# Best Practices for Recovering from Partial Migrations

**Document Version**: 1.0
**Last Updated**: 2025-12-18
**Applicable To**: OpenSearch, Elasticsearch, database migrations

---

## Table of Contents

1. [Immediate Response Checklist](#immediate-response-checklist)
2. [State Assessment Framework](#state-assessment-framework)
3. [Recovery Decision Matrix](#recovery-decision-matrix)
4. [Data Loss Prevention](#data-loss-prevention)
5. [Zero-Downtime Recovery Strategies](#zero-downtime-recovery-strategies)
6. [Preventive Architecture Patterns](#preventive-architecture-patterns)

---

## Immediate Response Checklist

### ⏱️ First 5 Minutes

**Priority 1: STOP THE DAMAGE**

- [ ] **Halt all automated processes**
  - Stop migration scripts
  - Pause CI/CD pipelines
  - Disable cron jobs affecting the system

- [ ] **Freeze write operations** (if safe to do so)
  - Put application in read-only mode
  - Disable background workers
  - Pause message queue consumers

- [ ] **Assess blast radius**
  - What systems are affected?
  - Are users impacted?
  - Is data actively being lost?

**Priority 2: PRESERVE EVIDENCE**

- [ ] **Capture current state**
  ```bash
  # OpenSearch example
  curl -XGET "https://<ENDPOINT>/_cat/indices?v" > indices-snapshot-$(date +%s).txt
  curl -XGET "https://<ENDPOINT>/_cat/aliases?v" > aliases-snapshot-$(date +%s).txt
  curl -XGET "https://<ENDPOINT>/_cluster/health?pretty" > health-snapshot-$(date +%s).txt
  ```

- [ ] **Save logs immediately**
  - Application logs
  - Database/OpenSearch logs
  - CloudWatch/monitoring logs
  - Migration script output

- [ ] **Take emergency snapshot**
  ```bash
  # Even if data is corrupted, preserve it for forensics
  curl -XPUT "https://<ENDPOINT>/_snapshot/<repo>/emergency-$(date +%s)" -d '{
    "indices": "*",
    "include_global_state": true
  }'
  ```

**Priority 3: ACTIVATE INCIDENT RESPONSE**

- [ ] Declare incident severity (P0/P1/P2)
- [ ] Notify incident commander
- [ ] Assemble response team
- [ ] Start incident timeline log

### ⏱️ First 30 Minutes

**Assessment Phase**

- [ ] **Verify backup integrity**
  - Confirm pre-migration backup exists
  - Validate backup is complete (not partial)
  - Document backup document counts

- [ ] **Quantify data loss**
  - Compare current state vs backup
  - Identify missing/corrupted documents
  - Calculate percentage of data affected

- [ ] **Determine recovery path**
  - Full restore from backup?
  - Partial reindex?
  - Continue migration?
  - No action needed?

- [ ] **Estimate recovery time**
  - Time to restore from backup
  - Time to reindex data
  - Time to validate recovery

---

## State Assessment Framework

### Migration State Classification

| State | Description | Risk Level | Recommended Action |
|-------|-------------|------------|-------------------|
| **Pre-Migration** | Backup created, no changes made | 🟢 Low | Continue migration OR abort safely |
| **Partial Schema Change** | New index created, no data moved | 🟡 Medium | Delete new index, retry migration |
| **Mid-Reindex** | Data copying in progress | 🟠 High | Stop reindex, assess data integrity |
| **Post-Reindex, Pre-Switch** | Data copied, alias not switched | 🟡 Medium | Validate data, proceed with switch |
| **Mid-Switch** | Alias partially updated | 🔴 Critical | Complete switch OR full rollback |
| **Post-Switch** | Alias switched, old index exists | 🟢 Low | Monitor, cleanup old index |
| **Cleanup Phase** | Old index deleted | 🟢 Low | Normal operation |

### Data Integrity Levels

**Level 1: Perfect Integrity** ✅
- Current index matches backup exactly
- No data loss
- All mappings correct
- **Action**: No recovery needed, document incident

**Level 2: Acceptable Variance** ⚠️
- Minor differences (<0.1% documents)
- Likely due to concurrent writes during migration
- Functional mappings
- **Action**: Document variance, accept if within tolerance

**Level 3: Significant Data Loss** 🔴
- Missing >0.1% of documents
- Critical documents missing
- Incorrect mappings affecting functionality
- **Action**: Immediate rollback required

**Level 4: Critical Corruption** 💀
- Index unreadable
- Search functionality broken
- Severe data loss (>5%)
- **Action**: Emergency restore, escalate to senior engineers

---

## Recovery Decision Matrix

### Decision Tree

```
1. Is there a valid backup?
   ├─ NO → Escalate to senior team, engage disaster recovery
   └─ YES → Continue to Q2

2. Is current index accessible?
   ├─ NO → RESTORE from backup (no other option)
   └─ YES → Continue to Q3

3. Run document count comparison
   Backup count: _____
   Current count: _____
   Difference: _____

   Is difference within acceptable threshold (<0.1%)?
   ├─ YES → Continue to Q4
   └─ NO → Continue to Q5

4. Is search functionality working?
   ├─ YES → No recovery needed. Document incident, implement monitoring.
   └─ NO → Check mappings (Q6)

5. Can we identify missing documents?
   ├─ YES → SELECTIVE RESTORE (reindex only missing docs)
   └─ NO → FULL RESTORE from backup

6. Are mappings correct (k-NN field if required)?
   ├─ YES → Investigate performance issue
   └─ NO → Blue-green migration required (cannot modify mappings in-place)
```

### Recovery Method Selection

| Scenario | Method | Downtime | Data Loss Risk | Complexity |
|----------|--------|----------|----------------|------------|
| Backup OK, Current OK | **No Action** | None | None | Low |
| Backup OK, Current Missing <0.1% | **Selective Reindex** | None | None (if backup complete) | Medium |
| Backup OK, Current Missing >0.1% | **Full Restore** | Minutes to hours | None (if backup complete) | Medium |
| Backup OK, Current Corrupted | **Emergency Restore** | Minutes to hours | None (if backup complete) | Medium |
| Backup Invalid, Current OK | **No Rollback** | None | None | Low |
| Backup Invalid, Current Corrupted | **Disaster Recovery** | Hours to days | High | Critical |

---

## Data Loss Prevention

### Pre-Migration Safeguards

**1. Automated Pre-Flight Checks**

```typescript
// opensearch-preflight-validation.ts
export async function validateMigrationPrerequisites(
  client: Client,
  sourceIndex: string,
  targetIndex: string
): Promise<ValidationReport> {
  const checks = [];

  // Check 1: Source index exists and is healthy
  checks.push(await validateSourceHealth(client, sourceIndex));

  // Check 2: Network connectivity (VPC access)
  checks.push(await validateNetworkAccess(client));

  // Check 3: Backup exists and is recent
  checks.push(await validateBackupExists(client, sourceIndex));

  // Check 4: Sufficient disk space
  checks.push(await validateDiskSpace(client));

  // Check 5: No concurrent migrations
  checks.push(await validateNoActiveMigrations(client));

  // Check 6: Index names match configuration
  checks.push(await validateIndexNameConsistency(sourceIndex));

  const allPassed = checks.every(c => c.passed);

  return {
    passed: allPassed,
    checks,
    recommendation: allPassed
      ? 'Safe to proceed with migration'
      : 'ABORT: Fix validation failures before proceeding'
  };
}
```

**2. Circuit Breaker Pattern** (Already implemented in `opensearch-migration-strategy.ts`)

```typescript
class CircuitBreaker {
  // Prevents cascade failures
  // Automatically stops migration on repeated errors
  // Allows manual retry after cooldown period
}
```

**3. Incremental Checkpoints**

```typescript
// Save progress at each phase
const MIGRATION_PHASES = [
  'VALIDATING',
  'BACKUP_CREATED',    // ← Checkpoint
  'GREEN_CREATED',     // ← Checkpoint
  'REINDEX_STARTED',
  'REINDEX_50%',       // ← Checkpoint
  'REINDEX_100%',      // ← Checkpoint
  'VALIDATED',         // ← Checkpoint
  'ALIAS_SWITCHED',    // ← Checkpoint
  'COMPLETED'
];

// On failure, resume from last checkpoint instead of restarting
```

### During Migration Safeguards

**1. Real-Time Monitoring**

```bash
# Monitor document count during migration
while true; do
  echo "$(date) - Docs: $(curl -s https://<ENDPOINT>/<INDEX>/_count | jq .count)"
  sleep 10
done
```

**2. Canary Queries**

```typescript
// Run test queries during migration to detect issues early
const CANARY_QUERIES = [
  { term: { file_type: 'pdf' } },
  { match: { file_name: 'test' } },
  { range: { file_size: { gte: 0 } } }
];

setInterval(async () => {
  for (const query of CANARY_QUERIES) {
    try {
      await client.search({ index, body: { query, size: 1 } });
    } catch (error) {
      logger.error('Canary query failed', { query, error });
      // Trigger circuit breaker
    }
  }
}, 30000); // Every 30 seconds
```

**3. Progressive Rollout**

```typescript
// Phase 1: Test with 1% of traffic
await switchAlias(newIndex, { routing: '0-1' });
await monitorErrorRate(duration: 300); // 5 min

// Phase 2: Test with 10% of traffic
await switchAlias(newIndex, { routing: '0-10' });
await monitorErrorRate(duration: 600); // 10 min

// Phase 3: Full cutover
await switchAlias(newIndex, { routing: '*' });
```

### Post-Migration Safeguards

**1. Validation Suite**

```typescript
interface PostMigrationValidation {
  documentCount: ValidationResult;
  sampleData: ValidationResult;
  schema: ValidationResult;
  performance: ValidationResult;
  search: ValidationResult;
}

// All validations must pass before declaring migration successful
```

**2. Monitoring Window**

```typescript
// Monitor for 5-15 minutes after switch
const MONITORING_DURATION = 15 * 60 * 1000; // 15 minutes

await monitorPostSwitch({
  duration: MONITORING_DURATION,
  metrics: [
    'error_rate',
    'latency_p95',
    'document_count',
    'search_failures'
  ],
  thresholds: {
    error_rate: 0.01,      // <1% errors
    latency_p95: 500,      // <500ms p95 latency
    search_failures: 0.001 // <0.1% search failures
  },
  onThresholdExceeded: async () => {
    logger.critical('Threshold exceeded, rolling back');
    await rollback();
  }
});
```

**3. Gradual Cleanup**

```bash
# Do NOT delete old index immediately
# Keep for 7 days for forensics and emergency rollback

# Day 0: Migration complete, keep both indices
# Day 1-3: Monitor new index
# Day 4-7: Old index read-only (emergency rollback available)
# Day 8: Delete old index

# Automated retention policy
PUT /_snapshot/<repo>/retention_policy
{
  "schedule": "0 0 * * *",
  "retention": {
    "expire_after": "7d",
    "min_count": 3,
    "max_count": 10
  }
}
```

---

## Zero-Downtime Recovery Strategies

### Strategy 1: Alias-Based Instant Rollback

**Scenario**: New index has issues, need to revert to old index

```bash
# Instant rollback (atomic operation, <1 second downtime)
curl -XPOST "https://<ENDPOINT>/_aliases" -d '{
  "actions": [
    { "remove": { "index": "file-index-green", "alias": "file-index" } },
    { "add": { "index": "file-index-blue", "alias": "file-index" } }
  ]
}'
```

**Advantages**:
- Sub-second switchover
- No data loss
- Users unaffected

**Requirements**:
- Old index must still exist
- Old index must be up-to-date

### Strategy 2: Parallel Indexing During Recovery

**Scenario**: Need to rebuild index without stopping writes

```typescript
// Write to BOTH old and new index during recovery
async function dualWrite(document: FileDocument) {
  await Promise.all([
    indexToOld(document),  // Current production index
    indexToNew(document)   // New index being rebuilt
  ]);
}

// After new index catches up, switch alias
```

**Advantages**:
- Zero data loss
- No write downtime

**Disadvantages**:
- Increased write latency
- Temporary storage cost

### Strategy 3: Read-From-Old, Write-To-New

**Scenario**: New index is being rebuilt, need to maintain service

```typescript
// Reads continue from old index (low latency)
async function search(query: SearchQuery) {
  return await searchOldIndex(query);
}

// Writes go to new index only
async function index(document: FileDocument) {
  await indexToNewIndex(document);
  // Optionally also write to old for consistency
}

// When new index ready, switch reads to new index
```

---

## Preventive Architecture Patterns

### Pattern 1: Blue-Green Deployment (Implemented)

**Code**: `/src/lib/opensearch-migration-strategy.ts`

```
Production Traffic → Alias "file-index" → Blue Index (v1)
                                       ↘ Green Index (v2) [standby]

Migration Phase:
1. Create Green with new mappings
2. Reindex Blue → Green
3. Validate Green
4. Switch Alias: file-index → Green
5. Blue becomes standby for rollback
```

**Benefits**:
- Instant rollback capability
- Zero-downtime migrations
- Safe testing before cutover

### Pattern 2: Index Versioning

```
Current: file-index (alias) → file-index-v1-2025-12-18 (physical index)

Migration:
file-index (alias) → file-index-v2-2025-12-19 (new physical index)

Rollback (if needed):
file-index (alias) → file-index-v1-2025-12-18 (instant revert)
```

**Implementation**:

```typescript
const INDEX_VERSION = process.env.INDEX_VERSION || 'v1';
const PHYSICAL_INDEX = `file-index-${INDEX_VERSION}-${dateString}`;
const ALIAS = 'file-index';

// Application always uses alias, never physical index name
await client.search({ index: ALIAS, body: { query } });
```

### Pattern 3: Write-Ahead Log (WAL) for Recovery

**Scenario**: Ensure no writes are lost during migration

```typescript
// All writes first go to DynamoDB WAL
await writeToWAL(document);

// Then index to OpenSearch
try {
  await indexToOpenSearch(document);
  await markWALProcessed(document.id);
} catch (error) {
  // Document remains in WAL for retry
  logger.error('Indexing failed, document in WAL', { docId: document.id });
}

// Periodic WAL replay (recovers any failed writes)
setInterval(async () => {
  const pendingDocs = await getUnprocessedFromWAL();
  for (const doc of pendingDocs) {
    await retryIndex(doc);
  }
}, 60000); // Every 1 minute
```

**Benefits**:
- Guarantees no data loss
- Automatic retry mechanism
- Audit trail of all writes

### Pattern 4: Immutable Event Sourcing

**Concept**: Store all events, rebuild index from events anytime

```typescript
// Events stored in S3 (immutable, permanent)
interface FileIndexedEvent {
  eventId: string;
  timestamp: Date;
  eventType: 'FILE_ADDED' | 'FILE_UPDATED' | 'FILE_DELETED';
  fileKey: string;
  metadata: FileMetadata;
  embedding: number[];
}

// OpenSearch index is just a materialized view
// Can be rebuilt anytime from event log

async function rebuildIndexFromEvents(since?: Date) {
  const events = await loadEventsFromS3(since);

  for (const event of events) {
    await applyEventToIndex(event);
  }
}
```

**Benefits**:
- Index is disposable (can be rebuilt)
- Perfect audit trail
- Time-travel queries possible

**Disadvantages**:
- Higher storage cost
- Rebuild time for large datasets

### Pattern 5: Chaos Engineering for Migrations

**Test migration failures in staging**

```bash
#!/bin/bash
# chaos-migration-test.sh

# Test 1: Network failure during reindex
perform_migration &
sleep 60 # Let migration start
block_network_to_opensearch
wait
validate_rollback_successful

# Test 2: Partial data corruption
perform_migration &
sleep 120 # Let migration reach 50%
corrupt_random_documents --percentage=1
wait
validate_data_integrity

# Test 3: Concurrent writes during migration
perform_migration &
generate_write_load --rate=100 &  # 100 writes/sec
wait
validate_no_data_loss
```

**Benefits**:
- Builds confidence in rollback procedures
- Identifies edge cases before production
- Validates monitoring and alerting

---

## Emergency Recovery Runbook

### When Everything Goes Wrong

**Scenario**: Migration failed, rollback failed, production is down

**Step 1: Immediate Triage (5 minutes)**

```bash
# Determine what's still working
curl -I https://<OPENSEARCH_ENDPOINT>/_cluster/health
# Response: 200 OK → OpenSearch alive
# Response: timeout → OpenSearch down (escalate to AWS support)

# Can we read from ANY index?
curl -XGET "https://<ENDPOINT>/_cat/indices?v"
# If yes → Data exists, focus on routing traffic to correct index
# If no → Critical outage, engage disaster recovery
```

**Step 2: Emergency Read-Only Mode**

```typescript
// If writes are failing but reads work, serve stale data
const EMERGENCY_MODE = true;

app.post('/search', async (req, res) => {
  if (EMERGENCY_MODE) {
    // Read from backup/cache/replica
    const results = await readFromBackupSource(req.query);
    return res.json({
      results,
      warning: 'Service degraded, showing cached results'
    });
  }
});

app.post('/index', async (req, res) => {
  if (EMERGENCY_MODE) {
    // Queue for later processing
    await sqs.sendMessage({ body: req.body });
    return res.status(202).json({ message: 'Queued for processing' });
  }
});
```

**Step 3: Restore from Last Known Good Snapshot**

```bash
# Find latest successful snapshot
curl -XGET "https://<ENDPOINT>/_snapshot/<repo>/_all" | jq -r '
  .snapshots
  | sort_by(.start_time)
  | reverse
  | .[0]
  | .snapshot
'

# Restore to temporary index
curl -XPOST "https://<ENDPOINT>/_snapshot/<repo>/<snapshot>/_restore" -d '{
  "indices": "*",
  "rename_pattern": "(.+)",
  "rename_replacement": "emergency-restore-$1"
}'

# Point alias to emergency restore
curl -XPOST "https://<ENDPOINT>/_aliases" -d '{
  "actions": [
    { "remove": { "index": "file-index-broken", "alias": "file-index" } },
    { "add": { "index": "emergency-restore-file-index", "alias": "file-index" } }
  ]
}'
```

**Step 4: Engage Escalation Path**

```
T+0min:   Developer detects issue
T+5min:   Incident Commander assigned (Engineering Manager)
T+10min:  Senior Engineers engaged
T+15min:  AWS Support ticket created (if infrastructure issue)
T+30min:  CTO/VP Engineering notified
T+1hour:  Customer communication prepared (if user-facing)
```

---

## Success Metrics

After implementing these best practices, you should achieve:

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Migration Success Rate** | >99% | Successful migrations / Total attempts |
| **Mean Time to Detect (MTTD)** | <5 minutes | Time from failure to detection |
| **Mean Time to Resolve (MTTR)** | <30 minutes | Time from detection to full recovery |
| **Data Loss per Incident** | 0 documents | Documents lost during failed migrations |
| **Rollback Success Rate** | 100% | Successful rollbacks / Total rollback attempts |
| **Unplanned Downtime** | <0.1% annually | Downtime caused by migrations |

---

## Appendix: Quick Reference

### Commands to Memorize

```bash
# Health check
curl -XGET "https://<ENDPOINT>/_cluster/health?pretty"

# Document count
curl -XGET "https://<ENDPOINT>/<INDEX>/_count"

# List snapshots
curl -XGET "https://<ENDPOINT>/_snapshot/<REPO>/_all"

# Restore snapshot
curl -XPOST "https://<ENDPOINT>/_snapshot/<REPO>/<SNAPSHOT>/_restore"

# Switch alias (instant rollback)
curl -XPOST "https://<ENDPOINT>/_aliases" -d '{
  "actions": [
    { "remove": { "index": "old", "alias": "production" } },
    { "add": { "index": "new", "alias": "production" } }
  ]
}'
```

### When to Escalate

| Situation | Action |
|-----------|--------|
| Data loss >1% | Escalate to Engineering Manager immediately |
| Rollback failed | Escalate to Senior Engineers |
| OpenSearch cluster down | Engage AWS Support (Enterprise Support SLA: 15min response) |
| Customer data exposed | Escalate to Security Team + Legal (GDPR breach protocol) |
| Repeated migration failures | Escalate to Solutions Architect for design review |

---

**Document Maintained By**: Infrastructure Team
**Review Frequency**: Quarterly
**Next Review**: 2025-03-18
