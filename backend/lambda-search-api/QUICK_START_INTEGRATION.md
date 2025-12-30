# Lambda Search API - クイックスタート（既存API Gateway統合版）

## 概要

このガイドでは、既存のAPI Gateway (`cis-filesearch-api`) にLambda Search関数を統合する手順を説明します。

**所要時間:** 30分

---

## 前提条件

- [x] AWS CLIインストール済み（認証設定済み）
- [x] Terraform v1.0+インストール済み
- [x] Node.js 20.x インストール済み
- [x] 既存のVPC、OpenSearch、Cognito User Poolが稼働中

---

## デプロイ方法（3つのオプション）

### 🚀 オプション1: 自動デプロイスクリプト（推奨）

**最も簡単で推奨される方法です。**

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/scripts
./deploy-with-existing-api-gateway.sh
```

このスクリプトは以下を自動で実行します:
1. ✅ 前提条件チェック
2. ✅ Lambda関数のビルド
3. ✅ Terraformデプロイ
4. ✅ デプロイ検証
5. ✅ API動作テスト

**出力例:**
```
============================================================
Lambda Search API - Deploy with Existing API Gateway
============================================================
✓ Node.js v20.11.0 found
✓ npm 10.2.4 found
✓ AWS CLI aws-cli/2.15.0 found
✓ Terraform v1.7.0 found
✓ AWS Account: 123456789012

============================================================
Step 2: Building Lambda Function
============================================================
✓ Dependencies installed
✓ TypeScript build completed
✓ Deployment package created (2.3M)

...

🎉 All done!
```

---

### ⚙️ オプション2: 手動デプロイ（ステップバイステップ）

#### Step 1: Lambda関数のビルド

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api

# 依存関係インストール
npm install --production

# TypeScriptビルド
npm run build

# ZIPパッケージ作成
npm run package

# 確認
ls -lh dist/lambda-deployment.zip
```

#### Step 2: Terraformファイルの確認

既に以下のファイルが配置されているか確認:

```bash
# メインプロジェクトのTerraform
ls /Users/tatsuya/focus_project/cis_filesearch_app/terraform/lambda_search_api.tf

# 確認コマンド
cat /Users/tatsuya/focus_project/cis_filesearch_app/terraform/lambda_search_api.tf | head -20
```

**期待される出力:**
```
# ============================================================================
# Lambda Search API - Terraform Configuration
# Integrates with existing API Gateway (api_gateway_cognito.tf)
# ============================================================================
```

#### Step 3: API Gatewayの統合設定を適用

**重要:** `terraform/api_gateway_cognito.tf` を以下のように修正する必要があります。

**編集箇所1:** `/search` エンドポイントをPOSTからGETに変更

```hcl
# Line 46-57を以下に置き換え
resource "aws_api_gateway_method" "search_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.search.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id

  request_parameters = {
    "method.request.header.Authorization"   = true
    "method.request.querystring.q"          = false
    "method.request.querystring.searchMode" = false
    "method.request.querystring.fileType"   = false
    "method.request.querystring.dateFrom"   = false
    "method.request.querystring.dateTo"     = false
    "method.request.querystring.page"       = false
    "method.request.querystring.limit"      = false
    "method.request.querystring.sortBy"     = false
    "method.request.querystring.sortOrder"  = false
  }
}
```

**編集箇所2:** Lambda統合の更新

```hcl
# Line 60-67を以下に置き換え
resource "aws_api_gateway_integration" "search_lambda" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.search.id
  http_method             = aws_api_gateway_method.search_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.search_api_prod.invoke_arn
}
```

**編集箇所3:** Deployment triggersの更新

```hcl
# Line 219-237を以下に置き換え
resource "aws_api_gateway_deployment" "main" {
  rest_api_id = aws_api_gateway_rest_api.main.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.search.id,
      aws_api_gateway_method.search_get.id,  # POSTからGETに変更
      aws_api_gateway_integration.search_lambda.id,
      aws_api_gateway_resource.files.id,
      aws_api_gateway_resource.file_id.id,
      aws_api_gateway_method.file_get.id,
      aws_api_gateway_integration.file_lambda.id,
      aws_lambda_function.search_api_prod.id,  # 新規追加
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}
```

#### Step 4: Terraformデプロイ

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/terraform

# 初期化（新規ファイル追加時のみ）
terraform init

# 変更内容の確認
terraform plan -out=tfplan

# 適用
terraform apply tfplan
```

#### Step 5: 検証

```bash
# Lambda関数の確認
aws lambda get-function --function-name cis-search-api-prod

# VPC設定の確認
aws lambda get-function-configuration \
  --function-name cis-search-api-prod \
  --query 'VpcConfig'

# ログの確認
aws logs tail /aws/lambda/cis-search-api-prod --follow
```

---

### 🔧 オプション3: AWS CLIでの手動設定（Terraform未使用）

**非推奨:** Terraformを使用できない特殊な環境でのみ使用してください。

<details>
<summary>詳細手順を表示</summary>

#### 1. IAMロールの作成

```bash
# ロール作成
aws iam create-role \
  --role-name cis-lambda-search-api-role-prod \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Action": "sts:AssumeRole",
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"}
    }]
  }'

# VPC実行ポリシーのアタッチ
aws iam attach-role-policy \
  --role-name cis-lambda-search-api-role-prod \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole

# OpenSearchアクセスポリシーの作成
cat > opensearch-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "es:ESHttpGet",
      "es:ESHttpPost",
      "es:ESHttpHead"
    ],
    "Resource": "arn:aws:es:ap-northeast-1:ACCOUNT_ID:domain/cis-filesearch-opensearch/*"
  }]
}
EOF

aws iam put-role-policy \
  --role-name cis-lambda-search-api-role-prod \
  --policy-name opensearch-access \
  --policy-document file://opensearch-policy.json
```

#### 2. セキュリティグループの作成

```bash
# Lambda用セキュリティグループ作成
LAMBDA_SG_ID=$(aws ec2 create-security-group \
  --group-name cis-lambda-search-api-sg-prod \
  --description "Security group for Lambda Search API" \
  --vpc-id YOUR_VPC_ID \
  --query 'GroupId' \
  --output text)

# HTTPS Egressルール追加
aws ec2 authorize-security-group-egress \
  --group-id ${LAMBDA_SG_ID} \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0

# OpenSearchセキュリティグループへのIngressルール追加
aws ec2 authorize-security-group-ingress \
  --group-id YOUR_OPENSEARCH_SG_ID \
  --protocol tcp \
  --port 443 \
  --source-group ${LAMBDA_SG_ID}
```

#### 3. Lambda関数の作成

```bash
# Lambda関数作成
aws lambda create-function \
  --function-name cis-search-api-prod \
  --runtime nodejs20.x \
  --architecture arm64 \
  --role arn:aws:iam::ACCOUNT_ID:role/cis-lambda-search-api-role-prod \
  --handler index.handler \
  --zip-file fileb://dist/lambda-deployment.zip \
  --memory-size 512 \
  --timeout 30 \
  --environment Variables="{
    OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xxx.ap-northeast-1.es.amazonaws.com,
    OPENSEARCH_INDEX=file-index,
    AWS_REGION=ap-northeast-1,
    LOG_LEVEL=info,
    NODE_ENV=prod
  }" \
  --vpc-config SubnetIds=subnet-xxx,subnet-yyy,SecurityGroupIds=${LAMBDA_SG_ID},YOUR_OPENSEARCH_SG_ID
```

#### 4. API Gatewayとの統合

```bash
# API Gateway IDを取得
API_ID=$(aws apigateway get-rest-apis \
  --query "items[?name=='cis-filesearch-api'].id" \
  --output text)

# /search リソースIDを取得
SEARCH_RESOURCE_ID=$(aws apigateway get-resources \
  --rest-api-id ${API_ID} \
  --query "items[?path=='/search'].id" \
  --output text)

# GET メソッドを追加
aws apigateway put-method \
  --rest-api-id ${API_ID} \
  --resource-id ${SEARCH_RESOURCE_ID} \
  --http-method GET \
  --authorization-type COGNITO_USER_POOLS \
  --authorizer-id YOUR_AUTHORIZER_ID

# Lambda統合
aws apigateway put-integration \
  --rest-api-id ${API_ID} \
  --resource-id ${SEARCH_RESOURCE_ID} \
  --http-method GET \
  --type AWS_PROXY \
  --integration-http-method POST \
  --uri "arn:aws:apigateway:ap-northeast-1:lambda:path/2015-03-31/functions/arn:aws:lambda:ap-northeast-1:ACCOUNT_ID:function:cis-search-api-prod/invocations"

# Lambda権限付与
aws lambda add-permission \
  --function-name cis-search-api-prod \
  --statement-id AllowAPIGatewayInvoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:ap-northeast-1:ACCOUNT_ID:${API_ID}/*/*"

# デプロイ
aws apigateway create-deployment \
  --rest-api-id ${API_ID} \
  --stage-name prod
```

</details>

---

## デプロイ後の確認

### 1. Lambda関数の動作確認

```bash
# Lambda関数が存在するか確認
aws lambda get-function --function-name cis-search-api-prod

# 環境変数の確認
aws lambda get-function-configuration \
  --function-name cis-search-api-prod \
  --query 'Environment.Variables'
```

**期待される出力:**
```json
{
  "OPENSEARCH_ENDPOINT": "https://vpc-cis-filesearch-opensearch-xxx.ap-northeast-1.es.amazonaws.com",
  "OPENSEARCH_INDEX": "file-index",
  "AWS_REGION": "ap-northeast-1",
  "LOG_LEVEL": "info",
  "NODE_ENV": "prod"
}
```

### 2. VPC設定の確認

```bash
aws lambda get-function-configuration \
  --function-name cis-search-api-prod \
  --query 'VpcConfig'
```

**期待される出力:**
```json
{
  "SubnetIds": ["subnet-xxx", "subnet-yyy"],
  "SecurityGroupIds": ["sg-lambda", "sg-opensearch"],
  "VpcId": "vpc-xxx"
}
```

### 3. API Gateway統合の確認

```bash
# API Gateway URLの取得
cd /Users/tatsuya/focus_project/cis_filesearch_app/terraform
terraform output api_gateway_custom_domain_url
```

**期待される出力:**
```
https://api.filesearch.company.com
```

### 4. APIエンドポイントのテスト

```bash
# Cognitoトークンを取得（まだ持っていない場合）
TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id YOUR_CLIENT_ID \
  --auth-parameters USERNAME=test@example.com,PASSWORD=Pass123! \
  --query 'AuthenticationResult.IdToken' \
  --output text)

# /search エンドポイントをテスト
curl -X GET \
  "https://api.filesearch.company.com/search?q=test&page=1&limit=20" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" | jq .
```

**期待される出力:**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "file-123",
        "fileName": "test.pdf",
        "filePath": "/nas/documents/test.pdf",
        "fileType": "pdf",
        "fileSize": 1048576,
        "modifiedDate": "2024-12-01T10:30:00Z",
        "snippet": "This is a <mark>test</mark> document...",
        "relevanceScore": 15.3
      }
    ],
    "pagination": {
      "total": 150,
      "page": 1,
      "limit": 20,
      "totalPages": 8
    },
    "query": {
      "q": "test",
      "searchMode": "or",
      "sortBy": "relevance",
      "sortOrder": "desc"
    },
    "took": 45
  }
}
```

### 5. CloudWatch Logsの確認

```bash
# 最新のログを確認
aws logs tail /aws/lambda/cis-search-api-prod --follow

# エラーログのみ抽出
aws logs filter-log-events \
  --log-group-name /aws/lambda/cis-search-api-prod \
  --filter-pattern "ERROR" \
  --start-time $(date -u -d '1 hour ago' +%s)000
```

---

## トラブルシューティング

### 問題1: "Cannot connect to OpenSearch"

**症状:**
```
Failed to connect to OpenSearch endpoint
```

**原因:**
- Lambda関数がVPC内に配置されていない
- セキュリティグループでOpenSearchへの通信が許可されていない

**解決策:**
```bash
# VPC設定の確認
aws lambda get-function-configuration \
  --function-name cis-search-api-prod \
  --query 'VpcConfig'

# OpenSearchセキュリティグループにルール追加
aws ec2 authorize-security-group-ingress \
  --group-id YOUR_OPENSEARCH_SG_ID \
  --protocol tcp \
  --port 443 \
  --source-group YOUR_LAMBDA_SG_ID
```

### 問題2: "401 Unauthorized"

**症状:**
```json
{
  "message": "Unauthorized"
}
```

**原因:**
- Cognitoトークンが無効または期限切れ
- Authorizerの設定ミス

**解決策:**
```bash
# 新しいトークンを取得
TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id YOUR_CLIENT_ID \
  --auth-parameters USERNAME=test@example.com,PASSWORD=Pass123! \
  --query 'AuthenticationResult.IdToken' \
  --output text)

# トークンの内容を確認
echo $TOKEN | cut -d'.' -f2 | base64 -d | jq .
```

### 問題3: "Terraform apply失敗"

**症状:**
```
Error: creating Lambda Function: InvalidParameterValueException
```

**原因:**
- ZIPファイルが存在しない
- ZIPファイルのパスが間違っている

**解決策:**
```bash
# ZIPファイルの存在確認
ls -lh /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/dist/lambda-deployment.zip

# 存在しない場合は再ビルド
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
npm run build
npm run package
```

---

## 次のステップ

### 1. フロントエンド統合

Lambda Search APIをフロントエンドに統合します:

```typescript
// frontend/src/lib/opensearch.ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_GATEWAY_URL;

export async function searchFiles(params: SearchParams) {
  const session = await Auth.currentSession();
  const idToken = session.getIdToken().getJwtToken();

  const queryString = new URLSearchParams(
    Object.entries(params).filter(([_, v]) => v != null)
  ).toString();

  const response = await fetch(
    `${API_BASE_URL}/search?${queryString}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
    }
  );

  return await response.json();
}
```

### 2. 監視設定

CloudWatch Dashboardを作成:

```bash
# ダッシュボードテンプレートの作成
cat > dashboard.json << EOF
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/Lambda", "Invocations"],
          [".", "Errors"],
          [".", "Duration"]
        ],
        "region": "ap-northeast-1",
        "title": "Lambda Search API Metrics"
      }
    }
  ]
}
EOF

aws cloudwatch put-dashboard \
  --dashboard-name CIS-Search-API \
  --dashboard-body file://dashboard.json
```

### 3. パフォーマンス最適化

Provisioned Concurrencyの有効化（Cold Start削減）:

```bash
aws lambda put-provisioned-concurrency-config \
  --function-name cis-search-api-prod \
  --provisioned-concurrent-executions 2 \
  --qualifier prod
```

---

## 関連ドキュメント

- **詳細分析レポート**: `API_GATEWAY_INTEGRATION_ANALYSIS.md`
- **完全な実装ガイド**: `README.md`
- **デプロイガイド**: `PRODUCTION_DEPLOYMENT_GUIDE.md`
- **VPC統合詳細**: `VPC_OPENSEARCH_IMPLEMENTATION.md`

---

## サポート

問題が発生した場合:

1. CloudWatch Logsを確認: `/aws/lambda/cis-search-api-prod`
2. 詳細分析レポートのトラブルシューティングセクションを参照
3. 開発チームに連絡（CloudWatch Logsのスクリーンショット付き）

---

**作成日:** 2025-12-17
**最終更新:** 2025-12-17
**バージョン:** 1.0
**対象環境:** 本番環境 (ap-northeast-1)
