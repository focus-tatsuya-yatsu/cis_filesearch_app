/**
 * Image Upload Component
 * ドラッグ&ドロップまたはファイル選択で画像をアップロード
 */

import { FC, useCallback, useState, useRef, DragEvent, ChangeEvent } from 'react';
import { Upload, X, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { validateImageFile } from '@/utils/imageValidation';
import { useToast } from '@/hooks';
import { IMAGE_SEARCH_MESSAGES } from '@/lib/constants/toast-messages';
import { compressImageWithProgress, type CompressionResult } from '@/lib/imageCompression';

export interface ImageUploadProps {
  /**
   * アップロード成功時のコールバック
   */
  onUploadSuccess?: (data: ImageUploadResult) => void;

  /**
   * アップロード失敗時のコールバック
   */
  onUploadError?: (error: ImageUploadError) => void;

  /**
   * アップロード中の状態変更コールバック
   */
  onUploadingChange?: (isUploading: boolean) => void;

  /**
   * カスタムクラス名
   */
  className?: string;

  /**
   * 無効化フラグ
   */
  disabled?: boolean;
}

export interface ImageUploadResult {
  embedding: number[];
  dimensions: number;
  fileName: string;
  fileSize: number;
  fileType: string;
}

export interface ImageUploadError {
  error: string;
  code: string;
  message?: string;
}

/**
 * 画像アップロードコンポーネント
 */
export const ImageUpload: FC<ImageUploadProps> = ({
  onUploadSuccess,
  onUploadError,
  onUploadingChange,
  className = '',
  disabled = false,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compressionProgress, setCompressionProgress] = useState(0);
  const [compressionStats, setCompressionStats] = useState<CompressionResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  /**
   * アップロード状態を更新
   */
  const updateUploadingState = useCallback(
    (uploading: boolean) => {
      setIsUploading(uploading);
      onUploadingChange?.(uploading);
    },
    [onUploadingChange]
  );

  /**
   * ファイルをアップロード
   */
  const uploadFile = useCallback(
    async (file: File) => {
      // バリデーション
      const validation = validateImageFile(file);
      if (!validation.valid) {
        const errorMessage = validation.error || 'Invalid file';
        setError(errorMessage);

        // バリデーションエラー通知
        if (validation.errorCode === 'INVALID_TYPE') {
          toast.error(IMAGE_SEARCH_MESSAGES.INVALID_FILE_TYPE, {
            description: errorMessage,
          });
        } else if (validation.errorCode === 'FILE_TOO_LARGE') {
          toast.error(IMAGE_SEARCH_MESSAGES.INVALID_FILE_SIZE, {
            description: errorMessage,
          });
        } else {
          toast.error('ファイルの検証に失敗しました', {
            description: errorMessage,
          });
        }

        onUploadError?.({
          error: errorMessage,
          code: validation.errorCode || 'VALIDATION_ERROR',
        });
        return;
      }

      updateUploadingState(true);
      setError(null);
      setCompressionProgress(0);

      // ローディングトースト表示
      const toastId = toast.loading(IMAGE_SEARCH_MESSAGES.UPLOAD_START, {
        description: `${file.name} (${(file.size / 1024).toFixed(1)} KB)`,
      });

      try {
        // 画像圧縮
        const compressionResult = await compressImageWithProgress(
          file,
          {
            maxSizeMB: 1,
            maxWidth: 2048,
            maxHeight: 2048,
            quality: 0.85,
            convertToWebP: true,
          },
          (progress) => {
            setCompressionProgress(progress);
          }
        );

        setCompressionStats(compressionResult);

        // 圧縮統計を表示
        const savingsMB = (compressionResult.originalSize - compressionResult.compressedSize) / 1024 / 1024;
        if (savingsMB > 0.1) {
          console.log(`[Image Compression] Saved ${savingsMB.toFixed(2)}MB (${compressionResult.compressionRatio.toFixed(1)}% reduction)`);
        }

        // FormData作成（圧縮後の画像を使用）
        const formData = new FormData();
        formData.append('image', compressionResult.file);

        // API呼び出し
        const response = await fetch('/api/image-embedding', {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Upload failed');
        }

        // 成功
        toast.dismiss(toastId);
        toast.success(IMAGE_SEARCH_MESSAGES.UPLOAD_SUCCESS, {
          description: `ベクトル化が完了しました (${data.data.dimensions}次元) - ${savingsMB.toFixed(1)}MB削減`,
        });

        onUploadSuccess?.(data.data);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Upload failed';
        setError(errorMessage);

        // エラートースト表示
        toast.dismiss(toastId);
        toast.error(IMAGE_SEARCH_MESSAGES.UPLOAD_ERROR, {
          description: errorMessage,
        });

        onUploadError?.({
          error: errorMessage,
          code: 'UPLOAD_ERROR',
        });
      } finally {
        updateUploadingState(false);
        setCompressionProgress(0);
      }
    },
    [onUploadSuccess, onUploadError, updateUploadingState, toast]
  );

  /**
   * ファイル選択処理
   */
  const handleFileSelect = useCallback(
    (file: File) => {
      setSelectedFile(file);
      setError(null);

      // プレビュー作成
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);

      // アップロード実行
      uploadFile(file);
    },
    [uploadFile]
  );

  /**
   * ドラッグオーバー
   */
  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  /**
   * ドラッグリーブ
   */
  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  /**
   * ドロップ
   */
  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (disabled || isUploading) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        handleFileSelect(files[0]);
      }
    },
    [disabled, isUploading, handleFileSelect]
  );

  /**
   * ファイル入力変更
   */
  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFileSelect(files[0]);
      }
    },
    [handleFileSelect]
  );

  /**
   * ファイル選択ダイアログを開く
   */
  const openFileDialog = useCallback(() => {
    if (!disabled && !isUploading) {
      fileInputRef.current?.click();
    }
  }, [disabled, isUploading]);

  /**
   * 選択をクリア
   */
  const clearSelection = useCallback(() => {
    setSelectedFile(null);
    setPreview(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  return (
    <div className={`image-upload ${className}`} data-testid="image-upload">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/jpg"
        onChange={handleInputChange}
        className="hidden"
        disabled={disabled || isUploading}
        data-testid="file-input"
      />

      {/* Drop zone */}
      <div
        className={`
          border-2 border-dashed rounded-lg p-8
          transition-colors duration-200
          ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}
          ${disabled || isUploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={openFileDialog}
        data-testid="drop-zone"
      >
        <div className="flex flex-col items-center space-y-4">
          {/* アイコン */}
          {!selectedFile && !isUploading && (
            <>
              <Upload className="w-12 h-12 text-gray-400" />
              <div className="text-center">
                <p className="text-lg font-medium text-gray-700">
                  画像をドラッグ&ドロップ
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  または クリックしてファイルを選択
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  JPEG, PNG (最大5MB)
                </p>
              </div>
            </>
          )}

          {/* プレビュー */}
          {preview && !isUploading && (
            <div className="relative">
              <img
                src={preview}
                alt="Preview"
                className="max-w-xs max-h-64 rounded-lg"
                data-testid="preview-image"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearSelection();
                }}
                className="absolute top-2 right-2 p-1 bg-white rounded-full shadow hover:bg-gray-100"
                data-testid="clear-button"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ローディング */}
          {isUploading && (
            <div className="flex flex-col items-center space-y-2">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
              <div className="w-full max-w-xs space-y-2">
                <p className="text-sm text-gray-600 text-center">
                  {compressionProgress < 100 ? '画像を圧縮中...' : 'アップロード中...'}
                </p>
                {compressionProgress > 0 && compressionProgress < 100 && (
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${compressionProgress}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* エラー */}
          {error && (
            <div
              className="flex items-center space-x-2 text-red-600 bg-red-50 p-3 rounded"
              data-testid="error-message"
            >
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm">{error}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
