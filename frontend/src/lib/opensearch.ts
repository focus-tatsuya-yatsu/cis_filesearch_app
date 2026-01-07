/**
 * OpenSearch Client for Next.js
 * Handles search operations against AWS OpenSearch Service
 *
 * Features:
 * - Environment-aware client initialization
 * - API Gateway integration for Lambda-based search
 * - Direct OpenSearch connection fallback
 * - Connection health checks
 * - Comprehensive error handling
 */

import { defaultProvider } from '@aws-sdk/credential-provider-node'
import { Client } from '@opensearch-project/opensearch'
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws'

export interface SearchQuery {
  query: string
  searchMode?: 'and' | 'or' // AND検索 or OR検索
  imageEmbedding?: number[] // 画像検索用のベクトル（1024次元）
  fileType?: string
  dateFrom?: string
  dateTo?: string
  size?: number
  from?: number
  sortBy?: 'relevance' | 'date' | 'name' | 'size'
  sortOrder?: 'asc' | 'desc'
}

export interface SearchResult {
  id: string
  fileName: string
  filePath: string
  fileType: string
  fileSize: number
  modifiedDate: string
  snippet: string
  relevanceScore: number
  highlights?: {
    fileName?: string[]
    filePath?: string[]
    extractedText?: string[]
  }
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
  took: number
  error?: string // エラーメッセージ
}

/**
 * OpenSearch クライアントのシングルトンインスタンス
 */
let opensearchClient: Client | null = null
let connectionHealthy: boolean | null = null
let lastHealthCheck: number = 0
const HEALTH_CHECK_INTERVAL = 60000 // 60秒

/**
 * 検索パフォーマンス設定
 */
const SEARCH_TIMEOUT = parseInt(process.env.OPENSEARCH_REQUEST_TIMEOUT || '30000', 10)
const MAX_RETRIES = parseInt(process.env.OPENSEARCH_MAX_RETRIES || '3', 10)
const BATCH_SIZE = parseInt(process.env.OPENSEARCH_BATCH_SIZE || '100', 10)

/**
 * 環境判定: VPCエンドポイントかどうか
 */
function isVpcEndpoint(endpoint: string): boolean {
  return endpoint.includes('vpc-') && endpoint.includes('.es.amazonaws.com')
}

/**
 * OpenSearch接続のヘルスチェック
 */
async function checkOpenSearchHealth(client: Client): Promise<boolean> {
  const now = Date.now()

  // キャッシュされた結果を返す
  if (connectionHealthy !== null && now - lastHealthCheck < HEALTH_CHECK_INTERVAL) {
    return connectionHealthy
  }

  try {
    await client.ping({ requestTimeout: 5000 })
    connectionHealthy = true
    lastHealthCheck = now
    return true
  } catch (error) {
    connectionHealthy = false
    lastHealthCheck = now
    console.warn('OpenSearch health check failed:', error)
    return false
  }
}

/**
 * OpenSearch クライアントを取得（遅延初期化）
 */
export async function getOpenSearchClient(): Promise<Client | null> {
  if (opensearchClient) {
    return opensearchClient
  }

  const endpoint = process.env.OPENSEARCH_ENDPOINT
  if (!endpoint) {
    console.warn('OPENSEARCH_ENDPOINT environment variable is not set')
    return null
  }

  const region = process.env.AWS_REGION || 'ap-northeast-1'

  try {
    opensearchClient = new Client({
      ...AwsSigv4Signer({
        region,
        service: 'es',
        getCredentials: () => {
          const credentialsProvider = defaultProvider({
            timeout: 5000, // 認証タイムアウト
          })
          return credentialsProvider()
        },
      }),
      node: endpoint,
      requestTimeout: SEARCH_TIMEOUT,
      maxRetries: MAX_RETRIES,
      // 接続プール設定（パフォーマンス最適化）
      compression: 'gzip',
      // SSL設定
      ssl: {
        rejectUnauthorized: true,
      },
    })

    // Test connection
    const isHealthy = await checkOpenSearchHealth(opensearchClient)
    if (!isHealthy) {
      console.warn('OpenSearch connection is not healthy')
      opensearchClient = null
      return null
    }

    console.info('OpenSearch client initialized successfully')
    return opensearchClient
  } catch (error) {
    console.error('Failed to initialize OpenSearch client:', error)
    opensearchClient = null
    return null
  }
}

/**
 * API Gateway経由で検索を実行
 */
async function searchViaApiGateway(
  searchQuery: SearchQuery,
  apiGatewayUrl: string
): Promise<SearchResponse> {
  const {
    query = '',
    searchMode = 'or',
    fileType,
    dateFrom,
    dateTo,
    size = 20,
    from = 0,
    sortBy = 'relevance',
    sortOrder = 'desc',
  } = searchQuery

  // ページ番号を計算
  const page = Math.floor(from / size) + 1

  // クエリパラメータを構築
  const params = new URLSearchParams()
  if (query) params.append('q', query)
  params.append('searchMode', searchMode)
  if (fileType) params.append('fileType', fileType)
  if (dateFrom) params.append('dateFrom', dateFrom)
  if (dateTo) params.append('dateTo', dateTo)
  params.append('page', page.toString())
  params.append('limit', size.toString())
  params.append('sortBy', sortBy)
  params.append('sortOrder', sortOrder)

  const url = `${apiGatewayUrl}?${params.toString()}`

  console.info(`[API Gateway] Searching via Lambda: ${url}`)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      // Cognitoトークンがあれば追加
      ...(typeof window !== 'undefined' &&
        window.localStorage?.getItem('cognitoToken') && {
          Authorization: `Bearer ${window.localStorage.getItem('cognitoToken')}`,
        }),
    },
  })

  if (!response.ok) {
    throw new Error(`API Gateway error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()

  // Lambda response structure: { success: true, data: { results, total, page, limit, ... } }
  // Extract the data object from Lambda's response
  const lambdaData = data.data || data

  // API Gatewayレスポンスをアプリケーション形式に変換
  return {
    results: lambdaData.results || [],
    total: lambdaData.total || 0,
    took: lambdaData.took || 0,
  }
}

/**
 * ドキュメントを検索
 * API Gateway経由でLambda関数を呼び出す
 */
export async function searchDocuments(searchQuery: SearchQuery): Promise<SearchResponse> {
  // API Gateway URLを取得
  const apiGatewayUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL

  // API Gatewayが設定されている場合は、Lambda経由で検索
  if (apiGatewayUrl) {
    return searchViaApiGateway(searchQuery, apiGatewayUrl)
  }

  // API Gatewayが設定されていない場合は、従来のOpenSearch直接接続を試みる
  const client = await getOpenSearchClient()

  // OpenSearchクライアントが利用できない場合はエラーを返す
  if (!client) {
    throw new Error('OpenSearch client is not available. Please check your configuration.')
  }
  const indexName = process.env.OPENSEARCH_INDEX || 'file-index'

  const {
    query,
    searchMode = 'or', // デフォルトはOR検索
    imageEmbedding,
    fileType,
    dateFrom,
    dateTo,
    size = 20,
    from = 0,
    sortBy = 'relevance',
    sortOrder = 'desc',
  } = searchQuery

  // ハイブリッド検索の判定
  const hasTextQuery = query && query.trim()
  const hasImageQuery = imageEmbedding && imageEmbedding.length > 0

  // クエリを構築
  const mustClauses: any[] = []
  const shouldClauses: any[] = []
  const filterClauses: any[] = []

  // テキスト検索クエリ
  if (hasTextQuery) {
    const textQuery = {
      multi_match: {
        query: query.trim(),
        fields: [
          'file_name^3', // ファイル名を最重視
          'file_path^2', // パスを次に重視
          'extracted_text', // 本文
        ],
        type: 'best_fields',
        operator: searchMode, // 'and' または 'or'
        fuzziness: searchMode === 'or' ? 'AUTO' : '0', // AND検索では曖昧検索無効
      },
    }

    // ハイブリッド検索の場合はshouldに、そうでない場合はmustに
    if (hasImageQuery) {
      shouldClauses.push(textQuery)
    } else {
      mustClauses.push(textQuery)
    }
  }

  // 画像ベクトル検索（k-NN）
  // OpenSearchのk-NNクエリは script_score を使用
  // 注意: AWS Bedrock Titan Embeddingsは正規化済みベクトルを生成するため、
  // innerproductを使用（cosinesimilと等価だが計算効率が高い）
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
            space_type: 'innerproduct', // 正規化済みベクトルに最適
          },
        },
      },
    })
  }

  // ファイルタイプフィルター
  if (fileType && fileType !== 'all') {
    filterClauses.push({
      term: { file_type: fileType },
    })
  }

  // 日付範囲フィルター
  if (dateFrom || dateTo) {
    const rangeQuery: any = {}
    if (dateFrom) rangeQuery.gte = dateFrom
    if (dateTo) rangeQuery.lte = dateTo

    filterClauses.push({
      range: { processed_at: rangeQuery },
    })
  }

  // ソート設定
  const sort: any[] = []
  if (sortBy === 'relevance') {
    sort.push('_score')
  } else if (sortBy === 'date') {
    sort.push({ processed_at: { order: sortOrder } })
  } else if (sortBy === 'name') {
    sort.push({ 'file_name.keyword': { order: sortOrder } })
  } else if (sortBy === 'size') {
    sort.push({ file_size: { order: sortOrder } })
  }

  // 検索リクエストボディ
  const searchBody: any = {
    query: {
      bool: {
        must: mustClauses.length > 0 ? mustClauses : undefined,
        should: shouldClauses.length > 0 ? shouldClauses : undefined,
        filter: filterClauses.length > 0 ? filterClauses : undefined,
        // ハイブリッド検索の場合、shouldのうち少なくとも1つはマッチする必要がある
        minimum_should_match: shouldClauses.length > 0 && mustClauses.length === 0 ? 1 : undefined,
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
  }

  const response = await client.search({
    index: indexName,
    body: searchBody,
  })

  // 結果を変換
  const results: SearchResult[] = response.body.hits.hits.map((hit: any) => {
    const source = hit._source
    const highlights = hit.highlight || {}

    // ハイライトまたはスニペットを生成
    let snippet = ''
    if (highlights.extracted_text && highlights.extracted_text.length > 0) {
      snippet = highlights.extracted_text.join(' ... ')
    } else if (source.extracted_text) {
      snippet = source.extracted_text.substring(0, 200) + '...'
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
    }
  })

  // 型処理: totalは number または { value: number } の可能性がある
  const totalHits = response.body.hits?.total
  const totalValue = typeof totalHits === 'number' ? totalHits : totalHits?.value || 0

  return {
    results,
    total: totalValue,
    took: response.body.took || 0,
  }
}

/**
 * インデックスの統計を取得
 */
export async function getIndexStats(): Promise<any> {
  const client = await getOpenSearchClient()

  // OpenSearchクライアントが利用できない場合はエラーを投げる
  if (!client) {
    throw new Error('OpenSearch client is not available. Please check your configuration.')
  }

  const indexName = process.env.OPENSEARCH_INDEX || 'file-index'

  const stats = await client.indices.stats({
    index: indexName,
  })

  return stats.body
}

/**
 * ドキュメントの画像埋め込みベクトルを更新
 *
 * @param documentId - 更新対象のドキュメントID（S3キーやファイルパスなど）
 * @param imageEmbedding - 1024次元の画像ベクトル
 * @returns 更新結果
 */
export async function updateDocumentImageEmbedding(
  documentId: string,
  imageEmbedding: number[]
): Promise<{ success: boolean; error?: string }> {
  try {
    // API Gateway経由でLambda関数を呼び出す
    const apiGatewayUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL

    if (!apiGatewayUrl) {
      throw new Error('API Gateway URL is not configured')
    }

    // Lambda関数に更新リクエストを送信
    const response = await fetch(apiGatewayUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'update_embedding',
        documentId,
        imageEmbedding,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error?.message || `API Gateway error: ${response.status}`)
    }

    const result = await response.json()
    return { success: true }
  } catch (error: any) {
    console.error('Failed to update document image embedding:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 複数ドキュメントの画像埋め込みベクトルをバッチ更新
 *
 * @param updates - ドキュメントIDとベクトルのペアの配列
 * @returns 更新結果の配列
 */
export async function batchUpdateImageEmbeddings(
  updates: Array<{ documentId: string; imageEmbedding: number[] }>
): Promise<Array<{ documentId: string; success: boolean; error?: string }>> {
  try {
    const apiGatewayUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL

    if (!apiGatewayUrl) {
      throw new Error('API Gateway URL is not configured')
    }

    const response = await fetch(apiGatewayUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'batch_update_embeddings',
        updates,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error?.message || `API Gateway error: ${response.status}`)
    }

    const result = await response.json()
    return result.results || []
  } catch (error: any) {
    console.error('Failed to batch update image embeddings:', error)
    return updates.map((update) => ({
      documentId: update.documentId,
      success: false,
      error: error.message,
    }))
  }
}

/**
 * OpenSearch クライアントを閉じる
 */
export async function closeOpenSearchClient(): Promise<void> {
  if (opensearchClient) {
    await opensearchClient.close()
    opensearchClient = null
  }
}
