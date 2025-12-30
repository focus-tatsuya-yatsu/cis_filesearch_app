# 画像検索機能 クイックスタートガイド

## 目的

画像検索が0件になる問題を解決し、すぐに画像検索を動作させるための最短手順。

## 前提条件

- OpenSearchインデックス: `cis-files`
- `image_embedding`フィールド（knn_vector, 1024次元）が設定済み
- S3バケット: `cis-filesearch-thumbnails`
- AWS認証情報が設定済み

## 3ステップで画像検索を有効化

### Step 1: 既存画像にベクトルを付与（一括処理）

**目的:** S3にある既存のサムネイル画像をベクトル化してOpenSearchに保存

```bash
# フロントエンドのディレクトリに移動
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

# 環境変数を設定（必須）
export OPENSEARCH_ENDPOINT="vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
export OPENSEARCH_INDEX="cis-files"
export AWS_REGION="ap-northeast-1"
export S3_BUCKET_NAME="cis-filesearch-thumbnails"
export NEXT_PUBLIC_API_URL="http://localhost:3000"

# AWS認証情報（まだ設定していない場合）
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"

# バッチ処理を実行
npx ts-node src/services/batch-process-images.ts
```

**実行結果の例:**
```
[Batch Process] Starting batch processing...
[Batch Process] Found 100 image files to process
[Batch Process] Processing batch 1/10
[Batch Process] Progress: 10/100 (10 successful, 0 failed)
...
=== Batch Processing Complete ===
Total files: 100
Processed: 100
Successful: 98
Failed: 2
```

**注意:**
- 処理時間は画像数によります（100件で約10-15分）
- エラーが発生した画像は自動的にリトライされます
- 失敗した画像はログで確認できます

### Step 2: Lambda関数を更新（KNN検索の最適化）

**目的:** OpenSearchのKNN検索クエリを最適化

```bash
# Lambda関数のディレクトリに移動
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api

# デプロイスクリプトに実行権限を付与
chmod +x scripts/quick-deploy.sh

# Lambda関数を更新
./scripts/quick-deploy.sh
```

**実行結果の例:**
```
=== Quick Lambda Deploy ===
Deploying OpenSearch service fix...
Using temporary directory: /var/folders/...
Copying source files...
Installing dependencies...
Compiling TypeScript...
Creating deployment package...
Updating Lambda function: cis-search-api
Waiting for Lambda update to complete...
=== Deployment Complete ===
Lambda function updated successfully: cis-search-api
```

### Step 3: 動作確認

**テスト画像で検索:**

```bash
# 画像をアップロードしてベクトル化
curl -X POST http://localhost:3000/api/image-embedding \
  -F "image=@/path/to/test-image.jpg"

# レスポンス例:
# {
#   "success": true,
#   "data": {
#     "embedding": [0.123, -0.456, ...],
#     "dimensions": 1024
#   }
# }

# ベクトルを使って画像検索
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "imageEmbedding": [0.123, -0.456, ...],
    "size": 20,
    "page": 1
  }'

# レスポンス例:
# {
#   "success": true,
#   "data": {
#     "results": [
#       {
#         "fileName": "similar-image1.jpg",
#         "relevanceScore": 0.95,
#         ...
#       }
#     ],
#     "pagination": {
#       "total": 15
#     }
#   }
# }
```

**OpenSearchで直接確認:**

```bash
# ベクトルが保存されているか確認
curl -X GET "https://$OPENSEARCH_ENDPOINT/cis-files/_search?pretty" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "exists": {
        "field": "image_embedding"
      }
    },
    "size": 10
  }'
```

## トラブルシューティング

### エラー: AWS credentials not configured

**解決策:**
```bash
# AWS認証情報を設定
aws configure

# または環境変数で設定
export AWS_ACCESS_KEY_ID="your-key"
export AWS_SECRET_ACCESS_KEY="your-secret"
```

### エラー: OpenSearch endpoint not configured

**解決策:**
```bash
# 環境変数を設定
export OPENSEARCH_ENDPOINT="vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"

# 確認
echo $OPENSEARCH_ENDPOINT
```

### バッチ処理が途中で止まる

**解決策:**
```typescript
// src/services/batch-process-images.ts の設定を調整
const CONFIG = {
  BATCH_SIZE: 5,        // 並列処理数を減らす
  RETRY_ATTEMPTS: 5,    // リトライ回数を増やす
  RETRY_DELAY_MS: 2000, // 待機時間を長くする
};
```

### 検索結果が0件

**確認項目:**

1. **ベクトルが保存されているか確認**
   ```bash
   curl -X GET "https://$OPENSEARCH_ENDPOINT/cis-files/_count?pretty" \
     -d '{"query": {"exists": {"field": "image_embedding"}}}'
   ```

2. **Lambda関数が更新されているか確認**
   ```bash
   aws lambda get-function --function-name cis-search-api --region ap-northeast-1
   # LastModified を確認
   ```

3. **ログを確認**
   ```bash
   # Lambda関数のログ
   aws logs tail /aws/lambda/cis-search-api --follow

   # フロントエンドのログ
   # ブラウザのコンソールを確認
   ```

## 新規画像の処理フロー

今後、新しい画像をアップロードする場合の推奨フロー：

```typescript
// 1. 画像をアップロードしてベクトル化
const embeddingResponse = await fetch('/api/image-embedding', {
  method: 'POST',
  body: formData, // FormData with image file
});
const { data } = await embeddingResponse.json();

// 2. ベクトルをOpenSearchに保存
await fetch('/api/save-image-embedding', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    s3Key: data.s3Key,
    imageEmbedding: data.embedding,
    fileName: data.fileName,
  }),
});

// 3. これで画像検索可能！
```

## パフォーマンスチューニング

### バッチ処理の並列度

```typescript
// 小規模（100件以下）
BATCH_SIZE: 10

// 中規模（1000件）
BATCH_SIZE: 20

// 大規模（10000件以上）
BATCH_SIZE: 30-50
```

### 検索のk値調整

Lambda関数の設定:
```typescript
// より精度の高い結果を得たい場合
k: size * 5  // デフォルトは size * 3

// 高速化したい場合
k: size * 2
```

## まとめ

以下の3ステップで画像検索が動作します：

1. ✅ **バッチ処理実行** - 既存画像をベクトル化してOpenSearchに保存
2. ✅ **Lambda更新** - KNN検索クエリを最適化
3. ✅ **動作確認** - テスト画像で検索実行

所要時間: **約15-20分**（画像数100件の場合）

---

**サポートが必要な場合:**
- ログファイル: `/tmp/batch-process.log`
- Lambda CloudWatchログ: `/aws/lambda/cis-search-api`
- 詳細ドキュメント: `IMAGE_SEARCH_IMPLEMENTATION.md`
