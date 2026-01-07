/**
 * 画像検索デバッグロガー
 *
 * 開発環境でのみ動作し、画像検索のデータフローを詳細にログ出力します。
 * 本番環境では何も出力しません。
 *
 * Usage:
 * ```typescript
 * import { ImageSearchDebugLogger } from './debug-logger'
 *
 * ImageSearchDebugLogger.logVectorData(embedding)
 * ImageSearchDebugLogger.logRequest('/api/search', 'POST', { imageEmbedding: embedding })
 * ImageSearchDebugLogger.logResponse('/api/search', 200, responseData)
 * ```
 */

export class ImageSearchDebugLogger {
  /**
   * デバッグログが有効かどうか
   * 開発環境でのみ有効
   */
  private static isEnabled = process.env.NODE_ENV === 'development'

  /**
   * ログのプレフィックス
   */
  private static PREFIX = '[IMAGE SEARCH DEBUG]'

  /**
   * APIリクエストをログ出力
   *
   * @param endpoint - エンドポイント名（例: '/api/search'）
   * @param method - HTTPメソッド（GET, POST, etc.）
   * @param data - リクエストデータ
   */
  static logRequest(endpoint: string, method: string, data: any) {
    if (!this.isEnabled) return

    console.group(`${this.PREFIX} 🔵 Request to ${endpoint}`)
    console.log('📤 Method:', method)
    console.log('📋 Data:', {
      ...data,
      imageEmbedding: data.imageEmbedding
        ? `[Vector: ${data.imageEmbedding.length} dimensions]`
        : 'Not provided',
    })
    console.log('⏰ Timestamp:', new Date().toISOString())
    console.groupEnd()
  }

  /**
   * APIレスポンスをログ出力
   *
   * @param endpoint - エンドポイント名
   * @param status - HTTPステータスコード
   * @param data - レスポンスデータ
   */
  static logResponse(endpoint: string, status: number, data: any) {
    if (!this.isEnabled) return

    const icon = status >= 200 && status < 300 ? '✅' : '❌'

    console.group(`${this.PREFIX} ${icon} Response from ${endpoint}`)
    console.log('📥 Status:', status)
    console.log('📊 Data:', data)
    console.log('⏰ Timestamp:', new Date().toISOString())
    console.groupEnd()
  }

  /**
   * 画像ベクトルデータの詳細をログ出力
   *
   * @param embedding - 画像ベクトル配列
   * @param label - ラベル（オプション）
   */
  static logVectorData(embedding: number[], label: string = 'Image Vector') {
    if (!this.isEnabled) return

    console.group(`${this.PREFIX} 🔢 ${label}`)
    console.log('📐 Dimensions:', embedding.length)
    console.log('🔝 First 10 values:', embedding.slice(0, 10))
    console.log('🔚 Last 10 values:', embedding.slice(-10))

    // 統計情報
    const min = Math.min(...embedding)
    const max = Math.max(...embedding)
    const avg = embedding.reduce((a, b) => a + b, 0) / embedding.length

    console.log('📊 Statistics:', {
      min: min.toFixed(6),
      max: max.toFixed(6),
      average: avg.toFixed(6),
      range: (max - min).toFixed(6),
    })

    // ゼロ値や異常値の検出
    const zeroCount = embedding.filter((v) => v === 0).length
    const nanCount = embedding.filter((v) => isNaN(v)).length
    const infCount = embedding.filter((v) => !isFinite(v)).length

    if (zeroCount > 0 || nanCount > 0 || infCount > 0) {
      console.warn('⚠️ Potential Issues:', {
        zeroValues: zeroCount,
        nanValues: nanCount,
        infiniteValues: infCount,
      })
    }

    console.log('⏰ Timestamp:', new Date().toISOString())
    console.groupEnd()
  }

  /**
   * エラーをログ出力
   *
   * @param context - エラーコンテキスト
   * @param error - エラーオブジェクト
   */
  static logError(context: string, error: unknown) {
    if (!this.isEnabled) return

    console.group(`${this.PREFIX} ❌ Error in ${context}`)

    // エラーオブジェクトの型を安全に判定
    if (error instanceof Error) {
      console.error('🔴 Error Name:', error.name)
      console.error('💬 Error Message:', error.message)
      console.error('📚 Stack Trace:', error.stack)
    } else if (typeof error === 'object' && error !== null) {
      // Error以外のオブジェクト型エラー
      const errorObj = error as Record<string, unknown>
      console.error('🔴 Error Type:', 'Object')
      console.error('💬 Error Details:', errorObj)

      if ('name' in errorObj) {
        console.error('  - Name:', errorObj.name)
      }
      if ('message' in errorObj) {
        console.error('  - Message:', errorObj.message)
      }
      if ('stack' in errorObj) {
        console.error('  - Stack:', errorObj.stack)
      }
    } else if (typeof error === 'string') {
      console.error('🔴 Error Type:', 'String')
      console.error('💬 Error Message:', error)
    } else {
      console.error('🔴 Error Type:', typeof error)
      console.error('💬 Error Value:', error)
    }

    console.error('⏰ Timestamp:', new Date().toISOString())
    console.groupEnd()
  }

  /**
   * データフローの開始をログ出力
   *
   * @param flow - フロー名（例: 'Image Upload → Vector Generation'）
   */
  static startFlow(flow: string) {
    if (!this.isEnabled) return

    console.group(`${this.PREFIX} 🚀 Starting Flow: ${flow}`)
    console.log('⏰ Start Time:', new Date().toISOString())
    console.groupEnd()
  }

  /**
   * データフローの完了をログ出力
   *
   * @param flow - フロー名
   * @param duration - 実行時間（ミリ秒）
   */
  static endFlow(flow: string, duration?: number) {
    if (!this.isEnabled) return

    console.group(`${this.PREFIX} 🏁 Completed Flow: ${flow}`)
    if (duration !== undefined) {
      console.log('⏱️ Duration:', `${duration}ms`)
    }
    console.log('⏰ End Time:', new Date().toISOString())
    console.groupEnd()
  }

  /**
   * 特定のステップの完了をログ出力
   *
   * @param step - ステップ名
   * @param data - ステップデータ（オプション）
   */
  static logStep(step: string, data?: any) {
    if (!this.isEnabled) return

    console.group(`${this.PREFIX} ✅ Step: ${step}`)
    if (data) {
      console.log('📋 Data:', data)
    }
    console.log('⏰ Timestamp:', new Date().toISOString())
    console.groupEnd()
  }

  /**
   * パフォーマンス計測の開始
   *
   * @param label - ラベル
   * @returns 計測開始時刻
   */
  static startPerformance(label: string): number {
    if (!this.isEnabled) return 0

    const start = performance.now()
    console.log(`${this.PREFIX} ⏱️ Performance: ${label} started`)
    return start
  }

  /**
   * パフォーマンス計測の終了
   *
   * @param label - ラベル
   * @param startTime - 開始時刻（startPerformanceの戻り値）
   */
  static endPerformance(label: string, startTime: number) {
    if (!this.isEnabled) return

    const duration = performance.now() - startTime
    console.log(`${this.PREFIX} ⏱️ Performance: ${label} completed in ${duration.toFixed(2)}ms`)

    // パフォーマンス警告（500ms以上かかった場合）
    if (duration > 500) {
      console.warn(
        `${this.PREFIX} ⚠️ Performance Warning: ${label} took longer than expected (${duration.toFixed(2)}ms)`
      )
    }
  }

  /**
   * データの比較をログ出力（デバッグ時に便利）
   *
   * @param label - ラベル
   * @param expected - 期待値
   * @param actual - 実際の値
   */
  static compareData(label: string, expected: any, actual: any) {
    if (!this.isEnabled) return

    const isEqual = JSON.stringify(expected) === JSON.stringify(actual)

    console.group(`${this.PREFIX} ${isEqual ? '✅' : '❌'} Comparison: ${label}`)
    console.log('📊 Expected:', expected)
    console.log('📊 Actual:', actual)
    console.log('🔍 Match:', isEqual)

    if (!isEqual) {
      console.warn('⚠️ Values do not match!')
    }

    console.groupEnd()
  }

  /**
   * テーブル形式でデータをログ出力
   *
   * @param label - ラベル
   * @param data - テーブルデータ
   */
  static logTable(label: string, data: any[]) {
    if (!this.isEnabled) return

    console.group(`${this.PREFIX} 📊 Table: ${label}`)
    console.table(data)
    console.groupEnd()
  }

  /**
   * すべてのログをクリア（コンソールのクリア）
   */
  static clear() {
    if (!this.isEnabled) return

    console.clear()
    console.log(`${this.PREFIX} 🧹 Console cleared`)
  }
}

/**
 * パフォーマンス計測用のデコレータ（実験的）
 *
 * 使用例:
 * ```typescript
 * @measurePerformance('myFunction')
 * async function myFunction() {
 *   // ...
 * }
 * ```
 */
export function measurePerformance(label: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: any[]) {
      const start = ImageSearchDebugLogger.startPerformance(label)
      try {
        const result = await originalMethod.apply(this, args)
        ImageSearchDebugLogger.endPerformance(label, start)
        return result
      } catch (error) {
        ImageSearchDebugLogger.endPerformance(label, start)
        throw error
      }
    }

    return descriptor
  }
}

/**
 * エクスポート用の簡易エイリアス
 */
export const debug = ImageSearchDebugLogger
