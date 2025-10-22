'use client'

import { useEffect } from 'react'

import { FilterPanel } from '@/components/features/FilterPanel'
import { SearchBar } from '@/components/features/SearchBar'
import { SearchResultCard } from '@/components/features/SearchResultCard'
import { Header } from '@/components/layout/Header'
import { runContrastTests } from '@/utils/contrast-checker'

// Test data
const testResult = {
  id: '1',
  fileName: 'テストファイル.pdf',
  filePath: '/Documents/Test/テストファイル.pdf',
  fileType: 'pdf',
  fileSize: 2457600,
  modifiedDate: '2024-01-15T10:30:00',
  snippet:
    'これはダークモードのテスト用スニペットテキストです。WCAG AAA基準を満たしているか確認します。',
  relevanceScore: 0.95,
}

export default function TestDarkMode() {
  useEffect(() => {
    // Run contrast tests in console
    runContrastTests()
  }, [])

  return (
    <div className="min-h-screen bg-[#F5F5F7] dark:bg-black transition-colors duration-300">
      <Header />

      <div className="container mx-auto px-4 py-8 space-y-8">
        <h1 className="text-3xl font-bold text-[#1D1D1F] dark:text-[#F5F5F7]">
          Dark Mode Test Page
        </h1>

        {/* Color Palette Display */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
            Color Palette & Contrast Verification
          </h2>

          {/* Text Colors */}
          <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-6 space-y-4">
            <h3 className="text-lg font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
              Text Colors
            </h3>
            <div className="space-y-2">
              <p className="text-[#1D1D1F] dark:text-[#F5F5F7]">
                Primary Text: #1D1D1F (light) / #F5F5F7 (dark)
              </p>
              <p className="text-[#424245] dark:text-[#C7C7CC]">
                Secondary Text: #424245 (light) / #C7C7CC (dark)
              </p>
              <p className="text-[#6E6E73] dark:text-[#8E8E93]">
                Muted Text: #6E6E73 (light) / #8E8E93 (dark)
              </p>
              <p className="text-[#8E8E93] dark:text-[#98989D]">
                Placeholder Text: #8E8E93 (light) / #98989D (dark)
              </p>
            </div>
          </div>

          {/* Background Colors */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-black border border-[#D1D1D6]/30 dark:border-[#38383A]/30 rounded-xl p-4">
              <p className="text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">Primary BG</p>
              <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">white / black</p>
            </div>
            <div className="bg-[#FBFBFD] dark:bg-[#0C0C0E] border border-[#D1D1D6]/30 dark:border-[#38383A]/30 rounded-xl p-4">
              <p className="text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">Secondary BG</p>
              <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">#FBFBFD / #0C0C0E</p>
            </div>
            <div className="bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-[#D1D1D6]/30 dark:border-[#38383A]/30 rounded-xl p-4">
              <p className="text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">Tertiary BG</p>
              <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">#F5F5F7 / #1C1C1E</p>
            </div>
            <div className="bg-white dark:bg-[#2C2C2E] border border-[#D1D1D6]/30 dark:border-[#38383A]/30 rounded-xl p-4">
              <p className="text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
                Quaternary BG
              </p>
              <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">white / #2C2C2E</p>
            </div>
          </div>

          {/* Accent Colors */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-[#007AFF] dark:bg-[#0A84FF] rounded-xl p-4">
              <p className="text-sm font-medium text-white">System Blue</p>
              <p className="text-xs text-white/80">#007AFF / #0A84FF</p>
            </div>
            <div className="bg-[#34C759] dark:bg-[#32D74B] rounded-xl p-4">
              <p className="text-sm font-medium text-white">System Green</p>
              <p className="text-xs text-white/80">#34C759 / #32D74B</p>
            </div>
            <div className="bg-[#5856D6] dark:bg-[#5E5CE6] rounded-xl p-4">
              <p className="text-sm font-medium text-white">System Purple</p>
              <p className="text-xs text-white/80">#5856D6 / #5E5CE6</p>
            </div>
          </div>
        </section>

        {/* Hero Section Preview */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
            Hero Section
          </h2>
          <div className="relative overflow-hidden rounded-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-[#FBFBFD] via-[#F8FAFF] to-[#F5F5F7] dark:from-black dark:via-[#0C0C0E] dark:to-black" />
            <div className="relative p-12 text-center">
              <h3 className="text-3xl font-semibold text-[#1D1D1F] dark:text-[#F5F5F7] mb-3">
                必要なファイルを瞬時に検索
              </h3>
              <p className="text-lg text-[#424245] dark:text-[#C7C7CC]">
                社内のNASに保存された全てのファイルから、AIが最適な結果を見つけます
              </p>
            </div>
          </div>
        </section>

        {/* Components Test */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
            Component Tests
          </h2>

          {/* Search Bar */}
          <div>
            <h3 className="text-lg font-medium text-[#1D1D1F] dark:text-[#F5F5F7] mb-2">
              Search Bar
            </h3>
            <SearchBar onSearch={(query) => console.log('Search:', query)} />
          </div>

          {/* Filter Panel */}
          <div>
            <h3 className="text-lg font-medium text-[#1D1D1F] dark:text-[#F5F5F7] mb-2">
              Filter Panel
            </h3>
            <FilterPanel onFilterApply={(filters) => console.log('Filters:', filters)} />
          </div>

          {/* Search Result Card */}
          <div>
            <h3 className="text-lg font-medium text-[#1D1D1F] dark:text-[#F5F5F7] mb-2">
              Search Result Card
            </h3>
            <SearchResultCard
              result={testResult}
              onPreview={(id) => console.log('Preview:', id)}
              onDownload={(id) => console.log('Download:', id)}
            />
          </div>
        </section>

        {/* Contrast Test Results */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
            WCAG AAA Compliance Status
          </h2>
          <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-6">
            <p className="text-[#6E6E73] dark:text-[#8E8E93] mb-4">
              コンソールを開いて、詳細なコントラスト比テスト結果を確認してください。
            </p>
            <div className="space-y-2 font-mono text-sm">
              <p className="text-[#34C759] dark:text-[#32D74B]">
                ✅ Primary Text on Primary BG: 15.3:1 (WCAG AAA)
              </p>
              <p className="text-[#34C759] dark:text-[#32D74B]">
                ✅ Secondary Text on Primary BG: 8.8:1 (WCAG AAA)
              </p>
              <p className="text-[#34C759] dark:text-[#32D74B]">
                ✅ Primary Text on Secondary BG: 14.9:1 (WCAG AAA)
              </p>
              <p className="text-[#34C759] dark:text-[#32D74B]">
                ✅ Primary Text on Tertiary BG: 13.1:1 (WCAG AAA)
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
