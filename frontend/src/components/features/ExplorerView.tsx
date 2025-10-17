'use client'

import { FC, useState } from 'react'

import { GripVertical } from 'lucide-react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

import type { SearchResult } from '@/types'

import { FolderTree } from './FolderTree'
import { SearchResultCard } from './SearchResultCard'

// ダミーのフォルダ構造データ
const dummyFolderData = [
  {
    id: '1',
    name: 'Documents',
    type: 'folder' as const,
    path: '/Documents',
    children: [
      {
        id: '2',
        name: 'Planning',
        type: 'folder' as const,
        path: '/Documents/Planning',
        children: [
          {
            id: '3',
            name: 'FY2024',
            type: 'folder' as const,
            path: '/Documents/Planning/FY2024',
            children: [
              {
                id: '4',
                name: '2024年度事業計画書.pdf',
                type: 'file' as const,
                path: '/Documents/Planning/FY2024/2024年度事業計画書.pdf',
              },
              {
                id: '5',
                name: '予算案.xlsx',
                type: 'file' as const,
                path: '/Documents/Planning/FY2024/予算案.xlsx',
              },
            ],
          },
        ],
      },
      {
        id: '6',
        name: 'Reports',
        type: 'folder' as const,
        path: '/Documents/Reports',
        children: [
          {
            id: '7',
            name: 'Sales',
            type: 'folder' as const,
            path: '/Documents/Reports/Sales',
            children: [
              {
                id: '8',
                name: '2024Q3',
                type: 'folder' as const,
                path: '/Documents/Reports/Sales/2024Q3',
                children: [
                  {
                    id: '9',
                    name: '売上分析レポート_Q3.xlsx',
                    type: 'file' as const,
                    path: '/Documents/Reports/Sales/2024Q3/売上分析レポート_Q3.xlsx',
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: '10',
        name: 'Marketing',
        type: 'folder' as const,
        path: '/Documents/Marketing',
        children: [
          {
            id: '11',
            name: 'Catalogs',
            type: 'folder' as const,
            path: '/Documents/Marketing/Catalogs',
            children: [
              {
                id: '12',
                name: '製品カタログ2024.docx',
                type: 'file' as const,
                path: '/Documents/Marketing/Catalogs/製品カタログ2024.docx',
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: '13',
    name: 'Projects',
    type: 'folder' as const,
    path: '/Projects',
    children: [
      {
        id: '14',
        name: 'ProjectA',
        type: 'folder' as const,
        path: '/Projects/ProjectA',
        children: [],
      },
      {
        id: '15',
        name: 'ProjectB',
        type: 'folder' as const,
        path: '/Projects/ProjectB',
        children: [],
      },
    ],
  },
  {
    id: '16',
    name: 'Resources',
    type: 'folder' as const,
    path: '/Resources',
    children: [],
  },
]

interface ExplorerViewProps {
  searchResults: SearchResult[]
  onPreview?: (id: string) => void
  onDownload?: (id: string) => void
}

export const ExplorerView: FC<ExplorerViewProps> = ({ searchResults, onPreview, onDownload }) => {
  const [selectedFolder, setSelectedFolder] = useState<string>('')

  const handleFolderSelect = (path: string) => {
    setSelectedFolder(path)
    // TODO: 実際のフォルダ内容の取得処理を実装
  }

  return (
    <div className="h-[600px] bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl border border-[#D1D1D6]/30 dark:border-[#38383A]/30 rounded-2xl overflow-hidden shadow-sm">
      <PanelGroup direction="horizontal">
        {/* 左パネル: ツリービュー */}
        <Panel defaultSize={25} minSize={15} maxSize={40}>
          <div className="h-full bg-[#F5F5F7] dark:bg-[#1C1C1E] border-r border-[#D1D1D6]/30 dark:border-[#38383A]/30">
            {/* ヘッダー */}
            <div className="px-4 py-2 border-b border-[#D1D1D6]/30 dark:border-[#38383A]/30">
              <h3 className="text-sm font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                フォルダ構造
              </h3>
            </div>
            {/* ツリービュー */}
            <div className="overflow-y-auto h-[calc(100%-40px)] p-2">
              <FolderTree
                data={dummyFolderData}
                onSelectFolder={handleFolderSelect}
                selectedPath={selectedFolder}
              />
            </div>
          </div>
        </Panel>

        {/* リサイズハンドル */}
        <PanelResizeHandle className="w-1 bg-[#D1D1D6]/30 dark:bg-[#38383A]/30 hover:bg-[#007AFF]/30 dark:hover:bg-[#0A84FF]/30 transition-colors cursor-col-resize flex items-center justify-center">
          <GripVertical className="w-4 h-4 text-[#8E8E93]" />
        </PanelResizeHandle>

        {/* 右パネル: 検索結果 */}
        <Panel defaultSize={75}>
          <div className="h-full bg-white/90 dark:bg-[#1C1C1E]/90">
            {/* ヘッダー */}
            <div className="px-4 py-2 border-b border-[#D1D1D6]/30 dark:border-[#38383A]/30 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                {selectedFolder ? `${selectedFolder} の検索結果` : '検索結果'}
              </h3>
              <span className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">
                {searchResults.length}件
              </span>
            </div>
            {/* 検索結果リスト */}
            <div className="overflow-y-auto h-[calc(100%-40px)] p-4 space-y-4">
              {searchResults.length > 0 ? (
                searchResults.map((result) => (
                  <SearchResultCard
                    key={result.id}
                    result={result}
                    onPreview={onPreview}
                    onDownload={onDownload}
                  />
                ))
              ) : (
                <div className="text-center py-20">
                  <p className="text-[#6E6E73] dark:text-[#8E8E93]">
                    {selectedFolder
                      ? `${selectedFolder} に検索結果がありません`
                      : 'フォルダを選択するか、検索を実行してください'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  )
}
