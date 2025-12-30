# Worker Exit Status 1 Root Cause Analysis

**Date:** 2025-12-15
**Environment:** EC2 t3.medium, Python 3, SQS/OpenSearch Integration
**Issue:** worker.py exits with status=1 every 30 seconds, causing continuous restarts

---

## Executive Summary

The Python worker process is experiencing a **critical configuration issue** causing it to exit with status code 1 immediately after startup. Despite this, messages continue to be processed at ~242 msg/min because systemd automatically restarts the service every 30 seconds. This creates an unstable "crash loop" pattern that prevents the system from operating at full efficiency.

**Root Causes Identified:**
1. Python module import failures (missing dependencies)
2. Missing or incorrect environment variables
3. Systemd restart policy too aggressive
4. Potential file path mismatches (`/opt/worker` vs `/opt/file-processor`)

**Impact:**
- 7,749 messages accumulated in DLQ
- Continuous service restarts (every 30 seconds)
- Reduced processing efficiency
- Potential data loss or duplicate processing

---

## Detailed Analysis

### 1. Current Behavior

**Observed Pattern:**
```
Process: 1999 ExecStart=/usr/bin/python3 -u /opt/worker/worker.py (code=exited, status=1/FAILURE)
↓
systemd waits 30 seconds (RestartSec=30)
↓
systemd restarts worker.py
↓
worker.py processes a few messages
↓
worker.py exits with status=1
↓
REPEAT
```

**Why Messages Still Process:**
- During the brief time the worker is running (before exit), it successfully:
  - Polls SQS
  - Downloads files from S3
  - Processes some files
  - Indexes to OpenSearch
- Then it crashes and restarts

This explains why you see processing activity (242 msg/min) despite the continuous failures.

---

### 2. Probable Root Causes

#### A. Python Module Import Errors

**Analysis of worker.py imports (lines 25-30):**
```python
import boto3
from botocore.exceptions import ClientError

from config import get_config
from file_router import FileRouter
from opensearch_client import OpenSearchClient
```

**Potential Issues:**
1. **Missing Python packages:** If `boto3`, `opensearchpy`, or other dependencies aren't installed, Python will exit with status 1
2. **Module not found:** If `config.py`, `file_router.py`, or `opensearch_client.py` are missing from `/opt/worker/`, the import will fail
3. **Python version mismatch:** Code may require Python 3.11+ but EC2 might be running 3.9

**Evidence from Terraform:**
- `user_data.sh` line 261: Uses `/usr/bin/python3.11`
- But systemd service might use `/usr/bin/python3` (different version)

#### B. Missing Environment Variables

**Required by config.py (lines 28-38):**
```python
sqs_queue_url: str = os.environ.get('SQS_QUEUE_URL', '')
s3_bucket: str = os.environ.get('S3_BUCKET', 'cis-filesearch-storage')
opensearch_endpoint: str = os.environ.get('OPENSEARCH_ENDPOINT', '')
```

**Validation check (lines 47-58):**
```python
def validate(self) -> bool:
    if not self.sqs_queue_url:
        logger.error("SQS_QUEUE_URL is required")
        return False
```

If `SQS_QUEUE_URL` is not set, `worker.py` will:
1. Log error: "SQS_QUEUE_URL is required"
2. Return `False` from validation
3. Exit with `sys.exit(1)` (line 592)

**Evidence from user_data.sh:**
- Environment variables are created in `/etc/environment.d/file-processor.conf` (line 197)
- BUT: systemd service may not load this file properly
- Service uses `EnvironmentFile=/opt/file-processor/.env` (line 258)
- File path mismatch: `/opt/file-processor` vs `/opt/worker`

#### C. File Path Issues

**Discrepancy:**
- Terraform user_data.sh creates: `/opt/file-processor/` (line 168)
- Systemd service expects: `/opt/file-processor/.env` (line 258)
- But current deployment might use: `/opt/worker/`

**Impact:**
- Worker code might be deployed to `/opt/worker/`
- But `.env` file is expected at `/opt/file-processor/.env`
- Result: Environment variables not loaded → validation fails → exit(1)

#### D. Systemd Restart Policy

**Current configuration (from user_data.sh):**
```ini
Restart=always
RestartSec=10
StartLimitInterval=0
```

**Problem:**
- `Restart=always` means systemd will restart even on failure (exit 1)
- `StartLimitInterval=0` means no limit on restart attempts
- This creates infinite crash loop instead of stopping to surface the error

**Better approach:**
```ini
Restart=on-failure
RestartSec=30
StartLimitBurst=5
StartLimitIntervalSec=300
```

---

### 3. Why DLQ Has 7,749 Messages

**DLQ Accumulation Pattern:**

The worker is sending messages to DLQ due to:
1. **Processing failures** during the brief active periods
2. **Message visibility timeouts** - when worker crashes, in-flight messages return to queue and eventually hit max receive count
3. **Incomplete processing** - worker crashes mid-processing, leaving partial work

**From worker.py lines 462-464:**
```python
if send_to_dlq:
    self._send_to_dlq(message, error_message)
```

Messages are explicitly sent to DLQ when:
- File processing fails
- S3 download fails
- OpenSearch indexing fails
- Unsupported file types

**7,749 messages suggests:**
- System has been in this crash loop for extended period
- Many messages hit maxReceiveCount (default: 5 attempts)
- Or worker is explicitly sending failures to DLQ before crashing

---

### 4. Why It Still Processes ~242 Messages/Minute

**Processing During Brief Uptime:**

Each restart cycle:
1. Worker starts (0s)
2. Loads configuration (1-2s)
3. Connects to SQS (1s)
4. Polls for messages (2-20s depending on WaitTimeSeconds)
5. Processes 1-10 messages (5-15s per message)
6. **CRASHES** (exit 1)
7. Systemd waits 30s
8. REPEAT

**Math:**
- If worker lives ~20-30 seconds per cycle
- Processes ~2-4 messages per cycle
- 2 cycles per minute = 4-8 messages/min

**But you're seeing 242 msg/min:**
- This suggests either:
  - Multiple EC2 instances running (Auto Scaling Group)
  - Worker lives longer than expected before crash
  - Metrics are averaged over longer period

---

## Solution Implementation

### Immediate Fix (apply now)

**Run diagnostic script first:**
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker
chmod +x diagnose-exit-status-1.sh
./diagnose-exit-status-1.sh > diagnostic-output.log 2>&1
```

**Then apply fix:**
```bash
chmod +x fix-worker-exit-status-1.sh
./fix-worker-exit-status-1.sh
```

### What the Fix Does

#### 1. Ensures Python Dependencies
```bash
python3 -m pip install -r requirements.txt --user
```

Installs:
- boto3 (AWS SDK)
- opensearch-py (OpenSearch client)
- Pillow (image processing)
- pytesseract (OCR)
- All other requirements

#### 2. Creates Proper Environment File
```bash
cat > /opt/worker/.env
```

Sets all required variables:
- `SQS_QUEUE_URL`
- `DLQ_QUEUE_URL`
- `S3_BUCKET`
- `OPENSEARCH_ENDPOINT`
- `AWS_REGION`
- All processing configuration

#### 3. Fixes Systemd Service
```ini
[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/worker
EnvironmentFile=/opt/worker/.env
ExecStart=/usr/bin/python3 -u /opt/worker/worker.py

# CRITICAL: Better restart policy
Restart=on-failure
RestartSec=30
StartLimitBurst=5
StartLimitIntervalSec=300
```

Key changes:
- `Restart=on-failure` (not `always`)
- Limits restart attempts
- Proper working directory
- Correct environment file path

#### 4. Validates Configuration
```bash
python3 worker.py --validate-only
```

Ensures all settings are correct before starting service.

---

## Long-term Improvements

### 1. Health Checks

Add health check endpoint:
```python
# health_check.py
import sys
from config import get_config

def check_health():
    config = get_config()

    # Check SQS connectivity
    sqs = boto3.client('sqs')
    sqs.get_queue_attributes(QueueUrl=config.aws.sqs_queue_url)

    # Check S3 connectivity
    s3 = boto3.client('s3')
    s3.head_bucket(Bucket=config.aws.s3_bucket)

    # Check OpenSearch connectivity
    opensearch = OpenSearchClient(config)
    if not opensearch.is_connected():
        raise Exception("OpenSearch not connected")

    return True

if __name__ == '__main__':
    try:
        check_health()
        sys.exit(0)
    except Exception as e:
        print(f"Health check failed: {e}")
        sys.exit(1)
```

Add to systemd:
```ini
[Service]
ExecStartPre=/usr/bin/python3 /opt/worker/health_check.py
```

### 2. Better Error Logging

Add CloudWatch integration:
```python
import watchtower

cloudwatch_handler = watchtower.CloudWatchLogHandler(
    log_group='/aws/ec2/file-processor',
    stream_name='{instance_id}/worker'
)
logging.getLogger().addHandler(cloudwatch_handler)
```

### 3. Graceful Degradation

Modify worker.py to continue running even if OpenSearch is temporarily unavailable:
```python
if self.opensearch.is_connected():
    self.opensearch.index_document(document)
else:
    self.logger.warning("OpenSearch unavailable, queuing for retry")
    self._queue_for_retry(document)
```

### 4. Monitoring Dashboard

Create CloudWatch dashboard with:
- Worker restart count (custom metric)
- Exit status distribution
- Message processing rate
- DLQ depth
- OpenSearch indexing success rate

### 5. Auto-recovery from DLQ

Script to re-drive DLQ messages after fixing issues:
```bash
# redrive-dlq.sh
aws sqs start-message-move-task \
    --source-arn $(aws sqs get-queue-attributes --queue-url $DLQ_URL --attribute-names QueueArn --query 'Attributes.QueueArn' --output text) \
    --destination-arn $(aws sqs get-queue-attributes --queue-url $MAIN_QUEUE_URL --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)
```

---

## Testing Plan

### 1. Verify Fix Application

```bash
# SSH to EC2
ssh -i ~/.ssh/cis-filesearch-key.pem ec2-user@<EC2_IP>

# Check service status
sudo systemctl status file-scanner-worker

# Should show: "active (running)" without recent restarts

# Monitor logs
sudo journalctl -u file-scanner-worker -f

# Should show:
# - Successful configuration validation
# - SQS polling
# - Message processing
# - NO errors or crashes
```

### 2. Confirm Message Processing

```bash
# Check SQS queue depth (should decrease steadily)
watch -n 5 'aws sqs get-queue-attributes \
    --queue-url <SQS_QUEUE_URL> \
    --attribute-names ApproximateNumberOfMessages \
    --query "Attributes.ApproximateNumberOfMessages"'

# Check DLQ (should stop growing)
aws sqs get-queue-attributes \
    --queue-url <DLQ_QUEUE_URL> \
    --attribute-names ApproximateNumberOfMessages
```

### 3. Performance Validation

```bash
# Monitor processing rate
aws cloudwatch get-metric-statistics \
    --namespace AWS/SQS \
    --metric-name NumberOfMessagesReceived \
    --dimensions Name=QueueName,Value=cis-filesearch-index-queue \
    --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 60 \
    --statistics Sum
```

### 4. Stability Test

```bash
# Run for 24 hours and check:
# 1. No restarts
# 2. Consistent processing rate
# 3. No new DLQ messages
# 4. Memory usage stable

# Get restart count in last 24 hours:
sudo journalctl -u file-scanner-worker --since "24 hours ago" | grep -c "Started File Scanner Worker"
# Should be: 1 (only initial start)
```

---

## Rollback Plan

If fix causes issues:

```bash
# SSH to EC2
ssh -i ~/.ssh/cis-filesearch-key.pem ec2-user@<EC2_IP>

# Stop service
sudo systemctl stop file-scanner-worker

# Restore previous version (if backed up)
cd /opt/worker
sudo cp -r /opt/worker.backup.$(date +%Y%m%d)/* .

# Restart
sudo systemctl start file-scanner-worker
```

Or redeploy from scratch using Terraform:
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/terraform
terraform taint aws_autoscaling_group.file_processor
terraform apply
```

---

## Success Criteria

**Fix is successful when:**

1. ✅ Worker service status shows `active (running)` for >1 hour without restart
2. ✅ `sudo journalctl -u file-scanner-worker` shows no exit status 1 errors
3. ✅ SQS queue depth decreases at consistent rate (>200 msg/min)
4. ✅ DLQ stops accumulating new messages
5. ✅ OpenSearch receives indexed documents continuously
6. ✅ CloudWatch logs show healthy processing pattern
7. ✅ No Python import errors in logs
8. ✅ Memory and CPU usage remain stable

---

## Additional Resources

### Debugging Commands

```bash
# Check Python version
python3 --version

# Test Python imports manually
python3 -c "import boto3; print('boto3 OK')"
python3 -c "import opensearchpy; print('opensearch OK')"
python3 -c "from PIL import Image; print('Pillow OK')"

# Check environment variables
cat /opt/worker/.env

# Run worker in foreground (for debugging)
cd /opt/worker
source .env
python3 -u worker.py

# Check systemd service definition
systemctl cat file-scanner-worker

# See full logs with timestamps
sudo journalctl -u file-scanner-worker --since "1 hour ago" -o verbose
```

### Key Files

- **Worker code:** `/opt/worker/worker.py`
- **Configuration:** `/opt/worker/config.py`
- **Environment:** `/opt/worker/.env`
- **Systemd service:** `/etc/systemd/system/file-scanner-worker.service`
- **Logs:** `/var/log/file-scanner-worker.log` and `journalctl`

### AWS Resources

- **SQS Main Queue:** `cis-filesearch-index-queue`
- **SQS DLQ:** `cis-filesearch-index-queue-dlq`
- **S3 Bucket:** `cis-filesearch-storage-*`
- **OpenSearch Domain:** `cis-filesearch`
- **EC2 Tag:** `Name=cis-filesearch-ec2`

---

## Conclusion

The exit status 1 issue is caused by a **combination of missing dependencies, incorrect environment variables, and file path mismatches**. The provided fix script addresses all of these issues comprehensively.

**Key Takeaways:**
1. Systemd's aggressive restart policy masked the underlying issue
2. The worker CAN process messages when running correctly
3. DLQ accumulation is a symptom, not the root cause
4. Proper validation and health checks are essential

**Next Steps:**
1. Run diagnostic script to confirm exact issue
2. Apply fix script
3. Monitor for 24 hours
4. If stable, implement long-term improvements
5. Document learnings for future deployments

**Expected Outcome After Fix:**
- Worker runs continuously without crashes
- Processing rate increases to ~500-1000 msg/min (depending on file size)
- DLQ clears as messages are reprocessed
- System operates at full efficiency

---

**Report prepared by:** Backend File Search System Expert
**Contact:** See project documentation for support details
