/**
 * OpenSearch k-NN Performance Optimization Module
 *
 * Features:
 * - Dynamic ef_search calculation based on data size
 * - Optimized index settings
 * - Performance monitoring
 * - Query optimization patterns
 */

import { Client } from '@opensearch-project/opensearch'

/**
 * Performance configuration interface
 */
export interface PerformanceConfig {
  indexSize: number
  targetLatencyMs: number
  nodeCount: number
  memoryGB: number
}

/**
 * Index optimization settings
 */
export interface OptimizedIndexSettings {
  shardCount: number
  replicaCount: number
  efSearch: number
  efConstruction: number
  m: number
  refreshInterval: string
}

/**
 * Calculate optimal ef_search parameter based on index size and latency requirements
 *
 * @param indexSize - Number of documents in the index
 * @param targetLatencyMs - Target query latency in milliseconds
 * @returns Optimal ef_search value
 */
export const calculateOptimalEfSearch = (indexSize: number, targetLatencyMs: number): number => {
  // Base ef_search value based on data size
  let baseEfSearch: number

  if (indexSize < 100_000) {
    baseEfSearch = 128 // Small dataset
  } else if (indexSize < 1_000_000) {
    baseEfSearch = 256 // Medium dataset
  } else if (indexSize < 10_000_000) {
    baseEfSearch = 512 // Large dataset
  } else {
    baseEfSearch = 1024 // Very large dataset
  }

  // Adjust based on latency requirements
  const latencyFactor =
    targetLatencyMs < 50
      ? 0.7 // Real-time (< 50ms)
      : targetLatencyMs < 100
        ? 1.0 // Interactive (< 100ms)
        : 1.3 // Batch processing (> 100ms)

  return Math.round(baseEfSearch * latencyFactor)
}

/**
 * Calculate optimal shard count
 * Formula: ceil(documents / 1M) × node_count
 *
 * @param documentCount - Total number of documents
 * @param nodeCount - Number of OpenSearch nodes
 * @returns Optimal shard count
 */
export const calculateOptimalShardCount = (documentCount: number, nodeCount: number): number => {
  const baseShards = Math.ceil(documentCount / 1_000_000)
  return Math.max(1, baseShards * nodeCount)
}

/**
 * Determine optimal replica count based on availability requirements
 *
 * @param environment - Deployment environment
 * @returns Optimal replica count
 */
export const calculateOptimalReplicaCount = (
  environment: 'development' | 'staging' | 'production' | 'critical'
): number => {
  switch (environment) {
    case 'development':
      return 0 // Cost optimization
    case 'staging':
      return 1 // Standard availability
    case 'production':
      return 1 // 99.9% SLA
    case 'critical':
      return 2 // 99.99% SLA
    default:
      return 1
  }
}

/**
 * Generate optimized index settings
 *
 * @param config - Performance configuration
 * @returns Optimized index settings
 */
export const generateOptimizedSettings = (config: PerformanceConfig): OptimizedIndexSettings => {
  const shardCount = calculateOptimalShardCount(config.indexSize, config.nodeCount)
  const efSearch = calculateOptimalEfSearch(config.indexSize, config.targetLatencyMs)

  // ef_construction should be 2-4x ef_search for optimal build quality
  const efConstruction = Math.min(512, efSearch * 2)

  // m parameter: 16-48 range, higher for larger datasets
  const m = config.indexSize < 1_000_000 ? 16 : 24

  // refresh_interval: longer for bulk indexing, shorter for real-time
  const refreshInterval = config.indexSize > 1_000_000 ? '30s' : '10s'

  return {
    shardCount,
    replicaCount: 1, // Default to production setting
    efSearch,
    efConstruction,
    m,
    refreshInterval,
  }
}

/**
 * Create optimized k-NN index configuration
 *
 * @param indexName - Name of the index
 * @param config - Performance configuration
 * @returns Index creation body
 */
export const createOptimizedIndexConfig = (indexName: string, config: PerformanceConfig): any => {
  const settings = generateOptimizedSettings(config)

  return {
    settings: {
      index: {
        // Shard configuration
        number_of_shards: settings.shardCount,
        number_of_replicas: settings.replicaCount,

        // k-NN configuration
        knn: true,
        'knn.algo_param.ef_search': settings.efSearch,

        // Performance optimization
        refresh_interval: settings.refreshInterval,
        max_result_window: 10000,
        'translog.durability': 'async',
        'translog.flush_threshold_size': '512mb',

        // Cache configuration
        'cache.query.enable': true,
        'cache.request.enable': true,
        'indices.queries.cache.size': '10%',

        // Memory optimization
        'merge.policy.max_merged_segment': '5gb',
        codec: 'best_compression',
      },

      // Analyzer configuration for Japanese text
      analysis: {
        analyzer: {
          japanese_analyzer: {
            type: 'custom',
            tokenizer: 'kuromoji_tokenizer',
            filter: ['kuromoji_baseform', 'lowercase', 'cjk_width'],
          },
        },
      },
    },

    mappings: {
      properties: {
        file_name: {
          type: 'text',
          analyzer: 'japanese_analyzer',
          fields: {
            keyword: { type: 'keyword' },
          },
        },
        file_path: {
          type: 'text',
          analyzer: 'japanese_analyzer',
          fields: {
            keyword: { type: 'keyword' },
          },
        },
        file_type: {
          type: 'keyword',
        },
        file_size: {
          type: 'long',
        },
        processed_at: {
          type: 'date',
        },
        extracted_text: {
          type: 'text',
          analyzer: 'japanese_analyzer',
        },
        s3_key: {
          type: 'keyword',
        },
        // Optimized k-NN vector field
        image_embedding: {
          type: 'knn_vector',
          dimension: 1024, // AWS Bedrock Titan Embeddings dimension
          method: {
            name: 'hnsw',
            space_type: 'innerproduct', // Optimal for normalized vectors
            engine: 'faiss',
            parameters: {
              ef_construction: settings.efConstruction,
              m: settings.m,
            },
          },
        },
      },
    },
  }
}

/**
 * Build optimized k-NN search query with filters
 *
 * @param vector - Query vector (1024 dimensions)
 * @param options - Search options
 * @returns OpenSearch query body
 */
export const buildOptimizedKNNQuery = (
  vector: number[],
  options: {
    k?: number
    fileType?: string
    dateFrom?: string
    dateTo?: string
    minScore?: number
  } = {}
): any => {
  const { k = 50, fileType, dateFrom, dateTo, minScore = 0.7 } = options

  const filterClauses: any[] = []

  // File type filter
  if (fileType && fileType !== 'all') {
    filterClauses.push({
      term: { file_type: fileType },
    })
  }

  // Date range filter
  if (dateFrom || dateTo) {
    const rangeQuery: any = {}
    if (dateFrom) rangeQuery.gte = dateFrom
    if (dateTo) rangeQuery.lte = dateTo

    filterClauses.push({
      range: { processed_at: rangeQuery },
    })
  }

  // Build query based on whether filters exist
  if (filterClauses.length > 0) {
    // Filtered k-NN search using script_score
    return {
      query: {
        bool: {
          must: [
            {
              script_score: {
                query: {
                  bool: {
                    filter: filterClauses,
                  },
                },
                script: {
                  source: 'knn_score',
                  lang: 'knn',
                  params: {
                    field: 'image_embedding',
                    query_value: vector,
                    space_type: 'innerproduct',
                  },
                },
                min_score: minScore,
              },
            },
          ],
        },
      },
      size: k,
      _source: ['file_name', 'file_path', 'file_type', 'file_size', 'processed_at', 's3_key'],
      track_total_hits: true,
    }
  } else {
    // Simple k-NN search without filters
    return {
      query: {
        knn: {
          image_embedding: {
            vector,
            k,
          },
        },
      },
      size: k,
      min_score: minScore,
      _source: ['file_name', 'file_path', 'file_type', 'file_size', 'processed_at', 's3_key'],
      track_total_hits: true,
    }
  }
}

/**
 * Batch k-NN search for multiple vectors
 * Uses msearch API for efficient bulk operations
 *
 * @param client - OpenSearch client
 * @param vectors - Array of query vectors
 * @param indexName - Target index name
 * @param k - Number of results per vector
 * @returns Array of search results
 */
export const batchKNNSearch = async (
  client: Client,
  vectors: number[][],
  indexName: string,
  k: number = 20
): Promise<any[]> => {
  const body: any[] = []

  vectors.forEach((vector) => {
    body.push({ index: indexName })
    body.push(buildOptimizedKNNQuery(vector, { k }))
  })

  const response = await client.msearch({ body })
  return response.body.responses
}

/**
 * Search with pagination using search_after
 * More efficient than from/size for deep pagination
 *
 * @param client - OpenSearch client
 * @param vector - Query vector
 * @param indexName - Target index name
 * @param pageSize - Number of results per page
 * @param searchAfter - Search after cursor from previous page
 * @returns Search results with next cursor
 */
export const searchWithPagination = async (
  client: Client,
  vector: number[],
  indexName: string,
  pageSize: number = 20,
  searchAfter?: any[]
): Promise<{ results: any[]; nextSearchAfter: any[] | null }> => {
  const query = buildOptimizedKNNQuery(vector, { k: pageSize })

  // Add sort for search_after
  query.sort = [{ _score: 'desc' }, { _id: 'asc' }]

  // Add search_after if provided
  if (searchAfter) {
    query.search_after = searchAfter
  }

  const response = await client.search({
    index: indexName,
    body: query,
  })

  const { hits } = response.body.hits
  const nextSearchAfter = hits.length > 0 ? hits[hits.length - 1].sort : null

  return {
    results: hits,
    nextSearchAfter,
  }
}

/**
 * Performance metrics interface
 */
export interface PerformanceMetrics {
  queryLatency: {
    p50: number
    p95: number
    p99: number
    max: number
  }
  throughput: {
    queriesPerSecond: number
  }
  cache: {
    hitRate: number
    missRate: number
  }
}

/**
 * Calculate performance metrics from query history
 *
 * @param queryTimes - Array of query execution times in ms
 * @param cacheHits - Number of cache hits
 * @param cacheMisses - Number of cache misses
 * @returns Performance metrics
 */
export const calculatePerformanceMetrics = (
  queryTimes: number[],
  cacheHits: number,
  cacheMisses: number
): PerformanceMetrics => {
  const sorted = [...queryTimes].sort((a, b) => a - b)
  const total = cacheHits + cacheMisses

  return {
    queryLatency: {
      p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
      p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
      p99: sorted[Math.floor(sorted.length * 0.99)] || 0,
      max: sorted[sorted.length - 1] || 0,
    },
    throughput: {
      queriesPerSecond: queryTimes.length / (Math.max(...queryTimes) / 1000) || 0,
    },
    cache: {
      hitRate: total > 0 ? cacheHits / total : 0,
      missRate: total > 0 ? cacheMisses / total : 0,
    },
  }
}

/**
 * Estimate memory requirements for k-NN index
 * Formula: documents × dimensions × 4 bytes × (1 + m/8)
 *
 * @param documentCount - Number of documents
 * @param dimension - Vector dimension (default: 1024)
 * @param m - HNSW m parameter (default: 24)
 * @returns Estimated memory in GB
 */
export const estimateMemoryRequirements = (
  documentCount: number,
  dimension: number = 1024,
  m: number = 24
): number => {
  const bytes = documentCount * dimension * 4 * (1 + m / 8)
  const gb = bytes / (1024 * 1024 * 1024)
  return Math.ceil(gb * 1.2) // Add 20% buffer
}

/**
 * Recommend instance type based on workload
 *
 * @param config - Performance configuration
 * @returns Recommended AWS OpenSearch instance type
 */
export const recommendInstanceType = (config: PerformanceConfig): string => {
  const requiredMemoryGB = estimateMemoryRequirements(config.indexSize)

  if (requiredMemoryGB < 8) {
    return 't3.medium.search' // 4 GB, cost-effective for small datasets
  } else if (requiredMemoryGB < 16) {
    return 'r6g.large.search' // 16 GB, good for medium datasets
  } else if (requiredMemoryGB < 32) {
    return 'r6g.xlarge.search' // 32 GB, standard production
  } else if (requiredMemoryGB < 64) {
    return 'r6g.2xlarge.search' // 64 GB, large datasets
  } else {
    return 'r6g.4xlarge.search' // 128 GB, very large datasets
  }
}
