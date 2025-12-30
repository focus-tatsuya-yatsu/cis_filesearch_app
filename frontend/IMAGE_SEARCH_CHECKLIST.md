# 画像検索機能 実装チェックリスト

## 実装完了確認

### フロントエンド実装 ✅

- [x] **OpenSearchクライアント拡張** (`src/lib/opensearch.ts`)
  - [x] `updateDocumentImageEmbedding()` 関数
  - [x] `batchUpdateImageEmbeddings()` 関数
  - [x] エラーハンドリング
  - [x] TypeScript型定義

- [x] **画像埋め込み保存API** (`src/app/api/save-image-embedding/route.ts`)
  - [x] POST エンドポイント
  - [x] OpenSearch直接接続
  - [x] ドキュメントUPSERT機能
  - [x] バリデーション
  - [x] エラーハンドリング
  - [x] CORS設定

- [x] **バッチ処理スクリプト** (`src/services/batch-process-images.ts`)
  - [x] S3バケットスキャン
  - [x] 画像ダウンロード
  - [x] Bedrockベクトル化
  - [x] OpenSearch保存
  - [x] 並列処理
  - [x] リトライロジック
  - [x] 進捗ログ
  - [x] エラーレポート

- [x] **バッチ処理API** (`src/app/api/batch-process-images/route.ts`)
  - [x] POST エンドポイント
  - [x] 設定パラメータ
  - [x] ステータス報告
  - [x] エラーハンドリング
  - [x] CORS設定

### バックエンド実装 ✅

- [x] **Lambda関数のKNN検索最適化**
  - [x] `opensearch.service.enhanced.ts` 更新
  - [x] フィルターなしKNNクエリ
  - [x] フィルター付きscript_scoreクエリ
  - [x] コサイン類似度計算
  - [x] エラーハンドリング

- [x] **デプロイスクリプト**
  - [x] `scripts/quick-deploy.sh`
  - [x] Lambda関数パッケージング
  - [x] AWS CLI統合

### ドキュメント ✅

- [x] **IMAGE_SEARCH_IMPLEMENTATION.md**
  - [x] 問題の分析
  - [x] 実装内容の詳細
  - [x] アーキテクチャ図
  - [x] 使用方法
  - [x] デプロイ手順
  - [x] トラブルシューティング

- [x] **IMAGE_SEARCH_QUICKSTART.md**
  - [x] 3ステップガイド
  - [x] 環境変数設定
  - [x] 実行コマンド
  - [x] 動作確認方法

- [x] **IMAGE_SEARCH_SOLUTION_SUMMARY.md**
  - [x] 問題の診断
  - [x] 解決策の概要
  - [x] ファイル一覧
  - [x] デプロイ手順
  - [x] 期待される結果

- [x] **IMAGE_SEARCH_README.md**
  - [x] アーキテクチャ図
  - [x] API仕様
  - [x] 技術仕様
  - [x] パフォーマンスチューニング
  - [x] ベストプラクティス

### テスト・検証ツール ✅

- [x] **検証スクリプト** (`scripts/verify-image-search.sh`)
  - [x] 環境変数チェック
  - [x] AWS認証確認
  - [x] OpenSearch接続テスト
  - [x] S3バケット確認
  - [x] Lambda関数確認
  - [x] APIエンドポイント確認
  - [x] 実装ファイル確認

## デプロイ前チェック

### 環境設定 ⚠️ (要確認)

- [ ] **環境変数設定**
  ```bash
  export OPENSEARCH_ENDPOINT="vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
  export OPENSEARCH_INDEX="cis-files"
  export AWS_REGION="ap-northeast-1"
  export S3_BUCKET_NAME="cis-filesearch-thumbnails"
  export NEXT_PUBLIC_API_URL="http://localhost:3000"
  ```

- [ ] **AWS認証情報**
  ```bash
  aws configure
  # または
  aws sts get-caller-identity
  ```

- [ ] **IAM権限確認**
  - [ ] `es:ESHttpPut` (OpenSearch書き込み)
  - [ ] `es:ESHttpGet` (OpenSearch読み取み)
  - [ ] `s3:GetObject` (S3読み取り)
  - [ ] `bedrock:InvokeModel` (Bedrockアクセス)
  - [ ] `lambda:UpdateFunctionCode` (Lambda更新)

### インフラ確認 ⚠️ (要確認)

- [ ] **OpenSearchクラスタ**
  - [ ] クラスタが稼働中
  - [ ] インデックス `cis-files` 存在
  - [ ] `image_embedding` フィールド設定済み（knn_vector, 1024次元）
  - [ ] VPCエンドポイント設定（Lambda接続用）

- [ ] **S3バケット**
  - [ ] バケット `cis-filesearch-thumbnails` 存在
  - [ ] `thumbnails/` プレフィックスにファイル存在
  - [ ] 読み取り権限設定

- [ ] **Lambda関数**
  - [ ] 関数 `cis-search-api` 存在
  - [ ] VPC設定（OpenSearchアクセス用）
  - [ ] タイムアウト: 30秒以上
  - [ ] メモリ: 512MB以上

- [ ] **API Gateway**
  - [ ] REST API or HTTP API設定
  - [ ] Lambda統合設定
  - [ ] CORS設定
  - [ ] デプロイステージ設定

## デプロイ手順

### Step 1: 検証スクリプト実行 ⚠️

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
./scripts/verify-image-search.sh
```

**期待される結果:**
```
=== Verification Summary ===
Passed: 12
Failed: 0
Total:  12
✓ All checks passed! Image search is ready to use.
```

### Step 2: バッチ処理実行 ⚠️

```bash
# 環境変数を設定（まだの場合）
export OPENSEARCH_ENDPOINT="..."
export OPENSEARCH_INDEX="cis-files"
export AWS_REGION="ap-northeast-1"
export S3_BUCKET_NAME="cis-filesearch-thumbnails"
export NEXT_PUBLIC_API_URL="http://localhost:3000"

# バッチ処理実行
npx ts-node src/services/batch-process-images.ts
```

**期待される結果:**
```
=== Batch Processing Complete ===
Total files: 100
Processed: 100
Successful: 98
Failed: 2
```

### Step 3: Lambda関数デプロイ ⚠️

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
chmod +x scripts/quick-deploy.sh
./scripts/quick-deploy.sh
```

**期待される結果:**
```
=== Deployment Complete ===
Lambda function updated successfully: cis-search-api
Region: ap-northeast-1
```

### Step 4: 動作確認 ⚠️

```bash
# テスト画像で検索
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

# 画像をベクトル化
curl -X POST http://localhost:3000/api/image-embedding \
  -F "image=@/path/to/test.jpg"

# 検索実行（ベクトルを上記レスポンスから取得）
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"imageEmbedding": [...], "size": 20}'
```

**期待される結果:**
```json
{
  "success": true,
  "data": {
    "results": [...],
    "pagination": {
      "total": 15
    }
  }
}
```

## デプロイ後確認

### 機能テスト ⚠️

- [ ] **新規画像アップロード**
  - [ ] ベクトル生成成功
  - [ ] OpenSearch保存成功
  - [ ] 検索で見つかる

- [ ] **既存画像検索**
  - [ ] バッチ処理で処理された画像が見つかる
  - [ ] 類似度スコアが適切（0.7以上）
  - [ ] ソート・フィルターが動作

- [ ] **エラーハンドリング**
  - [ ] 無効な画像形式でエラーメッセージ
  - [ ] ファイルサイズ超過でエラーメッセージ
  - [ ] ネットワークエラー時のリトライ

### パフォーマンステスト ⚠️

- [ ] **検索速度**
  - [ ] レスポンスタイム < 500ms
  - [ ] 50件検索時 < 1秒

- [ ] **バッチ処理**
  - [ ] 100件処理 < 15分
  - [ ] エラー率 < 5%

- [ ] **同時アクセス**
  - [ ] 10並列リクエスト処理可能
  - [ ] エラー率 < 1%

### モニタリング設定 ⚠️

- [ ] **CloudWatchアラーム**
  - [ ] Lambda関数エラー率
  - [ ] OpenSearch CPU使用率
  - [ ] API Gatewayレイテンシー

- [ ] **ログ確認**
  - [ ] Lambda関数ログ正常
  - [ ] フロントエンドログ正常
  - [ ] エラーログなし

## トラブルシューティングチェック

### 検索結果が0件の場合

- [ ] ベクトルが保存されているか確認
  ```bash
  curl -X GET "https://$OPENSEARCH_ENDPOINT/cis-files/_count" \
    -d '{"query": {"exists": {"field": "image_embedding"}}}'
  ```

- [ ] Lambda関数が最新か確認
  ```bash
  aws lambda get-function --function-name cis-search-api \
    --query 'Configuration.LastModified'
  ```

- [ ] ベクトルの次元数が1024か確認
  ```bash
  curl -X GET "https://$OPENSEARCH_ENDPOINT/cis-files/_search?size=1" | \
    jq '.hits.hits[0]._source.image_embedding | length'
  ```

### バッチ処理が失敗する場合

- [ ] AWS認証情報を確認
  ```bash
  aws sts get-caller-identity
  ```

- [ ] S3バケットにアクセスできるか確認
  ```bash
  aws s3 ls s3://$S3_BUCKET_NAME/thumbnails/
  ```

- [ ] Bedrockにアクセスできるか確認
  ```bash
  aws bedrock list-foundation-models --region us-east-1
  ```

### Lambda関数エラーの場合

- [ ] VPC設定を確認
  ```bash
  aws lambda get-function-configuration \
    --function-name cis-search-api \
    --query 'VpcConfig'
  ```

- [ ] セキュリティグループを確認
  ```bash
  aws ec2 describe-security-groups --group-ids sg-xxx
  ```

- [ ] CloudWatchログを確認
  ```bash
  aws logs tail /aws/lambda/cis-search-api --follow
  ```

## ロールバック手順

問題が発生した場合のロールバック:

### Lambda関数のロールバック

```bash
# 以前のバージョンに戻す
aws lambda update-function-code \
  --function-name cis-search-api \
  --s3-bucket your-backup-bucket \
  --s3-key lambda-backup-YYYYMMDD.zip
```

### OpenSearchのロールバック

```bash
# ベクトルフィールドを削除（必要に応じて）
curl -X POST "https://$OPENSEARCH_ENDPOINT/cis-files/_update_by_query" \
  -d '{
    "script": {
      "source": "ctx._source.remove(\"image_embedding\")"
    }
  }'
```

## 完了確認

すべてのチェック項目が完了したら:

- [x] **実装完了** - すべてのコードが実装済み
- [ ] **デプロイ完了** - すべてのコンポーネントがデプロイ済み
- [ ] **テスト完了** - すべてのテストが成功
- [ ] **ドキュメント完了** - すべてのドキュメントが作成済み
- [ ] **モニタリング設定完了** - アラートとログが設定済み

---

**実装者:** Claude Code
**実装日:** 2024-12-18
**レビュアー:** _________
**承認日:** _________

**ステータス:**
- コード実装: ✅ 完了
- デプロイ: ⚠️ 実行待ち
- テスト: ⚠️ 実行待ち
- 本番リリース: ⚠️ 承認待ち
