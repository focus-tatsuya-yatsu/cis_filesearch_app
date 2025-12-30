# Lambda Search API - デプロイステータスレポート

**生成日時**: 2025-12-17
**対象環境**: 本番環境（ap-northeast-1）
**OpenSearchエンドポイント**: vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com

---

## 📊 現在のデプロイ状況

### 🔴 **ステータス: 未デプロイ**

Lambda Search APIは実装が完了していますが、**AWS環境への実際のデプロイはまだ行われていません**。

---

## ✅ 実装完了項目

### 1. Lambda関数コード
- ✅ **TypeScriptソースコード**: 完全実装済み
  - `/Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/src/index.ts`
  - `/Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/src/services/opensearch.service.ts`
  - その他、全サービス・ユーティリティ実装済み

### 2. Terraform Infrastructure as Code
- ✅ **完全なTerraform設定**: 作成済み
  - `/Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/terraform/lambda.tf`
  - Lambda関数、API Gateway、IAMロール、セキュリティグループ、CloudWatch設定を含む

### 3. デプロイスクリプト
- ✅ **自動デプロイスクリプト**: 実装済み
  - `scripts/deploy-production.sh`
  - `scripts/get-vpc-info.sh`
  - `scripts/test-api.sh`

### 4. ドキュメント
- ✅ **包括的ドキュメント**: 作成済み
  - README.md
  - DEPLOYMENT_STEPS.md
  - PRODUCTION_DEPLOYMENT_GUIDE.md
  - VPC_OPENSEARCH_IMPLEMENTATION.md
  - QUICK_START.md

---

## ❌ 未完了項目（デプロイが必要）

### 1. Lambda関数のビルド
- ❌ **distディレクトリ**: 存在しない
- ❌ **lambda-deployment.zip**: 未作成

**必要な操作:**
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
npm install
npm run build
npm run package
```

### 2. Terraformの初期化とデプロイ
- ❌ **Terraform初期化**: 未実行
- ❌ **Lambda関数**: AWS上に存在しない
- ❌ **API Gateway**: AWS上に存在しない

**必要な操作:**
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/terraform
terraform init
terraform plan
terraform apply
```

### 3. AWS認証情報
- ⚠️ **AWS Credentials**: 無効または期限切れ

**エラー内容:**
```
An error occurred (InvalidClientTokenId) when calling the GetCallerIdentity operation:
The security token included in the request is invalid
```

**必要な操作:**
AWS認証情報の更新が必要です。以下のいずれかを実行：

**方法1: AWS CLI設定の更新**
```bash
aws configure
# Access Key ID と Secret Access Key を入力
```

**方法2: AWS SSOの使用**
```bash
aws sso login --profile your-profile
export AWS_PROFILE=your-profile
```

---

## 🔍 デプロイ前に必要な情報取得

### OpenSearch VPC設定情報

Lambda関数をOpenSearchと同じVPC内にデプロイするため、以下の情報が必要です：

#### 必要な情報リスト

1. **VPC ID**
   - OpenSearchが配置されているVPC

2. **プライベートサブネットID（2つ以上）**
   - Lambda関数を配置するサブネット
   - 異なるAvailability Zone（AZ）のサブネットが必要

3. **OpenSearchセキュリティグループID**
   - Lambda → OpenSearchの通信を許可するSG

4. **Cognito User Pool情報**（認証を有効にする場合）
   - User Pool ID
   - User Pool ARN

#### 情報取得スクリプト

AWS認証情報が有効な状態で以下を実行：

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/scripts
./get-vpc-info.sh
```

このスクリプトは自動的に以下を実行：
1. OpenSearchドメインの検索
2. VPC設定の抽出
3. サブネット情報の取得
4. セキュリティグループの確認
5. `terraform/terraform.tfvars`への自動記入

---

## 📋 デプロイ実行手順

### ステップ1: AWS認証情報の確認・更新

```bash
# 現在の認証情報確認
aws sts get-caller-identity

# 正しいアカウントIDとリージョンが表示されることを確認
# 表示例:
# {
#   "UserId": "AIDXXXXXXXXXXXXXXXX",
#   "Account": "123456789012",
#   "Arn": "arn:aws:iam::123456789012:user/username"
# }
```

### ステップ2: VPC情報の自動取得

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/scripts
./get-vpc-info.sh
```

**成功時の出力例:**
```
✅ OpenSearch domain found: vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe
✅ VPC ID: vpc-xxxxxxxxx
✅ Private Subnets: subnet-aaaaaa, subnet-bbbbbb
✅ Security Group: sg-xxxxxxxxx
✅ terraform.tfvars created successfully
```

### ステップ3: Lambda関数のビルドとパッケージング

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api

# 依存関係のインストール
npm install

# TypeScriptをビルド
npm run build

# Lambda デプロイパッケージの作成
npm run package

# 確認
ls -lh lambda-deployment.zip
# lambda-deployment.zip が作成されていることを確認
```

### ステップ4: Terraform環境変数の設定

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/terraform

# terraform.tfvarsを確認
cat terraform.tfvars

# 以下のような内容が記載されていることを確認:
# aws_region = "ap-northeast-1"
# environment = "prod"
# opensearch_domain_endpoint = "vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
# opensearch_index_name = "file-index"
# vpc_id = "vpc-xxxxxxxxx"
# private_subnet_ids = ["subnet-aaaaaa", "subnet-bbbbbb"]
# opensearch_security_group_id = "sg-xxxxxxxxx"
# cognito_user_pool_id = "ap-northeast-1_xxxxxxxxx"
# cognito_user_pool_arn = "arn:aws:cognito-idp:ap-northeast-1:123456789012:userpool/ap-northeast-1_xxxxxxxxx"
```

### ステップ5: Terraformでインフラをデプロイ

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/terraform

# 初期化
terraform init

# プラン確認（どのリソースが作成されるか確認）
terraform plan

# デプロイ実行
terraform apply

# "yes" を入力してデプロイ実行
```

**作成されるAWSリソース:**
1. Lambda関数: `cis-search-api-prod`
2. Lambda IAMロール + ポリシー
3. Lambda セキュリティグループ
4. API Gateway REST API: `cis-search-api-prod`
5. API Gateway Authorizer（Cognito統合）
6. API Gateway デプロイメント
7. CloudWatch Log Group
8. CloudWatch Alarms（エラー、スロットル検知）

### ステップ6: API Gatewayエンドポイントの取得

デプロイ完了後、Terraformが以下の出力を表示します：

```
Outputs:

api_gateway_url = "https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod/search"
lambda_function_arn = "arn:aws:lambda:ap-northeast-1:123456789012:function:cis-search-api-prod"
lambda_function_name = "cis-search-api-prod"
```

**このAPI Gateway URLをメモしてください。フロントエンドで使用します。**

### ステップ7: 動作確認

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/scripts

# API動作テスト（Cognito認証なしの場合）
./test-api.sh https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod

# API動作テスト（Cognito認証ありの場合）
./test-api.sh https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod YOUR_COGNITO_TOKEN
```

### ステップ8: フロントエンドの環境変数更新

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

# .env.localファイルを編集
vim .env.local

# 以下を追加または更新:
NEXT_PUBLIC_API_GATEWAY_URL=https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod

# フロントエンドを再起動
yarn dev
```

---

## 🔧 トラブルシューティング

### 問題1: AWS認証エラー

**エラー:**
```
InvalidClientTokenId: The security token included in the request is invalid
```

**解決方法:**
```bash
# AWS CLIの再設定
aws configure

# または環境変数で設定
export AWS_ACCESS_KEY_ID=YOUR_ACCESS_KEY
export AWS_SECRET_ACCESS_KEY=YOUR_SECRET_KEY
export AWS_DEFAULT_REGION=ap-northeast-1
```

### 問題2: Terraformエラー - VPC情報が不足

**エラー:**
```
Error: Missing required variable
```

**解決方法:**
1. `scripts/get-vpc-info.sh`を実行
2. 手動で`terraform/terraform.tfvars`を作成

```bash
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
vim terraform/terraform.tfvars
# 必要な値を手動で入力
```

### 問題3: Lambda関数がOpenSearchに接続できない

**原因:**
- セキュリティグループの設定ミス
- サブネット設定の誤り
- IAMロールの権限不足

**診断コマンド:**
```bash
# Lambda関数のVPC設定確認
aws lambda get-function-configuration \
  --function-name cis-search-api-prod \
  --query 'VpcConfig'

# CloudWatch Logsでエラー確認
aws logs tail /aws/lambda/cis-search-api-prod --follow
```

### 問題4: ビルドエラー

**エラー:**
```
npm ERR! Missing script: "build"
```

**解決方法:**
```bash
# package.jsonを確認
cat package.json

# 依存関係を再インストール
rm -rf node_modules package-lock.json
npm install
npm run build
```

---

## 📊 デプロイ完了後の確認事項

### Lambda関数の確認

```bash
# Lambda関数の一覧
aws lambda list-functions \
  --query 'Functions[?contains(FunctionName, `search`)].{Name:FunctionName,Runtime:Runtime,State:State}'

# Lambda関数の設定詳細
aws lambda get-function-configuration \
  --function-name cis-search-api-prod
```

### API Gatewayの確認

```bash
# API Gateway一覧
aws apigateway get-rest-apis \
  --query 'items[?contains(name, `search`)].{Name:name,Id:id}'

# API Gatewayデプロイ確認
aws apigateway get-deployments \
  --rest-api-id YOUR_API_ID
```

### CloudWatch Logsの確認

```bash
# ログストリーム確認
aws logs describe-log-streams \
  --log-group-name /aws/lambda/cis-search-api-prod

# 最新ログをリアルタイム表示
aws logs tail /aws/lambda/cis-search-api-prod --follow
```

### OpenSearch接続テスト

Lambda関数から実際にOpenSearchに接続できるかテスト：

```bash
# Lambda関数を手動実行
aws lambda invoke \
  --function-name cis-search-api-prod \
  --payload '{"httpMethod":"GET","path":"/search","queryStringParameters":{"q":"test","page":"1","limit":"10"}}' \
  output.json

# レスポンス確認
cat output.json | jq '.'
```

---

## 📈 次のステップ

### 短期（デプロイ直後）

1. ✅ Lambda関数が正常にデプロイされていることを確認
2. ✅ API Gatewayエンドポイントが正常に動作することを確認
3. ✅ フロントエンドとの統合テスト
4. ✅ CloudWatch Logsでエラーがないことを確認

### 中期（1週間以内）

1. ⚠️ パフォーマンスモニタリングの開始
2. ⚠️ CloudWatch Alarmsの調整
3. ⚠️ API Gatewayスロットリング設定の最適化
4. ⚠️ Lambda関数のメモリサイズ調整

### 長期（1ヶ月以内）

1. 🔄 Provisioned Concurrencyの検討（Cold Start削減）
2. 🔄 API Gatewayキャッシングの有効化
3. 🔄 CI/CDパイプラインの構築（GitHub Actions）
4. 🔄 本番環境の監視・アラート体制の確立

---

## 📞 サポート

### 問題が発生した場合

1. **CloudWatch Logsを確認**
   ```bash
   aws logs tail /aws/lambda/cis-search-api-prod --follow
   ```

2. **ドキュメントを参照**
   - `/Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/DEPLOYMENT_STEPS.md`
   - `/Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/PRODUCTION_DEPLOYMENT_GUIDE.md`

3. **Terraformの状態を確認**
   ```bash
   cd terraform
   terraform show
   ```

---

## 🎯 まとめ

### 現状
- ✅ Lambda Search APIの実装: **完了**
- ✅ Terraformインフラ定義: **完了**
- ✅ デプロイスクリプト: **完了**
- ❌ AWS環境へのデプロイ: **未実施**

### 必要な作業
1. AWS認証情報の確認・更新
2. VPC情報の取得
3. Lambda関数のビルド・パッケージング
4. Terraformによるインフラデプロイ
5. 動作確認
6. フロントエンド統合

### 所要時間見積もり
- AWS認証設定: 5分
- VPC情報取得: 2分
- ビルド・パッケージング: 3分
- Terraformデプロイ: 5分
- 動作確認: 5分
- **合計: 約20分**

---

**レポート作成日**: 2025-12-17
**次回更新**: デプロイ完了後
