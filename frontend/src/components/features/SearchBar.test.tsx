import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchBar } from './SearchBar'

describe('SearchBar', () => {
  // Arrange: デフォルトpropsの設定
  const defaultProps = {
    onSearch: jest.fn(),
  }

  beforeEach(() => {
    // 各テスト前にモックをリセット
    jest.clearAllMocks()
  })

  describe('描画テスト', () => {
    it('正しくレンダリングされること', () => {
      // Arrange & Act
      render(<SearchBar {...defaultProps} />)

      // Assert
      expect(screen.getByRole('textbox', { name: '検索キーワード' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '検索' })).toBeInTheDocument()
    })

    it('カスタムプレースホルダーが表示されること', () => {
      // Arrange & Act
      const customPlaceholder = 'カスタム検索テキスト'
      render(<SearchBar {...defaultProps} placeholder={customPlaceholder} />)

      // Assert
      expect(screen.getByPlaceholderText(customPlaceholder)).toBeInTheDocument()
    })

    it('初期値が設定されること', () => {
      // Arrange & Act
      const initialValue = '初期検索ワード'
      render(<SearchBar {...defaultProps} initialValue={initialValue} />)

      // Assert
      const input = screen.getByRole('textbox', { name: '検索キーワード' })
      expect(input).toHaveValue(initialValue)
    })

    it('入力がない場合はクリアボタンが表示されないこと', () => {
      // Arrange & Act
      render(<SearchBar {...defaultProps} />)

      // Assert
      expect(screen.queryByLabelText('検索をクリア')).not.toBeInTheDocument()
    })

    it('入力がある場合はクリアボタンが表示されること', async () => {
      // Arrange
      const user = userEvent.setup()
      render(<SearchBar {...defaultProps} />)

      // Act
      const input = screen.getByRole('textbox', { name: '検索キーワード' })
      await user.type(input, 'テストクエリ')

      // Assert
      expect(screen.getByLabelText('検索をクリア')).toBeInTheDocument()
    })
  })

  describe('入力操作テスト', () => {
    it('テキスト入力が正しく反映されること', async () => {
      // Arrange
      const user = userEvent.setup()
      render(<SearchBar {...defaultProps} />)
      const input = screen.getByRole('textbox', { name: '検索キーワード' })

      // Act
      await user.type(input, 'test query')

      // Assert
      expect(input).toHaveValue('test query')
    })

    it('複数文字の入力が正しく処理されること', async () => {
      // Arrange
      const user = userEvent.setup()
      render(<SearchBar {...defaultProps} />)
      const input = screen.getByRole('textbox', { name: '検索キーワード' })

      // Act
      await user.type(input, '日本語入力テスト')

      // Assert
      expect(input).toHaveValue('日本語入力テスト')
    })
  })

  describe('検索機能テスト', () => {
    it('検索ボタンクリック時にonSearchが呼ばれること', async () => {
      // Arrange
      const user = userEvent.setup()
      const onSearchMock = jest.fn()
      render(<SearchBar onSearch={onSearchMock} />)

      // Act
      const input = screen.getByRole('textbox', { name: '検索キーワード' })
      await user.type(input, 'search term')
      await user.click(screen.getByRole('button', { name: '検索' }))

      // Assert
      expect(onSearchMock).toHaveBeenCalledTimes(1)
      expect(onSearchMock).toHaveBeenCalledWith('search term')
    })

    it('Enterキー押下時にonSearchが呼ばれること', async () => {
      // Arrange
      const user = userEvent.setup()
      const onSearchMock = jest.fn()
      render(<SearchBar onSearch={onSearchMock} />)

      // Act
      const input = screen.getByRole('textbox', { name: '検索キーワード' })
      await user.type(input, 'enter key test{Enter}')

      // Assert
      expect(onSearchMock).toHaveBeenCalledTimes(1)
      expect(onSearchMock).toHaveBeenCalledWith('enter key test')
    })

    it('前後の空白がトリムされること', async () => {
      // Arrange
      const user = userEvent.setup()
      const onSearchMock = jest.fn()
      render(<SearchBar onSearch={onSearchMock} />)

      // Act
      const input = screen.getByRole('textbox', { name: '検索キーワード' })
      await user.type(input, '  spaced query  ')
      await user.click(screen.getByRole('button', { name: '検索' }))

      // Assert
      expect(onSearchMock).toHaveBeenCalledWith('spaced query')
    })

    it('空文字列での検索時はonSearchが呼ばれないこと', async () => {
      // Arrange
      const user = userEvent.setup()
      const onSearchMock = jest.fn()
      render(<SearchBar onSearch={onSearchMock} />)

      // Act
      await user.click(screen.getByRole('button', { name: '検索' }))

      // Assert
      expect(onSearchMock).not.toHaveBeenCalled()
    })

    it('空白のみの入力では検索されないこと', async () => {
      // Arrange
      const user = userEvent.setup()
      const onSearchMock = jest.fn()
      render(<SearchBar onSearch={onSearchMock} />)

      // Act
      const input = screen.getByRole('textbox', { name: '検索キーワード' })
      await user.type(input, '   ')
      await user.click(screen.getByRole('button', { name: '検索' }))

      // Assert
      expect(onSearchMock).not.toHaveBeenCalled()
    })
  })

  describe('クリア機能テスト', () => {
    it('クリアボタンクリック時に入力がクリアされること', async () => {
      // Arrange
      const user = userEvent.setup()
      render(<SearchBar {...defaultProps} />)
      const input = screen.getByRole('textbox', { name: '検索キーワード' })

      // Act
      await user.type(input, 'test query')
      const clearButton = screen.getByLabelText('検索をクリア')
      await user.click(clearButton)

      // Assert
      expect(input).toHaveValue('')
    })

    it('クリアボタンクリック時にonSearchが空文字で呼ばれること', async () => {
      // Arrange
      const user = userEvent.setup()
      const onSearchMock = jest.fn()
      render(<SearchBar onSearch={onSearchMock} />)
      const input = screen.getByRole('textbox', { name: '検索キーワード' })

      // Act
      await user.type(input, 'test query')
      const clearButton = screen.getByLabelText('検索をクリア')
      await user.click(clearButton)

      // Assert
      expect(onSearchMock).toHaveBeenCalledWith('')
    })

    it('クリア後はクリアボタンが非表示になること', async () => {
      // Arrange
      const user = userEvent.setup()
      render(<SearchBar {...defaultProps} />)
      const input = screen.getByRole('textbox', { name: '検索キーワード' })

      // Act
      await user.type(input, 'test query')
      const clearButton = screen.getByLabelText('検索をクリア')
      await user.click(clearButton)

      // Assert
      expect(screen.queryByLabelText('検索をクリア')).not.toBeInTheDocument()
    })
  })

  describe('アクセシビリティテスト', () => {
    it('入力フィールドに適切なaria-labelが設定されていること', () => {
      // Arrange & Act
      render(<SearchBar {...defaultProps} />)

      // Assert
      const input = screen.getByRole('textbox', { name: '検索キーワード' })
      expect(input).toHaveAttribute('aria-label', '検索キーワード')
    })

    it('クリアボタンに適切なaria-labelが設定されていること', async () => {
      // Arrange
      const user = userEvent.setup()
      render(<SearchBar {...defaultProps} />)
      const input = screen.getByRole('textbox', { name: '検索キーワード' })

      // Act
      await user.type(input, 'test')

      // Assert
      const clearButton = screen.getByLabelText('検索をクリア')
      expect(clearButton).toBeInTheDocument()
    })

    it('検索ボタンにtypeが設定されていること', () => {
      // Arrange & Act
      render(<SearchBar {...defaultProps} />)

      // Assert
      const searchButton = screen.getByRole('button', { name: '検索' })
      expect(searchButton).toHaveAttribute('type', 'submit')
    })
  })

  describe('エッジケーステスト', () => {
    it('非常に長いテキストが入力できること', async () => {
      // Arrange
      const user = userEvent.setup()
      const longText = 'a'.repeat(500)
      render(<SearchBar {...defaultProps} />)
      const input = screen.getByRole('textbox', { name: '検索キーワード' })

      // Act
      await user.type(input, longText)

      // Assert
      expect(input).toHaveValue(longText)
    })

    it('特殊文字が正しく処理されること', async () => {
      // Arrange
      const user = userEvent.setup()
      const specialChars = '!@#$%^&*()_+-=test'
      const onSearchMock = jest.fn()
      render(<SearchBar onSearch={onSearchMock} />)
      const input = screen.getByRole('textbox', { name: '検索キーワード' })

      // Act
      await user.type(input, specialChars)
      await user.click(screen.getByRole('button', { name: '検索' }))

      // Assert
      expect(onSearchMock).toHaveBeenCalledWith(specialChars)
    })

    it('複数回の検索が正しく処理されること', async () => {
      // Arrange
      const user = userEvent.setup()
      const onSearchMock = jest.fn()
      render(<SearchBar onSearch={onSearchMock} />)
      const input = screen.getByRole('textbox', { name: '検索キーワード' })
      const searchButton = screen.getByRole('button', { name: '検索' })

      // Act
      await user.type(input, 'first search')
      await user.click(searchButton)
      await user.clear(input)
      await user.type(input, 'second search')
      await user.click(searchButton)

      // Assert
      expect(onSearchMock).toHaveBeenCalledTimes(2)
      expect(onSearchMock).toHaveBeenNthCalledWith(1, 'first search')
      expect(onSearchMock).toHaveBeenNthCalledWith(2, 'second search')
    })
  })
})
