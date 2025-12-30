/**
 * Image Search Performance Benchmark Tool
 * 画像検索機能のパフォーマンスベンチマーク
 *
 * Usage:
 * ts-node scripts/benchmark-image-search.ts
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Benchmark Configuration
 */
interface BenchmarkConfig {
  apiEndpoint: string;
  testImagesDir: string;
  iterations: number;
  concurrentRequests: number;
  warmupIterations: number;
}

/**
 * Benchmark Result
 */
interface BenchmarkResult {
  operation: string;
  iterations: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  p50Time: number;
  p95Time: number;
  p99Time: number;
  successRate: number;
  throughput: number;
}

/**
 * Test Result
 */
interface TestResult {
  success: boolean;
  duration: number;
  cached: boolean;
  error?: string;
}

/**
 * Default Configuration
 */
const DEFAULT_CONFIG: BenchmarkConfig = {
  apiEndpoint: process.env.NEXT_PUBLIC_API_GATEWAY_URL || 'http://localhost:3000/api',
  testImagesDir: './test-images',
  iterations: 100,
  concurrentRequests: 10,
  warmupIterations: 10,
};

/**
 * Benchmark Runner
 */
class ImageSearchBenchmark {
  private config: BenchmarkConfig;
  private testImages: string[] = [];

  constructor(config: Partial<BenchmarkConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize test images
   */
  async init(): Promise<void> {
    console.log('Initializing benchmark...');

    // Load test images
    if (!fs.existsSync(this.config.testImagesDir)) {
      throw new Error(`Test images directory not found: ${this.config.testImagesDir}`);
    }

    this.testImages = fs
      .readdirSync(this.config.testImagesDir)
      .filter((file) => /\.(jpg|jpeg|png)$/i.test(file))
      .map((file) => path.join(this.config.testImagesDir, file));

    if (this.testImages.length === 0) {
      throw new Error('No test images found');
    }

    console.log(`Loaded ${this.testImages.length} test images`);
  }

  /**
   * Run warmup iterations
   */
  async warmup(): Promise<void> {
    console.log(`Running ${this.config.warmupIterations} warmup iterations...`);

    for (let i = 0; i < this.config.warmupIterations; i++) {
      const imageIndex = i % this.testImages.length;
      await this.uploadAndSearch(this.testImages[imageIndex]);
    }

    console.log('Warmup completed');
  }

  /**
   * Upload image and perform search
   */
  async uploadAndSearch(imagePath: string): Promise<TestResult> {
    const startTime = Date.now();

    try {
      // Read image file
      const imageBuffer = fs.readFileSync(imagePath);

      // Upload to embedding API
      const formData = new FormData();
      const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
      formData.append('image', blob, path.basename(imagePath));

      const uploadResponse = await fetch(`${this.config.apiEndpoint}/image-embedding`, {
        method: 'POST',
        body: formData as any,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.statusText}`);
      }

      const uploadData = await uploadResponse.json();
      const embedding = uploadData.data.embedding;
      const cached = uploadData.performance?.cached || false;

      // Perform search
      const searchParams = new URLSearchParams({
        imageEmbedding: JSON.stringify(embedding),
        size: '20',
      });

      const searchResponse = await fetch(`${this.config.apiEndpoint}/search?${searchParams}`, {
        method: 'GET',
      });

      if (!searchResponse.ok) {
        throw new Error(`Search failed: ${searchResponse.statusText}`);
      }

      const duration = Date.now() - startTime;

      return {
        success: true,
        duration,
        cached,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;

      return {
        success: false,
        duration,
        cached: false,
        error: error.message,
      };
    }
  }

  /**
   * Run sequential benchmark
   */
  async runSequential(): Promise<BenchmarkResult> {
    console.log(`Running ${this.config.iterations} sequential requests...`);

    const results: TestResult[] = [];

    for (let i = 0; i < this.config.iterations; i++) {
      const imageIndex = i % this.testImages.length;
      const result = await this.uploadAndSearch(this.testImages[imageIndex]);
      results.push(result);

      if ((i + 1) % 10 === 0) {
        console.log(`Progress: ${i + 1}/${this.config.iterations}`);
      }
    }

    return this.calculateStats('Sequential Requests', results);
  }

  /**
   * Run concurrent benchmark
   */
  async runConcurrent(): Promise<BenchmarkResult> {
    console.log(
      `Running ${this.config.iterations} requests with ${this.config.concurrentRequests} concurrent connections...`
    );

    const results: TestResult[] = [];
    const batches = Math.ceil(this.config.iterations / this.config.concurrentRequests);

    for (let batch = 0; batch < batches; batch++) {
      const batchSize = Math.min(
        this.config.concurrentRequests,
        this.config.iterations - batch * this.config.concurrentRequests
      );

      const promises: Promise<TestResult>[] = [];

      for (let i = 0; i < batchSize; i++) {
        const imageIndex = (batch * this.config.concurrentRequests + i) % this.testImages.length;
        promises.push(this.uploadAndSearch(this.testImages[imageIndex]));
      }

      const batchResults = await Promise.all(promises);
      results.push(...batchResults);

      console.log(`Batch ${batch + 1}/${batches} completed`);
    }

    return this.calculateStats('Concurrent Requests', results);
  }

  /**
   * Calculate statistics
   */
  private calculateStats(operation: string, results: TestResult[]): BenchmarkResult {
    const successfulResults = results.filter((r) => r.success);
    const durations = successfulResults.map((r) => r.duration).sort((a, b) => a - b);

    const totalTime = results.reduce((sum, r) => sum + r.duration, 0);
    const averageTime = durations.reduce((sum, d) => sum + d, 0) / durations.length || 0;

    const percentile = (arr: number[], p: number) => {
      if (arr.length === 0) return 0;
      const index = Math.ceil((arr.length * p) / 100) - 1;
      return arr[Math.max(0, index)];
    };

    const successRate = (successfulResults.length / results.length) * 100;
    const throughput = (results.length / totalTime) * 1000; // requests per second

    return {
      operation,
      iterations: results.length,
      totalTime,
      averageTime,
      minTime: durations[0] || 0,
      maxTime: durations[durations.length - 1] || 0,
      p50Time: percentile(durations, 50),
      p95Time: percentile(durations, 95),
      p99Time: percentile(durations, 99),
      successRate,
      throughput,
    };
  }

  /**
   * Print results
   */
  printResults(results: BenchmarkResult[]): void {
    console.log('\n' + '='.repeat(80));
    console.log('BENCHMARK RESULTS');
    console.log('='.repeat(80));

    results.forEach((result) => {
      console.log(`\n${result.operation}:`);
      console.log(`  Iterations: ${result.iterations}`);
      console.log(`  Total Time: ${result.totalTime.toFixed(0)}ms`);
      console.log(`  Average Time: ${result.averageTime.toFixed(2)}ms`);
      console.log(`  Min Time: ${result.minTime.toFixed(2)}ms`);
      console.log(`  Max Time: ${result.maxTime.toFixed(2)}ms`);
      console.log(`  P50 Time: ${result.p50Time.toFixed(2)}ms`);
      console.log(`  P95 Time: ${result.p95Time.toFixed(2)}ms`);
      console.log(`  P99 Time: ${result.p99Time.toFixed(2)}ms`);
      console.log(`  Success Rate: ${result.successRate.toFixed(2)}%`);
      console.log(`  Throughput: ${result.throughput.toFixed(2)} req/s`);
    });

    console.log('\n' + '='.repeat(80));
  }

  /**
   * Save results to file
   */
  saveResults(results: BenchmarkResult[], filename: string): void {
    const output = {
      timestamp: new Date().toISOString(),
      config: this.config,
      results,
    };

    fs.writeFileSync(filename, JSON.stringify(output, null, 2));
    console.log(`\nResults saved to: ${filename}`);
  }

  /**
   * Run full benchmark suite
   */
  async run(): Promise<void> {
    await this.init();
    await this.warmup();

    const results: BenchmarkResult[] = [];

    // Sequential benchmark
    results.push(await this.runSequential());

    // Concurrent benchmark
    results.push(await this.runConcurrent());

    // Print and save results
    this.printResults(results);
    this.saveResults(results, `benchmark-results-${Date.now()}.json`);
  }
}

/**
 * Main execution
 */
async function main() {
  const benchmark = new ImageSearchBenchmark({
    iterations: parseInt(process.env.ITERATIONS || '100'),
    concurrentRequests: parseInt(process.env.CONCURRENT || '10'),
  });

  try {
    await benchmark.run();
  } catch (error: any) {
    console.error('Benchmark failed:', error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { ImageSearchBenchmark };
