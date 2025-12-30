# Lambda Search API - 詳細設計書

## 1. アーキテクチャ概要

### 1.1 システム構成

```
┌──────────────┐
│   ユーザー    │
└──────┬───────┘
       │ HTTPS
       ▼
┌──────────────────────────────────┐
│     Amazon CloudFront            │
│   (CDN + 静的コンテンツ)          │
└──────┬───────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│     Next.js Frontend             │
│   (Cognito JWT取得)              │
└──────┬───────────────────────────┘
       │ HTTPS + JWT Token
       ▼
┌──────────────────────────────────┐
│     API Gateway (REST API)       │
│   - CORS設定                      │
│   - Cognito Authorizer           │
│   - リクエストバリデーション       │
└──────┬───────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│     Lambda Function              │
│   - Node.js 20.x (ARM64)         │
│   - OpenSearch接続               │
│   - クエリ処理・結果変換           │
└──────┬───────────────────────────┘
       │
       ▼
┌──────────────────────────────────┐
│   Amazon OpenSearch Service      │
│   - t3.small.search              │
│   - 100GB gp3                     │
│   - kuromoji analyzer            │
└──────────────────────────────────┘
```

### 1.2 データフロー

```
1. 検索リクエスト:
   User → CloudFront → Next.js → API Gateway → Lambda → OpenSearch

2. レスポンス:
   OpenSearch → Lambda (変換) → API Gateway → Next.js → User

3. 認証フロー:
   User → Cognito (ログイン) → JWT Token → API Gateway (検証)
```

---

## 2. Lambda関数設計

### 2.1 技術スタック

| 項目 | 選択 | 理由 |
|------|------|------|
| **Runtime** | Node.js 20.x | TypeScriptサポート、既存フロントエンドとの親和性 |
| **Architecture** | ARM64 (Graviton2) | 20%コスト削減、同等以上のパフォーマンス |
| **Memory** | 512MB | OpenSearch SDKのメモリ要件 |
| **Timeout** | 30秒 | 検索クエリは通常5秒以内、余裕を持たせる |
| **Concurrency** | 10 (Reserved) | 50ユーザー想定、Cold Start回避 |
| **VPC** | Private Subnet | OpenSearchへのセキュアアクセス |

### 2.2 環境変数

```bash
# OpenSearch接続
OPENSEARCH_ENDPOINT=https://search-xxx.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index
AWS_REGION=ap-northeast-1

# Cognito設定
COGNITO_USER_POOL_ID=ap-northeast-1_xxxxxxxxx
COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx

# ログ設定
LOG_LEVEL=info
NODE_ENV=production
```

### 2.3 IAMロール設定

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OpenSearchAccess",
      "Effect": "Allow",
      "Action": [
        "es:ESHttpGet",
        "es:ESHttpPost",
        "es:ESHttpHead"
      ],
      "Resource": "arn:aws:es:ap-northeast-1:ACCOUNT_ID:domain/cis-file-search/*"
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:ap-northeast-1:ACCOUNT_ID:log-group:/aws/lambda/cis-search-api:*"
    },
    {
      "Sid": "VPCNetworkInterface",
      "Effect": "Allow",
      "Action": [
        "ec2:CreateNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DeleteNetworkInterface"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## 3. API Gateway設計

### 3.1 エンドポイント設計

```
GET /api/v1/search
GET /api/v1/search/suggestions
GET /api/v1/search/stats
```

### 3.2 リクエスト仕様

#### 基本検索: `GET /api/v1/search`

**Query Parameters:**

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `q` | string | No | 検索クエリ | `報告書` |
| `searchMode` | string | No | AND/OR検索 (デフォルト: `or`) | `and` |
| `fileType` | string | No | ファイルタイプフィルター | `pdf` |
| `dateFrom` | string (ISO8601) | No | 開始日 | `2024-01-01` |
| `dateTo` | string (ISO8601) | No | 終了日 | `2025-12-31` |
| `page` | integer | No | ページ番号 (デフォルト: 1) | `1` |
| `limit` | integer | No | 結果数 (デフォルト: 20, 最大: 100) | `20` |
| `sortBy` | string | No | ソート基準 (`relevance`/`date`/`name`/`size`) | `relevance` |
| `sortOrder` | string | No | ソート順 (`asc`/`desc`) | `desc` |

**レスポンス (200 OK):**

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "file-123",
        "fileName": "2024年度報告書.pdf",
        "filePath": "/nas/documents/2024/report.pdf",
        "fileType": "pdf",
        "fileSize": 1048576,
        "modifiedDate": "2024-12-01T10:30:00Z",
        "snippet": "本報告書では2024年度の<mark>業績</mark>について...",
        "relevanceScore": 15.3,
        "highlights": {
          "fileName": ["2024年度<mark>報告書</mark>.pdf"],
          "extractedText": ["本報告書では2024年度の<mark>業績</mark>について"]
        }
      }
    ],
    "pagination": {
      "total": 150,
      "page": 1,
      "limit": 20,
      "totalPages": 8
    },
    "query": {
      "q": "報告書",
      "searchMode": "or",
      "fileType": "pdf",
      "sortBy": "relevance",
      "sortOrder": "desc"
    },
    "took": 45
  }
}
```

**エラーレスポンス:**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_QUERY",
    "message": "At least one search parameter is required",
    "details": {
      "field": "q",
      "reason": "Query string cannot be empty"
    }
  }
}
```

### 3.3 CORS設定

```json
{
  "Access-Control-Allow-Origin": "https://yourdomain.com",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "3600"
}
```

### 3.4 API Gatewayリクエストバリデーション

```json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "title": "Search Request Validator",
  "type": "object",
  "properties": {
    "q": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500
    },
    "page": {
      "type": "integer",
      "minimum": 1,
      "maximum": 1000
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    }
  }
}
```

---

## 4. OpenSearch統合

### 4.1 接続方式

- **VPC内プライベート接続**: Lambda → VPC Private Subnet → OpenSearch
- **認証**: AWS Signature V4 (IAMベース認証)
- **接続プール**: Lambda実行コンテキスト間で再利用

### 4.2 クエリ最適化

```typescript
// マルチフィールド検索 + Boosting
const query = {
  bool: {
    must: [
      {
        multi_match: {
          query: searchTerm,
          fields: [
            'file_name^3',        // ファイル名を最重視
            'file_path^2',        // パスを次に重視
            'extracted_text'      // 本文
          ],
          type: 'best_fields',
          operator: searchMode,   // 'and' または 'or'
          fuzziness: searchMode === 'or' ? 'AUTO' : '0'
        }
      }
    ],
    filter: [
      // ファイルタイプフィルター
      { term: { file_type: fileType } },
      // 日付範囲フィルター
      {
        range: {
          processed_at: {
            gte: dateFrom,
            lte: dateTo
          }
        }
      }
    ]
  }
};
```

### 4.3 エラーハンドリング

```typescript
try {
  const response = await opensearchClient.search({
    index: 'file-index',
    body: searchBody
  });
  return response.body;
} catch (error) {
  if (error.statusCode === 404) {
    // インデックスが存在しない
    throw new OpenSearchIndexNotFoundError();
  } else if (error.statusCode === 503) {
    // OpenSearchが一時的に利用不可
    throw new OpenSearchUnavailableError();
  } else {
    // その他のエラー
    logger.error('OpenSearch query failed', { error });
    throw new OpenSearchQueryError(error.message);
  }
}
```

---

## 5. 実装コード

### 5.1 ディレクトリ構造

```
lambda-search-api/
├── src/
│   ├── index.ts                 # Lambda handler
│   ├── services/
│   │   ├── opensearch.service.ts
│   │   └── logger.service.ts
│   ├── models/
│   │   ├── search-query.model.ts
│   │   └── search-result.model.ts
│   ├── utils/
│   │   ├── validator.ts
│   │   └── error-handler.ts
│   └── types/
│       └── index.ts
├── package.json
├── tsconfig.json
├── webpack.config.js            # Lambda最適化バンドル
└── README.md
```

### 5.2 Lambda Handler (`src/index.ts`)

このコードは次のセクションで提供します。

---

## 6. デプロイ方法

### 6.1 手動デプロイ

```bash
# 1. 依存関係インストール
cd backend/lambda-search-api
npm install

# 2. TypeScriptビルド
npm run build

# 3. Lambda関数作成
aws lambda create-function \
  --function-name cis-search-api \
  --runtime nodejs20.x \
  --architecture arm64 \
  --handler dist/index.handler \
  --role arn:aws:iam::ACCOUNT_ID:role/lambda-opensearch-role \
  --zip-file fileb://dist.zip \
  --memory-size 512 \
  --timeout 30 \
  --environment Variables="{OPENSEARCH_ENDPOINT=https://...,AWS_REGION=ap-northeast-1}"

# 4. VPC設定
aws lambda update-function-configuration \
  --function-name cis-search-api \
  --vpc-config SubnetIds=subnet-xxx,subnet-yyy,SecurityGroupIds=sg-xxx
```

### 6.2 API Gateway統合

```bash
# 1. REST API作成
aws apigateway create-rest-api \
  --name cis-search-api \
  --endpoint-configuration types=REGIONAL

# 2. Cognitoオーソライザー作成
aws apigateway create-authorizer \
  --rest-api-id API_ID \
  --name CognitoAuthorizer \
  --type COGNITO_USER_POOLS \
  --provider-arns arn:aws:cognito-idp:ap-northeast-1:ACCOUNT_ID:userpool/USER_POOL_ID \
  --identity-source method.request.header.Authorization

# 3. リソースとメソッド作成
aws apigateway put-method \
  --rest-api-id API_ID \
  --resource-id RESOURCE_ID \
  --http-method GET \
  --authorization-type COGNITO_USER_POOLS \
  --authorizer-id AUTHORIZER_ID

# 4. Lambda統合
aws apigateway put-integration \
  --rest-api-id API_ID \
  --resource-id RESOURCE_ID \
  --http-method GET \
  --type AWS_PROXY \
  --integration-http-method POST \
  --uri arn:aws:apigateway:ap-northeast-1:lambda:path/2015-03-31/functions/arn:aws:lambda:ap-northeast-1:ACCOUNT_ID:function:cis-search-api/invocations
```

### 6.3 Terraformデプロイ (推奨)

```hcl
# terraform/lambda-search-api.tf
resource "aws_lambda_function" "search_api" {
  function_name = "cis-search-api"
  role          = aws_iam_role.lambda_opensearch.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]

  filename         = "../backend/lambda-search-api/dist.zip"
  source_code_hash = filebase64sha256("../backend/lambda-search-api/dist.zip")

  memory_size = 512
  timeout     = 30

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.lambda_opensearch.id]
  }

  environment {
    variables = {
      OPENSEARCH_ENDPOINT = aws_opensearch_domain.main.endpoint
      OPENSEARCH_INDEX    = "file-index"
      AWS_REGION          = var.aws_region
      LOG_LEVEL           = "info"
    }
  }

  reserved_concurrent_executions = 10

  tags = {
    Name        = "CIS Search API"
    Environment = var.environment
  }
}

# API Gateway統合
resource "aws_api_gateway_rest_api" "search_api" {
  name        = "cis-search-api"
  description = "CIS File Search API"

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_authorizer" "cognito" {
  name          = "CognitoAuthorizer"
  rest_api_id   = aws_api_gateway_rest_api.search_api.id
  type          = "COGNITO_USER_POOLS"
  provider_arns = [aws_cognito_user_pool.main.arn]

  identity_source = "method.request.header.Authorization"
}
```

---

## 7. フロントエンド統合

### 7.1 API呼び出し例

```typescript
// src/services/search-api.service.ts
import { Auth } from 'aws-amplify';

interface SearchParams {
  query?: string;
  searchMode?: 'and' | 'or';
  fileType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
  sortBy?: 'relevance' | 'date' | 'name' | 'size';
  sortOrder?: 'asc' | 'desc';
}

export async function searchFiles(params: SearchParams) {
  try {
    // Cognito JWTトークンを取得
    const session = await Auth.currentSession();
    const idToken = session.getIdToken().getJwtToken();

    // クエリパラメータを構築
    const queryString = new URLSearchParams(
      Object.entries(params).filter(([_, v]) => v != null) as [string, string][]
    ).toString();

    // API Gateway経由でLambda呼び出し
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_GATEWAY_URL}/api/v1/search?${queryString}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error.message);
    }

    return await response.json();
  } catch (error) {
    console.error('Search API error:', error);
    throw error;
  }
}
```

### 7.2 React コンポーネント統合

```typescript
// src/app/search/page.tsx
'use client';

import { useState } from 'react';
import { searchFiles } from '@/services/search-api.service';

export const SearchPage = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const response = await searchFiles({
        query,
        page: 1,
        limit: 20,
        sortBy: 'relevance',
        sortOrder: 'desc',
      });

      setResults(response.data.results);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
      />
      <button onClick={handleSearch} disabled={loading}>
        検索
      </button>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div>
          {results.map((result) => (
            <div key={result.id}>
              <h3>{result.fileName}</h3>
              <p>{result.snippet}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

---

## 8. 移行手順

### Phase 1: Lambda関数実装 (1週間)
- [ ] Lambda関数コード実装
- [ ] OpenSearch接続テスト
- [ ] ユニットテスト作成

### Phase 2: API Gateway設定 (3日)
- [ ] API Gateway REST API作成
- [ ] Cognitoオーソライザー設定
- [ ] Lambda統合設定

### Phase 3: フロントエンド統合 (5日)
- [ ] 既存Next.js API Routes削除
- [ ] API呼び出しサービス実装
- [ ] エラーハンドリング実装
- [ ] 統合テスト

### Phase 4: デプロイと検証 (2日)
- [ ] Terraform適用
- [ ] E2Eテスト
- [ ] パフォーマンステスト
- [ ] 本番デプロイ

---

## 9. パフォーマンス目標

| 指標 | 目標値 | 測定方法 |
|------|--------|---------|
| **Cold Start** | < 500ms | CloudWatch Metrics |
| **検索レスポンス** | < 1秒 | API Gateway Latency |
| **スループット** | 100 req/sec | Load Testing (Locust) |
| **同時実行数** | 10 | Reserved Concurrency |
| **エラー率** | < 0.1% | CloudWatch Alarms |

---

## 10. 監視とアラート

### 10.1 CloudWatch Metrics

```typescript
// カスタムメトリクス
import { CloudWatch } from 'aws-sdk';

const cloudwatch = new CloudWatch();

await cloudwatch.putMetricData({
  Namespace: 'CIS/SearchAPI',
  MetricData: [
    {
      MetricName: 'SearchLatency',
      Value: responseTime,
      Unit: 'Milliseconds',
      Timestamp: new Date(),
    },
    {
      MetricName: 'SearchResultCount',
      Value: results.length,
      Unit: 'Count',
    },
  ],
}).promise();
```

### 10.2 アラート設定

```hcl
resource "aws_cloudwatch_metric_alarm" "search_api_errors" {
  alarm_name          = "cis-search-api-high-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = "60"
  statistic           = "Sum"
  threshold           = "10"
  alarm_description   = "Search API error rate is too high"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    FunctionName = aws_lambda_function.search_api.function_name
  }
}
```

---

## 11. コスト見積もり

| サービス | 詳細 | 月額 |
|---------|------|------|
| Lambda実行 | 10K検索/月 × 500ms × 512MB | $0.50 |
| Lambda Reserved Concurrency | 10同時実行 | $3.60 |
| API Gateway | 10K リクエスト/月 | $0.035 |
| CloudWatch Logs | 2GB/月 | $1.00 |
| **合計** | | **$5.14/月** |

---

## 12. セキュリティチェックリスト

- [ ] VPC内プライベート接続
- [ ] Cognito JWT検証
- [ ] IAMロール最小権限の原則
- [ ] 環境変数暗号化
- [ ] API Gatewayリクエストバリデーション
- [ ] SQLインジェクション対策
- [ ] XSS対策（入力サニタイゼーション）
- [ ] レート制限（API Gateway Throttling）
- [ ] CloudWatch Logsでの監査ログ

---

次のステップ: Lambda関数の完全な実装コードを提供します。

---

## 13. 画像検索機能の実装

### 13.1 概要

画像検索機能では、ユーザーがアップロードした画像と類似した画像ファイルをOpenSearchのベクトル検索で見つけます。

### 13.2 アーキテクチャ

```
┌────────────────┐
│  ユーザー       │
└────────┬───────┘
         │ 画像アップロード
         ▼
┌────────────────────────────┐
│  Next.js API Route         │
│  /api/image-embedding      │
│  - 画像受信・バリデーション  │
│  - AWS Bedrock呼び出し      │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│  AWS Bedrock               │
│  Titan Multimodal          │
│  Embeddings v1             │
│  - 1024次元ベクトル生成     │
└────────┬───────────────────┘
         │ embedding[]
         ▼
┌────────────────────────────┐
│  Lambda Search API         │
│  (未実装)                  │
│  - ベクトル類似度検索       │
│  - 信頼度90%以上フィルタ    │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│  OpenSearch                │
│  - dense_vector検索        │
│  - cosine similarity       │
└────────────────────────────┘
```

### 13.3 実装状況

#### ✅ 実装済み

1. **フロントエンド画像アップロードUI**
   - ファイル: `/frontend/src/components/search/ImageSearchDropdown.tsx`
   - 機能:
     - ドラッグ&ドロップ対応
     - 画像プレビュー表示
     - バリデーション（JPEG/PNG、最大5MB）
     - ローディング状態表示

2. **画像埋め込みAPI (Next.js API Route)**
   - ファイル: `/frontend/src/app/api/image-embedding/route.ts`
   - 機能:
     - AWS Bedrock Titan Multimodal Embeddings v1 呼び出し
     - 1024次元ベクトル生成
     - **モックモード**: 開発環境でAWS認証情報がない場合は自動的にダミーベクトルを生成
     - 詳細なエラーハンドリングとログ

3. **API Client**
   - ファイル: `/frontend/src/lib/api/imageSearch.ts`
   - 機能:
     - FormDataでの画像アップロード
     - エラーレスポンス処理
     - デバッグログ

#### ❌ 未実装

1. **Lambda ベクトル検索API**
   - 画像のベクトルを受け取ってOpenSearchで類似検索
   - 信頼度（コサイン類似度）90%以上の結果をフィルタ

2. **OpenSearch インデックスマッピング**
   - `image_embedding` フィールド（dense_vector, 1024次元）
   - コサイン類似度によるベクトル検索設定

3. **フロントエンド統合**
   - `SearchInterface.tsx` の `handleImageSearch` 関数実装
   - ベクトル検索APIエンドポイント呼び出し

### 13.4 開発環境での動作

#### モックモード（デフォルト）

AWS認証情報が設定されていない場合、自動的にモックモードで動作:

```bash
# .env.local に AWS認証情報がない場合
[Image Embedding API] Mock mode: true
[MOCK MODE] Using mock embedding instead of AWS Bedrock
[MOCK MODE] Generated mock embedding vector (1024 dimensions)
```

- ✅ 画像アップロード・プレビュー動作
- ✅ 1024次元ダミーベクトル生成
- ✅ エラーハンドリング確認
- ❌ 実際の画像検索（バックエンドAPI未実装）

#### 実運用モード

`.env.local` に以下を追加で、AWS Bedrockを使った実際の埋め込み生成が可能:

```bash
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-northeast-1
```

**重要**: 使用するIAMユーザーには `bedrock:InvokeModel` 権限が必要です。

### 13.5 OpenSearchインデックスマッピング設計

```json
{
  "mappings": {
    "properties": {
      "file_id": {
        "type": "keyword"
      },
      "file_name": {
        "type": "text",
        "analyzer": "kuromoji"
      },
      "file_path": {
        "type": "keyword"
      },
      "file_type": {
        "type": "keyword"
      },
      "file_size": {
        "type": "long"
      },
      "processed_at": {
        "type": "date"
      },
      "extracted_text": {
        "type": "text",
        "analyzer": "kuromoji"
      },
      "image_embedding": {
        "type": "dense_vector",
        "dims": 1024,
        "index": true,
        "similarity": "cosine"
      }
    }
  }
}
```

### 13.6 Lambda ベクトル検索API実装 (TODO)

#### エンドポイント

```
POST /api/v1/search/image
```

#### リクエスト

```json
{
  "embedding": [0.123, -0.456, ...],  // 1024次元
  "confidenceThreshold": 0.9,          // 信頼度閾値
  "limit": 20                          // 結果数
}
```

#### レスポンス

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "file-456",
        "fileName": "similar-image.jpg",
        "filePath": "/nas/images/2024/photo.jpg",
        "fileType": "jpg",
        "fileSize": 2048576,
        "modifiedDate": "2024-11-15T14:30:00Z",
        "similarity": 0.95,           // コサイン類似度
        "confidence": 0.95            // 信頼度
      }
    ],
    "pagination": {
      "total": 3,
      "page": 1,
      "limit": 20
    },
    "took": 120
  }
}
```

#### 実装例

```typescript
// src/services/vector-search.service.ts
import { Client } from '@opensearch-project/opensearch';

export async function searchByImageEmbedding(
  embedding: number[],
  confidenceThreshold: number = 0.9,
  limit: number = 20
) {
  const client = getOpenSearchClient();

  const response = await client.search({
    index: 'file-index',
    body: {
      size: limit,
      query: {
        script_score: {
          query: {
            match_all: {}
          },
          script: {
            source: "cosineSimilarity(params.query_vector, 'image_embedding') + 1.0",
            params: {
              query_vector: embedding
            }
          }
        }
      },
      min_score: confidenceThreshold + 1.0  // cosine similarity + 1.0
    }
  });

  return response.body.hits.hits
    .map((hit: any) => ({
      id: hit._id,
      ...hit._source,
      similarity: hit._score - 1.0,  // 元のスコアに戻す
      confidence: hit._score - 1.0
    }))
    .filter((result: any) => result.confidence >= confidenceThreshold);
}
```

### 13.7 デバッグ方法

#### サーバーログ確認

開発サーバーのターミナルで以下のログを確認:

```
[Image Embedding API] Starting image embedding request
[Image Embedding API] Mock mode: true
[Image Embedding API] Received file: { name: '01377.jpg', size: 10240, type: 'image/jpeg' }
[Image Embedding API] File converted to buffer, size: 10240
[Image Embedding API] File encoded to base64, length: 13654
[Image Embedding API] Generating embedding...
[MOCK MODE] Using mock embedding instead of AWS Bedrock
[MOCK MODE] Generated mock embedding vector (1024 dimensions)
[Image Embedding API] Embedding generated successfully, dimensions: 1024
```

#### ブラウザコンソール確認

Chrome DevToolsで以下のログを確認:

```
[Image Search API] Uploading image: { name: '01377.jpg', size: 10240, type: 'image/jpeg' }
[Image Search API] Response status: 200
[Image Search API] Response data: { success: true, data: { embedding: [...], dimensions: 1024 } }
[Image Search API] Upload successful, embedding dimensions: 1024
```

#### エラーパターン

1. **"Internal server error"が表示される**
   - サーバーログで詳細なエラーメッセージを確認
   - ブラウザのNetworkタブでAPIレスポンスを確認

2. **"AWS Bedrock service error"が表示される**
   - AWS認証情報が正しく設定されているか確認 (`.env.local`)
   - IAM権限 `bedrock:InvokeModel` が付与されているか確認
   - モックモードで動作確認してから実運用に移行

3. **"Access denied to AWS Bedrock"が表示される**
   - IAMユーザー/ロールに `bedrock:InvokeModel` 権限を追加

4. **"Bedrock model not available in this region"が表示される**
   - AWS Bedrock Titan Embeddingsが `ap-northeast-1` で利用可能か確認
   - 別のリージョン（`us-east-1` など）を試す

### 13.8 今後の実装計画

#### Phase 1: OpenSearchマッピング設定 (2日)
- [ ] `image_embedding` フィールド追加
- [ ] インデックス再作成スクリプト
- [ ] 既存ファイルの画像埋め込み生成バッチ処理

#### Phase 2: Lambda ベクトル検索API実装 (3日)
- [ ] ベクトル検索ロジック実装
- [ ] 信頼度フィルタリング
- [ ] ユニットテスト作成

#### Phase 3: フロントエンド統合 (2日)
- [ ] `SearchInterface.tsx` の `handleImageSearch` 実装
- [ ] API呼び出しとエラーハンドリング
- [ ] 統合テスト

#### Phase 4: 本番デプロイと検証 (1日)
- [ ] AWS Bedrock IAM権限設定
- [ ] E2Eテスト
- [ ] パフォーマンステスト

### 13.9 コスト見積もり

| サービス | 詳細 | 月額 |
|---------|------|------|
| **AWS Bedrock** | Titan Multimodal Embeddings v1 | $0.00006/画像 |
|                 | 100画像検索/月 | $0.006 |
| **Lambda実行** | ベクトル検索API (100リクエスト/月) | $0.05 |
| **OpenSearch** | ベクトル検索処理 (追加コストなし) | $0 |
| **合計** | | **$0.056/月** |

### 13.10 関連ファイル

- **フロントエンド UI**: `/frontend/src/components/search/ImageSearchDropdown.tsx`
- **埋め込みAPI**: `/frontend/src/app/api/image-embedding/route.ts`
- **API Client**: `/frontend/src/lib/api/imageSearch.ts`
- **統合コンポーネント**: `/frontend/src/components/search/SearchInterface.tsx`
- **TypeScript型定義**: `/frontend/src/types/index.ts`

---

## 14. OpenSearch接続トラブルシューティング

### 14.1 問題の概要

Lambda関数からOpenSearchエンドポイントへの接続時に以下のエラーが発生する可能性があります：

#### DNS解決エラー
```
getaddrinfo ENOTFOUND vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
```

#### 認証エラー
```
401 Unauthorized - Response Error | Meta: {"statusCode": 401}
```

### 14.2 根本原因と解決策

#### 原因1: Lambda環境変数のエンドポイントURLタイポ

**確認方法:**
```bash
aws lambda get-function-configuration --function-name cis-search-api-prod \
  --query 'Environment.Variables.OPENSEARCH_ENDPOINT' --output text
```

**正しいエンドポイント:**
```
vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
```

**修正コマンド:**
```bash
aws lambda update-function-configuration \
  --function-name cis-search-api-prod \
  --environment "Variables={
    OPENSEARCH_ENDPOINT=vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com,
    OPENSEARCH_INDEX=cis-files
  }"
```

#### 原因2: OpenSearch Fine-Grained Access Control (FGAC) の認証設定

OpenSearchのFGACが内部ユーザーデータベース認証を使用している場合、Lambda関数のIAMロールが認証されず401エラーが発生します。

**確認方法:**
```bash
aws opensearch describe-domain --domain-name cis-filesearch-opensearch \
  --query 'DomainStatus.AdvancedSecurityOptions'
```

**問題のある設定:**
```json
{
  "Enabled": true,
  "InternalUserDatabaseEnabled": true,
  "AnonymousAuthEnabled": false
}
```

**解決方法: Lambda実行ロールをマスターユーザーに設定**

1. Lambda実行ロールARNを取得:
```bash
aws lambda get-function-configuration --function-name cis-search-api-prod \
  --query 'Role' --output text
# 出力例: arn:aws:iam::770923989980:role/cis-lambda-search-api-role
```

2. OpenSearch設定を更新:
```bash
aws opensearch update-domain-config \
  --domain-name cis-filesearch-opensearch \
  --advanced-security-options '{
    "Enabled": true,
    "InternalUserDatabaseEnabled": false,
    "MasterUserOptions": {
      "MasterUserARN": "arn:aws:iam::770923989980:role/cis-lambda-search-api-role"
    }
  }'
```

**注意:** この更新には10-15分かかります。更新完了を待ってから次のステップに進んでください。

### 14.3 更新進行状況の監視

OpenSearchドメインの更新状況を監視するスクリプトを使用:

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
./scripts/monitor-opensearch-update.sh
```

**期待される出力:**
```
======================================
OpenSearchドメイン更新監視
ドメイン: cis-filesearch-opensearch
======================================

⏳ 更新中... (経過時間: 0分30秒)
⏳ 更新中... (経過時間: 1分0秒)
...
✅ 更新が完了しました！

{
  "Processing": false,
  "AdvancedSecurityOptions": {
    "Enabled": true,
    "InternalUserDatabaseEnabled": false,
    "AnonymousAuthEnabled": false
  }
}
```

### 14.4 接続テストの実行

OpenSearch更新完了後、Lambda関数の接続をテスト:

```bash
./scripts/test-lambda-connection.sh
```

**成功時の出力:**
```
======================================
Lambda関数接続テスト
関数名: cis-search-api-prod
======================================

1️⃣ Lambda関数の設定を確認
-----------------------------------
{
  "FunctionName": "cis-search-api-prod",
  "State": "Active",
  "LastUpdateStatus": "Successful",
  "Environment": {
    "OPENSEARCH_ENDPOINT": "vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com",
    "OPENSEARCH_INDEX": "cis-files"
  }
}

2️⃣ Lambda関数を実行
-----------------------------------
{
  "StatusCode": 200
}

3️⃣ レスポンス内容
-----------------------------------
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  },
  "body": "{\"success\":true,\"total\":150,\"results\":[...]}"
}

4️⃣ ステータスコード確認
-----------------------------------
✅ 成功: ステータスコード 200

5️⃣ 検索結果サマリー
-----------------------------------
{
  "success": true,
  "total": 150,
  "results_count": 5
}
```

### 14.5 両インデックスの検証

`cis-files` と `file-index-v2-knn` の両方のインデックスへの接続を確認:

```bash
./scripts/verify-opensearch-indices.sh
```

このスクリプトは各インデックスに対して:
1. Lambda環境変数を更新
2. テスト検索を実行
3. 接続結果とサンプルデータを表示

### 14.6 確認済みの正常な設定

以下の設定は既に正しく構成されています（追加の対応不要）:

#### VPC DNS設定
```bash
# 確認コマンド
aws ec2 describe-vpc-attribute --vpc-id vpc-02d08f2fa75078e67 --attribute enableDnsSupport
aws ec2 describe-vpc-attribute --vpc-id vpc-02d08f2fa75078e67 --attribute enableDnsHostnames

# 両方とも true
```

#### Lambda VPC設定
- **VPC ID**: vpc-02d08f2fa75078e67
- **Subnets**: 3つのプライベートサブネット (ap-northeast-1a, 1c, 1d)
- **Security Groups**: sg-06ee622d64e67f12f, sg-0c482a057b356a0c3

#### IAM権限
Lambda実行ロール (`cis-lambda-search-api-role`) には以下のポリシーがアタッチ済み:
- `AWSLambdaVPCAccessExecutionRole` - VPC内でのLambda実行
- `AWSLambdaBasicExecutionRole` - CloudWatch Logs書き込み
- `cis-lambda-opensearch-access` - OpenSearchへのアクセス権限

### 14.7 アーキテクチャ図

```
┌─────────────────┐
│   API Gateway   │
│  または Client  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│   Lambda Function                   │
│   (cis-search-api-prod)            │
│                                     │
│   - VPC: vpc-02d08f2fa75078e67     │
│   - Private Subnets (1a, 1c, 1d)   │
│   - IAM Role: cis-lambda-search-   │
│     api-role                        │
└────────┬────────────────────────────┘
         │
         │ AWS Signature V4
         │ (IAM認証)
         │
         ▼
┌─────────────────────────────────────┐
│   OpenSearch Domain                 │
│   (cis-filesearch-opensearch)      │
│                                     │
│   - VPC: vpc-02d08f2fa75078e67     │
│   - Subnet: subnet-0ea0487400a0b3627│
│   - FGAC: Enabled (IAM Master)     │
│                                     │
│   Indices:                          │
│   - cis-files                       │
│   - file-index-v2-knn               │
└─────────────────────────────────────┘
```

### 14.8 トラブルシューティングチェックリスト

接続問題が発生した場合、以下の順序で確認:

- [ ] Lambda環境変数のエンドポイントURLが正しいか
- [ ] VPC DNS設定が有効か (EnableDnsSupport, EnableDnsHostnames)
- [ ] Lambda関数が正しいVPCとサブネットに配置されているか
- [ ] OpenSearch FGACでLambda実行ロールがマスターユーザーに設定されているか
- [ ] Lambda実行ロールに適切なIAM権限があるか
- [ ] OpenSearchドメインの更新が完了しているか
- [ ] セキュリティグループで通信が許可されているか

### 14.9 関連スクリプト

- **更新監視**: `/scripts/monitor-opensearch-update.sh`
- **接続テスト**: `/scripts/test-lambda-connection.sh`
- **インデックス検証**: `/scripts/verify-opensearch-indices.sh`

### 14.10 サポート情報

問題が解決しない場合は、以下の情報を収集してサポートに問い合わせてください:

1. Lambda関数の実行ログ (CloudWatch Logs)
2. OpenSearchドメインのステータス
3. エラーメッセージの全文
4. 実行したコマンドと結果
5. VPC、サブネット、セキュリティグループの設定

---

次のステップ: Lambda ベクトル検索APIの実装を開始します。
