/**
 * OpenSearch Service
 * AWS OpenSearchとの接続・検索処理
 */

import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import https from 'https';
import { SearchQuery, SearchResponse, SearchResult, OpenSearchConfig } from '../types';
import { Logger } from './logger.service';
import {
  OpenSearchError,
  OpenSearchIndexNotFoundError,
  OpenSearchUnavailableError,
} from '../utils/error-handler';

const logger = new Logger('OpenSearchService');

/**
 * OpenSearchクライアントのシングルトンインスタンス
 * Lambda実行コンテキスト間で再利用される
 */
let opensearchClient: Client | null = null;

/**
 * 環境変数からOpenSearch設定を取得
 */
function getOpenSearchConfig(): OpenSearchConfig {
  const endpoint = process.env.OPENSEARCH_ENDPOINT;
  if (!endpoint) {
    throw new Error('OPENSEARCH_ENDPOINT environment variable is not set');
  }

  return {
    endpoint,
    index: process.env.OPENSEARCH_INDEX || 'file-index',
    region: process.env.AWS_REGION || 'ap-northeast-1',
  };
}

/**
 * OpenSearchクライアントを取得（遅延初期化）
 */
export async function getOpenSearchClient(): Promise<Client> {
  if (opensearchClient) {
    logger.debug('Reusing existing OpenSearch client');
    return opensearchClient;
  }

  const config = getOpenSearchConfig();
  logger.info('Initializing OpenSearch client', {
    endpoint: config.endpoint,
    region: config.region,
  });

  try {
    // IPアドレス使用時の特別な設定
    const useIp = process.env.OPENSEARCH_USE_IP === 'true';
    let clientConfig: any;

    if (useIp) {
      logger.info('Using IP-based connection with custom SSL settings');

      // HTTPSエージェントの設定（SSL証明書検証を緩和）
      const agent = new https.Agent({
        rejectUnauthorized: false, // 開発環境用: SSL証明書の検証を無効化
      });

      clientConfig = {
        ...AwsSigv4Signer({
          region: config.region,
          service: 'es',
          getCredentials: () => {
            const credentialsProvider = defaultProvider();
            return credentialsProvider();
          },
        }),
        node: config.endpoint,
        ssl: {
          rejectUnauthorized: false, // SSL証明書検証を無効化
        },
        agent,
        requestTimeout: 30000,
        maxRetries: 3,
        compression: 'gzip',
        headers: {
          'Host': 'vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com',
        },
      };
    } else {
      // 通常のドメイン名ベースの接続
      clientConfig = {
        ...AwsSigv4Signer({
          region: config.region,
          service: 'es',
          getCredentials: () => {
            const credentialsProvider = defaultProvider();
            return credentialsProvider();
          },
        }),
        node: config.endpoint,
        requestTimeout: 30000,
        maxRetries: 3,
        compression: 'gzip',
      };
    }

    opensearchClient = new Client(clientConfig);

    // 接続テスト
    await opensearchClient.ping();
    logger.info('OpenSearch client initialized successfully');

    return opensearchClient;
  } catch (error: any) {
    logger.error('Failed to initialize OpenSearch client', {
      error: error.message,
    });
    throw new OpenSearchUnavailableError('Failed to connect to OpenSearch');
  }
}

/**
 * OpenSearchでドキュメントを検索
 */
export async function searchDocuments(
  searchQuery: SearchQuery
): Promise<SearchResponse> {
  const client = await getOpenSearchClient();
  const config = getOpenSearchConfig();

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

  logger.info('Executing search query', {
    query,
    searchMode,
    fileType,
    size,
    from,
    sortBy,
  });

  // クエリビルダー
  const mustClauses: any[] = [];
  const shouldClauses: any[] = [];
  const filterClauses: any[] = [];

  // テキスト検索クエリ
  const hasTextQuery = query && query.trim();
  const hasImageQuery = imageEmbedding && imageEmbedding.length > 0;

  if (hasTextQuery) {
    const textQuery = {
      multi_match: {
        query: query!.trim(),
        fields: [
          'file_name^3',    // ファイル名を最重視
          'file_path^2',    // パスを次に重視
          'extracted_text', // 本文
        ],
        type: 'best_fields',
        operator: searchMode, // 'and' または 'or'
        fuzziness: searchMode === 'or' ? 'AUTO' : '0', // AND検索では曖昧検索無効
      },
    };

    // ハイブリッド検索の場合はshouldに、そうでない場合はmustに
    if (hasImageQuery) {
      shouldClauses.push(textQuery);
    } else {
      mustClauses.push(textQuery);
    }
  }

  // 画像ベクトル検索（k-NN）
  if (hasImageQuery) {
    shouldClauses.push({
      script_score: {
        query: { match_all: {} },
        script: {
          source: 'knn_score',
          lang: 'knn',
          params: {
            field: 'image_embedding',
            query_value: imageEmbedding,
            space_type: 'cosinesimil', // コサイン類似度
          },
        },
      },
    });
  }

  // ファイルタイプフィルター
  if (fileType && fileType !== 'all') {
    filterClauses.push({
      term: { file_type: fileType },
    });
  }

  // 日付範囲フィルター
  if (dateFrom || dateTo) {
    const rangeQuery: any = {};
    if (dateFrom) rangeQuery.gte = dateFrom;
    if (dateTo) rangeQuery.lte = dateTo;

    filterClauses.push({
      range: { processed_at: rangeQuery },
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
        must: mustClauses.length > 0 ? mustClauses : undefined,
        should: shouldClauses.length > 0 ? shouldClauses : undefined,
        filter: filterClauses.length > 0 ? filterClauses : undefined,
        minimum_should_match:
          shouldClauses.length > 0 && mustClauses.length === 0 ? 1 : undefined,
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
    const startTime = Date.now();

    const response = await client.search({
      index: config.index,
      body: searchBody,
    });

    const took = Date.now() - startTime;

    logger.info('Search query completed', {
      took,
      hits: response.body.hits.total,
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
    const totalValue =
      typeof totalHits === 'number' ? totalHits : totalHits?.value || 0;

    return {
      results,
      total: totalValue,
      took: response.body.took || 0,
    };
  } catch (error: any) {
    logger.error('OpenSearch query failed', {
      error: error.message,
      statusCode: error.statusCode,
    });

    if (error.statusCode === 404) {
      throw new OpenSearchIndexNotFoundError(
        `Index '${config.index}' not found`
      );
    } else if (error.statusCode === 503 || error.code === 'ECONNREFUSED') {
      throw new OpenSearchUnavailableError(
        'OpenSearch service is temporarily unavailable'
      );
    } else {
      throw new OpenSearchError(
        `Search operation failed: ${error.message}`,
        500
      );
    }
  }
}

/**
 * OpenSearchクライアントを閉じる
 * 通常はLambda実行コンテキストが終了時に自動クローズされるため、
 * 明示的に呼び出す必要はない
 */
export async function closeOpenSearchClient(): Promise<void> {
  if (opensearchClient) {
    logger.info('Closing OpenSearch client');
    await opensearchClient.close();
    opensearchClient = null;
  }
}
