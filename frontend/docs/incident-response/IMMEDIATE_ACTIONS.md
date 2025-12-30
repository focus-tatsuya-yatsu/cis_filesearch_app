# 🚨 IMMEDIATE ACTIONS REQUIRED - OpenSearch Migration Incident

**Incident ID**: OPENSEARCH-MIGRATION-20251218-001
**Created**: 2025-12-18 10:30:00 JST
**Status**: 🔴 OPEN - Awaiting Data Verification
**Priority**: P0 - Critical

---

## ⚡ Quick Status

| Item | Status |
|------|--------|
| **Backup Created** | ✅ SUCCESS - `file-search-dev-backup-20251218-101015` |
| **Current Index** | ⚠️ UNKNOWN - Verification pending |
| **Production Service** | ✅ OPERATIONAL - No user impact detected |
| **Data Integrity** | ⏳ PENDING - Verification required |
| **Security Violation** | ✅ MITIGATED - VPC controls prevented unauthorized access |

---

## 📋 STEP 1: Immediate Data Verification (Next 30 minutes)

### Prerequisites
- ✅ VPC access (EC2 bastion or SSM Session Manager)
- ✅ AWS credentials with OpenSearch permissions
- ✅ OpenSearch endpoint: `vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com`

### Execute on EC2 Instance

```bash
# 1. Connect to EC2 instance in VPC
aws ssm start-session --target <EC2_INSTANCE_ID>

# 2. Verify current index status
curl -XGET "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_cat/indices?v" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"

# Expected output: List of indices including 'file-index'

# 3. Check document count
curl -XGET "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/file-index/_count" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"

# Record the count: _____________

# 4. Verify backup integrity
curl -XGET "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_snapshot/<REPO_NAME>/file-search-dev-backup-20251218-101015" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"

# Expected: "state": "SUCCESS"

# 5. Compare document counts
# Backup count: _____________
# Current count: _____________
# Difference: _____________
```

### Decision Point

**If counts match (difference < 0.1%)**:
- ✅ **No rollback needed**
- ✅ **Data integrity confirmed**
- → Proceed to STEP 2 (Post-Incident Actions)

**If counts differ significantly (difference ≥ 0.1%)**:
- ⚠️ **Potential data loss detected**
- ⚠️ **Rollback required**
- → Proceed to STEP 3 (Emergency Rollback)

**If verification fails or errors occur**:
- 🔴 **Escalate immediately**
- 🔴 **Contact senior engineer**
- → Do NOT proceed with rollback without approval

---

## 📋 STEP 2: Post-Incident Actions (If No Data Loss)

### 2.1 Document Findings

```bash
# Create incident summary
cat > /tmp/incident-summary.txt <<EOF
Incident ID: OPENSEARCH-MIGRATION-20251218-001
Status: RESOLVED - No data loss
Findings:
- Backup created successfully: file-search-dev-backup-20251218-101015
- Current index intact: file-index
- Document count verified: [INSERT COUNT]
- VPC access controls functioned correctly (prevented unauthorized access)
Root Cause: Migration script attempted VPC access from local machine
Resolution: Migration halted before making changes; current index unaffected
EOF
```

### 2.2 Update Audit Trail

Open and complete: `/docs/incident-response/audit-trail-template.md`

- [ ] Fill in timeline with actual timestamps
- [ ] Document verification results
- [ ] Mark incident status as RESOLVED
- [ ] Obtain approvals from Engineering Manager

### 2.3 Fix Configuration Issues

```bash
# Fix index name consistency
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

# Update .env.local
# Change: OPENSEARCH_INDEX=file-index
# To match actual index name in OpenSearch

# Verify configuration
grep OPENSEARCH_INDEX .env.local
```

### 2.4 Implement Monitoring

```bash
# Set up CloudWatch alarm for document count monitoring
aws cloudwatch put-metric-alarm \
  --alarm-name opensearch-file-index-document-count-drop \
  --alarm-description "Alert if document count drops by >1%" \
  --metric-name SearchableDocuments \
  --namespace AWS/ES \
  --statistic Average \
  --period 300 \
  --evaluation-periods 1 \
  --threshold <CURRENT_DOC_COUNT * 0.99> \
  --comparison-operator LessThanThreshold \
  --dimensions Name=DomainName,Value=cis-filesearch-opensearch Name=ClientId,Value=<AWS_ACCOUNT_ID>
```

### 2.5 Schedule Proper Migration

**Do NOT attempt migration again without:**
- ✅ Change management approval
- ✅ Scheduled maintenance window
- ✅ Tested dry-run on staging environment
- ✅ Rollback plan documented
- ✅ Team members on standby

```bash
# Use new secure migration script (from EC2 instance)
npm run migrate:opensearch:dry-run   # Test first
npm run migrate:opensearch -- --execute  # Execute after approval
```

---

## 📋 STEP 3: Emergency Rollback (If Data Loss Detected)

### ⚠️ CRITICAL: Only if data loss confirmed

### 3.1 Stop All Write Operations

```bash
# 1. Disable SQS queue
aws sqs set-queue-attributes \
  --queue-url <QUEUE_URL> \
  --attributes ReceiveMessageWaitTimeSeconds=0,VisibilityTimeout=0

# 2. Stop EC2 worker instances
aws ec2 stop-instances --instance-ids <INSTANCE_IDS>

# 3. Verify no active indexing
aws cloudwatch get-metric-statistics \
  --namespace AWS/ES \
  --metric-name IndexingRate \
  --dimensions Name=DomainName,Value=cis-filesearch-opensearch Name=ClientId,Value=<AWS_ACCOUNT_ID> \
  --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average

# Expected: Near-zero indexing rate
```

### 3.2 Create Emergency Snapshot

```bash
# Even if data is corrupted, preserve current state for forensics
curl -XPUT "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_snapshot/<REPO_NAME>/emergency-pre-restore-$(date +%Y%m%d-%H%M%S)" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  -H 'Content-Type: application/json' -d'
{
  "indices": "file-index",
  "include_global_state": false,
  "metadata": {
    "reason": "Emergency snapshot before restore",
    "incident_id": "OPENSEARCH-MIGRATION-20251218-001"
  }
}'

# Wait for completion
curl -XGET "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_snapshot/<REPO_NAME>/emergency-pre-restore-*/_status" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"
```

### 3.3 Delete Corrupted Index

```bash
# ⚠️ IRREVERSIBLE - Ensure emergency snapshot completed
curl -XDELETE "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/file-index" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"
```

### 3.4 Restore from Backup

```bash
# Restore from pre-migration backup
curl -XPOST "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_snapshot/<REPO_NAME>/file-search-dev-backup-20251218-101015/_restore" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  -H 'Content-Type: application/json' -d'
{
  "indices": "*",
  "rename_pattern": "(.+)",
  "rename_replacement": "file-index",
  "include_global_state": false
}'

# Monitor restore progress
watch -n 5 'curl -XGET "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_snapshot/<REPO_NAME>/file-search-dev-backup-20251218-101015/_status" --aws-sigv4 "aws:amz:ap-northeast-1:es" --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" | jq .snapshots[0].state'
```

### 3.5 Validate Restore

```bash
# 1. Check index health
curl -XGET "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_cluster/health/file-index?pretty" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"

# Expected: "status": "green"

# 2. Verify document count
curl -XGET "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/file-index/_count" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"

# Should match backup count: _____________

# 3. Test search functionality
curl -XGET "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/file-index/_search?q=test&size=5" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"
```

### 3.6 Resume Operations

```bash
# 1. Re-enable SQS queue
aws sqs set-queue-attributes \
  --queue-url <QUEUE_URL> \
  --attributes ReceiveMessageWaitTimeSeconds=20,VisibilityTimeout=300

# 2. Start EC2 worker instances
aws ec2 start-instances --instance-ids <INSTANCE_IDS>

# 3. Monitor for errors
aws logs tail /aws/opensearch/cis-filesearch --follow
```

---

## 📞 Escalation Contacts

| Role | When to Escalate | Contact |
|------|------------------|---------|
| Engineering Manager | Data loss >0.1% OR rollback needed | [INSERT CONTACT] |
| Senior Engineer | Rollback failed OR unexpected errors | [INSERT CONTACT] |
| AWS Support | OpenSearch cluster issues | Enterprise Support: 1-800-xxx-xxxx |
| Security Team | Potential data breach | [INSERT CONTACT] |
| CTO/VP Engineering | Service downtime >1 hour | [INSERT CONTACT] |

---

## 📚 Reference Documents

1. **Data Integrity Checklist**: `/docs/incident-response/data-integrity-checklist.md`
2. **Rollback Procedures**: `/docs/incident-response/rollback-procedure.md`
3. **Audit Trail**: `/docs/incident-response/audit-trail-template.md`
4. **Recovery Best Practices**: `/docs/incident-response/recovery-best-practices.md`
5. **Secure Migration Script**: `/scripts/opensearch-secure-migration.ts`

---

## ✅ Completion Checklist

### Data Verification Phase
- [ ] Connected to EC2 instance in VPC
- [ ] Verified current index exists
- [ ] Counted documents in current index: _____________
- [ ] Verified backup snapshot integrity
- [ ] Compared counts (backup vs current)
- [ ] Decision made: ROLLBACK / NO ACTION

### Resolution Phase (if no data loss)
- [ ] Incident summary documented
- [ ] Audit trail completed
- [ ] Configuration issues fixed
- [ ] Monitoring alarms created
- [ ] Team notified of resolution
- [ ] Post-incident review scheduled

### Rollback Phase (if data loss detected)
- [ ] Write operations stopped
- [ ] Emergency snapshot created
- [ ] Corrupted index deleted
- [ ] Backup restored successfully
- [ ] Restore validated (health, count, search)
- [ ] Operations resumed
- [ ] Incident escalated to senior team

---

## 🎯 Success Criteria

**Incident considered resolved when:**
- ✅ Data integrity verified (no loss) OR successful rollback completed
- ✅ Production service operational
- ✅ Root cause documented
- ✅ Preventive measures implemented
- ✅ Monitoring alerts configured
- ✅ Audit trail completed
- ✅ Team notified

---

**Last Updated**: 2025-12-18 10:30:00 JST
**Owner**: [INSERT NAME]
**Status**: ⏳ IN PROGRESS
