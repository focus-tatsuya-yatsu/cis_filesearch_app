/**
 * Request Validation Utilities
 * 
 * 修正: categories, folders パラメータ対応
 * 修正: 複数ファイルタイプ対応
 */

import { SearchQuery } from '../types';

export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
    public reason?: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * クエリパラメータをバリデーション
 */
export function validateSearchQuery(params: Record<string, any>): SearchQuery {
  const {
    q,
    searchQuery, // POSTリクエスト用のエイリアス
    searchMode = 'or',
    imageEmbedding,
    imageVector, // POSTリクエスト用のエイリアス
    fileType,
    fileTypes, // 複数選択用（配列）
    categories,
    folders,
    dateFrom,
    dateTo,
    dateFilterType,
    page = '1',
    limit = '20',
    sortBy = 'relevance',
    sortOrder = 'desc',
  } = params;

  // クエリ文字列（q または searchQuery）
  const queryString = q || searchQuery || undefined;

  // Parse imageEmbedding if provided
  let parsedImageEmbedding: number[] | undefined;
  const embeddingInput = imageEmbedding || imageVector;
  if (embeddingInput) {
    try {
      parsedImageEmbedding = validateImageEmbedding(embeddingInput);
    } catch (error: any) {
      throw new ValidationError(
        error.message,
        'imageEmbedding',
        'Invalid image embedding format'
      );
    }
  }

  // ファイルタイプの処理（単一または複数）
  let parsedFileType: string | string[] | undefined;
  if (fileTypes && Array.isArray(fileTypes) && fileTypes.length > 0) {
    parsedFileType = fileTypes;
  } else if (fileType && fileType !== 'all') {
    parsedFileType = fileType;
  }

  // カテゴリの処理
  let parsedCategories: string[] | undefined;
  if (categories) {
    if (Array.isArray(categories)) {
      parsedCategories = categories.filter(c => c && c.trim());
    } else if (typeof categories === 'string') {
      parsedCategories = [categories];
    }
    if (parsedCategories && parsedCategories.length === 0) {
      parsedCategories = undefined;
    }
  }

  // フォルダの処理
  let parsedFolders: string[] | undefined;
  if (folders) {
    if (Array.isArray(folders)) {
      parsedFolders = folders.filter(f => f && f.trim());
    } else if (typeof folders === 'string') {
      parsedFolders = [folders];
    }
    if (parsedFolders && parsedFolders.length === 0) {
      parsedFolders = undefined;
    }
  }

  // 少なくとも1つの検索条件が必要
  const hasSearchCriteria = 
    queryString || 
    parsedImageEmbedding || 
    parsedFileType || 
    parsedCategories ||
    parsedFolders ||
    dateFrom || 
    dateTo;

  if (!hasSearchCriteria) {
    throw new ValidationError(
      'At least one search parameter is required',
      'q',
      'Query string, image embedding, or filter is required'
    );
  }

  // クエリ長のバリデーション
  if (queryString && (queryString.length > 500 || queryString.length < 1)) {
    throw new ValidationError(
      'Query string length must be between 1 and 500 characters',
      'q',
      `Query length is ${queryString.length}`
    );
  }

  // ページネーションのバリデーション
  const pageNum = typeof page === 'number' ? page : parseInt(page, 10);
  const limitNum = typeof limit === 'number' ? limit : parseInt(limit, 10);

  if (isNaN(pageNum) || pageNum < 1 || pageNum > 1000) {
    throw new ValidationError(
      'Page number must be between 1 and 1000',
      'page',
      `Page is ${page}`
    );
  }

  if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
    throw new ValidationError(
      'Limit must be between 1 and 100',
      'limit',
      `Limit is ${limit}`
    );
  }

  // searchModeのバリデーション
  if (searchMode !== 'and' && searchMode !== 'or') {
    throw new ValidationError(
      "Search mode must be 'and' or 'or'",
      'searchMode',
      `Search mode is ${searchMode}`
    );
  }

  // sortByのバリデーション
  const validSortBy = ['relevance', 'date', 'name', 'size'];
  if (!validSortBy.includes(sortBy)) {
    throw new ValidationError(
      `Sort by must be one of: ${validSortBy.join(', ')}`,
      'sortBy',
      `Sort by is ${sortBy}`
    );
  }

  // sortOrderのバリデーション
  if (sortOrder !== 'asc' && sortOrder !== 'desc') {
    throw new ValidationError(
      "Sort order must be 'asc' or 'desc'",
      'sortOrder',
      `Sort order is ${sortOrder}`
    );
  }

  // 日付フォーマットのバリデーション（ISO 8601）
  if (dateFrom && !isValidDate(dateFrom)) {
    throw new ValidationError(
      'Invalid date format for dateFrom (expected ISO 8601)',
      'dateFrom',
      `Date is ${dateFrom}`
    );
  }

  if (dateTo && !isValidDate(dateTo)) {
    throw new ValidationError(
      'Invalid date format for dateTo (expected ISO 8601)',
      'dateTo',
      `Date is ${dateTo}`
    );
  }

  return {
    query: queryString,
    searchMode: searchMode as 'and' | 'or',
    imageEmbedding: parsedImageEmbedding,
    fileType: parsedFileType,
    categories: parsedCategories,
    folders: parsedFolders,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    dateFilterType: dateFilterType || undefined,
    size: limitNum,
    from: (pageNum - 1) * limitNum,
    sortBy: sortBy as 'relevance' | 'date' | 'name' | 'size',
    sortOrder: sortOrder as 'asc' | 'desc',
  };
}

/**
 * ISO 8601形式の日付をバリデーション
 */
function isValidDate(dateString: string): boolean {
  const date = new Date(dateString);
  return !isNaN(date.getTime());
}

/**
 * 入力文字列をサニタイゼーション（XSS対策）
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>\"']/g, '') // HTMLタグを削除
    .trim();
}

/**
 * Validate image embedding vector
 * Supports both 512 (CLIP) and 1024 (AWS Bedrock Titan Multimodal) dimensions
 */
export function validateImageEmbedding(embedding: any): number[] {
  // Parse if it's a JSON string
  let parsed = embedding;
  if (typeof embedding === 'string') {
    try {
      parsed = JSON.parse(embedding);
    } catch (error) {
      throw new Error('Image embedding must be a valid JSON array');
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Image embedding must be an array');
  }

  // Support 512 (CLIP) and 1024 (Bedrock Titan) dimensions
  const validDimensions = [512, 1024];
  if (!validDimensions.includes(parsed.length)) {
    throw new Error(
      `Image embedding must have ${validDimensions.join(' or ')} dimensions, got ${parsed.length}`
    );
  }

  if (!parsed.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    throw new Error('All embedding values must be finite numbers');
  }

  return parsed;
}

/**
 * Validate and parse similarity threshold
 */
export function validateSimilarityThreshold(threshold: any): number {
  const parsed = typeof threshold === 'string' ? parseFloat(threshold) : threshold;

  if (typeof parsed !== 'number' || isNaN(parsed)) {
    throw new Error('Similarity threshold must be a number');
  }

  if (parsed < 0 || parsed > 1) {
    throw new Error('Similarity threshold must be between 0 and 1');
  }

  return parsed;
}
