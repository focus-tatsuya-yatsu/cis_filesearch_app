/**
 * ImageSearchDropdown Component
 *
 * 画像検索用のドロップダウンコンポーネント
 *
 * Features:
 * - ドラッグ&ドロップでの画像アップロード
 * - ファイル選択ダイアログによるアップロード
 * - 画像プレビュー表示
 * - バリデーション（ファイルサイズ、ファイルタイプ）
 * - スムーズなアニメーション
 * - エラーハンドリング
 */

import { FC, useState, useRef, DragEvent, ChangeEvent } from 'react'

import { motion, AnimatePresence } from 'framer-motion'
import { Image as ImageIcon, Upload, X, AlertCircle } from 'lucide-react'

import {
  validateImageFile,
  createImagePreviewUrl,
  revokeImagePreviewUrl,
} from '@/lib/api/imageSearch'

interface ImageSearchDropdownProps {
  isOpen: boolean
  onClose: () => void
  onImageSelect: (file: File, previewUrl: string) => void
  isUploading?: boolean
  error?: string | null
}

/**
 * ImageSearchDropdown Component
 *
 * 画像をアップロードして検索するためのUI
 */
export const ImageSearchDropdown: FC<ImageSearchDropdownProps> = ({
  isOpen,
  onClose,
  onImageSelect,
  isUploading = false,
  error = null,
}) => {
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /**
   * ファイルを処理
   */
  const handleFile = (file: File) => {
    // バリデーション
    const validation = validateImageFile(file)
    if (!validation.isValid) {
      setValidationError(validation.error || '無効なファイルです')
      return
    }

    // 以前のプレビューURLをクリーンアップ
    if (previewUrl) {
      revokeImagePreviewUrl(previewUrl)
    }

    // プレビューURL作成
    const newPreviewUrl = createImagePreviewUrl(file)

    setSelectedFile(file)
    setPreviewUrl(newPreviewUrl)
    setValidationError(null)

    // 親コンポーネントに通知
    onImageSelect(file, newPreviewUrl)
  }

  /**
   * ドラッグオーバーハンドラ
   */
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  /**
   * ドラッグリーブハンドラ
   */
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  /**
   * ドロップハンドラ
   */
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const { files } = e.dataTransfer
    if (files && files.length > 0) {
      handleFile(files[0])
    }
  }

  /**
   * ファイル選択ハンドラ
   */
  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const { files } = e.target
    if (files && files.length > 0) {
      handleFile(files[0])
    }
  }

  /**
   * ファイル選択ダイアログを開く
   */
  const openFileDialog = () => {
    fileInputRef.current?.click()
  }

  /**
   * 選択をクリア
   */
  const handleClear = () => {
    if (previewUrl) {
      revokeImagePreviewUrl(previewUrl)
    }
    setSelectedFile(null)
    setPreviewUrl(null)
    setValidationError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  /**
   * クローズハンドラ
   */
  const handleClose = () => {
    handleClear()
    onClose()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div className="bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl rounded-2xl border border-[#D1D1D6]/30 dark:border-[#38383A]/30 p-6 shadow-lg">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5 text-[#007AFF] dark:text-[#0A84FF]" />
                <h3 className="text-lg font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                  画像で検索
                </h3>
              </div>
              <button
                onClick={handleClose}
                disabled={isUploading}
                aria-label="閉じる"
                className="p-2 hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E] rounded-lg transition-colors duration-200 disabled:opacity-50"
              >
                <X className="h-5 w-5 text-[#6E6E73] dark:text-[#98989D]" />
              </button>
            </div>

            {/* Drop Zone */}
            {!previewUrl && (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={openFileDialog}
                className={`
                  relative border-2 border-dashed rounded-xl p-8
                  transition-all duration-300 cursor-pointer
                  ${
                    isDragging
                      ? 'border-[#007AFF] dark:border-[#0A84FF] bg-[#007AFF]/5 dark:bg-[#0A84FF]/5'
                      : 'border-[#D1D1D6] dark:border-[#38383A] hover:border-[#007AFF] dark:hover:border-[#0A84FF] hover:bg-[#F5F5F7]/50 dark:hover:bg-[#2C2C2E]/50'
                  }
                  ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/jpg"
                  onChange={handleFileSelect}
                  disabled={isUploading}
                  className="hidden"
                  aria-label="画像ファイルを選択"
                />

                <div className="flex flex-col items-center justify-center gap-4">
                  <div
                    className={`
                    w-16 h-16 rounded-full flex items-center justify-center
                    ${
                      isDragging
                        ? 'bg-[#007AFF] dark:bg-[#0A84FF]'
                        : 'bg-[#F5F5F7] dark:bg-[#2C2C2E]'
                    }
                    transition-colors duration-300
                  `}
                  >
                    <Upload
                      className={`h-8 w-8 ${
                        isDragging ? 'text-white' : 'text-[#6E6E73] dark:text-[#98989D]'
                      }`}
                    />
                  </div>

                  <div className="text-center">
                    <p className="text-base font-medium text-[#1D1D1F] dark:text-[#F5F5F7] mb-1">
                      {isDragging ? 'ここにドロップしてください' : '画像をドラッグ&ドロップ'}
                    </p>
                    <p className="text-sm text-[#6E6E73] dark:text-[#98989D]">
                      または{' '}
                      <span className="text-[#007AFF] dark:text-[#0A84FF] font-medium">
                        クリックして選択
                      </span>
                    </p>
                  </div>

                  <p className="text-xs text-[#86868B] dark:text-[#86868B]">
                    JPEG、PNG形式 / 最大5MB
                  </p>
                </div>
              </div>
            )}

            {/* Preview */}
            {previewUrl && selectedFile && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2 }}
                className="relative"
              >
                <div className="relative rounded-xl overflow-hidden border border-[#D1D1D6] dark:border-[#38383A]">
                  <img
                    src={previewUrl}
                    alt="Selected preview"
                    className="w-full h-48 object-contain bg-[#F5F5F7] dark:bg-[#1C1C1E]"
                  />

                  {/* Loading Overlay */}
                  {isUploading && (
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="h-10 w-10 border-4 border-white border-t-transparent rounded-full animate-spin" />
                        <p className="text-white font-medium">処理中...</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* File Info */}
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7] truncate">
                      {selectedFile.name}
                    </p>
                    <p className="text-xs text-[#6E6E73] dark:text-[#98989D]">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>

                  {!isUploading && (
                    <button
                      onClick={handleClear}
                      className="ml-3 p-2 hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E] rounded-lg transition-colors duration-200"
                      aria-label="選択をクリア"
                    >
                      <X className="h-5 w-5 text-[#6E6E73] dark:text-[#98989D]" />
                    </button>
                  )}
                </div>
              </motion.div>
            )}

            {/* Error Messages */}
            {(validationError || error) && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3"
              >
                <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-800 dark:text-red-200">{validationError || error}</p>
              </motion.div>
            )}

            {/* Help Text */}
            {!previewUrl && !validationError && !error && (
              <div className="mt-4 p-3 bg-[#007AFF]/5 dark:bg-[#0A84FF]/5 rounded-lg">
                <p className="text-xs text-[#6E6E73] dark:text-[#98989D]">
                  💡 画像をアップロードすると、類似した画像ファイルを検索できます。
                </p>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
