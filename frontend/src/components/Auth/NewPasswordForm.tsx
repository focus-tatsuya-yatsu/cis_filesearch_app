/**
 * 新しいパスワード設定フォームコンポーネント
 *
 * 初回ログイン時のNEW_PASSWORD_REQUIRED challengeに対応します。
 * Apple Human Interface Guidelinesに基づいた洗練されたUIデザインを提供します。
 */

'use client'

import { FC, useState, FormEvent, useEffect, useRef } from 'react'

import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PasswordStrengthIndicator } from '@/components/ui/PasswordStrengthIndicator'
import { useAuth } from '@/contexts/AuthContext'
import { getCognitoErrorMessage } from '@/utils/authErrors'
import { validatePassword, validatePasswordConfirmation } from '@/utils/validation'

// ========================================
// Types
// ========================================

interface NewPasswordFormProps {
  /** ログインに戻るコールバック */
  onBack: () => void
}

// ========================================
// Component
// ========================================

export const NewPasswordForm: FC<NewPasswordFormProps> = ({ onBack }) => {
  const { confirmNewPassword } = useAuth()
  const router = useRouter()

  // Refs
  const newPasswordRef = useRef<HTMLInputElement>(null)

  // Form state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Validation state
  const [newPasswordError, setNewPasswordError] = useState<string | null>(null)
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null)

  // UI state
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // Auto-focus on mount
  useEffect(() => {
    newPasswordRef.current?.focus()
  }, [])

  /**
   * 新しいパスワード変更ハンドラ
   */
  const handleNewPasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target
    setNewPassword(value)
    setNewPasswordError(null)

    // 確認パスワードとの照合
    if (confirmPassword && value !== confirmPassword) {
      setConfirmPasswordError('パスワードが一致しません')
    } else {
      setConfirmPasswordError(null)
    }
  }

  /**
   * 確認パスワード変更ハンドラ
   */
  const handleConfirmPasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target
    setConfirmPassword(value)
    setConfirmPasswordError(null)

    if (value && newPassword !== value) {
      setConfirmPasswordError('パスワードが一致しません')
    }
  }

  /**
   * フォーム送信ハンドラ
   */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccessMessage('')
    setNewPasswordError(null)
    setConfirmPasswordError(null)

    // バリデーション
    const passwordValidation = validatePassword(newPassword)
    const confirmValidation = validatePasswordConfirmation(newPassword, confirmPassword)

    let hasError = false

    if (!passwordValidation.isValid) {
      setNewPasswordError(passwordValidation.error)
      hasError = true
    }

    if (!confirmValidation.isValid) {
      setConfirmPasswordError(confirmValidation.error)
      hasError = true
    }

    if (hasError) return

    setIsLoading(true)

    try {
      await confirmNewPassword(newPassword)

      // パスワード設定成功メッセージ
      setSuccessMessage('パスワードが正常に設定されました')

      // 3秒後に検索画面にリダイレクト
      setTimeout(() => {
        router.push('/search')
      }, 3000)
    } catch (err) {
      const errorMessage = getCognitoErrorMessage(err)
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <motion.div
      className="w-full max-w-md space-y-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center justify-center gap-2">
          <h2 className="text-2xl font-bold text-center text-[#1D1D1F] dark:text-[#F5F5F7]">
            パスワードを変更してください
          </h2>
          <span className="inline-flex items-center px-2 py-1 rounded-md bg-[#007AFF]/10 dark:bg-[#0A84FF]/10 text-xs font-medium text-[#007AFF] dark:text-[#0A84FF]">
            初回ログイン
          </span>
        </div>
        <p className="text-sm text-center text-[#6E6E73] dark:text-[#98989D]">
          管理者から付与された仮パスワードを新しいパスワードに変更する必要があります。
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4" aria-label="新しいパスワード設定フォーム">
        {/* Success Message */}
        <AnimatePresence>
          {successMessage && (
            <motion.div
              className="bg-[#34C759]/10 dark:bg-[#32D74B]/10 border border-[#34C759] dark:border-[#32D74B] rounded-xl p-4"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3 }}
              role="alert"
              aria-live="polite"
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[#34C759] dark:bg-[#32D74B] flex items-center justify-center">
                  <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-[#34C759] dark:text-[#32D74B]">
                    {successMessage}
                  </p>
                  <p className="mt-1 text-xs text-[#6E6E73] dark:text-[#98989D]">
                    3秒後に検索画面に移動します...
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error Message */}
        <AnimatePresence>
          {error && (
            <motion.div
              className="bg-[#FF3B30]/10 dark:bg-[#FF453A]/10 border border-[#FF3B30] dark:border-[#FF453A] rounded-xl p-4"
              initial={{ opacity: 0, x: 0 }}
              animate={{
                opacity: 1,
                x: [0, -8, 8, -4, 4, 0],
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              role="alert"
              aria-live="assertive"
            >
              <p className="text-sm text-[#FF3B30] dark:text-[#FF453A]">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Info Alert */}
        <motion.div
          className="bg-[#007AFF]/10 dark:bg-[#0A84FF]/10 border border-[#007AFF] dark:border-[#0A84FF] rounded-xl p-4"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.3 }}
        >
          <div className="flex gap-3">
            <svg
              className="h-5 w-5 text-[#007AFF] dark:text-[#0A84FF] flex-shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-sm text-[#007AFF] dark:text-[#0A84FF]">
              仮パスワードでのログインを検出しました。セキュリティのため、新しいパスワードを設定してください。
            </p>
          </div>
        </motion.div>

        {/* New Password Input */}
        <div className="space-y-2">
          <Input
            ref={newPasswordRef}
            label="新しいパスワード"
            type="password"
            placeholder="••••••••"
            value={newPassword}
            onChange={handleNewPasswordChange}
            error={newPasswordError ?? undefined}
            disabled={isLoading}
            required
            autoComplete="new-password"
            aria-describedby="password-strength"
            aria-invalid={!!newPasswordError}
            icon={
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                />
              </svg>
            }
          />

          {/* Password Strength Indicator */}
          <div id="password-strength">
            <PasswordStrengthIndicator password={newPassword} />
          </div>
        </div>

        {/* Confirm Password Input */}
        <div className="relative">
          <Input
            label="新しいパスワード (確認)"
            type="password"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={handleConfirmPasswordChange}
            error={confirmPasswordError ?? undefined}
            disabled={isLoading}
            required
            autoComplete="new-password"
            aria-invalid={!!confirmPasswordError}
            icon={
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            }
          />

          {/* Password match indicator */}
          <AnimatePresence>
            {confirmPassword && newPassword && (
              <motion.div
                className="absolute right-3 top-10"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
              >
                {newPassword === confirmPassword ? (
                  <svg
                    className="w-5 h-5 text-[#34C759] dark:text-[#32D74B]"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-5 h-5 text-[#FF3B30] dark:text-[#FF453A]"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Submit Button */}
        <Button
          type="submit"
          disabled={isLoading || !!successMessage}
          loading={isLoading}
          className="w-full"
        >
          {isLoading ? 'パスワード設定中...' : 'パスワードを設定'}
        </Button>

        {/* Back to Login Link */}
        <div className="text-center">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-[#007AFF] dark:text-[#0A84FF] hover:underline transition-colors"
            disabled={isLoading || !!successMessage}
          >
            ログイン画面に戻る
          </button>
        </div>
      </form>

      {/* Footer */}
      <p className="text-xs text-center text-[#6E6E73] dark:text-[#98989D]">
        パスワードは安全に保管し、他の人と共有しないでください
      </p>
    </motion.div>
  )
}
