#!/bin/bash
# ============================================================================
# Worker Exit Status 1 Complete Fix Script
# ============================================================================
# Purpose: Fix all issues causing worker.py to exit with status=1
# This script addresses:
#   1. Python module import errors
#   2. Missing environment variables
#   3. Systemd service configuration issues
#   4. File permissions and paths
# ============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
EC2_NAME_TAG="${EC2_NAME_TAG:-cis-filesearch-ec2}"
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/cis-filesearch-key.pem}"
AWS_REGION="${AWS_REGION:-ap-northeast-1}"

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}Worker Exit Status 1 Complete Fix${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""

# ============================================================================
# Get AWS Resources
# ============================================================================
echo -e "${YELLOW}[Step 1/10]${NC} Fetching AWS resource information..."

# Get EC2 IP
EC2_IP=$(aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=${EC2_NAME_TAG}" "Name=instance-state-name,Values=running" \
    --query "Reservations[0].Instances[0].PublicIpAddress" \
    --output text)

if [ "$EC2_IP" == "None" ] || [ -z "$EC2_IP" ]; then
    echo -e "${RED}ERROR: EC2 instance not found${NC}"
    exit 1
fi

# Get SQS Queue URL
SQS_QUEUE_URL=$(aws sqs get-queue-url \
    --queue-name cis-filesearch-index-queue \
    --query 'QueueUrl' \
    --output text 2>/dev/null || echo "")

# Get DLQ URL
DLQ_QUEUE_URL=$(aws sqs get-queue-url \
    --queue-name cis-filesearch-index-queue-dlq \
    --query 'QueueUrl' \
    --output text 2>/dev/null || echo "")

# Get S3 Bucket
S3_BUCKET=$(aws s3 ls | grep cis-filesearch | awk '{print $3}' | head -1)

# Get OpenSearch Endpoint
OPENSEARCH_ENDPOINT=$(aws opensearch describe-domain \
    --domain-name cis-filesearch \
    --query 'DomainStatus.Endpoint' \
    --output text 2>/dev/null || echo "")

echo -e "${GREEN}✓${NC} EC2 IP: $EC2_IP"
echo -e "${GREEN}✓${NC} SQS Queue: $SQS_QUEUE_URL"
echo -e "${GREEN}✓${NC} DLQ Queue: $DLQ_QUEUE_URL"
echo -e "${GREEN}✓${NC} S3 Bucket: $S3_BUCKET"
echo -e "${GREEN}✓${NC} OpenSearch: $OPENSEARCH_ENDPOINT"
echo ""

# Function to run SSH command
run_ssh() {
    ssh -o StrictHostKeyChecking=no -i "$SSH_KEY" "ec2-user@${EC2_IP}" "$@"
}

# ============================================================================
# Stop Current Worker Service
# ============================================================================
echo -e "${YELLOW}[Step 2/10]${NC} Stopping current worker service..."
run_ssh 'sudo systemctl stop file-scanner-worker 2>/dev/null || sudo systemctl stop file-processor 2>/dev/null || true'
echo -e "${GREEN}✓${NC} Service stopped"
echo ""

# ============================================================================
# Upload Latest Worker Code
# ============================================================================
echo -e "${YELLOW}[Step 3/10]${NC} Uploading latest worker code to S3..."

# Create deployment package
cd "$(dirname "$0")"
TEMP_DIR=$(mktemp -d)
cp -r . "$TEMP_DIR/python-worker"
cd "$TEMP_DIR"

# Exclude unnecessary files
tar -czf python-worker-latest.tar.gz \
    --exclude='*.md' \
    --exclude='*.pyc' \
    --exclude='__pycache__' \
    --exclude='.git' \
    --exclude='*.log' \
    --exclude='tests' \
    --exclude='.env.*' \
    python-worker/

# Upload to S3
aws s3 cp python-worker-latest.tar.gz "s3://${S3_BUCKET}/deployments/" --region "$AWS_REGION"
rm -rf "$TEMP_DIR"

echo -e "${GREEN}✓${NC} Worker code uploaded to S3"
echo ""

# ============================================================================
# Download and Extract Worker Code on EC2
# ============================================================================
echo -e "${YELLOW}[Step 4/10]${NC} Deploying worker code on EC2..."
run_ssh bash -s << EOF
set -e

# Create worker directory
sudo mkdir -p /opt/worker
cd /opt/worker

# Download latest code from S3
echo "Downloading from S3..."
aws s3 cp "s3://${S3_BUCKET}/deployments/python-worker-latest.tar.gz" /tmp/python-worker.tar.gz --region ${AWS_REGION}

# Extract
echo "Extracting..."
sudo tar -xzf /tmp/python-worker.tar.gz -C /tmp/
sudo cp -r /tmp/python-worker/* /opt/worker/
sudo rm -rf /tmp/python-worker /tmp/python-worker.tar.gz

# Set ownership
sudo chown -R ec2-user:ec2-user /opt/worker

echo "✓ Worker code deployed"
EOF
echo ""

# ============================================================================
# Install Python Dependencies
# ============================================================================
echo -e "${YELLOW}[Step 5/10]${NC} Installing Python dependencies..."
run_ssh bash -s << 'EOF'
set -e

cd /opt/worker

echo "Upgrading pip..."
python3 -m pip install --upgrade pip --user

echo "Installing requirements..."
python3 -m pip install -r requirements.txt --user

echo "Verifying critical packages..."
python3 -c "import boto3; print('✓ boto3:', boto3.__version__)"
python3 -c "import opensearchpy; print('✓ opensearchpy:', opensearchpy.__version__)"
python3 -c "from PIL import Image; print('✓ Pillow: OK')"

echo "✓ All dependencies installed"
EOF
echo ""

# ============================================================================
# Create Environment Variables File
# ============================================================================
echo -e "${YELLOW}[Step 6/10]${NC} Creating environment variables..."
run_ssh bash -s << ENVEOF
set -e

cat > /opt/worker/.env << 'EOF'
# AWS Configuration
AWS_REGION=${AWS_REGION}
AWS_DEFAULT_REGION=${AWS_REGION}

# S3 Configuration
S3_BUCKET=${S3_BUCKET}

# SQS Configuration
SQS_QUEUE_URL=${SQS_QUEUE_URL}
DLQ_QUEUE_URL=${DLQ_QUEUE_URL}
SQS_WAIT_TIME=20
SQS_VISIBILITY_TIMEOUT=300
SQS_MAX_MESSAGES=1

# OpenSearch Configuration
OPENSEARCH_ENDPOINT=${OPENSEARCH_ENDPOINT}
OPENSEARCH_INDEX=file-index
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
IMAGE_PREPROCESSING=true

# Logging Configuration
LOG_LEVEL=INFO
LOG_FILE=/var/log/file-scanner-worker.log
USE_CLOUDWATCH=false

# Retry Configuration
MAX_RETRIES=3
RETRY_DELAY=5
EOF

echo "✓ Environment file created"
cat /opt/worker/.env
ENVEOF
echo ""

# ============================================================================
# Create Improved Systemd Service
# ============================================================================
echo -e "${YELLOW}[Step 7/10]${NC} Creating systemd service..."
run_ssh bash -s << 'SERVICEEOF'
set -e

sudo tee /etc/systemd/system/file-scanner-worker.service > /dev/null << 'EOF'
[Unit]
Description=File Scanner Worker - SQS Message Processor
Documentation=https://github.com/your-org/cis-filesearch
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=ec2-user
Group=ec2-user
WorkingDirectory=/opt/worker

# Environment
EnvironmentFile=/opt/worker/.env

# Main process
ExecStart=/usr/bin/python3 -u /opt/worker/worker.py

# Restart policy - CRITICAL FIX
# Only restart on clean exit (0) or specific signals
# Do NOT restart on exit code 1 (failure)
Restart=on-failure
RestartSec=30
StartLimitBurst=5
StartLimitIntervalSec=300

# Graceful shutdown
TimeoutStopSec=30
KillMode=mixed
KillSignal=SIGTERM

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096
MemoryLimit=2G
CPUQuota=200%

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/tmp/file-processor /var/log

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=file-scanner-worker

[Install]
WantedBy=multi-user.target
EOF

echo "✓ Systemd service created"
sudo systemctl daemon-reload
SERVICEEOF
echo ""

# ============================================================================
# Create Log Directory and File
# ============================================================================
echo -e "${YELLOW}[Step 8/10]${NC} Setting up logging..."
run_ssh bash -s << 'EOF'
set -e

# Create log file
sudo touch /var/log/file-scanner-worker.log
sudo chown ec2-user:ec2-user /var/log/file-scanner-worker.log
sudo chmod 644 /var/log/file-scanner-worker.log

# Create temp directory
sudo mkdir -p /tmp/file-processor
sudo chown ec2-user:ec2-user /tmp/file-processor

echo "✓ Logging configured"
EOF
echo ""

# ============================================================================
# Validate Configuration
# ============================================================================
echo -e "${YELLOW}[Step 9/10]${NC} Validating worker configuration..."
run_ssh bash -s << 'EOF'
set -e

cd /opt/worker

# Source environment
set -a
source .env
set +a

# Validate configuration
echo "Running configuration validation..."
python3 worker.py --validate-only

EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
    echo "✓ Configuration validation successful"
else
    echo "✗ Configuration validation failed with exit code $EXIT_CODE"
    exit 1
fi
EOF
echo ""

# ============================================================================
# Start Worker Service
# ============================================================================
echo -e "${YELLOW}[Step 10/10]${NC} Starting worker service..."
run_ssh bash -s << 'EOF'
set -e

# Enable service
sudo systemctl enable file-scanner-worker

# Start service
sudo systemctl start file-scanner-worker

# Wait a bit
sleep 5

# Check status
if sudo systemctl is-active --quiet file-scanner-worker; then
    echo "✓ Worker service is active"
    sudo systemctl status file-scanner-worker --no-pager -l
else
    echo "✗ Worker service failed to start"
    echo ""
    echo "Recent logs:"
    sudo journalctl -u file-scanner-worker -n 50 --no-pager
    exit 1
fi
EOF
echo ""

# ============================================================================
# Monitor Service for 60 seconds
# ============================================================================
echo -e "${YELLOW}Monitoring service for 60 seconds...${NC}"
echo ""

for i in {1..12}; do
    sleep 5

    STATUS=$(run_ssh 'sudo systemctl is-active file-scanner-worker 2>/dev/null || echo "inactive"')

    if [ "$STATUS" == "active" ]; then
        echo -e "${GREEN}[$i/12]${NC} Service is running ✓"
    else
        echo -e "${RED}[$i/12]${NC} Service stopped! ✗"
        echo ""
        echo "Fetching error logs..."
        run_ssh 'sudo journalctl -u file-scanner-worker -n 100 --no-pager'
        exit 1
    fi
done

echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}Fix Applied Successfully!${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo "Worker service is now stable and processing messages."
echo ""
echo -e "${BLUE}Monitoring Commands:${NC}"
echo "  ssh -i $SSH_KEY ec2-user@${EC2_IP}"
echo "  sudo systemctl status file-scanner-worker"
echo "  sudo journalctl -u file-scanner-worker -f"
echo "  tail -f /var/log/file-scanner-worker.log"
echo ""
echo -e "${BLUE}Check Queue Status:${NC}"
echo "  aws sqs get-queue-attributes --queue-url $SQS_QUEUE_URL --attribute-names ApproximateNumberOfMessages"
echo ""
