/**
 * PDF Preview Component
 * PDFファイルのプレビューとキーワードハイライト機能を提供
 */

'use client'

import { useState, useEffect, FC } from 'react'

import {
  getPreviewUrl,
  getPdfPages,
  getKeywordHighlights,
  type PdfPagesResponse,
  type KeywordHighlightResponse,
} from '@/services/preview-service'

interface PdfPreviewProps {
  bucket: string
  s3Key: string
  keywords?: string[]
  initialPage?: number
  className?: string
}

export const PdfPreview: FC<PdfPreviewProps> = ({
  bucket,
  s3Key,
  keywords = [],
  initialPage = 1,
  className = '',
}) => {
  const [pdfData, setPdfData] = useState<PdfPagesResponse['data'] | null>(null)
  const [highlightData, setHighlightData] = useState<KeywordHighlightResponse['data'] | null>(null)
  const [currentPage, setCurrentPage] = useState(initialPage)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadPdfData()
  }, [bucket, s3Key, keywords])

  const loadPdfData = async () => {
    setIsLoading(true)
    setError(null)

    try {
      // PDFページデータを取得
      const pagesResponse = await getPdfPages(
        bucket,
        s3Key,
        undefined, // startPage
        undefined, // endPage
        keywords.length > 0 ? keywords : undefined
      )

      setPdfData(pagesResponse.data)

      // キーワードが指定されている場合、ハイライト情報を取得
      if (keywords.length > 0) {
        try {
          const highlightsResponse = await getKeywordHighlights(bucket, s3Key, keywords)
          setHighlightData(highlightsResponse.data)

          // 最初にキーワードが見つかったページにジャンプ
          if (highlightsResponse.data.pages.length > 0) {
            setCurrentPage(highlightsResponse.data.pages[0].pageNumber)
          }
        } catch (highlightError) {
          console.warn('Failed to load highlights:', highlightError)
          // ハイライト取得失敗は致命的ではない
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load PDF')
    } finally {
      setIsLoading(false)
    }
  }

  const goToPage = (pageNumber: number) => {
    if (pdfData && pageNumber >= 1 && pageNumber <= pdfData.metadata.totalPages) {
      setCurrentPage(pageNumber)
    }
  }

  const goToNextPage = () => {
    if (pdfData && currentPage < pdfData.metadata.totalPages) {
      setCurrentPage(currentPage + 1)
    }
  }

  const goToPreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1)
    }
  }

  const goToNextKeyword = () => {
    if (!highlightData) return

    // 現在のページより後のページでキーワードが見つかっているページを探す
    const nextPage = highlightData.pages.find((p) => p.pageNumber > currentPage)

    if (nextPage) {
      setCurrentPage(nextPage.pageNumber)
    } else {
      // 見つからない場合は最初のページに戻る
      if (highlightData.pages.length > 0) {
        setCurrentPage(highlightData.pages[0].pageNumber)
      }
    }
  }

  const goToPreviousKeyword = () => {
    if (!highlightData) return

    // 現在のページより前のページでキーワードが見つかっているページを探す
    const previousPages = highlightData.pages.filter((p) => p.pageNumber < currentPage)

    if (previousPages.length > 0) {
      setCurrentPage(previousPages[previousPages.length - 1].pageNumber)
    } else {
      // 見つからない場合は最後のページに移動
      if (highlightData.pages.length > 0) {
        const lastPage = highlightData.pages[highlightData.pages.length - 1]
        setCurrentPage(lastPage.pageNumber)
      }
    }
  }

  const getCurrentPageUrl = () => {
    if (!pdfData) return null

    const pageData = pdfData.pages.find((p) => p.pageNumber === currentPage)
    return pageData?.previewUrl || null
  }

  const getCurrentPageHighlights = () => {
    if (!highlightData) return null

    return highlightData.pages.find((p) => p.pageNumber === currentPage) || null
  }

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">PDFを読み込んでいます...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center text-red-600">
          <svg
            className="mx-auto h-12 w-12 mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <p className="font-semibold mb-2">エラーが発生しました</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    )
  }

  if (!pdfData) {
    return null
  }

  const currentPageUrl = getCurrentPageUrl()
  const currentHighlights = getCurrentPageHighlights()

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* ヘッダー: ファイル情報 */}
      <div className="bg-gray-100 p-4 border-b">
        <h2 className="text-lg font-semibold mb-2">{pdfData.metadata.fileName}</h2>
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>
            ページ: {currentPage} / {pdfData.metadata.totalPages}
          </span>
          <span>サイズ: {formatFileSize(pdfData.metadata.fileSize)}</span>
          {highlightData && (
            <span className="text-blue-600">キーワード: {highlightData.totalMatches}件マッチ</span>
          )}
        </div>
      </div>

      {/* ツールバー: ページナビゲーション */}
      <div className="bg-white p-3 border-b flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPreviousPage}
            disabled={currentPage === 1}
            className="p-2 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="前のページ"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          <input
            type="number"
            value={currentPage}
            onChange={(e) => {
              const page = parseInt(e.target.value)
              if (!isNaN(page)) {
                goToPage(page)
              }
            }}
            min={1}
            max={pdfData.metadata.totalPages}
            className="w-16 px-2 py-1 text-center border rounded"
          />

          <span className="text-gray-600">/ {pdfData.metadata.totalPages}</span>

          <button
            onClick={goToNextPage}
            disabled={currentPage === pdfData.metadata.totalPages}
            className="p-2 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="次のページ"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* キーワードナビゲーション */}
        {highlightData && highlightData.pages.length > 0 && (
          <div className="flex items-center gap-2 border-l pl-4">
            <button
              onClick={goToPreviousKeyword}
              className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              前のキーワード
            </button>
            <button
              onClick={goToNextKeyword}
              className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              次のキーワード
            </button>
          </div>
        )}
      </div>

      {/* PDFビューアー */}
      <div className="flex-1 overflow-auto bg-gray-50">
        {currentPageUrl ? (
          <iframe
            src={currentPageUrl}
            className="w-full h-full border-0"
            title={`Page ${currentPage}`}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            ページを読み込めませんでした
          </div>
        )}
      </div>

      {/* サイドパネル: ハイライト情報 */}
      {currentHighlights && (
        <div className="border-t bg-white p-4 max-h-48 overflow-y-auto">
          <h3 className="font-semibold mb-2">
            このページのキーワード ({currentHighlights.matchCount}件)
          </h3>
          <div className="space-y-2">
            {currentHighlights.snippets.map((snippet, index) => (
              <div key={index} className="text-sm">
                <div className="font-medium text-blue-600 mb-1">{snippet.keyword}</div>
                <div
                  className="text-gray-700"
                  dangerouslySetInnerHTML={{
                    __html: highlightText(snippet.text, snippet.keyword),
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * ファイルサイズを読みやすい形式にフォーマット
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

/**
 * テキスト内のキーワードをハイライト
 */
function highlightText(text: string, keyword: string): string {
  const regex = new RegExp(`(${keyword})`, 'gi')
  return text.replace(regex, '<mark class="bg-yellow-200">$1</mark>')
}
