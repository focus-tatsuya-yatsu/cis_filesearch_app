/**
 * Type Definitions for Lambda Search API
 * 
 * 修正: categories, folders, fileType複数選択対応
 */

export interface SearchQuery {
  query?: string;
  searchMode?: 'and' | 'or';
  imageEmbedding?: number[];
  fileType?: string | string[];  // 修正: 単一または複数対応
  categories?: string[];         // 追加: カテゴリフィルター ['road', 'structure']
  folders?: string[];            // 追加: フォルダフィルター ['H22_JOB', 'R01_JOB']
  dateFrom?: string;
  dateTo?: string;
  dateFilterType?: 'creation' | 'modification';  // 追加: 日付フィルタータイプ
  size?: number;
  from?: number;
  sortBy?: 'relevance' | 'date' | 'name' | 'size';
  sortOrder?: 'asc' | 'desc';
}

export interface SearchResult {
  id: string;
  fileName: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  modifiedDate: string;    // ファイル更新日
  createdDate?: string;    // ファイル作成日
  snippet: string;
  relevanceScore: number;
  highlights?: {
    fileName?: string[];
    filePath?: string[];
    extractedText?: string[];
  };
  // ハイブリッド検索拡張フィールド
  source?: 'text-index' | 'image-index' | 'hybrid';
  textScore?: number;
  imageScore?: number;
  imageEmbedding?: number[];
  // 追加: フィルター関連フィールド
  category?: string;
  categoryDisplay?: string;
  rootFolder?: string;
  nasServer?: string;
  nasPath?: string;
  thumbnailUrl?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  took: number;
  // ハイブリッド検索メタデータ
  metadata?: {
    queryType: 'text' | 'image' | 'hybrid';
    textIndexHits: number;
    imageIndexHits: number;
    indices: {
      text?: string;
      image?: string;
    };
  };
}

export interface PaginationInfo {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiSuccessResponse {
  success: true;
  data: {
    results: SearchResult[];
    pagination: PaginationInfo;
    query: SearchQuery;
    took: number;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
}

export type ApiResponse = ApiSuccessResponse | ApiErrorResponse;

export interface OpenSearchConfig {
  endpoint: string;
  index: string;
  region: string;
}

export interface LambdaEnvironment {
  OPENSEARCH_ENDPOINT: string;
  OPENSEARCH_INDEX: string;
  AWS_REGION: string;
  LOG_LEVEL?: string;
  NODE_ENV?: string;
}

export enum ErrorCode {
  INVALID_QUERY = 'INVALID_QUERY',
  INVALID_PAGINATION = 'INVALID_PAGINATION',
  OPENSEARCH_UNAVAILABLE = 'OPENSEARCH_UNAVAILABLE',
  OPENSEARCH_INDEX_NOT_FOUND = 'OPENSEARCH_INDEX_NOT_FOUND',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}
