/**
 * OpenSearch Service - Enhanced Version
 * 503エラー対策版: 詳細なデバッグ情報と複数の接続方式をサポート
 * 
 * 修正: file_type → file_extension フィールド対応
 * 修正: 複数ファイルタイプ選択対応
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
 * ファイルタイプから拡張子へのマッピング
 * フロントエンドの値 → OpenSearchの file_extension 値
 */
const FILE_TYPE_TO_EXTENSIONS: Record<string, string[]> = {
  pdf: ['.pdf'],
  xlsx: ['.xlsx', '.xls'],
  docx: ['.docx', '.doc'],
  pptx: ['.pptx', '.ppt'],
  xdw: ['.xdw', '.xbd'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.webp'],
  cad: ['.dwg', '.dxf', '.sfc', '.bvf'],
  other: [], // 特別処理が必要
};

/**
 * ファイルタイプをOpenSearchクエリ用の拡張子配列に変換
 * @param fileTypes - 単一または複数のファイルタイプ
 * @returns 拡張子の配列
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
  
  return [...new Set(extensions)]; // 重複を除去
}

/**
 * OpenSearchクライアントのシングルトンインスタンス
 */
let opensearchClient: Client | null = null;

/**
 * 環境変数からOpenSearch設定を取得
 */
function getOpenSearchConfig(): OpenSearchConfig {
  let endpoint = process.env.OPENSEARCH_ENDPOINT;
  if (!endpoint) {
    throw new Error('OPENSEARCH_ENDPOINT environment variable is not set');
  }

  // Ensure endpoint has https:// prefix
  if (!endpoint.startsWith('https://') && !endpoint.startsWith('http://')) {
    endpoint = `https://${endpoint}`;
  }

  return {
    endpoint,
    index: process.env.OPENSEARCH_INDEX || 'cis-files',
    region: process.env.AWS_REGION || 'ap-northeast-1',
  };
}

/**
 * OpenSearchクライアントを取得（遅延初期化）
 * 503エラー対策: 複数の接続方式を試行
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
    nodeEnv: process.env.NODE_ENV,
  });

  // 環境変数からデバッグモードを取得
  const debugMode = process.env.DEBUG_MODE === 'true';
  const skipSSLVerify = process.env.SKIP_SSL_VERIFY !== 'false'; // デフォルトtrue

  try {
    // AWS Sigv4署名の設定
    const signerConfig = {
      region: config.region,
      service: 'es' as const,
      getCredentials: async () => {
        try {
          const credentialsProvider = defaultProvider();
          const credentials = await credentialsProvider();

          if (debugMode) {
            logger.info('AWS Credentials loaded', {
              accessKeyId: credentials.accessKeyId?.substring(0, 8) + '...',
              hasSessionToken: !!credentials.sessionToken,
            });
          }

          return credentials;
        } catch (error: any) {
          logger.error('Failed to load AWS credentials', {
            error: error.message,
            stack: error.stack,
          });
          throw error;
        }
      },
    };

    // HTTPSエージェントの設定
    const httpsAgent = new https.Agent({
      rejectUnauthorized: !skipSSLVerify,
      keepAlive: true,
      maxSockets: 50,
      timeout: 30000,
    });

    // クライアント設定
    const clientConfig: any = {
      ...AwsSigv4Signer(signerConfig),
      node: config.endpoint,
      ssl: {
        rejectUnauthorized: !skipSSLVerify,
      },
      agent: httpsAgent,
      requestTimeout: 30000,
      pingTimeout: 10000,
      maxRetries: 3,
      compression: 'gzip',
    };

    // IPアドレス使用時はHostヘッダーを追加
    if (config.endpoint.match(/\d+\.\d+\.\d+\.\d+/)) {
      const domainName = process.env.OPENSEARCH_DOMAIN_NAME;
      if (domainName) {
        clientConfig.headers = {
          'Host': domainName,
        };
        logger.info('Using IP address with Host header', {
          ip: config.endpoint,
          host: domainName,
        });
      }
    }

    opensearchClient = new Client(clientConfig);

    // 接続テスト
    logger.info('Testing OpenSearch connection...');
    const pingResult = await opensearchClient.ping({}, {
      requestTimeout: 10000,
    });

    logger.info('OpenSearch ping successful', {
      statusCode: pingResult.statusCode,
      body: pingResult.body,
    });

    // クラスター情報を取得（デバッグ用）
    if (debugMode) {
      try {
        const clusterHealth = await opensearchClient.cluster.health();
        logger.info('OpenSearch cluster health', {
          status: clusterHealth.body.status,
          numberOfNodes: clusterHealth.body.number_of_nodes,
        });
      } catch (error: any) {
        logger.warn('Failed to get cluster health', { error: error.message });
      }
    }

    logger.info('OpenSearch client initialized successfully');
    return opensearchClient;

  } catch (error: any) {
    // 詳細なエラーログ
    logger.error('Failed to initialize OpenSearch client', {
      error: error.message,
      errorName: error.name,
      errorCode: error.code,
      statusCode: error.statusCode,
      stack: error.stack,
      meta: error.meta,
      endpoint: config.endpoint,
      region: config.region,
    });

    // エラーの種類に応じて詳細なメッセージを生成
    let errorMessage = 'Failed to connect to OpenSearch';

    if (error.code === 'ENOTFOUND') {
      errorMessage = `DNS resolution failed for ${config.endpoint}. Check OPENSEARCH_ENDPOINT configuration.`;
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = `Connection refused to ${config.endpoint}. Check security groups and network ACLs.`;
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = `Connection timeout to ${config.endpoint}. Check VPC configuration and routing.`;
    } else if (error.statusCode === 403) {
      errorMessage = `Access denied to OpenSearch. Check IAM role permissions and OpenSearch access policies.`;
    } else if (error.statusCode === 503) {
      errorMessage = `OpenSearch service unavailable (503). The cluster may be initializing or under maintenance.`;
    } else if (error.message?.includes('Response Error')) {
      errorMessage = `OpenSearch returned an error response. Check cluster status and access policies. Error: ${error.message}`;
    }

    throw new OpenSearchUnavailableError(errorMessage);
  }
}

/**
 * ファイルタイプフィルター用のOpenSearchクエリを構築
 * @param fileType - 単一または複数のファイルタイプ（undefinedも許容）
 * @returns OpenSearchのクエリ句またはnull
 *
 * 修正: file_type と file_extension の両方のフィールドに対応
 * また、ドット有り(.pdf)とドット無し(pdf)の両方のフォーマットに対応
 */
function buildFileTypeFilter(fileType: string | string[] | undefined): any {
  // 'all' または空の場合はフィルターなし
  if (!fileType || fileType === 'all' || (Array.isArray(fileType) && fileType.length === 0)) {
    return null;
  }

  const extensions = getExtensionsForFileTypes(fileType);

  if (extensions.length === 0) {
    // 'other' タイプの場合: 既知の拡張子以外をマッチ
    const allKnownExtensions = Object.values(FILE_TYPE_TO_EXTENSIONS).flat();
    // ドット無しバージョンも追加
    const allExtensionsWithBothFormats = [
      ...allKnownExtensions,
      ...allKnownExtensions.map(ext => ext.replace(/^\./, ''))
    ];
    return {
      bool: {
        must_not: [
          { terms: { 'file_extension': allExtensionsWithBothFormats } },
          { terms: { 'file_type': allExtensionsWithBothFormats } }
        ]
      }
    };
  }

  // ドット有り(.pdf)とドット無し(pdf)の両方のフォーマットを作成
  const extensionsWithBothFormats = [
    ...extensions,
    ...extensions.map(ext => ext.replace(/^\./, ''))  // ドットを除去したバージョン
  ];
  const uniqueExtensions = [...new Set(extensionsWithBothFormats)];

  // file_type と file_extension の両方のフィールドで検索
  return {
    bool: {
      should: [
        { terms: { 'file_extension': uniqueExtensions } },
        { terms: { 'file_type': uniqueExtensions } }
      ],
      minimum_should_match: 1
    }
  };
}

/**
 * カテゴリフィルター用のOpenSearchクエリを構築
 * @param categories - カテゴリ配列 ['road', 'structure']（undefinedも許容）
 * @returns OpenSearchのクエリ句またはnull
 */
function buildCategoryFilter(categories: string[] | undefined): any {
  if (!categories || categories.length === 0) {
    return null;
  }

  if (categories.length === 1) {
    return {
      term: { 'category': categories[0] }
    };
  }

  return {
    terms: { 'category': categories }
  };
}

/**
 * フォルダフィルター用のOpenSearchクエリを構築
 * @param folders - フォルダ配列 ['H22_JOB', 'R01_JOB']（undefinedも許容）
 * @returns OpenSearchのクエリ句またはnull
 */
function buildFolderFilter(folders: string[] | undefined): any {
  if (!folders || folders.length === 0) {
    return null;
  }

  if (folders.length === 1) {
    return {
      term: { 'root_folder': folders[0] }
    };
  }

  return {
    terms: { 'root_folder': folders }
  };
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
    categories,
    folders,
    dateFrom,
    dateTo,
    dateFilterType = 'modification', // デフォルトは更新日
    size = 20,
    from = 0,
    sortBy = 'relevance',
    sortOrder = 'desc',
  } = searchQuery;

  logger.info('Executing search query', {
    query,
    searchMode,
    fileType,
    categories,
    folders,
    dateFilterType,
    size,
    from,
    sortBy,
  });

  // クエリビルダー
  const hasTextQuery = query && query.trim();
  const hasImageQuery = imageEmbedding && imageEmbedding.length > 0;

  // 画像検索の場合は特別なクエリ構造を使用
  if (hasImageQuery) {
    logger.info('Building k-NN image search query', {
      embeddingDimensions: imageEmbedding!.length,
      hasTextQuery,
      k: Math.max(size * 3, 50), // 十分な候補数を確保
    });

    // フィルター条件を構築
    const filterClauses: any[] = [];

    // ファイルタイプフィルター（修正: file_type → file_extension）
    const fileTypeFilter = buildFileTypeFilter(fileType);
    if (fileTypeFilter) {
      filterClauses.push(fileTypeFilter);
    }

    // カテゴリフィルター
    const categoryFilter = buildCategoryFilter(categories);
    if (categoryFilter) {
      filterClauses.push(categoryFilter);
    }

    // フォルダフィルター
    const folderFilter = buildFolderFilter(folders);
    if (folderFilter) {
      filterClauses.push(folderFilter);
    }

    // 日付範囲フィルター
    if (dateFrom || dateTo) {
      const rangeQuery: any = {};
      if (dateFrom) rangeQuery.gte = dateFrom;
      if (dateTo) rangeQuery.lte = dateTo;

      // dateFilterTypeに基づいてフィールドを選択
      // creation: ファイル作成日 (created_at)
      // modification: ファイル更新日 (modified_at) または indexed_at
      const dateField = dateFilterType === 'creation'
        ? 'created_at'
        : 'modified_at';

      filterClauses.push({
        range: { [dateField]: rangeQuery },
      });
    }

    // k-NN検索クエリ（OpenSearch 2.x標準形式）
    // OpenSearch 2.9以降のefficient filteringを使用
    const searchBody: any = {
      query: {
        knn: {
          image_embedding: {
            vector: imageEmbedding,
            k: Math.max(size * 3, 50), // 十分な候補数を確保
            // フィルター条件がある場合は効率的なフィルタリングを適用
            ...(filterClauses.length > 0 && {
              filter: {
                bool: {
                  filter: filterClauses,
                },
              },
            }),
          },
        },
      },
      size,
      from,
      // k-NN インデックス (file-index-v2-knn) のフィールド構造に合わせる
      _source: [
        'file_name',
        'file_path',
        'file_type',      // k-NN インデックスは file_type を使用
        'file_size',
        'modified_at',
        'department',
        'tags',
      ],
      // スコアによるソート（類似度順）
      sort: [
        {
          _score: {
            order: 'desc',
          },
        },
      ],
      track_total_hits: true,
    };

    return await executeSearch(client, config, searchBody, KNN_INDEX);
  }

  // テキスト検索の場合は従来のboolクエリを使用
  const mustClauses: any[] = [];
  const filterClauses: any[] = [];

  if (hasTextQuery) {
    mustClauses.push({
      multi_match: {
        query: query!.trim(),
        fields: [
          'file_name^3',
          'file_path^2',
          'extracted_text',
        ],
        type: 'best_fields',
        operator: searchMode,
        fuzziness: searchMode === 'or' ? 'AUTO' : '0',
      },
    });
  }

  // ファイルタイプフィルター（修正: file_type → file_extension）
  const fileTypeFilter = buildFileTypeFilter(fileType);
  if (fileTypeFilter) {
    filterClauses.push(fileTypeFilter);
  }

  // カテゴリフィルター
  const categoryFilter = buildCategoryFilter(categories);
  if (categoryFilter) {
    filterClauses.push(categoryFilter);
  }

  // フォルダフィルター
  const folderFilter = buildFolderFilter(folders);
  if (folderFilter) {
    filterClauses.push(folderFilter);
  }

  // 日付範囲フィルター
  if (dateFrom || dateTo) {
    const rangeQuery: any = {};
    if (dateFrom) rangeQuery.gte = dateFrom;
    if (dateTo) rangeQuery.lte = dateTo;

    // dateFilterTypeに基づいてフィールドを選択
    const dateField = dateFilterType === 'creation'
      ? 'created_at'
      : 'modified_at';

    filterClauses.push({
      range: { [dateField]: rangeQuery },
    });
  }

  // ソート設定
  const sort: any[] = [];
  if (sortBy === 'relevance') {
    sort.push('_score');
  } else if (sortBy === 'date') {
    // dateFilterTypeに基づいてソートフィールドを選択
    const sortDateField = dateFilterType === 'creation'
      ? 'created_at'
      : 'modified_at';
    sort.push({ [sortDateField]: { order: sortOrder } });
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

  return await executeSearch(client, config, searchBody);
}

/**
 * k-NN検索用インデックス名
 * 画像ベクトル検索は専用インデックスを使用
 */
const KNN_INDEX = 'file-index-v2-knn';

/**
 * 検索を実行する共通ヘルパー関数
 * @param indexOverride - 指定された場合、config.indexの代わりにこのインデックスを使用
 */
async function executeSearch(
  client: Client,
  config: OpenSearchConfig,
  searchBody: any,
  indexOverride?: string
): Promise<SearchResponse> {

  const startTime = Date.now();

  // k-NN検索の場合は専用インデックスを使用
  const isKnnQuery = !!searchBody.query?.knn;
  const targetIndex = indexOverride || (isKnnQuery ? KNN_INDEX : config.index);

  try {
    // インデックスの存在確認（初回のみ）
    try {
      const indexExists = await client.indices.exists({ index: targetIndex });
      if (!indexExists.body) {
        throw new OpenSearchIndexNotFoundError(`Index '${targetIndex}' does not exist`);
      }
    } catch (error: any) {
      logger.error('Failed to check index existence', {
        error: error.message,
        index: targetIndex,
      });
      throw error;
    }

    logger.debug('Executing search', {
      index: targetIndex,
      queryType: isKnnQuery ? 'knn' : 'bool',
      body: JSON.stringify(searchBody, null, 2).substring(0, 1000),
    });

    const response = await client.search({
      index: targetIndex,
      body: searchBody,
    });

    const took = Date.now() - startTime;

    logger.info('Search query completed', {
      took,
      opensearchTook: response.body.took,
      hits: response.body.hits.total,
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
        // k-NN インデックスは file_type、テキストインデックスは file_extension を使用
        fileType: source.file_type || source.file_extension || '',
        fileSize: source.file_size || 0,
        // 更新日: modified_at が優先、なければ indexed_at
        modifiedDate: source.modified_at || source.indexed_at || '',
        // 作成日: created_at
        createdDate: source.created_at || '',
        snippet,
        relevanceScore: hit._score,
        highlights: {
          fileName: highlights.file_name,
          filePath: highlights.file_path,
          extractedText: highlights.extracted_text,
        },
        // 追加フィールド（テキストインデックス用、k-NNでは空になる場合がある）
        category: source.category,
        categoryDisplay: source.category_display,
        rootFolder: source.root_folder,
        nasServer: source.nas_server,
        nasPath: source.nas_path,
        thumbnailUrl: source.thumbnail_url,
        // k-NN インデックス追加フィールド
        department: source.department,
        tags: source.tags,
      };
    });

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
      errorCode: error.code,
      meta: error.meta,
      searchBody: JSON.stringify(searchBody, null, 2),
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
 */
export async function closeOpenSearchClient(): Promise<void> {
  if (opensearchClient) {
    logger.info('Closing OpenSearch client');
    await opensearchClient.close();
    opensearchClient = null;
  }
}
