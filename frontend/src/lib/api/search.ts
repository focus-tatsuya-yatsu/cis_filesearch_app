/**
 * Search API Client
 * フロントエンドから検索APIを呼び出すクライアント
 */

import { ImageSearchDebugLogger } from './debug-logger'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_GATEWAY_URL || '/api/search';

export interface SearchParams {
  q?: string;
  searchMode?: 'and' | 'or';
  imageEmbedding?: number[];
  searchType?: 'text' | 'image';
  fileType?: string;
  dateFrom?: string;
  dateTo?: string;
  dateFilterType?: 'creation' | 'modification';
  page?: number;
  limit?: number;
  sortBy?: 'relevance' | 'date' | 'name' | 'size';
  sortOrder?: 'asc' | 'desc';
  // フィルター条件
  categories?: string[];  // ['road', 'structure']
  folders?: string[];     // ['H22_JOB', 'H23_JOB']
}

export interface SearchResult {
  id: string;
  fileName: string;
  filePath: string;
  fileType?: string;
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
  success: boolean;
  data: {
    results: SearchResult[];
    total: number;
    page: number;
    limit: number;
    searchType: string;
    index: string;
    query?: SearchParams;
    took?: number;
  };
}

export interface SearchError {
  error: string;
  code: string;
  message?: string;
}

export interface ApiErrorResponse {
  userMessage: string;
  technicalMessage: string;
  statusCode: number;
  retryable: boolean;
  debugInfo?: {
    originalError?: string;
    timestamp: string;
    endpoint: string;
  };
}

const getErrorMessage = (statusCode: number, errorData?: SearchError): string => {
  // カスタムエラーコードのチェック
  if (errorData?.code === 'PAGINATION_LIMIT_EXCEEDED' || errorData?.error === 'PAGINATION_LIMIT_EXCEEDED') {
    return errorData?.message || '検索結果の表示上限を超えています。検索条件を絞り込んでください。';
  }

  switch (statusCode) {
    case 400:
      return errorData?.message || '検索条件が正しくありません。入力内容を確認してください。';
    case 401:
      return '認証が必要です。ログインしてください。';
    case 403:
      return 'このリソースへのアクセス権限がありません。';
    case 404:
      return '検索サービスが見つかりません。管理者に連絡してください。';
    case 429:
      return 'リクエストが多すぎます。しばらく待ってから再度お試しください。';
    case 500:
      // OpenSearch max_result_window エラーの検出
      if (errorData?.message?.includes('max_result_window') || errorData?.error?.includes('max_result_window')) {
        return '検索結果の表示上限を超えています。検索条件を絞り込むか、前のページに戻ってください。';
      }
      return 'サーバーエラーが発生しました。時間をおいて再度お試しください。';
    case 502:
      return 'ゲートウェイエラーが発生しました。時間をおいて再度お試しください。';
    case 503:
      return 'サービスが一時的に利用できません。しばらく待ってから再度お試しください。';
    case 504:
      return 'タイムアウトが発生しました。検索条件を絞り込んで再度お試しください。';
    default:
      return errorData?.message || '検索中に予期しないエラーが発生しました。';
  }
};

const isRetryableError = (statusCode: number): boolean => {
  return [429, 502, 503, 504].includes(statusCode);
};

async function handleSearchResponse(
  response: Response,
  url: string,
  isDevelopment: boolean
): Promise<SearchResponse | ApiErrorResponse> {
  if (!response.ok) {
    let errorData: SearchError | null = null;
    try {
      errorData = await response.json();
    } catch (parseError) {
      ImageSearchDebugLogger.logError('handleSearchResponse - JSON Parse Error', parseError)
    }

    const statusCode = response.status;
    const userMessage = getErrorMessage(statusCode, errorData || undefined);
    const technicalMessage = errorData?.message || errorData?.error || response.statusText;

    const errorResponse: ApiErrorResponse = {
      userMessage,
      technicalMessage,
      statusCode,
      retryable: isRetryableError(statusCode),
    };

    if (isDevelopment) {
      errorResponse.debugInfo = {
        originalError: errorData?.error,
        timestamp: new Date().toISOString(),
        endpoint: url,
      };
      console.error('Search API Error (Development):', { statusCode, userMessage, technicalMessage, errorData, url });
    }

    return errorResponse;
  }

  try {
    const data: SearchResponse = await response.json();
    return data;
  } catch (parseError) {
    ImageSearchDebugLogger.logError('handleSearchResponse - Response Parse Error', parseError)
    return {
      userMessage: 'サーバーからの応答を処理できませんでした。',
      technicalMessage: 'Failed to parse JSON response',
      statusCode: response.status,
      retryable: false,
    };
  }
}

function handleSearchError(error: unknown, url: string, isDevelopment: boolean): ApiErrorResponse {
  let errorMessage = 'Network error';
  if (error instanceof Error) {
    errorMessage = error.message;
  }

  const errorResponse: ApiErrorResponse = {
    userMessage: 'ネットワークエラーが発生しました。インターネット接続を確認してください。',
    technicalMessage: errorMessage,
    statusCode: 0,
    retryable: true,
  };

  if (isDevelopment) {
    errorResponse.debugInfo = {
      originalError: String(error),
      timestamp: new Date().toISOString(),
      endpoint: url,
    };
    console.error('Search API Network Error (Development):', error);
  }

  return errorResponse;
}

export async function searchFiles(params: SearchParams): Promise<SearchResponse | ApiErrorResponse> {
  const isDevelopment = process.env.NODE_ENV === 'development';

  // 画像検索の場合
  if (params.imageEmbedding && params.imageEmbedding.length > 0) {
    const url = API_BASE_URL;
    const startTime = ImageSearchDebugLogger.startPerformance('Image Search Request')

    ImageSearchDebugLogger.logVectorData(params.imageEmbedding, 'Sending to API')

    const requestBody = {
      searchQuery: params.q || '', // テキストクエリ（ハイブリッド検索用）
      imageVector: params.imageEmbedding,
      searchType: 'image',
      searchMode: params.searchMode || 'or',
      page: params.page || 1,
      limit: params.limit || 20,
      sortBy: params.sortBy || 'relevance',
      sortOrder: params.sortOrder || 'desc',
      // フィルター条件
      fileType: params.fileType,
      categories: params.categories,
      folders: params.folders,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      dateFilterType: params.dateFilterType,
    }

    ImageSearchDebugLogger.logRequest(url, 'POST', requestBody)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      ImageSearchDebugLogger.endPerformance('Image Search Request', startTime)
      const data = await handleSearchResponse(response, url, isDevelopment);
      ImageSearchDebugLogger.logResponse(url, response.status, data)
      return data
    } catch (error: unknown) {
      ImageSearchDebugLogger.endPerformance('Image Search Request', startTime)
      ImageSearchDebugLogger.logError('searchFiles (Image Search)', error)
      return handleSearchError(error, url, isDevelopment);
    }
  }

  // テキスト検索の場合（POST）
  const url = API_BASE_URL;

  const requestBody = {
    searchQuery: params.q || '',
    searchType: 'text',
    searchMode: params.searchMode || 'or',
    page: params.page || 1,
    limit: params.limit || 20,
    sortBy: params.sortBy || 'relevance',
    sortOrder: params.sortOrder || 'desc',
    // フィルター条件
    fileType: params.fileType,
    categories: params.categories,
    folders: params.folders,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    dateFilterType: params.dateFilterType,
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    return await handleSearchResponse(response, url, isDevelopment);
  } catch (error: unknown) {
    return handleSearchError(error, url, isDevelopment);
  }
}

export const isApiError = (response: SearchResponse | ApiErrorResponse): response is ApiErrorResponse => {
  return 'statusCode' in response && 'userMessage' in response;
};

export function validateSearchQuery(query: string): { isValid: boolean; error?: string } {
  if (!query || !query.trim()) {
    return { isValid: false, error: '検索キーワードを入力してください' };
  }
  if (query.length > 500) {
    return { isValid: false, error: '検索キーワードは500文字以内で入力してください' };
  }
  return { isValid: true };
}

export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function stripHighlightTags(text: string): string {
  return text.replace(/<\/?mark>/g, '');
}
