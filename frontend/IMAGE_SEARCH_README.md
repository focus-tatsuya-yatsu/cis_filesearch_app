# 画像検索機能 - 完全実装ガイド

## 概要

CIS File Search Applicationの画像検索機能の完全実装ガイド。AWS Bedrock Titan Embeddingsを使用した1024次元ベクトル検索により、高精度な画像類似検索を実現します。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Image Search Flow                            │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────┐
│   User       │
│   Upload     │
│   Image      │
└──────┬───────┘
       │
       v
┌──────────────────────────────────────────────────────────────────┐
│  Frontend (Next.js)                                               │
│                                                                   │
│  ┌──────────────────────┐      ┌──────────────────────┐          │
│  │ /api/image-embedding │      │ /api/save-image-     │          │
│  │                      │      │      embedding       │          │
│  │ • ファイル検証       │      │ • OpenSearch更新     │          │
│  │ • Bedrock呼び出し    │──────>│ • ドキュメントUPSERT │          │
│  │ • ベクトル生成       │      │ • エラーハンドリング │          │
│  └──────────────────────┘      └──────────────────────┘          │
│           │                              │                        │
└───────────┼──────────────────────────────┼────────────────────────┘
            │                              │
            v                              v
    ┌───────────────┐            ┌─────────────────┐
    │ AWS Bedrock   │            │  OpenSearch     │
    │ Titan Embed   │            │  cis-files      │
    │               │            │  • image_       │
    │ • us-east-1   │            │    embedding    │
    │ • 1024次元    │            │  • knn_vector   │
    └───────────────┘            └─────────────────┘

┌──────────────┐
│   User       │
│   Search     │
│   by Image   │
└──────┬───────┘
       │
       v
┌──────────────────────────────────────────────────────────────────┐
│  Frontend (Next.js)                                               │
│                                                                   │
│  ┌──────────────────────────────────────────────────────┐        │
│  │ /api/search (POST)                                   │        │
│  │                                                       │        │
│  │ • imageEmbedding: [1024 dimensions]                  │        │
│  │ • filters (fileType, dateRange)                      │        │
│  │ • pagination                                         │        │
│  └──────────────────────────────────────────────────────┘        │
│           │                                                       │
└───────────┼───────────────────────────────────────────────────────┘
            │
            v
    ┌───────────────────┐
    │  API Gateway      │
    │  (VPC Link)       │
    └────────┬──────────┘
             │
             v
    ┌───────────────────┐
    │  Lambda Function  │
    │  cis-search-api   │
    │                   │
    │  • KNN検索        │
    │  • フィルター     │
    │  • ソート         │
    └────────┬──────────┘
             │
             v
    ┌─────────────────┐
    │  OpenSearch     │
    │  • KNN query    │
    │  • script_score │
    │  • cosinesimil  │
    └─────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Batch Processing (Existing Images)                              │
│                                                                   │
│  ┌──────────────────────────────────────────────────────┐        │
│  │ /services/batch-process-images.ts                    │        │
│  │                                                       │        │
│  │ 1. S3バケットをスキャン                               │        │
│  │ 2. 各画像をダウンロード                               │        │
│  │ 3. Bedrockでベクトル化                                │        │
│  │ 4. OpenSearchに保存                                   │        │
│  │                                                       │        │
│  │ • 並列処理 (BATCH_SIZE: 10)                          │        │
│  │ • 自動リトライ (RETRY_ATTEMPTS: 3)                   │        │
│  │ • 進捗ログ                                           │        │
│  └──────────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────┘
```

## ディレクトリ構造

```
cis_filesearch_app/
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   └── api/
│   │   │       ├── image-embedding/
│   │   │       │   └── route.ts              # ベクトル生成API
│   │   │       ├── save-image-embedding/
│   │   │       │   └── route.ts              # ベクトル保存API
│   │   │       ├── batch-process-images/
│   │   │       │   └── route.ts              # バッチ処理API
│   │   │       └── search/
│   │   │           └── route.ts              # 検索API
│   │   ├── lib/
│   │   │   └── opensearch.ts                 # OpenSearchクライアント
│   │   └── services/
│   │       └── batch-process-images.ts       # バッチ処理スクリプト
│   ├── scripts/
│   │   └── verify-image-search.sh            # 検証スクリプト
│   ├── IMAGE_SEARCH_IMPLEMENTATION.md        # 詳細実装ガイド
│   ├── IMAGE_SEARCH_QUICKSTART.md            # クイックスタート
│   ├── IMAGE_SEARCH_SOLUTION_SUMMARY.md      # 解決策サマリー
│   └── IMAGE_SEARCH_README.md                # このファイル
└── backend/
    └── lambda-search-api/
        ├── src/
        │   └── services/
        │       └── opensearch.service.enhanced.ts  # KNN検索実装
        └── scripts/
            └── quick-deploy.sh                     # デプロイスクリプト
```

## クイックスタート（3ステップ）

### 前提条件

```bash
# 環境変数を設定
export OPENSEARCH_ENDPOINT="vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
export OPENSEARCH_INDEX="cis-files"
export AWS_REGION="ap-northeast-1"
export S3_BUCKET_NAME="cis-filesearch-thumbnails"
export NEXT_PUBLIC_API_URL="http://localhost:3000"

# AWS認証情報
aws configure
```

### Step 1: バッチ処理（既存画像）

```bash
cd frontend
npx ts-node src/services/batch-process-images.ts
```

**実行時間:** 約10-15分（100件の場合）

### Step 2: Lambda関数デプロイ

```bash
cd ../backend/lambda-search-api
chmod +x scripts/quick-deploy.sh
./scripts/quick-deploy.sh
```

**実行時間:** 約2-3分

### Step 3: 動作確認

```bash
cd ../../frontend
./scripts/verify-image-search.sh
```

## API仕様

### 1. 画像ベクトル生成

**エンドポイント:** `POST /api/image-embedding`

**リクエスト:**
```bash
curl -X POST http://localhost:3000/api/image-embedding \
  -F "image=@/path/to/image.jpg"
```

**レスポンス:**
```json
{
  "success": true,
  "data": {
    "embedding": [0.123, -0.456, ..., 0.789],
    "dimensions": 1024,
    "fileName": "image.jpg",
    "fileSize": 245678,
    "fileType": "image/jpeg"
  }
}
```

### 2. ベクトル保存

**エンドポイント:** `POST /api/save-image-embedding`

**リクエスト:**
```bash
curl -X POST http://localhost:3000/api/save-image-embedding \
  -H "Content-Type: application/json" \
  -d '{
    "s3Key": "thumbnails/image.jpg",
    "imageEmbedding": [0.123, -0.456, ..., 0.789],
    "fileName": "image.jpg",
    "filePath": "thumbnails/image.jpg"
  }'
```

**レスポンス:**
```json
{
  "success": true,
  "message": "Image embedding saved successfully",
  "documentId": "dGh1bWJuYWlscy9pbWFnZS5qcGc=",
  "result": "updated"
}
```

### 3. 画像検索

**エンドポイント:** `POST /api/search`

**リクエスト:**
```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "imageEmbedding": [0.123, -0.456, ..., 0.789],
    "size": 20,
    "page": 1,
    "fileType": "jpg",
    "sortBy": "relevance"
  }'
```

**レスポンス:**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "doc123",
        "fileName": "similar-image1.jpg",
        "filePath": "thumbnails/similar-image1.jpg",
        "fileType": "jpg",
        "fileSize": 245678,
        "modifiedDate": "2024-12-18T10:30:00Z",
        "relevanceScore": 0.95,
        "snippet": "..."
      }
    ],
    "pagination": {
      "total": 15,
      "page": 1,
      "limit": 20,
      "totalPages": 1
    },
    "query": {
      "searchType": "image",
      "fileType": "jpg",
      "sortBy": "relevance"
    },
    "took": 125
  }
}
```

### 4. バッチ処理

**エンドポイント:** `POST /api/batch-process-images`

**リクエスト:**
```bash
curl -X POST http://localhost:3000/api/batch-process-images \
  -H "Content-Type: application/json" \
  -d '{
    "maxFiles": 100,
    "batchSize": 10,
    "prefix": "thumbnails/"
  }'
```

**レスポンス:**
```json
{
  "success": true,
  "message": "Batch processing completed",
  "stats": {
    "total": 100,
    "processed": 100,
    "successful": 98,
    "failed": 2,
    "successRate": "98.00%",
    "errors": [
      "file1.jpg: Connection timeout",
      "file2.jpg: Invalid format"
    ]
  }
}
```

## 技術仕様

### ベクトル生成

- **モデル:** AWS Bedrock Titan Multimodal Embeddings
- **モデルID:** `amazon.titan-embed-image-v1`
- **次元数:** 1024
- **リージョン:** us-east-1（Titan Embeddingsはus-east-1のみ）
- **入力形式:** JPEG, PNG（最大5MB）
- **処理時間:** 約1-2秒/画像

### KNN検索

- **距離指標:** コサイン類似度（cosinesimil）
- **検索方式:** OpenSearch k-NN plugin
- **デフォルトk値:** `size * 3`（最低50）
- **フィルター:** ファイルタイプ、日付範囲に対応
- **検索速度:** 50-200ms（k=50の場合）

### バッチ処理

- **並列度:** 10件並列（設定可能）
- **リトライ:** 最大3回、1秒間隔
- **対応形式:** .jpg, .jpeg, .png
- **処理速度:** 約10件/分
- **エラーハンドリング:** 自動リトライ + 詳細ログ

## パフォーマンスチューニング

### バッチ処理の並列度

```typescript
// src/services/batch-process-images.ts
const CONFIG = {
  // 小規模（100件以下）
  BATCH_SIZE: 10,

  // 中規模（1000件）
  BATCH_SIZE: 20,

  // 大規模（10000件以上）
  BATCH_SIZE: 30-50,
};
```

### 検索のk値調整

```typescript
// Lambda関数: opensearch.service.enhanced.ts
// より高精度
k: Math.max(size * 5, 100)

// デフォルト
k: Math.max(size * 3, 50)

// 高速化
k: Math.max(size * 2, 30)
```

### キャッシュ戦略

```typescript
// 頻繁な検索結果をキャッシュ
const CACHE_TTL = 300; // 5分

// レスポンスヘッダー
'Cache-Control': 'private, max-age=60'
```

## トラブルシューティング

### 検索結果が0件

**チェックリスト:**

1. ベクトルが保存されているか確認
   ```bash
   curl -X GET "https://$OPENSEARCH_ENDPOINT/cis-files/_count" \
     -d '{"query": {"exists": {"field": "image_embedding"}}}'
   ```

2. Lambda関数が更新されているか
   ```bash
   aws lambda get-function --function-name cis-search-api \
     --query 'Configuration.LastModified'
   ```

3. ベクトルの次元数が正しいか
   ```bash
   curl -X GET "https://$OPENSEARCH_ENDPOINT/cis-files/_search?size=1" \
     -d '{"query": {"match_all": {}}}' | jq '.hits.hits[0]._source.image_embedding | length'
   ```

### AWS認証エラー

```bash
# 認証情報を確認
aws sts get-caller-identity

# IAMポリシーを確認
aws iam get-user-policy --user-name your-user --policy-name your-policy
```

**必要な権限:**
- `es:ESHttpPut` (OpenSearch書き込み)
- `es:ESHttpGet` (OpenSearch読み取り)
- `s3:GetObject` (S3読み取り)
- `bedrock:InvokeModel` (Bedrockアクセス)

### OpenSearch接続エラー

```bash
# DNSを確認
nslookup $OPENSEARCH_ENDPOINT

# セキュリティグループを確認
aws ec2 describe-security-groups --group-ids sg-xxx

# VPC設定を確認（Lambda関数の場合）
aws lambda get-function-configuration --function-name cis-search-api \
  --query 'VpcConfig'
```

## モニタリング

### CloudWatchログ

```bash
# Lambda関数のログ
aws logs tail /aws/lambda/cis-search-api --follow

# 特定のエラーを検索
aws logs filter-log-events \
  --log-group-name /aws/lambda/cis-search-api \
  --filter-pattern "ERROR"
```

### メトリクス

- **検索レイテンシー:** CloudWatch Metrics
- **成功率:** Lambda関数の成功/失敗率
- **スループット:** リクエスト数/分
- **エラー率:** 4xx/5xxエラー率

## セキュリティ

### 認証・認可

- AWS Sigv4署名による認証
- IAMロールベースのアクセス制御
- 最小権限の原則

### データ保護

- HTTPS通信（TLS 1.2以上）
- VPC内通信（Lambda → OpenSearch）
- 入力検証とサニタイゼーション

### レート制限

```typescript
// API Gatewayでレート制限を設定
{
  "throttle": {
    "burstLimit": 100,
    "rateLimit": 50
  }
}
```

## コスト最適化

### Bedrock使用量

- **価格:** 約$0.00006/画像（us-east-1）
- **1000画像:** 約$0.06
- **10000画像:** 約$0.60

### OpenSearch

- **インスタンス:** t3.small.search（開発環境）
- **ストレージ:** EBS（gp3）
- **データ転送:** VPC内通信は無料

### Lambda

- **メモリ:** 512MB推奨
- **タイムアウト:** 30秒
- **同時実行数:** 10-20（通常）

## ベストプラクティス

1. **エラーハンドリング:** すべてのAPI呼び出しにtry-catchを実装
2. **ログ:** 詳細なログで問題の早期発見
3. **リトライ:** 一時的なエラーに対する自動リトライ
4. **バリデーション:** 入力データの厳格な検証
5. **モニタリング:** CloudWatchアラームの設定

## 関連リソース

- **詳細実装:** [IMAGE_SEARCH_IMPLEMENTATION.md](IMAGE_SEARCH_IMPLEMENTATION.md)
- **クイックスタート:** [IMAGE_SEARCH_QUICKSTART.md](IMAGE_SEARCH_QUICKSTART.md)
- **解決策サマリー:** [IMAGE_SEARCH_SOLUTION_SUMMARY.md](IMAGE_SEARCH_SOLUTION_SUMMARY.md)
- **AWS Bedrock Titan:** https://docs.aws.amazon.com/bedrock/latest/userguide/titan-multiemb-models.html
- **OpenSearch k-NN:** https://opensearch.org/docs/latest/search-plugins/knn/

## サポート

問題が発生した場合:

1. **検証スクリプト実行:** `./scripts/verify-image-search.sh`
2. **ログ確認:** CloudWatch Logs
3. **ドキュメント参照:** 上記の関連リソース

---

**実装完了日:** 2024-12-18
**バージョン:** 1.0.0
**ステータス:** Production Ready ✅
