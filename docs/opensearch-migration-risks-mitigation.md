# OpenSearch Index Migration: Risks & Mitigation Strategies

## Executive Summary

This document outlines potential risks associated with migrating the OpenSearch index to support k-NN vector search, along with comprehensive mitigation strategies.

## Risk Assessment Matrix

| Risk | Severity | Probability | Impact | Mitigation Priority |
|------|----------|-------------|--------|-------------------|
| Data Loss During Migration | 🔴 Critical | Low | High | 🔥 Immediate |
| Service Downtime | 🟡 High | Medium | Medium | 🔥 Immediate |
| Performance Degradation | 🟡 High | Medium | Medium | ⚠️ High |
| Increased Costs | 🟢 Medium | High | Low | ℹ️ Medium |
| Rollback Complexity | 🟡 High | Low | High | ⚠️ High |
| Index Corruption | 🔴 Critical | Very Low | Critical | 🔥 Immediate |

## Critical Risks

### 1. Data Loss During Migration

#### Risk Description
- Reindex operation fails midway
- Source index deleted before verification
- Backup index corrupted or incomplete

#### Impact
- ❌ Complete loss of search functionality
- ❌ Need to rebuild index from S3 (hours to days)
- ❌ Business continuity severely affected

#### Mitigation Strategy

**BEFORE Migration:**
```bash
# 1. Create snapshot backup
curl -X PUT "$OPENSEARCH_ENDPOINT/_snapshot/fs-backup/migration-backup-$(date +%Y%m%d)" \
  -H 'Content-Type: application/json' \
  -d "{
    \"indices\": \"$INDEX_NAME\",
    \"ignore_unavailable\": true,
    \"include_global_state\": false
  }"

# 2. Verify snapshot completed
curl "$OPENSEARCH_ENDPOINT/_snapshot/fs-backup/migration-backup-*/_status"

# 3. Export critical metadata
curl "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_mapping" > mapping-backup.json
curl "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_settings" > settings-backup.json
curl "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_count" > count-backup.json
```

**DURING Migration:**
```bash
# 1. Use Blue-Green deployment (NEVER delete source index immediately)
# 2. Validate document counts match
SOURCE_COUNT=$(curl -s "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_count" | jq -r '.count')
DEST_COUNT=$(curl -s "$OPENSEARCH_ENDPOINT/$NEW_INDEX/_count" | jq -r '.count')

if [ "$SOURCE_COUNT" -ne "$DEST_COUNT" ]; then
    echo "ERROR: Document count mismatch!"
    exit 1
fi

# 3. Sample validation - compare random documents
curl "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_search?size=10" > source-sample.json
curl "$OPENSEARCH_ENDPOINT/$NEW_INDEX/_search?size=10" > dest-sample.json
```

**AFTER Migration:**
```bash
# Keep old index for 7 days minimum
# Set up auto-deletion using Curator or Index Lifecycle Management
curl -X PUT "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_settings" \
  -d '{"index.blocks.write": true}'  # Make read-only
```

**Recovery Plan:**
```bash
# If issues detected after cutover:
# 1. Immediately switch alias back to old index
curl -X POST "$OPENSEARCH_ENDPOINT/_aliases" -d '{
  "actions": [
    {"remove": {"index": "$NEW_INDEX", "alias": "$ALIAS_NAME"}},
    {"add": {"index": "$INDEX_NAME", "alias": "$ALIAS_NAME"}}
  ]
}'

# 2. Restore from snapshot if needed
curl -X POST "$OPENSEARCH_ENDPOINT/_snapshot/fs-backup/migration-backup-*/_restore"
```

**Risk Level After Mitigation:** 🟢 Low

---

### 2. Service Downtime / Availability Impact

#### Risk Description
- Users cannot search during migration
- API returns errors during alias switch
- Reindex operation takes longer than expected

#### Impact
- ❌ User frustration and support tickets
- ❌ Lost productivity
- ❌ Potential SLA violations

#### Mitigation Strategy

**Use Zero-Downtime Blue-Green Deployment:**

```bash
# ✅ CORRECT: Atomic alias switch (0 downtime)
curl -X POST "$OPENSEARCH_ENDPOINT/_aliases" -d '{
  "actions": [
    {"remove": {"index": "old-index", "alias": "search"}},
    {"add": {"index": "new-index", "alias": "search"}}
  ]
}'
# ↑ This operation is atomic - no gap in service

# ❌ WRONG: Delete old index then create new (causes downtime)
curl -X DELETE "$OPENSEARCH_ENDPOINT/file-search-dev"
curl -X PUT "$OPENSEARCH_ENDPOINT/file-search-dev" -d '{...}'
```

**Application-Level Resilience:**

```typescript
// frontend/src/lib/opensearch.ts
export async function searchDocuments(query: SearchQuery): Promise<SearchResponse> {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.search({
        index: ALIAS_NAME,  // Always use alias, not direct index name
        body: buildQuery(query),
      });
      return transformResponse(response);
    } catch (error: any) {
      lastError = error;

      // Retry on transient errors
      if (error.statusCode === 503 || error.code === 'ECONNRESET') {
        console.warn(`Search attempt ${attempt}/${maxRetries} failed, retrying...`);
        await sleep(1000 * attempt);  // Exponential backoff
        continue;
      }

      // Don't retry on client errors
      throw error;
    }
  }

  throw lastError;
}
```

**Migration Timing:**
```bash
# Schedule during low-traffic period
OPTIMAL_HOURS="02:00-04:00 JST"  # Typical low-traffic window

# Check current query rate
curl "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_stats" | \
  jq '.indices[].total.search.query_total'
```

**Monitoring During Migration:**
```bash
# Real-time health monitoring
watch -n 5 'curl -s "$OPENSEARCH_ENDPOINT/_cluster/health" | jq ".status, .number_of_nodes"'

# Alert on errors
aws cloudwatch put-metric-alarm \
  --alarm-name opensearch-migration-errors \
  --metric-name 5xx \
  --threshold 10 \
  --evaluation-periods 2
```

**Risk Level After Mitigation:** 🟢 Low (with Blue-Green) / 🔴 High (without)

---

### 3. Performance Degradation Post-Migration

#### Risk Description
- k-NN queries slower than expected
- Index size larger than anticipated
- Memory pressure on OpenSearch nodes
- Higher CPU utilization

#### Impact
- 🟡 Search latency increases (100ms → 500ms)
- 🟡 User experience degradation
- 🟡 Need to scale infrastructure (unexpected costs)

#### Mitigation Strategy

**Pre-Migration Capacity Planning:**

```bash
# Calculate expected index size
CURRENT_SIZE=$(curl -s "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_stats" | \
  jq -r '.indices[].total.store.size_in_bytes')

# k-NN overhead estimation
# Formula: new_size ≈ current_size + (docs × 1024 × 4 bytes × (1 + m/10))
DOC_COUNT=$(curl -s "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_count" | jq -r '.count')
KNN_OVERHEAD=$((DOC_COUNT * 1024 * 4 * (1 + 24/10)))

echo "Current index size: $(numfmt --to=iec $CURRENT_SIZE)"
echo "Estimated k-NN overhead: $(numfmt --to=iec $KNN_OVERHEAD)"
echo "Total estimated size: $(numfmt --to=iec $((CURRENT_SIZE + KNN_OVERHEAD)))"

# Recommended instance upgrade if needed
CURRENT_INSTANCE="t3.medium.search"
RECOMMENDED_INSTANCE="r6g.large.search"  # Memory-optimized for k-NN
```

**Performance Testing BEFORE Production Cutover:**

```bash
#!/bin/bash
# performance-test.sh

echo "=== Performance Benchmark ==="

# 1. Test pure k-NN search
for k in 10 20 50 100; do
  echo "Testing k=$k..."
  time curl -X POST "$OPENSEARCH_ENDPOINT/$NEW_INDEX/_search" \
    -H 'Content-Type: application/json' \
    -d "{
      \"size\": 10,
      \"query\": {
        \"knn\": {
          \"image_embedding\": {
            \"vector\": $(cat test-embedding-1024.json),
            \"k\": $k
          }
        }
      }
    }"
done

# 2. Test hybrid search
echo "Testing hybrid search..."
time curl -X POST "$OPENSEARCH_ENDPOINT/$NEW_INDEX/_search" \
  -d "{
    \"query\": {
      \"bool\": {
        \"should\": [
          {\"knn\": {\"image_embedding\": {\"vector\": [...], \"k\": 20}}},
          {\"multi_match\": {\"query\": \"report\", \"fields\": [\"file_name\", \"file_path\"]}}
        ]
      }
    }
  }"

# 3. Load testing with vegeta
echo "GET $OPENSEARCH_ENDPOINT/$NEW_INDEX/_search" | \
  vegeta attack -duration=60s -rate=50/s | \
  vegeta report -type=text

# Success criteria:
# - P95 latency < 200ms
# - P99 latency < 500ms
# - 0% error rate
```

**Optimization Tuning:**

```json
// If performance is suboptimal, tune these settings:

// 1. Lower ef_search for better speed (trade-off: recall)
{
  "index.knn.algo_param.ef_search": 80  // Down from 100
}

// 2. Adjust HNSW parameters (requires reindex)
{
  "image_embedding": {
    "method": {
      "parameters": {
        "ef_construction": 100,  // Down from 128
        "m": 16  // Down from 24
      }
    }
  }
}

// 3. Increase shard count for parallelization (>500K docs)
{
  "settings": {
    "number_of_shards": 3  // Up from 1
  }
}
```

**Post-Migration Monitoring:**

```python
# CloudWatch Dashboard
import boto3

cloudwatch = boto3.client('cloudwatch')

# Monitor these metrics:
METRICS_TO_WATCH = [
    'SearchLatency',           # Should be < 200ms P95
    'JVMMemoryPressure',       # Should be < 85%
    'CPUUtilization',          # Should be < 70%
    'SearchRate',              # QPS
    'ClusterStatus.yellow',    # Should be 0
]

# Alert if P95 latency > 300ms
cloudwatch.put_metric_alarm(
    AlarmName='OpenSearch-High-Latency',
    MetricName='SearchLatency',
    Threshold=300,
    ComparisonOperator='GreaterThanThreshold',
    Statistic='Average',
    Period=300,
)
```

**Risk Level After Mitigation:** 🟡 Medium (can be tuned)

---

## Medium Risks

### 4. Increased Infrastructure Costs

#### Risk Description
- Larger index size increases storage costs
- May need larger instance types (more memory for k-NN)
- Higher data transfer costs

#### Impact
- 💰 Monthly AWS costs increase by 30-50%
- 💰 Unexpected budget overrun

#### Cost Estimation

```bash
# Current costs (example)
CURRENT_INSTANCE_COST=$120/month  # t3.medium.search
CURRENT_STORAGE_COST=$30/month    # 100GB
TOTAL_CURRENT=$150/month

# Estimated costs after k-NN
STORAGE_INCREASE=2.5x  # 100GB → 250GB
NEW_INSTANCE=r6g.large.search  # $180/month
NEW_STORAGE_COST=$75/month  # 250GB

TOTAL_NEW=$255/month
INCREASE=70%

echo "Cost increase: $((TOTAL_NEW - TOTAL_CURRENT))/month"
```

#### Mitigation Strategy

**Cost Optimization:**

1. **Use Graviton instances** (30% cheaper than x86)
```bash
# r6g.large.search instead of r5.large.search
# Savings: ~$50/month
```

2. **Optimize index settings** to reduce size:
```json
{
  "settings": {
    "refresh_interval": "60s",  // Less frequent refreshes
    "number_of_replicas": 1,     // Not 2
    "codec": "best_compression"  // Compress stored fields
  }
}
```

3. **Use Index Lifecycle Management** (ILM):
```json
// Auto-delete old indices
{
  "policy": {
    "phases": {
      "hot": { "min_age": "0ms" },
      "warm": { "min_age": "30d" },
      "delete": { "min_age": "90d" }
    }
  }
}
```

4. **Consider Reserved Instances** (40% discount):
```bash
# If running 24/7, buy 1-year reserved capacity
aws opensearch purchase-reserved-instance \
  --reserved-instance-offering-id <offering-id>
```

**Risk Level After Mitigation:** 🟢 Low (predictable)

---

### 5. Rollback Complexity

#### Risk Description
- Cannot easily revert to old mapping
- Rollback requires another full reindex
- May lose data added after migration

#### Impact
- ⏱️ Extended downtime during rollback
- 😰 Stress and pressure on ops team

#### Mitigation Strategy

**Keep Old Index Intact for 7 Days:**
```bash
# After successful cutover
curl -X PUT "$OPENSEARCH_ENDPOINT/$OLD_INDEX/_settings" -d '{
  "index.blocks.write": true,      // Read-only
  "index.refresh_interval": "-1"   // Stop refreshing
}'

# Auto-delete after 7 days (using cron)
echo "0 2 * * * curl -X DELETE $OPENSEARCH_ENDPOINT/$OLD_INDEX" | crontab -
```

**Maintain Parallel Write Path (Advanced):**
```typescript
// During migration period, write to BOTH indices
export async function indexDocument(doc: Document) {
  await Promise.all([
    client.index({ index: OLD_INDEX, body: doc }),
    client.index({ index: NEW_INDEX, body: doc }),
  ]);
}
```

**Fast Rollback Script:**
```bash
#!/bin/bash
# emergency-rollback.sh

set -e

echo "🚨 EMERGENCY ROLLBACK INITIATED"

# 1. Switch alias back (instant)
curl -X POST "$OPENSEARCH_ENDPOINT/_aliases" -d '{
  "actions": [
    {"remove": {"index": "new-index", "alias": "search"}},
    {"add": {"index": "old-index", "alias": "search"}}
  ]
}'

echo "✅ Rollback complete in <1 second"
echo "⚠️  Old index is active. Investigate new index issues."
```

**Risk Level After Mitigation:** 🟡 Medium (manageable with Blue-Green)

---

### 6. Index Corruption Risk

#### Risk Description
- Hardware failure during reindex
- Network interruption during migration
- OpenSearch process crash mid-operation

#### Impact
- 🔴 Index unusable, needs rebuild
- 🔴 Extended downtime (hours)

#### Mitigation Strategy

**Pre-Flight Checks:**
```bash
# 1. Verify cluster health is GREEN
HEALTH=$(curl -s "$OPENSEARCH_ENDPOINT/_cluster/health" | jq -r '.status')
[ "$HEALTH" != "green" ] && echo "Abort: Cluster not healthy" && exit 1

# 2. Check disk space (need 2x current size)
# 3. Verify no ongoing snapshots or restores
# 4. Check shard allocation is stable
```

**Use Transactional Snapshots:**
```bash
# Before any destructive operation
curl -X PUT "$OPENSEARCH_ENDPOINT/_snapshot/fs-backup/pre-migration" -d '{
  "indices": "file-search-dev",
  "include_global_state": false
}'

# Verify snapshot succeeded
STATUS=$(curl -s "$OPENSEARCH_ENDPOINT/_snapshot/fs-backup/pre-migration/_status" | \
  jq -r '.snapshots[0].state')
[ "$STATUS" != "SUCCESS" ] && exit 1
```

**Enable Cluster Monitoring:**
```bash
# Alert on yellow/red status
aws sns create-topic --name opensearch-alerts
aws cloudwatch put-metric-alarm \
  --alarm-name cluster-red \
  --metric-name ClusterStatus.red \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold
```

**Risk Level After Mitigation:** 🟢 Very Low (with snapshots)

---

## Minor Risks

### 7. Version Compatibility Issues

#### Risk Description
- OpenSearch version doesn't support k-NN features
- FAISS engine not available in region

#### Mitigation
```bash
# Check OpenSearch version
VERSION=$(curl -s "$OPENSEARCH_ENDPOINT" | jq -r '.version.number')
echo "OpenSearch version: $VERSION"

# k-NN requires OpenSearch 1.0+
# FAISS requires OpenSearch 1.2+
```

**Risk Level:** 🟢 Low (AWS OpenSearch Service supports all features)

---

### 8. Embedding Dimension Mismatch

#### Risk Description
- Code generates embeddings with wrong dimension (e.g., 512 instead of 1024)
- Results in indexing failures

#### Mitigation
```typescript
// Validation in image-embedding API
if (embedding.length !== 1024) {
  throw new Error(`Invalid embedding dimension: ${embedding.length}, expected 1024`);
}

// Unit test
test('Bedrock Titan generates 1024-dim embeddings', async () => {
  const embedding = await generateImageEmbedding(testImage);
  expect(embedding).toHaveLength(1024);
});
```

**Risk Level:** 🟢 Very Low (with validation)

---

## Risk Mitigation Checklist

### Pre-Migration (1 day before)
- [ ] Create full snapshot backup
- [ ] Verify cluster health is GREEN
- [ ] Check disk space (need 2x current index size)
- [ ] Export mapping and settings JSON
- [ ] Test rollback procedure in staging
- [ ] Schedule migration during low-traffic window
- [ ] Alert on-call team

### During Migration
- [ ] Use Blue-Green deployment script
- [ ] Monitor cluster health continuously
- [ ] Validate document counts match
- [ ] Test search queries on new index before cutover
- [ ] Perform atomic alias switch

### Post-Migration (1 week)
- [ ] Monitor search latency (P95 < 200ms)
- [ ] Monitor JVM memory pressure (< 85%)
- [ ] Monitor error rates (< 0.1%)
- [ ] Keep old index for 7 days
- [ ] Schedule backup deletion

## Recommended Tools

### Monitoring Stack
```bash
# 1. Cerebro - OpenSearch GUI
docker run -p 9000:9000 lmenezes/cerebro:latest

# 2. OpenSearch Dashboards
# Already included with AWS OpenSearch Service

# 3. CloudWatch Dashboards
# Create custom dashboard with key metrics
```

### Testing Tools
```bash
# Load testing
apt-get install vegeta

# Performance profiling
curl "$OPENSEARCH_ENDPOINT/$INDEX/_search?profile=true" -d '{...}'
```

## Conclusion

**Overall Risk Level:** 🟡 MEDIUM (manageable)

With proper planning and the Blue-Green deployment strategy:
- ✅ Zero downtime achievable
- ✅ Data loss risk minimal (with snapshots)
- ✅ Easy rollback within seconds
- ✅ Performance predictable with testing

**Key Success Factors:**
1. Use Blue-Green deployment (NOT in-place update)
2. Create snapshots before ANY destructive operation
3. Test thoroughly in staging environment
4. Monitor metrics continuously
5. Keep old index for 7 days minimum

**Recommended Migration Timeline:**
- Week 1: Staging environment migration + testing
- Week 2: Production migration during low-traffic window
- Week 3-4: Monitor performance, keep old index as backup
- Week 4: Delete old index if no issues

By following these mitigation strategies, the migration can be performed safely with minimal risk.
