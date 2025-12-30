#!/bin/bash
# User Data Script for EC2 File Processor
# Initializes EC2 instance with all dependencies and starts python-worker

set -e  # Exit on error
set -x  # Print commands (for CloudWatch Logs debugging)

# ============================================================================
# Configuration from Terraform
# ============================================================================
AWS_REGION="${aws_region}"
S3_BUCKET="${s3_bucket}"
SQS_QUEUE_URL="${sqs_queue_url}"
OPENSEARCH_ENDPOINT="${opensearch_endpoint}"
OPENSEARCH_INDEX="${opensearch_index}"
LOG_GROUP="${log_group}"
PROJECT_NAME="${project_name}"

# ============================================================================
# Logging Setup
# ============================================================================
LOGFILE="/var/log/user-data.log"
exec > >(tee -a $LOGFILE) 2>&1

echo "=================================="
echo "EC2 File Processor Initialization"
echo "=================================="
echo "Start time: $(date)"
echo "Instance ID: $(ec2-metadata --instance-id | cut -d ' ' -f 2)"
echo "Region: $AWS_REGION"

# ============================================================================
# System Update and Package Installation
# ============================================================================
echo "[1/10] Updating system packages..."

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
fi

if [ "$OS" = "amzn" ]; then
    # Amazon Linux 2023
    yum update -y
    yum install -y python3.11 python3.11-pip git wget curl jq
    yum install -y gcc gcc-c++ make autoconf automake libtool
elif [ "$OS" = "ubuntu" ]; then
    # Ubuntu
    apt-get update -y
    apt-get upgrade -y
    apt-get install -y python3.11 python3-pip git wget curl jq
    apt-get install -y build-essential autoconf automake libtool
fi

# ============================================================================
# Install OCR Dependencies (Tesseract + Language Packs)
# ============================================================================
echo "[2/10] Installing OCR dependencies..."

if [ "$OS" = "amzn" ]; then
    # Tesseract from EPEL or compile from source
    yum install -y tesseract tesseract-langpack-jpn tesseract-langpack-eng
    yum install -y poppler-utils  # For PDF rendering
elif [ "$OS" = "ubuntu" ]; then
    apt-get install -y tesseract-ocr tesseract-ocr-jpn tesseract-ocr-eng
    apt-get install -y poppler-utils
fi

# Verify Tesseract installation
tesseract --version

# ============================================================================
# Install Image Processing Libraries
# ============================================================================
echo "[3/10] Installing image processing libraries..."

if [ "$OS" = "amzn" ]; then
    yum install -y libjpeg-turbo-devel libpng-devel libtiff-devel
elif [ "$OS" = "ubuntu" ]; then
    apt-get install -y libjpeg-dev libpng-dev libtiff-dev
fi

# ============================================================================
# Install CloudWatch Logs Agent
# ============================================================================
echo "[4/10] Installing CloudWatch Logs agent..."

if [ "$OS" = "amzn" ]; then
    yum install -y amazon-cloudwatch-agent
elif [ "$OS" = "ubuntu" ]; then
    wget https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
    dpkg -i amazon-cloudwatch-agent.deb
fi

# Configure CloudWatch Logs agent
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<EOF
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/file-processor.log",
            "log_group_name": "$LOG_GROUP",
            "log_stream_name": "{instance_id}/worker",
            "timezone": "UTC"
          },
          {
            "file_path": "/var/log/user-data.log",
            "log_group_name": "$LOG_GROUP",
            "log_stream_name": "{instance_id}/init",
            "timezone": "UTC"
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "FileProcessor",
    "metrics_collected": {
      "cpu": {
        "measurement": [
          {
            "name": "cpu_usage_idle",
            "rename": "CPU_IDLE",
            "unit": "Percent"
          }
        ],
        "metrics_collection_interval": 60
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
EOF

# Start CloudWatch agent
/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -s \
    -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

# ============================================================================
# Create Application User
# ============================================================================
echo "[5/10] Creating application user..."

useradd -r -m -s /bin/bash fileprocessor || true
usermod -a -G systemd-journal fileprocessor || true

# ============================================================================
# Clone Python Worker Code
# ============================================================================
echo "[6/10] Deploying python-worker application..."

# Create application directory
APP_DIR="/opt/file-processor"
mkdir -p $APP_DIR
cd $APP_DIR

# Option 1: Clone from git repository (if using CodeCommit/GitHub)
# git clone https://git-codecommit.$AWS_REGION.amazonaws.com/v1/repos/$PROJECT_NAME .

# Option 2: Download from S3 (deployment package)
aws s3 cp s3://$S3_BUCKET/deployments/python-worker-latest.tar.gz /tmp/python-worker.tar.gz
tar -xzf /tmp/python-worker.tar.gz -C $APP_DIR
rm /tmp/python-worker.tar.gz

# Set ownership
chown -R fileprocessor:fileprocessor $APP_DIR

# ============================================================================
# Install Python Dependencies
# ============================================================================
echo "[7/10] Installing Python dependencies..."

cd $APP_DIR
sudo -u fileprocessor python3.11 -m pip install --user --upgrade pip
sudo -u fileprocessor python3.11 -m pip install --user -r requirements.txt

# ============================================================================
# Configure Environment Variables
# ============================================================================
echo "[8/10] Configuring environment variables..."

cat > /etc/environment.d/file-processor.conf <<EOF
# AWS Configuration
AWS_REGION=$AWS_REGION
AWS_DEFAULT_REGION=$AWS_REGION

# S3 Configuration
S3_BUCKET=$S3_BUCKET

# SQS Configuration
SQS_QUEUE_URL=$SQS_QUEUE_URL
SQS_WAIT_TIME=20
SQS_VISIBILITY_TIMEOUT=300
SQS_MAX_MESSAGES=1

# OpenSearch Configuration
OPENSEARCH_ENDPOINT=$OPENSEARCH_ENDPOINT
OPENSEARCH_INDEX=$OPENSEARCH_INDEX
OPENSEARCH_USE_SSL=true
OPENSEARCH_VERIFY_CERTS=true

# Processing Configuration
MAX_FILE_SIZE_MB=100
PROCESSING_TIMEOUT=300
OCR_TIMEOUT=180
TEMP_DIR=/tmp/file-processor
MAX_WORKERS=4

# OCR Configuration
OCR_LANGUAGE=jpn+eng
PDF_DPI=300

# Logging Configuration
LOG_LEVEL=INFO
LOG_FILE=/var/log/file-processor.log
USE_CLOUDWATCH=true
CLOUDWATCH_LOG_GROUP=$LOG_GROUP

# Application
PROJECT_NAME=$PROJECT_NAME
EOF

# Also create .env file for systemd service
cp /etc/environment.d/file-processor.conf /opt/file-processor/.env
chown fileprocessor:fileprocessor /opt/file-processor/.env

# ============================================================================
# Create Systemd Service
# ============================================================================
echo "[9/10] Creating systemd service..."

cat > /etc/systemd/system/file-processor.service <<EOF
[Unit]
Description=File Processor Worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=fileprocessor
Group=fileprocessor
WorkingDirectory=/opt/file-processor
EnvironmentFile=/opt/file-processor/.env

# Start worker
ExecStart=/usr/bin/python3.11 /opt/file-processor/worker.py

# Restart policy
Restart=always
RestartSec=10
StartLimitInterval=0

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/tmp/file-processor /var/log

# Logging
StandardOutput=append:/var/log/file-processor.log
StandardError=append:/var/log/file-processor.log

[Install]
WantedBy=multi-user.target
EOF

# Create log file
touch /var/log/file-processor.log
chown fileprocessor:fileprocessor /var/log/file-processor.log

# Create temp directory
mkdir -p /tmp/file-processor
chown fileprocessor:fileprocessor /tmp/file-processor

# Reload systemd
systemctl daemon-reload

# ============================================================================
# Start File Processor Service
# ============================================================================
echo "[10/10] Starting file processor service..."

systemctl enable file-processor.service
systemctl start file-processor.service

# Wait a few seconds and check status
sleep 5
systemctl status file-processor.service

# ============================================================================
# Verification
# ============================================================================
echo "=================================="
echo "Initialization Complete"
echo "=================================="
echo "Service status:"
systemctl is-active file-processor.service

echo ""
echo "Recent logs:"
tail -n 20 /var/log/file-processor.log

echo ""
echo "Initialization finished at: $(date)"
echo "=================================="

# Send success metric to CloudWatch
aws cloudwatch put-metric-data \
    --namespace "FileProcessor" \
    --metric-name "InstanceInitialization" \
    --value 1 \
    --unit Count \
    --region $AWS_REGION
