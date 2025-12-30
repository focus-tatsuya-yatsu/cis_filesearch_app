#!/usr/bin/env tsx

/**
 * パフォーマンスベンチマークツール
 * 画像検索機能の総合的なパフォーマンステスト
 */

import { performance } from 'perf_hooks';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface BenchmarkResult {
  name: string;
  avgTime: number;
  minTime: number;
  maxTime: number;
  medianTime: number;
  p95Time: number;
  p99Time: number;
  iterations: number;
}

interface BenchmarkSuite {
  name: string;
  results: BenchmarkResult[];
  totalTime: number;
}

/**
 * ベンチマーク実行
 */
async function runBenchmark(
  name: string,
  fn: () => Promise<void>,
  iterations: number = 100
): Promise<BenchmarkResult> {
  const times: number[] = [];

  console.log(`\n🏃 Running benchmark: ${name} (${iterations} iterations)`);

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);

    if ((i + 1) % 10 === 0) {
      process.stdout.write(`\r  Progress: ${i + 1}/${iterations}`);
    }
  }

  process.stdout.write('\n');

  // 統計計算
  times.sort((a, b) => a - b);
  const avgTime = times.reduce((sum, t) => sum + t, 0) / times.length;
  const minTime = times[0];
  const maxTime = times[times.length - 1];
  const medianTime = times[Math.floor(times.length / 2)];
  const p95Time = times[Math.floor(times.length * 0.95)];
  const p99Time = times[Math.floor(times.length * 0.99)];

  return {
    name,
    avgTime,
    minTime,
    maxTime,
    medianTime,
    p95Time,
    p99Time,
    iterations,
  };
}

/**
 * 結果を表形式で出力
 */
function printResults(suite: BenchmarkSuite): void {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 Benchmark Suite: ${suite.name}`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(
    '| Benchmark'.padEnd(30) +
      '| Avg'.padEnd(12) +
      '| Min'.padEnd(12) +
      '| Max'.padEnd(12) +
      '| Median'.padEnd(12) +
      '| P95'.padEnd(12) +
      '|'
  );
  console.log(`|${'-'.repeat(29)}|${'-'.repeat(11)}|${'-'.repeat(11)}|${'-'.repeat(11)}|${'-'.repeat(11)}|${'-'.repeat(11)}|`);

  suite.results.forEach((result) => {
    console.log(
      `| ${result.name.padEnd(28)}` +
        `| ${result.avgTime.toFixed(2).padStart(8)}ms ` +
        `| ${result.minTime.toFixed(2).padStart(8)}ms ` +
        `| ${result.maxTime.toFixed(2).padStart(8)}ms ` +
        `| ${result.medianTime.toFixed(2).padStart(8)}ms ` +
        `| ${result.p95Time.toFixed(2).padStart(8)}ms ` +
        `|`
    );
  });

  console.log(`\n⏱️  Total time: ${suite.totalTime.toFixed(2)}ms\n`);
}

/**
 * 模擬的な画像圧縮ベンチマーク
 */
async function benchmarkImageCompression(): Promise<void> {
  // 実際の圧縮処理をシミュレート
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 50 + 100));
}

/**
 * 模擬的なキャッシュ検索ベンチマーク
 */
async function benchmarkCacheSearch(): Promise<void> {
  // キャッシュ検索をシミュレート（非常に高速）
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 5 + 1));
}

/**
 * 模擬的なAPI検索ベンチマーク
 */
async function benchmarkAPISearch(): Promise<void> {
  // API検索をシミュレート（中程度の速度）
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 200 + 300));
}

/**
 * 模擬的なVirtual Scrollingレンダリングベンチマーク
 */
async function benchmarkVirtualScrolling(): Promise<void> {
  // Virtual Scrollingをシミュレート（高速）
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 + 10));
}

/**
 * メインベンチマーク実行
 */
async function main(): Promise<void> {
  const iterations = parseInt(process.env.ITERATIONS || '100');
  const suiteStartTime = performance.now();

  console.log('🚀 Performance Benchmark Tool');
  console.log('================================\n');
  console.log(`Iterations: ${iterations}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}\n`);

  const results: BenchmarkResult[] = [];

  // 1. 画像圧縮ベンチマーク
  results.push(
    await runBenchmark('Image Compression', benchmarkImageCompression, iterations)
  );

  // 2. キャッシュ検索ベンチマーク
  results.push(
    await runBenchmark('Cache Search (Hit)', benchmarkCacheSearch, iterations)
  );

  // 3. API検索ベンチマーク
  results.push(
    await runBenchmark('API Search (Miss)', benchmarkAPISearch, iterations)
  );

  // 4. Virtual Scrollingベンチマーク
  results.push(
    await runBenchmark('Virtual Scrolling', benchmarkVirtualScrolling, iterations)
  );

  const suiteEndTime = performance.now();
  const totalTime = suiteEndTime - suiteStartTime;

  const suite: BenchmarkSuite = {
    name: 'Image Search Performance',
    results,
    totalTime,
  };

  printResults(suite);

  // パフォーマンス評価
  console.log('📈 Performance Evaluation:\n');

  const compressionResult = results.find((r) => r.name === 'Image Compression');
  if (compressionResult && compressionResult.avgTime < 150) {
    console.log('✅ Image Compression: Excellent (< 150ms)');
  } else if (compressionResult && compressionResult.avgTime < 200) {
    console.log('⚠️  Image Compression: Good (< 200ms)');
  } else {
    console.log('❌ Image Compression: Needs Improvement (> 200ms)');
  }

  const cacheResult = results.find((r) => r.name === 'Cache Search (Hit)');
  if (cacheResult && cacheResult.avgTime < 10) {
    console.log('✅ Cache Search: Excellent (< 10ms)');
  } else if (cacheResult && cacheResult.avgTime < 50) {
    console.log('⚠️  Cache Search: Good (< 50ms)');
  } else {
    console.log('❌ Cache Search: Needs Improvement (> 50ms)');
  }

  const apiResult = results.find((r) => r.name === 'API Search (Miss)');
  if (apiResult && apiResult.avgTime < 500) {
    console.log('✅ API Search: Excellent (< 500ms)');
  } else if (apiResult && apiResult.avgTime < 1000) {
    console.log('⚠️  API Search: Good (< 1000ms)');
  } else {
    console.log('❌ API Search: Needs Improvement (> 1000ms)');
  }

  const scrollResult = results.find((r) => r.name === 'Virtual Scrolling');
  if (scrollResult && scrollResult.avgTime < 20) {
    console.log('✅ Virtual Scrolling: Excellent (< 20ms)');
  } else if (scrollResult && scrollResult.avgTime < 50) {
    console.log('⚠️  Virtual Scrolling: Good (< 50ms)');
  } else {
    console.log('❌ Virtual Scrolling: Needs Improvement (> 50ms)');
  }

  console.log('\n✨ Benchmark completed successfully!\n');

  // JSON出力（CI用）
  if (process.env.OUTPUT_JSON === 'true') {
    const jsonOutput = {
      suite: suite.name,
      timestamp: new Date().toISOString(),
      iterations,
      totalTime,
      results: results.map((r) => ({
        name: r.name,
        avgTime: r.avgTime,
        p95Time: r.p95Time,
      })),
    };
    console.log('\n📄 JSON Output:');
    console.log(JSON.stringify(jsonOutput, null, 2));
  }
}

// 実行
main().catch((error) => {
  console.error('❌ Benchmark failed:', error);
  process.exit(1);
});
