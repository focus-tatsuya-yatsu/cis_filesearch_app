# Lambda Search API - VPC接続問題の解決策サマリー

## 問題の概要

Lambda関数 `cis-search-api-prod` がVPC内のOpenSearchエンドポイントに接続できない:

```
Error: "getaddrinfo ENOTFOUND vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
```

## 根本原因

1. **OpenSearch Terraformリソースの欠落**
   - OpenSearchドメインの定義が存在しない
   - Terraformで`aws_opensearch_domain.main`を参照しているが、実際のリソース定義がない

2. **VPCエンドポイントの不足**
   - Lambda関数がVPC内でAWSサービス（CloudWatch Logs、STSなど）にアクセスできない
   - DNS解決に必要なVPCエンドポイントが設定されていない

3. **Lambda VPC設定の問題**
   - セキュリティグループの誤った割り当て
   - Lambda関数にOpenSearch SGを直接割り当てている（不適切）

4. **環境変数の問題**
   - `OPENSEARCH_ENDPOINT`に`https://`プレフィックスが含まれている
   - コード内で二重に`https://`が付与される

## 解決策

### 1. 作成・修正したファイル

#### Terraformファイル

| ファイル | 内容 | 目的 |
|---------|------|------|
| `terraform/opensearch.tf` | **新規作成** | OpenSearchドメインの定義、FGAC設定、暗号化、CloudWatch統合 |
| `terraform/variables.tf` | **修正** | OpenSearch関連の変数追加（master_user, master_password, instance_count等） |
| `terraform/vpc.tf` | **修正** | VPCエンドポイント追加（S3, DynamoDB, Lambda, CloudWatch Logs, STS） |
| `terraform/lambda_search_api.tf` | **修正** | VPC設定の最適化、環境変数の修正 |

#### Lambda関数ファイル

| ファイル | 内容 | 目的 |
|---------|------|------|
| `backend/lambda-search-api/index-vpc-fixed.js` | **修正** | VPC接続の最適化、エンドポイントURL正規化、エラーハンドリング改善 |

#### ドキュメント・スクリプト

| ファイル | 種類 | 目的 |
|---------|------|------|
| `VPC_DEPLOYMENT_GUIDE.md` | ドキュメント | 完全なデプロイメントガイド（根本原因、解決策、手順、トラブルシューティング） |
| `QUICKSTART_VPC_FIX.md` | クイックスタート | 3ステップの即座の解決手順 |
| `deploy-vpc-fixed.sh` | デプロイスクリプト | Lambda関数の自動デプロイ |
| `diagnose-vpc-connection.sh` | 診断スクリプト | VPC接続の包括的な診断 |
| `VPC_FIX_SUMMARY.md` | サマリー | この文書 |

### 2. 主要な変更点

#### OpenSearchドメインの作成

```hcl
resource "aws_opensearch_domain" "main" {
  domain_name    = "${var.project_name}-opensearch-${var.environment}"
  engine_version = "OpenSearch_2.11"

  vpc_options {
    subnet_ids         = [aws_subnet.private[0].id]
    security_group_ids = [aws_security_group.opensearch.id]
  }

  # Fine-Grained Access Control
  advanced_security_options {
    enabled                        = true
    internal_user_database_enabled = true
    master_user_options {
      master_user_name     = var.opensearch_master_user
      master_user_password = var.opensearch_master_password
    }
  }

  # 暗号化設定
  encrypt_at_rest { enabled = true }
  node_to_node_encryption { enabled = true }
  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }
}
```

#### VPCエンドポイントの追加

**Gateway Endpoints（無料）**:
- S3: `com.amazonaws.ap-northeast-1.s3`
- DynamoDB: `com.amazonaws.ap-northeast-1.dynamodb`

**Interface Endpoints（課金あり）**:
- Lambda: `com.amazonaws.ap-northeast-1.lambda`
- CloudWatch Logs: `com.amazonaws.ap-northeast-1.logs`
- STS: `com.amazonaws.ap-northeast-1.sts`

コスト: 約$22/月（Interface Endpointsのみ）

#### Lambda関数コードの最適化

```javascript
// Before
const endpoint = process.env.OPENSEARCH_ENDPOINT || 'vpc-...';
node: `https://${endpoint}`,

// After
const endpoint = process.env.OPENSEARCH_ENDPOINT;
if (!endpoint) {
  throw new Error('OPENSEARCH_ENDPOINT environment variable is required');
}
const cleanEndpoint = endpoint.replace(/^https?:\/\//, '');
node: `https://${cleanEndpoint}`,
```

追加設定:
- `requestTimeout: 30000`
- `ssl: { rejectUnauthorized: true }`
- 環境変数の必須チェック

#### Lambda VPC設定の修正

```hcl
# Before
vpc_config {
  subnet_ids = aws_subnet.private[*].id
  security_group_ids = [
    aws_security_group.lambda_search_api.id,
    aws_security_group.opensearch.id  # ❌ 不適切
  ]
}

# After
vpc_config {
  subnet_ids = aws_subnet.private[*].id
  security_group_ids = [
    aws_security_group.lambda_search_api.id  # ✅ Lambda専用SG
  ]
}
```

#### 環境変数の修正

```hcl
# Before
OPENSEARCH_ENDPOINT = "https://${aws_opensearch_domain.main.endpoint}"

# After
OPENSEARCH_ENDPOINT = aws_opensearch_domain.main.endpoint  # https://なし
```

### 3. デプロイメント手順

#### クイックスタート（推奨）

```bash
# 1. Terraformの準備
cd terraform
cat > terraform.tfvars <<EOF
customer_gateway_ip        = "YOUR_VPN_IP"
nas_smb_server            = "YOUR_NAS_IP"
nas_smb_username          = "YOUR_NAS_USER"
nas_smb_password          = "YOUR_NAS_PASSWORD"
admin_email               = "admin@example.com"
frontend_domain           = "filesearch.example.com"
route53_zone_name         = "example.com"
opensearch_master_user    = "admin"
opensearch_master_password = "SecurePassword123!"
create_opensearch_service_role = false
EOF

terraform init
terraform apply -auto-approve

# 2. Lambda関数のデプロイ
cd ../backend/lambda-search-api
./deploy-vpc-fixed.sh

# 3. 接続確認
./diagnose-vpc-connection.sh
```

#### 手動デプロイ

詳細は`VPC_DEPLOYMENT_GUIDE.md`を参照

### 4. 検証手順

#### 診断スクリプト実行

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
./diagnose-vpc-connection.sh
```

診断内容:
- [1] Lambda関数の設定確認
- [2] VPC DNS設定の確認
- [3] セキュリティグループの分析
- [4] OpenSearchドメインのステータス
- [5] VPCエンドポイントの確認
- [6] NAT Gatewayの確認
- [7] ルートテーブルの確認
- [8] Lambda IAMロールの権限確認
- [9] 直近のLambdaエラー確認

#### Lambda関数のテスト

```bash
# テスト実行
aws lambda invoke \
  --function-name cis-search-api-prod \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test","limit":"5"}}' \
  response.json

# 結果確認
cat response.json | python3 -m json.tool
```

成功時の応答:
```json
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  },
  "body": "{\"success\":true,\"data\":{\"results\":[...],\"total\":100,\"page\":1,\"limit\":5}}"
}
```

### 5. トラブルシューティング

#### DNS解決エラーが続く場合

```bash
# VPC DNS設定の確認と修正
aws ec2 modify-vpc-attribute \
  --vpc-id vpc-02d08f2fa75078e67 \
  --enable-dns-support

aws ec2 modify-vpc-attribute \
  --vpc-id vpc-02d08f2fa75078e67 \
  --enable-dns-hostnames
```

#### OpenSearchアクセス拒否エラー

```bash
# OpenSearchのアクセスポリシー確認
aws opensearch describe-domain \
  --domain-name cis-filesearch-opensearch-prod \
  --query 'DomainStatus.AccessPolicies'

# Fine-Grained Access Controlのマスターユーザーでアクセスしているか確認
```

#### セキュリティグループの問題

```bash
# Lambda SG → OpenSearch SG への443番ポート許可確認
aws ec2 describe-security-groups \
  --group-ids sg-0c482a057b356a0c3 \
  --query 'SecurityGroups[0].IpPermissions[?FromPort==`443`]'
```

必要なインバウンドルール:
- Source: Lambda SG (sg-06ee622d64e67f12f)
- Port: 443 (HTTPS)
- Protocol: TCP

#### CloudWatch Logsの確認

```bash
# Lambda関数のログ
aws logs tail /aws/lambda/cis-search-api-prod --follow

# OpenSearchのログ
aws logs tail /aws/opensearch/cis-filesearch-prod/application-logs --follow
```

### 6. コスト分析

#### VPCエンドポイント

| エンドポイント | タイプ | 月額コスト |
|---------------|--------|-----------|
| S3 | Gateway | $0 |
| DynamoDB | Gateway | $0 |
| Lambda | Interface | ~$7.30 |
| CloudWatch Logs | Interface | ~$7.30 |
| STS | Interface | ~$7.30 |
| **合計** | | **~$22** |

データ処理料金: $0.01/GB

#### NAT Gateway

| 項目 | 料金 |
|------|------|
| 時間料金 | $0.062/時間 × 730時間 = ~$45 |
| データ処理 | $0.062/GB |

#### 推奨構成

VPCエンドポイントを使用することで:
- ✅ NAT Gatewayのデータ転送量削減
- ✅ レイテンシー改善
- ✅ セキュリティ向上（VPC内で完結）
- ⚠️ 月額コストは同程度（~$22 vs ~$45）

総コスト: VPCエンドポイント使用時の方が長期的に低コスト

### 7. セキュリティ考慮事項

1. **Fine-Grained Access Control (FGAC)**
   - OpenSearchへのアクセスはマスターユーザーで制御
   - インデックス・ドキュメント・フィールドレベルのアクセス制御

2. **VPC Isolation**
   - OpenSearchはVPC内でのみアクセス可能
   - インターネットからの直接アクセス不可

3. **暗号化**
   - 保存時の暗号化: 有効
   - 転送時の暗号化: TLS 1.2以上
   - ノード間暗号化: 有効

4. **IAMロール**
   - Lambda実行ロールは最小権限の原則に従う
   - OpenSearchへのアクセスは`es:ESHttpGet`、`es:ESHttpPost`、`es:ESHttpHead`のみ

5. **セキュリティグループ**
   - Lambda SG → OpenSearch SG: 443番ポートのみ許可
   - OpenSearch SGからのアウトバウンド: 制限なし（ログ送信等のため）

### 8. モニタリング設定

#### CloudWatch Alarms（既存）

- **高エラー率**: >10エラー/2分
- **スロットル**: >5スロットル/1分
- **高レイテンシー**: >5秒平均

#### OpenSearch Logs

- Application Logs: `/aws/opensearch/cis-filesearch-prod/application-logs`
- Index Slow Logs: `/aws/opensearch/cis-filesearch-prod/index-slow-logs`
- Search Slow Logs: `/aws/opensearch/cis-filesearch-prod/search-slow-logs`

保持期間: 7日間

#### 推奨メトリクス

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

# OpenSearch CPU使用率
aws cloudwatch get-metric-statistics \
  --namespace AWS/ES \
  --metric-name CPUUtilization \
  --dimensions Name=DomainName,Value=cis-filesearch-opensearch-prod \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum
```

### 9. パフォーマンス最適化

#### OpenSearch設定

- **インスタンスタイプ**: t3.small.search（開発）→ r6g.large.search（本番推奨）
- **インスタンス数**: 1（開発）→ 2-3（本番、Multi-AZ）
- **EBSボリューム**: gp3（3000 IOPS、125 MB/s）
- **シャード設定**: インデックスサイズに応じて最適化

#### Lambda設定

- **メモリ**: 512 MB（必要に応じて1024 MBに増加）
- **タイムアウト**: 30秒
- **同時実行数**: 10（予約済み）
- **VPC設定**: プライベートサブネット × 2（Multi-AZ）

#### キャッシング戦略

フロントエンド側で検索結果をキャッシュ:
- Redis（ElastiCache）または
- CloudFront（API Gateway前段）

### 10. 次のステップ

1. **OpenSearchインデックスの作成**
   - `cis-files`インデックス（テキスト検索用）
   - `file-index-v2-knn`インデックス（画像検索用）

2. **サンプルデータの投入**
   - テストデータのインデックス
   - 検索動作の確認

3. **API Gatewayとの統合**
   - エンドポイントの設定
   - Cognito認証の統合
   - CORS設定

4. **フロントエンドとの統合**
   - 検索UIの接続
   - エラーハンドリングの実装
   - パフォーマンステスト

## 提供ファイル一覧

### Terraformファイル
- ✅ `terraform/opensearch.tf` - OpenSearchドメイン定義
- ✅ `terraform/variables.tf` - 変数追加
- ✅ `terraform/vpc.tf` - VPCエンドポイント追加
- ✅ `terraform/lambda_search_api.tf` - VPC設定修正

### Lambda関数ファイル
- ✅ `backend/lambda-search-api/index-vpc-fixed.js` - VPC最適化版

### ドキュメント
- ✅ `VPC_DEPLOYMENT_GUIDE.md` - 完全なデプロイメントガイド
- ✅ `QUICKSTART_VPC_FIX.md` - 3ステップクイックスタート
- ✅ `VPC_FIX_SUMMARY.md` - このサマリー文書

### スクリプト
- ✅ `deploy-vpc-fixed.sh` - 自動デプロイスクリプト
- ✅ `diagnose-vpc-connection.sh` - VPC接続診断スクリプト

## まとめ

Lambda関数がVPC内のOpenSearchに接続できない問題は、以下の対応で解決します:

1. **OpenSearchドメインの作成** - Terraform経由で適切に構成
2. **VPCエンドポイントの設定** - Lambda関数がAWSサービスにアクセス可能に
3. **Lambda VPC設定の最適化** - セキュリティグループと環境変数の修正
4. **Lambda関数コードの改善** - VPC接続に最適化

すべての変更は、提供されたTerraformファイルとスクリプトで簡単にデプロイできます。

## サポート

問題が解決しない場合:
1. `./diagnose-vpc-connection.sh`を実行
2. CloudWatch Logsを確認
3. `VPC_DEPLOYMENT_GUIDE.md`のトラブルシューティングセクションを参照

## 参考資料

- [VPC_DEPLOYMENT_GUIDE.md](./VPC_DEPLOYMENT_GUIDE.md) - 完全なデプロイメントガイド
- [QUICKSTART_VPC_FIX.md](./QUICKSTART_VPC_FIX.md) - クイックスタートガイド
- [AWS Lambda VPC設定](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
- [Amazon OpenSearch VPCドメイン](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/vpc.html)
