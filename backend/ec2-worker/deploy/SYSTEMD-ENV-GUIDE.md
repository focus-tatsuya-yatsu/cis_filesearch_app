# systemd Environment Variable Best Practices Guide

## Overview

This guide explains how to properly configure environment variables for systemd services, specifically for the CIS Preview Worker running on Amazon Linux 2023.

## The Problem

Common issues when environment variables are not loaded:

1. **Service starts but doesn't process SQS messages** - Missing `PREVIEW_QUEUE_URL` or AWS credentials
2. **Python dotenv doesn't find .env file** - `WorkingDirectory` not set correctly
3. **systemd ignores .env file** - Wrong format (dotenv format != systemd EnvironmentFile format)
4. **Permission denied** - .env file not readable by service user

## Solution: Dual Approach

### Method 1: systemd EnvironmentFile (Recommended)

systemd's `EnvironmentFile` directive reads KEY=VALUE pairs directly into the service environment.

**Service File Configuration:**

```ini
[Service]
EnvironmentFile=/opt/cis-worker/.env
Environment="PATH=/opt/cis-worker/venv/bin:/usr/bin"
```

**Important Rules for .env file:**

```bash
# CORRECT format for systemd EnvironmentFile
AWS_REGION=ap-northeast-1
PREVIEW_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/123456789/queue

# INCORRECT - systemd will fail to parse
export AWS_REGION=ap-northeast-1     # Don't use 'export'
AWS_REGION="ap-northeast-1"           # Quotes are usually OK but can cause issues
AWS_REGION='ap-northeast-1'           # Single quotes may cause issues
AWS_REGION = ap-northeast-1           # No spaces around '='
```

**Compatibility Note:** Python's `dotenv` library handles both formats, but systemd is stricter:

| Format | dotenv | systemd |
|--------|--------|---------|
| `KEY=value` | Yes | Yes |
| `KEY="value"` | Yes | Usually |
| `KEY='value'` | Yes | May fail |
| `export KEY=value` | Yes | No |
| `KEY = value` | Yes | No |

### Method 2: Python dotenv (Backup)

If using Python's `dotenv`, ensure `WorkingDirectory` is set:

```ini
[Service]
WorkingDirectory=/opt/cis-worker
ExecStart=/opt/cis-worker/venv/bin/python /opt/cis-worker/src/preview_worker.py
```

The `config.py` calls `load_dotenv()` which searches:
1. Current working directory (needs `WorkingDirectory`)
2. Parent directories
3. Explicit path if specified

## Verification Commands

### Check if service sees environment variables:

```bash
# Method 1: Check running service environment
sudo cat /proc/$(pgrep -f preview_worker)/environ | tr '\0' '\n' | grep -E "(AWS|SQS|PREVIEW|OPENSEARCH)"

# Method 2: Test with systemd-run
sudo systemd-run --unit=test-env --same-dir -p User=cis-worker \
    -p EnvironmentFile=/opt/cis-worker/.env \
    /opt/cis-worker/venv/bin/python -c "import os; print(os.environ.get('PREVIEW_QUEUE_URL', 'NOT SET'))"

# Method 3: Check systemd's view of the service
systemctl show preview-worker --property=Environment
```

### Validate .env file format:

```bash
# Check for problematic lines
grep -E "^export |= |^[^=]+$" /opt/cis-worker/.env

# Should return nothing if format is correct
```

### Test Python config loading:

```bash
cd /opt/cis-worker
source venv/bin/activate
python -c "
from src.config import config
print(f'Queue URL: {config.sqs.queue_url}')
print(f'AWS Region: {config.aws.region}')
"
```

## Common Issues and Solutions

### Issue 1: Service runs but no SQS processing

**Symptoms:**
- Service status shows `active (running)`
- Logs show "Starting preview worker polling..."
- No messages processed

**Diagnosis:**

```bash
# Check if queue URL is set
sudo journalctl -u preview-worker -f | grep -i queue

# Check environment
cat /proc/$(pgrep -f preview_worker)/environ | tr '\0' '\n' | grep QUEUE
```

**Solution:**

Ensure `.env` has correct format:

```bash
# Create clean .env
cat > /opt/cis-worker/.env << 'EOF'
AWS_REGION=ap-northeast-1
PREVIEW_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/123456789/cis-filesearch-preview-queue
S3_LANDING_BUCKET=cis-landing-bucket
S3_THUMBNAIL_BUCKET=cis-thumbnail-bucket
OPENSEARCH_ENDPOINT=https://xxx.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX_NAME=cis-files
LOG_LEVEL=INFO
EOF

# Fix permissions
chmod 600 /opt/cis-worker/.env
chown cis-worker:cis-worker /opt/cis-worker/.env

# Restart service
sudo systemctl restart preview-worker
```

### Issue 2: "EnvironmentFile not found"

**Solution:**

```bash
# Check file exists and permissions
ls -la /opt/cis-worker/.env

# Create if missing
touch /opt/cis-worker/.env
chown cis-worker:cis-worker /opt/cis-worker/.env
chmod 600 /opt/cis-worker/.env
```

### Issue 3: systemd ignores EnvironmentFile changes

**Solution:**

```bash
# Always daemon-reload after changing service files
sudo systemctl daemon-reload
sudo systemctl restart preview-worker
```

### Issue 4: IAM credentials not available

On EC2, credentials should come from Instance Role, not .env file.

**Check IAM access:**

```bash
# As cis-worker user
sudo -u cis-worker aws sts get-caller-identity

# If fails, check instance metadata access
curl http://169.254.169.254/latest/meta-data/iam/security-credentials/
```

**Note:** Don't put `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` in .env on EC2. Use IAM Instance Roles.

## Production-Ready .env Template

```bash
# =============================================================================
# CIS Preview Worker Configuration
# Format: KEY=value (no spaces, no export, no quotes unless necessary)
# =============================================================================

# AWS Configuration (Region only - credentials via IAM Role)
AWS_REGION=ap-northeast-1

# S3 Buckets
S3_LANDING_BUCKET=cis-landing-bucket
S3_THUMBNAIL_BUCKET=cis-thumbnail-bucket

# SQS Queue (Preview-specific queue)
PREVIEW_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/YOUR_ACCOUNT_ID/cis-filesearch-preview-queue
SQS_VISIBILITY_TIMEOUT=900
SQS_MAX_MESSAGES=10

# OpenSearch
OPENSEARCH_ENDPOINT=https://your-domain.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX_NAME=cis-files
OPENSEARCH_USE_AWS_AUTH=true

# Worker Settings
WORKER_THREADS=2
LOG_LEVEL=INFO

# Preview Settings
PREVIEW_DPI=150
PREVIEW_MAX_PAGES=50
PREVIEW_QUALITY=85
ENABLE_PREVIEW=true

# Temporary Directory
TEMP_DIR=/opt/cis-worker/temp
```

## Alternative: Using AWS SSM Parameter Store

For more secure configuration management:

```bash
# Store parameters
aws ssm put-parameter --name "/cis/preview-worker/queue-url" \
    --value "https://sqs..." --type "String"

# Retrieve in user data script
QUEUE_URL=$(aws ssm get-parameter --name "/cis/preview-worker/queue-url" \
    --query 'Parameter.Value' --output text)
```

## AMI Baking vs User Data

### Option A: Full User Data (Current Approach)

**Pros:**
- Flexible, easy to update
- No AMI management

**Cons:**
- Slower boot time (5-10 minutes)
- More points of failure

### Option B: Baked AMI with Minimal User Data

**Pros:**
- Fast boot time (1-2 minutes)
- More reliable
- Consistent deployments

**Cons:**
- Need to rebuild AMI for updates
- AMI management overhead

**Recommended for Production:** Baked AMI with user data only for:
- Downloading latest .env from S3/SSM
- Starting services

## Health Check Script

Create `/opt/cis-worker/health-check.sh`:

```bash
#!/bin/bash
# Health check for preview worker

# Check service is running
if ! systemctl is-active --quiet preview-worker; then
    echo "UNHEALTHY: Service not running"
    exit 1
fi

# Check process is alive
if ! pgrep -f preview_worker > /dev/null; then
    echo "UNHEALTHY: Process not found"
    exit 1
fi

# Check recent activity in logs (last 5 minutes)
RECENT_LOG=$(find /var/log/cis-worker/preview-worker.log -mmin -5 2>/dev/null)
if [ -z "$RECENT_LOG" ]; then
    echo "WARNING: No recent log activity"
fi

echo "HEALTHY"
exit 0
```

Use with ALB health checks or Auto Scaling lifecycle hooks.

## Debugging Checklist

1. [ ] Service file has `EnvironmentFile=/opt/cis-worker/.env`
2. [ ] .env file exists and is readable by service user
3. [ ] .env format is `KEY=value` (no export, no spaces around =)
4. [ ] `WorkingDirectory` is set in service file
5. [ ] Service was restarted after .env changes
6. [ ] IAM Instance Role has required permissions
7. [ ] Security Group allows outbound HTTPS
8. [ ] VPC has NAT Gateway or VPC Endpoints for AWS services
