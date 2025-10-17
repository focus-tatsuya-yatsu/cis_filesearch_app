/**
 * File Utility Functions - Icons
 *
 * Extracted from SearchResultCard.tsx for reusability and better testability.
 * Returns appropriate icons based on file type.
 */

import { FileText } from 'lucide-react'

/**
 * Get icon component based on file type
 *
 * @param fileType - File extension or type (case-insensitive)
 * @returns React element with appropriate icon and color
 *
 * @example
 * getFileIcon('pdf') // Red FileText icon
 * getFileIcon('docx') // Blue FileText icon
 * getFileIcon('XLSX') // Green FileText icon (case-insensitive)
 * getFileIcon('unknown') // Gray FileText icon (default)
 */
export const getFileIcon = (fileType: string) => {
  switch (fileType.toLowerCase()) {
    case 'pdf':
      return <FileText className="h-5 w-5 text-red-500" />
    case 'docx':
    case 'doc':
      return <FileText className="h-5 w-5 text-blue-500" />
    case 'xlsx':
    case 'xls':
      return <FileText className="h-5 w-5 text-green-500" />
    default:
      return <FileText className="h-5 w-5 text-gray-500" />
  }
}
