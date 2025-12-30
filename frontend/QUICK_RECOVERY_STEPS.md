# OpenSearch Migration - Quick Recovery Steps

## URGENT: Immediate Actions Required

### Status
- ✅ Backup created: `file-search-dev-backup-20251218-101015`
- ⚠️ Script stopped at index deletion step
- ✅ Data likely safe (VPC endpoint not accessible from local machine)

---

## Option 1: Quick Check (Recommended First Step)

### From EC2 Instance (VPC Access Required)

```bash
# 1. Connect to EC2
aws ssm start-session --target <instance-id>

# 2. Set environment variables
export OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"

# 3. Check cluster health
curl -s "${OPENSEARCH_ENDPOINT}/_cluster/health" | jq .

# 4. List all indices
curl -s "${OPENSEARCH_ENDPOINT}/_cat/indices?v" | grep -E "file|cis"

# 5. Check specific indices
for idx in "file-index" "file-search-dev" "cis-files" "file-search-dev-backup-20251218-101015"; do
  echo "Checking: $idx"
  curl -s "${OPENSEARCH_ENDPOINT}/${idx}/_count" | jq .
done
```

**Expected Results:**
- If you see the backup index with documents: ✅ **Data is safe**
- If you see the original index still exists: ✅ **No damage, migration can proceed**

---

## Option 2: Complete Migration (After Verification)

### Prerequisites
- SSH/SSM access to EC2 instance in VPC
- Correct index name identified (`file-index` by default)

### Execution Steps

```bash
# 1. Copy the VPC-compatible script to EC2
# On your local machine:
scp frontend/scripts/fix-opensearch-mapping-vpc.sh ec2-user@<instance>:/tmp/

# 2. Connect to EC2
ssh ec2-user@<instance>
# or
aws ssm start-session --target <instance-id>

# 3. Set environment variables
export OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
export OPENSEARCH_INDEX="file-index"  # Use the correct index name

# 4. Make script executable and run
chmod +x /tmp/fix-opensearch-mapping-vpc.sh
/tmp/fix-opensearch-mapping-vpc.sh

# 5. Follow the prompts and confirm when asked
```

**Duration:** 10-15 minutes (depending on document count)

---

## Option 3: Manual Recovery (If Script Fails)

### Step-by-Step Manual Process

```bash
# 1. Verify backup exists
curl -s "${OPENSEARCH_ENDPOINT}/file-search-dev-backup-20251218-101015/_count"

# 2. If original index was deleted, restore from backup
curl -X POST "${OPENSEARCH_ENDPOINT}/_reindex" \
  -H "Content-Type: application/json" \
  -d '{
    "source": {"index": "file-search-dev-backup-20251218-101015"},
    "dest": {"index": "file-index"}
  }'

# 3. Wait for reindex to complete
curl -s "${OPENSEARCH_ENDPOINT}/_tasks?detailed=true&actions=*reindex"

# 4. Verify document count
curl -s "${OPENSEARCH_ENDPOINT}/file-index/_count"

# 5. Create new backup before modification
BACKUP_NEW="file-index-backup-$(date +%Y%m%d-%H%M%S)"
curl -X POST "${OPENSEARCH_ENDPOINT}/_reindex" \
  -H "Content-Type: application/json" \
  -d "{
    \"source\": {\"index\": \"file-index\"},
    \"dest\": {\"index\": \"${BACKUP_NEW}\"}
  }"

# 6. Delete and recreate with correct mapping
curl -X DELETE "${OPENSEARCH_ENDPOINT}/file-index"

curl -X PUT "${OPENSEARCH_ENDPOINT}/file-index" \
  -H "Content-Type: application/json" \
  -d @/tmp/opensearch-mapping-template.json

# 7. Restore data (excluding image_embedding)
curl -X POST "${OPENSEARCH_ENDPOINT}/_reindex" \
  -H "Content-Type: application/json" \
  -d "{
    \"source\": {
      \"index\": \"${BACKUP_NEW}\",
      \"_source\": {\"excludes\": [\"image_embedding\"]}
    },
    \"dest\": {\"index\": \"file-index\"}
  }"

# 8. Verify
curl -s "${OPENSEARCH_ENDPOINT}/file-index/_mapping" | \
  jq '.["file-index"].mappings.properties.image_embedding'
```

---

## Decision Tree

```
1. Can you access EC2 instance in VPC?
   ├─ YES → Use Option 1 (Quick Check) first
   │         └─ Data intact?
   │            ├─ YES → Use Option 2 (Complete Migration)
   │            └─ NO → Use Option 3 (Manual Recovery)
   │
   └─ NO → Request access or contact AWS administrator
           Temporary workaround: Use mock data in frontend
```

---

## Verification Checklist

After completing migration:

- [ ] Cluster health is green: `curl -s "${OPENSEARCH_ENDPOINT}/_cluster/health" | jq .status`
- [ ] Correct index exists: `curl -s "${OPENSEARCH_ENDPOINT}/_cat/indices?v" | grep file-index`
- [ ] Document count matches original: `curl -s "${OPENSEARCH_ENDPOINT}/file-index/_count"`
- [ ] image_embedding field is knn_vector type with 1024 dimensions
- [ ] Backup index still exists for safety
- [ ] Search functionality works from frontend

---

## Rollback Plan

If migration fails:

```bash
# 1. Delete failed index
curl -X DELETE "${OPENSEARCH_ENDPOINT}/file-index"

# 2. Restore from backup
curl -X POST "${OPENSEARCH_ENDPOINT}/_reindex" \
  -H "Content-Type: application/json" \
  -d '{
    "source": {"index": "file-search-dev-backup-20251218-101015"},
    "dest": {"index": "file-index"}
  }'

# 3. Verify restoration
curl -s "${OPENSEARCH_ENDPOINT}/file-index/_count"
```

---

## Key Files

| File | Purpose | Location |
|------|---------|----------|
| `recovery-check-opensearch.sh` | State diagnosis | `frontend/scripts/` |
| `fix-opensearch-mapping-vpc.sh` | VPC-compatible migration | `frontend/scripts/` |
| `opensearch-mapping-template.json` | Index mapping definition | `frontend/scripts/` |
| `OPENSEARCH_MIGRATION_RECOVERY.md` | Full recovery guide | `frontend/` |

---

## Support Information

**OpenSearch Domain:** cis-filesearch-opensearch
**Region:** ap-northeast-1
**VPC Endpoint:** vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
**Default Index:** file-index

**Emergency Contacts:**
- AWS Support (if cluster is down)
- Check CloudWatch Logs: `/aws/opensearch/cis-filesearch-opensearch`

---

## Timeline Estimate

| Scenario | Time Required |
|----------|---------------|
| Quick check (Option 1) | 5 minutes |
| Data intact + migration (Option 2) | 10-15 minutes |
| Recovery + migration (Option 3) | 20-30 minutes |
| Worst case (full rebuild) | 1-2 hours |

---

## Next Steps After Recovery

1. ✅ Verify image_embedding field is properly configured
2. ✅ Test image upload and vector generation
3. ✅ Test image similarity search functionality
4. ✅ Clean up old backup indices (after confirmation)
5. ✅ Update documentation with lessons learned
6. ✅ Set up automated backup snapshots

---

## Important Notes

⚠️ **VPC Access Only:** All OpenSearch operations must be performed from within the VPC (EC2 instance)

⚠️ **Index Name Consistency:** Ensure all systems use the same index name (`file-index` by default)

⚠️ **Backup Before Changes:** Always create a backup before destructive operations

✅ **Current Status:** Data is likely safe due to VPC access restrictions
