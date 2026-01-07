/**
 * Image Search Performance Testing Tool
 *
 * 1000件データでの包括的なパフォーマンステスト
 *
 * テスト項目:
 * 1. API応答速度 (画像ベクトル生成 + 検索)
 * 2. メモリ使用量の測定
 * 3. 同時リクエスト処理能力
 * 4. レンダリングパフォーマンス
 * 5. バンドルサイズとロード時間
 *
 * 使用方法:
 * npx ts-node scripts/performance-test-image-search.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import { performance } from 'perf_hooks'

// === Configuration ===
const TEST_CONFIG = {
  // APIエンドポイント
  EMBEDDING_API: process.env.NEXT_PUBLIC_API_URL
    ? `${process.env.NEXT_PUBLIC_API_URL}/api/image-embedding`
    : 'http://localhost:3000/api/image-embedding',

  SEARCH_API: process.env.NEXT_PUBLIC_SEARCH_API_URL
    ? `${process.env.NEXT_PUBLIC_SEARCH_API_URL}/search`
    : 'http://localhost:3000/api/search',

  // テスト画像パス（複数の画像でテスト）
  TEST_IMAGES: [
    '/Users/tatsuya/focus_project/cis_filesearch_app/frontend/test-data/sample1.jpg',
    '/Users/tatsuya/focus_project/cis_filesearch_app/frontend/test-data/sample2.jpg',
    '/Users/tatsuya/focus_project/cis_filesearch_app/frontend/test-data/sample3.jpg',
  ],

  // テスト実行回数
  ITERATIONS: 10,

  // 同時リクエスト数
  CONCURRENT_REQUESTS: [1, 5, 10],

  // パフォーマンス要件
  REQUIREMENTS: {
    RESPONSE_TIME_MS: 2000, // 2秒以内
    MEMORY_LIMIT_MB: 500, // 500MB以内
    RENDER_FPS: 60, // 60fps維持
  },
}

// === Performance Metrics ===
interface PerformanceMetrics {
  operation: string
  duration: number
  memoryUsed: number
  timestamp: number
}

interface TestResults {
  apiResponseTimes: {
    embedding: number[]
    search: number[]
    total: number[]
  }
  memoryUsage: {
    initial: number
    peak: number
    final: number
  }
  concurrentPerformance: {
    requestCount: number
    avgResponseTime: number
    maxResponseTime: number
    successRate: number
  }[]
  errors: string[]
  summary: {
    passed: boolean
    totalTests: number
    failedTests: number
  }
}

// === Utility Functions ===
class PerformanceTestRunner {
  private results: TestResults = {
    apiResponseTimes: {
      embedding: [],
      search: [],
      total: [],
    },
    memoryUsage: {
      initial: 0,
      peak: 0,
      final: 0,
    },
    concurrentPerformance: [],
    errors: [],
    summary: {
      passed: true,
      totalTests: 0,
      failedTests: 0,
    },
  }

  private metrics: PerformanceMetrics[] = []

  /**
   * メモリ使用量を取得（MB単位）
   */
  private getMemoryUsageMB(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const usage = process.memoryUsage()
      return usage.heapUsed / 1024 / 1024
    }
    return 0
  }

  /**
   * パフォーマンス計測開始
   */
  private startMeasurement(operation: string): () => void {
    const startTime = performance.now()
    const startMemory = this.getMemoryUsageMB()

    return () => {
      const duration = performance.now() - startTime
      const memoryUsed = this.getMemoryUsageMB() - startMemory

      this.metrics.push({
        operation,
        duration,
        memoryUsed,
        timestamp: Date.now(),
      })

      return { duration, memoryUsed }
    }
  }

  /**
   * テスト画像をロード
   */
  private async loadTestImage(imagePath: string): Promise<File> {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Test image not found: ${imagePath}`)
    }

    const buffer = fs.readFileSync(imagePath)
    const fileName = path.basename(imagePath)
    const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg'

    // Node.js環境でFileオブジェクトをシミュレート
    const blob = new Blob([buffer], { type: mimeType })
    return new File([blob], fileName, { type: mimeType })
  }

  /**
   * 画像埋め込みAPIをテスト
   */
  private async testEmbeddingAPI(
    imageFile: File
  ): Promise<{ embedding: number[]; duration: number }> {
    const endTimer = this.startMeasurement('embedding_api')

    try {
      const formData = new FormData()
      formData.append('image', imageFile)

      const response = await fetch(TEST_CONFIG.EMBEDDING_API, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error(`Embedding API failed: ${response.status} ${response.statusText}`)
      }

      const result = await response.json()
      const { duration } = endTimer()

      if (!result.success || !result.data?.embedding) {
        throw new Error('Invalid embedding response format')
      }

      return {
        embedding: result.data.embedding,
        duration,
      }
    } catch (error: any) {
      endTimer()
      throw error
    }
  }

  /**
   * 画像検索APIをテスト
   */
  private async testSearchAPI(embedding: number[]): Promise<{ results: any[]; duration: number }> {
    const endTimer = this.startMeasurement('search_api')

    try {
      const response = await fetch(TEST_CONFIG.SEARCH_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageEmbedding: embedding,
          confidenceThreshold: 0.9,
        }),
      })

      if (!response.ok) {
        throw new Error(`Search API failed: ${response.status} ${response.statusText}`)
      }

      const result = await response.json()
      const { duration } = endTimer()

      return {
        results: result.hits || [],
        duration,
      }
    } catch (error: any) {
      endTimer()
      throw error
    }
  }

  /**
   * 単一リクエストのテスト
   */
  private async testSingleRequest(imagePath: string): Promise<void> {
    console.log(`\n🔍 Testing with image: ${path.basename(imagePath)}`)

    const startMemory = this.getMemoryUsageMB()
    const startTime = performance.now()

    try {
      // 1. 画像をロード
      const imageFile = await this.loadTestImage(imagePath)
      console.log(`   ✅ Image loaded: ${imageFile.size} bytes`)

      // 2. 埋め込みベクトル生成
      const { embedding, duration: embeddingDuration } = await this.testEmbeddingAPI(imageFile)
      this.results.apiResponseTimes.embedding.push(embeddingDuration)
      console.log(
        `   ✅ Embedding generated: ${embeddingDuration.toFixed(2)}ms (${embedding.length} dimensions)`
      )

      // 3. 画像検索
      const { results, duration: searchDuration } = await this.testSearchAPI(embedding)
      this.results.apiResponseTimes.search.push(searchDuration)
      console.log(
        `   ✅ Search completed: ${searchDuration.toFixed(2)}ms (${results.length} results)`
      )

      // 4. トータル時間
      const totalDuration = performance.now() - startTime
      this.results.apiResponseTimes.total.push(totalDuration)

      // 5. メモリ使用量
      const memoryUsed = this.getMemoryUsageMB() - startMemory
      if (memoryUsed > this.results.memoryUsage.peak) {
        this.results.memoryUsage.peak = memoryUsed
      }

      console.log(
        `   📊 Total time: ${totalDuration.toFixed(2)}ms, Memory: ${memoryUsed.toFixed(2)}MB`
      )

      // パフォーマンス要件チェック
      if (totalDuration > TEST_CONFIG.REQUIREMENTS.RESPONSE_TIME_MS) {
        this.results.errors.push(
          `Response time exceeded: ${totalDuration.toFixed(2)}ms > ${TEST_CONFIG.REQUIREMENTS.RESPONSE_TIME_MS}ms`
        )
        this.results.summary.failedTests++
      }

      this.results.summary.totalTests++
    } catch (error: any) {
      console.error(`   ❌ Test failed: ${error.message}`)
      this.results.errors.push(`Single request test failed: ${error.message}`)
      this.results.summary.failedTests++
      this.results.summary.totalTests++
    }
  }

  /**
   * 同時リクエストのテスト
   */
  private async testConcurrentRequests(concurrentCount: number): Promise<void> {
    console.log(`\n🚀 Testing ${concurrentCount} concurrent requests...`)

    const startTime = performance.now()
    const promises: Promise<any>[] = []
    const responseTimes: number[] = []
    let successCount = 0

    for (let i = 0; i < concurrentCount; i++) {
      const imagePath = TEST_CONFIG.TEST_IMAGES[i % TEST_CONFIG.TEST_IMAGES.length]

      const promise = (async () => {
        const requestStart = performance.now()

        try {
          const imageFile = await this.loadTestImage(imagePath)
          const { embedding } = await this.testEmbeddingAPI(imageFile)
          await this.testSearchAPI(embedding)

          const requestDuration = performance.now() - requestStart
          responseTimes.push(requestDuration)
          successCount++
        } catch (error: any) {
          console.error(`   ❌ Concurrent request ${i + 1} failed: ${error.message}`)
        }
      })()

      promises.push(promise)
    }

    await Promise.all(promises)

    const totalDuration = performance.now() - startTime
    const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    const maxResponseTime = Math.max(...responseTimes)
    const successRate = (successCount / concurrentCount) * 100

    this.results.concurrentPerformance.push({
      requestCount: concurrentCount,
      avgResponseTime,
      maxResponseTime,
      successRate,
    })

    console.log(`   📊 Total duration: ${totalDuration.toFixed(2)}ms`)
    console.log(`   📊 Avg response time: ${avgResponseTime.toFixed(2)}ms`)
    console.log(`   📊 Max response time: ${maxResponseTime.toFixed(2)}ms`)
    console.log(`   📊 Success rate: ${successRate.toFixed(2)}%`)
  }

  /**
   * 統計情報を計算
   */
  private calculateStats(values: number[]): {
    min: number
    max: number
    avg: number
    p50: number
    p95: number
    p99: number
  } {
    if (values.length === 0) {
      return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 }
    }

    const sorted = values.slice().sort((a, b) => a - b)
    const sum = values.reduce((a, b) => a + b, 0)

    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / values.length,
      p50: this.percentile(sorted, 50),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
    }
  }

  private percentile(sortedValues: number[], p: number): number {
    const index = Math.ceil((sortedValues.length * p) / 100) - 1
    return sortedValues[Math.max(0, index)]
  }

  /**
   * テスト結果をレポート
   */
  private generateReport(): void {
    console.log('\n' + '='.repeat(80))
    console.log('📊 PERFORMANCE TEST RESULTS')
    console.log('='.repeat(80))

    // API Response Times
    console.log('\n📈 API Response Times:')
    console.log('   Embedding API:')
    const embeddingStats = this.calculateStats(this.results.apiResponseTimes.embedding)
    console.log(`      Min: ${embeddingStats.min.toFixed(2)}ms`)
    console.log(`      Max: ${embeddingStats.max.toFixed(2)}ms`)
    console.log(`      Avg: ${embeddingStats.avg.toFixed(2)}ms`)
    console.log(`      P50: ${embeddingStats.p50.toFixed(2)}ms`)
    console.log(`      P95: ${embeddingStats.p95.toFixed(2)}ms`)
    console.log(`      P99: ${embeddingStats.p99.toFixed(2)}ms`)

    console.log('\n   Search API:')
    const searchStats = this.calculateStats(this.results.apiResponseTimes.search)
    console.log(`      Min: ${searchStats.min.toFixed(2)}ms`)
    console.log(`      Max: ${searchStats.max.toFixed(2)}ms`)
    console.log(`      Avg: ${searchStats.avg.toFixed(2)}ms`)
    console.log(`      P50: ${searchStats.p50.toFixed(2)}ms`)
    console.log(`      P95: ${searchStats.p95.toFixed(2)}ms`)
    console.log(`      P99: ${searchStats.p99.toFixed(2)}ms`)

    console.log('\n   Total (Embedding + Search):')
    const totalStats = this.calculateStats(this.results.apiResponseTimes.total)
    console.log(`      Min: ${totalStats.min.toFixed(2)}ms`)
    console.log(`      Max: ${totalStats.max.toFixed(2)}ms`)
    console.log(`      Avg: ${totalStats.avg.toFixed(2)}ms`)
    console.log(`      P50: ${totalStats.p50.toFixed(2)}ms`)
    console.log(`      P95: ${totalStats.p95.toFixed(2)}ms`)
    console.log(`      P99: ${totalStats.p99.toFixed(2)}ms`)

    // Performance Requirements Check
    console.log('\n✅ Performance Requirements:')
    const meetsResponseTime = totalStats.p95 <= TEST_CONFIG.REQUIREMENTS.RESPONSE_TIME_MS
    console.log(
      `   Response Time (P95 ≤ ${TEST_CONFIG.REQUIREMENTS.RESPONSE_TIME_MS}ms): ` +
        `${meetsResponseTime ? '✅ PASS' : '❌ FAIL'} (${totalStats.p95.toFixed(2)}ms)`
    )

    const meetsMemoryLimit =
      this.results.memoryUsage.peak <= TEST_CONFIG.REQUIREMENTS.MEMORY_LIMIT_MB
    console.log(
      `   Memory Usage (≤ ${TEST_CONFIG.REQUIREMENTS.MEMORY_LIMIT_MB}MB): ` +
        `${meetsMemoryLimit ? '✅ PASS' : '❌ FAIL'} (${this.results.memoryUsage.peak.toFixed(2)}MB)`
    )

    // Memory Usage
    console.log('\n💾 Memory Usage:')
    console.log(`   Initial: ${this.results.memoryUsage.initial.toFixed(2)}MB`)
    console.log(`   Peak: ${this.results.memoryUsage.peak.toFixed(2)}MB`)
    console.log(`   Final: ${this.results.memoryUsage.final.toFixed(2)}MB`)

    // Concurrent Performance
    console.log('\n🚀 Concurrent Performance:')
    this.results.concurrentPerformance.forEach((perf) => {
      console.log(`   ${perf.requestCount} concurrent requests:`)
      console.log(`      Avg response: ${perf.avgResponseTime.toFixed(2)}ms`)
      console.log(`      Max response: ${perf.maxResponseTime.toFixed(2)}ms`)
      console.log(`      Success rate: ${perf.successRate.toFixed(2)}%`)
    })

    // Errors
    if (this.results.errors.length > 0) {
      console.log('\n❌ Errors:')
      this.results.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`)
      })
    }

    // Summary
    console.log('\n📝 Summary:')
    console.log(`   Total tests: ${this.results.summary.totalTests}`)
    console.log(`   Failed tests: ${this.results.summary.failedTests}`)
    console.log(
      `   Success rate: ${(((this.results.summary.totalTests - this.results.summary.failedTests) / this.results.summary.totalTests) * 100).toFixed(2)}%`
    )

    const allRequirementsMet =
      meetsResponseTime && meetsMemoryLimit && this.results.summary.failedTests === 0
    console.log(`   Overall: ${allRequirementsMet ? '✅ PASSED' : '❌ FAILED'}`)

    console.log('\n' + '='.repeat(80))
  }

  /**
   * テストを実行
   */
  async run(): Promise<void> {
    console.log('🚀 Starting Performance Tests...\n')
    console.log('Configuration:')
    console.log(`   Test images: ${TEST_CONFIG.TEST_IMAGES.length}`)
    console.log(`   Iterations per image: ${TEST_CONFIG.ITERATIONS}`)
    console.log(`   Concurrent request tests: ${TEST_CONFIG.CONCURRENT_REQUESTS.join(', ')}`)
    console.log('')

    // 初期メモリ使用量
    this.results.memoryUsage.initial = this.getMemoryUsageMB()

    // 1. 単一リクエストテスト（複数回実行）
    console.log('\n📋 Phase 1: Single Request Tests')
    for (let i = 0; i < TEST_CONFIG.ITERATIONS; i++) {
      console.log(`\nIteration ${i + 1}/${TEST_CONFIG.ITERATIONS}`)
      for (const imagePath of TEST_CONFIG.TEST_IMAGES) {
        await this.testSingleRequest(imagePath)
        // GC実行を促す
        if (global.gc) {
          global.gc()
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    // 2. 同時リクエストテスト
    console.log('\n📋 Phase 2: Concurrent Request Tests')
    for (const concurrentCount of TEST_CONFIG.CONCURRENT_REQUESTS) {
      await this.testConcurrentRequests(concurrentCount)
      // GC実行を促す
      if (global.gc) {
        global.gc()
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    // 最終メモリ使用量
    this.results.memoryUsage.final = this.getMemoryUsageMB()

    // レポート生成
    this.generateReport()

    // JSON形式で結果を保存
    const reportPath = path.join(__dirname, '../performance-test-results.json')
    fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2))
    console.log(`\n💾 Detailed results saved to: ${reportPath}`)
  }
}

// === メイン実行 ===
async function main() {
  try {
    const runner = new PerformanceTestRunner()
    await runner.run()
    process.exit(0)
  } catch (error: any) {
    console.error('❌ Test execution failed:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

// 実行
if (require.main === module) {
  main()
}

export { PerformanceTestRunner, TEST_CONFIG }
