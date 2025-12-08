# Quick Start Guide - Python Worker

## 5-Minute Setup for Testing

### Prerequisites

- Amazon Linux 2023 EC2 instance
- IAM role attached with S3, SQS, OpenSearch permissions
- Python 3.11 installed

### Step 1: Upload Files to EC2

```bash
# From your local machine
cd /path/to/cis_filesearch_app/backend/python-worker
tar czf python-worker.tar.gz .

# Upload to EC2
scp -i your-key.pem python-worker.tar.gz ec2-user@your-instance-ip:/home/ec2-user/

# SSH to EC2
ssh -i your-key.pem ec2-user@your-instance-ip

# Extract
cd /home/ec2-user
tar xzf python-worker.tar.gz
rm python-worker.tar.gz
```

### Step 2: Install System Dependencies

```bash
# Update system
sudo dnf update -y

# Install core dependencies
sudo dnf install -y \
    python3.11 \
    python3.11-pip \
    poppler-utils \
    ImageMagick \
    file-devel

# Install Tesseract (if you have the installation script)
# sudo bash /tmp/install-tesseract-al2023.sh

# Or install from DNF (may be older version)
sudo dnf install -y tesseract tesseract-langpack-jpn
```

### Step 3: Install Python Dependencies

```bash
# Upgrade pip
pip3.11 install --user --upgrade pip

# Install requirements
pip3.11 install --user -r requirements.txt
```

### Step 4: Configure Environment

```bash
# Copy and edit .env
cp .env.example .env
nano .env
```

**Minimum required settings:**
```bash
AWS_REGION=ap-northeast-1
S3_BUCKET=your-bucket-name
SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/123456789012/your-queue
OPENSEARCH_ENDPOINT=https://search-xxxxx.ap-northeast-1.es.amazonaws.com
```

### Step 5: Test Configuration

```bash
# Validate configuration
python3.11 worker.py --validate-only

# If validation passes:
# ✓ Configuration validation successful
```

### Step 6: Create OpenSearch Index

```bash
# Create index with proper mappings
python3.11 worker.py --create-index

# Should see:
# [INFO] Created index 'file-index'
```

### Step 7: Start Worker (Manual Test)

```bash
# Run worker in foreground (for testing)
python3.11 worker.py

# You should see:
# [INFO] Starting to poll SQS queue...
# [INFO] Worker initialized successfully
```

### Step 8: Test with Sample File

**In another terminal:**

```bash
# Upload a test file to S3 (triggers processing)
aws s3 cp test.pdf s3://your-bucket/test.pdf

# This should trigger:
# 1. S3 → EventBridge → SQS
# 2. Worker polls SQS
# 3. Downloads file
# 4. Processes file
# 5. Indexes to OpenSearch
```

**Watch the worker logs for:**
```
[INFO] Received 1 message(s)
[INFO] Processing: s3://your-bucket/test.pdf
[INFO] Downloading s3://your-bucket/test.pdf
[INFO] Starting file processing...
[INFO] Successfully processed PDF: test.pdf (5 pages, 2500 chars in 8.3s)
[INFO] Indexing to OpenSearch...
[INFO] Successfully indexed document
[INFO] Message processed and deleted from queue
```

## Install as Service (Production)

### Option 1: Quick Install Script

```bash
bash deployment/install.sh
```

This script will:
- Install all dependencies
- Configure systemd service
- Setup log rotation
- Enable service to start on boot

### Option 2: Manual Service Installation

```bash
# Copy service file
sudo cp deployment/file-processor.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable service
sudo systemctl enable file-processor

# Start service
sudo systemctl start file-processor

# Check status
sudo systemctl status file-processor
```

## Common Commands

```bash
# View live logs
sudo journalctl -u file-processor -f

# View recent logs
sudo journalctl -u file-processor --since "10 min ago"

# Restart service
sudo systemctl restart file-processor

# Stop service
sudo systemctl stop file-processor

# Check service status
sudo systemctl status file-processor
```

## Docker Quick Start

```bash
# Build image
docker build -t file-processor-worker .

# Create .env file with your settings
cp .env.example .env
nano .env

# Run with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## Troubleshooting

### Issue: "SQS_QUEUE_URL not configured"

**Fix:**
```bash
# Edit .env and add your SQS queue URL
nano .env
# Add: SQS_QUEUE_URL=https://sqs.region.amazonaws.com/account/queue-name
```

### Issue: "Tesseract not found"

**Fix:**
```bash
# Check if Tesseract is installed
which tesseract
tesseract --version

# If not found, install
sudo dnf install -y tesseract tesseract-langpack-jpn

# Set environment variable
echo 'export TESSDATA_PREFIX=/usr/share/tesseract' >> ~/.bashrc
source ~/.bashrc
```

### Issue: "Failed to connect to OpenSearch"

**Fix:**
```bash
# Check endpoint
curl -XGET https://your-opensearch-endpoint.es.amazonaws.com

# Verify IAM role has permissions
aws iam get-role --role-name YourEC2RoleName

# Check security group allows HTTPS (443) to OpenSearch
```

### Issue: "No messages received"

**Fix:**
```bash
# Check if SQS has messages
aws sqs get-queue-attributes \
  --queue-url $SQS_QUEUE_URL \
  --attribute-names ApproximateNumberOfMessages

# Verify EventBridge rule is configured
# Upload a test file to S3 to trigger event
aws s3 cp test.txt s3://your-bucket/test.txt
```

## Performance Tips

### For Fast Processing

```bash
# Edit .env
PDF_DPI=150              # Lower DPI = faster (default 300)
MAX_WORKERS=8           # More workers = more parallel processing
IMAGE_PREPROCESSING=false  # Disable preprocessing for speed
```

### For High Accuracy

```bash
# Edit .env
PDF_DPI=400             # Higher DPI = better accuracy
IMAGE_PREPROCESSING=true  # Enable image enhancement
MIN_OCR_CONFIDENCE=70.0  # Higher threshold
```

## Next Steps

1. **Scale Up**: Configure Auto Scaling Group for multiple workers
2. **Monitor**: Set up CloudWatch alarms and dashboards
3. **Optimize**: Tune parameters based on your file types
4. **Backup**: Configure S3 lifecycle and OpenSearch snapshots

## Getting Help

- Check logs: `sudo journalctl -u file-processor -f`
- Validate config: `python3.11 worker.py --validate-only`
- Test individual components
- Review `README_PRODUCTION.md` for detailed documentation

---

**Ready to process millions of files!** 🚀
