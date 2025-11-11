/**
 * UserMenu Component Tests
 *
 * ユーザーメニューコンポーネントのテスト
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { UserMenu } from './UserMenu'
import type { AuthUser } from 'aws-amplify/auth'

// ========================================
// Mock Data
// ========================================

const mockUser: AuthUser = {
  username: 'testuser',
  userId: '123456',
  signInDetails: {
    loginId: 'test@example.com',
  },
}

// ========================================
// Tests
// ========================================

describe('UserMenu', () => {
  describe('初期表示', () => {
    it('ユーザー名が表示される', () => {
      const onLogout = vi.fn()
      render(<UserMenu user={mockUser} onLogout={onLogout} />)

      expect(screen.getByText('test@example.com')).toBeInTheDocument()
    })

    it('メニューが閉じた状態で表示される', () => {
      const onLogout = vi.fn()
      render(<UserMenu user={mockUser} onLogout={onLogout} />)

      // メニュー項目は表示されていない
      expect(screen.queryByText('マイページ')).not.toBeInTheDocument()
      expect(screen.queryByText('設定')).not.toBeInTheDocument()
      expect(screen.queryByText('ログアウト')).not.toBeInTheDocument()
    })

    it('トグルボタンに適切なARIA属性が設定されている', () => {
      const onLogout = vi.fn()
      render(<UserMenu user={mockUser} onLogout={onLogout} />)

      const toggleButton = screen.getByRole('button', { name: 'ユーザーメニュー' })
      expect(toggleButton).toHaveAttribute('aria-haspopup', 'true')
      expect(toggleButton).toHaveAttribute('aria-expanded', 'false')
    })
  })

  describe('メニューの開閉', () => {
    it('トグルボタンクリックでメニューが開く', async () => {
      const onLogout = vi.fn()
      render(<UserMenu user={mockUser} onLogout={onLogout} />)

      const toggleButton = screen.getByRole('button', { name: 'ユーザーメニュー' })
      fireEvent.click(toggleButton)

      await waitFor(() => {
        expect(screen.getByText('マイページ')).toBeInTheDocument()
        expect(screen.getByText('設定')).toBeInTheDocument()
        expect(screen.getByText('ログアウト')).toBeInTheDocument()
      })

      // ARIA属性が更新される
      expect(toggleButton).toHaveAttribute('aria-expanded', 'true')
    })

    it('再度クリックでメニューが閉じる', async () => {
      const onLogout = vi.fn()
      render(<UserMenu user={mockUser} onLogout={onLogout} />)

      const toggleButton = screen.getByRole('button', { name: 'ユーザーメニュー' })

      // メニューを開く
      fireEvent.click(toggleButton)
      await waitFor(() => {
        expect(screen.getByText('マイページ')).toBeInTheDocument()
      })

      // メニューを閉じる
      fireEvent.click(toggleButton)
      await waitFor(() => {
        expect(screen.queryByText('マイページ')).not.toBeInTheDocument()
      })

      expect(toggleButton).toHaveAttribute('aria-expanded', 'false')
    })

    it('メニュー外クリックでメニューが閉じる', async () => {
      const onLogout = vi.fn()
      render(
        <div>
          <div data-testid="outside">Outside</div>
          <UserMenu user={mockUser} onLogout={onLogout} />
        </div>
      )

      const toggleButton = screen.getByRole('button', { name: 'ユーザーメニュー' })

      // メニューを開く
      fireEvent.click(toggleButton)
      await waitFor(() => {
        expect(screen.getByText('マイページ')).toBeInTheDocument()
      })

      // メニュー外をクリック
      const outside = screen.getByTestId('outside')
      fireEvent.mouseDown(outside)

      await waitFor(() => {
        expect(screen.queryByText('マイページ')).not.toBeInTheDocument()
      })
    })

    it('Escapeキーでメニューが閉じる', async () => {
      const onLogout = vi.fn()
      render(<UserMenu user={mockUser} onLogout={onLogout} />)

      const toggleButton = screen.getByRole('button', { name: 'ユーザーメニュー' })

      // メニューを開く
      fireEvent.click(toggleButton)
      await waitFor(() => {
        expect(screen.getByText('マイページ')).toBeInTheDocument()
      })

      // Escapeキーを押す
      fireEvent.keyDown(document, { key: 'Escape' })

      await waitFor(() => {
        expect(screen.queryByText('マイページ')).not.toBeInTheDocument()
      })
    })
  })

  describe('メニュー項目', () => {
    it('マイページボタンクリックでメニューが閉じる', async () => {
      const onLogout = vi.fn()
      render(<UserMenu user={mockUser} onLogout={onLogout} />)

      const toggleButton = screen.getByRole('button', { name: 'ユーザーメニュー' })

      // メニューを開く
      fireEvent.click(toggleButton)
      await waitFor(() => {
        expect(screen.getByText('マイページ')).toBeInTheDocument()
      })

      // マイページをクリック
      const myPageButton = screen.getByRole('menuitem', { name: 'マイページ' })
      fireEvent.click(myPageButton)

      await waitFor(() => {
        expect(screen.queryByText('マイページ')).not.toBeInTheDocument()
      })
    })

    it('設定ボタンクリックでメニューが閉じる', async () => {
      const onLogout = vi.fn()
      render(<UserMenu user={mockUser} onLogout={onLogout} />)

      const toggleButton = screen.getByRole('button', { name: 'ユーザーメニュー' })

      // メニューを開く
      fireEvent.click(toggleButton)
      await waitFor(() => {
        expect(screen.getByText('設定')).toBeInTheDocument()
      })

      // 設定をクリック
      const settingsButton = screen.getByRole('menuitem', { name: '設定' })
      fireEvent.click(settingsButton)

      await waitFor(() => {
        expect(screen.queryByText('設定')).not.toBeInTheDocument()
      })
    })

    it('ログアウトボタンクリックでonLogoutが呼ばれる', async () => {
      const onLogout = vi.fn()
      render(<UserMenu user={mockUser} onLogout={onLogout} />)

      const toggleButton = screen.getByRole('button', { name: 'ユーザーメニュー' })

      // メニューを開く
      fireEvent.click(toggleButton)
      await waitFor(() => {
        expect(screen.getByText('ログアウト')).toBeInTheDocument()
      })

      // ログアウトをクリック
      const logoutButton = screen.getByRole('menuitem', { name: 'ログアウト' })
      fireEvent.click(logoutButton)

      expect(onLogout).toHaveBeenCalledTimes(1)

      await waitFor(() => {
        expect(screen.queryByText('ログアウト')).not.toBeInTheDocument()
      })
    })
  })

  describe('ユーザー情報表示', () => {
    it('loginIdがある場合はそれを表示', () => {
      const onLogout = vi.fn()
      render(<UserMenu user={mockUser} onLogout={onLogout} />)

      expect(screen.getByText('test@example.com')).toBeInTheDocument()
    })

    it('loginIdがない場合はusernameを表示', () => {
      const userWithoutLoginId: AuthUser = {
        username: 'testuser123',
        userId: '123456',
      }

      const onLogout = vi.fn()
      render(<UserMenu user={userWithoutLoginId} onLogout={onLogout} />)

      expect(screen.getByText('testuser123')).toBeInTheDocument()
    })

    it('長いユーザー名は省略される', () => {
      const userWithLongName: AuthUser = {
        username: 'very-long-username-that-should-be-truncated@example.com',
        userId: '123456',
        signInDetails: {
          loginId: 'very-long-username-that-should-be-truncated@example.com',
        },
      }

      const onLogout = vi.fn()
      render(<UserMenu user={userWithLongName} onLogout={onLogout} />)

      const displayName = screen.getByText(
        'very-long-username-that-should-be-truncated@example.com'
      )
      // truncateクラスが適用されている
      expect(displayName).toHaveClass('truncate')
    })
  })

  describe('アクセシビリティ', () => {
    it('メニューに適切なrole属性が設定されている', async () => {
      const onLogout = vi.fn()
      render(<UserMenu user={mockUser} onLogout={onLogout} />)

      const toggleButton = screen.getByRole('button', { name: 'ユーザーメニュー' })
      fireEvent.click(toggleButton)

      await waitFor(() => {
        const menu = screen.getByRole('menu')
        expect(menu).toHaveAttribute('aria-orientation', 'vertical')
      })
    })

    it('各メニュー項目にmenuitemロールが設定されている', async () => {
      const onLogout = vi.fn()
      render(<UserMenu user={mockUser} onLogout={onLogout} />)

      const toggleButton = screen.getByRole('button', { name: 'ユーザーメニュー' })
      fireEvent.click(toggleButton)

      await waitFor(() => {
        expect(screen.getByRole('menuitem', { name: 'マイページ' })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: '設定' })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: 'ログアウト' })).toBeInTheDocument()
      })
    })
  })
})
