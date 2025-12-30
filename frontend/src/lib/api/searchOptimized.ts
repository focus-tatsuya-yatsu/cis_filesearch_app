/**
 * 最適化された検索APIクライアント
 * キャッシング、圧縮、バッチリクエスト対応
 */

import { searchCache, imageSearchCache } from '@/lib/searchCache';

export interface SearchParams {
  query?: string;
  searchMode?: 'and' | 'or';
  imageEmbedding?: number[];
  fileType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  size?: number;
  sortBy?: 'relevance' | 'date' | 'name' | 'size';
  sortOrder?: 'asc' | 'desc';
}

export interface SearchResponse {
  success: boolean;
  data: {
    results: any[];
    total: number;
    page: number;
    limit: number;
    searchType: string;
    index: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * 検索実行（キャッシュ対応）
 */
export const searchWithCache = async (
  params: SearchParams
): Promise<SearchResponse> => {
  // キャッシュキーを生成
  const cacheKey = params;

  // 画像検索か判定
  const isImageSearch = Boolean(params.imageEmbedding && params.imageEmbedding.length > 0);

  // 適切なキャッシュを選択
  const cache = isImageSearch ? imageSearchCache : searchCache;

  // キャッシュチェック
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[Search Cache] Hit for query: ${params.query || 'image search'}`);
    return cached;
  }

  console.log(`[Search Cache] Miss for query: ${params.query || 'image search'}`);

  // API呼び出し
  try {
    const startTime = performance.now();

    let response: Response;

    if (isImageSearch) {
      // 画像検索はPOST
      response = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        body: JSON.stringify(params),
      });
    } else {
      // テキスト検索はGET
      const queryParams = new URLSearchParams();
      if (params.query) queryParams.append('q', params.query);
      if (params.searchMode) queryParams.append('searchMode', params.searchMode);
      if (params.fileType) queryParams.append('fileType', params.fileType);
      if (params.dateFrom) queryParams.append('dateFrom', params.dateFrom);
      if (params.dateTo) queryParams.append('dateTo', params.dateTo);
      if (params.page) queryParams.append('page', params.page.toString());
      if (params.size) queryParams.append('limit', params.size.toString());
      if (params.sortBy) queryParams.append('sortBy', params.sortBy);
      if (params.sortOrder) queryParams.append('sortOrder', params.sortOrder);

      response = await fetch(`/api/search?${queryParams.toString()}`, {
        method: 'GET',
        headers: {
          'Accept-Encoding': 'gzip, deflate, br',
        },
      });
    }

    const endTime = performance.now();
    const duration = endTime - startTime;

    if (!response.ok) {
      throw new Error(`Search API error: ${response.status}`);
    }

    const data: SearchResponse = await response.json();

    // パフォーマンスログ
    console.log(`[Search API] Completed in ${duration.toFixed(0)}ms`, {
      isImageSearch,
      resultCount: data.data?.results?.length || 0,
      cacheSize: cache.getSizeMB().toFixed(2) + 'MB',
    });

    // キャッシュに保存
    cache.set(cacheKey, data);

    return data;
  } catch (error) {
    console.error('[Search API] Error:', error);
    throw error;
  }
};

/**
 * プリフェッチ（次のページを事前に取得）
 */
export const prefetchNextPage = async (params: SearchParams): Promise<void> => {
  const nextPage = (params.page || 1) + 1;
  const nextParams = { ...params, page: nextPage };

  // バックグラウンドでフェッチ
  try {
    await searchWithCache(nextParams);
    console.log(`[Prefetch] Page ${nextPage} cached`);
  } catch (error) {
    console.warn(`[Prefetch] Failed to prefetch page ${nextPage}`, error);
  }
};

/**
 * 複数ページを一括プリフェッチ
 */
export const prefetchPages = async (
  params: SearchParams,
  pageCount: number = 3
): Promise<void> => {
  const currentPage = params.page || 1;
  const promises = [];

  for (let i = 1; i <= pageCount; i++) {
    const nextPage = currentPage + i;
    const nextParams = { ...params, page: nextPage };
    promises.push(searchWithCache(nextParams));
  }

  try {
    await Promise.allSettled(promises);
    console.log(`[Prefetch] Cached ${pageCount} pages ahead`);
  } catch (error) {
    console.warn('[Prefetch] Some pages failed to prefetch', error);
  }
};

/**
 * キャッシュを手動でクリア
 */
export const clearSearchCache = (): void => {
  searchCache.clear();
  imageSearchCache.clear();
  console.log('[Cache] All caches cleared');
};

/**
 * キャッシュ統計を取得
 */
export const getCacheStats = () => {
  return {
    search: searchCache.getStats(),
    imageSearch: imageSearchCache.getStats(),
  };
};

/**
 * バッチ検索リクエスト
 * 複数の検索クエリを効率的に実行
 */
export const batchSearch = async (
  queries: SearchParams[]
): Promise<SearchResponse[]> => {
  console.log(`[Batch Search] Processing ${queries.length} queries`);

  const results = await Promise.allSettled(
    queries.map((params) => searchWithCache(params))
  );

  return results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      console.error(`[Batch Search] Query ${index} failed:`, result.reason);
      return {
        success: false,
        data: {
          results: [],
          total: 0,
          page: 1,
          limit: 20,
          searchType: 'text',
          index: 'cis-files',
        },
        error: {
          code: 'BATCH_ERROR',
          message: result.reason.message,
        },
      };
    }
  });
};

/**
 * デバウンスされた検索
 * 連続した検索リクエストを制限
 */
let searchTimeoutId: NodeJS.Timeout | null = null;

export const debouncedSearch = (
  params: SearchParams,
  delay: number = 300
): Promise<SearchResponse> => {
  return new Promise((resolve, reject) => {
    if (searchTimeoutId) {
      clearTimeout(searchTimeoutId);
    }

    searchTimeoutId = setTimeout(async () => {
      try {
        const result = await searchWithCache(params);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }, delay);
  });
};

/**
 * 無限スクロール用のページ取得
 */
export const fetchMoreResults = async (
  params: SearchParams,
  currentResults: any[]
): Promise<{ results: any[]; hasMore: boolean }> => {
  const nextPage = (params.page || 1) + 1;
  const response = await searchWithCache({ ...params, page: nextPage });

  if (!response.success) {
    throw new Error(response.error?.message || 'Failed to fetch more results');
  }

  const newResults = [...currentResults, ...response.data.results];
  const totalPages = Math.ceil(response.data.total / response.data.limit);
  const hasMore = nextPage < totalPages;

  // 次のページもプリフェッチ
  if (hasMore) {
    prefetchNextPage({ ...params, page: nextPage });
  }

  return {
    results: newResults,
    hasMore,
  };
};
