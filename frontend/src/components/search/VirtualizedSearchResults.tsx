/**
 * 仮想スクロール対応検索結果コンポーネント
 *
 * 500万件のファイルを効率的に表示するための仮想スクロール実装
 * @tanstack/react-virtualを使用してメモリ効率を最適化
 */

'use client'

import { FC, useRef, useCallback, useState, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  DocumentIcon,
  FolderIcon,
  PhotoIcon,
  DocumentTextIcon,
  TableCellsIcon,
  PresentationChartBarIcon,
  EyeIcon,
  ArrowDownTrayIcon,
  ClipboardDocumentCheckIcon
} from '@heroicons/react/24/outline'
import { motion, AnimatePresence } from 'framer-motion'
import type { SearchResult } from '@/types'

interface VirtualizedSearchResultsProps {
  results: SearchResult[]
  onPreview: (id: string) => void
  onDownload: (id: string) => void
  viewMode?: 'list' | 'grid' // リストビューまたはグリッドビュー
  className?: string
}

/**
 * VirtualizedSearchResults コンポーネント
 *
 * 機能:
 * - 500万件対応の仮想スクロール
 * - リスト/グリッドビュー切り替え
 * - ファイルアイコン自動選択
 * - パスコピー機能
 * - プレビュー/ダウンロード
 * - パフォーマンス最適化
 */
export const VirtualizedSearchResults: FC<VirtualizedSearchResultsProps> = ({
  results,
  onPreview,
  onDownload,
  viewMode = 'list',
  className = ''
}) => {
  // 仮想化のための親要素ref
  const parentRef = useRef<HTMLDivElement>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // ファイルサイズのフォーマット
  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
  }, [])

  // 日付のフォーマット
  const formatDate = useCallback((dateString: string): string => {
    const date = new Date(dateString)
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - date.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return '今日'
    } else if (diffDays === 1) {
      return '昨日'
    } else if (diffDays < 7) {
      return `${diffDays}日前`
    } else {
      return date.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
    }
  }, [])

  // ファイルアイコン取得
  const getFileIcon = useCallback((fileType: string | undefined) => {
    const iconClass = "w-6 h-6"

    // Null/undefined safety check
    if (!fileType) {
      return <DocumentIcon className={`${iconClass} text-[#6E6E73] dark:text-[#8E8E93]`} />
    }

    switch (fileType.toLowerCase()) {
      case 'pdf':
        return <DocumentIcon className={`${iconClass} text-red-500`} />
      case 'xlsx':
      case 'xls':
        return <TableCellsIcon className={`${iconClass} text-green-600`} />
      case 'docx':
      case 'doc':
        return <DocumentTextIcon className={`${iconClass} text-blue-600`} />
      case 'pptx':
      case 'ppt':
        return <PresentationChartBarIcon className={`${iconClass} text-orange-500`} />
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
      case 'svg':
        return <PhotoIcon className={`${iconClass} text-purple-500`} />
      case 'folder':
        return <FolderIcon className={`${iconClass} text-yellow-500`} />
      default:
        return <DocumentIcon className={`${iconClass} text-[#6E6E73] dark:text-[#8E8E93]`} />
    }
  }, [])

  // パスをクリップボードにコピー
  const copyPath = useCallback(async (path: string, id: string) => {
    try {
      await navigator.clipboard.writeText(path)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000) // 2秒後にリセット
    } catch (error) {
      console.error('Failed to copy path:', error)
    }
  }, [])

  // パスの短縮表示（長いパスの場合）
  const truncatePath = useCallback((path: string | undefined, maxLength: number = 50) => {
    // Nullチェック
    if (!path) return 'パス不明'
    if (path.length <= maxLength) return path

    const parts = path.split('/')
    if (parts.length <= 3) return path

    // 最初と最後の部分を保持
    const start = parts.slice(0, 2).join('/')
    const end = parts.slice(-2).join('/')
    return `${start}/.../${end}`
  }, [])

  // 各行の高さ（viewModeによって変わる）
  const itemHeight = viewMode === 'list' ? 80 : 200

  // TanStack Virtual設定
  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan: 5, // 表示領域外に5アイテム余分にレンダリング
    measureElement:
      typeof window !== 'undefined' && navigator.userAgent.indexOf('Firefox') === -1
        ? (element) => element?.getBoundingClientRect().height
        : undefined,
  })

  // 仮想アイテムのレンダリング
  const renderVirtualItem = useCallback((virtualItem: any) => {
    const result = results[virtualItem.index]

    if (viewMode === 'list') {
      // リストビュー
      return (
        <div
          key={virtualItem.key}
          ref={virtualizer.measureElement}
          data-index={virtualItem.index}
          className={`
            absolute top-0 left-0 w-full
            px-4 py-3
            border-b border-[#E5E5EA] dark:border-[#3A3A3C]
            hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E]
            transition-colors duration-150
          `}
          style={{
            transform: `translateY(${virtualItem.start}px)`,
          }}
        >
          <div className="flex items-center gap-4">
            {/* ファイルアイコン */}
            <div className="flex-shrink-0">
              {getFileIcon(result.fileType)}
            </div>

            {/* ファイル情報 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-[#1D1D1F] dark:text-[#F5F5F7] truncate">
                    {result.fileName}
                  </h4>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93] truncate flex-1">
                      {truncatePath(result.filePath)}
                    </p>
                    <button
                      onClick={() => copyPath(result.filePath, result.id)}
                      className="p-1 hover:bg-[#007AFF]/10 rounded transition-colors"
                      aria-label="パスをコピー"
                    >
                      <ClipboardDocumentCheckIcon
                        className={`w-4 h-4 ${
                          copiedId === result.id
                            ? 'text-green-500'
                            : 'text-[#007AFF] dark:text-[#0A84FF]'
                        }`}
                      />
                    </button>
                  </div>
                  {result.snippet && (
                    <p
                      className="text-xs text-[#6E6E73] dark:text-[#8E8E93] mt-1 line-clamp-2"
                      dangerouslySetInnerHTML={{ __html: result.snippet }}
                    />
                  )}
                </div>

                {/* メタ情報とアクション */}
                <div className="flex items-center gap-4 ml-4">
                  <div className="text-right">
                    <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">
                      {formatFileSize(result.fileSize)}
                    </p>
                    <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93] mt-1">
                      {formatDate(result.modifiedDate)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => onPreview(result.id)}
                      className="p-2 hover:bg-[#007AFF]/10 rounded-lg transition-colors"
                      aria-label="プレビュー"
                    >
                      <EyeIcon className="w-4 h-4 text-[#007AFF] dark:text-[#0A84FF]" />
                    </button>
                    <button
                      onClick={() => onDownload(result.id)}
                      className="p-2 hover:bg-[#007AFF]/10 rounded-lg transition-colors"
                      aria-label="ダウンロード"
                    >
                      <ArrowDownTrayIcon className="w-4 h-4 text-[#007AFF] dark:text-[#0A84FF]" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    } else {
      // グリッドビュー
      return (
        <div
          key={virtualItem.key}
          ref={virtualizer.measureElement}
          data-index={virtualItem.index}
          className={`
            absolute top-0 left-0
            p-4
            border border-[#E5E5EA] dark:border-[#3A3A3C]
            rounded-xl
            bg-white dark:bg-[#1C1C1E]
            hover:shadow-md dark:hover:shadow-lg
            transition-all duration-200
            cursor-pointer
          `}
          style={{
            transform: `translate(${(virtualItem.index % 3) * 33.33}%, ${Math.floor(virtualItem.index / 3) * itemHeight}px)`,
            width: 'calc(33.33% - 16px)',
          }}
        >
          <div className="flex flex-col h-full">
            {/* アイコンとファイル名 */}
            <div className="flex items-start gap-3 mb-3">
              {getFileIcon(result.fileType)}
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-[#1D1D1F] dark:text-[#F5F5F7] line-clamp-2">
                  {result.fileName}
                </h4>
              </div>
            </div>

            {/* パス */}
            <div className="flex items-center gap-1 mb-2">
              <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93] truncate flex-1">
                {truncatePath(result.filePath, 40)}
              </p>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  copyPath(result.filePath, result.id)
                }}
                className="p-1 hover:bg-[#007AFF]/10 rounded"
              >
                <ClipboardDocumentCheckIcon
                  className={`w-3 h-3 ${
                    copiedId === result.id ? 'text-green-500' : 'text-[#007AFF]'
                  }`}
                />
              </button>
            </div>

            {/* スニペット */}
            {result.snippet && (
              <p
                className="text-xs text-[#6E6E73] dark:text-[#8E8E93] line-clamp-3 mb-3 flex-1"
                dangerouslySetInnerHTML={{ __html: result.snippet }}
              />
            )}

            {/* メタ情報とアクション */}
            <div className="flex items-center justify-between mt-auto pt-3 border-t border-[#E5E5EA] dark:border-[#3A3A3C]">
              <div>
                <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">
                  {formatFileSize(result.fileSize)} • {formatDate(result.modifiedDate)}
                </p>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onPreview(result.id)
                  }}
                  className="p-1.5 hover:bg-[#007AFF]/10 rounded-lg"
                >
                  <EyeIcon className="w-4 h-4 text-[#007AFF]" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDownload(result.id)
                  }}
                  className="p-1.5 hover:bg-[#007AFF]/10 rounded-lg"
                >
                  <ArrowDownTrayIcon className="w-4 h-4 text-[#007AFF]" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    }
  }, [results, viewMode, copiedId, getFileIcon, formatFileSize, formatDate, truncatePath, copyPath, onPreview, onDownload, virtualizer])

  // 結果が空の場合
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <FolderIcon className="w-20 h-20 text-[#C7C7CC] dark:text-[#48484A] mb-4" />
        <p className="text-lg font-medium text-[#6E6E73] dark:text-[#8E8E93]">
          検索結果が見つかりませんでした
        </p>
        <p className="text-sm text-[#6E6E73] dark:text-[#8E8E93] mt-2">
          別のキーワードやフィルタで検索してみてください
        </p>
      </div>
    )
  }

  return (
    <div className={`${className}`}>
      {/* 結果数とビュー切り替え */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[#6E6E73] dark:text-[#8E8E93]">
          {results.length.toLocaleString()}件の結果
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => {}} // TODO: viewMode切り替え実装
            className={`p-2 rounded-lg transition-colors ${
              viewMode === 'list'
                ? 'bg-[#007AFF] text-white'
                : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#1D1D1F] dark:text-[#F5F5F7] hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C]'
            }`}
            aria-label="リストビュー"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <button
            onClick={() => {}} // TODO: viewMode切り替え実装
            className={`p-2 rounded-lg transition-colors ${
              viewMode === 'grid'
                ? 'bg-[#007AFF] text-white'
                : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#1D1D1F] dark:text-[#F5F5F7] hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C]'
            }`}
            aria-label="グリッドビュー"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
        </div>
      </div>

      {/* 仮想スクロールコンテナ */}
      <div
        ref={parentRef}
        className="h-[600px] overflow-auto bg-white dark:bg-[#1C1C1E] rounded-xl border border-[#E5E5EA] dark:border-[#3A3A3C]"
        style={{
          contain: 'strict',
        }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {/* 仮想化されたアイテムのレンダリング */}
          {virtualizer.getVirtualItems().map(renderVirtualItem)}
        </div>
      </div>

      {/* パフォーマンス情報（開発時のみ） */}
      {process.env.NODE_ENV === 'development' && (
        <div className="mt-4 p-3 bg-[#F9F9F9] dark:bg-[#2C2C2E] rounded-lg text-xs text-[#6E6E73] dark:text-[#8E8E93]">
          <p>仮想スクロール情報:</p>
          <p>総アイテム数: {results.length.toLocaleString()}</p>
          <p>レンダリング中: {virtualizer.getVirtualItems().length}</p>
          <p>スクロール位置: {Math.round(virtualizer.scrollOffset || 0)}px</p>
        </div>
      )}
    </div>
  )
}