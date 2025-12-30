/**
 * 階層フィルタリングパネル
 *
 * カテゴリ（道路・構造）× フォルダ（H22_JOB〜など）の階層型フィルタリングUI
 */

'use client'

import { FC, useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { useFilterStore } from '@/stores/useFilterStore'
import { DateRangeFilter } from './DateRangeFilter'
import { FileTypeSelector } from './FileTypeSelector'
import { motion, AnimatePresence } from 'framer-motion'

interface HierarchicalFilterPanelProps {
  onApplyFilters?: () => void
  className?: string
}

export const HierarchicalFilterPanel: FC<HierarchicalFilterPanelProps> = ({
  onApplyFilters,
  className = ''
}) => {
  const {
    servers,
    folders,
    selectedServerIds,
    selectedFolderIds,
    toggleServer,
    toggleFolder,
    hasActiveFilters,
    resetFilters,
    getSelectedServers,
    getSelectedFolders,
    getFoldersForServer
  } = useFilterStore()

  const [isExpanded, setIsExpanded] = useState(true)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  const handleApplyFilters = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (onApplyFilters) {
      onApplyFilters()
    }
  }

  const toggleCategoryExpansion = (categoryId: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev)
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId)
      } else {
        newSet.add(categoryId)
      }
      return newSet
    })
  }

  const selectedServers = getSelectedServers()
  const selectedFolders = getSelectedFolders()

  // フィルターサマリー
  const filterSummary = selectedServers.length > 0 
    ? `${selectedServers.map(c => c.name).join(', ')}${selectedFolders.length > 0 ? ` / ${selectedFolders.length}フォルダ` : ''}`
    : ''

  return (
    <div className={`bg-white dark:bg-[#1C1C1E] rounded-xl shadow-sm border border-[#D2D2D7] dark:border-[#3A3A3C] ${className}`}>
      {/* パネルヘッダー */}
      <div className="px-6 py-4 border-b border-[#D2D2D7] dark:border-[#3A3A3C]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] rounded-lg transition-colors"
            >
              {isExpanded ? (
                <ChevronDownIcon className="w-5 h-5 text-[#3C3C43] dark:text-[#EBEBF5]" />
              ) : (
                <ChevronRightIcon className="w-5 h-5 text-[#3C3C43] dark:text-[#EBEBF5]" />
              )}
            </button>
            <div>
              <h3 className="text-lg font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                フィルタ設定
              </h3>
              {filterSummary && (
                <p className="text-sm text-[#6E6E73] dark:text-[#8E8E93] mt-0.5">
                  {filterSummary}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasActiveFilters() && (
              <button
                onClick={resetFilters}
                className="px-3 py-1.5 text-sm font-medium text-[#007AFF] hover:bg-[#F2F2F7] dark:hover:bg-[#2C2C2E] rounded-lg transition-colors"
              >
                リセット
              </button>
            )}
            <button
              type="button"
              onClick={(e) => handleApplyFilters(e)}
              className="px-4 py-2 bg-[#007AFF] text-white text-sm font-medium rounded-lg hover:bg-[#0056D3] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={false}
            >
              フィルタを適用
            </button>
          </div>
        </div>
      </div>

      {/* パネル本体 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-6 space-y-6">
              {/* カテゴリ × フォルダ選択 */}
              <div className="space-y-3">
                <h4 className="text-base font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
                  カテゴリ・フォルダ選択
                </h4>
                
                <div className="space-y-3">
                  {servers.map(server => {
                    const isSelected = selectedServerIds.includes(server.id)
                    const isExpanded = expandedCategories.has(server.id) || isSelected
                    const serverFolders = getFoldersForServer(server.id)
                    const selectedFolderCount = serverFolders.filter(f => 
                      selectedFolderIds.includes(f.id)
                    ).length

                    return (
                      <div 
                        key={server.id}
                        className={`
                          border rounded-lg overflow-hidden transition-all
                          ${isSelected 
                            ? 'border-[#007AFF] bg-blue-50 dark:bg-blue-900/20' 
                            : 'border-[#E5E5EA] dark:border-[#3A3A3C]'
                          }
                        `}
                      >
                        {/* カテゴリヘッダー */}
                        <div 
                          className={`
                            flex items-center justify-between px-4 py-3 cursor-pointer
                            ${isSelected 
                              ? 'bg-[#007AFF] text-white' 
                              : 'bg-[#F9F9F9] dark:bg-[#2C2C2E] hover:bg-[#F2F2F7] dark:hover:bg-[#3A3A3C]'
                            }
                          `}
                          onClick={() => {
                            toggleServer(server.id)
                            if (!isSelected) {
                              setExpandedCategories(prev => new Set(prev).add(server.id))
                            }
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                e.stopPropagation()
                                toggleServer(server.id)
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="w-4 h-4 rounded border-gray-300 text-[#007AFF] focus:ring-[#007AFF]"
                            />
                            <div>
                              <span className="font-medium">{server.name}</span>
                              {server.description && (
                                <span className={`text-sm ml-2 ${isSelected ? 'text-blue-100' : 'text-[#6E6E73] dark:text-[#8E8E93]'}`}>
                                  ({server.description})
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {selectedFolderCount > 0 && (
                              <span className={`
                                px-2 py-0.5 text-xs font-medium rounded-full
                                ${isSelected ? 'bg-white text-[#007AFF]' : 'bg-[#007AFF] text-white'}
                              `}>
                                {selectedFolderCount}フォルダ
                              </span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleCategoryExpansion(server.id)
                              }}
                              className={`p-1 rounded ${isSelected ? 'hover:bg-blue-600' : 'hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C]'}`}
                            >
                              {isExpanded ? (
                                <ChevronDownIcon className="w-4 h-4" />
                              ) : (
                                <ChevronRightIcon className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* フォルダリスト */}
                        <AnimatePresence>
                          {isExpanded && isSelected && (
                            <motion.div
                              initial={{ height: 0 }}
                              animate={{ height: 'auto' }}
                              exit={{ height: 0 }}
                              transition={{ duration: 0.15 }}
                              className="overflow-hidden"
                            >
                              <div className="p-3 bg-white dark:bg-[#1C1C1E]">
                                <p className="text-xs text-[#6E6E73] dark:text-[#8E8E93] mb-2">
                                  絞り込みたいフォルダを選択（未選択で全フォルダ対象）
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {serverFolders.map(folder => (
                                    <button
                                      key={folder.id}
                                      onClick={() => toggleFolder(folder.id)}
                                      className={`
                                        px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-200
                                        ${selectedFolderIds.includes(folder.id)
                                          ? 'bg-[#34C759] text-white shadow-sm'
                                          : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#1D1D1F] dark:text-[#F5F5F7] hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C]'
                                        }
                                      `}
                                    >
                                      {folder.name}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 日付範囲フィルター */}
              <div className="pt-4 border-t border-[#E5E5EA] dark:border-[#3A3A3C]">
                <DateRangeFilter />
              </div>

              {/* ファイルタイプフィルター */}
              <div className="pt-4 border-t border-[#E5E5EA] dark:border-[#3A3A3C]">
                <FileTypeSelector />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
