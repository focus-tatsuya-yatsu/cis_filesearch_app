/**
 * Performance Benchmark and Monitoring Module
 *
 * Features:
 * - Query latency tracking
 * - Throughput measurement
 * - Cache performance monitoring
 * - Resource utilization tracking
 * - Automated performance reports
 */

import { Client } from '@opensearch-project/opensearch'

import { buildOptimizedKNNQuery } from './opensearch-performance'

/**
 * Benchmark configuration
 */
export interface BenchmarkConfig {
  vectorDimension: number
  testVectorCount: number
  queriesPerTest: number
  warmupQueries: number
  concurrentQueries: number
}

/**
 * Query performance metrics
 */
export interface QueryMetrics {
  queryId: string
  timestamp: number
  latencyMs: number
  resultCount: number
  cacheHit: boolean
  error?: string
}

/**
 * Benchmark result
 */
export interface BenchmarkResult {
  config: BenchmarkConfig
  startTime: number
  endTime: number
  totalDuration: number
  metrics: {
    latency: {
      min: number
      max: number
      mean: number
      median: number
      p95: number
      p99: number
      stdDev: number
    }
    throughput: {
      queriesPerSecond: number
      avgQueryTime: number
    }
    cache: {
      hitRate: number
      totalHits: number
      totalMisses: number
    }
    reliability: {
      successRate: number
      errorCount: number
      errorRate: number
    }
  }
  queries: QueryMetrics[]
}

/**
 * Performance monitor class
 */
export class PerformanceMonitor {
  private queries: QueryMetrics[] = []
  private startTime: number = 0

  /**
   * Start monitoring session
   */
  start(): void {
    this.startTime = Date.now()
    this.queries = []
  }

  /**
   * Record a query
   */
  recordQuery(metrics: QueryMetrics): void {
    this.queries.push(metrics)
  }

  /**
   * Calculate statistics
   */
  calculateStats(): BenchmarkResult['metrics'] {
    const latencies = this.queries.filter((q) => !q.error).map((q) => q.latencyMs)

    const sortedLatencies = [...latencies].sort((a, b) => a - b)

    const cacheHits = this.queries.filter((q) => q.cacheHit).length
    const cacheMisses = this.queries.length - cacheHits
    const errors = this.queries.filter((q) => q.error).length

    const mean = latencies.reduce((sum, l) => sum + l, 0) / latencies.length
    const variance = latencies.reduce((sum, l) => sum + Math.pow(l - mean, 2), 0) / latencies.length
    const stdDev = Math.sqrt(variance)

    const duration = (Date.now() - this.startTime) / 1000 // seconds

    return {
      latency: {
        min: Math.min(...latencies),
        max: Math.max(...latencies),
        mean,
        median: sortedLatencies[Math.floor(sortedLatencies.length * 0.5)],
        p95: sortedLatencies[Math.floor(sortedLatencies.length * 0.95)],
        p99: sortedLatencies[Math.floor(sortedLatencies.length * 0.99)],
        stdDev,
      },
      throughput: {
        queriesPerSecond: this.queries.length / duration,
        avgQueryTime: mean,
      },
      cache: {
        hitRate: cacheHits / this.queries.length,
        totalHits: cacheHits,
        totalMisses: cacheMisses,
      },
      reliability: {
        successRate: (this.queries.length - errors) / this.queries.length,
        errorCount: errors,
        errorRate: errors / this.queries.length,
      },
    }
  }

  /**
   * Get all recorded queries
   */
  getQueries(): QueryMetrics[] {
    return this.queries
  }

  /**
   * Clear all data
   */
  reset(): void {
    this.queries = []
    this.startTime = 0
  }
}

/**
 * Generate random test vector
 *
 * @param dimension - Vector dimension
 * @returns Random normalized vector
 */
export const generateTestVector = (dimension: number): number[] => {
  const vector = Array.from({ length: dimension }, () => Math.random() * 2 - 1)

  // Normalize vector
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
  return vector.map((v) => v / magnitude)
}

/**
 * Run k-NN search benchmark
 *
 * @param client - OpenSearch client
 * @param config - Benchmark configuration
 * @returns Benchmark result
 */
export const runKNNBenchmark = async (
  client: Client,
  config: BenchmarkConfig
): Promise<BenchmarkResult> => {
  const monitor = new PerformanceMonitor()
  monitor.start()

  const startTime = Date.now()

  // Generate test vectors
  const testVectors = Array.from({ length: config.testVectorCount }, () =>
    generateTestVector(config.vectorDimension)
  )

  console.log(`[Benchmark] Generated ${config.testVectorCount} test vectors`)

  // Warmup phase
  console.log(`[Benchmark] Running ${config.warmupQueries} warmup queries...`)
  for (let i = 0; i < config.warmupQueries; i++) {
    const vector = testVectors[i % testVectors.length]
    try {
      await executeKNNQuery(client, vector)
    } catch (error) {
      console.error('[Benchmark] Warmup query failed:', error)
    }
  }

  console.log('[Benchmark] Warmup complete, starting benchmark...')

  // Main benchmark
  for (let i = 0; i < config.queriesPerTest; i++) {
    const vector = testVectors[i % testVectors.length]
    const queryId = `query-${i}`

    const queryStart = Date.now()
    try {
      const result = await executeKNNQuery(client, vector)
      const latencyMs = Date.now() - queryStart

      monitor.recordQuery({
        queryId,
        timestamp: Date.now(),
        latencyMs,
        resultCount: result.hits?.hits?.length || 0,
        cacheHit: false, // Would need to integrate with cache to detect
      })
    } catch (error) {
      const latencyMs = Date.now() - queryStart
      monitor.recordQuery({
        queryId,
        timestamp: Date.now(),
        latencyMs,
        resultCount: 0,
        cacheHit: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }

    // Progress update every 10 queries
    if ((i + 1) % 10 === 0) {
      console.log(`[Benchmark] Progress: ${i + 1}/${config.queriesPerTest}`)
    }
  }

  const endTime = Date.now()

  console.log('[Benchmark] Complete, calculating statistics...')

  const result: BenchmarkResult = {
    config,
    startTime,
    endTime,
    totalDuration: endTime - startTime,
    metrics: monitor.calculateStats(),
    queries: monitor.getQueries(),
  }

  return result
}

/**
 * Execute k-NN query
 */
const executeKNNQuery = async (client: Client, vector: number[]): Promise<any> => {
  const query = buildOptimizedKNNQuery(vector, { k: 20 })

  const response = await client.search({
    index: process.env.OPENSEARCH_INDEX || 'file-index',
    body: query,
  })

  return response.body
}

/**
 * Run concurrent queries benchmark
 *
 * @param client - OpenSearch client
 * @param config - Benchmark configuration
 * @returns Benchmark result
 */
export const runConcurrentBenchmark = async (
  client: Client,
  config: BenchmarkConfig
): Promise<BenchmarkResult> => {
  const monitor = new PerformanceMonitor()
  monitor.start()

  const startTime = Date.now()

  // Generate test vectors
  const testVectors = Array.from({ length: config.testVectorCount }, () =>
    generateTestVector(config.vectorDimension)
  )

  console.log(
    `[Concurrent Benchmark] Running ${config.queriesPerTest} queries with ${config.concurrentQueries} concurrent connections`
  )

  // Split queries into batches
  const batchSize = config.concurrentQueries
  const batches = Math.ceil(config.queriesPerTest / batchSize)

  for (let batch = 0; batch < batches; batch++) {
    const batchStart = batch * batchSize
    const batchEnd = Math.min(batchStart + batchSize, config.queriesPerTest)

    // Execute batch concurrently
    const promises = []
    for (let i = batchStart; i < batchEnd; i++) {
      const vector = testVectors[i % testVectors.length]
      const queryId = `query-${i}`

      const queryStart = Date.now()
      const promise = executeKNNQuery(client, vector)
        .then((result) => {
          const latencyMs = Date.now() - queryStart
          monitor.recordQuery({
            queryId,
            timestamp: Date.now(),
            latencyMs,
            resultCount: result.hits?.hits?.length || 0,
            cacheHit: false,
          })
        })
        .catch((error) => {
          const latencyMs = Date.now() - queryStart
          monitor.recordQuery({
            queryId,
            timestamp: Date.now(),
            latencyMs,
            resultCount: 0,
            cacheHit: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        })

      promises.push(promise)
    }

    await Promise.all(promises)

    console.log(`[Concurrent Benchmark] Batch ${batch + 1}/${batches} complete`)
  }

  const endTime = Date.now()

  const result: BenchmarkResult = {
    config,
    startTime,
    endTime,
    totalDuration: endTime - startTime,
    metrics: monitor.calculateStats(),
    queries: monitor.getQueries(),
  }

  return result
}

/**
 * Print benchmark report
 *
 * @param result - Benchmark result
 */
export const printBenchmarkReport = (result: BenchmarkResult): void => {
  console.log('\n' + '='.repeat(80))
  console.log('OpenSearch k-NN Performance Benchmark Report')
  console.log('='.repeat(80))

  console.log('\n## Configuration')
  console.log(`  Vector Dimension: ${result.config.vectorDimension}`)
  console.log(`  Test Vectors: ${result.config.testVectorCount}`)
  console.log(`  Total Queries: ${result.config.queriesPerTest}`)
  console.log(`  Warmup Queries: ${result.config.warmupQueries}`)
  console.log(`  Concurrent Queries: ${result.config.concurrentQueries}`)

  console.log('\n## Latency Metrics (ms)')
  console.log(`  Min:     ${result.metrics.latency.min.toFixed(2)}`)
  console.log(`  Max:     ${result.metrics.latency.max.toFixed(2)}`)
  console.log(`  Mean:    ${result.metrics.latency.mean.toFixed(2)}`)
  console.log(`  Median:  ${result.metrics.latency.median.toFixed(2)}`)
  console.log(`  P95:     ${result.metrics.latency.p95.toFixed(2)}`)
  console.log(`  P99:     ${result.metrics.latency.p99.toFixed(2)}`)
  console.log(`  Std Dev: ${result.metrics.latency.stdDev.toFixed(2)}`)

  console.log('\n## Throughput')
  console.log(`  Queries/Second: ${result.metrics.throughput.queriesPerSecond.toFixed(2)}`)
  console.log(`  Avg Query Time: ${result.metrics.throughput.avgQueryTime.toFixed(2)}ms`)

  console.log('\n## Cache Performance')
  console.log(`  Hit Rate:    ${(result.metrics.cache.hitRate * 100).toFixed(2)}%`)
  console.log(`  Total Hits:  ${result.metrics.cache.totalHits}`)
  console.log(`  Total Misses: ${result.metrics.cache.totalMisses}`)

  console.log('\n## Reliability')
  console.log(`  Success Rate: ${(result.metrics.reliability.successRate * 100).toFixed(2)}%`)
  console.log(`  Error Count:  ${result.metrics.reliability.errorCount}`)
  console.log(`  Error Rate:   ${(result.metrics.reliability.errorRate * 100).toFixed(2)}%`)

  console.log('\n## Summary')
  console.log(`  Total Duration: ${(result.totalDuration / 1000).toFixed(2)}s`)
  console.log(`  Start Time: ${new Date(result.startTime).toISOString()}`)
  console.log(`  End Time:   ${new Date(result.endTime).toISOString()}`)

  console.log('\n' + '='.repeat(80) + '\n')
}

/**
 * Export benchmark results to JSON
 *
 * @param result - Benchmark result
 * @param filename - Output filename
 */
export const exportBenchmarkResults = (
  result: BenchmarkResult,
  filename: string = 'benchmark-results.json'
): void => {
  const json = JSON.stringify(result, null, 2)

  if (typeof window !== 'undefined') {
    // Browser environment
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  } else {
    // Node.js environment
    const fs = require('fs')
    fs.writeFileSync(filename, json)
    console.log(`[Benchmark] Results exported to ${filename}`)
  }
}

/**
 * Compare two benchmark results
 *
 * @param baseline - Baseline benchmark result
 * @param current - Current benchmark result
 * @returns Comparison report
 */
export const compareBenchmarks = (
  baseline: BenchmarkResult,
  current: BenchmarkResult
): {
  latencyImprovement: number
  throughputImprovement: number
  cacheImprovement: number
  reliabilityImprovement: number
} => {
  const latencyImprovement =
    ((baseline.metrics.latency.p95 - current.metrics.latency.p95) / baseline.metrics.latency.p95) *
    100

  const throughputImprovement =
    ((current.metrics.throughput.queriesPerSecond - baseline.metrics.throughput.queriesPerSecond) /
      baseline.metrics.throughput.queriesPerSecond) *
    100

  const cacheImprovement =
    ((current.metrics.cache.hitRate - baseline.metrics.cache.hitRate) /
      (baseline.metrics.cache.hitRate || 0.01)) *
    100

  const reliabilityImprovement =
    ((current.metrics.reliability.successRate - baseline.metrics.reliability.successRate) /
      baseline.metrics.reliability.successRate) *
    100

  return {
    latencyImprovement,
    throughputImprovement,
    cacheImprovement,
    reliabilityImprovement,
  }
}
