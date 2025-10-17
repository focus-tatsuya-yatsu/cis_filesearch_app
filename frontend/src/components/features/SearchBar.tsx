import { FC, useState, FormEvent } from 'react'

import { Search, X } from 'lucide-react'

import { Button } from '@/components/ui'

interface SearchBarProps {
  onSearch: (query: string) => void
  placeholder?: string
  initialValue?: string
}

export const SearchBar: FC<SearchBarProps> = ({
  onSearch,
  placeholder = 'ファイル名、内容、タグで検索...',
  initialValue = '',
}) => {
  const [query, setQuery] = useState(initialValue)
  const [isFocused, setIsFocused] = useState(false)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (query.trim()) {
      onSearch(query.trim())
    }
  }

  const handleClear = () => {
    setQuery('')
    onSearch('')
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`w-full transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        isFocused ? 'scale-[1.01]' : 'scale-100'
      }`}
    >
      <div className="relative flex items-center gap-3">
        <div className="relative flex-1">
          {/* 検索アイコン - Apple System SF Symbols スタイル */}
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[#6E6E73] dark:text-[#98989D] pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholder}
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
            "
            style={{
              WebkitAppearance: 'none',
              MozAppearance: 'none',
            }}
          />
          {/* クリアボタン - iOS スタイル with CSS animation */}
          {query && (
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
        {/* 検索ボタン - iOS System Blue */}
        <Button
          type="submit"
          size="lg"
          className="
            px-8 py-4
            bg-[#007AFF] hover:bg-[#0051D5] active:bg-[#004CCC]
            dark:bg-[#0A84FF] dark:hover:bg-[#0066FF] dark:active:bg-[#004DE6]
            text-white font-medium
            rounded-2xl
            transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
            shadow-sm hover:shadow-lg
            transform hover:scale-[1.02] active:scale-[0.98]
          "
        >
          検索
        </Button>
      </div>
    </form>
  )
}
