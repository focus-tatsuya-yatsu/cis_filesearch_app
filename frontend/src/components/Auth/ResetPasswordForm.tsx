/**
 * パスワードリセットフォームコンポーネント
 *
 * 検証コードと新しいパスワードを入力してパスワードをリセット
 */

'use client'

import { FC, useState, FormEvent } from 'react'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/contexts/AuthContext'
import { getCognitoErrorMessage } from '@/utils/authErrors'
import { validatePassword, validatePasswordConfirmation, validateVerificationCode } from '@/utils/validation'

// ========================================
// Types
// ========================================

interface ResetPasswordFormProps {
  /** ユーザー名またはメールアドレス */
  username: string
  /** リセット成功時のコールバック */
  onSuccess: () => void
  /** 戻るボタンのコールバック */
  onBack: () => void
}

// ========================================
// Component
// ========================================

export const ResetPasswordForm: FC<ResetPasswordFormProps> = ({ username, onSuccess, onBack }) => {
  const { confirmPasswordReset } = useAuth()

  const [verificationCode, setVerificationCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [codeError, setCodeError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null)

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  /**
   * フォーム送信ハンドラ
   */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccessMessage('')
    setCodeError(null)
    setPasswordError(null)
    setConfirmPasswordError(null)

    // バリデーション
    const codeValidation = validateVerificationCode(verificationCode)
    const passwordValidation = validatePassword(newPassword)
    const confirmPasswordValidation = validatePasswordConfirmation(newPassword, confirmPassword)

    let hasError = false

    if (!codeValidation.isValid) {
      setCodeError(codeValidation.error)
      hasError = true
    }

    if (!passwordValidation.isValid) {
      setPasswordError(passwordValidation.error)
      hasError = true
    }

    if (!confirmPasswordValidation.isValid) {
      setConfirmPasswordError(confirmPasswordValidation.error)
      hasError = true
    }

    if (hasError) return

    setIsLoading(true)

    try {
      await confirmPasswordReset(username, verificationCode, newPassword)
      setSuccessMessage('パスワードが正常にリセットされました。ログイン画面に戻ります。')

      // 2秒後にログイン画面に戻る
      setTimeout(() => {
        onSuccess()
      }, 2000)
    } catch (err) {
      const errorMessage = getCognitoErrorMessage(err)
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-center text-[#1D1D1F] dark:text-[#F5F5F7]">
          パスワードをリセット
        </h2>
        <p className="mt-2 text-sm text-center text-[#6E6E73] dark:text-[#98989D]">
          メールで受信した検証コードと新しいパスワードを入力してください
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Success Message */}
        {successMessage && (
          <div className="bg-[#34C759]/10 dark:bg-[#30D158]/10 border border-[#34C759] dark:border-[#30D158] rounded-xl p-4">
            <p className="text-sm text-[#34C759] dark:text-[#30D158]">{successMessage}</p>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-[#FF3B30]/10 dark:bg-[#FF453A]/10 border border-[#FF3B30] dark:border-[#FF453A] rounded-xl p-4">
            <p className="text-sm text-[#FF3B30] dark:text-[#FF453A]">{error}</p>
          </div>
        )}

        {/* Verification Code Input */}
        <Input
          label="検証コード"
          type="text"
          placeholder="123456"
          value={verificationCode}
          onChange={(e) => setVerificationCode(e.target.value)}
          error={codeError ?? undefined}
          disabled={isLoading}
          maxLength={6}
          required
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

        {/* New Password Input */}
        <Input
          label="新しいパスワード"
          type="password"
          placeholder="••••••••"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          error={passwordError ?? undefined}
          disabled={isLoading}
          required
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
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          }
        />

        {/* Confirm Password Input */}
        <Input
          label="パスワード確認"
          type="password"
          placeholder="••••••••"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={confirmPasswordError ?? undefined}
          disabled={isLoading}
          required
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

        {/* Password Requirements */}
        <div className="bg-[#F5F5F7] dark:bg-[#1C1C1E] rounded-xl p-3">
          <p className="text-xs text-[#6E6E73] dark:text-[#98989D] mb-2">
            パスワードの要件:
          </p>
          <ul className="text-xs text-[#6E6E73] dark:text-[#98989D] space-y-1">
            <li>• 8文字以上</li>
            <li>• 小文字を含む</li>
            <li>• 大文字を含む</li>
            <li>• 数字を含む</li>
            <li>• 記号を含む</li>
          </ul>
        </div>

        {/* Submit Button */}
        <Button type="submit" disabled={isLoading} loading={isLoading} className="w-full">
          {isLoading ? 'リセット中...' : 'パスワードをリセット'}
        </Button>

        {/* Back Button */}
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={isLoading}
          className="w-full"
        >
          前の画面に戻る
        </Button>
      </form>
    </div>
  )
}
