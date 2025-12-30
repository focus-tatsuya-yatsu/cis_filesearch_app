#!/bin/bash
# ============================================================================
# EC2 Bastion Setup Script for OpenSearch Migration
# ============================================================================

set -e
set -o pipefail

# Enable error logging
exec 2>&1 | tee /var/log/bastion-setup.log

echo "======================================================================"
echo " OpenSearch Migration Bastion Setup"
echo "======================================================================"

# Update system
echo "Updating system packages..."
dnf update -y

# Install required packages
echo "Installing required packages..."
dnf install -y \
  git \
  nodejs \
  npm \
  jq \
  unzip \
  wget \
  vim \
  htop

# Install AWS CLI v2
echo "Installing AWS CLI v2..."
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip"
unzip -q /tmp/awscliv2.zip -d /tmp
/tmp/aws/install
rm -rf /tmp/aws /tmp/awscliv2.zip

# Verify installations
echo "Verifying installations..."
node --version
npm --version
aws --version

# Configure AWS region
export AWS_REGION="${aws_region}"
echo "export AWS_REGION=${aws_region}" >> /etc/profile.d/aws-config.sh

# Create migration user
echo "Creating migration user..."
useradd -m -s /bin/bash migration
usermod -aG wheel migration

# Setup migration directory
echo "Setting up migration directory..."
mkdir -p /opt/cis-migration
chown migration:migration /opt/cis-migration

# Clone repository (if accessible from VPC)
# Note: You may need to configure VPC endpoints for GitHub access
# or use AWS CodeCommit instead

# Create environment file template
cat > /opt/cis-migration/.env.template << 'EOF'
# OpenSearch Configuration
OPENSEARCH_ENDPOINT=${opensearch_endpoint}
OPENSEARCH_INDEX=file-index
OPENSEARCH_NEW_INDEX=file-index-v2-$(date +%Y%m%d)
OPENSEARCH_ALIAS=file-index
AWS_REGION=${aws_region}
OPENSEARCH_BACKUP_REPO=opensearch-backups

# Migration Options
# Add --dry-run for testing
# Add --execute for actual migration
# Add --force to bypass some validations (use with caution)
EOF

chown migration:migration /opt/cis-migration/.env.template

# Create quick-start script
cat > /opt/cis-migration/quick-start.sh << 'QUICKSTART'
#!/bin/bash

echo "======================================================================"
echo " OpenSearch Migration Quick Start"
echo "======================================================================"
echo ""
echo "This bastion instance is configured for OpenSearch migration."
echo ""
echo "STEPS TO EXECUTE MIGRATION:"
echo ""
echo "1. Navigate to migration directory:"
echo "   cd /opt/cis-migration"
echo ""
echo "2. Clone the repository (if not already done):"
echo "   git clone https://github.com/your-org/cis-filesearch-app.git"
echo "   cd cis-filesearch-app/backend/lambda-search-api"
echo ""
echo "3. Install dependencies:"
echo "   npm install"
echo ""
echo "4. Configure environment variables:"
echo "   cp /opt/cis-migration/.env.template .env.migration"
echo "   vim .env.migration  # Edit as needed"
echo "   export \$(cat .env.migration | xargs)"
echo ""
echo "5. Run dry-run (RECOMMENDED):"
echo "   npm run migrate:opensearch -- --dry-run"
echo ""
echo "6. If dry-run succeeds, execute migration:"
echo "   npm run migrate:opensearch -- --execute"
echo ""
echo "7. Monitor progress:"
echo "   tail -f /var/log/migration-*.log"
echo ""
echo "======================================================================"
echo ""
echo "OpenSearch Endpoint: ${opensearch_endpoint}"
echo "AWS Region: ${aws_region}"
echo ""
echo "For help, see: /opt/cis-migration/README.md"
echo "======================================================================"
QUICKSTART

chmod +x /opt/cis-migration/quick-start.sh
chown migration:migration /opt/cis-migration/quick-start.sh

# Create README
cat > /opt/cis-migration/README.md << 'README'
# OpenSearch Migration Bastion

## Overview

This EC2 instance is configured as a bastion for executing OpenSearch index migrations.

## Quick Start

Run the quick-start script to see instructions:

```bash
/opt/cis-migration/quick-start.sh
```

## Manual Migration Steps

### 1. Connect to this instance

From your local machine:

```bash
aws ssm start-session --target i-xxxxxxxxxxxxx
```

### 2. Switch to migration user

```bash
sudo su - migration
cd /opt/cis-migration
```

### 3. Clone repository

```bash
git clone https://github.com/your-org/cis-filesearch-app.git
cd cis-filesearch-app/backend/lambda-search-api
```

### 4. Install dependencies

```bash
npm install
```

### 5. Configure environment

```bash
cp /opt/cis-migration/.env.template .env.migration
vim .env.migration
export $(cat .env.migration | xargs)
```

### 6. Run dry-run

```bash
npm run migrate:opensearch -- --dry-run
```

### 7. Execute migration

```bash
npm run migrate:opensearch -- --execute 2>&1 | tee migration-$(date +%Y%m%d-%H%M%S).log
```

## Troubleshooting

### Check OpenSearch connectivity

```bash
curl -XGET "https://${opensearch_endpoint}/_cluster/health" \
  --aws-sigv4 "aws:amz:${aws_region}:es"
```

### View available indices

```bash
curl -XGET "https://${opensearch_endpoint}/_cat/indices?v" \
  --aws-sigv4 "aws:amz:${aws_region}:es"
```

### Check IAM permissions

```bash
aws sts get-caller-identity
aws opensearch describe-domain --domain-name cis-filesearch-opensearch
```

## Logs

- Setup log: `/var/log/bastion-setup.log`
- Migration logs: `~/migration-*.log`
- CloudWatch Logs: `/cis-filesearch/migration`

## Security

- This instance has no public IP
- Access is via AWS Systems Manager Session Manager only
- All outbound HTTPS traffic is allowed
- Inbound traffic is blocked except from VPC

## Support

For issues, contact: devops@example.com
README

chown migration:migration /opt/cis-migration/README.md

# Configure CloudWatch Agent (optional but recommended)
echo "Configuring CloudWatch Agent..."
wget https://s3.amazonaws.com/amazoncloudwatch-agent/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm -O /tmp/amazon-cloudwatch-agent.rpm
rpm -U /tmp/amazon-cloudwatch-agent.rpm
rm /tmp/amazon-cloudwatch-agent.rpm

cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << 'CWAGENT'
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/bastion-setup.log",
            "log_group_name": "/cis-filesearch/migration",
            "log_stream_name": "{instance_id}/bastion-setup"
          },
          {
            "file_path": "/home/migration/migration-*.log",
            "log_group_name": "/cis-filesearch/migration",
            "log_stream_name": "{instance_id}/migration"
          }
        ]
      }
    }
  }
}
CWAGENT

/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

# Display success message
echo ""
echo "======================================================================"
echo " Bastion Setup Complete"
echo "======================================================================"
echo ""
echo "OpenSearch Endpoint: ${opensearch_endpoint}"
echo "AWS Region: ${aws_region}"
echo ""
echo "To get started, run: /opt/cis-migration/quick-start.sh"
echo ""
echo "======================================================================"

# Create success marker
touch /var/log/bastion-setup-complete
