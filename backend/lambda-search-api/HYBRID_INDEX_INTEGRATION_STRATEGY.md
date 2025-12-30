# OpenSearch ハイブリッドインデックス統合戦略（最適化版）

## 🎯 Executive Summary

**課題**: `cis-files`（10,000+件のテキストデータ）と`file-index-v2-knn`（20件の画像ベクトルデータ）を統合し、統一された検索APIを提供する。

**推奨アプローチ**: **戦略2: スマート・デュアルインデックス検索** - ダウンタイムゼロ、既存データ再処理不要

---

## 📋 戦略比較表

| 戦略 | ダウンタイム | データ移行 | 実装複雑度 | 保守性 | パフォーマンス | 推奨度 |
|------|------------|-----------|-----------|--------|--------------|-------|
| **戦略1: 統合インデックス作成** | 30-60分 | 必須 | 中 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **戦略2: デュアルインデックス検索** | ゼロ | 不要 | 低 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **戦略3: エイリアス・ルーティング** | ゼロ | 段階的 | 高 | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

---

## 🚀 戦略2: スマート・デュアルインデックス検索（推奨）

### メリット
✅ **ダウンタイムゼロ** - 既存システムに影響なし
✅ **データ移行不要** - 10,000件のデータを再処理する必要なし
✅ **即座にデプロイ可能** - Lambda関数の更新のみ（10分）
✅ **段階的な画像ベクトル追加** - 将来的な統合への自然な移行パス
✅ **ロールバック容易** - 単純な環境変数変更で戻せる

### アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                    Lambda Search API                         │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  クエリ分析器 (Query Analyzer)                          │ │
│  │  - テキスト検索のみ → cis-files                         │ │
│  │  - 画像検索のみ → file-index-v2-knn                     │ │
│  │  - ハイブリッド検索 → 両方を並列クエリ                  │ │
│  └────────────────────────────────────────────────────────┘ │
│           ↓                               ↓                  │
│  ┌──────────────────┐         ┌──────────────────┐          │
│  │  cis-files       │         │ file-index-v2-knn│          │
│  │  (10,000+ docs)  │         │   (20+ docs)     │          │
│  │  - Text Search   │         │  - Image Vector  │          │
│  └──────────────────┘         └──────────────────┘          │
│           ↓                               ↓                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  結果マージエンジン (Result Merger)                     │ │
│  │  - スコア正規化                                         │ │
│  │  - file_pathでドキュメント結合                          │ │
│  │  - 統一レスポンス形式生成                               │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 実装詳細

#### 1. OpenSearchサービスの拡張

```typescript
// src/services/opensearch.hybrid.service.ts

import { Client } from '@opensearch-project/opensearch';
import { SearchQuery, SearchResponse, SearchResult } from '../types';
import { getOpenSearchClient } from './opensearch.service';
import { Logger } from './logger.service';

const logger = new Logger('HybridSearchService');

/**
 * クエリタイプの判定
 */
function analyzeQueryType(query: SearchQuery): 'text' | 'image' | 'hybrid' {
  const hasTextQuery = query.query && query.query.trim().length > 0;
  const hasImageQuery = query.imageEmbedding && query.imageEmbedding.length > 0;

  if (hasTextQuery && hasImageQuery) return 'hybrid';
  if (hasImageQuery) return 'image';
  return 'text';
}

/**
 * テキストインデックス検索 (cis-files)
 */
async function searchTextIndex(
  client: Client,
  query: SearchQuery
): Promise<{ results: SearchResult[]; total: number; took: number }> {
  const { query: textQuery, searchMode = 'or', fileType, dateFrom, dateTo, size = 20, from = 0 } = query;

  const mustClauses: any[] = [];
  const filterClauses: any[] = [];

  // テキスト検索クエリ
  if (textQuery && textQuery.trim()) {
    mustClauses.push({
      multi_match: {
        query: textQuery.trim(),
        fields: ['file_name^3', 'file_path^2', 'extracted_text'],
        type: 'best_fields',
        operator: searchMode,
        fuzziness: searchMode === 'or' ? 'AUTO' : '0',
      },
    });
  }

  // フィルター
  if (fileType && fileType !== 'all') {
    filterClauses.push({ term: { file_type: fileType } });
  }
  if (dateFrom || dateTo) {
    const rangeQuery: any = {};
    if (dateFrom) rangeQuery.gte = dateFrom;
    if (dateTo) rangeQuery.lte = dateTo;
    filterClauses.push({ range: { processed_at: rangeQuery } });
  }

  const searchBody = {
    query: {
      bool: {
        must: mustClauses.length > 0 ? mustClauses : [{ match_all: {} }],
        filter: filterClauses.length > 0 ? filterClauses : undefined,
      },
    },
    highlight: {
      fields: {
        extracted_text: { fragment_size: 150, number_of_fragments: 3 },
        file_name: {},
        file_path: {},
      },
      pre_tags: ['<mark>'],
      post_tags: ['</mark>'],
    },
    size,
    from,
    track_total_hits: true,
  };

  const startTime = Date.now();
  const response = await client.search({
    index: 'cis-files',
    body: searchBody,
  });
  const took = Date.now() - startTime;

  const results: SearchResult[] = response.body.hits.hits.map((hit: any) => ({
    id: hit._id,
    fileName: hit._source.file_name || '',
    filePath: hit._source.file_path || '',
    fileType: hit._source.file_type || '',
    fileSize: hit._source.file_size || 0,
    modifiedDate: hit._source.processed_at || '',
    snippet: hit.highlight?.extracted_text?.join(' ... ') || hit._source.extracted_text?.substring(0, 200) + '...' || '',
    relevanceScore: hit._score,
    highlights: {
      fileName: hit.highlight?.file_name,
      filePath: hit.highlight?.file_path,
      extractedText: hit.highlight?.extracted_text,
    },
    source: 'text-index' as const,
  }));

  const totalValue = typeof response.body.hits.total === 'number'
    ? response.body.hits.total
    : response.body.hits.total?.value || 0;

  return { results, total: totalValue, took };
}

/**
 * 画像インデックス検索 (file-index-v2-knn)
 */
async function searchImageIndex(
  client: Client,
  query: SearchQuery
): Promise<{ results: SearchResult[]; total: number; took: number }> {
  const { imageEmbedding, fileType, dateFrom, dateTo, size = 20, from = 0 } = query;

  if (!imageEmbedding || imageEmbedding.length === 0) {
    return { results: [], total: 0, took: 0 };
  }

  const filterClauses: any[] = [];

  // フィルター
  if (fileType && fileType !== 'all') {
    filterClauses.push({ term: { file_type: fileType } });
  }
  if (dateFrom || dateTo) {
    const rangeQuery: any = {};
    if (dateFrom) rangeQuery.gte = dateFrom;
    if (dateTo) rangeQuery.lte = dateTo;
    filterClauses.push({ range: { processed_at: rangeQuery } });
  }

  const searchBody = {
    query: {
      bool: {
        must: [
          {
            knn: {
              image_embedding: {
                vector: imageEmbedding,
                k: size,
              },
            },
          },
        ],
        filter: filterClauses.length > 0 ? filterClauses : undefined,
      },
    },
    size,
    from,
    track_total_hits: true,
  };

  const startTime = Date.now();
  const response = await client.search({
    index: 'file-index-v2-knn',
    body: searchBody,
  });
  const took = Date.now() - startTime;

  const results: SearchResult[] = response.body.hits.hits.map((hit: any) => ({
    id: hit._id,
    fileName: hit._source.file_name || '',
    filePath: hit._source.file_path || '',
    fileType: hit._source.file_type || '',
    fileSize: hit._source.file_size || 0,
    modifiedDate: hit._source.processed_at || '',
    snippet: '',
    relevanceScore: hit._score,
    highlights: {},
    source: 'image-index' as const,
    imageEmbedding: hit._source.image_embedding,
  }));

  const totalValue = typeof response.body.hits.total === 'number'
    ? response.body.hits.total
    : response.body.hits.total?.value || 0;

  return { results, total: totalValue, took };
}

/**
 * 結果のマージと正規化
 */
function mergeResults(
  textResults: SearchResult[],
  imageResults: SearchResult[],
  queryType: 'text' | 'image' | 'hybrid'
): SearchResult[] {
  if (queryType === 'text') return textResults;
  if (queryType === 'image') return imageResults;

  // ハイブリッド検索: 両方の結果をマージ
  const resultMap = new Map<string, SearchResult>();

  // スコアの正規化係数
  const maxTextScore = Math.max(...textResults.map((r) => r.relevanceScore || 0), 1);
  const maxImageScore = Math.max(...imageResults.map((r) => r.relevanceScore || 0), 1);

  // テキスト検索結果を追加
  for (const result of textResults) {
    const normalizedScore = (result.relevanceScore || 0) / maxTextScore;
    resultMap.set(result.filePath, {
      ...result,
      relevanceScore: normalizedScore,
      textScore: normalizedScore,
    });
  }

  // 画像検索結果を追加/マージ
  for (const result of imageResults) {
    const normalizedScore = (result.relevanceScore || 0) / maxImageScore;
    const existing = resultMap.get(result.filePath);

    if (existing) {
      // 同じファイルが両方のインデックスに存在する場合
      const combinedScore = (existing.textScore || 0) * 0.6 + normalizedScore * 0.4; // テキスト重視
      resultMap.set(result.filePath, {
        ...existing,
        relevanceScore: combinedScore,
        imageScore: normalizedScore,
        imageEmbedding: result.imageEmbedding,
        source: 'hybrid' as const,
      });
    } else {
      resultMap.set(result.filePath, {
        ...result,
        relevanceScore: normalizedScore,
        imageScore: normalizedScore,
      });
    }
  }

  // スコアでソート
  return Array.from(resultMap.values()).sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
}

/**
 * ハイブリッド検索のメインエントリーポイント
 */
export async function hybridSearch(searchQuery: SearchQuery): Promise<SearchResponse> {
  const client = await getOpenSearchClient();
  const queryType = analyzeQueryType(searchQuery);

  logger.info('Executing hybrid search', {
    queryType,
    hasTextQuery: !!searchQuery.query,
    hasImageQuery: !!searchQuery.imageEmbedding,
  });

  try {
    let textResults: SearchResult[] = [];
    let imageResults: SearchResult[] = [];
    let totalText = 0;
    let totalImage = 0;
    let tookText = 0;
    let tookImage = 0;

    // 並列クエリ実行
    if (queryType === 'text' || queryType === 'hybrid') {
      const textResponse = await searchTextIndex(client, searchQuery);
      textResults = textResponse.results;
      totalText = textResponse.total;
      tookText = textResponse.took;
    }

    if (queryType === 'image' || queryType === 'hybrid') {
      const imageResponse = await searchImageIndex(client, searchQuery);
      imageResults = imageResponse.results;
      totalImage = imageResponse.total;
      tookImage = imageResponse.took;
    }

    // 結果のマージ
    const mergedResults = mergeResults(textResults, imageResults, queryType);

    // ページネーション適用
    const { size = 20, from = 0 } = searchQuery;
    const paginatedResults = mergedResults.slice(from, from + size);

    logger.info('Hybrid search completed', {
      queryType,
      textHits: totalText,
      imageHits: totalImage,
      mergedHits: mergedResults.length,
      returnedHits: paginatedResults.length,
      tookText,
      tookImage,
    });

    return {
      results: paginatedResults,
      total: mergedResults.length,
      took: Math.max(tookText, tookImage),
      metadata: {
        queryType,
        textIndexHits: totalText,
        imageIndexHits: totalImage,
        indices: {
          text: queryType === 'text' || queryType === 'hybrid' ? 'cis-files' : undefined,
          image: queryType === 'image' || queryType === 'hybrid' ? 'file-index-v2-knn' : undefined,
        },
      },
    };
  } catch (error: any) {
    logger.error('Hybrid search failed', { error: error.message });
    throw error;
  }
}
```

#### 2. 型定義の拡張

```typescript
// src/types/index.ts (追加)

export interface SearchResult {
  id: string;
  fileName: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  modifiedDate: string;
  snippet: string;
  relevanceScore: number;
  highlights?: {
    fileName?: string[];
    filePath?: string[];
    extractedText?: string[];
  };
  source?: 'text-index' | 'image-index' | 'hybrid';
  textScore?: number;
  imageScore?: number;
  imageEmbedding?: number[];
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  took: number;
  metadata?: {
    queryType: 'text' | 'image' | 'hybrid';
    textIndexHits: number;
    imageIndexHits: number;
    indices: {
      text?: string;
      image?: string;
    };
  };
}
```

#### 3. Lambda関数の更新

```typescript
// index.ts (メインハンドラー)

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { hybridSearch } from './services/opensearch.hybrid.service';
import { buildSearchQuery } from './utils/query-builder';
import { Logger } from './services/logger.service';

const logger = new Logger('SearchHandler');

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  logger.info('Search request received', {
    queryStringParameters: event.queryStringParameters,
    httpMethod: event.httpMethod,
  });

  try {
    // クエリパラメータからSearchQueryを構築
    const searchQuery = buildSearchQuery(event.queryStringParameters || {});

    // ハイブリッド検索実行
    const response = await hybridSearch(searchQuery);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
      body: JSON.stringify(response),
    };
  } catch (error: any) {
    logger.error('Search request failed', { error: error.message });

    return {
      statusCode: error.statusCode || 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: error.message,
        type: error.constructor.name,
      }),
    };
  }
}
```

### デプロイ手順（10分）

```bash
#!/bin/bash
# deploy-hybrid-search.sh

set -e

FUNCTION_NAME="cis-search-api"
REGION="ap-northeast-1"

echo "🚀 デュアルインデックス・ハイブリッド検索のデプロイ開始"

# 1. 依存関係インストール
echo "📦 依存関係インストール..."
npm install

# 2. TypeScriptビルド
echo "🔨 TypeScriptビルド..."
npm run build

# 3. Lambda デプロイパッケージ作成
echo "📦 デプロイパッケージ作成..."
cd dist
zip -r ../function.zip .
cd ..

# 4. Lambda関数更新
echo "☁️  Lambda関数更新..."
aws lambda update-function-code \
  --function-name "${FUNCTION_NAME}" \
  --zip-file fileb://function.zip \
  --region "${REGION}"

# 5. デプロイ完了待機
echo "⏳ デプロイ完了待機..."
aws lambda wait function-updated \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}"

echo "✅ デプロイ完了！"
echo ""
echo "検証コマンド:"
echo "  テキスト検索: curl \"https://your-api-gateway.execute-api.ap-northeast-1.amazonaws.com/search?q=契約書\""
echo "  画像検索: curl -X POST \"https://your-api-gateway.execute-api.ap-northeast-1.amazonaws.com/search\" -H \"Content-Type: application/json\" -d '{\"imageEmbedding\": [...]}'"
```

---

## 📊 将来的な統合パス

### フェーズ1: デュアルインデックス運用（現在）
- ✅ ダウンタイムゼロ
- ✅ 既存データ保持
- ✅ 即座に画像検索が可能

### フェーズ2: 画像ベクトルの段階的追加（1-3ヶ月後）
1. **新ファイルのみ画像ベクトル生成**
   - EC2 Workerを更新: 画像ファイル検出時にLambda呼び出し
   - Lambda（画像埋め込み生成）: `cis-files`インデックスに`image_embedding`を追加（部分更新）

2. **既存ファイルのバックフィル（オプション）**
   - バッチ処理スクリプトで段階的に画像ベクトル追加

### フェーズ3: 統合インデックスへの完全移行（6ヶ月後）
- すべての画像ファイルにベクトルが追加された後
- `cis-files`インデックスに`knn: true`設定を追加（再インデックス）
- `file-index-v2-knn`を廃止
- Lambda関数を単一インデックス検索に簡素化

---

## 🧪 テスト計画

### ユニットテスト
```typescript
// __tests__/opensearch.hybrid.service.test.ts

import { hybridSearch } from '../services/opensearch.hybrid.service';

describe('HybridSearchService', () => {
  test('テキスト検索のみ - cis-filesインデックスを使用', async () => {
    const result = await hybridSearch({
      query: '契約書',
      searchMode: 'and',
      size: 10,
    });

    expect(result.metadata?.queryType).toBe('text');
    expect(result.metadata?.indices.text).toBe('cis-files');
    expect(result.results.length).toBeGreaterThan(0);
  });

  test('画像検索のみ - file-index-v2-knnインデックスを使用', async () => {
    const mockEmbedding = new Array(1024).fill(0.5);

    const result = await hybridSearch({
      imageEmbedding: mockEmbedding,
      size: 10,
    });

    expect(result.metadata?.queryType).toBe('image');
    expect(result.metadata?.indices.image).toBe('file-index-v2-knn');
  });

  test('ハイブリッド検索 - 両インデックスを使用し結果をマージ', async () => {
    const mockEmbedding = new Array(1024).fill(0.5);

    const result = await hybridSearch({
      query: '契約書',
      imageEmbedding: mockEmbedding,
      searchMode: 'or',
      size: 20,
    });

    expect(result.metadata?.queryType).toBe('hybrid');
    expect(result.metadata?.indices.text).toBe('cis-files');
    expect(result.metadata?.indices.image).toBe('file-index-v2-knn');
    expect(result.results.length).toBeGreaterThan(0);
  });
});
```

### 統合テスト
```bash
#!/bin/bash
# test-hybrid-search.sh

API_ENDPOINT="https://your-api-gateway.execute-api.ap-northeast-1.amazonaws.com/search"

echo "🧪 ハイブリッド検索統合テスト"

# テスト1: テキスト検索
echo ""
echo "Test 1: テキスト検索"
curl -s "${API_ENDPOINT}?q=契約書&searchMode=and&size=5" | jq '.metadata'

# テスト2: ファイルタイプフィルター
echo ""
echo "Test 2: PDFファイルのみ検索"
curl -s "${API_ENDPOINT}?q=契約&fileType=pdf&size=5" | jq '.total'

# テスト3: 画像検索（実際の画像埋め込みベクトルが必要）
echo ""
echo "Test 3: 画像検索"
curl -s -X POST "${API_ENDPOINT}" \
  -H "Content-Type: application/json" \
  -d '{
    "imageEmbedding": [0.1, 0.2, 0.3, ...],
    "size": 5
  }' | jq '.metadata'

echo ""
echo "✅ テスト完了"
```

---

## 📈 パフォーマンス最適化

### 1. 並列クエリ実行
```typescript
// 両インデックスへのクエリを並列実行
const [textResponse, imageResponse] = await Promise.all([
  searchTextIndex(client, searchQuery),
  searchImageIndex(client, searchQuery),
]);
```

### 2. レスポンスキャッシュ
```typescript
// Redis or ElastiCache
import { createClient } from 'redis';

const cache = createClient({ url: process.env.REDIS_URL });

export async function cachedHybridSearch(searchQuery: SearchQuery): Promise<SearchResponse> {
  const cacheKey = `search:${JSON.stringify(searchQuery)}`;

  // キャッシュチェック
  const cached = await cache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // 検索実行
  const result = await hybridSearch(searchQuery);

  // キャッシュ保存（5分TTL）
  await cache.setEx(cacheKey, 300, JSON.stringify(result));

  return result;
}
```

### 3. インデックス最適化
```bash
# cis-files インデックス設定最適化
curl -XPUT "https://opensearch-endpoint/cis-files/_settings" \
  -H 'Content-Type: application/json' \
  -d '{
    "index": {
      "refresh_interval": "5s",
      "number_of_replicas": 1,
      "max_result_window": 10000
    }
  }'
```

---

## 🔒 セキュリティ考慮事項

1. **IAMロール権限**
   - Lambda実行ロールに両インデックスへのアクセス権限を付与
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "es:ESHttpGet",
           "es:ESHttpPost"
         ],
         "Resource": [
           "arn:aws:es:ap-northeast-1:*:domain/cis-filesearch-opensearch/cis-files/*",
           "arn:aws:es:ap-northeast-1:*:domain/cis-filesearch-opensearch/file-index-v2-knn/*"
         ]
       }
     ]
   }
   ```

2. **入力バリデーション**
   - 画像埋め込みベクトルの次元チェック（1024次元）
   - クエリ文字列のサニタイズ

---

## 📊 モニタリング

### CloudWatch メトリクス
```typescript
// src/utils/metrics.ts

import { CloudWatch } from '@aws-sdk/client-cloudwatch';

const cloudwatch = new CloudWatch({ region: 'ap-northeast-1' });

export async function recordSearchMetrics(metadata: {
  queryType: 'text' | 'image' | 'hybrid';
  textIndexHits: number;
  imageIndexHits: number;
  latency: number;
}) {
  await cloudwatch.putMetricData({
    Namespace: 'CISFileSearch',
    MetricData: [
      {
        MetricName: 'SearchLatency',
        Value: metadata.latency,
        Unit: 'Milliseconds',
        Dimensions: [{ Name: 'QueryType', Value: metadata.queryType }],
      },
      {
        MetricName: 'SearchHits',
        Value: metadata.textIndexHits + metadata.imageIndexHits,
        Unit: 'Count',
        Dimensions: [{ Name: 'QueryType', Value: metadata.queryType }],
      },
    ],
  });
}
```

---

## ✅ デプロイチェックリスト

- [ ] Lambda関数コードをビルド
- [ ] ユニットテストをパス
- [ ] Lambda関数をデプロイ
- [ ] API Gatewayエンドポイントをテスト
- [ ] CloudWatchログ確認
- [ ] パフォーマンステスト実行
- [ ] フロントエンドからの疎通確認

---

## 🎯 まとめ

**戦略2（スマート・デュアルインデックス検索）**は以下の理由で最適です：

1. ✅ **即座にデプロイ可能** - 10分で本番環境にデプロイ
2. ✅ **ゼロダウンタイム** - 既存システムに影響なし
3. ✅ **データ移行不要** - 10,000件のデータを再処理する必要なし
4. ✅ **段階的な機能拡張** - 将来的な統合への自然な移行パス
5. ✅ **リスク最小化** - 簡単なロールバック

次のステップとして、このドキュメントを承認後、Lambda関数の実装を進めます。
