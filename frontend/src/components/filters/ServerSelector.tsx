/**
 * サーバー選択コンポーネント
 *
 * 個別サーバーまたは全サーバーの選択を管理
 */

'use client'

import { FC, useMemo } from 'react'

import { useFilterStore } from '@/stores/useFilterStore'

interface ServerSelectorProps {
  serverId?: string // 特定のサーバーID（指定しない場合は全サーバー選択）
}

/**
 * ServerSelector コンポーネント
 *
 * チェックボックスによるサーバー選択UI
 * - 個別サーバー選択: serverId を指定
 * - 全サーバー選択: serverId を指定しない
 */
export const ServerSelector: FC<ServerSelectorProps> = ({ serverId }) => {
  const { servers, selectedServerIds, toggleServer, selectAllServers, deselectAllServers } =
    useFilterStore()

  // 全選択/個別選択の状態を計算
  const { isChecked, isIndeterminate } = useMemo(() => {
    if (serverId) {
      // 個別サーバーの場合
      return {
        isChecked: selectedServerIds.includes(serverId),
        isIndeterminate: false,
      }
    } else {
      // 全サーバー選択の場合
      const allSelected = servers.length > 0 && selectedServerIds.length === servers.length
      const someSelected = selectedServerIds.length > 0 && selectedServerIds.length < servers.length

      return {
        isChecked: allSelected,
        isIndeterminate: someSelected,
      }
    }
  }, [serverId, servers, selectedServerIds])

  // クリックハンドラー
  const handleClick = () => {
    if (serverId) {
      // 個別サーバーをトグル
      toggleServer(serverId)
    } else {
      // 全サーバーを選択/解除
      if (isChecked) {
        deselectAllServers()
      } else {
        selectAllServers()
      }
    }
  }

  // サーバー情報取得
  const server = serverId ? servers.find((s) => s.id === serverId) : null

  return (
    <label className="inline-flex items-center cursor-pointer group">
      <input
        type="checkbox"
        checked={isChecked}
        ref={(input) => {
          if (input) {
            input.indeterminate = isIndeterminate
          }
        }}
        onChange={handleClick}
        className="
          w-4 h-4
          text-[#007AFF]
          bg-white dark:bg-[#1C1C1E]
          border-[#D2D2D7] dark:border-[#48484A]
          rounded
          focus:ring-2 focus:ring-[#007AFF] focus:ring-offset-0
          transition-colors
        "
        aria-label={serverId ? `${server?.name || 'サーバー'}を選択` : '全サーバーを選択'}
      />
      {!serverId && (
        <span className="ml-2 text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7] select-none">
          全て選択
        </span>
      )}
    </label>
  )
}
