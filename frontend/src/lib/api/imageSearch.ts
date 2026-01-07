/**
 * Image Search API Client
 * 画像検索関連のAPI呼び出しクライアント
 */

import type { ImageEmbeddingResponse, ImageEmbeddingError } from '@/types'

// API Gateway URL (Lambda)
const API_BASE_URL = process.env.NEXT_PUBLIC_API_GATEWAY_URL || '/api/search'

/**
 * 画像をBase64に変換
 */
const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // data:image/jpeg;base64, の部分を除去
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

/**
 * 画像をアップロードしてベクトル化
 *
 * @param imageFile - アップロードする画像ファイル
 * @returns 画像のベクトル表現（embedding）
 */
export const uploadImageForEmbedding = async (
  imageFile: File
): Promise<ImageEmbeddingResponse | ImageEmbeddingError> => {
  try {
    console.log('[Image Search API] Uploading image:', {
      name: imageFile.name,
      size: imageFile.size,
      type: imageFile.type,
    })

    // 画像をBase64に変換
    const imageBase64 = await fileToBase64(imageFile)
    console.log('[Image Search API] Image converted to base64, length:', imageBase64.length)

    // Lambda APIを直接呼び出し（embedding生成）
    const response = await fetch(API_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'generate-embedding',
        image: imageBase64,
      }),
    })

    console.log('[Image Search API] Response status:', response.status)

    const data = await response.json()
    console.log('[Image Search API] Response data:', data)

    if (!response.ok || !data.success) {
      console.error('[Image Search API] API error:', data)
      return {
        error: data.error || 'サーバーエラーが発生しました',
        code: data.code || 'UNKNOWN_ERROR',
        message: data.message,
      } as ImageEmbeddingError
    }

    console.log('[Image Search API] Upload successful, embedding dimensions:', data.data.dimensions)

    // レスポンス形式を統一
    return {
      success: true,
      data: {
        embedding: data.data.embedding,
        dimensions: data.data.dimensions,
      },
    } as ImageEmbeddingResponse
  } catch (error: any) {
    console.error('[Image Search API] Network error:', error)
    return {
      error: 'ネットワークエラーが発生しました',
      code: 'NETWORK_ERROR',
      message: error.message,
    }
  }
}

/**
 * 画像のベクトルを使ってファイル検索
 *
 * @param embedding - 画像のベクトル表現
 * @param confidenceThreshold - 信頼度の閾値（デフォルト: 0.9）
 */
export const searchByImageEmbedding = async (
  embedding: number[],
  confidenceThreshold: number = 0.9
) => {
  try {
    const response = await fetch(API_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        imageVector: embedding,
        searchType: 'image',
        limit: 20,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.message || 'Search failed')
    }

    return await response.json()
  } catch (error: any) {
    console.error('Image search failed:', error)
    throw error
  }
}

/**
 * ファイルサイズバリデーション
 */
export const validateFileSize = (file: File, maxSizeMB: number = 5): boolean => {
  const maxSizeBytes = maxSizeMB * 1024 * 1024
  return file.size <= maxSizeBytes
}

/**
 * ファイルタイプバリデーション
 */
export const validateFileType = (file: File): boolean => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg']
  return allowedTypes.includes(file.type)
}

/**
 * 画像ファイルの総合バリデーション
 */
export const validateImageFile = (file: File): { isValid: boolean; error?: string } => {
  if (!validateFileSize(file, 5)) {
    return {
      isValid: false,
      error: 'ファイルサイズは5MB以下にしてください',
    }
  }

  if (!validateFileType(file)) {
    return {
      isValid: false,
      error: 'JPEG、PNG形式の画像のみサポートされています',
    }
  }

  return { isValid: true }
}

/**
 * 画像ファイルのプレビューURLを生成
 */
export const createImagePreviewUrl = (file: File): string => URL.createObjectURL(file)

/**
 * プレビューURLをクリーンアップ
 */
export const revokeImagePreviewUrl = (url: string): void => {
  URL.revokeObjectURL(url)
}
