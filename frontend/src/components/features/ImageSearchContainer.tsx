/**
 * ImageSearchContainer Component
 *
 * 画像検索のメインコンテナコンポーネント
 * 状態管理とビジネスロジックを担当
 *
 * Features:
 * - 画像アップロード管理
 * - 検索実行とエラーハンドリング
 * - 結果表示の制御
 * - Toast通知による適切なフィードバック
 */

import { FC, useState, useCallback } from 'react'

import { motion, AnimatePresence } from 'framer-motion'
import { Search, AlertCircle } from 'lucide-react'

import { ImageSearchDropdown } from '@/components/search/ImageSearchDropdown'
import { ImageSearchResults } from '@/components/features/ImageSearchResults'
import { SearchProgress } from '@/components/features/SearchProgress'
import {
  uploadImageForEmbedding,
  searchByImageEmbedding,
} from '@/lib/api/imageSearch'
import { useToast } from '@/hooks/useToast'
import type { SearchResult, ImageSearchState } from '@/types'

interface ImageSearchContainerProps {
  /**
   * 検索モード切替コールバック
   */
  onSearchModeChange?: (mode: 'text' | 'image') => void

  /**
   * 初期表示状態
   */
  initialOpen?: boolean

  /**
   * 信頼度閾値（デフォルト: 0.9）
   */
  confidenceThreshold?: number
}

/**
 * ImageSearchContainer Component
 *
 * 画像検索のメインコンテナ
 */
export const ImageSearchContainer: FC<ImageSearchContainerProps> = ({
  onSearchModeChange,
  initialOpen = false,
  confidenceThreshold = 0.9,
}) => {
  // State management
  const [isOpen, setIsOpen] = useState(initialOpen)
  const [imageState, setImageState] = useState<ImageSearchState>({
    imageFile: null,
    imagePreviewUrl: null,
    isUploading: false,
    embedding: null,
    error: null,
  })
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [searchProgress, setSearchProgress] = useState<number>(0)

  const toast = useToast()

  /**
   * 画像選択ハンドラ
   */
  const handleImageSelect = useCallback(
    async (file: File, previewUrl: string) => {
      setImageState({
        imageFile: file,
        imagePreviewUrl: previewUrl,
        isUploading: true,
        embedding: null,
        error: null,
      })

      setSearchProgress(10)

      try {
        // 画像をベクトル化
        toast.info('画像を処理中...', {
          description: 'ベクトル化処理を実行しています',
        })

        setSearchProgress(30)

        const response = await uploadImageForEmbedding(file)

        if ('error' in response) {
          throw new Error(response.error)
        }

        setSearchProgress(50)

        setImageState((prev) => ({
          ...prev,
          isUploading: false,
          embedding: response.data.embedding,
          error: null,
        }))

        // 自動的に検索を実行
        await executeSearch(response.data.embedding)
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : '画像の処理に失敗しました'

        setImageState((prev) => ({
          ...prev,
          isUploading: false,
          error: errorMessage,
        }))

        setSearchProgress(0)

        toast.error('エラー', {
          description: errorMessage,
        })
      }
    },
    [toast, confidenceThreshold]
  )

  /**
   * 検索実行
   */
  const executeSearch = async (embedding: number[]) => {
    setIsSearching(true)
    setSearchProgress(60)

    try {
      toast.info('類似画像を検索中...', {
        description: `信頼度${confidenceThreshold * 100}%以上の結果を表示`,
      })

      const results = await searchByImageEmbedding(embedding, confidenceThreshold)

      setSearchProgress(90)

      setSearchResults(results.hits || [])

      setSearchProgress(100)

      // 成功通知
      if (results.hits && results.hits.length > 0) {
        toast.success('検索完了', {
          description: `${results.hits.length}件の類似画像が見つかりました`,
          duration: 3000,
        })
      } else {
        toast.warning('結果が見つかりませんでした', {
          description: '別の画像で試してみてください',
          duration: 5000,
        })
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : '検索に失敗しました'

      toast.error('検索エラー', {
        description: errorMessage,
      })

      setSearchResults([])
    } finally {
      setIsSearching(false)
      setTimeout(() => setSearchProgress(0), 1000)
    }
  }

  /**
   * ドロップダウンを開く
   */
  const openDropdown = () => {
    setIsOpen(true)
    onSearchModeChange?.('image')
  }

  /**
   * ドロップダウンを閉じる
   */
  const closeDropdown = () => {
    setIsOpen(false)
    setImageState({
      imageFile: null,
      imagePreviewUrl: null,
      isUploading: false,
      embedding: null,
      error: null,
    })
    setSearchResults([])
    setSearchProgress(0)
  }

  return (
    <div className="w-full">
      {/* Search Toggle Button */}
      {!isOpen && (
        <motion.button
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          onClick={openDropdown}
          className="
            w-full flex items-center justify-center gap-2
            px-4 py-3 rounded-xl
            bg-white/90 dark:bg-[#1C1C1E]/90
            backdrop-blur-xl
            border border-[#D1D1D6]/30 dark:border-[#38383A]/30
            hover:border-[#007AFF] dark:hover:border-[#0A84FF]
            transition-all duration-200
            shadow-sm hover:shadow-md
          "
          aria-label="画像で検索"
        >
          <Search className="h-5 w-5 text-[#007AFF] dark:text-[#0A84FF]" />
          <span className="text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
            画像で検索
          </span>
        </motion.button>
      )}

      {/* Image Upload Dropdown */}
      <ImageSearchDropdown
        isOpen={isOpen}
        onClose={closeDropdown}
        onImageSelect={handleImageSelect}
        isUploading={imageState.isUploading}
        error={imageState.error}
      />

      {/* Search Progress */}
      <AnimatePresence>
        {(imageState.isUploading || isSearching) && searchProgress > 0 && (
          <SearchProgress progress={searchProgress} />
        )}
      </AnimatePresence>

      {/* Search Results */}
      <AnimatePresence>
        {searchResults.length > 0 && (
          <ImageSearchResults
            results={searchResults}
            isLoading={isSearching}
            confidenceThreshold={confidenceThreshold}
          />
        )}
      </AnimatePresence>

      {/* Empty State */}
      {!isSearching &&
        searchResults.length === 0 &&
        imageState.embedding !== null && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="mt-6 p-8 bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl rounded-2xl border border-[#D1D1D6]/30 dark:border-[#38383A]/30"
          >
            <div className="flex flex-col items-center justify-center gap-4">
              <div className="h-16 w-16 rounded-full bg-[#F5F5F7] dark:bg-[#2C2C2E] flex items-center justify-center">
                <AlertCircle className="h-8 w-8 text-[#6E6E73] dark:text-[#98989D]" />
              </div>
              <div className="text-center">
                <h3 className="text-lg font-semibold text-[#1D1D1F] dark:text-[#F5F5F7] mb-2">
                  結果が見つかりませんでした
                </h3>
                <p className="text-sm text-[#6E6E73] dark:text-[#98989D]">
                  信頼度{confidenceThreshold * 100}
                  %以上の類似画像が見つかりませんでした。
                  <br />
                  別の画像で試してみてください。
                </p>
              </div>
            </div>
          </motion.div>
        )}
    </div>
  )
}
