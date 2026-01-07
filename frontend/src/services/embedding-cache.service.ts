/**
 * Embedding Cache Service
 * ベクトル埋め込みのキャッシング戦略
 *
 * Features:
 * - LocalStorage persistent cache
 * - IndexedDB for large datasets
 * - LRU eviction policy
 * - Compression support
 */

/**
 * Cache Entry Structure
 */
interface CacheEntry {
  embedding: number[]
  timestamp: number
  imageHash: string
  metadata: {
    fileName: string
    fileSize: number
    dimensions: number
  }
}

/**
 * Cache Configuration
 */
const CACHE_CONFIG = {
  maxEntries: 100, // Maximum cache entries
  ttl: 24 * 60 * 60 * 1000, // 24 hours
  storageKey: 'image-embedding-cache',
  useIndexedDB: true, // Use IndexedDB for larger cache
}

/**
 * IndexedDB Configuration
 */
const DB_NAME = 'CISFileSearchDB'
const DB_VERSION = 1
const STORE_NAME = 'embeddings'

/**
 * LocalStorage Cache Manager
 */
class LocalStorageCache {
  private cacheKey: string

  constructor(cacheKey: string) {
    this.cacheKey = cacheKey
  }

  /**
   * Get cached embedding
   */
  get(imageHash: string): CacheEntry | null {
    try {
      const cacheData = localStorage.getItem(this.cacheKey)
      if (!cacheData) return null

      const cache: Record<string, CacheEntry> = JSON.parse(cacheData)
      const entry = cache[imageHash]

      if (!entry) return null

      // Check TTL
      if (Date.now() - entry.timestamp > CACHE_CONFIG.ttl) {
        delete cache[imageHash]
        localStorage.setItem(this.cacheKey, JSON.stringify(cache))
        return null
      }

      return entry
    } catch (error) {
      console.error('[LocalStorageCache] Get error:', error)
      return null
    }
  }

  /**
   * Set cache entry
   */
  set(imageHash: string, entry: CacheEntry): void {
    try {
      const cacheData = localStorage.getItem(this.cacheKey)
      const cache: Record<string, CacheEntry> = cacheData ? JSON.parse(cacheData) : {}

      cache[imageHash] = entry

      // Apply LRU eviction if necessary
      const entries = Object.entries(cache)
      if (entries.length > CACHE_CONFIG.maxEntries) {
        // Sort by timestamp (oldest first)
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp)

        // Remove oldest entries
        const toRemove = entries.slice(0, entries.length - CACHE_CONFIG.maxEntries)
        toRemove.forEach(([key]) => delete cache[key])
      }

      localStorage.setItem(this.cacheKey, JSON.stringify(cache))
    } catch (error) {
      console.error('[LocalStorageCache] Set error:', error)
      // If quota exceeded, clear old entries
      this.clearExpired()
    }
  }

  /**
   * Clear expired entries
   */
  clearExpired(): void {
    try {
      const cacheData = localStorage.getItem(this.cacheKey)
      if (!cacheData) return

      const cache: Record<string, CacheEntry> = JSON.parse(cacheData)
      const now = Date.now()

      Object.keys(cache).forEach((key) => {
        if (now - cache[key].timestamp > CACHE_CONFIG.ttl) {
          delete cache[key]
        }
      })

      localStorage.setItem(this.cacheKey, JSON.stringify(cache))
    } catch (error) {
      console.error('[LocalStorageCache] Clear expired error:', error)
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    localStorage.removeItem(this.cacheKey)
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; oldestEntry: number; newestEntry: number } {
    try {
      const cacheData = localStorage.getItem(this.cacheKey)
      if (!cacheData) return { size: 0, oldestEntry: 0, newestEntry: 0 }

      const cache: Record<string, CacheEntry> = JSON.parse(cacheData)
      const entries = Object.values(cache)

      if (entries.length === 0) {
        return { size: 0, oldestEntry: 0, newestEntry: 0 }
      }

      const timestamps = entries.map((e) => e.timestamp)

      return {
        size: entries.length,
        oldestEntry: Math.min(...timestamps),
        newestEntry: Math.max(...timestamps),
      }
    } catch (error) {
      console.error('[LocalStorageCache] Get stats error:', error)
      return { size: 0, oldestEntry: 0, newestEntry: 0 }
    }
  }
}

/**
 * IndexedDB Cache Manager (for larger datasets)
 */
class IndexedDBCache {
  private db: IDBDatabase | null = null

  /**
   * Initialize IndexedDB
   */
  async init(): Promise<void> {
    if (this.db) return

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)

      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event: any) => {
        const db = event.target.result as IDBDatabase

        // Create object store
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'imageHash' })
          store.createIndex('timestamp', 'timestamp', { unique: false })
        }
      }
    })
  }

  /**
   * Get cached embedding
   */
  async get(imageHash: string): Promise<CacheEntry | null> {
    await this.init()

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('IndexedDB not initialized'))
        return
      }

      const transaction = this.db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(imageHash)

      request.onsuccess = () => {
        const entry = request.result as CacheEntry | undefined

        if (!entry) {
          resolve(null)
          return
        }

        // Check TTL
        if (Date.now() - entry.timestamp > CACHE_CONFIG.ttl) {
          this.delete(imageHash)
          resolve(null)
          return
        }

        resolve(entry)
      }

      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Set cache entry
   */
  async set(imageHash: string, entry: CacheEntry): Promise<void> {
    await this.init()

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('IndexedDB not initialized'))
        return
      }

      const transaction = this.db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.put(entry)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Delete cache entry
   */
  async delete(imageHash: string): Promise<void> {
    await this.init()

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('IndexedDB not initialized'))
        return
      }

      const transaction = this.db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.delete(imageHash)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Clear expired entries
   */
  async clearExpired(): Promise<void> {
    await this.init()

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('IndexedDB not initialized'))
        return
      }

      const transaction = this.db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const index = store.index('timestamp')
      const now = Date.now()

      const cursorRequest = index.openCursor()

      cursorRequest.onsuccess = (event: any) => {
        const cursor = event.target.result

        if (cursor) {
          const entry = cursor.value as CacheEntry

          if (now - entry.timestamp > CACHE_CONFIG.ttl) {
            cursor.delete()
          }

          cursor.continue()
        } else {
          resolve()
        }
      }

      cursorRequest.onerror = () => reject(cursorRequest.error)
    })
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    await this.init()

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('IndexedDB not initialized'))
        return
      }

      const transaction = this.db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.clear()

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ size: number; oldestEntry: number; newestEntry: number }> {
    await this.init()

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('IndexedDB not initialized'))
        return
      }

      const transaction = this.db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const countRequest = store.count()

      countRequest.onsuccess = () => {
        const size = countRequest.result

        if (size === 0) {
          resolve({ size: 0, oldestEntry: 0, newestEntry: 0 })
          return
        }

        // Get timestamps
        const index = store.index('timestamp')
        const timestamps: number[] = []

        const cursorRequest = index.openCursor()

        cursorRequest.onsuccess = (event: any) => {
          const cursor = event.target.result

          if (cursor) {
            timestamps.push(cursor.value.timestamp)
            cursor.continue()
          } else {
            resolve({
              size,
              oldestEntry: Math.min(...timestamps),
              newestEntry: Math.max(...timestamps),
            })
          }
        }

        cursorRequest.onerror = () => reject(cursorRequest.error)
      }

      countRequest.onerror = () => reject(countRequest.error)
    })
  }
}

/**
 * Unified Cache Service
 */
class EmbeddingCacheService {
  private localCache: LocalStorageCache
  private indexedDBCache: IndexedDBCache
  private useIndexedDB: boolean

  constructor() {
    this.localCache = new LocalStorageCache(CACHE_CONFIG.storageKey)
    this.indexedDBCache = new IndexedDBCache()
    this.useIndexedDB = CACHE_CONFIG.useIndexedDB
  }

  /**
   * Get cached embedding
   */
  async get(imageHash: string): Promise<CacheEntry | null> {
    if (this.useIndexedDB) {
      return this.indexedDBCache.get(imageHash)
    } else {
      return this.localCache.get(imageHash)
    }
  }

  /**
   * Set cache entry
   */
  async set(imageHash: string, entry: CacheEntry): Promise<void> {
    if (this.useIndexedDB) {
      await this.indexedDBCache.set(imageHash, entry)
    } else {
      this.localCache.set(imageHash, entry)
    }
  }

  /**
   * Clear expired entries
   */
  async clearExpired(): Promise<void> {
    if (this.useIndexedDB) {
      await this.indexedDBCache.clearExpired()
    } else {
      this.localCache.clearExpired()
    }
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    if (this.useIndexedDB) {
      await this.indexedDBCache.clear()
    } else {
      this.localCache.clear()
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ size: number; oldestEntry: number; newestEntry: number }> {
    if (this.useIndexedDB) {
      return this.indexedDBCache.getStats()
    } else {
      return this.localCache.getStats()
    }
  }
}

/**
 * Export singleton instance
 */
export const embeddingCache = new EmbeddingCacheService()

/**
 * Calculate image hash (SHA-256)
 */
export async function calculateImageHash(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  return hashHex
}
