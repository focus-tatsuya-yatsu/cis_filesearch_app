import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilterPanel } from './FilterPanel'
import type { FilterOptions } from '@/types'

describe('FilterPanel', () => {
  const defaultProps = {
    onFilterChange: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('描画テスト', () => {
    it('正しくレンダリングされること', () => {
      // Arrange & Act
      render(<FilterPanel {...defaultProps} />)

      // Assert
      expect(screen.getByText('フィルター・ソート')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'リセット' })).toBeInTheDocument()
    })

    it('すべてのフィルター項目が表示されること', () => {
      // Arrange & Act
      render(<FilterPanel {...defaultProps} />)

      // Assert - getAllByTextを使用してlabelを検証
      const labels = ['ファイルタイプ', 'ファイルサイズ', '並び替え']
      labels.forEach((label) => {
        expect(screen.getByText(label, { selector: 'label' })).toBeInTheDocument()
      })
      // 更新日時は複数箇所に表示されるのでgetAllByTextで確認
      expect(screen.getAllByText('更新日時').length).toBeGreaterThan(0)
    })

    it('昇順/降順ボタンが表示されること', () => {
      // Arrange & Act
      render(<FilterPanel {...defaultProps} />)

      // Assert
      expect(screen.getByRole('button', { name: '降順 ↓' })).toBeInTheDocument()
    })

    it('初期状態では降順が選択されていること', () => {
      // Arrange & Act
      render(<FilterPanel {...defaultProps} />)

      // Assert
      const sortOrderButton = screen.getByRole('button', { name: '降順 ↓' })
      expect(sortOrderButton).toHaveClass('border-primary-600') // outline variant
    })
  })

  describe('フィルター変更テスト', () => {
    it('ファイルタイプ変更時にonFilterChangeが呼ばれること', async () => {
      // Arrange
      const user = userEvent.setup()
      const onFilterChange = jest.fn()
      render(<FilterPanel onFilterChange={onFilterChange} />)

      // Act
      const selects = screen.getAllByRole('combobox')
      const fileTypeSelect = selects[0] // ファイルタイプは最初のselect
      await user.selectOptions(fileTypeSelect, 'pdf')

      // Assert
      expect(onFilterChange).toHaveBeenCalledTimes(1)
      expect(onFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({
          fileType: ['pdf'],
        })
      )
    })

    it('更新日時変更時にonFilterChangeが呼ばれること', async () => {
      // Arrange
      const user = userEvent.setup()
      const onFilterChange = jest.fn()
      render(<FilterPanel onFilterChange={onFilterChange} />)

      // Act
      const selects = screen.getAllByRole('combobox')
      const dateRangeSelect = selects[1] // 更新日時は2番目のselect
      await user.selectOptions(dateRangeSelect, 'today')

      // Assert
      expect(onFilterChange).toHaveBeenCalled()
    })

    it('ファイルサイズ変更時にonFilterChangeが呼ばれること', async () => {
      // Arrange
      const user = userEvent.setup()
      const onFilterChange = jest.fn()
      render(<FilterPanel onFilterChange={onFilterChange} />)

      // Act
      const selects = screen.getAllByRole('combobox')
      const fileSizeSelect = selects[2] // ファイルサイズは3番目のselect
      await user.selectOptions(fileSizeSelect, 'small')

      // Assert
      expect(onFilterChange).toHaveBeenCalled()
    })

    it('並び替え変更時にonFilterChangeが呼ばれること', async () => {
      // Arrange
      const user = userEvent.setup()
      const onFilterChange = jest.fn()
      render(<FilterPanel onFilterChange={onFilterChange} />)

      // Act
      const selects = screen.getAllByRole('combobox')
      const sortBySelect = selects[3] // 並び替えは4番目のselect
      await user.selectOptions(sortBySelect, 'name')

      // Assert
      expect(onFilterChange).toHaveBeenCalledTimes(1)
      expect(onFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({
          sortBy: 'name',
          sortOrder: 'desc',
        })
      )
    })
  })

  describe('ソート順変更テスト', () => {
    it('ソート順ボタンクリックで昇順に切り替わること', async () => {
      // Arrange
      const user = userEvent.setup()
      const onFilterChange = jest.fn()
      render(<FilterPanel onFilterChange={onFilterChange} />)

      // Act
      const sortOrderButton = screen.getByRole('button', { name: '降順 ↓' })
      await user.click(sortOrderButton)

      // Assert
      expect(screen.getByRole('button', { name: '昇順 ↑' })).toBeInTheDocument()
      expect(onFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({
          sortOrder: 'asc',
        })
      )
    })

    it('ソート順ボタンを2回クリックすると降順に戻ること', async () => {
      // Arrange
      const user = userEvent.setup()
      render(<FilterPanel {...defaultProps} />)

      // Act
      let sortOrderButton = screen.getByRole('button', { name: '降順 ↓' })
      await user.click(sortOrderButton)

      sortOrderButton = screen.getByRole('button', { name: '昇順 ↑' })
      await user.click(sortOrderButton)

      // Assert
      expect(screen.getByRole('button', { name: '降順 ↓' })).toBeInTheDocument()
    })

    it('昇順時はprimaryバリアントが適用されること', async () => {
      // Arrange
      const user = userEvent.setup()
      render(<FilterPanel {...defaultProps} />)

      // Act
      const sortOrderButton = screen.getByRole('button', { name: '降順 ↓' })
      await user.click(sortOrderButton)

      // Assert
      const updatedButton = screen.getByRole('button', { name: '昇順 ↑' })
      expect(updatedButton).toHaveClass('bg-primary-600')
    })
  })

  describe('リセット機能テスト', () => {
    it('リセットボタンクリックで初期状態に戻ること', async () => {
      // Arrange
      const user = userEvent.setup()
      const onFilterChange = jest.fn()
      render(<FilterPanel onFilterChange={onFilterChange} />)

      // Act - フィルターを変更
      const selects = screen.getAllByRole('combobox')
      await user.selectOptions(selects[0], 'pdf')
      await user.selectOptions(selects[3], 'name')

      onFilterChange.mockClear()

      // Act - リセット
      const resetButton = screen.getByRole('button', { name: 'リセット' })
      await user.click(resetButton)

      // Assert
      expect(onFilterChange).toHaveBeenCalledWith({
        sortBy: 'relevance',
        sortOrder: 'desc',
      })
    })

    it('リセット後のフィルター値が初期値になること', async () => {
      // Arrange
      const user = userEvent.setup()
      render(<FilterPanel {...defaultProps} />)

      // Act - フィルターを変更
      const selects = screen.getAllByRole('combobox')
      const fileTypeSelect = selects[0]
      await user.selectOptions(fileTypeSelect, 'pdf')

      // Act - リセット
      const resetButton = screen.getByRole('button', { name: 'リセット' })
      await user.click(resetButton)

      // Assert
      expect(fileTypeSelect).toHaveValue('')
    })

    it('リセット後のソート順が降順に戻ること', async () => {
      // Arrange
      const user = userEvent.setup()
      render(<FilterPanel {...defaultProps} />)

      // Act - ソート順を昇順に変更
      let sortOrderButton = screen.getByRole('button', { name: '降順 ↓' })
      await user.click(sortOrderButton)

      // Act - リセット
      const resetButton = screen.getByRole('button', { name: 'リセット' })
      await user.click(resetButton)

      // Assert
      expect(screen.getByRole('button', { name: '降順 ↓' })).toBeInTheDocument()
    })
  })

  describe('フィルターオプションの型変換テスト', () => {
    it('fileTypeが空の場合はundefinedで送信されること', async () => {
      // Arrange
      const user = userEvent.setup()
      const onFilterChange = jest.fn()
      render(<FilterPanel onFilterChange={onFilterChange} />)

      // Act
      const selects = screen.getAllByRole('combobox')
      const sortBySelect = selects[3]
      await user.selectOptions(sortBySelect, 'name')

      // Assert
      const lastCall = onFilterChange.mock.calls[onFilterChange.mock.calls.length - 1][0]
      expect(lastCall.fileType).toBeUndefined()
    })

    it('fileTypeが選択されている場合は配列で送信されること', async () => {
      // Arrange
      const user = userEvent.setup()
      const onFilterChange = jest.fn()
      render(<FilterPanel onFilterChange={onFilterChange} />)

      // Act
      const selects = screen.getAllByRole('combobox')
      const fileTypeSelect = selects[0]
      await user.selectOptions(fileTypeSelect, 'pdf')

      // Assert
      expect(onFilterChange).toHaveBeenCalledWith(
        expect.objectContaining({
          fileType: ['pdf'],
        })
      )
    })

    it('sortByが正しい型で送信されること', async () => {
      // Arrange
      const user = userEvent.setup()
      const onFilterChange = jest.fn()
      render(<FilterPanel onFilterChange={onFilterChange} />)

      // Act
      const selects = screen.getAllByRole('combobox')
      const sortBySelect = selects[3]
      await user.selectOptions(sortBySelect, 'date')

      // Assert
      const filterOptions: FilterOptions = onFilterChange.mock.calls[0][0]
      expect(filterOptions.sortBy).toBe('date')
      expect(['name', 'date', 'size', 'relevance']).toContain(filterOptions.sortBy)
    })
  })

  describe('複数フィルター同時適用テスト', () => {
    it('複数のフィルターを連続して変更できること', async () => {
      // Arrange
      const user = userEvent.setup()
      const onFilterChange = jest.fn()
      render(<FilterPanel onFilterChange={onFilterChange} />)

      // Act
      const selects = screen.getAllByRole('combobox')
      await user.selectOptions(selects[0], 'pdf')
      await user.selectOptions(selects[3], 'name')

      const sortOrderButton = screen.getByRole('button', { name: '降順 ↓' })
      await user.click(sortOrderButton)

      // Assert
      expect(onFilterChange).toHaveBeenCalledTimes(3)
    })

    it('最後に適用されたフィルターが正しい状態であること', async () => {
      // Arrange
      const user = userEvent.setup()
      const onFilterChange = jest.fn()
      render(<FilterPanel onFilterChange={onFilterChange} />)

      // Act
      const selects = screen.getAllByRole('combobox')
      await user.selectOptions(selects[0], 'pdf')
      await user.selectOptions(selects[3], 'name')
      await user.click(screen.getByRole('button', { name: '降順 ↓' }))

      // Assert
      const lastCall = onFilterChange.mock.calls[onFilterChange.mock.calls.length - 1][0]
      expect(lastCall).toEqual({
        fileType: ['pdf'],
        sortBy: 'name',
        sortOrder: 'asc',
      })
    })
  })

  describe('Select コンポーネント統合テスト', () => {
    it('ファイルタイプの全オプションが選択可能であること', async () => {
      // Arrange
      const user = userEvent.setup()
      render(<FilterPanel {...defaultProps} />)
      const selects = screen.getAllByRole('combobox')
      const fileTypeSelect = selects[0]

      // Act & Assert
      const options = ['', 'pdf', 'docx', 'xlsx', 'pptx', 'image', 'video', 'other']
      for (const option of options) {
        await user.selectOptions(fileTypeSelect, option)
        expect(fileTypeSelect).toHaveValue(option)
      }
    })

    it('更新日時の全オプションが選択可能であること', async () => {
      // Arrange
      const user = userEvent.setup()
      render(<FilterPanel {...defaultProps} />)
      const selects = screen.getAllByRole('combobox')
      const dateRangeSelect = selects[1]

      // Act & Assert
      const options = ['', 'today', 'week', 'month', '3months', 'year']
      for (const option of options) {
        await user.selectOptions(dateRangeSelect, option)
        expect(dateRangeSelect).toHaveValue(option)
      }
    })

    it('ファイルサイズの全オプションが選択可能であること', async () => {
      // Arrange
      const user = userEvent.setup()
      render(<FilterPanel {...defaultProps} />)
      const selects = screen.getAllByRole('combobox')
      const fileSizeSelect = selects[2]

      // Act & Assert
      const options = ['', 'small', 'medium', 'large', 'xlarge']
      for (const option of options) {
        await user.selectOptions(fileSizeSelect, option)
        expect(fileSizeSelect).toHaveValue(option)
      }
    })

    it('並び替えの全オプションが選択可能であること', async () => {
      // Arrange
      const user = userEvent.setup()
      render(<FilterPanel {...defaultProps} />)
      const selects = screen.getAllByRole('combobox')
      const sortBySelect = selects[3]

      // Act & Assert
      const options = ['relevance', 'name', 'date', 'size']
      for (const option of options) {
        await user.selectOptions(sortBySelect, option)
        expect(sortBySelect).toHaveValue(option)
      }
    })
  })

  describe('アクセシビリティテスト', () => {
    it('すべてのSelectラベルが表示されていること', () => {
      // Arrange & Act
      render(<FilterPanel {...defaultProps} />)

      // Assert - すべてのselect要素が存在する
      const selects = screen.getAllByRole('combobox')
      expect(selects).toHaveLength(4)
    })

    it('リセットボタンが適切なアクセシブル名を持つこと', () => {
      // Arrange & Act
      render(<FilterPanel {...defaultProps} />)

      // Assert
      expect(screen.getByRole('button', { name: 'リセット' })).toBeInTheDocument()
    })

    it('ソート順ボタンが適切なアクセシブル名を持つこと', () => {
      // Arrange & Act
      render(<FilterPanel {...defaultProps} />)

      // Assert
      expect(screen.getByRole('button', { name: /降順|昇順/ })).toBeInTheDocument()
    })
  })

  describe('UIスタイルテスト', () => {
    it('フィルターアイコンが表示されること', () => {
      // Arrange & Act
      render(<FilterPanel {...defaultProps} />)

      // Assert
      const filterIcon = document.querySelector('svg')
      expect(filterIcon).toBeInTheDocument()
    })

    it('リセットボタンがghostバリアントであること', () => {
      // Arrange & Act
      render(<FilterPanel {...defaultProps} />)

      // Assert
      const resetButton = screen.getByRole('button', { name: 'リセット' })
      expect(resetButton).toHaveClass('text-gray-600')
    })
  })
})
