/**
 * CloudWatch Monitoring & Logging Service
 *
 * パフォーマンスメトリクスとエラートラッキングを提供します。
 *
 * Features:
 * - パフォーマンスメトリクスの記録
 * - エラートラッキング
 * - CloudWatch Logsへの送信
 * - 構造化ログ
 */

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'
import {
  CloudWatchLogsClient,
  PutLogEventsCommand,
  CreateLogStreamCommand,
} from '@aws-sdk/client-cloudwatch-logs'
import { defaultProvider } from '@aws-sdk/credential-provider-node'

/**
 * ログレベル
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * メトリクスタイプ
 */
export enum MetricType {
  EMBEDDING_GENERATION_TIME = 'EmbeddingGenerationTime',
  SEARCH_QUERY_TIME = 'SearchQueryTime',
  CACHE_HIT_RATE = 'CacheHitRate',
  API_REQUEST_COUNT = 'APIRequestCount',
  ERROR_COUNT = 'ErrorCount',
}

/**
 * CloudWatch設定
 */
interface CloudWatchConfig {
  enabled: boolean
  logGroupName: string
  logStreamName: string
  metricsNamespace: string
  region: string
  logLevel: LogLevel
}

/**
 * ログエントリ
 */
interface LogEntry {
  timestamp: Date
  level: LogLevel
  message: string
  context?: Record<string, any>
  error?: Error
}

/**
 * メトリクスエントリ
 */
interface MetricEntry {
  name: MetricType
  value: number
  unit: 'Milliseconds' | 'Count' | 'Percent'
  timestamp: Date
  dimensions?: Record<string, string>
}

/**
 * CloudWatch監視サービス
 */
class MonitoringService {
  private config: CloudWatchConfig
  private cloudWatchLogsClient: CloudWatchLogsClient | null = null
  private cloudWatchClient: CloudWatchClient | null = null
  private logBuffer: LogEntry[] = []
  private metricBuffer: MetricEntry[] = []
  private flushInterval: NodeJS.Timeout | null = null

  constructor(config: CloudWatchConfig) {
    this.config = config

    if (this.config.enabled) {
      this.initializeClients()
      this.startFlushInterval()
    }
  }

  /**
   * CloudWatchクライアントを初期化
   */
  private initializeClients(): void {
    try {
      this.cloudWatchLogsClient = new CloudWatchLogsClient({
        region: this.config.region,
        credentials: defaultProvider(),
      })

      this.cloudWatchClient = new CloudWatchClient({
        region: this.config.region,
        credentials: defaultProvider(),
      })

      console.log('[Monitoring] CloudWatch clients initialized')
    } catch (error) {
      console.error('[Monitoring] Failed to initialize CloudWatch clients:', error)
    }
  }

  /**
   * 定期的にログとメトリクスをフラッシュ
   */
  private startFlushInterval(): void {
    this.flushInterval = setInterval(() => {
      this.flush()
    }, 60000) // 1分ごと
  }

  /**
   * ログを記録
   */
  log(level: LogLevel, message: string, context?: Record<string, any>, error?: Error): void {
    // ログレベルチェック
    const logLevels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR]
    const currentLevelIndex = logLevels.indexOf(this.config.logLevel)
    const messageLevelIndex = logLevels.indexOf(level)

    if (messageLevelIndex < currentLevelIndex) {
      return // ログレベルが低いので無視
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      context,
      error,
    }

    // コンソールに出力
    this.logToConsole(entry)

    // CloudWatch有効時はバッファに追加
    if (this.config.enabled) {
      this.logBuffer.push(entry)

      // バッファが100エントリに達したら即座にフラッシュ
      if (this.logBuffer.length >= 100) {
        this.flush()
      }
    }
  }

  /**
   * コンソールにログ出力
   */
  private logToConsole(entry: LogEntry): void {
    const timestamp = entry.timestamp.toISOString()
    const logMessage = `[${timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`

    switch (entry.level) {
      case LogLevel.DEBUG:
      case LogLevel.INFO:
        console.log(logMessage, entry.context || '')
        break
      case LogLevel.WARN:
        console.warn(logMessage, entry.context || '')
        break
      case LogLevel.ERROR:
        console.error(logMessage, entry.context || '', entry.error || '')
        break
    }
  }

  /**
   * メトリクスを記録
   */
  recordMetric(
    name: MetricType,
    value: number,
    unit: 'Milliseconds' | 'Count' | 'Percent' = 'Count',
    dimensions?: Record<string, string>
  ): void {
    if (!this.config.enabled) {
      return
    }

    const entry: MetricEntry = {
      name,
      value,
      unit,
      timestamp: new Date(),
      dimensions,
    }

    this.metricBuffer.push(entry)

    // バッファが20メトリクスに達したら即座にフラッシュ
    if (this.metricBuffer.length >= 20) {
      this.flush()
    }
  }

  /**
   * バッファをCloudWatchにフラッシュ
   */
  async flush(): Promise<void> {
    if (!this.config.enabled) {
      return
    }

    // ログをフラッシュ
    if (this.logBuffer.length > 0) {
      await this.flushLogs()
    }

    // メトリクスをフラッシュ
    if (this.metricBuffer.length > 0) {
      await this.flushMetrics()
    }
  }

  /**
   * ログをCloudWatch Logsに送信
   */
  private async flushLogs(): Promise<void> {
    if (!this.cloudWatchLogsClient || this.logBuffer.length === 0) {
      return
    }

    const logs = [...this.logBuffer]
    this.logBuffer = []

    try {
      // ログストリームを作成（存在しない場合）
      try {
        await this.cloudWatchLogsClient.send(
          new CreateLogStreamCommand({
            logGroupName: this.config.logGroupName,
            logStreamName: this.config.logStreamName,
          })
        )
      } catch (error: any) {
        // ログストリームが既に存在する場合はエラーを無視
        if (error.name !== 'ResourceAlreadyExistsException') {
          throw error
        }
      }

      // ログイベントを送信
      const logEvents = logs.map((entry) => ({
        timestamp: entry.timestamp.getTime(),
        message: JSON.stringify({
          level: entry.level,
          message: entry.message,
          context: entry.context,
          error: entry.error
            ? {
                name: entry.error.name,
                message: entry.error.message,
                stack: entry.error.stack,
              }
            : undefined,
        }),
      }))

      await this.cloudWatchLogsClient.send(
        new PutLogEventsCommand({
          logGroupName: this.config.logGroupName,
          logStreamName: this.config.logStreamName,
          logEvents,
        })
      )

      console.log(`[Monitoring] Flushed ${logs.length} log entries to CloudWatch`)
    } catch (error) {
      console.error('[Monitoring] Failed to flush logs to CloudWatch:', error)
      // エラー時は次回リトライのためにバッファを戻す
      this.logBuffer = [...logs, ...this.logBuffer]
    }
  }

  /**
   * メトリクスをCloudWatchに送信
   */
  private async flushMetrics(): Promise<void> {
    if (!this.cloudWatchClient || this.metricBuffer.length === 0) {
      return
    }

    const metrics = [...this.metricBuffer]
    this.metricBuffer = []

    try {
      const metricData = metrics.map((entry) => ({
        MetricName: entry.name,
        Value: entry.value,
        Unit: entry.unit,
        Timestamp: entry.timestamp,
        Dimensions: entry.dimensions
          ? Object.entries(entry.dimensions).map(([key, value]) => ({
              Name: key,
              Value: value,
            }))
          : undefined,
      }))

      await this.cloudWatchClient.send(
        new PutMetricDataCommand({
          Namespace: this.config.metricsNamespace,
          MetricData: metricData,
        })
      )

      console.log(`[Monitoring] Flushed ${metrics.length} metrics to CloudWatch`)
    } catch (error) {
      console.error('[Monitoring] Failed to flush metrics to CloudWatch:', error)
      // エラー時は次回リトライのためにバッファを戻す
      this.metricBuffer = [...metrics, ...this.metricBuffer]
    }
  }

  /**
   * サービスをシャットダウン
   */
  shutdown(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
      this.flushInterval = null
    }

    // 残っているバッファをフラッシュ
    this.flush()
  }

  // 便利メソッド
  debug(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, context)
  }

  info(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, context)
  }

  warn(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, context)
  }

  error(message: string, error?: Error, context?: Record<string, any>): void {
    this.log(LogLevel.ERROR, message, context, error)
  }
}

/**
 * シングルトンインスタンス
 */
let monitoringService: MonitoringService | null = null

/**
 * 監視サービスを取得
 */
export function getMonitoringService(): MonitoringService {
  if (!monitoringService) {
    const config: CloudWatchConfig = {
      enabled: process.env.ENABLE_CLOUDWATCH_LOGS === 'true',
      logGroupName: process.env.LOG_GROUP_NAME || '/aws/lambda/cis-filesearch',
      logStreamName: `frontend-${new Date().toISOString().split('T')[0]}`,
      metricsNamespace: process.env.METRICS_NAMESPACE || 'CISFileSearch',
      region: process.env.AWS_REGION || 'ap-northeast-1',
      logLevel: (process.env.LOG_LEVEL as LogLevel) || LogLevel.INFO,
    }

    monitoringService = new MonitoringService(config)

    console.log('[Monitoring] Service initialized with config:', {
      enabled: config.enabled,
      logGroupName: config.logGroupName,
      metricsNamespace: config.metricsNamespace,
      logLevel: config.logLevel,
    })
  }

  return monitoringService
}

/**
 * パフォーマンス計測ヘルパー
 */
export function measurePerformance<T>(
  metricName: MetricType,
  operation: () => Promise<T>
): Promise<T> {
  const startTime = Date.now()
  const monitoring = getMonitoringService()

  return operation()
    .then((result) => {
      const duration = Date.now() - startTime
      monitoring.recordMetric(metricName, duration, 'Milliseconds')
      return result
    })
    .catch((error) => {
      const duration = Date.now() - startTime
      monitoring.recordMetric(metricName, duration, 'Milliseconds')
      monitoring.recordMetric(MetricType.ERROR_COUNT, 1)
      throw error
    })
}
