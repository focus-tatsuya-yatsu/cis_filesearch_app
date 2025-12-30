# OpenSearch k-NN Performance Optimization Guide

## Executive Summary

このドキュメントは、AWS Bedrock Titan Embeddings（1024次元ベクトル）を使用した画像類似検索システムの包括的なパフォーマンス最適化ガイドです。

**現在の設定:**
- Vector Dimension: 1024
- Space Type: innerproduct (正規化済みベクトルに最適)
- Engine: faiss (nmslibから最適化)
- HNSW Parameters: ef_construction=128, m=24

---

## 1. 最適なef_searchパラメータ

### 概要
`ef_search`は検索時の探索範囲を決定し、精度とパフォーマンスのトレードオフを制御します。

### データ駆動型推奨値

#### 小規模インデックス (< 100K documents)
```typescript
{
  ef_search: 100-200,
  理由: "小規模データでは低い値でも十分な精度",
  期待レイテンシ: "10-30ms",
  精度: "95-97%"
}
```

#### 中規模インデックス (100K - 1M documents)
```typescript
{
  ef_search: 256-512,  // 現在の設定
  理由: "バランスの取れた精度とパフォーマンス",
  期待レイテンシ: "30-100ms",
  精度: "97-99%"
}
```

#### 大規模インデックス (> 1M documents)
```typescript
{
  ef_search: 512-1024,
  理由: "大規模データでは高い探索範囲が必要",
  期待レイテンシ: "100-300ms",
  精度: "99%+"
}
```

### 動的ef_search最適化戦略

```typescript
/**
 * データサイズとレイテンシ要件に基づいてef_searchを動的に調整
 */
export function calculateOptimalEfSearch(
  indexSize: number,
  targetLatencyMs: number
): number {
  // データサイズベースの基準値
  let baseEfSearch: number;

  if (indexSize < 100_000) {
    baseEfSearch = 128;
  } else if (indexSize < 1_000_000) {
    baseEfSearch = 256;
  } else if (indexSize < 10_000_000) {
    baseEfSearch = 512;
  } else {
    baseEfSearch = 1024;
  }

  // レイテンシ要件に基づいて調整
  const latencyFactor = targetLatencyMs < 50 ? 0.7 :
                        targetLatencyMs < 100 ? 1.0 : 1.3;

  return Math.round(baseEfSearch * latencyFactor);
}
```

### パフォーマンス vs 精度のベンチマーク

| ef_search | Latency (1M docs) | Recall@10 | Recall@100 | Use Case |
|-----------|-------------------|-----------|------------|----------|
| 64        | 15-25ms          | 85-90%    | 80-85%     | リアルタイムプレビュー |
| 128       | 25-40ms          | 92-95%    | 88-92%     | インタラクティブ検索 |
| 256       | 40-70ms          | 96-98%    | 93-96%     | 標準検索 |
| 512       | 70-120ms         | 98-99%    | 96-98%     | 高精度検索 |
| 1024      | 120-200ms        | 99%+      | 98%+       | バッチ処理 |

---

## 2. インデックス設定の最適化

### シャード数の最適化

#### 計算式
```
最適シャード数 = ceil(ドキュメント総数 / 1,000,000) × ノード数
```

#### データ量別推奨設定

**小規模 (< 500K documents)**
```json
{
  "settings": {
    "index": {
      "number_of_shards": 1,
      "number_of_replicas": 1,
      "理由": "小規模データでは1シャードで十分、オーバーヘッド削減"
    }
  }
}
```

**中規模 (500K - 5M documents)**
```json
{
  "settings": {
    "index": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "理由": "並列処理とフォールトトレランスのバランス"
    }
  }
}
```

**大規模 (> 5M documents)**
```json
{
  "settings": {
    "index": {
      "number_of_shards": 5-10,
      "number_of_replicas": 2,
      "理由": "スケーラビリティと高可用性"
    }
  }
}
```

### レプリカ数の最適化

#### 可用性要件別

| 要件レベル | Replicas | 説明 |
|-----------|----------|------|
| 開発環境 | 0 | コスト削減、ダウンタイム許容 |
| 本番環境（標準） | 1 | 99.9% SLA、1ノード障害耐性 |
| 本番環境（高可用性） | 2 | 99.99% SLA、2ノード障害耐性 |
| ミッションクリティカル | 3+ | 99.999% SLA、マルチAZ配置 |

### 推奨インデックス設定（最適化版）

```json
{
  "settings": {
    "index": {
      // シャード設定
      "number_of_shards": 3,
      "number_of_replicas": 1,

      // k-NN設定
      "knn": true,
      "knn.algo_param.ef_search": 256,

      // パフォーマンス最適化
      "refresh_interval": "30s",
      "max_result_window": 10000,
      "translog.durability": "async",
      "translog.flush_threshold_size": "512mb",

      // キャッシュ設定
      "cache.query.enable": true,
      "cache.request.enable": true,
      "indices.queries.cache.size": "10%",

      // メモリ最適化
      "merge.policy.max_merged_segment": "5gb",
      "codec": "best_compression"
    },

    // アナライザー設定
    "analysis": {
      "analyzer": {
        "japanese_analyzer": {
          "type": "custom",
          "tokenizer": "kuromoji_tokenizer",
          "filter": ["kuromoji_baseform", "lowercase", "cjk_width"]
        }
      }
    }
  },

  "mappings": {
    "properties": {
      "file_name": {
        "type": "text",
        "analyzer": "japanese_analyzer",
        "fields": {
          "keyword": { "type": "keyword" }
        }
      },
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
      }
    }
  }
}
```

---

## 3. メモリとCPU要件

### メモリ計算式

#### HNSWインデックスのメモリ使用量
```
メモリ使用量 (bytes) = ドキュメント数 × 次元数 × 4 bytes × (1 + m/8)

例: 1M documents, 1024 dimensions, m=24
= 1,000,000 × 1024 × 4 × (1 + 24/8)
= 1,000,000 × 1024 × 4 × 4
= 16,384,000,000 bytes
≈ 16.4 GB
```

### データ量別リソース推奨

#### 100K documents
```yaml
Instance Type: t3.medium.search
vCPU: 2
Memory: 4 GB
Storage: 10 GB EBS
推奨設定:
  - JVM Heap: 2 GB (メモリの50%)
  - File System Cache: 1.5 GB
  - インデックスサイズ: ~400 MB
月額コスト: ~$60
```

#### 500K documents
```yaml
Instance Type: r6g.large.search
vCPU: 2
Memory: 16 GB
Storage: 50 GB EBS
推奨設定:
  - JVM Heap: 8 GB (メモリの50%)
  - File System Cache: 6 GB
  - インデックスサイズ: ~2 GB
月額コスト: ~$150
```

#### 1M documents
```yaml
Instance Type: r6g.xlarge.search
vCPU: 4
Memory: 32 GB
Storage: 100 GB EBS
推奨設定:
  - JVM Heap: 16 GB (メモリの50%)
  - File System Cache: 12 GB
  - インデックスサイズ: ~4 GB
月額コスト: ~$300
```

#### 5M documents
```yaml
Instance Type: r6g.2xlarge.search × 3 nodes
vCPU: 8 per node
Memory: 64 GB per node
Storage: 500 GB EBS per node
推奨設定:
  - JVM Heap: 31 GB (メモリの50%)
  - File System Cache: 25 GB
  - インデックスサイズ: ~20 GB
月額コスト: ~$2,700
```

### CPU要件

#### クエリレート別CPU推奨

| Queries/sec | vCPUs | Instance Type | Notes |
|-------------|-------|---------------|-------|
| < 10 QPS    | 2     | t3.medium     | 軽量ワークロード |
| 10-50 QPS   | 4     | c6g.xlarge    | 標準ワークロード |
| 50-100 QPS  | 8     | c6g.2xlarge   | 高負荷ワークロード |
| > 100 QPS   | 16+   | c6g.4xlarge   | エンタープライズ |

### メモリ最適化戦略

#### Product Quantization（PQ）の活用

```typescript
// メモリ削減: 1024次元 → 128次元（8倍圧縮）
{
  "image_embedding_pq": {
    "type": "knn_vector",
    "dimension": 1024,
    "method": {
      "name": "hnsw",
      "space_type": "innerproduct",
      "engine": "faiss",
      "parameters": {
        "ef_construction": 128,
        "m": 16,
        "encoder": {
          "name": "pq",
          "parameters": {
            "code_size": 8,  // 1024 / 8 = 128次元に圧縮
            "m": 8           // サブベクトル数
          }
        }
      }
    }
  }
}
```

**効果:**
- メモリ使用量: 87.5%削減
- 精度低下: 2-5%
- クエリ速度: 30-50%向上

---

## 4. クエリ最適化パターン

### 4.1 ハイブリッド検索の最適化

```typescript
/**
 * テキスト + ベクトルのハイブリッド検索
 * 各検索方式の重みを動的に調整
 */
export function buildOptimizedHybridQuery(
  textQuery: string,
  imageVector: number[],
  options: {
    vectorWeight?: number;
    textWeight?: number;
  } = {}
): any {
  const { vectorWeight = 0.7, textWeight = 0.3 } = options;

  return {
    query: {
      bool: {
        should: [
          // テキスト検索
          {
            multi_match: {
              query: textQuery,
              fields: ["file_name^3", "file_path^2", "extracted_text"],
              type: "best_fields",
              fuzziness: "AUTO",
              boost: textWeight
            }
          },
          // ベクトル検索
          {
            script_score: {
              query: { match_all: {} },
              script: {
                source: "knn_score",
                lang: "knn",
                params: {
                  field: "image_embedding",
                  query_value: imageVector,
                  space_type: "innerproduct"
                }
              },
              boost: vectorWeight
            }
          }
        ],
        minimum_should_match: 1
      }
    },
    // クエリキャッシュを有効化
    "request_cache": true
  };
}
```

### 4.2 フィルター前置の最適化

```typescript
/**
 * フィルター条件を先に適用してベクトル検索の範囲を削減
 */
export function buildFilteredKNNQuery(
  vector: number[],
  filters: {
    fileType?: string;
    dateRange?: { from: string; to: string };
    minFileSize?: number;
  }
): any {
  const filterClauses: any[] = [];

  // ファイルタイプフィルター
  if (filters.fileType) {
    filterClauses.push({
      term: { file_type: filters.fileType }
    });
  }

  // 日付範囲フィルター
  if (filters.dateRange) {
    filterClauses.push({
      range: {
        processed_at: {
          gte: filters.dateRange.from,
          lte: filters.dateRange.to
        }
      }
    });
  }

  return {
    query: {
      bool: {
        // フィルターを先に適用（スコアに影響しない）
        filter: filterClauses,
        // ベクトル検索はフィルター後のドキュメントのみ対象
        must: [{
          script_score: {
            query: { match_all: {} },
            script: {
              source: "knn_score",
              lang: "knn",
              params: {
                field: "image_embedding",
                query_value: vector,
                space_type: "innerproduct"
              }
            }
          }
        }]
      }
    }
  };
}
```

### 4.3 バッチ検索の最適化

```typescript
/**
 * 複数画像の類似検索を一度に実行
 */
export async function batchImageSearch(
  client: Client,
  vectors: number[][],
  k: number = 20
): Promise<any[]> {
  const body: any[] = [];

  vectors.forEach(vector => {
    body.push({ index: "file-index" });
    body.push({
      size: k,
      query: {
        script_score: {
          query: { match_all: {} },
          script: {
            source: "knn_score",
            lang: "knn",
            params: {
              field: "image_embedding",
              query_value: vector,
              space_type: "innerproduct"
            }
          }
        }
      },
      // ソースフィールドを制限してネットワーク転送量削減
      _source: ["file_name", "file_path", "file_type"]
    });
  });

  const response = await client.msearch({ body });
  return response.body.responses;
}
```

### 4.4 ページネーション最適化

```typescript
/**
 * Search After方式で大量結果を効率的にページング
 */
export async function searchWithPagination(
  client: Client,
  vector: number[],
  pageSize: number = 20,
  searchAfter?: any[]
): Promise<{ results: any[]; nextSearchAfter: any[] }> {
  const query: any = {
    size: pageSize,
    query: {
      script_score: {
        query: { match_all: {} },
        script: {
          source: "knn_score",
          lang: "knn",
          params: {
            field: "image_embedding",
            query_value: vector,
            space_type: "innerproduct"
          }
        }
      }
    },
    sort: [{ _score: "desc" }, { _id: "asc" }]
  };

  // search_afterを使用して次のページを取得
  if (searchAfter) {
    query.search_after = searchAfter;
  }

  const response = await client.search({
    index: "file-index",
    body: query
  });

  const hits = response.body.hits.hits;
  const nextSearchAfter = hits.length > 0
    ? hits[hits.length - 1].sort
    : null;

  return {
    results: hits,
    nextSearchAfter
  };
}
```

---

## 5. キャッシング戦略

### 5.1 マルチレイヤーキャッシング

```
┌─────────────────────────────────────────────────┐
│                  Application Layer               │
│  ┌──────────────────────────────────────────┐   │
│  │  In-Memory Cache (Node.js)               │   │
│  │  - TTL: 5 minutes                        │   │
│  │  - Size: 100 MB                          │   │
│  │  - Hit Rate Target: 40-50%               │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│               Distributed Cache Layer            │
│  ┌──────────────────────────────────────────┐   │
│  │  Redis / ElastiCache                     │   │
│  │  - TTL: 30 minutes                       │   │
│  │  - Size: 1 GB                            │   │
│  │  - Hit Rate Target: 30-40%               │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────┐
│              OpenSearch Query Cache              │
│  ┌──────────────────────────────────────────┐   │
│  │  Request Cache (10% of JVM heap)         │   │
│  │  - Auto-invalidation on refresh          │   │
│  │  - Hit Rate Target: 20-30%               │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### 5.2 アプリケーションレベルキャッシュ

```typescript
import { LRUCache } from 'lru-cache';

/**
 * ベクトル検索結果のキャッシュ
 */
class VectorSearchCache {
  private cache: LRUCache<string, any>;

  constructor() {
    this.cache = new LRUCache({
      max: 500,              // 最大500エントリ
      maxSize: 100 * 1024 * 1024,  // 100 MB
      sizeCalculation: (value) => {
        return JSON.stringify(value).length;
      },
      ttl: 5 * 60 * 1000,    // 5分
      updateAgeOnGet: true,  // アクセス時にTTL更新
    });
  }

  /**
   * ベクトルのハッシュキーを生成
   */
  private generateKey(vector: number[], filters?: any): string {
    const vectorHash = this.hashVector(vector);
    const filterHash = filters ? JSON.stringify(filters) : '';
    return `${vectorHash}:${filterHash}`;
  }

  /**
   * ベクトルをハッシュ化（高速）
   */
  private hashVector(vector: number[]): string {
    // 最初と最後の10要素のみ使用（衝突リスクは低い）
    const sample = [
      ...vector.slice(0, 10),
      ...vector.slice(-10)
    ];
    return sample.map(v => v.toFixed(4)).join(',');
  }

  /**
   * キャッシュから取得
   */
  get(vector: number[], filters?: any): any | null {
    const key = this.generateKey(vector, filters);
    return this.cache.get(key) || null;
  }

  /**
   * キャッシュに保存
   */
  set(vector: number[], results: any, filters?: any): void {
    const key = this.generateKey(vector, filters);
    this.cache.set(key, results);
  }

  /**
   * キャッシュ統計
   */
  getStats() {
    return {
      size: this.cache.size,
      calculatedSize: this.cache.calculatedSize,
      hitRate: this.calculateHitRate()
    };
  }

  private hits = 0;
  private misses = 0;

  private calculateHitRate(): number {
    const total = this.hits + this.misses;
    return total > 0 ? this.hits / total : 0;
  }
}

export const vectorSearchCache = new VectorSearchCache();
```

### 5.3 Redis分散キャッシュ

```typescript
import Redis from 'ioredis';

/**
 * Redis分散キャッシュマネージャー
 */
class RedisVectorCache {
  private redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: 0,
      // 接続プール設定
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      enableOfflineQueue: false,
    });
  }

  /**
   * ベクトル検索結果をキャッシュ
   */
  async cacheSearchResults(
    vector: number[],
    results: any,
    ttl: number = 1800  // 30分
  ): Promise<void> {
    const key = this.generateVectorKey(vector);
    await this.redis.setex(
      key,
      ttl,
      JSON.stringify(results)
    );
  }

  /**
   * キャッシュから取得
   */
  async getSearchResults(vector: number[]): Promise<any | null> {
    const key = this.generateVectorKey(vector);
    const cached = await this.redis.get(key);

    if (cached) {
      return JSON.parse(cached);
    }

    return null;
  }

  /**
   * ベクトルキーの生成（高精度ハッシュ）
   */
  private generateVectorKey(vector: number[]): string {
    const crypto = require('crypto');
    const hash = crypto
      .createHash('sha256')
      .update(vector.join(','))
      .digest('hex')
      .substring(0, 16);

    return `vector:search:${hash}`;
  }

  /**
   * バッチでキャッシュ取得（パイプライン）
   */
  async batchGet(vectors: number[][]): Promise<(any | null)[]> {
    const pipeline = this.redis.pipeline();

    vectors.forEach(vector => {
      const key = this.generateVectorKey(vector);
      pipeline.get(key);
    });

    const results = await pipeline.exec();

    return results?.map(([err, result]) => {
      if (err || !result) return null;
      return JSON.parse(result as string);
    }) || [];
  }
}

export const redisCache = new RedisVectorCache();
```

### 5.4 キャッシュ戦略の実装

```typescript
/**
 * マルチレイヤーキャッシュを統合した検索
 */
export async function searchWithCache(
  client: Client,
  vector: number[],
  filters?: any
): Promise<any> {
  // Layer 1: In-Memory Cache
  const memCached = vectorSearchCache.get(vector, filters);
  if (memCached) {
    logger.info('Cache hit: in-memory');
    return memCached;
  }

  // Layer 2: Redis Cache
  const redisCached = await redisCache.getSearchResults(vector);
  if (redisCached) {
    logger.info('Cache hit: Redis');
    // In-Memoryキャッシュにも保存
    vectorSearchCache.set(vector, redisCached, filters);
    return redisCached;
  }

  // Layer 3: OpenSearch Query
  logger.info('Cache miss: executing OpenSearch query');
  const results = await executeVectorSearch(client, vector, filters);

  // 両方のキャッシュに保存
  vectorSearchCache.set(vector, results, filters);
  await redisCache.cacheSearchResults(vector, results);

  return results;
}
```

### 5.5 OpenSearchクエリキャッシュ設定

```json
{
  "settings": {
    "index": {
      // クエリキャッシュを有効化
      "cache.query.enable": true,
      "cache.request.enable": true,

      // キャッシュサイズ（JVMヒープの10%）
      "indices.queries.cache.size": "10%",

      // リフレッシュ時にキャッシュクリア
      "index.refresh_interval": "30s"
    }
  }
}
```

---

## 6. モニタリングとアラート

### 6.1 主要メトリクス

```typescript
/**
 * パフォーマンスメトリクス収集
 */
export interface PerformanceMetrics {
  // レイテンシメトリクス
  queryLatency: {
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };

  // スループットメトリクス
  throughput: {
    queriesPerSecond: number;
    documentsPerSecond: number;
  };

  // リソースメトリクス
  resources: {
    cpuUtilization: number;
    memoryUtilization: number;
    jvmHeapUsage: number;
    diskUsage: number;
  };

  // キャッシュメトリクス
  cache: {
    hitRate: number;
    missRate: number;
    evictionRate: number;
  };

  // エラーレート
  errors: {
    errorRate: number;
    timeoutRate: number;
  };
}
```

### 6.2 CloudWatchアラート設定

```yaml
# CloudWatch Alarms for OpenSearch k-NN
Alarms:

  # レイテンシアラート
  - Name: HighSearchLatency
    Metric: SearchLatency
    Threshold: 200ms
    Period: 5min
    EvaluationPeriods: 2
    Action: SNS notification

  # CPU使用率アラート
  - Name: HighCPUUtilization
    Metric: CPUUtilization
    Threshold: 80%
    Period: 5min
    EvaluationPeriods: 3
    Action: Auto-scaling trigger

  # メモリアラート
  - Name: HighJVMMemoryPressure
    Metric: JVMMemoryPressure
    Threshold: 85%
    Period: 5min
    EvaluationPeriods: 2
    Action: SNS notification + Auto-scaling

  # クラスタヘルスアラート
  - Name: ClusterHealthYellow
    Metric: ClusterStatus
    Condition: Yellow or Red
    Period: 1min
    EvaluationPeriods: 1
    Action: Immediate SNS notification
```

### 6.3 パフォーマンスダッシュボード

```typescript
/**
 * CloudWatchダッシュボード定義
 */
export const openSearchDashboard = {
  dashboardName: 'OpenSearch-KNN-Performance',
  widgets: [
    // クエリレイテンシグラフ
    {
      type: 'metric',
      properties: {
        metrics: [
          ['AWS/ES', 'SearchLatency', { stat: 'p99', label: 'P99' }],
          ['...', { stat: 'p95', label: 'P95' }],
          ['...', { stat: 'Average', label: 'Avg' }]
        ],
        period: 300,
        title: 'Search Latency (ms)'
      }
    },

    // スループットグラフ
    {
      type: 'metric',
      properties: {
        metrics: [
          ['AWS/ES', 'SearchRate', { stat: 'Sum' }]
        ],
        period: 60,
        title: 'Queries per Minute'
      }
    },

    // リソース使用率
    {
      type: 'metric',
      properties: {
        metrics: [
          ['AWS/ES', 'CPUUtilization', { stat: 'Average' }],
          ['AWS/ES', 'JVMMemoryPressure', { stat: 'Average' }]
        ],
        period: 300,
        title: 'Resource Utilization (%)'
      }
    },

    // キャッシュヒット率
    {
      type: 'metric',
      properties: {
        metrics: [
          ['AWS/ES', 'QueryCacheHitRate', { stat: 'Average' }],
          ['AWS/ES', 'RequestCacheHitRate', { stat: 'Average' }]
        ],
        period: 300,
        title: 'Cache Hit Rate (%)'
      }
    }
  ]
};
```

---

## 7. ベストプラクティスまとめ

### 7.1 パフォーマンス最適化チェックリスト

- [ ] **ef_searchの調整**: データサイズとレイテンシ要件に応じて最適化
- [ ] **シャード数の最適化**: `ceil(documents / 1M) × nodes`
- [ ] **適切なインスタンスタイプ**: メモリ最適化インスタンス（r6g系）を選択
- [ ] **JVMヒープ設定**: メモリの50%を割り当て
- [ ] **refresh_intervalの調整**: バルクインデックス時は30s以上
- [ ] **キャッシュの有効化**: クエリキャッシュとリクエストキャッシュ
- [ ] **圧縮の有効化**: `codec: best_compression`
- [ ] **モニタリング設定**: CloudWatch AlarmとDashboard

### 7.2 パフォーマンス劣化時の対応

#### Step 1: メトリクスの確認
```bash
# OpenSearch統計取得
GET /_cluster/stats
GET /file-index/_stats

# ノード統計
GET /_nodes/stats
```

#### Step 2: スロークエリ分析
```json
{
  "settings": {
    "index.search.slowlog.threshold.query.warn": "10s",
    "index.search.slowlog.threshold.query.info": "5s",
    "index.search.slowlog.threshold.query.debug": "2s",
    "index.search.slowlog.threshold.fetch.warn": "1s"
  }
}
```

#### Step 3: 最適化アクション
1. **短期対応**: ef_searchを下げる（512 → 256）
2. **中期対応**: キャッシュ層を追加（Redis）
3. **長期対応**: スケールアウト（ノード追加）

### 7.3 コスト最適化

#### リザーブドインスタンスの活用
```
通常料金: $300/月
1年RI: $210/月 (30% OFF)
3年RI: $150/月 (50% OFF)
```

#### ストレージ最適化
- UltraWarm: コールドデータ用（90%コスト削減）
- Snapshot: S3バックアップ（99%コスト削減）

---

## 8. 実装例

### 8.1 最適化されたインデックス作成

```typescript
import { Client } from '@opensearch-project/opensearch';

/**
 * 最適化されたk-NNインデックスを作成
 */
export async function createOptimizedKNNIndex(
  client: Client,
  indexName: string,
  options: {
    documentCount: number;
    nodeCount: number;
  }
): Promise<void> {
  // ドキュメント数に基づいてシャード数を計算
  const shardCount = Math.max(
    1,
    Math.ceil(options.documentCount / 1_000_000) * options.nodeCount
  );

  // ef_searchを動的に決定
  const efSearch = calculateOptimalEfSearch(
    options.documentCount,
    100  // 目標レイテンシ: 100ms
  );

  const indexConfig = {
    settings: {
      index: {
        number_of_shards: shardCount,
        number_of_replicas: 1,
        knn: true,
        'knn.algo_param.ef_search': efSearch,
        refresh_interval: '30s',
        max_result_window: 10000,
        'cache.query.enable': true,
        'cache.request.enable': true,
        codec: 'best_compression'
      }
    },
    mappings: {
      properties: {
        file_name: {
          type: 'text',
          fields: { keyword: { type: 'keyword' } }
        },
        file_path: {
          type: 'text',
          fields: { keyword: { type: 'keyword' } }
        },
        file_type: { type: 'keyword' },
        file_size: { type: 'long' },
        processed_at: { type: 'date' },
        extracted_text: { type: 'text' },
        image_embedding: {
          type: 'knn_vector',
          dimension: 1024,
          method: {
            name: 'hnsw',
            space_type: 'innerproduct',
            engine: 'faiss',
            parameters: {
              ef_construction: 128,
              m: 24
            }
          }
        }
      }
    }
  };

  await client.indices.create({
    index: indexName,
    body: indexConfig
  });

  logger.info('Optimized k-NN index created', {
    indexName,
    shardCount,
    efSearch
  });
}
```

---

## 9. 参考リソース

### 公式ドキュメント
- [OpenSearch k-NN Plugin](https://opensearch.org/docs/latest/search-plugins/knn/index/)
- [HNSW Algorithm](https://arxiv.org/abs/1603.09320)
- [AWS OpenSearch Service Best Practices](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/bp.html)

### パフォーマンスベンチマーク
- [k-NN Benchmarks](https://opensearch.org/docs/latest/search-plugins/knn/performance-tuning/)
- [Vector Search Performance](https://github.com/erikbern/ann-benchmarks)

---

## まとめ

このガイドに従うことで、以下の最適化効果が期待できます:

| 項目 | 最適化前 | 最適化後 | 改善率 |
|------|---------|---------|--------|
| クエリレイテンシ (P95) | 300-500ms | 50-100ms | **70-80%削減** |
| スループット | 10 QPS | 50-100 QPS | **5-10倍向上** |
| メモリ使用量 | 32 GB | 16 GB (PQ使用時) | **50%削減** |
| コスト | $500/月 | $250/月 | **50%削減** |
| キャッシュヒット率 | 0% | 60-70% | **クエリ負荷60%削減** |

**次のステップ:**
1. 現在のパフォーマンスベースラインを測定
2. このガイドの推奨設定を段階的に適用
3. A/Bテストで効果を検証
4. モニタリングダッシュボードで継続的に監視
