/**
 * ログインフォームコンポーネント
 *
 * ユーザー名とパスワードでログイン
 */

'use client'

import { FC, useState, FormEvent } from 'react'

import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/contexts/AuthContext'
import { getCognitoErrorMessage } from '@/utils/authErrors'
import { validateEmail, validatePassword } from '@/utils/validation'

// ========================================
// Types
// ========================================

interface LoginFormProps {
  /** パスワード忘れリンククリック時のコールバック */
  onForgotPassword: () => void
  /** 新しいパスワードが必要な時のコールバック */
  onNewPasswordRequired: () => void
}

// ========================================
// Component
// ========================================

export const LoginForm: FC<LoginFormProps> = ({ onForgotPassword, onNewPasswordRequired }) => {
  const { login } = useAuth()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  /**
   * フォーム送信ハンドラ
   */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setEmailError(null)
    setPasswordError(null)

    // バリデーション
    const emailValidation = validateEmail(email)
    const passwordValidation = validatePassword(password)

    let hasError = false

    if (!emailValidation.isValid) {
      setEmailError(emailValidation.error)
      hasError = true
    }

    if (!passwordValidation.isValid) {
      setPasswordError(passwordValidation.error)
      hasError = true
    }

    if (hasError) return

    setIsLoading(true)

    try {
      const result = await login(email, password)

      if (result.success) {
        // ログイン成功 → 検索画面にリダイレクト
        router.push('/search')
      } else if (result.requiresNewPassword) {
        // 新しいパスワード必要 → 新規パスワード設定画面へ
        onNewPasswordRequired()
      } else if (result.requiresMFA) {
        // MFA必要 → MFA画面へ（今回は未実装）
        setError('MFA認証が必要です。（未実装）')
      }
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
          CIS ファイル検索システム
        </h2>
        <p className="mt-2 text-sm text-center text-[#6E6E73] dark:text-[#98989D]">
          ログインするにはメールアドレスとパスワードを入力してください
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
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          }
        />

        {/* Password Input */}
        <Input
          label="パスワード"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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

        {/* Submit Button */}
        <Button type="submit" disabled={isLoading} loading={isLoading} className="w-full">
          {isLoading ? 'ログイン中...' : 'ログイン'}
        </Button>

        {/* Forgot Password Link */}
        <div className="text-center">
          <button
            type="button"
            onClick={onForgotPassword}
            className="text-sm text-[#007AFF] dark:text-[#0A84FF] hover:underline"
            disabled={isLoading}
          >
            パスワードを忘れた方
          </button>
        </div>
      </form>

      {/* Footer */}
      <p className="text-xs text-center text-[#6E6E73] dark:text-[#98989D]">
        AWS Cognitoのセキュアな認証システムを使用しています
      </p>
    </div>
  )
}
