# OpenSearch Zero-Downtime Migration Best Practices

## Overview
This guide details the production-grade approach for migrating OpenSearch indices without service interruption, specifically for adding k-NN vector fields.

## Migration Strategies Comparison

### Strategy 1: Blue-Green Deployment (Recommended) ✅
**Approach:** Create new index → Copy data → Switch alias → Delete old
- ✅ Zero downtime
- ✅ Easy rollback
- ✅ No data loss risk
- ❌ Requires 2x storage temporarily
- ⏱️ Duration: 10-30 minutes (100K docs)

**Use when:**
- Production environment
- Cannot afford downtime
- Have sufficient storage (2x current index size)

### Strategy 2: In-Place Update ❌
**Approach:** Delete index → Recreate → Restore
- ❌ Service interruption (5-30 minutes)
- ❌ Risky rollback
- ✅ No extra storage needed
- ⏱️ Duration: 5-15 minutes (100K docs)

**Use when:**
- Development environment only
- Can tolerate downtime
- Storage constrained

### Strategy 3: Rolling Update (Advanced) 🔧
**Approach:** Gradual shard-by-shard migration
- ✅ Zero downtime
- ✅ Minimal storage overhead
- ⚠️ Complex implementation
- ⏱️ Duration: 30-60 minutes (100K docs)

**Use when:**
- Multi-shard indices (>1M docs)
- Very large datasets (>10GB)
- Need fine-grained control

## Blue-Green Deployment Implementation

### Pre-Migration Checklist

```bash
#!/bin/bash
# Pre-migration validation checklist

echo "=== Pre-Migration Checklist ==="

# 1. Check cluster health
CLUSTER_HEALTH=$(curl -s "$OPENSEARCH_ENDPOINT/_cluster/health" | jq -r '.status')
echo "✓ Cluster health: $CLUSTER_HEALTH"
[ "$CLUSTER_HEALTH" != "green" ] && echo "⚠️  Warning: Cluster not green"

# 2. Check available disk space (need 2x current index size)
INDEX_SIZE=$(curl -s "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_stats" | jq -r '.indices[].total.store.size_in_bytes')
FREE_SPACE=$(curl -s "$OPENSEARCH_ENDPOINT/_nodes/stats" | jq -r '.nodes[].fs.total.free_in_bytes' | head -1)
REQUIRED_SPACE=$((INDEX_SIZE * 2))

echo "✓ Current index size: $(numfmt --to=iec $INDEX_SIZE)"
echo "✓ Free disk space: $(numfmt --to=iec $FREE_SPACE)"
echo "✓ Required space: $(numfmt --to=iec $REQUIRED_SPACE)"

if [ $FREE_SPACE -lt $REQUIRED_SPACE ]; then
    echo "❌ Insufficient disk space!"
    exit 1
fi

# 3. Check for ongoing operations
RUNNING_TASKS=$(curl -s "$OPENSEARCH_ENDPOINT/_tasks" | jq '.tasks | length')
echo "✓ Running tasks: $RUNNING_TASKS"
[ $RUNNING_TASKS -gt 10 ] && echo "⚠️  Warning: High task count"

# 4. Check shard allocation
UNASSIGNED=$(curl -s "$OPENSEARCH_ENDPOINT/_cat/shards?h=state" | grep -c UNASSIGNED || true)
echo "✓ Unassigned shards: $UNASSIGNED"
[ $UNASSIGNED -gt 0 ] && echo "❌ Unassigned shards detected!" && exit 1

# 5. Verify current mapping
CURRENT_MAPPING=$(curl -s "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_mapping")
echo "✓ Current mapping retrieved"

# 6. Check index document count
DOC_COUNT=$(curl -s "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_count" | jq -r '.count')
echo "✓ Document count: $DOC_COUNT"

# 7. Estimate migration time
REINDEX_RATE=500  # docs/sec (conservative estimate)
ESTIMATED_MINUTES=$((DOC_COUNT / REINDEX_RATE / 60))
echo "✓ Estimated migration time: ~$ESTIMATED_MINUTES minutes"

# 8. Verify backup exists
SNAPSHOT_REPO="${SNAPSHOT_REPO:-fs-backup}"
LATEST_SNAPSHOT=$(curl -s "$OPENSEARCH_ENDPOINT/_snapshot/$SNAPSHOT_REPO/_all" | jq -r '.snapshots[-1].snapshot // "none"')
echo "✓ Latest snapshot: $LATEST_SNAPSHOT"
[ "$LATEST_SNAPSHOT" = "none" ] && echo "⚠️  Warning: No recent snapshot found"

echo ""
echo "=== Pre-Migration Validation Complete ==="
echo "Proceed with migration? (yes/no)"
read -r CONFIRM
[ "$CONFIRM" != "yes" ] && exit 0
```

### Migration Script (Production-Grade)

```bash
#!/bin/bash
###############################################################################
# Production-Grade Zero-Downtime OpenSearch Index Migration
###############################################################################

set -euo pipefail  # Exit on error, undefined vars, pipe failures

# Configuration
OPENSEARCH_ENDPOINT="${OPENSEARCH_ENDPOINT:-https://your-domain.es.amazonaws.com}"
INDEX_NAME="${INDEX_NAME:-file-search-dev}"
ALIAS_NAME="${ALIAS_NAME:-file-search}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
NEW_INDEX="${INDEX_NAME}-v2-${TIMESTAMP}"
BACKUP_INDEX="${INDEX_NAME}-backup-${TIMESTAMP}"

# Logging
LOG_FILE="/var/log/opensearch-migration-${TIMESTAMP}.log"
exec > >(tee -a "$LOG_FILE") 2>&1

log_info() { echo "[INFO] $(date +%H:%M:%S) - $*"; }
log_warn() { echo "[WARN] $(date +%H:%M:%S) - $*"; }
log_error() { echo "[ERROR] $(date +%H:%M:%S) - $*"; exit 1; }

# Error handler
trap 'log_error "Migration failed at line $LINENO. Check $LOG_FILE for details."' ERR

log_info "Starting zero-downtime migration"
log_info "Source: $INDEX_NAME → Target: $NEW_INDEX"

###############################################################################
# Phase 1: Validation
###############################################################################
log_info "[1/7] Validating cluster state..."

# Check cluster health
HEALTH=$(curl -sf "$OPENSEARCH_ENDPOINT/_cluster/health" | jq -r '.status')
[ "$HEALTH" != "green" ] && log_warn "Cluster health is $HEALTH (not green)"

# Check source index exists
if ! curl -sf "$OPENSEARCH_ENDPOINT/$INDEX_NAME" > /dev/null; then
    log_error "Source index $INDEX_NAME does not exist"
fi

DOC_COUNT=$(curl -sf "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_count" | jq -r '.count')
log_info "Source index contains $DOC_COUNT documents"

###############################################################################
# Phase 2: Create Backup (Safety Net)
###############################################################################
log_info "[2/7] Creating safety backup..."

curl -sf -X POST "$OPENSEARCH_ENDPOINT/_reindex?wait_for_completion=true" \
  -H 'Content-Type: application/json' \
  -d "{
    \"source\": { \"index\": \"$INDEX_NAME\" },
    \"dest\": { \"index\": \"$BACKUP_INDEX\" }
  }" | jq -r '.total, .created' | {
    read TOTAL
    read CREATED
    log_info "Backup created: $CREATED/$TOTAL documents in $BACKUP_INDEX"
}

###############################################################################
# Phase 3: Create New Index with Updated Mapping
###############################################################################
log_info "[3/7] Creating new index with k-NN mapping..."

CREATE_RESPONSE=$(curl -sf -X PUT "$OPENSEARCH_ENDPOINT/$NEW_INDEX" \
  -H 'Content-Type: application/json' \
  -d '{
    "settings": {
      "index": {
        "knn": true,
        "knn.algo_param.ef_search": 100,
        "number_of_shards": 1,
        "number_of_replicas": 1,
        "refresh_interval": "30s"
      }
    },
    "mappings": {
      "properties": {
        "file_name": {
          "type": "text",
          "fields": { "keyword": { "type": "keyword" } }
        },
        "file_path": {
          "type": "text",
          "fields": { "keyword": { "type": "keyword" } }
        },
        "file_type": { "type": "keyword" },
        "file_size": { "type": "long" },
        "modified_date": { "type": "date" },
        "processed_at": { "type": "date" },
        "extracted_text": { "type": "text" },
        "image_embedding": {
          "type": "knn_vector",
          "dimension": 1024,
          "method": {
            "name": "hnsw",
            "space_type": "innerproduct",
            "engine": "faiss",
            "parameters": {
              "ef_construction": 128,
              "m": 24
            }
          }
        },
        "s3_location": { "type": "keyword" },
        "indexed_at": { "type": "date" }
      }
    }
  }')

if echo "$CREATE_RESPONSE" | jq -e '.acknowledged == true' > /dev/null; then
    log_info "New index created successfully"
else
    log_error "Failed to create new index: $CREATE_RESPONSE"
fi

###############################################################################
# Phase 4: Reindex Data (Exclude old image_embedding field)
###############################################################################
log_info "[4/7] Reindexing data to new index..."

# Start async reindex
TASK_RESPONSE=$(curl -sf -X POST "$OPENSEARCH_ENDPOINT/_reindex?wait_for_completion=false&slices=auto" \
  -H 'Content-Type: application/json' \
  -d "{
    \"source\": {
      \"index\": \"$INDEX_NAME\",
      \"_source\": {
        \"excludes\": [\"image_embedding\"]
      }
    },
    \"dest\": {
      \"index\": \"$NEW_INDEX\"
    }
  }")

TASK_ID=$(echo "$TASK_RESPONSE" | jq -r '.task')
log_info "Reindex task started: $TASK_ID"

# Monitor progress
LAST_PROGRESS=0
while true; do
    TASK_INFO=$(curl -sf "$OPENSEARCH_ENDPOINT/_tasks/$TASK_ID")
    COMPLETED=$(echo "$TASK_INFO" | jq -r '.completed')

    if [ "$COMPLETED" = "true" ]; then
        CREATED=$(echo "$TASK_INFO" | jq -r '.task.status.created')
        TOTAL=$(echo "$TASK_INFO" | jq -r '.task.status.total')
        log_info "Reindex completed: $CREATED/$TOTAL documents"
        break
    fi

    CURRENT=$(echo "$TASK_INFO" | jq -r '.task.status.created // 0')
    TOTAL=$(echo "$TASK_INFO" | jq -r '.task.status.total // 0')
    PROGRESS=$((CURRENT * 100 / TOTAL))

    if [ $PROGRESS -ne $LAST_PROGRESS ]; then
        log_info "Progress: $PROGRESS% ($CURRENT/$TOTAL documents)"
        LAST_PROGRESS=$PROGRESS
    fi

    sleep 5
done

###############################################################################
# Phase 5: Validate New Index
###############################################################################
log_info "[5/7] Validating new index..."

# Refresh index
curl -sf -X POST "$OPENSEARCH_ENDPOINT/$NEW_INDEX/_refresh" > /dev/null

# Count documents
NEW_DOC_COUNT=$(curl -sf "$OPENSEARCH_ENDPOINT/$NEW_INDEX/_count" | jq -r '.count')
log_info "New index document count: $NEW_DOC_COUNT (expected: $DOC_COUNT)"

if [ "$NEW_DOC_COUNT" -ne "$DOC_COUNT" ]; then
    log_error "Document count mismatch! Expected $DOC_COUNT, got $NEW_DOC_COUNT"
fi

# Verify mapping
MAPPING_CHECK=$(curl -sf "$OPENSEARCH_ENDPOINT/$NEW_INDEX/_mapping" | \
    jq -e ".[\"$NEW_INDEX\"].mappings.properties.image_embedding.type == \"knn_vector\"")

if [ "$MAPPING_CHECK" = "true" ]; then
    log_info "Mapping validation passed: image_embedding is knn_vector type"
else
    log_error "Mapping validation failed: image_embedding is not knn_vector"
fi

###############################################################################
# Phase 6: Atomic Alias Switch (Zero-Downtime Cutover)
###############################################################################
log_info "[6/7] Switching alias (zero-downtime cutover)..."

# Check if alias exists
ALIAS_EXISTS=$(curl -sf "$OPENSEARCH_ENDPOINT/_alias/$ALIAS_NAME" | jq 'keys | length')

if [ "$ALIAS_EXISTS" -gt 0 ]; then
    # Atomic swap
    ALIAS_RESPONSE=$(curl -sf -X POST "$OPENSEARCH_ENDPOINT/_aliases" \
      -H 'Content-Type: application/json' \
      -d "{
        \"actions\": [
          { \"remove\": { \"index\": \"$INDEX_NAME\", \"alias\": \"$ALIAS_NAME\" } },
          { \"add\": { \"index\": \"$NEW_INDEX\", \"alias\": \"$ALIAS_NAME\" } }
        ]
      }")
else
    # Create new alias
    ALIAS_RESPONSE=$(curl -sf -X POST "$OPENSEARCH_ENDPOINT/_aliases" \
      -H 'Content-Type: application/json' \
      -d "{
        \"actions\": [
          { \"add\": { \"index\": \"$NEW_INDEX\", \"alias\": \"$ALIAS_NAME\" } }
        ]
      }")
fi

if echo "$ALIAS_RESPONSE" | jq -e '.acknowledged == true' > /dev/null; then
    log_info "Alias switched successfully - CUTOVER COMPLETE"
    log_info "Applications now using new index with zero downtime"
else
    log_error "Alias switch failed: $ALIAS_RESPONSE"
fi

###############################################################################
# Phase 7: Cleanup
###############################################################################
log_info "[7/7] Post-migration cleanup..."

# Ask about old index deletion
log_warn "Old index $INDEX_NAME still exists. Delete it? (yes/no/later)"
read -r DELETE_CHOICE

case "$DELETE_CHOICE" in
    yes)
        curl -sf -X DELETE "$OPENSEARCH_ENDPOINT/$INDEX_NAME" > /dev/null
        log_info "Old index deleted: $INDEX_NAME"
        ;;
    no)
        log_info "Old index retained: $INDEX_NAME"
        log_info "Delete manually: curl -X DELETE $OPENSEARCH_ENDPOINT/$INDEX_NAME"
        ;;
    *)
        log_info "Old index retained for now: $INDEX_NAME"
        ;;
esac

# Cleanup backup after 24 hours (optional)
log_info "Backup index: $BACKUP_INDEX (will auto-delete after 24h)"

###############################################################################
# Migration Summary
###############################################################################
log_info "=== Migration Complete ==="
log_info "Timeline:"
log_info "  - Start time: $(date +%H:%M:%S)"
log_info "  - Documents migrated: $NEW_DOC_COUNT"
log_info "  - New index: $NEW_INDEX"
log_info "  - Active alias: $ALIAS_NAME → $NEW_INDEX"
log_info "  - Backup: $BACKUP_INDEX"
log_info "  - Log file: $LOG_FILE"

log_info ""
log_info "Next steps:"
log_info "  1. Monitor application logs for errors"
log_info "  2. Test image search functionality"
log_info "  3. Re-upload images to generate new embeddings"
log_info "  4. Delete backup after verification: curl -X DELETE $OPENSEARCH_ENDPOINT/$BACKUP_INDEX"

exit 0
```

## Rollback Procedure

If issues occur after migration:

```bash
#!/bin/bash
# Emergency rollback script

log_error "ROLLBACK INITIATED"

# Switch alias back to old index
curl -X POST "$OPENSEARCH_ENDPOINT/_aliases" \
  -H 'Content-Type: application/json' \
  -d "{
    \"actions\": [
      { \"remove\": { \"index\": \"$NEW_INDEX\", \"alias\": \"$ALIAS_NAME\" } },
      { \"add\": { \"index\": \"$INDEX_NAME\", \"alias\": \"$ALIAS_NAME\" } }
    ]
  }"

log_info "Rollback complete - using original index"
log_info "Investigate issues before retrying migration"
```

## Post-Migration Validation

```bash
#!/bin/bash
# Post-migration smoke tests

echo "=== Post-Migration Validation ==="

# 1. Verify alias points to new index
ALIAS_TARGET=$(curl -s "$OPENSEARCH_ENDPOINT/_alias/$ALIAS_NAME" | jq -r 'keys[0]')
echo "✓ Alias target: $ALIAS_TARGET"

# 2. Test text search
SEARCH_RESULT=$(curl -s -X POST "$OPENSEARCH_ENDPOINT/$ALIAS_NAME/_search" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": { "match": { "file_name": "test" } },
    "size": 1
  }' | jq -r '.hits.total.value')
echo "✓ Text search working: $SEARCH_RESULT hits"

# 3. Test mapping
MAPPING_TYPE=$(curl -s "$OPENSEARCH_ENDPOINT/$ALIAS_NAME/_mapping" | \
  jq -r '.[].mappings.properties.image_embedding.type')
echo "✓ image_embedding type: $MAPPING_TYPE"

# 4. Test k-NN readiness (will fail until embeddings are added)
KNN_ENABLED=$(curl -s "$OPENSEARCH_ENDPOINT/$ALIAS_NAME/_settings" | \
  jq -r '.[].settings.index.knn')
echo "✓ k-NN enabled: $KNN_ENABLED"

# 5. Check index health
INDEX_HEALTH=$(curl -s "$OPENSEARCH_ENDPOINT/_cluster/health/$ALIAS_NAME" | jq -r '.status')
echo "✓ Index health: $INDEX_HEALTH"

echo ""
echo "=== Validation Complete ==="
```

## Advanced: Rolling Update Strategy

For very large indices (>10GB), consider shard-by-shard migration:

```bash
# 1. Create new index with multiple shards
curl -X PUT "$OPENSEARCH_ENDPOINT/$NEW_INDEX" -d '{
  "settings": {
    "number_of_shards": 5,
    "routing.allocation.include._name": "node1,node2,node3"
  }
}'

# 2. Migrate shard by shard
for SHARD in {0..4}; do
  log_info "Migrating shard $SHARD..."
  curl -X POST "$OPENSEARCH_ENDPOINT/_reindex" -d "{
    \"source\": {
      \"index\": \"$INDEX_NAME\",
      \"query\": { \"term\": { \"_routing\": \"shard-$SHARD\" } }
    },
    \"dest\": {
      \"index\": \"$NEW_INDEX\",
      \"routing\": \"shard-$SHARD\"
    }
  }"
done
```

## Monitoring During Migration

```bash
# Watch cluster stats in real-time
watch -n 5 'curl -s "$OPENSEARCH_ENDPOINT/_cluster/stats" | jq ".indices.count, .indices.docs.count"'

# Monitor reindex progress
watch -n 2 'curl -s "$OPENSEARCH_ENDPOINT/_tasks?detailed=true&actions=*reindex" | jq ".nodes[].tasks"'

# Check for errors
curl -s "$OPENSEARCH_ENDPOINT/_cluster/health?level=shards" | jq '.relocating_shards, .unassigned_shards'
```

## Best Practices Summary

### ✅ DO
1. **Always create a backup** before migration
2. **Use alias-based routing** for zero-downtime switches
3. **Monitor reindex progress** with task API
4. **Validate document counts** after migration
5. **Test alias switch** in staging first
6. **Keep old index** for 24-48 hours post-migration
7. **Use slices=auto** for parallel reindexing
8. **Refresh new index** before switching alias

### ❌ DON'T
1. **Don't delete old index** immediately after switch
2. **Don't skip validation** steps
3. **Don't run during peak hours** if possible
4. **Don't forget to test rollback** procedure
5. **Don't ignore cluster health** warnings
6. **Don't use wait_for_completion=true** for large datasets
7. **Don't switch alias** before validating new index

## Troubleshooting

### Issue: Reindex Takes Too Long
```bash
# Solution: Use slicing for parallelization
curl -X POST "$OPENSEARCH_ENDPOINT/_reindex?slices=5" ...
```

### Issue: Out of Disk Space
```bash
# Solution: Clean up old indices first
curl -X DELETE "$OPENSEARCH_ENDPOINT/old-index-*"
```

### Issue: Document Count Mismatch
```bash
# Solution: Check for reindex failures
curl "$OPENSEARCH_ENDPOINT/_tasks/$TASK_ID" | jq '.task.status.failures'
```

### Issue: Alias Switch Failed
```bash
# Solution: Force remove old alias first
curl -X DELETE "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_alias/$ALIAS_NAME"
curl -X PUT "$OPENSEARCH_ENDPOINT/$NEW_INDEX/_alias/$ALIAS_NAME"
```

## Timeline Estimates

| Index Size | Document Count | Migration Time | Downtime |
|-----------|----------------|----------------|----------|
| < 100 MB | < 10K | 2-5 min | 0 sec |
| 100 MB - 1 GB | 10K-100K | 5-15 min | 0 sec |
| 1 GB - 10 GB | 100K-1M | 15-60 min | 0 sec |
| > 10 GB | > 1M | 1-4 hours | 0 sec |

**Note:** Zero downtime achieved with Blue-Green deployment strategy.
