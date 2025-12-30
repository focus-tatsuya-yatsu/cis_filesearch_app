# Worker Deployment Verification Guide

This guide provides comprehensive steps to verify that the new worker instance is processing files correctly.

## Quick Start

```bash
# Make scripts executable
chmod +x verify-deployment.sh check-opensearch.sh ssm-connect.sh analyze-logs.py

# Run comprehensive verification
./verify-deployment.sh

# Analyze CloudWatch logs
python3 analyze-logs.py --minutes 30 --file-types --opensearch

# Interactive SSM session
./ssm-connect.sh
```

## Instance Details

- **Instance ID**: `i-0e6ac1e4d535a4ab2`
- **Launch Template**: v19
- **Queue URL**: `https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue`
- **OpenSearch Endpoint**: `https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com`
- **Index Name**: `file-metadata`

## Verification Checklist

### 1. Instance Status ✓

```bash
# Check instance is running
aws ec2 describe-instances \
  --instance-ids i-0e6ac1e4d535a4ab2 \
  --query 'Reservations[0].Instances[0].[State.Name,LaunchTime,InstanceType]' \
  --output table
```

**Expected**: State should be "running" with recent launch time.

### 2. CloudWatch Logs Analysis ✓

```bash
# Run automated log analysis
python3 analyze-logs.py --minutes 30 --file-types --opensearch
```

**What to verify**:
- Messages received vs messages deleted ratio
- Presence of "Indexed to OpenSearch" log entries
- File type detection logs
- No errors or minimal error rate (<5%)

**Success Indicators**:
- ✅ `opensearch_indexed` events > 0
- ✅ `file_type_detected` events > 0
- ✅ `s3_access` events > 0
- ❌ `message_deleted` only without processing

### 3. SQS Queue Metrics ✓

```bash
# Check queue status
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
  --attribute-names All \
  --query 'Attributes.{Messages:ApproximateNumberOfMessages,InFlight:ApproximateNumberOfMessagesNotVisible,Delayed:ApproximateNumberOfMessagesDelayed}' \
  --output table
```

**Expected**:
- Messages being processed (InFlight > 0)
- Queue draining over time (Messages decreasing)
- Not just deleting (verify with logs)

### 4. OpenSearch Index Verification ✓

#### Option A: Via SSM Port Forwarding (Recommended)

```bash
# Start port forwarding
./ssm-connect.sh
# Select option 9

# In another terminal
curl -X GET "http://localhost:9200/file-metadata/_count?pretty"
curl -X GET "http://localhost:9200/file-metadata/_search?pretty&size=5"
```

#### Option B: Via Bastion/EC2 Instance

```bash
# SSH into bastion or worker instance
aws ssm start-session --target i-0e6ac1e4d535a4ab2

# From instance
curl https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/file-metadata/_count?pretty
```

#### Option C: Using Verification Script

```bash
./check-opensearch.sh
```

**What to verify**:
- Index exists
- Document count > 0 and increasing
- Recent `indexed_at` timestamps
- DocuWorks files with relationships

**Success Indicators**:
```json
{
  "_count": {
    "count": 1234  // Should be > 0 and increasing
  }
}
```

### 5. DocuWorks Processing ✓

```bash
# Check for DocuWorks-specific logs
aws logs filter-log-events \
  --log-group-name /aws/ec2/cis-filesearch-worker \
  --filter-pattern '"DocuWorks" OR "xdw"' \
  --start-time $(date -u -d '30 minutes ago' +%s)000 \
  --query 'events[*].message' \
  --output table
```

**Expected**:
- "DocuWorks file detected" messages
- "Tracking relationships" messages
- Parent/child file associations

### 6. Worker Application Logs ✓

```bash
# Using SSM (recommended)
./ssm-connect.sh
# Select option 2 (tail worker.log)

# Or manually
aws ssm send-command \
  --instance-ids i-0e6ac1e4d535a4ab2 \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["tail -100 /var/log/worker.log"]' \
  --query 'Command.CommandId' \
  --output text
```

**What to look for**:
```
✅ "Processing message: <message-id>"
✅ "File type detected: pdf/xdw/docx/etc"
✅ "Accessing S3 file: s3://bucket/key"
✅ "Extracted metadata: {...}"
✅ "Indexed to OpenSearch: <file-path>"
✅ "Message deleted successfully"

❌ Only "Message deleted" without processing
❌ Connection errors to OpenSearch
❌ S3 access denied errors
❌ Python exceptions
```

### 7. System Resources ✓

```bash
# Check system health
./ssm-connect.sh
# Select option 7 (System resources)
```

**Expected**:
- CPU usage reasonable (<80%)
- Memory available (>500MB free)
- Disk space available (>20%)

### 8. Network Connectivity ✓

```bash
# Test OpenSearch connectivity from worker
./ssm-connect.sh
# Select option 5 (OpenSearch connectivity)
```

**Expected**:
- Successful connection to OpenSearch endpoint
- HTTP 200 response
- No certificate errors

## Common Issues & Solutions

### Issue 1: No OpenSearch Indexing

**Symptoms**:
- Messages deleted but `opensearch_indexed` count = 0
- No "Indexed to OpenSearch" logs

**Check**:
```bash
# 1. Check OpenSearch connectivity
curl https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_cluster/health

# 2. Check worker code
aws ssm start-session --target i-0e6ac1e4d535a4ab2
cat /home/ec2-user/worker.py | grep -A 20 "opensearch"

# 3. Check environment variables
printenv | grep OPENSEARCH
```

**Solutions**:
- Verify OpenSearch endpoint in environment variables
- Check security groups allow worker -> OpenSearch traffic
- Verify IAM role has OpenSearch write permissions

### Issue 2: S3 Access Errors

**Symptoms**:
- "Access Denied" in logs
- Cannot retrieve file metadata

**Check**:
```bash
# Check IAM role
aws sts get-caller-identity
aws s3 ls s3://cis-filesearch-files/ --recursive | head
```

**Solutions**:
- Verify EC2 instance profile has S3 read permissions
- Check bucket policy allows worker role

### Issue 3: DocuWorks Not Detected

**Symptoms**:
- No DocuWorks-related logs
- .xdw files processed as generic files

**Check**:
```bash
# Check worker code
grep -n "xdw" /home/ec2-user/worker.py
grep -n "docuworks" /home/ec2-user/worker.py -i
```

**Solutions**:
- Verify file extension detection logic
- Check DocuWorks relationship tracking code

## Verification Commands Summary

```bash
# 1. Quick health check
./verify-deployment.sh

# 2. Detailed log analysis
python3 analyze-logs.py --minutes 60 --file-types --opensearch

# 3. OpenSearch verification
# (requires port forwarding or bastion)
./check-opensearch.sh

# 4. Interactive troubleshooting
./ssm-connect.sh

# 5. Real-time log monitoring
aws logs tail /aws/ec2/cis-filesearch-worker --follow

# 6. CloudWatch Insights query
aws logs start-query \
  --log-group-name /aws/ec2/cis-filesearch-worker \
  --start-time $(date -u -d '1 hour ago' +%s) \
  --end-time $(date -u +%s) \
  --query-string 'fields @timestamp, @message
    | filter @message like /Indexed to OpenSearch/
    | stats count() by bin(5m)'
```

## Success Criteria

The deployment is successful if:

1. ✅ CloudWatch logs show "Indexed to OpenSearch" messages
2. ✅ OpenSearch index document count is increasing
3. ✅ File types are being detected correctly
4. ✅ DocuWorks files show relationship tracking
5. ✅ Error rate < 5%
6. ✅ Processing rate > 80% of messages received
7. ✅ No connectivity issues to S3 or OpenSearch

## Next Steps After Verification

### If Processing is Working ✅

1. Monitor for 24 hours
2. Check indexing rate vs expected volume
3. Verify data quality in OpenSearch
4. Set up CloudWatch alarms
5. Document any issues found

### If Processing is NOT Working ❌

1. Review worker.py code
2. Check environment variables
3. Verify IAM permissions
4. Review CloudWatch logs for errors
5. Test OpenSearch connectivity
6. Redeploy with fixes

## Monitoring Setup

```bash
# Create CloudWatch alarm for processing rate
aws cloudwatch put-metric-alarm \
  --alarm-name cis-worker-low-processing-rate \
  --alarm-description "Alert when OpenSearch indexing rate drops" \
  --metric-name FilesProcessed \
  --namespace CISFileSearch \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator LessThanThreshold \
  --evaluation-periods 2
```

## Contact & Support

- AWS Console: [EC2 Instances](https://console.aws.amazon.com/ec2/v2/home?region=ap-northeast-1#Instances:)
- CloudWatch Logs: [Worker Logs](https://console.aws.amazon.com/cloudwatch/home?region=ap-northeast-1#logsV2:log-groups/log-group/$252Faws$252Fec2$252Fcis-filesearch-worker)
- OpenSearch: [Dashboard](https://console.aws.amazon.com/aos/home?region=ap-northeast-1)

---

**Last Updated**: 2025-12-15
**Instance**: i-0e6ac1e4d535a4ab2
**Launch Template**: v19
