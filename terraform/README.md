# CIS File Search Application - Terraform Infrastructure

このディレクトリには、CISファイル検索アプリケーション（Pattern 3: 月次バッチ同期）のAWSインフラストラクチャをプロビジョニングするためのTerraformコードが含まれています。

## アーキテクチャパターン

**Pattern 3: 月次バッチ同期（NAS-AWSハイブリッド）**
- 月額コスト: **$47.24/月**
- VPN接続: **月4時間のみ**（97%コスト削減）
- データ同期: **月1回の増分同期**
- 検索対象: **過去データのみ**（新データは検索対象外）

## ディレクトリ構造

```
terraform/
├── README.md                 # このファイル
├── main.tf                   # メイン設定（Provider、Backend）
├── variables.tf              # 変数定義
├── outputs.tf                # 出力定義
├── terraform.tfvars.example  # 変数ファイルのサンプル
├── vpc.tf                    # VPC、サブネット、セキュリティグループ
├── vpn.tf                    # Site-to-Site VPN設定
├── s3.tf                     # S3バケット（メタデータストレージ）
├── s3_frontend.tf            # S3フロントエンドバケット（静的ホスティング）✅
├── cloudfront.tf             # CloudFront Distribution✅
├── cognito.tf                # Cognito User Pool（認証）✅
├── api_gateway_cognito.tf    # API Gateway + Cognito Authorizer✅
├── datasync.tf               # DataSync（NAS→S3同期）
├── lambda.tf                 # Lambda関数（未作成）
├── opensearch.tf             # OpenSearch（未作成）
├── dynamodb.tf               # DynamoDB（未作成）
├── step_functions.tf         # Step Functions（未作成）
├── cloudwatch.tf             # CloudWatch（未作成）
├── eventbridge.tf            # EventBridge（未作成）
└── iam.tf                    # IAMロール・ポリシー（未作成）
```

## 前提条件

### 必要なツール
- Terraform >= 1.5.0
- AWS CLI (認証情報設定済み)
- DataSync Agent（NAS側にインストール）

### AWS認証情報
```bash
export AWS_PROFILE=cis-filesearch
export AWS_REGION=ap-northeast-1
```

## セットアップ手順

### 1. 変数ファイルの作成

`terraform.tfvars`を作成し、環境固有の値を設定します：

```bash
# terraform.tfvars.exampleをコピー
cp terraform.tfvars.example terraform.tfvars

# エディタで編集
vim terraform.tfvars
```

```hcl
# terraform.tfvars
aws_region           = "ap-northeast-1"
environment          = "prod"
project_name         = "cis-filesearch"

# VPN Configuration
customer_gateway_ip  = "203.0.113.1"  # オンプレミスVPNルーターのパブリックIP
customer_gateway_bgp_asn = 65000

# NAS Configuration
nas_smb_server       = "192.168.1.100"
nas_smb_domain       = "WORKGROUP"
nas_smb_username     = "datasync_user"
nas_smb_password     = "SecurePassword123!"  # Secrets Managerに保存推奨
nas_smb_subdirectory = "/files"

# DataSync Configuration
datasync_bandwidth_limit = 100  # Mbps

# OpenSearch Configuration
opensearch_instance_type   = "t3.small.search"
opensearch_ebs_volume_size = 50

# Lambda Configuration
lambda_architecture = "arm64"  # Graviton2

# Notification
admin_email = "admin@example.com"

# Frontend Configuration (S3 + CloudFront + Cognito)
frontend_domain    = "filesearch.company.com"
route53_zone_name  = "company.com"

# Cognito Configuration
cognito_mfa_enabled              = false
cognito_use_ses                  = false
cognito_admin_only_user_creation = true

# WAF Configuration
enable_waf = false
```

**注意**: `terraform.tfvars`は`.gitignore`に追加し、Gitにコミットしないでください。

### 2. Terraform Backendの初期化

Terraform Stateを保存するためのS3バケットとDynamoDBテーブルを手動で作成します：

```bash
# S3 Bucket for Terraform State
aws s3 mb s3://cis-filesearch-terraform-state --region ap-northeast-1

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket cis-filesearch-terraform-state \
  --versioning-configuration Status=Enabled

# DynamoDB Table for State Locking
aws dynamodb create-table \
  --table-name cis-filesearch-terraform-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ap-northeast-1
```

### 3. Terraform初期化

```bash
cd terraform
terraform init
```

### 4. プランの確認

```bash
terraform plan -out=tfplan
```

変更内容を確認し、問題がないことを確認します。

### 5. インフラストラクチャのデプロイ

```bash
terraform apply tfplan
```

**デプロイされるリソース**:
- **フロントエンド層**:
  - S3 Bucket（静的ホスティング）
  - CloudFront Distribution（CDN）
  - ACM Certificate（SSL/TLS）
  - Route53 A Record（カスタムドメイン）
- **認証層**:
  - Cognito User Pool（ユーザー認証）
  - Cognito Identity Pool（AWS リソースアクセス）
  - Cognito Hosted UI（ログイン画面）
- **API層**:
  - API Gateway REST API
  - Cognito Authorizer（JWT検証）
  - API Gateway Custom Domain
- **バックエンド層**:
  - VPC、サブネット、NAT Gateway
  - Site-to-Site VPN Connection
  - S3 Bucket（Intelligent-Tiering）
  - DataSync Task（月次スケジュール）
  - Lambda Functions（TextExtractor、ImageFeatureExtractor、etc.）
  - OpenSearch Domain（t3.small.search、kuromoji + k-NN）
  - DynamoDB Tables（file_metadata、sync_jobs）
  - Step Functions State Machine
  - EventBridge Rule（月次トリガー）
- **監視・通知**:
  - CloudWatch Logs & Alarms
  - SNS Topic（通知用）

### 6. DataSync Agentのアクティベーション

DataSync AgentはNAS側にインストールされたソフトウェアです。以下の手順でアクティベーションします：

1. **Agentのインストール**:
   - NAS側にDataSync Agent VMをデプロイ
   - VMを起動し、IPアドレスを確認

2. **Agentのアクティベーション**:
   ```bash
   aws datasync create-agent \
     --agent-name cis-filesearch-datasync-agent \
     --activation-key <ACTIVATION_KEY> \
     --region ap-northeast-1
   ```

3. **TerraformでAgent ARNを更新**:
   ```hcl
   # datasync.tf
   resource "aws_datasync_agent" "nas" {
     name       = "${var.project_name}-datasync-agent"
     ip_address = "192.168.1.200"  # 実際のAgent IP
     # ...
   }
   ```

4. **再デプロイ**:
   ```bash
   terraform apply
   ```

### 7. VPN接続の設定

Terraform出力から取得したVPN設定情報をオンプレミスVPNルーターに設定します：

```bash
# VPN設定情報を取得
terraform output -json > vpn_config.json

# または個別に取得
terraform output vpn_tunnel1_address
terraform output vpn_tunnel1_preshared_key
```

**オンプレミスルーター設定例（StrongSwan）**:
```conf
# /etc/ipsec.conf
conn cis-filesearch-tunnel1
    type=tunnel
    authby=secret
    left=%defaultroute
    leftid=<YOUR_PUBLIC_IP>
    right=<vpn_tunnel1_address>
    rightsubnet=10.0.0.0/16
    ike=aes256-sha256-modp2048!
    esp=aes256-sha256!
    keyingtries=%forever
    auto=start
```

```conf
# /etc/ipsec.secrets
<YOUR_PUBLIC_IP> <vpn_tunnel1_address> : PSK "<vpn_tunnel1_preshared_key>"
```

## 運用

### 月次バッチの手動実行

EventBridgeによる自動実行の他、手動でバッチを実行することも可能です：

```bash
# Step Functions State Machineを手動実行
aws stepfunctions start-execution \
  --state-machine-arn <STATE_MACHINE_ARN> \
  --input '{}'
```

### ログの確認

```bash
# DataSyncログ
aws logs tail /aws/datasync/cis-filesearch --follow

# Lambda実行ログ
aws logs tail /aws/lambda/cis-filesearch-text-extractor --follow

# Step Functionsログ
aws logs tail /aws/states/cis-filesearch-monthly-batch --follow
```

### コスト監視

```bash
# 月次コストレポート
aws ce get-cost-and-usage \
  --time-period Start=2025-01-01,End=2025-02-01 \
  --granularity MONTHLY \
  --metrics "UnblendedCost" \
  --filter file://cost-filter.json
```

## トラブルシューティング

### VPN接続が確立しない

1. **ルーター側のログを確認**:
   ```bash
   sudo tail -f /var/log/syslog | grep ipsec
   ```

2. **AWS側のトンネル状態を確認**:
   ```bash
   aws ec2 describe-vpn-connections \
     --vpn-connection-ids <VPN_CONNECTION_ID>
   ```

3. **セキュリティグループとルートテーブルを確認**

### DataSync同期が失敗する

1. **DataSync Task実行履歴を確認**:
   ```bash
   aws datasync describe-task-execution \
     --task-execution-arn <TASK_EXECUTION_ARN>
   ```

2. **NAS側のアクセス権限を確認**:
   - SMBユーザーの権限
   - ファイアウォール設定

3. **CloudWatch Logsを確認**:
   ```bash
   aws logs tail /aws/datasync/cis-filesearch
   ```

### Lambda関数がタイムアウトする

1. **メモリとタイムアウト設定を増やす**:
   ```hcl
   resource "aws_lambda_function" "text_extractor" {
     memory_size = 3008  # MB
     timeout     = 900   # seconds (15分)
     # ...
   }
   ```

2. **VPCエンドポイントを使用してNAT Gateway経由の通信を削減**

## セキュリティベストプラクティス

### Secrets Managerの使用

機密情報（NASパスワード等）はSecrets Managerに保存することを推奨します：

```hcl
# secrets.tf
resource "aws_secretsmanager_secret" "nas_credentials" {
  name = "${var.project_name}/nas-credentials"
}

resource "aws_secretsmanager_secret_version" "nas_credentials" {
  secret_id = aws_secretsmanager_secret.nas_credentials.id
  secret_string = jsonencode({
    username = var.nas_smb_username
    password = var.nas_smb_password
  })
}
```

### IAM最小権限の原則

各Lambdaは必要最小限の権限のみを持つIAMロールを使用します。

### VPCエンドポイント

S3、DynamoDB、Secrets ManagerへのアクセスにVPCエンドポイントを使用し、インターネット経由の通信を削減します。

## コスト最適化

### Reserved InstancesとSavings Plans

3ヶ月の安定稼働後、以下のReserved Instancesの購入を検討：

- OpenSearch Reserved Instances（1年契約）: **$10/月削減**
- Compute Savings Plans: **$5/月削減**

### Intelligent-Tiering最適化

S3 Intelligent-Tieringにより、アクセス頻度に応じて自動的に最適なストレージクラスに移動します。

## 次のステップ

### Week 3-4: Lambda関数の実装

以下のLambda関数を実装します：

1. **VPNManager**: VPN接続/切断
2. **FileScanner**: S3バケットスキャン
3. **TextExtractor**: PDF/Docuworksテキスト抽出
4. **ImageFeatureExtractor**: ResNet-50画像特徴抽出
5. **BulkIndexer**: OpenSearch一括インデックス

詳細は`/docs/implementation-roadmap-optimized.md`を参照してください。

## 参考ドキュメント

- [Architecture Design](/docs/architecture-batch-optimized.md)
- [Image Similarity Search](/docs/image-similarity-search.md)
- [Batch Sync Design](/docs/batch-sync-design.md)
- [Cost Optimization Analysis](/docs/cost-optimization-analysis.md)
- [Implementation Roadmap](/docs/implementation-roadmap-optimized.md)
- [AWS Resource Sizing](/docs/aws-resource-sizing.md)

## サポート

問題が発生した場合は、以下のチャンネルでサポートを受けてください：

- GitHub Issues: https://github.com/your-org/cis-filesearch/issues
- Slack: #cis-filesearch-support
- Email: support@example.com
