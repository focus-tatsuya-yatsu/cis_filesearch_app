// 検索結果の型定義
export interface SearchResult {
  id: string
  fileName: string
  filePath: string
  fileType?: string // Optional: may be undefined for some results
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

// 画像検索の型定義
export interface ImageSearchState {
  imageFile: File | null
  imagePreviewUrl: string | null
  isUploading: boolean
  embedding: number[] | null
  error: string | null
}

export interface ImageEmbeddingResponse {
  success: boolean
  data: {
    embedding: number[]
    dimensions: number
    fileName: string
    fileSize: number
    fileType: string
  }
}

export interface ImageEmbeddingError {
  error: string
  code: string
  message?: string
}
