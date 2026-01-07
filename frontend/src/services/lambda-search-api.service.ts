/**
 * Lambda Search API Service
 * API Gateway経由でLambda検索APIを呼び出すサービス
 */

// import { Auth } from 'aws-amplify'; // AWS Amplifyの認証を使用する場合はコメントアウトを解除

/**
 * 検索パラメータ
 */
export interface SearchParams {
  query?: string
  searchMode?: 'and' | 'or'
  fileType?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  limit?: number
  sortBy?: 'relevance' | 'date' | 'name' | 'size'
  sortOrder?: 'asc' | 'desc'
}

/**
 * 検索結果
 */
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

/**
 * 検索APIレスポンス
 */
export interface SearchApiResponse {
  success: true
  data: {
    results: SearchResult[]
    total: number
    page: number
    limit: number
    searchType: string
    index: string
    query?: SearchParams
    took?: number
  }
}

/**
 * エラーレスポンス
 */
export interface SearchApiError {
  success: false
  error: {
    code: string
    message: string
    details?: Record<string, any>
  }
}

/**
 * カスタムエラークラス
 */
export class SearchApiException extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, any>
  ) {
    super(message)
    this.name = 'SearchApiException'
  }
}

/**
 * API Gateway URLを取得
 */
function getApiGatewayUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_GATEWAY_URL
  if (!url) {
    throw new Error('NEXT_PUBLIC_API_GATEWAY_URL is not set')
  }
  return url
}

/**
 * Cognito JWTトークンを取得
 * TODO: AWS Amplify Auth実装後に有効化
 */
async function getAuthToken(): Promise<string> {
  // 開発環境用のモックトークン
  // 本番環境では AWS Amplify Auth を使用してください
  if (process.env.NODE_ENV === 'development') {
    // 開発用のダミートークンを返す
    return 'development-jwt-token'
  }

  // AWS Amplify Authを使用する場合は以下のコメントを解除
  /*
  try {
    const session = await Auth.currentSession();
    return session.getIdToken().getJwtToken();
  } catch (error: any) {
    // トークンが期限切れの場合、リフレッシュを試みる
    if (error.message?.includes('expired') || error.message?.includes('invalid')) {
      try {
        await Auth.currentAuthenticatedUser({ bypassCache: true });
        const session = await Auth.currentSession();
        return session.getIdToken().getJwtToken();
      } catch (refreshError) {
        throw new SearchApiException(
          'Authentication failed. Please log in again.',
          'AUTH_FAILED'
        );
      }
    }
    throw error;
  }
  */

  // 仮実装：localStorageから取得（実際の実装では推奨されません）
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  if (!token) {
    throw new SearchApiException('Authentication required. Please log in.', 'AUTH_REQUIRED')
  }
  return token
}

/**
 * ファイル検索API呼び出し
 */
export async function searchFiles(params: SearchParams): Promise<SearchApiResponse> {
  try {
    // JWTトークンを取得
    const token = await getAuthToken()

    // クエリパラメータを構築
    const queryParams = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        queryParams.append(key, String(value))
      }
    })

    const url = `${getApiGatewayUrl()}/search?${queryParams.toString()}`

    // API呼び出し
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      // キャッシュ戦略
      cache: 'no-store', // SSRの場合
    })

    if (!response.ok) {
      const errorData: SearchApiError = await response.json()
      throw new SearchApiException(
        errorData.error.message,
        errorData.error.code,
        errorData.error.details
      )
    }

    const data: SearchApiResponse = await response.json()
    return data
  } catch (error: any) {
    if (error instanceof SearchApiException) {
      throw error
    }

    // ネットワークエラー
    if (error.message?.includes('fetch')) {
      throw new SearchApiException(
        'Network error. Please check your internet connection.',
        'NETWORK_ERROR'
      )
    }

    // その他のエラー
    throw new SearchApiException(error.message || 'An unexpected error occurred', 'UNKNOWN_ERROR')
  }
}

/**
 * 検索サジェスト取得（将来実装予定）
 */
export async function getSearchSuggestions(query: string): Promise<string[]> {
  try {
    const token = await getAuthToken()

    const response = await fetch(
      `${getApiGatewayUrl()}/search/suggestions?q=${encodeURIComponent(query)}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }
    )

    if (!response.ok) {
      throw new Error('Failed to fetch suggestions')
    }

    const data = await response.json()
    return data.suggestions || []
  } catch (error) {
    console.error('Failed to fetch suggestions:', error)
    return []
  }
}

/**
 * 検索統計情報取得（将来実装予定）
 */
export async function getSearchStats(): Promise<{
  totalSearches: number
  avgResponseTime: number
  popularQueries: string[]
}> {
  try {
    const token = await getAuthToken()

    const response = await fetch(`${getApiGatewayUrl()}/search/stats`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error('Failed to fetch search stats')
    }

    return await response.json()
  } catch (error) {
    console.error('Failed to fetch search stats:', error)
    return {
      totalSearches: 0,
      avgResponseTime: 0,
      popularQueries: [],
    }
  }
}
