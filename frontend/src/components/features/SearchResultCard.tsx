import { FC, useState } from 'react'
import { FileText, Copy, Eye, Download, Folder, Calendar, HardDrive } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui'

interface SearchResult {
  id: string
  fileName: string
  filePath: string
  fileType: string
  fileSize: number
  modifiedDate: string
  snippet: string
  relevanceScore: number
}

interface SearchResultCardProps {
  result: SearchResult
  onPreview?: (id: string) => void
  onDownload?: (id: string) => void
}

export const SearchResultCard: FC<SearchResultCardProps> = ({
  result,
  onPreview,
  onDownload,
}) => {
  const [copied, setCopied] = useState(false)

  const formatFileSize = (bytes: number): string => {
    const sizes = ['B', 'KB', 'MB', 'GB']
    if (bytes === 0) return '0 B'
    const i = Math.floor(Math.log(bytes) / Math.log(1024))
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i]
  }

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(result.filePath)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy path:', err)
    }
  }

  const getFileIcon = (fileType: string) => {
    switch (fileType.toLowerCase()) {
      case 'pdf':
        return <FileText className="h-5 w-5 text-red-500" />
      case 'docx':
      case 'doc':
        return <FileText className="h-5 w-5 text-blue-500" />
      case 'xlsx':
      case 'xls':
        return <FileText className="h-5 w-5 text-green-500" />
      default:
        return <FileText className="h-5 w-5 text-gray-500" />
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl rounded-2xl border border-[#D1D1D6]/30 dark:border-[#38383A]/30 p-5 hover:shadow-lg dark:hover:shadow-2xl transition-all duration-300"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3 flex-1">
          {getFileIcon(result.fileType)}
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-[#1D1D1F] dark:text-[#F5F5F7] truncate">{result.fileName}</h3>
            <div className="flex items-center gap-2 mt-1 text-sm text-[#6E6E73] dark:text-[#8E8E93]">
              <Folder className="h-3.5 w-3.5" />
              <span className="truncate flex-1">{result.filePath}</span>
              <button
                onClick={handleCopyPath}
                className="p-1 hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E] rounded-lg transition-colors"
                title="パスをコピー"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              {copied && (
                <span className="text-xs text-[#34C759] dark:text-[#32D74B] font-medium">コピーしました！</span>
              )}
            </div>
          </div>
        </div>
        <div className="text-sm font-medium bg-gradient-to-br from-[#007AFF] to-[#0051D5] dark:from-[#0A84FF] dark:to-[#0066FF] bg-clip-text text-transparent">
          関連度: {Math.round(result.relevanceScore * 100)}%
        </div>
      </div>

      {/* ファイル詳細情報 */}
      <div className="flex items-center gap-4 text-sm text-[#6E6E73] dark:text-[#8E8E93] mb-3">
        <div className="flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5" />
          <span>{formatDate(result.modifiedDate)}</span>
        </div>
        <div className="flex items-center gap-1">
          <HardDrive className="h-3.5 w-3.5" />
          <span>{formatFileSize(result.fileSize)}</span>
        </div>
        <div className="px-2 py-0.5 bg-[#F5F5F7] dark:bg-[#2C2C2E] rounded-lg text-xs font-medium uppercase">
          {result.fileType}
        </div>
      </div>

      {/* スニペット */}
      {result.snippet && (
        <div className="bg-[#F5F5F7] dark:bg-[#2C2C2E] rounded-xl p-3 mb-3">
          <p className="text-sm text-[#424245] dark:text-[#C7C7CC] line-clamp-2">{result.snippet}</p>
        </div>
      )}

      {/* アクションボタン */}
      <div className="flex items-center gap-2">
        {onPreview && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPreview(result.id)}
            icon={<Eye className="h-4 w-4" />}
          >
            プレビュー
          </Button>
        )}
        {onDownload && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDownload(result.id)}
            icon={<Download className="h-4 w-4" />}
          >
            ダウンロード
          </Button>
        )}
      </div>
    </motion.div>
  )
}