/**
 * 日付範囲フィルターコンポーネント
 *
 * 作成日または更新日による日付範囲フィルタリング
 */

'use client'

import { FC, useState } from 'react'

import { CalendarIcon } from '@heroicons/react/24/outline'

import { useFilterStore } from '@/stores/useFilterStore'

/**
 * DateRangeFilter コンポーネント
 *
 * 機能:
 * - 作成日/更新日の切り替え
 * - 開始日・終了日の選択
 * - クイック選択（今日、今週、今月、今年）
 */
export const DateRangeFilter: FC = () => {
  const { dateRange, setDateRange } = useFilterStore()
  const [isExpanded, setIsExpanded] = useState(false)

  // 日付フォーマット（YYYY-MM-DD → 表示用）
  const formatDate = (dateString: string | null) => {
    if (!dateString) return ''
    const date = new Date(dateString)
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }

  // クイック選択オプション
  const quickSelectOptions = [
    {
      label: '今日',
      value: () => {
        const today = new Date().toISOString().split('T')[0]
        setDateRange({
          ...dateRange,
          startDate: today,
          endDate: today,
        })
      },
    },
    {
      label: '今週',
      value: () => {
        const now = new Date()
        const dayOfWeek = now.getDay()
        const monday = new Date(now)
        monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
        const sunday = new Date(monday)
        sunday.setDate(monday.getDate() + 6)

        setDateRange({
          ...dateRange,
          startDate: monday.toISOString().split('T')[0],
          endDate: sunday.toISOString().split('T')[0],
        })
      },
    },
    {
      label: '今月',
      value: () => {
        const now = new Date()
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)

        setDateRange({
          ...dateRange,
          startDate: firstDay.toISOString().split('T')[0],
          endDate: lastDay.toISOString().split('T')[0],
        })
      },
    },
    {
      label: '今年',
      value: () => {
        const now = new Date()
        const firstDay = new Date(now.getFullYear(), 0, 1)
        const lastDay = new Date(now.getFullYear(), 11, 31)

        setDateRange({
          ...dateRange,
          startDate: firstDay.toISOString().split('T')[0],
          endDate: lastDay.toISOString().split('T')[0],
        })
      },
    },
    {
      label: '過去3ヶ月',
      value: () => {
        const now = new Date()
        const threeMonthsAgo = new Date()
        threeMonthsAgo.setMonth(now.getMonth() - 3)

        setDateRange({
          ...dateRange,
          startDate: threeMonthsAgo.toISOString().split('T')[0],
          endDate: now.toISOString().split('T')[0],
        })
      },
    },
    {
      label: '過去1年',
      value: () => {
        const now = new Date()
        const oneYearAgo = new Date()
        oneYearAgo.setFullYear(now.getFullYear() - 1)

        setDateRange({
          ...dateRange,
          startDate: oneYearAgo.toISOString().split('T')[0],
          endDate: now.toISOString().split('T')[0],
        })
      },
    },
  ]

  // 日付リセット
  const clearDateRange = () => {
    setDateRange({
      ...dateRange,
      startDate: null,
      endDate: null,
    })
  }

  // 範囲が選択されているか
  const hasDateRange = dateRange.startDate || dateRange.endDate

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-base font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">日付フィルター</h4>
        {hasDateRange && (
          <button
            onClick={clearDateRange}
            className="text-sm text-[#007AFF] hover:text-[#0056D3] transition-colors"
          >
            クリア
          </button>
        )}
      </div>

      {/* フィルタータイプ選択（作成日/更新日） */}
      <div className="flex gap-2">
        <button
          onClick={() => setDateRange({ ...dateRange, filterType: 'creation' })}
          className={`
            flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors
            ${
              dateRange.filterType === 'creation'
                ? 'bg-[#007AFF] text-white'
                : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#1D1D1F] dark:text-[#F5F5F7] hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C]'
            }
          `}
        >
          作成日
        </button>
        <button
          onClick={() => setDateRange({ ...dateRange, filterType: 'modification' })}
          className={`
            flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors
            ${
              dateRange.filterType === 'modification'
                ? 'bg-[#007AFF] text-white'
                : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] text-[#1D1D1F] dark:text-[#F5F5F7] hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C]'
            }
          `}
        >
          更新日
        </button>
      </div>

      {/* 日付範囲入力 */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-[#6E6E73] dark:text-[#8E8E93] mb-1">
            開始日
          </label>
          <div className="relative">
            <input
              type="date"
              value={dateRange.startDate || ''}
              onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value || null })}
              max={dateRange.endDate || undefined}
              className="
                w-full px-3 py-2 pr-10
                bg-white dark:bg-[#1C1C1E]
                border border-[#D2D2D7] dark:border-[#48484A]
                rounded-lg
                text-sm text-[#1D1D1F] dark:text-[#F5F5F7]
                focus:ring-2 focus:ring-[#007AFF] focus:border-transparent
                transition-colors
              "
            />
            <CalendarIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6E6E73] dark:text-[#8E8E93] pointer-events-none" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#6E6E73] dark:text-[#8E8E93] mb-1">
            終了日
          </label>
          <div className="relative">
            <input
              type="date"
              value={dateRange.endDate || ''}
              onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value || null })}
              min={dateRange.startDate || undefined}
              className="
                w-full px-3 py-2 pr-10
                bg-white dark:bg-[#1C1C1E]
                border border-[#D2D2D7] dark:border-[#48484A]
                rounded-lg
                text-sm text-[#1D1D1F] dark:text-[#F5F5F7]
                focus:ring-2 focus:ring-[#007AFF] focus:border-transparent
                transition-colors
              "
            />
            <CalendarIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6E6E73] dark:text-[#8E8E93] pointer-events-none" />
          </div>
        </div>
      </div>

      {/* クイック選択 */}
      <div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-sm text-[#007AFF] hover:text-[#0056D3] transition-colors mb-2"
        >
          {isExpanded ? '閉じる' : 'クイック選択 ▼'}
        </button>

        {isExpanded && (
          <div className="grid grid-cols-3 gap-2">
            {quickSelectOptions.map((option) => (
              <button
                key={option.label}
                onClick={option.value}
                className="
                  px-3 py-1.5
                  text-xs font-medium
                  bg-[#F2F2F7] dark:bg-[#2C2C2E]
                  text-[#1D1D1F] dark:text-[#F5F5F7]
                  rounded-lg
                  hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C]
                  transition-colors
                "
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 選択された範囲の表示 */}
      {hasDateRange && (
        <div className="px-3 py-2 bg-[#007AFF]/5 dark:bg-[#007AFF]/10 rounded-lg">
          <p className="text-sm text-[#007AFF] dark:text-[#0A84FF] font-medium">
            {dateRange.filterType === 'creation' ? '作成日' : '更新日'}：
            {dateRange.startDate && formatDate(dateRange.startDate)}
            {dateRange.startDate && dateRange.endDate && ' 〜 '}
            {dateRange.endDate && formatDate(dateRange.endDate)}
          </p>
        </div>
      )}
    </div>
  )
}
