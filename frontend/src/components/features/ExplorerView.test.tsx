import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { SearchResult } from '@/types'

import { ExplorerView } from './ExplorerView'

// react-resizable-panelsのモック
jest.mock('react-resizable-panels', () => ({
  Panel: ({ children }: { children: React.ReactNode }) => <div data-testid="panel">{children}</div>,
  PanelGroup: ({ children }: { children: React.ReactNode }) => <div data-testid="panel-group">{children}</div>,
  PanelResizeHandle: ({ children }: { children: React.ReactNode }) => <div data-testid="panel-resize-handle">{children}</div>,
}))

// FolderTreeとSearchResultCardのモック
jest.mock('./FolderTree', () => ({
  FolderTree: ({ data, onSelectFolder, selectedPath }: any) => (
    <div data-testid="folder-tree">
      <button onClick={() => onSelectFolder('/Documents')}>
        Documents
      </button>
      <div>Selected: {selectedPath || 'none'}</div>
    </div>
  ),
}))

jest.mock('./SearchResultCard', () => ({
  SearchResultCard: ({ result, onPreview, onDownload }: any) => (
    <div data-testid={`search-result-${result.id}`}>
      <div>{result.fileName}</div>
      {onPreview && <button onClick={() => onPreview(result.id)}>Preview</button>}
      {onDownload && <button onClick={() => onDownload(result.id)}>Download</button>}
    </div>
  ),
}))

describe('ExplorerView', () => {
  const mockSearchResults: SearchResult[] = [
    {
      id: '1',
      fileName: 'test1.pdf',
      filePath: '/Documents/test1.pdf',
      fileType: 'pdf',
      fileSize: 1024,
      modifiedDate: '2024-01-01',
      snippet: 'Test content 1',
      relevanceScore: 0.95,
    },
    {
      id: '2',
      fileName: 'test2.docx',
      filePath: '/Documents/test2.docx',
      fileType: 'docx',
      fileSize: 2048,
      modifiedDate: '2024-01-02',
      snippet: 'Test content 2',
      relevanceScore: 0.85,
    },
  ]

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('基本的な描画', () => {
    it('PanelGroupが描画される', () => {
      render(<ExplorerView searchResults={[]} />)
      expect(screen.getByTestId('panel-group')).toBeInTheDocument()
    })

    it('2つのPanelが描画される（左：フォルダツリー、右：検索結果）', () => {
      render(<ExplorerView searchResults={[]} />)
      const panels = screen.getAllByTestId('panel')
      expect(panels).toHaveLength(2)
    })

    it('PanelResizeHandleが描画される', () => {
      render(<ExplorerView searchResults={[]} />)
      expect(screen.getByTestId('panel-resize-handle')).toBeInTheDocument()
    })

    it('リサイズハンドルにGripVerticalアイコンが表示される', () => {
      const { container } = render(<ExplorerView searchResults={[]} />)
      const resizeHandle = screen.getByTestId('panel-resize-handle')
      const svg = resizeHandle.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('左パネルに"フォルダ構造"ヘッダーが表示される', () => {
      render(<ExplorerView searchResults={[]} />)
      expect(screen.getByText('フォルダ構造')).toBeInTheDocument()
    })

    it('右パネルに"検索結果"ヘッダーが表示される', () => {
      render(<ExplorerView searchResults={[]} />)
      expect(screen.getByText('検索結果')).toBeInTheDocument()
    })
  })

  describe('フォルダツリーの統合', () => {
    it('FolderTreeコンポーネントが描画される', () => {
      render(<ExplorerView searchResults={[]} />)
      expect(screen.getByTestId('folder-tree')).toBeInTheDocument()
    })

    it('フォルダ選択時にonSelectFolderが呼ばれる', async () => {
      const user = userEvent.setup()
      render(<ExplorerView searchResults={[]} />)

      const folderButton = screen.getByText('Documents')
      await user.click(folderButton)

      expect(screen.getByText('Selected: /Documents')).toBeInTheDocument()
    })

    it('フォルダ選択時にヘッダーが更新される', async () => {
      const user = userEvent.setup()
      render(<ExplorerView searchResults={[]} />)

      const folderButton = screen.getByText('Documents')
      await user.click(folderButton)

      expect(screen.getByText('/Documents の検索結果')).toBeInTheDocument()
    })
  })

  describe('検索結果の表示', () => {
    it('検索結果が0件の場合、デフォルトメッセージが表示される', () => {
      render(<ExplorerView searchResults={[]} />)
      expect(screen.getByText('フォルダを選択するか、検索を実行してください')).toBeInTheDocument()
    })

    it('フォルダ選択後、検索結果が0件の場合、フォルダ固有のメッセージが表示される', async () => {
      const user = userEvent.setup()
      render(<ExplorerView searchResults={[]} />)

      const folderButton = screen.getByText('Documents')
      await user.click(folderButton)

      expect(screen.getByText('/Documents に検索結果がありません')).toBeInTheDocument()
    })

    it('検索結果の件数が正しく表示される', () => {
      render(<ExplorerView searchResults={mockSearchResults} />)
      expect(screen.getByText('2件')).toBeInTheDocument()
    })

    it('検索結果がある場合、SearchResultCardが描画される', () => {
      render(<ExplorerView searchResults={mockSearchResults} />)
      expect(screen.getByTestId('search-result-1')).toBeInTheDocument()
      expect(screen.getByTestId('search-result-2')).toBeInTheDocument()
    })

    it('各検索結果にファイル名が表示される', () => {
      render(<ExplorerView searchResults={mockSearchResults} />)
      expect(screen.getByText('test1.pdf')).toBeInTheDocument()
      expect(screen.getByText('test2.docx')).toBeInTheDocument()
    })

    it('空の検索結果メッセージが中央に表示される', () => {
      const { container } = render(<ExplorerView searchResults={[]} />)
      const messageContainer = container.querySelector('.text-center.py-20')
      expect(messageContainer).toBeInTheDocument()
    })
  })

  describe('コールバック関数', () => {
    it('onPreviewが渡された場合、SearchResultCardにも渡される', () => {
      const onPreview = jest.fn()
      render(<ExplorerView searchResults={mockSearchResults} onPreview={onPreview} />)

      const previewButtons = screen.getAllByText('Preview')
      expect(previewButtons).toHaveLength(2)
    })

    it('onDownloadが渡された場合、SearchResultCardにも渡される', () => {
      const onDownload = jest.fn()
      render(<ExplorerView searchResults={mockSearchResults} onDownload={onDownload} />)

      const downloadButtons = screen.getAllByText('Download')
      expect(downloadButtons).toHaveLength(2)
    })

    it('onPreviewコールバックが正しく実行される', async () => {
      const user = userEvent.setup()
      const onPreview = jest.fn()
      render(<ExplorerView searchResults={mockSearchResults} onPreview={onPreview} />)

      const previewButtons = screen.getAllByText('Preview')
      await user.click(previewButtons[0])

      expect(onPreview).toHaveBeenCalledWith('1')
    })

    it('onDownloadコールバックが正しく実行される', async () => {
      const user = userEvent.setup()
      const onDownload = jest.fn()
      render(<ExplorerView searchResults={mockSearchResults} onDownload={onDownload} />)

      const downloadButtons = screen.getAllByText('Download')
      await user.click(downloadButtons[0])

      expect(onDownload).toHaveBeenCalledWith('1')
    })
  })

  describe('レイアウトとスタイル', () => {
    it('コンテナに固定高さが設定されている', () => {
      const { container } = render(<ExplorerView searchResults={[]} />)
      const mainContainer = container.querySelector('.h-\\[600px\\]')
      expect(mainContainer).toBeInTheDocument()
    })

    it('左パネルに境界線が表示される', () => {
      const { container } = render(<ExplorerView searchResults={[]} />)
      const leftPanel = container.querySelector('.border-r')
      expect(leftPanel).toBeInTheDocument()
    })

    it('検索結果リストにスペースが設定されている', () => {
      const { container } = render(<ExplorerView searchResults={mockSearchResults} />)
      const resultsList = container.querySelector('.space-y-4')
      expect(resultsList).toBeInTheDocument()
    })

    it('ダークモード用のスタイルクラスが含まれている', () => {
      const { container } = render(<ExplorerView searchResults={[]} />)
      const darkModeElements = container.querySelectorAll('[class*="dark:"]')
      expect(darkModeElements.length).toBeGreaterThan(0)
    })
  })

  describe('スクロール動作', () => {
    it('フォルダツリーエリアにoverflow-y-autoが設定されている', () => {
      const { container } = render(<ExplorerView searchResults={[]} />)
      const treeArea = container.querySelector('.overflow-y-auto')
      expect(treeArea).toBeInTheDocument()
    })

    it('検索結果エリアにoverflow-y-autoが設定されている', () => {
      const { container } = render(<ExplorerView searchResults={mockSearchResults} />)
      const resultsArea = container.querySelectorAll('.overflow-y-auto')
      expect(resultsArea.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('エッジケース', () => {
    it('searchResultsが空配列の場合でもエラーにならない', () => {
      expect(() => render(<ExplorerView searchResults={[]} />)).not.toThrow()
    })

    it('onPreview/onDownloadが未定義でもエラーにならない', () => {
      expect(() => render(<ExplorerView searchResults={mockSearchResults} />)).not.toThrow()
    })

    it('大量の検索結果でも正しく描画される', () => {
      const manyResults: SearchResult[] = Array.from({ length: 100 }, (_, i) => ({
        id: String(i),
        fileName: `test${i}.pdf`,
        filePath: `/test${i}.pdf`,
        fileType: 'pdf',
        fileSize: 1024,
        modifiedDate: '2024-01-01',
        snippet: `Test content ${i}`,
        relevanceScore: 0.9,
      }))

      render(<ExplorerView searchResults={manyResults} />)
      expect(screen.getByText('100件')).toBeInTheDocument()
    })
  })
})
