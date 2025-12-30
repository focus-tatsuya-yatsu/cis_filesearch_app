# Quick Start: Production Recovery Guide

## Immediate Actions (5 Minutes)

### 1. Deploy Critical Fixes

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker

# Set your SSH key path
export SSH_KEY=~/path/to/cis_key_pair.pem

# Deploy fixes
./deploy_fixes.sh deploy
```

**What this does**:
- Backs up existing files
- Deploys fixed `worker.py` with guaranteed message deletion
- Updates visibility timeout to 10 minutes
- Restarts worker service
- Verifies deployment

### 2. Monitor Worker

```bash
# Watch logs in real-time
./deploy_fixes.sh monitor

# Look for:
# ✓ "✓ Message {id} deleted from queue" (good)
# ✗ "❌ FAILED to delete message" (bad - alert immediately)
```

### 3. Verify Queue Status

```bash
# Check if messages are no longer stuck
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/381492033915/cis-filesearch-index-queue \
  --attribute-names ApproximateNumberOfMessagesNotVisible \
  --region ap-northeast-1

# Should return: "ApproximateNumberOfMessagesNotVisible": "0" or "1"
```

---

## DLQ Recovery (30-60 Minutes)

### Test First (5 Minutes)

```bash
# SSH into EC2
ssh -i ~/path/to/cis_key_pair.pem ec2-user@13.231.196.150

# Navigate to worker directory
cd /home/ec2-user/file-processor

# Test with 5 messages
python3 recover_dlq.py --batch-size 5 --max-batches 1
```

**Expected Output**:
```
=== DLQ Recovery Started ===
Batch size: 5
OpenSearch: Connected
----------------------------

[1] Processing: test/file1.pdf
  ✓ Successfully re-indexed

[2] Processing: test/file2.docx
  ✓ Already indexed - removing from DLQ

...

=== DLQ Recovery Statistics ===
Total Processed:     5
Successfully Recovered:  3
Already Indexed:     2
Archived:            0
Failed:              0
Success Rate:        100.0%
```

### Process All DLQ Messages (30-60 Minutes)

```bash
# Process all 8,158 messages in batches of 50
python3 recover_dlq.py --batch-size 50

# Monitor progress (separate terminal)
watch -n 10 'aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/381492033915/cis-filesearch-dlq \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-northeast-1 \
  --output text | grep ApproximateNumberOfMessages'
```

---

## Verification Checklist

After deployment and DLQ recovery:

- [ ] **Main Queue**: No messages stuck in flight
  ```bash
  aws sqs get-queue-attributes \
    --queue-url https://sqs.ap-northeast-1.amazonaws.com/381492033915/cis-filesearch-index-queue \
    --attribute-names ApproximateNumberOfMessagesNotVisible \
    --region ap-northeast-1
  # Should show: 0
  ```

- [ ] **DLQ**: Message count decreasing
  ```bash
  aws sqs get-queue-attributes \
    --queue-url https://sqs.ap-northeast-1.amazonaws.com/381492033915/cis-filesearch-dlq \
    --attribute-names ApproximateNumberOfMessages \
    --region ap-northeast-1
  # Should show: decreasing number
  ```

- [ ] **Worker Logs**: No critical errors
  ```bash
  ssh -i ~/key.pem ec2-user@13.231.196.150 \
    "sudo journalctl -u phased-worker.service -n 50 | grep -i error"
  # Should show: no critical errors
  ```

- [ ] **Test Message**: End-to-end test
  ```bash
  # Send test message to queue
  aws sqs send-message \
    --queue-url https://sqs.ap-northeast-1.amazonaws.com/381492033915/cis-filesearch-index-queue \
    --message-body '{"bucket":"cis-filesearch-storage","key":"test/sample.pdf"}' \
    --region ap-northeast-1

  # Watch logs for processing
  ssh -i ~/key.pem ec2-user@13.231.196.150 \
    "sudo journalctl -u phased-worker.service -f | grep sample.pdf"
  ```

---

## Troubleshooting

### Issue: Deployment Script Can't Connect to EC2

```bash
# Check EC2 instance is running
aws ec2 describe-instances --instance-ids i-0e6ac1e4d535a4ab2 \
  --region ap-northeast-1 --query 'Reservations[0].Instances[0].State.Name'

# Verify security group allows your IP
# Go to AWS Console → EC2 → Security Groups
# Add your IP to SSH (port 22) inbound rules
```

### Issue: Worker Not Starting

```bash
# Check service logs
ssh -i ~/key.pem ec2-user@13.231.196.150 \
  "sudo journalctl -u phased-worker.service -n 100 --no-pager"

# Common issues:
# 1. Missing environment variables
# 2. Python dependencies not installed
# 3. File permissions

# Verify Python dependencies
ssh -i ~/key.pem ec2-user@13.231.196.150 \
  "python3 -c 'import boto3, opensearchpy; print(\"OK\")'"
```

### Issue: OpenSearch Connection Failed

```bash
# Check OpenSearch endpoint
ssh -i ~/key.pem ec2-user@13.231.196.150 \
  "env | grep OPENSEARCH"

# Should show:
# OPENSEARCH_ENDPOINT=https://search-xxx.ap-northeast-1.es.amazonaws.com

# Test connectivity
ssh -i ~/key.pem ec2-user@13.231.196.150 \
  "curl -I https://your-opensearch-endpoint.ap-northeast-1.es.amazonaws.com"

# If fails:
# 1. Check security group allows EC2 → OpenSearch
# 2. Verify IAM role has OpenSearch permissions
# 3. Check OpenSearch domain exists and is active
```

### Issue: DLQ Recovery Script Errors

```bash
# Run with verbose logging
python3 recover_dlq.py --verbose --batch-size 5 --max-batches 1

# Common issues:
# 1. OpenSearch not connected → documents won't be indexed (but will be archived)
# 2. S3 permissions → check IAM role
# 3. Files don't exist in S3 → normal, will be archived
```

---

## Emergency Rollback

If something goes wrong:

```bash
# SSH into EC2
ssh -i ~/key.pem ec2-user@13.231.196.150

# Stop worker
sudo systemctl stop phased-worker.service

# Restore backup
BACKUP_DIR=$(ls -td /home/ec2-user/backups/* | head -1)
echo "Restoring from: $BACKUP_DIR"
cp "$BACKUP_DIR/worker.py" /home/ec2-user/file-processor/
cp "$BACKUP_DIR/config.py" /home/ec2-user/file-processor/

# Restart worker
sudo systemctl start phased-worker.service
sudo systemctl status phased-worker.service
```

---

## Success Criteria

**System is recovered when**:

1. ✅ Main queue: 0 messages in flight
2. ✅ DLQ: < 100 messages remaining
3. ✅ Worker logs: No "FAILED to delete message" errors
4. ✅ Test message: Processes successfully
5. ✅ OpenSearch: Documents being indexed (or stored for retry)

---

## Next Steps After Recovery

1. **Set up monitoring alerts**
   - CloudWatch alarm for message delete failures
   - DLQ message count threshold
   - Worker service health checks

2. **Schedule DLQ review**
   - Weekly review of DLQ
   - Analyze failure patterns
   - Fix recurring issues

3. **Implement batch retry for stored documents**
   - Process `retry-index/` S3 prefix
   - Re-attempt OpenSearch indexing
   - Archive truly failed documents

4. **Document operational procedures**
   - Runbooks for common issues
   - On-call playbooks
   - Escalation procedures

---

## Support

**Files Created**:
- `PRODUCTION_INCIDENT_ANALYSIS.md` - Detailed analysis
- `emergency_fixes.md` - Technical details
- `deploy_fixes.sh` - Deployment automation
- `recover_dlq.py` - DLQ recovery script
- `QUICKSTART_RECOVERY.md` - This guide

**AWS Resources**:
- Main Queue: `cis-filesearch-index-queue`
- DLQ: `cis-filesearch-dlq`
- EC2 Instance: `i-0e6ac1e4d535a4ab2`
- Region: `ap-northeast-1`

**Time Estimate**:
- Deployment: 5-10 minutes
- DLQ Recovery: 30-60 minutes
- Verification: 10 minutes
- **Total: ~1-2 hours**

---

**Ready to proceed?** Start with: `./deploy_fixes.sh deploy`
