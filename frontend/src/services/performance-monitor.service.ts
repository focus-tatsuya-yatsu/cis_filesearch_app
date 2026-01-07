/**
 * Performance Monitoring Service
 * 画像検索パフォーマンスの計測とレポート
 *
 * Features:
 * - Request timing metrics
 * - Network performance tracking
 * - Error rate monitoring
 * - Performance analytics
 */

/**
 * Performance Metrics
 */
export interface PerformanceMetrics {
  operation: string
  timestamp: number
  duration: number
  success: boolean
  metadata?: Record<string, any>
}

/**
 * Aggregated Performance Stats
 */
export interface PerformanceStats {
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  averageDuration: number
  p50Duration: number
  p95Duration: number
  p99Duration: number
  minDuration: number
  maxDuration: number
  errorRate: number
}

/**
 * Performance Monitor Configuration
 */
const MONITOR_CONFIG = {
  maxMetrics: 1000, // Maximum metrics to store
  reportInterval: 60000, // Report every 60 seconds
  enableConsoleLog: true,
  enableAnalytics: true,
}

/**
 * Performance Monitor Service
 */
class PerformanceMonitorService {
  private metrics: PerformanceMetrics[] = []
  private reportTimer: NodeJS.Timeout | null = null

  constructor() {
    this.startPeriodicReporting()
  }

  /**
   * Start a performance measurement
   */
  start(operation: string): (metadata?: Record<string, any>) => void {
    const startTime = performance.now()
    const timestamp = Date.now()

    return (metadata?: Record<string, any>) => {
      const duration = performance.now() - startTime

      this.recordMetric({
        operation,
        timestamp,
        duration,
        success: true,
        metadata,
      })
    }
  }

  /**
   * Record a performance metric
   */
  recordMetric(metric: PerformanceMetrics): void {
    this.metrics.push(metric)

    // Trim metrics if exceeds max
    if (this.metrics.length > MONITOR_CONFIG.maxMetrics) {
      this.metrics = this.metrics.slice(-MONITOR_CONFIG.maxMetrics)
    }

    // Console log for development
    if (MONITOR_CONFIG.enableConsoleLog && process.env.NODE_ENV === 'development') {
      console.log('[PerformanceMonitor]', {
        operation: metric.operation,
        duration: `${metric.duration.toFixed(2)}ms`,
        success: metric.success,
        metadata: metric.metadata,
      })
    }
  }

  /**
   * Record an error
   */
  recordError(operation: string, error: Error, metadata?: Record<string, any>): void {
    this.recordMetric({
      operation,
      timestamp: Date.now(),
      duration: 0,
      success: false,
      metadata: {
        ...metadata,
        error: error.message,
        stack: error.stack,
      },
    })
  }

  /**
   * Get metrics for a specific operation
   */
  getMetrics(operation?: string): PerformanceMetrics[] {
    if (operation) {
      return this.metrics.filter((m) => m.operation === operation)
    }
    return this.metrics
  }

  /**
   * Calculate statistics for an operation
   */
  getStats(operation?: string): PerformanceStats {
    const metrics = this.getMetrics(operation)

    if (metrics.length === 0) {
      return {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageDuration: 0,
        p50Duration: 0,
        p95Duration: 0,
        p99Duration: 0,
        minDuration: 0,
        maxDuration: 0,
        errorRate: 0,
      }
    }

    const successfulMetrics = metrics.filter((m) => m.success)
    const durations = successfulMetrics.map((m) => m.duration).sort((a, b) => a - b)

    const totalRequests = metrics.length
    const successfulRequests = successfulMetrics.length
    const failedRequests = totalRequests - successfulRequests

    const averageDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length || 0

    const percentile = (arr: number[], p: number) => {
      if (arr.length === 0) return 0
      const index = Math.ceil((arr.length * p) / 100) - 1
      return arr[Math.max(0, index)]
    }

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      averageDuration,
      p50Duration: percentile(durations, 50),
      p95Duration: percentile(durations, 95),
      p99Duration: percentile(durations, 99),
      minDuration: durations[0] || 0,
      maxDuration: durations[durations.length - 1] || 0,
      errorRate: (failedRequests / totalRequests) * 100,
    }
  }

  /**
   * Generate performance report
   */
  generateReport(): Record<string, PerformanceStats> {
    const operations = Array.from(new Set(this.metrics.map((m) => m.operation)))
    const report: Record<string, PerformanceStats> = {}

    operations.forEach((operation) => {
      report[operation] = this.getStats(operation)
    })

    return report
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = []
  }

  /**
   * Start periodic reporting
   */
  private startPeriodicReporting(): void {
    if (!MONITOR_CONFIG.enableAnalytics) return

    this.reportTimer = setInterval(() => {
      const report = this.generateReport()

      console.log('[PerformanceMonitor] Periodic Report:', report)

      // Send to analytics service (if configured)
      this.sendToAnalytics(report)
    }, MONITOR_CONFIG.reportInterval)
  }

  /**
   * Send metrics to analytics service
   */
  private sendToAnalytics(report: Record<string, PerformanceStats>): void {
    // Implement analytics integration here (e.g., Google Analytics, CloudWatch)
    // For now, just log to console
    if (process.env.NODE_ENV === 'development') {
      console.log('[Analytics] Performance Report:', JSON.stringify(report, null, 2))
    }
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.reportTimer) {
      clearInterval(this.reportTimer)
      this.reportTimer = null
    }
  }
}

/**
 * Export singleton instance
 */
export const performanceMonitor = new PerformanceMonitorService()

/**
 * Performance measurement decorator
 */
export function measurePerformance(operation: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: any[]) {
      const endMeasurement = performanceMonitor.start(operation)

      try {
        const result = await originalMethod.apply(this, args)
        endMeasurement()
        return result
      } catch (error) {
        performanceMonitor.recordError(operation, error as Error)
        throw error
      }
    }

    return descriptor
  }
}

/**
 * Core Web Vitals Monitoring
 */
export class WebVitalsMonitor {
  /**
   * Monitor Largest Contentful Paint (LCP)
   */
  static observeLCP(callback: (value: number) => void): void {
    if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        const lastEntry = entries[entries.length - 1] as any

        if (lastEntry) {
          callback(lastEntry.renderTime || lastEntry.loadTime)
        }
      })

      observer.observe({ type: 'largest-contentful-paint', buffered: true })
    } catch (error) {
      console.warn('[WebVitals] LCP observation failed:', error)
    }
  }

  /**
   * Monitor First Input Delay (FID)
   */
  static observeFID(callback: (value: number) => void): void {
    if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return

    try {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        entries.forEach((entry: any) => {
          if (entry.name === 'first-input') {
            callback(entry.processingStart - entry.startTime)
          }
        })
      })

      observer.observe({ type: 'first-input', buffered: true })
    } catch (error) {
      console.warn('[WebVitals] FID observation failed:', error)
    }
  }

  /**
   * Monitor Cumulative Layout Shift (CLS)
   */
  static observeCLS(callback: (value: number) => void): void {
    if (typeof window === 'undefined' || !('PerformanceObserver' in window)) return

    try {
      let clsValue = 0

      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        entries.forEach((entry: any) => {
          if (!entry.hadRecentInput) {
            clsValue += entry.value
            callback(clsValue)
          }
        })
      })

      observer.observe({ type: 'layout-shift', buffered: true })
    } catch (error) {
      console.warn('[WebVitals] CLS observation failed:', error)
    }
  }

  /**
   * Monitor all Core Web Vitals
   */
  static observeAll(callback: (metric: { name: string; value: number }) => void): void {
    this.observeLCP((value) => callback({ name: 'LCP', value }))
    this.observeFID((value) => callback({ name: 'FID', value }))
    this.observeCLS((value) => callback({ name: 'CLS', value }))
  }
}

/**
 * Network Performance Monitoring
 */
export class NetworkMonitor {
  /**
   * Measure API request performance
   */
  static async measureRequest(
    url: string,
    options: RequestInit = {}
  ): Promise<{
    response: Response
    metrics: {
      dnsTime: number
      tcpTime: number
      tlsTime: number
      requestTime: number
      responseTime: number
      totalTime: number
    }
  }> {
    const startTime = performance.now()

    const response = await fetch(url, options)

    const endTime = performance.now()
    const totalTime = endTime - startTime

    // Try to get detailed timing from Performance API
    let detailedMetrics = {
      dnsTime: 0,
      tcpTime: 0,
      tlsTime: 0,
      requestTime: 0,
      responseTime: 0,
      totalTime,
    }

    if (typeof window !== 'undefined' && 'performance' in window) {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      const entry = entries.find((e) => e.name === url)

      if (entry) {
        detailedMetrics = {
          dnsTime: entry.domainLookupEnd - entry.domainLookupStart,
          tcpTime: entry.connectEnd - entry.connectStart,
          tlsTime: entry.secureConnectionStart ? entry.connectEnd - entry.secureConnectionStart : 0,
          requestTime: entry.responseStart - entry.requestStart,
          responseTime: entry.responseEnd - entry.responseStart,
          totalTime: entry.responseEnd - entry.startTime,
        }
      }
    }

    return { response, metrics: detailedMetrics }
  }
}
