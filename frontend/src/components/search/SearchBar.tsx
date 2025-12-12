import { FC, useState, FormEvent } from 'react'

import { Search, X } from 'lucide-react'

import { Button } from '@/components/ui'

interface SearchBarProps {
  onSearch: (query: string, searchMode: 'and' | 'or') => void
  placeholder?: string
  initialValue?: string
  isLoading?: boolean
}

/**
 * SearchBar Component
 *
 * Search input with submit button and clear functionality
 *
 * Features:
 * - Controlled input with validation
 * - Clear button (X) when input has text
 * - Loading state during search
 * - Enter key submission
 * - Focus management
 * - Accessibility (ARIA labels)
 *
 * @example
 * ```tsx
 * <SearchBar
 *   onSearch={handleSearch}
 *   placeholder="ファイル名・内容・タグを入力して下さい"
 *   isLoading={isSearching}
 * />
 * ```
 */
export const SearchBar: FC<SearchBarProps> = ({
  onSearch,
  placeholder = 'ファイル名・内容・タグを入力して下さい',
  initialValue = '',
  isLoading = false,
}) => {
  const [query, setQuery] = useState(initialValue)
  const [searchMode, setSearchMode] = useState<'and' | 'or'>('or')
  const [isFocused, setIsFocused] = useState(false)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (query.trim()) {
      onSearch(query.trim(), searchMode)
    }
  }

  const toggleSearchMode = () => {
    setSearchMode(prev => prev === 'or' ? 'and' : 'or')
  }

  const handleClear = () => {
    setQuery('')
    // Optionally trigger search with empty query to reset results
    // onSearch('')
  }

  return (
    <div className="w-full space-y-3">
      <form
        onSubmit={handleSubmit}
        className={`w-full transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isFocused ? 'scale-[1.01]' : 'scale-100'
        }`}
      >
        <div className="relative flex items-center gap-3">
        <div className="relative flex-1">
          {/* 検索アイコン */}
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[#6E6E73] dark:text-[#98989D] pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholder}
            disabled={isLoading}
            aria-label="検索キーワード"
            className="
              w-full pl-12 pr-12 py-4
              text-[1.0625rem] leading-[1.4] font-normal
              bg-white/90 dark:bg-[#1C1C1E]/90
              backdrop-blur-xl
              rounded-2xl
              border border-[#D1D1D6]/30 dark:border-[#38383A]/30
              text-[#1D1D1F] dark:text-[#F5F5F7]
              placeholder:text-[#6E6E73] dark:placeholder:text-[#98989D]
              focus:border-[#007AFF] dark:focus:border-[#0A84FF]
              focus:outline-none focus:ring-4 focus:ring-[#007AFF]/10 dark:focus:ring-[#0A84FF]/10
              transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
              hover:bg-white dark:hover:bg-[#2C2C2E]/90
              shadow-sm hover:shadow-md
              disabled:opacity-50 disabled:cursor-not-allowed
            "
            style={{
              WebkitAppearance: 'none',
              MozAppearance: 'none',
            }}
          />
          {/* クリアボタン */}
          {query && !isLoading && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="検索をクリア"
              className="
                absolute right-4 top-1/2 -translate-y-1/2
                w-5 h-5 flex items-center justify-center
                bg-[#C7C7CC] dark:bg-[#48484A]
                hover:bg-[#AEAEB2] dark:hover:bg-[#636366]
                rounded-full transition-all duration-200
                animate-fade-in-scale
              "
            >
              <X className="h-3 w-3 text-white dark:text-[#F5F5F7]" strokeWidth={3} />
            </button>
          )}
        </div>
        {/* 検索ボタン */}
        <Button
          type="submit"
          size="lg"
          disabled={!query.trim() || isLoading}
          className="
            px-8 py-4
            bg-[#007AFF] hover:bg-[#0051D5] active:bg-[#004CCC]
            dark:bg-[#0A84FF] dark:hover:bg-[#0066FF] dark:active:bg-[#004DE6]
            text-white font-medium
            rounded-2xl
            transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
            shadow-sm hover:shadow-lg
            transform hover:scale-[1.02] active:scale-[0.98]
            disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
          "
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              検索中...
            </span>
          ) : (
            '検索'
          )}
        </Button>
      </div>
    </form>

    {/* AND/OR検索モード切り替え */}
    <div className="flex items-center justify-center gap-2">
      <span className="text-sm text-[#6E6E73] dark:text-[#98989D]">検索モード:</span>
      <button
        type="button"
        onClick={toggleSearchMode}
        className={`
          px-4 py-2 rounded-lg font-medium text-sm
          transition-all duration-200 ease-out
          ${searchMode === 'and'
            ? 'bg-[#007AFF] dark:bg-[#0A84FF] text-white shadow-md'
            : 'bg-[#F5F5F7] dark:bg-[#1C1C1E] text-[#6E6E73] dark:text-[#98989D] hover:bg-[#E5E5EA] dark:hover:bg-[#2C2C2E]'
          }
        `}
      >
        AND検索
      </button>
      <button
        type="button"
        onClick={toggleSearchMode}
        className={`
          px-4 py-2 rounded-lg font-medium text-sm
          transition-all duration-200 ease-out
          ${searchMode === 'or'
            ? 'bg-[#007AFF] dark:bg-[#0A84FF] text-white shadow-md'
            : 'bg-[#F5F5F7] dark:bg-[#1C1C1E] text-[#6E6E73] dark:text-[#98989D] hover:bg-[#E5E5EA] dark:hover:bg-[#2C2C2E]'
          }
        `}
      >
        OR検索
      </button>
      <span className="text-xs text-[#86868B] dark:text-[#86868B] ml-2">
        {searchMode === 'and'
          ? '（すべてのキーワードを含む）'
          : '（いずれかのキーワードを含む）'}
      </span>
    </div>
  </div>
  )
}
