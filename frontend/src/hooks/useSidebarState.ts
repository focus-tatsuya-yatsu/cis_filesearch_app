import { useState, useCallback, useEffect } from 'react'

import { STORAGE_KEYS, getLocalStorage, setLocalStorage } from '@/lib/localStorage'

/**
 * Return type for useSidebarState hook
 */
export interface UseSidebarStateReturn {
  isCollapsed: boolean
  toggleCollapse: () => void
  setCollapsed: (collapsed: boolean) => void
}

/**
 * useSidebarState Hook
 *
 * Custom hook for managing sidebar collapse state with localStorage persistence
 *
 * Features:
 * - Tracks sidebar collapsed/expanded state
 * - Persists state to localStorage
 * - Provides toggle and direct setter functions
 *
 * @param defaultCollapsed - Default collapsed state (default: false)
 * @returns Sidebar collapse state and management functions
 *
 * @example
 * ```tsx
 * const { isCollapsed, toggleCollapse, setCollapsed } = useSidebarState()
 *
 * // Toggle sidebar
 * <button onClick={toggleCollapse}>Toggle</button>
 *
 * // Direct control
 * <button onClick={() => setCollapsed(true)}>Collapse</button>
 * ```
 */
export const useSidebarState = (defaultCollapsed: boolean = false): UseSidebarStateReturn => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() =>
    getLocalStorage<boolean>(STORAGE_KEYS.SIDEBAR_STATE, defaultCollapsed)
  )

  /**
   * Persist state to localStorage whenever it changes
   */
  useEffect(() => {
    setLocalStorage(STORAGE_KEYS.SIDEBAR_STATE, isCollapsed)
  }, [isCollapsed])

  /**
   * Toggle sidebar collapse state
   */
  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev)
  }, [])

  /**
   * Set sidebar collapse state directly
   *
   * @param collapsed - New collapsed state
   */
  const setCollapsed = useCallback((collapsed: boolean) => {
    setIsCollapsed(collapsed)
  }, [])

  return {
    isCollapsed,
    toggleCollapse,
    setCollapsed,
  }
}
