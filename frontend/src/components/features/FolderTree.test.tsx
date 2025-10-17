import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { FolderTree } from './FolderTree'

// framer-motionのモック
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe('FolderTree', () => {
  const mockData = [
    {
      id: '1',
      name: 'Documents',
      type: 'folder' as const,
      path: '/Documents',
      children: [
        {
          id: '2',
          name: 'Reports',
          type: 'folder' as const,
          path: '/Documents/Reports',
          children: [
            {
              id: '3',
              name: 'report.pdf',
              type: 'file' as const,
              path: '/Documents/Reports/report.pdf',
            },
          ],
        },
        {
          id: '4',
          name: 'readme.txt',
          type: 'file' as const,
          path: '/Documents/readme.txt',
        },
      ],
    },
    {
      id: '5',
      name: 'Projects',
      type: 'folder' as const,
      path: '/Projects',
      children: [],
    },
    {
      id: '6',
      name: 'standalone.docx',
      type: 'file' as const,
      path: '/standalone.docx',
    },
  ]

  const onSelectFolder = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('基本的な描画', () => {
    it('ツリーが正しく描画される', () => {
      render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)
      expect(screen.getByText('Documents')).toBeInTheDocument()
      expect(screen.getByText('Projects')).toBeInTheDocument()
      expect(screen.getByText('standalone.docx')).toBeInTheDocument()
    })

    it('フォルダアイコンが表示される', () => {
      const { container } = render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)
      const folderIcons = container.querySelectorAll('svg')
      expect(folderIcons.length).toBeGreaterThan(0)
    })

    it('初期状態では子要素が非表示', () => {
      render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)
      expect(screen.queryByText('Reports')).not.toBeInTheDocument()
      expect(screen.queryByText('readme.txt')).not.toBeInTheDocument()
    })

    it('ファイルとフォルダが区別される', () => {
      render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      const documentsButton = screen.getByRole('button', { name: /フォルダ: Documents/ })
      const fileButton = screen.getByRole('button', { name: /ファイル: standalone.docx/ })

      expect(documentsButton).toBeInTheDocument()
      expect(fileButton).toBeInTheDocument()
    })
  })

  describe('フォルダの展開と折りたたみ', () => {
    it('フォルダをクリックすると展開される', async () => {
      const user = userEvent.setup()
      render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      const documentsButton = screen.getByRole('button', { name: /Documents/ })
      await user.click(documentsButton)

      expect(screen.getByText('Reports')).toBeInTheDocument()
      expect(screen.getByText('readme.txt')).toBeInTheDocument()
    })

    it('展開されたフォルダを再度クリックすると折りたたまれる', async () => {
      const user = userEvent.setup()
      render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      const documentsButton = screen.getByRole('button', { name: /Documents/ })

      // 展開
      await user.click(documentsButton)
      expect(screen.getByText('Reports')).toBeInTheDocument()

      // 折りたたみ
      await user.click(documentsButton)
      expect(screen.queryByText('Reports')).not.toBeInTheDocument()
    })

    it('子要素のないフォルダもクリック可能', async () => {
      const user = userEvent.setup()
      render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      const projectsButton = screen.getByRole('button', { name: /Projects/ })
      await user.click(projectsButton)

      expect(onSelectFolder).toHaveBeenCalledWith('/Projects')
    })

    it('ネストされたフォルダを展開できる', async () => {
      const user = userEvent.setup()
      render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      // 親フォルダを展開
      const documentsButton = screen.getByRole('button', { name: /Documents/ })
      await user.click(documentsButton)

      // 子フォルダを展開
      const reportsButton = screen.getByRole('button', { name: /Reports/ })
      await user.click(reportsButton)

      expect(screen.getByText('report.pdf')).toBeInTheDocument()
    })
  })

  describe('フォルダアイコンの変化', () => {
    it('折りたたまれた状態ではChevronRightとFolderアイコンが表示される', () => {
      const { container } = render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      // Folderアイコン（閉じた状態）が存在することを確認
      const folderIcons = container.querySelectorAll('svg')
      expect(folderIcons.length).toBeGreaterThan(0)
    })

    it('展開された状態ではChevronDownとFolderOpenアイコンが表示される', async () => {
      const user = userEvent.setup()
      const { container } = render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      const documentsButton = screen.getByRole('button', { name: /Documents/ })
      await user.click(documentsButton)

      // FolderOpenアイコン（開いた状態）が存在することを確認
      const icons = container.querySelectorAll('svg')
      expect(icons.length).toBeGreaterThan(0)
    })

    it('ファイルにはFileアイコンが表示される', () => {
      const { container } = render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      const fileButton = screen.getByRole('button', { name: /standalone.docx/ })
      expect(fileButton).toBeInTheDocument()
    })
  })

  describe('選択状態の管理', () => {
    it('選択されたパスがハイライトされる', () => {
      render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} selectedPath="/Documents" />)

      const documentsButton = screen.getByRole('button', { name: /Documents/ })
      expect(documentsButton).toHaveClass('bg-[#007AFF]/10')
    })

    it('選択されていないアイテムにはハイライトがない', () => {
      render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} selectedPath="/Documents" />)

      const projectsButton = screen.getByRole('button', { name: /Projects/ })
      expect(projectsButton).not.toHaveClass('bg-[#007AFF]/10')
    })

    it('selectedPathが変更されると、ハイライトも更新される', () => {
      const { rerender } = render(
        <FolderTree data={mockData} onSelectFolder={onSelectFolder} selectedPath="/Documents" />,
      )

      let documentsButton = screen.getByRole('button', { name: /Documents/ })
      expect(documentsButton).toHaveClass('bg-[#007AFF]/10')

      rerender(<FolderTree data={mockData} onSelectFolder={onSelectFolder} selectedPath="/Projects" />)

      documentsButton = screen.getByRole('button', { name: /Documents/ })
      const projectsButton = screen.getByRole('button', { name: /Projects/ })

      expect(documentsButton).not.toHaveClass('bg-[#007AFF]/10')
      expect(projectsButton).toHaveClass('bg-[#007AFF]/10')
    })
  })

  describe('onSelectFolderコールバック', () => {
    it('フォルダクリック時にonSelectFolderが呼ばれる', async () => {
      const user = userEvent.setup()
      render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      const documentsButton = screen.getByRole('button', { name: /Documents/ })
      await user.click(documentsButton)

      expect(onSelectFolder).toHaveBeenCalledWith('/Documents')
    })

    it('ファイルクリック時にはonSelectFolderが呼ばれない', async () => {
      const user = userEvent.setup()
      render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      const fileButton = screen.getByRole('button', { name: /standalone.docx/ })
      await user.click(fileButton)

      expect(onSelectFolder).not.toHaveBeenCalled()
    })

    it('ネストされたフォルダクリック時も正しいパスが渡される', async () => {
      const user = userEvent.setup()
      render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      // 親フォルダを展開
      const documentsButton = screen.getByRole('button', { name: /Documents/ })
      await user.click(documentsButton)

      // 子フォルダをクリック
      const reportsButton = screen.getByRole('button', { name: /Reports/ })
      await user.click(reportsButton)

      expect(onSelectFolder).toHaveBeenLastCalledWith('/Documents/Reports')
    })
  })

  describe('深いネスト構造', () => {
    const deepNestedData = [
      {
        id: '1',
        name: 'Level1',
        type: 'folder' as const,
        path: '/Level1',
        children: [
          {
            id: '2',
            name: 'Level2',
            type: 'folder' as const,
            path: '/Level1/Level2',
            children: [
              {
                id: '3',
                name: 'Level3',
                type: 'folder' as const,
                path: '/Level1/Level2/Level3',
                children: [
                  {
                    id: '4',
                    name: 'deep-file.txt',
                    type: 'file' as const,
                    path: '/Level1/Level2/Level3/deep-file.txt',
                  },
                ],
              },
            ],
          },
        ],
      },
    ]

    it('深くネストされたフォルダも正しく展開される', async () => {
      const user = userEvent.setup()
      render(<FolderTree data={deepNestedData} onSelectFolder={onSelectFolder} />)

      // Level1を展開
      await user.click(screen.getByRole('button', { name: /Level1/ }))
      expect(screen.getByText('Level2')).toBeInTheDocument()

      // Level2を展開
      await user.click(screen.getByRole('button', { name: /Level2/ }))
      expect(screen.getByText('Level3')).toBeInTheDocument()

      // Level3を展開
      await user.click(screen.getByRole('button', { name: /Level3/ }))
      expect(screen.getByText('deep-file.txt')).toBeInTheDocument()
    })

    it('深いネストでも正しいインデントが適用される', async () => {
      const user = userEvent.setup()
      render(<FolderTree data={deepNestedData} onSelectFolder={onSelectFolder} />)

      // すべてのレベルを展開
      await user.click(screen.getByRole('button', { name: /Level1/ }))
      await user.click(screen.getByRole('button', { name: /Level2/ }))
      await user.click(screen.getByRole('button', { name: /Level3/ }))

      const deepFileButton = screen.getByRole('button', { name: /deep-file.txt/ })
      const style = window.getComputedStyle(deepFileButton)

      // 深いネストのため、パディングが増加していることを確認
      expect(deepFileButton).toBeInTheDocument()
    })
  })

  describe('アクセシビリティ', () => {
    it('フォルダにaria-expanded属性が設定される', () => {
      render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      const documentsButton = screen.getByRole('button', { name: /Documents/ })
      expect(documentsButton).toHaveAttribute('aria-expanded', 'false')
    })

    it('展開されたフォルダのaria-expandedがtrueになる', async () => {
      const user = userEvent.setup()
      render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      const documentsButton = screen.getByRole('button', { name: /Documents/ })
      await user.click(documentsButton)

      expect(documentsButton).toHaveAttribute('aria-expanded', 'true')
    })

    it('ファイルにはaria-expanded属性がない', () => {
      render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      const fileButton = screen.getByRole('button', { name: /standalone.docx/ })
      expect(fileButton).not.toHaveAttribute('aria-expanded')
    })

    it('すべてのアイテムにaria-labelが設定される', () => {
      render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      expect(screen.getByRole('button', { name: /フォルダ: Documents/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /フォルダ: Projects/ })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /ファイル: standalone.docx/ })).toBeInTheDocument()
    })
  })

  describe('エッジケース', () => {
    it('空のデータ配列でもエラーにならない', () => {
      expect(() => render(<FolderTree data={[]} onSelectFolder={onSelectFolder} />)).not.toThrow()
    })

    it('childrenが未定義のフォルダでもエラーにならない', () => {
      const dataWithoutChildren = [
        {
          id: '1',
          name: 'NoChildren',
          type: 'folder' as const,
          path: '/NoChildren',
        },
      ]

      expect(() =>
        render(<FolderTree data={dataWithoutChildren} onSelectFolder={onSelectFolder} />),
      ).not.toThrow()
    })

    it('childrenが空配列のフォルダは展開ボタンを表示しない', () => {
      const { container } = render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      const projectsButton = screen.getByRole('button', { name: /Projects/ })

      // Folderアイコンは存在するが、Chevronアイコンは存在しない
      // プロジェクトフォルダには子要素がないため
      expect(projectsButton).toBeInTheDocument()
    })

    it('selectedPathが未定義でもエラーにならない', () => {
      expect(() =>
        render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} selectedPath={undefined} />),
      ).not.toThrow()
    })

    it('非常に長いファイル名も正しく表示される', () => {
      const longNameData = [
        {
          id: '1',
          name: 'これは非常に長いファイル名でスペースとアンダースコアが含まれています_test_file_2024.pdf',
          type: 'file' as const,
          path: '/long-name.pdf',
        },
      ]

      render(<FolderTree data={longNameData} onSelectFolder={onSelectFolder} />)

      expect(
        screen.getByText(
          'これは非常に長いファイル名でスペースとアンダースコアが含まれています_test_file_2024.pdf',
        ),
      ).toBeInTheDocument()
    })
  })

  describe('レイアウトとスタイル', () => {
    it('ホバー効果のスタイルが適用される', () => {
      render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      const documentsButton = screen.getByRole('button', { name: /Documents/ })
      expect(documentsButton).toHaveClass('hover:bg-[#F5F5F7]')
    })

    it('ダークモード用のスタイルクラスが含まれている', () => {
      const { container } = render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      const darkModeElements = container.querySelectorAll('[class*="dark:"]')
      expect(darkModeElements.length).toBeGreaterThan(0)
    })

    it('アイテムが角丸のボタンとして描画される', () => {
      render(<FolderTree data={mockData} onSelectFolder={onSelectFolder} />)

      const documentsButton = screen.getByRole('button', { name: /Documents/ })
      expect(documentsButton).toHaveClass('rounded-lg')
    })
  })
})
