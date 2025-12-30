/**
 * ImageSearchResults Component
 *
 * 画像検索結果を表示するコンポーネント
 *
 * Features:
 * - 検索結果のグリッド表示
 * - 類似度スコア表示
 * - ファイル情報（名前、パス、サイズ、更新日）
 * - ホバーエフェクトとアニメーション
 * - レスポンシブデザイン
 * - 画像プレビューモーダル連携
 */

import { FC, useState } from 'react'

import { motion } from 'framer-motion'
import {
  FileText,
  Calendar,
  HardDrive,
  TrendingUp,
  ExternalLink,
  Copy,
  CheckCircle,
} from 'lucide-react'

import { ImagePreviewModal } from '@/components/features/ImagePreviewModal'
import { useToast } from '@/hooks/useToast'
import type { SearchResult } from '@/types'

interface ImageSearchResultsProps {
  results: SearchResult[]
  isLoading?: boolean
  confidenceThreshold?: number
}

/**
 * ImageSearchResults Component
 */
export const ImageSearchResults: FC<ImageSearchResultsProps> = ({
  results,
  isLoading = false,
  confidenceThreshold = 0.9,
}) => {
  const [previewFile, setPreviewFile] = useState<SearchResult | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const toast = useToast()

  /**
   * ファイルパスをクリップボードにコピー
   */
  const copyToClipboard = async (filePath: string, fileId: string) => {
    try {
      await navigator.clipboard.writeText(filePath)
      setCopiedId(fileId)
      toast.success('コピーしました', {
        description: 'ファイルパスをクリップボードにコピーしました',
        duration: 2000,
      })

      setTimeout(() => setCopiedId(null), 2000)
    } catch (error) {
      toast.error('コピーに失敗しました', {
        description: 'クリップボードへのアクセスに失敗しました',
      })
    }
  }

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
    })
  }

  /**
   * スコアに基づく色を取得
   */
  const getScoreColor = (score: number): string => {
    if (score >= 0.95) return 'text-green-600 dark:text-green-400'
    if (score >= 0.9) return 'text-blue-600 dark:text-blue-400'
    return 'text-yellow-600 dark:text-yellow-400'
  }

  /**
   * スコアのパーセンテージを計算
   */
  const getScorePercentage = (score: number): number => {
    return Math.round(score * 100)
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="mt-6"
      >
        {/* Results Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
              検索結果
            </h3>
            <p className="text-sm text-[#6E6E73] dark:text-[#98989D]">
              {results.length}件の類似画像が見つかりました（信頼度
              {confidenceThreshold * 100}%以上）
            </p>
          </div>
        </div>

        {/* Results Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {results.map((result, index) => (
            <motion.div
              key={result.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.3,
                delay: index * 0.05,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="
                group relative
                bg-white/90 dark:bg-[#1C1C1E]/90
                backdrop-blur-xl
                rounded-xl
                border border-[#D1D1D6]/30 dark:border-[#38383A]/30
                hover:border-[#007AFF] dark:hover:border-[#0A84FF]
                transition-all duration-300
                hover:shadow-lg hover:scale-[1.02]
                cursor-pointer
                overflow-hidden
              "
              onClick={() => setPreviewFile(result)}
            >
              {/* Relevance Score Badge */}
              <div className="absolute top-3 right-3 z-10">
                <div
                  className={`
                  flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                  bg-white/95 dark:bg-[#1C1C1E]/95
                  backdrop-blur-xl
                  border border-[#D1D1D6]/50 dark:border-[#38383A]/50
                  shadow-sm
                `}
                >
                  <TrendingUp className={`h-4 w-4 ${getScoreColor(result.relevanceScore)}`} />
                  <span
                    className={`text-xs font-semibold ${getScoreColor(result.relevanceScore)}`}
                  >
                    {getScorePercentage(result.relevanceScore)}%
                  </span>
                </div>
              </div>

              {/* File Type Icon */}
              <div className="p-6 pb-4">
                <div className="h-12 w-12 rounded-xl bg-[#007AFF]/10 dark:bg-[#0A84FF]/10 flex items-center justify-center mb-4">
                  <FileText className="h-6 w-6 text-[#007AFF] dark:text-[#0A84FF]" />
                </div>

                {/* File Name */}
                <h4 className="text-base font-semibold text-[#1D1D1F] dark:text-[#F5F5F7] mb-2 truncate">
                  {result.fileName}
                </h4>

                {/* File Path */}
                <div className="flex items-start gap-2 mb-3">
                  <p className="text-xs text-[#6E6E73] dark:text-[#98989D] line-clamp-2 flex-1">
                    {result.filePath}
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      copyToClipboard(result.filePath, result.id)
                    }}
                    className="
                      flex-shrink-0 p-1.5 rounded-lg
                      hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E]
                      transition-colors duration-200
                    "
                    aria-label="パスをコピー"
                  >
                    {copiedId === result.id ? (
                      <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <Copy className="h-4 w-4 text-[#6E6E73] dark:text-[#98989D]" />
                    )}
                  </button>
                </div>

                {/* File Metadata */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-[#6E6E73] dark:text-[#98989D]" />
                    <span className="text-xs text-[#6E6E73] dark:text-[#98989D]">
                      {formatFileSize(result.fileSize)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-[#6E6E73] dark:text-[#98989D]" />
                    <span className="text-xs text-[#6E6E73] dark:text-[#98989D]">
                      {formatDate(result.modifiedDate)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Hover Action */}
              <div
                className="
                absolute inset-0 bg-gradient-to-t from-black/50 to-transparent
                opacity-0 group-hover:opacity-100
                transition-opacity duration-300
                flex items-end justify-center pb-6
              "
              >
                <div className="flex items-center gap-2 text-white">
                  <ExternalLink className="h-4 w-4" />
                  <span className="text-sm font-medium">プレビュー</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Image Preview Modal */}
      {previewFile && (
        <ImagePreviewModal
          file={previewFile}
          isOpen={!!previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </>
  )
}
