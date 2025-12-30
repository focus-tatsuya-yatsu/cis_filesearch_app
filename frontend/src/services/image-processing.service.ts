/**
 * Image Processing Service
 * クライアントサイドでの画像最適化処理
 *
 * Features:
 * - 画像リサイズ（アップロード前の最適化）
 * - WebP変換サポート
 * - 画像圧縮
 * - プログレッシブローディング
 */

/**
 * 画像最適化オプション
 */
export interface ImageOptimizationOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // 0-1
  format?: 'jpeg' | 'png' | 'webp';
}

/**
 * デフォルト設定
 */
const DEFAULT_OPTIONS: Required<ImageOptimizationOptions> = {
  maxWidth: 1024,
  maxHeight: 1024,
  quality: 0.85,
  format: 'jpeg',
};

/**
 * 画像をリサイズして最適化
 * Bedrock APIへの送信前に画像サイズを削減
 */
export async function optimizeImage(
  file: File,
  options: ImageOptimizationOptions = {}
): Promise<Blob> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // ファイルサイズチェック（5MB制限）
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Image file size must be less than 5MB');
  }

  // 画像をロード
  const img = await loadImage(file);

  // リサイズ比率を計算
  const { width, height } = calculateResizeDimensions(
    img.width,
    img.height,
    opts.maxWidth,
    opts.maxHeight
  );

  // Canvasでリサイズ
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // 高品質リサイズ設定
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 画像を描画
  ctx.drawImage(img, 0, 0, width, height);

  // Blobに変換
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to convert canvas to blob'));
        }
      },
      `image/${opts.format}`,
      opts.quality
    );
  });
}

/**
 * 画像をロード
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

/**
 * リサイズ後の寸法を計算（アスペクト比を維持）
 */
function calculateResizeDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  let width = originalWidth;
  let height = originalHeight;

  // 最大幅を超える場合
  if (width > maxWidth) {
    height = (height * maxWidth) / width;
    width = maxWidth;
  }

  // 最大高さを超える場合
  if (height > maxHeight) {
    width = (width * maxHeight) / height;
    height = maxHeight;
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

/**
 * 画像をプログレッシブにロード
 * 低解像度プレビュー → 高解像度の順にロード
 */
export async function loadImageProgressively(
  file: File
): Promise<{ preview: Blob; full: Blob }> {
  // 低解像度プレビュー（200x200、低品質）
  const preview = await optimizeImage(file, {
    maxWidth: 200,
    maxHeight: 200,
    quality: 0.6,
  });

  // フル解像度（1024x1024、高品質）
  const full = await optimizeImage(file, {
    maxWidth: 1024,
    maxHeight: 1024,
    quality: 0.85,
  });

  return { preview, full };
}

/**
 * ファイルをBase64エンコード
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        // "data:image/jpeg;base64," プレフィックスを除去
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error('Failed to convert blob to base64'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * 画像形式を検証
 */
export function validateImageFormat(file: File): boolean {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
  return allowedTypes.includes(file.type);
}

/**
 * 画像メタデータを取得
 */
export async function getImageMetadata(file: File): Promise<{
  width: number;
  height: number;
  size: number;
  format: string;
}> {
  const img = await loadImage(file);

  return {
    width: img.width,
    height: img.height,
    size: file.size,
    format: file.type,
  };
}
