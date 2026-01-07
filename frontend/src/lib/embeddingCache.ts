/**
 * Image Embedding Cache Service
 *
 * AWS Bedrock Titan Embeddingsの結果をメモリにキャッシュし、
 * 同じ画像の再処理を防いでパフォーマンスを向上させます。
 *
 * Features:
 * - LRU (Least Recently Used) キャッシュアルゴリズム
 * - TTL (Time To Live) サポート
 * - メモリ使用量の自動制御
 * - 統計情報の収集
 */

import crypto from 'crypto'

/**
 * キャッシュエントリ
 */
interface CacheEntry {
  embedding: number[]
  timestamp: number
  accessCount: number
  lastAccessed: number
}

/**
 * キャッシュ統計情報
 */
export interface CacheStats {
  size: number
  maxSize: number
  hits: number
  misses: number
  hitRate: number
  evictions: number
  totalEntries: number
}

/**
 * キャッシュ設定
 */
interface CacheConfig {
  maxSize: number // 最大エントリ数
  ttl: number // Time To Live（ミリ秒）
}

/**
 * 画像エンベディングキャッシュクラス
 */
class EmbeddingCache {
  private cache: Map<string, CacheEntry>
  private config: CacheConfig
  private stats: {
    hits: number
    misses: number
    evictions: number
    totalEntries: number
  }

  constructor(config: CacheConfig) {
    this.cache = new Map()
    this.config = config
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      totalEntries: 0,
    }
  }

  /**
   * 画像のハッシュ値を計算（キャッシュキーとして使用）
   */
  private generateKey(imageBuffer: Buffer): string {
    return crypto.createHash('sha256').update(imageBuffer).digest('hex')
  }

  /**
   * キャッシュから埋め込みベクトルを取得
   */
  get(imageBuffer: Buffer): number[] | null {
    const key = this.generateKey(imageBuffer)
    const entry = this.cache.get(key)

    if (!entry) {
      this.stats.misses++
      return null
    }

    const now = Date.now()

    // TTLチェック
    if (now - entry.timestamp > this.config.ttl) {
      this.cache.delete(key)
      this.stats.misses++
      return null
    }

    // アクセス情報を更新
    entry.accessCount++
    entry.lastAccessed = now
    this.stats.hits++

    return entry.embedding
  }

  /**
   * キャッシュに埋め込みベクトルを保存
   */
  set(imageBuffer: Buffer, embedding: number[]): void {
    const key = this.generateKey(imageBuffer)
    const now = Date.now()

    // キャッシュサイズがmax sizeに達している場合、LRUで古いエントリを削除
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      this.evictLRU()
    }

    this.cache.set(key, {
      embedding,
      timestamp: now,
      accessCount: 0,
      lastAccessed: now,
    })

    this.stats.totalEntries++
  }

  /**
   * LRU（Least Recently Used）アルゴリズムで最も古いエントリを削除
   */
  private evictLRU(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
      this.stats.evictions++
    }
  }

  /**
   * 期限切れのエントリをクリーンアップ
   */
  cleanup(): void {
    const now = Date.now()
    let cleanedCount = 0

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.config.ttl) {
        this.cache.delete(key)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      console.log(`[EmbeddingCache] Cleaned up ${cleanedCount} expired entries`)
    }
  }

  /**
   * キャッシュをクリア
   */
  clear(): void {
    this.cache.clear()
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      totalEntries: 0,
    }
    console.log('[EmbeddingCache] Cache cleared')
  }

  /**
   * キャッシュ統計情報を取得
   */
  getStats(): CacheStats {
    const totalRequests = this.stats.hits + this.stats.misses
    const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0

    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: Math.round(hitRate * 10000) / 100, // パーセンテージ（小数点2桁）
      evictions: this.stats.evictions,
      totalEntries: this.stats.totalEntries,
    }
  }

  /**
   * キャッシュ統計をログ出力
   */
  logStats(): void {
    const stats = this.getStats()
    console.log('[EmbeddingCache] Statistics:', {
      size: `${stats.size}/${stats.maxSize}`,
      hits: stats.hits,
      misses: stats.misses,
      hitRate: `${stats.hitRate}%`,
      evictions: stats.evictions,
      totalEntries: stats.totalEntries,
    })
  }
}

/**
 * シングルトンインスタンス
 */
let embeddingCacheInstance: EmbeddingCache | null = null

/**
 * キャッシュインスタンスを取得
 */
export function getEmbeddingCache(): EmbeddingCache {
  if (!embeddingCacheInstance) {
    const config: CacheConfig = {
      maxSize: parseInt(process.env.EMBEDDING_CACHE_MAX_SIZE || '10000', 10),
      ttl: parseInt(process.env.EMBEDDING_CACHE_TTL || '86400000', 10), // デフォルト24時間
    }

    embeddingCacheInstance = new EmbeddingCache(config)

    console.log('[EmbeddingCache] Initialized with config:', {
      maxSize: config.maxSize,
      ttl: `${config.ttl / 1000 / 60 / 60}h`,
    })

    // 定期的にクリーンアップ（1時間ごと）
    setInterval(() => {
      embeddingCacheInstance?.cleanup()
      embeddingCacheInstance?.logStats()
    }, 3600000)
  }

  return embeddingCacheInstance
}

/**
 * キャッシュをリセット（テスト用）
 */
export function resetEmbeddingCache(): void {
  if (embeddingCacheInstance) {
    embeddingCacheInstance.clear()
    embeddingCacheInstance = null
  }
}
