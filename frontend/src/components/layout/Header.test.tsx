/**
 * Header Component Tests (with Authentication)
 *
 * ヘッダーコンポーネントのテスト（認証統合版）
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { AuthUser } from 'aws-amplify/auth'

import { ThemeProvider } from '@/contexts/ThemeContext'

import { Header } from './Header'

// ThemeToggleとButtonコンポーネントのモック
jest.mock('@/components/ui/ThemeToggle', () => ({
  ThemeToggle: () => <button data-testid="theme-toggle">テーマ切り替え</button>,
}))

jest.mock('@/components/ui', () => ({
  Button: ({ children, icon, loading, ...props }: any) => (
    <button {...props} disabled={loading || props.disabled}>
      {loading ? 'Loading...' : icon}
      {children}
    </button>
  ),
}))

// AuthContextをモック
const mockUseAuth = jest.fn()
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

// UserMenuをモック
jest.mock('./UserMenu', () => ({
  UserMenu: ({ user, onLogout }: { user: AuthUser; onLogout: () => void }) => (
    <div data-testid="user-menu">
      <span>{user.username}</span>
      <button onClick={onLogout}>ログアウト</button>
    </div>
  ),
}))

const mockUser: AuthUser = {
  username: 'testuser',
  userId: '123456',
  signInDetails: {
    loginId: 'test@example.com',
  },
}

describe('Header', () => {
  const renderWithTheme = () => {
    return render(
      <ThemeProvider>
        <Header />
      </ThemeProvider>
    )
  }

  beforeEach(() => {
    jest.clearAllMocks()
    // デフォルトは未認証状態
    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      isAuthenticated: false,
      login: jest.fn(),
      loginWithHostedUI: jest.fn(),
      logout: jest.fn(),
      getAccessToken: jest.fn(),
      confirmMFA: jest.fn(),
    })
  })

  describe('基本的な描画', () => {
    it('ヘッダーが正しく描画される', () => {
      const { container } = renderWithTheme()
      const header = container.querySelector('header')
      expect(header).toBeInTheDocument()
    })

    it('role="banner"が設定される', () => {
      const { container } = renderWithTheme()
      const header = container.querySelector('header')
      expect(header).toHaveAttribute('role', 'banner')
    })

    it('ロゴとタイトルが表示される', () => {
      renderWithTheme()
      expect(screen.getByText('CIS File Search')).toBeInTheDocument()
    })

    it('サブタイトルが表示される', () => {
      renderWithTheme()
      expect(screen.getByText('企業内ファイル検索システム')).toBeInTheDocument()
    })

    it('ロゴアイコンが表示される', () => {
      const { container } = renderWithTheme()
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  describe('ナビゲーション', () => {
    it('ホームボタンが表示される', () => {
      renderWithTheme()
      expect(screen.getByText('ホーム')).toBeInTheDocument()
    })

    it('検索履歴ボタンが表示される', () => {
      renderWithTheme()
      expect(screen.getByText('検索履歴')).toBeInTheDocument()
    })

    it('お気に入りボタンが表示される', () => {
      renderWithTheme()
      expect(screen.getByText('お気に入り')).toBeInTheDocument()
    })

    it('ヘルプボタンが表示される', () => {
      renderWithTheme()
      expect(screen.getByText('ヘルプ')).toBeInTheDocument()
    })

    it('ナビゲーションがnavタグで囲まれている', () => {
      const { container } = renderWithTheme()
      const nav = container.querySelector('nav')
      expect(nav).toBeInTheDocument()
    })

    it('md以上の画面でのみ表示される（hiddenクラス）', () => {
      const { container } = renderWithTheme()
      const nav = container.querySelector('nav')
      expect(nav).toHaveClass('hidden')
      expect(nav).toHaveClass('md:flex')
    })
  })

  describe('アクションボタン', () => {
    it('ThemeToggleボタンが表示される', () => {
      renderWithTheme()
      expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()
    })

    it('通知ボタンが表示される', () => {
      renderWithTheme()
      expect(screen.getByText('通知')).toBeInTheDocument()
    })

    it('設定ボタンが表示される', () => {
      renderWithTheme()
      expect(screen.getByText('設定')).toBeInTheDocument()
    })

    it('ログインボタンが表示される', () => {
      renderWithTheme()
      expect(screen.getByText('ログイン')).toBeInTheDocument()
    })

    it('通知と設定がスクリーンリーダー用テキストを持つ', () => {
      renderWithTheme()
      const srOnlyTexts = screen.getAllByText(/通知|設定/)
      const srOnlyElements = srOnlyTexts.filter((el) => el.classList.contains('sr-only'))
      expect(srOnlyElements.length).toBeGreaterThan(0)
    })

    it('ボタン間に区切り線が表示される', () => {
      const { container } = renderWithTheme()
      const separator = container.querySelector('.h-8.w-px')
      expect(separator).toBeInTheDocument()
    })
  })

  describe('レイアウトとスタイル', () => {
    it('背景に透過効果が適用される', () => {
      const { container } = renderWithTheme()
      const header = container.querySelector('header')
      expect(header).toHaveClass('backdrop-blur-xl')
    })

    it('stickyポジショニングが適用される', () => {
      const { container } = renderWithTheme()
      const header = container.querySelector('header')
      expect(header).toHaveClass('sticky')
      expect(header).toHaveClass('top-0')
    })

    it('z-indexが設定される', () => {
      const { container } = renderWithTheme()
      const header = container.querySelector('header')
      expect(header).toHaveClass('z-50')
    })

    it('境界線が表示される', () => {
      const { container } = renderWithTheme()
      const header = container.querySelector('header')
      expect(header).toHaveClass('border-b')
    })

    it('ダークモード用のスタイルクラスが含まれている', () => {
      const { container } = renderWithTheme()
      const darkModeElements = container.querySelectorAll('[class*="dark:"]')
      expect(darkModeElements.length).toBeGreaterThan(0)
    })

    it('レスポンシブなコンテナが使用される', () => {
      const { container } = renderWithTheme()
      const contentContainer = container.querySelector('.container')
      expect(contentContainer).toBeInTheDocument()
    })

    it('レスポンシブなパディングが設定される', () => {
      const { container } = renderWithTheme()
      const paddingContainer = container.querySelector('.px-4.sm\\:px-6.lg\\:px-8')
      expect(paddingContainer).toBeInTheDocument()
    })
  })

  describe('ロゴのグラデーション', () => {
    it('ロゴ背景にグラデーションが適用される', () => {
      const { container } = renderWithTheme()
      const logoBackground = container.querySelector('.bg-gradient-to-br')
      expect(logoBackground).toBeInTheDocument()
    })

    it('ロゴに影が適用される', () => {
      const { container } = renderWithTheme()
      const logoBackground = container.querySelector('.shadow-sm')
      expect(logoBackground).toBeInTheDocument()
    })

    it('ロゴが角丸になっている', () => {
      const { container } = renderWithTheme()
      const logoBackground = container.querySelector('.rounded-xl')
      expect(logoBackground).toBeInTheDocument()
    })
  })

  describe('アクセシビリティ', () => {
    it('ナビゲーションボタンがtype="button"を持つ', () => {
      renderWithTheme()
      const homeButton = screen.getByText('ホーム')
      expect(homeButton).toHaveAttribute('type', 'button')
    })

    it('sr-onlyクラスで視覚的に隠されたテキストが提供される', () => {
      const { container } = renderWithTheme()
      const srOnlyElements = container.querySelectorAll('.sr-only')
      expect(srOnlyElements.length).toBeGreaterThan(0)
    })
  })

  // ========================================
  // 認証統合テスト
  // ========================================

  describe('認証: 未認証状態', () => {
    it('ログインボタンが表示される', () => {
      renderWithTheme()
      expect(screen.getByText('ログイン')).toBeInTheDocument()
    })

    it('ユーザーメニューは表示されない', () => {
      renderWithTheme()
      expect(screen.queryByTestId('user-menu')).not.toBeInTheDocument()
    })

    it('ログインボタンクリックでloginWithHostedUIが呼ばれる', async () => {
      const loginWithHostedUI = jest.fn()
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
        isAuthenticated: false,
        login: jest.fn(),
        loginWithHostedUI,
        logout: jest.fn(),
        getAccessToken: jest.fn(),
        confirmMFA: jest.fn(),
      })

      renderWithTheme()

      const loginButton = screen.getByText('ログイン')
      fireEvent.click(loginButton)

      await waitFor(() => {
        expect(loginWithHostedUI).toHaveBeenCalledTimes(1)
      })
    })

    it('ログイン処理中はローディング状態を表示', async () => {
      const loginWithHostedUI = jest.fn(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      )
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: false,
        isAuthenticated: false,
        login: jest.fn(),
        loginWithHostedUI,
        logout: jest.fn(),
        getAccessToken: jest.fn(),
        confirmMFA: jest.fn(),
      })

      renderWithTheme()

      const loginButton = screen.getByText('ログイン')
      fireEvent.click(loginButton)

      // ローディング中のテキストが表示される
      await waitFor(() => {
        expect(screen.getByText('リダイレクト中...')).toBeInTheDocument()
      })
    })
  })

  describe('認証: 認証済み状態', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: mockUser,
        isLoading: false,
        isAuthenticated: true,
        login: jest.fn(),
        loginWithHostedUI: jest.fn(),
        logout: jest.fn(),
        getAccessToken: jest.fn(),
        confirmMFA: jest.fn(),
      })
    })

    it('ユーザーメニューが表示される', () => {
      renderWithTheme()
      expect(screen.getByTestId('user-menu')).toBeInTheDocument()
      expect(screen.getByText('testuser')).toBeInTheDocument()
    })

    it('ログインボタンは表示されない', () => {
      renderWithTheme()
      expect(screen.queryByText('ログイン')).not.toBeInTheDocument()
    })

    it('ログアウトボタンクリックでlogoutが呼ばれる', async () => {
      const logout = jest.fn()
      mockUseAuth.mockReturnValue({
        user: mockUser,
        isLoading: false,
        isAuthenticated: true,
        login: jest.fn(),
        loginWithHostedUI: jest.fn(),
        logout,
        getAccessToken: jest.fn(),
        confirmMFA: jest.fn(),
      })

      renderWithTheme()

      const logoutButton = screen.getByText('ログアウト')
      fireEvent.click(logoutButton)

      await waitFor(() => {
        expect(logout).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('認証: ローディング状態', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: null,
        isLoading: true,
        isAuthenticated: false,
        login: jest.fn(),
        loginWithHostedUI: jest.fn(),
        logout: jest.fn(),
        getAccessToken: jest.fn(),
        confirmMFA: jest.fn(),
      })
    })

    it('認証状態確認中はプレースホルダーを表示', () => {
      const { container } = renderWithTheme()
      const placeholder = container.querySelector('.animate-pulse')
      expect(placeholder).toBeInTheDocument()
    })

    it('ローディング中はログインボタンとユーザーメニューが表示されない', () => {
      renderWithTheme()
      expect(screen.queryByText('ログイン')).not.toBeInTheDocument()
      expect(screen.queryByTestId('user-menu')).not.toBeInTheDocument()
    })
  })
})
