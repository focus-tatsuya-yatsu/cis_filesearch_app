# Lambda Search API - 本番環境デプロイガイド

## 前提条件

本番環境へのデプロイ前に、以下のAWSリソースが準備されていることを確認してください:

### 1. OpenSearch Domain (VPC内)
- **エンドポイント**: `vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com`
- **インデックス名**: `file-index`
- **VPC配置**: プライベートサブネット
- **セキュリティグループ**: LambdaからのHTTPS接続を許可

### 2. VPC & ネットワーク
- VPC ID
- プライベートサブネット (最低2つ、異なるAZ)
- NATゲートウェイ (LambdaがAWS APIにアクセスするため)

### 3. Cognito User Pool (認証用)
- User Pool ID
- User Pool ARN

### 4. IAM権限
- OpenSearchへのアクセス権限 (`es:ESHttpGet`, `es:ESHttpPost`, `es:ESHttpHead`)
- CloudWatch Logsへの書き込み権限
- VPC ENI管理権限

---

## デプロイ手順

### Step 1: 環境情報の収集

必要な情報をAWS Consoleまたは CLIで取得します:

```bash
# VPC IDを取得
aws ec2 describe-vpcs --region ap-northeast-1

# プライベートサブネットIDを取得
aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=YOUR_VPC_ID" \
  --query 'Subnets[?MapPublicIpOnLaunch==`false`].[SubnetId,AvailabilityZone]' \
  --output table

# OpenSearchのセキュリティグループIDを取得
aws ec2 describe-security-groups \
  --filters "Name=vpc-id,Values=YOUR_VPC_ID" \
  --query 'SecurityGroups[?contains(GroupName, `opensearch`)].[GroupId,GroupName]' \
  --output table

# Cognito User Pool情報を取得
aws cognito-idp list-user-pools --max-results 10 \
  --query 'UserPools[?Name==`cis-file-search`].[Id,Arn]' \
  --output table
```

### Step 2: Terraform変数ファイルの作成

```bash
cd backend/lambda-search-api/terraform

# テンプレートをコピー
cp terraform.tfvars.example terraform.tfvars

# 実際の値を記入
vim terraform.tfvars
```

**terraform.tfvars の例:**

```hcl
aws_region = "ap-northeast-1"
environment = "prod"

opensearch_domain_endpoint = "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
opensearch_index_name      = "file-index"

cognito_user_pool_id  = "ap-northeast-1_ABC123XYZ"
cognito_user_pool_arn = "arn:aws:cognito-idp:ap-northeast-1:123456789012:userpool/ap-northeast-1_ABC123XYZ"

vpc_id               = "vpc-0123456789abcdef0"
private_subnet_ids   = ["subnet-0aaa1111bbbb2222c", "subnet-0ddd3333eeee4444f"]
opensearch_security_group_id = "sg-0987654321fedcba0"
```

### Step 3: Lambda関数のビルド

```bash
cd backend/lambda-search-api

# 依存関係のインストール
npm install

# テストの実行（オプショナル）
npm test

# 本番用ビルド
npm run build

# デプロイパッケージの作成
npm run package
```

ビルドが成功すると、`dist/lambda-deployment.zip` が生成されます。

### Step 4: Terraformによるデプロイ

```bash
cd terraform

# Terraform初期化
terraform init

# デプロイ内容の確認
terraform plan

# 確認後、デプロイを実行
terraform apply
```

デプロイが完了すると、以下の情報が出力されます:

```
Outputs:

api_gateway_url = "https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod/search"
lambda_function_arn = "arn:aws:lambda:ap-northeast-1:123456789012:function:cis-search-api-prod"
lambda_function_name = "cis-search-api-prod"
```

### Step 5: デプロイの検証

#### 5.1 Lambda関数の動作確認

```bash
# Lambda関数が正常にデプロイされたか確認
aws lambda get-function --function-name cis-search-api-prod

# Lambda関数のテスト実行
aws lambda invoke \
  --function-name cis-search-api-prod \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test"}}' \
  response.json

cat response.json
```

#### 5.2 VPC接続の確認

```bash
# Lambda関数のVPC設定を確認
aws lambda get-function-configuration --function-name cis-search-api-prod \
  --query 'VpcConfig' --output json
```

#### 5.3 OpenSearch接続の確認

Lambda関数のCloudWatch Logsを確認:

```bash
aws logs tail /aws/lambda/cis-search-api-prod --follow
```

正常に接続できている場合、以下のようなログが表示されます:

```json
{
  "timestamp": "2025-12-16T10:30:45.123Z",
  "level": "info",
  "context": "OpenSearchService",
  "message": "OpenSearch client initialized successfully"
}
```

#### 5.4 API Gatewayの動作確認

Cognitoトークンを取得して、実際にAPIを呼び出します:

```bash
# Cognitoトークンの取得（実際のユーザー名とパスワードに置き換えてください）
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id YOUR_CLIENT_ID \
  --auth-parameters USERNAME=test@example.com,PASSWORD=YourPassword123!

# 取得したトークンでAPI呼び出し
curl -X GET "https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod/search?q=test&page=1&limit=10" \
  -H "Authorization: Bearer YOUR_ID_TOKEN" \
  -H "Content-Type: application/json"
```

期待されるレスポンス:

```json
{
  "success": true,
  "data": {
    "results": [...],
    "pagination": {
      "total": 150,
      "page": 1,
      "limit": 10,
      "totalPages": 15
    },
    "took": 45
  }
}
```

---

## トラブルシューティング

### 問題1: Lambda関数がOpenSearchに接続できない

**症状**: CloudWatch Logsに "Failed to connect to OpenSearch" エラー

**原因**:
- LambdaのセキュリティグループがOpenSearchへのアウトバウンド通信を許可していない
- OpenSearchのセキュリティグループがLambdaからのインバウンド通信を許可していない

**解決方法**:

```bash
# Lambdaセキュリティグループのアウトバウンドルールを確認
aws ec2 describe-security-groups --group-ids YOUR_LAMBDA_SG_ID

# OpenSearchセキュリティグループのインバウンドルールを確認
aws ec2 describe-security-groups --group-ids YOUR_OPENSEARCH_SG_ID

# OpenSearchセキュリティグループにLambdaからの接続を許可
aws ec2 authorize-security-group-ingress \
  --group-id YOUR_OPENSEARCH_SG_ID \
  --protocol tcp \
  --port 443 \
  --source-group YOUR_LAMBDA_SG_ID
```

### 問題2: Cold Startが遅い

**症状**: 初回リクエストのレスポンスタイムが3秒以上

**原因**: Provisioned Concurrencyが設定されていない

**解決方法**:

```bash
# Provisioned Concurrencyを設定
aws lambda put-provisioned-concurrency-config \
  --function-name cis-search-api-prod \
  --provisioned-concurrent-executions 5 \
  --qualifier prod
```

### 問題3: API Gatewayで403エラー

**症状**: Cognitoトークンを送信しているのに403エラー

**原因**: トークンの形式が間違っている、または期限切れ

**解決方法**:

```bash
# トークンの内容を確認（JWTデコード）
echo "YOUR_ID_TOKEN" | cut -d'.' -f2 | base64 -d | jq

# トークンの有効期限を確認
# exp フィールドが現在時刻より前の場合、トークンをリフレッシュ
```

### 問題4: メモリ不足エラー

**症状**: CloudWatch Logsに "Runtime.OutOfMemory" エラー

**原因**: Lambda関数のメモリサイズが不足

**解決方法**:

```bash
# メモリサイズを増やす（512MB → 1024MB）
aws lambda update-function-configuration \
  --function-name cis-search-api-prod \
  --memory-size 1024
```

---

## モニタリング

### CloudWatch Metricsの確認

```bash
# Lambda実行時間の確認
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=cis-search-api-prod \
  --start-time 2025-12-16T00:00:00Z \
  --end-time 2025-12-16T23:59:59Z \
  --period 300 \
  --statistics Average,Maximum

# エラー数の確認
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=cis-search-api-prod \
  --start-time 2025-12-16T00:00:00Z \
  --end-time 2025-12-16T23:59:59Z \
  --period 300 \
  --statistics Sum
```

### CloudWatch Logsの確認

```bash
# リアルタイムでログを表示
aws logs tail /aws/lambda/cis-search-api-prod --follow

# 特定期間のログを検索
aws logs filter-log-events \
  --log-group-name /aws/lambda/cis-search-api-prod \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --filter-pattern "ERROR"
```

---

## パフォーマンス最適化

### 1. Provisioned Concurrency

Cold Startを削減するために、Provisioned Concurrencyを有効化:

```hcl
# terraform/lambda.tf に追加
resource "aws_lambda_provisioned_concurrency_config" "search_api" {
  function_name                     = aws_lambda_function.search_api.function_name
  provisioned_concurrent_executions = 5
  qualifier                         = aws_lambda_alias.search_api_prod.name
}
```

### 2. API Gatewayキャッシング

頻繁に検索されるクエリをキャッシュ:

```hcl
# terraform/lambda.tf に追加
resource "aws_api_gateway_method_settings" "search_get_settings" {
  rest_api_id = aws_api_gateway_rest_api.search_api.id
  stage_name  = aws_api_gateway_deployment.search_api.stage_name
  method_path = "${aws_api_gateway_resource.search.path_part}/${aws_api_gateway_method.search_get.http_method}"

  settings {
    caching_enabled      = true
    cache_ttl_in_seconds = 300
    cache_data_encrypted = true
  }
}
```

### 3. Lambda メモリサイズの調整

パフォーマンステストを実施し、最適なメモリサイズを決定:

```bash
# 512MB → 1024MB に変更して比較
aws lambda update-function-configuration \
  --function-name cis-search-api-prod \
  --memory-size 1024
```

---

## セキュリティ強化

### 1. API Gatewayリソースポリシー

特定のIPアドレスからのアクセスのみを許可:

```hcl
resource "aws_api_gateway_rest_api_policy" "search_api_policy" {
  rest_api_id = aws_api_gateway_rest_api.search_api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = "*"
        Action = "execute-api:Invoke"
        Resource = "${aws_api_gateway_rest_api.search_api.execution_arn}/*"
        Condition = {
          IpAddress = {
            "aws:SourceIp": ["203.0.113.0/24", "198.51.100.0/24"]
          }
        }
      }
    ]
  })
}
```

### 2. WAF統合

API GatewayにWAFを統合してDDoS対策:

```bash
# WAF Web ACLの作成
aws wafv2 create-web-acl --name cis-search-api-waf \
  --scope REGIONAL \
  --default-action Allow={} \
  --rules file://waf-rules.json

# API GatewayにWAFを関連付け
aws wafv2 associate-web-acl \
  --web-acl-arn YOUR_WAF_ARN \
  --resource-arn YOUR_API_GATEWAY_ARN
```

---

## コスト最適化

### 月間コスト見積もり（10,000検索/月）

| サービス | 詳細 | 月額 |
|---------|------|------|
| Lambda実行 | 10K × 500ms × 512MB | $0.50 |
| Lambda Reserved Concurrency | 10同時実行 | $3.60 |
| Provisioned Concurrency | 5 × 24時間 | $18.00 |
| API Gateway | 10K リクエスト | $0.035 |
| CloudWatch Logs | 2GB/月 | $1.00 |
| **合計** | | **$23.14/月** |

### コスト削減のヒント

1. **Provisioned Concurrencyの調整**: ピーク時のみ有効化
2. **ログ保持期間の短縮**: 14日 → 7日
3. **API Gatewayキャッシング**: 重複リクエストの削減

---

## ロールバック手順

デプロイに問題が発生した場合:

```bash
# 前のバージョンに戻す
aws lambda update-function-code \
  --function-name cis-search-api-prod \
  --s3-bucket YOUR_BACKUP_BUCKET \
  --s3-key lambda-deployment-backup.zip

# Terraformで以前の状態に戻す
terraform apply -target=aws_lambda_function.search_api \
  -var="lambda_version=previous"
```

---

## 次のステップ

1. **CI/CDパイプラインの構築**: GitHub Actions または AWS CodePipeline
2. **X-Ray統合**: 分散トレーシング
3. **ElastiCache統合**: 検索結果のキャッシング
4. **マルチリージョン展開**: 可用性向上

---

## サポート

問題が発生した場合:

1. CloudWatch Logsでエラーログを確認
2. AWS Support に問い合わせ
3. 開発チームに連絡

**緊急連絡先**: devops@example.com
