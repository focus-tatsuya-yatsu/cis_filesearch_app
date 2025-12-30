# OpenSearch Migration Quick Reference Card

## TL;DR

**Problem:** `image_embedding` field is not `knn_vector` type
**Solution:** Run zero-downtime Blue-Green deployment script
**Downtime:** Zero (with recommended approach)
**Duration:** 10-30 minutes
**Risk Level:** 🟢 Low (with safeguards)

---

## Pre-Flight Checklist (5 minutes)

```bash
# 1. Check cluster health
curl "$OPENSEARCH_ENDPOINT/_cluster/health" | jq '.status'
# Must be: "green"

# 2. Check disk space
curl "$OPENSEARCH_ENDPOINT/_nodes/stats" | jq '.nodes[].fs.total.free_in_bytes'
# Need: 2x current index size

# 3. Document count
curl "$OPENSEARCH_ENDPOINT/file-search-dev/_count" | jq '.count'
# Note this number

# 4. Create snapshot backup
curl -X PUT "$OPENSEARCH_ENDPOINT/_snapshot/fs-backup/pre-migration-$(date +%Y%m%d)" \
  -H 'Content-Type: application/json' \
  -d '{"indices": "file-search-dev"}'

# 5. Verify snapshot completed
curl "$OPENSEARCH_ENDPOINT/_snapshot/fs-backup/pre-migration-*/_status" | jq '.snapshots[0].state'
# Must be: "SUCCESS"
```

---

## Migration Command (1 line)

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
./scripts/fix-opensearch-mapping-zero-downtime.sh
```

**This script will:**
1. ✅ Create new index with k-NN mapping
2. ✅ Copy all data (excluding old embeddings)
3. ✅ Switch alias atomically (zero downtime)
4. ✅ Keep old index as backup

---

## Monitoring During Migration (run in separate terminal)

```bash
# Terminal 1: Watch cluster health
watch -n 5 'curl -s "$OPENSEARCH_ENDPOINT/_cluster/health" | jq ".status, .number_of_nodes"'

# Terminal 2: Monitor reindex progress
watch -n 5 'curl -s "$OPENSEARCH_ENDPOINT/_cat/indices?v" | grep file-search'
```

---

## Post-Migration Validation (2 minutes)

```bash
# 1. Verify alias points to new index
curl "$OPENSEARCH_ENDPOINT/_alias/file-search" | jq 'keys'
# Should show: ["file-search-dev-v2-*"]

# 2. Check document count matches
curl "$OPENSEARCH_ENDPOINT/file-search/_count" | jq '.count'
# Should match pre-migration count

# 3. Verify mapping type
curl "$OPENSEARCH_ENDPOINT/file-search/_mapping" | \
  jq '.[].mappings.properties.image_embedding.type'
# Must be: "knn_vector"

# 4. Test search still works
curl -X POST "$OPENSEARCH_ENDPOINT/file-search/_search" \
  -H 'Content-Type: application/json' \
  -d '{"query": {"match": {"file_name": "test"}}, "size": 1}'
# Should return results
```

---

## Emergency Rollback (if needed)

```bash
# 1-second rollback to old index
export OLD_INDEX="file-search-dev"
export NEW_INDEX=$(curl -s "$OPENSEARCH_ENDPOINT/_alias/file-search" | jq -r 'keys[0]')

curl -X POST "$OPENSEARCH_ENDPOINT/_aliases" \
  -H 'Content-Type: application/json' \
  -d "{
    \"actions\": [
      {\"remove\": {\"index\": \"$NEW_INDEX\", \"alias\": \"file-search\"}},
      {\"add\": {\"index\": \"$OLD_INDEX\", \"alias\": \"file-search\"}}
    ]
  }"

echo "✅ Rollback complete - using old index"
```

---

## Expected Timeline

| Phase | Duration | What's Happening |
|-------|----------|------------------|
| Pre-flight checks | 5 min | Verify cluster health, create backup |
| Create new index | 1 min | Set up k-NN mapping |
| Reindex data | 5-25 min | Copy documents (depends on size) |
| Validate | 2 min | Count check, mapping verification |
| Alias switch | <1 sec | **Zero-downtime cutover** |
| **TOTAL** | **10-30 min** | **0 seconds downtime** |

---

## Key Configuration Values

```json
{
  "image_embedding": {
    "type": "knn_vector",
    "dimension": 1024,                    // AWS Titan embedding size
    "method": {
      "name": "hnsw",
      "space_type": "innerproduct",       // 10-15% faster than cosine
      "engine": "faiss",                  // Best performance
      "parameters": {
        "ef_construction": 128,           // Balanced build quality
        "m": 24                            // Balanced memory/recall
      }
    }
  },
  "settings": {
    "knn.algo_param.ef_search": 100      // Runtime tuning parameter
  }
}
```

---

## Success Criteria

After migration, verify these:

- [ ] ✅ Cluster health: GREEN
- [ ] ✅ Document count: Same as before
- [ ] ✅ Mapping type: `knn_vector`
- [ ] ✅ Search queries: Working normally
- [ ] ✅ Error rate: <0.1%
- [ ] ✅ Latency P95: <200ms

---

## Post-Migration Monitoring (48 hours)

```bash
# Watch key metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ES \
  --metric-name SearchLatency \
  --dimensions Name=DomainName,Value=cis-filesearch-dev \
  --statistics Average \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300

# Alert thresholds:
# - SearchLatency P95 > 200ms: Investigate
# - JVMMemoryPressure > 85%: Consider scaling
# - ClusterStatus.red > 0: CRITICAL - rollback
```

---

## Cleanup (after 7 days)

```bash
# Only if everything is working perfectly for 7+ days

# List old indices
curl "$OPENSEARCH_ENDPOINT/_cat/indices?v" | grep file-search

# Delete old index
curl -X DELETE "$OPENSEARCH_ENDPOINT/file-search-dev"

# Delete backup
curl -X DELETE "$OPENSEARCH_ENDPOINT/file-search-dev-backup-*"
```

---

## Troubleshooting

### Issue: "Insufficient disk space"
```bash
# Check space
curl "$OPENSEARCH_ENDPOINT/_cat/allocation?v"

# Free space by deleting old snapshots
curl -X DELETE "$OPENSEARCH_ENDPOINT/_snapshot/fs-backup/old-snapshot-name"
```

### Issue: "Document count mismatch"
```bash
# Check for failures
curl "$OPENSEARCH_ENDPOINT/_tasks?detailed=true&actions=*reindex" | jq '.nodes[].tasks[].status.failures'

# If failures exist, investigate and re-run reindex
```

### Issue: "Slow reindex (>30 min)"
```bash
# Check reindex task progress
TASK_ID="<task-id-from-script>"
curl "$OPENSEARCH_ENDPOINT/_tasks/$TASK_ID" | jq '.task.status'

# Reindex speed is typically:
# - Small indices (<100K docs): 500-1000 docs/sec
# - Large indices (>1M docs): 200-500 docs/sec
```

### Issue: "Cluster health YELLOW after migration"
```bash
# Check unassigned shards
curl "$OPENSEARCH_ENDPOINT/_cat/shards?v" | grep UNASSIGNED

# Usually resolves automatically within 5-10 minutes
# If persists >10 min, check allocation explain:
curl -X GET "$OPENSEARCH_ENDPOINT/_cluster/allocation/explain"
```

---

## Contact Information

**Documentation:**
- Main Summary: `/docs/opensearch-knn-migration-summary.md`
- HNSW Tuning: `/docs/opensearch-knn-optimization-guide.md`
- Risk Analysis: `/docs/opensearch-migration-risks-mitigation.md`
- Query Optimization: `/docs/opensearch-image-search-optimization.md`

**Scripts:**
- Zero-downtime: `/frontend/scripts/fix-opensearch-mapping-zero-downtime.sh`
- In-place (dev only): `/frontend/scripts/fix-opensearch-mapping.sh`

**OpenSearch Endpoint:**
```bash
export OPENSEARCH_ENDPOINT="https://search-cis-filesearch-dev.ap-northeast-1.es.amazonaws.com"
export INDEX_NAME="file-search-dev"
export ALIAS_NAME="file-search"
```

---

## Quick Commands Reference

```bash
# Cluster health
curl "$OPENSEARCH_ENDPOINT/_cluster/health" | jq .

# Index stats
curl "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_stats" | jq '.indices[].total'

# Mapping
curl "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_mapping" | jq .

# Count
curl "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_count" | jq .

# Settings
curl "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_settings" | jq .

# Aliases
curl "$OPENSEARCH_ENDPOINT/_alias" | jq .

# Snapshots
curl "$OPENSEARCH_ENDPOINT/_snapshot/fs-backup/_all" | jq '.snapshots[-1]'

# Running tasks
curl "$OPENSEARCH_ENDPOINT/_tasks?detailed=true" | jq .
```

---

## Remember

1. ✅ **Always use Blue-Green deployment** (zero-downtime script)
2. ✅ **Create snapshot backup first** - Your safety net
3. ✅ **Validate before switching alias** - No surprises
4. ✅ **Keep old index 7 days** - Easy rollback
5. ✅ **Monitor for 48 hours** - Catch issues early

**Good luck with the migration! 🚀**
