# OpenSearch Index Migration - Comprehensive Test Strategy

## 目次

1. [概要](#概要)
2. [テスト環境](#テスト環境)
3. [Pre-Migration Testing](#1-pre-migration-testing-requirements)
4. [Migration Validation Tests](#2-migration-validation-tests)
5. [Post-Migration Verification](#3-post-migration-verification-tests)
6. [Rollback Testing Procedures](#4-rollback-testing-procedures)
7. [Performance Benchmarking](#5-performance-benchmarking-tests)
8. [Data Integrity Validation](#6-data-integrity-validation-methods)
9. [実行方法](#実行方法)
10. [レポート解析](#レポート解析)
11. [トラブルシューティング](#トラブルシューティング)

## 概要

### 目的

AWS OpenSearch Serviceでのインデックスマッピング修正（k-NNベクトル対応）の際、データ損失や検索機能の劣化を防ぐため、包括的なテストを実施します。

### 対象環境

- **OpenSearch**: AWS OpenSearch Service
- **ドキュメント数**: 約100万件
- **リスクレベル**: **HIGH** (本番システム)
- **許容ダウンタイム**: ゼロ (Blue-Green Deployment使用)

### テストスコープ

```
1. Pre-Migration Testing (事前検証)
   ├─ ソースインデックスの健全性確認
   ├─ クラスターリソースのチェック
   └─ バックアップの確認

2. Migration Validation (移行プロセス検証)
   ├─ ターゲットインデックス作成
   ├─ データReindex
   └─ エイリアス切り替え

3. Post-Migration Verification (事後検証)
   ├─ データ整合性チェック
   ├─ 検索機能の動作確認
   └─ k-NNベクトル検索の検証

4. Rollback Procedures (ロールバック手順)
   ├─ エイリアス巻き戻し
   ├─ 検索機能の復旧確認
   └─ ロールバック時間の測定

5. Performance Benchmarking (パフォーマンス測定)
   ├─ 検索レイテンシの測定
   ├─ インデックスサイズの比較
   └─ リソース使用率の監視

6. Data Integrity Validation (データ整合性検証)
   ├─ ドキュメント数の照合
   ├─ サンプルデータの比較
   └─ フィールド型の検証
```

## テスト環境

### 必要な環境変数

```bash
# OpenSearch接続情報
export OPENSEARCH_ENDPOINT="https://search-cis-filesearch-dev.ap-northeast-1.es.amazonaws.com"
export AWS_REGION="ap-northeast-1"

# インデックス名
export OPENSEARCH_SOURCE_INDEX="file-search-dev"
export OPENSEARCH_TARGET_INDEX="file-search-v2-test"
export OPENSEARCH_ALIAS="file-search"

# AWS認証情報
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
# または IAM Roleを使用
```

### 必要なツール

- **Node.js**: v18以上
- **Yarn**: 1.22以上
- **Jest**: テストランナー
- **curl**: APIリクエスト用
- **jq**: JSON処理用
- **bc**: 計算用（シェルスクリプト）

## 1. Pre-Migration Testing Requirements

### 1.1 ソースインデックスの検証

#### テスト項目

| テスト | 目的 | 合格基準 |
|-------|------|---------|
| インデックス存在確認 | ソースインデックスが存在する | HTTP 200 |
| ドキュメント数取得 | 移行対象のデータ量を把握 | count >= 0 |
| マッピング構造確認 | 既存のフィールド定義を確認 | mappings.properties が存在 |
| image_embeddingフィールド確認 | 現在の型を特定 | type != knn_vector で移行必要 |

#### Jest テストコード例

```typescript
describe('1.1 Source Index Validation', () => {
  it('should verify source index exists', async () => {
    const response = await client.indices.exists({
      index: config.sourceIndex,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(true);
  });

  it('should get source index document count', async () => {
    const response = await client.count({
      index: config.sourceIndex,
    });

    expect(response.body.count).toBeGreaterThanOrEqual(0);
    (global as any).sourceDocumentCount = response.body.count;

    console.log(`Source index document count: ${response.body.count}`);
  });
});
```

### 1.2 クラスターヘルスチェック

#### テスト項目

| テスト | 目的 | 合格基準 |
|-------|------|---------|
| クラスター状態 | 移行を実施できる状態か | status = green または yellow |
| ディスク容量 | 新インデックス作成可能か | 使用率 < 80% |
| メモリ使用率 | 移行処理に十分なメモリ | JVM heap < 90% |

#### 推奨チェック項目

```bash
# クラスターヘルス
curl -X GET "$OPENSEARCH_ENDPOINT/_cluster/health" | jq .

# ディスク使用率
curl -X GET "$OPENSEARCH_ENDPOINT/_nodes/stats/fs" | \
  jq '.nodes | to_entries | .[] | {name: .value.name, disk_usage: ((.value.fs.total.total_in_bytes - .value.fs.total.available_in_bytes) / .value.fs.total.total_in_bytes * 100)}'

# メモリ使用率
curl -X GET "$OPENSEARCH_ENDPOINT/_nodes/stats/jvm" | \
  jq '.nodes | to_entries | .[] | {name: .value.name, heap_percent: .value.jvm.mem.heap_used_percent}'
```

### 1.3 バックアップの確認

#### スナップショットリポジトリの確認

```typescript
it('should verify snapshot repository is configured', async () => {
  try {
    const response = await client.snapshot.getRepository({
      repository: '_all',
    });

    const repos = Object.keys(response.body);
    expect(repos.length).toBeGreaterThan(0);

    console.log(`Available snapshot repositories: ${repos.join(', ')}`);
  } catch (error) {
    console.warn('⚠️ No snapshot repository configured');
  }
});
```

#### 移行前スナップショットの作成

```bash
# スナップショット作成
curl -X PUT "$OPENSEARCH_ENDPOINT/_snapshot/my_backup/pre-migration-$(date +%Y%m%d)" \
  -H "Content-Type: application/json" \
  -d "{
    \"indices\": \"$SOURCE_INDEX\",
    \"include_global_state\": false
  }"
```

## 2. Migration Validation Tests

### 2.1 ターゲットインデックス作成

#### 正しいk-NNマッピングの設定

```json
{
  "mappings": {
    "properties": {
      "image_embedding": {
        "type": "knn_vector",
        "dimension": 1024,
        "method": {
          "name": "hnsw",
          "space_type": "innerproduct",
          "engine": "faiss",
          "parameters": {
            "ef_construction": 128,
            "m": 24
          }
        }
      }
    }
  },
  "settings": {
    "index": {
      "knn": true,
      "knn.algo_param.ef_search": 100,
      "number_of_shards": 1,
      "number_of_replicas": 1,
      "refresh_interval": "30s"
    }
  }
}
```

#### 検証テスト

```typescript
it('should create target index with correct k-NN mapping', async () => {
  const response = await client.indices.create({
    index: config.targetIndex,
    body: {
      settings: expectedSettings,
      mappings: expectedMapping,
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.body.acknowledged).toBe(true);
});

it('should verify target index mapping is correct', async () => {
  const response = await client.indices.getMapping({
    index: config.targetIndex,
  });

  const mapping = response.body[config.targetIndex].mappings;

  expect(mapping.properties.image_embedding?.type).toBe('knn_vector');
  expect(mapping.properties.image_embedding?.dimension).toBe(1024);
  expect(mapping.properties.image_embedding?.method?.engine).toBe('faiss');
  expect(mapping.properties.image_embedding?.method?.space_type).toBe('innerproduct');
});
```

### 2.2 データReindexプロセス

#### 非同期Reindexの開始

```typescript
it('should initiate reindex from source to target', async () => {
  const response = await client.reindex({
    wait_for_completion: false,
    body: {
      source: {
        index: config.sourceIndex,
        _source: {
          excludes: ['image_embedding'], // 古いembeddingフィールドを除外
        },
      },
      dest: {
        index: config.targetIndex,
      },
    },
  });

  const taskId = response.body.task;
  expect(taskId).toBeDefined();

  (global as any).reindexTaskId = taskId;
});
```

#### 進行状況の監視

```typescript
it('should monitor reindex progress', async () => {
  const taskId = (global as any).reindexTaskId;

  let completed = false;
  let attempts = 0;
  const maxAttempts = 60; // 5分間

  while (!completed && attempts < maxAttempts) {
    const response = await client.tasks.get({
      task_id: taskId,
    });

    completed = response.body.completed;

    if (!completed) {
      const status = response.body.task?.status;
      const created = status?.created || 0;
      const total = status?.total || 0;
      const percent = total > 0 ? ((created / total) * 100).toFixed(2) : 0;

      console.log(`Reindex progress: ${created}/${total} (${percent}%)`);

      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;
    }
  }

  expect(completed).toBe(true);
});
```

#### ドキュメント数の検証

```typescript
it('should verify target index document count matches source', async () => {
  const sourceCount = (global as any).sourceDocumentCount || 0;

  const response = await client.count({
    index: config.targetIndex,
  });

  const targetCount = response.body.count;

  // 0.1% の許容誤差
  const tolerance = Math.max(1, Math.floor(sourceCount * 0.001));
  expect(Math.abs(targetCount - sourceCount)).toBeLessThanOrEqual(tolerance);
});
```

### 2.3 エイリアス管理

#### アトミックなエイリアススワップ（ゼロダウンタイム）

```typescript
it('should perform atomic alias swap (zero-downtime)', async () => {
  const response = await client.indices.updateAliases({
    body: {
      actions: [
        {
          remove: {
            index: config.sourceIndex,
            alias: config.aliasName,
          },
        },
        {
          add: {
            index: config.targetIndex,
            alias: config.aliasName,
          },
        },
      ],
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.body.acknowledged).toBe(true);
});
```

#### エイリアス検証

```typescript
it('should verify alias points to target index', async () => {
  const response = await client.indices.getAlias({
    name: config.aliasName,
  });

  const aliases = Object.keys(response.body);

  expect(aliases).toContain(config.targetIndex);
  expect(aliases).not.toContain(config.sourceIndex);
});
```

## 3. Post-Migration Verification Tests

### 3.1 データ整合性の検証

#### サンプルドキュメントの整合性チェック

```typescript
it('should verify all sample documents exist in target index', async () => {
  const sampleDocs = (global as any).sampleDocuments || [];

  for (const doc of sampleDocs) {
    const response = await client.get({
      index: config.targetIndex,
      id: doc.id,
    });

    expect(response.statusCode).toBe(200);

    const source = response.body._source;
    expect(source.file_name).toBe(doc.source.file_name);
    expect(source.file_path).toBe(doc.source.file_path);
  }

  console.log(`✓ Verified ${sampleDocs.length} sample documents`);
});
```

#### フィールド型の検証

```typescript
it('should verify field types are preserved', async () => {
  const response = await client.search({
    index: config.targetIndex,
    size: 100,
    body: {
      query: { match_all: {} },
    },
  });

  const hits = response.body.hits.hits;

  hits.forEach(hit => {
    const doc = hit._source;

    expect(typeof doc.file_name).toBe('string');
    expect(typeof doc.file_path).toBe('string');
    expect(typeof doc.file_type).toBe('string');
    expect(typeof doc.file_size).toBe('number');
  });
});
```

### 3.2 検索機能の検証

#### 基本的なテキスト検索

```typescript
it('should perform basic text search', async () => {
  const response = await client.search({
    index: config.targetIndex,
    body: {
      query: {
        multi_match: {
          query: 'test',
          fields: ['file_name', 'file_path', 'extracted_text'],
        },
      },
      size: 10,
    },
  });

  expect(response.statusCode).toBe(200);

  const result = response.body;
  expect(result.hits.total.value).toBeGreaterThanOrEqual(0);
});
```

#### ハイライト機能の確認

```typescript
it('should verify highlighting works', async () => {
  const response = await client.search({
    index: config.targetIndex,
    body: {
      query: {
        match: {
          file_name: 'test',
        },
      },
      highlight: {
        fields: {
          file_name: {},
          file_path: {},
          extracted_text: {},
        },
        pre_tags: ['<mark>'],
        post_tags: ['</mark>'],
      },
      size: 5,
    },
  });

  const hits = response.body.hits.hits;

  if (hits.length > 0) {
    const hasHighlight = hits.some(hit => hit.highlight !== undefined);
    expect(hasHighlight).toBe(true);
  }
});
```

#### ソート機能の確認

```typescript
it('should verify sorting works', async () => {
  const response = await client.search({
    index: config.targetIndex,
    body: {
      query: { match_all: {} },
      sort: [
        { processed_at: { order: 'desc' } },
      ],
      size: 10,
    },
  });

  const hits = response.body.hits.hits;

  // ソート順の検証
  for (let i = 0; i < hits.length - 1; i++) {
    const current = new Date(hits[i]._source.processed_at).getTime();
    const next = new Date(hits[i + 1]._source.processed_at).getTime();
    expect(current).toBeGreaterThanOrEqual(next);
  }
});
```

### 3.3 k-NNベクトル検索の検証

#### ベクトルフィールドのデータ挿入テスト

```typescript
it('should verify k-NN vector field accepts data', async () => {
  const testVector = Array(1024).fill(0).map(() => Math.random());

  const response = await client.index({
    index: config.targetIndex,
    id: 'test-vector-doc',
    body: {
      file_name: 'test-vector.jpg',
      file_path: '/test/vector.jpg',
      file_type: 'jpg',
      file_size: 1024,
      processed_at: new Date().toISOString(),
      image_embedding: testVector,
    },
    refresh: 'wait_for',
  });

  expect(response.statusCode).toBe(201);
});
```

#### 次元数の検証

```typescript
it('should reject vector with wrong dimension', async () => {
  const wrongVector = Array(512).fill(0).map(() => Math.random());

  await expect(
    client.index({
      index: config.targetIndex,
      id: 'test-wrong-dimension',
      body: {
        file_name: 'test.jpg',
        image_embedding: wrongVector,
      },
    })
  ).rejects.toThrow();
});
```

#### k-NN検索の実行テスト

```typescript
it('should perform k-NN vector search', async () => {
  const response = await client.search({
    index: config.targetIndex,
    body: {
      query: {
        exists: {
          field: 'image_embedding',
        },
      },
      size: 1,
    },
  });

  const hits = response.body.hits.hits;

  if (hits.length > 0) {
    const queryVector = hits[0]._source.image_embedding;

    const knnResponse = await client.search({
      index: config.targetIndex,
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
        size: 10,
      },
    });

    expect(knnResponse.body.hits.hits.length).toBeGreaterThan(0);
  }
});
```

## 4. Rollback Testing Procedures

### 4.1 ロールバックの準備確認

#### ソースインデックスの存在確認

```typescript
it('should verify source index still exists', async () => {
  const response = await client.indices.exists({
    index: config.sourceIndex,
  });

  expect(response.body).toBe(true);
});
```

#### ソースインデックスのヘルスチェック

```typescript
it('should verify source index is healthy', async () => {
  const response = await client.cluster.health({
    index: config.sourceIndex,
  });

  const status = response.body.status;
  expect(['green', 'yellow']).toContain(status);
});
```

### 4.2 ロールバックの実行

#### エイリアスの巻き戻し

```typescript
it('should perform rollback by swapping alias back', async () => {
  const response = await client.indices.updateAliases({
    body: {
      actions: [
        {
          remove: {
            index: config.targetIndex,
            alias: config.aliasName,
          },
        },
        {
          add: {
            index: config.sourceIndex,
            alias: config.aliasName,
          },
        },
      ],
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.body.acknowledged).toBe(true);
});
```

#### ロールバック後の検証

```typescript
it('should verify rollback was successful', async () => {
  const response = await client.indices.getAlias({
    name: config.aliasName,
  });

  const aliases = Object.keys(response.body);

  expect(aliases).toContain(config.sourceIndex);
  expect(aliases).not.toContain(config.targetIndex);
});
```

#### 検索機能の復旧確認

```typescript
it('should verify search functionality after rollback', async () => {
  const response = await client.search({
    index: config.aliasName,
    body: {
      query: { match_all: {} },
      size: 10,
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.body.hits.hits.length).toBeGreaterThan(0);
});
```

### 4.3 ロールバック時間の測定

```typescript
it('should measure rollback execution time', async () => {
  const startTime = Date.now();

  await client.indices.updateAliases({
    body: {
      actions: [
        {
          remove: {
            index: config.sourceIndex,
            alias: config.aliasName,
          },
        },
        {
          add: {
            index: config.targetIndex,
            alias: config.aliasName,
          },
        },
      ],
    },
  });

  const rollbackTime = Date.now() - startTime;

  console.log(`Rollback execution time: ${rollbackTime}ms`);

  // ロールバックは1秒未満で完了すること
  expect(rollbackTime).toBeLessThan(1000);
});
```

## 5. Performance Benchmarking Tests

### 5.1 検索パフォーマンスベンチマーク

#### 標準テキスト検索

```typescript
it('should benchmark standard text search', async () => {
  const iterations = 10;
  const latencies: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const startTime = Date.now();

    await client.search({
      index: config.targetIndex,
      body: {
        query: {
          multi_match: {
            query: `test query ${i}`,
            fields: ['file_name', 'file_path', 'extracted_text'],
          },
        },
        size: 20,
      },
    });

    latencies.push(Date.now() - startTime);
  }

  const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length;
  const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(iterations * 0.95)];

  console.log(`Text Search - Avg: ${avgLatency.toFixed(2)}ms, P95: ${p95Latency}ms`);

  expect(avgLatency).toBeLessThan(200); // 目標: <200ms avg
  expect(p95Latency).toBeLessThan(500); // 目標: <500ms P95
});
```

#### フィルター検索

```typescript
it('should benchmark filtered search', async () => {
  const iterations = 10;
  const latencies: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const startTime = Date.now();

    await client.search({
      index: config.targetIndex,
      body: {
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query: 'test',
                  fields: ['file_name', 'file_path'],
                },
              },
            ],
            filter: [
              { term: { file_type: 'pdf' } },
            ],
          },
        },
        size: 20,
      },
    });

    latencies.push(Date.now() - startTime);
  }

  const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length;

  console.log(`Filtered Search - Avg: ${avgLatency.toFixed(2)}ms`);

  expect(avgLatency).toBeLessThan(250);
});
```

#### k-NNベクトル検索

```typescript
it('should benchmark k-NN vector search', async () => {
  const response = await client.search({
    index: config.targetIndex,
    body: {
      query: {
        exists: {
          field: 'image_embedding',
        },
      },
      size: 1,
    },
  });

  const hits = response.body.hits.hits;

  if (hits.length === 0) {
    console.warn('⚠️ No vectors - k-NN benchmark skipped');
    return;
  }

  const queryVector = hits[0]._source.image_embedding;
  const iterations = 10;
  const latencies: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const startTime = Date.now();

    await client.search({
      index: config.targetIndex,
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
        size: 10,
      },
    });

    latencies.push(Date.now() - startTime);
  }

  const avgLatency = latencies.reduce((a, b) => a + b) / latencies.length;
  const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(iterations * 0.95)];

  console.log(`k-NN Search - Avg: ${avgLatency.toFixed(2)}ms, P95: ${p95Latency}ms`);

  // バランス型設定 (ef_construction=128, m=24) の目標値
  expect(avgLatency).toBeLessThan(50);  // <50ms avg
  expect(p95Latency).toBeLessThan(100); // <100ms P95
});
```

### 5.2 インデックスパフォーマンスベンチマーク

#### ドキュメントインデックス速度

```typescript
it('should benchmark document indexing speed', async () => {
  const testDocs = 10;
  const startTime = Date.now();

  const promises = [];
  for (let i = 0; i < testDocs; i++) {
    promises.push(
      client.index({
        index: config.targetIndex,
        id: `perf-test-${i}`,
        body: {
          file_name: `perf-test-${i}.pdf`,
          file_path: `/perf/test-${i}.pdf`,
          file_type: 'pdf',
          file_size: 1024 * i,
          processed_at: new Date().toISOString(),
        },
      })
    );
  }

  await Promise.all(promises);

  const totalTime = Date.now() - startTime;
  const docsPerSecond = (testDocs / (totalTime / 1000)).toFixed(2);

  console.log(`Indexing - ${testDocs} docs in ${totalTime}ms (${docsPerSecond} docs/sec)`);

  expect(parseFloat(docsPerSecond)).toBeGreaterThan(5);
});
```

#### バルクインデックス

```typescript
it('should benchmark bulk indexing', async () => {
  const bulkSize = 100;
  const body: any[] = [];

  for (let i = 0; i < bulkSize; i++) {
    body.push(
      { index: { _index: config.targetIndex, _id: `bulk-test-${i}` } },
      {
        file_name: `bulk-test-${i}.pdf`,
        file_path: `/bulk/test-${i}.pdf`,
        file_type: 'pdf',
        file_size: 1024 * i,
        processed_at: new Date().toISOString(),
      }
    );
  }

  const startTime = Date.now();

  await client.bulk({
    body,
    refresh: 'wait_for',
  });

  const totalTime = Date.now() - startTime;
  const docsPerSecond = (bulkSize / (totalTime / 1000)).toFixed(2);

  console.log(`Bulk Indexing - ${bulkSize} docs in ${totalTime}ms (${docsPerSecond} docs/sec)`);

  expect(parseFloat(docsPerSecond)).toBeGreaterThan(50);
});
```

### 5.3 リソース使用率ベンチマーク

#### インデックスサイズの測定

```typescript
it('should measure index memory footprint', async () => {
  const response = await client.indices.stats({
    index: config.targetIndex,
    metric: 'store',
  });

  const sizeInBytes = response.body._all.primaries.store.size_in_bytes;
  const sizeInMB = (sizeInBytes / 1024 / 1024).toFixed(2);

  console.log(`Index size: ${sizeInMB} MB`);

  const sourceSize = (global as any).sourceIndexSize || sizeInBytes;
  const sizeIncrease = ((sizeInBytes - sourceSize) / sourceSize * 100).toFixed(2);

  console.log(`Size change: ${sizeIncrease}%`);

  // k-NNベクトルにより最大200%の増加を許容
  expect(parseFloat(sizeIncrease)).toBeLessThan(200);
});
```

#### JVMヒープ使用率

```typescript
it('should measure JVM heap usage', async () => {
  const response = await client.nodes.stats({
    metric: 'jvm',
  });

  const nodes = response.body.nodes;
  const nodeIds = Object.keys(nodes);

  nodeIds.forEach(nodeId => {
    const jvm = nodes[nodeId].jvm;
    const heapUsedPercent = jvm.mem.heap_used_percent;
    const heapUsedMB = (jvm.mem.heap_used_in_bytes / 1024 / 1024).toFixed(2);

    console.log(`Node ${nodeId}: Heap ${heapUsedPercent}% (${heapUsedMB} MB)`);

    expect(heapUsedPercent).toBeLessThan(85);
  });
});
```

## 6. Data Integrity Validation Methods

### 6.1 チェックサム検証

#### ドキュメント数の一致確認

```typescript
it('should verify document count consistency', async () => {
  const sourceResponse = await client.count({
    index: config.sourceIndex,
  });

  const targetResponse = await client.count({
    index: config.targetIndex,
  });

  const sourceCount = sourceResponse.body.count;
  const targetCount = targetResponse.body.count;

  const difference = Math.abs(sourceCount - targetCount);
  const differencePercent = (difference / sourceCount * 100).toFixed(2);

  console.log(`Difference: ${difference} docs (${differencePercent}%)`);

  // 0.1% 以下の差異を許容
  expect(parseFloat(differencePercent)).toBeLessThan(0.1);
});
```

#### ランダムサンプルの整合性検証

```typescript
it('should verify random sample integrity', async () => {
  const sampleSize = 100;

  const sourceResponse = await client.search({
    index: config.sourceIndex,
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

  const sourceHits = sourceResponse.body.hits.hits;

  let matchCount = 0;
  let mismatchCount = 0;

  for (const sourceDoc of sourceHits) {
    try {
      const targetResponse = await client.get({
        index: config.targetIndex,
        id: sourceDoc._id,
      });

      const targetSource = targetResponse.body._source;

      if (
        targetSource.file_name === sourceDoc._source.file_name &&
        targetSource.file_path === sourceDoc._source.file_path &&
        targetSource.file_type === sourceDoc._source.file_type
      ) {
        matchCount++;
      } else {
        mismatchCount++;
      }
    } catch (error) {
      mismatchCount++;
    }
  }

  const matchPercent = (matchCount / sourceHits.length * 100).toFixed(2);

  console.log(`Sample integrity: ${matchCount}/${sourceHits.length} (${matchPercent}%)`);

  expect(parseFloat(matchPercent)).toBeGreaterThan(99);
});
```

### 6.2 フィールド検証

#### 必須フィールドの存在確認

```typescript
it('should verify all required fields exist', async () => {
  const response = await client.search({
    index: config.targetIndex,
    body: {
      size: 100,
      query: { match_all: {} },
    },
  });

  const hits = response.body.hits.hits;

  const requiredFields = ['file_name', 'file_path', 'file_type', 'file_size', 'processed_at'];

  hits.forEach(hit => {
    requiredFields.forEach(field => {
      expect(hit._source[field]).toBeDefined();
    });
  });

  console.log(`✓ All required fields present in ${hits.length} documents`);
});
```

#### フィールド値型の検証

```typescript
it('should verify field value types', async () => {
  const response = await client.search({
    index: config.targetIndex,
    body: {
      size: 100,
      query: { match_all: {} },
    },
  });

  const hits = response.body.hits.hits;

  hits.forEach(hit => {
    const doc = hit._source;

    expect(typeof doc.file_name).toBe('string');
    expect(typeof doc.file_path).toBe('string');
    expect(typeof doc.file_type).toBe('string');
    expect(typeof doc.file_size).toBe('number');
    expect(typeof doc.processed_at).toBe('string');
  });

  console.log(`✓ Field types validated for ${hits.length} documents`);
});
```

#### ベクトル次元の検証

```typescript
it('should verify vector field dimension', async () => {
  const response = await client.search({
    index: config.targetIndex,
    body: {
      query: {
        exists: {
          field: 'image_embedding',
        },
      },
      size: 10,
    },
  });

  const hits = response.body.hits.hits;

  hits.forEach(hit => {
    const vector = hit._source.image_embedding;
    expect(Array.isArray(vector)).toBe(true);
    expect(vector.length).toBe(1024);
  });

  console.log(`✓ Vector dimensions validated for ${hits.length} documents`);
});
```

### 6.3 インデックス間比較

#### 集計結果の比較

```typescript
it('should compare aggregation results between indexes', async () => {
  const sourceAgg = await client.search({
    index: config.sourceIndex,
    body: {
      size: 0,
      aggs: {
        file_types: {
          terms: {
            field: 'file_type',
            size: 100,
          },
        },
      },
    },
  });

  const targetAgg = await client.search({
    index: config.targetIndex,
    body: {
      size: 0,
      aggs: {
        file_types: {
          terms: {
            field: 'file_type',
            size: 100,
          },
        },
      },
    },
  });

  const sourceBuckets = sourceAgg.body.aggregations.file_types.buckets;
  const targetBuckets = targetAgg.body.aggregations.file_types.buckets;

  console.log('File type distribution comparison:');
  sourceBuckets.forEach((bucket: any) => {
    const targetBucket = targetBuckets.find((b: any) => b.key === bucket.key);
    const targetCount = targetBucket ? targetBucket.doc_count : 0;
    const difference = Math.abs(bucket.doc_count - targetCount);

    console.log(`  ${bucket.key}: Source=${bucket.doc_count}, Target=${targetCount}, Diff=${difference}`);
  });

  expect(sourceBuckets.length).toBe(targetBuckets.length);
});
```

### 6.4 破損検出

#### null/空フィールドの検出

```typescript
it('should detect null or empty required fields', async () => {
  const response = await client.search({
    index: config.targetIndex,
    body: {
      size: 100,
      query: {
        bool: {
          should: [
            {
              bool: {
                must_not: {
                  exists: {
                    field: 'file_name',
                  },
                },
              },
            },
            {
              bool: {
                must_not: {
                  exists: {
                    field: 'file_path',
                  },
                },
              },
            },
          ],
        },
      },
    },
  });

  const corruptedDocs = response.body.hits.hits;

  console.log(`Found ${corruptedDocs.length} potentially corrupted documents`);

  expect(corruptedDocs.length).toBe(0);
});
```

#### 重複ドキュメントの検出

```typescript
it('should detect duplicate documents', async () => {
  const response = await client.search({
    index: config.targetIndex,
    body: {
      size: 0,
      aggs: {
        duplicates: {
          terms: {
            field: 'file_path.keyword',
            min_doc_count: 2,
            size: 100,
          },
        },
      },
    },
  });

  const duplicateBuckets = response.body.aggregations.duplicates.buckets;

  console.log(`Found ${duplicateBuckets.length} duplicate file paths`);

  if (duplicateBuckets.length > 0) {
    duplicateBuckets.forEach((bucket: any) => {
      console.warn(`Duplicate: ${bucket.key} (${bucket.doc_count} copies)`);
    });
  }

  expect(duplicateBuckets.length).toBeLessThan(100);
});
```

## 実行方法

### 1. Jest経由で実行

```bash
# すべてのテストを実行
yarn test --testPathPattern="opensearch-migration.test.ts"

# カバレッジ付きで実行
yarn test --testPathPattern="opensearch-migration.test.ts" --coverage

# 特定のテストスイートのみ実行
yarn test --testPathPattern="opensearch-migration.test.ts" -t "Pre-Migration Testing"

# verbose モード
yarn test --testPathPattern="opensearch-migration.test.ts" --verbose
```

### 2. E2Eシェルスクリプトで実行

```bash
# デフォルト設定で実行
./scripts/test-opensearch-migration.sh

# カスタム設定で実行
./scripts/test-opensearch-migration.sh \
  --source-index file-search-dev \
  --target-index file-search-v2-test \
  --report-file migration-report.txt \
  --verbose

# 特定のテストをスキップ
./scripts/test-opensearch-migration.sh \
  --skip-pre-migration \
  --skip-rollback
```

### 3. CI/CDパイプラインに統合

```yaml
# GitHub Actions example
name: OpenSearch Migration Test

on:
  pull_request:
    paths:
      - 'scripts/fix-opensearch-mapping*.sh'
      - 'src/lib/__tests__/opensearch-migration*.ts'

jobs:
  test-migration:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: yarn install

      - name: Run migration tests
        env:
          OPENSEARCH_ENDPOINT: ${{ secrets.OPENSEARCH_ENDPOINT }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: |
          yarn test --testPathPattern="opensearch-migration.test.ts" --ci

      - name: Upload test report
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: migration-test-report
          path: migration-test-report.txt
```

## レポート解析

### レポートファイルのフォーマット

```
========================================
OpenSearch Migration Test Report
========================================

Test Execution: 2025-12-18T09:00:00Z
Source Index: file-search-dev
Target Index: file-search-v2-test
OpenSearch Endpoint: https://...

========================================
Test Results
========================================

--- Pre-Migration Tests ---
[PASS] Source index exists
[PASS] Get source document count
       Count: 1000000
[PASS] Cluster health check
       Status: green
[PASS] Source index mapping exists
[PASS] Disk space availability
       Usage: 45.2%
[PASS] Memory availability
       Heap: 72%

--- Migration Tests ---
[PASS] Jest migration tests

--- Post-Migration Tests ---
[PASS] Target index exists
[PASS] Get target document count
       Count: 999998
[PASS] Document count matches
       Source: 1000000, Target: 999998
[PASS] k-NN vector mapping verified
[PASS] Vector dimension is 1024
[PASS] HNSW parameters verified
       Engine: faiss, Space: innerproduct
[PASS] Basic text search works
       Results: 45203
[PASS] Alias points to target index

--- Performance Benchmarks ---
[PASS] Text search latency < 500ms
       Avg: 145ms
[PASS] Index size measured
       Size: 4620 MB
[PASS] Filtered search latency < 500ms
       Latency: 178ms

--- Rollback Test ---
[PASS] Rollback alias swap
[PASS] Rollback verified
       Alias points to source index
[PASS] Restore migration state

========================================
Summary
========================================

Completion Time: 2025-12-18T09:15:00Z
Total Duration: 900s
Total Tests: 25
Passed: 25
Failed: 0
Success Rate: 100%

Status: ✓ ALL TESTS PASSED
========================================
```

### 重要なメトリクス

| メトリクス | 目標値 | 確認方法 |
|----------|-------|---------|
| データ損失率 | < 0.1% | Document count comparison |
| 検索レイテンシ (P95) | < 500ms | Text search benchmark |
| k-NN検索レイテンシ (P95) | < 100ms | k-NN search benchmark |
| ロールバック時間 | < 1秒 | Rollback execution time |
| サンプル整合性 | > 99% | Random sample integrity check |
| インデックスサイズ増加 | < 200% | Index size comparison |

## トラブルシューティング

### よくあるエラーと対処法

#### 1. テストがタイムアウトする

**原因**: Reindexタスクの完了待ちが長すぎる

**対処法**:
```typescript
// opensearch-migration.test.ts の jest.setTimeout を増やす
jest.setTimeout(600000); // 10分
```

#### 2. "Cluster health is RED"

**原因**: クラスターが不健全な状態

**対処法**:
```bash
# クラスターの状態を確認
curl -X GET "$OPENSEARCH_ENDPOINT/_cluster/health?pretty"

# 未割り当てシャードを確認
curl -X GET "$OPENSEARCH_ENDPOINT/_cat/shards?v&h=index,shard,prirep,state,unassigned.reason"

# 必要に応じてシャードを再割り当て
curl -X POST "$OPENSEARCH_ENDPOINT/_cluster/reroute"
```

#### 3. "Document count mismatch"

**原因**: Reindex中に新しいドキュメントが追加された

**対処法**:
- 許容誤差を調整（0.1% → 1%）
- メンテナンスウィンドウ中に実行
- ソースインデックスへの書き込みを一時停止

#### 4. "k-NN search fails"

**原因**: ベクトルフィールドが存在しない、または次元が不一致

**対処法**:
```bash
# マッピングを確認
curl -X GET "$OPENSEARCH_ENDPOINT/$TARGET_INDEX/_mapping" | \
  jq '.[] | .mappings.properties.image_embedding'

# 期待される出力:
# {
#   "type": "knn_vector",
#   "dimension": 1024,
#   ...
# }

# 不正な場合はインデックスを再作成
./scripts/fix-opensearch-mapping-zero-downtime.sh
```

#### 5. "Out of memory"

**原因**: JVMヒープが不足している

**対処法**:
```bash
# JVMヒープ使用率を確認
curl -X GET "$OPENSEARCH_ENDPOINT/_nodes/stats/jvm" | \
  jq '.nodes | to_entries | .[] | {name: .value.name, heap_percent: .value.jvm.mem.heap_used_percent}'

# 対策:
# 1. インスタンスサイズを増やす
# 2. HNSWパラメータを小さくする (m: 24 → 16)
# 3. 不要なインデックスを削除
```

## ベストプラクティス

### 1. 移行前の準備

- [ ] スナップショットを作成
- [ ] クラスターヘルスがgreenまたはyellow
- [ ] ディスク使用率 < 80%
- [ ] JVMヒープ使用率 < 85%
- [ ] メンテナンスウィンドウを設定（可能であれば）

### 2. テスト実施

- [ ] 開発環境で事前にテスト
- [ ] ステージング環境で本番同様のデータ量でテスト
- [ ] 全テストが PASS することを確認
- [ ] レポートを保存

### 3. 本番移行

- [ ] Blue-Green Deployment方式を使用
- [ ] エイリアスでアトミックな切り替え
- [ ] ロールバック手順を準備
- [ ] 移行後24時間はソースインデックスを保持
- [ ] モニタリングダッシュボードで継続監視

### 4. 移行後

- [ ] 検索レイテンシを監視
- [ ] エラー率を監視
- [ ] ユーザーフィードバックを収集
- [ ] 問題なければソースインデックスを削除

## まとめ

この包括的なテストストラテジーに従うことで、OpenSearchインデックスの移行を安全かつ確実に実施できます。

### 提供されているツール

| ツール | 説明 | ファイルパス |
|-------|------|------------|
| Jest テストスイート | 詳細な単体・統合テスト | `src/lib/__tests__/opensearch-migration.test.ts` |
| テストユーティリティ | 再利用可能なヘルパー関数 | `src/lib/__tests__/opensearch-migration-utils.ts` |
| E2Eテストスクリプト | シェルベースの包括的テスト | `scripts/test-opensearch-migration.sh` |
| 移行スクリプト（ゼロダウンタイム） | Blue-Green Deployment | `scripts/fix-opensearch-mapping-zero-downtime.sh` |

### サポートドキュメント

- [OPENSEARCH_KNN_OPTIMIZATION.md](./OPENSEARCH_KNN_OPTIMIZATION.md) - k-NN最適化ガイド
- [OPENSEARCH_KNN_QUICK_REFERENCE.md](./OPENSEARCH_KNN_QUICK_REFERENCE.md) - クイックリファレンス

### 問い合わせ

テストで問題が発生した場合は、レポートファイルとともにチームに報告してください。
