#!/bin/bash
# =============================================================================
# CIS Preview Worker - AMI Build Script
# =============================================================================
#
# This script prepares an Amazon Linux 2023 instance for AMI creation.
# Run this on a fresh EC2 instance, then create an AMI from it.
#
# The resulting AMI can be used with Auto Scaling Launch Templates for
# faster instance boot times.
#
# Usage:
#   1. Launch Amazon Linux 2023 t3.medium instance
#   2. SSH into the instance
#   3. Run: sudo bash build-ami.sh
#   4. Create AMI from the instance
#   5. Update Launch Template with new AMI ID
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

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "=========================================="
log "CIS Preview Worker AMI Build"
log "=========================================="

# =============================================================================
# System Updates & Dependencies
# =============================================================================
log "Installing system dependencies..."

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
    unzip \
    amazon-cloudwatch-agent

log "Dependencies installed"

# Verify key installations
log "Verification:"
log "  Python: $(python3.11 --version)"
log "  Tesseract: $(tesseract --version | head -1)"
log "  LibreOffice: $(libreoffice --version | head -1)"

# =============================================================================
# Create Service User
# =============================================================================
log "Creating service user..."

if ! id -u $SERVICE_USER &>/dev/null; then
    useradd -r -s /sbin/nologin -d $APP_DIR $SERVICE_USER
fi

log "User $SERVICE_USER configured"

# =============================================================================
# Create Directory Structure
# =============================================================================
log "Creating directories..."

mkdir -p $APP_DIR
mkdir -p $APP_DIR/src
mkdir -p $APP_DIR/temp
mkdir -p $LOG_DIR

# =============================================================================
# Setup Python Virtual Environment
# =============================================================================
log "Setting up Python environment..."

cd $APP_DIR
python3.11 -m venv venv
source venv/bin/activate

pip install --upgrade pip

# Create requirements.txt for baked AMI
cat > $APP_DIR/requirements.txt << 'EOF'
boto3>=1.34.0
botocore>=1.34.0
opensearch-py>=2.4.0
requests>=2.31.0
requests-aws4auth>=1.2.3
python-dotenv>=1.0.0
Pillow>=10.0.0
pdf2image>=1.16.0
pytesseract>=0.3.10
PyMuPDF>=1.24.0
python-magic>=0.4.27
EOF

pip install -r requirements.txt

log "Python dependencies installed"

# =============================================================================
# Set Permissions
# =============================================================================
log "Setting permissions..."

chown -R $SERVICE_USER:$SERVICE_GROUP $APP_DIR
chown -R $SERVICE_USER:$SERVICE_GROUP $LOG_DIR
chmod 755 $APP_DIR
chmod 755 $LOG_DIR

# Create empty .env placeholder (will be populated by user data)
touch $APP_DIR/.env
chown $SERVICE_USER:$SERVICE_GROUP $APP_DIR/.env
chmod 600 $APP_DIR/.env

# Create empty log files
touch $LOG_DIR/preview-worker.log
touch $LOG_DIR/preview-worker-error.log
chown $SERVICE_USER:$SERVICE_GROUP $LOG_DIR/*.log
chmod 644 $LOG_DIR/*.log

# =============================================================================
# Install systemd Service
# =============================================================================
log "Installing systemd service..."

cat > /etc/systemd/system/preview-worker.service << 'SERVICEEOF'
[Unit]
Description=CIS Preview Worker - SQS Preview Generation Service
After=network-online.target cloud-final.service
Wants=network-online.target

[Service]
Type=simple
User=cis-worker
Group=cis-worker
WorkingDirectory=/opt/cis-worker

EnvironmentFile=/opt/cis-worker/.env
Environment="PATH=/opt/cis-worker/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="PYTHONUNBUFFERED=1"
Environment="PYTHONDONTWRITEBYTECODE=1"

ExecStart=/opt/cis-worker/venv/bin/python /opt/cis-worker/src/preview_worker.py --threads 2 --idle-timeout 300

Restart=on-failure
RestartSec=10s
StartLimitBurst=5
StartLimitIntervalSec=300s

TimeoutStopSec=65s
KillMode=mixed
KillSignal=SIGTERM

LimitNOFILE=65536
LimitNPROC=4096
MemoryMax=2G
MemoryHigh=1536M
CPUQuota=150%

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

StandardOutput=append:/var/log/cis-worker/preview-worker.log
StandardError=append:/var/log/cis-worker/preview-worker-error.log
SyslogIdentifier=cis-preview-worker

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
# Don't enable yet - will be enabled by user data after config is ready

log "systemd service installed (not enabled)"

# =============================================================================
# Install Spot Interruption Handler
# =============================================================================
log "Installing spot interruption handler..."

cat > /usr/local/bin/spot-interrupt-handler.sh << 'SPOTEOF'
#!/bin/bash
LOG_FILE="/var/log/cis-worker/spot-handler.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> $LOG_FILE
}

log "Spot interruption handler started"

while true; do
    TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "X-aws-ec2-metadata-token: $TOKEN" \
        http://169.254.169.254/latest/meta-data/spot/instance-action 2>/dev/null)

    if [ "$HTTP_CODE" == "200" ]; then
        log "Spot interruption notice received!"
        systemctl stop preview-worker.service
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

cat > /etc/systemd/system/spot-interrupt-handler.service << 'EOF'
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
EOF

systemctl daemon-reload
systemctl enable spot-interrupt-handler.service

log "Spot interruption handler installed"

# =============================================================================
# Configure CloudWatch Agent
# =============================================================================
log "Configuring CloudWatch Agent..."

cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'CWEOF'
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
            "timezone": "UTC"
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "CIS/PreviewWorker",
    "metrics_collected": {
      "cpu": {
        "measurement": ["cpu_usage_idle", "cpu_usage_iowait"],
        "metrics_collection_interval": 60,
        "totalcpu": true
      },
      "disk": {
        "measurement": ["used_percent"],
        "metrics_collection_interval": 60,
        "resources": ["/"]
      },
      "mem": {
        "measurement": ["mem_used_percent"],
        "metrics_collection_interval": 60
      }
    }
  }
}
CWEOF

systemctl enable amazon-cloudwatch-agent

log "CloudWatch Agent configured"

# =============================================================================
# Configure Log Rotation
# =============================================================================
log "Configuring log rotation..."

cat > /etc/logrotate.d/cis-preview-worker << 'EOF'
/var/log/cis-worker/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 cis-worker cis-worker
}
EOF

log "Log rotation configured"

# =============================================================================
# Create Bootstrap Script for User Data
# =============================================================================
log "Creating bootstrap script..."

cat > /opt/cis-worker/bootstrap.sh << 'BOOTEOF'
#!/bin/bash
# Bootstrap script - called by user data to finalize configuration

set -euo pipefail

AWS_REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)
export AWS_DEFAULT_REGION=$AWS_REGION

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a /var/log/cis-worker/bootstrap.log
}

log "Bootstrap starting..."

# Download latest code from S3
DEPLOY_BUCKET="${DEPLOY_BUCKET:-cis-deploy-bucket}"
DEPLOY_PREFIX="${DEPLOY_PREFIX:-cis-worker}"

if aws s3 cp s3://${DEPLOY_BUCKET}/${DEPLOY_PREFIX}/src.tar.gz /tmp/src.tar.gz 2>/dev/null; then
    log "Downloading latest source code..."
    tar -xzf /tmp/src.tar.gz -C /opt/cis-worker/
    rm -f /tmp/src.tar.gz
    chown -R cis-worker:cis-worker /opt/cis-worker/src
fi

# Download config from S3 or SSM
if aws s3 cp s3://${DEPLOY_BUCKET}/${DEPLOY_PREFIX}/config/.env /opt/cis-worker/.env 2>/dev/null; then
    log "Config downloaded from S3"
elif [ -n "${SSM_ENV_PATH:-}" ]; then
    log "Fetching config from SSM..."
    aws ssm get-parameter --name "$SSM_ENV_PATH" --with-decryption --query 'Parameter.Value' --output text > /opt/cis-worker/.env
fi

chmod 600 /opt/cis-worker/.env
chown cis-worker:cis-worker /opt/cis-worker/.env

# Enable and start services
systemctl enable preview-worker.service
systemctl start amazon-cloudwatch-agent
systemctl start spot-interrupt-handler.service
systemctl start preview-worker.service

log "Bootstrap complete"
BOOTEOF

chmod +x /opt/cis-worker/bootstrap.sh

log "Bootstrap script created"

# =============================================================================
# Cleanup for AMI
# =============================================================================
log "Cleaning up for AMI creation..."

# Clear logs
> /var/log/messages
> /var/log/secure
> /var/log/cloud-init.log
> /var/log/cloud-init-output.log
rm -f /var/log/user-data.log

# Clear SSH host keys (will be regenerated on boot)
rm -f /etc/ssh/ssh_host_*

# Clear machine ID (will be regenerated)
> /etc/machine-id

# Clear bash history
> ~/.bash_history
history -c

log "=========================================="
log "AMI Build Complete!"
log "=========================================="
log ""
log "Next steps:"
log "1. Stop this instance"
log "2. Create AMI from the instance"
log "3. Update Launch Template with new AMI ID"
log ""
log "User Data for Launch Template should call:"
log "  /opt/cis-worker/bootstrap.sh"
log ""
log "Example minimal user data:"
log "  #!/bin/bash"
log "  export DEPLOY_BUCKET=your-bucket"
log "  /opt/cis-worker/bootstrap.sh"
log "=========================================="
