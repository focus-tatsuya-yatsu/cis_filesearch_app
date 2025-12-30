/**
 * Performance Monitoring Utility
 *
 * Features:
 * - Request timing
 * - CloudWatch Metrics integration
 * - P50/P95/P99 percentile tracking
 * - Memory usage monitoring
 * - Custom metrics
 *
 * Usage:
 * const monitor = new PerformanceMonitor();
 * const endTimer = monitor.startTimer('operation_name');
 * // ... perform operation
 * endTimer();
 */

import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { Logger } from '../services/logger.service';

const logger = new Logger('PerformanceMonitor');

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: 'Milliseconds' | 'Count' | 'Bytes' | 'Percent';
  timestamp: Date;
}

export interface PerformanceStats {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

export class PerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();
  private cloudwatch: CloudWatchClient | null = null;
  private namespace: string;
  private enabled: boolean;

  constructor(namespace: string = 'CIS/SearchAPI') {
    this.namespace = namespace;
    this.enabled = process.env.ENABLE_PERFORMANCE_MONITORING === 'true';

    if (this.enabled) {
      this.cloudwatch = new CloudWatchClient({
        region: process.env.AWS_REGION || 'ap-northeast-1',
      });
    }
  }

  /**
   * Start a timer for an operation
   * Returns a function to call when operation completes
   */
  public startTimer(
    label: string,
    dimensions?: Record<string, string>
  ): () => void {
    const start = performance.now();

    return () => {
      const duration = performance.now() - start;

      // Store metric locally
      if (!this.metrics.has(label)) {
        this.metrics.set(label, []);
      }
      this.metrics.get(label)!.push(duration);

      // Send to CloudWatch (async, non-blocking)
      if (this.enabled && this.cloudwatch) {
        this.sendMetricToCloudWatch({
          name: label,
          value: duration,
          unit: 'Milliseconds',
          timestamp: new Date(),
          dimensions,
        }).catch((error) => {
          logger.warn('Failed to send metric to CloudWatch', {
            error: error.message,
          });
        });
      }

      // Log if duration exceeds threshold
      if (duration > 1000) {
        logger.warn('Slow operation detected', {
          operation: label,
          duration: `${duration.toFixed(2)}ms`,
        });
      }
    };
  }

  /**
   * Record a custom metric
   */
  public recordMetric(
    name: string,
    value: number,
    unit: PerformanceMetric['unit'] = 'Count',
    dimensions?: Record<string, string>
  ): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(value);

    if (this.enabled && this.cloudwatch) {
      this.sendMetricToCloudWatch({
        name,
        value,
        unit,
        timestamp: new Date(),
        dimensions,
      }).catch((error) => {
        logger.warn('Failed to send custom metric', {
          error: error.message,
        });
      });
    }
  }

  /**
   * Get statistics for a metric
   */
  public getStats(label: string): PerformanceStats | null {
    const values = this.metrics.get(label);
    if (!values || values.length === 0) {
      return null;
    }

    const sorted = values.slice().sort((a, b) => a - b);

    return {
      count: values.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: values.reduce((sum, val) => sum + val, 0) / values.length,
      p50: this.percentile(sorted, 50),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
    };
  }

  /**
   * Get all metrics summary
   */
  public getSummary(): Record<string, PerformanceStats> {
    const summary: Record<string, PerformanceStats> = {};

    for (const [label, _] of this.metrics.entries()) {
      const stats = this.getStats(label);
      if (stats) {
        summary[label] = stats;
      }
    }

    return summary;
  }

  /**
   * Clear all metrics
   */
  public clear(): void {
    this.metrics.clear();
  }

  /**
   * Calculate percentile
   */
  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;

    const index = Math.ceil((sortedValues.length * p) / 100) - 1;
    return sortedValues[Math.max(0, index)];
  }

  /**
   * Send metric to CloudWatch
   */
  private async sendMetricToCloudWatch(
    metric: PerformanceMetric & { dimensions?: Record<string, string> }
  ): Promise<void> {
    if (!this.cloudwatch) return;

    try {
      const command = new PutMetricDataCommand({
        Namespace: this.namespace,
        MetricData: [
          {
            MetricName: metric.name,
            Value: metric.value,
            Unit: metric.unit,
            Timestamp: metric.timestamp,
            Dimensions: metric.dimensions
              ? Object.entries(metric.dimensions).map(([Name, Value]) => ({
                  Name,
                  Value,
                }))
              : undefined,
          },
        ],
      });

      await this.cloudwatch.send(command);
    } catch (error: any) {
      // Fail silently to not impact application performance
      logger.debug('CloudWatch metric send failed', {
        error: error.message,
      });
    }
  }

  /**
   * Track memory usage
   */
  public trackMemoryUsage(label: string = 'memory_usage'): void {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const usage = process.memoryUsage();

      this.recordMetric(
        `${label}_heap_used`,
        usage.heapUsed,
        'Bytes'
      );

      this.recordMetric(
        `${label}_heap_total`,
        usage.heapTotal,
        'Bytes'
      );

      this.recordMetric(
        `${label}_external`,
        usage.external,
        'Bytes'
      );

      this.recordMetric(
        `${label}_rss`,
        usage.rss,
        'Bytes'
      );

      // Calculate heap usage percentage
      const heapPercent = (usage.heapUsed / usage.heapTotal) * 100;
      this.recordMetric(
        `${label}_heap_percent`,
        heapPercent,
        'Percent'
      );

      // Warn if heap usage is high
      if (heapPercent > 80) {
        logger.warn('High heap usage detected', {
          heapPercent: `${heapPercent.toFixed(2)}%`,
          heapUsed: `${(usage.heapUsed / 1024 / 1024).toFixed(2)}MB`,
          heapTotal: `${(usage.heapTotal / 1024 / 1024).toFixed(2)}MB`,
        });
      }
    }
  }

  /**
   * Create a timing decorator for async functions
   */
  public static createTimingDecorator(label: string) {
    const monitor = new PerformanceMonitor();

    return function (
      _target: any,
      propertyKey: string,
      descriptor: PropertyDescriptor
    ) {
      const originalMethod = descriptor.value;

      descriptor.value = async function (...args: any[]) {
        const endTimer = monitor.startTimer(`${label}_${propertyKey}`);

        try {
          const result = await originalMethod.apply(this, args);
          return result;
        } finally {
          endTimer();
        }
      };

      return descriptor;
    };
  }
}

/**
 * Global singleton instance
 */
export const globalMonitor = new PerformanceMonitor();

/**
 * Middleware for Lambda handler performance tracking
 */
export function withPerformanceTracking<T extends (...args: any[]) => any>(
  handler: T,
  handlerName: string = 'lambda_handler'
): T {
  return (async (...args: any[]) => {
    const monitor = new PerformanceMonitor();
    const endTimer = monitor.startTimer(handlerName);

    // Track initial memory
    monitor.trackMemoryUsage('handler_start');

    try {
      const result = await handler(...args);

      // Track final memory
      monitor.trackMemoryUsage('handler_end');

      // Log performance summary
      const stats = monitor.getStats(handlerName);
      if (stats) {
        logger.info('Handler performance', {
          duration: `${stats.avg.toFixed(2)}ms`,
          count: stats.count,
        });
      }

      return result;
    } catch (error) {
      logger.error('Handler error', { error });
      monitor.recordMetric('handler_errors', 1);
      throw error;
    } finally {
      endTimer();
    }
  }) as T;
}

/**
 * Usage example:
 *
 * import { PerformanceMonitor, withPerformanceTracking } from './utils/performance-monitor';
 *
 * // Wrap Lambda handler
 * export const handler = withPerformanceTracking(
 *   async (event, context) => {
 *     const monitor = new PerformanceMonitor();
 *
 *     // Track OpenSearch query
 *     const endTimer = monitor.startTimer('opensearch_query');
 *     const results = await searchDocuments(query);
 *     endTimer();
 *
 *     // Track custom metric
 *     monitor.recordMetric('search_results_count', results.length);
 *
 *     // Get performance stats
 *     const stats = monitor.getSummary();
 *     console.log('Performance Summary:', stats);
 *
 *     return results;
 *   },
 *   'search_api_handler'
 * );
 */
