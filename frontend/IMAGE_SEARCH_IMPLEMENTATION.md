# 画像検索機能 実装完了レポート

## 概要

画像検索機能の実装が完了しました。このドキュメントでは、実装内容、アーキテクチャ、使用方法、およびトラブルシューティングについて説明します。

## 問題の分析

### 元の問題
- 画像のベクトル（1024次元）は生成されていた
- OpenSearchのインデックスに`image_embedding`フィールド（knn_vector）は設定されていた
- しかし、**ベクトルがOpenSearchに保存されていなかった**ため、検索結果が0件だった

## 実装内容

### 1. OpenSearchドキュメント更新機能 (`/lib/opensearch.ts`)

```typescript
// 単一ドキュメントの更新
export async function updateDocumentImageEmbedding(
  documentId: string,
  imageEmbedding: number[]
): Promise<{ success: boolean; error?: string }>

// バッチ更新
export async function batchUpdateImageEmbeddings(
  updates: Array<{ documentId: string; imageEmbedding: number[] }>
): Promise<Array<{ documentId: string; success: boolean; error?: string }>>
```

**機能:**
- API Gateway経由でLambda関数を呼び出し、OpenSearchのドキュメントを更新
- 画像埋め込みベクトル（1024次元）を保存
- エラーハンドリングとリトライロジック

### 2. 画像埋め込み保存API (`/api/save-image-embedding/route.ts`)

**エンドポイント:** `POST /api/save-image-embedding`

**リクエストボディ:**
```json
{
  "s3Key": "thumbnails/image123.jpg",
  "imageEmbedding": [0.123, -0.456, ...], // 1024次元のベクトル
  "fileName": "image123.jpg", // オプション
  "filePath": "thumbnails/image123.jpg" // オプション
}
```

**レスポンス:**
```json
{
  "success": true,
  "message": "Image embedding saved successfully",
  "documentId": "dGh1bWJuYWlscy9pbWFnZTEyMy5qcGc=",
  "result": "updated" // または "created"
}
```

**機能:**
- OpenSearchクライアントを直接使用してドキュメントを更新
- ドキュメントが存在する場合は更新（UPDATE）、存在しない場合は作成（CREATE）
- AWS Sigv4署名による認証
- 詳細なエラーログとステータス報告

### 3. バッチ処理スクリプト (`/services/batch-process-images.ts`)

**機能:**
- S3バケット内の既存画像を一括処理
- 各画像に対して以下を実行:
  1. S3から画像を取得
  2. AWS Bedrock Titan Embeddingsでベクトル化
  3. OpenSearchに保存
- 並列処理によるパフォーマンス最適化
- 自動リトライ機能
- 進捗状況の詳細なログ

**設定パラメータ:**
```typescript
const CONFIG = {
  S3_BUCKET: 'cis-filesearch-thumbnails',
  S3_PREFIX: 'thumbnails/',
  BATCH_SIZE: 10,        // 並列処理数
  MAX_FILES: 1000,       // 最大処理ファイル数
  RETRY_ATTEMPTS: 3,     // リトライ回数
  RETRY_DELAY_MS: 1000,  // リトライ間隔
};
```

### 4. バッチ処理API (`/api/batch-process-images/route.ts`)

**エンドポイント:** `POST /api/batch-process-images`

**リクエストボディ（オプション）:**
```json
{
  "maxFiles": 1000,
  "batchSize": 10,
  "prefix": "thumbnails/"
}
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
    "errors": ["file1.jpg: Connection timeout", "file2.jpg: Invalid format"]
  }
}
```

### 5. KNN検索クエリの最適化 (Lambda関数)

**修正内容:**
- OpenSearch 2.x標準のKNN検索クエリ形式に変更
- フィルターの有無に応じて最適なクエリ構造を使用

**フィルターなしの場合:**
```javascript
{
  query: {
    knn: {
      image_embedding: {
        vector: imageEmbedding,
        k: 50
      }
    }
  }
}
```

**フィルター付きの場合:**
```javascript
{
  query: {
    bool: {
      must: [{
        script_score: {
          query: { bool: { filter: filterClauses } },
          script: {
            source: "knn_score",
            lang: "knn",
            params: {
              field: "image_embedding",
              query_value: imageEmbedding,
              space_type: "cosinesimil"
            }
          }
        }
      }]
    }
  }
}
```

## アーキテクチャ

```
[フロントエンド]
    |
    | 1. 画像アップロード
    v
[POST /api/image-embedding]
    |
    | 2. ベクトル生成 (AWS Bedrock)
    v
[1024次元ベクトル]
    |
    | 3. 保存
    v
[POST /api/save-image-embedding]
    |
    | 4. OpenSearch更新
    v
[OpenSearch - cis-files インデックス]
    |
    | 5. 画像検索
    v
[POST /api/search (imageEmbedding付き)]
    |
    | 6. KNN検索実行
    v
[Lambda Search API]
    |
    | 7. 検索結果
    v
[OpenSearch KNN検索]
```

## 使用方法

### 新規画像の処理

```typescript
// 1. 画像をアップロードしてベクトル化
const formData = new FormData();
formData.append('image', imageFile);

const embeddingResponse = await fetch('/api/image-embedding', {
  method: 'POST',
  body: formData,
});

const { data } = await embeddingResponse.json();
const { embedding, fileName } = data;

// 2. ベクトルをOpenSearchに保存
const saveResponse = await fetch('/api/save-image-embedding', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    s3Key: `thumbnails/${fileName}`,
    imageEmbedding: embedding,
    fileName,
  }),
});

const saveResult = await saveResponse.json();
console.log('Saved:', saveResult.success);

// 3. 画像検索を実行
const searchResponse = await fetch('/api/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    imageEmbedding: embedding,
    size: 20,
    page: 1,
  }),
});

const searchResults = await searchResponse.json();
console.log('Found:', searchResults.data.results.length);
```

### 既存画像の一括処理

```bash
# API経由でバッチ処理を実行
curl -X POST http://localhost:3000/api/batch-process-images \
  -H "Content-Type: application/json" \
  -d '{
    "maxFiles": 100,
    "batchSize": 10
  }'

# または、スクリプトを直接実行
cd frontend
npx ts-node src/services/batch-process-images.ts
```

## デプロイ手順

### 1. フロントエンド

```bash
cd frontend

# 依存関係をインストール（既にインストール済みの場合はスキップ）
yarn install

# ビルド
yarn build

# デプロイ（Next.jsアプリケーション）
# 環境変数を設定
export OPENSEARCH_ENDPOINT="vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
export OPENSEARCH_INDEX="cis-files"
export AWS_REGION="ap-northeast-1"
export S3_BUCKET_NAME="cis-filesearch-thumbnails"

# 起動
yarn start
```

### 2. Lambda関数の更新

```bash
cd backend/lambda-search-api

# KNN検索の修正をデプロイ
chmod +x scripts/quick-deploy.sh
./scripts/quick-deploy.sh
```

## 環境変数

### フロントエンド (.env.local)

```bash
# OpenSearch
OPENSEARCH_ENDPOINT=vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=cis-files
AWS_REGION=ap-northeast-1

# API Gateway
NEXT_PUBLIC_API_GATEWAY_URL=https://your-api-gateway-url.execute-api.ap-northeast-1.amazonaws.com/prod/search
NEXT_PUBLIC_API_URL=http://localhost:3000

# S3
S3_BUCKET_NAME=cis-filesearch-thumbnails

# AWS認証情報（ローカル開発時）
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

### Lambda関数

```bash
# 環境変数はAWS Lambda設定で管理
OPENSEARCH_ENDPOINT=vpc-cis-filesearch-opensearch-...
OPENSEARCH_INDEX=cis-files
AWS_REGION=ap-northeast-1
DEBUG_MODE=false
SKIP_SSL_VERIFY=false
```

## トラブルシューティング

### 画像検索で結果が0件

**原因:** ベクトルがOpenSearchに保存されていない

**解決策:**
1. バッチ処理を実行して既存画像を処理
   ```bash
   curl -X POST http://localhost:3000/api/batch-process-images
   ```

2. 新規画像は必ず`/api/save-image-embedding`で保存

3. OpenSearchのドキュメントを確認
   ```bash
   curl -X GET "https://$OPENSEARCH_ENDPOINT/cis-files/_search?pretty" \
     -H "Content-Type: application/json" \
     -d '{"query": {"exists": {"field": "image_embedding"}}}'
   ```

### AWS認証エラー

**エラー:** `AWS credentials not configured`

**解決策:**
1. AWS認証情報を設定
   ```bash
   aws configure
   # または
   export AWS_ACCESS_KEY_ID=...
   export AWS_SECRET_ACCESS_KEY=...
   ```

2. IAMロールに必要な権限を付与
   - `es:ESHttpPut` (OpenSearch書き込み)
   - `es:ESHttpGet` (OpenSearch読み取り)
   - `s3:GetObject` (S3読み取り)
   - `bedrock:InvokeModel` (Bedrockアクセス)

### OpenSearch接続エラー

**エラー:** `OpenSearch endpoint not configured`

**解決策:**
1. 環境変数を確認
   ```bash
   echo $OPENSEARCH_ENDPOINT
   ```

2. エンドポイントが正しいか確認（`https://`は不要）
   ```
   正: vpc-cis-filesearch-opensearch-...ap-northeast-1.es.amazonaws.com
   誤: https://vpc-cis-filesearch-opensearch-...
   ```

3. VPC設定を確認（Lambda関数がVPC内にある場合）

### バッチ処理が失敗する

**症状:** 一部の画像が処理されない

**解決策:**
1. エラーログを確認
   ```javascript
   // レスポンスのerrorsフィールドを確認
   {
     "stats": {
       "errors": ["file1.jpg: Timeout", ...]
     }
   }
   ```

2. リトライ設定を調整
   ```typescript
   // batch-process-images.tsの設定
   RETRY_ATTEMPTS: 5,      // リトライ回数を増やす
   RETRY_DELAY_MS: 2000,   // 待機時間を長くする
   ```

3. バッチサイズを減らす
   ```typescript
   BATCH_SIZE: 5,  // 並列処理数を減らす
   ```

## パフォーマンス最適化

### バッチ処理

- **並列処理:** デフォルトで10件並列（`BATCH_SIZE: 10`）
- **推奨値:**
  - 小規模（100件以下）: `BATCH_SIZE: 10`
  - 中規模（1000件）: `BATCH_SIZE: 20`
  - 大規模（10000件以上）: `BATCH_SIZE: 30-50`

### 検索パフォーマンス

- **k値の調整:** デフォルトは`k = size * 3`（最低50）
- **フィルター:** フィルターを使用すると検索が遅くなる可能性あり
- **キャッシュ:** 頻繁な検索はキャッシュを検討

## セキュリティ考慮事項

1. **AWS認証情報:** 本番環境では環境変数やSecrets Managerを使用
2. **API認証:** 本番環境ではCognito認証を実装
3. **入力検証:** ベクトルの次元数（1024）を厳格に検証
4. **レート制限:** バッチ処理APIにレート制限を実装推奨

## 次のステップ

### 短期（即座に実装可能）
1. バッチ処理を実行して既存画像を処理
2. Lambda関数をデプロイしてKNN検索を有効化
3. フロントエンドで画像検索UIを統合

### 中期（1-2週間）
1. 画像検索結果のプレビュー表示
2. 検索履歴の保存と再利用
3. パフォーマンスモニタリングダッシュボード

### 長期（1-2ヶ月）
1. ハイブリッド検索（テキスト + 画像）の重み調整UI
2. 画像の自動タグ付け（AWS Rekognition統合）
3. 類似画像のクラスタリング表示

## まとめ

この実装により、以下が実現されました：

✅ **画像ベクトルの生成** - AWS Bedrock Titan Embeddings (1024次元)
✅ **OpenSearchへの保存** - 新規/既存ドキュメントの更新
✅ **バッチ処理** - S3内の既存画像の一括処理
✅ **KNN検索の最適化** - OpenSearch 2.x標準形式
✅ **エラーハンドリング** - 詳細なログとリトライロジック
✅ **API エンドポイント** - RESTful API設計

画像検索機能は完全に実装されており、デプロイ後すぐに利用可能です。
