# OpenSearch Migration Rollback Procedure

**Incident ID**: OPENSEARCH-MIGRATION-20251218-001
**Rollback Strategy**: Point-in-Time Recovery from Snapshot

## 🚨 CRITICAL: Execute Only After Data Integrity Verification

**Prerequisites**:
- ✅ Backup snapshot verified intact: `file-search-dev-backup-20251218-101015`
- ✅ Current data state assessed and documented
- ✅ Approval obtained from senior engineer/architect
- ✅ VPC access established (via EC2 bastion or SSM Session Manager)

---

## Rollback Decision Tree

```
Is current index corrupted or missing data?
├─ YES → Proceed with FULL RESTORE (Section A)
│   └─ High Priority: Execute within 30 minutes
│
└─ NO → Current index is intact
    ├─ Does backup have MORE data than current?
    │   ├─ YES → Proceed with SELECTIVE RESTORE (Section B)
    │   └─ NO → No rollback needed
    │       └─ Document incident and monitor (Section C)
    │
    └─ Are mappings incorrect/missing k-NN field?
        ├─ YES → Proceed with MAPPING UPDATE (Section D)
        └─ NO → No action needed
```

---

## Section A: FULL RESTORE (Data Loss Detected)

### A.1 Pre-Restore Validation

```bash
# 1. Verify backup snapshot exists and is complete
curl -XGET "https://<OPENSEARCH_ENDPOINT>/_snapshot/<REPO_NAME>/file-search-dev-backup-20251218-101015" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq '.snapshots[0].state'

# Expected: "SUCCESS"

# 2. Check backup document count
curl -XGET "https://<OPENSEARCH_ENDPOINT>/_snapshot/<REPO_NAME>/file-search-dev-backup-20251218-101015" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq '.snapshots[0].shards.successful'

# Note the document count for validation
```

### A.2 Stop All Write Operations

```bash
# 1. Disable SQS queue (file processor worker)
aws sqs set-queue-attributes \
  --queue-url <QUEUE_URL> \
  --attributes ReceiveMessageWaitTimeSeconds=0,VisibilityTimeout=0

# 2. Stop EC2 worker instances (if running)
aws ec2 stop-instances --instance-ids <INSTANCE_ID>

# 3. Verify no active indexing
curl -XGET "https://<OPENSEARCH_ENDPOINT>/_stats/indexing?pretty" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"
# index_total should not be increasing
```

### A.3 Create Emergency Snapshot of Current State

```bash
# Even if data is corrupted, preserve current state for forensics
curl -XPUT "https://<OPENSEARCH_ENDPOINT>/_snapshot/<REPO_NAME>/emergency-pre-restore-$(date +%Y%m%d-%H%M%S)" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H 'Content-Type: application/json' -d'
{
  "indices": "file-index",
  "include_global_state": false,
  "metadata": {
    "reason": "Emergency snapshot before restore from backup",
    "incident_id": "OPENSEARCH-MIGRATION-20251218-001"
  }
}'
```

### A.4 Delete Current Corrupted Index

```bash
# CRITICAL: This is irreversible. Ensure emergency snapshot completed.

curl -XDELETE "https://<OPENSEARCH_ENDPOINT>/file-index" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"

# Verify deletion
curl -XGET "https://<OPENSEARCH_ENDPOINT>/_cat/indices?v" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"
```

### A.5 Restore from Backup

```bash
# Restore snapshot to original index name
curl -XPOST "https://<OPENSEARCH_ENDPOINT>/_snapshot/<REPO_NAME>/file-search-dev-backup-20251218-101015/_restore" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H 'Content-Type: application/json' -d'
{
  "indices": "*",
  "rename_pattern": "(.+)",
  "rename_replacement": "file-index",
  "include_global_state": false,
  "include_aliases": true
}'

# Monitor restore progress
curl -XGET "https://<OPENSEARCH_ENDPOINT>/_snapshot/<REPO_NAME>/file-search-dev-backup-20251218-101015/_status" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"
```

### A.6 Post-Restore Validation

```bash
# 1. Verify index exists
curl -XGET "https://<OPENSEARCH_ENDPOINT>/_cat/indices?v" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | grep file-index

# 2. Check document count matches backup
curl -XGET "https://<OPENSEARCH_ENDPOINT>/file-index/_count" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"

# 3. Verify index health
curl -XGET "https://<OPENSEARCH_ENDPOINT>/_cluster/health/file-index?pretty" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"
# Expected: status=green

# 4. Test search functionality
curl -XGET "https://<OPENSEARCH_ENDPOINT>/file-index/_search?q=test&size=5" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"

# 5. Verify mappings restored
curl -XGET "https://<OPENSEARCH_ENDPOINT>/file-index/_mapping" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq '.["file-index"].mappings.properties | keys'
```

### A.7 Resume Write Operations

```bash
# 1. Re-enable SQS queue
aws sqs set-queue-attributes \
  --queue-url <QUEUE_URL> \
  --attributes ReceiveMessageWaitTimeSeconds=20,VisibilityTimeout=300

# 2. Start EC2 worker instances
aws ec2 start-instances --instance-ids <INSTANCE_ID>

# 3. Monitor for indexing errors
aws logs tail /aws/opensearch/cis-filesearch --follow
```

---

## Section B: SELECTIVE RESTORE (Partial Data Loss)

Use this when current index exists but is missing some documents.

### B.1 Identify Missing Documents

```python
# Script to compare backup vs current index
import boto3
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

def find_missing_documents(endpoint, backup_snapshot, current_index):
    # Get document IDs from backup
    backup_ids = get_snapshot_document_ids(backup_snapshot)

    # Get document IDs from current index
    current_ids = get_current_document_ids(current_index)

    # Find missing
    missing = set(backup_ids) - set(current_ids)

    return list(missing)

# Restore only missing documents via scroll API
```

### B.2 Reindex Missing Documents

```bash
# Create temporary index from backup
curl -XPOST "https://<OPENSEARCH_ENDPOINT>/_snapshot/<REPO_NAME>/file-search-dev-backup-20251218-101015/_restore" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H 'Content-Type: application/json' -d'
{
  "indices": "*",
  "rename_pattern": "(.+)",
  "rename_replacement": "file-index-temp-restore",
  "include_global_state": false
}'

# Reindex missing documents
curl -XPOST "https://<OPENSEARCH_ENDPOINT>/_reindex" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H 'Content-Type: application/json' -d'
{
  "source": {
    "index": "file-index-temp-restore",
    "query": {
      "ids": {
        "values": ["<missing_doc_id_1>", "<missing_doc_id_2>"]
      }
    }
  },
  "dest": {
    "index": "file-index",
    "op_type": "create"
  }
}'

# Delete temporary index
curl -XDELETE "https://<OPENSEARCH_ENDPOINT>/file-index-temp-restore" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"
```

---

## Section C: NO ROLLBACK NEEDED (Data Intact)

### C.1 Document Incident

1. Update incident log with findings
2. No data loss detected
3. Migration script stopped before making changes
4. Current index state preserved

### C.2 Monitoring Plan

```bash
# Set up CloudWatch Alarms
aws cloudwatch put-metric-alarm \
  --alarm-name opensearch-file-index-document-count \
  --alarm-description "Alert if document count drops unexpectedly" \
  --metric-name SearchableDocuments \
  --namespace AWS/ES \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold <CURRENT_DOC_COUNT> \
  --comparison-operator LessThanThreshold \
  --dimensions Name=DomainName,Value=cis-filesearch-opensearch Name=ClientId,Value=<AWS_ACCOUNT_ID> Name=IndexName,Value=file-index
```

---

## Section D: MAPPING UPDATE (k-NN Field Missing)

### D.1 Check Current Mapping

```bash
curl -XGET "https://<OPENSEARCH_ENDPOINT>/file-index/_mapping" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq '.["file-index"].mappings.properties.image_embedding'
```

### D.2 Add k-NN Field (If Index Allows)

**⚠️ WARNING**: You CANNOT add k-NN fields to existing indices without reindexing.

**Required**: Blue-Green migration via alias (see opensearch-migration-strategy.ts)

```bash
# This will FAIL if you try to add k-NN to existing index:
# "mapper_parsing_exception: Mapping definition for [image_embedding] has unsupported parameters: [dimension : 1024]"

# CORRECT APPROACH:
# 1. Create new index with k-NN mapping
# 2. Reindex all data
# 3. Switch alias
# 4. Delete old index
```

---

## Rollback Success Criteria

- [ ] Index health: `green`
- [ ] Document count matches backup: `<EXPECTED_COUNT>`
- [ ] Search functionality working
- [ ] No data loss detected
- [ ] Write operations resumed
- [ ] Monitoring alerts configured
- [ ] Incident documented in audit trail

---

## Escalation Procedures

**If rollback fails or unexpected issues occur:**

1. **STOP immediately** - Do not continue with restore
2. **Contact senior infrastructure engineer**
3. **Preserve all evidence**:
   - CloudWatch logs
   - Snapshot metadata
   - Index stats before/after
4. **Do NOT delete any data** until root cause analysis complete
5. **Engage AWS Support** if OpenSearch service issues suspected

---

## Post-Rollback Actions

1. **Root Cause Analysis**:
   - Why did migration script attempt VPC access from local machine?
   - Why were index names mismatched?
   - What validation was missing?

2. **Process Improvements**:
   - Update migration scripts with VPC access checks
   - Implement dry-run mode for migrations
   - Add pre-flight validation
   - Document proper migration procedures

3. **Preventive Measures**:
   - Automated daily backups
   - Index alias usage for zero-downtime migrations
   - Circuit breaker patterns for critical operations
   - Comprehensive testing in staging environment

---

## Sign-off

**Rollback Executed By**: _____________
**Date/Time**: _____________
**Result**: SUCCESS / PARTIAL / FAILED
**Data Loss**: YES / NO
**Approved By**: _____________
