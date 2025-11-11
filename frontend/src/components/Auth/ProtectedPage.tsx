/**
 * 認証ガードHOC (Higher-Order Component)
 *
 * ページレベルの認証保護を提供する再利用可能なコンポーネント
 *
 * @example
 * ```tsx
 * const HomePage: FC = () => {
 *   return <div>Protected Content</div>
 * }
 *
 * export default withAuth(HomePage)
 * ```
 */

'use client'

import { FC, ComponentType, ReactNode } from 'react'

import { motion } from 'framer-motion'

import { Spinner } from '@/components/ui'
import { AuthFlowManager } from './AuthFlowManager'
import { useAuth } from '@/contexts/AuthContext'

// ========================================
// Types
// ========================================

interface WithAuthOptions {
  /** ローディング中に表示するカスタムコンポーネント */
  loadingComponent?: ReactNode
  /** 未認証時に表示するカスタムコンポーネント */
  unauthorizedComponent?: ReactNode
  /** リダイレクトモード（true: 自動リダイレクト、false: LoginForm表示） */
  autoRedirect?: boolean
}

// ========================================
// Default Components
// ========================================

/**
 * デフォルトのローディングコンポーネント
 */
const DefaultLoadingComponent: FC = () => (
  <div className="flex min-h-screen items-center justify-center bg-[#F5F5F7] dark:bg-black">
    <div className="space-y-4 text-center">
      <Spinner size="lg" />
      <p className="text-sm text-[#6E6E73] dark:text-[#8E8E93]">認証状態を確認中...</p>
    </div>
  </div>
)

/**
 * デフォルトの未認証コンポーネント
 *
 * 中央配置されたAuthFlowManager（ログイン・パスワードリセット管理）をアニメーション付きで表示
 */
const DefaultUnauthorizedComponent: FC = () => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.3, ease: 'easeOut' }}
  >
    <AuthFlowManager />
  </motion.div>
)

// ========================================
// HOC
// ========================================

/**
 * 認証ガードHOC
 *
 * コンポーネントを認証保護でラップします
 *
 * @param Component - 保護するコンポーネント
 * @param options - 認証ガードのオプション
 * @returns 認証保護されたコンポーネント
 *
 * @remarks
 * - 認証状態確認中: LoadingComponentを表示
 * - 未認証: UnauthorizedComponent（デフォルトはLoginForm）を表示
 * - 認証済み: 元のコンポーネントを表示
 * - autoRedirect=true: 未認証時に自動的にCognito Hosted UIにリダイレクト
 */
export const withAuth = <P extends object>(
  Component: ComponentType<P>,
  options: WithAuthOptions = {}
): FC<P> => {
  const {
    loadingComponent = <DefaultLoadingComponent />,
    unauthorizedComponent = <DefaultUnauthorizedComponent />,
    autoRedirect = false,
  } = options

  const ProtectedComponent: FC<P> = (props) => {
    const { isAuthenticated, isLoading, loginWithHostedUI } = useAuth()

    // ローディング中
    if (isLoading) {
      return <>{loadingComponent}</>
    }

    // 未認証時
    if (!isAuthenticated) {
      // 自動リダイレクトモード
      if (autoRedirect) {
        loginWithHostedUI()
        return <>{loadingComponent}</> // リダイレクト中はローディング表示
      }

      // LoginForm表示モード
      return <>{unauthorizedComponent}</>
    }

    // 認証済み: 元のコンポーネントを表示
    return <Component {...props} />
  }

  // displayNameを設定（React DevToolsでの識別用）
  ProtectedComponent.displayName = `withAuth(${Component.displayName || Component.name || 'Component'})`

  return ProtectedComponent
}

// ========================================
// Utility HOCs
// ========================================

/**
 * 自動リダイレクトモードの認証ガード
 *
 * 未認証ユーザーを自動的にCognito Hosted UIにリダイレクトします
 *
 * @example
 * ```tsx
 * export default withAuthRedirect(HomePage)
 * ```
 */
export const withAuthRedirect = <P extends object>(Component: ComponentType<P>): FC<P> => {
  return withAuth(Component, { autoRedirect: true })
}

/**
 * LoginFormモードの認証ガード
 *
 * 未認証ユーザーにLoginFormを表示します（デフォルト動作）
 *
 * @example
 * ```tsx
 * export default withAuthLoginForm(HomePage)
 * ```
 */
export const withAuthLoginForm = <P extends object>(Component: ComponentType<P>): FC<P> => {
  return withAuth(Component, { autoRedirect: false })
}
