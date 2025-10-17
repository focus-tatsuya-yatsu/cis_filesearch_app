/**
 * File Utility Functions - Formatters
 *
 * Extracted from SearchResultCard.tsx for reusability and better testability.
 * These pure functions handle formatting of file metadata for display.
 */

/**
 * Format file size from bytes to human-readable format
 *
 * @param bytes - File size in bytes
 * @returns Formatted string with appropriate unit (B, KB, MB, GB)
 *
 * @example
 * formatFileSize(0) // "0 B"
 * formatFileSize(1024) // "1 KB"
 * formatFileSize(1536) // "1.5 KB"
 * formatFileSize(1048576) // "1 MB"
 * formatFileSize(2457600) // "2.34 MB"
 * formatFileSize(1073741824) // "1 GB"
 */
export const formatFileSize = (bytes: number): string => {
  const sizes = ['B', 'KB', 'MB', 'GB']
  if (bytes === 0) return '0 B'
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i]
}

/**
 * Format date string to Japanese locale format
 *
 * @param dateString - ISO 8601 date string or any valid date format
 * @returns Formatted date string in Japanese format (YYYY/MM/DD HH:mm)
 *
 * @example
 * formatDate('2024-01-15T10:30:00') // "2024/01/15 10:30"
 * formatDate('2024-12-31T23:59:59') // "2024/12/31 23:59"
 */
export const formatDate = (dateString: string): string => {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
