import { useState, useCallback, useMemo } from 'react'

import { DEFAULT_FILTERS } from '@/constants/filterOptions'
import type { FilterOptions } from '@/types'

/**
 * Internal filter state (simplified for UI)
 */
interface FilterState {
  fileType: string
  dateRange: string
  fileSize: string
  sortBy: string
  sortOrder: 'asc' | 'desc'
}

/**
 * Options for useFilterState hook
 */
interface UseFilterStateOptions {
  initialFilters?: Partial<FilterState>
  onFilterChange: (filters: FilterOptions) => void
}

/**
 * Return type for useFilterState hook
 */
interface UseFilterStateReturn {
  filters: FilterState
  filterOptions: FilterOptions
  handleFilterChange: (key: keyof FilterState, value: string) => void
  handleReset: () => void
  handleFileTypeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  handleDateRangeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  handleFileSizeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  handleSortByChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  handleSortOrderToggle: () => void
}

/**
 * useFilterState Hook
 *
 * Custom hook for managing filter state in FilterPanel
 * - Extracts business logic from UI component
 * - Improves testability by isolating state management
 * - Enables reuse of filter logic in other components
 *
 * Benefits:
 * - UI component becomes pure presentation
 * - Hook can be tested independently
 * - Easier to modify filter logic without touching UI
 * - 130+ lines of logic extracted from FilterPanel
 *
 * Performance:
 * - All handlers memoized with useCallback
 * - filterOptions memoized with useMemo
 * - No performance regression from extraction
 *
 * @param options - Hook configuration options
 * @returns Filter state and handlers
 */
export const useFilterState = ({
  initialFilters,
  onFilterChange,
}: UseFilterStateOptions): UseFilterStateReturn => {
  const [filters, setFilters] = useState<FilterState>({
    ...DEFAULT_FILTERS,
    sortOrder: 'desc',
    ...initialFilters,
  })

  /**
   * Memoized FilterOptions
   *
   * Converts internal FilterState to FilterOptions type
   * - Memoized to prevent unnecessary recalculations
   * - Only recalculates when filters change
   */
  const filterOptions = useMemo<FilterOptions>(() => {
    return {
      fileType: filters.fileType ? [filters.fileType] : undefined,
      sortBy: filters.sortBy as 'name' | 'date' | 'size' | 'relevance',
      sortOrder: filters.sortOrder,
    }
  }, [filters])

  /**
   * handleFilterChange - Memoized filter update handler
   *
   * Dependencies:
   * - filters: Required to access current state
   * - onFilterChange: Required to notify parent
   *
   * Re-creation triggers:
   * - When filters state changes (expected and necessary)
   * - When onFilterChange reference changes (parent should prevent this with useCallback)
   */
  const handleFilterChange = useCallback(
    (key: keyof FilterState, value: string) => {
      const newFilters = { ...filters, [key]: value }
      setFilters(newFilters)

      // Convert FilterState to FilterOptions
      const newFilterOptions: FilterOptions = {
        fileType: newFilters.fileType ? [newFilters.fileType] : undefined,
        sortBy: newFilters.sortBy as 'name' | 'date' | 'size' | 'relevance',
        sortOrder: newFilters.sortOrder,
      }
      onFilterChange(newFilterOptions)
    },
    [filters, onFilterChange]
  )

  /**
   * handleReset - Memoized reset handler
   *
   * Resets all filters to default values
   * Dependencies: [onFilterChange]
   */
  const handleReset = useCallback(() => {
    const defaultFilters: FilterState = {
      ...DEFAULT_FILTERS,
      sortOrder: 'desc',
    }
    setFilters(defaultFilters)

    const resetFilterOptions: FilterOptions = {
      sortBy: 'relevance',
      sortOrder: 'desc',
    }
    onFilterChange(resetFilterOptions)
  }, [onFilterChange])

  /**
   * Individual Select handlers - Memoized onChange handlers
   *
   * These handlers wrap handleFilterChange for specific filter keys
   * Making them separate improves readability in the UI component
   */
  const handleFileTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      handleFilterChange('fileType', e.target.value)
    },
    [handleFilterChange]
  )

  const handleDateRangeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      handleFilterChange('dateRange', e.target.value)
    },
    [handleFilterChange]
  )

  const handleFileSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      handleFilterChange('fileSize', e.target.value)
    },
    [handleFilterChange]
  )

  const handleSortByChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      handleFilterChange('sortBy', e.target.value)
    },
    [handleFilterChange]
  )

  /**
   * handleSortOrderToggle - Memoized sort order toggle
   *
   * Toggles between 'asc' and 'desc'
   * Dependencies: [filters.sortOrder, handleFilterChange]
   */
  const handleSortOrderToggle = useCallback(() => {
    handleFilterChange('sortOrder', filters.sortOrder === 'asc' ? 'desc' : 'asc')
  }, [filters.sortOrder, handleFilterChange])

  return {
    filters,
    filterOptions,
    handleFilterChange,
    handleReset,
    handleFileTypeChange,
    handleDateRangeChange,
    handleFileSizeChange,
    handleSortByChange,
    handleSortOrderToggle,
  }
}
