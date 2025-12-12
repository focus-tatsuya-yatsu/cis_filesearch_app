/**
 * OpenSearch Client for Next.js
 * Handles search operations against AWS OpenSearch Service
 */

import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

export interface SearchQuery {
  query: string;
  fileType?: string;
  dateFrom?: string;
  dateTo?: string;
  size?: number;
  from?: number;
  sortBy?: 'relevance' | 'date' | 'name' | 'size';
  sortOrder?: 'asc' | 'desc';
}

export interface SearchResult {
  id: string;
  fileName: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  modifiedDate: string;
  snippet: string;
  relevanceScore: number;
  highlights?: {
    fileName?: string[];
    filePath?: string[];
    extractedText?: string[];
  };
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  took: number;
}

/**
 * OpenSearch クライアントのシングルトンインスタンス
 */
let opensearchClient: Client | null = null;

/**
 * OpenSearch クライアントを取得（遅延初期化）
 */
export async function getOpenSearchClient(): Promise<Client> {
  if (opensearchClient) {
    return opensearchClient;
  }

  const endpoint = process.env.OPENSEARCH_ENDPOINT;
  if (!endpoint) {
    throw new Error('OPENSEARCH_ENDPOINT environment variable is not set');
  }

  const region = process.env.AWS_REGION || 'ap-northeast-1';

  try {
    opensearchClient = new Client({
      ...AwsSigv4Signer({
        region,
        service: 'es',
        getCredentials: () => {
          const credentialsProvider = defaultProvider();
          return credentialsProvider();
        },
      }),
      node: endpoint,
      requestTimeout: 30000,
      maxRetries: 3,
    });

    // Test connection
    await opensearchClient.ping();

    return opensearchClient;
  } catch (error) {
    console.error('Failed to initialize OpenSearch client:', error);
    throw error;
  }
}

/**
 * ドキュメントを検索
 */
export async function searchDocuments(
  searchQuery: SearchQuery
): Promise<SearchResponse> {
  const client = await getOpenSearchClient();
  const indexName = process.env.OPENSEARCH_INDEX || 'file-index';

  const {
    query,
    fileType,
    dateFrom,
    dateTo,
    size = 20,
    from = 0,
    sortBy = 'relevance',
    sortOrder = 'desc',
  } = searchQuery;

  // クエリを構築
  const mustClauses: any[] = [];
  const filterClauses: any[] = [];

  // テキスト検索クエリ
  if (query && query.trim()) {
    mustClauses.push({
      multi_match: {
        query: query.trim(),
        fields: [
          'file_name^3',    // ファイル名を最重視
          'file_path^2',    // パスを次に重視
          'extracted_text'  // 本文
        ],
        type: 'best_fields',
        operator: 'or',
        fuzziness: 'AUTO',
      },
    });
  }

  // ファイルタイプフィルター
  if (fileType && fileType !== 'all') {
    filterClauses.push({
      term: { file_type: fileType }
    });
  }

  // 日付範囲フィルター
  if (dateFrom || dateTo) {
    const rangeQuery: any = {};
    if (dateFrom) rangeQuery.gte = dateFrom;
    if (dateTo) rangeQuery.lte = dateTo;

    filterClauses.push({
      range: { processed_at: rangeQuery }
    });
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

  // 検索リクエストボディ
  const searchBody: any = {
    query: {
      bool: {
        must: mustClauses.length > 0 ? mustClauses : [{ match_all: {} }],
        filter: filterClauses,
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

  try {
    const response = await client.search({
      index: indexName,
      body: searchBody,
    });

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
      };
    });

    // 型処理: totalは number または { value: number } の可能性がある
    const totalHits = response.body.hits?.total;
    const totalValue = typeof totalHits === 'number'
      ? totalHits
      : (totalHits?.value || 0);

    return {
      results,
      total: totalValue,
      took: response.body.took || 0,
    };
  } catch (error) {
    console.error('OpenSearch query failed:', error);
    throw new Error('Search operation failed');
  }
}

/**
 * インデックスの統計を取得
 */
export async function getIndexStats(): Promise<any> {
  const client = await getOpenSearchClient();
  const indexName = process.env.OPENSEARCH_INDEX || 'file-index';

  try {
    const stats = await client.indices.stats({
      index: indexName,
    });

    return stats.body;
  } catch (error) {
    console.error('Failed to get index stats:', error);
    throw error;
  }
}

/**
 * OpenSearch クライアントを閉じる
 */
export async function closeOpenSearchClient(): Promise<void> {
  if (opensearchClient) {
    await opensearchClient.close();
    opensearchClient = null;
  }
}
