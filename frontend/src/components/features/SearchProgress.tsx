/**
 * SearchProgress Component
 *
 * 検索進捗を表示するコンポーネント
 *
 * Features:
 * - プログレスバー表示
 * - スムーズなアニメーション
 * - パーセンテージ表示
 * - ステータスメッセージ
 * - ガラスモーフィズムデザイン
 */

import { FC } from 'react'

import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'

interface SearchProgressProps {
  /**
   * 進捗率（0-100）
   */
  progress: number

  /**
   * ステータスメッセージ（オプション）
   */
  message?: string

  /**
   * カスタムクラス名
   */
  className?: string
}

/**
 * SearchProgress Component
 *
 * 検索の進捗状況を視覚的に表示
 */
export const SearchProgress: FC<SearchProgressProps> = ({
  progress,
  message,
  className = '',
}) => {
  /**
   * 進捗に応じたステータスメッセージを取得
   */
  const getDefaultMessage = (): string => {
    if (progress < 30) return '画像を処理中...'
    if (progress < 60) return 'ベクトル化処理中...'
    if (progress < 90) return '類似画像を検索中...'
    if (progress < 100) return '結果を整理中...'
    return '完了しました'
  }

  const displayMessage = message || getDefaultMessage()

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={`
        mt-4
        bg-white/90 dark:bg-[#1C1C1E]/90
        backdrop-blur-xl
        rounded-xl
        border border-[#D1D1D6]/30 dark:border-[#38383A]/30
        p-4
        shadow-sm
        ${className}
      `}
    >
      {/* Progress Info */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 text-[#007AFF] dark:text-[#0A84FF] animate-spin" />
          <span className="text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
            {displayMessage}
          </span>
        </div>
        <span className="text-sm font-semibold text-[#007AFF] dark:text-[#0A84FF]">
          {Math.round(progress)}%
        </span>
      </div>

      {/* Progress Bar */}
      <div className="relative h-2 bg-[#F5F5F7] dark:bg-[#2C2C2E] rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="
            absolute inset-y-0 left-0
            bg-gradient-to-r from-[#007AFF] to-[#0051D5]
            dark:from-[#0A84FF] dark:to-[#0077ED]
            rounded-full
          "
        >
          {/* Shimmer Effect */}
          <motion.div
            animate={{
              x: ['0%', '100%'],
            }}
            transition={{
              duration: 1,
              repeat: Infinity,
              ease: 'linear',
            }}
            className="
              absolute inset-0
              bg-gradient-to-r from-transparent via-white/30 to-transparent
            "
          />
        </motion.div>
      </div>

      {/* Progress Steps */}
      <div className="mt-3 flex items-center justify-between text-xs text-[#86868B] dark:text-[#86868B]">
        <span className={progress >= 30 ? 'text-[#007AFF] dark:text-[#0A84FF]' : ''}>
          処理開始
        </span>
        <span className={progress >= 60 ? 'text-[#007AFF] dark:text-[#0A84FF]' : ''}>
          ベクトル化
        </span>
        <span className={progress >= 90 ? 'text-[#007AFF] dark:text-[#0A84FF]' : ''}>
          検索実行
        </span>
        <span className={progress >= 100 ? 'text-[#007AFF] dark:text-[#0A84FF]' : ''}>
          完了
        </span>
      </div>
    </motion.div>
  )
}
