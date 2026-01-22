/**
 * PDFプレビューモーダルコンポーネント
 *
 * Lambda API経由でS3 presigned URLを取得してプレビュー表示
 * - 全ページ表示対応
 * - ページナビゲーション
 * - 高解像度プレビュー
 */

'use client'

import { FC, useState, useEffect, useCallback } from 'react'

import {
  XMarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MagnifyingGlassPlusIcon,
  MagnifyingGlassMinusIcon,
  DocumentIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline'
import { motion, AnimatePresence } from 'framer-motion'

// API Gateway URL
const API_URL =
  process.env.NEXT_PUBLIC_API_GATEWAY_URL ||
  'https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search'

interface PreviewPage {
  pageNumber: number
  url: string
  size?: number
}

interface PdfPreviewModalProps {
  isOpen: boolean
  onClose: () => void
  fileId: string
  fileName: string
  filePath: string
  fileType?: string
  s3Key?: string
  keywords?: string[]
}

/**
 * PdfPreviewModal コンポーネント
 */
export const PdfPreviewModal: FC<PdfPreviewModalProps> = ({
  isOpen,
  onClose,
  fileId,
  fileName,
  filePath,
  fileType,
  s3Key,
  keywords = [],
}) => {
  // 状態管理
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [allPages, setAllPages] = useState<PreviewPage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorType, setErrorType] = useState<'not_found' | 'conversion_pending' | 'unknown' | null>(null)
  const [zoomLevel, setZoomLevel] = useState(100)
  const [previewType, setPreviewType] = useState<'images' | 'pdf'>('images')
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)

  /**
   * プレビュー情報を取得
   */
  const fetchPreviewInfo = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setErrorType(null)
    setPdfUrl(null)
    setPreviewType('images')

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'get_preview',
          fileName: fileName,
          fileType: fileType,
          s3Key: s3Key,
          pageNumber: 1,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        // エラータイプを判別
        if (response.status === 404) {
          const isDocuWorks = /\.(xdw|xbd)$/i.test(fileName)
          const isOffice = /\.(docx?|xlsx?|pptx?)$/i.test(fileName)
          if (isDocuWorks) {
            setErrorType('conversion_pending')
            throw new Error('DocuWorks変換済みPDFが見つかりません')
          } else if (isOffice) {
            setErrorType('conversion_pending')
            throw new Error('Officeファイルのプレビューは準備中です')
          } else {
            setErrorType('not_found')
            throw new Error(errorData.message || 'プレビューが見つかりません')
          }
        }
        setErrorType('unknown')
        throw new Error(errorData.message || errorData.error || 'Failed to fetch preview')
      }

      const data = await response.json()

      if (data.success && data.data) {
        // プレビュータイプに応じて処理
        if (data.data.previewType === 'pdf' && data.data.pdfUrl) {
          setPreviewType('pdf')
          setPdfUrl(data.data.pdfUrl)
          setTotalPages(1)
        } else {
          setPreviewType('images')
          setTotalPages(data.data.totalPages || 0)
          setAllPages(data.data.allPages || [])
        }
      } else {
        setErrorType('not_found')
        throw new Error(data.message || data.error || 'Preview not available')
      }
    } catch (err: unknown) {
      console.error('Failed to fetch preview:', err)
      const errorMessage = err instanceof Error ? err.message : 'プレビューの読み込みに失敗しました'
      setError(errorMessage)
      if (!errorType) {
        setErrorType('unknown')
      }
    } finally {
      setIsLoading(false)
    }
  }, [fileName, fileType, s3Key])

  /**
   * 現在のページのURL取得
   */
  const getCurrentPageUrl = useCallback(() => {
    const page = allPages.find((p) => p.pageNumber === currentPage)
    return page?.url || null
  }, [allPages, currentPage])

  /**
   * ページ変更処理
   */
  const handlePageChange = useCallback(
    (newPage: number) => {
      if (newPage < 1 || newPage > totalPages) {
        return
      }
      setCurrentPage(newPage)
    },
    [totalPages]
  )

  /**
   * ズーム処理
   */
  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(prev + 25, 200))
  }

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(prev - 25, 50))
  }

  /**
   * ダウンロード処理
   */
  const handleDownload = async () => {
    const url = getCurrentPageUrl()
    if (!url) return

    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const downloadUrl = URL.createObjectURL(blob)

      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = `${fileName}_page_${currentPage}.jpg`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(downloadUrl)
    } catch (error) {
      console.error('Download failed:', error)
    }
  }

  /**
   * キーボードナビゲーション
   */
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (!isOpen) return

      switch (e.key) {
        case 'ArrowLeft':
          handlePageChange(currentPage - 1)
          break
        case 'ArrowRight':
          handlePageChange(currentPage + 1)
          break
        case 'Escape':
          onClose()
          break
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [isOpen, currentPage, handlePageChange, onClose])

  /**
   * 初回読み込み
   */
  useEffect(() => {
    if (isOpen) {
      setCurrentPage(1)
      setAllPages([])
      setTotalPages(0)
      fetchPreviewInfo()
    }
  }, [isOpen, fetchPreviewInfo])

  const currentPageUrl = getCurrentPageUrl()

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', damping: 25 }}
            className="relative w-full max-w-6xl h-[90vh] bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ヘッダー */}
            <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-6 py-4 bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-md border-b border-[#E5E5EA] dark:border-[#3A3A3C]">
              <div className="flex items-center gap-3">
                <DocumentIcon className="w-6 h-6 text-red-500" />
                <div>
                  <h3 className="text-lg font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                    {fileName}
                  </h3>
                  <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">
                    {totalPages > 0 && `${currentPage} / ${totalPages}ページ`}
                  </p>
                </div>
              </div>

              {/* コントロール */}
              <div className="flex items-center gap-2">
                {/* ズーム */}
                <button
                  onClick={handleZoomOut}
                  className="p-2 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] rounded-lg transition-colors"
                  aria-label="縮小"
                >
                  <MagnifyingGlassMinusIcon className="w-5 h-5 text-[#6E6E73] dark:text-[#8E8E93]" />
                </button>
                <span className="px-2 text-sm text-[#6E6E73] dark:text-[#8E8E93]">
                  {zoomLevel}%
                </span>
                <button
                  onClick={handleZoomIn}
                  className="p-2 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] rounded-lg transition-colors"
                  aria-label="拡大"
                >
                  <MagnifyingGlassPlusIcon className="w-5 h-5 text-[#6E6E73] dark:text-[#8E8E93]" />
                </button>

                <div className="w-px h-6 bg-[#E5E5EA] dark:bg-[#3A3A3C] mx-1" />

                {/* ダウンロード */}
                <button
                  onClick={handleDownload}
                  className="p-2 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] rounded-lg transition-colors"
                  aria-label="ダウンロード"
                  disabled={!currentPageUrl}
                >
                  <ArrowDownTrayIcon className="w-5 h-5 text-[#007AFF] dark:text-[#0A84FF]" />
                </button>

                {/* 閉じる */}
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] rounded-lg transition-colors"
                  aria-label="閉じる"
                >
                  <XMarkIcon className="w-5 h-5 text-[#6E6E73] dark:text-[#8E8E93]" />
                </button>
              </div>
            </div>

            {/* コンテンツエリア */}
            <div className="h-full pt-20 pb-20 overflow-auto">
              {isLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-[#007AFF] border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm text-[#6E6E73] dark:text-[#8E8E93]">
                      プレビューを読み込んでいます...
                    </p>
                  </div>
                </div>
              ) : error ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center max-w-md px-6">
                    {/* エラーアイコン */}
                    <div className="mb-4">
                      <DocumentIcon className="w-16 h-16 mx-auto text-[#8E8E93] dark:text-[#6E6E73]" />
                    </div>

                    {/* エラーメッセージ */}
                    <p className="text-lg font-medium text-[#1D1D1F] dark:text-[#F5F5F7] mb-2">
                      {errorType === 'not_found'
                        ? 'プレビューが見つかりません'
                        : errorType === 'conversion_pending'
                          ? 'プレビュー変換中'
                          : 'プレビューの読み込みに失敗しました'}
                    </p>

                    {/* 詳細説明 */}
                    <p className="text-sm text-[#6E6E73] dark:text-[#8E8E93] mb-6">
                      {errorType === 'not_found'
                        ? 'このファイルのプレビュー画像はまだ生成されていません。しばらく経ってから再度お試しください。'
                        : errorType === 'conversion_pending'
                          ? /\.(xdw|xbd)$/i.test(fileName)
                            ? 'DocuWorksファイルのPDF変換がまだ完了していません。変換には時間がかかる場合があります。'
                            : 'このファイル形式のプレビュー機能は現在準備中です。'
                          : error}
                    </p>

                    {/* アクションボタン */}
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                      <button
                        onClick={fetchPreviewInfo}
                        className="px-6 py-2.5 bg-[#007AFF] text-white rounded-lg hover:bg-[#0056D3] transition-colors font-medium"
                      >
                        再試行
                      </button>
                      {s3Key && (
                        <button
                          onClick={() => {
                            // NASパスをコピー
                            const nasPath = filePath || s3Key
                            navigator.clipboard.writeText(nasPath)
                            alert('ファイルパスをコピーしました')
                          }}
                          className="px-6 py-2.5 bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#1D1D1F] dark:text-[#F5F5F7] rounded-lg hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C] transition-colors font-medium"
                        >
                          パスをコピー
                        </button>
                      )}
                    </div>

                    {/* 追加情報 */}
                    {errorType === 'conversion_pending' && (
                      <p className="text-xs text-[#8E8E93] dark:text-[#6E6E73] mt-4">
                        ファイルを直接開くには、上のパスをコピーしてエクスプローラーで開いてください
                      </p>
                    )}
                  </div>
                </div>
              ) : previewType === 'pdf' && pdfUrl ? (
                // PDFプレビュー（DocuWorks変換済みPDF等）
                <div className="h-full w-full bg-[#F2F2F7] dark:bg-[#2C2C2E]">
                  <iframe
                    src={pdfUrl}
                    className="w-full h-full border-0"
                    title={`${fileName} - PDF Preview`}
                  />
                </div>
              ) : currentPageUrl ? (
                <div className="h-full w-full p-4 bg-[#F2F2F7] dark:bg-[#2C2C2E]">
                  <div
                    className="mx-auto flex justify-center"
                    style={{
                      transform: `scale(${zoomLevel / 100})`,
                      transformOrigin: 'top center',
                    }}
                  >
                    <img
                      src={currentPageUrl}
                      alt={`${fileName} - Page ${currentPage}`}
                      className="max-w-full h-auto shadow-xl rounded-lg bg-white"
                      style={{ maxHeight: '80vh' }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-[#6E6E73] dark:text-[#8E8E93]">プレビューがありません</p>
                </div>
              )}
            </div>

            {/* ページナビゲーション */}
            {totalPages > 1 && (
              <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-center gap-4 px-6 py-4 bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-md border-t border-[#E5E5EA] dark:border-[#3A3A3C]">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="p-2 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="前のページ"
                >
                  <ChevronLeftIcon className="w-5 h-5 text-[#6E6E73] dark:text-[#8E8E93]" />
                </button>

                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={currentPage}
                    onChange={(e) => handlePageChange(parseInt(e.target.value) || 1)}
                    min={1}
                    max={totalPages}
                    className="w-16 px-2 py-1 text-center bg-[#F2F2F7] dark:bg-[#2C2C2E] border border-[#E5E5EA] dark:border-[#3A3A3C] rounded-lg text-sm text-[#1D1D1F] dark:text-[#F5F5F7]"
                  />
                  <span className="text-sm text-[#6E6E73] dark:text-[#8E8E93]">/ {totalPages}</span>
                </div>

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="p-2 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="次のページ"
                >
                  <ChevronRightIcon className="w-5 h-5 text-[#6E6E73] dark:text-[#8E8E93]" />
                </button>
              </div>
            )}

            {/* キーワードハイライト表示 */}
            {keywords.length > 0 && (
              <div className="absolute top-20 right-6 z-10 p-3 bg-[#007AFF]/10 dark:bg-[#0A84FF]/10 rounded-lg">
                <p className="text-xs text-[#007AFF] dark:text-[#0A84FF] font-medium">
                  検索キーワード: {keywords.join(', ')}
                </p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
