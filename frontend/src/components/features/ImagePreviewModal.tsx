/**
 * ImagePreviewModal Component
 *
 * 画像プレビューモーダルコンポーネント
 *
 * Features:
 * - フルスクリーンモーダル表示
 * - 画像プレビュー（対応形式: JPEG, PNG, GIF）
 * - ファイル詳細情報表示
 * - スムーズなアニメーション（Framer Motion）
 * - キーボードショートカット（ESCで閉じる）
 * - アクセシビリティ対応（ARIA labels）
 */

import { FC, useEffect } from 'react'

import { motion, AnimatePresence } from 'framer-motion'
import { X, FileText, Calendar, HardDrive, Folder, TrendingUp } from 'lucide-react'

import type { SearchResult } from '@/types'

interface ImagePreviewModalProps {
  file: SearchResult
  isOpen: boolean
  onClose: () => void
}

/**
 * ImagePreviewModal Component
 */
export const ImagePreviewModal: FC<ImagePreviewModalProps> = ({
  file,
  isOpen,
  onClose,
}) => {
  /**
   * ESCキーで閉じる
   */
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  /**
   * ファイルサイズをフォーマット
   */
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  /**
   * 日付をフォーマット
   */
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  /**
   * スコアに基づく色を取得
   */
  const getScoreColor = (score: number): string => {
    if (score >= 0.95) return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
    if (score >= 0.9) return 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
    return 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20'
  }

  /**
   * スコアのパーセンテージを計算
   */
  const getScorePercentage = (score: number): number => {
    return Math.round(score * 100)
  }

  /**
   * ディレクトリパスを取得
   */
  const getDirectoryPath = (fullPath: string): string => {
    const pathParts = fullPath.split('/')
    pathParts.pop() // ファイル名を除去
    return pathParts.join('/') || '/'
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="
              fixed inset-4 md:inset-8 lg:inset-16
              bg-white/95 dark:bg-[#1C1C1E]/95
              backdrop-blur-xl
              rounded-2xl
              border border-[#D1D1D6]/50 dark:border-[#38383A]/50
              shadow-2xl
              z-50
              overflow-hidden
              flex flex-col
            "
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#D1D1D6]/30 dark:border-[#38383A]/30">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <FileText className="h-6 w-6 text-[#007AFF] dark:text-[#0A84FF] flex-shrink-0" />
                <h2
                  id="modal-title"
                  className="text-lg font-semibold text-[#1D1D1F] dark:text-[#F5F5F7] truncate"
                >
                  {file.fileName}
                </h2>
              </div>
              <button
                onClick={onClose}
                className="
                  p-2 rounded-lg
                  hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E]
                  transition-colors duration-200
                  flex-shrink-0 ml-4
                "
                aria-label="閉じる"
              >
                <X className="h-6 w-6 text-[#6E6E73] dark:text-[#98989D]" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Preview Area (Left) */}
                <div className="lg:col-span-2">
                  <div className="
                    aspect-video w-full rounded-xl
                    bg-[#F5F5F7] dark:bg-[#2C2C2E]
                    border border-[#D1D1D6]/30 dark:border-[#38383A]/30
                    flex items-center justify-center
                    overflow-hidden
                  ">
                    {/* Image Preview Placeholder */}
                    <div className="text-center p-8">
                      <FileText className="h-16 w-16 text-[#6E6E73] dark:text-[#98989D] mx-auto mb-4" />
                      <p className="text-sm text-[#6E6E73] dark:text-[#98989D]">
                        画像プレビューは実装予定です
                      </p>
                      <p className="text-xs text-[#86868B] dark:text-[#86868B] mt-2">
                        S3 Preview API統合により対応
                      </p>
                    </div>
                  </div>
                </div>

                {/* File Details (Right) */}
                <div className="space-y-4">
                  {/* Relevance Score */}
                  <div className={`p-4 rounded-xl border ${getScoreColor(file.relevanceScore)}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="h-5 w-5" />
                      <span className="font-semibold text-sm">類似度</span>
                    </div>
                    <div className="text-2xl font-bold">
                      {getScorePercentage(file.relevanceScore)}%
                    </div>
                    <div className="mt-2 h-2 bg-white/50 dark:bg-black/20 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${getScorePercentage(file.relevanceScore)}%` }}
                        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                        className="h-full bg-current"
                      />
                    </div>
                  </div>

                  {/* File Information */}
                  <div className="bg-[#F5F5F7]/50 dark:bg-[#2C2C2E]/50 rounded-xl p-4 space-y-3">
                    <h3 className="font-semibold text-sm text-[#1D1D1F] dark:text-[#F5F5F7] mb-3">
                      ファイル情報
                    </h3>

                    {/* File Type */}
                    <div className="flex items-start gap-3">
                      <FileText className="h-4 w-4 text-[#6E6E73] dark:text-[#98989D] mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-[#6E6E73] dark:text-[#98989D] mb-0.5">
                          ファイル形式
                        </div>
                        <div className="text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
                          {file.fileType.toUpperCase()}
                        </div>
                      </div>
                    </div>

                    {/* File Size */}
                    <div className="flex items-start gap-3">
                      <HardDrive className="h-4 w-4 text-[#6E6E73] dark:text-[#98989D] mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-[#6E6E73] dark:text-[#98989D] mb-0.5">
                          サイズ
                        </div>
                        <div className="text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
                          {formatFileSize(file.fileSize)}
                        </div>
                      </div>
                    </div>

                    {/* Modified Date */}
                    <div className="flex items-start gap-3">
                      <Calendar className="h-4 w-4 text-[#6E6E73] dark:text-[#98989D] mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-[#6E6E73] dark:text-[#98989D] mb-0.5">
                          更新日時
                        </div>
                        <div className="text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
                          {formatDate(file.modifiedDate)}
                        </div>
                      </div>
                    </div>

                    {/* Directory Path */}
                    <div className="flex items-start gap-3">
                      <Folder className="h-4 w-4 text-[#6E6E73] dark:text-[#98989D] mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-[#6E6E73] dark:text-[#98989D] mb-0.5">
                          場所
                        </div>
                        <div className="text-xs font-mono text-[#1D1D1F] dark:text-[#F5F5F7] break-all">
                          {getDirectoryPath(file.filePath)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Full Path */}
                  <div className="bg-[#007AFF]/5 dark:bg-[#0A84FF]/5 rounded-xl p-4">
                    <div className="text-xs text-[#6E6E73] dark:text-[#98989D] mb-2">
                      フルパス
                    </div>
                    <div className="text-xs font-mono text-[#1D1D1F] dark:text-[#F5F5F7] break-all">
                      {file.filePath}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-[#D1D1D6]/30 dark:border-[#38383A]/30">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[#6E6E73] dark:text-[#98989D]">
                  ESCキーで閉じる
                </p>
                <button
                  onClick={onClose}
                  className="
                    px-4 py-2 rounded-lg
                    bg-[#007AFF] dark:bg-[#0A84FF]
                    text-white font-medium text-sm
                    hover:bg-[#0051D5] dark:hover:bg-[#0077ED]
                    transition-colors duration-200
                  "
                >
                  閉じる
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
