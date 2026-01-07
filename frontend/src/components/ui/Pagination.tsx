'use client'

import { FC, useCallback, useMemo } from 'react'

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, AlertCircle } from 'lucide-react'

/**
 * OpenSearchの制限に基づくページング制限
 * max_result_window (default: 10,000) を考慮
 */
const MAX_RESULT_WINDOW = 10000

interface PaginationProps {
  currentPage: number
  totalPages: number
  totalItems: number
  itemsPerPage: number
  onPageChange: (page: number) => void
  className?: string
}

/**
 * Pagination Component
 *
 * Apple Design System inspired pagination with:
 * - First/Last page buttons
 * - Previous/Next buttons
 * - Page number display
 * - Smooth transitions
 */
export const Pagination: FC<PaginationProps> = ({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
  className = '',
}) => {
  // OpenSearchの制限を考慮した最大ページ数を計算
  const maxAccessiblePage = useMemo(
    () =>
      // from + size <= MAX_RESULT_WINDOW を満たす最大ページ
      // from = (page - 1) * itemsPerPage
      // (page - 1) * itemsPerPage + itemsPerPage <= MAX_RESULT_WINDOW
      // page <= MAX_RESULT_WINDOW / itemsPerPage
      Math.floor(MAX_RESULT_WINDOW / itemsPerPage),
    [itemsPerPage]
  )

  // 実際にアクセス可能なページ数（totalPagesとmaxAccessiblePageの小さい方）
  const effectiveTotalPages = useMemo(
    () => Math.min(totalPages, maxAccessiblePage),
    [totalPages, maxAccessiblePage]
  )

  // ページング制限に達しているかどうか
  const isLimitReached = totalPages > maxAccessiblePage

  const startItem = (currentPage - 1) * itemsPerPage + 1
  const endItem = Math.min(currentPage * itemsPerPage, totalItems)

  const handleFirst = useCallback(() => {
    if (currentPage > 1) onPageChange(1)
  }, [currentPage, onPageChange])

  const handlePrevious = useCallback(() => {
    if (currentPage > 1) onPageChange(currentPage - 1)
  }, [currentPage, onPageChange])

  const handleNext = useCallback(() => {
    if (currentPage < effectiveTotalPages) onPageChange(currentPage + 1)
  }, [currentPage, effectiveTotalPages, onPageChange])

  const handleLast = useCallback(() => {
    if (currentPage < effectiveTotalPages) onPageChange(effectiveTotalPages)
  }, [currentPage, effectiveTotalPages, onPageChange])

  // Generate page numbers to show (effectiveTotalPagesを使用)
  const getPageNumbers = () => {
    const pages: (number | string)[] = []
    const maxVisible = 5

    if (effectiveTotalPages <= maxVisible) {
      for (let i = 1; i <= effectiveTotalPages; i++) pages.push(i)
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i)
        pages.push('...')
        pages.push(effectiveTotalPages)
      } else if (currentPage >= effectiveTotalPages - 2) {
        pages.push(1)
        pages.push('...')
        for (let i = effectiveTotalPages - 3; i <= effectiveTotalPages; i++) pages.push(i)
      } else {
        pages.push(1)
        pages.push('...')
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i)
        pages.push('...')
        pages.push(effectiveTotalPages)
      }
    }

    return pages
  }

  if (effectiveTotalPages <= 1) return null

  return (
    <div className={`flex flex-col gap-2 px-4 py-3 ${className}`}>
      {/* ページング制限警告 */}
      {isLimitReached && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-300">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>
            検索結果が{totalItems.toLocaleString()}件あります。最初の
            {(maxAccessiblePage * itemsPerPage).toLocaleString()}
            件まで表示可能です。検索条件を絞り込むことで、より多くの結果にアクセスできます。
          </span>
        </div>
      )}

      <div className="flex items-center justify-between">
        {/* Items info */}
        <div className="text-sm text-[#6E6E73] dark:text-[#8E8E93]">
          <span className="font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
            {startItem.toLocaleString()} - {endItem.toLocaleString()}
          </span>{' '}
          / {totalItems.toLocaleString()}件
          {isLimitReached && (
            <span className="text-amber-600 dark:text-amber-400 ml-1">
              (表示可能: {(maxAccessiblePage * itemsPerPage).toLocaleString()}件)
            </span>
          )}
        </div>

        {/* Pagination controls */}
        <div className="flex items-center gap-1">
          {/* First page */}
          <button
            onClick={handleFirst}
            disabled={currentPage === 1}
            className="p-2 rounded-lg transition-all duration-200
                     hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E]
                     disabled:opacity-30 disabled:cursor-not-allowed
                     text-[#1D1D1F] dark:text-[#F5F5F7]"
            aria-label="最初のページ"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>

          {/* Previous page */}
          <button
            onClick={handlePrevious}
            disabled={currentPage === 1}
            className="p-2 rounded-lg transition-all duration-200
                     hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E]
                     disabled:opacity-30 disabled:cursor-not-allowed
                     text-[#1D1D1F] dark:text-[#F5F5F7]"
            aria-label="前のページ"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Page numbers */}
          <div className="flex items-center gap-1 mx-2">
            {getPageNumbers().map((page, index) => (
              <button
                key={index}
                onClick={() => typeof page === 'number' && onPageChange(page)}
                disabled={page === '...'}
                className={`
                min-w-[36px] h-9 px-3 rounded-lg text-sm font-medium
                transition-all duration-200
                ${
                  page === currentPage
                    ? 'bg-[#007AFF] dark:bg-[#0A84FF] text-white'
                    : page === '...'
                      ? 'cursor-default text-[#6E6E73] dark:text-[#8E8E93]'
                      : 'hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E] text-[#1D1D1F] dark:text-[#F5F5F7]'
                }
              `}
              >
                {page}
              </button>
            ))}
          </div>

          {/* Next page */}
          <button
            onClick={handleNext}
            disabled={currentPage === effectiveTotalPages}
            className="p-2 rounded-lg transition-all duration-200
                     hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E]
                     disabled:opacity-30 disabled:cursor-not-allowed
                     text-[#1D1D1F] dark:text-[#F5F5F7]"
            aria-label="次のページ"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Last page */}
          <button
            onClick={handleLast}
            disabled={currentPage === effectiveTotalPages}
            className="p-2 rounded-lg transition-all duration-200
                     hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E]
                     disabled:opacity-30 disabled:cursor-not-allowed
                     text-[#1D1D1F] dark:text-[#F5F5F7]"
            aria-label="最後のページ"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
