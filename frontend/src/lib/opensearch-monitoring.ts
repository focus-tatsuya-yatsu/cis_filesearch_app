/**
 * OpenSearch Migration Monitoring & Alerting
 * Real-time metrics and alerting during index migration
 *
 * @description
 * Comprehensive monitoring system for tracking migration health,
 * performance metrics, and triggering alerts on anomalies.
 *
 * Key Features:
 * - Real-time metrics collection
 * - CloudWatch integration
 * - Anomaly detection
 * - Multi-channel alerting (SNS, Slack, Email)
 * - Performance dashboards
 * - SLA tracking
 */

import {
  CloudWatchClient,
  PutMetricDataCommand,
  Dimension,
  MetricDatum,
} from '@aws-sdk/client-cloudwatch'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import { Client } from '@opensearch-project/opensearch'

import { Logger } from './logger'

const logger = new Logger('MigrationMonitoring')

/**
 * Metric Types
 */
export enum MetricType {
  // Performance Metrics
  QUERY_LATENCY = 'QueryLatency',
  INDEXING_THROUGHPUT = 'IndexingThroughput',
  REINDEX_PROGRESS = 'ReindexProgress',
  SEARCH_SUCCESS_RATE = 'SearchSuccessRate',

  // Health Metrics
  INDEX_HEALTH = 'IndexHealth',
  CLUSTER_HEALTH = 'ClusterHealth',
  NODE_AVAILABILITY = 'NodeAvailability',

  // Data Metrics
  DOCUMENT_COUNT = 'DocumentCount',
  INDEX_SIZE = 'IndexSize',
  SHARD_COUNT = 'ShardCount',

  // Error Metrics
  ERROR_RATE = 'ErrorRate',
  TIMEOUT_RATE = 'TimeoutRate',
  CIRCUIT_BREAKER_TRIPS = 'CircuitBreakerTrips',
}

/**
 * Alert Severity Levels
 */
export enum AlertSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
}

/**
 * Metric Data Point
 */
export interface MetricDataPoint {
  timestamp: Date
  metricType: MetricType
  value: number
  unit: string
  dimensions?: Record<string, string>
}

/**
 * Alert Configuration
 */
export interface AlertConfig {
  name: string
  metricType: MetricType
  threshold: number
  comparison: 'GreaterThan' | 'LessThan' | 'Equal'
  evaluationPeriods: number
  severity: AlertSeverity
  enabled: boolean
}

/**
 * Alert Event
 */
export interface AlertEvent {
  timestamp: Date
  severity: AlertSeverity
  title: string
  message: string
  metrics?: Record<string, number>
  indexName?: string
}

/**
 * Health Check Result
 */
export interface HealthCheckResult {
  healthy: boolean
  score: number // 0-100
  checks: {
    clusterHealth: boolean
    indexHealth: boolean
    queryPerformance: boolean
    errorRate: boolean
  }
  details: Record<string, any>
}

/**
 * Migration Monitoring System
 */
export class MigrationMonitoring {
  private client: Client
  private cloudWatch: CloudWatchClient
  private sns: SNSClient
  private namespace: string
  private alertConfigs: AlertConfig[]
  private metricsBuffer: MetricDataPoint[] = []
  private flushInterval: NodeJS.Timeout | null = null

  constructor(client: Client, region: string, namespace = 'CIS/OpenSearchMigration') {
    this.client = client
    this.cloudWatch = new CloudWatchClient({ region })
    this.sns = new SNSClient({ region })
    this.namespace = namespace
    this.alertConfigs = this.getDefaultAlertConfigs()

    // Start metrics flushing
    this.startMetricsFlushing()
  }

  /**
   * Default Alert Configurations
   */
  private getDefaultAlertConfigs(): AlertConfig[] {
    return [
      {
        name: 'HighQueryLatency',
        metricType: MetricType.QUERY_LATENCY,
        threshold: 1000, // 1 second
        comparison: 'GreaterThan',
        evaluationPeriods: 3,
        severity: AlertSeverity.WARNING,
        enabled: true,
      },
      {
        name: 'HighErrorRate',
        metricType: MetricType.ERROR_RATE,
        threshold: 5, // 5%
        comparison: 'GreaterThan',
        evaluationPeriods: 2,
        severity: AlertSeverity.CRITICAL,
        enabled: true,
      },
      {
        name: 'LowSearchSuccessRate',
        metricType: MetricType.SEARCH_SUCCESS_RATE,
        threshold: 95, // 95%
        comparison: 'LessThan',
        evaluationPeriods: 3,
        severity: AlertSeverity.ERROR,
        enabled: true,
      },
      {
        name: 'ClusterUnhealthy',
        metricType: MetricType.CLUSTER_HEALTH,
        threshold: 1, // 0=red, 1=yellow, 2=green
        comparison: 'LessThan',
        evaluationPeriods: 2,
        severity: AlertSeverity.CRITICAL,
        enabled: true,
      },
      {
        name: 'ReindexStalled',
        metricType: MetricType.REINDEX_PROGRESS,
        threshold: 0, // No progress
        comparison: 'Equal',
        evaluationPeriods: 5,
        severity: AlertSeverity.WARNING,
        enabled: true,
      },
    ]
  }

  /**
   * Record a metric data point
   */
  recordMetric(
    metricType: MetricType,
    value: number,
    unit: string,
    dimensions?: Record<string, string>
  ): void {
    const dataPoint: MetricDataPoint = {
      timestamp: new Date(),
      metricType,
      value,
      unit,
      dimensions,
    }

    this.metricsBuffer.push(dataPoint)

    // Flush if buffer is large
    if (this.metricsBuffer.length >= 100) {
      this.flushMetrics()
    }
  }

  /**
   * Start periodic metrics flushing
   */
  private startMetricsFlushing(): void {
    this.flushInterval = setInterval(() => {
      this.flushMetrics()
    }, 60000) // Flush every minute
  }

  /**
   * Flush metrics to CloudWatch
   */
  private async flushMetrics(): Promise<void> {
    if (this.metricsBuffer.length === 0) {
      return
    }

    const metricsToFlush = [...this.metricsBuffer]
    this.metricsBuffer = []

    try {
      // Convert to CloudWatch format
      const metricData: MetricDatum[] = metricsToFlush.map((point) => {
        const dimensions: Dimension[] = point.dimensions
          ? Object.entries(point.dimensions).map(([name, value]) => ({
              Name: name,
              Value: value,
            }))
          : []

        return {
          MetricName: point.metricType,
          Timestamp: point.timestamp,
          Value: point.value,
          Unit: point.unit as any,
          Dimensions: dimensions,
        }
      })

      // Send to CloudWatch (batch of 20 at a time)
      for (let i = 0; i < metricData.length; i += 20) {
        const batch = metricData.slice(i, i + 20)

        await this.cloudWatch.send(
          new PutMetricDataCommand({
            Namespace: this.namespace,
            MetricData: batch,
          })
        )
      }

      logger.debug('Flushed metrics to CloudWatch', {
        count: metricData.length,
      })
    } catch (error: any) {
      logger.error('Failed to flush metrics', {
        error: error.message,
        count: metricsToFlush.length,
      })

      // Re-add to buffer for retry
      this.metricsBuffer.unshift(...metricsToFlush)
    }
  }

  /**
   * Comprehensive Health Check
   */
  async performHealthCheck(indexName: string): Promise<HealthCheckResult> {
    const checks = {
      clusterHealth: false,
      indexHealth: false,
      queryPerformance: false,
      errorRate: false,
    }

    const details: Record<string, any> = {}

    try {
      // 1. Cluster Health
      const clusterHealth = await this.client.cluster.health()
      const clusterStatus = clusterHealth.body.status
      checks.clusterHealth = clusterStatus === 'green'
      details.clusterStatus = clusterStatus

      this.recordMetric(
        MetricType.CLUSTER_HEALTH,
        clusterStatus === 'green' ? 2 : clusterStatus === 'yellow' ? 1 : 0,
        'None',
        { IndexName: indexName }
      )

      // 2. Index Health
      const indexHealth = await this.client.cluster.health({
        index: indexName,
      })
      const indexStatus = indexHealth.body.status
      checks.indexHealth = indexStatus === 'green'
      details.indexStatus = indexStatus

      this.recordMetric(
        MetricType.INDEX_HEALTH,
        indexStatus === 'green' ? 2 : indexStatus === 'yellow' ? 1 : 0,
        'None',
        { IndexName: indexName }
      )

      // 3. Query Performance Test
      const queryStart = Date.now()
      const testQuery = await this.client.search({
        index: indexName,
        body: {
          query: { match_all: {} },
          size: 1,
        },
      })
      const queryLatency = Date.now() - queryStart
      checks.queryPerformance = queryLatency < 1000 // < 1 second
      details.queryLatency = queryLatency

      this.recordMetric(MetricType.QUERY_LATENCY, queryLatency, 'Milliseconds', {
        IndexName: indexName,
        QueryType: 'HealthCheck',
      })

      // 4. Get Index Stats for Error Rate
      const stats = await this.client.indices.stats({
        index: indexName,
      })

      const indexStats = stats.body.indices[indexName]
      const searchTotal = indexStats?.total?.search?.query_total || 0
      const searchFailed = indexStats?.total?.search?.query_failed || 0
      const errorRate = searchTotal > 0 ? (searchFailed / searchTotal) * 100 : 0
      checks.errorRate = errorRate < 5 // < 5%
      details.errorRate = errorRate

      this.recordMetric(MetricType.ERROR_RATE, errorRate, 'Percent', { IndexName: indexName })

      // Calculate overall health score
      const score = Object.values(checks).filter(Boolean).length * 25

      const result: HealthCheckResult = {
        healthy: Object.values(checks).every(Boolean),
        score,
        checks,
        details,
      }

      logger.info('Health check completed', {
        indexName,
        score,
        healthy: result.healthy,
      })

      return result
    } catch (error: any) {
      logger.error('Health check failed', {
        indexName,
        error: error.message,
      })

      return {
        healthy: false,
        score: 0,
        checks,
        details: { error: error.message },
      }
    }
  }

  /**
   * Monitor Reindex Progress
   */
  async monitorReindexTask(taskId: string): Promise<void> {
    logger.info('Starting reindex monitoring', { taskId })

    let lastProgress = 0
    let stallCount = 0

    const monitorInterval = setInterval(async () => {
      try {
        const taskStatus = await this.client.tasks.get({
          task_id: taskId,
        })

        const task = taskStatus.body
        const status = task.task?.status

        if (status) {
          const created = status.created || 0
          const total = status.total || 1
          const progress = (created / total) * 100

          // Record progress metric
          this.recordMetric(MetricType.REINDEX_PROGRESS, progress, 'Percent', { TaskId: taskId })

          // Check for stall
          if (progress === lastProgress) {
            stallCount++
            if (stallCount >= 5) {
              await this.sendAlert({
                timestamp: new Date(),
                severity: AlertSeverity.WARNING,
                title: 'Reindex Task Stalled',
                message: `Reindex task ${taskId} has made no progress for 5 checks`,
                metrics: { progress, created, total },
              })
            }
          } else {
            stallCount = 0
          }

          lastProgress = progress
        }

        // Check if completed
        if (task.completed) {
          clearInterval(monitorInterval)
          logger.info('Reindex task completed', { taskId })

          if (task.error) {
            await this.sendAlert({
              timestamp: new Date(),
              severity: AlertSeverity.ERROR,
              title: 'Reindex Task Failed',
              message: `Reindex task ${taskId} failed: ${JSON.stringify(task.error)}`,
            })
          }
        }
      } catch (error: any) {
        logger.error('Error monitoring reindex task', {
          taskId,
          error: error.message,
        })
      }
    }, 10000) // Check every 10 seconds
  }

  /**
   * Monitor Query Performance
   */
  async monitorQueryPerformance(indexName: string, duration: number = 300000): Promise<void> {
    logger.info('Starting query performance monitoring', {
      indexName,
      duration,
    })

    const startTime = Date.now()
    const testQueries = [
      {
        name: 'SimpleMatch',
        query: { multi_match: { query: 'test', fields: ['file_name'] } },
      },
      {
        name: 'ComplexBool',
        query: {
          bool: {
            must: [{ match: { extracted_text: 'document' } }],
            filter: [{ term: { file_type: 'pdf' } }],
          },
        },
      },
      {
        name: 'RangeQuery',
        query: {
          range: { file_size: { gte: 1000, lte: 100000 } },
        },
      },
    ]

    const monitorInterval = setInterval(async () => {
      if (Date.now() - startTime > duration) {
        clearInterval(monitorInterval)
        logger.info('Query performance monitoring completed')
        return
      }

      for (const testQuery of testQueries) {
        try {
          const queryStart = Date.now()

          await this.client.search({
            index: indexName,
            body: {
              query: testQuery.query,
              size: 10,
            },
          })

          const latency = Date.now() - queryStart

          this.recordMetric(MetricType.QUERY_LATENCY, latency, 'Milliseconds', {
            IndexName: indexName,
            QueryType: testQuery.name,
          })

          // Alert on high latency
          if (latency > 1000) {
            await this.sendAlert({
              timestamp: new Date(),
              severity: AlertSeverity.WARNING,
              title: 'High Query Latency',
              message: `Query ${testQuery.name} on ${indexName} took ${latency}ms`,
              metrics: { latency },
              indexName,
            })
          }
        } catch (error: any) {
          logger.error('Query performance test failed', {
            queryName: testQuery.name,
            error: error.message,
          })

          this.recordMetric(MetricType.ERROR_RATE, 1, 'Count', {
            IndexName: indexName,
            QueryType: testQuery.name,
          })
        }
      }
    }, 30000) // Run every 30 seconds
  }

  /**
   * Send Alert
   */
  async sendAlert(alert: AlertEvent): Promise<void> {
    logger.warn('Sending alert', {
      severity: alert.severity,
      title: alert.title,
    })

    const snsTopicArn = process.env.MIGRATION_ALERT_SNS_TOPIC

    if (!snsTopicArn) {
      logger.warn('SNS topic not configured, alert not sent')
      return
    }

    try {
      const message = JSON.stringify(alert, null, 2)

      await this.sns.send(
        new PublishCommand({
          TopicArn: snsTopicArn,
          Subject: `[${alert.severity}] ${alert.title}`,
          Message: message,
          MessageAttributes: {
            severity: {
              DataType: 'String',
              StringValue: alert.severity,
            },
          },
        })
      )

      logger.info('Alert sent successfully', {
        severity: alert.severity,
        title: alert.title,
      })
    } catch (error: any) {
      logger.error('Failed to send alert', {
        error: error.message,
        alert,
      })
    }
  }

  /**
   * Get Migration Dashboard Metrics
   */
  async getDashboardMetrics(indexName: string): Promise<Record<string, any>> {
    try {
      // Get index stats
      const stats = await this.client.indices.stats({
        index: indexName,
      })

      const indexStats = stats.body.indices[indexName]

      // Get document count
      const count = await this.client.count({
        index: indexName,
      })

      // Get index size
      const indexSize = indexStats?.total?.store?.size_in_bytes || 0

      // Calculate metrics
      const searchTotal = indexStats?.total?.search?.query_total || 0
      const searchFailed = indexStats?.total?.search?.query_failed || 0
      const searchSuccessRate =
        searchTotal > 0 ? ((searchTotal - searchFailed) / searchTotal) * 100 : 100

      const indexingTotal = indexStats?.total?.indexing?.index_total || 0
      const indexingFailed = indexStats?.total?.indexing?.index_failed || 0
      const indexingSuccessRate =
        indexingTotal > 0 ? ((indexingTotal - indexingFailed) / indexingTotal) * 100 : 100

      return {
        indexName,
        documentCount: count.body.count,
        indexSize,
        searchTotal,
        searchFailed,
        searchSuccessRate,
        indexingTotal,
        indexingFailed,
        indexingSuccessRate,
        timestamp: new Date().toISOString(),
      }
    } catch (error: any) {
      logger.error('Failed to get dashboard metrics', {
        error: error.message,
      })
      return {}
    }
  }

  /**
   * Compare Blue vs Green Metrics
   */
  async compareIndices(blueIndex: string, greenIndex: string): Promise<Record<string, any>> {
    const [blueMetrics, greenMetrics] = await Promise.all([
      this.getDashboardMetrics(blueIndex),
      this.getDashboardMetrics(greenIndex),
    ])

    const comparison = {
      blue: blueMetrics,
      green: greenMetrics,
      diff: {
        documentCount: greenMetrics.documentCount - blueMetrics.documentCount,
        documentCountPercent:
          blueMetrics.documentCount > 0
            ? ((greenMetrics.documentCount - blueMetrics.documentCount) /
                blueMetrics.documentCount) *
              100
            : 0,
        indexSize: greenMetrics.indexSize - blueMetrics.indexSize,
        searchSuccessRate: greenMetrics.searchSuccessRate - blueMetrics.searchSuccessRate,
      },
    }

    logger.info('Index comparison', comparison)

    return comparison
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
    }

    // Final flush
    this.flushMetrics()
  }
}

/**
 * SLA Tracker
 */
export class SLATracker {
  private targets: Map<string, number> = new Map([
    ['availability', 99.9], // 99.9% uptime
    ['query_latency_p95', 500], // 500ms p95
    ['error_rate', 0.1], // 0.1% error rate
  ])

  private measurements: Map<string, number[]> = new Map()

  recordMeasurement(sla: string, value: number): void {
    if (!this.measurements.has(sla)) {
      this.measurements.set(sla, [])
    }

    this.measurements.get(sla)!.push(value)
  }

  getSLAStatus(sla: string): {
    target: number
    current: number
    met: boolean
  } {
    const target = this.targets.get(sla) || 0
    const measurements = this.measurements.get(sla) || []

    if (measurements.length === 0) {
      return { target, current: 0, met: false }
    }

    // Calculate p95 for latency metrics
    let current: number
    if (sla.includes('latency')) {
      measurements.sort((a, b) => a - b)
      const p95Index = Math.floor(measurements.length * 0.95)
      current = measurements[p95Index]
    } else {
      // Average for other metrics
      current = measurements.reduce((a, b) => a + b, 0) / measurements.length
    }

    const met = sla.includes('latency') ? current <= target : current >= target

    return { target, current, met }
  }

  getAllSLAStatus(): Record<string, any> {
    const status: Record<string, any> = {}

    for (const [sla] of this.targets) {
      status[sla] = this.getSLAStatus(sla)
    }

    return status
  }
}
