/**
 * 検索結果キャッシュマネージャー
 * メモリ効率の良いLRUキャッシュを実装
 */

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  hits: number;
  size: number;
}

export interface CacheOptions {
  /**
   * 最大キャッシュサイズ（MB）
   */
  maxSizeMB?: number;

  /**
   * 最大エントリ数
   */
  maxEntries?: number;

  /**
   * キャッシュの有効期限（ミリ秒）
   */
  ttl?: number;

  /**
   * キャッシュ統計を有効化
   */
  enableStats?: boolean;
}

export interface CacheStats {
  totalEntries: number;
  totalSizeBytes: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
}

/**
 * LRUキャッシュの実装
 */
export class SearchCache<T = any> {
  private cache: Map<string, CacheEntry<T>>;
  private options: Required<CacheOptions>;
  private stats: CacheStats;
  private accessOrder: string[];

  constructor(options: CacheOptions = {}) {
    this.cache = new Map();
    this.accessOrder = [];
    this.options = {
      maxSizeMB: options.maxSizeMB || 50,
      maxEntries: options.maxEntries || 100,
      ttl: options.ttl || 5 * 60 * 1000, // デフォルト5分
      enableStats: options.enableStats !== false,
    };
    this.stats = {
      totalEntries: 0,
      totalSizeBytes: 0,
      hits: 0,
      misses: 0,
      evictions: 0,
      hitRate: 0,
    };
  }

  /**
   * キャッシュキーを生成
   */
  private generateKey(params: Record<string, any>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((acc, key) => {
        acc[key] = params[key];
        return acc;
      }, {} as Record<string, any>);

    return JSON.stringify(sortedParams);
  }

  /**
   * データのサイズを推定（バイト）
   */
  private estimateSize(data: T): number {
    try {
      return new Blob([JSON.stringify(data)]).size;
    } catch {
      // フォールバック: 簡易的なサイズ推定
      return JSON.stringify(data).length * 2; // UTF-16を想定
    }
  }

  /**
   * キャッシュの空き容量を確保
   */
  private evictIfNeeded(newEntrySize: number): void {
    const maxSizeBytes = this.options.maxSizeMB * 1024 * 1024;

    // サイズベースの削除
    while (
      this.stats.totalSizeBytes + newEntrySize > maxSizeBytes &&
      this.cache.size > 0
    ) {
      const oldestKey = this.accessOrder.shift();
      if (oldestKey) {
        const entry = this.cache.get(oldestKey);
        if (entry) {
          this.stats.totalSizeBytes -= entry.size;
          this.cache.delete(oldestKey);
          this.stats.evictions++;
        }
      }
    }

    // エントリ数ベースの削除
    while (this.cache.size >= this.options.maxEntries) {
      const oldestKey = this.accessOrder.shift();
      if (oldestKey) {
        const entry = this.cache.get(oldestKey);
        if (entry) {
          this.stats.totalSizeBytes -= entry.size;
          this.cache.delete(oldestKey);
          this.stats.evictions++;
        }
      }
    }
  }

  /**
   * アクセス順序を更新（LRU）
   */
  private updateAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }

  /**
   * キャッシュにデータを保存
   */
  set(params: Record<string, any>, data: T): void {
    const key = this.generateKey(params);
    const size = this.estimateSize(data);

    // 既存のエントリを削除
    if (this.cache.has(key)) {
      const oldEntry = this.cache.get(key)!;
      this.stats.totalSizeBytes -= oldEntry.size;
    }

    // 空き容量を確保
    this.evictIfNeeded(size);

    // 新しいエントリを追加
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      hits: 0,
      size,
    };

    this.cache.set(key, entry);
    this.updateAccessOrder(key);
    this.stats.totalSizeBytes += size;
    this.stats.totalEntries = this.cache.size;
  }

  /**
   * キャッシュからデータを取得
   */
  get(params: Record<string, any>): T | null {
    const key = this.generateKey(params);
    const entry = this.cache.get(key);

    if (!entry) {
      if (this.options.enableStats) {
        this.stats.misses++;
        this.updateHitRate();
      }
      return null;
    }

    // TTLチェック
    const now = Date.now();
    if (now - entry.timestamp > this.options.ttl) {
      this.delete(params);
      if (this.options.enableStats) {
        this.stats.misses++;
        this.updateHitRate();
      }
      return null;
    }

    // ヒットカウントとアクセス順序を更新
    entry.hits++;
    this.updateAccessOrder(key);

    if (this.options.enableStats) {
      this.stats.hits++;
      this.updateHitRate();
    }

    return entry.data;
  }

  /**
   * キャッシュエントリを削除
   */
  delete(params: Record<string, any>): boolean {
    const key = this.generateKey(params);
    const entry = this.cache.get(key);

    if (entry) {
      this.stats.totalSizeBytes -= entry.size;
      this.cache.delete(key);
      const index = this.accessOrder.indexOf(key);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
      this.stats.totalEntries = this.cache.size;
      return true;
    }

    return false;
  }

  /**
   * キャッシュをクリア
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
    this.stats.totalEntries = 0;
    this.stats.totalSizeBytes = 0;
  }

  /**
   * キャッシュに存在するか確認
   */
  has(params: Record<string, any>): boolean {
    const key = this.generateKey(params);
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    // TTLチェック
    const now = Date.now();
    if (now - entry.timestamp > this.options.ttl) {
      this.delete(params);
      return false;
    }

    return true;
  }

  /**
   * ヒット率を更新
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
  }

  /**
   * キャッシュ統計を取得
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * 期限切れエントリを削除
   */
  prune(): number {
    const now = Date.now();
    let prunedCount = 0;
    const keysToDelete: string[] = [];

    this.cache.forEach((entry, key) => {
      if (now - entry.timestamp > this.options.ttl) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach((key) => {
      const entry = this.cache.get(key);
      if (entry) {
        this.stats.totalSizeBytes -= entry.size;
        this.cache.delete(key);
        const index = this.accessOrder.indexOf(key);
        if (index > -1) {
          this.accessOrder.splice(index, 1);
        }
        prunedCount++;
      }
    });

    this.stats.totalEntries = this.cache.size;
    return prunedCount;
  }

  /**
   * キャッシュサイズ（MB）を取得
   */
  getSizeMB(): number {
    return this.stats.totalSizeBytes / 1024 / 1024;
  }

  /**
   * 全エントリを取得（デバッグ用）
   */
  getAllEntries(): Array<{ key: string; entry: CacheEntry<T> }> {
    const entries: Array<{ key: string; entry: CacheEntry<T> }> = [];
    this.cache.forEach((entry, key) => {
      entries.push({ key, entry });
    });
    return entries;
  }
}

/**
 * グローバル検索キャッシュインスタンス
 */
export const searchCache = new SearchCache({
  maxSizeMB: 50,
  maxEntries: 100,
  ttl: 5 * 60 * 1000, // 5分
  enableStats: true,
});

/**
 * 画像検索専用キャッシュ
 * より小さいTTL（2分）で高頻度アクセスに対応
 */
export const imageSearchCache = new SearchCache({
  maxSizeMB: 20,
  maxEntries: 50,
  ttl: 2 * 60 * 1000, // 2分
  enableStats: true,
});

/**
 * 定期的なキャッシュクリーンアップ
 */
if (typeof window !== 'undefined') {
  // 5分ごとに期限切れエントリを削除
  setInterval(() => {
    const prunedSearch = searchCache.prune();
    const prunedImage = imageSearchCache.prune();

    if (prunedSearch > 0 || prunedImage > 0) {
      console.log(
        `[Cache Cleanup] Pruned ${prunedSearch} search cache entries, ${prunedImage} image search cache entries`
      );
    }
  }, 5 * 60 * 1000);

  // 開発環境でキャッシュ統計をログ出力
  if (process.env.NODE_ENV === 'development') {
    setInterval(() => {
      const searchStats = searchCache.getStats();
      const imageStats = imageSearchCache.getStats();

      console.log('[Search Cache Stats]', {
        entries: searchStats.totalEntries,
        sizeMB: searchCache.getSizeMB().toFixed(2),
        hitRate: searchStats.hitRate.toFixed(1) + '%',
        hits: searchStats.hits,
        misses: searchStats.misses,
      });

      console.log('[Image Search Cache Stats]', {
        entries: imageStats.totalEntries,
        sizeMB: imageSearchCache.getSizeMB().toFixed(2),
        hitRate: imageStats.hitRate.toFixed(1) + '%',
        hits: imageStats.hits,
        misses: imageStats.misses,
      });
    }, 60 * 1000); // 1分ごと
  }
}
