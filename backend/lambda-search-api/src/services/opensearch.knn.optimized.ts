/**
 * OpenSearch k-NN Optimized Service
 * 画像ベクトル検索の高速化
 *
 * Optimizations:
 * - HNSW algorithm parameters tuning
 * - Vector quantization (Product Quantization)
 * - Result caching
 * - Query batching
 * - Index warming
 */

import { Client } from '@opensearch-project/opensearch';
import { Logger } from './logger.service';

const logger = new Logger('KNNOptimizedService');

/**
 * k-NN Index Settings (Optimized)
 */
export const OPTIMIZED_KNN_INDEX_SETTINGS = {
  settings: {
    index: {
      // シャード設定
      number_of_shards: 3, // データサイズに応じて調整
      number_of_replicas: 1,

      // k-NN設定
      knn: true,
      'knn.algo_param.ef_search': 512, // 検索時の探索範囲（高いほど精度向上、速度低下）

      // パフォーマンス最適化
      refresh_interval: '30s', // デフォルト1sから変更（バルクインデックス時）
      max_result_window: 10000,

      // キャッシュ設定
      'cache.query.enable': true,
      'cache.request.enable': true,
    },

    // アナライザー設定（テキスト検索用）
    analysis: {
      analyzer: {
        default: {
          type: 'standard',
        },
      },
    },
  },

  mappings: {
    properties: {
      // ファイル情報
      file_name: {
        type: 'text',
        fields: {
          keyword: { type: 'keyword' },
        },
      },
      file_path: {
        type: 'text',
        fields: {
          keyword: { type: 'keyword' },
        },
      },
      file_type: { type: 'keyword' },
      file_size: { type: 'long' },
      processed_at: { type: 'date' },

      // テキスト抽出結果
      extracted_text: { type: 'text' },

      // 画像埋め込みベクトル（1024次元）
      image_embedding: {
        type: 'knn_vector',
        dimension: 1024,
        method: {
          name: 'hnsw', // Hierarchical Navigable Small World
          space_type: 'cosinesimil', // コサイン類似度
          engine: 'nmslib', // または 'faiss'
          parameters: {
            ef_construction: 512, // インデックス構築時の探索範囲
            m: 16, // ノードあたりの双方向リンク数（メモリと精度のトレードオフ）
          },
        },
      },

      // 圧縮ベクトル（Product Quantization）- オプション
      image_embedding_pq: {
        type: 'knn_vector',
        dimension: 1024,
        method: {
          name: 'hnsw',
          space_type: 'cosinesimil',
          engine: 'faiss',
          parameters: {
            ef_construction: 256,
            m: 8,
            encoder: {
              name: 'pq', // Product Quantization
              parameters: {
                code_size: 8, // 圧縮サイズ（元のベクトルの1/8）
                m: 8, // サブベクトル数
              },
            },
          },
        },
      },
    },
  },
};

/**
 * k-NN Search Options
 */
export interface KNNSearchOptions {
  vector: number[];
  k?: number; // 取得件数（デフォルト: 20）
  efSearch?: number; // 検索時の探索範囲（デフォルト: 512）
  minScore?: number; // 最小スコア閾値
  filter?: any; // 追加フィルター条件
  useQuantized?: boolean; // 圧縮ベクトルを使用するか
}

/**
 * k-NN検索クエリビルダー（最適化版）
 */
export function buildOptimizedKNNQuery(options: KNNSearchOptions): any {
  const {
    vector,
    k = 20,
    efSearch = 512,
    // minScore = 0.7, // Commented out as it's not used in the current implementation
    filter,
    useQuantized = false,
  } = options;

  const fieldName = useQuantized ? 'image_embedding_pq' : 'image_embedding';

  const knnQuery: any = {
    size: k,
    query: {
      knn: {
        [fieldName]: {
          vector,
          k: k * 2, // Over-fetch for better results
          ef_search: efSearch,
          // min_score: minScore, // OpenSearch 2.x+
        },
      },
    },
  };

  // フィルター条件を追加
  if (filter) {
    knnQuery.query = {
      bool: {
        must: [knnQuery.query],
        filter: [filter],
      },
    };
  }

  // ハイライト設定
  knnQuery.highlight = {
    fields: {
      file_name: {},
      file_path: {},
    },
  };

  return knnQuery;
}

/**
 * ハイブリッド検索クエリ（テキスト + ベクトル）
 */
export function buildHybridSearchQuery(
  textQuery: string,
  vector: number[],
  options: {
    k?: number;
    textWeight?: number; // テキスト検索の重み
    vectorWeight?: number; // ベクトル検索の重み
    filter?: any;
  } = {}
): any {
  const { k = 20, textWeight = 0.3, vectorWeight = 0.7, filter } = options;

  const query: any = {
    size: k,
    query: {
      bool: {
        should: [
          // テキスト検索
          {
            multi_match: {
              query: textQuery,
              fields: ['file_name^3', 'file_path^2', 'extracted_text'],
              type: 'best_fields',
              fuzziness: 'AUTO',
              boost: textWeight,
            },
          },
          // ベクトル検索
          {
            script_score: {
              query: { match_all: {} },
              script: {
                source: 'knn_score',
                lang: 'knn',
                params: {
                  field: 'image_embedding',
                  query_value: vector,
                  space_type: 'cosinesimil',
                },
              },
              boost: vectorWeight,
            },
          },
        ],
        minimum_should_match: 1,
      },
    },
  };

  // フィルター条件
  if (filter) {
    query.query.bool.filter = [filter];
  }

  return query;
}

/**
 * ベクトル量子化（Product Quantization）
 * ベクトルサイズを削減してメモリ効率向上
 */
export function quantizeVector(
  vector: number[],
  codeSize: number = 8
): number[] {
  // 簡易的なPQ実装（本番環境ではFAISSなどを使用）
  const subVectorLength = Math.ceil(vector.length / codeSize);
  const quantized: number[] = [];

  for (let i = 0; i < codeSize; i++) {
    const start = i * subVectorLength;
    const end = Math.min(start + subVectorLength, vector.length);
    const subVector = vector.slice(start, end);

    // サブベクトルの平均値を使用（簡易版）
    const avg = subVector.reduce((sum, val) => sum + val, 0) / subVector.length;
    quantized.push(avg);
  }

  return quantized;
}

/**
 * インデックスウォーミング
 * 検索パフォーマンス向上のため、インデックスをメモリに事前ロード
 */
export async function warmupKNNIndex(
  client: Client,
  indexName: string
): Promise<void> {
  logger.info('Starting k-NN index warmup', { indexName });

  try {
    // ダミークエリを実行してインデックスをキャッシュ
    const dummyVector = Array(1024).fill(0);

    await client.search({
      index: indexName,
      body: {
        size: 10,
        query: {
          knn: {
            image_embedding: {
              vector: dummyVector,
              k: 10,
            },
          },
        },
      },
    });

    logger.info('k-NN index warmup completed', { indexName });
  } catch (error: any) {
    logger.warn('k-NN index warmup failed', {
      indexName,
      error: error.message,
    });
  }
}

/**
 * インデックス統計取得
 */
export async function getKNNIndexStats(
  client: Client,
  indexName: string
): Promise<any> {
  const stats = await client.indices.stats({
    index: indexName,
    metric: ['docs', 'store', 'search', 'query_cache'],
  });

  return {
    docCount: stats.body._all.primaries.docs.count,
    storeSize: stats.body._all.primaries.store.size_in_bytes,
    searchQueries: stats.body._all.primaries.search.query_total,
    searchTime: stats.body._all.primaries.search.query_time_in_millis,
    cacheSize: stats.body._all.primaries.query_cache.memory_size_in_bytes,
  };
}

/**
 * k-NN設定の最適化アドバイス
 */
export function getKNNOptimizationAdvice(stats: {
  docCount: number;
  avgQueryTime: number;
  memoryUsage: number;
}): string[] {
  const advice: string[] = [];

  // ドキュメント数に基づく推奨
  if (stats.docCount > 1000000) {
    advice.push('Large index detected. Consider using Product Quantization (PQ) to reduce memory usage.');
    advice.push('Increase number of shards for better parallelization.');
  }

  // クエリ時間に基づく推奨
  if (stats.avgQueryTime > 1000) {
    advice.push('Slow queries detected. Consider reducing ef_search parameter.');
    advice.push('Enable result caching for frequently searched vectors.');
  }

  // メモリ使用量に基づく推奨
  if (stats.memoryUsage > 8 * 1024 * 1024 * 1024) {
    // 8GB
    advice.push('High memory usage. Consider using quantized vectors (image_embedding_pq).');
    advice.push('Reduce m parameter in HNSW to decrease memory footprint.');
  }

  if (advice.length === 0) {
    advice.push('k-NN configuration is well optimized.');
  }

  return advice;
}

/**
 * バッチベクトル検索
 * 複数のベクトルを一度に検索して効率化
 */
export async function batchKNNSearch(
  client: Client,
  indexName: string,
  vectors: number[][],
  k: number = 20
): Promise<any[]> {
  logger.info('Executing batch k-NN search', {
    indexName,
    batchSize: vectors.length,
    k,
  });

  // msearch APIを使用してバッチ検索
  const body: any[] = [];

  vectors.forEach((vector) => {
    body.push({ index: indexName });
    body.push({
      size: k,
      query: {
        knn: {
          image_embedding: {
            vector,
            k,
          },
        },
      },
    });
  });

  const response = await client.msearch({
    body,
  });

  return response.body.responses.map((r: any) => r.hits.hits);
}
