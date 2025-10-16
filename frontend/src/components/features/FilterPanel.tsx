import { FC, useState } from 'react'
import { Filter, Calendar, FileText, HardDrive } from 'lucide-react'
import { Select, Button } from '@/components/ui'

interface FilterOptions {
  fileType: string
  dateRange: string
  fileSize: string
  sortBy: string
  sortOrder: 'asc' | 'desc'
}

interface FilterPanelProps {
  onFilterChange: (filters: FilterOptions) => void
}

export const FilterPanel: FC<FilterPanelProps> = ({ onFilterChange }) => {
  const [filters, setFilters] = useState<FilterOptions>({
    fileType: '',
    dateRange: '',
    fileSize: '',
    sortBy: 'relevance',
    sortOrder: 'desc',
  })

  const handleFilterChange = (key: keyof FilterOptions, value: string) => {
    const newFilters = { ...filters, [key]: value }
    setFilters(newFilters)
    onFilterChange(newFilters)
  }

  const handleReset = () => {
    const defaultFilters: FilterOptions = {
      fileType: '',
      dateRange: '',
      fileSize: '',
      sortBy: 'relevance',
      sortOrder: 'desc',
    }
    setFilters(defaultFilters)
    onFilterChange(defaultFilters)
  }

  return (
    <div className="bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl rounded-2xl shadow-sm border border-[#D1D1D6]/30 dark:border-[#38383A]/30 p-5 transition-all duration-300">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-[#6E6E73] dark:text-[#8E8E93]" />
          <h3 className="font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">フィルター・ソート</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          className="text-[#007AFF] dark:text-[#0A84FF] hover:bg-[#007AFF]/10 dark:hover:bg-[#0A84FF]/10"
        >
          リセット
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* ファイルタイプ */}
        <Select
          label="ファイルタイプ"
          value={filters.fileType}
          onChange={(e) => handleFilterChange('fileType', e.target.value)}
          options={[
            { value: '', label: 'すべて' },
            { value: 'pdf', label: 'PDF' },
            { value: 'docx', label: 'Word' },
            { value: 'xlsx', label: 'Excel' },
            { value: 'pptx', label: 'PowerPoint' },
            { value: 'image', label: '画像' },
            { value: 'video', label: '動画' },
            { value: 'other', label: 'その他' },
          ]}
        />

        {/* 更新日時 */}
        <Select
          label="更新日時"
          value={filters.dateRange}
          onChange={(e) => handleFilterChange('dateRange', e.target.value)}
          options={[
            { value: '', label: 'すべて' },
            { value: 'today', label: '今日' },
            { value: 'week', label: '過去1週間' },
            { value: 'month', label: '過去1ヶ月' },
            { value: '3months', label: '過去3ヶ月' },
            { value: 'year', label: '過去1年' },
          ]}
        />

        {/* ファイルサイズ */}
        <Select
          label="ファイルサイズ"
          value={filters.fileSize}
          onChange={(e) => handleFilterChange('fileSize', e.target.value)}
          options={[
            { value: '', label: 'すべて' },
            { value: 'small', label: '1MB未満' },
            { value: 'medium', label: '1-10MB' },
            { value: 'large', label: '10-100MB' },
            { value: 'xlarge', label: '100MB以上' },
          ]}
        />

        {/* ソート順 */}
        <Select
          label="並び替え"
          value={filters.sortBy}
          onChange={(e) => handleFilterChange('sortBy', e.target.value)}
          options={[
            { value: 'relevance', label: '関連性' },
            { value: 'name', label: 'ファイル名' },
            { value: 'date', label: '更新日時' },
            { value: 'size', label: 'サイズ' },
          ]}
        />

        {/* 昇順/降順 */}
        <div className="flex items-end">
          <Button
            variant={filters.sortOrder === 'asc' ? 'primary' : 'outline'}
            size="md"
            onClick={() =>
              handleFilterChange('sortOrder', filters.sortOrder === 'asc' ? 'desc' : 'asc')
            }
            className="w-full"
          >
            {filters.sortOrder === 'asc' ? '昇順 ↑' : '降順 ↓'}
          </Button>
        </div>
      </div>
    </div>
  )
}