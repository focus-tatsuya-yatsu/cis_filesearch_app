# Lambda Search API - VPC Deployment Guide

## 問題の概要

Lambda関数がVPC内のOpenSearchドメインに接続できない問題が発生していました:
```
Error: "getaddrinfo ENOTFOUND vpc-cis-filesearch-opensearch-*.ap-northeast-1.es.amazonaws.com"
```

## 根本原因

1. **OpenSearch Terraformリソースの欠落**: OpenSearchドメインの定義が存在しなかった
2. **VPCエンドポイントの不足**: Lambda関数がAWSサービスにアクセスするためのVPCエンドポイントが未設定
3. **Lambda VPC設定の問題**: セキュリティグループの誤った割り当て
4. **環境変数の問題**: エンドポイントURLに不要な`https://`プレフィックスが含まれていた

## 解決策

### 1. OpenSearch Terraformリソースの作成

新規ファイル: `/terraform/opensearch.tf`

主な機能:
- VPC内のOpenSearchドメイン作成
- Fine-Grained Access Control (FGAC)の有効化
- 暗号化設定 (at-rest, in-transit, node-to-node)
- CloudWatch Logsとの統合
- マルチAZ対応（オプション）

### 2. VPCエンドポイントの追加

修正ファイル: `/terraform/vpc.tf`

追加されたエンドポイント:
- **Gateway Endpoints (無料)**:
  - S3
  - DynamoDB

- **Interface Endpoints (課金あり)**:
  - Lambda
  - CloudWatch Logs
  - STS (IAMロール取得用)

### 3. Lambda関数の修正

修正ファイル: `/backend/lambda-search-api/index-vpc-fixed.js`

主な改善点:
```javascript
// Before
const endpoint = process.env.OPENSEARCH_ENDPOINT || 'vpc-...';
node: `https://${endpoint}`,

// After
const endpoint = process.env.OPENSEARCH_ENDPOINT;
const cleanEndpoint = endpoint.replace(/^https?:\/\//, '');
node: `https://${cleanEndpoint}`,
```

追加設定:
- 環境変数の必須チェック
- VPC接続用のタイムアウト設定
- SSL/TLS設定の最適化

### 4. Terraform変数の追加

修正ファイル: `/terraform/variables.tf`

追加変数:
```hcl
variable "opensearch_master_user" {
  description = "OpenSearch master username"
  type        = string
  sensitive   = true
}

variable "opensearch_master_password" {
  description = "OpenSearch master password"
  type        = string
  sensitive   = true
}

variable "opensearch_instance_count" {
  description = "Number of OpenSearch instances"
  type        = number
  default     = 1
}
```

## デプロイメント手順

### ステップ1: 環境変数の準備

`terraform.tfvars`ファイルを作成:

```hcl
# Required variables
customer_gateway_ip      = "YOUR_VPN_IP"
nas_smb_server          = "YOUR_NAS_IP"
nas_smb_username        = "YOUR_NAS_USER"
nas_smb_password        = "YOUR_NAS_PASSWORD"
admin_email             = "admin@example.com"
frontend_domain         = "filesearch.example.com"
route53_zone_name       = "example.com"

# OpenSearch credentials
opensearch_master_user     = "admin"
opensearch_master_password = "YourSecurePassword123!"

# Optional: Multi-AZ OpenSearch
opensearch_instance_count = 2
opensearch_instance_type  = "t3.small.search"
opensearch_volume_size    = 100
```

### ステップ2: OpenSearchサービスロールの確認

既存のOpenSearchサービスロールがあるか確認:

```bash
aws iam get-role --role-name AWSServiceRoleForAmazonOpenSearchService
```

存在する場合:
```hcl
# terraform.tfvars に追加
create_opensearch_service_role = false
```

存在しない場合:
```hcl
# terraform.tfvars に追加
create_opensearch_service_role = true
```

### ステップ3: Terraformの実行

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/terraform

# 初期化
terraform init

# プラン確認
terraform plan

# 適用
terraform apply
```

### ステップ4: Lambda関数のデプロイ

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api

# index.jsを最新版に更新
cp index-vpc-fixed.js index.js

# パッケージのインストール
npm install

# デプロイメントパッケージの作成
./deploy-dual-index.sh

# Lambdaの更新
aws lambda update-function-code \
  --function-name cis-search-api-prod \
  --zip-file fileb://lambda-vpc-fixed.zip

# 環境変数の確認
aws lambda get-function-configuration \
  --function-name cis-search-api-prod \
  --query 'Environment.Variables'
```

### ステップ5: 接続確認

```bash
# OpenSearchエンドポイントの取得
OPENSEARCH_ENDPOINT=$(terraform output -raw opensearch_vpc_endpoint)

# Lambda関数のテスト
aws lambda invoke \
  --function-name cis-search-api-prod \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test"}}' \
  response.json

# 結果確認
cat response.json
```

## トラブルシューティング

### DNS解決エラーが続く場合

1. **VPCのDNS設定確認**:
```bash
aws ec2 describe-vpc-attribute \
  --vpc-id vpc-02d08f2fa75078e67 \
  --attribute enableDnsSupport

aws ec2 describe-vpc-attribute \
  --vpc-id vpc-02d08f2fa75078e67 \
  --attribute enableDnsHostnames
```

両方とも`true`である必要があります。

2. **セキュリティグループの確認**:
```bash
# Lambda SG
aws ec2 describe-security-groups \
  --group-ids sg-06ee622d64e67f12f

# OpenSearch SG
aws ec2 describe-security-groups \
  --group-ids sg-0c482a057b356a0c3
```

Lambda SGからOpenSearch SGへのポート443アクセスが許可されている必要があります。

3. **VPCエンドポイントの確認**:
```bash
aws ec2 describe-vpc-endpoints \
  --filters "Name=vpc-id,Values=vpc-02d08f2fa75078e67"
```

### Lambda実行ロールの権限確認

```bash
aws iam get-role-policy \
  --role-name cis-lambda-search-api-role-prod \
  --policy-name opensearch-access
```

必要な権限:
- `es:ESHttpGet`
- `es:ESHttpPost`
- `es:ESHttpHead`

### OpenSearchアクセスポリシーの確認

OpenSearchコンソールで確認:
1. OpenSearchダッシュボードにアクセス
2. Security → Access Policies
3. VPC CIDR (`10.0.0.0/16`) からのアクセスが許可されているか確認

## パフォーマンス最適化

### VPCエンドポイントの選択的利用

本番環境でコストを抑えたい場合、Interface Endpointsを削除してNAT Gatewayのみを使用することも可能:

```hcl
# vpc.tf から以下をコメントアウト
# - aws_vpc_endpoint.lambda
# - aws_vpc_endpoint.logs
# - aws_vpc_endpoint.sts
```

ただし、この場合:
- Lambda関数はNAT Gateway経由でインターネットにアクセス
- NAT Gatewayのデータ転送料金が発生
- わずかにレイテンシーが増加

### 推奨設定

- **開発環境**: NAT Gatewayのみ（コスト重視）
- **本番環境**: VPCエンドポイント + NAT Gateway（パフォーマンス重視）

## コスト見積もり

### VPCエンドポイント（ap-northeast-1）

**Gateway Endpoints（無料）**:
- S3: $0
- DynamoDB: $0

**Interface Endpoints（課金あり）**:
- Lambda: ~$7.30/月
- CloudWatch Logs: ~$7.30/月
- STS: ~$7.30/月

**データ処理料金**: $0.01/GB

合計: 約$22/月 + データ転送料

### NAT Gateway

- 時間料金: ~$0.062/時間 × 730時間 = ~$45/月
- データ処理: $0.062/GB

### 推奨構成

VPCエンドポイントを使用することで:
- NAT Gatewayのデータ転送量削減
- レイテンシー改善
- トータルコストは同程度

## モニタリング

### CloudWatch Logsの確認

```bash
# Lambda関数のログ
aws logs tail /aws/lambda/cis-search-api-prod --follow

# OpenSearchのログ
aws logs tail /aws/opensearch/cis-filesearch-prod/application-logs --follow
```

### メトリクスの確認

```bash
# Lambda実行時間
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=cis-search-api-prod \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum
```

## セキュリティ考慮事項

1. **Fine-Grained Access Control**: OpenSearchへのアクセスはマスターユーザーで制御
2. **VPC Isolation**: OpenSearchはVPC内でのみアクセス可能
3. **暗号化**: データは保存時・転送時ともに暗号化
4. **IAMロール**: Lambda実行ロールは最小権限の原則に従う

## 次のステップ

1. インデックスの作成
2. サンプルデータの投入
3. 検索機能のテスト
4. API Gatewayとの統合テスト
5. フロントエンドとの統合

## 参考資料

- [AWS Lambda VPC Configuration](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
- [Amazon OpenSearch VPC Domains](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/vpc.html)
- [VPC Endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints.html)
- [OpenSearch Fine-Grained Access Control](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/fgac.html)
