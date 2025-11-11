/**
 * 認証フロー管理コンポーネント
 *
 * ログイン → パスワード忘れ → パスワードリセット の状態遷移を管理
 */

'use client'

import { FC, useState } from 'react'

import { LoginForm } from './LoginForm'
import { ForgotPasswordForm } from './ForgotPasswordForm'
import { ResetPasswordForm } from './ResetPasswordForm'
import { NewPasswordForm } from './NewPasswordForm'

// ========================================
// Types
// ========================================

/**
 * 認証フローの状態
 */
type AuthFlow = 'login' | 'forgot-password' | 'reset-password' | 'new-password'

// ========================================
// Component
// ========================================

export const AuthFlowManager: FC = () => {
  const [currentFlow, setCurrentFlow] = useState<AuthFlow>('login')
  const [userEmail, setUserEmail] = useState('')

  /**
   * パスワード忘れフローへ遷移
   */
  const handleForgotPassword = () => {
    setCurrentFlow('forgot-password')
  }

  /**
   * 新しいパスワード設定フローへ遷移
   */
  const handleNewPasswordRequired = () => {
    setCurrentFlow('new-password')
  }

  /**
   * 検証コード送信成功時
   * パスワードリセットフローへ遷移
   */
  const handleCodeSent = (email: string) => {
    setUserEmail(email)
    setCurrentFlow('reset-password')
  }

  /**
   * パスワードリセット成功時
   * ログインフローへ戻る
   */
  const handleResetSuccess = () => {
    setUserEmail('')
    setCurrentFlow('login')
  }

  /**
   * ログインフローへ戻る
   */
  const handleBackToLogin = () => {
    setUserEmail('')
    setCurrentFlow('login')
  }

  /**
   * パスワード忘れフローへ戻る
   */
  const handleBackToForgotPassword = () => {
    setCurrentFlow('forgot-password')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#F5F5F7] to-[#E5E5EA] dark:from-[#000000] dark:to-[#1C1C1E] p-4">
      <div className="w-full max-w-md">
        {/* ログインフォーム */}
        {currentFlow === 'login' && (
          <LoginForm
            onForgotPassword={handleForgotPassword}
            onNewPasswordRequired={handleNewPasswordRequired}
          />
        )}

        {/* 新しいパスワード設定フォーム */}
        {currentFlow === 'new-password' && <NewPasswordForm onBack={handleBackToLogin} />}

        {/* パスワード忘れフォーム */}
        {currentFlow === 'forgot-password' && (
          <ForgotPasswordForm onCodeSent={handleCodeSent} onBack={handleBackToLogin} />
        )}

        {/* パスワードリセットフォーム */}
        {currentFlow === 'reset-password' && (
          <ResetPasswordForm
            username={userEmail}
            onSuccess={handleResetSuccess}
            onBack={handleBackToForgotPassword}
          />
        )}
      </div>
    </div>
  )
}
