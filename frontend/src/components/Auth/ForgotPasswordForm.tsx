/**
 * パスワード忘れフォームコンポーネント
 *
 * メールアドレスを入力して検証コードを送信
 */

'use client'

import { FC, useState, FormEvent } from 'react'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/contexts/AuthContext'
import { getCognitoErrorMessage } from '@/utils/authErrors'
import { validateEmail } from '@/utils/validation'

// ========================================
// Types
// ========================================

interface ForgotPasswordFormProps {
  /** 検証コード送信成功時のコールバック */
  onCodeSent: (email: string) => void
  /** 戻るボタンのコールバック */
  onBack: () => void
}

// ========================================
// Component
// ========================================

export const ForgotPasswordForm: FC<ForgotPasswordFormProps> = ({ onCodeSent, onBack }) => {
  const { requestPasswordReset } = useAuth()

  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  /**
   * フォーム送信ハンドラ
   */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setEmailError(null)

    // バリデーション
    const emailValidation = validateEmail(email)
    if (!emailValidation.isValid) {
      setEmailError(emailValidation.error)
      return
    }

    setIsLoading(true)

    try {
      await requestPasswordReset(email)
      onCodeSent(email)
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
          パスワードをお忘れですか?
        </h2>
        <p className="mt-2 text-sm text-center text-[#6E6E73] dark:text-[#98989D]">
          登録されているメールアドレスに検証コードを送信します
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Global Error */}
        {error && (
          <div className="bg-[#FF3B30]/10 dark:bg-[#FF453A]/10 border border-[#FF3B30] dark:border-[#FF453A] rounded-xl p-4">
            <p className="text-sm text-[#FF3B30] dark:text-[#FF453A]">{error}</p>
          </div>
        )}

        {/* Email Input */}
        <Input
          label="メールアドレス"
          type="email"
          placeholder="example@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailError ?? undefined}
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
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          }
        />

        {/* Submit Button */}
        <Button type="submit" disabled={isLoading} loading={isLoading} className="w-full">
          {isLoading ? '送信中...' : '検証コードを送信'}
        </Button>

        {/* Back Button */}
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={isLoading}
          className="w-full"
        >
          ログイン画面に戻る
        </Button>
      </form>
    </div>
  )
}
