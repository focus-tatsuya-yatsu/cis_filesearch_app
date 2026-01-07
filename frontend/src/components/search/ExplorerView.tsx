'use client'

import { FC, useState, useMemo, useCallback } from 'react'

import { ChevronRight } from 'lucide-react'
import { Pagination } from '@/components/ui'
import { useSidebarState } from '@/hooks'
import type { SearchResult, TreeNode } from '@/types'

import { FolderTree } from '../features/FolderTree'
import { VirtualizedSearchResults } from './VirtualizedSearchResults'

/**
 * S3パスをNAS構造のパスに変換
 * 例: s3:/cis-filesearch-s3-landing/documents/road/ts-server3/H25_JOB/...
 *   → ts-server3/H25_JOB/...
 */
const convertS3PathToNASPath = (s3Path: string): string => {
  // バックスラッシュをスラッシュに変換
  let path = s3Path.replace(/\\/g, '/')

  // s3: プレフィックスを除去
  path = path.replace(/^s3:/, '')

  // 先頭のスラッシュを除去
  path = path.replace(/^\/+/, '')

  // NASサーバー名のパターン（ts-server1, ts-server2, ts-server3, ts-server5など）
  const serverPattern = /(ts-server\d+)/
  const match = path.match(serverPattern)

  if (match) {
    // サーバー名以降の部分を抽出
    const serverIndex = path.indexOf(match[1])
    return path.substring(serverIndex)
  }

  // サーバー名が見つからない場合は、既知のプレフィックスを除去
  const prefixesToRemove = [
    'cis-filesearch-s3-landing/documents/road/',
    'cis-filesearch-s3-landing/documents/',
    'cis-filesearch-s3-landing/',
  ]

  for (const prefix of prefixesToRemove) {
    if (path.startsWith(prefix)) {
      return path.substring(prefix.length)
    }
  }

  return path
}

/**
 * 検索結果のファイルパスからフォルダツリーを構築
 * NAS構造を模倣した階層構造を生成
 */
const buildFolderTreeFromResults = (results: SearchResult[]): TreeNode[] => {
  const root: Map<string, TreeNode> = new Map()
  let nodeId = 0

  const getOrCreateNode = (
    parentMap: Map<string, TreeNode>,
    pathParts: string[],
    currentIndex: number,
    fullPath: string
  ): TreeNode => {
    const name = pathParts[currentIndex]
    const isFile = currentIndex === pathParts.length - 1
    const path = '/' + pathParts.slice(0, currentIndex + 1).join('/')

    if (!parentMap.has(name)) {
      const node: TreeNode = {
        id: `node-${nodeId++}`,
        name,
        type: isFile ? 'file' : 'folder',
        path,
        children: isFile ? undefined : [],
      }
      parentMap.set(name, node)
    }

    return parentMap.get(name)!
  }

  // 各検索結果のパスを処理（.metaファイルは除外）
  results
    .filter((result) => !result.fileName.endsWith('.meta'))
    .forEach((result) => {
    // S3パスをNAS構造に変換
    const nasPath = convertS3PathToNASPath(result.filePath)

    const pathParts = nasPath.split('/').filter(Boolean)
    if (pathParts.length === 0) return

    // ルートレベルから階層を構築
    let currentMap = root
    for (let i = 0; i < pathParts.length; i++) {
      const node = getOrCreateNode(currentMap, pathParts, i, nasPath)

      if (i < pathParts.length - 1 && node.children) {
        // 次の階層のためのMapを作成
        const childMap = new Map<string, TreeNode>()
        node.children.forEach(child => childMap.set(child.name, child))

        // 次のノードを取得/作成
        const nextName = pathParts[i + 1]
        if (!childMap.has(nextName)) {
          const isLastFile = i + 1 === pathParts.length - 1
          const childNode: TreeNode = {
            id: `node-${nodeId++}`,
            name: nextName,
            type: isLastFile ? 'file' : 'folder',
            path: '/' + pathParts.slice(0, i + 2).join('/'),
            children: isLastFile ? undefined : [],
          }
          node.children.push(childNode)
          childMap.set(nextName, childNode)
        }
        currentMap = childMap
      }
    }
  })

  // Mapから配列に変換してソート（フォルダ優先、名前順）
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    return nodes
      .map(node => ({
        ...node,
        children: node.children ? sortNodes(node.children) : undefined,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'folder' ? -1 : 1
        }
        return a.name.localeCompare(b.name, 'ja')
      })
  }

  return sortNodes(Array.from(root.values()))
}

interface ExplorerViewProps {
  searchResults: SearchResult[]
  totalResults?: number
  currentPage?: number
  itemsPerPage?: number
  onPageChange?: (page: number) => void
  onPreview?: (id: string) => void
  onDownload?: (id: string) => void
}

/**
 * ExplorerView Component
 *
 * Explorer-style view with:
 * - Dynamic folder tree built from search results
 * - Collapsible sidebar with localStorage persistence
 * - Pagination at the bottom
 * - Smooth animations
 */
export const ExplorerView: FC<ExplorerViewProps> = ({
  searchResults,
  totalResults,
  currentPage = 1,
  itemsPerPage = 50,
  onPageChange,
  onPreview,
  onDownload,
}) => {
  const [selectedFolder, setSelectedFolder] = useState<string>('')
  const [highlightedFilePath, setHighlightedFilePath] = useState<string>('')
  const [highlightKey, setHighlightKey] = useState<number>(0) // 再ハイライト用のキー
  const { isCollapsed, toggleCollapse } = useSidebarState(false)

  // 総件数を表示（渡されていない場合はsearchResults.lengthを使用）
  const displayTotal = totalResults ?? searchResults.length
  const totalPages = Math.ceil(displayTotal / itemsPerPage)

  // 検索結果からフォルダツリーを動的に構築
  const folderTreeData = useMemo(() => {
    return buildFolderTreeFromResults(searchResults)
  }, [searchResults])

  // フォルダ選択時のハンドラ
  const handleFolderSelect = useCallback((path: string) => {
    setSelectedFolder(prev => prev === path ? '' : path)
  }, [])

  // 検索結果クリック時のハンドラ（ツリー内のファイルをハイライト）
  const handleResultClick = useCallback((filePath: string) => {
    // S3パスをNASパスに変換
    const nasPath = '/' + convertS3PathToNASPath(filePath)
    setHighlightedFilePath(nasPath)
    // 再ハイライト用のキーをインクリメント（同じファイルを再クリックした時も動作するように）
    setHighlightKey(prev => prev + 1)
    // フォルダ選択をクリア（フィルタリングを解除）
    setSelectedFolder('')
    // サイドバーが閉じている場合は開く
    if (isCollapsed) {
      toggleCollapse()
    }
  }, [isCollapsed, toggleCollapse])

  // 選択されたフォルダでフィルタリングした検索結果
  const filteredResults = useMemo(() => {
    if (!selectedFolder) return searchResults

    return searchResults.filter(result => {
      // S3パスをNASパスに変換してから比較
      const nasPath = '/' + convertS3PathToNASPath(result.filePath)
      const normalizedNasPath = nasPath.toLowerCase()
      const normalizedSelectedFolder = selectedFolder.toLowerCase()
      return normalizedNasPath.startsWith(normalizedSelectedFolder)
    })
  }, [searchResults, selectedFolder])

  // ページ変更ハンドラ
  const handlePageChange = useCallback((page: number) => {
    if (onPageChange) {
      onPageChange(page)
    }
  }, [onPageChange])

  return (
    <div className="h-[700px] bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl border border-[#D1D1D6]/30 dark:border-[#38383A]/30 rounded-2xl overflow-hidden shadow-sm flex flex-col">
      <div className="flex flex-1 overflow-hidden">
        {/* 左サイドバー: アニメーション付き */}
        <div
          className={`
            flex-shrink-0 border-r border-[#D1D1D6]/30 dark:border-[#38383A]/30
            transition-all duration-300 ease-in-out overflow-hidden
            ${isCollapsed ? 'w-12' : 'w-[280px]'}
          `}
        >
          {isCollapsed ? (
            /* 折りたたみ時のトグルボタン */
            <button
              onClick={toggleCollapse}
              className="w-full h-full bg-[#F5F5F7] dark:bg-[#2C2C2E] flex flex-col items-center justify-center gap-2 hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C] transition-colors"
              aria-label="フォルダ構造を開く"
            >
              <ChevronRight className="w-4 h-4 text-[#6E6E73] dark:text-[#8E8E93]" />
              <span className="text-xs text-[#6E6E73] dark:text-[#8E8E93] [writing-mode:vertical-rl]">フォルダ</span>
            </button>
          ) : (
            /* 展開時のサイドバー */
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#D1D1D6]/30 dark:border-[#38383A]/30">
                <h4 className="text-xs font-semibold text-[#6E6E73] dark:text-[#8E8E93] uppercase tracking-wider">
                  フォルダ構造
                </h4>
                <button
                  onClick={toggleCollapse}
                  className="p-1 hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E] rounded transition-colors"
                  aria-label="サイドバーを閉じる"
                >
                  <ChevronRight className="w-4 h-4 text-[#6E6E73] dark:text-[#8E8E93] rotate-180" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {folderTreeData.length > 0 ? (
                  <FolderTree
                    key={highlightKey}
                    data={folderTreeData}
                    onSelectFolder={handleFolderSelect}
                    selectedPath={selectedFolder}
                    highlightedFilePath={highlightedFilePath}
                  />
                ) : (
                  <p className="text-xs text-[#8E8E93] px-2">
                    検索結果がありません
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 右パネル: 検索結果 */}
        <div className="flex-1 h-full bg-white/90 dark:bg-[#1C1C1E]/90 flex flex-col min-w-0">
          {/* ヘッダー */}
          <div className="px-4 py-3 border-b border-[#D1D1D6]/30 dark:border-[#38383A]/30 flex items-center justify-between bg-white/50 dark:bg-[#1C1C1E]/50 backdrop-blur-sm">
            <h3 className="text-sm font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
              {selectedFolder ? (
                <>
                  <span className="text-[#6E6E73] dark:text-[#8E8E93]">フォルダ: </span>
                  {selectedFolder}
                </>
              ) : (
                '検索結果'
              )}
            </h3>
            <span className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">
              {selectedFolder
                ? `${filteredResults.length.toLocaleString()}件 / ${displayTotal.toLocaleString()}件中`
                : `${displayTotal.toLocaleString()}件`
              }
            </span>
          </div>

          {/* 検索結果リスト */}
          <div className="flex-1 p-4 overflow-hidden">
            {filteredResults.length > 0 ? (
              <VirtualizedSearchResults
                results={filteredResults}
                onPreview={onPreview || (() => {})}
                onDownload={onDownload || (() => {})}
                onResultClick={handleResultClick}
                viewMode="list"
                className="h-full"
              />
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
      </div>

      {/* ページネーション */}
      {totalPages > 1 && !selectedFolder && (
        <div className="border-t border-[#D1D1D6]/30 dark:border-[#38383A]/30 bg-white/50 dark:bg-[#1C1C1E]/50 backdrop-blur-sm">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={displayTotal}
            itemsPerPage={itemsPerPage}
            onPageChange={handlePageChange}
          />
        </div>
      )}
    </div>
  )
}
