# 画像検索パフォーマンス最適化 実装ガイド

## エグゼクティブサマリー

このドキュメントは、CIS File Search Applicationの画像検索システムにおける包括的なパフォーマンス最適化の実装ガイドです。

### 最適化の対象範囲

1. **OpenSearch k-NN検索の最適化**
2. **Lambda関数の最適化（コールドスタート対策）**
3. **画像処理の最適化**
4. **マルチレイヤーキャッシング戦略**
5. **パフォーマンスベンチマークとモニタリング**

### 期待される効果

| 項目 | 最適化前 | 最適化後 | 改善率 |
|------|---------|---------|--------|
| クエリレイテンシ (P95) | 300-500ms | 50-100ms | **70-80%削減** |
| スループット | 10 QPS | 50-100 QPS | **5-10倍向上** |
| Lambda コールドスタート | 8-15秒 | 3-5秒 | **60%削減** |
| キャッシュヒット率 | 0% | 60-70% | **クエリ負荷60%削減** |
| メモリ使用量 | 32 GB | 16 GB (最適化時) | **50%削減可能** |

---

## 実装概要

### 新規作成ファイル

```
frontend/src/lib/
├── opensearch-performance.ts       # OpenSearch最適化モジュール
├── cache/
│   └── vector-search-cache.ts      # マルチレイヤーキャッシング
├── image-processing-optimizer.ts   # 画像処理最適化
└── performance-benchmark.ts        # ベンチマークツール

backend/lambda-image-embedding/
└── optimization.py                 # Lambda最適化モジュール

frontend/scripts/
└── run-performance-test.ts         # パフォーマンステストスクリプト
```

---

## 1. OpenSearch k-NN検索の最適化

### 実装ファイル

`frontend/src/lib/opensearch-performance.ts`

### 主要機能

#### 1.1 動的ef_search計算

データサイズとレイテンシ要件に基づいて最適なef_searchを自動計算:

```typescript
import { calculateOptimalEfSearch } from '@/lib/opensearch-performance';

const efSearch = calculateOptimalEfSearch(
  1_000_000,  // 1M documents
  100         // Target: 100ms
);
// => 256
```

#### 1.2 インデックス設定の最適化

```typescript
import {
  generateOptimizedSettings,
  createOptimizedIndexConfig,
} from '@/lib/opensearch-performance';

const config = {
  indexSize: 1_000_000,
  targetLatencyMs: 100,
  nodeCount: 2,
  memoryGB: 32,
};

const settings = generateOptimizedSettings(config);
const indexConfig = createOptimizedIndexConfig('file-index', config);

// OpenSearchにインデックス作成
await client.indices.create({
  index: 'file-index',
  body: indexConfig,
});
```

#### 1.3 最適化されたk-NNクエリ

```typescript
import { buildOptimizedKNNQuery } from '@/lib/opensearch-performance';

const query = buildOptimizedKNNQuery(imageVector, {
  k: 50,
  fileType: 'image',
  minScore: 0.7,
});

const response = await client.search({
  index: 'file-index',
  body: query,
});
```

#### 1.4 バッチ検索

複数ベクトルの一括検索:

```typescript
import { batchKNNSearch } from '@/lib/opensearch-performance';

const vectors = [vector1, vector2, vector3];
const results = await batchKNNSearch(
  client,
  vectors,
  'file-index',
  20  // k=20
);
```

#### 1.5 ページネーション最適化

search_after方式で効率的なページング:

```typescript
import { searchWithPagination } from '@/lib/opensearch-performance';

const { results, nextSearchAfter } = await searchWithPagination(
  client,
  vector,
  'file-index',
  20,  // page size
  previousSearchAfter
);
```

### 推奨設定値

#### データ量別の推奨設定

| ドキュメント数 | ef_search | シャード数 | インスタンス | メモリ |
|--------------|-----------|-----------|-------------|--------|
| < 100K       | 128       | 1         | t3.medium   | 4 GB   |
| 100K - 500K  | 256       | 2         | r6g.large   | 16 GB  |
| 500K - 1M    | 256-512   | 3         | r6g.xlarge  | 32 GB  |
| > 1M         | 512-1024  | 5-10      | r6g.2xlarge | 64 GB  |

---

## 2. マルチレイヤーキャッシング戦略

### 実装ファイル

`frontend/src/lib/cache/vector-search-cache.ts`

### アーキテクチャ

```
┌─────────────────────────────────────┐
│   Layer 1: In-Memory Cache (LRU)   │
│   - TTL: 5分                        │
│   - Size: 100 MB                    │
│   - Hit Rate: 40-50%                │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│   Layer 2: Redis Cache              │
│   - TTL: 30分                       │
│   - Size: 1 GB                      │
│   - Hit Rate: 30-40%                │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│   Layer 3: OpenSearch Query         │
│   - Request Cache                   │
│   - Hit Rate: 20-30%                │
└─────────────────────────────────────┘
```

### 使用方法

#### 基本的な使用方法

```typescript
import { vectorSearchCache } from '@/lib/cache/vector-search-cache';

// キャッシュから取得を試行
const cached = await vectorSearchCache.get(imageVector);

if (cached) {
  console.log('Cache hit!');
  return cached.results;
}

// キャッシュミス時はOpenSearchクエリを実行
const results = await executeOpenSearchQuery(imageVector);

// 結果をキャッシュに保存
await vectorSearchCache.set(imageVector, {
  results,
  total: results.length,
  took: 100,
  timestamp: Date.now(),
});
```

#### キャッシュ統計の取得

```typescript
const stats = vectorSearchCache.getCombinedStats();

console.log(`Overall Hit Rate: ${(stats.overall.overallHitRate * 100).toFixed(2)}%`);
console.log(`Memory Cache Hits: ${stats.memory.hits}`);
console.log(`Redis Cache Hits: ${stats.redis.hits}`);
```

### Redis設定（本番環境）

`.env`:
```env
REDIS_HOST=your-redis-endpoint.cache.amazonaws.com
REDIS_PORT=6379
REDIS_PASSWORD=your-password
```

---

## 3. Lambda関数の最適化

### 実装ファイル

`backend/lambda-image-embedding/optimization.py`

### 主要最適化

#### 3.1 推奨Lambda設定

```yaml
# Lambda Configuration
Memory: 3008 MB  # 3 GB
Timeout: 30 seconds
Ephemeral Storage: 512 MB
Reserved Concurrency: 20 (本番環境)

# Environment Variables
MODEL_NAME: openai/clip-vit-base-patch32
VECTOR_DIMENSION: 512
MAX_IMAGE_SIZE: 2048
TORCH_NUM_THREADS: 2
```

#### 3.2 Provisioned Concurrency

コールドスタートを最小化:

```python
from optimization import recommend_provisioned_concurrency

# 1分あたり平均100リクエストの場合
recommended = recommend_provisioned_concurrency(
    avg_requests_per_minute=100,
    target_cold_start_rate=0.01  # 1%
)
# => 5 instances
```

#### 3.3 メモリ使用量の最適化

```python
from optimization import get_memory_usage, log_performance_metrics

# メモリ使用状況を確認
memory = get_memory_usage()
print(f"RSS: {memory['rss_mb']:.2f} MB")
print(f"Percent: {memory['percent']:.2f}%")

# パフォーマンスメトリクスをCloudWatchにログ
log_performance_metrics()
```

#### 3.4 バッチ処理

複数画像の効率的な処理:

```python
from optimization import optimize_batch_processing

images = [image1_bytes, image2_bytes, image3_bytes, ...]
batches = optimize_batch_processing(images, max_batch_size=10)

# 各バッチを処理
for batch in batches:
    embeddings = process_batch(batch)
```

### Terraformでの設定例

```hcl
resource "aws_lambda_function" "image_embedding" {
  function_name = "cis-image-embedding"
  runtime       = "python3.9"
  handler       = "handler.lambda_handler"
  memory_size   = 3008
  timeout       = 30

  reserved_concurrent_executions = 20

  environment {
    variables = {
      MODEL_NAME           = "openai/clip-vit-base-patch32"
      VECTOR_DIMENSION     = "512"
      MAX_IMAGE_SIZE       = "2048"
      TORCH_NUM_THREADS    = "2"
      OMP_NUM_THREADS      = "2"
    }
  }
}

# Provisioned Concurrency
resource "aws_lambda_provisioned_concurrency_config" "image_embedding" {
  function_name                     = aws_lambda_function.image_embedding.function_name
  provisioned_concurrent_executions = 5
  qualifier                         = aws_lambda_function.image_embedding.version
}
```

---

## 4. 画像処理の最適化

### 実装ファイル

`frontend/src/lib/image-processing-optimizer.ts`

### 主要機能

#### 4.1 クライアント側の画像圧縮

アップロード前に画像を圧縮してネットワーク転送量を削減:

```typescript
import { compressImage } from '@/lib/image-processing-optimizer';

const originalFile = event.target.files[0];

const result = await compressImage(originalFile, {
  maxWidth: 2048,
  maxHeight: 2048,
  quality: 0.85,
  format: 'jpeg',
});

console.log(`Original: ${result.originalSize} bytes`);
console.log(`Compressed: ${result.compressedSize} bytes`);
console.log(`Ratio: ${result.compressionRatio.toFixed(2)}x`);

// 圧縮後のファイルをアップロード
await uploadImage(result.file);
```

#### 4.2 バッチ画像処理

複数画像の効率的な処理:

```typescript
import { batchProcessImages } from '@/lib/image-processing-optimizer';

const files = Array.from(event.target.files);

const result = await batchProcessImages(
  files,
  { quality: 0.85 },
  (processed, total) => {
    console.log(`Progress: ${processed}/${total}`);
  }
);

console.log(`Successfully processed: ${result.processed.length}`);
console.log(`Failed: ${result.failed.length}`);
console.log(`Average compression ratio: ${result.averageCompressionRatio.toFixed(2)}x`);
```

#### 4.3 画像バリデーション

```typescript
import { validateImageFile } from '@/lib/image-processing-optimizer';

const validation = validateImageFile(file);

if (!validation.isValid) {
  console.error(validation.error);
  return;
}
```

---

## 5. パフォーマンスベンチマーク

### 実装ファイル

- `frontend/src/lib/performance-benchmark.ts`
- `frontend/scripts/run-performance-test.ts`

### ベンチマークの実行

#### 環境変数の設定

```bash
export OPENSEARCH_ENDPOINT=https://your-opensearch-endpoint.es.amazonaws.com
export AWS_REGION=ap-northeast-1
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key
```

#### テストの実行

```bash
cd frontend
yarn add ts-node @types/node --dev
yarn ts-node scripts/run-performance-test.ts
```

### テスト内容

1. **Sequential Test**: 順次クエリ実行（50クエリ）
2. **Concurrent Test**: 同時クエリ実行（100クエリ、10並列）
3. **Stress Test**: 高負荷テスト（200クエリ、20並列）

### レポート出力

テスト完了後、以下のファイルが生成されます:

- `benchmark-sequential.json`
- `benchmark-concurrent.json`
- `benchmark-stress.json`

### プログラマティックな使用

```typescript
import {
  runKNNBenchmark,
  printBenchmarkReport,
  BenchmarkConfig,
} from '@/lib/performance-benchmark';

const config: BenchmarkConfig = {
  vectorDimension: 1024,
  testVectorCount: 10,
  queriesPerTest: 50,
  warmupQueries: 5,
  concurrentQueries: 1,
};

const result = await runKNNBenchmark(client, config);
printBenchmarkReport(result);
```

---

## 6. 統合実装例

### 画像検索の完全なフロー

```typescript
import { vectorSearchCache } from '@/lib/cache/vector-search-cache';
import { buildOptimizedKNNQuery } from '@/lib/opensearch-performance';
import { compressImage } from '@/lib/image-processing-optimizer';
import { uploadImageForEmbedding } from '@/lib/api/imageSearch';

/**
 * 最適化された画像検索フロー
 */
export const performOptimizedImageSearch = async (
  imageFile: File
): Promise<SearchResult[]> => {
  // Step 1: 画像を圧縮
  const compressed = await compressImage(imageFile, {
    maxWidth: 2048,
    maxHeight: 2048,
    quality: 0.85,
  });

  console.log(`Compression: ${compressed.compressionRatio.toFixed(2)}x`);

  // Step 2: 画像をベクトル化
  const embeddingResult = await uploadImageForEmbedding(compressed.file);

  if ('error' in embeddingResult) {
    throw new Error(embeddingResult.error);
  }

  const vector = embeddingResult.data.embedding;

  // Step 3: キャッシュをチェック
  const cached = await vectorSearchCache.get(vector);

  if (cached) {
    console.log('Cache hit! Returning cached results.');
    return cached.results;
  }

  // Step 4: OpenSearch k-NNクエリを実行
  const query = buildOptimizedKNNQuery(vector, {
    k: 50,
    minScore: 0.7,
  });

  const response = await client.search({
    index: 'file-index',
    body: query,
  });

  const results = response.body.hits.hits.map((hit: any) => ({
    id: hit._id,
    fileName: hit._source.file_name,
    filePath: hit._source.file_path,
    score: hit._score,
  }));

  // Step 5: 結果をキャッシュに保存
  await vectorSearchCache.set(vector, {
    results,
    total: results.length,
    took: response.body.took,
    timestamp: Date.now(),
  });

  return results;
};
```

---

## 7. モニタリングとアラート

### CloudWatch メトリクス

#### OpenSearch メトリクス

```typescript
// CloudWatch メトリクスの送信
const putMetric = async (
  metricName: string,
  value: number,
  unit: string = 'Milliseconds'
) => {
  const cloudwatch = new AWS.CloudWatch({ region: 'ap-northeast-1' });

  await cloudwatch.putMetricData({
    Namespace: 'CIS/ImageSearch',
    MetricData: [
      {
        MetricName: metricName,
        Value: value,
        Unit: unit,
        Timestamp: new Date(),
      },
    ],
  }).promise();
};

// クエリレイテンシを記録
await putMetric('SearchLatency', latencyMs, 'Milliseconds');
await putMetric('CacheHitRate', hitRate, 'Percent');
```

### アラート設定

```yaml
# CloudWatch Alarms
Alarms:
  - Name: HighSearchLatency
    Metric: SearchLatency
    Threshold: 200ms
    Period: 5min
    Action: SNS notification

  - Name: LowCacheHitRate
    Metric: CacheHitRate
    Threshold: 40%
    Period: 10min
    Action: SNS notification

  - Name: HighErrorRate
    Metric: ErrorRate
    Threshold: 5%
    Period: 5min
    Action: SNS notification + Auto-scaling
```

---

## 8. デプロイメント

### 段階的デプロイ

#### Phase 1: 開発環境

```bash
# 最適化モジュールをデプロイ
cd frontend
npm run build

# Lambdaをデプロイ
cd ../backend/lambda-image-embedding
./deploy.sh development
```

#### Phase 2: ステージング環境

```bash
# パフォーマンステストを実行
yarn ts-node scripts/run-performance-test.ts

# 結果が良好であればステージングにデプロイ
./deploy.sh staging
```

#### Phase 3: 本番環境

```bash
# A/Bテストを実施
# トラフィックの10%を新バージョンに向ける
# メトリクスを監視
# 問題なければ100%に切り替え

./deploy.sh production
```

### ロールバック手順

問題が発生した場合:

```bash
# 以前のバージョンに即座にロールバック
aws lambda update-function-configuration \
  --function-name cis-image-embedding \
  --environment Variables={ROLLBACK=true}

# OpenSearchインデックス設定を元に戻す
curl -X PUT "https://$OPENSEARCH_ENDPOINT/file-index/_settings" \
  -H 'Content-Type: application/json' \
  -d '{
    "index": {
      "knn.algo_param.ef_search": 128
    }
  }'
```

---

## 9. トラブルシューティング

### 高レイテンシ

**症状**: P95レイテンシが200ms以上

**対処**:
1. ef_searchを下げる (512 → 256)
2. キャッシュヒット率を確認
3. OpenSearchノード数を増やす

### キャッシュミス率が高い

**症状**: キャッシュヒット率が40%未満

**対処**:
1. キャッシュTTLを延長 (5分 → 10分)
2. キャッシュサイズを増やす
3. Redis層を追加

### Lambda コールドスタート

**症状**: コールドスタートが10秒以上

**対処**:
1. Provisioned Concurrencyを有効化
2. メモリを増やす (3GB → 4GB)
3. モデルをEFSに配置

---

## 10. 参考資料

### 公式ドキュメント

- [OpenSearch k-NN Plugin](https://opensearch.org/docs/latest/search-plugins/knn/)
- [AWS Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [AWS OpenSearch Service](https://docs.aws.amazon.com/opensearch-service/)

### 関連ドキュメント

- `/docs/OPENSEARCH_KNN_PERFORMANCE_OPTIMIZATION.md`
- `/docs/PERFORMANCE_OPTIMIZATION_DEPLOYMENT.md`
- `/frontend/docs/PERFORMANCE_OPTIMIZATION_REPORT.md`

---

## まとめ

この実装ガイドに従うことで、以下の最適化効果が期待できます:

| 指標 | 改善率 |
|------|--------|
| クエリレイテンシ削減 | **70-80%** |
| スループット向上 | **5-10倍** |
| コールドスタート削減 | **60%** |
| メモリ使用量削減 | **最大50%** |
| キャッシュヒット率 | **60-70%** |

すべての最適化モジュールは実装済みで、即座に使用可能です。段階的なデプロイとモニタリングを通じて、安全に本番環境に適用してください。
