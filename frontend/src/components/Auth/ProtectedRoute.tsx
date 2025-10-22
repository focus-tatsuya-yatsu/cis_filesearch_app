/**
 * 保護されたルートコンポーネント
 *
 * 認証が必要なページで使用し、未認証の場合はログインページにリダイレクト
 */

'use client'

import { useEffect, FC, ReactNode } from 'react'

import { useRouter } from 'next/navigation'

import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/contexts/AuthContext'

interface ProtectedRouteProps {
  children: ReactNode
  /** リダイレクト先のパス（デフォルト: /login） */
  redirectTo?: string
}

export const ProtectedRoute: FC<ProtectedRouteProps> = ({ children, redirectTo = '/login' }) => {
  const { isAuthenticated, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    // ローディング完了後、未認証の場合はログインページへリダイレクト
    if (!isLoading && !isAuthenticated) {
      router.push(redirectTo)
    }
  }, [isAuthenticated, isLoading, router, redirectTo])

  // ローディング中はスピナー表示
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center space-y-4">
          <Spinner size="lg" />
          <p className="text-sm text-gray-600">認証情報を確認中...</p>
        </div>
      </div>
    )
  }

  // 未認証の場合は何も表示しない（リダイレクト中）
  if (!isAuthenticated) {
    return null
  }

  // 認証済みの場合は子コンポーネントを表示
  return <>{children}</>
}
