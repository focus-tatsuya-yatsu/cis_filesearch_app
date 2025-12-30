# 画像検索機能デプロイメントガイド

本番環境への画像検索機能のデプロイ手順書

## 概要

このガイドでは、AWS Bedrock Titan Multimodal EmbeddingsとOpenSearch k-NNを使用した画像検索機能を本番環境にデプロイする手順を説明します。

## 前提条件

### 必要なAWSリソース

- [x] OpenSearch Domain（VPC内）
- [x] Lambda Search API関数
- [x] API Gateway
- [x] Next.js Frontend（EC2またはVercel）
- [x] IAMロールと権限
- [x] VPCとセキュリティグループ

### 必要なツール

- AWS CLI v2
- Node.js 20.x
- curl
- jq（推奨）
- Terraform（インフラ変更時）

### 必要な権限

- OpenSearch：読み取り・書き込み権限
- Bedrock：`bedrock:InvokeModel`権限（us-east-1リージョン）
- Lambda：関数更新権限
- CloudWatch：ログ読み取り権限

## デプロイメント手順

### ステップ1: 環境変数の設定

#### 1.1 Frontend環境変数（`.env.production`）

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

cat > .env.production <<EOF
# OpenSearch Configuration
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh5x3uqe.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index-v2

# AWS Configuration
AWS_REGION=ap-northeast-1

# Bedrock Configuration
BEDROCK_MODEL_ID=amazon.titan-embed-image-v1
BEDROCK_REGION=us-east-1
USE_MOCK_EMBEDDING=false

# API Gateway
NEXT_PUBLIC_API_GATEWAY_URL=https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search

# Performance Settings
EMBEDDING_CACHE_TTL=86400
EMBEDDING_CACHE_MAX_SIZE=10000
OPENSEARCH_REQUEST_TIMEOUT=30000
OPENSEARCH_MAX_RETRIES=3
EOF
```

#### 1.2 Lambda環境変数（Terraformで自動設定）

`/terraform/lambda_search_api.tf`の環境変数を確認:

```hcl
environment {
  variables = {
    OPENSEARCH_ENDPOINT = "https://${aws_opensearch_domain.main.endpoint}"
    OPENSEARCH_INDEX    = "file-index-v2"
    AWS_REGION          = "ap-northeast-1"
    LOG_LEVEL           = "info"
  }
}
```

### ステップ2: OpenSearchインデックスの作成

#### 2.1 AWS認証情報の設定

```bash
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_REGION="ap-northeast-1"
export OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh5x3uqe.ap-northeast-1.es.amazonaws.com"
export OPENSEARCH_INDEX="file-index-v2"
```

#### 2.2 インデックス作成スクリプトの実行

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/scripts

# スクリプトを実行
./create-opensearch-knn-index.sh
```

期待される出力:

```
==========================================
OpenSearch k-NN Index Creation Script
==========================================

Index Name: file-index-v2
OpenSearch Endpoint: https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh5x3uqe.ap-northeast-1.es.amazonaws.com
AWS Region: ap-northeast-1

[INFO] Checking prerequisites...
[INFO] Prerequisites check completed.

[INFO] Checking OpenSearch connection...
[INFO] OpenSearch connection successful
{
  "cluster_name": "...",
  "status": "green",
  "number_of_nodes": 2
}

[INFO] Creating index: file-index-v2
[INFO] Index created successfully: file-index-v2

[INFO] Verifying index creation...
[INFO] Index creation completed successfully!
```

#### 2.3 インデックス作成の確認

```bash
# マッピングを確認
curl -X GET "${OPENSEARCH_ENDPOINT}/file-index-v2/_mapping" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  | jq .

# k-NNプラグインの統計を確認
curl -X GET "${OPENSEARCH_ENDPOINT}/_plugins/_knn/stats" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  | jq .
```

### ステップ3: Lambda関数のデプロイ

#### 3.1 Lambda関数のビルド

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api

# 依存関係のインストール
npm install

# ビルドとパッケージング
npm run package

# デプロイメントパッケージの確認
ls -lh lambda-deployment.zip
```

期待される出力:

```
-rw-r--r--  1 user  staff   1.4M Dec 18 10:00 lambda-deployment.zip
```

#### 3.2 Lambda関数の更新

```bash
# Lambda関数コードの更新
aws lambda update-function-code \
  --function-name cis-search-api-production \
  --zip-file fileb://lambda-deployment.zip \
  --region ap-northeast-1

# 更新完了を待機
aws lambda wait function-updated \
  --function-name cis-search-api-production \
  --region ap-northeast-1

# 関数設定の確認
aws lambda get-function-configuration \
  --function-name cis-search-api-production \
  --region ap-northeast-1 \
  | jq '{FunctionName, Runtime, MemorySize, Timeout, Environment: .Environment.Variables}'
```

#### 3.3 Lambda環境変数の更新（必要に応じて）

```bash
aws lambda update-function-configuration \
  --function-name cis-search-api-production \
  --environment Variables="{
    OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh5x3uqe.ap-northeast-1.es.amazonaws.com,
    OPENSEARCH_INDEX=file-index-v2,
    AWS_REGION=ap-northeast-1,
    LOG_LEVEL=info,
    NODE_ENV=production
  }" \
  --region ap-northeast-1
```

### ステップ4: Frontend（Next.js）のデプロイ

#### 4.1 Frontendのビルド

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

# 本番用ビルド
npm run build
```

#### 4.2 EC2へのデプロイ（該当する場合）

```bash
# EC2インスタンスにSSH接続
ssh -i ~/.ssh/your-key.pem ec2-user@your-ec2-instance

# アプリケーションディレクトリに移動
cd /path/to/cis_filesearch_app/frontend

# Gitから最新コードをプル
git pull origin main

# 依存関係のインストール
npm install

# 環境変数を設定
cp .env.production.example .env.production
vim .env.production  # 本番環境の値を設定

# ビルド
npm run build

# PM2でアプリケーションを再起動
pm2 restart cis-frontend
pm2 save
```

#### 4.3 Vercelへのデプロイ（該当する場合）

```bash
# Vercel CLIでデプロイ
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

vercel --prod
```

環境変数をVercelダッシュボードで設定:
- `OPENSEARCH_ENDPOINT`
- `OPENSEARCH_INDEX`
- `BEDROCK_MODEL_ID`
- `BEDROCK_REGION`
- `NEXT_PUBLIC_API_GATEWAY_URL`
- AWS認証情報（必要に応じて）

### ステップ5: 統合テスト

#### 5.1 テストスクリプトの実行

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/scripts

# テスト画像を用意（または自動生成）
# brew install imagemagick  # ImageMagickをインストール（未インストールの場合）

# 統合テストを実行
./test-image-search-integration.sh path/to/test-image.jpg
```

期待される出力:

```
==========================================
Image Search Integration Test Suite
==========================================

Configuration:
  Frontend URL: https://your-frontend-domain.com
  API Gateway URL: https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search
  Test Image: test-image.jpg

[INFO] Checking prerequisites...
[INFO] Prerequisites check completed.

==========================================
Test 1: Image Embedding API
==========================================
[INFO] Testing: POST https://your-frontend-domain.com/api/image-embedding
HTTP Status: 200
[INFO] Image embedding API: SUCCESS
{
  "success": true,
  "dimensions": 1024,
  "fileName": "test-image.jpg",
  "cached": false
}

==========================================
Test 2: Lambda Search API (Direct)
==========================================
[INFO] Testing: POST https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search
HTTP Status: 200
[INFO] Lambda Search API: SUCCESS

...

==========================================
Test Summary
==========================================
[INFO] All critical tests passed!
```

#### 5.2 手動テスト

##### 画像ベクトル化のテスト

```bash
curl -X POST "https://your-frontend-domain.com/api/image-embedding" \
  -F "image=@test-image.jpg" \
  | jq .
```

##### 画像検索のテスト

```bash
# 上記で得られたembeddingを使用
curl -X POST "https://your-frontend-domain.com/api/search" \
  -H "Content-Type: application/json" \
  -d '{
    "imageEmbedding": [0.123, -0.456, ...],
    "size": 10
  }' \
  | jq .
```

### ステップ6: モニタリングとアラート

#### 6.1 CloudWatch Logsの確認

```bash
# Lambda関数のログストリーム
aws logs tail /aws/lambda/cis-search-api-production \
  --follow \
  --region ap-northeast-1

# 特定のエラーを検索
aws logs filter-log-events \
  --log-group-name /aws/lambda/cis-search-api-production \
  --filter-pattern "ERROR" \
  --region ap-northeast-1
```

#### 6.2 OpenSearchメトリクスの確認

```bash
# クラスターヘルス
curl -X GET "${OPENSEARCH_ENDPOINT}/_cluster/health" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  | jq .

# k-NN統計
curl -X GET "${OPENSEARCH_ENDPOINT}/_plugins/_knn/stats" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  | jq .

# インデックス統計
curl -X GET "${OPENSEARCH_ENDPOINT}/file-index-v2/_stats" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  | jq '.indices."file-index-v2".total | {docs, store, search, indexing}'
```

#### 6.3 Lambda関数のメトリクス

```bash
# Lambda関数のメトリクスを取得
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=cis-search-api-production \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum \
  --region ap-northeast-1

# エラー率を確認
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=cis-search-api-production \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum \
  --region ap-northeast-1
```

### ステップ7: パフォーマンスチューニング

#### 7.1 OpenSearch `ef_search`パラメータの調整

```bash
# 高精度検索用（レイテンシ増加）
curl -X PUT "${OPENSEARCH_ENDPOINT}/file-index-v2/_settings" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{
    "index.knn.algo_param.ef_search": 1000
  }'

# 高速検索用（精度低下）
curl -X PUT "${OPENSEARCH_ENDPOINT}/file-index-v2/_settings" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{
    "index.knn.algo_param.ef_search": 256
  }'
```

#### 7.2 Lambda関数のメモリ・タイムアウト調整

```bash
# メモリを1024MBに増やす（CPU性能も向上）
aws lambda update-function-configuration \
  --function-name cis-search-api-production \
  --memory-size 1024 \
  --region ap-northeast-1

# タイムアウトを60秒に増やす
aws lambda update-function-configuration \
  --function-name cis-search-api-production \
  --timeout 60 \
  --region ap-northeast-1
```

#### 7.3 画像キャッシュの調整

Frontend（`.env.production`）で設定:

```env
# キャッシュTTL: 24時間
EMBEDDING_CACHE_TTL=86400

# 最大キャッシュエントリ数: 10,000
EMBEDDING_CACHE_MAX_SIZE=10000
```

## トラブルシューティング

### 問題1: 画像ベクトル化が失敗する

**症状**: `/api/image-embedding`が403エラーを返す

**原因**: Bedrockへのアクセス権限不足

**解決策**:

```bash
# IAMロールにBedrockアクセス権限を追加
aws iam put-role-policy \
  --role-name cis-frontend-ec2-role \
  --policy-name BedrockAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": "bedrock:InvokeModel",
        "Resource": "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-image-v1"
      }
    ]
  }'
```

### 問題2: Lambda関数が503エラーを返す

**症状**: API Gatewayが503 Service Unavailableを返す

**原因**: OpenSearchへの接続失敗

**解決策**:

```bash
# 1. OpenSearchクラスターのステータス確認
aws opensearch describe-domain \
  --domain-name cis-filesearch-opensearch \
  --region ap-northeast-1 \
  | jq '{DomainStatus: .DomainStatus.Processing, Endpoint: .DomainStatus.Endpoint}'

# 2. Lambda関数のVPC設定確認
aws lambda get-function-configuration \
  --function-name cis-search-api-production \
  --region ap-northeast-1 \
  | jq .VpcConfig

# 3. セキュリティグループルールの確認
aws ec2 describe-security-groups \
  --group-ids sg-xxxx \
  --region ap-northeast-1 \
  | jq '.SecurityGroups[].IpPermissions'
```

### 問題3: 検索結果が0件

**症状**: 画像検索が常に0件を返す

**原因**: OpenSearchインデックスにデータがない、またはimage_embeddingフィールドがnull

**解決策**:

```bash
# インデックスのドキュメント数を確認
curl -X GET "${OPENSEARCH_ENDPOINT}/file-index-v2/_count" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}"

# image_embeddingが存在するドキュメントを確認
curl -X GET "${OPENSEARCH_ENDPOINT}/file-index-v2/_search" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {
      "exists": {
        "field": "image_embedding"
      }
    },
    "size": 10
  }'
```

### 問題4: 検索が遅い

**症状**: 画像検索のレスポンスタイムが5秒以上

**原因**: `ef_search`が高すぎる、またはk値が大きすぎる

**解決策**:

```bash
# ef_searchを下げる（精度とのトレードオフ）
curl -X PUT "${OPENSEARCH_ENDPOINT}/file-index-v2/_settings" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{
    "index.knn.algo_param.ef_search": 256
  }'

# Lambda関数のメモリを増やす（CPU性能向上）
aws lambda update-function-configuration \
  --function-name cis-search-api-production \
  --memory-size 1024 \
  --region ap-northeast-1
```

## ロールバック手順

### Lambda関数のロールバック

```bash
# 以前のバージョンを確認
aws lambda list-versions-by-function \
  --function-name cis-search-api-production \
  --region ap-northeast-1

# 特定バージョンにロールバック
aws lambda update-alias \
  --function-name cis-search-api-production \
  --name prod \
  --function-version 42 \
  --region ap-northeast-1
```

### OpenSearchインデックスのロールバック

```bash
# 新しいインデックスを削除
curl -X DELETE "${OPENSEARCH_ENDPOINT}/file-index-v2" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}"

# 古いインデックスのエイリアスを変更
curl -X POST "${OPENSEARCH_ENDPOINT}/_aliases" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{
    "actions": [
      { "add": { "index": "file-index-v1", "alias": "file-index" } },
      { "remove": { "index": "file-index-v2", "alias": "file-index" } }
    ]
  }'
```

## 本番運用のベストプラクティス

### セキュリティ

1. **IAM権限の最小化**: Lambda関数には必要最小限の権限のみを付与
2. **VPC内配置**: Lambda関数とOpenSearchを同じVPC内に配置
3. **シークレット管理**: AWS Secrets Managerを使用して機密情報を管理
4. **アクセスログ**: API GatewayとCloudFrontのアクセスログを有効化

### パフォーマンス

1. **Lambda Provisioned Concurrency**: 常時稼働が必要な場合は有効化
2. **OpenSearch ウォームノード**: 頻繁にアクセスされるインデックス用
3. **CloudFront CDN**: 静的アセットとAPIレスポンスのキャッシュ
4. **画像キャッシュ**: 重複画像の検索を高速化

### 可用性

1. **マルチAZ配置**: OpenSearchとLambdaをマルチAZに配置
2. **ヘルスチェック**: API Gatewayとアプリケーションのヘルスチェック
3. **自動スケーリング**: Lambda同時実行数とOpenSearchノード数の調整
4. **バックアップ**: OpenSearchスナップショットの定期取得

### コスト最適化

1. **Lambda予約同時実行数**: 不要な同時実行を制限
2. **OpenSearchインスタンスタイプ**: ワークロードに適したサイズを選択
3. **S3ライフサイクル**: 古い画像をGlacierに移動
4. **CloudWatch Logsの保持期間**: 30日程度に設定

## 参考資料

- [OpenSearch画像検索統合ガイド](/docs/OPENSEARCH_IMAGE_SEARCH_INTEGRATION.md)
- [Lambda Search API実装](/backend/lambda-search-api/README.md)
- [AWS Bedrock Titan Multimodal](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-multimodal-models.html)
- [OpenSearch k-NN Plugin](https://opensearch.org/docs/latest/search-plugins/knn/index/)

## デプロイメントチェックリスト

- [ ] OpenSearchインデックス作成完了
- [ ] Lambda関数デプロイ完了
- [ ] Frontend環境変数設定完了
- [ ] 統合テスト成功
- [ ] CloudWatchアラート設定完了
- [ ] IAM権限確認完了
- [ ] VPCセキュリティグループ確認完了
- [ ] パフォーマンステスト実施
- [ ] ロールバック手順確認
- [ ] 本番運用ドキュメント作成

## サポート

問題が発生した場合は、以下の情報を含めてサポートチームに連絡してください:

1. エラーメッセージとスタックトレース
2. CloudWatch Logsのログストリーム
3. 実行したコマンドと出力
4. 環境情報（Lambda関数バージョン、OpenSearchバージョンなど）
