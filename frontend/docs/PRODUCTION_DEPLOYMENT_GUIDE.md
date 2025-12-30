# 本番環境デプロイメントガイド

CIS File Search Application - 画像検索機能の本番環境デプロイメント手順とチェックリスト

## 目次

1. [前提条件](#前提条件)
2. [環境設定](#環境設定)
3. [デプロイ前チェックリスト](#デプロイ前チェックリスト)
4. [デプロイ手順](#デプロイ手順)
5. [デプロイ後の検証](#デプロイ後の検証)
6. [トラブルシューティング](#トラブルシューティング)
7. [ロールバック手順](#ロールバック手順)

---

## 前提条件

### 必須リソース

- [ ] AWS OpenSearch Service ドメイン (VPC内)
- [ ] AWS Bedrock アクセス権限 (us-east-1リージョン)
- [ ] S3バケット (cis-filesearch-storage)
- [ ] EC2インスタンス（またはECS/Fargate）with IAMロール
- [ ] CloudWatch Logs ロググループ
- [ ] Cognito User Pool（認証用）

### IAMロール権限

本番環境のEC2/ECS IAMロールに以下の権限が必要です：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel"
      ],
      "Resource": "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-image-v1"
    },
    {
      "Effect": "Allow",
      "Action": [
        "es:ESHttpGet",
        "es:ESHttpPost",
        "es:ESHttpPut",
        "es:ESHttpDelete"
      ],
      "Resource": "arn:aws:es:ap-northeast-1:*:domain/cis-filesearch-opensearch/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::cis-filesearch-storage/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:ap-northeast-1:*:log-group:/aws/lambda/cis-filesearch:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricData"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## 環境設定

### 1. 本番環境変数の設定

`/frontend/.env.production` ファイルを作成し、以下の設定を行います：

```bash
# ========================================
# OpenSearch Configuration
# ========================================
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh5x3uqe.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index

# ========================================
# AWS Configuration
# ========================================
AWS_REGION=ap-northeast-1

# ⚠️ 本番環境ではIAMロールを使用（認証情報不要）

# ========================================
# S3 Configuration
# ========================================
S3_BUCKET=cis-filesearch-storage
S3_PROCESSED_PREFIX=processed/
S3_THUMBNAIL_PREFIX=thumbnails/
S3_PRESIGNED_URL_EXPIRES=300

# ========================================
# AWS Bedrock Configuration
# ========================================
BEDROCK_MODEL_ID=amazon.titan-embed-image-v1
BEDROCK_REGION=us-east-1

# ⚠️ 本番環境では必ずfalseに設定
USE_MOCK_EMBEDDING=false

# ========================================
# Performance Optimization
# ========================================
EMBEDDING_CACHE_TTL=86400          # 24時間
EMBEDDING_CACHE_MAX_SIZE=10000     # 最大10,000エントリ
OPENSEARCH_REQUEST_TIMEOUT=30000   # 30秒
OPENSEARCH_MAX_RETRIES=3
OPENSEARCH_BATCH_SIZE=100

# ========================================
# Monitoring & Logging
# ========================================
ENABLE_CLOUDWATCH_LOGS=true
LOG_LEVEL=info
LOG_GROUP_NAME=/aws/lambda/cis-filesearch
ENABLE_PERFORMANCE_METRICS=true
METRICS_NAMESPACE=CISFileSearch
ENABLE_ERROR_TRACKING=true

# ========================================
# Security Settings
# ========================================
NEXT_PUBLIC_CSP_ENABLED=true
API_RATE_LIMIT_PER_MINUTE=100
API_RATE_LIMIT_PER_HOUR=1000

# ========================================
# Node Environment
# ========================================
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
```

### 2. AWS Systems Manager Parameter Store（推奨）

本番環境では、機密情報をParameter Storeに保存することを推奨します：

```bash
# パラメータを作成
aws ssm put-parameter \
  --name "/cis-filesearch/opensearch/endpoint" \
  --value "https://vpc-cis-filesearch-opensearch-..." \
  --type "SecureString" \
  --region ap-northeast-1

# EC2起動時に環境変数として読み込む（User Data）
export OPENSEARCH_ENDPOINT=$(aws ssm get-parameter \
  --name "/cis-filesearch/opensearch/endpoint" \
  --with-decryption \
  --query "Parameter.Value" \
  --output text \
  --region ap-northeast-1)
```

---

## デプロイ前チェックリスト

### インフラストラクチャ

- [ ] OpenSearchドメインが稼働中
- [ ] OpenSearchのインデックス `file-index` が存在
- [ ] S3バケット `cis-filesearch-storage` が存在
- [ ] EC2/ECSのIAMロールに必要な権限が付与されている
- [ ] CloudWatchロググループ `/aws/lambda/cis-filesearch` が作成されている
- [ ] VPCセキュリティグループでOpenSearchへのアクセスが許可されている

### コード

- [ ] `.env.production` が正しく設定されている
- [ ] `USE_MOCK_EMBEDDING=false` になっている
- [ ] 全てのテストが成功している
- [ ] TypeScriptのビルドエラーがない
- [ ] Lintエラーがない

### セキュリティ

- [ ] AWS認証情報がハードコードされていない
- [ ] 環境変数ファイルが `.gitignore` に含まれている
- [ ] IAMロールの最小権限原則が適用されている
- [ ] HTTPS/TLSが有効になっている

---

## デプロイ手順

### 1. ビルド

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

# 依存関係をインストール
yarn install --frozen-lockfile

# 本番ビルド
NODE_ENV=production yarn build

# ビルド結果を確認
ls -la .next/
```

### 2. デプロイ（EC2の場合）

```bash
# 1. 既存プロセスを停止
pm2 stop cis-filesearch-frontend

# 2. 最新コードをデプロイ
rsync -avz --exclude 'node_modules' --exclude '.next' \
  ./ ec2-user@<EC2-IP>:/opt/cis-filesearch/frontend/

# 3. EC2でビルド
ssh ec2-user@<EC2-IP>
cd /opt/cis-filesearch/frontend
yarn install --frozen-lockfile
NODE_ENV=production yarn build

# 4. 環境変数を設定（Parameter Storeから取得）
export $(cat .env.production | xargs)

# 5. アプリケーションを起動
pm2 start yarn --name "cis-filesearch-frontend" -- start
pm2 save
```

### 3. デプロイ（Docker/ECSの場合）

```bash
# 1. Dockerイメージをビルド
docker build -t cis-filesearch-frontend:latest \
  --build-arg NODE_ENV=production \
  -f Dockerfile .

# 2. ECRにプッシュ
aws ecr get-login-password --region ap-northeast-1 | \
  docker login --username AWS --password-stdin <ECR-URL>

docker tag cis-filesearch-frontend:latest <ECR-URL>/cis-filesearch-frontend:latest
docker push <ECR-URL>/cis-filesearch-frontend:latest

# 3. ECSサービスを更新
aws ecs update-service \
  --cluster cis-filesearch-cluster \
  --service cis-filesearch-frontend \
  --force-new-deployment \
  --region ap-northeast-1
```

---

## デプロイ後の検証

### 1. ヘルスチェック

```bash
# アプリケーションが起動しているか確認
curl -I http://localhost:3000/

# Expected: HTTP/1.1 200 OK
```

### 2. AWS Bedrock接続テスト

```bash
# 画像エンベディングAPIをテスト
curl -X POST http://localhost:3000/api/image-embedding \
  -F "image=@test-image.jpg"

# Expected:
# {
#   "success": true,
#   "data": {
#     "embedding": [...],
#     "dimensions": 1024,
#     "cached": false
#   }
# }
```

### 3. OpenSearch接続テスト

```bash
# 検索APIをテスト
curl "http://localhost:3000/api/search?q=test&searchMode=and"

# Expected:
# {
#   "results": [...],
#   "total": 10,
#   "took": 123
# }
```

### 4. ログ確認

```bash
# CloudWatch Logsを確認
aws logs tail /aws/lambda/cis-filesearch --follow --region ap-northeast-1

# EC2の場合はpm2ログを確認
pm2 logs cis-filesearch-frontend
```

### 5. パフォーマンスメトリクス確認

```bash
# CloudWatchメトリクスを確認
aws cloudwatch get-metric-statistics \
  --namespace CISFileSearch \
  --metric-name EmbeddingGenerationTime \
  --start-time 2025-01-01T00:00:00Z \
  --end-time 2025-01-01T23:59:59Z \
  --period 3600 \
  --statistics Average,Maximum,Minimum \
  --region ap-northeast-1
```

### 6. エンドツーエンドテスト

本番環境で以下の機能を手動でテスト：

- [ ] 画像検索機能が動作する
- [ ] 検索結果が正しく表示される
- [ ] 画像アップロードが成功する
- [ ] キャッシュが機能している（2回目のアップロードが高速）
- [ ] エラー処理が適切に動作する

---

## トラブルシューティング

### AWS Bedrock認証エラー

**症状:**
```
Error: AWS credentials not configured for Bedrock access
```

**解決策:**
1. EC2 IAMロールを確認
   ```bash
   aws sts get-caller-identity
   ```

2. Bedrockアクセス権限を確認
   ```bash
   aws iam get-role-policy \
     --role-name <EC2-ROLE-NAME> \
     --policy-name BedrockAccess
   ```

3. 認証情報を強制リフレッシュ
   ```bash
   pm2 restart cis-filesearch-frontend
   ```

### OpenSearch接続エラー

**症状:**
```
Error: OpenSearch client is not available
```

**解決策:**
1. VPCエンドポイントに接続可能か確認
   ```bash
   curl -X GET "https://vpc-cis-filesearch-opensearch-.../_cluster/health"
   ```

2. セキュリティグループを確認
   ```bash
   aws ec2 describe-security-groups \
     --group-ids <SG-ID> \
     --region ap-northeast-1
   ```

3. IAMロールのOpenSearchアクセス権限を確認

### パフォーマンス問題

**症状:**
画像エンベディング生成が遅い

**解決策:**
1. キャッシュ統計を確認
   ```bash
   # ログでキャッシュヒット率を確認
   aws logs filter-log-events \
     --log-group-name /aws/lambda/cis-filesearch \
     --filter-pattern "Cache hit rate" \
     --region ap-northeast-1
   ```

2. Bedrockレイテンシを確認
   ```bash
   # CloudWatchメトリクスでEmbeddingGenerationTimeを確認
   ```

3. キャッシュサイズを増やす
   ```bash
   # .env.productionで調整
   EMBEDDING_CACHE_MAX_SIZE=20000
   ```

---

## ロールバック手順

問題が発生した場合、以下の手順で前バージョンに戻します：

### EC2の場合

```bash
# 1. pm2を停止
pm2 stop cis-filesearch-frontend

# 2. 前のバージョンに戻す
cd /opt/cis-filesearch/frontend
git checkout <PREVIOUS-COMMIT>
yarn install --frozen-lockfile
NODE_ENV=production yarn build

# 3. 再起動
pm2 restart cis-filesearch-frontend
```

### ECSの場合

```bash
# 前のタスク定義リビジョンにロールバック
aws ecs update-service \
  --cluster cis-filesearch-cluster \
  --service cis-filesearch-frontend \
  --task-definition cis-filesearch-frontend:<PREVIOUS-REVISION> \
  --region ap-northeast-1
```

---

## パフォーマンス最適化レポート

### 実装した最適化

1. **AWS認証トークン自動更新**
   - 1時間ごとにBedrockクライアントをリフレッシュ
   - 認証トークン期限切れエラーを防止

2. **画像エンベディングキャッシュ**
   - LRUキャッシュアルゴリズム
   - 最大10,000エントリ、24時間TTL
   - 期待効果: 同じ画像の再処理で95%以上高速化

3. **リトライロジック**
   - 指数バックオフ with ジッター
   - 最大3回リトライ
   - リトライ可能なエラーを自動判定

4. **OpenSearch接続最適化**
   - Gzip圧縮有効化
   - 接続プール設定
   - タイムアウト設定（30秒）

5. **CloudWatch監視**
   - パフォーマンスメトリクスの自動収集
   - 構造化ログ
   - エラートラッキング

### 期待されるパフォーマンス向上

| メトリクス | 最適化前 | 最適化後 | 改善率 |
|-----------|---------|---------|-------|
| 画像エンベディング生成（初回） | 2,000ms | 2,000ms | - |
| 画像エンベディング生成（キャッシュヒット） | 2,000ms | 50ms | **97.5%** |
| OpenSearch検索レイテンシ | 500ms | 300ms | **40%** |
| エラー回復時間 | 10,000ms | 3,000ms | **70%** |
| キャッシュヒット率 | 0% | 80-90% | - |

---

## サポート連絡先

問題が発生した場合：

1. CloudWatchログを確認: `/aws/lambda/cis-filesearch`
2. 本ドキュメントのトラブルシューティングセクションを参照
3. 開発チームに連絡

---

**最終更新日:** 2025-01-18
**バージョン:** 1.0.0
