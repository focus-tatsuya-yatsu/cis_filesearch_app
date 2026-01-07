/**
 * Toast notification messages
 * Centralized message definitions for consistent UX
 */

/**
 * Image search related messages
 */
export const IMAGE_SEARCH_MESSAGES = {
  // Upload
  UPLOAD_START: '画像をアップロード中...',
  UPLOAD_SUCCESS: '画像のアップロードに成功しました',
  UPLOAD_ERROR: '画像のアップロードに失敗しました',

  // Validation errors
  INVALID_FILE_TYPE: 'サポートされていないファイル形式です',
  INVALID_FILE_SIZE: 'ファイルサイズが大きすぎます (最大5MB)',

  // Search
  SEARCH_START: '類似画像を検索中...',
  SEARCH_SUCCESS: '検索が完了しました',
  SEARCH_NO_RESULTS: '類似する画像が見つかりませんでした',
  SEARCH_ERROR: '画像検索中にエラーが発生しました',

  // OpenSearch
  OPENSEARCH_CONNECTION_ERROR: 'OpenSearchへの接続に失敗しました',
  OPENSEARCH_TIMEOUT: 'OpenSearchがタイムアウトしました',
} as const

/**
 * Text search related messages
 */
export const TEXT_SEARCH_MESSAGES = {
  // Search
  SEARCH_START: '検索中...',
  SEARCH_SUCCESS: '検索が完了しました',
  SEARCH_NO_RESULTS: '検索結果が見つかりませんでした',
  SEARCH_ERROR: '検索中にエラーが発生しました',

  // Validation
  EMPTY_QUERY: '検索キーワードを入力してください',
  QUERY_TOO_SHORT: '検索キーワードは1文字以上入力してください',
  QUERY_TOO_LONG: '検索キーワードは500文字以内で入力してください',
} as const

/**
 * General API error messages
 */
export const API_ERROR_MESSAGES = {
  NETWORK_ERROR: 'ネットワークエラーが発生しました',
  SERVER_ERROR: 'サーバーエラーが発生しました',
  TIMEOUT: 'リクエストがタイムアウトしました',
  UNAUTHORIZED: '認証が必要です',
  FORBIDDEN: 'アクセス権限がありません',
  NOT_FOUND: 'リソースが見つかりません',
  RATE_LIMIT: 'リクエストが多すぎます。しばらく待ってから再度お試しください',
} as const

/**
 * Filter related messages
 */
export const FILTER_MESSAGES = {
  APPLIED: 'フィルタを適用しました',
  CLEARED: 'フィルタをクリアしました',
  NO_FILTERS: 'フィルタが設定されていません',
} as const

/**
 * File operation messages
 */
export const FILE_OPERATION_MESSAGES = {
  DOWNLOAD_START: 'ダウンロードを開始しました',
  DOWNLOAD_SUCCESS: 'ダウンロードが完了しました',
  DOWNLOAD_ERROR: 'ダウンロードに失敗しました',

  PREVIEW_ERROR: 'プレビューの表示に失敗しました',

  COPY_SUCCESS: 'パスをクリップボードにコピーしました',
  COPY_ERROR: 'コピーに失敗しました',
} as const

/**
 * Get localized error message with fallback
 */
export const getErrorMessage = (error: unknown, fallback = 'エラーが発生しました'): string => {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  if (error && typeof error === 'object') {
    const errorObj = error as Record<string, unknown>

    if ('userMessage' in errorObj && typeof errorObj.userMessage === 'string') {
      return errorObj.userMessage
    }

    if ('message' in errorObj && typeof errorObj.message === 'string') {
      return errorObj.message
    }

    if ('error' in errorObj && typeof errorObj.error === 'string') {
      return errorObj.error
    }
  }

  return fallback
}

/**
 * Create retry action configuration
 */
export const createRetryAction = (onRetry: () => void) => ({
  label: '再試行',
  onClick: onRetry,
})

/**
 * Create cancel action configuration
 */
export const createCancelAction = (onCancel?: () => void) => ({
  label: '閉じる',
  onClick: onCancel,
})
