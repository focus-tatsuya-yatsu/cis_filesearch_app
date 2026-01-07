/**
 * レート制限ユーティリティ
 * IP、ユーザーID、グローバルのレート制限を実装
 */

import { LRUCache } from 'lru-cache'

/**
 * レート制限オプション
 */
export interface RateLimitOptions {
  interval: number // ミリ秒単位の時間窓
  uniqueTokenPerInterval: number // 追跡するユニークトークン数
}

/**
 * レート制限結果
 */
export interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  reset: number // Unixタイムスタンプ（ミリ秒）
}

/**
 * レート制限エラー
 */
export class RateLimitError extends Error {
  public readonly limit: number
  public readonly remaining: number
  public readonly reset: number

  constructor(limit: number, remaining: number, reset: number) {
    super('Rate limit exceeded')
    this.name = 'RateLimitError'
    this.limit = limit
    this.remaining = remaining
    this.reset = reset
  }
}

/**
 * レート制限クラス
 */
export class RateLimiter {
  private tokenCache: LRUCache<string, number[]>
  private interval: number

  constructor(options: RateLimitOptions) {
    this.interval = options.interval
    this.tokenCache = new LRUCache<string, number[]>({
      max: options.uniqueTokenPerInterval || 500,
      ttl: options.interval || 60000,
    })
  }

  /**
   * レート制限をチェック
   */
  async check(token: string, limit: number): Promise<RateLimitResult> {
    const now = Date.now()
    const tokenCount = this.tokenCache.get(token) || [0, now]
    const [currentCount, windowStart] = tokenCount

    // タイムウィンドウの確認
    const windowElapsed = now - windowStart
    if (windowElapsed >= this.interval) {
      // 新しいウィンドウを開始
      this.tokenCache.set(token, [1, now])
      return {
        success: true,
        limit,
        remaining: limit - 1,
        reset: now + this.interval,
      }
    }

    // 制限を超えている場合
    if (currentCount >= limit) {
      throw new RateLimitError(limit, 0, windowStart + this.interval)
    }

    // カウントを増やす
    const newCount = currentCount + 1
    this.tokenCache.set(token, [newCount, windowStart])

    return {
      success: true,
      limit,
      remaining: Math.max(0, limit - newCount),
      reset: windowStart + this.interval,
    }
  }

  /**
   * トークンをリセット（テスト用）
   */
  reset(token: string): void {
    this.tokenCache.delete(token)
  }

  /**
   * すべてのトークンをクリア（テスト用）
   */
  clear(): void {
    this.tokenCache.clear()
  }
}

/**
 * レート制限インスタンスを作成
 */
export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  return new RateLimiter(options)
}

/**
 * グローバルレート制限インスタンス
 */
export const rateLimiters = {
  // IP制限（未認証ユーザー向け） - 10リクエスト/分
  ip: createRateLimiter({
    interval: 60 * 1000, // 1分
    uniqueTokenPerInterval: 500,
  }),

  // ユーザー制限（認証済みユーザー向け） - 50リクエスト/分
  user: createRateLimiter({
    interval: 60 * 1000, // 1分
    uniqueTokenPerInterval: 1000,
  }),

  // グローバル制限（全体） - 100リクエスト/分
  global: createRateLimiter({
    interval: 60 * 1000, // 1分
    uniqueTokenPerInterval: 100,
  }),

  // 画像アップロード制限（厳格） - 5リクエスト/分
  imageUpload: createRateLimiter({
    interval: 60 * 1000, // 1分
    uniqueTokenPerInterval: 200,
  }),
}

/**
 * レート制限ヘッダーを生成
 */
export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': new Date(result.reset).toISOString(),
  }
}

/**
 * Retry-Afterヘッダーを生成（秒単位）
 */
export function getRetryAfterSeconds(reset: number): number {
  const now = Date.now()
  const seconds = Math.ceil((reset - now) / 1000)
  return Math.max(1, seconds)
}
