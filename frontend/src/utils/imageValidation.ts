/**
 * Image Validation Utilities
 * 画像ファイルのバリデーション関連ユーティリティ
 */

/**
 * 許可される画像ファイルタイプ
 */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/jpg'] as const

/**
 * 最大ファイルサイズ（5MB）
 */
export const MAX_FILE_SIZE = 5 * 1024 * 1024

/**
 * 最小ベクトル次元数
 */
export const MIN_VECTOR_DIMENSIONS = 1024

/**
 * 最小信頼度スコア（90%）
 */
export const MIN_CONFIDENCE_SCORE = 0.9

/**
 * 画像バリデーション結果の型
 */
export interface ImageValidationResult {
  valid: boolean
  error?: string
  errorCode?: string
}

/**
 * ファイルが画像かどうかをチェック
 */
export const isImageFile = (file: File): boolean => ALLOWED_IMAGE_TYPES.includes(file.type as any)

/**
 * ファイルサイズが許容範囲内かチェック
 */
export const isValidFileSize = (file: File): boolean => file.size > 0 && file.size <= MAX_FILE_SIZE

/**
 * 画像ファイルの包括的なバリデーション
 */
export const validateImageFile = (file: File): ImageValidationResult => {
  // ファイルが存在するかチェック
  if (!file) {
    return {
      valid: false,
      error: 'File is required',
      errorCode: 'MISSING_FILE',
    }
  }

  // ファイルタイプチェック
  if (!isImageFile(file)) {
    return {
      valid: false,
      error: `Only ${ALLOWED_IMAGE_TYPES.join(', ')} images are supported`,
      errorCode: 'INVALID_FILE_TYPE',
    }
  }

  // ファイルサイズチェック
  if (!isValidFileSize(file)) {
    if (file.size === 0) {
      return {
        valid: false,
        error: 'File is empty',
        errorCode: 'EMPTY_FILE',
      }
    }
    return {
      valid: false,
      error: `File size must be less than ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
      errorCode: 'FILE_TOO_LARGE',
    }
  }

  return { valid: true }
}

/**
 * ベクトル次元数が正しいかチェック
 */
export const isValidVectorDimensions = (dimensions: number): boolean =>
  dimensions === MIN_VECTOR_DIMENSIONS

/**
 * ベクトルが有効かチェック
 */
export const validateVector = (vector: number[]): ImageValidationResult => {
  if (!Array.isArray(vector)) {
    return {
      valid: false,
      error: 'Vector must be an array',
      errorCode: 'INVALID_VECTOR_FORMAT',
    }
  }

  if (vector.length === 0) {
    return {
      valid: false,
      error: 'Vector is empty',
      errorCode: 'EMPTY_VECTOR',
    }
  }

  if (!isValidVectorDimensions(vector.length)) {
    return {
      valid: false,
      error: `Vector must have ${MIN_VECTOR_DIMENSIONS} dimensions`,
      errorCode: 'INVALID_VECTOR_DIMENSIONS',
    }
  }

  // 全ての要素が数値かチェック
  const hasInvalidNumbers = vector.some((val) => typeof val !== 'number' || !isFinite(val))
  if (hasInvalidNumbers) {
    return {
      valid: false,
      error: 'Vector contains invalid numbers',
      errorCode: 'INVALID_VECTOR_VALUES',
    }
  }

  return { valid: true }
}

/**
 * 信頼度スコアが閾値を超えているかチェック
 */
export const meetsConfidenceThreshold = (score: number): boolean => score >= MIN_CONFIDENCE_SCORE

/**
 * 検索結果を信頼度でフィルタリング
 */
export interface SearchResult {
  id: string
  score: number
  [key: string]: any
}

export const filterByConfidence = (results: SearchResult[]): SearchResult[] =>
  results.filter((result) => meetsConfidenceThreshold(result.score))

/**
 * ファイル拡張子を取得
 */
export const getFileExtension = (filename: string): string => {
  const parts = filename.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
}

/**
 * 画像ファイルかどうかを拡張子でチェック
 */
export const isImageExtension = (filename: string): boolean => {
  const extension = getFileExtension(filename)
  return ['jpg', 'jpeg', 'png'].includes(extension)
}

/**
 * Base64文字列が有効かチェック
 */
export const isValidBase64 = (str: string): boolean => {
  if (!str || typeof str !== 'string') {
    return false
  }

  // Base64の正規表現パターン
  const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/
  return base64Pattern.test(str)
}

/**
 * ファイルサイズを人間が読みやすい形式に変換
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}
