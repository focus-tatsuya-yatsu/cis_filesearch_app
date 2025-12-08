# AWS EC2 File Processor Configuration Guide - CIS File Scanner

## Table of Contents
1. [Overview and Architecture](#overview-and-architecture)
2. [Launch Template Configuration](#launch-template-configuration)
3. [Auto Scaling Group Design](#auto-scaling-group-design)
4. [Python Worker Application](#python-worker-application)
5. [Integration with File Processing Pipeline](#integration-with-file-processing-pipeline)
6. [Performance Optimization](#performance-optimization)
7. [Monitoring and Troubleshooting](#monitoring-and-troubleshooting)
8. [Cost Optimization](#cost-optimization)
9. [Security Best Practices](#security-best-practices)
10. [Production Deployment Checklist](#production-deployment-checklist)

---

## Overview and Architecture

### Why EC2 Instead of Lambda?

**Lambda limitations for our use case:**
- **15-minute maximum timeout**: Tesseract OCR on large PDFs can take 20-60 minutes
- **Memory constraints**: Lambda max 10GB vs EC2 8GB+ with disk swap
- **Cost at scale**: Processing 100K+ files/month is cheaper with Spot Instances
- **Specialized libraries**: Tesseract + Japanese language packs require custom environment

**EC2 benefits:**
- **No time limits**: Process files taking hours if needed
- **Cost-effective**: Spot Instances 70-90% cheaper than On-Demand
- **Custom environment**: Full control over OS, libraries, and configurations
- **Scaling flexibility**: Auto Scaling based on queue depth

### Processing Flow

```
┌──────────────┐
│   DataSync   │ Syncs NAS → S3
└──────┬───────┘
       │
       ▼
┌──────────────┐
│      S3      │ Landing bucket
│   Bucket     │
└──────┬───────┘
       │ S3 Event
       ▼
┌──────────────┐
│  EventBridge │ Routes events
└──────┬───────┘
       │
       ▼
┌──────────────┐
│     SQS      │ Message queue (buffering)
│    Queue     │
└──────┬───────┘
       │ SQS Polling
       ▼
┌──────────────────────────────────────┐
│   Auto Scaling Group (1-10 EC2)     │
│   ┌──────────┬──────────┬─────────┐ │
│   │ Worker 1 │ Worker 2 │ Worker N│ │
│   │          │          │         │ │
│   │ Python   │ Python   │ Python  │ │
│   │ Tesseract│ Tesseract│Tesseract│ │
│   └──────────┴──────────┴─────────┘ │
└──────────┬───────────────────────────┘
           │
           ├──────────┬──────────────┬──────────┐
           ▼          ▼              ▼          ▼
       ┌─────┐   ┌────────┐   ┌──────────┐  ┌────┐
       │  S3 │   │ Bedrock│   │OpenSearch│  │ S3 │
       │Files│   │ Titan  │   │  Index   │  │Thumb│
       └─────┘   │Embeddi │   └──────────┘  └────┘
                 │  ngs   │
                 └────────┘
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Spot Instances** | 70-90% cost savings, acceptable interruption for batch processing |
| **c5.xlarge** | CPU-optimized for Tesseract OCR (4 vCPU, 8GB RAM) |
| **Amazon Linux 2023** | Latest packages, security updates, optimized for AWS |
| **Python 3.11** | Modern async/await, better performance than 3.9 |
| **SQS Target Tracking** | Auto-scale based on queue depth (messages per instance) |
| **Multiprocessing** | Parallel file processing within each instance |

### Resource Specifications

**EC2 Instance Type: c5.xlarge**
- vCPU: 4 cores (Intel Xeon Platinum 8000)
- Memory: 8GB RAM
- Network: Up to 10 Gbps
- EBS-optimized: Yes
- Spot Price (Tokyo): ~$0.034/hour (vs $0.17 On-Demand)

**Workload Capacity:**
- Concurrent files per instance: 4 (1 per vCPU)
- OCR processing time: 30-180 seconds per page
- Thumbnail generation: 5-10 seconds per file
- Bedrock embedding: 2-5 seconds per file
- **Estimated throughput**: 40-80 files/hour per instance

---

## Launch Template Configuration

### Overview

Launch Templates define the EC2 configuration for Auto Scaling Groups. This includes AMI, instance type, security groups, IAM role, and User Data script.

### Step 1: Create IAM Role for EC2 Workers

#### Required Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3FileAccess",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::cis-filesearch-landing-prod/*",
        "arn:aws:s3:::cis-filesearch-thumbnails-prod/*"
      ]
    },
    {
      "Sid": "S3BucketList",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": [
        "arn:aws:s3:::cis-filesearch-landing-prod",
        "arn:aws:s3:::cis-filesearch-thumbnails-prod"
      ]
    },
    {
      "Sid": "SQSMessageProcessing",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:ChangeMessageVisibility"
      ],
      "Resource": [
        "arn:aws:sqs:ap-northeast-1:*:cis-filesearch-queue-prod",
        "arn:aws:sqs:ap-northeast-1:*:cis-filesearch-dlq-prod"
      ]
    },
    {
      "Sid": "BedrockEmbeddings",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel"
      ],
      "Resource": [
        "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0"
      ]
    },
    {
      "Sid": "OpenSearchAccess",
      "Effect": "Allow",
      "Action": [
        "es:ESHttpPost",
        "es:ESHttpPut",
        "es:ESHttpGet"
      ],
      "Resource": [
        "arn:aws:es:ap-northeast-1:*:domain/cis-filesearch-prod/*"
      ]
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": [
        "arn:aws:logs:ap-northeast-1:*:log-group:/aws/cis-file-processor/*"
      ]
    },
    {
      "Sid": "CloudWatchMetrics",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricData"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "cloudwatch:namespace": "CISFileProcessor"
        }
      }
    },
    {
      "Sid": "EC2DescribeForAutoScaling",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeTags"
      ],
      "Resource": "*"
    }
  ]
}
```

#### Create Role via CLI

```bash
# Set variables
REGION="ap-northeast-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Create trust policy for EC2
cat > ec2-trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create IAM role
aws iam create-role \
  --role-name CISFileProcessorRole \
  --assume-role-policy-document file://ec2-trust-policy.json \
  --description "Role for CIS File Processor EC2 instances"

# Create and attach policy
cat > file-processor-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3FileAccess",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::cis-filesearch-landing-prod/*",
        "arn:aws:s3:::cis-filesearch-thumbnails-prod/*"
      ]
    },
    {
      "Sid": "SQSMessageProcessing",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:ChangeMessageVisibility"
      ],
      "Resource": "arn:aws:sqs:${REGION}:${ACCOUNT_ID}:cis-filesearch-queue-prod"
    },
    {
      "Sid": "BedrockEmbeddings",
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0"
    },
    {
      "Sid": "OpenSearchAccess",
      "Effect": "Allow",
      "Action": [
        "es:ESHttpPost",
        "es:ESHttpPut",
        "es:ESHttpGet"
      ],
      "Resource": "arn:aws:es:${REGION}:${ACCOUNT_ID}:domain/cis-filesearch-prod/*"
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:${REGION}:${ACCOUNT_ID}:log-group:/aws/cis-file-processor/*"
    },
    {
      "Sid": "CloudWatchMetrics",
      "Effect": "Allow",
      "Action": "cloudwatch:PutMetricData",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "cloudwatch:namespace": "CISFileProcessor"
        }
      }
    }
  ]
}
EOF

aws iam create-policy \
  --policy-name CISFileProcessorPolicy \
  --policy-document file://file-processor-policy.json

# Attach policy to role
aws iam attach-role-policy \
  --role-name CISFileProcessorRole \
  --policy-arn arn:aws:iam::${ACCOUNT_ID}:policy/CISFileProcessorPolicy

# Create instance profile
aws iam create-instance-profile \
  --instance-profile-name CISFileProcessorInstanceProfile

aws iam add-role-to-instance-profile \
  --instance-profile-name CISFileProcessorInstanceProfile \
  --role-name CISFileProcessorRole

echo "IAM Role created: CISFileProcessorRole"
```

### Step 2: Select Amazon Linux 2023 AMI

```bash
# Find latest Amazon Linux 2023 AMI
AMI_ID=$(aws ec2 describe-images \
  --owners amazon \
  --filters \
    "Name=name,Values=al2023-ami-2023.*-x86_64" \
    "Name=state,Values=available" \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' \
  --output text)

echo "Latest AL2023 AMI: $AMI_ID"

# Expected output: ami-0d48337b7d3c86f62 (as of Jan 2025)
```

**Why Amazon Linux 2023?**
- **Latest packages**: Python 3.11, systemd 252, kernel 6.1
- **Security**: Automatic security updates, SELinux enabled
- **Performance**: Optimized for AWS infrastructure
- **Support**: 5 years of support (until 2028)
- **Cost**: No additional licensing fees

### Step 3: Create User Data Script

User Data runs once at instance launch. This script installs all dependencies and starts the worker application.

```bash
#!/bin/bash
# User Data script for CIS File Processor EC2 instances
# Amazon Linux 2023

set -e  # Exit on any error

# Logging
exec > >(tee /var/log/user-data.log)
exec 2>&1

echo "=== CIS File Processor Setup Started at $(date) ==="

# Update system
echo "Updating system packages..."
dnf update -y

# Install Python 3.11 and development tools
echo "Installing Python 3.11..."
dnf install -y \
  python3.11 \
  python3.11-pip \
  python3.11-devel \
  gcc \
  gcc-c++ \
  make \
  git

# Create symlinks for python3.11
alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1
alternatives --set python3 /usr/bin/python3.11

# Verify Python version
python3 --version

# Install Tesseract OCR
echo "Installing Tesseract OCR..."
dnf install -y \
  tesseract \
  tesseract-devel

# Install Japanese language pack for Tesseract
echo "Installing Tesseract Japanese language pack..."
dnf install -y tesseract-langpack-jpn

# Verify Tesseract installation
tesseract --version
tesseract --list-langs

# Install image processing libraries
echo "Installing image processing libraries..."
dnf install -y \
  libjpeg-turbo \
  libjpeg-turbo-devel \
  libpng \
  libpng-devel \
  libtiff \
  libtiff-devel \
  libwebp \
  libwebp-devel

# Install PDF processing libraries
dnf install -y \
  poppler-utils \
  ghostscript

# Install CloudWatch Agent
echo "Installing CloudWatch Agent..."
dnf install -y amazon-cloudwatch-agent

# Configure CloudWatch Agent
cat > /opt/aws/amazon-cloudwatch-agent/etc/config.json <<'CLOUDWATCH_CONFIG'
{
  "agent": {
    "metrics_collection_interval": 60,
    "run_as_user": "cwagent"
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/cis-file-processor/app.log",
            "log_group_name": "/aws/cis-file-processor/prod/application",
            "log_stream_name": "{instance_id}",
            "retention_in_days": 30,
            "timezone": "Asia/Tokyo"
          },
          {
            "file_path": "/var/log/cis-file-processor/error.log",
            "log_group_name": "/aws/cis-file-processor/prod/errors",
            "log_stream_name": "{instance_id}",
            "retention_in_days": 90,
            "timezone": "Asia/Tokyo"
          },
          {
            "file_path": "/var/log/user-data.log",
            "log_group_name": "/aws/cis-file-processor/prod/user-data",
            "log_stream_name": "{instance_id}",
            "retention_in_days": 7,
            "timezone": "Asia/Tokyo"
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "CISFileProcessor",
    "metrics_collected": {
      "cpu": {
        "measurement": [
          {
            "name": "cpu_usage_idle",
            "rename": "CPU_IDLE",
            "unit": "Percent"
          },
          {
            "name": "cpu_usage_iowait",
            "rename": "CPU_IOWAIT",
            "unit": "Percent"
          }
        ],
        "metrics_collection_interval": 60,
        "totalcpu": false
      },
      "disk": {
        "measurement": [
          {
            "name": "used_percent",
            "rename": "DISK_USED",
            "unit": "Percent"
          }
        ],
        "metrics_collection_interval": 60,
        "resources": [
          "/"
        ]
      },
      "mem": {
        "measurement": [
          {
            "name": "mem_used_percent",
            "rename": "MEM_USED",
            "unit": "Percent"
          }
        ],
        "metrics_collection_interval": 60
      }
    }
  }
}
CLOUDWATCH_CONFIG

# Start CloudWatch Agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/config.json

# Create application user
echo "Creating application user..."
useradd -r -s /bin/bash -d /opt/cis-file-processor cis-processor

# Create application directories
mkdir -p /opt/cis-file-processor/{app,venv,logs,temp}
mkdir -p /var/log/cis-file-processor

# Set ownership
chown -R cis-processor:cis-processor /opt/cis-file-processor
chown -R cis-processor:cis-processor /var/log/cis-file-processor

# Install Python application
echo "Installing Python worker application..."
cd /opt/cis-file-processor

# Create virtual environment
sudo -u cis-processor python3 -m venv venv

# Activate venv and install dependencies
sudo -u cis-processor bash <<'INSTALL_DEPS'
source venv/bin/activate

# Upgrade pip
pip install --upgrade pip setuptools wheel

# Install AWS SDK
pip install boto3 botocore

# Install image processing
pip install Pillow

# Install PDF processing
pip install PyPDF2 pdf2image

# Install Tesseract wrapper
pip install pytesseract

# Install async/multiprocessing
pip install aiofiles asyncio

# Install logging and monitoring
pip install python-json-logger watchtower

# Install OpenSearch client
pip install opensearch-py requests-aws4auth

echo "Python dependencies installed"
INSTALL_DEPS

# Download worker application from S3
echo "Downloading worker application..."
aws s3 cp s3://cis-filesearch-config-prod/worker-app/worker.py \
  /opt/cis-file-processor/app/worker.py

aws s3 cp s3://cis-filesearch-config-prod/worker-app/config.py \
  /opt/cis-file-processor/app/config.py

# Set permissions
chown -R cis-processor:cis-processor /opt/cis-file-processor/app

# Create systemd service
cat > /etc/systemd/system/cis-file-processor.service <<'SYSTEMD_SERVICE'
[Unit]
Description=CIS File Processor Worker
After=network.target

[Service]
Type=simple
User=cis-processor
Group=cis-processor
WorkingDirectory=/opt/cis-file-processor/app
Environment="PATH=/opt/cis-file-processor/venv/bin:/usr/local/bin:/usr/bin:/bin"
Environment="PYTHONUNBUFFERED=1"
ExecStart=/opt/cis-file-processor/venv/bin/python worker.py
Restart=always
RestartSec=10
StandardOutput=append:/var/log/cis-file-processor/app.log
StandardError=append:/var/log/cis-file-processor/error.log

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
SYSTEMD_SERVICE

# Reload systemd and enable service
systemctl daemon-reload
systemctl enable cis-file-processor.service
systemctl start cis-file-processor.service

# Wait for service to start
sleep 5

# Check service status
systemctl status cis-file-processor.service

echo "=== CIS File Processor Setup Completed at $(date) ==="
echo "Instance is ready to process files"
```

### Step 4: Create Launch Template via Console

1. **Navigate to EC2 Console**
   - AWS Console → EC2 → Launch Templates → Create launch template

2. **Basic Configuration**
   - **Name**: `cis-file-processor-template-v1`
   - **Description**: `Launch template for CIS File Processor workers with Tesseract OCR`
   - **Template tags**:
     - `Project: CISFileSearch`
     - `Component: FileProcessor`
     - `Environment: Production`

3. **Application and OS Images (AMI)**
   - **AMI**: Use AMI ID from Step 2 (Amazon Linux 2023)
   - **Architecture**: x86_64

4. **Instance Type**
   - **Type**: `c5.xlarge` (4 vCPU, 8GB RAM)
   - **Why**: CPU-optimized for Tesseract OCR

5. **Key Pair**
   - **Key pair**: Select existing or create new (for SSH troubleshooting)
   - **Recommendation**: Create `cis-file-processor-key` for emergency access

6. **Network Settings**
   - **Subnet**: Don't include in template (Auto Scaling will specify)
   - **Security groups**: Create new security group
     - **Name**: `cis-file-processor-sg`
     - **Inbound rules**:
       - SSH (22) from bastion host or VPN IP only
     - **Outbound rules**:
       - HTTPS (443) to 0.0.0.0/0 (for AWS services)
       - HTTP (80) to 0.0.0.0/0 (for package updates)

7. **Storage (EBS)**
   - **Volume 1 (Root)**:
     - **Size**: 30 GB (OS + application + temp files)
     - **Volume type**: gp3 (better performance than gp2)
     - **IOPS**: 3000 (default)
     - **Throughput**: 125 MB/s (default)
     - **Delete on termination**: Yes
     - **Encrypted**: Yes (use default AWS KMS key)

8. **Resource Tags**
   - **Tag volumes and instances**:
     - `Name: cis-file-processor`
     - `Project: CISFileSearch`
     - `ManagedBy: AutoScaling`
     - `Environment: Production`
     - `CostCenter: IT`

9. **Advanced Details**
   - **IAM instance profile**: `CISFileProcessorInstanceProfile`
   - **Monitoring**: Enable detailed monitoring (1-minute metrics)
   - **Termination protection**: Disabled (Auto Scaling manages)
   - **Shutdown behavior**: Terminate
   - **Stop - Hibernate behavior**: Disabled
   - **Spot options**: Request Spot Instances
     - **Maximum price**: Empty (use current Spot price)
     - **Interruption behavior**: Terminate
     - **Request type**: Persistent
   - **User data**: Paste the User Data script from Step 3
   - **Metadata options**:
     - **Metadata version**: V2 only (IMDSv2)
     - **Metadata response hop limit**: 1

10. **Create Template**
    - Review all settings
    - Click "Create launch template"

### Step 5: Create Launch Template via CLI

```bash
# Set variables
REGION="ap-northeast-1"
TEMPLATE_NAME="cis-file-processor-template-v1"
AMI_ID="ami-0d48337b7d3c86f62"  # Replace with latest from Step 2
INSTANCE_TYPE="c5.xlarge"
KEY_NAME="cis-file-processor-key"
SECURITY_GROUP_ID="sg-xxxxx"  # Replace with your SG ID
INSTANCE_PROFILE_ARN="arn:aws:iam::${ACCOUNT_ID}:instance-profile/CISFileProcessorInstanceProfile"

# Create launch template
aws ec2 create-launch-template \
  --launch-template-name $TEMPLATE_NAME \
  --version-description "v1 - Initial release with Tesseract OCR and Python 3.11" \
  --launch-template-data '{
    "ImageId": "'$AMI_ID'",
    "InstanceType": "'$INSTANCE_TYPE'",
    "KeyName": "'$KEY_NAME'",
    "SecurityGroupIds": ["'$SECURITY_GROUP_ID'"],
    "IamInstanceProfile": {
      "Arn": "'$INSTANCE_PROFILE_ARN'"
    },
    "BlockDeviceMappings": [
      {
        "DeviceName": "/dev/xvda",
        "Ebs": {
          "VolumeSize": 30,
          "VolumeType": "gp3",
          "Iops": 3000,
          "Throughput": 125,
          "DeleteOnTermination": true,
          "Encrypted": true
        }
      }
    ],
    "InstanceMarketOptions": {
      "MarketType": "spot",
      "SpotOptions": {
        "SpotInstanceType": "persistent",
        "InstanceInterruptionBehavior": "terminate"
      }
    },
    "Monitoring": {
      "Enabled": true
    },
    "MetadataOptions": {
      "HttpTokens": "required",
      "HttpPutResponseHopLimit": 1
    },
    "TagSpecifications": [
      {
        "ResourceType": "instance",
        "Tags": [
          {"Key": "Name", "Value": "cis-file-processor"},
          {"Key": "Project", "Value": "CISFileSearch"},
          {"Key": "Environment", "Value": "Production"},
          {"Key": "ManagedBy", "Value": "AutoScaling"}
        ]
      },
      {
        "ResourceType": "volume",
        "Tags": [
          {"Key": "Name", "Value": "cis-file-processor-root"},
          {"Key": "Project", "Value": "CISFileSearch"}
        ]
      }
    ],
    "UserData": "'$(base64 -w 0 user-data.sh)'"
  }'

echo "Launch Template created: $TEMPLATE_NAME"
```

### User Data Best Practices

**DO:**
- ✅ Log all output to `/var/log/user-data.log` for debugging
- ✅ Use `set -e` to exit on errors
- ✅ Verify installations with `--version` commands
- ✅ Create systemd service for automatic restart
- ✅ Set up CloudWatch Agent for monitoring
- ✅ Use dedicated user (not root) for application

**DON'T:**
- ❌ Hardcode secrets (use Secrets Manager or Parameter Store)
- ❌ Run application as root user
- ❌ Skip error handling
- ❌ Install unnecessary packages
- ❌ Forget to enable and start services

### Testing Launch Template

```bash
# Test by launching a single instance
aws ec2 run-instances \
  --launch-template LaunchTemplateName=$TEMPLATE_NAME \
  --subnet-id subnet-xxxxx \
  --count 1

# Get instance ID
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=cis-file-processor" \
          "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)

echo "Test instance launched: $INSTANCE_ID"

# Wait for instance to be ready
aws ec2 wait instance-status-ok --instance-ids $INSTANCE_ID

# Check User Data logs
aws ssm send-command \
  --instance-ids $INSTANCE_ID \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["tail -n 50 /var/log/user-data.log"]'

# Or SSH into instance
ssh -i ~/.ssh/cis-file-processor-key.pem ec2-user@$(aws ec2 describe-instances \
  --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)

# Check service status
sudo systemctl status cis-file-processor

# Check CloudWatch Agent
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a query -m ec2 -c default -s

# Terminate test instance
aws ec2 terminate-instances --instance-ids $INSTANCE_ID
```

---

## Auto Scaling Group Design

### Overview

Auto Scaling Groups (ASG) automatically adjust the number of EC2 instances based on demand (SQS queue depth in our case).

### Step 1: Determine Scaling Parameters

**Key calculations:**

```python
# Variables
messages_per_instance = 10  # How many messages should queue before adding instance
min_instances = 1           # Always keep 1 running
max_instances = 10          # Maximum for cost control
desired_capacity = 2        # Healthy state

# Target Tracking Metric
target_value = messages_per_instance  # 10 messages per instance

# Example scenario:
# Queue has 45 messages → ASG scales to 45 / 10 = 5 instances (rounded up)
# Queue has 5 messages → ASG maintains min of 1 instance
# Queue has 150 messages → ASG scales to 10 instances (max limit)
```

**Scaling thresholds:**

| Queue Depth | Instances | Reason |
|-------------|-----------|--------|
| 0-9 messages | 1 | Minimum capacity |
| 10-19 messages | 2 | 1st scale-out |
| 20-29 messages | 3 | 2nd scale-out |
| 50-59 messages | 5 | Moderate load |
| 100+ messages | 10 | Maximum capacity (cost limit) |

### Step 2: Create Auto Scaling Group (Console)

1. **Navigate to Auto Scaling**
   - EC2 Console → Auto Scaling Groups → Create Auto Scaling group

2. **Choose Launch Template**
   - **Name**: `cis-file-processor-asg-prod`
   - **Launch template**: `cis-file-processor-template-v1`
   - **Version**: Latest

3. **Network**
   - **VPC**: Select your VPC
   - **Subnets**: Select multiple AZs for high availability
     - `ap-northeast-1a` (subnet-xxxxx)
     - `ap-northeast-1c` (subnet-yyyyy)
     - `ap-northeast-1d` (subnet-zzzzz)
   - **Why multiple AZs**: Spot Instance availability varies by AZ

4. **Advanced Options**
   - **Load balancing**: None (we're not using ALB)
   - **Health checks**:
     - **Health check type**: EC2
     - **Health check grace period**: 300 seconds (time for User Data to complete)
   - **Additional settings**:
     - **Monitoring**: Enable CloudWatch group metrics

5. **Group Size and Scaling**
   - **Desired capacity**: 2
   - **Minimum capacity**: 1
   - **Maximum capacity**: 10

6. **Automatic Scaling (Target Tracking)**
   - **Scaling policy name**: `cis-sqs-target-tracking`
   - **Metric type**: Custom metric
   - **Custom metric**:
     ```json
     {
       "Namespace": "AWS/SQS",
       "MetricName": "ApproximateNumberOfMessagesVisible",
       "Dimensions": [
         {
           "Name": "QueueName",
           "Value": "cis-filesearch-queue-prod"
         }
       ],
       "Statistic": "Average",
       "Unit": "None"
     }
     ```
   - **Target value**: 10 (messages per instance)
   - **Instances need**: 300 seconds warm-up before counted

   **How this works:**
   ```
   Current Messages in Queue: 45
   Current Instances: 2
   Messages Per Instance: 45 / 2 = 22.5
   Target: 10

   Since 22.5 > 10, ASG scales OUT:
   Desired Instances = 45 / 10 = 5 instances (rounded up)

   ASG launches 3 more instances (5 - 2 = 3)
   ```

7. **Instance Maintenance Policy**
   - **Instance refresh**: Disabled (manual updates only)
   - **Termination policies**:
     1. `OldestInstance` (terminate oldest first when scaling in)
     2. `Default` (balanced across AZs)

8. **Add Notifications (Optional)**
   - **SNS topic**: `cis-file-processor-asg-notifications`
   - **Events**:
     - Launch
     - Terminate
     - Fail to launch
     - Fail to terminate

9. **Tags**
   - `Name: cis-file-processor`
   - `Project: CISFileSearch`
   - `Environment: Production`
   - `ManagedBy: AutoScaling`
   - **Propagate to instances**: Yes

10. **Review and Create**

### Step 3: Create Auto Scaling Group (CLI)

```bash
# Set variables
ASG_NAME="cis-file-processor-asg-prod"
TEMPLATE_NAME="cis-file-processor-template-v1"
SUBNET_IDS="subnet-xxxxx,subnet-yyyyy,subnet-zzzzz"
QUEUE_NAME="cis-filesearch-queue-prod"
MIN_SIZE=1
MAX_SIZE=10
DESIRED_CAPACITY=2

# Create Auto Scaling Group
aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name $ASG_NAME \
  --launch-template "LaunchTemplateName=${TEMPLATE_NAME},Version=\$Latest" \
  --min-size $MIN_SIZE \
  --max-size $MAX_SIZE \
  --desired-capacity $DESIRED_CAPACITY \
  --vpc-zone-identifier $SUBNET_IDS \
  --health-check-type EC2 \
  --health-check-grace-period 300 \
  --tags \
    "Key=Name,Value=cis-file-processor,PropagateAtLaunch=true" \
    "Key=Project,Value=CISFileSearch,PropagateAtLaunch=true" \
    "Key=Environment,Value=Production,PropagateAtLaunch=true" \
    "Key=ManagedBy,Value=AutoScaling,PropagateAtLaunch=true"

# Enable CloudWatch group metrics
aws autoscaling enable-metrics-collection \
  --auto-scaling-group-name $ASG_NAME \
  --granularity "1Minute" \
  --metrics \
    GroupMinSize \
    GroupMaxSize \
    GroupDesiredCapacity \
    GroupInServiceInstances \
    GroupTotalInstances

# Create Target Tracking Scaling Policy
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name $ASG_NAME \
  --policy-name cis-sqs-target-tracking \
  --policy-type TargetTrackingScaling \
  --target-tracking-configuration '{
    "CustomizedMetricSpecification": {
      "MetricName": "ApproximateNumberOfMessagesVisible",
      "Namespace": "AWS/SQS",
      "Dimensions": [
        {
          "Name": "QueueName",
          "Value": "'$QUEUE_NAME'"
        }
      ],
      "Statistic": "Average",
      "Unit": "None"
    },
    "TargetValue": 10.0
  }'

echo "Auto Scaling Group created: $ASG_NAME"
```

### Spot Instance Allocation Strategy

**Capacity-Optimized Allocation:**

The launch template specifies Spot Instances. ASG automatically uses capacity-optimized allocation.

**How it works:**
1. ASG requests Spot Instances across all specified AZs
2. AWS selects instances from pools with most available capacity
3. This minimizes interruption rate (typically < 5%)

**Interruption handling:**
- **Behavior**: Terminate (configured in launch template)
- **2-minute warning**: EC2 sends termination notice
- **Graceful shutdown**: Worker application should handle SIGTERM

**Monitor Spot interruptions:**

```bash
# Check Spot interruption rate
aws ec2 describe-spot-instance-requests \
  --filters "Name=state,Values=active" \
  --query 'SpotInstanceRequests[*].[InstanceId,Status.Code,Status.Message]'

# Set up CloudWatch alarm for high interruption rate
aws cloudwatch put-metric-alarm \
  --alarm-name cis-spot-interruption-rate \
  --alarm-description "Alert if Spot interruption rate > 10%" \
  --metric-name SpotInstanceInterruptionRate \
  --namespace AWS/EC2Spot \
  --statistic Average \
  --period 300 \
  --threshold 0.1 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2
```

### Scaling Cooldown and Warm-up

**Default Cooldown**: 300 seconds (5 minutes)
- After scaling activity, wait 5 minutes before next scale-in/out
- Prevents rapid fluctuations

**Warm-up Time**: 300 seconds
- Time for new instance to be "ready" before counted in metrics
- Matches health check grace period (User Data completion time)

**Fine-tuning:**

```bash
# If instances start processing faster (< 5 minutes)
aws autoscaling update-auto-scaling-group \
  --auto-scaling-group-name $ASG_NAME \
  --health-check-grace-period 180  # 3 minutes

# If scaling is too aggressive
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name $ASG_NAME \
  --policy-name cis-sqs-target-tracking \
  --policy-type TargetTrackingScaling \
  --target-tracking-configuration '{
    "CustomizedMetricSpecification": { ... },
    "TargetValue": 20.0,
    "ScaleInCooldown": 600,
    "ScaleOutCooldown": 300
  }'
```

### Testing Auto Scaling

**Test scale-out:**

```bash
# Send 100 test messages to SQS
for i in {1..100}; do
  aws sqs send-message \
    --queue-url https://sqs.ap-northeast-1.amazonaws.com/${ACCOUNT_ID}/${QUEUE_NAME} \
    --message-body "{\"test\": true, \"id\": $i}" &
done
wait

# Watch scaling activity
watch -n 10 'aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names '$ASG_NAME' \
  --query "AutoScalingGroups[0].[DesiredCapacity,MinSize,MaxSize,Instances[*].[InstanceId,LifecycleState]]"'

# Expected: ASG scales from 2 to 10 instances over ~5-10 minutes
```

**Test scale-in:**

```bash
# Purge queue (test only!)
aws sqs purge-queue \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/${ACCOUNT_ID}/${QUEUE_NAME}

# Watch ASG scale down
# Expected: After 10-15 minutes, ASG scales back to min capacity (1 instance)
```

---

## Python Worker Application

### Architecture

```
┌─────────────────────────────────────────┐
│        worker.py (Main Process)         │
│                                         │
│  ┌────────────────────────────────┐    │
│  │   SQS Long Polling Loop        │    │
│  │   (Receives up to 10 messages) │    │
│  └──────────┬─────────────────────┘    │
│             │                           │
│             ▼                           │
│  ┌────────────────────────────────┐    │
│  │  Multiprocessing Pool (4)      │    │
│  │  ┌─────┬─────┬─────┬─────┐    │    │
│  │  │ P1  │ P2  │ P3  │ P4  │    │    │
│  │  │ OCR │ OCR │ OCR │ OCR │    │    │
│  │  └─────┴─────┴─────┴─────┘    │    │
│  └────────────────────────────────┘    │
│             │                           │
│             ▼                           │
│  ┌────────────────────────────────┐    │
│  │   File Processing Pipeline     │    │
│  │   1. Download from S3          │    │
│  │   2. Tesseract OCR             │    │
│  │   3. Thumbnail generation      │    │
│  │   4. Bedrock embeddings        │    │
│  │   5. OpenSearch indexing       │    │
│  │   6. Cleanup & SQS delete      │    │
│  └────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

### Core Application: worker.py

```python
#!/usr/bin/env python3
"""
CIS File Processor Worker
Processes files from SQS queue using Tesseract OCR, generates thumbnails,
creates embeddings, and indexes to OpenSearch.
"""

import os
import sys
import json
import time
import signal
import logging
import hashlib
import tempfile
import multiprocessing
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from datetime import datetime

# AWS SDK
import boto3
from botocore.exceptions import ClientError

# Image processing
from PIL import Image

# PDF processing
from pdf2image import convert_from_path
import PyPDF2

# OCR
import pytesseract

# OpenSearch
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

# Logging
from pythonjsonlogger import jsonlogger

# ============================================================================
# Configuration
# ============================================================================

@dataclass
class Config:
    """Application configuration loaded from environment variables"""

    # AWS Region
    region: str = os.getenv('AWS_REGION', 'ap-northeast-1')

    # SQS
    queue_url: str = os.getenv('SQS_QUEUE_URL', '')
    queue_visibility_timeout: int = int(os.getenv('SQS_VISIBILITY_TIMEOUT', '300'))
    queue_wait_time: int = int(os.getenv('SQS_WAIT_TIME', '20'))
    max_messages: int = int(os.getenv('SQS_MAX_MESSAGES', '10'))

    # S3
    landing_bucket: str = os.getenv('S3_LANDING_BUCKET', 'cis-filesearch-landing-prod')
    thumbnail_bucket: str = os.getenv('S3_THUMBNAIL_BUCKET', 'cis-filesearch-thumbnails-prod')

    # Bedrock
    bedrock_region: str = os.getenv('BEDROCK_REGION', 'us-east-1')
    bedrock_model: str = os.getenv('BEDROCK_MODEL', 'amazon.titan-embed-text-v2:0')

    # OpenSearch
    opensearch_endpoint: str = os.getenv('OPENSEARCH_ENDPOINT', '')
    opensearch_index: str = os.getenv('OPENSEARCH_INDEX', 'cis-filesearch-prod')

    # Processing
    worker_processes: int = int(os.getenv('WORKER_PROCESSES', str(multiprocessing.cpu_count())))
    temp_dir: str = os.getenv('TEMP_DIR', '/opt/cis-file-processor/temp')

    # Tesseract
    tesseract_lang: str = os.getenv('TESSERACT_LANG', 'jpn+eng')
    tesseract_config: str = os.getenv('TESSERACT_CONFIG', '--psm 1 --oem 3')

    # Thumbnails
    thumbnail_width: int = int(os.getenv('THUMBNAIL_WIDTH', '800'))
    thumbnail_quality: int = int(os.getenv('THUMBNAIL_QUALITY', '85'))

    # Logging
    log_level: str = os.getenv('LOG_LEVEL', 'INFO')
    log_file: str = os.getenv('LOG_FILE', '/var/log/cis-file-processor/app.log')

    def __post_init__(self):
        """Validate configuration"""
        if not self.queue_url:
            raise ValueError("SQS_QUEUE_URL environment variable is required")
        if not self.opensearch_endpoint:
            raise ValueError("OPENSEARCH_ENDPOINT environment variable is required")

        # Create temp directory
        Path(self.temp_dir).mkdir(parents=True, exist_ok=True)


# ============================================================================
# Logging Setup
# ============================================================================

def setup_logging(config: Config) -> logging.Logger:
    """Configure structured JSON logging"""

    logger = logging.getLogger('cis-file-processor')
    logger.setLevel(getattr(logging, config.log_level.upper()))

    # JSON formatter
    formatter = jsonlogger.JsonFormatter(
        '%(timestamp)s %(level)s %(name)s %(message)s',
        timestamp=True
    )

    # File handler
    file_handler = logging.FileHandler(config.log_file)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    # Console handler (for CloudWatch Logs)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    return logger


# ============================================================================
# AWS Clients
# ============================================================================

class AWSClients:
    """Singleton AWS service clients"""

    def __init__(self, config: Config):
        self.config = config
        self._sqs = None
        self._s3 = None
        self._bedrock = None
        self._opensearch = None
        self._cloudwatch = None

    @property
    def sqs(self):
        if self._sqs is None:
            self._sqs = boto3.client('sqs', region_name=self.config.region)
        return self._sqs

    @property
    def s3(self):
        if self._s3 is None:
            self._s3 = boto3.client('s3', region_name=self.config.region)
        return self._s3

    @property
    def bedrock(self):
        if self._bedrock is None:
            self._bedrock = boto3.client(
                'bedrock-runtime',
                region_name=self.config.bedrock_region
            )
        return self._bedrock

    @property
    def opensearch(self):
        if self._opensearch is None:
            # Get AWS credentials for signing requests
            credentials = boto3.Session().get_credentials()
            awsauth = AWS4Auth(
                credentials.access_key,
                credentials.secret_key,
                self.config.region,
                'es',
                session_token=credentials.token
            )

            self._opensearch = OpenSearch(
                hosts=[{'host': self.config.opensearch_endpoint, 'port': 443}],
                http_auth=awsauth,
                use_ssl=True,
                verify_certs=True,
                connection_class=RequestsHttpConnection
            )
        return self._opensearch

    @property
    def cloudwatch(self):
        if self._cloudwatch is None:
            self._cloudwatch = boto3.client('cloudwatch', region_name=self.config.region)
        return self._cloudwatch


# ============================================================================
# File Processing
# ============================================================================

class FileProcessor:
    """Handles file processing pipeline"""

    def __init__(self, config: Config, aws_clients: AWSClients, logger: logging.Logger):
        self.config = config
        self.aws = aws_clients
        self.logger = logger

    def process_message(self, message: Dict[str, Any]) -> bool:
        """
        Process a single SQS message

        Returns:
            bool: True if processing succeeded, False otherwise
        """
        start_time = time.time()

        try:
            # Parse message body
            body = json.loads(message['Body'])
            s3_bucket = body.get('s3Bucket', self.config.landing_bucket)
            s3_key = body['s3Key']
            file_id = body.get('fileId', hashlib.md5(s3_key.encode()).hexdigest())

            self.logger.info(
                'Processing file',
                extra={
                    'file_id': file_id,
                    's3_key': s3_key,
                    'bucket': s3_bucket
                }
            )

            # Download file from S3
            local_file = self._download_from_s3(s3_bucket, s3_key)

            # Determine file type
            file_ext = Path(s3_key).suffix.lower()

            # Extract text using OCR
            extracted_text = self._extract_text(local_file, file_ext)

            # Generate thumbnail
            thumbnail_key = self._generate_thumbnail(local_file, file_ext, file_id)

            # Create embeddings using Bedrock
            embeddings = self._create_embeddings(extracted_text)

            # Index to OpenSearch
            self._index_to_opensearch(
                file_id=file_id,
                s3_key=s3_key,
                text=extracted_text,
                embeddings=embeddings,
                thumbnail_key=thumbnail_key,
                metadata=body.get('metadata', {})
            )

            # Cleanup local file
            os.remove(local_file)

            # Delete message from SQS
            self.aws.sqs.delete_message(
                QueueUrl=self.config.queue_url,
                ReceiptHandle=message['ReceiptHandle']
            )

            # Publish metrics
            processing_time = time.time() - start_time
            self._publish_metrics(processing_time, success=True)

            self.logger.info(
                'File processed successfully',
                extra={
                    'file_id': file_id,
                    'processing_time_seconds': processing_time
                }
            )

            return True

        except Exception as e:
            processing_time = time.time() - start_time
            self._publish_metrics(processing_time, success=False)

            self.logger.error(
                'File processing failed',
                extra={
                    'error': str(e),
                    'error_type': type(e).__name__,
                    'processing_time_seconds': processing_time
                },
                exc_info=True
            )

            return False

    def _download_from_s3(self, bucket: str, key: str) -> str:
        """Download file from S3 to local temp directory"""

        filename = Path(key).name
        local_path = os.path.join(
            self.config.temp_dir,
            f"{int(time.time())}_{filename}"
        )

        self.logger.debug('Downloading from S3', extra={'bucket': bucket, 'key': key})

        self.aws.s3.download_file(bucket, key, local_path)

        return local_path

    def _extract_text(self, file_path: str, file_ext: str) -> str:
        """Extract text from file using Tesseract OCR"""

        self.logger.debug('Extracting text', extra={'file': file_path, 'type': file_ext})

        if file_ext == '.pdf':
            return self._ocr_pdf(file_path)
        elif file_ext in ['.jpg', '.jpeg', '.png', '.tiff', '.bmp']:
            return self._ocr_image(file_path)
        elif file_ext == '.xdw':
            # DocuWorks files require special handling
            return self._ocr_docuworks(file_path)
        else:
            self.logger.warning('Unsupported file type', extra={'file_ext': file_ext})
            return ""

    def _ocr_pdf(self, pdf_path: str) -> str:
        """OCR a PDF file"""

        # Try to extract text directly first (for text-based PDFs)
        try:
            with open(pdf_path, 'rb') as pdf_file:
                pdf_reader = PyPDF2.PdfReader(pdf_file)
                text = ""
                for page in pdf_reader.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n"

                # If we extracted meaningful text, return it
                if len(text.strip()) > 100:
                    self.logger.debug('Extracted text from PDF directly (no OCR needed)')
                    return text
        except Exception as e:
            self.logger.warning(f'Direct PDF text extraction failed: {e}')

        # Convert PDF to images and OCR each page
        self.logger.debug('Converting PDF to images for OCR')
        images = convert_from_path(pdf_path, dpi=300)

        text = ""
        for i, image in enumerate(images):
            self.logger.debug(f'OCR-ing page {i+1}/{len(images)}')
            page_text = pytesseract.image_to_string(
                image,
                lang=self.config.tesseract_lang,
                config=self.config.tesseract_config
            )
            text += f"\n=== Page {i+1} ===\n{page_text}"

        return text

    def _ocr_image(self, image_path: str) -> str:
        """OCR an image file"""

        image = Image.open(image_path)
        text = pytesseract.image_to_string(
            image,
            lang=self.config.tesseract_lang,
            config=self.config.tesseract_config
        )

        return text

    def _ocr_docuworks(self, xdw_path: str) -> str:
        """
        OCR a DocuWorks file
        Note: Requires DocuWorks API or conversion to PDF first
        """
        # TODO: Implement DocuWorks handling
        # For now, return empty string
        self.logger.warning('DocuWorks OCR not yet implemented')
        return ""

    def _generate_thumbnail(self, file_path: str, file_ext: str, file_id: str) -> Optional[str]:
        """Generate thumbnail and upload to S3"""

        try:
            if file_ext == '.pdf':
                # Convert first page of PDF to image
                images = convert_from_path(file_path, dpi=150, first_page=1, last_page=1)
                image = images[0]
            elif file_ext in ['.jpg', '.jpeg', '.png', '.tiff', '.bmp']:
                image = Image.open(file_path)
            else:
                return None

            # Resize maintaining aspect ratio
            image.thumbnail((self.config.thumbnail_width, self.config.thumbnail_width))

            # Save to temp file
            thumbnail_path = os.path.join(
                self.config.temp_dir,
                f"{file_id}_thumb.jpg"
            )
            image.save(thumbnail_path, 'JPEG', quality=self.config.thumbnail_quality)

            # Upload to S3
            thumbnail_key = f"thumbnails/{file_id}.jpg"
            self.aws.s3.upload_file(
                thumbnail_path,
                self.config.thumbnail_bucket,
                thumbnail_key
            )

            # Cleanup
            os.remove(thumbnail_path)

            self.logger.debug('Thumbnail generated', extra={'key': thumbnail_key})

            return thumbnail_key

        except Exception as e:
            self.logger.error(f'Thumbnail generation failed: {e}')
            return None

    def _create_embeddings(self, text: str) -> List[float]:
        """Create embeddings using Bedrock Titan"""

        if not text or len(text.strip()) == 0:
            return []

        # Truncate text to max length (Titan limit: 8K tokens ≈ 32K characters)
        max_chars = 30000
        if len(text) > max_chars:
            text = text[:max_chars]
            self.logger.debug('Text truncated for embedding')

        try:
            response = self.aws.bedrock.invoke_model(
                modelId=self.config.bedrock_model,
                body=json.dumps({
                    "inputText": text,
                    "dimensions": 512,
                    "normalize": True
                })
            )

            result = json.loads(response['body'].read())
            embeddings = result['embedding']

            self.logger.debug('Embeddings created', extra={'dimensions': len(embeddings)})

            return embeddings

        except Exception as e:
            self.logger.error(f'Embedding creation failed: {e}')
            return []

    def _index_to_opensearch(
        self,
        file_id: str,
        s3_key: str,
        text: str,
        embeddings: List[float],
        thumbnail_key: Optional[str],
        metadata: Dict
    ):
        """Index document to OpenSearch"""

        document = {
            'file_id': file_id,
            's3_key': s3_key,
            'file_name': Path(s3_key).name,
            'file_path': str(Path(s3_key).parent),
            'file_ext': Path(s3_key).suffix.lower(),
            'content': text[:10000],  # Truncate very long content
            'content_length': len(text),
            'embedding': embeddings,
            'thumbnail_url': f"s3://{self.config.thumbnail_bucket}/{thumbnail_key}" if thumbnail_key else None,
            'indexed_at': datetime.utcnow().isoformat(),
            **metadata
        }

        self.aws.opensearch.index(
            index=self.config.opensearch_index,
            id=file_id,
            body=document
        )

        self.logger.debug('Document indexed to OpenSearch', extra={'file_id': file_id})

    def _publish_metrics(self, processing_time: float, success: bool):
        """Publish custom CloudWatch metrics"""

        try:
            self.aws.cloudwatch.put_metric_data(
                Namespace='CISFileProcessor',
                MetricData=[
                    {
                        'MetricName': 'FilesProcessed',
                        'Value': 1,
                        'Unit': 'Count',
                        'Dimensions': [
                            {'Name': 'Status', 'Value': 'Success' if success else 'Failed'}
                        ]
                    },
                    {
                        'MetricName': 'ProcessingTime',
                        'Value': processing_time,
                        'Unit': 'Seconds',
                        'Dimensions': [
                            {'Name': 'Status', 'Value': 'Success' if success else 'Failed'}
                        ]
                    }
                ]
            )
        except Exception as e:
            self.logger.warning(f'Failed to publish metrics: {e}')


# ============================================================================
# SQS Message Polling
# ============================================================================

class MessagePoller:
    """Handles SQS long polling and message distribution"""

    def __init__(
        self,
        config: Config,
        aws_clients: AWSClients,
        logger: logging.Logger
    ):
        self.config = config
        self.aws = aws_clients
        self.logger = logger
        self.running = True
        self.processor = FileProcessor(config, aws_clients, logger)

        # Multiprocessing pool
        self.pool = multiprocessing.Pool(processes=config.worker_processes)

        # Setup signal handlers for graceful shutdown
        signal.signal(signal.SIGTERM, self._shutdown_handler)
        signal.signal(signal.SIGINT, self._shutdown_handler)

    def _shutdown_handler(self, signum, frame):
        """Handle shutdown signals gracefully"""
        self.logger.info(f'Received signal {signum}, shutting down gracefully...')
        self.running = False
        self.pool.close()
        self.pool.join()
        sys.exit(0)

    def poll(self):
        """Main polling loop"""

        self.logger.info('Starting message polling', extra={
            'queue_url': self.config.queue_url,
            'max_messages': self.config.max_messages,
            'worker_processes': self.config.worker_processes
        })

        while self.running:
            try:
                # Long poll for messages
                response = self.aws.sqs.receive_message(
                    QueueUrl=self.config.queue_url,
                    MaxNumberOfMessages=self.config.max_messages,
                    WaitTimeSeconds=self.config.queue_wait_time,
                    MessageAttributeNames=['All']
                )

                messages = response.get('Messages', [])

                if not messages:
                    self.logger.debug('No messages received')
                    continue

                self.logger.info(f'Received {len(messages)} messages')

                # Process messages in parallel using pool
                results = []
                for message in messages:
                    result = self.pool.apply_async(
                        self.processor.process_message,
                        (message,)
                    )
                    results.append(result)

                # Wait for all to complete
                for result in results:
                    result.get(timeout=self.config.queue_visibility_timeout)

            except Exception as e:
                self.logger.error(f'Polling error: {e}', exc_info=True)
                time.sleep(5)  # Back off on errors


# ============================================================================
# Main Entry Point
# ============================================================================

def main():
    """Main application entry point"""

    # Load configuration
    config = Config()

    # Setup logging
    logger = setup_logging(config)

    logger.info('CIS File Processor starting', extra={
        'region': config.region,
        'worker_processes': config.worker_processes
    })

    # Initialize AWS clients
    aws_clients = AWSClients(config)

    # Create and start poller
    poller = MessagePoller(config, aws_clients, logger)

    try:
        poller.poll()
    except KeyboardInterrupt:
        logger.info('Interrupted by user')
    except Exception as e:
        logger.error(f'Fatal error: {e}', exc_info=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
```

### Configuration File: config.py

```python
"""
Configuration management for CIS File Processor
Supports environment variables and AWS Parameter Store
"""

import os
from typing import Optional
import boto3


class ConfigManager:
    """Centralized configuration management"""

    def __init__(self):
        self.ssm = boto3.client('ssm', region_name=os.getenv('AWS_REGION', 'ap-northeast-1'))
        self._cache = {}

    def get(self, key: str, default: Optional[str] = None, use_ssm: bool = False) -> Optional[str]:
        """
        Get configuration value
        Priority: Environment Variable > SSM Parameter Store > Default

        Args:
            key: Configuration key
            default: Default value if not found
            use_ssm: Whether to check SSM Parameter Store

        Returns:
            Configuration value or default
        """
        # Check environment variable first
        value = os.getenv(key)
        if value is not None:
            return value

        # Check SSM Parameter Store
        if use_ssm:
            ssm_key = f"/cis-file-processor/{key}"

            # Check cache
            if ssm_key in self._cache:
                return self._cache[ssm_key]

            try:
                response = self.ssm.get_parameter(
                    Name=ssm_key,
                    WithDecryption=True
                )
                value = response['Parameter']['Value']
                self._cache[ssm_key] = value
                return value
            except self.ssm.exceptions.ParameterNotFound:
                pass

        return default
```

### Requirements File: requirements.txt

```txt
# AWS SDK
boto3==1.34.19
botocore==1.34.19

# Image processing
Pillow==10.2.0
pdf2image==1.17.0

# PDF processing
PyPDF2==3.0.1

# OCR
pytesseract==0.3.10

# OpenSearch
opensearch-py==2.4.2
requests-aws4auth==1.2.3

# Async/Concurrency
aiofiles==23.2.1

# Logging
python-json-logger==2.0.7
watchtower==3.0.1

# Utilities
python-dateutil==2.8.2
```

### Environment Variables (.env for testing)

```bash
# AWS Configuration
AWS_REGION=ap-northeast-1

# SQS
SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/123456789012/cis-filesearch-queue-prod
SQS_VISIBILITY_TIMEOUT=300
SQS_WAIT_TIME=20
SQS_MAX_MESSAGES=10

# S3
S3_LANDING_BUCKET=cis-filesearch-landing-prod
S3_THUMBNAIL_BUCKET=cis-filesearch-thumbnails-prod

# Bedrock
BEDROCK_REGION=us-east-1
BEDROCK_MODEL=amazon.titan-embed-text-v2:0

# OpenSearch
OPENSEARCH_ENDPOINT=search-cis-filesearch-prod-xxxxx.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=cis-filesearch-prod

# Processing
WORKER_PROCESSES=4
TEMP_DIR=/opt/cis-file-processor/temp

# Tesseract
TESSERACT_LANG=jpn+eng
TESSERACT_CONFIG=--psm 1 --oem 3

# Thumbnails
THUMBNAIL_WIDTH=800
THUMBNAIL_QUALITY=85

# Logging
LOG_LEVEL=INFO
LOG_FILE=/var/log/cis-file-processor/app.log
```

---

*(Continued in next response due to length...)*
