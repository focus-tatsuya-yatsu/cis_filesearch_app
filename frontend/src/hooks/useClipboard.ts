/**
 * useClipboard Custom Hook
 *
 * Extracted from SearchResultCard.tsx for reusability.
 * Provides clipboard copy functionality with success state and error handling.
 *
 * Performance Optimization: useCallback applied
 * - copyToClipboard function has stable reference
 * - Prevents unnecessary re-renders in components using this hook
 * - Dependencies: [timeout] (configuration value)
 */

import { useState, useCallback } from 'react'

/**
 * Return type for useClipboard hook
 */
interface UseClipboardReturn {
  /** Whether the copy operation was recently successful */
  copied: boolean
  /** Function to copy text to clipboard */
  copyToClipboard: (text: string) => Promise<void>
  /** Error object if copy operation failed */
  error: Error | null
}

/**
 * Custom hook for clipboard operations with success feedback
 *
 * @param timeout - Duration in milliseconds to show "copied" state (default: 2000ms)
 * @returns Object with copied state, copy function, and error state
 *
 * @example
 * ```tsx
 * const { copied, copyToClipboard, error } = useClipboard()
 *
 * <button onClick={() => copyToClipboard(filePath)}>
 *   <Copy />
 * </button>
 * {copied && <span>コピーしました！</span>}
 * {error && <span>エラー: {error.message}</span>}
 * ```
 *
 * @example
 * ```tsx
 * // Custom timeout (5 seconds)
 * const { copied, copyToClipboard } = useClipboard(5000)
 *
 * <button onClick={() => copyToClipboard('Hello, World!')}>
 *   Copy Text
 * </button>
 * {copied && <span className="success">Copied!</span>}
 * ```
 */
export const useClipboard = (timeout = 2000): UseClipboardReturn => {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  /**
   * Copy text to clipboard
   *
   * Performance: useCallback ensures stable function reference
   * - Prevents re-creation on every render
   * - Only recreates if timeout changes
   */
  const copyToClipboard = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setError(null)

        // Reset copied state after timeout
        setTimeout(() => {
          setCopied(false)
        }, timeout)
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to copy to clipboard')
        setError(error)
        console.error('Failed to copy to clipboard:', err)
      }
    },
    [timeout]
  )

  return {
    copied,
    copyToClipboard,
    error,
  }
}
