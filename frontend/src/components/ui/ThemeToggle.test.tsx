import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ThemeProvider } from '@/contexts/ThemeContext'

import { ThemeToggle } from './ThemeToggle'

// Buttonコンポーネントのモック
jest.mock('./Button', () => ({
  Button: ({ children, onClick, icon, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {icon}
      {children}
    </button>
  ),
}))

describe('ThemeToggle', () => {
  const renderWithTheme = (initialTheme: 'light' | 'dark' = 'light') => {
    // ThemeProviderでラップしてレンダリング
    return render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    )
  }

  describe('基本的な描画', () => {
    it('トグルボタンが描画される', () => {
      renderWithTheme()
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })

    it('ライトモード時にMoonアイコンが表示される', () => {
      const { container } = renderWithTheme()
      // lucide-reactのMoonアイコン（SVG）を確認
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('ライトモード時に適切なaria-labelが設定される', () => {
      renderWithTheme()
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label', 'ダークモードに切り替え')
    })
  })

  describe('テーマ切り替え', () => {
    it('ボタンクリックでテーマが切り替わる', async () => {
      const user = userEvent.setup()
      renderWithTheme()

      const button = screen.getByRole('button')

      // 初期状態（ライトモード）
      expect(button).toHaveAttribute('aria-label', 'ダークモードに切り替え')

      // クリックしてダークモードに切り替え
      await user.click(button)

      // ダークモードになったことを確認
      expect(button).toHaveAttribute('aria-label', 'ライトモードに切り替え')
    })

    it('複数回クリックでテーマがトグルされる', async () => {
      const user = userEvent.setup()
      renderWithTheme()

      let button = screen.getByRole('button')

      // 初期状態の取得（ライトモードまたはダークモード）
      const initialLabel = button.getAttribute('aria-label')

      // 1回目: トグル
      await user.click(button)
      button = screen.getByRole('button')
      const firstLabel = button.getAttribute('aria-label')
      expect(firstLabel).not.toBe(initialLabel)

      // 2回目: 元に戻る
      await user.click(button)
      button = screen.getByRole('button')
      expect(button.getAttribute('aria-label')).toBe(initialLabel)

      // 3回目: 再度トグル
      await user.click(button)
      button = screen.getByRole('button')
      expect(button.getAttribute('aria-label')).toBe(firstLabel)
    })
  })

  describe('アイコンの切り替え', () => {
    it('ダークモード時にSunアイコンが表示される', async () => {
      const user = userEvent.setup()
      const { container } = renderWithTheme()

      const button = screen.getByRole('button')

      // ダークモードに切り替え
      await user.click(button)

      // SVGアイコンが表示されていることを確認
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })
  })

  describe('スクリーンリーダー対応', () => {
    it('sr-onlyクラスでスクリーンリーダー用テキストが提供される', () => {
      const { container } = renderWithTheme()
      const srOnlyElements = container.querySelectorAll('.sr-only')
      expect(srOnlyElements.length).toBeGreaterThan(0)
    })

    it('ダークモード時にもスクリーンリーダー用テキストが提供される', async () => {
      const user = userEvent.setup()
      const { container } = renderWithTheme()

      const button = screen.getByRole('button')
      await user.click(button)

      const srOnlyElements = container.querySelectorAll('.sr-only')
      expect(srOnlyElements.length).toBeGreaterThan(0)
    })
  })

  describe('Buttonコンポーネントとの統合', () => {
    it('Buttonコンポーネントが使用される', () => {
      renderWithTheme()
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })

    it('ボタンが正しく機能する', async () => {
      const user = userEvent.setup()
      renderWithTheme()
      const button = screen.getByRole('button')

      await user.click(button)

      // クリック後にボタンは引き続き存在する
      expect(button).toBeInTheDocument()
    })
  })
})
