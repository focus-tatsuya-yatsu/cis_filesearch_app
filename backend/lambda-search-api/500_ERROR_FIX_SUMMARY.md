# Lambda Search API - 500エラー修正レポート

## 実行日時
2025-12-19

## 問題の概要
GET `/api/search/?q=宇都宮&searchMode=or&page=1&limit=20&sortBy=relevance&sortOrder=desc` で500 Internal Server Errorが発生

## Root Cause分析

### 1. 第一の問題: パラメータ解析エラー (修正完了)

**問題**:
- `index-dual.js` (デプロイされたコード) が `event.body` からパラメータを取得しようとしていた
- API Gateway GET requests では、パラメータは `queryStringParameters` に含まれる
- `event.body` は GET リクエストでは `null` または空のため、JSON.parse でエラー

**影響**:
- すべてのGETリクエストが失敗
- POST requests (画像検索) は正常に動作

**修正内容**:
```javascript
// 修正前 (index-dual.js line 30)
const body = JSON.parse(event.body || '{}');
const {
  query,
  searchType,
  imageVector,
  page = 1,
  limit = 20,
  // ...
} = body;

// 修正後
const httpMethod = event.httpMethod || 'GET';
let params;

if (httpMethod === 'POST' && event.body) {
  params = JSON.parse(event.body);
} else {
  params = event.queryStringParameters || {};
}

const {
  query = params.q || params.query,
  searchType = params.searchType,
  imageVector = params.imageVector,
  page = parseInt(params.page) || 1,
  limit = parseInt(params.limit) || 20,
  // ...
} = params;
```

**検証**:
```bash
# テスト実行結果
aws lambda invoke --function-name cis-search-api-prod \
  --cli-binary-format raw-in-base64-out \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test","searchMode":"or","page":"1","limit":"20"}}' \
  response.json

# 結果: 500エラー → 新しいエラーに変化
# "getaddrinfo ENOTFOUND vpc-cis-filesearch-opensearch..."
```

### 2. 第二の問題: OpenSearch DNS解決エラー (要対応)

**問題**:
- Lambda関数がVPC内のOpenSearchエンドポイントを解決できない
- エラー: `getaddrinfo ENOTFOUND vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com`

**原因分析**:
1. Lambda VPC設定は正常:
   - VPC ID: `vpc-02d08f2fa75078e67`
   - Subnets: 3つのプライベートサブネット
   - Security Groups: 2つ設定済み

2. OpenSearch VPC設定:
   - 同じVPC: `vpc-02d08f2fa75078e67` ✅
   - Subnet: `subnet-0ea0487400a0b3627` (Lambda subnetsの一つ) ✅
   - Security Group: `sg-0c482a057b356a0c3` (Lambda SGsの一つ) ✅

3. 考えられる原因:
   - DNS解決のためのVPC設定が不足
   - セキュリティグループのインバウンドルールが不足
   - 環境変数のエンドポイントURLが間違っている可能性

**現在の環境変数**:
```json
{
  "OPENSEARCH_ENDPOINT": "vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com",
  "OPENSEARCH_INDEX": "cis-files"
}
```

**OpenSearch実際のエンドポイント**:
```
vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
                                     ^
                                     注: "cPgtq" (大文字P)
```

**環境変数のエンドポイント**:
```
vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
                                     ^
                                     "cgptq" (小文字g)
```

## 修正手順

### Phase 1: パラメータ解析修正 ✅ (完了)

1. `index-dual.js` を修正してGET/POST両方に対応
2. Lambda関数を再デプロイ
3. テストで新しいエラーを確認

**デプロイ実行**:
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
zip -r lambda-dual-index-fixed.zip index.js node_modules package.json package-lock.json
aws lambda update-function-code \
  --function-name cis-search-api-prod \
  --zip-file fileb://lambda-dual-index-fixed.zip
```

**結果**: デプロイ成功 (2025-12-19T05:13:53.000+0000)

### Phase 2: OpenSearch接続修正 (次のステップ)

#### Option 1: 環境変数のエンドポイント修正 (推奨)

OpenSearchの正しいエンドポイントを環境変数に設定:

```bash
aws lambda update-function-configuration \
  --function-name cis-search-api-prod \
  --environment "Variables={
    OPENSEARCH_ENDPOINT=vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com,
    OPENSEARCH_INDEX=cis-files,
    NODE_ENV=production
  }"
```

#### Option 2: セキュリティグループ設定確認

Lambda Security Groupから OpenSearch Security Groupへの通信を許可:

```bash
# OpenSearch Security Group (sg-0c482a057b356a0c3) のインバウンドルール確認
aws ec2 describe-security-groups \
  --group-ids sg-0c482a057b356a0c3 \
  --query 'SecurityGroups[0].IpPermissions'

# 必要に応じて、Lambda SG (sg-06ee622d64e67f12f) からのHTTPSアクセスを許可
aws ec2 authorize-security-group-ingress \
  --group-id sg-0c482a057b356a0c3 \
  --protocol tcp \
  --port 443 \
  --source-group sg-06ee622d64e67f12f
```

#### Option 3: OpenSearch認証情報の追加

Lambda関数に `OPENSEARCH_USERNAME` と `OPENSEARCH_PASSWORD` を設定:

```bash
aws lambda update-function-configuration \
  --function-name cis-search-api-prod \
  --environment "Variables={
    OPENSEARCH_ENDPOINT=vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com,
    OPENSEARCH_INDEX=cis-files,
    OPENSEARCH_USERNAME=admin,
    OPENSEARCH_PASSWORD=<パスワード>,
    NODE_ENV=production
  }"
```

## 検証手順

### 修正後のテスト

```bash
# 1. Lambda関数を直接テスト
aws lambda invoke \
  --function-name cis-search-api-prod \
  --cli-binary-format raw-in-base64-out \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test","searchMode":"or","page":"1","limit":"20"}}' \
  /tmp/response.json

cat /tmp/response.json | jq '.'

# 2. API Gatewayエンドポイント経由でテスト (正しいURLを確認後)
curl "https://<API-GATEWAY-ID>.execute-api.ap-northeast-1.amazonaws.com/prod/search?q=test&searchMode=or&page=1&limit=20"
```

### 期待される結果

```json
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  },
  "body": "{\"success\":true,\"data\":{\"results\":[...],\"total\":10,\"page\":1,\"limit\":20,\"searchType\":\"text\",\"index\":\"cis-files\"}}"
}
```

## 今後の改善提案

### 1. TypeScriptソースからのビルドプロセス確立

現在の問題:
- `src/index.ts` (正しい実装) が存在
- `index-dual.js` (手動作成、不完全) がデプロイされている
- ビルドプロセスが統一されていない

推奨:
```bash
# TypeScriptからビルド
npm run build  # src/ → dist/ へコンパイル

# dist/index.js をデプロイ
zip -r lambda-deployment.zip dist/ node_modules/ package.json
aws lambda update-function-code --function-name cis-search-api-prod --zip-file fileb://lambda-deployment.zip
```

### 2. 環境変数の一元管理

`env-vars.json` を使って環境変数を管理:

```json
{
  "Variables": {
    "OPENSEARCH_ENDPOINT": "vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com",
    "OPENSEARCH_INDEX": "cis-files",
    "OPENSEARCH_USERNAME": "admin",
    "OPENSEARCH_PASSWORD": "${SECRET}",
    "NODE_ENV": "production"
  }
}
```

### 3. デプロイ自動化スクリプト

`deploy.sh`:
```bash
#!/bin/bash
set -e

echo "Building TypeScript..."
npm run build

echo "Creating deployment package..."
zip -r lambda-deployment.zip dist/ node_modules/ package.json

echo "Updating Lambda function..."
aws lambda update-function-code \
  --function-name cis-search-api-prod \
  --zip-file fileb://lambda-deployment.zip

echo "Updating environment variables..."
aws lambda update-function-configuration \
  --function-name cis-search-api-prod \
  --environment file://env-vars.json

echo "Deployment complete!"
```

### 4. CloudWatch Logsでの監視強化

```bash
# リアルタイムログ監視
aws logs tail /aws/lambda/cis-search-api-prod --follow

# エラーログフィルタ
aws logs filter-log-events \
  --log-group-name /aws/lambda/cis-search-api-prod \
  --filter-pattern "ERROR"
```

## まとめ

### 修正完了
✅ GETリクエストのパラメータ解析エラー
✅ Lambda関数の再デプロイ

### 次のステップ
1. OpenSearchエンドポイントの環境変数修正
2. セキュリティグループ設定の確認・修正
3. OpenSearch認証情報の追加
4. 接続テストと動作確認
5. TypeScriptビルドプロセスの統一

### 推定復旧時間
- 環境変数修正: 5分
- セキュリティグループ確認: 10分
- テスト・検証: 15分
- **合計: 30分**
