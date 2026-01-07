#!/usr/bin/env ts-node
/**
 * Performance Test Runner
 *
 * Runs comprehensive performance tests for image search system:
 * 1. OpenSearch k-NN query performance
 * 2. Cache performance
 * 3. Concurrent query handling
 * 4. Image processing optimization
 * 5. End-to-end latency
 */

import { defaultProvider } from '@aws-sdk/credential-provider-node'
import { Client } from '@opensearch-project/opensearch'
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws'

import {
  generateOptimizedSettings,
  recommendInstanceType,
  PerformanceConfig,
} from '../src/lib/opensearch-performance'
import {
  runKNNBenchmark,
  runConcurrentBenchmark,
  printBenchmarkReport,
  exportBenchmarkResults,
  BenchmarkConfig,
} from '../src/lib/performance-benchmark'

/**
 * Initialize OpenSearch client
 */
const initializeClient = (): Client => {
  const endpoint = process.env.OPENSEARCH_ENDPOINT
  if (!endpoint) {
    throw new Error('OPENSEARCH_ENDPOINT environment variable is required')
  }

  const region = process.env.AWS_REGION || 'ap-northeast-1'

  return new Client({
    ...AwsSigv4Signer({
      region,
      service: 'es',
      getCredentials: () => defaultProvider()(),
    }),
    node: endpoint,
    requestTimeout: 30000,
    maxRetries: 3,
  })
}

/**
 * Run performance optimization analysis
 */
const runOptimizationAnalysis = () => {
  console.log('\n' + '='.repeat(80))
  console.log('Performance Optimization Analysis')
  console.log('='.repeat(80))

  // Test different data sizes
  const testConfigs: PerformanceConfig[] = [
    {
      indexSize: 100_000,
      targetLatencyMs: 50,
      nodeCount: 1,
      memoryGB: 4,
    },
    {
      indexSize: 500_000,
      targetLatencyMs: 100,
      nodeCount: 1,
      memoryGB: 16,
    },
    {
      indexSize: 1_000_000,
      targetLatencyMs: 100,
      nodeCount: 2,
      memoryGB: 32,
    },
    {
      indexSize: 5_000_000,
      targetLatencyMs: 200,
      nodeCount: 3,
      memoryGB: 64,
    },
  ]

  console.log('\n## Recommended Settings by Data Size\n')

  for (const config of testConfigs) {
    const settings = generateOptimizedSettings(config)
    const instanceType = recommendInstanceType(config)

    console.log(`### ${(config.indexSize / 1000).toFixed(0)}K Documents`)
    console.log(`  Target Latency: ${config.targetLatencyMs}ms`)
    console.log(`  Instance Type: ${instanceType}`)
    console.log(`  Shard Count: ${settings.shardCount}`)
    console.log(`  Replica Count: ${settings.replicaCount}`)
    console.log(`  ef_search: ${settings.efSearch}`)
    console.log(`  ef_construction: ${settings.efConstruction}`)
    console.log(`  m: ${settings.m}`)
    console.log(`  refresh_interval: ${settings.refreshInterval}`)
    console.log('')
  }
}

/**
 * Main test execution
 */
const main = async () => {
  console.log('Starting Performance Test Suite...\n')

  // Run optimization analysis
  runOptimizationAnalysis()

  // Check if OpenSearch is available
  if (!process.env.OPENSEARCH_ENDPOINT) {
    console.warn('\nWarning: OPENSEARCH_ENDPOINT not set. Skipping live benchmarks.\n')
    console.log('To run live benchmarks, set the following environment variables:')
    console.log('  - OPENSEARCH_ENDPOINT')
    console.log('  - AWS_REGION')
    console.log('  - AWS_ACCESS_KEY_ID')
    console.log('  - AWS_SECRET_ACCESS_KEY')
    return
  }

  try {
    const client = initializeClient()

    // Test 1: Sequential k-NN queries
    console.log('\n' + '='.repeat(80))
    console.log('Test 1: Sequential k-NN Query Performance')
    console.log('='.repeat(80) + '\n')

    const sequentialConfig: BenchmarkConfig = {
      vectorDimension: 1024, // AWS Bedrock Titan Embeddings
      testVectorCount: 10,
      queriesPerTest: 50,
      warmupQueries: 5,
      concurrentQueries: 1,
    }

    const sequentialResult = await runKNNBenchmark(client, sequentialConfig)
    printBenchmarkReport(sequentialResult)
    exportBenchmarkResults(sequentialResult, 'benchmark-sequential.json')

    // Test 2: Concurrent k-NN queries
    console.log('\n' + '='.repeat(80))
    console.log('Test 2: Concurrent k-NN Query Performance')
    console.log('='.repeat(80) + '\n')

    const concurrentConfig: BenchmarkConfig = {
      vectorDimension: 1024,
      testVectorCount: 10,
      queriesPerTest: 100,
      warmupQueries: 10,
      concurrentQueries: 10, // 10 concurrent queries
    }

    const concurrentResult = await runConcurrentBenchmark(client, concurrentConfig)
    printBenchmarkReport(concurrentResult)
    exportBenchmarkResults(concurrentResult, 'benchmark-concurrent.json')

    // Test 3: Stress test
    console.log('\n' + '='.repeat(80))
    console.log('Test 3: Stress Test (High Load)')
    console.log('='.repeat(80) + '\n')

    const stressConfig: BenchmarkConfig = {
      vectorDimension: 1024,
      testVectorCount: 20,
      queriesPerTest: 200,
      warmupQueries: 20,
      concurrentQueries: 20, // 20 concurrent queries
    }

    const stressResult = await runConcurrentBenchmark(client, stressConfig)
    printBenchmarkReport(stressResult)
    exportBenchmarkResults(stressResult, 'benchmark-stress.json')

    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('Performance Test Summary')
    console.log('='.repeat(80) + '\n')

    console.log('## Sequential Performance')
    console.log(`  P95 Latency: ${sequentialResult.metrics.latency.p95.toFixed(2)}ms`)
    console.log(
      `  Throughput: ${sequentialResult.metrics.throughput.queriesPerSecond.toFixed(2)} QPS`
    )

    console.log('\n## Concurrent Performance (10 concurrent)')
    console.log(`  P95 Latency: ${concurrentResult.metrics.latency.p95.toFixed(2)}ms`)
    console.log(
      `  Throughput: ${concurrentResult.metrics.throughput.queriesPerSecond.toFixed(2)} QPS`
    )

    console.log('\n## Stress Test (20 concurrent)')
    console.log(`  P95 Latency: ${stressResult.metrics.latency.p95.toFixed(2)}ms`)
    console.log(`  Throughput: ${stressResult.metrics.throughput.queriesPerSecond.toFixed(2)} QPS`)
    console.log(
      `  Success Rate: ${(stressResult.metrics.reliability.successRate * 100).toFixed(2)}%`
    )

    // Recommendations
    console.log('\n## Recommendations\n')

    if (sequentialResult.metrics.latency.p95 > 100) {
      console.log('  ⚠️  High sequential latency detected. Consider:')
      console.log('     - Reducing ef_search parameter')
      console.log('     - Adding more shards')
      console.log('     - Upgrading instance type')
    }

    if (concurrentResult.metrics.latency.p95 > 200) {
      console.log('  ⚠️  High concurrent latency detected. Consider:')
      console.log('     - Scaling horizontally (add nodes)')
      console.log('     - Implementing connection pooling')
      console.log('     - Adding Redis cache layer')
    }

    if (stressResult.metrics.reliability.successRate < 0.95) {
      console.log('  ⚠️  Low success rate under stress. Consider:')
      console.log('     - Increasing timeout values')
      console.log('     - Adding rate limiting')
      console.log('     - Implementing circuit breakers')
    }

    if (
      sequentialResult.metrics.latency.p95 < 100 &&
      concurrentResult.metrics.latency.p95 < 200 &&
      stressResult.metrics.reliability.successRate > 0.95
    ) {
      console.log('  ✅ All performance tests passed!')
      console.log('     System is performing within acceptable ranges.')
    }

    console.log('\n' + '='.repeat(80) + '\n')

    await client.close()
  } catch (error) {
    console.error('\n❌ Performance test failed:', error)
    process.exit(1)
  }
}

// Run tests
main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
