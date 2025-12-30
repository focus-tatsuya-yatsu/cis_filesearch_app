/**
 * OpenSearch k-NN Performance Optimized Service
 * Implements advanced optimization techniques for vector search
 *
 * Features:
 * - Dynamic ef_search calculation based on index size
 * - Multi-layer caching (In-Memory LRU)
 * - Batch query processing
 * - Performance monitoring and metrics
 * - Query optimization patterns
 * - Adaptive parameter tuning
 *
 * Performance Targets:
 * - Query latency P95: < 100ms
 * - Cache hit rate: > 60%
 * - Throughput: > 50 QPS
 * 
 * 修正: fileType複数選択対応（string | string[] | undefined）
 */

import { Client } from '@opensearch-project/opensearch';
import { LRUCache } from 'lru-cache';
import { createHash } from 'crypto';
import { SearchQuery, SearchResponse, SearchResult } from '../types';
import { Logger } from './logger.service';
import { getOpenSearchClient } from './opensearch.service.optimized';

const logger = new Logger('KNNPerformanceService');

/**
 * ファイルタイプから拡張子へのマッピング
 */
const FILE_TYPE_TO_EXTENSIONS: Record<string, string[]> = {
  pdf: ['.pdf'],
  xlsx: ['.xlsx', '.xls'],
  docx: ['.docx', '.doc'],
  pptx: ['.pptx', '.ppt'],
  xdw: ['.xdw', '.xbd'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.webp'],
  cad: ['.dwg', '.dxf', '.sfc', '.bvf'],
  other: [],
};

/**
 * ファイルタイプをOpenSearchクエリ用の拡張子配列に変換
 */
function getExtensionsForFileTypes(fileTypes: string | string[]): string[] {
  const types = Array.isArray(fileTypes) ? fileTypes : [fileTypes];
  const extensions: string[] = [];
  
  for (const type of types) {
    const exts = FILE_TYPE_TO_EXTENSIONS[type.toLowerCase()];
    if (exts) {
      extensions.push(...exts);
    }
  }
  
  return [...new Set(extensions)];
}

/**
 * In-Memory LRUキャッシュ設定
 */
const vectorSearchCache = new LRUCache<string, SearchResponse>({
  max: 500,                      // 最大500エントリ
  maxSize: 100 * 1024 * 1024,    // 100 MB
  sizeCalculation: (value) => {
    return JSON.stringify(value).length;
  },
  ttl: 5 * 60 * 1000,            // 5分
  updateAgeOnGet: true,          // アクセス時にTTL更新
  updateAgeOnHas: false,
  allowStale: false,
});

/**
 * キャッシュ統計
 */
interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  maxSize: number;
}

const cacheStats = {
  hits: 0,
  misses: 0,
  get hitRate(): number {
    const total = this.hits + this.misses;
    return total > 0 ? this.hits / total : 0;
  },
};

/**
 * パフォーマンスメトリクス
 */
interface PerformanceMetrics {
  queryCount: number;
  totalLatency: number;
  avgLatency: number;
  p95Latency: number;
  p99Latency: number;
  cacheHitRate: number;
}

const latencyHistory: number[] = [];
const MAX_LATENCY_HISTORY = 1000;

/**
 * データサイズとレイテンシ要件に基づいてef_searchを動的に計算
 */
export function calculateOptimalEfSearch(
  indexSize: number,
  targetLatencyMs: number = 100
): number {
  let baseEfSearch: number;

  // データサイズベースの基準値
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
  const latencyFactor =
    targetLatencyMs < 50 ? 0.7 : targetLatencyMs < 100 ? 1.0 : 1.3;

  const optimizedEfSearch = Math.round(baseEfSearch * latencyFactor);

  logger.debug('Calculated optimal ef_search', {
    indexSize,
    targetLatencyMs,
    baseEfSearch,
    latencyFactor,
    optimizedEfSearch,
  });

  return optimizedEfSearch;
}

/**
 * ベクトルとフィルターからキャッシュキーを生成
 * 修正: fileType を string | string[] | undefined に対応
 */
function generateCacheKey(
  query: string | undefined,
  imageEmbedding: number[] | undefined,
  filters: {
    fileType?: string | string[];  // 修正: 複数対応
    dateFrom?: string;
    dateTo?: string;
    searchMode?: string;
    sortBy?: string;
    sortOrder?: string;
  }
): string {
  const parts: string[] = [];

  // テキストクエリ
  if (query) {
    parts.push(`q:${query}`);
  }

  // 画像ベクトル（SHA256ハッシュ化）
  if (imageEmbedding && imageEmbedding.length > 0) {
    const vectorHash = createHash('sha256')
      .update(imageEmbedding.join(','))
      .digest('hex')
      .substring(0, 16);
    parts.push(`v:${vectorHash}`);
  }

  // フィルター条件
  if (filters.fileType) {
    // 配列の場合はソートして結合
    const ftValue = Array.isArray(filters.fileType) 
      ? filters.fileType.sort().join(',') 
      : filters.fileType;
    parts.push(`ft:${ftValue}`);
  }
  if (filters.dateFrom) parts.push(`df:${filters.dateFrom}`);
  if (filters.dateTo) parts.push(`dt:${filters.dateTo}`);
  if (filters.searchMode) parts.push(`sm:${filters.searchMode}`);
  if (filters.sortBy) parts.push(`sb:${filters.sortBy}`);
  if (filters.sortOrder) parts.push(`so:${filters.sortOrder}`);

  return parts.join('|');
}

/**
 * インデックスサイズを取得
 */
async function getIndexSize(client: Client, indexName: string): Promise<number> {
  try {
    const stats = await client.indices.stats({
      index: indexName,
      metric: ['docs'],
    });

    return stats.body._all.primaries.docs.count || 0;
  } catch (error: any) {
    logger.warn('Failed to get index size, using default', {
      error: error.message,
    });
    return 1_000_000; // デフォルト値
  }
}

/**
 * ハイブリッド検索クエリビルダー（最適化版）
 */
function buildOptimizedHybridQuery(
  textQuery: string | undefined,
  imageVector: number[] | undefined,
  options: {
    vectorWeight?: number;
    textWeight?: number;
    efSearch?: number;
  } = {}
): any {
  const { vectorWeight = 0.7, textWeight = 0.3, efSearch } = options;

  const shouldClauses: any[] = [];

  // テキスト検索
  if (textQuery && textQuery.trim()) {
    shouldClauses.push({
      multi_match: {
        query: textQuery.trim(),
        fields: ['file_name^3', 'file_path^2', 'extracted_text'],
        type: 'best_fields',
        fuzziness: 'AUTO',
        boost: textWeight,
      },
    });
  }

  // ベクトル検索
  if (imageVector && imageVector.length > 0) {
    const scriptScoreQuery: any = {
      script_score: {
        query: { match_all: {} },
        script: {
          source: 'knn_score',
          lang: 'knn',
          params: {
            field: 'image_embedding',
            query_value: imageVector,
            space_type: 'innerproduct', // 正規化済みベクトルに最適
          },
        },
        boost: vectorWeight,
      },
    };

    // ef_searchパラメータを追加（OpenSearch 2.x+）
    if (efSearch) {
      scriptScoreQuery.script_score.script.params.ef_search = efSearch;
    }

    shouldClauses.push(scriptScoreQuery);
  }

  return {
    bool: {
      should: shouldClauses,
      minimum_should_match: 1,
    },
  };
}

/**
 * ファイルタイプフィルター用のOpenSearchクエリを構築
 */
function buildFileTypeFilter(fileType: string | string[] | undefined): any {
  if (!fileType || fileType === 'all' || (Array.isArray(fileType) && fileType.length === 0)) {
    return null;
  }

  const extensions = getExtensionsForFileTypes(fileType);
  
  if (extensions.length === 0) {
    const allKnownExtensions = Object.values(FILE_TYPE_TO_EXTENSIONS).flat();
    return {
      bool: {
        must_not: {
          terms: { 'file_extension': allKnownExtensions }
        }
      }
    };
  }

  if (extensions.length === 1) {
    return {
      term: { 'file_extension': extensions[0] }
    };
  }

  return {
    terms: { 'file_extension': extensions }
  };
}

/**
 * フィルター条件をビルド
 * 修正: fileType を file_extension に変更、複数選択対応
 */
function buildFilterClauses(searchQuery: SearchQuery): any[] {
  const filterClauses: any[] = [];

  // ファイルタイプフィルター（修正: file_extension使用）
  const fileTypeFilter = buildFileTypeFilter(searchQuery.fileType);
  if (fileTypeFilter) {
    filterClauses.push(fileTypeFilter);
  }

  // 日付範囲フィルター
  if (searchQuery.dateFrom || searchQuery.dateTo) {
    const rangeQuery: any = {};
    if (searchQuery.dateFrom) rangeQuery.gte = searchQuery.dateFrom;
    if (searchQuery.dateTo) rangeQuery.lte = searchQuery.dateTo;

    filterClauses.push({
      range: { indexed_at: rangeQuery },
    });
  }

  return filterClauses;
}

/**
 * ソート設定をビルド
 */
function buildSortConfig(
  sortBy: string = 'relevance',
  sortOrder: string = 'desc'
): any[] {
  const sort: any[] = [];

  if (sortBy === 'relevance') {
    sort.push('_score');
  } else if (sortBy === 'date') {
    sort.push({ indexed_at: { order: sortOrder } });
  } else if (sortBy === 'name') {
    sort.push({ 'file_name.keyword': { order: sortOrder } });
  } else if (sortBy === 'size') {
    sort.push({ file_size: { order: sortOrder } });
  }

  return sort;
}

/**
 * レイテンシを記録
 */
function recordLatency(latency: number): void {
  latencyHistory.push(latency);

  // 履歴サイズを制限
  if (latencyHistory.length > MAX_LATENCY_HISTORY) {
    latencyHistory.shift();
  }
}

/**
 * パーセンタイルを計算
 */
function calculatePercentile(percentile: number): number {
  if (latencyHistory.length === 0) return 0;

  const sorted = [...latencyHistory].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * OpenSearchでドキュメントを検索（パフォーマンス最適化版）
 */
export async function searchDocuments(
  searchQuery: SearchQuery
): Promise<SearchResponse> {
  const client = await getOpenSearchClient();
  const indexName = process.env.OPENSEARCH_INDEX || 'cis-files';

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

  // キャッシュキーを生成
  const cacheKey = generateCacheKey(query, imageEmbedding, {
    fileType,
    dateFrom,
    dateTo,
    searchMode,
    sortBy,
    sortOrder,
  });

  // キャッシュチェック
  const cached = vectorSearchCache.get(cacheKey);
  if (cached) {
    cacheStats.hits++;
    logger.info('Cache hit', {
      cacheKey: cacheKey.substring(0, 50) + '...',
      hitRate: cacheStats.hitRate.toFixed(3),
    });
    return cached;
  }

  cacheStats.misses++;

  logger.info('Executing performance-optimized search', {
    hasTextQuery: !!query,
    hasImageVector: !!imageEmbedding,
    fileType,
    size,
    from,
    cacheHitRate: cacheStats.hitRate.toFixed(3),
  });

  const startTime = Date.now();

  try {
    // インデックスサイズを取得してef_searchを動的に決定
    const indexSize = await getIndexSize(client, indexName);
    const efSearch = calculateOptimalEfSearch(indexSize, 100);

    // クエリビルダー
    const hasTextQuery = query && query.trim();
    const hasImageQuery = imageEmbedding && imageEmbedding.length > 0;

    let mainQuery: any;

    if (hasTextQuery && hasImageQuery) {
      // ハイブリッド検索
      mainQuery = buildOptimizedHybridQuery(query, imageEmbedding, {
        vectorWeight: 0.7,
        textWeight: 0.3,
        efSearch,
      });
    } else if (hasImageQuery) {
      // ベクトル検索のみ
      mainQuery = {
        script_score: {
          query: { match_all: {} },
          script: {
            source: 'knn_score',
            lang: 'knn',
            params: {
              field: 'image_embedding',
              query_value: imageEmbedding,
              space_type: 'innerproduct',
              ef_search: efSearch,
            },
          },
        },
      };
    } else if (hasTextQuery) {
      // テキスト検索のみ
      mainQuery = {
        multi_match: {
          query: query!.trim(),
          fields: ['file_name^3', 'file_path^2', 'extracted_text'],
          type: 'best_fields',
          operator: searchMode,
          fuzziness: searchMode === 'or' ? 'AUTO' : '0',
        },
      };
    } else {
      // クエリなしの場合はすべてマッチ
      mainQuery = { match_all: {} };
    }

    // フィルター条件
    const filterClauses = buildFilterClauses(searchQuery);

    // ソート設定
    const sort = buildSortConfig(sortBy, sortOrder);

    // 検索リクエストボディ
    const searchBody: any = {
      query: {
        bool: {
          must: [mainQuery],
          filter: filterClauses.length > 0 ? filterClauses : undefined,
        },
      },
      highlight: {
        fields: {
          extracted_text: {
            fragment_size: 150,
            number_of_fragments: 2,
            boundary_scanner: 'sentence',
          },
          file_name: {
            number_of_fragments: 0,
          },
          file_path: {
            number_of_fragments: 0,
          },
        },
        pre_tags: ['<mark>'],
        post_tags: ['</mark>'],
      },
      size,
      from,
      sort,
      track_total_hits: true,
      // クエリキャッシュを有効化
      request_cache: true,
      // 不要なフィールドを除外してネットワーク転送量削減
      _source: {
        includes: [
          'file_name',
          'file_path',
          'file_extension',
          'file_size',
          'indexed_at',
          'modified_at',
          'category',
          'root_folder',
          'nas_server',
          'nas_path',
        ],
        excludes: ['image_embedding'], // ベクトルは返さない
      },
    };

    const response = await client.search({
      index: indexName,
      body: searchBody,
    });

    const latency = Date.now() - startTime;
    recordLatency(latency);

    logger.info('Search completed', {
      latency,
      hits: response.body.hits.total,
      efSearch,
      cached: false,
    });

    // 結果を変換
    const results: SearchResult[] = response.body.hits.hits.map((hit: any) => {
      const source = hit._source;
      const highlights = hit.highlight || {};

      let snippet = '';
      if (highlights.extracted_text && highlights.extracted_text.length > 0) {
        snippet = highlights.extracted_text.join(' ... ');
      } else if (source.extracted_text) {
        snippet = source.extracted_text.substring(0, 200) + '...';
      }

      return {
        id: hit._id,
        fileName: source.file_name || '',
        filePath: source.file_path || '',
        fileType: source.file_extension || '',  // 修正: file_extension
        fileSize: source.file_size || 0,
        modifiedDate: source.indexed_at || source.modified_at || '',
        snippet,
        relevanceScore: hit._score || 0,
        highlights: {
          fileName: highlights.file_name,
          filePath: highlights.file_path,
          extractedText: highlights.extracted_text,
        },
        // 追加フィールド
        category: source.category,
        rootFolder: source.root_folder,
        nasServer: source.nas_server,
        nasPath: source.nas_path,
      };
    });

    const totalHits = response.body.hits?.total;
    const totalValue =
      typeof totalHits === 'number' ? totalHits : totalHits?.value || 0;

    const searchResponse: SearchResponse = {
      results,
      total: totalValue,
      took: response.body.took || 0,
    };

    // キャッシュに保存
    vectorSearchCache.set(cacheKey, searchResponse);

    return searchResponse;
  } catch (error: any) {
    const latency = Date.now() - startTime;
    recordLatency(latency);

    logger.error('Search failed', {
      error: error.message,
      statusCode: error.statusCode,
      latency,
    });

    throw error;
  }
}

/**
 * バッチベクトル検索
 */
export async function batchVectorSearch(
  vectors: number[][],
  k: number = 20
): Promise<SearchResponse[]> {
  const client = await getOpenSearchClient();
  const indexName = process.env.OPENSEARCH_INDEX || 'cis-files';

  logger.info('Executing batch vector search', {
    batchSize: vectors.length,
    k,
  });

  const indexSize = await getIndexSize(client, indexName);
  const efSearch = calculateOptimalEfSearch(indexSize, 100);

  const body: any[] = [];

  vectors.forEach((vector) => {
    body.push({ index: indexName });
    body.push({
      size: k,
      query: {
        script_score: {
          query: { match_all: {} },
          script: {
            source: 'knn_score',
            lang: 'knn',
            params: {
              field: 'image_embedding',
              query_value: vector,
              space_type: 'innerproduct',
              ef_search: efSearch,
            },
          },
        },
      },
      _source: {
        includes: ['file_name', 'file_path', 'file_extension', 'file_size', 'indexed_at'],
        excludes: ['image_embedding'],
      },
    });
  });

  const response = await client.msearch({ body });

  return response.body.responses.map((r: any) => {
    const results: SearchResult[] = r.hits.hits.map((hit: any) => ({
      id: hit._id,
      fileName: hit._source.file_name || '',
      filePath: hit._source.file_path || '',
      fileType: hit._source.file_extension || '',  // 修正: file_extension
      fileSize: hit._source.file_size || 0,
      modifiedDate: hit._source.indexed_at || '',
      snippet: '',
      relevanceScore: hit._score || 0,
    }));

    const totalHits = r.hits?.total;
    const totalValue =
      typeof totalHits === 'number' ? totalHits : totalHits?.value || 0;

    return {
      results,
      total: totalValue,
      took: r.took || 0,
    };
  });
}

/**
 * キャッシュ統計を取得
 */
export function getCacheStats(): CacheStats {
  return {
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    hitRate: cacheStats.hitRate,
    size: vectorSearchCache.size,
    maxSize: vectorSearchCache.max,
  };
}

/**
 * パフォーマンスメトリクスを取得
 */
export function getPerformanceMetrics(): PerformanceMetrics {
  const total = latencyHistory.length;
  const totalLatency = latencyHistory.reduce((sum, val) => sum + val, 0);

  return {
    queryCount: total,
    totalLatency,
    avgLatency: total > 0 ? totalLatency / total : 0,
    p95Latency: calculatePercentile(95),
    p99Latency: calculatePercentile(99),
    cacheHitRate: cacheStats.hitRate,
  };
}

/**
 * キャッシュをクリア
 */
export function clearCache(): void {
  vectorSearchCache.clear();
  cacheStats.hits = 0;
  cacheStats.misses = 0;
  logger.info('Cache cleared');
}

/**
 * メトリクスをリセット
 */
export function resetMetrics(): void {
  latencyHistory.length = 0;
  cacheStats.hits = 0;
  cacheStats.misses = 0;
  logger.info('Metrics reset');
}
