/**
 * 仮想スクロール対応検索結果コンポーネント
 *
 * 500万件のファイルを効率的に表示するための仮想スクロール実装
 * @tanstack/react-virtualを使用してメモリ効率を最適化
 */

'use client'

import { FC, useRef, useCallback, useState, useMemo } from 'react'

import {
  DocumentIcon,
  FolderIcon,
  PhotoIcon,
  DocumentTextIcon,
  DocumentDuplicateIcon,
  TableCellsIcon,
  PresentationChartBarIcon,
  EyeIcon,
  ArrowDownTrayIcon,
  ClipboardDocumentCheckIcon,
} from '@heroicons/react/24/outline'
import { useVirtualizer } from '@tanstack/react-virtual'
import { motion, AnimatePresence } from 'framer-motion'

import type { SearchResult } from '@/types'

/**
 * サーバー名からドライブレターへのマッピング
 * Windowsで直接使用できる形式に変換するため
 */
const SERVER_TO_DRIVE_MAP: Record<string, string> = {
  'ts-server3': 'R:',
  'ts-server5': 'U:',
  'ts-server6': 'V:',
  'ts-server7': 'S:',
}

/**
 * file_pathからファイル名を抽出（fileNameがundefinedの場合のフォールバック）
 */
const extractFileNameFromPath = (filePath: string | undefined): string => {
  if (!filePath) return 'Unknown'
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath || 'Unknown'
}

/**
 * S3パスをWindowsドライブレター形式のパスに変換
 * 例: cis-filesearch-s3-landing/documents/road/ts-server3/H25_JOB/file.pdf
 *   → R:\H25_JOB\file.pdf
 */
const convertS3PathToNASPath = (s3Path: string): string => {
  // バックスラッシュをスラッシュに変換
  let path = s3Path.replace(/\\/g, '/')

  // s3: プレフィックスを除去
  path = path.replace(/^s3:/, '')

  // 先頭のスラッシュを除去
  path = path.replace(/^\/+/, '')

  // NASサーバー名のパターン（ts-server1, ts-server2, ts-server3, ts-server5など）
  const serverPattern = /(ts-server\d+)/
  const match = path.match(serverPattern)

  if (match) {
    const serverName = match[1]
    // サーバー名以降の部分を抽出（サーバー名を除く）
    const serverIndex = path.indexOf(serverName)
    const afterServer = path.substring(serverIndex + serverName.length)

    // ドライブレターにマッピング
    const driveLetter = SERVER_TO_DRIVE_MAP[serverName]
    if (driveLetter) {
      // R:\path\to\file 形式で返す
      return driveLetter + afterServer.replace(/\//g, '\\')
    }

    // マッピングがない場合はUNCパス形式（\\server\path）
    return '\\\\' + serverName + afterServer.replace(/\//g, '\\')
  }

  // サーバー名が見つからない場合は、既知のプレフィックスを除去
  const prefixesToRemove = [
    'cis-filesearch-s3-landing/documents/road/',
    'cis-filesearch-s3-landing/documents/',
    'cis-filesearch-s3-landing/',
  ]

  for (const prefix of prefixesToRemove) {
    if (path.startsWith(prefix)) {
      const remaining = path.substring(prefix.length)
      return remaining.replace(/\//g, '\\')
    }
  }

  // 変換できない場合は元のパスをバックスラッシュ形式で返す
  return path.replace(/\//g, '\\')
}

interface VirtualizedSearchResultsProps {
  results: SearchResult[]
  onPreview: (id: string) => void
  onDownload: (id: string) => void
  onResultClick?: (filePath: string) => void // 検索結果クリック時のコールバック
  className?: string
}

/**
 * VirtualizedSearchResults コンポーネント
 *
 * 機能:
 * - 500万件対応の仮想スクロール
 * - ファイルアイコン自動選択
 * - パスコピー機能
 * - プレビュー/ダウンロード
 * - パフォーマンス最適化
 */
export const VirtualizedSearchResults: FC<VirtualizedSearchResultsProps> = ({
  results,
  onPreview,
  onDownload,
  onResultClick,
  className = '',
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
        day: '2-digit',
      })
    }
  }, [])

  // 画像ファイルかどうか判定
  const isImageFile = useCallback((fileType: string | undefined, fileName?: string): boolean => {
    let type = fileType?.toLowerCase()
    if (!type && fileName) {
      const ext = fileName.split('.').pop()?.toLowerCase()
      if (ext && ext !== fileName.toLowerCase()) {
        type = ext
      }
    }
    return ['jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp', 'webp', 'tiff', 'tif'].includes(type || '')
  }, [])

  // ファイルアイコン取得（fileTypeまたはfileNameから判定）
  const getFileIcon = useCallback((fileType: string | undefined, fileName?: string) => {
    const iconClass = 'w-6 h-6'

    // fileTypeがない場合、fileNameから拡張子を取得
    let type = fileType?.toLowerCase()
    if (!type && fileName) {
      const ext = fileName.split('.').pop()?.toLowerCase()
      if (ext && ext !== fileName.toLowerCase()) {
        type = ext
      }
    }

    // Null/undefined safety check
    if (!type) {
      return <DocumentIcon className={`${iconClass} text-[#6E6E73] dark:text-[#8E8E93]`} />
    }

    switch (type) {
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
      case 'bfox': // CAD形式
        return <DocumentTextIcon className={`${iconClass} text-indigo-500`} />
      case 'xdw': // DocuWorks文書
      case 'xbd': // DocuWorksバインダー
        return <DocumentDuplicateIcon className={`${iconClass} text-indigo-500`} />
      case 'lnk': // ショートカット
        return <DocumentIcon className={`${iconClass} text-gray-400`} />
      case 'folder':
        return <FolderIcon className={`${iconClass} text-yellow-500`} />
      default:
        return <DocumentIcon className={`${iconClass} text-[#6E6E73] dark:text-[#8E8E93]`} />
    }
  }, [])

  // パスをクリップボードにコピー（NAS形式に変換）
  const copyPath = useCallback(async (path: string, id: string) => {
    try {
      // S3パスをNASパス（UNC形式）に変換してコピー
      const nasPath = convertS3PathToNASPath(path)
      await navigator.clipboard.writeText(nasPath)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000) // 2秒後にリセット
    } catch (error) {
      console.error('Failed to copy path:', error)
    }
  }, [])

  // パスの短縮表示（長いパスの場合）- NAS形式で表示
  const truncatePath = useCallback((path: string | undefined, maxLength: number = 50) => {
    // Nullチェック
    if (!path) return 'パス不明'

    // NASパスに変換
    const nasPath = convertS3PathToNASPath(path)

    if (nasPath.length <= maxLength) return nasPath

    const parts = nasPath.split('\\').filter(Boolean)
    if (parts.length <= 3) return nasPath

    // 最初と最後の部分を保持（UNC形式）
    const start = '\\\\' + parts.slice(0, 2).join('\\')
    const end = parts.slice(-2).join('\\')
    return `${start}\\...\\${end}`
  }, [])

  // 各行の高さ
  const itemHeight = 80

  // TanStack Virtual設定
  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan: 10, // 表示領域外に10アイテム余分にレンダリング（スムーズなスクロール）
    paddingEnd: 20, // 下部に余白を追加
  })

  // 仮想アイテムのレンダリング
  const renderVirtualItem = useCallback(
    (virtualItem: any) => {
      const result = results[virtualItem.index]

      return (
        <div
          key={virtualItem.key}
          data-index={virtualItem.index}
          className={`
          absolute top-0 left-0 w-full
          px-4 py-3
          border-b border-[#E5E5EA] dark:border-[#3A3A3C]
          hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E]
          transition-colors duration-150
          cursor-pointer
        `}
          style={{
            height: `${itemHeight}px`,
            transform: `translateY(${virtualItem.start}px)`,
          }}
          onClick={() => onResultClick?.(result.filePath)}
        >
          <div className="flex items-center gap-4">
            {/* ファイルアイコン */}
            <div className="flex-shrink-0">
              {getFileIcon(
                result.fileType,
                result.fileName || extractFileNameFromPath(result.filePath)
              )}
            </div>

            {/* ファイル情報 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-[#1D1D1F] dark:text-[#F5F5F7] truncate">
                    {result.fileName || extractFileNameFromPath(result.filePath)}
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
                  {result.snippet &&
                    !isImageFile(
                      result.fileType,
                      result.fileName || extractFileNameFromPath(result.filePath)
                    ) && (
                      <p
                        className="text-xs text-[#6E6E73] dark:text-[#8E8E93] mt-1 line-clamp-1 max-w-[600px]"
                        dangerouslySetInnerHTML={{ __html: result.snippet.slice(0, 200) }}
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
    },
    [
      results,
      copiedId,
      getFileIcon,
      isImageFile,
      formatFileSize,
      formatDate,
      truncatePath,
      copyPath,
      onPreview,
      onDownload,
      onResultClick,
      itemHeight,
    ]
  )

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
    <div className={`flex flex-col ${className}`}>
      {/* 結果数表示 */}
      <div className="flex-shrink-0 flex items-center justify-between mb-2">
        <p className="text-sm text-[#6E6E73] dark:text-[#8E8E93]">
          {results.length.toLocaleString()}件の結果
        </p>
      </div>

      {/* 仮想スクロールコンテナ */}
      <div
        ref={parentRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-white dark:bg-[#1C1C1E] rounded-xl border border-[#E5E5EA] dark:border-[#3A3A3C]"
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
    </div>
  )
}
