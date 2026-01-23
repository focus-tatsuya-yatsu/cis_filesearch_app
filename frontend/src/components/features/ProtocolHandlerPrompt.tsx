/**
 * プロトコルハンドラーインストール案内コンポーネント
 *
 * ユーザーがNASファイルを直接開く機能を使用する際に、
 * プロトコルハンドラーがインストールされていない場合に表示する案内
 */

'use client'

import { FC, useState, useCallback } from 'react'

import {
  XMarkIcon,
  FolderOpenIcon,
  ArrowDownTrayIcon,
  CheckCircleIcon,
  InformationCircleIcon,
  ClipboardDocumentIcon,
  ComputerDesktopIcon,
} from '@heroicons/react/24/outline'
import { motion, AnimatePresence } from 'framer-motion'

import {
  PROTOCOL_CONFIG,
  isHandlerMarkedAsInstalled,
  markHandlerAsInstalled,
  dismissInstallPrompt,
  isWindowsOS,
} from '@/lib/protocol-handler'

interface ProtocolHandlerPromptProps {
  /** モーダルの表示状態 */
  isOpen: boolean
  /** モーダルを閉じるコールバック */
  onClose: () => void
  /** パスコピーのコールバック（フォールバック用） */
  onCopyPath?: () => void
  /** 表示するファイルパス（オプション） */
  filePath?: string
}

/**
 * プロトコルハンドラーインストール案内モーダル
 */
export const ProtocolHandlerPrompt: FC<ProtocolHandlerPromptProps> = ({
  isOpen,
  onClose,
  onCopyPath,
  filePath,
}) => {
  const [step, setStep] = useState<'intro' | 'installed' | 'later'>('intro')
  const [copied, setCopied] = useState(false)

  // パスをコピー
  const handleCopyPath = useCallback(async () => {
    if (filePath) {
      try {
        await navigator.clipboard.writeText(filePath)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch (error) {
        console.error('Failed to copy path:', error)
      }
    }
    onCopyPath?.()
  }, [filePath, onCopyPath])

  // インストール済みとしてマーク
  const handleMarkInstalled = useCallback(() => {
    markHandlerAsInstalled()
    setStep('installed')
  }, [])

  // 後でインストール
  const handleDismiss = useCallback(() => {
    dismissInstallPrompt()
    setStep('later')
  }, [])

  // モーダルを閉じる
  const handleClose = useCallback(() => {
    setStep('intro')
    onClose()
  }, [onClose])

  // Windows以外の場合
  const isWindows = isWindowsOS()

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* オーバーレイ */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50"
            onClick={handleClose}
          />

          {/* モーダル */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white dark:bg-[#2C2C2E] rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
              {/* ヘッダー */}
              <div className="flex items-center justify-between p-4 border-b border-[#E5E5EA] dark:border-[#3A3A3C]">
                <div className="flex items-center gap-2">
                  <FolderOpenIcon className="w-6 h-6 text-[#34C759]" />
                  <h2 className="text-lg font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                    NASファイルを開く
                  </h2>
                </div>
                <button
                  onClick={handleClose}
                  className="p-1 hover:bg-[#F2F2F7] dark:hover:bg-[#3A3A3C] rounded-lg transition-colors"
                >
                  <XMarkIcon className="w-5 h-5 text-[#6E6E73]" />
                </button>
              </div>

              {/* コンテンツ */}
              <div className="p-6">
                {!isWindows ? (
                  // Mac/Linux向けメッセージ
                  <div className="text-center">
                    <ComputerDesktopIcon className="w-16 h-16 mx-auto text-[#6E6E73] mb-4" />
                    <h3 className="text-lg font-medium text-[#1D1D1F] dark:text-[#F5F5F7] mb-2">
                      この機能はWindows専用です
                    </h3>
                    <p className="text-sm text-[#6E6E73] dark:text-[#8E8E93] mb-4">
                      Macをご利用の場合は、パスをコピーしてFinderで開いてください。
                    </p>
                    {filePath && (
                      <button
                        onClick={handleCopyPath}
                        className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-[#007AFF] hover:bg-[#0056CC] text-white rounded-xl transition-colors"
                      >
                        {copied ? (
                          <>
                            <CheckCircleIcon className="w-5 h-5" />
                            コピーしました
                          </>
                        ) : (
                          <>
                            <ClipboardDocumentIcon className="w-5 h-5" />
                            パスをコピー
                          </>
                        )}
                      </button>
                    )}
                  </div>
                ) : step === 'intro' ? (
                  // インストール案内
                  <>
                    <div className="flex items-start gap-3 p-4 bg-[#F2F2F7] dark:bg-[#1C1C1E] rounded-xl mb-4">
                      <InformationCircleIcon className="w-6 h-6 text-[#007AFF] flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm text-[#1D1D1F] dark:text-[#F5F5F7] font-medium mb-1">
                          初回セットアップが必要です
                        </p>
                        <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93]">
                          NASファイルを直接開くには、専用ツールのインストールが必要です。
                          一度インストールすれば、次回からはワンクリックで開けます。
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3 mb-6">
                      <h4 className="text-sm font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
                        インストール手順
                      </h4>
                      <ol className="space-y-2 text-sm text-[#6E6E73] dark:text-[#8E8E93]">
                        <li className="flex items-start gap-2">
                          <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center bg-[#007AFF] text-white text-xs rounded-full">
                            1
                          </span>
                          <span>下のボタンからインストーラーをダウンロード</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center bg-[#007AFF] text-white text-xs rounded-full">
                            2
                          </span>
                          <span>ZIPファイルを展開</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center bg-[#007AFF] text-white text-xs rounded-full">
                            3
                          </span>
                          <span>「インストール.bat」をダブルクリック</span>
                        </li>
                      </ol>
                    </div>

                    <div className="space-y-3">
                      <a
                        href={PROTOCOL_CONFIG.installerPath}
                        download
                        className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-[#34C759] hover:bg-[#2FB350] text-white rounded-xl transition-colors"
                      >
                        <ArrowDownTrayIcon className="w-5 h-5" />
                        インストーラーをダウンロード
                      </a>

                      <button
                        onClick={handleMarkInstalled}
                        className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-[#007AFF] hover:bg-[#0056CC] text-white rounded-xl transition-colors"
                      >
                        <CheckCircleIcon className="w-5 h-5" />
                        インストール済み
                      </button>

                      <button
                        onClick={handleDismiss}
                        className="w-full py-2 text-sm text-[#6E6E73] hover:text-[#1D1D1F] dark:hover:text-[#F5F5F7] transition-colors"
                      >
                        後でインストールする
                      </button>
                    </div>
                  </>
                ) : step === 'installed' ? (
                  // インストール済み確認
                  <div className="text-center">
                    <CheckCircleIcon className="w-16 h-16 mx-auto text-[#34C759] mb-4" />
                    <h3 className="text-lg font-medium text-[#1D1D1F] dark:text-[#F5F5F7] mb-2">
                      設定完了！
                    </h3>
                    <p className="text-sm text-[#6E6E73] dark:text-[#8E8E93] mb-6">
                      これからはワンクリックでNASファイルを開けます。
                      もう一度「エクスプローラーで開く」ボタンをクリックしてください。
                    </p>
                    <button
                      onClick={handleClose}
                      className="w-full py-3 px-4 bg-[#007AFF] hover:bg-[#0056CC] text-white rounded-xl transition-colors"
                    >
                      閉じる
                    </button>
                  </div>
                ) : (
                  // 後でインストール
                  <div className="text-center">
                    <InformationCircleIcon className="w-16 h-16 mx-auto text-[#6E6E73] mb-4" />
                    <h3 className="text-lg font-medium text-[#1D1D1F] dark:text-[#F5F5F7] mb-2">
                      代わりにパスをコピーできます
                    </h3>
                    <p className="text-sm text-[#6E6E73] dark:text-[#8E8E93] mb-4">
                      パスをコピーしてエクスプローラーのアドレスバーに貼り付けてください。
                    </p>
                    {filePath && (
                      <div className="mb-4 p-3 bg-[#F2F2F7] dark:bg-[#1C1C1E] rounded-lg">
                        <p className="text-xs text-[#6E6E73] font-mono break-all">
                          {filePath}
                        </p>
                      </div>
                    )}
                    <div className="space-y-3">
                      {filePath && (
                        <button
                          onClick={handleCopyPath}
                          className="flex items-center justify-center gap-2 w-full py-3 px-4 bg-[#007AFF] hover:bg-[#0056CC] text-white rounded-xl transition-colors"
                        >
                          {copied ? (
                            <>
                              <CheckCircleIcon className="w-5 h-5" />
                              コピーしました
                            </>
                          ) : (
                            <>
                              <ClipboardDocumentIcon className="w-5 h-5" />
                              パスをコピー
                            </>
                          )}
                        </button>
                      )}
                      <button
                        onClick={handleClose}
                        className="w-full py-2 text-sm text-[#6E6E73] hover:text-[#1D1D1F] dark:hover:text-[#F5F5F7] transition-colors"
                      >
                        閉じる
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

/**
 * インストール状態を表示するバッジコンポーネント
 */
export const ProtocolHandlerBadge: FC = () => {
  const isInstalled = isHandlerMarkedAsInstalled()

  if (!isWindowsOS()) {
    return null
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${
        isInstalled
          ? 'bg-[#34C759]/10 text-[#34C759]'
          : 'bg-[#FF9500]/10 text-[#FF9500]'
      }`}
    >
      {isInstalled ? (
        <>
          <CheckCircleIcon className="w-3 h-3" />
          NASオープン機能: 有効
        </>
      ) : (
        <>
          <InformationCircleIcon className="w-3 h-3" />
          NASオープン機能: 未設定
        </>
      )}
    </span>
  )
}

export default ProtocolHandlerPrompt
