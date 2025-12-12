/**
 * 検索インターフェースコンポーネント
 *
 * メイン検索機能を提供するコンポーネント
 * - SearchBar
 * - SearchHistory
 * - FilterPanel
 * - ExplorerView
 *
 * @remarks
 * 元々page.tsxにあった検索ロジックを分離し、再利用可能なコンポーネントとして抽出
 */

'use client'

import { useState, useCallback, FC } from 'react'

import { AnimatePresence } from 'framer-motion'

import { Header } from '@/components/layout/Header'
import { ExplorerView } from './ExplorerView'
import { FilterPanel } from './FilterPanel'
import { SearchBar } from './SearchBar'
import { SearchHistory } from './SearchHistory'
import { Spinner } from '@/components/ui'
import { useSearchHistory } from '@/hooks'
import type { SearchResult, FilterOptions } from '@/types'
import { searchFiles, validateSearchQuery } from '@/lib/api/search'

// ========================================
// Dummy Data (TODO: Replace with API)
// ========================================

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

// ========================================
// Component
// ========================================

/**
 * SearchInterface Component
 *
 * 検索インターフェースの全体を提供
 *
 * State Management:
 * - searchQuery: 現在の検索クエリ
 * - searchResults: 検索結果配列
 * - isSearching: ローディング状態
 * - hasSearched: ユーザーが検索を実行したか
 * - searchHistory: 最近の検索履歴（useSearchHistoryフックで管理）
 * - showHistory: 条件付き表示（検索結果がない時に表示）
 *
 * Features:
 * - localStorageによる検索履歴の永続化
 * - ステージングフィルター（ボタンクリックで適用）
 * - 折りたたみ可能なサイドバー（localStorage永続化）
 * - Framer Motionによるスムーズなアニメーション
 */
export const SearchInterface: FC = () => {
  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [hasSearched, setHasSearched] = useState(false)

  // Search history hook
  const { history, addToHistory, clearHistory, removeHistoryItem } = useSearchHistory()

  /**
   * 検索実行
   *
   * - 検索クエリ状態を更新
   * - ローディング状態を表示
   * - 実際のAPIを呼び出し
   * - 結果を更新
   * - 検索履歴に追加
   */
  const handleSearch = useCallback(
    async (query: string) => {
      // クエリ検証
      const validation = validateSearchQuery(query)
      if (!validation.isValid) {
        console.error('Invalid query:', validation.error)
        return
      }

      setSearchQuery(query)
      setIsSearching(true)
      setHasSearched(true)

      try {
        // 実際のAPI呼び出し
        const response = await searchFiles({
          q: query,
          page: 1,
          limit: 20,
          sortBy: 'relevance',
          sortOrder: 'desc',
        })

        // 結果を更新
        setSearchResults(response.data.results)

        // 検索履歴に追加
        addToHistory(query, response.data.pagination.total)

      } catch (error: any) {
        console.error('Search failed:', error)

        // エラー時は空配列をセット
        setSearchResults([])

        // TODO: エラートーストを表示
        alert(`検索に失敗しました: ${error.message}`)

      } finally {
        setIsSearching(false)
      }
    },
    [addToHistory]
  )

  /**
   * 検索履歴アイテムクリック処理
   *
   * 選択されたクエリで検索を再実行
   */
  const handleSelectHistory = useCallback(
    (query: string) => {
      handleSearch(query)
    },
    [handleSearch]
  )

  /**
   * フィルター適用
   *
   * FilterPanelの「ソート」ボタンクリック時にトリガー
   */
  const handleApplyFilters = useCallback((_filters: FilterOptions) => {
    // TODO: Implement filter application logic
    // - Filter searchResults based on _filters
    // - Or re-fetch from API with filters
    console.log('Applying filters:', _filters)
  }, [])

  /**
   * ファイルプレビュー処理
   */
  const handlePreview = useCallback((_id: string) => {
    // TODO: Implement preview functionality
    console.log('Preview file:', _id)
  }, [])

  /**
   * ファイルダウンロード処理
   */
  const handleDownload = useCallback((_id: string) => {
    // TODO: Implement download functionality
    console.log('Download file:', _id)
  }, [])

  /**
   * 検索履歴表示判定
   *
   * 以下の場合に検索履歴を表示:
   * - ユーザーがまだ検索していない、または
   * - ユーザーが検索したが結果が見つからなかった
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
