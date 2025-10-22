import { useState, useCallback, useEffect } from 'react'

import { STORAGE_KEYS, getLocalStorage, setLocalStorage } from '@/lib/localStorage'
import type { SearchHistoryItem } from '@/types'

/**
 * Maximum number of search history items to store
 */
const MAX_HISTORY_ITEMS = 10

/**
 * Return type for useSearchHistory hook
 */
export interface UseSearchHistoryReturn {
  history: SearchHistoryItem[]
  addToHistory: (query: string, resultCount?: number) => void
  clearHistory: () => void
  removeHistoryItem: (id: string) => void
}

/**
 * useSearchHistory Hook
 *
 * Custom hook for managing search history with localStorage persistence
 *
 * Features:
 * - Stores last 10 search queries
 * - Persists to localStorage
 * - Prevents duplicate entries
 * - Automatically sorts by timestamp (newest first)
 *
 * @returns Search history state and management functions
 *
 * @example
 * ```tsx
 * const { history, addToHistory, clearHistory, removeHistoryItem } = useSearchHistory()
 *
 * // Add search to history
 * addToHistory('document.pdf', 42)
 *
 * // Clear all history
 * clearHistory()
 *
 * // Remove specific item
 * removeHistoryItem('history-item-id')
 * ```
 */
export const useSearchHistory = (): UseSearchHistoryReturn => {
  const [history, setHistory] = useState<SearchHistoryItem[]>(() =>
    getLocalStorage<SearchHistoryItem[]>(STORAGE_KEYS.SEARCH_HISTORY, [])
  )

  /**
   * Persist history to localStorage whenever it changes
   */
  useEffect(() => {
    setLocalStorage(STORAGE_KEYS.SEARCH_HISTORY, history)
  }, [history])

  /**
   * Add search query to history
   *
   * - Prevents empty queries
   * - Removes duplicate queries (case-insensitive)
   * - Limits to MAX_HISTORY_ITEMS
   * - Sorts by timestamp (newest first)
   *
   * @param query - Search query string
   * @param resultCount - Optional number of results found
   */
  const addToHistory = useCallback((query: string, resultCount?: number) => {
    const trimmedQuery = query.trim()

    // Don't add empty queries
    if (!trimmedQuery) {
      return
    }

    setHistory((prevHistory) => {
      // Remove duplicate query (case-insensitive)
      const filteredHistory = prevHistory.filter(
        (item) => item.query.toLowerCase() !== trimmedQuery.toLowerCase()
      )

      // Create new history item
      const newItem: SearchHistoryItem = {
        id: `history-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        query: trimmedQuery,
        timestamp: Date.now(),
        resultCount,
      }

      // Add to beginning and limit to MAX_HISTORY_ITEMS
      const newHistory = [newItem, ...filteredHistory].slice(0, MAX_HISTORY_ITEMS)

      return newHistory
    })
  }, [])

  /**
   * Clear all search history
   */
  const clearHistory = useCallback(() => {
    setHistory([])
  }, [])

  /**
   * Remove specific history item by ID
   *
   * @param id - History item ID to remove
   */
  const removeHistoryItem = useCallback((id: string) => {
    setHistory((prevHistory) => prevHistory.filter((item) => item.id !== id))
  }, [])

  return {
    history,
    addToHistory,
    clearHistory,
    removeHistoryItem,
  }
}
