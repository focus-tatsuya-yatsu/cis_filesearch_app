/**
 * OpenSearch Migration Test Utilities
 *
 * 移行テストで使用する共通ユーティリティ関数とヘルパー
 */

import { Client } from '@opensearch-project/opensearch';

// ========================================================================
// Type Definitions
// ========================================================================

export interface MigrationReport {
  status: 'success' | 'failure' | 'partial';
  startTime: Date;
  endTime: Date;
  duration: number;
  sourceIndex: string;
  targetIndex: string;
  sourceDocCount: number;
  targetDocCount: number;
  dataLoss: number;
  dataLossPercent: number;
  errors: string[];
  warnings: string[];
  metrics: {
    avgSearchLatency: number;
    p95SearchLatency: number;
    p99SearchLatency: number;
    indexSize: number;
    memoryUsage: number;
  };
}

export interface ValidationResult {
  passed: boolean;
  message: string;
  details?: any;
}

export interface ComparisonResult {
  field: string;
  sourceValue: any;
  targetValue: any;
  match: boolean;
  difference?: any;
}

// ========================================================================
// Index Management Utilities
// ========================================================================

/**
 * インデックスが存在するかチェック
 */
export async function indexExists(
  client: Client,
  indexName: string
): Promise<boolean> {
  try {
    const response = await client.indices.exists({
      index: indexName,
    });
    return response.body === true;
  } catch (error) {
    return false;
  }
}

/**
 * インデックスのドキュメント数を取得
 */
export async function getDocumentCount(
  client: Client,
  indexName: string
): Promise<number> {
  const response = await client.count({
    index: indexName,
  });
  return response.body.count;
}

/**
 * インデックスのサイズを取得（バイト単位）
 */
export async function getIndexSize(
  client: Client,
  indexName: string
): Promise<number> {
  const response = await client.indices.stats({
    index: indexName,
    metric: 'store',
  });
  return response.body._all.primaries.store.size_in_bytes;
}

/**
 * インデックスのマッピングを取得
 */
export async function getIndexMapping(
  client: Client,
  indexName: string
): Promise<any> {
  const response = await client.indices.getMapping({
    index: indexName,
  });
  return response.body[indexName].mappings;
}

/**
 * インデックスの設定を取得
 */
export async function getIndexSettings(
  client: Client,
  indexName: string
): Promise<any> {
  const response = await client.indices.getSettings({
    index: indexName,
  });
  return response.body[indexName].settings;
}

/**
 * インデックスのヘルスステータスを取得
 */
export async function getIndexHealth(
  client: Client,
  indexName: string
): Promise<string> {
  const response = await client.cluster.health({
    index: indexName,
  });
  return response.body.status;
}

// ========================================================================
// Data Validation Utilities
// ========================================================================

/**
 * ランダムなドキュメントサンプルを取得
 */
export async function getRandomSample(
  client: Client,
  indexName: string,
  sampleSize: number
): Promise<any[]> {
  const response = await client.search({
    index: indexName,
    body: {
      size: sampleSize,
      query: {
        function_score: {
          query: { match_all: {} },
          random_score: {},
        },
      },
    },
  });

  return response.body.hits.hits.map((hit: any) => ({
    id: hit._id,
    source: hit._source,
  }));
}

/**
 * 2つのドキュメントを比較
 */
export function compareDocuments(
  doc1: any,
  doc2: any,
  excludeFields: string[] = []
): ComparisonResult[] {
  const results: ComparisonResult[] = [];
  const allFields = new Set([
    ...Object.keys(doc1),
    ...Object.keys(doc2),
  ]);

  allFields.forEach(field => {
    if (excludeFields.includes(field)) {
      return;
    }

    const value1 = doc1[field];
    const value2 = doc2[field];

    const match = JSON.stringify(value1) === JSON.stringify(value2);

    results.push({
      field,
      sourceValue: value1,
      targetValue: value2,
      match,
      difference: match ? undefined : { source: value1, target: value2 },
    });
  });

  return results;
}

/**
 * サンプルドキュメントの整合性をチェック
 */
export async function validateSampleIntegrity(
  client: Client,
  sourceIndex: string,
  targetIndex: string,
  sampleSize: number,
  excludeFields: string[] = ['image_embedding', 'indexed_at']
): Promise<ValidationResult> {
  const sourceSamples = await getRandomSample(client, sourceIndex, sampleSize);

  let matchCount = 0;
  let mismatchCount = 0;
  const mismatches: any[] = [];

  for (const sample of sourceSamples) {
    try {
      const targetDoc = await client.get({
        index: targetIndex,
        id: sample.id,
      });

      const comparison = compareDocuments(
        sample.source,
        targetDoc.body._source,
        excludeFields
      );

      const allMatch = comparison.every(c => c.match);

      if (allMatch) {
        matchCount++;
      } else {
        mismatchCount++;
        mismatches.push({
          id: sample.id,
          mismatches: comparison.filter(c => !c.match),
        });
      }
    } catch (error) {
      mismatchCount++;
      mismatches.push({
        id: sample.id,
        error: 'Document not found in target index',
      });
    }
  }

  const matchPercent = (matchCount / sourceSamples.length) * 100;
  const passed = matchPercent >= 99; // 99% match required

  return {
    passed,
    message: `Sample integrity: ${matchCount}/${sourceSamples.length} (${matchPercent.toFixed(2)}%)`,
    details: {
      matchCount,
      mismatchCount,
      matchPercent,
      mismatches,
    },
  };
}

// ========================================================================
// Performance Measurement Utilities
// ========================================================================

/**
 * 検索レイテンシを測定
 */
export async function measureSearchLatency(
  client: Client,
  indexName: string,
  query: any,
  iterations: number = 10
): Promise<{
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  latencies: number[];
}> {
  const latencies: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const startTime = Date.now();

    await client.search({
      index: indexName,
      body: query,
    });

    latencies.push(Date.now() - startTime);
  }

  const sorted = [...latencies].sort((a, b) => a - b);

  return {
    avg: latencies.reduce((a, b) => a + b) / latencies.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: sorted[Math.floor(iterations * 0.5)],
    p95: sorted[Math.floor(iterations * 0.95)],
    p99: sorted[Math.floor(iterations * 0.99)],
    latencies,
  };
}

/**
 * k-NN検索のパフォーマンスを測定
 */
export async function measureKnnPerformance(
  client: Client,
  indexName: string,
  queryVector: number[],
  k: number = 10,
  iterations: number = 10
): Promise<{
  avg: number;
  p95: number;
  p99: number;
  latencies: number[];
}> {
  const latencies: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const startTime = Date.now();

    await client.search({
      index: indexName,
      body: {
        query: {
          script_score: {
            query: { match_all: {} },
            script: {
              source: 'knn_score',
              lang: 'knn',
              params: {
                field: 'image_embedding',
                query_value: queryVector,
                space_type: 'innerproduct',
              },
            },
          },
        },
        size: k,
      },
    });

    latencies.push(Date.now() - startTime);
  }

  const sorted = [...latencies].sort((a, b) => a - b);

  return {
    avg: latencies.reduce((a, b) => a + b) / latencies.length,
    p95: sorted[Math.floor(iterations * 0.95)],
    p99: sorted[Math.floor(iterations * 0.99)],
    latencies,
  };
}

// ========================================================================
// Migration Progress Monitoring
// ========================================================================

/**
 * Reindexタスクの進行状況を監視
 */
export async function monitorReindexTask(
  client: Client,
  taskId: string,
  pollInterval: number = 5000,
  maxWaitTime: number = 300000 // 5 minutes
): Promise<{
  completed: boolean;
  total: number;
  created: number;
  duration: number;
}> {
  const startTime = Date.now();

  while (true) {
    const response = await client.tasks.get({
      task_id: taskId,
    });

    const completed = response.body.completed;
    const status = response.body.task?.status;

    if (completed) {
      return {
        completed: true,
        total: status?.total || 0,
        created: status?.created || 0,
        duration: Date.now() - startTime,
      };
    }

    if (Date.now() - startTime > maxWaitTime) {
      throw new Error('Reindex task timeout');
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
}

// ========================================================================
// Cluster Health Monitoring
// ========================================================================

/**
 * クラスターヘルスをチェック
 */
export async function checkClusterHealth(
  client: Client
): Promise<ValidationResult> {
  const response = await client.cluster.health();
  const status = response.body.status;

  const passed = ['green', 'yellow'].includes(status);

  return {
    passed,
    message: `Cluster health: ${status}`,
    details: response.body,
  };
}

/**
 * ディスク容量をチェック
 */
export async function checkDiskSpace(
  client: Client,
  minFreePercent: number = 20
): Promise<ValidationResult> {
  const response = await client.nodes.stats({
    metric: 'fs',
  });

  const nodes = response.body.nodes;
  const warnings: string[] = [];

  Object.keys(nodes).forEach(nodeId => {
    const fsTotal = nodes[nodeId].fs.total;
    const availableBytes = fsTotal.available_in_bytes;
    const totalBytes = fsTotal.total_in_bytes;
    const freePercent = (availableBytes / totalBytes) * 100;

    if (freePercent < minFreePercent) {
      warnings.push(
        `Node ${nodeId}: Only ${freePercent.toFixed(2)}% free (< ${minFreePercent}%)`
      );
    }
  });

  return {
    passed: warnings.length === 0,
    message: warnings.length > 0 ? 'Insufficient disk space' : 'Disk space OK',
    details: { warnings },
  };
}

/**
 * メモリ使用率をチェック
 */
export async function checkMemoryUsage(
  client: Client,
  maxHeapPercent: number = 90
): Promise<ValidationResult> {
  const response = await client.nodes.stats({
    metric: 'jvm',
  });

  const nodes = response.body.nodes;
  const warnings: string[] = [];

  Object.keys(nodes).forEach(nodeId => {
    const heapUsedPercent = nodes[nodeId].jvm.mem.heap_used_percent;

    if (heapUsedPercent > maxHeapPercent) {
      warnings.push(
        `Node ${nodeId}: Heap ${heapUsedPercent}% (> ${maxHeapPercent}%)`
      );
    }
  });

  return {
    passed: warnings.length === 0,
    message: warnings.length > 0 ? 'High memory usage' : 'Memory usage OK',
    details: { warnings },
  };
}

// ========================================================================
// Migration Report Generation
// ========================================================================

/**
 * 移行レポートを生成
 */
export async function generateMigrationReport(
  client: Client,
  sourceIndex: string,
  targetIndex: string,
  startTime: Date,
  endTime: Date
): Promise<MigrationReport> {
  const sourceDocCount = await getDocumentCount(client, sourceIndex);
  const targetDocCount = await getDocumentCount(client, targetIndex);
  const dataLoss = sourceDocCount - targetDocCount;
  const dataLossPercent = (dataLoss / sourceDocCount) * 100;

  // Performance metrics
  const searchLatency = await measureSearchLatency(client, targetIndex, {
    query: {
      multi_match: {
        query: 'test',
        fields: ['file_name', 'file_path'],
      },
    },
    size: 20,
  });

  const indexSize = await getIndexSize(client, targetIndex);

  const nodesStats = await client.nodes.stats({
    metric: 'jvm',
  });
  const nodes = nodesStats.body.nodes;
  const avgMemoryUsage =
    Object.values(nodes).reduce(
      (sum: number, node: any) => sum + node.jvm.mem.heap_used_percent,
      0
    ) / Object.keys(nodes).length;

  const status: 'success' | 'failure' | 'partial' =
    dataLossPercent === 0
      ? 'success'
      : dataLossPercent < 1
      ? 'partial'
      : 'failure';

  return {
    status,
    startTime,
    endTime,
    duration: endTime.getTime() - startTime.getTime(),
    sourceIndex,
    targetIndex,
    sourceDocCount,
    targetDocCount,
    dataLoss,
    dataLossPercent,
    errors: [],
    warnings:
      dataLossPercent > 0
        ? [`Data loss detected: ${dataLossPercent.toFixed(2)}%`]
        : [],
    metrics: {
      avgSearchLatency: searchLatency.avg,
      p95SearchLatency: searchLatency.p95,
      p99SearchLatency: searchLatency.p99,
      indexSize,
      memoryUsage: avgMemoryUsage,
    },
  };
}

/**
 * レポートを整形して出力
 */
export function formatMigrationReport(report: MigrationReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('========================================');
  lines.push('OpenSearch Migration Report');
  lines.push('========================================');
  lines.push('');
  lines.push(`Status: ${report.status.toUpperCase()}`);
  lines.push(`Start Time: ${report.startTime.toISOString()}`);
  lines.push(`End Time: ${report.endTime.toISOString()}`);
  lines.push(`Duration: ${(report.duration / 1000).toFixed(2)}s`);
  lines.push('');
  lines.push('--- Indexes ---');
  lines.push(`Source: ${report.sourceIndex}`);
  lines.push(`Target: ${report.targetIndex}`);
  lines.push('');
  lines.push('--- Document Count ---');
  lines.push(`Source: ${report.sourceDocCount.toLocaleString()}`);
  lines.push(`Target: ${report.targetDocCount.toLocaleString()}`);
  lines.push(`Data Loss: ${report.dataLoss.toLocaleString()} (${report.dataLossPercent.toFixed(4)}%)`);
  lines.push('');
  lines.push('--- Performance Metrics ---');
  lines.push(`Avg Search Latency: ${report.metrics.avgSearchLatency.toFixed(2)}ms`);
  lines.push(`P95 Search Latency: ${report.metrics.p95SearchLatency.toFixed(2)}ms`);
  lines.push(`P99 Search Latency: ${report.metrics.p99SearchLatency.toFixed(2)}ms`);
  lines.push(`Index Size: ${(report.metrics.indexSize / 1024 / 1024).toFixed(2)} MB`);
  lines.push(`Memory Usage: ${report.metrics.memoryUsage.toFixed(2)}%`);
  lines.push('');

  if (report.errors.length > 0) {
    lines.push('--- Errors ---');
    report.errors.forEach(error => lines.push(`  - ${error}`));
    lines.push('');
  }

  if (report.warnings.length > 0) {
    lines.push('--- Warnings ---');
    report.warnings.forEach(warning => lines.push(`  - ${warning}`));
    lines.push('');
  }

  lines.push('========================================');
  lines.push('');

  return lines.join('\n');
}

// ========================================================================
// Test Data Generators
// ========================================================================

/**
 * テスト用のランダムベクトルを生成
 */
export function generateRandomVector(dimension: number): number[] {
  const vector: number[] = [];

  for (let i = 0; i < dimension; i++) {
    vector.push(Math.random());
  }

  // Normalize vector (for innerproduct space)
  const magnitude = Math.sqrt(
    vector.reduce((sum, val) => sum + val * val, 0)
  );

  return vector.map(val => val / magnitude);
}

/**
 * テスト用のドキュメントを生成
 */
export function generateTestDocument(id: string): any {
  return {
    file_name: `test-${id}.pdf`,
    file_path: `/test/documents/test-${id}.pdf`,
    file_type: 'pdf',
    file_size: Math.floor(Math.random() * 10000000),
    modified_date: new Date().toISOString(),
    processed_at: new Date().toISOString(),
    extracted_text: `This is a test document ${id} with some content for testing purposes.`,
    metadata: {
      author: 'Test User',
      created: new Date().toISOString(),
    },
    s3_location: `s3://test-bucket/documents/test-${id}.pdf`,
    indexed_at: new Date().toISOString(),
  };
}

/**
 * バルクインデックス用のドキュメント配列を生成
 */
export function generateBulkDocuments(
  indexName: string,
  count: number
): any[] {
  const body: any[] = [];

  for (let i = 0; i < count; i++) {
    body.push(
      { index: { _index: indexName, _id: `bulk-test-${i}` } },
      generateTestDocument(`bulk-${i}`)
    );
  }

  return body;
}
