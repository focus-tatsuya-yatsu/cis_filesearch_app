/**
 * Image Processing Optimization Module
 *
 * Features:
 * - Client-side image compression
 * - Automatic resizing
 * - Format conversion
 * - Batch processing
 * - Progress tracking
 * - Memory-efficient processing
 */

/**
 * Image processing options
 */
export interface ImageProcessingOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // 0-1 for JPEG quality
  format?: 'jpeg' | 'png' | 'webp';
  maxSizeMB?: number;
}

/**
 * Processed image result
 */
export interface ProcessedImage {
  file: File;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  width: number;
  height: number;
  processingTime: number;
}

/**
 * Batch processing result
 */
export interface BatchProcessingResult {
  processed: ProcessedImage[];
  failed: Array<{ file: File; error: string }>;
  totalTime: number;
  totalOriginalSize: number;
  totalCompressedSize: number;
  averageCompressionRatio: number;
}

/**
 * Default image processing settings
 */
const DEFAULT_OPTIONS: ImageProcessingOptions = {
  maxWidth: 2048,
  maxHeight: 2048,
  quality: 0.85,
  format: 'jpeg',
  maxSizeMB: 5,
};

/**
 * Check if image needs compression
 *
 * @param file - Image file to check
 * @param maxSizeMB - Maximum file size in MB
 * @returns True if compression is needed
 */
export const needsCompression = (
  file: File,
  maxSizeMB: number = 5
): boolean => {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  return file.size > maxSizeBytes;
};

/**
 * Load image from File object
 *
 * @param file - Image file
 * @returns Promise that resolves to HTMLImageElement
 */
const loadImage = (file: File): Promise<HTMLImageElement> => {
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
};

/**
 * Calculate optimal dimensions while maintaining aspect ratio
 *
 * @param originalWidth - Original image width
 * @param originalHeight - Original image height
 * @param maxWidth - Maximum width
 * @param maxHeight - Maximum height
 * @returns Optimal dimensions
 */
const calculateOptimalDimensions = (
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } => {
  if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
    return { width: originalWidth, height: originalHeight };
  }

  const ratio = Math.min(maxWidth / originalWidth, maxHeight / originalHeight);

  return {
    width: Math.round(originalWidth * ratio),
    height: Math.round(originalHeight * ratio),
  };
};

/**
 * Compress and resize image
 *
 * @param file - Image file to process
 * @param options - Processing options
 * @returns Promise that resolves to processed image
 */
export const compressImage = async (
  file: File,
  options: ImageProcessingOptions = {}
): Promise<ProcessedImage> => {
  const startTime = performance.now();

  const opts = { ...DEFAULT_OPTIONS, ...options };

  try {
    // Load image
    const img = await loadImage(file);

    // Calculate optimal dimensions
    const { width, height } = calculateOptimalDimensions(
      img.naturalWidth,
      img.naturalHeight,
      opts.maxWidth!,
      opts.maxHeight!
    );

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    // Enable image smoothing for better quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Draw resized image
    ctx.drawImage(img, 0, 0, width, height);

    // Convert to blob
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) {
            resolve(result);
          } else {
            reject(new Error('Failed to convert canvas to blob'));
          }
        },
        `image/${opts.format}`,
        opts.quality
      );
    });

    // Create new File object
    const compressedFile = new File(
      [blob],
      file.name.replace(/\.[^.]+$/, `.${opts.format}`),
      { type: blob.type }
    );

    const processingTime = performance.now() - startTime;

    return {
      file: compressedFile,
      originalSize: file.size,
      compressedSize: compressedFile.size,
      compressionRatio: file.size / compressedFile.size,
      width,
      height,
      processingTime,
    };
  } catch (error) {
    throw new Error(
      `Image compression failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Process multiple images in batch
 *
 * @param files - Array of image files
 * @param options - Processing options
 * @param onProgress - Progress callback
 * @returns Promise that resolves to batch processing result
 */
export const batchProcessImages = async (
  files: File[],
  options: ImageProcessingOptions = {},
  onProgress?: (processed: number, total: number) => void
): Promise<BatchProcessingResult> => {
  const startTime = performance.now();

  const processed: ProcessedImage[] = [];
  const failed: Array<{ file: File; error: string }> = [];

  for (let i = 0; i < files.length; i++) {
    try {
      const result = await compressImage(files[i], options);
      processed.push(result);
    } catch (error) {
      failed.push({
        file: files[i],
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    if (onProgress) {
      onProgress(i + 1, files.length);
    }
  }

  const totalTime = performance.now() - startTime;
  const totalOriginalSize = processed.reduce((sum, p) => sum + p.originalSize, 0);
  const totalCompressedSize = processed.reduce((sum, p) => sum + p.compressedSize, 0);
  const averageCompressionRatio =
    processed.length > 0
      ? processed.reduce((sum, p) => sum + p.compressionRatio, 0) / processed.length
      : 0;

  return {
    processed,
    failed,
    totalTime,
    totalOriginalSize,
    totalCompressedSize,
    averageCompressionRatio,
  };
};

/**
 * Convert image to WebP format for better compression
 *
 * @param file - Image file
 * @param quality - WebP quality (0-1)
 * @returns Promise that resolves to WebP file
 */
export const convertToWebP = async (
  file: File,
  quality: number = 0.85
): Promise<File> => {
  return compressImage(file, {
    format: 'webp',
    quality,
    maxWidth: 2048,
    maxHeight: 2048,
  }).then((result) => result.file);
};

/**
 * Get image dimensions without loading full image
 *
 * @param file - Image file
 * @returns Promise that resolves to image dimensions
 */
export const getImageDimensions = async (
  file: File
): Promise<{ width: number; height: number }> => {
  const img = await loadImage(file);
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
  };
};

/**
 * Validate image file
 *
 * @param file - File to validate
 * @returns Validation result
 */
export const validateImageFile = (
  file: File
): { isValid: boolean; error?: string } => {
  // Check file type
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return {
      isValid: false,
      error: 'JPEG、PNG、WebP形式の画像のみサポートされています',
    };
  }

  // Check file size (max 10MB before compression)
  const maxSizeBytes = 10 * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    return {
      isValid: false,
      error: 'ファイルサイズは10MB以下にしてください',
    };
  }

  return { isValid: true };
};

/**
 * Format file size for display
 *
 * @param bytes - File size in bytes
 * @returns Formatted size string
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  } else {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
};

/**
 * Calculate estimated compression time
 *
 * @param fileSize - File size in bytes
 * @returns Estimated time in milliseconds
 */
export const estimateCompressionTime = (fileSize: number): number => {
  // Empirical formula: ~100ms per MB
  const sizeMB = fileSize / (1024 * 1024);
  return Math.round(sizeMB * 100);
};
