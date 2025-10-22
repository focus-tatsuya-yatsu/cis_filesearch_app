'use client'

import { useState, useCallback } from 'react'

import { AnimatePresence } from 'framer-motion'

import { Header } from '@/components/layout/Header'
import { ExplorerView } from '@/components/search/ExplorerView'
import { FilterPanel } from '@/components/search/FilterPanel'
import { SearchBar } from '@/components/search/SearchBar'
import { SearchHistory } from '@/components/search/SearchHistory'
import { Spinner } from '@/components/ui'
import { useSearchHistory } from '@/hooks'
import type { SearchResult, FilterOptions } from '@/types'

// ダミーデータ
const dummyResults: SearchResult[] = [
  {
    id: '1',
    fileName: '2024年度事業計画書.pdf',
    filePath: '/Documents/Planning/FY2024/2024年度事業計画書.pdf',
    fileType: 'pdf',
    fileSize: 2457600,
    modifiedDate: '2024-01-15T10:30:00',
    snippet:
      '2024年度の事業計画について、前年度の実績を踏まえ、新たな成長戦略を策定しました。特に重点を置くのは...',
    relevanceScore: 0.95,
  },
  {
    id: '2',
    fileName: '売上分析レポート_Q3.xlsx',
    filePath: '/Documents/Reports/Sales/2024Q3/売上分析レポート_Q3.xlsx',
    fileType: 'xlsx',
    fileSize: 1048576,
    modifiedDate: '2024-01-10T14:20:00',
    snippet: '第3四半期の売上データを詳細に分析し、地域別・製品別の売上推移をまとめています...',
    relevanceScore: 0.87,
  },
  {
    id: '3',
    fileName: '製品カタログ2024.docx',
    filePath: '/Documents/Marketing/Catalogs/製品カタログ2024.docx',
    fileType: 'docx',
    fileSize: 5242880,
    modifiedDate: '2024-01-05T09:15:00',
    snippet: '2024年版の製品カタログです。新製品の詳細情報と価格表を含みます...',
    relevanceScore: 0.82,
  },
]

/**
 * Home Page (v2 - Refactored)
 *
 * Main search page with all new features:
 * 1. ✅ Hero section removed
 * 2. ✅ SearchBar moved directly below Header
 * 3. ✅ SearchHistory displayed when no results
 * 4. ✅ FilterPanel with staged filters (ソート button)
 * 5. ✅ ExplorerView with collapsible sidebar
 *
 * State Management:
 * - searchQuery: Current search query
 * - searchResults: Search results array
 * - isSearching: Loading state
 * - hasSearched: Whether user has executed a search
 * - searchHistory: Recent searches (managed by useSearchHistory hook)
 * - showHistory: Conditional display (visible when no search results)
 *
 * Features:
 * - Search history with localStorage persistence
 * - Staged filters (apply on button click)
 * - Collapsible sidebar with localStorage persistence
 * - Smooth animations with Framer Motion
 */
const HomePage = () => {
  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [hasSearched, setHasSearched] = useState(false)

  // Search history hook
  const { history, addToHistory, clearHistory, removeHistoryItem } = useSearchHistory()

  /**
   * Execute search
   *
   * - Updates search query state
   * - Shows loading state
   * - Simulates API call
   * - Updates results
   * - Adds to search history
   */
  const handleSearch = useCallback(
    async (query: string) => {
      setSearchQuery(query)
      setIsSearching(true)
      setHasSearched(true)

      // Simulate search API call
      setTimeout(() => {
        setSearchResults(dummyResults)
        setIsSearching(false)

        // Add to history with result count
        addToHistory(query, dummyResults.length)
      }, 1500)
    },
    [addToHistory]
  )

  /**
   * Handle search history item click
   *
   * Re-executes search with selected query
   */
  const handleSelectHistory = useCallback(
    (query: string) => {
      handleSearch(query)
    },
    [handleSearch]
  )

  /**
   * Apply filters
   *
   * Triggered when "ソート" button clicked in FilterPanel
   */
  const handleApplyFilters = useCallback((_filters: FilterOptions) => {
    // TODO: Implement filter application logic
    // - Filter searchResults based on _filters
    // - Or re-fetch from API with filters
    console.log('Applying filters:', _filters)
  }, [])

  /**
   * Handle file preview
   */
  const handlePreview = useCallback((_id: string) => {
    // TODO: Implement preview functionality
    console.log('Preview file:', _id)
  }, [])

  /**
   * Handle file download
   */
  const handleDownload = useCallback((_id: string) => {
    // TODO: Implement download functionality
    console.log('Download file:', _id)
  }, [])

  /**
   * Determine if search history should be shown
   *
   * Show history when:
   * - User hasn't searched yet, OR
   * - User has searched but no results found
   */
  const showHistory = !hasSearched || (hasSearched && !isSearching && searchResults.length === 0)

  return (
    <div className="min-h-screen bg-[#F5F5F7] dark:bg-black">
      <Header />

      {/* Main Content */}
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search Bar Section */}
        <section className="mb-8">
          <div className="max-w-4xl mx-auto">
            <SearchBar
              onSearch={handleSearch}
              placeholder="ファイル名・内容・タグを入力して下さい"
              isLoading={isSearching}
            />
          </div>
        </section>

        {/* Search History or Results */}
        <AnimatePresence mode="wait">
          {showHistory ? (
            /* Search History */
            <section key="history" className="mb-8">
              <div className="max-w-4xl mx-auto">
                <SearchHistory
                  history={history}
                  onSelectHistory={handleSelectHistory}
                  onClearItem={removeHistoryItem}
                  onClearAll={clearHistory}
                />
              </div>
            </section>
          ) : (
            /* Search Results Section */
            <section key="results">
              {/* Filter Panel */}
              <div className="mb-6 animate-fade-in-fast">
                <FilterPanel onFilterApply={handleApplyFilters} />
              </div>

              {/* Results Header */}
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                  {searchQuery && `"${searchQuery}" の検索結果`}
                  {!isSearching && searchResults.length > 0 && (
                    <span className="ml-2 text-sm font-normal text-[#6E6E73] dark:text-[#8E8E93]">
                      ({searchResults.length}件)
                    </span>
                  )}
                </h3>
              </div>

              {/* Loading State */}
              {isSearching ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <Spinner size="lg" />
                  <p className="mt-4 text-[#6E6E73] dark:text-[#8E8E93]">検索中...</p>
                </div>
              ) : (
                /* Explorer View */
                <ExplorerView
                  searchResults={searchResults}
                  onPreview={handlePreview}
                  onDownload={handleDownload}
                />
              )}
            </section>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}

export default HomePage
