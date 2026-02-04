/**
 * Download Button Component
 *
 * CIS-FileHandler-Setupなどのファイルをダウンロードするためのボタン
 * Apple Design Philosophyに基づいたミニマルなデザイン
 */

'use client'

import { FC, useState, useCallback } from 'react'
import { Download, CheckCircle } from 'lucide-react'

// ========================================
// Types
// ========================================

interface DownloadButtonProps {
  /** ダウンロードURL */
  href: string
  /** ダウンロード時のファイル名 */
  fileName?: string
  /** ボタンラベル */
  label?: string
  /** デスクトップでのみラベルを表示 */
  labelVisibleOnDesktop?: boolean
  /** カスタムクラス */
  className?: string
}

// ========================================
// Component
// ========================================

export const DownloadButton: FC<DownloadButtonProps> = ({
  href,
  fileName = 'CIS-FileHandler-Setup',
  label = 'ダウンロード',
  labelVisibleOnDesktop = true,
  className = '',
}) => {
  const [downloadState, setDownloadState] = useState<'idle' | 'downloading' | 'complete'>('idle')

  const handleDownload = useCallback(() => {
    setDownloadState('downloading')

    // ダウンロード開始のフィードバック
    setTimeout(() => {
      setDownloadState('complete')
      // 成功状態表示後にリセット
      setTimeout(() => setDownloadState('idle'), 2000)
    }, 500)
  }, [])

  const isComplete = downloadState === 'complete'

  return (
    <a
      href={href}
      download={fileName}
      onClick={handleDownload}
      className={`
        group
        inline-flex items-center justify-center
        gap-2
        px-3 py-2
        rounded-lg
        font-medium text-sm
        tracking-tight
        transition-all duration-200
        ease-[cubic-bezier(0.22,1,0.36,1)]

        /* Default State */
        text-[#6E6E73] dark:text-[#8E8E93]
        bg-transparent

        /* Hover State */
        hover:text-[#1D1D1F] dark:hover:text-[#F5F5F7]
        hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E]
        hover:scale-[1.02]

        /* Active State */
        active:scale-[0.98]
        active:bg-[#E8E8ED] dark:active:bg-[#3A3A3C]

        /* Focus State */
        focus:outline-none
        focus-visible:ring-2
        focus-visible:ring-[#007AFF] dark:focus-visible:ring-[#0A84FF]
        focus-visible:ring-offset-2
        focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#1C1C1E]

        ${className}
      `}
      aria-label={`${fileName}をダウンロード`}
      role="button"
    >
      {/* アイコン（状態に応じて切り替え） */}
      <span className="relative w-5 h-5">
        <Download
          className={`
            absolute inset-0
            w-5 h-5
            transition-all duration-200
            ${isComplete ? 'opacity-0 scale-75' : 'opacity-100 scale-100'}
          `}
          aria-hidden="true"
        />
        <CheckCircle
          className={`
            absolute inset-0
            w-5 h-5
            text-[#34C759] dark:text-[#30D158]
            transition-all duration-200
            ${isComplete ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}
          `}
          aria-hidden="true"
        />
      </span>

      {/* ラベル - モバイルでは非表示、デスクトップでは表示 */}
      {labelVisibleOnDesktop && (
        <span className="hidden sm:inline">
          {isComplete ? '完了' : label}
        </span>
      )}

      {/* スクリーンリーダー用テキスト */}
      <span className="sr-only">
        {isComplete
          ? `${fileName}のダウンロードを開始しました`
          : `${fileName}のセットアップファイルをダウンロード`
        }
      </span>
    </a>
  )
}
