import { render, screen, renderHook, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, useTheme } from './ThemeContext'
import { ReactNode } from 'react'

describe('ThemeContext', () => {
  // 各テスト前にlocalStorageとmatchMediaをリセット
  beforeEach(() => {
    localStorage.clear()
    jest.clearAllMocks()
    // documentのクラスリストをクリア
    document.documentElement.className = ''
  })

  afterEach(() => {
    // クリーンアップ
    document.documentElement.className = ''
  })

  describe('ThemeProvider初期化テスト', () => {
    it('ThemeProviderが子要素を正しくレンダリングすること', () => {
      // Arrange & Act
      render(
        <ThemeProvider>
          <div>Test Content</div>
        </ThemeProvider>
      )

      // Assert
      expect(screen.getByText('Test Content')).toBeInTheDocument()
    })

    it('localStorageに保存されたテーマがない場合はlightがデフォルトであること', () => {
      // Arrange
      window.matchMedia = jest.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }))

      // Act
      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      })

      // Assert
      expect(result.current.theme).toBe('light')
    })

    it('localStorageにdarkが保存されている場合はdarkで初期化されること', () => {
      // Arrange
      localStorage.setItem('theme', 'dark')

      // Act
      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      })

      // Assert
      expect(result.current.theme).toBe('dark')
    })

    it('localStorageにlightが保存されている場合はlightで初期化されること', () => {
      // Arrange
      localStorage.setItem('theme', 'light')

      // Act
      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      })

      // Assert
      expect(result.current.theme).toBe('light')
    })

    it('システムのprefers-color-schemeがdarkの場合、darkで初期化されること', () => {
      // Arrange
      window.matchMedia = jest.fn().mockImplementation((query) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }))

      // Act
      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      })

      // Assert
      expect(result.current.theme).toBe('dark')
    })

    it('localStorageの値がシステム設定より優先されること', () => {
      // Arrange
      localStorage.setItem('theme', 'light')
      window.matchMedia = jest.fn().mockImplementation((query) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }))

      // Act
      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      })

      // Assert
      expect(result.current.theme).toBe('light')
    })
  })

  describe('テーマ切り替えテスト', () => {
    it('toggleTheme関数でlightからdarkに切り替わること', () => {
      // Arrange
      localStorage.setItem('theme', 'light')
      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      })

      // Act
      act(() => {
        result.current.toggleTheme()
      })

      // Assert
      expect(result.current.theme).toBe('dark')
    })

    it('toggleTheme関数でdarkからlightに切り替わること', () => {
      // Arrange
      localStorage.setItem('theme', 'dark')
      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      })

      // Act
      act(() => {
        result.current.toggleTheme()
      })

      // Assert
      expect(result.current.theme).toBe('light')
    })

    it('複数回toggleThemeを呼び出すと正しく切り替わること', () => {
      // Arrange
      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      })

      // Act & Assert
      const initialTheme = result.current.theme

      act(() => {
        result.current.toggleTheme()
      })
      expect(result.current.theme).toBe(initialTheme === 'light' ? 'dark' : 'light')

      act(() => {
        result.current.toggleTheme()
      })
      expect(result.current.theme).toBe(initialTheme)

      act(() => {
        result.current.toggleTheme()
      })
      expect(result.current.theme).toBe(initialTheme === 'light' ? 'dark' : 'light')
    })
  })

  describe('localStorage永続化テスト', () => {
    it('テーマ変更時にlocalStorageに保存されること', () => {
      // Arrange
      const setItemSpy = jest.spyOn(Storage.prototype, 'setItem')
      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      })

      // Act
      act(() => {
        result.current.toggleTheme()
      })

      // Assert
      expect(setItemSpy).toHaveBeenCalledWith('theme', result.current.theme)
      setItemSpy.mockRestore()
    })

    it('darkテーマに切り替えた時にlocalStorageにdarkが保存されること', () => {
      // Arrange
      localStorage.setItem('theme', 'light')
      const setItemSpy = jest.spyOn(Storage.prototype, 'setItem')
      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      })

      // Act
      act(() => {
        result.current.toggleTheme()
      })

      // Assert
      expect(setItemSpy).toHaveBeenCalledWith('theme', 'dark')
      setItemSpy.mockRestore()
    })

    it('lightテーマに切り替えた時にlocalStorageにlightが保存されること', () => {
      // Arrange
      localStorage.setItem('theme', 'dark')
      const setItemSpy = jest.spyOn(Storage.prototype, 'setItem')
      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      })

      // Act
      act(() => {
        result.current.toggleTheme()
      })

      // Assert
      expect(setItemSpy).toHaveBeenCalledWith('theme', 'light')
      setItemSpy.mockRestore()
    })
  })

  describe('DOM操作テスト', () => {
    it('lightテーマの場合、documentにdarkクラスが付与されないこと', () => {
      // Arrange
      localStorage.setItem('theme', 'light')

      // Act
      renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      })

      // Assert
      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })

    it('darkテーマの場合、documentにdarkクラスが付与されること', () => {
      // Arrange
      localStorage.setItem('theme', 'dark')

      // Act
      renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      })

      // Assert
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('lightからdarkに切り替えた時にdarkクラスが追加されること', () => {
      // Arrange
      localStorage.setItem('theme', 'light')
      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      })

      // Act
      act(() => {
        result.current.toggleTheme()
      })

      // Assert
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('darkからlightに切り替えた時にdarkクラスが削除されること', () => {
      // Arrange
      localStorage.setItem('theme', 'dark')
      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      })

      // Act
      act(() => {
        result.current.toggleTheme()
      })

      // Assert
      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })
  })

  describe('useThemeフックエラーハンドリングテスト', () => {
    it('ThemeProvider外でuseThemeを使用するとエラーがスローされること', () => {
      // Arrange
      // コンソールエラーを抑制
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

      // Act & Assert
      expect(() => {
        renderHook(() => useTheme())
      }).toThrow('useTheme must be used within a ThemeProvider')

      // クリーンアップ
      consoleError.mockRestore()
    })
  })

  describe('統合テスト', () => {
    it('実際のコンポーネントでテーマが正しく使用できること', () => {
      // Arrange
      const TestComponent = () => {
        const { theme, toggleTheme } = useTheme()
        return (
          <div>
            <p>Current theme: {theme}</p>
            <button onClick={toggleTheme}>Toggle</button>
          </div>
        )
      }

      // Act
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      // Assert
      expect(screen.getByText(/Current theme:/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Toggle' })).toBeInTheDocument()
    })

    it('ユーザー操作でテーマが切り替わること', async () => {
      // Arrange
      const user = userEvent.setup()
      const TestComponent = () => {
        const { theme, toggleTheme } = useTheme()
        return (
          <div>
            <p data-testid="theme-display">Current theme: {theme}</p>
            <button onClick={toggleTheme}>Toggle Theme</button>
          </div>
        )
      }

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      )

      const initialTheme = screen.getByTestId('theme-display').textContent

      // Act
      await user.click(screen.getByRole('button', { name: 'Toggle Theme' }))

      // Assert
      const updatedTheme = screen.getByTestId('theme-display').textContent
      expect(updatedTheme).not.toBe(initialTheme)
    })

    it('複数のコンポーネントで同じテーマ状態が共有されること', async () => {
      // Arrange
      const user = userEvent.setup()
      const ComponentA = () => {
        const { theme } = useTheme()
        return <p data-testid="component-a">Component A: {theme}</p>
      }

      const ComponentB = () => {
        const { theme, toggleTheme } = useTheme()
        return (
          <div>
            <p data-testid="component-b">Component B: {theme}</p>
            <button onClick={toggleTheme}>Toggle</button>
          </div>
        )
      }

      render(
        <ThemeProvider>
          <ComponentA />
          <ComponentB />
        </ThemeProvider>
      )

      const themeA = screen.getByTestId('component-a').textContent?.split(': ')[1]
      const themeB = screen.getByTestId('component-b').textContent?.split(': ')[1]

      // Assert初期状態
      expect(themeA).toBe(themeB)

      // Act
      await user.click(screen.getByRole('button', { name: 'Toggle' }))

      // Assert切り替え後
      const updatedThemeA = screen.getByTestId('component-a').textContent?.split(': ')[1]
      const updatedThemeB = screen.getByTestId('component-b').textContent?.split(': ')[1]
      expect(updatedThemeA).toBe(updatedThemeB)
      expect(updatedThemeA).not.toBe(themeA)
    })
  })
})
