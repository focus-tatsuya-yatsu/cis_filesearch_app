import { FC, memo } from 'react'

import { Filter, ArrowUpDown } from 'lucide-react'

import { Select, Button } from '@/components/ui'
import {
  FILE_TYPE_OPTIONS,
  DATE_RANGE_OPTIONS,
  FILE_SIZE_OPTIONS,
  SORT_BY_OPTIONS,
} from '@/constants/filterOptions'
import { useFilterState } from '@/hooks/useFilterState.v2'
import type { FilterOptions } from '@/types'

interface FilterPanelProps {
  onFilterApply: (filters: FilterOptions) => void
}

/**
 * FilterPanel Component (v2 - Staged Filters)
 *
 * Enhanced version with staged filter support
 *
 * Changes from v1:
 * - Filters are selected but not applied immediately
 * - "ソート" button (previously "降順") applies filters
 * - Button disabled when no unapplied changes
 * - Visual feedback for staged filters
 * - Loading state during filter application
 *
 * Performance Optimization: React.memo + Custom Hook
 * - Prevents re-renders when parent state changes
 * - Business logic extracted to useFilterState.v2 hook
 *
 * @example
 * ```tsx
 * <FilterPanel onFilterApply={(filters) => applyFiltersToResults(filters)} />
 * ```
 */
const FilterPanelComponent: FC<FilterPanelProps> = ({ onFilterApply }) => {
  const {
    selectedFilters,
    hasUnappliedChanges,
    handleReset,
    handleFileTypeChange,
    handleDateRangeChange,
    handleFileSizeChange,
    handleSortByChange,
    handleSortOrderToggle,
    handleApplyFilters,
    isApplying,
  } = useFilterState({ onFilterApply })

  return (
    <div className="bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl rounded-2xl shadow-sm border border-[#D1D1D6]/30 dark:border-[#38383A]/30 p-5 transition-all duration-300">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-[#6E6E73] dark:text-[#8E8E93]" />
          <h3 className="font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">フィルター・ソート</h3>
          {hasUnappliedChanges && (
            <span className="px-2 py-0.5 text-xs font-medium bg-[#FF9500]/10 dark:bg-[#FF9F0A]/10 text-[#FF9500] dark:text-[#FF9F0A] rounded-full">
              未適用
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          className="text-[#007AFF] dark:text-[#0A84FF] hover:bg-[#007AFF]/10 dark:hover:bg-[#0A84FF]/10"
        >
          リセット
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
        {/* ファイルタイプ */}
        <Select
          label="ファイルタイプ"
          value={selectedFilters.fileType}
          onChange={handleFileTypeChange}
          options={FILE_TYPE_OPTIONS}
        />

        {/* 更新日時 */}
        <Select
          label="更新日時"
          value={selectedFilters.dateRange}
          onChange={handleDateRangeChange}
          options={DATE_RANGE_OPTIONS}
        />

        {/* ファイルサイズ */}
        <Select
          label="ファイルサイズ"
          value={selectedFilters.fileSize}
          onChange={handleFileSizeChange}
          options={FILE_SIZE_OPTIONS}
        />

        {/* ソート順 */}
        <Select
          label="並び替え"
          value={selectedFilters.sortBy}
          onChange={handleSortByChange}
          options={SORT_BY_OPTIONS}
        />

        {/* 昇順/降順トグル */}
        <div className="flex items-end">
          <Button
            variant={selectedFilters.sortOrder === 'asc' ? 'primary' : 'outline'}
            size="md"
            onClick={handleSortOrderToggle}
            className="w-full"
          >
            {selectedFilters.sortOrder === 'asc' ? '昇順 ↑' : '降順 ↓'}
          </Button>
        </div>

        {/* ソート適用ボタン (previously 降順 button) */}
        <div className="flex items-end">
          <Button
            variant="primary"
            size="md"
            onClick={handleApplyFilters}
            disabled={!hasUnappliedChanges || isApplying}
            className="w-full flex items-center justify-center gap-2"
          >
            {isApplying ? (
              <>
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                適用中...
              </>
            ) : (
              <>
                <ArrowUpDown className="h-4 w-4" />
                ソート
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Memoized FilterPanel
 *
 * Prevents re-render when parent re-renders due to other state changes
 */
export const FilterPanel = memo(FilterPanelComponent)

FilterPanel.displayName = 'FilterPanel'
