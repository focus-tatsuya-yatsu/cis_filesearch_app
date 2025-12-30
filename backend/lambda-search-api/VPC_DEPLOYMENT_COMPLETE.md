# Lambda VPC Deployment - Complete Guide

## デプロイメント完了状況

### 実施済み作業

#### 1. Terraform設定ファイル作成 ✅
- **ファイル**: `terraform/terraform.tfvars`
- **VPC ID**: `vpc-02d08f2fa75078e67`
- **プライベートサブネット**:
  - `subnet-0ea0487400a0b3627` (ap-northeast-1a, 10.0.10.0/24)
  - `subnet-01edf92f9d1500875` (ap-northeast-1c, 10.0.11.0/24)
  - `subnet-0ce8ff9ce4bc429bf` (ap-northeast-1d, 10.0.12.0/24)
- **NAT Gateway**: `nat-04c18741881490c45` (rtb-029d3fac4dcd8dd1e)

#### 2. セキュリティグループ設定 ✅
- **Lambda SG**: `sg-06ee622d64e67f12f` (cis-lambda-search-api-sg-prod)
  - Egress: port 443 → `sg-0c482a057b356a0c3` (OpenSearch)
  - Egress: port 443 → 0.0.0.0/0 (AWS services via NAT)

- **OpenSearch SG**: `sg-0c482a057b356a0c3` (cis-filesearch-opensearch-sg)
  - Ingress: port 443 ← `sg-06ee622d64e67f12f` (Lambda)
  - Ingress: port 443 ← `sg-0d44bb0fdfd19da07` (EC2 Worker)
  - Ingress: port 443 ← `sg-0c482a057b356a0c3` (Self)

#### 3. Lambda関数VPC設定 ✅
```bash
Function: cis-search-api-prod
VPC: vpc-02d08f2fa75078e67
Subnets: 3 private subnets across 3 AZs
Security Groups:
  - sg-06ee622d64e67f12f (Lambda SG)
  - sg-0c482a057b356a0c3 (OpenSearch SG)
Status: Active, LastUpdateStatus: Successful
```

#### 4. DNS設定確認 ✅
- **Route 53 Private Hosted Zone**: `Z00961932K6CIIM22B6VP`
  - Domain: `ap-northeast-1.es.amazonaws.com`
  - VPC Association: `vpc-02d08f2fa75078e67`
  - DNS Record: `vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com` → `10.0.10.145`

- **VPC DNS設定**:
  - DNS Support: **enabled**
  - DNS Hostnames: **enabled**

#### 5. Lambda環境変数設定 ✅
```json
{
  "OPENSEARCH_ENDPOINT": "https://10.0.10.145",
  "OPENSEARCH_INDEX": "file-index",
  "OPENSEARCH_USE_IP": "true",
  "NODE_ENV": "production",
  "LOG_LEVEL": "info"
}
```

#### 6. IAM権限設定 ✅
- **Role**: `cis-lambda-search-api-role`
- **Attached Policies**:
  - `AWSLambdaVPCAccessExecutionRole` (VPC ENI管理)
  - `AWSLambdaBasicExecutionRole` (CloudWatch Logs)
  - `cis-lambda-opensearch-access` (OpenSearch access)

### 現在の問題と解決方法

#### 問題: OpenSearch接続エラー

**症状**:
```
Response Error
Failed to connect to OpenSearch
```

**原因**: OpenSearch Fine-Grained Access Control (FGAC) の設定不足

**OpenSearch設定**:
- Advanced Security Options: **Enabled**
- Internal User Database: **Disabled** (IAM認証を使用)
- Anonymous Auth: **Disabled**

**解決方法**: OpenSearchダッシュボードでIAMロールマッピング設定

## 次のステップ: OpenSearch FGAC設定

### OpenSearchダッシュボードへのアクセス

1. **マスターユーザーでログイン**
   ```
   URL: https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_dashboards/
   ```

2. **Security Plugin設定**
   - Dashboards → Security → Roles
   - Role: `all_access` または新規ロール作成

### IAMロールマッピング設定手順

#### 方法1: OpenSearch Dashboards UI

1. **Security → Role Mappings** に移動

2. **`all_access` ロールにマッピング追加**:
   ```
   Backend Role: arn:aws:iam::770923989980:role/cis-lambda-search-api-role
   ```

3. **または、カスタムロール作成**:
   - Role name: `lambda_search_role`
   - Permissions:
     - Cluster: `cluster:monitor/*`, `indices:data/read/*`
     - Index: `file-index`
     - Actions: `read`, `search`

#### 方法2: AWS CLI (OpenSearch Configuration API)

```bash
# Note: これはOpenSearchのConfigration APIを使用する高度な方法です
# ダッシュボードからの設定を推奨します
```

### 設定確認方法

Lambda関数を再度テストして接続を確認:

```bash
aws lambda invoke \
  --function-name cis-search-api-prod \
  --region ap-northeast-1 \
  --cli-binary-format raw-in-base64-out \
  --payload '{"httpMethod":"GET","path":"/search","queryStringParameters":{"q":"test","searchMode":"or","page":"1","limit":"10"}}' \
  /tmp/lambda-response.json

cat /tmp/lambda-response.json | jq .
```

成功時のレスポンス例:
```json
{
  "statusCode": 200,
  "body": {
    "results": [...],
    "pagination": {...},
    "query": {...}
  }
}
```

## アーキテクチャ図

```
┌─────────────────────────────────────────────────────────────┐
│                         VPC (vpc-02d08f2fa75078e67)          │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Private Subnet (10.0.10.0/24) - ap-northeast-1a      │   │
│  │                                                        │   │
│  │  ┌──────────────┐                ┌─────────────────┐ │   │
│  │  │   Lambda     │────────────────│  OpenSearch     │ │   │
│  │  │  Function    │   port 443     │  10.0.10.145    │ │   │
│  │  │              │────────────────│                 │ │   │
│  │  └──────────────┘                └─────────────────┘ │   │
│  │    sg-06ee622d64e67f12f            sg-0c482a057b356a0c3  │
│  │                                                        │   │
│  └────────────────────────────────────┬───────────────────┘   │
│                                       │                       │
│  ┌──────────────────────────────────┴───────────────────┐   │
│  │ Private Subnets (10.0.11.0/24, 10.0.12.0/24)         │   │
│  │                                                        │   │
│  │  Lambda ENIs also deployed here for HA               │   │
│  └────────────────────────────────────────────────────────┘   │
│                                       │                       │
│                                       │                       │
│  ┌────────────────────────────────────┴──────────────────┐   │
│  │          NAT Gateway (nat-04c18741881490c45)          │   │
│  └────────────────────────────────────┬──────────────────┘   │
└───────────────────────────────────────┼──────────────────────┘
                                        │
                                        ▼
                                 Internet Gateway
                                        │
                                        ▼
                             AWS Services (SigV4 auth)
```

## トラブルシューティング

### DNS解決の問題

**症状**: `getaddrinfo ENOTFOUND`

**確認事項**:
```bash
# VPC DNS設定確認
aws ec2 describe-vpc-attribute --vpc-id vpc-02d08f2fa75078e67 --attribute enableDnsSupport
aws ec2 describe-vpc-attribute --vpc-id vpc-02d08f2fa75078e67 --attribute enableDnsHostnames

# Route 53 Private Zone確認
aws route53 get-hosted-zone --id Z00961932K6CIIM22B6VP
aws route53 list-resource-record-sets --hosted-zone-id Z00961932K6CIIM22B6VP
```

**解決方法**:
- 現在はIPアドレス直接指定で回避済み (`OPENSEARCH_USE_IP=true`)
- DNS解決を使用する場合は、VPC DNSが有効であることを確認

### セキュリティグループの問題

**確認コマンド**:
```bash
# Lambda SG確認
aws ec2 describe-security-groups --group-ids sg-06ee622d64e67f12f

# OpenSearch SG確認
aws ec2 describe-security-groups --group-ids sg-0c482a057b356a0c3
```

### Lambda実行ログ確認

```bash
# リアルタイムログ確認
aws logs tail /aws/lambda/cis-search-api-prod --region ap-northeast-1 --follow

# 過去5分のログ
aws logs tail /aws/lambda/cis-search-api-prod --region ap-northeast-1 --since 5m
```

## リソース一覧

### VPCリソース
- VPC ID: `vpc-02d08f2fa75078e67`
- Private Subnets:
  - `subnet-0ea0487400a0b3627` (1a)
  - `subnet-01edf92f9d1500875` (1c)
  - `subnet-0ce8ff9ce4bc429bf` (1d)
- NAT Gateway: `nat-04c18741881490c45`
- Route Table: `rtb-029d3fac4dcd8dd1e`

### セキュリティグループ
- Lambda SG: `sg-06ee622d64e67f12f`
- OpenSearch SG: `sg-0c482a057b356a0c3`

### Lambda
- Function: `cis-search-api-prod`
- Runtime: nodejs20.x
- Memory: 512 MB
- Timeout: 30s
- Role: `cis-lambda-search-api-role`

### OpenSearch
- Domain: `cis-filesearch-opensearch`
- Version: OpenSearch 2.x
- Endpoint: `vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com`
- Internal IP: `10.0.10.145`
- Index: `file-index`

### DNS
- Route 53 Zone: `Z00961932K6CIIM22B6VP`
- Domain: `ap-northeast-1.es.amazonaws.com`

## 本番環境への移行チェックリスト

- [x] Lambda関数をVPC内プライベートサブネットに配置
- [x] セキュリティグループで最小権限の原則を適用
- [x] NAT Gatewayを使用してAWSサービスへのアクセスを確保
- [x] VPC DNS設定を有効化
- [x] Route 53プライベートゾーンを設定
- [ ] OpenSearch Fine-Grained Access Controlを設定
- [ ] Lambda関数の接続テスト成功
- [ ] CloudWatch Logsでモニタリング設定
- [ ] CloudWatch Alarmsで異常検知設定

## 次回のタスク

1. **OpenSearch FGAC設定** (最優先)
   - OpenSearchダッシュボードにアクセス
   - `cis-lambda-search-api-role` IAMロールをマッピング

2. **接続テスト**
   - Lambda関数を再実行
   - 検索クエリが正常に実行されることを確認

3. **API Gateway統合**
   - Terraformを使用してAPI Gatewayリソースをデプロイ
   - Cognitoオーソライザーを設定（オプション）

4. **フロントエンド統合**
   - Next.jsフロントエンドからAPI Gatewayエンドポイントにアクセス
   - 検索機能の動作確認

## 参考資料

- [AWS Lambda VPC Configuration](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
- [Amazon OpenSearch Service Fine-Grained Access Control](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/fgac.html)
- [VPC Endpoints for Amazon OpenSearch Service](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/vpc.html)
