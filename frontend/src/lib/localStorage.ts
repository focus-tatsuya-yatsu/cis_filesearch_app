/**
 * LocalStorage Utilities
 *
 * Safe localStorage access with error handling and TypeScript support
 * Handles cases where localStorage is unavailable (SSR, disabled, quota exceeded)
 */

/**
 * Storage keys used throughout the application
 */
export const STORAGE_KEYS = {
  SEARCH_HISTORY: 'cis_search_history',
  SIDEBAR_STATE: 'cis_sidebar_collapsed',
  FILTER_PREFERENCES: 'cis_filter_preferences',
} as const

/**
 * Check if localStorage is available
 *
 * @returns true if localStorage is available and functional
 */
export const isLocalStorageAvailable = (): boolean => {
  try {
    const testKey = '__localStorage_test__'
    localStorage.setItem(testKey, 'test')
    localStorage.removeItem(testKey)
    return true
  } catch {
    return false
  }
}

/**
 * Get item from localStorage with type safety
 *
 * @param key - Storage key
 * @param defaultValue - Default value if key doesn't exist or parsing fails
 * @returns Parsed value or default value
 */
export const getLocalStorage = <T>(key: string, defaultValue: T): T => {
  if (!isLocalStorageAvailable()) {
    return defaultValue
  }

  try {
    const item = localStorage.getItem(key)
    if (item === null) {
      return defaultValue
    }
    return JSON.parse(item) as T
  } catch (error) {
    console.error(`Error reading localStorage key "${key}":`, error)
    return defaultValue
  }
}

/**
 * Set item in localStorage with error handling
 *
 * @param key - Storage key
 * @param value - Value to store (will be JSON stringified)
 * @returns true if successful, false otherwise
 */
export const setLocalStorage = <T>(key: string, value: T): boolean => {
  if (!isLocalStorageAvailable()) {
    return false
  }

  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (error) {
    console.error(`Error writing to localStorage key "${key}":`, error)
    return false
  }
}

/**
 * Remove item from localStorage
 *
 * @param key - Storage key
 * @returns true if successful, false otherwise
 */
export const removeLocalStorage = (key: string): boolean => {
  if (!isLocalStorageAvailable()) {
    return false
  }

  try {
    localStorage.removeItem(key)
    return true
  } catch (error) {
    console.error(`Error removing localStorage key "${key}":`, error)
    return false
  }
}

/**
 * Clear all localStorage items
 *
 * @returns true if successful, false otherwise
 */
export const clearLocalStorage = (): boolean => {
  if (!isLocalStorageAvailable()) {
    return false
  }

  try {
    localStorage.clear()
    return true
  } catch (error) {
    console.error('Error clearing localStorage:', error)
    return false
  }
}
