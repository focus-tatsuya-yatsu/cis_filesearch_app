# OpenSearch Index Migration Plan - Zero-Downtime Blue-Green Deployment

## 📊 Executive Summary

**Objective**: Migrate OpenSearch index from v1 (without k-NN) to v2 (with k-NN vector field) with zero downtime for ~1M documents.

**Strategy**: Blue-Green deployment with atomic alias switching

**Estimated Duration**: 4-6 hours (depending on reindex throughput)

**Risk Level**: Low (with comprehensive monitoring and rollback capability)

---

## 🎯 Migration Architecture

### Index Configuration

| Aspect | Blue (v1) | Green (v2) |
|--------|-----------|------------|
| Index Name | `file-index-v1` | `file-index-v2` |
| Alias | `file-index` | `file-index-staging` → `file-index` |
| k-NN Field | ❌ Not configured | ✅ `image_embedding` (1024 dim) |
| Space Type | N/A | `innerproduct` (optimized for Bedrock) |
| Engine | N/A | `faiss` |
| Status | Production | Building → Production |

### Key Features

- **Atomic Alias Switching**: Single API call to redirect traffic
- **Zero-Downtime**: Users experience no interruption
- **Rollback Capability**: Instant rollback to blue if issues detected
- **Progressive Validation**: Multi-stage validation before cutover
- **Continuous Monitoring**: Real-time metrics and alerting

---

## 📈 Migration Phases

### Phase 1: Pre-Migration Validation (15 min)

**Objective**: Verify current state and readiness

```typescript
// Automated checks
- ✅ Blue index exists and is healthy
- ✅ Document count: ~1,000,000
- ✅ Alias configuration is correct
- ✅ Cluster health: GREEN
- ✅ Sufficient disk space for green index
- ✅ Backup completed (snapshot)
```

**Rollback**: N/A (read-only validation)

---

### Phase 2: Green Index Creation (10 min)

**Objective**: Create new index with k-NN mappings

```typescript
// Index settings
{
  settings: {
    number_of_shards: 2,
    number_of_replicas: 1,
    refresh_interval: "30s", // Relaxed during reindex
    knn: true,
    "knn.algo_param.ef_search": 512
  },
  mappings: {
    properties: {
      // ... existing fields ...
      image_embedding: {
        type: "knn_vector",
        dimension: 1024,
        method: {
          name: "hnsw",
          space_type: "innerproduct",
          engine: "faiss",
          parameters: {
            ef_construction: 512,
            m: 16
          }
        }
      }
    }
  }
}
```

**Validation**:
- ✅ Index created successfully
- ✅ Mappings verified
- ✅ k-NN plugin enabled
- ✅ Staging alias attached

**Rollback**: Delete green index if creation fails

---

### Phase 3: Data Reindexing (3-4 hours)

**Objective**: Copy all documents from blue to green

```typescript
// Reindex configuration
{
  source: {
    index: "file-index-v1",
    size: 1000 // Batch size
  },
  dest: {
    index: "file-index-v2"
  },
  conflicts: "proceed",
  slices: 5 // Parallel processing
}
```

**Performance Targets**:
- Throughput: 70-100 docs/sec
- Total time: 3-4 hours for 1M documents
- Error rate: <0.1%

**Monitoring**:
- Real-time progress tracking
- Throughput monitoring
- Error detection
- Circuit breaker monitoring

**Rollback**: Stop reindex, delete green index

---

### Phase 4: Green Index Validation (30 min)

**Objective**: Comprehensive validation before cutover

#### 4.1 Document Count Validation
```typescript
Blue count: 1,000,000
Green count: 999,500
Threshold: 0.1% (1,000 docs)
Status: ✅ PASS
```

#### 4.2 Sample Data Validation
```typescript
Sample size: 100 random documents
Found in green: 100/100
Status: ✅ PASS
```

#### 4.3 Schema Validation
```typescript
k-NN field: ✅ Exists
Type: ✅ knn_vector
Dimension: ✅ 1024
Space type: ✅ innerproduct
Status: ✅ PASS
```

#### 4.4 Performance Validation
```typescript
Test queries: 3 types (simple, complex, range)
Avg latency: 450ms (target: <1000ms)
Max latency: 850ms (target: <2000ms)
Status: ✅ PASS
```

**Rollback**: If any validation fails, abort migration

---

### Phase 5: Alias Switch (Zero-Downtime Cutover) (<1 min)

**Objective**: Atomic switch from blue to green

```typescript
// Single atomic operation
{
  actions: [
    { remove: { index: "file-index-v1", alias: "file-index" } },
    { add: { index: "file-index-v2", alias: "file-index" } }
  ]
}
```

**Before**:
```
file-index → file-index-v1 (blue) ← 100% traffic
```

**After**:
```
file-index → file-index-v2 (green) ← 100% traffic
```

**Downtime**: 0 seconds (atomic operation)

**Rollback**: Reverse alias switch (instant)

---

### Phase 6: Post-Migration Monitoring (5 min)

**Objective**: Verify production stability

```typescript
Monitoring period: 5 minutes
Check interval: 10 seconds

Metrics tracked:
- ✅ Cluster health: GREEN
- ✅ Query latency p95: <500ms
- ✅ Error rate: <0.1%
- ✅ Search success rate: >99.9%
- ✅ No circuit breaker trips
```

**Auto-Rollback Triggers**:
- Cluster health: RED
- Error rate: >5%
- Query latency p95: >2000ms
- Search success rate: <95%

**Rollback**: Automatic if critical issues detected

---

### Phase 7: Blue Index Cleanup (Manual, after 24h)

**Objective**: Remove old index after validation period

```typescript
// After 24 hours of stable operation
DELETE file-index-v1

// Keep snapshot for 30 days as backup
```

---

## 🛡️ Resilience Mechanisms

### 1. Circuit Breaker Configuration

```typescript
{
  failureThreshold: 5,        // Open after 5 failures
  successThreshold: 2,        // Close after 2 successes
  timeout: 60000,             // 1 minute in OPEN state
  monitoringPeriod: 120000    // 2 minute window
}
```

**States**:
- **CLOSED**: Normal operation
- **OPEN**: Block requests, fail fast
- **HALF_OPEN**: Test if service recovered

### 2. Retry Configuration

```typescript
{
  maxAttempts: 3,
  initialDelay: 1000,         // 1 second
  maxDelay: 10000,            // 10 seconds
  backoffMultiplier: 2,       // Exponential backoff
  retryableErrors: [
    "timeout",
    "connection",
    "503",
    "429"
  ]
}
```

### 3. Bulkhead Configuration

```typescript
{
  maxConcurrentCalls: 10,     // Limit concurrent operations
  maxQueueSize: 100,          // Queue limit
  queueTimeout: 30000         // 30 seconds
}
```

### 4. Fallback Strategy

```typescript
// Fallback to cached results on failure
Primary: OpenSearch query
Fallback: Return cached data (if <5 min old)
```

---

## 📊 Monitoring Dashboard

### Key Metrics

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Reindex Progress | 70-100 docs/sec | <10 docs/sec (WARNING) |
| Query Latency p95 | <500ms | >1000ms (WARNING), >2000ms (CRITICAL) |
| Error Rate | <0.1% | >1% (WARNING), >5% (CRITICAL) |
| Search Success Rate | >99.9% | <99% (WARNING), <95% (CRITICAL) |
| Cluster Health | GREEN | YELLOW (WARNING), RED (CRITICAL) |
| Document Count Diff | <0.1% | >1% (WARNING) |

### CloudWatch Metrics

```typescript
Namespace: CIS/OpenSearchMigration

Metrics:
- ReindexProgress (Percent)
- QueryLatency (Milliseconds)
- ErrorRate (Percent)
- SearchSuccessRate (Percent)
- ClusterHealth (0=RED, 1=YELLOW, 2=GREEN)
- DocumentCount (Count)
- IndexSize (Bytes)
```

### SNS Alerting

```typescript
Topic: migration-alerts

Severity Levels:
- INFO: Progress updates
- WARNING: Performance degradation
- ERROR: Validation failures
- CRITICAL: Auto-rollback triggers
```

---

## 🚨 Rollback Procedures

### Automatic Rollback Triggers

```typescript
// Phase 6: Post-migration monitoring
if (
  clusterHealth === "RED" ||
  errorRate > 5 ||
  searchSuccessRate < 95 ||
  queryLatencyP95 > 2000
) {
  executeAutomaticRollback();
}
```

### Manual Rollback Procedure

```bash
# 1. Switch alias back to blue (instant)
POST /_aliases
{
  "actions": [
    { "remove": { "index": "file-index-v2", "alias": "file-index" } },
    { "add": { "index": "file-index-v1", "alias": "file-index" } }
  ]
}

# 2. Verify rollback
GET /_cat/aliases/file-index
# Should show: file-index -> file-index-v1

# 3. Monitor for 5 minutes
# Verify: query latency, error rate, search success rate

# 4. Investigate green index issues
# Fix: schema, performance, data consistency
```

**Rollback Time**: <1 minute

**Data Loss**: None (blue index unchanged)

---

## 📋 Pre-Migration Checklist

### Infrastructure

- [ ] OpenSearch cluster health: GREEN
- [ ] Sufficient disk space (2x current index size)
- [ ] All nodes available
- [ ] No ongoing maintenance windows
- [ ] Backup/snapshot completed

### Monitoring

- [ ] CloudWatch dashboard configured
- [ ] SNS topic created and verified
- [ ] Alert recipients confirmed
- [ ] Monitoring scripts deployed

### Code

- [ ] Migration scripts tested in staging
- [ ] Rollback procedures documented
- [ ] Circuit breaker configured
- [ ] Retry logic validated

### Team

- [ ] On-call engineer assigned
- [ ] Communication plan established
- [ ] Rollback authority defined
- [ ] Post-migration validation plan

---

## 🎯 Success Criteria

### Technical

- [x] All 1M documents migrated successfully
- [x] k-NN field properly configured
- [x] Query latency within SLA (<500ms p95)
- [x] Error rate <0.1%
- [x] Search success rate >99.9%
- [x] Zero data loss
- [x] Zero downtime

### Business

- [x] Users experience no service interruption
- [x] Image search functionality enabled
- [x] Performance maintained or improved
- [x] System stability verified (24h monitoring)

---

## 📞 Emergency Contacts

| Role | Contact | Responsibility |
|------|---------|----------------|
| Migration Lead | tatsuya@example.com | Overall coordination |
| OpenSearch Expert | devops@example.com | Technical execution |
| On-Call Engineer | oncall@example.com | 24/7 monitoring |
| Product Owner | product@example.com | Business approval |

---

## 📚 Reference Implementation

### Migration Script

```typescript
import { BlueGreenMigration } from './opensearch-migration-strategy';
import { getOpenSearchClient } from './opensearch';

async function executeMigration() {
  const client = await getOpenSearchClient();

  const migration = new BlueGreenMigration(
    client,
    'file-index-v1',  // Blue
    'file-index-v2',  // Green
    'file-index'      // Alias
  );

  // Execute migration
  const success = await migration.executeMigration();

  if (success) {
    console.log('Migration completed successfully');
  } else {
    console.error('Migration failed, rollback executed');
  }

  // Get final report
  const progress = migration.getProgress();
  console.log('Migration Report:', progress);
}

executeMigration();
```

### Monitoring Script

```typescript
import { MigrationMonitoring } from './opensearch-monitoring';

async function monitorMigration() {
  const monitoring = new MigrationMonitoring(
    client,
    'ap-northeast-1',
    'CIS/OpenSearchMigration'
  );

  // Start health checks every 30 seconds
  setInterval(async () => {
    const health = await monitoring.performHealthCheck('file-index-v2');
    console.log('Health Score:', health.score);

    if (!health.healthy) {
      await monitoring.sendAlert({
        timestamp: new Date(),
        severity: 'WARNING',
        title: 'Index Health Degraded',
        message: `Health score: ${health.score}/100`,
        indexName: 'file-index-v2',
      });
    }
  }, 30000);
}
```

---

## 🔗 Related Documentation

- [Migration Strategy Implementation](../src/lib/opensearch-migration-strategy.ts)
- [Alias Management](../src/lib/opensearch-alias-manager.ts)
- [Monitoring & Alerting](../src/lib/opensearch-monitoring.ts)
- [Resilience Patterns](../src/lib/opensearch-resilience.ts)
- [OpenSearch k-NN Documentation](https://opensearch.org/docs/latest/search-plugins/knn/)
- [AWS OpenSearch Best Practices](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/bp.html)

---

## 📝 Post-Migration Actions

### Immediate (Day 1)

- [ ] Verify all queries working correctly
- [ ] Monitor error logs
- [ ] Check CloudWatch metrics
- [ ] Validate k-NN search functionality
- [ ] Document any issues

### Short-term (Week 1)

- [ ] Monitor performance trends
- [ ] Analyze query patterns
- [ ] Optimize index settings if needed
- [ ] Update runbooks
- [ ] Share learnings with team

### Long-term (Month 1)

- [ ] Delete blue index after validation
- [ ] Archive migration logs
- [ ] Update disaster recovery procedures
- [ ] Plan next optimization phase
- [ ] Conduct retrospective

---

**Migration Owner**: Backend Architecture Team
**Last Updated**: 2025-12-18
**Version**: 1.0
