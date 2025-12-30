# Lambda Search API - VPC接続問題のクイックフィックス

## 問題

Lambda関数がVPC内のOpenSearchエンドポイントを解決できません:
```
Error: "getaddrinfo ENOTFOUND vpc-cis-filesearch-opensearch-*.ap-northeast-1.es.amazonaws.com"
```

## 即座の解決策（3ステップ）

### ステップ1: Terraformの準備

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/terraform

# terraform.tfvarsの作成（存在しない場合）
cat > terraform.tfvars <<EOF
# 必須設定
customer_gateway_ip      = "YOUR_VPN_IP"
nas_smb_server          = "YOUR_NAS_IP"
nas_smb_username        = "YOUR_NAS_USER"
nas_smb_password        = "YOUR_NAS_PASSWORD"
admin_email             = "admin@example.com"
frontend_domain         = "filesearch.example.com"
route53_zone_name       = "example.com"

# OpenSearch認証情報
opensearch_master_user     = "admin"
opensearch_master_password = "SecurePassword123!"

# オプション: OpenSearchサービスロール
create_opensearch_service_role = false  # 既存の場合はfalse
EOF

# Terraformの適用
terraform init
terraform plan
terraform apply -auto-approve
```

### ステップ2: Lambda関数のデプロイ

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api

# デプロイスクリプトの実行
./deploy-vpc-fixed.sh
```

### ステップ3: 接続確認

```bash
# 診断スクリプトの実行
./diagnose-vpc-connection.sh

# Lambda関数のテスト
aws lambda invoke \
  --function-name cis-search-api-prod \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test"}}' \
  response.json

cat response.json
```

## 主な変更点

### 1. OpenSearchドメインの作成 (`terraform/opensearch.tf`)

- VPC内のOpenSearchドメイン
- Fine-Grained Access Control有効化
- 暗号化設定（保存時・転送時・ノード間）
- CloudWatch Logs統合

### 2. VPCエンドポイントの追加 (`terraform/vpc.tf`)

- S3エンドポイント（Gateway - 無料）
- DynamoDBエンドポイント（Gateway - 無料）
- CloudWatch Logsエンドポイント（Interface）
- STSエンドポイント（Interface）
- Lambdaエンドポイント（Interface）

### 3. Lambda関数コードの最適化 (`index-vpc-fixed.js`)

- 環境変数の検証強化
- VPC接続用タイムアウト設定
- エンドポイントURLの正規化
- エラーハンドリング改善

### 4. セキュリティグループの修正

- Lambda関数のSG設定を最適化
- OpenSearch SGへの適切なインバウンドルール設定

## トラブルシューティング

### DNS解決エラーが続く場合

```bash
# VPC DNS設定の確認
aws ec2 describe-vpc-attribute \
  --vpc-id vpc-02d08f2fa75078e67 \
  --attribute enableDnsSupport

aws ec2 describe-vpc-attribute \
  --vpc-id vpc-02d08f2fa75078e67 \
  --attribute enableDnsHostnames

# 両方ともtrueである必要があります
```

修正:
```bash
aws ec2 modify-vpc-attribute \
  --vpc-id vpc-02d08f2fa75078e67 \
  --enable-dns-support

aws ec2 modify-vpc-attribute \
  --vpc-id vpc-02d08f2fa75078e67 \
  --enable-dns-hostnames
```

### OpenSearchアクセスエラー

```bash
# OpenSearchのアクセスポリシー確認
aws opensearch describe-domain \
  --domain-name cis-filesearch-opensearch-prod \
  --query 'DomainStatus.AccessPolicies' \
  --output text | python3 -m json.tool
```

### セキュリティグループの確認

```bash
# Lambda SG → OpenSearch SG への443番ポートアクセス確認
aws ec2 describe-security-groups \
  --group-ids sg-0c482a057b356a0c3 \
  --query 'SecurityGroups[0].IpPermissions[?FromPort==`443`]'
```

## コスト最適化

### VPCエンドポイント vs NAT Gateway

**現在の構成（推奨）**:
- VPCエンドポイント（Gateway）: 無料
- VPCエンドポイント（Interface）: ~$22/月
- NAT Gateway: ~$45/月 + データ転送料

**代替案（低コスト）**:
Interface Endpointsを削除してNAT Gatewayのみを使用:
```bash
# terraform/vpc.tfから以下をコメントアウト
# - aws_vpc_endpoint.lambda
# - aws_vpc_endpoint.logs
# - aws_vpc_endpoint.sts

# 再デプロイ
terraform apply
```

トレードオフ:
- コスト削減: ~$22/月削減
- パフォーマンス: わずかにレイテンシー増加
- データ転送料: NAT Gatewayのデータ転送料が増加

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

# Lambda エラー数
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=cis-search-api-prod \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

## 次のステップ

1. **OpenSearchインデックスの作成**:
```bash
# インデックス作成スクリプト実行
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
./scripts/create-opensearch-indices.sh
```

2. **サンプルデータの投入**:
```bash
# サンプルデータのインデックス
./scripts/index-sample-data.sh
```

3. **API Gatewayとの統合テスト**:
```bash
# API Gateway経由でのテスト
curl -X GET "https://YOUR_API_GATEWAY_URL/search?q=test&limit=10"
```

4. **フロントエンドとの統合**:
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
# .envファイルの更新
echo "NEXT_PUBLIC_API_URL=https://YOUR_API_GATEWAY_URL" > .env.local

# 開発サーバー起動
npm run dev
```

## 詳細情報

完全なデプロイメントガイド:
- `/backend/lambda-search-api/VPC_DEPLOYMENT_GUIDE.md`

診断スクリプト:
- `/backend/lambda-search-api/diagnose-vpc-connection.sh`

## サポート

問題が解決しない場合:
1. 診断スクリプトを実行: `./diagnose-vpc-connection.sh`
2. CloudWatch Logsを確認
3. セキュリティグループ設定を確認
4. VPC DNS設定を確認

## 参考資料

- [AWS Lambda VPC設定](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
- [Amazon OpenSearch VPCドメイン](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/vpc.html)
- [VPCエンドポイント](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints.html)
