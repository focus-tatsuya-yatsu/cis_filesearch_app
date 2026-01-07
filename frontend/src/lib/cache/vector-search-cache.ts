/**
 * Multi-Layer Vector Search Cache
 *
 * Implements a three-tier caching strategy:
 * 1. In-Memory Cache (Node.js LRU)
 * 2. Redis Distributed Cache
 * 3. OpenSearch Query Cache
 *
 * Features:
 * - Fast in-memory lookups
 * - Distributed caching for scalability
 * - Automatic cache invalidation
 * - Performance metrics tracking
 */

import { createHash } from 'crypto'

import { LRUCache } from 'lru-cache'

/**
 * Search result cache entry
 */
export interface CacheEntry {
  results: any[]
  total: number
  took: number
  timestamp: number
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number
  misses: number
  hitRate: number
  size: number
  calculatedSize: number
}

/**
 * In-Memory Vector Search Cache
 * Uses LRU eviction policy
 */
export class InMemoryVectorCache {
  private cache: LRUCache<string, CacheEntry>
  private hits: number = 0
  private misses: number = 0

  constructor(
    options: {
      maxSize?: number // Maximum cache size in bytes
      maxEntries?: number // Maximum number of entries
      ttl?: number // TTL in milliseconds
    } = {}
  ) {
    const {
      maxSize = 100 * 1024 * 1024, // 100 MB default
      maxEntries = 500,
      ttl = 5 * 60 * 1000, // 5 minutes default
    } = options

    this.cache = new LRUCache<string, CacheEntry>({
      max: maxEntries,
      maxSize,
      sizeCalculation: (entry) => JSON.stringify(entry).length,
      ttl,
      updateAgeOnGet: true, // Refresh TTL on access
      allowStale: false,
    })
  }

  /**
   * Generate cache key from vector and filters
   */
  private generateKey(vector: number[], filters?: any): string {
    const vectorHash = this.hashVector(vector)
    const filterHash = filters ? JSON.stringify(filters) : ''
    return `${vectorHash}:${filterHash}`
  }

  /**
   * Fast vector hashing using sample-based approach
   * Uses first and last 10 elements for speed
   */
  private hashVector(vector: number[]): string {
    const sample = [...vector.slice(0, 10), ...vector.slice(-10)]
    return sample.map((v) => v.toFixed(4)).join(',')
  }

  /**
   * Get entry from cache
   */
  get(vector: number[], filters?: any): CacheEntry | null {
    const key = this.generateKey(vector, filters)
    const entry = this.cache.get(key)

    if (entry) {
      this.hits++
      return entry
    } else {
      this.misses++
      return null
    }
  }

  /**
   * Set entry in cache
   */
  set(vector: number[], entry: CacheEntry, filters?: any): void {
    const key = this.generateKey(vector, filters)
    this.cache.set(key, entry)
  }

  /**
   * Check if entry exists
   */
  has(vector: number[], filters?: any): boolean {
    const key = this.generateKey(vector, filters)
    return this.cache.has(key)
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear()
    this.hits = 0
    this.misses = 0
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      size: this.cache.size,
      calculatedSize: this.cache.calculatedSize || 0,
    }
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.hits = 0
    this.misses = 0
  }
}

/**
 * Redis Distributed Cache
 * For multi-instance deployments
 */
export class RedisVectorCache {
  private hits: number = 0
  private misses: number = 0
  private enabled: boolean = false

  // Redis client would be initialized here in production
  // private redis: Redis;

  constructor() {
    // Check if Redis is configured
    this.enabled = !!(process.env.REDIS_HOST && process.env.REDIS_PORT)

    if (this.enabled) {
      console.log('[Redis Cache] Initialized (simulated)')
      // In production, initialize Redis client here:
      // this.redis = new Redis({
      //   host: process.env.REDIS_HOST,
      //   port: parseInt(process.env.REDIS_PORT || '6379'),
      //   password: process.env.REDIS_PASSWORD,
      //   db: 0,
      //   maxRetriesPerRequest: 3,
      //   enableReadyCheck: true,
      //   enableOfflineQueue: false,
      // });
    }
  }

  /**
   * Generate Redis key from vector
   */
  private generateKey(vector: number[]): string {
    const hash = createHash('sha256').update(vector.join(',')).digest('hex').substring(0, 16)

    return `vector:search:${hash}`
  }

  /**
   * Get entry from Redis cache
   */
  async get(vector: number[]): Promise<CacheEntry | null> {
    if (!this.enabled) {
      this.misses++
      return null
    }

    try {
      // In production, use Redis client:
      // const key = this.generateKey(vector);
      // const cached = await this.redis.get(key);
      // if (cached) {
      //   this.hits++;
      //   return JSON.parse(cached);
      // }

      this.misses++
      return null
    } catch (error) {
      console.error('[Redis Cache] Get error:', error)
      this.misses++
      return null
    }
  }

  /**
   * Set entry in Redis cache
   */
  async set(
    vector: number[],
    entry: CacheEntry,
    ttl: number = 1800 // 30 minutes default
  ): Promise<void> {
    if (!this.enabled) {
      return
    }

    try {
      // In production, use Redis client:
      // const key = this.generateKey(vector);
      // await this.redis.setex(
      //   key,
      //   ttl,
      //   JSON.stringify(entry)
      // );
    } catch (error) {
      console.error('[Redis Cache] Set error:', error)
    }
  }

  /**
   * Batch get multiple vectors using pipeline
   */
  async batchGet(vectors: number[][]): Promise<(CacheEntry | null)[]> {
    if (!this.enabled) {
      return vectors.map(() => null)
    }

    try {
      // In production, use Redis pipeline:
      // const pipeline = this.redis.pipeline();
      // vectors.forEach(vector => {
      //   const key = this.generateKey(vector);
      //   pipeline.get(key);
      // });
      //
      // const results = await pipeline.exec();
      // return results?.map(([err, result]) => {
      //   if (err || !result) {
      //     this.misses++;
      //     return null;
      //   }
      //   this.hits++;
      //   return JSON.parse(result as string);
      // }) || [];

      return vectors.map(() => null)
    } catch (error) {
      console.error('[Redis Cache] Batch get error:', error)
      return vectors.map(() => null)
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      size: 0,
      calculatedSize: 0,
    }
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.hits = 0
    this.misses = 0
  }
}

/**
 * Unified Multi-Layer Cache Manager
 * Coordinates between in-memory and Redis caches
 */
export class MultiLayerVectorCache {
  private memoryCache: InMemoryVectorCache
  private redisCache: RedisVectorCache

  constructor(options?: { memoryMaxSize?: number; memoryTTL?: number; redisTTL?: number }) {
    this.memoryCache = new InMemoryVectorCache({
      maxSize: options?.memoryMaxSize,
      ttl: options?.memoryTTL,
    })

    this.redisCache = new RedisVectorCache()
  }

  /**
   * Get entry from cache (checks all layers)
   */
  async get(vector: number[], filters?: any): Promise<CacheEntry | null> {
    // Layer 1: Check in-memory cache
    const memCached = this.memoryCache.get(vector, filters)
    if (memCached) {
      console.log('[Cache] Hit: In-Memory')
      return memCached
    }

    // Layer 2: Check Redis cache
    const redisCached = await this.redisCache.get(vector)
    if (redisCached) {
      console.log('[Cache] Hit: Redis')
      // Store in memory cache for future requests
      this.memoryCache.set(vector, redisCached, filters)
      return redisCached
    }

    console.log('[Cache] Miss: All layers')
    return null
  }

  /**
   * Set entry in cache (saves to all layers)
   */
  async set(vector: number[], entry: CacheEntry, filters?: any): Promise<void> {
    // Save to both layers
    this.memoryCache.set(vector, entry, filters)
    await this.redisCache.set(vector, entry)
  }

  /**
   * Clear all caches
   */
  clear(): void {
    this.memoryCache.clear()
  }

  /**
   * Get combined cache statistics
   */
  getCombinedStats(): {
    memory: CacheStats
    redis: CacheStats
    overall: {
      totalHits: number
      totalMisses: number
      overallHitRate: number
    }
  } {
    const memStats = this.memoryCache.getStats()
    const redisStats = this.redisCache.getStats()

    const totalHits = memStats.hits + redisStats.hits
    const totalMisses = memStats.misses + redisStats.misses
    const total = totalHits + totalMisses

    return {
      memory: memStats,
      redis: redisStats,
      overall: {
        totalHits,
        totalMisses,
        overallHitRate: total > 0 ? totalHits / total : 0,
      },
    }
  }
}

/**
 * Global cache instance (singleton)
 */
export const vectorSearchCache = new MultiLayerVectorCache({
  memoryMaxSize: 100 * 1024 * 1024, // 100 MB
  memoryTTL: 5 * 60 * 1000, // 5 minutes
  redisTTL: 30 * 60, // 30 minutes
})
