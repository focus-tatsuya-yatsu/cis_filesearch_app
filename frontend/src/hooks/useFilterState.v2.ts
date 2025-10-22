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
  onFilterApply: (filters: FilterOptions) => void
}

/**
 * Return type for useFilterState hook (v2 with staged filters)
 */
interface UseFilterStateReturn {
  // Current filter states
  selectedFilters: FilterState
  appliedFilters: FilterState
  hasUnappliedChanges: boolean

  // Filter change handlers
  handleFilterChange: (key: keyof FilterState, value: string) => void
  handleFileTypeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  handleDateRangeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  handleFileSizeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  handleSortByChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  handleSortOrderToggle: () => void

  // Apply and reset
  handleApplyFilters: () => void
  handleReset: () => void

  // Loading state
  isApplying: boolean
}

/**
 * useFilterState Hook (v2 - Staged Filters)
 *
 * Enhanced version with staged filter support
 * - Filters are selected but not applied immediately
 * - "ソート" button applies staged filters
 * - Visual feedback for unapplied changes
 *
 * Changes from v1:
 * - Added staged filter state (selectedFilters vs appliedFilters)
 * - Added hasUnappliedChanges computed property
 * - Added handleApplyFilters function
 * - Added isApplying loading state
 *
 * @param options - Hook configuration options
 * @returns Filter state and handlers
 */
export const useFilterState = ({
  initialFilters,
  onFilterApply,
}: UseFilterStateOptions): UseFilterStateReturn => {
  const defaultState = useMemo<FilterState>(
    () => ({
      ...DEFAULT_FILTERS,
      sortOrder: 'desc',
      ...initialFilters,
    }),
    [initialFilters]
  )

  // Selected filters (not yet applied)
  const [selectedFilters, setSelectedFilters] = useState<FilterState>(defaultState)

  // Applied filters (currently active)
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(defaultState)

  // Loading state during filter application
  const [isApplying, setIsApplying] = useState(false)

  /**
   * Check if there are unapplied changes
   */
  const hasUnappliedChanges = useMemo(
    () =>
      selectedFilters.fileType !== appliedFilters.fileType ||
      selectedFilters.dateRange !== appliedFilters.dateRange ||
      selectedFilters.fileSize !== appliedFilters.fileSize ||
      selectedFilters.sortBy !== appliedFilters.sortBy ||
      selectedFilters.sortOrder !== appliedFilters.sortOrder,
    [selectedFilters, appliedFilters]
  )

  /**
   * Convert FilterState to FilterOptions
   */
  const convertToFilterOptions = useCallback(
    (state: FilterState): FilterOptions => ({
      fileType: state.fileType ? [state.fileType] : undefined,
      sortBy: state.sortBy as 'name' | 'date' | 'size' | 'relevance',
      sortOrder: state.sortOrder,
    }),
    []
  )

  /**
   * Update selected filter (staged, not applied)
   */
  const handleFilterChange = useCallback((key: keyof FilterState, value: string) => {
    setSelectedFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

  /**
   * Individual filter change handlers
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
   * Toggle sort order
   */
  const handleSortOrderToggle = useCallback(() => {
    setSelectedFilters((prev) => ({
      ...prev,
      sortOrder: prev.sortOrder === 'asc' ? 'desc' : 'asc',
    }))
  }, [])

  /**
   * Apply staged filters
   *
   * Sets loading state, applies filters, and notifies parent
   */
  const handleApplyFilters = useCallback(async () => {
    if (!hasUnappliedChanges) return

    setIsApplying(true)

    try {
      // Simulate async operation (remove in production if not needed)
      await new Promise((resolve) => setTimeout(resolve, 300))

      // Apply filters
      setAppliedFilters(selectedFilters)

      // Notify parent
      const filterOptions = convertToFilterOptions(selectedFilters)
      onFilterApply(filterOptions)
    } finally {
      setIsApplying(false)
    }
  }, [hasUnappliedChanges, selectedFilters, convertToFilterOptions, onFilterApply])

  /**
   * Reset all filters to default
   */
  const handleReset = useCallback(() => {
    setSelectedFilters(defaultState)
    setAppliedFilters(defaultState)

    const resetOptions = convertToFilterOptions(defaultState)
    onFilterApply(resetOptions)
  }, [defaultState, convertToFilterOptions, onFilterApply])

  return {
    selectedFilters,
    appliedFilters,
    hasUnappliedChanges,
    handleFilterChange,
    handleFileTypeChange,
    handleDateRangeChange,
    handleFileSizeChange,
    handleSortByChange,
    handleSortOrderToggle,
    handleApplyFilters,
    handleReset,
    isApplying,
  }
}
