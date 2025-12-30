/**
 * Preview Service
 * フロントエンドからS3プレビューAPIを呼び出すサービス
 */

export interface PreviewUrlResponse {
  success: boolean;
  data: {
    previewUrl: string;
    expiresAt: string;
    expiresIn: number;
    metadata?: {
      totalPages: number;
      fileName: string;
      fileSize: number;
      contentType: string;
    };
  };
}

export interface PdfPagesResponse {
  success: boolean;
  data: {
    pages: Array<{
      pageNumber: number;
      previewUrl: string;
      hasKeywords: boolean;
      keywords: string[];
    }>;
    metadata: {
      totalPages: number;
      fileName: string;
      fileSize: number;
    };
    expiresAt: string;
  };
}

export interface KeywordHighlightResponse {
  success: boolean;
  data: {
    pages: Array<{
      pageNumber: number;
      keywords: string[];
      snippets: Array<{
        text: string;
        keyword: string;
        position?: {
          x: number;
          y: number;
        };
      }>;
      matchCount: number;
    }>;
    totalMatches: number;
    keywords: string[];
  };
}

/**
 * 単一ファイルのプレビューURLを取得
 *
 * @param bucket - S3バケット名
 * @param key - S3オブジェクトキー
 * @param fileType - ファイルタイプ
 * @param pageNumber - PDFのページ番号（オプション）
 * @param expiresIn - URL有効期限（秒）
 * @returns プレビューURL情報
 */
export async function getPreviewUrl(
  bucket: string,
  key: string,
  fileType: string,
  pageNumber?: number,
  expiresIn: number = 300
): Promise<PreviewUrlResponse> {
  const params = new URLSearchParams({
    bucket,
    key,
    fileType,
    expiresIn: expiresIn.toString(),
  });

  if (pageNumber !== undefined) {
    params.append('pageNumber', pageNumber.toString());
  }

  const response = await fetch(`/api/preview?${params.toString()}`);

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to get preview URL');
  }

  return response.json();
}

/**
 * PDFの全ページまたは指定範囲のプレビューURLを取得
 *
 * @param bucket - S3バケット名
 * @param key - S3オブジェクトキー
 * @param startPage - 開始ページ
 * @param endPage - 終了ページ
 * @param keywords - ハイライトキーワード
 * @param expiresIn - URL有効期限（秒）
 * @returns ページごとのプレビューURL情報
 */
export async function getPdfPages(
  bucket: string,
  key: string,
  startPage?: number,
  endPage?: number,
  keywords?: string[],
  expiresIn: number = 300
): Promise<PdfPagesResponse> {
  const params = new URLSearchParams({
    bucket,
    key,
    expiresIn: expiresIn.toString(),
  });

  if (startPage !== undefined) {
    params.append('startPage', startPage.toString());
  }

  if (endPage !== undefined) {
    params.append('endPage', endPage.toString());
  }

  if (keywords && keywords.length > 0) {
    params.append('keywords', keywords.join(','));
  }

  const response = await fetch(`/api/preview/pages?${params.toString()}`);

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to get PDF pages');
  }

  return response.json();
}

/**
 * PDFファイル内のキーワードハイライト情報を取得
 *
 * @param bucket - S3バケット名
 * @param key - S3オブジェクトキー
 * @param keywords - 検索キーワード
 * @returns キーワードハイライト情報
 */
export async function getKeywordHighlights(
  bucket: string,
  key: string,
  keywords: string[]
): Promise<KeywordHighlightResponse> {
  if (keywords.length === 0) {
    throw new Error('At least one keyword is required');
  }

  const params = new URLSearchParams({
    bucket,
    key,
    keywords: keywords.join(','),
  });

  const response = await fetch(`/api/preview/keywords?${params.toString()}`);

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to get keyword highlights');
  }

  return response.json();
}

/**
 * プレビューURLのキャッシュ管理クラス
 * URLの有効期限を考慮して、必要に応じて再生成
 */
export class PreviewUrlCache {
  private cache: Map<
    string,
    {
      url: string;
      expiresAt: Date;
    }
  > = new Map();

  /**
   * キャッシュキーを生成
   */
  private getCacheKey(
    bucket: string,
    key: string,
    fileType: string,
    pageNumber?: number
  ): string {
    return `${bucket}:${key}:${fileType}:${pageNumber ?? 'all'}`;
  }

  /**
   * キャッシュからURLを取得、または新規生成
   */
  async getUrl(
    bucket: string,
    key: string,
    fileType: string,
    pageNumber?: number,
    expiresIn: number = 300
  ): Promise<string> {
    const cacheKey = this.getCacheKey(bucket, key, fileType, pageNumber);
    const cached = this.cache.get(cacheKey);

    // キャッシュが存在し、有効期限内の場合は再利用
    // ただし、有効期限の80%を過ぎている場合は再生成
    if (cached) {
      const now = new Date();
      const expiresAt = cached.expiresAt;
      const totalLifetime = expiresAt.getTime() - (now.getTime() - expiresIn * 1000);
      const remainingLifetime = expiresAt.getTime() - now.getTime();
      const lifetimeRatio = remainingLifetime / totalLifetime;

      if (lifetimeRatio > 0.2) {
        return cached.url;
      }
    }

    // 新規にURLを生成
    const response = await getPreviewUrl(
      bucket,
      key,
      fileType,
      pageNumber,
      expiresIn
    );

    // キャッシュに保存
    this.cache.set(cacheKey, {
      url: response.data.previewUrl,
      expiresAt: new Date(response.data.expiresAt),
    });

    return response.data.previewUrl;
  }

  /**
   * 期限切れのキャッシュをクリア
   */
  clearExpired(): void {
    const now = new Date();

    for (const [key, value] of this.cache.entries()) {
      if (value.expiresAt < now) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 全キャッシュをクリア
   */
  clearAll(): void {
    this.cache.clear();
  }
}

/**
 * グローバルなプレビューURLキャッシュインスタンス
 */
export const previewUrlCache = new PreviewUrlCache();

// 定期的に期限切れキャッシュをクリア（5分ごと）
if (typeof window !== 'undefined') {
  setInterval(() => {
    previewUrlCache.clearExpired();
  }, 5 * 60 * 1000);
}
