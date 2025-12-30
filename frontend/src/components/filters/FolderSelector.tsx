/**
 * フォルダ選択コンポーネント
 *
 * サーバー内のフォルダ選択を管理（H22_JOB～H31_JOB等）
 */

'use client'

import { FC } from 'react'
import { FolderIcon, FolderOpenIcon } from '@heroicons/react/24/outline'
import { useFilterStore, Folder } from '@/stores/useFilterStore'

interface FolderSelectorProps {
  serverId: string
  folders: Folder[]
}

/**
 * FolderSelector コンポーネント
 *
 * 特定サーバー配下のフォルダ選択UI
 * - フォルダごとのチェックボックス
 * - ファイル数の表示
 * - 全選択/全解除機能
 */
export const FolderSelector: FC<FolderSelectorProps> = ({ serverId, folders }) => {
  const {
    selectedFolderIds,
    toggleFolder,
    selectAllFoldersInServer,
    deselectAllFoldersInServer
  } = useFilterStore()

  // 全選択/一部選択の状態を判定
  const selectedCount = folders.filter(f => selectedFolderIds.includes(f.id)).length
  const allSelected = selectedCount === folders.length && folders.length > 0
  const someSelected = selectedCount > 0 && selectedCount < folders.length

  // 全選択/全解除ハンドラー
  const handleSelectAll = () => {
    if (allSelected) {
      deselectAllFoldersInServer(serverId)
    } else {
      selectAllFoldersInServer(serverId)
    }
  }

  // フォルダグループ化（年度系とその他で分ける）
  const jobFolders = folders.filter(f => f.name.includes('_JOB'))
  const otherFolders = folders.filter(f => !f.name.includes('_JOB'))

  // ファイル数のフォーマット
  const formatFileCount = (count?: number) => {
    if (!count) return ''
    if (count >= 10000) {
      return `${Math.floor(count / 10000)}万+`
    } else if (count >= 1000) {
      return `${Math.floor(count / 1000)}千+`
    }
    return count.toString()
  }

  // フォルダレンダリング関数
  const renderFolder = (folder: Folder) => {
    const isSelected = selectedFolderIds.includes(folder.id)

    return (
      <label
        key={folder.id}
        className={`
          flex items-center justify-between px-4 py-2.5
          cursor-pointer transition-colors
          hover:bg-[#F2F2F7] dark:hover:bg-[#3A3A3C]
          ${isSelected ? 'bg-[#007AFF]/5 dark:bg-[#007AFF]/10' : ''}
        `}
      >
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleFolder(folder.id)}
            className="
              w-4 h-4
              text-[#007AFF]
              bg-white dark:bg-[#1C1C1E]
              border-[#D2D2D7] dark:border-[#48484A]
              rounded
              focus:ring-2 focus:ring-[#007AFF] focus:ring-offset-0
              transition-colors
            "
            aria-label={`${folder.name}を選択`}
          />
          <div className="flex items-center gap-2">
            {isSelected ? (
              <FolderOpenIcon className="w-5 h-5 text-[#007AFF]" />
            ) : (
              <FolderIcon className="w-5 h-5 text-[#6E6E73] dark:text-[#8E8E93]" />
            )}
            <span className={`
              text-sm font-medium
              ${isSelected
                ? 'text-[#007AFF] dark:text-[#0A84FF]'
                : 'text-[#1D1D1F] dark:text-[#F5F5F7]'
              }
            `}>
              {folder.name}
            </span>
          </div>
        </div>

        {folder.fileCount !== undefined && (
          <span className="text-xs text-[#6E6E73] dark:text-[#8E8E93] font-medium">
            {formatFileCount(folder.fileCount)}ファイル
          </span>
        )}
      </label>
    )
  }

  return (
    <div className="bg-white dark:bg-[#1C1C1E]">
      {/* 全選択ヘッダー */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#F9F9F9] dark:bg-[#2C2C2E] border-b border-[#E5E5EA] dark:border-[#3A3A3C]">
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={allSelected}
            ref={input => {
              if (input) {
                input.indeterminate = someSelected
              }
            }}
            onChange={handleSelectAll}
            className="
              w-4 h-4
              text-[#007AFF]
              bg-white dark:bg-[#1C1C1E]
              border-[#D2D2D7] dark:border-[#48484A]
              rounded
              focus:ring-2 focus:ring-[#007AFF] focus:ring-offset-0
              transition-colors
            "
            aria-label="全フォルダを選択"
          />
          <span className="ml-2 text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
            全フォルダ選択
          </span>
        </label>
        <span className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">
          {selectedCount}/{folders.length}
        </span>
      </div>

      {/* フォルダリスト */}
      <div className="divide-y divide-[#E5E5EA] dark:divide-[#3A3A3C]">
        {/* 年度フォルダ（H22_JOB～H31_JOB） */}
        {jobFolders.length > 0 && (
          <div>
            {jobFolders.map(folder => renderFolder(folder))}
          </div>
        )}

        {/* その他のフォルダ */}
        {otherFolders.length > 0 && (
          <div>
            {jobFolders.length > 0 && (
              <div className="px-4 py-2 bg-[#F9F9F9] dark:bg-[#2C2C2E]">
                <span className="text-xs font-semibold text-[#6E6E73] dark:text-[#8E8E93] uppercase tracking-wider">
                  その他
                </span>
              </div>
            )}
            {otherFolders.map(folder => renderFolder(folder))}
          </div>
        )}
      </div>
    </div>
  )
}