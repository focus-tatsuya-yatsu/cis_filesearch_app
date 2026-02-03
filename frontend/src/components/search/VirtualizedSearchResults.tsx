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
  FolderOpenIcon,
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

import { ProtocolHandlerPrompt } from '@/components/features/ProtocolHandlerPrompt'
import {
  isHandlerMarkedAsInstalled,
  isInstallPromptDismissed,
  isWindowsOS,
} from '@/lib/protocol-handler'
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
 * 許可されたNASサーバーのリスト（セキュリティ対策）
 * カスタムプロトコルでアクセスを許可するサーバーを制限
 */
const ALLOWED_NAS_SERVERS = ['ts-server3', 'ts-server5', 'ts-server6', 'ts-server7']

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

/**
 * S3パスからサーバー名を抽出
 */
const extractServerFromPath = (s3Path: string): string | null => {
  const serverPattern = /(ts-server\d+)/
  const match = s3Path.match(serverPattern)
  return match ? match[1] : null
}

/**
 * 許可されたNASサーバーかどうかを検証（セキュリティ対策）
 */
const isAllowedNASServer = (s3Path: string): boolean => {
  const server = extractServerFromPath(s3Path)
  return server ? ALLOWED_NAS_SERVERS.includes(server) : false
}

/**
 * S3パスをUNCパス形式に変換（カスタムプロトコル用）
 * 例: cis-filesearch-s3-landing/documents/road/ts-server3/H25_JOB/file.pdf
 *   → \\ts-server3\share\H25_JOB\file.pdf
 *
 * NAS構造:
 *   ts-server3 (192.168.1.212) → \\ts-server3\share\ → R:
 *   ts-server5 (192.168.1.214) → \\ts-server5\share\ → U:
 *   ts-server6 (192.168.1.217) → \\ts-server6\share\ → V:
 *   ts-server7 (192.168.1.218) → \\ts-server7\share\ → S:
 */
const convertS3PathToUNCPath = (s3Path: string): string | null => {
  // セキュリティチェック: 許可されたサーバーのみ
  if (!isAllowedNASServer(s3Path)) {
    console.warn('Access to this server is not allowed:', s3Path)
    return null
  }

  // バックスラッシュをスラッシュに変換
  let path = s3Path.replace(/\\/g, '/')

  // s3: プレフィックスを除去
  path = path.replace(/^s3:/, '')

  // 先頭のスラッシュを除去
  path = path.replace(/^\/+/, '')

  // NASサーバー名のパターン
  const serverPattern = /(ts-server\d+)/
  const match = path.match(serverPattern)

  if (match) {
    const serverName = match[1]
    // サーバー名以降の部分を抽出（サーバー名を含む）
    const serverIndex = path.indexOf(serverName)
    const afterServer = path.substring(serverIndex + serverName.length)

    // UNCパス形式（\\server\share\path）で返す - "share" フォルダを追加
    return '\\\\' + serverName + '\\share' + afterServer.replace(/\//g, '\\')
  }

  return null
}

interface VirtualizedSearchResultsProps {
  results: SearchResult[]
  onPreview: (id: string) => void
  onDownload: (id: string) => void
  onResultClick?: (filePath: string) => void // 検索結果クリック時のコールバック
  searchQuery?: string // 検索キーワード（ハイライト用）
  className?: string
}

/**
 * 検索キーワードをハイライト表示
 * @param text ハイライト対象のテキスト
 * @param query 検索クエリ（スペース区切りで複数キーワード対応）
 * @returns ハイライト付きHTML
 */
const highlightKeywords = (text: string, query: string | undefined): string => {
  if (!query || !text) return text

  // スペースで分割してキーワードを取得（空文字を除く）
  const keywords = query.split(/\s+/).filter(k => k.length > 0)
  if (keywords.length === 0) return text

  // 各キーワードをエスケープしてOR条件で結合
  const escapedKeywords = keywords.map(k =>
    k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  )
  const pattern = new RegExp(`(${escapedKeywords.join('|')})`, 'gi')

  // マッチした部分をハイライトタグで囲む
  return text.replace(pattern, '<mark class="bg-yellow-300 dark:bg-yellow-600 px-0.5 rounded">$1</mark>')
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
  searchQuery,
  className = '',
}) => {
  // 仮想化のための親要素ref
  const parentRef = useRef<HTMLDivElement>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // プロトコルハンドラーインストール案内モーダルの状態
  const [showProtocolPrompt, setShowProtocolPrompt] = useState(false)
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null)

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

  // 画像拡張子リスト
  const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp', 'webp', 'tiff', 'tif']

  // 画像ファイルかどうか判定
  const isImageFile = useCallback((fileType: string | undefined, fileName?: string): boolean => {
    // ドットを除去して正規化（.jpg → jpg）
    let type = fileType?.toLowerCase().replace(/^\./, '')

    // fileTypeが画像拡張子でない場合、ファイル名から抽出を試みる
    if ((!type || !IMAGE_EXTENSIONS.includes(type)) && fileName) {
      const ext = fileName.split('.').pop()?.toLowerCase()
      if (ext && ext !== fileName.toLowerCase()) {
        type = ext
      }
    }

    return IMAGE_EXTENSIONS.includes(type || '')
  }, [])

  // 既知のファイル拡張子セット
  const KNOWN_EXTENSIONS = new Set([
    'pdf', 'xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt',
    'jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp', 'webp', 'tiff', 'tif',
    'xdw', 'xbd', 'bfox', 'lnk', 'folder',
    'txt', 'csv', 'zip', 'rar', '7z', 'tar', 'gz',
    'mp3', 'wav', 'mp4', 'avi', 'mov', 'mkv',
    'html', 'htm', 'css', 'js', 'ts', 'json', 'xml',
  ])

  // ファイルアイコン取得（fileTypeまたはfileNameから判定）
  const getFileIcon = useCallback((fileType: string | undefined, fileName?: string) => {
    const iconClass = 'w-6 h-6'

    // fileTypeを正規化（ドット除去、小文字化）
    let type = fileType?.toLowerCase().replace(/^\./, '')

    // fileTypeが既知の拡張子でない場合、ファイル名から拡張子を抽出
    if ((!type || !KNOWN_EXTENSIONS.has(type)) && fileName) {
      const ext = fileName.split('.').pop()?.toLowerCase()
      if (ext && ext !== fileName.toLowerCase() && KNOWN_EXTENSIONS.has(ext)) {
        type = ext
      }
    }

    // それでも不明な場合、ファイル名から強制的に拡張子を取得
    if (!type || !KNOWN_EXTENSIONS.has(type)) {
      if (fileName) {
        const ext = fileName.split('.').pop()?.toLowerCase()
        if (ext && ext !== fileName.toLowerCase()) {
          type = ext
        }
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
      case 'bmp':
      case 'webp':
      case 'tiff':
      case 'tif':
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

  // カスタムプロトコルでNASファイルを開く
  const openFileInExplorer = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation() // 親要素のクリックイベントを防止

    // UNCパスに変換（セキュリティ検証含む）
    const uncPath = convertS3PathToUNCPath(path)
    if (!uncPath) {
      console.error('Cannot open file: invalid or disallowed path')
      alert('このファイルは直接開くことができません。パスをコピーしてエクスプローラーで開いてください。')
      return
    }

    // Windows以外の場合、またはハンドラー未インストールで初回の場合はプロンプトを表示
    if (!isWindowsOS()) {
      // Windows以外の場合はプロンプトを表示（パスコピー案内）
      setPendingFilePath(convertS3PathToNASPath(path))
      setShowProtocolPrompt(true)
      return
    }

    // ハンドラーがインストール済みとしてマークされていない、かつ
    // 「後でインストール」も選択されていない場合はプロンプトを表示
    if (!isHandlerMarkedAsInstalled() && !isInstallPromptDismissed()) {
      setPendingFilePath(convertS3PathToNASPath(path))
      setShowProtocolPrompt(true)
      return
    }

    // カスタムプロトコルでファイルを開く
    // cis-open://プロトコルハンドラーがインストールされている必要あり
    const protocolUrl = `cis-open://${encodeURIComponent(uncPath)}`
    window.location.href = protocolUrl
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
                  <h4
                    className="text-sm font-semibold text-[#1D1D1F] dark:text-[#F5F5F7] truncate"
                    dangerouslySetInnerHTML={{
                      __html: highlightKeywords(
                        result.fileName || extractFileNameFromPath(result.filePath),
                        searchQuery
                      )
                    }}
                  />
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
                      title="プレビュー"
                    >
                      <EyeIcon className="w-4 h-4 text-[#007AFF] dark:text-[#0A84FF]" />
                    </button>
                    <button
                      onClick={(e) => openFileInExplorer(result.filePath, e)}
                      className="p-2 hover:bg-[#34C759]/10 rounded-lg transition-colors"
                      aria-label="ファイルを開く"
                      title="エクスプローラーで開く"
                    >
                      <FolderOpenIcon className="w-4 h-4 text-[#34C759] dark:text-[#30D158]" />
                    </button>
                    <button
                      onClick={() => onDownload(result.id)}
                      className="p-2 hover:bg-[#007AFF]/10 rounded-lg transition-colors"
                      aria-label="ダウンロード"
                      title="ダウンロード"
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
      openFileInExplorer,
      onPreview,
      onDownload,
      onResultClick,
      searchQuery,
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

  // プロンプトを閉じるハンドラー
  const handleCloseProtocolPrompt = useCallback(() => {
    setShowProtocolPrompt(false)
    setPendingFilePath(null)
  }, [])

  // パスコピー時のハンドラー
  const handleCopyPathFromPrompt = useCallback(async () => {
    if (pendingFilePath) {
      try {
        await navigator.clipboard.writeText(pendingFilePath)
      } catch (error) {
        console.error('Failed to copy path:', error)
      }
    }
  }, [pendingFilePath])

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

      {/* プロトコルハンドラーインストール案内モーダル */}
      <ProtocolHandlerPrompt
        isOpen={showProtocolPrompt}
        onClose={handleCloseProtocolPrompt}
        onCopyPath={handleCopyPathFromPrompt}
        filePath={pendingFilePath || undefined}
      />
    </div>
  )
}
