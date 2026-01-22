# OpenSearch Data Integrity Verification Checklist

**Incident ID**: OPENSEARCH-MIGRATION-20251218-001
**Created**: 2025-12-18 10:30:00
**Severity**: P0 - Critical

## Pre-Migration State Verification

### ✅ Backup Verification

- [ ] **Backup Snapshot Exists**
  - Name: `file-search-dev-backup-20251218-101015`
  - Location: OpenSearch Snapshots Repository
  - Command:
    ```bash
    curl -XGET "https://<OPENSEARCH_ENDPOINT>/_snapshot/<REPO_NAME>/file-search-dev-backup-20251218-101015"
    ```

- [ ] **Backup Integrity Check**
  - Status: SUCCESS/PARTIAL/FAILED
  - Document Count: ******\_******
  - Shard Status: ******\_******
  - Timestamp: ******\_******

### ✅ Current Index State

- [ ] **Index Exists**: file-index
- [ ] **Index Exists**: file-search-dev (if created)
- [ ] **Index Exists**: cis-files (mentioned in description)

- [ ] **Document Count Verification**

  ```bash
  # file-index
  curl -XGET "https://<ENDPOINT>/file-index/_count"
  # Expected Count: _____________
  # Actual Count: _____________
  ```

- [ ] **Index Health Status**

  ```bash
  curl -XGET "https://<ENDPOINT>/_cluster/health/file-index?pretty"
  # Status: green/yellow/red
  # Active Shards: _____________
  # Unassigned Shards: _____________
  ```

- [ ] **Alias Configuration**
  ```bash
  curl -XGET "https://<ENDPOINT>/_cat/aliases?v"
  # file-index aliases: _____________
  # file-search-dev aliases: _____________
  ```

### ✅ Mapping Verification

- [ ] **Current Mapping Has k-NN Field**

  ```bash
  curl -XGET "https://<ENDPOINT>/file-index/_mapping" | jq '.["file-index"].mappings.properties.image_embedding'
  # Expected: type=knn_vector, dimension=1024
  # Actual: _____________
  ```

- [ ] **All Required Fields Present**
  - file_key: keyword
  - file_name: text with japanese_analyzer
  - file_path: text with japanese_analyzer
  - extracted_text: text
  - image_embedding: knn_vector (dimension: 1024)

## Data Loss Assessment

### ✅ Sample Data Verification

- [ ] **Random Sample Check (N=100)**

  ```bash
  curl -XGET "https://<ENDPOINT>/file-index/_search" -H 'Content-Type: application/json' -d'
  {
    "size": 100,
    "query": {
      "function_score": {
        "random_score": {}
      }
    }
  }'
  # Total Hits: _____________
  # Sample Size Retrieved: _____________
  ```

- [ ] **Specific Document Retrieval**
  - Document ID 1: ******\_\_\_****** (EXISTS/MISSING)
  - Document ID 2: ******\_\_\_****** (EXISTS/MISSING)
  - Document ID 3: ******\_\_\_****** (EXISTS/MISSING)

### ✅ Recent Data Verification

- [ ] **Last 24h Indexed Documents**
  ```bash
  curl -XGET "https://<ENDPOINT>/file-index/_search" -H 'Content-Type: application/json' -d'
  {
    "query": {
      "range": {
        "indexed_at": {
          "gte": "now-24h"
        }
      }
    }
  }'
  # Count: _____________
  ```

## Migration Impact Assessment

### ✅ Write Operations During Migration

- [ ] **Check for Concurrent Writes**

  ```bash
  # Review CloudWatch Logs for indexing operations
  aws logs filter-log-events \
    --log-group-name "/aws/opensearch/cis-filesearch" \
    --start-time $(date -u -d '2025-12-18 10:00:00' +%s)000 \
    --filter-pattern "indexing"
  ```

- [ ] **Identify Potentially Lost Documents**
  - Start Time: 2025-12-18 10:10:15
  - End Time: 2025-12-18 10:30:00
  - Estimated Write Count: ******\_******

### ✅ Search Functionality

- [ ] **Test Basic Search**

  ```bash
  curl -XGET "https://<ENDPOINT>/file-index/_search?q=test"
  # Response Status: _____________
  # Results Count: _____________
  ```

- [ ] **Test k-NN Search (if field exists)**
  ```bash
  curl -XGET "https://<ENDPOINT>/file-index/_search" -H 'Content-Type: application/json' -d'
  {
    "query": {
      "knn": {
        "image_embedding": {
          "vector": [0.1, 0.2, ...],  # 1024 dimensions
          "k": 10
        }
      }
    }
  }'
  # Response Status: _____________
  # k-NN Search Working: YES/NO
  ```

## Risk Assessment

| Risk                  | Likelihood      | Impact   | Mitigation Priority |
| --------------------- | --------------- | -------- | ------------------- |
| Data Loss             | Low/Medium/High | Critical | P0                  |
| Index Corruption      | Low/Medium/High | High     | P0                  |
| Service Downtime      | Low/Medium/High | Medium   | P1                  |
| Inconsistent Mappings | Low/Medium/High | Medium   | P1                  |

## Decision Matrix

### If Backup is Valid AND Current Index Intact

- **Action**: No rollback needed, proceed with monitoring
- **Next Steps**:
  1. Document current state
  2. Update migration script for VPC access
  3. Schedule proper migration window

### If Backup is Valid BUT Current Index Corrupted

- **Action**: Restore from backup immediately
- **Next Steps**: See Section 2 (Rollback Procedures)

### If Backup is Invalid

- **Action**: Critical escalation, do not proceed with any changes
- **Next Steps**:
  1. Stop all write operations
  2. Create emergency snapshot
  3. Engage senior infrastructure team

## Sign-off

- [ ] Data Integrity Verified By: ******\_******
- [ ] Date/Time: ******\_******
- [ ] Approval to Proceed: YES/NO
- [ ] Approved By: ******\_******
