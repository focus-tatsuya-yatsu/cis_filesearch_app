# AWS OpenSearch Configuration Guide for CIS File Scanner

## Table of Contents
1. [Why This Matters - Understanding OpenSearch](#why-this-matters)
2. [OpenSearch Domain Creation](#opensearch-domain-creation)
3. [k-NN Plugin Configuration](#k-nn-plugin-configuration)
4. [Index Mapping Setup](#index-mapping-setup)
5. [Access Policies and Security](#access-policies-and-security)
6. [Testing and Verification](#testing-and-verification)
7. [Performance Optimization](#performance-optimization)
8. [Cost Management](#cost-management)
9. [Troubleshooting](#troubleshooting)

---

## Why This Matters - Understanding OpenSearch

### What is OpenSearch and Why We Use It

Amazon OpenSearch Service (formerly Elasticsearch) is a fully managed search and analytics engine. For the CIS File Scanner, OpenSearch serves as:

1. **Primary Data Store**: All file metadata stored in OpenSearch (NO DynamoDB)
2. **Full-Text Search**: Fast text search across file names, paths, and content
3. **Vector Search**: Image similarity search using k-NN with Bedrock Titan embeddings
4. **Aggregations**: Analytics for file statistics and dashboards

### Key OpenSearch Concepts

- **Domain**: A managed OpenSearch cluster
- **Index**: Like a database table (e.g., `files` index)
- **Document**: Individual file metadata record
- **Mapping**: Schema definition for index fields
- **k-NN**: k-Nearest Neighbors for vector similarity search
- **Shards**: Data partitions for scalability
- **Replicas**: Copies of shards for high availability

### Architecture Flow

```
File Scanner PC → DataSync → S3 Landing Bucket
                                ↓
                            EventBridge Rule
                                ↓
                            SQS Queue
                                ↓
                    EC2 Workers (Auto Scaling)
                                ↓
                    ┌───────────┴───────────┐
                    ↓                       ↓
            Bedrock Titan              OpenSearch
            (Image Embeddings)      (Store Everything)
```

### Cost Implications

**For t3.small.search with 100GB storage** (Tokyo region):

| Component | Cost |
|-----------|------|
| Instance (t3.small.search) | $36.50/month |
| Storage (100GB GP3) | $11.50/month |
| Data transfer IN | FREE |
| Data transfer OUT | $0.114/GB (minimal) |
| **Total** | **~$48/month** |

**Why t3.small.search?**
- 2 vCPU, 2GB RAM
- Sufficient for 100K-500K documents
- Can scale to t3.medium.search as needed
- Burstable performance (good for batch indexing)

---

## OpenSearch Domain Creation

### Prerequisites

Before starting:
- VPC created with private subnets
- Security groups configured
- IAM role for EC2 workers ready

### Console Method

#### Step 1: Navigate to OpenSearch Console

1. AWS Console → Search "OpenSearch Service"
2. Click "Create domain"

#### Step 2: Domain Configuration

**Deployment type**: Development and testing

**Why Development mode?**
- Single node (no standby replicas)
- Lower cost ($36.50 vs $73/month)
- Sufficient for initial deployment
- Can upgrade to Production later

**Version**: OpenSearch 2.11 (latest stable)

**Why 2.11?**
- Latest k-NN improvements
- Better performance
- Security patches
- FAISS engine support

#### Step 3: Domain Name

**Domain name**: `cis-filesearch-dev`

**Naming convention:**
```
{project}-{service}-{environment}

Examples:
- cis-filesearch-dev     # Development
- cis-filesearch-staging # Staging
- cis-filesearch-prod    # Production
```

**Important**: Domain names are permanent, cannot be renamed

#### Step 4: Instance Configuration

**Instance type**: `t3.small.search`

**Instance specifications:**
- 2 vCPU
- 2 GB RAM
- Burstable performance
- EBS-only storage

**Number of nodes**: 1 (Development mode)

**Why single node for dev?**
- Lower cost
- Faster deployments
- Easier debugging
- Production will use 3 nodes

#### Step 5: Storage Configuration

**Storage type**: GP3

**Why GP3 over GP2?**
- 20% cheaper
- Better baseline performance (3000 IOPS)
- Configurable IOPS and throughput
- Modern AWS standard

**EBS volume size**: 100 GB

**Calculation:**
```
Estimated file count: 100,000 files
Average document size: ~5 KB (metadata + embeddings)
Total data: 500 MB

With overhead (mappings, analyzers, etc.): ~2 GB
Buffer for growth (50x): 100 GB

100 GB allows for 5M documents comfortably
```

**Throughput**: 125 MB/s (default)
**IOPS**: 3000 (default)

**When to increase:**
- Throughput: If bulk indexing > 125 MB/s
- IOPS: If search latency > 100ms

#### Step 6: Network Configuration

**Network**: VPC access

**Why VPC access?**
- Better security (not publicly accessible)
- Lower latency from EC2
- No data transfer charges
- Required for production

**VPC**: Select your CIS VPC

**Subnets**: Select **private subnet** in **one AZ** (dev mode)

**Important**: Development mode only supports one subnet

**Security groups**: Create or select security group

**Required inbound rules:**
```
Type: HTTPS
Port: 443
Source: EC2 Worker Security Group
Description: Allow OpenSearch access from workers
```

**Availability zones**: Single-AZ (dev mode)

#### Step 7: Access Policy

**Access policy**: Custom access policy

**Initial policy** (will refine later):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "*"
      },
      "Action": "es:*",
      "Resource": "arn:aws:es:ap-northeast-1:ACCOUNT_ID:domain/cis-filesearch-dev/*"
    }
  ]
}
```

**Why allow all for now?**
- Easier initial setup
- Will lock down with IAM roles later
- VPC isolation provides security

#### Step 8: Fine-Grained Access Control

**Enable**: No (for simplicity)

**Why disabled?**
- Adds complexity
- IAM policies sufficient for this project
- VPC security group controls access
- Can enable later if needed

#### Step 9: Encryption

**Encryption at rest**: Enabled

**Why enable?**
- Free (no extra cost)
- Meets compliance requirements
- Best practice

**Node-to-node encryption**: Enabled

**Why enable?**
- Encrypts internal cluster communication
- Free
- Security best practice

**Key**: aws/es (AWS managed key)

**Why AWS managed key?**
- Free (no KMS costs)
- Automatic rotation
- Sufficient for most use cases
- Custom KMS key adds $1/month + API costs

#### Step 10: Advanced Cluster Settings

**Automated snapshot start hour**: 00:00 UTC (default)

**Why keep default?**
- Low activity time
- Daily backups
- 14-day retention (free)

**Plugins**: Auto-enable recommended plugins

**Required plugins:**
- ✅ analysis-icu: International text analysis
- ✅ analysis-kuromoji: Japanese text analysis
- ✅ analysis-phonetic: Fuzzy search
- ✅ ingest-attachment: PDF/Office text extraction
- ✅ **k-NN**: Vector similarity search (CRITICAL)

**Enable k-NN plugin**: YES

**k-NN settings** (add to advanced settings):

```json
{
  "knn.algo_param.index_thread_qty": 2,
  "knn.memory.circuit_breaker.limit": "50%",
  "knn.cache.item.expiry.enabled": true,
  "knn.cache.item.expiry.minutes": 60
}
```

**What these do:**
- `index_thread_qty`: Parallel threads for indexing vectors (2 for t3.small)
- `circuit_breaker.limit`: Prevent OOM errors (50% of heap)
- `cache.expiry`: Clear unused vectors after 1 hour

#### Step 11: Tags

Add tags for cost tracking:

```
Project: CISFileSearch
Environment: Development
Component: SearchEngine
CostCenter: IT
ManagedBy: Manual
DataType: FileMetadata
```

#### Step 12: Review and Create

1. Review all settings
2. Click "Create"
3. **Wait 15-20 minutes** for domain creation

**Console will show:**
```
Domain status: Loading...
```

**When ready:**
```
Domain status: Active
Health: Green
```

### CLI Method

```bash
# Set variables
DOMAIN_NAME="cis-filesearch-dev"
REGION="ap-northeast-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
VPC_ID="vpc-xxxxx"
SUBNET_ID="subnet-xxxxx"
SECURITY_GROUP_ID="sg-xxxxx"

# Create OpenSearch domain
aws opensearch create-domain \
  --region $REGION \
  --domain-name $DOMAIN_NAME \
  --engine-version "OpenSearch_2.11" \
  --cluster-config '{
    "InstanceType": "t3.small.search",
    "InstanceCount": 1,
    "DedicatedMasterEnabled": false,
    "ZoneAwarenessEnabled": false
  }' \
  --ebs-options '{
    "EBSEnabled": true,
    "VolumeType": "gp3",
    "VolumeSize": 100,
    "Iops": 3000,
    "Throughput": 125
  }' \
  --vpc-options "{
    \"SubnetIds\": [\"$SUBNET_ID\"],
    \"SecurityGroupIds\": [\"$SECURITY_GROUP_ID\"]
  }" \
  --encryption-at-rest-options '{
    "Enabled": true,
    "KmsKeyId": "aws/es"
  }' \
  --node-to-node-encryption-options '{
    "Enabled": true
  }' \
  --domain-endpoint-options '{
    "EnforceHTTPS": true,
    "TLSSecurityPolicy": "Policy-Min-TLS-1-2-2019-07"
  }' \
  --advanced-options '{
    "rest.action.multi.allow_explicit_index": "true",
    "knn.algo_param.index_thread_qty": "2",
    "knn.memory.circuit_breaker.limit": "50%"
  }' \
  --access-policies "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Principal\": {\"AWS\": \"*\"},
      \"Action\": \"es:*\",
      \"Resource\": \"arn:aws:es:$REGION:$ACCOUNT_ID:domain/$DOMAIN_NAME/*\"
    }]
  }" \
  --tags "Key=Project,Value=CISFileSearch" \
         "Key=Environment,Value=Development"

# Wait for domain to be active
aws opensearch describe-domain \
  --domain-name $DOMAIN_NAME \
  --region $REGION \
  --query 'DomainStatus.Processing' \
  --output text

# Get endpoint URL (save this!)
OPENSEARCH_ENDPOINT=$(aws opensearch describe-domain \
  --domain-name $DOMAIN_NAME \
  --region $REGION \
  --query 'DomainStatus.Endpoint' \
  --output text)

echo "OpenSearch Endpoint: https://$OPENSEARCH_ENDPOINT"
```

**Save the endpoint URL** - You'll need it for:
- EC2 worker configuration
- API integration
- Testing

---

## k-NN Plugin Configuration

### Why k-NN Matters

The k-NN (k-Nearest Neighbors) plugin enables **vector similarity search** for:
- Image similarity search using Bedrock Titan embeddings
- Semantic search (future feature)
- Recommendation systems

### Verify k-NN Plugin

```bash
# Check if k-NN plugin is installed
curl -X GET "https://$OPENSEARCH_ENDPOINT/_cat/plugins?v" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"

# Expected output:
# name              component  version
# opensearch-node-1 knn        2.11.0.0
```

### k-NN Settings Explained

**Index thread quantity** (`knn.algo_param.index_thread_qty`):
```
Value: 2 (for t3.small)
Why: Balance between indexing speed and CPU usage
Higher values: Faster indexing, more CPU
Lower values: Slower indexing, less CPU
```

**Circuit breaker** (`knn.memory.circuit_breaker.limit`):
```
Value: 50%
Why: Prevent OutOfMemory errors
Formula: 50% of JVM heap size
For t3.small (2GB RAM): ~500MB for k-NN graphs
```

**Cache expiry** (`knn.cache.item.expiry.enabled`):
```
Value: true
Why: Free up memory from unused vectors
Expiry time: 60 minutes
Benefit: Better memory utilization
```

### Update k-NN Settings (if needed)

```bash
aws opensearch update-domain-config \
  --domain-name $DOMAIN_NAME \
  --region $REGION \
  --advanced-options '{
    "knn.algo_param.index_thread_qty": "2",
    "knn.memory.circuit_breaker.limit": "50%",
    "knn.cache.item.expiry.enabled": "true",
    "knn.cache.item.expiry.minutes": "60"
  }'
```

---

## Index Mapping Setup

### Understanding Index Structure

We'll create one main index: `files`

**Index fields:**
- File metadata (name, path, size, dates)
- Content (extracted text from PDFs)
- Image embeddings (512-dimension vectors from Titan)
- Tags and categories

### Create Files Index

#### Step 1: Index Creation with Mapping

```bash
# Create index with mapping
curl -X PUT "https://$OPENSEARCH_ENDPOINT/files" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
  "settings": {
    "index": {
      "number_of_shards": 2,
      "number_of_replicas": 0,
      "refresh_interval": "5s",
      "max_result_window": 10000,
      "knn": true,
      "knn.algo_param.ef_search": 100
    },
    "analysis": {
      "analyzer": {
        "japanese_analyzer": {
          "type": "custom",
          "tokenizer": "kuromoji_tokenizer",
          "filter": ["kuromoji_baseform", "kuromoji_part_of_speech", "cjk_width", "lowercase"]
        },
        "path_analyzer": {
          "type": "custom",
          "tokenizer": "path_hierarchy",
          "filter": ["lowercase"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "file_id": {
        "type": "keyword"
      },
      "file_name": {
        "type": "text",
        "analyzer": "japanese_analyzer",
        "fields": {
          "keyword": {
            "type": "keyword"
          }
        }
      },
      "file_path": {
        "type": "text",
        "analyzer": "path_analyzer",
        "fields": {
          "keyword": {
            "type": "keyword"
          }
        }
      },
      "file_size": {
        "type": "long"
      },
      "file_extension": {
        "type": "keyword"
      },
      "mime_type": {
        "type": "keyword"
      },
      "file_hash": {
        "type": "keyword"
      },
      "created_at": {
        "type": "date"
      },
      "modified_at": {
        "type": "date"
      },
      "indexed_at": {
        "type": "date"
      },
      "s3_bucket": {
        "type": "keyword"
      },
      "s3_key": {
        "type": "keyword"
      },
      "content": {
        "type": "text",
        "analyzer": "japanese_analyzer"
      },
      "image_embedding": {
        "type": "knn_vector",
        "dimension": 1024,
        "method": {
          "name": "hnsw",
          "space_type": "cosinesimil",
          "engine": "faiss",
          "parameters": {
            "ef_construction": 128,
            "m": 16
          }
        }
      },
      "tags": {
        "type": "keyword"
      },
      "department": {
        "type": "keyword"
      },
      "project": {
        "type": "keyword"
      },
      "status": {
        "type": "keyword"
      }
    }
  }
}'
```

### Settings Explained

**Shards** (`number_of_shards: 2`):
- Data partitions for scalability
- 2 shards for 100K-500K documents
- More shards = better parallelism but more overhead

**Replicas** (`number_of_replicas: 0`):
- Development mode: no replicas (cost savings)
- Production: 1-2 replicas for high availability

**Refresh interval** (`refresh_interval: "5s"`):
- How often new documents become searchable
- 5s = near real-time search
- Increase to 30s for faster bulk indexing

**k-NN settings**:
- `ef_search: 100`: Quality of k-NN search (higher = more accurate, slower)
- `ef_construction: 128`: Quality of index building (higher = better index, slower)
- `m: 16`: Graph connections per node (higher = better recall, more memory)

### Analyzers Explained

**Japanese analyzer** (`japanese_analyzer`):
```
Input:  "東京都渋谷区のファイル"
Tokens: ["東京", "都", "渋谷", "区", "ファイル"]
Why:    Kuromoji tokenizer handles Japanese text properly
```

**Path analyzer** (`path_analyzer`):
```
Input:  "/nas/projects/2025/documents/report.pdf"
Tokens: ["/nas", "/nas/projects", "/nas/projects/2025", ...]
Why:    Enables hierarchical path search
```

### Field Types Explained

**keyword**: Exact match only, not analyzed
- Good for: file extensions, IDs, tags
- Example: `file_extension: "pdf"` matches only "pdf"

**text**: Full-text search, analyzed
- Good for: file names, content
- Example: `file_name: "report"` matches "Monthly_Report.pdf"

**knn_vector**: Vector embeddings
- Dimension: 1024 (Bedrock Titan Multimodal Embeddings)
- Method: HNSW (Hierarchical Navigable Small World)
- Space: cosinesimilarity (best for embeddings)

### Verify Index Creation

```bash
# Check index exists
curl -X GET "https://$OPENSEARCH_ENDPOINT/_cat/indices/files?v" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"

# Get index mapping
curl -X GET "https://$OPENSEARCH_ENDPOINT/files/_mapping" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq .

# Get index settings
curl -X GET "https://$OPENSEARCH_ENDPOINT/files/_settings" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq .
```

---

## Access Policies and Security

### IAM Role for EC2 Workers

EC2 workers need permissions to read/write OpenSearch.

#### Create IAM Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "es:ESHttpGet",
        "es:ESHttpHead",
        "es:ESHttpPost",
        "es:ESHttpPut",
        "es:ESHttpDelete"
      ],
      "Resource": [
        "arn:aws:es:ap-northeast-1:ACCOUNT_ID:domain/cis-filesearch-dev",
        "arn:aws:es:ap-northeast-1:ACCOUNT_ID:domain/cis-filesearch-dev/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "es:DescribeDomain",
        "es:ListDomainNames"
      ],
      "Resource": "*"
    }
  ]
}
```

#### Create and Attach Policy (CLI)

```bash
# Create policy document
cat > ec2-opensearch-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "es:ESHttpGet",
      "es:ESHttpPost",
      "es:ESHttpPut",
      "es:ESHttpDelete"
    ],
    "Resource": "arn:aws:es:ap-northeast-1:*:domain/cis-filesearch-*/*"
  }]
}
EOF

# Create IAM policy
aws iam create-policy \
  --policy-name CISFileProcessorOpenSearchAccess \
  --policy-document file://ec2-opensearch-policy.json

# Attach to EC2 instance role
aws iam attach-role-policy \
  --role-name CISFileProcessorRole \
  --policy-arn arn:aws:iam::$ACCOUNT_ID:policy/CISFileProcessorOpenSearchAccess
```

### Update Domain Access Policy

Restrict access to EC2 workers only:

```bash
cat > opensearch-access-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::$ACCOUNT_ID:role/CISFileProcessorRole"
      },
      "Action": "es:*",
      "Resource": "arn:aws:es:ap-northeast-1:$ACCOUNT_ID:domain/$DOMAIN_NAME/*"
    }
  ]
}
EOF

aws opensearch update-domain-config \
  --domain-name $DOMAIN_NAME \
  --region $REGION \
  --access-policies file://opensearch-access-policy.json
```

### Security Group Configuration

**Inbound rules for OpenSearch security group:**

```bash
# Allow HTTPS from EC2 workers
aws ec2 authorize-security-group-ingress \
  --group-id $OPENSEARCH_SG_ID \
  --protocol tcp \
  --port 443 \
  --source-group $EC2_WORKER_SG_ID \
  --region $REGION
```

**Why port 443?**
- OpenSearch uses HTTPS
- TLS encryption enforced
- Secure data transmission

---

## Testing and Verification

### 1. Check Domain Health

```bash
# Get domain status
aws opensearch describe-domain \
  --domain-name $DOMAIN_NAME \
  --region $REGION

# Check cluster health
curl -X GET "https://$OPENSEARCH_ENDPOINT/_cluster/health" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq .
```

**Expected output:**
```json
{
  "cluster_name": "123456789012:cis-filesearch-dev",
  "status": "green",
  "timed_out": false,
  "number_of_nodes": 1,
  "number_of_data_nodes": 1,
  "active_primary_shards": 2,
  "active_shards": 2,
  "relocating_shards": 0,
  "initializing_shards": 0,
  "unassigned_shards": 0
}
```

**Status meanings:**
- **Green**: All shards assigned, cluster healthy
- **Yellow**: All primary shards assigned, some replicas missing (OK for dev)
- **Red**: Some primary shards unassigned, data loss possible

### 2. Index Test Document

```bash
# Index a test file
curl -X POST "https://$OPENSEARCH_ENDPOINT/files/_doc" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H 'Content-Type: application/json' \
  -d '{
  "file_id": "test-001",
  "file_name": "テストファイル.pdf",
  "file_path": "/nas/projects/test/テストファイル.pdf",
  "file_size": 1048576,
  "file_extension": "pdf",
  "mime_type": "application/pdf",
  "file_hash": "sha256-test-hash",
  "created_at": "2025-01-15T10:00:00Z",
  "modified_at": "2025-01-15T10:00:00Z",
  "indexed_at": "2025-01-15T10:05:00Z",
  "s3_bucket": "cis-filesearch-landing-dev",
  "s3_key": "files/test/テストファイル.pdf",
  "content": "これはテスト文書です。ファイル検索システムのテストを行っています。",
  "tags": ["test", "development"],
  "department": "IT",
  "status": "active"
}'
```

**Save the document ID** from response

### 3. Search Test

```bash
# Simple text search
curl -X GET "https://$OPENSEARCH_ENDPOINT/files/_search" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H 'Content-Type: application/json' \
  -d '{
  "query": {
    "match": {
      "file_name": "テスト"
    }
  }
}'

# Should return the test document
```

### 4. k-NN Search Test

```bash
# Generate random embedding for test
EMBEDDING=$(python3 -c "import random; print([random.random() for _ in range(1024)])")

# k-NN search
curl -X GET "https://$OPENSEARCH_ENDPOINT/files/_search" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H 'Content-Type: application/json' \
  -d "{
  \"size\": 5,
  \"query\": {
    \"knn\": {
      \"image_embedding\": {
        \"vector\": $EMBEDDING,
        \"k\": 5
      }
    }
  }
}"
```

### 5. Aggregation Test

```bash
# Count files by extension
curl -X GET "https://$OPENSEARCH_ENDPOINT/files/_search" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H 'Content-Type: application/json' \
  -d '{
  "size": 0,
  "aggs": {
    "by_extension": {
      "terms": {
        "field": "file_extension",
        "size": 10
      }
    }
  }
}'
```

### 6. Performance Test

```bash
# Bulk index 1000 documents
cat > bulk-test.json <<'EOF'
{ "index": { "_index": "files" } }
{ "file_id": "bulk-1", "file_name": "test1.pdf", "file_size": 1024, "indexed_at": "2025-01-15T10:00:00Z" }
{ "index": { "_index": "files" } }
{ "file_id": "bulk-2", "file_name": "test2.pdf", "file_size": 2048, "indexed_at": "2025-01-15T10:00:01Z" }
...
EOF

# Bulk insert
curl -X POST "https://$OPENSEARCH_ENDPOINT/_bulk" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H 'Content-Type: application/x-ndjson' \
  --data-binary @bulk-test.json

# Measure indexing speed
# Good performance: > 500 docs/sec on t3.small
```

---

## Performance Optimization

### 1. Bulk Indexing Settings

For faster bulk indexing:

```bash
# Temporarily disable refresh
curl -X PUT "https://$OPENSEARCH_ENDPOINT/files/_settings" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H 'Content-Type: application/json' \
  -d '{
  "index": {
    "refresh_interval": "-1",
    "number_of_replicas": 0
  }
}'

# ... do bulk indexing ...

# Re-enable refresh
curl -X PUT "https://$OPENSEARCH_ENDPOINT/files/_settings" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H 'Content-Type: application/json' \
  -d '{
  "index": {
    "refresh_interval": "5s"
  }
}'
```

### 2. Query Performance

**Use filters instead of queries when possible:**

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "content": "検索キーワード" } }
      ],
      "filter": [
        { "term": { "file_extension": "pdf" } },
        { "range": { "file_size": { "gte": 1024 } } }
      ]
    }
  }
}
```

**Why filters are faster:**
- Filters are cached
- No scoring calculation
- Binary yes/no decision

### 3. k-NN Performance

**Tune ef_search for speed vs accuracy:**

```bash
# Faster search, lower accuracy
curl -X PUT "https://$OPENSEARCH_ENDPOINT/files/_settings" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H 'Content-Type: application/json' \
  -d '{
  "index.knn.algo_param.ef_search": 50
}'

# Higher accuracy, slower search
curl -X PUT "https://$OPENSEARCH_ENDPOINT/files/_settings" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H 'Content-Type: application/json' \
  -d '{
  "index.knn.algo_param.ef_search": 200
}'
```

**Recommendations:**
- Development: `ef_search: 50` (faster)
- Production: `ef_search: 100` (balanced)
- High accuracy needed: `ef_search: 200` (slower)

### 4. Monitoring Performance

```bash
# Get cluster stats
curl -X GET "https://$OPENSEARCH_ENDPOINT/_cluster/stats" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq .

# Get node stats
curl -X GET "https://$OPENSEARCH_ENDPOINT/_nodes/stats" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq .

# Get index stats
curl -X GET "https://$OPENSEARCH_ENDPOINT/files/_stats" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq .
```

**Key metrics to watch:**
- `indexing.index_total`: Total documents indexed
- `indexing.index_time_in_millis`: Time spent indexing
- `search.query_total`: Total searches
- `search.query_time_in_millis`: Time spent searching
- `jvm.mem.heap_used_percent`: JVM memory usage (keep < 85%)

---

## Cost Management

### 1. Right-Size Instance

**When to upgrade from t3.small.search:**

| Indicator | Threshold | Action |
|-----------|-----------|--------|
| Document count | > 500K | Upgrade to t3.medium |
| Search latency | > 500ms p95 | Upgrade to t3.medium |
| Heap usage | > 85% | Upgrade to t3.medium |
| Indexing backlog | > 1 hour delay | Upgrade or add nodes |

**Cost comparison:**
- t3.small.search: $36.50/month
- t3.medium.search: $73/month (2x capacity)
- t3.large.search: $146/month (4x capacity)

### 2. Optimize Storage

```bash
# Force merge to reduce segment count
curl -X POST "https://$OPENSEARCH_ENDPOINT/files/_forcemerge?max_num_segments=1" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"

# Check storage usage
curl -X GET "https://$OPENSEARCH_ENDPOINT/_cat/indices/files?v&h=index,store.size,docs.count" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"
```

**When to force merge:**
- After bulk indexing
- Monthly maintenance
- Before taking snapshots

**Benefits:**
- Reduced storage usage (10-20%)
- Faster searches
- Lower costs

### 3. Delete Old Documents

```bash
# Delete documents older than 90 days
curl -X POST "https://$OPENSEARCH_ENDPOINT/files/_delete_by_query" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H 'Content-Type: application/json' \
  -d '{
  "query": {
    "range": {
      "indexed_at": {
        "lte": "now-90d"
      }
    }
  }
}'
```

### 4. Use Index Lifecycle Management

```bash
# Create ILM policy
curl -X PUT "https://$OPENSEARCH_ENDPOINT/_plugins/_ism/policies/files_policy" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H 'Content-Type: application/json' \
  -d '{
  "policy": {
    "description": "File index lifecycle",
    "default_state": "hot",
    "states": [
      {
        "name": "hot",
        "actions": [],
        "transitions": [
          {
            "state_name": "delete",
            "conditions": {
              "min_index_age": "90d"
            }
          }
        ]
      },
      {
        "name": "delete",
        "actions": [
          {
            "delete": {}
          }
        ]
      }
    ]
  }
}'
```

### 5. Reserved Instances

For production, consider Reserved Instances:

**1-year Reserved Instance savings:**
- No upfront: 30% savings
- Partial upfront: 35% savings
- All upfront: 40% savings

**Example** (t3.small.search):
- On-demand: $36.50/month = $438/year
- 1-year all upfront: $263/year
- **Savings: $175/year (40%)**

---

## Troubleshooting

### Issue 1: Domain Stuck in Processing

**Symptoms:**
- Domain status: Processing for > 30 minutes
- Cannot access cluster

**Diagnosis:**
```bash
aws opensearch describe-domain \
  --domain-name $DOMAIN_NAME \
  --region $REGION \
  --query 'DomainStatus.Processing'
```

**Solutions:**
1. Wait up to 60 minutes (normal for initial creation)
2. Check VPC subnet availability
3. Verify security group allows 443
4. Check AWS service health dashboard

### Issue 2: Cluster Health Red/Yellow

**Symptoms:**
```json
{
  "status": "red",
  "unassigned_shards": 2
}
```

**Diagnosis:**
```bash
# Get shard allocation explanation
curl -X GET "https://$OPENSEARCH_ENDPOINT/_cluster/allocation/explain" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"
```

**Common causes:**
1. **Red status**: Primary shard lost
   - Solution: Restore from snapshot
2. **Yellow status**: Replica not assigned (normal for dev single-node)
   - Solution: Set replicas to 0 or add nodes

### Issue 3: Cannot Connect to Domain

**Symptoms:**
```
Could not connect to the endpoint URL
```

**Diagnosis:**
```bash
# Check if domain is in VPC
aws opensearch describe-domain \
  --domain-name $DOMAIN_NAME \
  --query 'DomainStatus.VPCOptions'

# Check security groups
aws ec2 describe-security-groups \
  --group-ids $OPENSEARCH_SG_ID
```

**Solutions:**
1. Verify EC2 in same VPC
2. Check security group allows 443 from EC2
3. Verify IAM permissions
4. Try from EC2 inside VPC, not locally

### Issue 4: k-NN Search Not Working

**Symptoms:**
```json
{
  "error": {
    "type": "illegal_argument_exception",
    "reason": "Field 'image_embedding' is not of type knn_vector"
  }
}
```

**Diagnosis:**
```bash
# Check if k-NN enabled
curl -X GET "https://$OPENSEARCH_ENDPOINT/_cluster/settings" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | grep knn

# Check mapping
curl -X GET "https://$OPENSEARCH_ENDPOINT/files/_mapping" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq '.files.mappings.properties.image_embedding'
```

**Solutions:**
1. Verify k-NN plugin installed
2. Recreate index with correct mapping
3. Check vector dimension matches (1024 for Titan)
4. Ensure `"index.knn": true` in settings

### Issue 5: High Memory Usage

**Symptoms:**
- Frequent circuit breaker errors
- Slow queries
- `heap_used_percent > 85%`

**Diagnosis:**
```bash
# Check heap usage
curl -X GET "https://$OPENSEARCH_ENDPOINT/_nodes/stats/jvm" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  | jq '.nodes[].jvm.mem.heap_used_percent'
```

**Solutions:**
1. Reduce k-NN circuit breaker limit to 40%
2. Clear field data cache:
```bash
curl -X POST "https://$OPENSEARCH_ENDPOINT/_cache/clear?fielddata=true" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"
```
3. Upgrade to larger instance
4. Reduce shard count
5. Enable cache expiry for k-NN

### Issue 6: Slow Indexing

**Symptoms:**
- Bulk indexing < 100 docs/sec
- Queue backup

**Solutions:**
1. Disable refresh during bulk load
2. Increase bulk batch size to 500-1000 docs
3. Reduce number of replicas to 0
4. Use GP3 with higher IOPS (5000+)
5. Upgrade to larger instance

---

## Summary Checklist

- [ ] OpenSearch domain created (t3.small.search)
- [ ] k-NN plugin enabled and configured
- [ ] VPC access configured with private subnet
- [ ] Security group allows 443 from EC2 workers
- [ ] IAM policy created for EC2 access
- [ ] Domain access policy updated
- [ ] Index created with proper mapping
- [ ] Japanese analyzer configured
- [ ] k-NN vector field configured (dimension 1024)
- [ ] Test document indexed successfully
- [ ] Text search working
- [ ] k-NN search working
- [ ] Cluster health: Green (or Yellow for dev)
- [ ] CloudWatch alarms configured
- [ ] Backup/snapshot verified

---

## Next Steps

1. **Configure EventBridge**: See `aws-eventbridge-configuration-guide.md`
2. **Configure Auto Scaling Group**: See `aws-autoscaling-configuration-guide.md`
3. **Integrate with EC2 Workers**: Update `.env` with OpenSearch endpoint
4. **Test Full Pipeline**: S3 → SQS → EC2 → OpenSearch
5. **Set Up Monitoring**: Create CloudWatch dashboard

---

## Additional Resources

- [OpenSearch Documentation](https://docs.aws.amazon.com/opensearch-service/)
- [k-NN Plugin Guide](https://opensearch.org/docs/latest/search-plugins/knn/index/)
- [OpenSearch Best Practices](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/bp.html)
- [Bedrock Titan Embeddings](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-multiemb-models.html)

---

**Document Version**: 1.0
**Last Updated**: 2025-01-18
**Author**: CIS Development Team
