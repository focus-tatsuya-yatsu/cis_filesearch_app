import { FC } from 'react'

import { motion, AnimatePresence } from 'framer-motion'
import { Clock, X, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui'
import type { SearchHistoryItem } from '@/types'

interface SearchHistoryProps {
  history: SearchHistoryItem[]
  onSelectHistory: (query: string) => void
  onClearItem: (id: string) => void
  onClearAll: () => void
}

/**
 * SearchHistory Component
 *
 * Displays recent search queries with click-to-search functionality
 *
 * Features:
 * - Shows last 10 searches
 * - Click to re-execute search
 * - Delete individual items
 * - Clear all history
 * - Smooth animations with Framer Motion
 * - Empty state handling
 *
 * @example
 * ```tsx
 * <SearchHistory
 *   history={searchHistory}
 *   onSelectHistory={(query) => handleSearch(query)}
 *   onClearItem={removeHistoryItem}
 *   onClearAll={clearHistory}
 * />
 * ```
 */
export const SearchHistory: FC<SearchHistoryProps> = ({
  history,
  onSelectHistory,
  onClearItem,
  onClearAll,
}) => {
  // Empty state
  if (history.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
        className="bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl rounded-2xl shadow-sm border border-[#D1D1D6]/30 dark:border-[#38383A]/30 p-6"
      >
        <div className="text-center">
          <Clock className="h-12 w-12 mx-auto mb-3 text-[#C7C7CC] dark:text-[#48484A]" />
          <p className="text-sm text-[#6E6E73] dark:text-[#8E8E93]">検索履歴はありません</p>
          <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93] mt-1">
            検索を実行すると、ここに履歴が表示されます
          </p>
        </div>
      </motion.div>
    )
  }

  /**
   * Format timestamp to readable date
   */
  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'たった今'
    if (diffMins < 60) return `${diffMins}分前`
    if (diffHours < 24) return `${diffHours}時間前`
    if (diffDays < 7) return `${diffDays}日前`

    return date.toLocaleDateString('ja-JP', {
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
      className="bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl rounded-2xl shadow-sm border border-[#D1D1D6]/30 dark:border-[#38383A]/30 overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#D1D1D6]/30 dark:border-[#38383A]/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-[#6E6E73] dark:text-[#8E8E93]" />
          <h3 className="font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">最近の検索</h3>
          <span className="text-xs text-[#6E6E73] dark:text-[#8E8E93] ml-1">
            ({history.length})
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearAll}
          className="text-[#FF3B30] dark:text-[#FF453A] hover:bg-[#FF3B30]/10 dark:hover:bg-[#FF453A]/10 flex items-center gap-1"
          aria-label="すべての履歴を削除"
        >
          <Trash2 className="h-4 w-4" />
          すべて削除
        </Button>
      </div>

      {/* History List */}
      <div className="max-h-[400px] overflow-y-auto">
        <AnimatePresence mode="popLayout">
          {history.map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2, delay: index * 0.03 }}
              className="group relative border-b border-[#D1D1D6]/30 dark:border-[#38383A]/30 last:border-b-0"
            >
              {/* Clickable Area */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => onSelectHistory(item.query)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelectHistory(item.query)
                  }
                }}
                className="w-full px-5 py-3 cursor-pointer hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E] transition-colors duration-200 flex items-center justify-between gap-3 focus:outline-none focus:ring-2 focus:ring-[#007AFF] dark:focus:ring-[#0A84FF] focus:ring-inset"
                aria-label={`"${item.query}"を再検索`}
              >
                <div className="flex-1 min-w-0">
                  {/* Query */}
                  <p className="text-[#1D1D1F] dark:text-[#F5F5F7] font-medium truncate group-hover:text-[#007AFF] dark:group-hover:text-[#0A84FF] transition-colors">
                    {item.query}
                  </p>
                  {/* Metadata */}
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">
                      {formatDate(item.timestamp)}
                    </span>
                    {item.resultCount !== undefined && (
                      <>
                        <span className="text-xs text-[#D1D1D6] dark:text-[#38383A]">•</span>
                        <span className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">
                          {item.resultCount}件の結果
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Delete Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onClearItem(item.id)
                  }}
                  className="p-2 rounded-full hover:bg-[#E5E5EA] dark:hover:bg-[#38383A] transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-[#FF3B30] dark:focus:ring-[#FF453A]"
                  aria-label={`"${item.query}"を履歴から削除`}
                >
                  <X className="h-4 w-4 text-[#6E6E73] dark:text-[#8E8E93]" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
