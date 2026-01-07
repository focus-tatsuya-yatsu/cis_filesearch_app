#!/bin/bash
# =============================================================================
# CIS Preview Worker - Minimal User Data for Baked AMI
# =============================================================================
#
# This script is designed for use with a pre-baked AMI that already has:
# - Python environment set up
# - All dependencies installed
# - systemd service files in place
# - CloudWatch agent configured
#
# User data only needs to:
# 1. Download latest source code (optional)
# 2. Configure environment variables
# 3. Start services
#
# Expected boot time: 1-2 minutes (vs 5-10 minutes for full user data)
#
# =============================================================================

set -euo pipefail

exec > >(tee /var/log/user-data.log|logger -t user-data) 2>&1

# =============================================================================
# Configuration - UPDATE THESE VALUES
# =============================================================================
DEPLOY_BUCKET="cis-deploy-bucket"         # S3 bucket with deployment artifacts
DEPLOY_PREFIX="cis-worker"                 # S3 prefix

# Get AWS region from instance metadata
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
AWS_REGION=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/region)
export AWS_DEFAULT_REGION=$AWS_REGION

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "=========================================="
log "CIS Preview Worker Bootstrap (Baked AMI)"
log "Region: $AWS_REGION"
log "=========================================="

# =============================================================================
# Download Latest Source Code (Optional)
# =============================================================================
log "Checking for source code updates..."

if aws s3 cp s3://${DEPLOY_BUCKET}/${DEPLOY_PREFIX}/src.tar.gz /tmp/src.tar.gz 2>/dev/null; then
    log "Downloading latest source code..."
    rm -rf /opt/cis-worker/src/*
    tar -xzf /tmp/src.tar.gz -C /opt/cis-worker/
    rm -f /tmp/src.tar.gz
    chown -R cis-worker:cis-worker /opt/cis-worker/src
    log "Source code updated"
else
    log "Using source code from AMI"
fi

# =============================================================================
# Configure Environment Variables
# =============================================================================
log "Configuring environment..."

# Option 1: Download .env from S3
if aws s3 cp s3://${DEPLOY_BUCKET}/${DEPLOY_PREFIX}/config/.env /opt/cis-worker/.env 2>/dev/null; then
    log "Config downloaded from S3"

# Option 2: Download from SSM Parameter Store (more secure)
# elif aws ssm get-parameter --name "/cis/preview-worker/env" --with-decryption --query 'Parameter.Value' --output text > /opt/cis-worker/.env 2>/dev/null; then
#     log "Config downloaded from SSM"

# Option 3: Create from embedded values (least secure, for testing only)
else
    log "Creating default config..."
    cat > /opt/cis-worker/.env << 'ENVEOF'
AWS_REGION=ap-northeast-1
S3_LANDING_BUCKET=cis-landing-bucket
S3_THUMBNAIL_BUCKET=cis-thumbnail-bucket
PREVIEW_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/YOUR_ACCOUNT_ID/cis-filesearch-preview-queue
OPENSEARCH_ENDPOINT=https://your-domain.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX_NAME=cis-files
LOG_LEVEL=INFO
WORKER_THREADS=2
PREVIEW_DPI=150
PREVIEW_MAX_PAGES=50
ENVEOF
fi

# Fix permissions
chmod 600 /opt/cis-worker/.env
chown cis-worker:cis-worker /opt/cis-worker/.env

# =============================================================================
# Update Region in .env (Override with instance region)
# =============================================================================
sed -i "s/^AWS_REGION=.*/AWS_REGION=$AWS_REGION/" /opt/cis-worker/.env

# =============================================================================
# Start Services
# =============================================================================
log "Starting services..."

# Enable and start preview worker
systemctl enable preview-worker.service
systemctl start preview-worker.service

# Start CloudWatch agent
systemctl start amazon-cloudwatch-agent

# Start spot interrupt handler (should already be running)
systemctl start spot-interrupt-handler.service

# =============================================================================
# Verify Services
# =============================================================================
log "Verifying services..."

sleep 5

SERVICES=("preview-worker" "amazon-cloudwatch-agent" "spot-interrupt-handler")
ALL_OK=true

for svc in "${SERVICES[@]}"; do
    if systemctl is-active --quiet $svc; then
        log "  $svc: RUNNING"
    else
        log "  $svc: FAILED"
        ALL_OK=false
    fi
done

if [ "$ALL_OK" = true ]; then
    log "All services started successfully"
else
    log "WARNING: Some services failed to start"
fi

# =============================================================================
# Signal Completion
# =============================================================================
INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
PRIVATE_IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/local-ipv4)

log "=========================================="
log "Bootstrap Complete"
log "Instance: $INSTANCE_ID"
log "IP: $PRIVATE_IP"
log "=========================================="

# Optional: Send CloudFormation signal
# /opt/aws/bin/cfn-signal -e 0 --stack ${AWS::StackName} --resource AutoScalingGroup --region $AWS_REGION

exit 0
