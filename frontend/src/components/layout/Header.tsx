/**
 * Header Component
 *
 * アプリケーション全体のヘッダー
 * - AWS Cognito認証統合
 * - ユーザーメニュー（認証済み）
 * - ログインボタン（未認証）
 */

'use client'

import { FC, useState, useCallback } from 'react'

import { Search, Settings, Bell, User } from 'lucide-react'

import { Button, DownloadButton } from '@/components/ui'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { SyncButton } from '@/components/sync'
import { useAuth } from '@/contexts/AuthContext'

import { UserMenu } from './UserMenu'

// ========================================
// Component
// ========================================

export const Header: FC = () => {
  const { isAuthenticated, isLoading, user, loginWithHostedUI, logout } = useAuth()
  const [isLoggingIn, setIsLoggingIn] = useState(false)

  /**
   * Hosted UIでログイン
   */
  const handleLogin = useCallback(async () => {
    try {
      setIsLoggingIn(true)
      await loginWithHostedUI()
    } catch (error) {
      console.error('❌ ログインに失敗しました:', error)
      // TODO: エラートースト表示
      setIsLoggingIn(false)
    }
    // Note: リダイレクトされるため、setIsLoggingIn(false)は不要
  }, [loginWithHostedUI])

  /**
   * ログアウト処理
   */
  const handleLogout = useCallback(async () => {
    try {
      await logout()
      console.log('✅ ログアウトしました')
      // TODO: 成功トースト表示
    } catch (error) {
      console.error('❌ ログアウトに失敗しました:', error)
      // TODO: エラートースト表示
    }
  }, [logout])

  return (
    <header
      className="bg-white/95 dark:bg-[#1C1C1E]/95 backdrop-blur-xl border-b border-[#D1D1D6]/30 dark:border-[#38383A]/30 sticky top-0 z-50"
      role="banner"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* ロゴ・タイトル */}
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-[#007AFF] to-[#0051D5] dark:from-[#0A84FF] dark:to-[#0066FF] rounded-xl p-2 shadow-sm">
              <Search className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#1D1D1F] dark:text-[#F5F5F7]">
                CIS File Search
              </h1>
              <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">
                企業内ファイル検索システム
              </p>
            </div>
          </div>

          {/* ナビゲーション */}
          <nav className="hidden md:flex items-center gap-6" aria-label="メインナビゲーション">
            <button
              type="button"
              className="text-[#6E6E73] dark:text-[#8E8E93] hover:text-[#1D1D1F] dark:hover:text-[#F5F5F7] font-medium transition-colors bg-transparent border-none cursor-pointer"
            >
              ホーム
            </button>
            <button
              type="button"
              className="text-[#6E6E73] dark:text-[#8E8E93] hover:text-[#1D1D1F] dark:hover:text-[#F5F5F7] font-medium transition-colors bg-transparent border-none cursor-pointer"
            >
              検索履歴
            </button>
            <button
              type="button"
              className="text-[#6E6E73] dark:text-[#8E8E93] hover:text-[#1D1D1F] dark:hover:text-[#F5F5F7] font-medium transition-colors bg-transparent border-none cursor-pointer"
            >
              お気に入り
            </button>
            <button
              type="button"
              className="text-[#6E6E73] dark:text-[#8E8E93] hover:text-[#1D1D1F] dark:hover:text-[#F5F5F7] font-medium transition-colors bg-transparent border-none cursor-pointer"
            >
              ヘルプ
            </button>
          </nav>

          {/* アクションボタン */}
          <div className="flex items-center gap-2">
            <DownloadButton
              href="/downloads/CIS-FileHandler-Setup.zip"
              fileName="CIS-FileHandler-Setup"
              label="ダウンロード"
            />
            <ThemeToggle />
            <SyncButton />
            <Button
              variant="ghost"
              size="sm"
              icon={<Bell className="h-5 w-5" />}
              className="text-[#6E6E73] dark:text-[#8E8E93] hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E]"
              aria-label="通知"
            >
              <span className="sr-only">通知</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Settings className="h-5 w-5" />}
              className="text-[#6E6E73] dark:text-[#8E8E93] hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E]"
              aria-label="設定"
            >
              <span className="sr-only">設定</span>
            </Button>
            <div
              className="h-8 w-px bg-[#D1D1D6]/30 dark:bg-[#38383A]/30 mx-2"
              aria-hidden="true"
            />

            {/* 認証状態によって表示を切り替え */}
            {isLoading ? (
              // ローディング中
              <div
                className="h-9 w-24 animate-pulse bg-[#F5F5F7] dark:bg-[#2C2C2E] rounded-lg"
                aria-label="認証状態を確認中"
              />
            ) : isAuthenticated && user ? (
              // 認証済み: ユーザーメニュー
              <UserMenu user={user} onLogout={handleLogout} />
            ) : (
              // 未認証: ログインボタン
              <Button
                variant="outline"
                size="sm"
                icon={<User className="h-5 w-5" />}
                className="border-[#D1D1D6]/30 dark:border-[#38383A]/30 text-[#007AFF] dark:text-[#0A84FF] hover:bg-[#007AFF]/10 dark:hover:bg-[#0A84FF]/10"
                onClick={handleLogin}
                loading={isLoggingIn}
                disabled={isLoggingIn}
                aria-label="ログイン"
              >
                {isLoggingIn ? 'リダイレクト中...' : 'ログイン'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
