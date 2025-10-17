/**
 * Filter Options Constants
 *
 * Centralized constants for FilterPanel component
 * - Improves maintainability by keeping options in one place
 * - Makes it easier to add/modify filter options
 * - Enables type safety with 'as const' assertion
 *
 * Usage:
 * - Import in FilterPanel component
 * - Use in Select component options prop
 * - Use DEFAULT_FILTERS for initial state
 */

/**
 * File Type Filter Options
 */
export const FILE_TYPE_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'Word' },
  { value: 'xlsx', label: 'Excel' },
  { value: 'pptx', label: 'PowerPoint' },
  { value: 'image', label: '画像' },
  { value: 'video', label: '動画' },
  { value: 'other', label: 'その他' },
] as const

/**
 * Date Range Filter Options
 */
export const DATE_RANGE_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'today', label: '今日' },
  { value: 'week', label: '過去1週間' },
  { value: 'month', label: '過去1ヶ月' },
  { value: '3months', label: '過去3ヶ月' },
  { value: 'year', label: '過去1年' },
] as const

/**
 * File Size Filter Options
 */
export const FILE_SIZE_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'small', label: '1MB未満' },
  { value: 'medium', label: '1-10MB' },
  { value: 'large', label: '10-100MB' },
  { value: 'xlarge', label: '100MB以上' },
] as const

/**
 * Sort By Filter Options
 */
export const SORT_BY_OPTIONS = [
  { value: 'relevance', label: '関連性' },
  { value: 'name', label: 'ファイル名' },
  { value: 'date', label: '更新日時' },
  { value: 'size', label: 'サイズ' },
] as const

/**
 * Default Filter State
 *
 * Used for:
 * - Initial state in FilterPanel
 * - Reset functionality
 * - Ensuring consistent default values across the application
 */
export const DEFAULT_FILTERS = {
  fileType: '',
  dateRange: '',
  fileSize: '',
  sortBy: 'relevance',
  sortOrder: 'desc' as const,
} as const
