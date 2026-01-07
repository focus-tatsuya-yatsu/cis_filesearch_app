#!/bin/bash
# =============================================================================
# CIS Preview Worker - User Data Script for Auto Scaling Launch Template
# =============================================================================
#
# Target OS: Amazon Linux 2023
# Purpose: Bootstrap EC2 instances for preview processing
#
# Prerequisites:
#   - IAM Instance Role with S3, SQS, OpenSearch, Bedrock, CloudWatch permissions
#   - Security Group allowing outbound HTTPS
#   - S3 bucket with worker package: s3://YOUR-DEPLOY-BUCKET/cis-worker/
#
# =============================================================================

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================
APP_DIR="/opt/cis-worker"
LOG_DIR="/var/log/cis-worker"
TEMP_DIR="/opt/cis-worker/temp"
SERVICE_USER="cis-worker"
SERVICE_GROUP="cis-worker"

# S3 deployment bucket - UPDATE THIS
DEPLOY_BUCKET="${DEPLOY_BUCKET:-cis-deploy-bucket}"
DEPLOY_PREFIX="${DEPLOY_PREFIX:-cis-worker}"

# AWS Region - Auto-detect from instance metadata
AWS_REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)
export AWS_DEFAULT_REGION=$AWS_REGION

# =============================================================================
# Logging Setup
# =============================================================================
exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "=========================================="
log "CIS Preview Worker Bootstrap Starting"
log "AWS Region: $AWS_REGION"
log "=========================================="

# =============================================================================
# System Updates & Dependencies
# =============================================================================
log "Step 1: Installing system dependencies..."

dnf update -y
dnf install -y \
    python3.11 \
    python3.11-pip \
    python3.11-devel \
    gcc \
    gcc-c++ \
    make \
    tesseract \
    tesseract-langpack-jpn \
    tesseract-langpack-eng \
    poppler-utils \
    libreoffice-core \
    libreoffice-calc \
    libreoffice-writer \
    libreoffice-impress \
    ImageMagick \
    fontconfig \
    google-noto-sans-cjk-fonts \
    jq \
    unzip

# Verify LibreOffice installation
if command -v libreoffice &> /dev/null; then
    log "LibreOffice installed successfully: $(libreoffice --version | head -1)"
else
    log "WARNING: LibreOffice installation failed"
fi

# =============================================================================
# Create Service User
# =============================================================================
log "Step 2: Creating service user..."

if ! id -u $SERVICE_USER &>/dev/null; then
    useradd -r -s /sbin/nologin -d $APP_DIR $SERVICE_USER
    log "Created user: $SERVICE_USER"
else
    log "User $SERVICE_USER already exists"
fi

# =============================================================================
# Create Directory Structure
# =============================================================================
log "Step 3: Creating directories..."

mkdir -p $APP_DIR
mkdir -p $LOG_DIR
mkdir -p $TEMP_DIR
mkdir -p $APP_DIR/src

# =============================================================================
# Download Application from S3
# =============================================================================
log "Step 4: Downloading application from S3..."

# Download worker package
aws s3 cp s3://${DEPLOY_BUCKET}/${DEPLOY_PREFIX}/cis-worker.tar.gz /tmp/cis-worker.tar.gz

# Extract to app directory
tar -xzf /tmp/cis-worker.tar.gz -C $APP_DIR
rm -f /tmp/cis-worker.tar.gz

log "Application downloaded and extracted"

# =============================================================================
# Setup Python Virtual Environment
# =============================================================================
log "Step 5: Setting up Python environment..."

cd $APP_DIR
python3.11 -m venv venv
source venv/bin/activate

pip install --upgrade pip
pip install -r requirements.txt

log "Python dependencies installed"

# =============================================================================
# Configure Environment Variables
# =============================================================================
log "Step 6: Configuring environment variables..."

# Download environment config from S3 (or use SSM Parameter Store)
if aws s3 cp s3://${DEPLOY_BUCKET}/${DEPLOY_PREFIX}/config/.env $APP_DIR/.env 2>/dev/null; then
    log "Downloaded .env from S3"
else
    log "Creating .env from template..."

    # Create .env file from environment or defaults
    cat > $APP_DIR/.env << 'ENVEOF'
# AWS Configuration
AWS_REGION=ap-northeast-1

# S3 Buckets
S3_LANDING_BUCKET=cis-landing-bucket
S3_THUMBNAIL_BUCKET=cis-thumbnail-bucket

# SQS Queue - Preview specific
PREVIEW_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/YOUR_ACCOUNT_ID/cis-filesearch-preview-queue

# OpenSearch
OPENSEARCH_ENDPOINT=https://your-domain.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX_NAME=cis-files

# Worker Configuration
WORKER_THREADS=2
WORKER_POLL_INTERVAL=20
LOG_LEVEL=INFO

# Feature Flags
ENABLE_PREVIEW=true

# Preview Settings
PREVIEW_DPI=150
PREVIEW_MAX_PAGES=50
PREVIEW_QUALITY=85
ENVEOF
fi

# Override specific values from instance metadata or SSM
# Example: Get queue URL from SSM Parameter Store
# PREVIEW_QUEUE_URL=$(aws ssm get-parameter --name /cis/preview-queue-url --query 'Parameter.Value' --output text 2>/dev/null || echo "")
# if [ -n "$PREVIEW_QUEUE_URL" ]; then
#     sed -i "s|^PREVIEW_QUEUE_URL=.*|PREVIEW_QUEUE_URL=$PREVIEW_QUEUE_URL|" $APP_DIR/.env
# fi

log "Environment configured"

# =============================================================================
# Set Permissions
# =============================================================================
log "Step 7: Setting permissions..."

chown -R $SERVICE_USER:$SERVICE_GROUP $APP_DIR
chown -R $SERVICE_USER:$SERVICE_GROUP $LOG_DIR
chmod 755 $APP_DIR
chmod 755 $LOG_DIR
chmod 600 $APP_DIR/.env

# Ensure log files exist and are writable
touch $LOG_DIR/preview-worker.log
touch $LOG_DIR/preview-worker-error.log
chown $SERVICE_USER:$SERVICE_GROUP $LOG_DIR/*.log
chmod 644 $LOG_DIR/*.log

log "Permissions set"

# =============================================================================
# Install systemd Service
# =============================================================================
log "Step 8: Installing systemd service..."

cat > /etc/systemd/system/preview-worker.service << 'SERVICEEOF'
[Unit]
Description=CIS Preview Worker - SQS Preview Generation Service
Documentation=https://github.com/your-org/cis-file-search
After=network-online.target
Wants=network-online.target
After=cloud-final.service

[Service]
Type=simple
User=cis-worker
Group=cis-worker
WorkingDirectory=/opt/cis-worker

# Environment file - KEY=VALUE format
EnvironmentFile=/opt/cis-worker/.env

# PATH must include virtual environment
Environment="PATH=/opt/cis-worker/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="PYTHONUNBUFFERED=1"
Environment="PYTHONDONTWRITEBYTECODE=1"

# Main process
ExecStart=/opt/cis-worker/venv/bin/python /opt/cis-worker/src/preview_worker.py --threads 2 --idle-timeout 300

# Restart policy
Restart=on-failure
RestartSec=10s
StartLimitBurst=5
StartLimitIntervalSec=300s

# Graceful shutdown
TimeoutStopSec=65s
KillMode=mixed
KillSignal=SIGTERM

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096
MemoryMax=2G
MemoryHigh=1536M
CPUQuota=150%

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictRealtime=true
RestrictNamespaces=true
LockPersonality=true
RestrictSUIDSGID=true
ReadWritePaths=/var/log/cis-worker /tmp /opt/cis-worker/temp

# Logging
StandardOutput=append:/var/log/cis-worker/preview-worker.log
StandardError=append:/var/log/cis-worker/preview-worker-error.log
SyslogIdentifier=cis-preview-worker

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
systemctl enable preview-worker.service

log "systemd service installed"

# =============================================================================
# Install Spot Interruption Handler
# =============================================================================
log "Step 9: Installing spot interruption handler..."

cat > /usr/local/bin/spot-interrupt-handler.sh << 'SPOTEOF'
#!/bin/bash
# Spot Instance Interruption Handler for Preview Worker

LOG_FILE="/var/log/cis-worker/spot-handler.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> $LOG_FILE
}

log "Spot interruption handler started"

while true; do
    # Check for spot interruption notice
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "X-aws-ec2-metadata-token: $(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")" \
        http://169.254.169.254/latest/meta-data/spot/instance-action 2>/dev/null)

    if [ "$HTTP_CODE" == "200" ]; then
        log "Spot interruption notice received!"

        # Get action details
        ACTION=$(curl -s -H "X-aws-ec2-metadata-token: $(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")" \
            http://169.254.169.254/latest/meta-data/spot/instance-action)
        log "Action details: $ACTION"

        # Gracefully stop the worker
        log "Initiating graceful shutdown..."
        systemctl stop preview-worker.service

        # Wait for service to stop (max 60 seconds)
        for i in {1..60}; do
            if ! systemctl is-active --quiet preview-worker.service; then
                log "Worker service stopped successfully"
                break
            fi
            sleep 1
        done

        log "Shutdown complete"
        break
    fi

    sleep 5
done
SPOTEOF

chmod +x /usr/local/bin/spot-interrupt-handler.sh

# Create systemd service for spot handler
cat > /etc/systemd/system/spot-interrupt-handler.service << 'SPOTSERVICEEOF'
[Unit]
Description=EC2 Spot Instance Interruption Handler
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/spot-interrupt-handler.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SPOTSERVICEEOF

systemctl daemon-reload
systemctl enable spot-interrupt-handler.service
systemctl start spot-interrupt-handler.service

log "Spot interruption handler installed"

# =============================================================================
# Configure CloudWatch Agent
# =============================================================================
log "Step 10: Installing CloudWatch Agent..."

dnf install -y amazon-cloudwatch-agent

cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'CWEOF'
{
  "agent": {
    "metrics_collection_interval": 60,
    "run_as_user": "cwagent",
    "logfile": "/opt/aws/amazon-cloudwatch-agent/logs/amazon-cloudwatch-agent.log"
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/cis-worker/preview-worker.log",
            "log_group_name": "/aws/ec2/cis-preview-worker",
            "log_stream_name": "{instance_id}/worker",
            "timezone": "UTC",
            "retention_in_days": 14
          },
          {
            "file_path": "/var/log/cis-worker/preview-worker-error.log",
            "log_group_name": "/aws/ec2/cis-preview-worker",
            "log_stream_name": "{instance_id}/error",
            "timezone": "UTC",
            "retention_in_days": 14
          },
          {
            "file_path": "/var/log/user-data.log",
            "log_group_name": "/aws/ec2/cis-preview-worker",
            "log_stream_name": "{instance_id}/user-data",
            "timezone": "UTC",
            "retention_in_days": 7
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "CIS/PreviewWorker",
    "metrics_collected": {
      "cpu": {
        "measurement": ["cpu_usage_idle", "cpu_usage_iowait", "cpu_usage_user", "cpu_usage_system"],
        "metrics_collection_interval": 60,
        "totalcpu": true
      },
      "disk": {
        "measurement": ["used_percent", "inodes_free"],
        "metrics_collection_interval": 60,
        "resources": ["/", "/opt"]
      },
      "diskio": {
        "measurement": ["io_time", "read_bytes", "write_bytes"],
        "metrics_collection_interval": 60,
        "resources": ["*"]
      },
      "mem": {
        "measurement": ["mem_used_percent", "mem_available_percent"],
        "metrics_collection_interval": 60
      },
      "swap": {
        "measurement": ["swap_used_percent"],
        "metrics_collection_interval": 60
      }
    },
    "aggregation_dimensions": [["InstanceId"], ["AutoScalingGroupName"]]
  }
}
CWEOF

/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -s \
    -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

log "CloudWatch Agent installed and started"

# =============================================================================
# Configure Log Rotation
# =============================================================================
log "Step 11: Configuring log rotation..."

cat > /etc/logrotate.d/cis-preview-worker << 'LOGROTATEEOF'
/var/log/cis-worker/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 cis-worker cis-worker
    sharedscripts
    postrotate
        # Signal CloudWatch agent to refresh file handles
        /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status > /dev/null 2>&1 || true
    endscript
}
LOGROTATEEOF

log "Log rotation configured"

# =============================================================================
# Validate Configuration
# =============================================================================
log "Step 12: Validating configuration..."

cd $APP_DIR
source venv/bin/activate

# Test Python imports
python3 -c "
import sys
sys.path.insert(0, '/opt/cis-worker/src')
try:
    from config import config
    print('Config loaded successfully')
    print(f'  AWS Region: {config.aws.region}')
    print(f'  Log Level: {config.logging.level}')
except Exception as e:
    print(f'Config validation failed: {e}')
    sys.exit(1)
"

if [ $? -eq 0 ]; then
    log "Configuration validation passed"
else
    log "WARNING: Configuration validation failed"
fi

# =============================================================================
# Start Services
# =============================================================================
log "Step 13: Starting preview worker service..."

systemctl start preview-worker.service

# Wait for service to start
sleep 5

if systemctl is-active --quiet preview-worker.service; then
    log "Preview worker service started successfully"
else
    log "ERROR: Preview worker service failed to start"
    systemctl status preview-worker.service
fi

# =============================================================================
# Signal Completion
# =============================================================================
log "=========================================="
log "CIS Preview Worker Bootstrap Complete"
log "Instance ID: $(curl -s http://169.254.169.254/latest/meta-data/instance-id)"
log "Private IP: $(curl -s http://169.254.169.254/latest/meta-data/local-ipv4)"
log "=========================================="

# Send success signal to CloudFormation (if using cfn-signal)
# /opt/aws/bin/cfn-signal -e $? --stack ${AWS::StackName} --resource AutoScalingGroup --region ${AWS::Region}

exit 0
