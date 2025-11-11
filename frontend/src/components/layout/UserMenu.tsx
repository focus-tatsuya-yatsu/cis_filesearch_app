/**
 * UserMenu Component
 *
 * 認証済みユーザー向けのドロップダウンメニュー
 * - ユーザー情報表示
 * - マイページ、設定、ログアウトメニュー
 */

'use client'

import { FC, useState, useRef, useEffect } from 'react'
import { User, Settings as SettingsIcon, LogOut, ChevronDown } from 'lucide-react'
import { AuthUser } from 'aws-amplify/auth'

// ========================================
// Types
// ========================================

interface UserMenuProps {
  /** 現在のユーザー */
  user: AuthUser
  /** ログアウトハンドラー */
  onLogout: () => void
}

// ========================================
// Component
// ========================================

export const UserMenu: FC<UserMenuProps> = ({ user, onLogout }) => {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // ユーザー表示名を取得（email または username）
  const displayName = user.signInDetails?.loginId || user.username || 'ユーザー'

  /**
   * メニュー外クリックで閉じる
   */
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  /**
   * Escapeキーでメニューを閉じる
   */
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  const toggleMenu = () => {
    setIsOpen((prev) => !prev)
  }

  const handleLogout = () => {
    setIsOpen(false)
    onLogout()
  }

  return (
    <div className="relative" ref={menuRef}>
      {/* トグルボタン */}
      <button
        type="button"
        onClick={toggleMenu}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#D1D1D6]/30 dark:border-[#38383A]/30 text-[#1D1D1F] dark:text-[#F5F5F7] hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#007AFF] dark:focus:ring-[#0A84FF] focus:ring-offset-2"
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-label="ユーザーメニュー"
      >
        {/* ユーザーアバター */}
        <div className="flex items-center justify-center h-7 w-7 rounded-full bg-gradient-to-br from-[#007AFF] to-[#0051D5] dark:from-[#0A84FF] dark:to-[#0066FF]">
          <User className="h-4 w-4 text-white" />
        </div>

        {/* ユーザー名 */}
        <span className="text-sm font-medium max-w-[120px] truncate hidden sm:inline">
          {displayName}
        </span>

        {/* 展開アイコン */}
        <ChevronDown
          className={`h-4 w-4 text-[#6E6E73] dark:text-[#8E8E93] transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* ドロップダウンメニュー */}
      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-56 bg-white dark:bg-[#1C1C1E] rounded-xl border border-[#D1D1D6]/30 dark:border-[#38383A]/30 shadow-lg overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200"
          role="menu"
          aria-orientation="vertical"
          aria-labelledby="user-menu-button"
        >
          {/* ユーザー情報 */}
          <div className="px-4 py-3 border-b border-[#D1D1D6]/30 dark:border-[#38383A]/30">
            <p className="text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7] truncate">
              {displayName}
            </p>
            <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93] mt-0.5">
              {user.signInDetails?.loginId || 'ログイン済み'}
            </p>
          </div>

          {/* メニュー項目 */}
          <div className="py-1">
            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#1D1D1F] dark:text-[#F5F5F7] hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E] transition-colors duration-150"
              role="menuitem"
              onClick={() => {
                setIsOpen(false)
                // TODO: マイページへのナビゲーション
                console.log('Navigate to My Page')
              }}
            >
              <User className="h-4 w-4 text-[#6E6E73] dark:text-[#8E8E93]" />
              <span>マイページ</span>
            </button>

            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#1D1D1F] dark:text-[#F5F5F7] hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E] transition-colors duration-150"
              role="menuitem"
              onClick={() => {
                setIsOpen(false)
                // TODO: 設定ページへのナビゲーション
                console.log('Navigate to Settings')
              }}
            >
              <SettingsIcon className="h-4 w-4 text-[#6E6E73] dark:text-[#8E8E93]" />
              <span>設定</span>
            </button>
          </div>

          {/* ログアウト */}
          <div className="border-t border-[#D1D1D6]/30 dark:border-[#38383A]/30 py-1">
            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[#FF3B30] dark:text-[#FF453A] hover:bg-[#FF3B30]/10 dark:hover:bg-[#FF453A]/10 transition-colors duration-150"
              role="menuitem"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
              <span>ログアウト</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
