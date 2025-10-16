'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Header } from '@/components/layout/Header'
import { SearchBar } from '@/components/features/SearchBar'
import { FilterPanel } from '@/components/features/FilterPanel'
import { SearchResultCard } from '@/components/features/SearchResultCard'
import { ExplorerView } from '@/components/features/ExplorerView'
import { Spinner, Button } from '@/components/ui'
import { LayoutGrid, FolderTree } from 'lucide-react'

// ダミーデータ
const dummyResults = [
  {
    id: '1',
    fileName: '2024年度事業計画書.pdf',
    filePath: '/Documents/Planning/FY2024/2024年度事業計画書.pdf',
    fileType: 'pdf',
    fileSize: 2457600,
    modifiedDate: '2024-01-15T10:30:00',
    snippet: '2024年度の事業計画について、前年度の実績を踏まえ、新たな成長戦略を策定しました。特に重点を置くのは...',
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

const HomePage = () => {
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<typeof dummyResults>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'explorer'>('explorer')

  const handleSearch = async (query: string) => {
    setSearchQuery(query)
    setIsSearching(true)
    setHasSearched(true)

    // 検索処理のシミュレーション
    setTimeout(() => {
      setSearchResults(dummyResults)
      setIsSearching(false)
    }, 1500)
  }

  const handleFilterChange = (filters: any) => {
    console.log('Filters changed:', filters)
    // フィルター処理の実装
  }

  const handlePreview = (id: string) => {
    console.log('Preview file:', id)
    // プレビュー機能の実装
  }

  const handleDownload = (id: string) => {
    console.log('Download file:', id)
    // ダウンロード機能の実装
  }

  return (
    <div className="min-h-screen bg-[#F5F5F7] dark:bg-black">
      <Header />

      {/* ヒーローセクション - Apple Design Philosophy */}
      <section className="relative overflow-hidden">
        {/* 背景グラデーション - 極めて微細な階調 */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#FBFBFD] via-[#F8FAFF] to-[#F5F5F7] dark:from-black dark:via-[#0C0C0E] dark:to-[#000000]" />

        {/* 微細なノイズテクスチャ（高級感の演出） */}
        <div className="absolute inset-0 opacity-[0.015] dark:opacity-[0.02]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%239C9C9C' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />

        <div className="relative py-20 sm:py-24 lg:py-28">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="text-center mb-10"
            >
              {/* メインタイトル - SF Pro Display風のウェイト */}
              <h2 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-[-0.02em] text-[#1D1D1F] dark:text-[#F5F5F7] mb-4 leading-[1.1]">
                必要なファイルを瞬時に検索
              </h2>
              {/* サブタイトル - 控えめな階層感 */}
              <p className="text-lg sm:text-xl lg:text-2xl text-[#424245] dark:text-[#C7C7CC] max-w-2xl mx-auto leading-[1.4]">
                社内のNASに保存された全てのファイルから、AIが最適な結果を見つけます
              </p>
            </motion.div>

            {/* 検索バー - フローティング効果 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
              className="max-w-3xl mx-auto"
            >
              <div className="relative">
                {/* 影のレイヤリング（Appleスタイル） */}
                <div className="absolute -inset-1 bg-gradient-to-r from-[#D1D1D6]/20 to-[#C7C7CC]/20 dark:from-[#38383A]/20 dark:to-[#48484A]/20 rounded-2xl blur-xl" />
                <div className="relative">
                  <SearchBar onSearch={handleSearch} />
                </div>
              </div>
            </motion.div>

            {/* 検索統計 - Glass Morphism */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center justify-center gap-6 sm:gap-10 lg:gap-12 mt-12"
            >
              {/* 統計カード */}
              <div className="relative group">
                {/* 背景ブラー効果 */}
                <div className="absolute inset-0 bg-white/60 dark:bg-[#1C1C1E]/60 backdrop-blur-xl rounded-2xl" />
                <div className="relative px-6 py-4 text-center">
                  {/* 数値 - iOS System Blue アクセント */}
                  <p className="text-3xl sm:text-4xl font-semibold bg-gradient-to-br from-[#007AFF] to-[#0051D5] dark:from-[#0A84FF] dark:to-[#0066FF] bg-clip-text text-transparent">
                    1.2M+
                  </p>
                  {/* ラベル */}
                  <p className="text-xs sm:text-sm mt-1 text-[#6E6E73] dark:text-[#8E8E93] font-medium">
                    インデックス済みファイル
                  </p>
                </div>
              </div>

              {/* 区切り線 - 極細で上品 */}
              <div className="w-px h-12 bg-[#D1D1D6]/50 dark:bg-[#38383A]/50" />

              <div className="relative group">
                <div className="absolute inset-0 bg-white/60 dark:bg-[#1C1C1E]/60 backdrop-blur-xl rounded-2xl" />
                <div className="relative px-6 py-4 text-center">
                  <p className="text-3xl sm:text-4xl font-semibold bg-gradient-to-br from-[#34C759] to-[#30D158] dark:from-[#32D74B] dark:to-[#2FE55B] bg-clip-text text-transparent">
                    {'< 0.5s'}
                  </p>
                  <p className="text-xs sm:text-sm mt-1 text-[#6E6E73] dark:text-[#8E8E93] font-medium">
                    平均検索時間
                  </p>
                </div>
              </div>

              <div className="w-px h-12 bg-[#D1D1D6]/50 dark:bg-[#38383A]/50" />

              <div className="relative group">
                <div className="absolute inset-0 bg-white/60 dark:bg-[#1C1C1E]/60 backdrop-blur-xl rounded-2xl" />
                <div className="relative px-6 py-4 text-center">
                  <p className="text-3xl sm:text-4xl font-semibold bg-gradient-to-br from-[#5856D6] to-[#7C7AFF] dark:from-[#5E5CE6] dark:to-[#8E8CF4] bg-clip-text text-transparent">
                    99.9%
                  </p>
                  <p className="text-xs sm:text-sm mt-1 text-[#6E6E73] dark:text-[#8E8E93] font-medium">
                    検索精度
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* 検索結果セクション */}
      {hasSearched && (
        <section className="py-8">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            {/* フィルターパネル */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="mb-6"
            >
              <FilterPanel onFilterChange={handleFilterChange} />
            </motion.div>

            {/* ビュー切り替えと検索結果ヘッダー */}
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                {searchQuery && `"${searchQuery}" の検索結果`}
                {!isSearching && searchResults.length > 0 && (
                  <span className="ml-2 text-sm font-normal text-[#6E6E73] dark:text-[#8E8E93]">
                    ({searchResults.length}件)
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2">
                <Button
                  variant={viewMode === 'explorer' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('explorer')}
                  icon={<FolderTree className="h-4 w-4" />}
                >
                  エクスプローラー
                </Button>
                <Button
                  variant={viewMode === 'grid' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                  icon={<LayoutGrid className="h-4 w-4" />}
                >
                  グリッド
                </Button>
              </div>
            </div>

            {isSearching ? (
              <div className="flex flex-col items-center justify-center py-20">
                <Spinner size="lg" />
                <p className="mt-4 text-[#6E6E73] dark:text-[#8E8E93]">検索中...</p>
              </div>
            ) : viewMode === 'explorer' ? (
              <ExplorerView
                searchResults={searchResults}
                onPreview={handlePreview}
                onDownload={handleDownload}
              />
            ) : searchResults.length > 0 ? (
              <div className="space-y-4">
                {searchResults.map((result, index) => (
                  <motion.div
                    key={result.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.1 }}
                  >
                    <SearchResultCard
                      result={result}
                      onPreview={handlePreview}
                      onDownload={handleDownload}
                    />
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="text-center py-20">
                <p className="text-[#6E6E73] dark:text-[#8E8E93]">検索結果が見つかりませんでした</p>
                <p className="text-sm text-[#6E6E73] dark:text-[#8E8E93] mt-2">
                  別のキーワードで検索してください
                </p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

export default HomePage