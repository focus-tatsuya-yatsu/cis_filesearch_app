# AWS Auto Scaling Group with EC2 Spot Instances Guide

## Table of Contents
1. [Why This Matters - Understanding Auto Scaling](#why-this-matters)
2. [Launch Template Creation](#launch-template-creation)
3. [Auto Scaling Group Setup](#auto-scaling-group-setup)
4. [Spot Instance Configuration](#spot-instance-configuration)
5. [Scaling Policies](#scaling-policies)
6. [Worker Application Setup](#worker-application-setup)
7. [Monitoring and Optimization](#monitoring-and-optimization)
8. [Cost Management](#cost-management)
9. [Troubleshooting](#troubleshooting)

---

## Why This Matters - Understanding Auto Scaling

### The Problem We're Solving

**Without Auto Scaling:**
```
Fixed EC2 instance running 24/7
Cost: $50/month
Utilization: 10% (mostly idle)
Waste: $45/month
```

**With Auto Scaling + Spot:**
```
0-3 instances based on SQS queue depth
Cost: $5-$15/month
Utilization: 80-90%
Savings: 70-90%
```

### Architecture Overview

```
SQS Queue (0-1000 messages)
        ↓ (CloudWatch metric)
Auto Scaling Group (0-3 instances)
        ↓ (workers poll SQS)
EC2 Spot Instances (t3.medium)
        ↓ (process files)
OpenSearch + Bedrock
```

### Why Spot Instances?

**On-Demand vs Spot Pricing** (t3.medium, Tokyo):

| Type | Price/hour | Price/month (730h) | Savings |
|------|-----------|-------------------|---------|
| On-Demand | $0.0528 | $38.54 | Baseline |
| Spot | $0.0158 | $11.53 | **70%** |

**Spot Instance Characteristics:**
- ✅ Up to 90% cheaper than On-Demand
- ✅ Same performance and features
- ⚠️ Can be interrupted with 2-minute notice
- ✅ Perfect for stateless, fault-tolerant workloads (like file processing)

**Our use case is IDEAL for Spot:**
- Stateless workers (no local data)
- Queue-based (work persists in SQS)
- Fault-tolerant (failed jobs reappear in queue)
- Flexible timing (files can wait a few minutes)

---

## Launch Template Creation

### Prerequisites

Before creating the launch template:
- AMI ID for Amazon Linux 2023
- Security group for EC2 workers
- IAM instance profile (role) created
- User data script prepared

### Step 1: Create Security Group for Workers

```bash
VPC_ID="vpc-xxxxx"
REGION="ap-northeast-1"

# Create security group
WORKER_SG_ID=$(aws ec2 create-security-group \
  --group-name cis-file-processor-workers \
  --description "Security group for CIS file processing workers" \
  --vpc-id $VPC_ID \
  --region $REGION \
  --query 'GroupId' \
  --output text)

# Allow outbound HTTPS (OpenSearch, S3, SQS, Bedrock)
aws ec2 authorize-security-group-egress \
  --group-id $WORKER_SG_ID \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0 \
  --region $REGION

# Allow SSH from bastion (optional, for debugging)
BASTION_SG="sg-bastion-xxxxx"
aws ec2 authorize-security-group-ingress \
  --group-id $WORKER_SG_ID \
  --protocol tcp \
  --port 22 \
  --source-group $BASTION_SG \
  --region $REGION

# Tag security group
aws ec2 create-tags \
  --resources $WORKER_SG_ID \
  --tags "Key=Name,Value=cis-file-processor-workers" \
         "Key=Project,Value=CISFileSearch" \
         "Key=Environment,Value=Development"
```

### Step 2: Prepare User Data Script

The user data script runs when instance launches.

**Create file**: `worker-user-data.sh`

```bash
#!/bin/bash
set -e

# Update system
yum update -y

# Install Python 3.11
yum install -y python3.11 python3.11-pip git

# Install CloudWatch agent
wget https://s3.amazonaws.com/amazoncloudwatch-agent/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm
rpm -U ./amazon-cloudwatch-agent.rpm

# Create application directory
mkdir -p /opt/cis-file-processor
cd /opt/cis-file-processor

# Clone or download worker application
# Option 1: From S3
aws s3 cp s3://cis-filesearch-deployment/worker-app.tar.gz .
tar -xzf worker-app.tar.gz

# Option 2: From Git (if using CodeCommit/GitHub)
# git clone https://github.com/your-org/cis-file-processor.git .

# Install dependencies
python3.11 -m pip install -r requirements.txt

# Configure environment
cat > .env <<'EOF'
AWS_REGION=ap-northeast-1
OPENSEARCH_ENDPOINT=search-cis-filesearch-dev-xxxxx.ap-northeast-1.es.amazonaws.com
SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/ACCOUNT/cis-filesearch-queue-dev
S3_BUCKET=cis-filesearch-landing-dev
BEDROCK_MODEL_ID=amazon.titan-embed-image-v1
LOG_LEVEL=INFO
WORKER_CONCURRENCY=2
EOF

# Create systemd service
cat > /etc/systemd/system/cis-file-processor.service <<'EOF'
[Unit]
Description=CIS File Processor Worker
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/cis-file-processor
EnvironmentFile=/opt/cis-file-processor/.env
ExecStart=/usr/bin/python3.11 /opt/cis-file-processor/worker.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Start worker service
systemctl daemon-reload
systemctl enable cis-file-processor
systemctl start cis-file-processor

# Configure CloudWatch agent
cat > /opt/aws/amazon-cloudwatch-agent/etc/config.json <<'EOF'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/cis-file-processor.log",
            "log_group_name": "/aws/cis-file-processor/dev/workers",
            "log_stream_name": "{instance_id}"
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
            "name": "cpu_usage_active",
            "rename": "CPUUtilization",
            "unit": "Percent"
          }
        ],
        "metrics_collection_interval": 60
      },
      "mem": {
        "measurement": [
          {
            "name": "mem_used_percent",
            "rename": "MemoryUtilization",
            "unit": "Percent"
          }
        ],
        "metrics_collection_interval": 60
      }
    }
  }
}
EOF

# Start CloudWatch agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/config.json

# Signal success
echo "Worker initialization complete"
```

**Base64 encode for launch template:**

```bash
cat worker-user-data.sh | base64 > worker-user-data-b64.txt
```

### Step 3: Create Launch Template (Console)

**Navigate to EC2 Console:**

1. EC2 → Launch Templates → Create launch template

**Launch template details:**

**Name**: `cis-file-processor-worker-v1`

**Description**: CIS file processing worker with Spot instances

**Version description**: Initial version with Python 3.11 and systemd service

**Template tags**:
```
Project: CISFileSearch
Environment: Development
Component: Worker
```

**Application and OS Images (AMI):**

**Quick Start**: Amazon Linux

**Amazon Linux AMI**: Amazon Linux 2023 AMI (latest)

**Why AL2023?**
- Latest security patches
- Python 3.11 available
- systemd for service management
- 5 years of support

**Get AMI ID (CLI):**

```bash
AMI_ID=$(aws ec2 describe-images \
  --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023.*-x86_64" \
            "Name=state,Values=available" \
  --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
  --output text \
  --region $REGION)

echo "Latest AL2023 AMI: $AMI_ID"
```

**Instance type:**

**Instance type**: t3.medium

**Why t3.medium?**
- 2 vCPU, 4 GB RAM
- Sufficient for PDF processing + embeddings
- Good Spot availability
- Burstable performance
- Cost-effective ($11.53/month Spot)

**Key pair**: cis-workers-keypair (create new or select existing)

**Why key pair?**
- SSH access for debugging
- Optional in production
- Create with: `aws ec2 create-key-pair --key-name cis-workers-keypair`

**Network settings:**

**Subnet**: Don't include in launch template (configured in ASG)

**Security groups**: Select `cis-file-processor-workers`

**Advanced network configuration:**

**Auto-assign public IP**: Disable (using private subnets)

**Network interface**: eth0

**Security groups**: `sg-xxxxx` (cis-file-processor-workers)

**Storage (volumes):**

**Volume 1 (Root volume):**
- Device: /dev/xvda
- Size: 20 GB
- Volume type: gp3
- IOPS: 3000
- Throughput: 125 MB/s
- Delete on termination: Yes
- Encrypted: Yes

**Why 20 GB?**
- OS: ~2 GB
- Application: ~1 GB
- Temp files during processing: ~5 GB
- Logs: ~2 GB
- Buffer: ~10 GB

**Resource tags:**

```
Name: cis-file-processor-worker
Project: CISFileSearch
Environment: Development
Component: Worker
ManagedBy: AutoScaling
```

**Advanced details:**

**IAM instance profile**: CISFileProcessorRole (create separately)

**Monitoring**: Enable CloudWatch detailed monitoring

**Why detailed monitoring?**
- 1-minute metrics instead of 5-minute
- Faster scaling reactions
- Better debugging
- Cost: $2.10/month per instance (worth it)

**User data**: Paste content from `worker-user-data.sh`

**Metadata options:**

- **Metadata version**: V2 only (IMDSv2)
- **Metadata response hop limit**: 1
- **Metadata token TTL**: 21600 (6 hours)

**Why IMDSv2?**
- Security improvement (prevents SSRF attacks)
- Required for many compliance frameworks
- AWS best practice

### Step 4: Create Launch Template (CLI)

```bash
# Get latest AMI
AMI_ID=$(aws ec2 describe-images \
  --owners amazon \
  --filters "Name=name,Values=al2023-ami-2023.*-x86_64" \
            "Name=state,Values=available" \
  --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
  --output text)

# Create launch template
aws ec2 create-launch-template \
  --launch-template-name cis-file-processor-worker-v1 \
  --version-description "Initial version with Python 3.11" \
  --launch-template-data "{
    \"ImageId\": \"$AMI_ID\",
    \"InstanceType\": \"t3.medium\",
    \"KeyName\": \"cis-workers-keypair\",
    \"SecurityGroupIds\": [\"$WORKER_SG_ID\"],
    \"IamInstanceProfile\": {
      \"Name\": \"CISFileProcessorRole\"
    },
    \"BlockDeviceMappings\": [{
      \"DeviceName\": \"/dev/xvda\",
      \"Ebs\": {
        \"VolumeSize\": 20,
        \"VolumeType\": \"gp3\",
        \"Iops\": 3000,
        \"Throughput\": 125,
        \"DeleteOnTermination\": true,
        \"Encrypted\": true
      }
    }],
    \"Monitoring\": {
      \"Enabled\": true
    },
    \"MetadataOptions\": {
      \"HttpTokens\": \"required\",
      \"HttpPutResponseHopLimit\": 1,
      \"HttpEndpoint\": \"enabled\"
    },
    \"UserData\": \"$(cat worker-user-data-b64.txt)\",
    \"TagSpecifications\": [{
      \"ResourceType\": \"instance\",
      \"Tags\": [
        {\"Key\": \"Name\", \"Value\": \"cis-file-processor-worker\"},
        {\"Key\": \"Project\", \"Value\": \"CISFileSearch\"},
        {\"Key\": \"Environment\", \"Value\": \"Development\"}
      ]
    }]
  }" \
  --region $REGION
```

---

## Auto Scaling Group Setup

### Step 1: Create Auto Scaling Group (Console)

**Navigate to EC2 → Auto Scaling Groups → Create Auto Scaling group**

**Step 1: Choose launch template**

**Name**: `cis-file-processor-asg-dev`

**Launch template**: cis-file-processor-worker-v1

**Version**: Latest

**Step 2: Network**

**VPC**: Select your CIS VPC

**Availability Zones and subnets**: Select 2-3 **private subnets**

**Why private subnets?**
- Workers don't need public IPs
- Better security
- Lower attack surface
- NAT Gateway for outbound (or VPC endpoints)

**Example:**
```
Subnet 1: private-subnet-ap-northeast-1a
Subnet 2: private-subnet-ap-northeast-1c
```

**Step 3: Configure advanced options**

**Load balancing**: No load balancer

**Why no ALB?**
- Workers poll SQS (don't receive traffic)
- Not serving HTTP requests
- Cost savings

**Health checks:**

**Health check type**: EC2

**Health check grace period**: 300 seconds (5 minutes)

**Why 5 minutes?**
- Allows instance to boot
- Install dependencies
- Start worker process
- Begin processing

**Additional settings:**

**Enable CloudWatch group metrics**: Yes

**Metrics to collect:**
- GroupDesiredCapacity
- GroupInServiceInstances
- GroupMinSize
- GroupMaxSize
- GroupPendingInstances
- GroupTerminatingInstances

**Step 4: Group size and scaling**

**Desired capacity**: 0

**Minimum capacity**: 0

**Maximum capacity**: 3

**Why start at 0?**
- No cost when queue is empty
- Scales up automatically when messages arrive
- Perfect for variable workloads

**Why max 3?**
- Sufficient for 100K files/month
- Each instance processes ~50 files/min
- 3 instances = 150 files/min = 9000 files/hour
- Can process daily batch in ~11 hours

**Automatic scaling**: Target tracking scaling policy

**Scaling policy name**: cis-sqs-depth-scaling

**Metric type**: Average - Custom metric

**Target value**: 30

**What this means:**
```
SQS messages / running instances ≈ 30

Examples:
- 90 messages → 3 instances (90/3 = 30) ✓
- 60 messages → 2 instances (60/2 = 30) ✓
- 15 messages → 1 instance (15/1 = 15, rounds up) ✓
- 0 messages → 0 instances ✓
```

**Instance warmup**: 180 seconds (3 minutes)

**Why 3 minutes?**
- Gives instance time to start processing
- Prevents aggressive scaling
- Allows backlog to clear

**Step 5: Notifications (Optional)**

**SNS topic**: cis-file-processor-notifications

**Events:**
- autoscaling:EC2_INSTANCE_LAUNCH
- autoscaling:EC2_INSTANCE_TERMINATE
- autoscaling:EC2_INSTANCE_LAUNCH_ERROR
- autoscaling:EC2_INSTANCE_TERMINATE_ERROR

**Step 6: Tags**

```
Name: cis-file-processor-worker
Project: CISFileSearch
Environment: Development
Component: Worker
ManagedBy: AutoScaling
```

**Tag new instances**: Yes (checked)

**Step 7: Review and create**

Click "Create Auto Scaling group"

### Step 2: Create Auto Scaling Group (CLI)

```bash
SUBNET_1="subnet-private-1a"
SUBNET_2="subnet-private-1c"

# Create Auto Scaling group
aws autoscaling create-auto-scaling-group \
  --auto-scaling-group-name cis-file-processor-asg-dev \
  --launch-template "LaunchTemplateName=cis-file-processor-worker-v1,Version=\$Latest" \
  --min-size 0 \
  --max-size 3 \
  --desired-capacity 0 \
  --default-cooldown 180 \
  --health-check-type EC2 \
  --health-check-grace-period 300 \
  --vpc-zone-identifier "$SUBNET_1,$SUBNET_2" \
  --enabled-metrics "GroupDesiredCapacity,GroupInServiceInstances,GroupMinSize,GroupMaxSize" \
  --tags "Key=Name,Value=cis-file-processor-worker,PropagateAtLaunch=true" \
         "Key=Project,Value=CISFileSearch,PropagateAtLaunch=true" \
         "Key=Environment,Value=Development,PropagateAtLaunch=true" \
  --region $REGION
```

---

## Spot Instance Configuration

### Why Use Spot Instance Mix?

**Strategy: 70% Spot + 30% On-Demand**

**Benefits:**
- 70% cost savings from Spot
- 30% guaranteed capacity from On-Demand
- Graceful handling of Spot interruptions

### Configure Spot in Launch Template

**Mixed Instances Policy:**

```bash
aws autoscaling update-auto-scaling-group \
  --auto-scaling-group-name cis-file-processor-asg-dev \
  --mixed-instances-policy '{
    "LaunchTemplate": {
      "LaunchTemplateSpecification": {
        "LaunchTemplateName": "cis-file-processor-worker-v1",
        "Version": "$Latest"
      },
      "Overrides": [
        {
          "InstanceType": "t3.medium"
        },
        {
          "InstanceType": "t3a.medium"
        },
        {
          "InstanceType": "t2.medium"
        }
      ]
    },
    "InstancesDistribution": {
      "OnDemandAllocationStrategy": "prioritized",
      "OnDemandBaseCapacity": 0,
      "OnDemandPercentageAboveBaseCapacity": 30,
      "SpotAllocationStrategy": "capacity-optimized",
      "SpotMaxPrice": ""
    }
  }' \
  --region $REGION
```

**Configuration explained:**

**Overrides (instance types):**
- t3.medium: Primary choice (Intel)
- t3a.medium: AMD alternative (same specs, often cheaper)
- t2.medium: Fallback (older generation)

**Why multiple types?**
- Better Spot availability
- Reduces interruption rate
- AWS picks cheapest available

**OnDemandBaseCapacity: 0**
- Start with 0 On-Demand instances
- All initial instances are Spot

**OnDemandPercentageAboveBaseCapacity: 30**
- 30% of instances above base are On-Demand
- Example: 3 instances = 2 Spot + 1 On-Demand

**SpotAllocationStrategy: capacity-optimized**
- AWS picks Spot pools with deepest capacity
- Minimizes interruption rate
- Better than lowest-price strategy

**SpotMaxPrice: "" (empty)**
- Pay up to On-Demand price
- Better availability
- Still get Spot discount (up to 90%)

### Spot Interruption Handling

When AWS needs Spot capacity back:

1. **2-minute warning**: Instance receives termination notice
2. **Worker gracefully stops**: Finishes current file or aborts
3. **SQS visibility timeout expires**: Message reappears in queue
4. **New instance picks up**: Another worker processes the file

**Worker code handles interruptions:**

```python
# worker.py
import signal
import sys

shutdown_requested = False

def handle_shutdown(signum, frame):
    global shutdown_requested
    print("Received termination signal, finishing current task...")
    shutdown_requested = True

signal.signal(signal.SIGTERM, handle_shutdown)

while not shutdown_requested:
    # Poll SQS
    messages = sqs.receive_message(...)

    for message in messages:
        if shutdown_requested:
            # Don't start new tasks
            break

        process_file(message)
        sqs.delete_message(message)
```

---

## Scaling Policies

### Custom Metric: SQS Messages Per Instance

Create CloudWatch metric for scaling decisions.

**Calculate backlog per instance:**

```
Backlog Per Instance = ApproximateNumberOfMessages / InServiceInstances
```

#### Create CloudWatch Math Metric

```bash
# Publish custom metric via Lambda or worker
# This example uses CloudWatch Events + Lambda

# Create Lambda function that calculates metric
cat > calculate-backlog.py <<'EOF'
import boto3
import os

sqs = boto3.client('sqs')
cloudwatch = boto3.client('cloudwatch')
autoscaling = boto3.client('autoscaling')

QUEUE_URL = os.environ['QUEUE_URL']
ASG_NAME = os.environ['ASG_NAME']

def lambda_handler(event, context):
    # Get queue depth
    queue_attrs = sqs.get_queue_attributes(
        QueueUrl=QUEUE_URL,
        AttributeNames=['ApproximateNumberOfMessages']
    )
    messages = int(queue_attrs['Attributes']['ApproximateNumberOfMessages'])

    # Get running instances
    asg_response = autoscaling.describe_auto_scaling_groups(
        AutoScalingGroupNames=[ASG_NAME]
    )
    instances = asg_response['AutoScalingGroups'][0]['DesiredCapacity']

    # Calculate backlog per instance
    if instances > 0:
        backlog_per_instance = messages / instances
    else:
        backlog_per_instance = messages  # Scale from 0

    # Publish metric
    cloudwatch.put_metric_data(
        Namespace='CISFileProcessor',
        MetricData=[
            {
                'MetricName': 'BacklogPerInstance',
                'Value': backlog_per_instance,
                'Unit': 'Count',
                'Dimensions': [
                    {
                        'Name': 'AutoScalingGroupName',
                        'Value': ASG_NAME
                    }
                ]
            }
        ]
    )

    return {
        'statusCode': 200,
        'body': f'Messages: {messages}, Instances: {instances}, Backlog: {backlog_per_instance}'
    }
EOF
```

#### Create Target Tracking Policy

```bash
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name cis-file-processor-asg-dev \
  --policy-name sqs-backlog-scaling \
  --policy-type TargetTrackingScaling \
  --target-tracking-configuration '{
    "CustomizedMetricSpecification": {
      "MetricName": "BacklogPerInstance",
      "Namespace": "CISFileProcessor",
      "Statistic": "Average",
      "Dimensions": [{
        "Name": "AutoScalingGroupName",
        "Value": "cis-file-processor-asg-dev"
      }]
    },
    "TargetValue": 30.0,
    "ScaleInCooldown": 300,
    "ScaleOutCooldown": 60
  }' \
  --region $REGION
```

**Cooldowns explained:**

**ScaleOutCooldown: 60 seconds**
- How long to wait between scale-out actions
- Fast reaction to queue buildup
- Prevents instance churn

**ScaleInCooldown: 300 seconds**
- How long to wait between scale-in actions
- Slower to terminate instances
- Prevents premature scale-down

### Alternative: Step Scaling Policy

For more control:

```bash
# Scale out policy
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name cis-file-processor-asg-dev \
  --policy-name scale-out-on-queue-depth \
  --policy-type StepScaling \
  --adjustment-type ChangeInCapacity \
  --metric-aggregation-type Average \
  --step-adjustments \
    "MetricIntervalLowerBound=0,MetricIntervalUpperBound=50,ScalingAdjustment=1" \
    "MetricIntervalLowerBound=50,MetricIntervalUpperBound=100,ScalingAdjustment=2" \
    "MetricIntervalLowerBound=100,ScalingAdjustment=3" \
  --region $REGION

# Scale in policy
aws autoscaling put-scaling-policy \
  --auto-scaling-group-name cis-file-processor-asg-dev \
  --policy-name scale-in-on-low-queue \
  --policy-type StepScaling \
  --adjustment-type ChangeInCapacity \
  --metric-aggregation-type Average \
  --step-adjustments \
    "MetricIntervalUpperBound=0,ScalingAdjustment=-1" \
  --region $REGION
```

**Step scaling logic:**

```
Queue Depth:
- 0-50 messages: +1 instance
- 50-100 messages: +2 instances
- 100+ messages: +3 instances (max)

Queue empty for 5 minutes: -1 instance
```

---

## Worker Application Setup

### Python Worker Example

**File**: `worker.py`

```python
#!/usr/bin/env python3
import boto3
import json
import logging
import os
import signal
import sys
import time
from typing import Dict, Any

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Environment variables
AWS_REGION = os.getenv('AWS_REGION', 'ap-northeast-1')
OPENSEARCH_ENDPOINT = os.getenv('OPENSEARCH_ENDPOINT')
SQS_QUEUE_URL = os.getenv('SQS_QUEUE_URL')
S3_BUCKET = os.getenv('S3_BUCKET')
BEDROCK_MODEL_ID = os.getenv('BEDROCK_MODEL_ID', 'amazon.titan-embed-image-v1')

# AWS clients
sqs = boto3.client('sqs', region_name=AWS_REGION)
s3 = boto3.client('s3', region_name=AWS_REGION)
bedrock = boto3.client('bedrock-runtime', region_name=AWS_REGION)

# Graceful shutdown
shutdown_requested = False

def signal_handler(signum, frame):
    global shutdown_requested
    logger.info(f"Received signal {signum}, initiating graceful shutdown...")
    shutdown_requested = True

signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

def process_message(message: Dict[str, Any]) -> bool:
    """Process a single SQS message"""
    try:
        body = json.loads(message['Body'])
        s3_key = body['s3Key']

        logger.info(f"Processing file: {s3_key}")

        # Download file from S3
        file_obj = s3.get_object(Bucket=S3_BUCKET, Key=s3_key)
        file_content = file_obj['Body'].read()

        # Generate embeddings for images
        if s3_key.lower().endswith(('.jpg', '.jpeg', '.png')):
            embedding = generate_image_embedding(file_content)
        else:
            embedding = None

        # Index to OpenSearch
        index_to_opensearch({
            's3_key': s3_key,
            'file_size': body['fileSize'],
            'embedding': embedding,
            # ... other metadata
        })

        logger.info(f"Successfully processed: {s3_key}")
        return True

    except Exception as e:
        logger.error(f"Error processing message: {e}")
        return False

def generate_image_embedding(image_bytes: bytes) -> list:
    """Generate embedding using Bedrock Titan"""
    try:
        response = bedrock.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            body=json.dumps({
                "inputImage": image_bytes.decode('latin1'),
            }),
            contentType='application/json'
        )

        result = json.loads(response['body'].read())
        return result['embedding']

    except Exception as e:
        logger.error(f"Error generating embedding: {e}")
        return None

def index_to_opensearch(document: Dict[str, Any]):
    """Index document to OpenSearch"""
    # Implementation here
    pass

def main():
    logger.info("Worker starting...")
    logger.info(f"Polling queue: {SQS_QUEUE_URL}")

    while not shutdown_requested:
        try:
            # Poll SQS with long polling
            response = sqs.receive_message(
                QueueUrl=SQS_QUEUE_URL,
                MaxNumberOfMessages=1,
                WaitTimeSeconds=20,
                VisibilityTimeout=300
            )

            messages = response.get('Messages', [])

            if not messages:
                logger.debug("No messages in queue")
                continue

            for message in messages:
                if shutdown_requested:
                    logger.info("Shutdown requested, stopping message processing")
                    break

                success = process_message(message)

                if success:
                    # Delete message from queue
                    sqs.delete_message(
                        QueueUrl=SQS_QUEUE_URL,
                        ReceiptHandle=message['ReceiptHandle']
                    )
                else:
                    logger.warning("Message processing failed, will retry")
                    # Message will reappear after visibility timeout

        except KeyboardInterrupt:
            logger.info("Keyboard interrupt received")
            break
        except Exception as e:
            logger.error(f"Error in main loop: {e}")
            time.sleep(5)  # Back off on errors

    logger.info("Worker shutdown complete")

if __name__ == '__main__':
    main()
```

**requirements.txt:**

```
boto3>=1.34.0
requests>=2.31.0
opensearch-py>=2.4.0
python-dotenv>=1.0.0
```

---

## Monitoring and Optimization

### CloudWatch Dashboard

Create comprehensive dashboard:

```bash
aws cloudwatch put-dashboard \
  --dashboard-name CISFileProcessorASG \
  --dashboard-body '{
    "widgets": [
      {
        "type": "metric",
        "properties": {
          "metrics": [
            ["AWS/AutoScaling", "GroupDesiredCapacity", {"stat": "Average"}],
            [".", "GroupInServiceInstances", {"stat": "Average"}]
          ],
          "period": 60,
          "stat": "Average",
          "region": "ap-northeast-1",
          "title": "ASG Capacity"
        }
      },
      {
        "type": "metric",
        "properties": {
          "metrics": [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", {"stat": "Sum"}]
          ],
          "period": 60,
          "stat": "Sum",
          "region": "ap-northeast-1",
          "title": "SQS Queue Depth"
        }
      }
    ]
  }'
```

### Key Metrics

**Auto Scaling metrics:**
- GroupDesiredCapacity
- GroupInServiceInstances
- GroupPendingInstances
- GroupTerminatingInstances

**EC2 metrics:**
- CPUUtilization
- NetworkIn/NetworkOut
- StatusCheckFailed

**Custom metrics:**
- FilesProcessedPerMinute
- ProcessingErrors
- AverageProcessingTime

---

## Cost Management

### Monthly Cost Estimate

**Scenario**: Processing 100K files/month

**Assumptions:**
- Average processing: 1 minute/file
- Total processing time: 100K minutes = 1667 hours
- Instance type: t3.medium Spot
- 3 instances running in parallel
- Actual runtime: 1667 / 3 = 556 hours/month

**Cost calculation:**

| Component | Calculation | Monthly Cost |
|-----------|-------------|--------------|
| Spot instances | 556h × $0.0158/h | $8.78 |
| EBS storage | 20GB × 3 × $0.096/GB × (556/730) | $4.41 |
| Data transfer | Negligible (VPC endpoints) | $0.50 |
| **Total** | | **$13.69** |

**Compare to On-Demand 24/7:**
- 730h × 3 × $0.0528/h = $115.58/month
- **Savings: $101.89 (88%)**

---

## Troubleshooting

### Issue 1: Instances Not Launching

**Check:**
```bash
# ASG activity
aws autoscaling describe-scaling-activities \
  --auto-scaling-group-name cis-file-processor-asg-dev \
  --max-records 10

# Spot request status
aws ec2 describe-spot-instance-requests \
  --filters "Name=state,Values=open,active"
```

**Common causes:**
1. Insufficient Spot capacity
2. IAM role missing permissions
3. Launch template errors
4. Subnet AZ unavailable

### Issue 2: High Spot Interruption Rate

**Solutions:**
1. Add more instance types to overrides
2. Increase On-Demand percentage to 50%
3. Use capacity-optimized-prioritized strategy

---

## Summary Checklist

- [ ] Security group created for workers
- [ ] IAM instance profile created
- [ ] User data script prepared
- [ ] Launch template created
- [ ] Auto Scaling group created
- [ ] Spot instance mix configured (70/30)
- [ ] Scaling policy configured (target: 30 msg/instance)
- [ ] CloudWatch metrics enabled
- [ ] Worker application deployed
- [ ] Test: Upload file → instance launches
- [ ] Test: Process file → instance terminates
- [ ] Monitoring dashboard created

---

## Next Steps

1. **Configure IAM Roles**: See `aws-iam-roles-policies-guide.md`
2. **Deploy Worker Application**: Package and upload to S3
3. **Test Full Pipeline**: S3 → EventBridge → SQS → ASG → OpenSearch
4. **Optimize Costs**: Monitor and adjust instance types

---

**Document Version**: 1.0
**Last Updated**: 2025-01-18
**Author**: CIS Development Team
