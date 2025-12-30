/**
 * OpenSearch Hybrid Search Service
 *
 * デュアルインデックス検索戦略:
 * - cis-files: テキスト検索用メインインデックス（10,000+ docs）
 * - file-index-v2-knn: 画像ベクトル検索用インデックス（20+ docs）
 *
 * クエリタイプに応じて最適なインデックスを選択し、
 * 必要に応じて結果をマージして統一されたレスポンスを返す
 *
 * @module services/opensearch.hybrid.service
 */

import { Client } from '@opensearch-project/opensearch';
import { SearchQuery, SearchResponse, SearchResult } from '../types';
import { getOpenSearchClient } from './opensearch.service';
import { Logger } from './logger.service';
import {
  OpenSearchError,
  OpenSearchIndexNotFoundError,
  OpenSearchUnavailableError,
} from '../utils/error-handler';

const logger = new Logger('HybridSearchService');

/**
 * インデックス名定数
 */
const INDICES = {
  TEXT: 'cis-files',           // テキスト検索用メインインデックス
  IMAGE: 'file-index-v2-knn',  // 画像ベクトル検索用インデックス
} as const;

/**
 * クエリタイプの判定
 */
function analyzeQueryType(query: SearchQuery): 'text' | 'image' | 'hybrid' {
  const hasTextQuery = query.query && query.query.trim().length > 0;
  const hasImageQuery = query.imageEmbedding && query.imageEmbedding.length > 0;

  if (hasTextQuery && hasImageQuery) return 'hybrid';
  if (hasImageQuery) return 'image';
  return 'text';
}

/**
 * テキストインデックス検索 (cis-files)
 *
 * 10,000+件のファイルメタデータから日本語全文検索を実行
 */
async function searchTextIndex(
  client: Client,
  query: SearchQuery
): Promise<{ results: SearchResult[]; total: number; took: number }> {
  const {
    query: textQuery,
    searchMode = 'or',
    fileType,
    dateFrom,
    dateTo,
    size = 20,
    from = 0,
    sortBy = 'relevance',
    sortOrder = 'desc',
  } = query;

  const mustClauses: any[] = [];
  const filterClauses: any[] = [];

  // テキスト検索クエリ
  if (textQuery && textQuery.trim()) {
    mustClauses.push({
      multi_match: {
        query: textQuery.trim(),
        fields: [
          'file_name^3',        // ファイル名を最重視
          'file_path^2',        // パスを次に重視
          'extracted_text',     // 本文
        ],
        type: 'best_fields',
        operator: searchMode,   // 'and' または 'or'
        fuzziness: searchMode === 'or' ? 'AUTO' : '0', // AND検索では曖昧検索無効
      },
    });
  }

  // ファイルタイプフィルター
  if (fileType && fileType !== 'all') {
    filterClauses.push({ term: { file_type: fileType } });
  }

  // 日付範囲フィルター
  if (dateFrom || dateTo) {
    const rangeQuery: any = {};
    if (dateFrom) rangeQuery.gte = dateFrom;
    if (dateTo) rangeQuery.lte = dateTo;
    filterClauses.push({ range: { processed_at: rangeQuery } });
  }

  // ソート設定
  const sort: any[] = [];
  if (sortBy === 'relevance') {
    sort.push('_score');
  } else if (sortBy === 'date') {
    sort.push({ processed_at: { order: sortOrder } });
  } else if (sortBy === 'name') {
    sort.push({ 'file_name.keyword': { order: sortOrder } });
  } else if (sortBy === 'size') {
    sort.push({ file_size: { order: sortOrder } });
  }

  const searchBody = {
    query: {
      bool: {
        must: mustClauses.length > 0 ? mustClauses : [{ match_all: {} }],
        filter: filterClauses.length > 0 ? filterClauses : undefined,
      },
    },
    highlight: {
      fields: {
        extracted_text: {
          fragment_size: 150,
          number_of_fragments: 3,
        },
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
  };

  logger.debug('Text index search query', {
    index: INDICES.TEXT,
    query: textQuery,
    searchMode,
  });

  const startTime = Date.now();
  const response = await client.search({
    index: INDICES.TEXT,
    body: searchBody,
  });
  const took = Date.now() - startTime;

  // 結果を変換
  const results: SearchResult[] = response.body.hits.hits.map((hit: any) => {
    const source = hit._source;
    const highlights = hit.highlight || {};

    // ハイライトまたはスニペットを生成
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
      fileType: source.file_type || '',
      fileSize: source.file_size || 0,
      modifiedDate: source.processed_at || '',
      snippet,
      relevanceScore: hit._score,
      highlights: {
        fileName: highlights.file_name,
        filePath: highlights.file_path,
        extractedText: highlights.extracted_text,
      },
      source: 'text-index' as const,
    };
  });

  const totalValue =
    typeof response.body.hits.total === 'number'
      ? response.body.hits.total
      : response.body.hits.total?.value || 0;

  logger.info('Text index search completed', {
    hits: totalValue,
    returned: results.length,
    took,
  });

  return { results, total: totalValue, took };
}

/**
 * 画像インデックス検索 (file-index-v2-knn)
 *
 * k-NNベクトル検索で類似画像を検索
 */
async function searchImageIndex(
  client: Client,
  query: SearchQuery
): Promise<{ results: SearchResult[]; total: number; took: number }> {
  const {
    imageEmbedding,
    fileType,
    dateFrom,
    dateTo,
    size = 20,
    from = 0,
  } = query;

  if (!imageEmbedding || imageEmbedding.length === 0) {
    logger.warn('Image search requested but no embedding provided');
    return { results: [], total: 0, took: 0 };
  }

  // ベクトル次元チェック
  if (imageEmbedding.length !== 1024) {
    throw new OpenSearchError(
      `Invalid image embedding dimension: expected 1024, got ${imageEmbedding.length}`,
      400
    );
  }

  const filterClauses: any[] = [];

  // ファイルタイプフィルター
  if (fileType && fileType !== 'all') {
    filterClauses.push({ term: { file_type: fileType } });
  }

  // 日付範囲フィルター
  if (dateFrom || dateTo) {
    const rangeQuery: any = {};
    if (dateFrom) rangeQuery.gte = dateFrom;
    if (dateTo) rangeQuery.lte = dateTo;
    filterClauses.push({ range: { processed_at: rangeQuery } });
  }

  // k-NN検索クエリ
  const searchBody = {
    query: {
      bool: {
        must: [
          {
            knn: {
              image_embedding: {
                vector: imageEmbedding,
                k: size + from, // ページネーション考慮
              },
            },
          },
        ],
        filter: filterClauses.length > 0 ? filterClauses : undefined,
      },
    },
    size: size + from,
    track_total_hits: true,
  };

  logger.debug('Image index search query', {
    index: INDICES.IMAGE,
    vectorDimension: imageEmbedding.length,
    k: size + from,
  });

  const startTime = Date.now();
  const response = await client.search({
    index: INDICES.IMAGE,
    body: searchBody,
  });
  const took = Date.now() - startTime;

  // 結果を変換（ページネーション適用）
  const allHits = response.body.hits.hits;
  const paginatedHits = allHits.slice(from, from + size);

  const results: SearchResult[] = paginatedHits.map((hit: any) => {
    const source = hit._source;

    return {
      id: hit._id,
      fileName: source.file_name || '',
      filePath: source.file_path || '',
      fileType: source.file_type || '',
      fileSize: source.file_size || 0,
      modifiedDate: source.processed_at || '',
      snippet: '',
      relevanceScore: hit._score,
      highlights: {},
      source: 'image-index' as const,
      imageEmbedding: source.image_embedding,
    };
  });

  const totalValue =
    typeof response.body.hits.total === 'number'
      ? response.body.hits.total
      : response.body.hits.total?.value || 0;

  logger.info('Image index search completed', {
    hits: totalValue,
    returned: results.length,
    took,
  });

  return { results, total: totalValue, took };
}

/**
 * 結果のマージと正規化
 *
 * ハイブリッド検索時に両インデックスの結果を統合:
 * - 同一ファイルは結合（file_pathで判定）
 * - スコアを正規化して比較可能にする
 * - テキストスコア60% + 画像スコア40%の重み付け
 */
function mergeResults(
  textResults: SearchResult[],
  imageResults: SearchResult[],
  queryType: 'text' | 'image' | 'hybrid'
): SearchResult[] {
  if (queryType === 'text') return textResults;
  if (queryType === 'image') return imageResults;

  logger.debug('Merging search results', {
    textResults: textResults.length,
    imageResults: imageResults.length,
  });

  // ハイブリッド検索: 両方の結果をマージ
  const resultMap = new Map<string, SearchResult>();

  // スコアの正規化係数（各インデックスでスケールが異なるため）
  const maxTextScore = Math.max(...textResults.map((r) => r.relevanceScore || 0), 1);
  const maxImageScore = Math.max(...imageResults.map((r) => r.relevanceScore || 0), 1);

  logger.debug('Score normalization factors', {
    maxTextScore,
    maxImageScore,
  });

  // テキスト検索結果を追加
  for (const result of textResults) {
    const normalizedScore = (result.relevanceScore || 0) / maxTextScore;
    resultMap.set(result.filePath, {
      ...result,
      relevanceScore: normalizedScore,
      textScore: normalizedScore,
    });
  }

  // 画像検索結果を追加/マージ
  for (const result of imageResults) {
    const normalizedScore = (result.relevanceScore || 0) / maxImageScore;
    const existing = resultMap.get(result.filePath);

    if (existing) {
      // 同じファイルが両方のインデックスに存在する場合
      // テキストスコア60% + 画像スコア40%の重み付け
      const textWeight = 0.6;
      const imageWeight = 0.4;
      const combinedScore = (existing.textScore || 0) * textWeight + normalizedScore * imageWeight;

      resultMap.set(result.filePath, {
        ...existing,
        relevanceScore: combinedScore,
        imageScore: normalizedScore,
        imageEmbedding: result.imageEmbedding,
        source: 'hybrid' as const,
      });

      logger.debug('Merged result for same file', {
        filePath: result.filePath,
        textScore: existing.textScore,
        imageScore: normalizedScore,
        combinedScore,
      });
    } else {
      // 画像検索でのみヒットしたファイル
      resultMap.set(result.filePath, {
        ...result,
        relevanceScore: normalizedScore,
        imageScore: normalizedScore,
      });
    }
  }

  // スコアの降順でソート
  const mergedResults = Array.from(resultMap.values()).sort(
    (a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0)
  );

  logger.info('Results merged', {
    uniqueFiles: mergedResults.length,
    hybridFiles: mergedResults.filter((r) => r.source === 'hybrid').length,
  });

  return mergedResults;
}

/**
 * ハイブリッド検索のメインエントリーポイント
 *
 * クエリタイプを自動判定し、最適なインデックス検索を実行:
 * - テキストのみ → cis-files
 * - 画像のみ → file-index-v2-knn
 * - 両方 → 並列検索してマージ
 *
 * @param searchQuery - 検索クエリ
 * @returns 統合された検索結果
 */
export async function hybridSearch(searchQuery: SearchQuery): Promise<SearchResponse> {
  const client = await getOpenSearchClient();
  const queryType = analyzeQueryType(searchQuery);

  logger.info('Executing hybrid search', {
    queryType,
    hasTextQuery: !!searchQuery.query,
    hasImageQuery: !!searchQuery.imageEmbedding,
    size: searchQuery.size,
    from: searchQuery.from,
  });

  try {
    let textResults: SearchResult[] = [];
    let imageResults: SearchResult[] = [];
    let totalText = 0;
    let totalImage = 0;
    let tookText = 0;
    let tookImage = 0;

    // 並列クエリ実行（該当するインデックスのみ）
    const promises: Promise<any>[] = [];

    if (queryType === 'text' || queryType === 'hybrid') {
      promises.push(
        searchTextIndex(client, searchQuery).then((response) => {
          textResults = response.results;
          totalText = response.total;
          tookText = response.took;
        })
      );
    }

    if (queryType === 'image' || queryType === 'hybrid') {
      promises.push(
        searchImageIndex(client, searchQuery).then((response) => {
          imageResults = response.results;
          totalImage = response.total;
          tookImage = response.took;
        })
      );
    }

    // 並列実行完了待機
    await Promise.all(promises);

    // 結果のマージ
    const mergedResults = mergeResults(textResults, imageResults, queryType);

    // ページネーション適用（マージ後）
    const { size = 20, from = 0 } = searchQuery;
    const paginatedResults = mergedResults.slice(from, from + size);

    logger.info('Hybrid search completed', {
      queryType,
      textHits: totalText,
      imageHits: totalImage,
      mergedHits: mergedResults.length,
      returnedHits: paginatedResults.length,
      tookText,
      tookImage,
      totalTook: Math.max(tookText, tookImage),
    });

    return {
      results: paginatedResults,
      total: mergedResults.length,
      took: Math.max(tookText, tookImage),
      metadata: {
        queryType,
        textIndexHits: totalText,
        imageIndexHits: totalImage,
        indices: {
          text: queryType === 'text' || queryType === 'hybrid' ? INDICES.TEXT : undefined,
          image: queryType === 'image' || queryType === 'hybrid' ? INDICES.IMAGE : undefined,
        },
      },
    };
  } catch (error: any) {
    logger.error('Hybrid search failed', {
      error: error.message,
      statusCode: error.statusCode,
      queryType,
    });

    if (error.statusCode === 404) {
      throw new OpenSearchIndexNotFoundError(
        `One or more indices not found: ${INDICES.TEXT}, ${INDICES.IMAGE}`
      );
    } else if (error.statusCode === 503 || error.code === 'ECONNREFUSED') {
      throw new OpenSearchUnavailableError('OpenSearch service is temporarily unavailable');
    } else if (error instanceof OpenSearchError) {
      throw error;
    } else {
      throw new OpenSearchError(`Hybrid search operation failed: ${error.message}`, 500);
    }
  }
}

/**
 * インデックスのヘルスチェック
 *
 * 両インデックスの存在と状態を確認
 */
export async function checkIndicesHealth(): Promise<{
  textIndex: { exists: boolean; docCount?: number };
  imageIndex: { exists: boolean; docCount?: number };
}> {
  const client = await getOpenSearchClient();

  const result = {
    textIndex: { exists: false, docCount: undefined as number | undefined },
    imageIndex: { exists: false, docCount: undefined as number | undefined },
  };

  try {
    // cis-files インデックスチェック
    const textIndexExists = await client.indices.exists({ index: INDICES.TEXT });
    result.textIndex.exists = textIndexExists.body;

    if (textIndexExists.body) {
      const textCount = await client.count({ index: INDICES.TEXT });
      result.textIndex.docCount = textCount.body.count;
    }
  } catch (error: any) {
    logger.error('Failed to check text index health', { error: error.message });
  }

  try {
    // file-index-v2-knn インデックスチェック
    const imageIndexExists = await client.indices.exists({ index: INDICES.IMAGE });
    result.imageIndex.exists = imageIndexExists.body;

    if (imageIndexExists.body) {
      const imageCount = await client.count({ index: INDICES.IMAGE });
      result.imageIndex.docCount = imageCount.body.count;
    }
  } catch (error: any) {
    logger.error('Failed to check image index health', { error: error.message });
  }

  logger.info('Indices health check completed', result);

  return result;
}
