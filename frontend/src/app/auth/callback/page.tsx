/**
 * OAuth 2.0 認証コールバックページ
 *
 * Cognito Hosted UIでの認証完了後、このページにリダイレクトされます。
 * 認証状態を確認して、適切なページへリダイレクトします。
 */

'use client'

import { useEffect, FC } from 'react'

import { useRouter } from 'next/navigation'

import { useAuth } from '@/contexts/AuthContext'

/**
 * Spinnerコンポーネント
 *
 * ローディング中に表示するスピナー
 */
const Spinner: FC = () => (
  <div className="flex min-h-screen items-center justify-center">
    <div className="space-y-4 text-center">
      <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600"></div>
      <p className="text-sm text-gray-600">認証処理中...</p>
    </div>
  </div>
)

/**
 * 認証コールバックページ
 *
 * @remarks
 * OAuth 2.0 Authorization Code Grant フローの最終ステップ
 * Cognitoから認証コードを受け取り、トークンと交換します
 */
const AuthCallbackPage: FC = () => {
  const router = useRouter()
  const { isAuthenticated, isLoading } = useAuth()

  useEffect(() => {
    // ローディング完了後、認証状態に応じてリダイレクト
    if (!isLoading) {
      if (isAuthenticated) {
        // 認証成功 → 検索ページへ
        router.push('/search')
      } else {
        // 認証失敗 → トップページへ
        router.push('/')
      }
    }
  }, [isAuthenticated, isLoading, router])

  return <Spinner />
}

export default AuthCallbackPage
