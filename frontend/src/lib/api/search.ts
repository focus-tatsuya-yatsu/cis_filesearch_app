/**
 * Search API Client
 * フロントエンドから検索APIを呼び出すクライアント
 */

export interface SearchParams {
  q?: string;
  fileType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
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
  success: boolean;
  data: {
    results: SearchResult[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
    query: SearchParams;
    took: number;
  };
}

export interface SearchError {
  error: string;
  code: string;
  message?: string;
}

/**
 * 検索APIを呼び出す
 */
export async function searchFiles(
  params: SearchParams
): Promise<SearchResponse> {
  const searchParams = new URLSearchParams();

  // パラメータを追加
  if (params.q) searchParams.set('q', params.q);
  if (params.fileType) searchParams.set('fileType', params.fileType);
  if (params.dateFrom) searchParams.set('dateFrom', params.dateFrom);
  if (params.dateTo) searchParams.set('dateTo', params.dateTo);
  if (params.page) searchParams.set('page', params.page.toString());
  if (params.limit) searchParams.set('limit', params.limit.toString());
  if (params.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params.sortOrder) searchParams.set('sortOrder', params.sortOrder);

  const url = `/api/search?${searchParams.toString()}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData: SearchError = await response.json();
      throw new Error(errorData.message || errorData.error);
    }

    const data: SearchResponse = await response.json();
    return data;

  } catch (error: any) {
    console.error('Search API call failed:', error);
    throw new Error(error.message || 'Failed to perform search');
  }
}

/**
 * 検索クエリを検証
 */
export function validateSearchQuery(query: string): {
  isValid: boolean;
  error?: string;
} {
  // 空白のみのクエリは無効
  if (!query || !query.trim()) {
    return {
      isValid: false,
      error: '検索キーワードを入力してください',
    };
  }

  // 最小文字数チェック（日本語の場合は1文字でOK）
  if (query.trim().length < 1) {
    return {
      isValid: false,
      error: '検索キーワードは1文字以上入力してください',
    };
  }

  // 最大文字数チェック
  if (query.length > 500) {
    return {
      isValid: false,
      error: '検索キーワードは500文字以内で入力してください',
    };
  }

  return { isValid: true };
}

/**
 * ファイルサイズを人間が読める形式に変換
 */
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

/**
 * 日付を日本語形式にフォーマット
 */
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

/**
 * ハイライトされたテキストからHTMLタグを削除
 */
export function stripHighlightTags(text: string): string {
  return text.replace(/<\/?mark>/g, '');
}
