/**
 * 検索ページレイアウト（Protected Route）
 *
 * 認証済みユーザーのみアクセス可能
 * 未認証の場合はトップページにリダイレクトします
 */

'use client'

import { useEffect, useState, FC, ReactNode } from 'react'

import { useRouter } from 'next/navigation'

import { useAuth } from '@/contexts/AuthContext'

interface ProtectedLayoutProps {
  children: ReactNode
}

/**
 * Spinnerコンポーネント
 *
 * 認証状態確認中に表示するスピナー
 */
const Spinner: FC = () => (
  <div className="flex min-h-screen items-center justify-center">
    <div className="space-y-4 text-center">
      <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600"></div>
      <p className="text-sm text-gray-600">認証状態を確認中...</p>
    </div>
  </div>
)

/**
 * Protected Route レイアウト
 *
 * @remarks
 * 認証ガードとして機能し、未認証ユーザーをトップページにリダイレクトします
 */
const ProtectedLayout: FC<ProtectedLayoutProps> = ({ children }) => {
  const router = useRouter()
  const { isAuthenticated, isLoading } = useAuth()
  const [mounted, setMounted] = useState(false)

  // クライアントサイドマウント検知
  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    // ローディング完了後、未認証の場合はトップページへリダイレクト
    if (!isLoading && !isAuthenticated) {
      router.push('/')
    }
  }, [isAuthenticated, isLoading, router])

  // SSG flash content防止: 初回レンダリング時は必ずスピナー表示
  if (!mounted || isLoading) {
    return <Spinner />
  }

  // 未認証の場合は何も表示しない（リダイレクト処理中）
  if (!isAuthenticated) {
    return null
  }

  // 認証済みの場合は子コンポーネントを表示
  return <>{children}</>
}

export default ProtectedLayout
