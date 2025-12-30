# 既存API Gateway統合分析レポート

## エグゼクティブサマリー

**結論: 既存API Gatewayを使用することを推奨します**

既存の `cis-filesearch-image-search-API` (ID: 5xbn5nq51f) を活用することで、Lambda Search関数を迅速かつ安全に統合できます。このアプローチにより、以下のメリットが得られます:

- ✅ **統一されたAPIエンドポイント**: フロントエンドから単一のAPI Gatewayを経由
- ✅ **共通の認証基盤**: 既存のCognito Authorizerを再利用
- ✅ **運用コストの削減**: 複数のAPI Gatewayを管理する必要がない
- ✅ **一貫したCORS設定**: 既存設定をベースに構築
- ✅ **統合されたモニタリング**: CloudWatch Metrics/Logsの一元管理

---

## 1. 現状分析

### 1.1 既存API Gateway (`terraform/api_gateway_cognito.tf`)

```
API名: cis-filesearch-api (Terraformで管理)
タイプ: REST API
エンドポイント: REGIONAL
認証: Cognito User Pools (aws_api_gateway_authorizer.cognito)

既存リソース:
├── /search (POST) → Lambda: aws_lambda_function.search_api
├── /files
│   └── /{id} (GET) → Lambda: aws_lambda_function.file_api
└── CORS設定済み (OPTIONS メソッド)
```

### 1.2 新規Lambda Search関数

```
関数名: cis-search-api-prod
ランタイム: Node.js 20.x (ARM64)
メモリ: 512MB
タイムアウト: 30秒
VPC: プライベートサブネット配置
接続先: OpenSearch VPC Endpoint
```

### 1.3 発見した問題点

**重複定義が存在します:**

1. **メインプロジェクトのTerraform** (`terraform/api_gateway_cognito.tf`)
   - 既に `aws_lambda_function.search_api` を定義 (Line 66)
   - `/search` エンドポイントも定義済み (Line 40-67)

2. **Lambda Search APIのTerraform** (`backend/lambda-search-api/terraform/lambda.tf`)
   - 独自のAPI Gateway REST APIを作成 (Line 183-195)
   - 独自のCognito Authorizerを作成 (Line 198-205)
   - 独自の `/search` エンドポイントを定義 (Line 208-213)

**この重複により:**
- リソースの競合リスク
- メンテナンスコストの増加
- 異なる設定による挙動の不一致

---

## 2. 推奨アーキテクチャ

### 2.1 統合アプローチ

```
┌──────────────────────────────────────────────┐
│          CloudFront + Next.js Frontend        │
└──────────────────┬───────────────────────────┘
                   │ HTTPS + JWT Token
                   ▼
┌──────────────────────────────────────────────┐
│     API Gateway: cis-filesearch-api          │
│     (既存のRESTful API - 統一エンドポイント)  │
│                                              │
│     Resources:                               │
│     ├── /search (GET) → Lambda Search       │  ← 新規追加
│     ├── /files/{id} (GET) → Lambda File     │  ← 既存
│     └── /image-search (POST) → Lambda Image │  ← 既存?
│                                              │
│     Authorizer: Cognito User Pool (共通)     │
│     CORS: 全エンドポイント統一設定           │
└──────────────────┬───────────────────────────┘
                   │
        ┌──────────┴──────────┬────────────┐
        ▼                     ▼            ▼
┌──────────────┐  ┌────────────────┐  ┌─────────────┐
│Lambda Search │  │ Lambda File    │  │Lambda Image │
│(VPC内)       │  │                │  │             │
└──────┬───────┘  └────────────────┘  └─────────────┘
       │
       ▼
┌──────────────────────────────────────────────┐
│     OpenSearch VPC Endpoint                  │
│     vpc-cis-filesearch-opensearch-...        │
└──────────────────────────────────────────────┘
```

### 2.2 リソース統合マトリックス

| 要素 | 既存リソース | 新規Lambda | 統合戦略 |
|------|------------|----------|---------|
| **API Gateway** | `aws_api_gateway_rest_api.main` | 削除 | 既存を使用 |
| **Cognito Authorizer** | `aws_api_gateway_authorizer.cognito` | 削除 | 既存を使用 |
| **Lambda関数** | なし | 新規作成 | `cis-search-api-prod` |
| **/search エンドポイント** | POST (Line 46-67) | GET | **HTTPメソッド変更** |
| **VPC設定** | なし | 必須 | Lambda固有設定 |
| **IAM Role** | なし | 新規作成 | OpenSearch権限付与 |

---

## 3. 統合実装計画

### 3.1 Terraform修正内容

#### ステップ1: メインプロジェクトの修正 (`terraform/api_gateway_cognito.tf`)

**変更前 (Line 46-67):**
```hcl
# POST /search Method (Cognito Authentication Required)
resource "aws_api_gateway_method" "search_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.search.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}
```

**変更後:**
```hcl
# GET /search Method (Cognito Authentication Required)
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

**Lambda統合の修正 (Line 60-67):**
```hcl
# Lambda Integration for GET /search
resource "aws_api_gateway_integration" "search_lambda" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.search.id
  http_method             = aws_api_gateway_method.search_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.search_api_prod.invoke_arn
}
```

**OPTIONS メソッドの更新 (Line 101-112):**
```hcl
resource "aws_api_gateway_integration_response" "search_options" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.search.id
  http_method = aws_api_gateway_method.search_options.http_method
  status_code = aws_api_gateway_method_response.search_options_200.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,PUT,DELETE,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'https://${var.frontend_domain}'"
  }
}
```

#### ステップ2: Lambda関数定義の追加 (`terraform/lambda_search_api.tf` - 新規ファイル)

**新規ファイル作成:**
```hcl
# ============================================================================
# Lambda Search API - Terraform Configuration
# ============================================================================

# ----------------------------------------------------------------------------
# Lambda IAM Role
# ----------------------------------------------------------------------------
resource "aws_iam_role" "lambda_search_api" {
  name = "cis-lambda-search-api-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name        = "CIS Lambda Search API Role"
    Environment = var.environment
  }
}

# ----------------------------------------------------------------------------
# Lambda IAM Policy - OpenSearch Access
# ----------------------------------------------------------------------------
resource "aws_iam_role_policy" "lambda_opensearch_access" {
  name = "opensearch-access"
  role = aws_iam_role.lambda_search_api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "OpenSearchAccess"
        Effect = "Allow"
        Action = [
          "es:ESHttpGet",
          "es:ESHttpPost",
          "es:ESHttpHead"
        ]
        Resource = "${aws_opensearch_domain.main.arn}/*"
      }
    ]
  })
}

# ----------------------------------------------------------------------------
# Lambda IAM Policy - CloudWatch Logs (VPC Access)
# ----------------------------------------------------------------------------
resource "aws_iam_role_policy_attachment" "lambda_vpc_execution" {
  role       = aws_iam_role.lambda_search_api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# ----------------------------------------------------------------------------
# Lambda Security Group
# ----------------------------------------------------------------------------
resource "aws_security_group" "lambda_search_api" {
  name        = "cis-lambda-search-api-sg-${var.environment}"
  description = "Security group for Lambda Search API"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS to OpenSearch"
  }

  tags = {
    Name        = "CIS Lambda Search API SG"
    Environment = var.environment
  }
}

# ----------------------------------------------------------------------------
# Lambda Function
# ----------------------------------------------------------------------------
resource "aws_lambda_function" "search_api_prod" {
  function_name = "cis-search-api-${var.environment}"
  role          = aws_iam_role.lambda_search_api.arn
  handler       = "index.handler"
  runtime       = var.lambda_runtime_nodejs
  architectures = [var.lambda_architecture]

  filename         = "${path.module}/../backend/lambda-search-api/dist/lambda-deployment.zip"
  source_code_hash = filebase64sha256("${path.module}/../backend/lambda-search-api/dist/lambda-deployment.zip")

  memory_size = 512
  timeout     = 30

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [
      aws_security_group.lambda_search_api.id,
      aws_security_group.opensearch.id
    ]
  }

  environment {
    variables = {
      OPENSEARCH_ENDPOINT = "https://${aws_opensearch_domain.main.endpoint}"
      OPENSEARCH_INDEX    = "file-index"
      AWS_REGION          = var.aws_region
      LOG_LEVEL           = "info"
      NODE_ENV            = var.environment
    }
  }

  reserved_concurrent_executions = 10

  tags = {
    Name        = "CIS Search API"
    Environment = var.environment
  }
}

# ----------------------------------------------------------------------------
# CloudWatch Log Group
# ----------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "search_api" {
  name              = "/aws/lambda/${aws_lambda_function.search_api_prod.function_name}"
  retention_in_days = 30

  tags = {
    Name        = "CIS Search API Logs"
    Environment = var.environment
  }
}

# ----------------------------------------------------------------------------
# Lambda Permission for API Gateway
# ----------------------------------------------------------------------------
resource "aws_lambda_permission" "api_gateway_search" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.search_api_prod.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

# ----------------------------------------------------------------------------
# CloudWatch Alarms
# ----------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "search_api_errors" {
  alarm_name          = "${var.project_name}-search-api-high-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "Search API error rate is too high"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    FunctionName = aws_lambda_function.search_api_prod.function_name
  }

  tags = {
    Name        = "CIS Search API Error Alarm"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_metric_alarm" "search_api_throttles" {
  alarm_name          = "${var.project_name}-search-api-throttles"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Search API is being throttled"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    FunctionName = aws_lambda_function.search_api_prod.function_name
  }

  tags = {
    Name        = "CIS Search API Throttle Alarm"
    Environment = var.environment
  }
}

# ----------------------------------------------------------------------------
# Outputs
# ----------------------------------------------------------------------------
output "lambda_search_api_arn" {
  description = "ARN of the Lambda Search API function"
  value       = aws_lambda_function.search_api_prod.arn
}

output "lambda_search_api_name" {
  description = "Name of the Lambda Search API function"
  value       = aws_lambda_function.search_api_prod.function_name
}
```

#### ステップ3: API Gateway Deploymentの更新 (`terraform/api_gateway_cognito.tf`)

**Line 219-237を更新:**
```hcl
resource "aws_api_gateway_deployment" "main" {
  rest_api_id = aws_api_gateway_rest_api.main.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.search.id,
      aws_api_gateway_method.search_get.id,         # POST → GET に変更
      aws_api_gateway_integration.search_lambda.id,
      aws_api_gateway_resource.files.id,
      aws_api_gateway_resource.file_id.id,
      aws_api_gateway_method.file_get.id,
      aws_api_gateway_integration.file_lambda.id,
      aws_lambda_function.search_api_prod.id,       # 新規追加
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}
```

#### ステップ4: 削除するファイル

**不要になるファイル:**
```
backend/lambda-search-api/terraform/lambda.tf  # 削除
```

このファイルの内容はメインプロジェクトのTerraformに統合済み。

---

## 4. セキュリティ設定

### 4.1 セキュリティグループ設定

**OpenSearchセキュリティグループへのインバウンドルール追加:**

```hcl
# terraform/opensearch.tf (既存ファイルに追加)

resource "aws_security_group_rule" "opensearch_from_lambda_search" {
  type                     = "ingress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  security_group_id        = aws_security_group.opensearch.id
  source_security_group_id = aws_security_group.lambda_search_api.id
  description              = "Allow HTTPS from Lambda Search API"
}
```

### 4.2 IAM権限最小化

**Lambda実行ロールに必要な権限のみ付与:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OpenSearchReadOnly",
      "Effect": "Allow",
      "Action": [
        "es:ESHttpGet",
        "es:ESHttpPost",
        "es:ESHttpHead"
      ],
      "Resource": "arn:aws:es:ap-northeast-1:ACCOUNT_ID:domain/cis-filesearch-opensearch/*/_search"
    },
    {
      "Sid": "VPCNetworkInterface",
      "Effect": "Allow",
      "Action": [
        "ec2:CreateNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DeleteNetworkInterface",
        "ec2:AssignPrivateIpAddresses",
        "ec2:UnassignPrivateIpAddresses"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CloudWatchLogsWrite",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:ap-northeast-1:ACCOUNT_ID:log-group:/aws/lambda/cis-search-api-prod:*"
    }
  ]
}
```

### 4.3 CORS設定の統一

**全エンドポイントで統一したCORS設定:**

```javascript
// Lambda関数内のレスポンスヘッダー
{
  'Access-Control-Allow-Origin': process.env.FRONTEND_DOMAIN || 'https://filesearch.company.com',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '3600',
  'Vary': 'Origin'
}
```

---

## 5. デプロイ手順

### 5.1 前提条件の確認

```bash
# 1. VPC情報の確認
aws ec2 describe-vpcs --filters "Name=tag:Name,Values=cis-filesearch-vpc" \
  --query "Vpcs[0].VpcId" --output text

# 2. プライベートサブネットの確認
aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=YOUR_VPC_ID" "Name=tag:Name,Values=*private*" \
  --query "Subnets[*].[SubnetId,AvailabilityZone]" --output table

# 3. OpenSearchエンドポイントの確認
aws opensearch describe-domain --domain-name cis-filesearch-opensearch \
  --query "DomainStatus.Endpoint" --output text

# 4. Cognito User Poolの確認
aws cognito-idp list-user-pools --max-results 10 \
  --query "UserPools[?Name=='cis-filesearch-users'].Id" --output text
```

### 5.2 Lambda関数のビルド

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api

# 依存関係インストール
npm install --production

# TypeScriptビルド
npm run build

# Webpackバンドル
npm run package

# ZIPファイルの確認
ls -lh dist/lambda-deployment.zip
```

### 5.3 Terraformデプロイ

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/terraform

# 1. 新しいLambda関数定義を追加
# terraform/lambda_search_api.tf を作成済み

# 2. API Gatewayの修正を適用
# terraform/api_gateway_cognito.tf を編集済み

# 3. Terraform初期化（新規モジュール追加時のみ）
terraform init

# 4. 変更内容の確認
terraform plan -out=tfplan

# 5. デプロイ実行
terraform apply tfplan

# 6. 出力値の確認
terraform output
```

### 5.4 API Gateway再デプロイ

```bash
# API Gatewayの変更を反映
aws apigateway create-deployment \
  --rest-api-id $(terraform output -raw api_gateway_rest_api_id) \
  --stage-name prod \
  --description "Add Lambda Search API integration"
```

---

## 6. 動作確認

### 6.1 Lambda関数のテスト

```bash
# 1. Lambda関数の存在確認
aws lambda get-function --function-name cis-search-api-prod

# 2. VPC設定の確認
aws lambda get-function-configuration \
  --function-name cis-search-api-prod \
  --query 'VpcConfig'

# 3. 環境変数の確認
aws lambda get-function-configuration \
  --function-name cis-search-api-prod \
  --query 'Environment.Variables'

# 4. テストイベントで実行
aws lambda invoke \
  --function-name cis-search-api-prod \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test","page":"1","limit":"20"}}' \
  response.json

cat response.json | jq .
```

### 6.2 API Gateway経由のテスト

```bash
# 1. API Gateway URLの取得
API_URL=$(terraform output -raw api_gateway_custom_domain_url)

# 2. Cognitoトークンの取得
TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id YOUR_CLIENT_ID \
  --auth-parameters USERNAME=test@example.com,PASSWORD=TestPass123! \
  --query 'AuthenticationResult.IdToken' \
  --output text)

# 3. /search エンドポイントのテスト
curl -X GET \
  "${API_URL}/search?q=report&page=1&limit=20&searchMode=or" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" | jq .

# 4. エラーハンドリングのテスト
curl -X GET \
  "${API_URL}/search?page=9999" \
  -H "Authorization: Bearer ${TOKEN}" | jq .

# 5. フィルター機能のテスト
curl -X GET \
  "${API_URL}/search?q=report&fileType=pdf&dateFrom=2024-01-01&dateTo=2025-12-31" \
  -H "Authorization: Bearer ${TOKEN}" | jq .
```

### 6.3 CloudWatch Logsの確認

```bash
# 最新のログストリームを確認
aws logs tail /aws/lambda/cis-search-api-prod --follow

# 特定のエラーを検索
aws logs filter-log-events \
  --log-group-name /aws/lambda/cis-search-api-prod \
  --filter-pattern "ERROR" \
  --start-time $(date -u -d '1 hour ago' +%s)000
```

---

## 7. フロントエンド統合

### 7.1 環境変数設定

**`.env.production` に追加:**
```bash
NEXT_PUBLIC_API_GATEWAY_URL=https://api.filesearch.company.com
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_xxxxxxxxx
NEXT_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 7.2 API呼び出しサービスの修正

**`frontend/src/lib/opensearch.ts` を更新:**

```typescript
/**
 * Search API Service
 * API Gateway経由でLambda Search関数を呼び出す
 */

import { Auth } from 'aws-amplify';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_GATEWAY_URL;

interface SearchParams {
  q?: string;
  searchMode?: 'and' | 'or';
  fileType?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
  sortBy?: 'relevance' | 'date' | 'name' | 'size';
  sortOrder?: 'asc' | 'desc';
}

interface SearchResult {
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
    extractedText?: string[];
  };
}

interface SearchResponse {
  success: boolean;
  data?: {
    results: SearchResult[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
    query: SearchParams;
    took: number;
  };
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * ファイル検索実行
 */
export async function searchFiles(params: SearchParams): Promise<SearchResponse> {
  try {
    // Cognito JWTトークン取得
    const session = await Auth.currentSession();
    const idToken = session.getIdToken().getJwtToken();

    // クエリパラメータ構築
    const queryString = new URLSearchParams(
      Object.entries(params)
        .filter(([_, value]) => value != null && value !== '')
        .map(([key, value]) => [key, String(value)])
    ).toString();

    // API Gateway経由でLambda呼び出し
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

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Search request failed');
    }

    return await response.json();
  } catch (error) {
    console.error('Search API error:', error);
    throw error;
  }
}

/**
 * オートコンプリート用サジェスト取得（将来実装）
 */
export async function getSearchSuggestions(query: string): Promise<string[]> {
  // TODO: /search/suggestions エンドポイント実装後に有効化
  return [];
}
```

### 7.3 Reactコンポーネントの更新

**`frontend/src/app/search/page.tsx` の修正:**

```typescript
'use client';

import { useState } from 'react';
import { searchFiles } from '@/lib/opensearch';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<'and' | 'or'>('or');

  const handleSearch = async () => {
    if (!query.trim()) {
      setError('検索キーワードを入力してください');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await searchFiles({
        q: query,
        searchMode,
        page: 1,
        limit: 20,
        sortBy: 'relevance',
        sortOrder: 'desc',
      });

      if (response.success && response.data) {
        setResults(response.data.results);
      } else {
        setError(response.error?.message || '検索に失敗しました');
      }
    } catch (err: any) {
      setError(err.message || '予期しないエラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        {/* 検索バー */}
        <div className="mb-6">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="ファイルを検索..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleSearch}
              disabled={loading}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? '検索中...' : '検索'}
            </button>
          </div>

          {/* 検索モード切り替え */}
          <div className="mt-2 flex gap-4">
            <label className="flex items-center">
              <input
                type="radio"
                value="or"
                checked={searchMode === 'or'}
                onChange={(e) => setSearchMode(e.target.value as 'or')}
                className="mr-2"
              />
              OR検索（いずれかを含む）
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                value="and"
                checked={searchMode === 'and'}
                onChange={(e) => setSearchMode(e.target.value as 'and')}
                className="mr-2"
              />
              AND検索（すべて含む）
            </label>
          </div>
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {/* 検索結果 */}
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">検索中...</p>
          </div>
        ) : (
          <div className="space-y-4">
            {results.map((result: any) => (
              <div
                key={result.id}
                className="p-4 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-shadow"
              >
                <h3 className="text-lg font-semibold text-blue-600 mb-1">
                  {result.fileName}
                </h3>
                <p className="text-sm text-gray-600 mb-2">{result.filePath}</p>
                <p
                  className="text-sm text-gray-800"
                  dangerouslySetInnerHTML={{ __html: result.snippet }}
                />
                <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                  <span>{result.fileType.toUpperCase()}</span>
                  <span>{(result.fileSize / 1024).toFixed(1)} KB</span>
                  <span>スコア: {result.relevanceScore.toFixed(1)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## 8. 監視とアラート

### 8.1 CloudWatch Dashboard作成

```bash
# CloudWatch Dashboardの作成
aws cloudwatch put-dashboard --dashboard-name CIS-Search-API-Dashboard \
  --dashboard-body file://dashboard.json
```

**`dashboard.json`:**
```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/Lambda", "Invocations", { "stat": "Sum", "label": "Total Invocations" }],
          [".", "Errors", { "stat": "Sum", "label": "Errors" }],
          [".", "Throttles", { "stat": "Sum", "label": "Throttles" }],
          [".", "Duration", { "stat": "Average", "label": "Avg Duration (ms)" }]
        ],
        "view": "timeSeries",
        "stacked": false,
        "region": "ap-northeast-1",
        "title": "Lambda Search API Metrics",
        "period": 300
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/ApiGateway", "4XXError", { "stat": "Sum" }],
          [".", "5XXError", { "stat": "Sum" }],
          [".", "Latency", { "stat": "Average" }]
        ],
        "view": "timeSeries",
        "region": "ap-northeast-1",
        "title": "API Gateway Metrics",
        "period": 300
      }
    },
    {
      "type": "log",
      "properties": {
        "query": "SOURCE '/aws/lambda/cis-search-api-prod'\n| fields @timestamp, @message\n| filter @message like /ERROR/\n| sort @timestamp desc\n| limit 20",
        "region": "ap-northeast-1",
        "title": "Recent Errors"
      }
    }
  ]
}
```

### 8.2 SNSトピック設定

```bash
# SNSトピックの作成（既存のものを使用する場合はスキップ）
aws sns create-topic --name cis-filesearch-alerts

# メール通知の登録
aws sns subscribe \
  --topic-arn arn:aws:sns:ap-northeast-1:ACCOUNT_ID:cis-filesearch-alerts \
  --protocol email \
  --notification-endpoint admin@company.com
```

---

## 9. パフォーマンス最適化

### 9.1 Lambda予約済み同時実行数の設定

```bash
# 予約済み同時実行数を10に設定（Cold Start削減）
aws lambda put-function-concurrency \
  --function-name cis-search-api-prod \
  --reserved-concurrent-executions 10
```

### 9.2 API Gatewayキャッシング有効化（オプション）

```hcl
# terraform/api_gateway_cognito.tf に追加

resource "aws_api_gateway_method_settings" "search_cache" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  stage_name  = aws_api_gateway_stage.prod.stage_name
  method_path = "search/GET"

  settings {
    caching_enabled      = true
    cache_ttl_in_seconds = 300  # 5分間キャッシュ
    cache_data_encrypted = true
    require_authorization_for_cache_control = true
  }
}
```

### 9.3 Provisioned Concurrency（Cold Start完全排除）

```bash
# Provisioned Concurrency設定（コスト増加に注意）
aws lambda put-provisioned-concurrency-config \
  --function-name cis-search-api-prod \
  --provisioned-concurrent-executions 2 \
  --qualifier prod
```

---

## 10. コスト見積もり

### 10.1 月額コスト試算（10,000検索/月の場合）

| サービス | 詳細 | 月額（USD） |
|---------|------|-----------|
| **Lambda** | | |
| - 実行時間 | 10K × 500ms × 512MB | $0.50 |
| - Reserved Concurrency | 10同時実行 | $3.60 |
| **API Gateway** | | |
| - REST API呼び出し | 10K リクエスト | $0.035 |
| - データ転送 | 10K × 10KB = 100MB | $0.01 |
| **CloudWatch** | | |
| - Logs保存 | 2GB/月 | $1.00 |
| - Metrics | 標準メトリクス | 無料 |
| - Alarms | 2アラーム | $0.20 |
| **合計** | | **$5.34/月** |

### 10.2 スケーリング時のコスト（100,000検索/月の場合）

| サービス | 詳細 | 月額（USD） |
|---------|------|-----------|
| Lambda実行 | 100K × 500ms × 512MB | $5.00 |
| Lambda Reserved Concurrency | 10同時実行 | $3.60 |
| API Gateway | 100K リクエスト | $0.35 |
| CloudWatch Logs | 10GB/月 | $5.00 |
| **合計** | | **$13.95/月** |

**コスト削減のポイント:**
- CloudWatch Logs保存期間を14日→7日に短縮
- 使用頻度の低い時間帯はReserved Concurrencyを削減
- API Gatewayキャッシングで重複リクエストを削減

---

## 11. トラブルシューティング

### 11.1 よくある問題と解決策

#### 問題1: "Failed to connect to OpenSearch"

**原因:**
- Lambda関数がVPC内に配置されていない
- セキュリティグループで通信が許可されていない
- OpenSearchエンドポイントが誤っている

**解決策:**
```bash
# 1. VPC設定の確認
aws lambda get-function-configuration \
  --function-name cis-search-api-prod \
  --query 'VpcConfig'

# 2. セキュリティグループルールの確認
aws ec2 describe-security-groups \
  --group-ids sg-xxxxx \
  --query 'SecurityGroups[0].IpPermissions'

# 3. OpenSearchセキュリティグループにルール追加
aws ec2 authorize-security-group-ingress \
  --group-id OPENSEARCH_SG_ID \
  --protocol tcp \
  --port 443 \
  --source-group LAMBDA_SG_ID
```

#### 問題2: "401 Unauthorized from API Gateway"

**原因:**
- Cognitoトークンの有効期限切れ
- Authorizerの設定ミス
- トークンのフォーマットエラー

**解決策:**
```bash
# 新しいトークンを取得
TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id YOUR_CLIENT_ID \
  --auth-parameters USERNAME=test@example.com,PASSWORD=Pass123! \
  --query 'AuthenticationResult.IdToken' \
  --output text)

# トークンの内容を確認（JWT Decoder）
echo $TOKEN | cut -d'.' -f2 | base64 -d | jq .
```

#### 問題3: "Lambda timeout after 30 seconds"

**原因:**
- OpenSearchクエリが遅い
- インデックスサイズが大きすぎる
- VPC NAT Gatewayの制約

**解決策:**
```bash
# 1. タイムアウトを60秒に延長
aws lambda update-function-configuration \
  --function-name cis-search-api-prod \
  --timeout 60

# 2. OpenSearchクエリの最適化
# - ページサイズを制限（limit <= 100）
# - フィルターを先に適用
# - ソート基準を見直し

# 3. CloudWatch Logsで実行時間を確認
aws logs tail /aws/lambda/cis-search-api-prod \
  --filter-pattern "Duration" \
  --since 1h
```

#### 問題4: "CORS preflight request failed"

**原因:**
- OPTIONSメソッドが定義されていない
- Access-Control-Allow-Originが誤っている
- ヘッダーの設定ミス

**解決策:**
```bash
# Terraformで正しく設定されているか確認
terraform show | grep -A 10 "search_options"

# 手動でテスト
curl -X OPTIONS \
  https://api.filesearch.company.com/search \
  -H "Origin: https://filesearch.company.com" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization" \
  -v
```

---

## 12. ロールバック手順

### 12.1 緊急時のロールバック

```bash
# 1. Terraform状態の確認
terraform show

# 2. 直前の状態に戻す
terraform apply -target=aws_api_gateway_deployment.main \
  -var="lambda_search_enabled=false"

# 3. Lambda関数を無効化
aws lambda update-function-configuration \
  --function-name cis-search-api-prod \
  --environment Variables={DISABLED=true}

# 4. API Gatewayから切り離し
aws apigateway update-integration \
  --rest-api-id API_ID \
  --resource-id RESOURCE_ID \
  --http-method GET \
  --patch-operations op=replace,path=/uri,value=arn:aws:lambda:FALLBACK_FUNCTION
```

### 12.2 完全削除（開発環境のみ）

```bash
# Lambda関数の削除
terraform destroy -target=aws_lambda_function.search_api_prod

# API Gateway統合の削除
terraform destroy -target=aws_api_gateway_integration.search_lambda
```

---

## 13. 次のステップ

### 13.1 短期（1-2週間）

- [ ] Lambda関数のビルドとデプロイ
- [ ] API Gatewayとの統合テスト
- [ ] フロントエンド統合とE2Eテスト
- [ ] CloudWatch Alarmsの設定
- [ ] ドキュメントの共有

### 13.2 中期（1ヶ月）

- [ ] パフォーマンステストの実施（500万ファイル規模）
- [ ] API Gatewayキャッシングの評価
- [ ] X-Ray統合による分散トレーシング
- [ ] ユーザーフィードバックの収集

### 13.3 長期（3ヶ月）

- [ ] Provisioned Concurrencyの評価
- [ ] CI/CDパイプラインの構築
- [ ] 画像検索との統合
- [ ] マルチリージョン展開の検討

---

## 14. まとめ

### 14.1 推奨事項

**強く推奨:**
1. ✅ **既存API Gatewayを使用** - 統一されたエンドポイントと認証
2. ✅ **メインTerraformに統合** - インフラ管理の一元化
3. ✅ **セキュリティグループの厳格化** - 最小権限の原則
4. ✅ **CloudWatch監視の強化** - 早期検知と迅速な対応

**条件付き推奨:**
- ⚠️ **API Gatewayキャッシング** - 費用対効果を評価後に有効化
- ⚠️ **Provisioned Concurrency** - Cold Startが問題になる場合のみ
- ⚠️ **X-Ray統合** - パフォーマンス問題の詳細分析が必要な場合

**非推奨:**
- ❌ **独立したAPI Gateway作成** - 運用コストとエンドポイント分散
- ❌ **パブリックOpenSearchエンドポイント** - セキュリティリスク
- ❌ **Lambda関数の手動デプロイ** - Terraformで自動化すべき

### 14.2 期待される成果

**技術的成果:**
- VPC内OpenSearchへの安全なアクセス
- 1秒未満の検索レスポンスタイム
- 99.9%の可用性
- 統一されたAPI管理

**ビジネス成果:**
- 月額$5-15の低コスト運用
- フロントエンドとバックエンドの明確な分離
- スケーラブルなアーキテクチャ
- メンテナンス効率の向上

---

**作成日**: 2025-12-17
**バージョン**: 1.0
**OpenSearchエンドポイント**: vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
**対象環境**: 本番環境 (ap-northeast-1)
