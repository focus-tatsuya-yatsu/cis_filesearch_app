/**
 * NAS同期ボタンコンポーネント
 * フロントエンドからNAS同期をトリガーし、進捗を表示する
 */

import { FC, useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  startSync,
  getSyncProgress,
  getSyncStatusText,
  getSyncStatusColor,
  SyncProgressResponse,
} from '@/lib/api/sync'

interface SyncButtonProps {
  className?: string
  onSyncComplete?: (result: SyncProgressResponse) => void
}

export const SyncButton: FC<SyncButtonProps> = ({ className = '', onSyncComplete }) => {
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncId, setSyncId] = useState<string | null>(null)
  const [progress, setProgress] = useState<SyncProgressResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showProgress, setShowProgress] = useState(false)
  const pollingRef = useRef<NodeJS.Timeout | null>(null)

  // 進捗ポーリング
  const pollProgress = useCallback(async (id: string) => {
    try {
      const progressData = await getSyncProgress(id)
      setProgress(progressData)

      if (progressData.status === 'completed' || progressData.status === 'failed') {
        setIsSyncing(false)
        if (pollingRef.current) {
          clearInterval(pollingRef.current)
          pollingRef.current = null
        }
        if (progressData.status === 'completed' && onSyncComplete) {
          onSyncComplete(progressData)
        }
      }
    } catch (err) {
      console.error('Failed to poll sync progress:', err)
    }
  }, [onSyncComplete])

  // ポーリング開始
  const startPolling = useCallback((id: string) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
    }
    // 即座に1回取得
    pollProgress(id)
    // 3秒ごとにポーリング
    pollingRef.current = setInterval(() => pollProgress(id), 3000)
  }, [pollProgress])

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
      }
    }
  }, [])

  // 同期開始
  const handleSync = async () => {
    try {
      setError(null)
      setIsSyncing(true)
      setShowProgress(true)

      const response = await startSync({
        triggeredBy: 'web-ui',
      })

      setSyncId(response.syncId)
      setProgress({
        syncId: response.syncId,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nasServers: response.nasServers || [],
        fullSync: response.fullSync || false,
        triggeredBy: 'web-ui',
        progress: {
          current: 0,
          total: 4,
          processedFiles: 0,
          errors: 0,
        },
      })

      startPolling(response.syncId)
    } catch (err) {
      setIsSyncing(false)
      setError(err instanceof Error ? err.message : '同期の開始に失敗しました')
    }
  }

  // 進捗パネルを閉じる
  const handleCloseProgress = () => {
    setShowProgress(false)
    setSyncId(null)
    setProgress(null)
  }

  // 進捗バーの計算
  const progressPercent = progress?.progress
    ? (progress.progress.current / progress.progress.total) * 100
    : 0

  const statusColor = progress ? getSyncStatusColor(progress.status) : 'gray'
  const statusText = progress ? getSyncStatusText(progress.status) : ''

  const colorClasses = {
    gray: 'bg-gray-500',
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    red: 'bg-red-500',
  }

  return (
    <div className={`relative ${className}`}>
      {/* 同期ボタン */}
      <button
        onClick={handleSync}
        disabled={isSyncing}
        className={`
          inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium
          transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2
          ${isSyncing
            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
            : 'bg-primary-600 text-white hover:bg-primary-700 hover:scale-[1.02] active:scale-[0.98] focus:ring-primary-500'
          }
        `}
      >
        {isSyncing ? (
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        )}
        {isSyncing ? '同期中...' : 'NAS同期'}
      </button>

      {/* エラーメッセージ */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-full left-0 mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm max-w-xs z-10"
          >
            <div className="flex items-start gap-2">
              <svg className="h-4 w-4 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p>{error}</p>
                <button
                  onClick={() => setError(null)}
                  className="mt-1 text-xs underline hover:no-underline"
                >
                  閉じる
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 進捗パネル */}
      <AnimatePresence>
        {showProgress && progress && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="absolute top-full right-0 mt-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden z-20"
          >
            {/* ヘッダー */}
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${colorClasses[statusColor]} ${
                    progress.status === 'in_progress' ? 'animate-pulse' : ''
                  }`}
                />
                <span className="font-medium text-gray-900 dark:text-white">
                  NAS同期 - {statusText}
                </span>
              </div>
              {(progress.status === 'completed' || progress.status === 'failed') && (
                <button
                  onClick={handleCloseProgress}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              )}
            </div>

            {/* 進捗バー */}
            <div className="px-4 py-3">
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-2">
                <motion.div
                  className={`h-2 rounded-full ${colorClasses[statusColor]}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>
                  {progress.progress?.current || 0} / {progress.progress?.total || 4} NAS
                </span>
                <span>{Math.round(progressPercent)}%</span>
              </div>
            </div>

            {/* 詳細情報 */}
            {progress.progress && (
              <div className="px-4 pb-3 space-y-1 text-sm text-gray-600 dark:text-gray-300">
                {progress.progress.currentNas && (
                  <p>処理中: {progress.progress.currentNas}</p>
                )}
                <div className="flex justify-between">
                  <span>処理ファイル数:</span>
                  <span>{progress.progress.processedFiles || 0}</span>
                </div>
                {progress.progress.errors > 0 && (
                  <div className="flex justify-between text-red-600 dark:text-red-400">
                    <span>エラー:</span>
                    <span>{progress.progress.errors}</span>
                  </div>
                )}
              </div>
            )}

            {/* 完了結果 */}
            {progress.status === 'completed' && progress.result && (
              <div className="px-4 pb-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                  同期完了
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <div className="flex justify-between">
                    <span>新規:</span>
                    <span className="text-green-600">{progress.result.newFiles}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>変更:</span>
                    <span className="text-blue-600">{progress.result.changedFiles}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>削除:</span>
                    <span className="text-gray-600">{progress.result.deletedFiles}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>同期:</span>
                    <span className="text-primary-600">{progress.result.syncedFiles}</span>
                  </div>
                </div>
              </div>
            )}

            {/* エラーメッセージ */}
            {progress.status === 'failed' && progress.errorMessage && (
              <div className="px-4 pb-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm text-red-600 dark:text-red-400">
                  {progress.errorMessage}
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default SyncButton
