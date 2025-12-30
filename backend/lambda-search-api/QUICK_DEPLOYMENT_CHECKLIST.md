# Lambda Search API - クイックデプロイチェックリスト

**診断日時**: 2025-12-17 08:40:24

---

## 📋 現在のステータス

### ✅ 完了項目
- ✅ Node.js インストール済み (v22.20.0)
- ✅ npm インストール済み (10.9.3)
- ✅ AWS CLI インストール済み (2.31.18)
- ✅ Lambda関数のソースコード実装完了
- ✅ Terraform設定ファイル作成済み
- ✅ デプロイスクリプト作成済み

### ❌ 要対応項目
- ❌ **Terraformのインストール**
- ❌ **AWS認証情報の設定**
- ⚠️ 依存関係のインストール (npm install)
- ⚠️ Lambda関数のビルド
- ⚠️ VPC情報の取得
- ⚠️ Terraformによるデプロイ

---

## 🚀 デプロイ実行手順（5ステップ）

### Step 1: Terraformをインストール

**Mac（Homebrewを使用）:**
```bash
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
```

**または直接ダウンロード:**
```bash
# Intel Mac
curl -O https://releases.hashicorp.com/terraform/1.7.0/terraform_1.7.0_darwin_amd64.zip
unzip terraform_1.7.0_darwin_amd64.zip
sudo mv terraform /usr/local/bin/

# Apple Silicon Mac
curl -O https://releases.hashicorp.com/terraform/1.7.0/terraform_1.7.0_darwin_arm64.zip
unzip terraform_1.7.0_darwin_arm64.zip
sudo mv terraform /usr/local/bin/
```

**確認:**
```bash
terraform --version
# 出力例: Terraform v1.7.0
```

---

### Step 2: AWS認証情報を設定

```bash
aws configure
```

**入力が必要な情報:**
```
AWS Access Key ID [None]: AKIA... (あなたのAccess Key)
AWS Secret Access Key [None]: ****... (あなたのSecret Key)
Default region name [None]: ap-northeast-1
Default output format [None]: json
```

**確認:**
```bash
aws sts get-caller-identity
```

**期待される出力:**
```json
{
    "UserId": "AIDXXXXXXXXXXXXX",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/your-username"
}
```

---

### Step 3: 依存関係のインストールとビルド

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api

# 依存関係のインストール
npm install

# TypeScriptをビルド
npm run build

# Lambda デプロイパッケージを作成
npm run package
```

**確認:**
```bash
ls -lh lambda-deployment.zip
# 出力例: -rw-r--r--  1 user  staff   2.5M Dec 17 08:50 lambda-deployment.zip
```

---

### Step 4: VPC情報を自動取得

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/scripts
./get-vpc-info.sh
```

**このスクリプトが実行する内容:**
1. OpenSearchドメインを検索
2. VPC IDを取得
3. プライベートサブネットを検索
4. セキュリティグループを取得
5. `terraform/terraform.tfvars`ファイルを自動作成

**成功時の出力:**
```
✅ OpenSearch domain found: vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe
✅ VPC ID: vpc-xxxxxxxxx
✅ Private Subnets: subnet-aaaaaa, subnet-bbbbbb
✅ Security Group: sg-xxxxxxxxx
✅ terraform.tfvars created successfully
```

---

### Step 5: Terraformでデプロイ

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/terraform

# 初期化
terraform init

# デプロイ内容を確認
terraform plan

# デプロイ実行
terraform apply
```

**"yes"と入力してデプロイを実行**

**完了時の出力:**
```
Outputs:

api_gateway_url = "https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod/search"
lambda_function_arn = "arn:aws:lambda:ap-northeast-1:123456789012:function:cis-search-api-prod"
lambda_function_name = "cis-search-api-prod"
```

**このAPI Gateway URLを必ず保存してください！**

---

## 🧪 デプロイ後の動作確認

### テスト1: Lambda関数の確認

```bash
aws lambda get-function --function-name cis-search-api-prod
```

### テスト2: API動作テスト

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/scripts

# 基本的なAPIテスト
./test-api.sh https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod
```

### テスト3: CloudWatch Logsの確認

```bash
# リアルタイムログ表示
aws logs tail /aws/lambda/cis-search-api-prod --follow
```

### テスト4: フロントエンドからのテスト

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

# .env.localファイルを編集
echo "NEXT_PUBLIC_API_GATEWAY_URL=https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod" >> .env.local

# フロントエンド起動
yarn dev
```

ブラウザで http://localhost:3000 にアクセスして検索をテスト

---

## 🔧 トラブルシューティング

### 問題: Terraformでエラーが発生

**エラー例:**
```
Error: Missing required variable
```

**解決方法:**
```bash
# terraform.tfvarsの内容を確認
cat terraform/terraform.tfvars

# 不足している変数を手動で追加
vim terraform/terraform.tfvars
```

### 問題: Lambda関数がOpenSearchに接続できない

**診断:**
```bash
# CloudWatch Logsでエラー確認
aws logs tail /aws/lambda/cis-search-api-prod --follow
```

**よくあるエラー:**
- `OPENSEARCH_UNAVAILABLE`: セキュリティグループの設定ミス
- `Timeout`: サブネットまたはNATゲートウェイの問題
- `Access Denied`: IAMロールの権限不足

**解決方法:**
1. セキュリティグループの確認
```bash
# Lambda SG → OpenSearch SG への通信が許可されているか確認
aws ec2 describe-security-groups --group-ids <OPENSEARCH_SG_ID>
```

2. Lambda VPC設定の確認
```bash
aws lambda get-function-configuration --function-name cis-search-api-prod --query 'VpcConfig'
```

### 問題: ビルドエラー

**エラー例:**
```
npm ERR! Missing script: "build"
```

**解決方法:**
```bash
# package.jsonを確認
cat package.json

# node_modulesを削除して再インストール
rm -rf node_modules package-lock.json
npm install
npm run build
```

---

## 📊 デプロイされるAWSリソース

### Lambda関数
- **名前**: `cis-search-api-prod`
- **Runtime**: Node.js 20.x
- **Architecture**: ARM64 (Graviton2)
- **Memory**: 512MB
- **Timeout**: 30秒
- **VPC**: OpenSearchと同じVPC内
- **Concurrent Executions**: 10予約

### API Gateway
- **名前**: `cis-search-api-prod`
- **Type**: REST API
- **Stage**: `prod`
- **Endpoint**: Regional
- **Authentication**: Cognito (オプション)

### IAMロール
- **名前**: `cis-lambda-search-api-role-prod`
- **Permissions**:
  - OpenSearch: ESHttpGet, ESHttpPost, ESHttpHead
  - CloudWatch: Logs書き込み
  - VPC: ENI作成・削除

### セキュリティグループ
- **名前**: `cis-lambda-search-api-sg-prod`
- **Egress Rules**:
  - HTTPS (443) → OpenSearch
  - HTTP (80) → OpenSearch

### CloudWatch
- **Log Group**: `/aws/lambda/cis-search-api-prod`
- **Retention**: 14日間
- **Alarms**: エラー率、スロットル検知

---

## 💰 コスト見積もり

### 月間コスト（10,000検索/月）

| サービス | 詳細 | 月額（USD） |
|---------|------|-----------|
| Lambda実行 | 10K × 500ms × 512MB | $0.50 |
| Lambda Reserved Concurrency | 10同時実行 | $3.60 |
| API Gateway | 10K リクエスト | $0.04 |
| CloudWatch Logs | 2GB、14日保持 | $1.00 |
| **合計** | | **$5.14/月** |

---

## ✅ 最終チェックリスト

デプロイ前:
- [ ] Terraformインストール済み
- [ ] AWS認証情報設定済み
- [ ] npm installでエラーなし
- [ ] npm run buildでエラーなし
- [ ] lambda-deployment.zip作成済み
- [ ] terraform.tfvars作成済み

デプロイ後:
- [ ] Lambda関数がActive状態
- [ ] API Gatewayがデプロイ済み
- [ ] API Gateway URLを取得
- [ ] CloudWatch Logsでエラーなし
- [ ] API動作テスト成功
- [ ] フロントエンド統合成功

---

## 📞 サポート

### ドキュメント
- `DEPLOYMENT_STATUS_REPORT.md` - 詳細なステータスレポート
- `DEPLOYMENT_STEPS.md` - ステップバイステップガイド
- `PRODUCTION_DEPLOYMENT_GUIDE.md` - 本番環境デプロイ手順
- `VPC_OPENSEARCH_IMPLEMENTATION.md` - 技術実装詳細

### 診断ツール
```bash
# 現在のデプロイ状態を診断
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/scripts
./diagnose-deployment.sh
```

---

## 🎯 まとめ

**現在の状態:**
- Lambda Search APIの実装: ✅ 完了
- AWS環境へのデプロイ: ❌ 未実施

**必要な作業:**
1. Terraformインストール (5分)
2. AWS認証設定 (2分)
3. ビルド・パッケージング (3分)
4. VPC情報取得 (2分)
5. Terraformデプロイ (5分)

**合計所要時間: 約17分**

**次のコマンド:**
```bash
# Terraformインストール（Mac）
brew install hashicorp/tap/terraform

# AWS認証設定
aws configure

# その後、統合デプロイスクリプトを実行
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/scripts
./deploy-production.sh
```

---

**作成日**: 2025-12-17
**OpenSearchエンドポイント**: vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
