/**
 * 画像圧縮ユーティリティ
 * クライアントサイドで画像を圧縮してアップロードサイズを削減
 */

export interface CompressionOptions {
  /**
   * 最大ファイルサイズ（MB）
   */
  maxSizeMB?: number

  /**
   * 最大幅（px）
   */
  maxWidth?: number

  /**
   * 最大高さ（px）
   */
  maxHeight?: number

  /**
   * 画質（0-1）
   */
  quality?: number

  /**
   * WebPに変換するか
   */
  convertToWebP?: boolean

  /**
   * プログレッシブJPEG/インターレースPNG
   */
  progressive?: boolean
}

export interface CompressionResult {
  /**
   * 圧縮後のファイル
   */
  file: File

  /**
   * 圧縮前のサイズ（bytes）
   */
  originalSize: number

  /**
   * 圧縮後のサイズ（bytes）
   */
  compressedSize: number

  /**
   * 圧縮率（%）
   */
  compressionRatio: number

  /**
   * 圧縮にかかった時間（ms）
   */
  processingTime: number
}

/**
 * 画像を読み込んでImageオブジェクトを作成
 */
const loadImage = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }

    img.src = url
  })

/**
 * Canvasを使用して画像をリサイズ・圧縮
 */
const resizeAndCompressImage = (
  img: HTMLImageElement,
  options: CompressionOptions
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const { maxWidth = 2048, maxHeight = 2048, quality = 0.85, convertToWebP = true } = options

    // アスペクト比を維持してリサイズ
    let { width, height } = img
    if (width > maxWidth || height > maxHeight) {
      const ratio = Math.min(maxWidth / width, maxHeight / height)
      width = Math.floor(width * ratio)
      height = Math.floor(height * ratio)
    }

    // Canvas作成
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('Failed to get canvas context'))
      return
    }

    // 画質向上のための設定
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    // 画像を描画
    ctx.drawImage(img, 0, 0, width, height)

    // 出力形式を決定
    const mimeType =
      convertToWebP && isWebPSupported()
        ? 'image/webp'
        : img.src.startsWith('data:image/png')
          ? 'image/png'
          : 'image/jpeg'

    // Blobに変換
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Failed to compress image'))
        }
      },
      mimeType,
      quality
    )
  })

/**
 * WebPサポートチェック
 */
const isWebPSupported = (): boolean => {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  return canvas.toDataURL('image/webp').startsWith('data:image/webp')
}

/**
 * ファイルサイズが目標サイズ以下になるまで圧縮
 */
const compressToTargetSize = async (
  img: HTMLImageElement,
  targetSizeMB: number,
  options: CompressionOptions
): Promise<Blob> => {
  let quality = options.quality || 0.85
  let blob: Blob
  const targetSizeBytes = targetSizeMB * 1024 * 1024
  const minQuality = 0.1
  const qualityStep = 0.05

  // バイナリサーチで最適な品質を見つける
  while (quality >= minQuality) {
    blob = await resizeAndCompressImage(img, { ...options, quality })

    if (blob.size <= targetSizeBytes) {
      return blob
    }

    quality -= qualityStep
  }

  // 最小品質でも目標サイズを超える場合は、さらにリサイズ
  const currentOptions = { ...options }
  let scale = 0.9

  while (scale > 0.3) {
    currentOptions.maxWidth = Math.floor((options.maxWidth || img.width) * scale)
    currentOptions.maxHeight = Math.floor((options.maxHeight || img.height) * scale)
    currentOptions.quality = minQuality

    blob = await resizeAndCompressImage(img, currentOptions)

    if (blob.size <= targetSizeBytes) {
      return blob
    }

    scale -= 0.1
  }

  // それでも大きい場合は、最後の結果を返す
  throw new Error(
    `Cannot compress image below ${targetSizeMB}MB. Current size: ${(blob!.size / 1024 / 1024).toFixed(2)}MB`
  )
}

/**
 * 画像を圧縮
 *
 * @param file - 圧縮する画像ファイル
 * @param options - 圧縮オプション
 * @returns 圧縮結果
 */
export const compressImage = async (
  file: File,
  options: CompressionOptions = {}
): Promise<CompressionResult> => {
  const startTime = performance.now()
  const originalSize = file.size

  // デフォルトオプション
  const defaultOptions: CompressionOptions = {
    maxSizeMB: 1,
    maxWidth: 2048,
    maxHeight: 2048,
    quality: 0.85,
    convertToWebP: true,
    progressive: true,
  }

  const mergedOptions = { ...defaultOptions, ...options }

  try {
    // 画像を読み込み
    const img = await loadImage(file)

    // すでに目標サイズ以下の場合は、リサイズのみ
    const targetSizeBytes = (mergedOptions.maxSizeMB || 1) * 1024 * 1024
    let blob: Blob

    if (originalSize <= targetSizeBytes) {
      blob = await resizeAndCompressImage(img, mergedOptions)
    } else {
      blob = await compressToTargetSize(img, mergedOptions.maxSizeMB || 1, mergedOptions)
    }

    // Fileオブジェクトを作成
    const extension =
      mergedOptions.convertToWebP && isWebPSupported()
        ? 'webp'
        : file.name.split('.').pop() || 'jpg'
    const fileName = file.name.replace(/\.[^.]+$/, `.${extension}`)
    const compressedFile = new File([blob], fileName, {
      type: blob.type,
      lastModified: Date.now(),
    })

    const processingTime = performance.now() - startTime
    const compressedSize = compressedFile.size
    const compressionRatio = ((originalSize - compressedSize) / originalSize) * 100

    return {
      file: compressedFile,
      originalSize,
      compressedSize,
      compressionRatio,
      processingTime,
    }
  } catch (error) {
    throw new Error(
      `Image compression failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * 画像を段階的に圧縮（プログレッシブアップロード用）
 * 低品質版→高品質版の順で圧縮
 */
export const createProgressiveImages = async (
  file: File
): Promise<{ thumbnail: File; preview: File; full: File }> => {
  const img = await loadImage(file)

  // サムネイル（64x64、低品質）
  const thumbnailBlob = await resizeAndCompressImage(img, {
    maxWidth: 64,
    maxHeight: 64,
    quality: 0.5,
    convertToWebP: true,
  })
  const thumbnail = new File([thumbnailBlob], `thumb_${file.name}`, {
    type: thumbnailBlob.type,
  })

  // プレビュー（512x512、中品質）
  const previewBlob = await resizeAndCompressImage(img, {
    maxWidth: 512,
    maxHeight: 512,
    quality: 0.7,
    convertToWebP: true,
  })
  const preview = new File([previewBlob], `preview_${file.name}`, {
    type: previewBlob.type,
  })

  // フル画質（2048x2048、高品質）
  const fullBlob = await resizeAndCompressImage(img, {
    maxWidth: 2048,
    maxHeight: 2048,
    quality: 0.85,
    convertToWebP: true,
  })
  const full = new File([fullBlob], file.name, {
    type: fullBlob.type,
  })

  return { thumbnail, preview, full }
}

/**
 * 圧縮の進捗を監視しながら実行
 */
export const compressImageWithProgress = async (
  file: File,
  options: CompressionOptions = {},
  onProgress?: (progress: number) => void
): Promise<CompressionResult> => {
  // プログレス通知
  onProgress?.(0)

  const startTime = performance.now()
  const originalSize = file.size

  // 画像読み込み（20%）
  const img = await loadImage(file)
  onProgress?.(20)

  // 圧縮準備（40%）
  const defaultOptions: CompressionOptions = {
    maxSizeMB: 1,
    maxWidth: 2048,
    maxHeight: 2048,
    quality: 0.85,
    convertToWebP: true,
  }
  const mergedOptions = { ...defaultOptions, ...options }
  onProgress?.(40)

  // 圧縮実行（80%）
  const targetSizeBytes = (mergedOptions.maxSizeMB || 1) * 1024 * 1024
  let blob: Blob

  if (originalSize <= targetSizeBytes) {
    blob = await resizeAndCompressImage(img, mergedOptions)
  } else {
    blob = await compressToTargetSize(img, mergedOptions.maxSizeMB || 1, mergedOptions)
  }
  onProgress?.(80)

  // Fileオブジェクト作成（100%）
  const extension =
    mergedOptions.convertToWebP && isWebPSupported() ? 'webp' : file.name.split('.').pop() || 'jpg'
  const fileName = file.name.replace(/\.[^.]+$/, `.${extension}`)
  const compressedFile = new File([blob], fileName, {
    type: blob.type,
    lastModified: Date.now(),
  })

  const processingTime = performance.now() - startTime
  const compressedSize = compressedFile.size
  const compressionRatio = ((originalSize - compressedSize) / originalSize) * 100

  onProgress?.(100)

  return {
    file: compressedFile,
    originalSize,
    compressedSize,
    compressionRatio,
    processingTime,
  }
}
