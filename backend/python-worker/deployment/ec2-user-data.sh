#!/bin/bash
# ==========================================
# EC2 User Data Script
# Automatically sets up Python Worker on instance launch
# ==========================================

set -e

exec > >(tee /var/log/user-data.log)
exec 2>&1

echo "=========================================="
echo "EC2 User Data - Starting Setup"
echo "Date: $(date)"
echo "=========================================="

# Update system
echo "Updating system packages..."
dnf update -y

# Install basic tools
echo "Installing basic tools..."
dnf install -y \
    git \
    wget \
    curl \
    unzip \
    htop

# Install CloudWatch agent (optional)
echo "Installing CloudWatch agent..."
wget https://s3.amazonaws.com/amazoncloudwatch-agent/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm
rpm -U ./amazon-cloudwatch-agent.rpm
rm -f amazon-cloudwatch-agent.rpm

# Clone application repository (adjust URL)
echo "Cloning application repository..."
cd /home/ec2-user
# Replace with your actual repository URL
# git clone https://github.com/your-org/cis-filesearch-app.git
# cd cis-filesearch-app/backend/python-worker

# Or download from S3
# aws s3 cp s3://your-bucket/python-worker.zip . --region ap-northeast-1
# unzip python-worker.zip

# Run installation script
echo "Running installation script..."
# bash deployment/install.sh

# Configure AWS credentials (if using IAM role, this is automatic)
# Otherwise, configure manually

# Start service
echo "Starting file-processor service..."
# systemctl start file-processor
# systemctl status file-processor

echo "=========================================="
echo "EC2 User Data - Setup Complete"
echo "Date: $(date)"
echo "=========================================="

# Signal success to CloudFormation (if using CFN)
# /opt/aws/bin/cfn-signal -e $? --stack ${AWS::StackName} --resource AutoScalingGroup --region ${AWS::Region}
