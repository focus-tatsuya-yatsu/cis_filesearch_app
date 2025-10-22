// 検索結果の型定義
export interface SearchResult {
  id: string
  fileName: string
  filePath: string
  fileType: string
  fileSize: number
  modifiedDate: string
  snippet: string
  relevanceScore: number
}

// 検索履歴アイテムの型定義
export interface SearchHistoryItem {
  id: string
  query: string
  timestamp: number
  resultCount?: number
}

// フィルターオプションの型定義
export interface FilterOptions {
  fileType?: string[]
  dateRange?: {
    start: Date | null
    end: Date | null
  }
  sizeRange?: {
    min: number | null
    max: number | null
  }
  sortBy?: 'name' | 'date' | 'size' | 'relevance'
  sortOrder?: 'asc' | 'desc'
}

// フォルダツリーの型定義
export interface TreeNode {
  id: string
  name: string
  type: 'file' | 'folder'
  path: string
  children?: TreeNode[]
}
