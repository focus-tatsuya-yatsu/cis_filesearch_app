# AMI使用のEC2 Auto Scaling - 実践ガイド

## 目次

1. [クイックスタート](#クイックスタート)
2. [AMI作成手順](#ami作成手順)
3. [デプロイ手順](#デプロイ手順)
4. [トラブルシューティング](#トラブルシューティング)
5. [運用ガイド](#運用ガイド)

---

## クイックスタート

### 前提条件

- AWS CLIインストール済み
- 適切なIAM権限
- VPC、サブネット設定済み
- S3バケット作成済み
- OpenSearchドメイン作成済み

### 5分で動かす

```bash
# 1. AMI作成用EC2起動
aws ec2 run-instances \
  --image-id ami-0d52744d6551d851e \
  --instance-type t3.large \
  --key-name your-key \
  --subnet-id subnet-xxx \
  --security-group-ids sg-xxx \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=ami-builder}]'

# 2. インスタンスにSSH
ssh -i your-key.pem ec2-user@<instance-ip>

# 3. コードデプロイ
git clone https://github.com/your-repo/cis-filesearch-app.git
cd cis-filesearch-app/backend/python-worker

# 4. AMIビルド
sudo bash scripts/build-ami.sh
sudo bash scripts/ami-cleanup.sh

# 5. AMI作成
aws ec2 create-image \
  --instance-id i-xxx \
  --name "python-worker-$(date +%Y%m%d-%H%M%S)" \
  --no-reboot

# 6. Terraform適用
cd terraform
terraform init
terraform plan -var="ami_id=ami-newami123"
terraform apply -var="ami_id=ami-newami123"
```

---

## AMI作成手順

### Step 1: ビルダーインスタンスの起動

```bash
# Amazon Linux 2023ベースで起動
aws ec2 run-instances \
  --image-id ami-0d52744d6551d851e \
  --instance-type t3.large \
  --key-name your-key-pair \
  --subnet-id subnet-xxxxxxxxx \
  --security-group-ids sg-xxxxxxxxx \
  --iam-instance-profile Name=FileProcessorBuilderRole \
  --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=30,VolumeType=gp3}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=python-worker-ami-builder}]'
```

### Step 2: コードのデプロイ

```bash
# ビルダーインスタンスにSSH
ssh -i your-key.pem ec2-user@<instance-ip>

# アプリケーションコードをコピー
# Option 1: Git clone
git clone https://github.com/your-org/cis-filesearch-app.git
cd cis-filesearch-app/backend/python-worker

# Option 2: SCP
# ローカルから: scp -r . ec2-user@<instance-ip>:/home/ec2-user/python-worker/
```

### Step 3: AMIビルドスクリプト実行

```bash
cd /home/ec2-user/python-worker

# ビルドスクリプト実行 (10-15分程度)
sudo bash scripts/build-ami.sh

# 出力例:
# [1/10] Updating OS packages...
# [2/10] Installing system dependencies...
# [3/10] Installing Tesseract OCR...
# ...
# [10/10] Configuring CloudWatch Agent...
# ✅ AMI Build Preparation Complete!
```

**重要な確認ポイント**:
- すべてのステップが成功していること
- Tesseractが正しくインストールされていること
- Python依存関係がすべてインストールされていること

```bash
# 確認コマンド
tesseract --version
tesseract --list-langs | grep -E "(jpn|eng)"
pip3.11 list | grep -E "(boto3|pytesseract|Pillow|opensearch)"
python3.11 /app/worker.py --validate-only
```

### Step 4: クリーンアップ実行

```bash
# クリーンアップスクリプト実行
sudo bash scripts/ami-cleanup.sh

# 環境変数の削除確認
env | grep -E "(SQS|OPENSEARCH|AWS_ACCESS)" || echo "✅ No sensitive vars"
```

**警告**: 環境変数にSQS_QUEUE_URLやAWS_ACCESS_KEY_IDが残っている場合は削除してください:
```bash
unset SQS_QUEUE_URL
unset OPENSEARCH_ENDPOINT
unset AWS_ACCESS_KEY_ID
unset AWS_SECRET_ACCESS_KEY
```

### Step 5: AMI作成

```bash
# ビルダーインスタンスのIDを取得
INSTANCE_ID=$(ec2-metadata --instance-id | cut -d " " -f 2)

# AMI作成 (5-10分程度)
AMI_ID=$(aws ec2 create-image \
  --instance-id $INSTANCE_ID \
  --name "python-worker-v$(date +%Y%m%d-%H%M%S)" \
  --description "Python Worker for File Processing - Production Ready" \
  --no-reboot \
  --tag-specifications 'ResourceType=image,Tags=[{Key=Environment,Value=production},{Key=Application,Value=file-processor}]' \
  --query 'ImageId' \
  --output text)

echo "Created AMI: $AMI_ID"

# AMI作成完了待機
aws ec2 wait image-available --image-ids $AMI_ID
echo "✅ AMI is ready!"
```

### Step 6: ビルダーインスタンスの終了

```bash
# ローカル端末から
aws ec2 terminate-instances --instance-ids i-xxx
```

---

## デプロイ手順

### Terraform使用 (推奨)

#### 初回デプロイ

```bash
cd terraform

# 1. terraform.tfvarsファイルの作成
cp terraform.tfvars.example terraform.tfvars

# 2. 変数を編集
vim terraform.tfvars
# ami_id = "ami-xxxxxxxxxxxxxxxxx" に先ほど作成したAMI IDを設定

# 3. Terraform初期化
terraform init

# 4. プラン確認
terraform plan

# 5. 適用
terraform apply
```

#### AMI更新デプロイ

```bash
# Method 1: deploy-new-ami.sh スクリプト使用 (推奨)
export LAUNCH_TEMPLATE_NAME="python-worker-template-v1"
export ASG_NAME="cis-filesearch-worker-asg"

bash ../scripts/deploy-new-ami.sh ami-newami123456

# Method 2: Terraform変数更新
terraform apply -var="ami_id=ami-newami123456"
```

### AWS CLI使用 (手動)

```bash
# 1. Launch Templateバージョン作成
aws ec2 create-launch-template-version \
  --launch-template-name python-worker-template-v1 \
  --source-version '$Latest' \
  --launch-template-data '{"ImageId":"ami-newami123456"}'

# 2. デフォルトバージョン更新
LATEST_VERSION=$(aws ec2 describe-launch-templates \
  --launch-template-names python-worker-template-v1 \
  --query 'LaunchTemplates[0].LatestVersionNumber' \
  --output text)

aws ec2 modify-launch-template \
  --launch-template-name python-worker-template-v1 \
  --default-version $LATEST_VERSION

# 3. インスタンスリフレッシュ開始
aws autoscaling start-instance-refresh \
  --auto-scaling-group-name cis-filesearch-worker-asg \
  --preferences '{
    "MinHealthyPercentage": 90,
    "InstanceWarmup": 300
  }'
```

---

## トラブルシューティング

### 問題1: Worker が起動しない

#### 診断

```bash
# インスタンスにSSH接続
ssh -i your-key.pem ec2-user@<instance-ip>

# 診断スクリプト実行
sudo bash /app/scripts/debug-worker.sh

# または個別に確認
sudo systemctl status file-processor-worker.service
sudo journalctl -u file-processor-worker.service -n 100
```

#### よくある原因と対策

**1. 環境変数が未設定**

```bash
# 確認
cat /etc/file-processor/env

# 修正
sudo vim /etc/file-processor/env
# 必要な変数を追加

# サービス再起動
sudo systemctl restart file-processor-worker.service
```

**2. IAMロール権限不足**

```bash
# 権限確認
aws sts get-caller-identity

# SQS接続テスト
aws sqs get-queue-attributes \
  --queue-url $SQS_QUEUE_URL \
  --attribute-names All

# 失敗する場合はIAMロールに権限追加
```

**3. User Data実行失敗**

```bash
# User Dataログ確認
sudo cat /var/log/user-data.log

# 再実行
sudo bash -x /var/lib/cloud/instance/scripts/part-001
```

### 問題2: メッセージがDLQに蓄積

#### 診断

```bash
# DLQメッセージサンプル取得
aws sqs receive-message \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/xxx/dlq \
  --max-number-of-messages 10 \
  --output json > dlq-messages.json

# エラーパターン分析
cat dlq-messages.json | jq -r '.Messages[].Body' | jq .

# CloudWatch Logsでエラー検索
aws logs filter-log-events \
  --log-group-name /aws/ec2/file-processor \
  --filter-pattern "ERROR" \
  --start-time $(($(date +%s) * 1000 - 3600000))
```

#### 対策

詳細は [SQS-DLQ-IMPACT-ANALYSIS.md](./SQS-DLQ-IMPACT-ANALYSIS.md) を参照してください。

### 問題3: スケーリングが動作しない

#### 診断

```bash
# Auto Scaling Activity確認
aws autoscaling describe-scaling-activities \
  --auto-scaling-group-name cis-filesearch-worker-asg \
  --max-records 10

# CloudWatch Metrics確認
aws cloudwatch get-metric-statistics \
  --namespace AWS/SQS \
  --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions Name=QueueName,Value=file-processing-queue \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average
```

#### 対策

1. **Target Tracking Policy確認**
   ```bash
   aws autoscaling describe-policies \
     --auto-scaling-group-name cis-filesearch-worker-asg
   ```

2. **Cooldown期間の調整**
   - スケールアウト: 60秒
   - スケールイン: 300秒

3. **メトリクスの確認**
   - SQSメッセージ数が正しく収集されているか

---

## 運用ガイド

### 日常運用タスク

#### 1. ヘルスチェック (毎日)

```bash
# Auto Scaling Group状態確認
aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names cis-filesearch-worker-asg \
  --query 'AutoScalingGroups[0].{Desired:DesiredCapacity,Running:length(Instances),Healthy:length(Instances[?HealthStatus==`Healthy`])}'

# SQSキュー状態確認
aws sqs get-queue-attributes \
  --queue-url $SQS_QUEUE_URL \
  --attribute-names ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible

# DLQメッセージ数確認
aws sqs get-queue-attributes \
  --queue-url $DLQ_URL \
  --attribute-names ApproximateNumberOfMessages
```

#### 2. ログ監視

```bash
# エラーログ確認
aws logs filter-log-events \
  --log-group-name /aws/ec2/file-processor \
  --filter-pattern "ERROR" \
  --start-time $(($(date +%s) * 1000 - 3600000)) \
  | jq -r '.events[].message' \
  | head -20

# リアルタイムログ監視
aws logs tail /aws/ec2/file-processor --follow
```

#### 3. パフォーマンスメトリクス

```bash
# CloudWatchダッシュボード確認
# https://console.aws.amazon.com/cloudwatch/home?region=ap-northeast-1#dashboards:

# 重要メトリクス:
# - SQS: ApproximateNumberOfMessagesVisible
# - SQS: ApproximateAgeOfOldestMessage
# - ASG: GroupInServiceInstances
# - EC2: CPUUtilization
# - EC2: MemoryUtilization (CloudWatch Agent)
```

### 週次タスク

#### 1. AMI更新確認

```bash
# 使用中のAMI確認
aws autoscaling describe-launch-configurations \
  --query 'LaunchConfigurations[*].{Name:LaunchConfigurationName,AMI:ImageId}'

# AMI作成日確認
aws ec2 describe-images \
  --image-ids ami-xxx \
  --query 'Images[*].{ID:ImageId,Name:Name,Created:CreationDate}'

# 1ヶ月以上古い場合は更新を検討
```

#### 2. コスト分析

```bash
# EC2コスト確認
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-31 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --filter file://cost-filter.json

# cost-filter.json
{
  "Tags": {
    "Key": "Application",
    "Values": ["file-processor"]
  }
}
```

### 月次タスク

#### 1. セキュリティパッチ適用

```bash
# 新しいBase AMI確認
aws ec2 describe-images \
  --owners amazon \
  --filters "Name=name,Values=al2023-ami-*" \
  --query 'sort_by(Images, &CreationDate)[-1].{ID:ImageId,Name:Name,Date:CreationDate}'

# AMI再ビルドとデプロイ
```

#### 2. 容量計画

```bash
# ピーク時のインスタンス数確認
aws cloudwatch get-metric-statistics \
  --namespace AWS/AutoScaling \
  --metric-name GroupInServiceInstances \
  --dimensions Name=AutoScalingGroupName,Value=cis-filesearch-worker-asg \
  --start-time $(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 86400 \
  --statistics Maximum

# max_sizeの調整検討
```

### 緊急対応

#### DLQ急増時の対応

```bash
# 1. 新規メッセージ停止 (一時的)
# SQS送信を停止するか、ファイルスキャンを一時停止

# 2. 原因特定
bash scripts/debug-worker.sh > emergency-report.txt

# 3. DLQメッセージのリプレイ (原因修正後)
# DLQから元のキューに戻す
aws sqs receive-message \
  --queue-url $DLQ_URL \
  --max-number-of-messages 10 \
  | jq -r '.Messages[] | @json' \
  | while read msg; do
      aws sqs send-message \
        --queue-url $SQS_QUEUE_URL \
        --message-body "$(echo $msg | jq -r '.Body')"

      aws sqs delete-message \
        --queue-url $DLQ_URL \
        --receipt-handle "$(echo $msg | jq -r '.ReceiptHandle')"
    done
```

#### スケールアウト失敗時の対応

```bash
# 1. 手動でインスタンス追加
aws autoscaling set-desired-capacity \
  --auto-scaling-group-name cis-filesearch-worker-asg \
  --desired-capacity 5

# 2. 失敗原因確認
aws autoscaling describe-scaling-activities \
  --auto-scaling-group-name cis-filesearch-worker-asg \
  --max-records 10 \
  | jq -r '.Activities[] | select(.StatusCode!="Successful")'

# 3. サービス制限確認
aws service-quotas get-service-quota \
  --service-code ec2 \
  --quota-code L-1216C47A  # Running On-Demand instances
```

---

## ベストプラクティス

### 1. AMI管理

- **命名規則**: `python-worker-v{YYYYMMDD-HHMMSS}`
- **タグ付け**: Environment, Application, GitCommit
- **保持期間**: 最新5世代を保持、古いAMIは削除
- **テスト**: 本番適用前に検証環境でテスト

### 2. デプロイ

- **ローリングアップデート**: MinHealthyPercentage=90%
- **デプロイ時間帯**: 低負荷時間帯 (20:00-8:00)
- **ロールバック計画**: 旧AMI IDを記録
- **スモークテスト**: デプロイ後にテストメッセージ送信

### 3. モニタリング

- **CloudWatchダッシュボード**: 主要メトリクスを可視化
- **アラート設定**: DLQ蓄積、エラー率上昇
- **ログ保持**: 30日間
- **週次レビュー**: パフォーマンストレンド分析

### 4. セキュリティ

- **IAMロール**: 最小権限の原則
- **セキュリティグループ**: アウトバウンドのみ許可
- **暗号化**: EBS, SQS, S3すべて暗号化
- **パッチ適用**: 月次でBase AMI更新

---

## リファレンス

- [AMI-BEST-PRACTICES.md](./AMI-BEST-PRACTICES.md) - AMI構成詳細
- [SQS-DLQ-IMPACT-ANALYSIS.md](./SQS-DLQ-IMPACT-ANALYSIS.md) - DLQ問題分析
- [Terraform ドキュメント](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [AWS Auto Scaling ドキュメント](https://docs.aws.amazon.com/autoscaling/)

---

## サポート

問題が発生した場合:

1. `scripts/debug-worker.sh` を実行
2. CloudWatch Logsを確認
3. [SQS-DLQ-IMPACT-ANALYSIS.md](./SQS-DLQ-IMPACT-ANALYSIS.md) を参照
4. チームに報告

緊急時: [運用ガイド - 緊急対応](#緊急対応) を参照
