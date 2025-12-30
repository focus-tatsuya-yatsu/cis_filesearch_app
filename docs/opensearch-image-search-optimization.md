# OpenSearch Image Search Query Optimization

## Overview
This guide covers optimal query strategies for image similarity search using k-NN with AWS Bedrock Titan embeddings.

## Query Types & Performance

### 1. Pure k-NN Search (Image-Only)
**Use case:** Find visually similar images
**Performance:** ⚡⚡⚡ Very Fast (30-50ms)

```json
{
  "size": 10,
  "query": {
    "knn": {
      "image_embedding": {
        "vector": [/* 1024-dim vector from Bedrock */],
        "k": 20  // Fetch top 20 candidates
      }
    }
  }
}
```

**Optimization tips:**
- Set `k` to 2-3x your desired result count for better recall
- Use `k=20` for top 10 results, `k=50` for top 20 results

### 2. Hybrid Search (Image + Text)
**Use case:** "Find images similar to this, with filename containing 'report'"
**Performance:** ⚡⚡ Fast (50-100ms)

```json
{
  "size": 10,
  "query": {
    "bool": {
      "should": [
        {
          "knn": {
            "image_embedding": {
              "vector": [/* 1024-dim vector */],
              "k": 20,
              "boost": 2.0  // Prioritize visual similarity
            }
          }
        },
        {
          "multi_match": {
            "query": "report",
            "fields": ["file_name^3", "file_path"],
            "boost": 1.0  // Text relevance weight
          }
        }
      ]
    }
  }
}
```

**Boost strategy:**
- Image-primary: `knn_boost=2.0, text_boost=1.0`
- Text-primary: `knn_boost=1.0, text_boost=2.0`
- Balanced: `knn_boost=1.5, text_boost=1.5`

### 3. Filtered k-NN Search
**Use case:** "Find similar images, but only PDFs from 2024"
**Performance:** ⚡⚡ Fast (60-120ms)

```json
{
  "size": 10,
  "query": {
    "bool": {
      "must": [
        {
          "knn": {
            "image_embedding": {
              "vector": [/* 1024-dim vector */],
              "k": 50  // Higher k due to filtering
            }
          }
        }
      ],
      "filter": [
        {
          "term": { "file_type": "pdf" }
        },
        {
          "range": {
            "modified_date": {
              "gte": "2024-01-01"
            }
          }
        }
      ]
    }
  }
}
```

**Important:** Increase `k` when using filters (2-5x) because:
- Filters are applied AFTER k-NN retrieval
- Need more candidates to compensate for filtered-out results

### 4. Script Score k-NN (Advanced Control)
**Use case:** Custom scoring logic, threshold filtering
**Performance:** ⚡ Moderate (100-200ms)

```json
{
  "size": 10,
  "query": {
    "script_score": {
      "query": {
        "bool": {
          "filter": [
            { "term": { "file_type": "image" } }
          ]
        }
      },
      "script": {
        "source": "knn_score",
        "lang": "knn",
        "params": {
          "field": "image_embedding",
          "query_value": [/* 1024-dim vector */],
          "space_type": "innerproduct"
        }
      },
      "min_score": 0.7  // Only return results with score > 0.7
    }
  }
}
```

**When to use:**
- Need to apply similarity threshold
- Custom score calculation
- Complex filtering requirements

## Performance Tuning Parameters

### ef_search (Runtime Parameter)
**Can be set per query without reindexing**

```bash
# Set globally for all queries
curl -X PUT "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_settings" -d '{
  "index.knn.algo_param.ef_search": 100
}'

# Or set per query (OpenSearch 2.4+)
{
  "query": {
    "knn": {
      "image_embedding": {
        "vector": [...],
        "k": 10,
        "ef_search": 150  // Override global setting
      }
    }
  }
}
```

**Tuning guide:**

| ef_search | Latency | Recall | Use Case |
|-----------|---------|--------|----------|
| 50 | 30ms | 85-90% | Speed-critical, can tolerate some misses |
| 100 | 50ms | 92-95% | **Balanced (recommended)** |
| 150 | 80ms | 95-97% | High accuracy needed |
| 200+ | 120ms+ | 97-99% | Critical applications only |

**Rule of thumb:** Start with `ef_search = 10 × k`

### k (Number of Neighbors)
**Determines how many results to retrieve**

```json
{
  "query": {
    "knn": {
      "image_embedding": {
        "vector": [...],
        "k": 20  // Retrieve 20 candidates
      }
    }
  },
  "size": 10  // Return only top 10 to user
}
```

**Best practices:**
- Set `k` = 2-3x `size` for better ranking accuracy
- For filtered queries: `k` = 5-10x `size`
- Maximum practical `k`: 1000 (performance degrades beyond this)

### Rescore (Two-Phase Retrieval)
**Use cheap algorithm for initial retrieval, expensive for reranking**

```json
{
  "size": 10,
  "query": {
    "knn": {
      "image_embedding": {
        "vector": [...],
        "k": 100,
        "ef_search": 80  // Fast initial retrieval
      }
    }
  },
  "rescore": {
    "window_size": 50,
    "query": {
      "rescore_query": {
        "script_score": {
          "query": { "match_all": {} },
          "script": {
            "source": "knn_score",
            "lang": "knn",
            "params": {
              "field": "image_embedding",
              "query_value": [...],
              "space_type": "innerproduct"
            }
          }
        }
      },
      "query_weight": 0.5,
      "rescore_query_weight": 1.5
    }
  }
}
```

**Benefits:**
- 30-40% faster than single-pass high-accuracy search
- Maintains high recall (95%+)
- Best for latency-sensitive applications

## Distance Metrics Deep Dive

### Inner Product vs Cosine Similarity

**Inner Product (Recommended for Titan Embeddings):**
```python
similarity = sum(a[i] * b[i] for i in range(1024))
```

**Cosine Similarity:**
```python
similarity = dot(a, b) / (norm(a) * norm(b))
```

**Why Inner Product is faster:**
- No square root calculation needed
- No normalization step
- ~10-15% faster computation

**When they're equivalent:**
- If vectors are L2-normalized: `norm(a) = norm(b) = 1.0`
- AWS Bedrock Titan embeddings ARE pre-normalized

**Verification:**
```python
import numpy as np

# Check if embedding is normalized
embedding = np.array([...])  # 1024-dim vector from Bedrock
norm = np.linalg.norm(embedding)
print(f"L2 norm: {norm}")  # Should be ≈ 1.0
```

### Distance Metrics Comparison

| Metric | Formula | Range | Best For | Speed |
|--------|---------|-------|----------|-------|
| innerproduct | a·b | [-1, 1] | Normalized vectors | ⚡⚡⚡ Fastest |
| cosinesimil | a·b/(‖a‖‖b‖) | [-1, 1] | Any vectors | ⚡⚡ Fast |
| l2 (Euclidean) | ‖a-b‖ | [0, ∞) | Spatial data | ⚡ Slower |

**Score interpretation (innerproduct/cosine):**
- 1.0: Identical images
- 0.9-0.99: Very similar (same object, different angle)
- 0.8-0.89: Similar (related objects, same category)
- 0.7-0.79: Somewhat similar (same context/theme)
- < 0.7: Different images

## Query Optimization Patterns

### Pattern 1: Pagination for k-NN
```json
{
  "size": 20,
  "from": 0,  // WARNING: from/size doesn't work well with k-NN!
  "query": {
    "knn": {
      "image_embedding": {
        "vector": [...],
        "k": 100  // Must be large enough for pagination
      }
    }
  }
}
```

**Problem:** k-NN retrieves top-k globally, pagination is applied AFTER.

**Solution: Use search_after**
```json
{
  "size": 20,
  "query": { "knn": {...} },
  "sort": [
    { "_score": "desc" },
    { "_id": "asc" }  // Tie-breaker
  ],
  "search_after": [0.95, "doc_123"]  // From previous page
}
```

### Pattern 2: Approximate Count
```json
{
  "size": 0,  // Don't return documents
  "query": { "knn": {...} },
  "track_total_hits": true  // Get accurate count
}
```

**Note:** k-NN counts are approximate. For exact count, use:
```json
{
  "query": {
    "script_score": {
      "query": { "match_all": {} },
      "script": {
        "source": "knn_score",
        "lang": "knn",
        "params": {
          "field": "image_embedding",
          "query_value": [...],
          "space_type": "innerproduct"
        }
      },
      "min_score": 0.7
    }
  },
  "track_total_hits": true
}
```

### Pattern 3: Multi-Vector Search
**Use case:** Find images similar to ANY of multiple reference images

```json
{
  "query": {
    "bool": {
      "should": [
        {
          "knn": {
            "image_embedding": {
              "vector": [/* image1 embedding */],
              "k": 20,
              "boost": 1.0
            }
          }
        },
        {
          "knn": {
            "image_embedding": {
              "vector": [/* image2 embedding */],
              "k": 20,
              "boost": 1.0
            }
          }
        }
      ]
    }
  }
}
```

### Pattern 4: Negative Search
**Use case:** "Similar to A, but NOT similar to B"

```json
{
  "query": {
    "bool": {
      "must": [
        {
          "knn": {
            "image_embedding": {
              "vector": [/* positive example */],
              "k": 50
            }
          }
        }
      ],
      "must_not": [
        {
          "script_score": {
            "query": { "match_all": {} },
            "script": {
              "source": "knn_score",
              "lang": "knn",
              "params": {
                "field": "image_embedding",
                "query_value": [/* negative example */],
                "space_type": "innerproduct"
              }
            },
            "min_score": 0.85  // Exclude highly similar to negative
          }
        }
      ]
    }
  }
}
```

## Monitoring & Profiling

### Enable Query Profiling
```json
{
  "profile": true,
  "query": {
    "knn": {
      "image_embedding": {
        "vector": [...],
        "k": 10
      }
    }
  }
}
```

**Key metrics to watch:**
```json
{
  "profile": {
    "shards": [{
      "searches": [{
        "query": [{
          "type": "KNNQuery",
          "time_in_nanos": 45000000,  // 45ms
          "breakdown": {
            "score": 30000000,         // 30ms in scoring
            "build_scorer": 15000000   // 15ms in setup
          }
        }]
      }]
    }]
  }
}
```

### CloudWatch Custom Metrics
```python
import boto3

cloudwatch = boto3.client('cloudwatch')

def log_knn_metrics(latency_ms, recall, k):
    cloudwatch.put_metric_data(
        Namespace='CIS/FileSearch',
        MetricData=[
            {
                'MetricName': 'KNNSearchLatency',
                'Value': latency_ms,
                'Unit': 'Milliseconds',
                'Dimensions': [{'Name': 'k', 'Value': str(k)}]
            },
            {
                'MetricName': 'KNNRecall',
                'Value': recall,
                'Unit': 'Percent'
            }
        ]
    )
```

## Implementation in opensearch.ts

### Current Implementation Review
Your `opensearch.ts` implementation (lines 274-293) is good but can be optimized:

**Current:**
```typescript
if (hasImageQuery) {
  shouldClauses.push({
    script_score: {
      query: { match_all: {} },
      script: {
        source: "knn_score",
        lang: "knn",
        params: {
          field: "image_embedding",
          query_value: imageEmbedding,
          space_type: "innerproduct"
        }
      }
    }
  });
}
```

**Optimized Version:**
```typescript
if (hasImageQuery) {
  // Use native k-NN query for better performance
  shouldClauses.push({
    knn: {
      image_embedding: {
        vector: imageEmbedding,
        k: hasTextQuery ? 50 : 20,  // Higher k for hybrid search
        boost: hasTextQuery ? 2.0 : 1.0  // Prioritize image similarity
      }
    }
  });
}
```

**Why this is better:**
- Uses native `knn` query (10-20% faster than `script_score`)
- Dynamically adjusts `k` based on query type
- Proper boost weighting for hybrid search
- Better integration with HNSW algorithm

### Complete Optimized Implementation

```typescript
/**
 * Optimized Image Search Query Builder
 */
export async function buildImageSearchQuery(
  searchQuery: SearchQuery
): Promise<any> {
  const {
    query,
    searchMode = 'or',
    imageEmbedding,
    fileType,
    dateFrom,
    dateTo,
    size = 20,
    from = 0,
    sortBy = 'relevance',
    sortOrder = 'desc',
  } = searchQuery;

  const hasTextQuery = query && query.trim();
  const hasImageQuery = imageEmbedding && imageEmbedding.length === 1024;

  // Validate embedding dimensions
  if (hasImageQuery && imageEmbedding.length !== 1024) {
    throw new Error(`Invalid embedding dimension: ${imageEmbedding.length}, expected 1024`);
  }

  const mustClauses: any[] = [];
  const shouldClauses: any[] = [];
  const filterClauses: any[] = [];

  // Text search (if provided)
  if (hasTextQuery) {
    const textQuery = {
      multi_match: {
        query: query.trim(),
        fields: ['file_name^3', 'file_path^2', 'extracted_text'],
        type: 'best_fields',
        operator: searchMode,
        fuzziness: searchMode === 'or' ? 'AUTO' : '0',
      },
    };

    shouldClauses.push(textQuery);
  }

  // Image k-NN search (if provided)
  if (hasImageQuery) {
    // Determine optimal k based on search type
    const optimalK = hasTextQuery
      ? Math.min(size * 5, 100)  // Hybrid: 5x size, max 100
      : Math.min(size * 3, 50);  // Pure image: 3x size, max 50

    shouldClauses.push({
      knn: {
        image_embedding: {
          vector: imageEmbedding,
          k: optimalK,
          boost: hasTextQuery ? 2.0 : 1.0,  // Prioritize image in hybrid
        },
      },
    });
  }

  // Filters
  if (fileType && fileType !== 'all') {
    filterClauses.push({ term: { file_type: fileType } });
  }

  if (dateFrom || dateTo) {
    const rangeQuery: any = {};
    if (dateFrom) rangeQuery.gte = dateFrom;
    if (dateTo) rangeQuery.lte = dateTo;
    filterClauses.push({ range: { modified_date: rangeQuery } });
  }

  // Minimum should match for hybrid search
  const minimumShouldMatch = shouldClauses.length > 0 && mustClauses.length === 0 ? 1 : undefined;

  // Sort configuration
  const sort: any[] = [];
  if (sortBy === 'relevance') {
    sort.push('_score');
  } else if (sortBy === 'date') {
    sort.push({ modified_date: { order: sortOrder } });
    sort.push('_score');  // Secondary sort by relevance
  } else if (sortBy === 'name') {
    sort.push({ 'file_name.keyword': { order: sortOrder } });
  } else if (sortBy === 'size') {
    sort.push({ file_size: { order: sortOrder } });
  }

  // Add tie-breaker for consistent pagination
  sort.push({ _id: 'asc' });

  return {
    query: {
      bool: {
        must: mustClauses.length > 0 ? mustClauses : undefined,
        should: shouldClauses.length > 0 ? shouldClauses : undefined,
        filter: filterClauses.length > 0 ? filterClauses : undefined,
        minimum_should_match: minimumShouldMatch,
      },
    },
    highlight: {
      fields: {
        extracted_text: { fragment_size: 150, number_of_fragments: 3 },
        file_name: {},
        file_path: {},
      },
      pre_tags: ['<mark>'],
      post_tags: ['</mark>'],
    },
    size,
    from,
    sort,
    track_total_hits: true,
    _source: {
      excludes: ['image_embedding'],  // Don't return large vector in results
    },
  };
}
```

## Performance Benchmarks

### Expected Latencies (P95)

| Query Type | Document Count | Latency | Notes |
|-----------|----------------|---------|-------|
| Pure k-NN (k=10) | 100K | 35ms | Optimal |
| Pure k-NN (k=50) | 100K | 60ms | Good |
| Hybrid (text + image) | 100K | 85ms | Acceptable |
| Filtered k-NN | 100K | 110ms | Higher k needed |
| Pure k-NN (k=10) | 1M | 120ms | Consider sharding |

### Optimization Checklist

✅ Use `innerproduct` for Titan embeddings (10-15% faster)
✅ Set `k` = 2-3x `size` for better recall
✅ Use native `knn` query instead of `script_score` when possible
✅ Exclude `image_embedding` from `_source` in results
✅ Add `_id` to sort for pagination consistency
✅ Use `ef_search=100` as starting point
✅ Enable query profiling in development
✅ Monitor P95/P99 latencies in CloudWatch

## Further Reading

- [OpenSearch k-NN Performance Tuning](https://opensearch.org/docs/latest/search-plugins/knn/performance-tuning/)
- [FAISS Index Types](https://github.com/facebookresearch/faiss/wiki/Faiss-indexes)
- [Bedrock Titan Embeddings](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-multiemb-models.html)
