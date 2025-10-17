/**
 * Utils Module - Central Export Point
 *
 * Aggregates all utility functions for easy importing throughout the application.
 *
 * @example
 * // Named imports
 * import { formatFileSize, formatDate, getFileIcon } from '@/utils'
 *
 * // Or import specific modules
 * import { formatFileSize } from '@/utils/formatters'
 * import { getFileIcon } from '@/utils/fileIcons'
 */

// Formatter utilities
export { formatFileSize, formatDate } from './formatters'

// Icon utilities
export { getFileIcon } from './fileIcons'
