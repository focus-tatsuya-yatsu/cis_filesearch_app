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

import { useState, useCallback, useRef, useEffect, FC } from 'react'

import { AnimatePresence } from 'framer-motion'

import { Header } from '@/components/layout/Header'
import { ExplorerView } from './ExplorerView'
// import { FilterPanel } from './FilterPanel' // 既存のFilterPanelを置き換え
import { HierarchicalFilterPanel } from '@/components/filters/HierarchicalFilterPanel' // 新しい階層フィルタパネル
import { SearchBar } from './SearchBar'
import { SearchHistory } from './SearchHistory'
import { ImageSearchDropdown } from './ImageSearchDropdown' // 画像検索ドロップダウン
import { Spinner, EmptyState } from '@/components/ui'
import { PdfPreviewModal } from '@/components/preview/PdfPreviewModal' // プレビューモーダル追加
import { useSearchHistory, useToast } from '@/hooks'
import { useFilterStore } from '@/stores/useFilterStore' // フィルタストア追加
import type { SearchResult, FilterOptions, ImageSearchState } from '@/types'
import {
  searchFiles,
  validateSearchQuery,
  isApiError,
  type ApiErrorResponse,
} from '@/lib/api/search'
import { uploadImageForEmbedding, revokeImagePreviewUrl } from '@/lib/api/imageSearch'
import { ImageSearchDebugLogger } from '@/lib/api/debug-logger'
import {
  IMAGE_SEARCH_MESSAGES,
  TEXT_SEARCH_MESSAGES,
  getErrorMessage,
  createRetryAction,
} from '@/lib/constants/toast-messages'

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
  const searchQueryRef = useRef(searchQuery)

  // searchQueryが変更されたらrefを更新
  useEffect(() => {
    searchQueryRef.current = searchQuery
  }, [searchQuery])

  // フィルタストアからfileTypeを購読
  const fileType = useFilterStore((state) => state.fileType)
  const hasActiveFilters = useFilterStore((state) => state.hasActiveFilters)
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [totalResults, setTotalResults] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [searchError, setSearchError] = useState<ApiErrorResponse | null>(null)
  const [lastSearchParams, setLastSearchParams] = useState<{
    query: string
    mode: 'and' | 'or'
    searchType: 'text' | 'image'
    imageEmbedding?: number[]
  } | null>(null)

  // ページネーション設定
  const ITEMS_PER_PAGE = 50

  // Preview state
  const [previewFile, setPreviewFile] = useState<SearchResult | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  // Image search state
  const [isImageSearchOpen, setIsImageSearchOpen] = useState(false)
  const [imageSearchState, setImageSearchState] = useState<ImageSearchState>({
    imageFile: null,
    imagePreviewUrl: null,
    isUploading: false,
    embedding: null,
    error: null,
  })

  // Search history hook
  const { history, addToHistory, clearHistory, removeHistoryItem } = useSearchHistory()

  // Toast notifications hook
  const toast = useToast()

  /**
   * 検索実行
   *
   * - 検索クエリ状態を更新
   * - ローディング状態を表示
   * - 実際のAPIを呼び出し
   * - 結果を更新
   * - 検索履歴に追加
   * - エラー時は適切なエラーメッセージを表示
   */
  const handleSearch = useCallback(
    async (query: string, searchMode: 'and' | 'or' = 'or') => {
      // クエリ検証
      const validation = validateSearchQuery(query)
      if (!validation.isValid) {
        console.error('Invalid query:', validation.error)
        toast.error(validation.error || TEXT_SEARCH_MESSAGES.EMPTY_QUERY)
        setSearchError({
          userMessage: validation.error || '無効な検索クエリです',
          technicalMessage: validation.error || 'Invalid query',
          statusCode: 400,
          retryable: false,
        })
        return
      }

      setSearchQuery(query)
      setIsSearching(true)
      setHasSearched(true)
      setCurrentPage(1) // 新規検索時はページをリセット
      setSearchError(null) // エラーをクリア

      // 画像エンベディングが存在する場合はハイブリッド検索
      const hasActiveImage = imageSearchState.embedding && imageSearchState.embedding.length > 0
      const effectiveSearchType = hasActiveImage ? 'image' : 'text'

      // リトライ用にパラメータを保存（画像エンベディングも保持）
      setLastSearchParams({
        query,
        mode: searchMode,
        searchType: effectiveSearchType,
        imageEmbedding: hasActiveImage ? imageSearchState.embedding : undefined
      })

      // フィルタストアから現在の状態を取得
      const filterStore = useFilterStore.getState()
      const {
        selectedServerIds,
        selectedFolderIds,
        dateRange,
        fileType: currentFileType,
      } = filterStore

      // フォルダIDからフォルダ名を抽出
      const folderNames = selectedFolderIds.map((id) => {
        const parts = id.split('_')
        return parts.slice(1).join('_')
      })

      // 検索パラメータを構築（フィルタ含む）
      const searchParams: any = {
        q: query,
        searchMode,
        searchType: effectiveSearchType,
        page: 1,
        limit: ITEMS_PER_PAGE,
        sortBy: 'relevance',
        sortOrder: 'desc',
      }

      // 画像エンベディングがある場合はハイブリッド検索用に追加
      if (hasActiveImage && imageSearchState.embedding) {
        searchParams.imageEmbedding = imageSearchState.embedding
      }

      // カテゴリフィルタ
      if (selectedServerIds.length > 0) {
        searchParams.categories = selectedServerIds
      }

      // フォルダフィルタ
      if (folderNames.length > 0) {
        searchParams.folders = folderNames
      }

      // 日付フィルタ
      if (dateRange.startDate || dateRange.endDate) {
        searchParams.dateFrom = dateRange.startDate
        searchParams.dateTo = dateRange.endDate
        searchParams.dateFilterType = dateRange.filterType
      }

      // ファイルタイプフィルタ
      if (currentFileType !== 'all') {
        searchParams.fileType = currentFileType
      }

      // 実際のAPI呼び出し
      const response = await searchFiles(searchParams)

      setIsSearching(false)

      // エラーレスポンスの場合
      if (isApiError(response)) {
        setSearchResults([])
        setSearchError(response)

        // エラートースト通知（リトライ可能な場合はアクションボタン表示）
        if (response.retryable) {
          toast.error(response.userMessage, {
            description: response.technicalMessage,
            action: createRetryAction(() => handleSearch(query, searchMode)),
          })
        } else {
          toast.error(response.userMessage, {
            description: response.technicalMessage,
          })
        }
        return
      }

      // 成功時の処理
      const total = response.data.total ?? response.data.results.length
      setTotalResults(total)
      setSearchResults(response.data.results)
      setSearchError(null)

      // 結果件数に応じた通知
      if (response.data.results.length === 0) {
        toast.warning(TEXT_SEARCH_MESSAGES.SEARCH_NO_RESULTS, {
          description: '別のキーワードやフィルタ条件で検索してみてください',
        })
      } else {
        const totalResults = response.data.total ?? response.data.results.length
        toast.success(TEXT_SEARCH_MESSAGES.SEARCH_SUCCESS, {
          description: `${totalResults}件の検索結果が見つかりました`,
        })
      }

      // 検索履歴に追加
      const totalResults = response.data.total ?? response.data.results.length
      addToHistory(query, totalResults)
    },
    [addToHistory, toast, imageSearchState.embedding]
  )

  /**
   * リトライ処理
   * 前回の検索パラメータを使って再度検索を実行
   */
  const handleRetry = useCallback(() => {
    if (lastSearchParams) {
      handleSearch(lastSearchParams.query, lastSearchParams.mode)
    }
  }, [lastSearchParams, handleSearch])

  /**
   * ページ変更処理
   * 指定されたページの検索結果を取得
   */
  const handlePageChange = useCallback(
    async (page: number) => {
      if (!lastSearchParams) return

      setIsSearching(true)
      setCurrentPage(page)

      // フィルタストアから現在の状態を取得
      const filterStore = useFilterStore.getState()
      const {
        selectedServerIds,
        selectedFolderIds,
        dateRange,
        fileType: currentFileType,
      } = filterStore

      // フォルダIDからフォルダ名を抽出
      const folderNames = selectedFolderIds.map((id) => {
        const parts = id.split('_')
        return parts.slice(1).join('_')
      })

      // 検索パラメータを構築
      const searchParams: any = {
        q: lastSearchParams.query,
        searchMode: lastSearchParams.mode,
        searchType: lastSearchParams.searchType,
        page,
        limit: ITEMS_PER_PAGE,
        sortBy: 'relevance',
        sortOrder: 'desc',
      }

      // 画像検索の場合
      if (lastSearchParams.searchType === 'image' && lastSearchParams.imageEmbedding) {
        searchParams.imageEmbedding = lastSearchParams.imageEmbedding
      }

      // フィルタを適用
      if (selectedServerIds.length > 0) {
        searchParams.categories = selectedServerIds
      }
      if (folderNames.length > 0) {
        searchParams.folders = folderNames
      }
      if (dateRange.startDate || dateRange.endDate) {
        searchParams.dateFrom = dateRange.startDate
        searchParams.dateTo = dateRange.endDate
        searchParams.dateFilterType = dateRange.filterType
      }
      if (currentFileType !== 'all') {
        searchParams.fileType = currentFileType
      }

      // API呼び出し
      const response = await searchFiles(searchParams)

      setIsSearching(false)

      if (isApiError(response)) {
        toast.error(response.userMessage)
        return
      }

      setSearchResults(response.data.results)
      const total = response.data.total ?? response.data.results.length
      setTotalResults(total)
    },
    [lastSearchParams, toast]
  )

  /**
   * 検索履歴アイテムクリック処理
   *
   * 選択されたクエリで検索を再実行（デフォルトはOR検索）
   */
  const handleSelectHistory = useCallback(
    (query: string) => {
      handleSearch(query, 'or')
    },
    [handleSearch]
  )

  /**
   * 画像検索トグル
   */
  const handleImageSearchToggle = useCallback(() => {
    setIsImageSearchOpen((prev) => !prev)
  }, [])

  /**
   * 画像削除ハンドラ
   * 画像のエンベディングをクリアしてテキスト検索モードに戻す
   */
  const handleImageRemove = useCallback(() => {
    setImageSearchState({
      imageFile: null,
      imagePreviewUrl: null,
      isUploading: false,
      embedding: null,
      error: null,
    })
    // lastSearchParamsからも画像情報をクリア
    if (lastSearchParams?.imageEmbedding) {
      setLastSearchParams({
        ...lastSearchParams,
        searchType: 'text',
        imageEmbedding: undefined
      })
    }
  }, [lastSearchParams])

  /**
   * 画像選択ハンドラ
   */
  const handleImageSelect = useCallback(
    async (file: File, previewUrl: string) => {
      // アップロード開始
      setImageSearchState({
        imageFile: file,
        imagePreviewUrl: previewUrl,
        isUploading: true,
        embedding: null,
        error: null,
      })

      // ローディングトースト表示
      const toastId = toast.loading(IMAGE_SEARCH_MESSAGES.UPLOAD_START, {
        description: `${file.name} (${(file.size / 1024).toFixed(1)} KB)`,
      })

      try {
        // 画像をアップロードしてベクトル化
        const response = await uploadImageForEmbedding(file)

        if ('error' in response) {
          // エラーレスポンス
          const errorMessage = response.error || IMAGE_SEARCH_MESSAGES.UPLOAD_ERROR
          setImageSearchState((prev) => ({
            ...prev,
            isUploading: false,
            error: errorMessage,
          }))

          // ローディングトーストを閉じてエラートーストを表示
          toast.dismiss(toastId)
          toast.error(IMAGE_SEARCH_MESSAGES.UPLOAD_ERROR, {
            description: errorMessage,
          })
          return
        }

        // 成功レスポンス
        const { embedding } = response.data

        setImageSearchState((prev) => ({
          ...prev,
          isUploading: false,
          embedding,
          error: null,
        }))

        // ローディングトーストを閉じて成功トーストを表示
        toast.dismiss(toastId)
        toast.success(IMAGE_SEARCH_MESSAGES.UPLOAD_SUCCESS, {
          description: '類似画像を検索中...',
          duration: 2000,
        })

        // ベクトルを使って検索実行
        await handleImageSearch(embedding, searchQueryRef.current)
      } catch (error: any) {
        console.error('Image upload failed:', error)
        const errorMessage = error.message || '予期しないエラーが発生しました'

        setImageSearchState((prev) => ({
          ...prev,
          isUploading: false,
          error: errorMessage,
        }))

        // ローディングトーストを閉じてエラートーストを表示
        toast.dismiss(toastId)
        toast.error(IMAGE_SEARCH_MESSAGES.UPLOAD_ERROR, {
          description: errorMessage,
        })
      }
    },
    [toast]
  )

  /**
   * 画像ベクトルで検索実行
   */
  const handleImageSearch = useCallback(
    async (embedding: number[], query: string = '') => {
      ImageSearchDebugLogger.startFlow('Image Search Flow')
      const flowStartTime = ImageSearchDebugLogger.startPerformance('Complete Image Search Flow')

      setIsSearching(true)
      setHasSearched(true)
      setSearchError(null)
      // searchQueryは維持（ハイブリッド検索対応）

      // デバッグログ: ベクトルデータの確認
      ImageSearchDebugLogger.logVectorData(embedding, 'Received in handleImageSearch')
      ImageSearchDebugLogger.logStep('Preparing search parameters', {
        searchType: 'image',
        searchMode: 'or',
        embeddingDimensions: embedding.length,
      })

      // 画像ベクトルを使って検索実行（テキストクエリがあればハイブリッド検索）
      const response = await searchFiles({
        q: query || searchQueryRef.current || '', // テキストクエリも送信（refから最新値を取得）
        imageEmbedding: embedding,
        searchType: 'image',
        searchMode: lastSearchParams?.mode || 'or',
        page: 1,
        limit: ITEMS_PER_PAGE,
        sortBy: 'relevance',
        sortOrder: 'desc',
      })

      // 画像検索のパラメータを保存
      setLastSearchParams({
        query: query || searchQueryRef.current || '',
        mode: 'or',
        searchType: 'image',
        imageEmbedding: embedding,
      })

      setIsSearching(false)

      if (isApiError(response)) {
        ImageSearchDebugLogger.logError('handleImageSearch', response)
        ImageSearchDebugLogger.endPerformance('Complete Image Search Flow', flowStartTime)
        ImageSearchDebugLogger.endFlow('Image Search Flow')
        setSearchResults([])
        setSearchError(response)

        // エラートースト通知
        toast.error(IMAGE_SEARCH_MESSAGES.SEARCH_ERROR, {
          description: response.userMessage,
        })
        return
      }

      ImageSearchDebugLogger.logStep('Search successful', {
        totalResults: response.data.results.length,
        took: response.data.took,
      })

      // ハイブリッド検索の場合は信頼度フィルタを緩和（30%）、画像のみは90%
      const confidenceThreshold = searchQueryRef.current ? 0.1 : 0.9
      const filteredResults = response.data.results.filter(
        (result) => result.relevanceScore >= confidenceThreshold
      )

      ImageSearchDebugLogger.logStep('Results filtered by confidence', {
        beforeFilter: response.data.results.length,
        afterFilter: filteredResults.length,
      })

      // デバッグ用: フィルタリング詳細をテーブル表示
      if (process.env.NODE_ENV === 'development' && response.data.results.length > 0) {
        const scoreTable = response.data.results.map((r) => ({
          fileName: r.fileName,
          score: r.relevanceScore,
          included: r.relevanceScore >= confidenceThreshold ? 'Yes' : 'No',
        }))
        ImageSearchDebugLogger.logTable('Confidence Score Breakdown', scoreTable)
      }

      setSearchResults(filteredResults)
      // 総件数はAPIから返される値を使用（ない場合はフィルタ後の件数）
      setTotalResults(response.data.total || filteredResults.length)
      setSearchError(null)
      // 画像検索のパラメータを保存（フィルタ適用時に参照）
      setLastSearchParams({
        query: query || searchQueryRef.current || '',
        mode: 'or',
        searchType: 'image',
        imageEmbedding: embedding,
      })

      // 結果件数に応じた通知
      if (filteredResults.length === 0) {
        // ハイブリッド検索の場合は詳細情報を表示
        const textCount = response.data.textSearchCount
        const imageCount = response.data.imageSearchCount
        if (searchQueryRef.current && textCount !== undefined) {
          toast.warning(IMAGE_SEARCH_MESSAGES.SEARCH_NO_RESULTS, {
            description: `テキスト検索: ${textCount}件ヒット → 画像検索: ${imageCount}件マッチ。キーワードを含む画像ファイルが見つかりませんでした。`,
            duration: 8000,
          })
        } else {
          toast.warning(IMAGE_SEARCH_MESSAGES.SEARCH_NO_RESULTS, {
            description: '条件に合う類似画像が見つかりませんでした',
          })
        }
      } else {
        toast.success(IMAGE_SEARCH_MESSAGES.SEARCH_SUCCESS, {
          description: `${filteredResults.length}件の類似画像が見つかりました`,
        })
      }

      ImageSearchDebugLogger.endPerformance('Complete Image Search Flow', flowStartTime)
      ImageSearchDebugLogger.endFlow('Image Search Flow')
    },
    [toast, searchQuery, lastSearchParams]
  )

  /**
   * フィルター適用
   *
   * HierarchicalFilterPanelの「フィルタを適用」ボタンクリック時にトリガー
   * フィルタストアから現在の選択状態を取得して検索を実行
   */
  const handleApplyFilters = useCallback(async () => {
    try {
      console.log('handleApplyFilters called')
      const filterStore = useFilterStore.getState()

      const {
        selectedServerIds,
        selectedFolderIds,
        dateRange,
        fileType,
        getSelectedServers,
        getSelectedFolders,
      } = filterStore

      // フィルタが設定されていない場合は通常検索
      if (!filterStore.hasActiveFilters() && !searchQuery) {
        return
      }

      // フィルタ情報をログ出力（デバッグ用）
      console.log('Applying filters:', {
        servers: getSelectedServers(),
        folders: getSelectedFolders(),
        dateRange,
        fileType,
      })

      // 検索クエリとフィルタを組み合わせて検索実行
      setIsSearching(true)
      setSearchError(null)

      // フォルダIDからフォルダ名のみを抽出（例: "road_H22_JOB" → "H22_JOB"）
      const folderNames = selectedFolderIds.map((id) => {
        const parts = id.split('_')
        return parts.slice(1).join('_')
      })

      // APIパラメータを構築
      const searchParams: any = {
        q: searchQuery || '',
        searchType: lastSearchParams?.searchType || 'text',
        searchMode: lastSearchParams?.mode || 'or',
        page: 1,
        limit: ITEMS_PER_PAGE,
        sortBy: 'relevance',
        sortOrder: 'desc',
      }
      // 画像検索の場合はimageEmbeddingを追加
      if (lastSearchParams?.searchType === 'image' && lastSearchParams?.imageEmbedding) {
        searchParams.imageEmbedding = lastSearchParams.imageEmbedding
      }
      // フォルダフィルタ（フォルダ名のみ）
      // カテゴリフィルタ
      if (selectedServerIds.length > 0) {
        searchParams.categories = selectedServerIds
      }
      if (folderNames.length > 0) {
        searchParams.folders = folderNames
      }

      // 日付フィルタ
      if (dateRange.startDate || dateRange.endDate) {
        searchParams.dateFrom = dateRange.startDate
        searchParams.dateTo = dateRange.endDate
        searchParams.dateFilterType = dateRange.filterType
      }

      // ファイルタイプフィルタ
      if (fileType !== 'all') {
        searchParams.fileType = fileType
      }

      // API呼び出し
      const response = await searchFiles(searchParams)

      setIsSearching(false)

      // エラーレスポンスの場合
      if (isApiError(response)) {
        setSearchResults([])
        setSearchError(response)
        return
      }

      // 成功時の処理
      const total = response.data.total ?? response.data.results.length
      setTotalResults(total)
      setSearchResults(response.data.results)
      setSearchError(null)
      setHasSearched(true)

      console.log('Filter applied, results:', total)
    } catch (error) {
      console.error('Error applying filters:', error)
      setIsSearching(false)
      setSearchError({
        userMessage: 'フィルター適用中にエラーが発生しました',
        technicalMessage: String(error),
        statusCode: 0,
        retryable: true,
      })
    }
  }, [searchQuery, lastSearchParams])

  /**
   * ファイルプレビュー処理
   * PDFプレビューモーダルを開く
   */
  const handlePreview = useCallback(
    (id: string) => {
      const file = searchResults.find((r) => r.id === id)
      if (file) {
        setPreviewFile(file)
        setIsPreviewOpen(true)
      }
    },
    [searchResults]
  )

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
  const showHistory = !hasSearched

  return (
    <div className="min-h-screen bg-[#F5F5F7] dark:bg-black">
      <Header />

      {/* Main Content */}
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search Bar Section */}
        <section className="mb-8">
          <div className="max-w-4xl mx-auto space-y-4">
            <SearchBar
              onSearch={handleSearch}
              onQueryChange={(q) => {
                setSearchQuery(q)
                searchQueryRef.current = q
              }}
              placeholder="ファイル名・内容・タグを入力して下さい"
              isLoading={isSearching}
              onImageSearchToggle={handleImageSearchToggle}
              isImageSearchOpen={isImageSearchOpen}
            />

            {/* Image Search Dropdown */}
            <ImageSearchDropdown
              isOpen={isImageSearchOpen}
              onClose={() => setIsImageSearchOpen(false)}
              onImageSelect={handleImageSelect}
              onImageRemove={handleImageRemove}
              isUploading={imageSearchState.isUploading}
              error={imageSearchState.error}
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
              {/* Hierarchical Filter Panel - 新しい階層フィルタリングパネル */}
              <div className="mb-6 animate-fade-in-fast">
                <HierarchicalFilterPanel onApplyFilters={handleApplyFilters} />
              </div>

              {/* Results Header */}
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                  {searchQuery
                    ? `"${searchQuery}" の検索結果`
                    : searchResults.length > 0
                      ? '画像検索の結果'
                      : ''}
                  {!isSearching && (
                    <span className="ml-2 text-sm font-normal text-[#6E6E73] dark:text-[#8E8E93]">
                      ({totalResults}件)
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
              ) : searchError ? (
                /* Error State */
                <div className="flex flex-col items-center justify-center py-20">
                  {/* エラーアイコン */}
                  <div className="text-red-500 dark:text-red-400 mb-4">
                    <svg
                      className="w-16 h-16"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                  </div>

                  {/* エラーメッセージ */}
                  <h3 className="text-xl font-semibold text-[#1D1D1F] dark:text-[#F5F5F7] mb-2">
                    検索中にエラーが発生しました
                  </h3>
                  <p className="text-[#6E6E73] dark:text-[#8E8E93] mb-6 text-center max-w-md">
                    {searchError.userMessage}
                  </p>

                  {/* リトライボタン（retryableな場合のみ表示） */}
                  {searchError.retryable && (
                    <button
                      onClick={handleRetry}
                      className="px-6 py-3 bg-[#0071E3] hover:bg-[#0077ED] text-white font-medium rounded-lg transition-colors duration-200 flex items-center gap-2"
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                      </svg>
                      再試行
                    </button>
                  )}

                  {/* デバッグ情報（開発環境のみ） */}
                  {searchError.debugInfo && process.env.NODE_ENV === 'development' && (
                    <details className="mt-6 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg max-w-2xl w-full text-left">
                      <summary className="cursor-pointer text-sm font-medium text-[#6E6E73] dark:text-[#8E8E93] hover:text-[#1D1D1F] dark:hover:text-[#F5F5F7]">
                        デバッグ情報
                      </summary>
                      <div className="mt-3 space-y-2 text-xs font-mono text-[#1D1D1F] dark:text-[#F5F5F7]">
                        <div>
                          <span className="text-[#6E6E73] dark:text-[#8E8E93]">Status Code:</span>{' '}
                          {searchError.statusCode}
                        </div>
                        <div>
                          <span className="text-[#6E6E73] dark:text-[#8E8E93]">
                            Technical Message:
                          </span>{' '}
                          {searchError.technicalMessage}
                        </div>
                        <div>
                          <span className="text-[#6E6E73] dark:text-[#8E8E93]">Timestamp:</span>{' '}
                          {searchError.debugInfo.timestamp}
                        </div>
                        <div>
                          <span className="text-[#6E6E73] dark:text-[#8E8E93]">Endpoint:</span>{' '}
                          {searchError.debugInfo.endpoint}
                        </div>
                        {searchError.debugInfo.originalError && (
                          <div>
                            <span className="text-[#6E6E73] dark:text-[#8E8E93]">
                              Original Error:
                            </span>{' '}
                            {searchError.debugInfo.originalError}
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              ) : searchResults.length === 0 ? (
                /* No Results State */
                <EmptyState
                  icon={
                    <svg
                      className="w-16 h-16"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  }
                  title="検索結果が見つかりません"
                  description="別のキーワードやフィルタ条件で検索してみてください"
                />
              ) : (
                /* Explorer View */
                <ExplorerView
                  searchResults={searchResults}
                  totalResults={totalResults}
                  currentPage={currentPage}
                  itemsPerPage={ITEMS_PER_PAGE}
                  onPageChange={handlePageChange}
                  onPreview={handlePreview}
                  onDownload={handleDownload}
                />
              )}
            </section>
          )}
        </AnimatePresence>
      </main>

      {/* PDFプレビューモーダル */}
      {previewFile && (
        <PdfPreviewModal
          isOpen={isPreviewOpen}
          onClose={() => {
            setIsPreviewOpen(false)
            setPreviewFile(null)
          }}
          fileId={previewFile.id}
          fileName={previewFile.fileName}
          filePath={previewFile.filePath}
          s3Key={`processed/${previewFile.filePath.replace(/^\//, '')}`}
          keywords={searchQuery ? searchQuery.split(' ') : []}
        />
      )}
    </div>
  )
}
