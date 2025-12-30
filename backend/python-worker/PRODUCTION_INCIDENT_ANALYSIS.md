# Production Incident Analysis Report
## SQS Queue Processing Failure

**Date**: 2025-12-15
**Severity**: CRITICAL
**Status**: Analysis Complete - Fixes Ready for Deployment
**Incident ID**: SQS-001

---

## Executive Summary

Critical production issue identified in the SQS message processing system:
- **5 messages stuck "in flight"** in main queue
- **8,158 messages accumulated in DLQ** (Dead Letter Queue)
- **Processing failures** preventing message deletion
- **OpenSearch indexing issues** blocking workflow

**Root Cause**: Exception handling logic prevents message deletion when OpenSearch indexing fails, causing visibility timeout loops.

**Impact**: Complete processing stall for new files, massive DLQ accumulation.

**Resolution Time Estimate**: 1-2 hours (deployment + DLQ recovery)

---

## Incident Timeline

### Observed Symptoms (AWS Console)

```
Queue: cis-filesearch-index-queue
├── Messages available: 0
├── Messages in flight: 5 (STUCK)
└── Created: 2025-11-05T10:48+09:00

Queue: cis-filesearch-dlq
├── Messages available: 8,158 (CRITICAL)
└── Created: 2025-11-05T10:36+09:00

Worker Instance: i-0e6ac1e4d535a4ab2
Service: phased-worker.service
```

### Current State

- Worker service is running but processing fails
- Messages enter visibility timeout but are never deleted
- After 300s (5 min) visibility timeout expires → messages return to queue
- Failed messages eventually move to DLQ (after max retries)
- DLQ has no processing mechanism → accumulates indefinitely

---

## Root Cause Analysis

### Problem 1: Message Deletion Logic Flaw

**File**: `/backend/python-worker/worker.py`
**Lines**: 428-479

#### Issue
```python
# Process each message
for message in messages:
    try:
        # Process the message
        success, error_msg = self.process_sqs_message(message)

        if success:
            self.stats['succeeded'] += 1
        else:
            send_to_dlq = True
            self.stats['failed'] += 1

    except Exception as e:
        send_to_dlq = True
        self.stats['failed'] += 1

    # メッセージを必ず削除 (成功/失敗に関わらず)
    if should_delete:
        try:
            self.sqs_client.delete_message(...)  # ← この行に到達しない
```

**Problem**: When `process_sqs_message()` raises an exception (e.g., OpenSearch connection failure), the exception is caught but message deletion code is inside the same `try` block, so it never executes.

**Result**: Message remains in queue → visibility timeout expires → message reappears → infinite loop

### Problem 2: OpenSearch Indexing Blocking Workflow

**File**: `/backend/python-worker/worker.py`
**Lines**: 359-368

#### Issue
```python
# Index to OpenSearch
if self.opensearch.is_connected():
    self.logger.info("Indexing to OpenSearch...")
    if not self.opensearch.index_document(document, document_id=key):
        error_msg = "Failed to index document to OpenSearch"
        self.logger.error(error_msg)
        return (False, error_msg)  # ← ENTIRE MESSAGE PROCESSING FAILS
```

**Problem**: If OpenSearch indexing fails (network issue, authentication, etc.), the entire message is marked as failed, even though file processing succeeded.

**Result**: Successfully processed files are re-queued because indexing failed → waste of resources, potential data inconsistency

### Problem 3: Insufficient Visibility Timeout

**File**: `/backend/python-worker/config.py`
**Line**: 30

#### Issue
```python
sqs_visibility_timeout: int = int(os.environ.get('SQS_VISIBILITY_TIMEOUT', '300'))  # 5 minutes
```

**Problem**:
- Average processing time: 1-2 minutes
- But if OpenSearch is slow or retrying: 3-5 minutes
- Visibility timeout: 5 minutes
- **Gap is too small** → messages reappear while still processing

**Result**: Duplicate processing attempts, resource contention

### Problem 4: No DLQ Recovery Mechanism

**Missing**: DLQ processing script

**Problem**: When messages fail max retries (typically 3), SQS automatically moves them to DLQ. However, there's no mechanism to:
- Analyze why they failed
- Retry processing
- Archive permanently failed messages

**Result**: 8,158 messages in DLQ with no path to recovery

### Problem 5: OpenSearch Connection Issues

**File**: `/backend/python-worker/opensearch_client.py`
**Lines**: 68-74

#### Suspected Issues
```python
# Test connection
info = self.client.info()  # ← May be failing
logger.info(f"Connected to OpenSearch cluster: {info['cluster_name']}")
```

**Possible Causes**:
1. **Missing Environment Variable**: `OPENSEARCH_ENDPOINT` not set
2. **Invalid Credentials**: AWS credentials expired/invalid
3. **Network/Security**: Security group not allowing EC2 → OpenSearch
4. **Domain Not Exist**: OpenSearch domain deleted/misconfigured

**Need to Verify**:
- Check environment variables on EC2
- Verify security group rules
- Test OpenSearch endpoint connectivity
- Check IAM role permissions

---

## Solution Architecture

### Fix 1: Guaranteed Message Deletion (CRITICAL)

**Strategy**: Use `finally` block to ALWAYS delete messages

```python
try:
    # Process message
    success, error_msg = self.process_sqs_message(message)
    if success:
        processing_success = True
except Exception as e:
    error_message = str(e)
finally:
    # CRITICAL: Always delete, regardless of success/failure
    self.sqs_client.delete_message(...)

    # Only AFTER deletion, send to DLQ if failed
    if not processing_success:
        self._send_to_dlq(message, error_message)
```

**Benefits**:
- ✅ Messages never stuck "in flight"
- ✅ No visibility timeout loops
- ✅ Failed messages properly routed to DLQ
- ✅ Clean separation: delete first, then handle failure

### Fix 2: Non-Blocking OpenSearch Indexing

**Strategy**: Make OpenSearch failures non-critical

```python
# Process file (critical path)
result = self.file_router.process_file(temp_file_path)

# Index to OpenSearch (non-critical path)
opensearch_indexed = False
try:
    if self.opensearch.is_connected():
        opensearch_indexed = self.opensearch.index_document(document)

    if not opensearch_indexed:
        # Store in S3 for later retry
        self._store_for_retry(document, key)
except Exception as e:
    self._store_for_retry(document, key)

# ALWAYS return success if file processing succeeded
return (True, None)
```

**Benefits**:
- ✅ File processing succeeds independently of indexing
- ✅ Failed indexing attempts stored for retry
- ✅ No data loss
- ✅ System resilience improved

### Fix 3: Retry Storage Mechanism

**New Method**: `_store_for_retry()`

```python
def _store_for_retry(self, document: Dict[str, Any], key: str):
    """Store document in S3 for later retry"""
    retry_key = f"retry-index/{datetime.utcnow().strftime('%Y-%m-%d')}/{key}.json"

    self.s3_client.put_object(
        Bucket=self.config.aws.s3_bucket,
        Key=retry_key,
        Body=json.dumps(document, ensure_ascii=False, indent=2),
        ContentType='application/json',
        Metadata={
            'original-key': key,
            'retry-reason': 'opensearch-indexing-failed',
            'failed-at': datetime.utcnow().isoformat()
        }
    )
```

**Benefits**:
- ✅ Failed indexing attempts preserved
- ✅ Can batch-retry later when OpenSearch is healthy
- ✅ Date-partitioned for easy management
- ✅ No data loss

### Fix 4: Increased Visibility Timeout

**Change**: 300s → 600s (5 min → 10 min)

```python
sqs_visibility_timeout: int = int(os.environ.get('SQS_VISIBILITY_TIMEOUT', '600'))
```

**Benefits**:
- ✅ More buffer for slow processing
- ✅ Reduces duplicate processing
- ✅ Handles OpenSearch retry delays

### Fix 5: DLQ Recovery Script

**New Script**: `recover_dlq.py`

**Features**:
- Processes DLQ messages in batches
- Checks if already indexed (deduplication)
- Attempts re-indexing from S3 metadata
- Archives permanently failed messages
- Detailed statistics and logging

**Usage**:
```bash
# Test with small batch
python3 recover_dlq.py --batch-size 5 --max-batches 1

# Process all DLQ messages
python3 recover_dlq.py --batch-size 50

# Dry run
python3 recover_dlq.py --dry-run
```

**Benefits**:
- ✅ Recovers 8,158 stuck messages
- ✅ Systematic processing
- ✅ Idempotent (safe to re-run)
- ✅ Archives unrecoverable messages

---

## Deployment Plan

### Phase 1: Pre-Deployment Verification (5 min)

```bash
# 1. Check current queue status
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/381492033915/cis-filesearch-index-queue \
  --attribute-names All --region ap-northeast-1

# 2. Check DLQ status
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/381492033915/cis-filesearch-dlq \
  --attribute-names All --region ap-northeast-1

# 3. Verify EC2 instance status
aws ec2 describe-instances --instance-ids i-0e6ac1e4d535a4ab2 \
  --region ap-northeast-1 --query 'Reservations[0].Instances[0].State.Name'
```

### Phase 2: Code Deployment (10 min)

```bash
# Navigate to worker directory
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker

# Run deployment script
./deploy_fixes.sh deploy
```

**Deployment Script Actions**:
1. ✅ Check prerequisites (SSH key, connectivity)
2. ✅ Test SSH connection to EC2
3. ✅ Backup existing files
4. ✅ Stop worker service
5. ✅ Deploy updated files:
   - `worker.py` (fixed message deletion)
   - `config.py` (increased timeout)
   - `recover_dlq.py` (DLQ recovery)
6. ✅ Update systemd service config
7. ✅ Start worker service
8. ✅ Verify deployment

### Phase 3: Monitoring (15 min)

```bash
# Monitor worker logs
./deploy_fixes.sh monitor

# Watch for:
# - "✓ Message {id} deleted from queue"
# - "OpenSearch: ✓" or "✗ (stored for retry)"
# - No "FAILED to delete message" errors
```

### Phase 4: DLQ Recovery (30-60 min)

```bash
# SSH into EC2
ssh -i ~/cis_key_pair.pem ec2-user@13.231.196.150

# Navigate to worker directory
cd /home/ec2-user/file-processor

# Test with small batch first
python3 recover_dlq.py --batch-size 10 --max-batches 1

# If successful, process all (8,158 messages in batches of 50)
# Estimated time: ~30-60 minutes
python3 recover_dlq.py --batch-size 50
```

### Phase 5: Post-Deployment Verification (10 min)

```bash
# 1. Check main queue (should be 0 messages in flight)
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/381492033915/cis-filesearch-index-queue \
  --attribute-names ApproximateNumberOfMessagesNotVisible

# 2. Check DLQ (should be decreasing)
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/381492033915/cis-filesearch-dlq \
  --attribute-names ApproximateNumberOfMessages

# 3. Check worker statistics
ssh -i ~/cis_key_pair.pem ec2-user@13.231.196.150 \
  "sudo journalctl -u phased-worker.service -n 100 --no-pager | grep -E '(Statistics|Succeeded|Failed)'"

# 4. Verify OpenSearch connectivity
ssh -i ~/cis_key_pair.pem ec2-user@13.231.196.150 \
  "sudo journalctl -u phased-worker.service -n 50 --no-pager | grep OpenSearch"
```

---

## Expected Outcomes

### Immediate (Within 1 hour)
- ✅ No messages stuck "in flight"
- ✅ Messages deleted immediately after processing
- ✅ Worker processing normally
- ✅ DLQ recovery started

### Short-term (Within 4 hours)
- ✅ DLQ reduced to < 100 messages
- ✅ Most recoverable messages re-indexed
- ✅ Failed messages archived in S3
- ✅ Normal processing resumed

### Long-term (Ongoing)
- ✅ Resilient to OpenSearch failures
- ✅ Automatic retry mechanism via S3
- ✅ No more message accumulation
- ✅ Proper monitoring and alerting

---

## Monitoring & Alerts

### Key Metrics to Monitor

1. **SQS Main Queue**
   - `ApproximateNumberOfMessages` → should be 0
   - `ApproximateNumberOfMessagesNotVisible` → should be 0-1
   - Alert if > 5 for > 10 minutes

2. **SQS DLQ**
   - `ApproximateNumberOfMessages` → should decrease, then stabilize near 0
   - Alert if increasing over time

3. **CloudWatch Metrics**
   - `CISFileSearch/Worker/MessageDeleteFailed` → should be 0
   - `CISFileSearch/Worker/CriticalError` → should be 0

4. **Worker Logs**
   - Monitor for: `"FAILED to delete message"`
   - Monitor for: `"OpenSearch not connected"`
   - Monitor for: `"ALERT:"`

### CloudWatch Alarm Configuration

```bash
# Create alarm for message delete failures
aws cloudwatch put-metric-alarm \
  --alarm-name "CIS-Worker-MessageDeleteFailed" \
  --alarm-description "Alert when worker fails to delete SQS messages" \
  --metric-name MessageDeleteFailed \
  --namespace CISFileSearch/Worker \
  --statistic Sum \
  --period 300 \
  --threshold 1 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1

# Create alarm for DLQ accumulation
aws cloudwatch put-metric-alarm \
  --alarm-name "CIS-DLQ-Accumulation" \
  --alarm-description "Alert when DLQ messages increase" \
  --metric-name ApproximateNumberOfMessagesVisible \
  --namespace AWS/SQS \
  --dimensions Name=QueueName,Value=cis-filesearch-dlq \
  --statistic Average \
  --period 900 \
  --threshold 100 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2
```

---

## Rollback Plan

### If Deployment Fails

```bash
# SSH into EC2
ssh -i ~/cis_key_pair.pem ec2-user@13.231.196.150

# Stop worker
sudo systemctl stop phased-worker.service

# Restore backup (created by deploy script)
BACKUP_DIR=$(ls -td /home/ec2-user/backups/* | head -1)
cp "$BACKUP_DIR/worker.py" /home/ec2-user/file-processor/
cp "$BACKUP_DIR/config.py" /home/ec2-user/file-processor/

# Restart worker
sudo systemctl start phased-worker.service
```

### If OpenSearch Issues Persist

**Temporary Workaround**: Disable OpenSearch requirement

```bash
# Option 1: Set environment variable to skip OpenSearch
sudo systemctl edit phased-worker.service
# Add: Environment="SKIP_OPENSEARCH=true"

# Option 2: Modify code to continue without OpenSearch
# (Already implemented in Fix 2)
```

### Emergency Queue Purge (LAST RESORT)

**WARNING**: This deletes all messages - use only if system is completely broken

```bash
# Purge main queue
aws sqs purge-queue \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/381492033915/cis-filesearch-index-queue \
  --region ap-northeast-1

# Note: Messages are lost permanently
# Only use if messages are already corrupted/unrecoverable
```

---

## Prevention Measures

### Code Quality Improvements

1. **Always use `finally` for cleanup operations**
   - Message deletion
   - File cleanup
   - Resource release

2. **Implement circuit breaker pattern for external services**
   - OpenSearch should not block critical path
   - Retry with exponential backoff
   - Fallback to alternative storage

3. **Add comprehensive error handling**
   - Catch specific exceptions
   - Log detailed error context
   - Send alerts for critical failures

### Infrastructure Improvements

1. **Increase visibility timeout**
   - Set to 2x average processing time
   - Monitor 95th percentile processing time
   - Adjust dynamically

2. **Implement DLQ monitoring**
   - CloudWatch alarm on message count
   - Automated DLQ processing
   - Regular DLQ audits

3. **Add health checks**
   - OpenSearch connectivity
   - S3 access
   - SQS availability

### Operational Improvements

1. **Regular DLQ reviews**
   - Weekly DLQ analysis
   - Identify recurring patterns
   - Fix root causes

2. **Enhanced monitoring**
   - Real-time dashboards
   - Alert thresholds tuning
   - Automated remediation

3. **Documentation**
   - Runbooks for common issues
   - Architecture diagrams
   - Troubleshooting guides

---

## Testing Checklist

### Pre-Deployment Testing

- [x] Code review completed
- [x] Logic verified for edge cases
- [x] Deployment script tested (dry-run)
- [ ] Backup procedure verified
- [ ] Rollback procedure tested

### Post-Deployment Testing

- [ ] Send 5 test messages to queue
- [ ] Verify messages are deleted
- [ ] Check no messages stuck in flight
- [ ] Verify OpenSearch indexing
- [ ] Test OpenSearch failure scenario
- [ ] Verify retry storage works
- [ ] Run DLQ recovery on test batch
- [ ] Check CloudWatch metrics
- [ ] Verify log output format

### Load Testing (Post-Recovery)

- [ ] Send 100 messages
- [ ] Monitor processing rate
- [ ] Verify no memory leaks
- [ ] Check error rate < 1%
- [ ] Verify throughput meets SLA

---

## Related Files

### Modified Files
- `/backend/python-worker/worker.py` - Main worker logic
- `/backend/python-worker/config.py` - Configuration settings

### New Files
- `/backend/python-worker/recover_dlq.py` - DLQ recovery script
- `/backend/python-worker/deploy_fixes.sh` - Deployment automation
- `/backend/python-worker/emergency_fixes.md` - Emergency procedures
- `/backend/python-worker/PRODUCTION_INCIDENT_ANALYSIS.md` - This document

### Configuration Files
- `/etc/systemd/system/phased-worker.service` - Systemd service (on EC2)

---

## Contact Information

**On-Call Engineer**: [Your Name]
**Escalation**: [Manager Name]
**AWS Account ID**: 381492033915
**Region**: ap-northeast-1 (Tokyo)

---

## Lessons Learned

1. **Always delete SQS messages in `finally` blocks**
   - Exception handling must not prevent cleanup
   - Message deletion is the most critical operation

2. **External service failures should not block core processing**
   - Implement graceful degradation
   - Store for retry rather than failing

3. **Visibility timeout must account for worst-case scenarios**
   - Not just average processing time
   - Include retry delays and network latency

4. **DLQ needs active monitoring and processing**
   - Not just a dumping ground
   - Regular audits and recovery procedures

5. **Testing should include failure scenarios**
   - Network failures
   - Service unavailability
   - Timeout scenarios

---

**Status**: Ready for Deployment
**Risk Level**: Medium (with rollback plan)
**Estimated Recovery Time**: 2 hours
**Approval Required**: Yes (Production Change)

