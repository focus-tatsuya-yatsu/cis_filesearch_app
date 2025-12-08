# 自社オフィスセットアップ - クイックスタート

**実行日**: 2025-12-01
**所要時間**: 約15分
**前提条件**: AWS CLI認証済み、jqインストール済み

---

## 🚀 今すぐ実行可能な一括セットアップ

### Step 1: 前提条件確認

```bash
# AWS CLI認証確認
aws sts get-caller-identity

# 期待される出力: AWSアカウントID、ユーザー情報

# jqインストール確認
which jq

# インストールされていない場合:
# macOS: brew install jq
# Linux: sudo apt-get install jq
```

### Step 2: スクリプトディレクトリに移動

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app
```

### Step 3: 一括セットアップ実行

```bash
bash scripts/office/00-run-all-office-setup.sh
```

このスクリプトは以下を自動実行します：

1. ✅ **環境変数設定** - AWS認証情報、S3バケット、SQS、DataSync Agent ARN
2. ✅ **S3 EventBridge有効化** - cis-filesearch-s3-landingバケット
3. ✅ **EventBridge Rule作成** - S3イベントをSQSにルーティング
4. ✅ **SQS Message Retention延長** - 4日→7日間
5. ✅ **CloudWatch Dashboard作成** - 監視ダッシュボード

---

## 📊 実行後の確認

### 検証スクリプト実行

```bash
cd backend/ec2-worker
python3 verify_aws_config.py
```

**期待される結果**:

```
✅ S3 EventBridge: Enabled
✅ EventBridge Rule: ENABLED (cis-s3-to-sqs-file-upload)
✅ SQS Message Retention: 7 days
✅ All checks passed!
```

---

## 🔍 各ステップの詳細確認

### 1. 環境変数確認

```bash
source /tmp/cis-aws-env.sh
echo "AWS Account: $AWS_ACCOUNT_ID"
echo "S3 Bucket: $S3_LANDING_BUCKET"
echo "SQS Queue: $SQS_QUEUE_NAME"
echo "DataSync Agent: $DATASYNC_AGENT_ARN"
```

### 2. S3 EventBridge確認

```bash
aws s3api get-bucket-notification-configuration \
  --bucket cis-filesearch-s3-landing \
  --region ap-northeast-1
```

**期待される出力**:
```json
{
    "EventBridgeConfiguration": {}
}
```

### 3. EventBridge Rule確認

```bash
aws events describe-rule \
  --name cis-s3-to-sqs-file-upload \
  --region ap-northeast-1
```

**確認ポイント**:
- State: `ENABLED`
- EventPattern: S3 Object Created events

```bash
# ターゲット確認（SQS）
aws events list-targets-by-rule \
  --rule cis-s3-to-sqs-file-upload \
  --region ap-northeast-1
```

### 4. SQS Message Retention確認

```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/<ACCOUNT_ID>/cis-filesearch-index-queue \
  --attribute-names MessageRetentionPeriod \
  --region ap-northeast-1
```

**期待される値**: `604800` (7日間)

### 5. CloudWatch Dashboard確認

ブラウザで以下にアクセス:
```
https://console.aws.amazon.com/cloudwatch/home?region=ap-northeast-1#dashboards:name=CIS-FileSearch-Monitoring
```

---

## 🧪 エンドツーエンドテスト

### テスト1: S3アップロード → EventBridge → SQS

```bash
# 環境変数読み込み
source /tmp/cis-aws-env.sh

# テストファイル作成
echo "Office Setup Test - $(date)" > office-test.txt

# S3にアップロード
aws s3 cp office-test.txt s3://$S3_LANDING_BUCKET/files/test/

# 5秒待機（イベント伝播）
sleep 5

# SQSメッセージ確認
aws sqs receive-message \
  --queue-url $SQS_QUEUE_URL \
  --max-number-of-messages 1 \
  --wait-time-seconds 10 \
  --region ap-northeast-1
```

**成功時の出力例**:
```json
{
  "Messages": [
    {
      "MessageId": "abc123...",
      "Body": "{\"eventType\":\"S3_OBJECT_CREATED\",\"s3Bucket\":\"cis-filesearch-s3-landing\",\"s3Key\":\"files/test/office-test.txt\",...}"
    }
  ]
}
```

### テスト2: メッセージ削除（後処理）

```bash
# テストメッセージを削除
aws sqs delete-message \
  --queue-url $SQS_QUEUE_URL \
  --receipt-handle "<ReceiptHandle from previous output>" \
  --region ap-northeast-1

# テストファイルも削除
aws s3 rm s3://$S3_LANDING_BUCKET/files/test/office-test.txt
```

---

## 📋 完了チェックリスト

自社オフィスで完了した作業:

- [ ] 環境変数設定完了（/tmp/cis-aws-env.sh）
- [ ] S3 EventBridge有効化
- [ ] EventBridge Rule作成（cis-s3-to-sqs-file-upload）
- [ ] SQS Message Retention 7日間に延長
- [ ] CloudWatch Dashboard作成
- [ ] 検証スクリプト全チェックパス
- [ ] エンドツーエンドテスト成功
- [ ] テストデータクリーンアップ完了

---

## 🏗️ クライアント先で実施する作業

### 準備事項

クライアント先で以下の情報を確認・取得してください：

1. **NAS接続情報**
   - [ ] NASのIPアドレスまたはホスト名
   - [ ] 共有フォルダパス
   - [ ] 認証用ユーザー名
   - [ ] パスワード
   - [ ] ドメイン名（Active Directory環境の場合）

2. **ネットワーク確認**
   - [ ] DataSync Agent VM (172.30.116.56) からNASへPing疎通確認
   - [ ] SMBポート（TCP 445）開放確認
   - [ ] ファイアウォール設定確認

### クライアント先実行スクリプト

```bash
# 1. NAS接続テスト（PowerShell - Windows Scanner PC）
pwsh scripts/client-site/01-test-nas-connection.ps1 `
  -NasServer "192.168.1.100" `
  -SharePath "shared-docs" `
  -Username "nas_user" `
  -Password (ConvertTo-SecureString "password" -AsPlainText -Force)

# 2. DataSync NAS Location作成（Bash）
bash scripts/client-site/02-create-datasync-nas-location.sh

# 3. DataSync Task作成
bash scripts/client-site/03-create-datasync-task.sh

# 4. 初回同期テスト
bash scripts/client-site/04-test-initial-sync.sh
```

---

## 🔧 個別スクリプト実行（トラブルシューティング用）

一括スクリプトがエラーになった場合、個別に実行できます：

```bash
# Step 1: 環境変数のみ
bash scripts/office/01-setup-env.sh
source /tmp/cis-aws-env.sh

# Step 2: S3 EventBridge有効化のみ
bash scripts/office/02-enable-s3-eventbridge.sh

# Step 3: EventBridge Ruleのみ
bash scripts/office/03-create-eventbridge-rule.sh

# Step 4: SQS Retentionのみ
bash scripts/office/04-extend-sqs-retention.sh

# Step 5: CloudWatch Dashboardのみ
bash scripts/office/05-create-cloudwatch-dashboard.sh
```

---

## ❌ トラブルシューティング

### 問題1: AWS CLI認証エラー

```bash
# エラー: Unable to locate credentials
aws sso login --profile default

# または
export AWS_PROFILE=your-profile
export AWS_REGION=ap-northeast-1
```

### 問題2: jqコマンドが見つからない

```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get update && sudo apt-get install -y jq

# Amazon Linux 2
sudo yum install -y jq
```

### 問題3: S3 EventBridge有効化失敗

```bash
# 権限確認
aws iam get-user

# 必要な権限
# - s3:PutBucketNotificationConfiguration
# - s3:GetBucketNotificationConfiguration

# IAMポリシーに権限追加
```

### 問題4: EventBridge Rule作成失敗

```bash
# 必要な権限
# - events:PutRule
# - events:PutTargets
# - sqs:SetQueueAttributes

# 既存ルールを削除して再作成
aws events remove-targets --rule cis-s3-to-sqs-file-upload --ids 1 --region ap-northeast-1
aws events delete-rule --name cis-s3-to-sqs-file-upload --region ap-northeast-1

# スクリプト再実行
bash scripts/office/03-create-eventbridge-rule.sh
```

### 問題5: SQSメッセージが届かない

```bash
# 診断チェックリスト
# 1. S3 EventBridge有効化確認
aws s3api get-bucket-notification-configuration --bucket cis-filesearch-s3-landing

# 2. EventBridge Rule状態確認
aws events describe-rule --name cis-s3-to-sqs-file-upload

# 3. EventBridge Targets確認
aws events list-targets-by-rule --rule cis-s3-to-sqs-file-upload

# 4. SQS Policy確認
aws sqs get-queue-attributes \
  --queue-url $SQS_QUEUE_URL \
  --attribute-names Policy

# 5. CloudWatch Logs確認（EventBridgeエラー）
aws logs tail /aws/events/cis-s3-to-sqs-file-upload --follow
```

---

## 📚 関連ドキュメント

- **詳細ガイド**: `/docs/deployment/PRE-CLIENT-SITE-PREPARATION.md`
- **DataSync設定**: `/docs/deployment/datasync/`
- **EventBridge設定**: `/docs/deployment/aws-eventbridge-s3-sqs-guide.md`
- **セキュリティ**: `/docs/security/aws-beginner-security-guide.md`

---

## 📞 サポート

問題が解決しない場合:

1. エラーメッセージ全文をコピー
2. 実行したコマンドをメモ
3. AWS Console → CloudWatch → Logs で詳細確認
4. チームメンバーに連絡

---

**Document Version**: 1.0
**Last Updated**: 2025-12-01
**Author**: CIS Development Team
