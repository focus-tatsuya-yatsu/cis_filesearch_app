# Image Vector Search Architecture

## Overview

This document describes the backend architecture for image similarity search using vector embeddings and OpenSearch k-NN capabilities.

## Architecture Diagram

```
┌─────────────────┐
│   Frontend      │
│  (Next.js)      │
└────────┬────────┘
         │
         ↓
┌─────────────────────────────────────────────────────────────┐
│                     API Gateway                              │
│                 (Cognito Authorizer)                         │
└────────┬────────────────────────────────┬───────────────────┘
         │                                │
         ↓                                ↓
┌────────────────────┐           ┌───────────────────────┐
│  Search Lambda     │           │  Image Embedding      │
│  (Enhanced)        │           │  Lambda Function      │
│  - Text Search     │           │  - CLIP/ResNet Model  │
│  - Vector Search   │◄──────────┤  - Vector Generation  │
│  - Hybrid Query    │           │  - S3 Image Fetch     │
└────────┬───────────┘           └───────────────────────┘
         │                                │
         ↓                                ↓
┌────────────────────────────────────────────────────────────┐
│              OpenSearch Domain                              │
│  Index: cis-files                                          │
│  - text fields (file_name, file_path, extracted_text)     │
│  - image_embedding field (knn_vector, dimension: 512)     │
│  - k-NN plugin enabled                                     │
│  - Cosine similarity algorithm                             │
└────────────────────────────────────────────────────────────┘
         ↑
         │
┌────────┴───────────┐
│   S3 Bucket        │
│   - Original Files │
│   - Thumbnails     │
└────────────────────┘
```

## Components

### 1. Image Embedding Lambda Function

**Purpose**: Generate vector embeddings from images using pre-trained models

**Specifications**:
- **Runtime**: Python 3.11 (better ML library support)
- **Memory**: 3008 MB (to accommodate model loading)
- **Timeout**: 60 seconds
- **Layers**: Custom layer with transformers, torch, PIL libraries
- **VPC**: Same VPC as search Lambda for OpenSearch access

**Model Selection**:
- **Primary**: CLIP (openai/clip-vit-base-patch32)
  - Dimension: 512
  - Multi-modal (text + image)
  - Better for semantic similarity
- **Alternative**: ResNet50
  - Dimension: 2048 (can be reduced via PCA)
  - Faster inference
  - Better for visual similarity

**Input**:
```json
{
  "imageUrl": "s3://bucket/path/to/image.jpg",
  "imageBase64": "base64-encoded-image-data",
  "operation": "generate" | "search"
}
```

**Output**:
```json
{
  "embedding": [0.123, -0.456, ...],
  "dimension": 512,
  "model": "clip-vit-base-patch32",
  "processingTime": 234
}
```

### 2. Enhanced Search Lambda Function

**Purpose**: Execute hybrid text + vector searches on OpenSearch

**New Capabilities**:
- Accept `imageEmbedding` parameter
- Combine text and vector queries using `should` clause
- Apply confidence threshold (90% similarity = cosine score > 0.9)
- Return combined relevance scores

**Query Structure**:
```typescript
{
  query: {
    bool: {
      should: [
        // Text search (if query provided)
        {
          multi_match: {
            query: "search text",
            fields: ["file_name^3", "file_path^2", "extracted_text"]
          }
        },
        // Vector search (if imageEmbedding provided)
        {
          script_score: {
            query: { match_all: {} },
            script: {
              source: "knn_score",
              lang: "knn",
              params: {
                field: "image_embedding",
                query_value: [0.123, -0.456, ...],
                space_type: "cosinesimil"
              }
            }
          }
        }
      ],
      minimum_should_match: 1,
      filter: [/* file type, date filters */]
    }
  }
}
```

### 3. OpenSearch Index Configuration

**Index Name**: `cis-files`

**Mapping**:
```json
{
  "settings": {
    "index": {
      "knn": true,
      "knn.algo_param.ef_search": 512,
      "number_of_shards": 2,
      "number_of_replicas": 1
    }
  },
  "mappings": {
    "properties": {
      "file_name": {
        "type": "text",
        "fields": {
          "keyword": { "type": "keyword" }
        }
      },
      "file_path": {
        "type": "text",
        "fields": {
          "keyword": { "type": "keyword" }
        }
      },
      "file_type": {
        "type": "keyword"
      },
      "file_size": {
        "type": "long"
      },
      "extracted_text": {
        "type": "text"
      },
      "processed_at": {
        "type": "date"
      },
      "image_embedding": {
        "type": "knn_vector",
        "dimension": 512,
        "method": {
          "name": "hnsw",
          "space_type": "cosinesimil",
          "engine": "nmslib",
          "parameters": {
            "ef_construction": 512,
            "m": 16
          }
        }
      },
      "has_image_embedding": {
        "type": "boolean"
      },
      "thumbnail_url": {
        "type": "keyword"
      }
    }
  }
}
```

**k-NN Algorithm Parameters**:
- **Method**: HNSW (Hierarchical Navigable Small World)
- **Space Type**: cosinesimil (Cosine Similarity)
- **Engine**: nmslib (faster than faiss for our use case)
- **ef_construction**: 512 (higher = better recall, slower indexing)
- **m**: 16 (number of bidirectional links, balanced setting)
- **ef_search**: 512 (higher = better recall, slower search)

### 4. EC2 Worker Integration

**Enhanced Worker Tasks**:
1. Process uploaded file
2. Extract text (existing)
3. **NEW**: If image file (jpg, png, gif, etc.):
   - Generate thumbnail
   - Call Image Embedding Lambda
   - Store vector in OpenSearch with document
4. Index document with all metadata

**Image File Types**:
- jpg, jpeg, png, gif, bmp, tiff
- pdf (extract first page as image)
- docuworks (extract first page)

## API Endpoints

### POST /api/image-embedding

Generate vector embedding from an image.

**Request**:
```json
{
  "imageUrl": "https://...",
  "imageBase64": "data:image/jpeg;base64,...",
  "returnVector": true
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "embedding": [0.123, -0.456, ...],
    "dimension": 512,
    "model": "clip-vit-base-patch32"
  }
}
```

### GET /api/search (Enhanced)

**New Query Parameters**:
- `imageEmbedding`: JSON array of vector values (512 dimensions)
- `similarityThreshold`: Minimum cosine similarity (default: 0.9)
- `hybridWeight`: Balance between text and image search (0-1, default: 0.5)

**Request**:
```
GET /api/search?q=meeting&imageEmbedding=[0.123,-0.456,...]&similarityThreshold=0.9
```

**Response**:
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "doc123",
        "fileName": "meeting_notes.jpg",
        "filePath": "/projects/2024/meeting_notes.jpg",
        "relevanceScore": 0.95,
        "textScore": 0.8,
        "imageScore": 0.98,
        "thumbnailUrl": "https://...",
        "highlights": { ... }
      }
    ],
    "pagination": { ... },
    "query": {
      "textQuery": "meeting",
      "hasImageQuery": true,
      "similarityThreshold": 0.9
    }
  }
}
```

## Performance Considerations

### Vector Dimension Trade-offs

| Dimension | Accuracy | Speed | Storage |
|-----------|----------|-------|---------|
| 512 (CLIP)| High     | Good  | 2 KB    |
| 2048      | Higher   | Slow  | 8 KB    |
| 256 (PCA) | Medium   | Fast  | 1 KB    |

**Recommendation**: Start with 512 dimensions (CLIP default)

### Caching Strategy

1. **Embedding Cache** (DynamoDB):
   - Key: S3 object hash (MD5)
   - Value: Pre-computed vector
   - TTL: 30 days
   - Reduces Lambda invocations by ~80%

2. **Search Result Cache** (ElastiCache Redis):
   - Key: Hash of (query + imageEmbedding + filters)
   - Value: Search results
   - TTL: 5 minutes
   - Reduces OpenSearch load

### Indexing Performance

**Bulk Indexing**:
- Batch size: 100 documents
- Use `_bulk` API
- Refresh interval: 30s during bulk operations

**Incremental Updates**:
- Update only `image_embedding` field
- Use `_update` API with `doc` parameter

## Security

### IAM Permissions

**Image Embedding Lambda**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::cis-filesearch-bucket/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "es:ESHttpPost",
        "es:ESHttpPut"
      ],
      "Resource": "arn:aws:es:region:account:domain/cis-filesearch-opensearch/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem"
      ],
      "Resource": "arn:aws:dynamodb:region:account:table/embedding-cache"
    }
  ]
}
```

### VPC Configuration

Both Lambda functions must be in the same VPC as OpenSearch:
- Private subnets (for Lambda)
- NAT Gateway (for internet access if needed)
- Security group allowing:
  - Outbound: 443 to OpenSearch
  - Outbound: 443 to S3 via VPC endpoint

## Cost Estimation

### Lambda Costs (per 1000 searches)

**Image Embedding Lambda**:
- 3 GB RAM × 2 seconds × 1000 invocations
- Cost: ~$0.10

**Search Lambda** (existing):
- 512 MB RAM × 0.5 seconds × 1000 invocations
- Cost: ~$0.01

### OpenSearch Costs

**Storage**:
- 1M documents × 2 KB (vector) = 2 GB
- Additional cost: ~$0.20/month

**Compute**:
- k-NN searches: +10-20% CPU usage
- May require one additional node: ~$100/month

### Total Additional Cost

- Low traffic (1000 searches/day): ~$5/month
- Medium traffic (10000 searches/day): ~$50/month
- High traffic (100000 searches/day): ~$200/month

## Monitoring

### CloudWatch Metrics

**Image Embedding Lambda**:
- Invocations
- Duration (target: <2s)
- Errors
- Cold start frequency

**Search Lambda**:
- Vector search latency (target: <500ms)
- Cache hit ratio (target: >50%)
- Concurrent executions

### OpenSearch Metrics

- k-NN search latency
- Index size growth
- CPU utilization
- JVM memory pressure

### Alerts

1. Image embedding duration > 5s
2. Search latency > 1s (p99)
3. Error rate > 1%
4. OpenSearch CPU > 80%

## Rollout Strategy

### Phase 1: Infrastructure Setup
1. Enable k-NN plugin on OpenSearch
2. Update index mapping
3. Deploy Image Embedding Lambda
4. Setup DynamoDB cache table

### Phase 2: Backfill Existing Images
1. Identify all image files in S3
2. Generate embeddings (batch processing)
3. Update OpenSearch documents
4. Verify data quality

### Phase 3: Frontend Integration
1. Add image upload UI
2. Implement "Search by Image" feature
3. Display similarity scores
4. A/B test user engagement

### Phase 4: Optimization
1. Monitor performance metrics
2. Tune k-NN parameters
3. Implement caching
4. Optimize costs

## References

- [OpenSearch k-NN Documentation](https://opensearch.org/docs/latest/search-plugins/knn/index/)
- [CLIP Model](https://github.com/openai/CLIP)
- [HNSW Algorithm](https://arxiv.org/abs/1603.09320)
- [AWS Lambda for ML](https://aws.amazon.com/blogs/compute/using-container-images-with-aws-lambda/)
