/**
 * ファイルタイプ選択コンポーネント
 *
 * ファイルの種類によるフィルタリング
 */

'use client'

import { FC } from 'react'
import {
  DocumentIcon,
  DocumentTextIcon,
  TableCellsIcon,
  PresentationChartBarIcon,
  PhotoIcon,
  FolderIcon,
  DocumentDuplicateIcon
} from '@heroicons/react/24/outline'
import { useFilterStore, FileTypeFilter } from '@/stores/useFilterStore'

/**
 * FileTypeSelector コンポーネント
 *
 * ファイルタイプ別のフィルタリングUI
 * - PDF, Excel, Word, PowerPoint, DocuWorks, 画像, その他
 */
export const FileTypeSelector: FC = () => {
  const { fileType, setFileType } = useFilterStore()

  // ファイルタイプオプション
  const fileTypeOptions: {
    value: FileTypeFilter
    label: string
    icon: React.ReactNode
    color: string
  }[] = [
    {
      value: 'all',
      label: '全て',
      icon: <FolderIcon className="w-5 h-5" />,
      color: 'text-[#6E6E73] dark:text-[#8E8E93]'
    },
    {
      value: 'pdf',
      label: 'PDF',
      icon: <DocumentIcon className="w-5 h-5" />,
      color: 'text-red-500'
    },
    {
      value: 'xlsx',
      label: 'Excel',
      icon: <TableCellsIcon className="w-5 h-5" />,
      color: 'text-green-600'
    },
    {
      value: 'docx',
      label: 'Word',
      icon: <DocumentTextIcon className="w-5 h-5" />,
      color: 'text-blue-600'
    },
    {
      value: 'pptx',
      label: 'PowerPoint',
      icon: <PresentationChartBarIcon className="w-5 h-5" />,
      color: 'text-orange-500'
    },
    {
      value: 'xdw',
      label: 'DocuWorks',
      icon: <DocumentDuplicateIcon className="w-5 h-5" />,
      color: 'text-indigo-500'
    },
    {
      value: 'image',
      label: '画像',
      icon: <PhotoIcon className="w-5 h-5" />,
      color: 'text-purple-500'
    },
    {
      value: 'other',
      label: 'その他',
      icon: <DocumentIcon className="w-5 h-5" />,
      color: 'text-[#6E6E73] dark:text-[#8E8E93]'
    }
  ]

  return (
    <div className="space-y-4">
      <h4 className="text-base font-medium text-[#1D1D1F] dark:text-[#F5F5F7]">
        ファイルタイプ
      </h4>

      {/* ファイルタイプボタングリッド */}
      <div className="grid grid-cols-4 gap-2">
        {fileTypeOptions.map((option) => {
          const isSelected = fileType === option.value

          return (
            <button
              key={option.value}
              onClick={() => setFileType(option.value)}
              className={`
                relative flex flex-col items-center justify-center
                px-3 py-3 rounded-lg
                transition-all duration-200
                ${isSelected
                  ? 'bg-[#007AFF] text-white shadow-md scale-105'
                  : 'bg-[#F2F2F7] dark:bg-[#2C2C2E] hover:bg-[#E5E5EA] dark:hover:bg-[#3A3A3C]'
                }
              `}
              aria-label={`${option.label}を選択`}
            >
              {/* アイコン */}
              <div className={isSelected ? 'text-white' : option.color}>
                {option.icon}
              </div>

              {/* ラベル */}
              <span className={`
                mt-1 text-xs font-medium
                ${isSelected
                  ? 'text-white'
                  : 'text-[#1D1D1F] dark:text-[#F5F5F7]'
                }
              `}>
                {option.label}
              </span>

              {/* 選択インジケーター */}
              {isSelected && (
                <div className="absolute top-1 right-1">
                  <div className="w-2 h-2 bg-white rounded-full" />
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
