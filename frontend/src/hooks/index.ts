/**
 * Hooks Module - Central Export Point
 *
 * Aggregates all custom React hooks for easy importing throughout the application.
 *
 * @example
 * // Named imports
 * import { useClipboard, useSearchHistory, useSidebarState } from '@/hooks'
 *
 * // Or import specific hooks
 * import { useClipboard } from '@/hooks/useClipboard'
 */

// Clipboard hook
export { useClipboard } from './useClipboard'

// Filter state hook
export { useFilterState } from './useFilterState'

// Search history hook
export { useSearchHistory } from './useSearchHistory'
export type { UseSearchHistoryReturn } from './useSearchHistory'

// Sidebar state hook
export { useSidebarState } from './useSidebarState'
export type { UseSidebarStateReturn } from './useSidebarState'
