/**
 * Custom hook for toast notifications
 * Wrapper around sonner toast library with pre-configured settings
 */

import { toast as sonnerToast, type ExternalToast } from 'sonner'

/**
 * Toast notification types
 */
export type ToastType = 'success' | 'error' | 'warning' | 'info'

/**
 * Toast configuration
 */
export interface ToastConfig {
  /**
   * Toast message (required)
   */
  message: string

  /**
   * Optional description/details
   */
  description?: string

  /**
   * Duration in milliseconds (default: auto-calculated based on type)
   */
  duration?: number

  /**
   * Action button configuration
   */
  action?: {
    label: string
    onClick: () => void
  }

  /**
   * Cancel button configuration
   */
  cancel?: {
    label: string
    onClick?: () => void
  }
}

/**
 * Default durations for each toast type
 */
const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 3000,
  info: 3000,
  warning: 5000,
  error: Infinity, // User must close manually
}

/**
 * Create toast with consistent configuration
 */
const createToast = (type: ToastType, config: ToastConfig) => {
  const { message, description, duration, action, cancel } = config

  const options: ExternalToast = {
    description,
    duration: duration ?? DEFAULT_DURATIONS[type],
    action: action
      ? {
          label: action.label,
          onClick: action.onClick,
        }
      : undefined,
    cancel: cancel
      ? {
          label: cancel.label,
          onClick: cancel.onClick,
        }
      : undefined,
  }

  switch (type) {
    case 'success':
      return sonnerToast.success(message, options)
    case 'error':
      return sonnerToast.error(message, options)
    case 'warning':
      return sonnerToast.warning(message, options)
    case 'info':
      return sonnerToast.info(message, options)
  }
}

/**
 * Custom toast hook
 *
 * Usage:
 * ```tsx
 * const toast = useToast()
 *
 * toast.success('Operation completed successfully!')
 * toast.error('An error occurred', { description: 'Please try again' })
 * toast.warning('No results found', { duration: 5000 })
 * toast.info('Processing...', { description: 'This may take a while' })
 * ```
 */
export const useToast = () => ({
  /**
   * Show success toast (green, auto-dismiss after 3s)
   */
  success: (message: string, options?: Omit<ToastConfig, 'message'>) =>
    createToast('success', { message, ...options }),

  /**
   * Show error toast (red, manual dismiss required)
   */
  error: (message: string, options?: Omit<ToastConfig, 'message'>) =>
    createToast('error', { message, ...options }),

  /**
   * Show warning toast (yellow, auto-dismiss after 5s)
   */
  warning: (message: string, options?: Omit<ToastConfig, 'message'>) =>
    createToast('warning', { message, ...options }),

  /**
   * Show info toast (blue, auto-dismiss after 3s)
   */
  info: (message: string, options?: Omit<ToastConfig, 'message'>) =>
    createToast('info', { message, ...options }),

  /**
   * Dismiss a specific toast by ID
   */
  dismiss: (toastId?: string | number) => sonnerToast.dismiss(toastId),

  /**
   * Show a loading toast
   */
  loading: (message: string, options?: Omit<ToastConfig, 'message'>) =>
    sonnerToast.loading(message, {
      description: options?.description,
    }),

  /**
   * Promise-based toast for async operations
   */
  promise: <T>(
    promise: Promise<T>,
    messages: {
      loading: string
      success: string | ((data: T) => string)
      error: string | ((error: Error) => string)
    }
  ) => sonnerToast.promise(promise, messages),
})
