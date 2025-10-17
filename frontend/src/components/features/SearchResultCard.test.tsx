import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SearchResultCard } from './SearchResultCard'

// Buttonコンポーネントのモック
jest.mock('@/components/ui', () => ({
  Button: ({ children, onClick, icon, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {icon}
      {children}
    </button>
  ),
}))

describe('SearchResultCard', () => {
  const mockResult = {
    id: '1',
    fileName: 'test-document.pdf',
    filePath: '/Documents/Projects/test-document.pdf',
    fileType: 'pdf',
    fileSize: 1048576, // 1 MB
    modifiedDate: '2024-01-15T10:30:00Z',
    snippet: 'これはテスト用のスニペットテキストです。検索キーワードが含まれています。',
    relevanceScore: 0.95,
  }

  // Clipboard APIのモック
  const mockWriteText = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    // navigatorのclipboardをモック
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: mockWriteText,
      },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('基本的な描画', () => {
    it('カードが正しく描画される', () => {
      const { container } = render(<SearchResultCard result={mockResult} />)
      expect(container.querySelector('.rounded-2xl')).toBeInTheDocument()
    })

    it('ファイル名が表示される', () => {
      render(<SearchResultCard result={mockResult} />)
      expect(screen.getByText('test-document.pdf')).toBeInTheDocument()
    })

    it('ファイルパスが表示される', () => {
      render(<SearchResultCard result={mockResult} />)
      expect(screen.getByText('/Documents/Projects/test-document.pdf')).toBeInTheDocument()
    })

    it('スニペットが表示される', () => {
      render(<SearchResultCard result={mockResult} />)
      expect(
        screen.getByText('これはテスト用のスニペットテキストです。検索キーワードが含まれています。'),
      ).toBeInTheDocument()
    })

    it('関連性スコアが正しく表示される', () => {
      render(<SearchResultCard result={mockResult} />)
      expect(screen.getByText('関連度: 95%')).toBeInTheDocument()
    })

    it('ファイルタイプが大文字で表示される', () => {
      const { container } = render(<SearchResultCard result={mockResult} />)
      const typeElement = container.querySelector('.uppercase')
      expect(typeElement).toHaveTextContent('pdf')
    })
  })

  describe('ファイルサイズのフォーマット', () => {
    it('バイトが正しくフォーマットされる（B）', () => {
      const result = { ...mockResult, fileSize: 512 }
      render(<SearchResultCard result={result} />)
      expect(screen.getByText('512 B')).toBeInTheDocument()
    })

    it('キロバイトが正しくフォーマットされる（KB）', () => {
      const result = { ...mockResult, fileSize: 1024 }
      render(<SearchResultCard result={result} />)
      expect(screen.getByText('1 KB')).toBeInTheDocument()
    })

    it('メガバイトが正しくフォーマットされる（MB）', () => {
      const result = { ...mockResult, fileSize: 1048576 }
      render(<SearchResultCard result={result} />)
      expect(screen.getByText('1 MB')).toBeInTheDocument()
    })

    it('ギガバイトが正しくフォーマットされる（GB）', () => {
      const result = { ...mockResult, fileSize: 1073741824 }
      render(<SearchResultCard result={result} />)
      expect(screen.getByText('1 GB')).toBeInTheDocument()
    })

    it('0バイトが正しく表示される', () => {
      const result = { ...mockResult, fileSize: 0 }
      render(<SearchResultCard result={result} />)
      expect(screen.getByText('0 B')).toBeInTheDocument()
    })

    it('小数点以下2桁で表示される', () => {
      const result = { ...mockResult, fileSize: 1536 } // 1.5 KB
      render(<SearchResultCard result={result} />)
      expect(screen.getByText('1.5 KB')).toBeInTheDocument()
    })
  })

  describe('日付のフォーマット', () => {
    it('日本語形式で日付が表示される', () => {
      render(<SearchResultCard result={mockResult} />)
      // Intl.DateTimeFormatによる日付フォーマット
      expect(screen.getByText(/2024/)).toBeInTheDocument()
    })

    it('時刻も含めて表示される', () => {
      const { container } = render(<SearchResultCard result={mockResult} />)
      const dateElement = container.querySelector('.flex.items-center.gap-1 span')
      expect(dateElement).toBeInTheDocument()
    })
  })

  describe('ファイルタイプアイコン', () => {
    it('PDFファイルには赤いアイコンが表示される', () => {
      const { container } = render(<SearchResultCard result={mockResult} />)
      const icon = container.querySelector('.text-red-500')
      expect(icon).toBeInTheDocument()
    })

    it('Wordファイルには青いアイコンが表示される', () => {
      const docxResult = { ...mockResult, fileType: 'docx' }
      const { container } = render(<SearchResultCard result={docxResult} />)
      const icon = container.querySelector('.text-blue-500')
      expect(icon).toBeInTheDocument()
    })

    it('Excelファイルには緑のアイコンが表示される', () => {
      const xlsxResult = { ...mockResult, fileType: 'xlsx' }
      const { container } = render(<SearchResultCard result={xlsxResult} />)
      const icon = container.querySelector('.text-green-500')
      expect(icon).toBeInTheDocument()
    })

    it('不明なファイルタイプにはグレーのアイコンが表示される', () => {
      const unknownResult = { ...mockResult, fileType: 'unknown' }
      const { container } = render(<SearchResultCard result={unknownResult} />)
      const icon = container.querySelector('.text-gray-500')
      expect(icon).toBeInTheDocument()
    })

    it('doc形式もWordファイルとして認識される', () => {
      const docResult = { ...mockResult, fileType: 'doc' }
      const { container } = render(<SearchResultCard result={docResult} />)
      const icon = container.querySelector('.text-blue-500')
      expect(icon).toBeInTheDocument()
    })

    it('xls形式もExcelファイルとして認識される', () => {
      const xlsResult = { ...mockResult, fileType: 'xls' }
      const { container } = render(<SearchResultCard result={xlsResult} />)
      const icon = container.querySelector('.text-green-500')
      expect(icon).toBeInTheDocument()
    })

    it('大文字のファイルタイプも正しく認識される', () => {
      const upperCaseResult = { ...mockResult, fileType: 'PDF' }
      const { container } = render(<SearchResultCard result={upperCaseResult} />)
      const icon = container.querySelector('.text-red-500')
      expect(icon).toBeInTheDocument()
    })
  })

  describe('パスのコピー機能', () => {
    it('コピーボタンが表示される', () => {
      render(<SearchResultCard result={mockResult} />)
      const copyButton = screen.getByTitle('パスをコピー')
      expect(copyButton).toBeInTheDocument()
    })

    it('コピーボタンが存在する', () => {
      render(<SearchResultCard result={mockResult} />)

      const copyButton = screen.getByTitle('パスをコピー')
      expect(copyButton).toBeInTheDocument()

      // モックされたclipboard APIが呼び出し可能であることを確認
      expect(navigator.clipboard.writeText).toBeDefined()
    })

    it('コピー成功時に確認メッセージが表示される', async () => {
      const user = userEvent.setup()
      mockWriteText.mockResolvedValueOnce(undefined)

      render(<SearchResultCard result={mockResult} />)

      const copyButton = screen.getByTitle('パスをコピー')
      await user.click(copyButton)

      await waitFor(() => {
        expect(screen.getByText('コピーしました！')).toBeInTheDocument()
      })
    })

    it('確認メッセージは2秒後に消える', async () => {
      const user = userEvent.setup()
      mockWriteText.mockResolvedValueOnce(undefined)

      render(<SearchResultCard result={mockResult} />)

      const copyButton = screen.getByTitle('パスをコピー')
      await user.click(copyButton)

      await waitFor(() => {
        expect(screen.getByText('コピーしました！')).toBeInTheDocument()
      })

      await waitFor(
        () => {
          expect(screen.queryByText('コピーしました！')).not.toBeInTheDocument()
        },
        { timeout: 2500 },
      )
    })

  })

  describe('プレビューボタン', () => {
    it('onPreviewが渡された場合、プレビューボタンが表示される', () => {
      const onPreview = jest.fn()
      render(<SearchResultCard result={mockResult} onPreview={onPreview} />)
      expect(screen.getByText('プレビュー')).toBeInTheDocument()
    })

    it('onPreviewが渡されない場合、プレビューボタンは表示されない', () => {
      render(<SearchResultCard result={mockResult} />)
      expect(screen.queryByText('プレビュー')).not.toBeInTheDocument()
    })

    it('プレビューボタンをクリックするとonPreviewが呼ばれる', async () => {
      const user = userEvent.setup()
      const onPreview = jest.fn()
      render(<SearchResultCard result={mockResult} onPreview={onPreview} />)

      const previewButton = screen.getByText('プレビュー')
      await user.click(previewButton)

      expect(onPreview).toHaveBeenCalledWith('1')
    })
  })

  describe('ダウンロードボタン', () => {
    it('onDownloadが渡された場合、ダウンロードボタンが表示される', () => {
      const onDownload = jest.fn()
      render(<SearchResultCard result={mockResult} onDownload={onDownload} />)
      expect(screen.getByText('ダウンロード')).toBeInTheDocument()
    })

    it('onDownloadが渡されない場合、ダウンロードボタンは表示されない', () => {
      render(<SearchResultCard result={mockResult} />)
      expect(screen.queryByText('ダウンロード')).not.toBeInTheDocument()
    })

    it('ダウンロードボタンをクリックするとonDownloadが呼ばれる', async () => {
      const user = userEvent.setup()
      const onDownload = jest.fn()
      render(<SearchResultCard result={mockResult} onDownload={onDownload} />)

      const downloadButton = screen.getByText('ダウンロード')
      await user.click(downloadButton)

      expect(onDownload).toHaveBeenCalledWith('1')
    })

    it('両方のボタンが同時に表示される', () => {
      const onPreview = jest.fn()
      const onDownload = jest.fn()
      render(<SearchResultCard result={mockResult} onPreview={onPreview} onDownload={onDownload} />)

      expect(screen.getByText('プレビュー')).toBeInTheDocument()
      expect(screen.getByText('ダウンロード')).toBeInTheDocument()
    })
  })

  describe('スニペットの表示', () => {
    it('スニペットがある場合に表示される', () => {
      render(<SearchResultCard result={mockResult} />)
      expect(
        screen.getByText('これはテスト用のスニペットテキストです。検索キーワードが含まれています。'),
      ).toBeInTheDocument()
    })

    it('スニペットが空の場合は表示されない', () => {
      const resultWithoutSnippet = { ...mockResult, snippet: '' }
      const { container } = render(<SearchResultCard result={resultWithoutSnippet} />)
      const snippetContainer = container.querySelector('.line-clamp-2')
      expect(snippetContainer).not.toBeInTheDocument()
    })

    it('長いスニペットはline-clamp-2で切り捨てられる', () => {
      const { container } = render(<SearchResultCard result={mockResult} />)
      const snippetElement = container.querySelector('.line-clamp-2')
      expect(snippetElement).toBeInTheDocument()
    })
  })

  describe('関連性スコア', () => {
    it('スコアがパーセント形式で表示される', () => {
      render(<SearchResultCard result={mockResult} />)
      expect(screen.getByText('関連度: 95%')).toBeInTheDocument()
    })

    it('スコアが正しく丸められる（0.945 -> 95%）', () => {
      const result = { ...mockResult, relevanceScore: 0.945 }
      render(<SearchResultCard result={result} />)
      expect(screen.getByText('関連度: 95%')).toBeInTheDocument()
    })

    it('スコアが正しく丸められる（0.944 -> 94%）', () => {
      const result = { ...mockResult, relevanceScore: 0.944 }
      render(<SearchResultCard result={result} />)
      expect(screen.getByText('関連度: 94%')).toBeInTheDocument()
    })

    it('低いスコアも正しく表示される', () => {
      const result = { ...mockResult, relevanceScore: 0.15 }
      render(<SearchResultCard result={result} />)
      expect(screen.getByText('関連度: 15%')).toBeInTheDocument()
    })

    it('100%のスコアが正しく表示される', () => {
      const result = { ...mockResult, relevanceScore: 1.0 }
      render(<SearchResultCard result={result} />)
      expect(screen.getByText('関連度: 100%')).toBeInTheDocument()
    })
  })

  describe('レイアウトとスタイル', () => {
    it('カードにホバー効果が適用される', () => {
      const { container } = render(<SearchResultCard result={mockResult} />)
      const card = container.querySelector('.hover\\:shadow-lg')
      expect(card).toBeInTheDocument()
    })

    it('ダークモード用のスタイルクラスが含まれている', () => {
      const { container } = render(<SearchResultCard result={mockResult} />)
      const darkModeElements = container.querySelectorAll('[class*="dark:"]')
      expect(darkModeElements.length).toBeGreaterThan(0)
    })

    it('アニメーションクラスが適用される', () => {
      const { container } = render(<SearchResultCard result={mockResult} />)
      const card = container.querySelector('.animate-fade-in')
      expect(card).toBeInTheDocument()
    })

    it('境界線が表示される', () => {
      const { container } = render(<SearchResultCard result={mockResult} />)
      const card = container.querySelector('.border')
      expect(card).toBeInTheDocument()
    })

    it('角丸が適用される', () => {
      const { container } = render(<SearchResultCard result={mockResult} />)
      const card = container.querySelector('.rounded-2xl')
      expect(card).toBeInTheDocument()
    })
  })

  describe('エッジケース', () => {
    it('ファイル名が非常に長い場合も正しく表示される', () => {
      const longNameResult = {
        ...mockResult,
        fileName: 'これは非常に長いファイル名でスペースとアンダースコアと記号が含まれています_test_file_2024_final_version.pdf',
      }
      render(<SearchResultCard result={longNameResult} />)
      expect(
        screen.getByText(
          'これは非常に長いファイル名でスペースとアンダースコアと記号が含まれています_test_file_2024_final_version.pdf',
        ),
      ).toBeInTheDocument()
    })

    it('パスが非常に長い場合も正しく表示される', () => {
      const longPathResult = {
        ...mockResult,
        filePath:
          '/Documents/Projects/2024/Q4/Reports/Sales/Regional/Tokyo/Branch1/Department/Team/SubTeam/test.pdf',
      }
      render(<SearchResultCard result={longPathResult} />)
      expect(
        screen.getByText(
          '/Documents/Projects/2024/Q4/Reports/Sales/Regional/Tokyo/Branch1/Department/Team/SubTeam/test.pdf',
        ),
      ).toBeInTheDocument()
    })

    it('特殊文字を含むファイル名も正しく表示される', () => {
      const specialCharsResult = {
        ...mockResult,
        fileName: 'test@#$%^&*()_+-=[]{}|;:,.<>?.pdf',
      }
      render(<SearchResultCard result={specialCharsResult} />)
      expect(screen.getByText('test@#$%^&*()_+-=[]{}|;:,.<>?.pdf')).toBeInTheDocument()
    })

    it('日本語のファイル名も正しく表示される', () => {
      const japaneseResult = {
        ...mockResult,
        fileName: '令和6年度事業計画書（最終版）.pdf',
      }
      render(<SearchResultCard result={japaneseResult} />)
      expect(screen.getByText('令和6年度事業計画書（最終版）.pdf')).toBeInTheDocument()
    })

    it('絵文字を含むファイル名も正しく表示される', () => {
      const emojiResult = {
        ...mockResult,
        fileName: 'プロジェクト計画書_📊_2024.pdf',
      }
      render(<SearchResultCard result={emojiResult} />)
      expect(screen.getByText('プロジェクト計画書_📊_2024.pdf')).toBeInTheDocument()
    })
  })
})
