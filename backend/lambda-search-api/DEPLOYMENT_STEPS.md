# Lambda Search API - デプロイ手順

## 🚀 本番環境へのデプロイ手順

### 前提条件

- AWS CLIがインストール・設定済み
- 適切なIAM権限を持つAWSアカウント
- Node.js 20.x以上がインストール済み
- Terraformがインストール済み（v1.5以上）

### Step 1: 環境変数の設定

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api

# 本番環境用の環境変数ファイルを作成
cp .env.production.example .env.production

# 以下の変数を設定
# OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
# OPENSEARCH_INDEX=file-index
# AWS_REGION=ap-northeast-1
```

### Step 2: VPC情報の取得

```bash
# VPC、サブネット、セキュリティグループを自動取得
./scripts/get-vpc-info.sh
```

このスクリプトは以下を実行します：
- OpenSearchが存在するVPCを特定
- プライベートサブネットを選択
- セキュリティグループを確認

### Step 3: Terraform変数の設定

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars

# 取得したVPC情報を terraform.tfvars に記入
```

### Step 4: Lambda関数のビルドとデプロイ

#### 方法1: 統合デプロイスクリプト（推奨）

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
./scripts/deploy-production.sh
```

#### 方法2: 手動デプロイ

```bash
# 依存関係のインストール
npm install

# TypeScriptをコンパイル
npm run build

# Lambdaパッケージを作成
npm run package

# Terraformでインフラをデプロイ
cd terraform
terraform init
terraform plan
terraform apply
```

### Step 5: API Gatewayエンドポイントの取得

デプロイ完了後、Terraformが出力するAPI Gateway URLをメモします：

```
Outputs:
api_gateway_url = "https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/v1"
```

### Step 6: フロントエンドの環境変数を更新

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

# .env.localを編集
echo "NEXT_PUBLIC_API_GATEWAY_URL=https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/v1" >> .env.local
```

### Step 7: 動作確認

```bash
# APIテストスクリプトを実行
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
./scripts/test-api.sh <API_GATEWAY_URL>
```

### Step 8: フロントエンドの再起動

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
# 開発環境の再起動
yarn dev

# または本番ビルド
yarn build
yarn start
```

## ✅ 確認項目

1. **Lambda関数**
   - CloudWatch Logsで実行ログを確認
   - VPC内でOpenSearchに接続できている

2. **API Gateway**
   - CORS設定が有効
   - Cognito認証が設定されている（必要な場合）

3. **フロントエンド**
   - 検索実行時にAPI Gateway経由でデータ取得
   - エラー時のフォールバック動作

## 🔧 トラブルシューティング

### VPC接続エラー

```bash
# セキュリティグループの確認
aws ec2 describe-security-groups --group-ids <SG_ID>

# Lambda関数のVPC設定確認
aws lambda get-function-configuration --function-name cis-search-api-prod
```

### OpenSearchアクセスエラー

```bash
# IAMロールの権限確認
aws iam get-role-policy --role-name cis-search-api-lambda-role --policy-name opensearch-access

# CloudWatch Logsでエラー確認
aws logs tail /aws/lambda/cis-search-api-prod --follow
```

### API Gatewayエラー

```bash
# API Gateway設定確認
aws apigateway get-rest-api --rest-api-id <API_ID>

# CORS設定確認
aws apigateway get-integration-response --rest-api-id <API_ID> --resource-id <RESOURCE_ID> --http-method GET
```

## 📝 重要な注意事項

1. **VPCエンドポイント**: Lambda関数は必ずOpenSearchと同じVPC内にデプロイ
2. **セキュリティグループ**: Lambda → OpenSearchの通信（HTTPS 443）を許可
3. **IAMロール**: OpenSearch:ESHttpGet, ESHttpPost権限が必要
4. **環境変数**: Lambda環境変数にOPENSEARCH_ENDPOINTを設定
5. **タイムアウト**: Lambda関数のタイムアウトは30秒以上推奨

## 📊 パフォーマンス最適化

デプロイ後、以下の最適化を検討：

1. **Provisioned Concurrency**の有効化（Cold Start削減）
2. **API Gatewayキャッシング**の設定（応答時間短縮）
3. **Lambda Memory**の調整（512MB → 1024MB）
4. **Reserved Concurrency**の設定（同時実行数制御）

---

## サポート

問題が発生した場合：
1. CloudWatch Logsを確認
2. `PRODUCTION_DEPLOYMENT_GUIDE.md`を参照
3. `VPC_OPENSEARCH_IMPLEMENTATION.md`で実装詳細を確認