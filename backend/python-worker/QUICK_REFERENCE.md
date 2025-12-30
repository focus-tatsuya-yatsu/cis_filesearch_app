# SQS/DLQ異常増加 - クイックリファレンス

**最終更新**: 2025-12-12
**対象**: 本番環境緊急対応

---

## ⚡ 最速対応フロー (5分以内)

```bash
# 1. ディレクトリ移動
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker/scripts

# 2. 診断実行 (1分)
./emergency_diagnosis.sh > diagnosis_$(date +%Y%m%d_%H%M%S).txt 2>&1

# 3. 診断レポート確認
tail -100 diagnosis_*.txt

# 4. 緊急停止 (2分)
./emergency_stop.sh
# → 'YES' と入力

# 5. 停止確認
aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name file-processing-queue-production --output text) \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-northeast-1
```

---

## 🔍 診断コマンド集

### SQS メッセージ数確認

```bash
# メインキュー
aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name file-processing-queue-production --output text) \
  --attribute-names ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible \
  --region ap-northeast-1 \
  --output json | jq -r '.Attributes | "可視: \(.ApproximateNumberOfMessages), 処理中: \(.ApproximateNumberOfMessagesNotVisible)"'

# DLQ
aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name file-processing-dlq-production --output text) \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-northeast-1 \
  --output json | jq -r '.Attributes.ApproximateNumberOfMessages'
```

### S3 Event Notification 確認

```bash
aws s3api get-bucket-notification-configuration \
  --bucket cis-filesearch-storage-production \
  --region ap-northeast-1 | jq '.QueueConfigurations | length'
# → 1 であるべき (2以上なら問題)
```

### EventBridge Rules 確認

```bash
aws events list-rules --region ap-northeast-1 \
  --output json | jq -r '.Rules[] | select(.Name | contains("file")) | "\(.Name): \(.State)"'
```

### CloudWatch Logs エラー確認

```bash
aws logs filter-log-events \
  --log-group-name /aws/ec2/file-processor \
  --start-time $(($(date +%s) - 3600))000 \
  --filter-pattern "?ERROR ?FAILED ?Exception" \
  --region ap-northeast-1 \
  --max-items 10 | jq -r '.events[].message'
```

---

## 🛠️ 修正コマンド集

### S3 Event Notification 修正

```bash
# 1. 現在の設定をバックアップ
aws s3api get-bucket-notification-configuration \
  --bucket cis-filesearch-storage-production \
  --region ap-northeast-1 > s3_backup.json

# 2. 修正版を作成 (s3_corrected.json)
cat > s3_corrected.json << 'EOF'
{
  "QueueConfigurations": [
    {
      "Id": "FileProcessingQueue",
      "QueueArn": "arn:aws:sqs:ap-northeast-1:YOUR_ACCOUNT_ID:file-processing-queue-production",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            {"Name": "prefix", "Value": "raw-files/"}
          ]
        }
      }
    }
  ]
}
EOF

# 3. YOUR_ACCOUNT_ID を置換
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
sed -i "s/YOUR_ACCOUNT_ID/${ACCOUNT_ID}/g" s3_corrected.json

# 4. 適用
aws s3api put-bucket-notification-configuration \
  --bucket cis-filesearch-storage-production \
  --notification-configuration file://s3_corrected.json \
  --region ap-northeast-1
```

### Visibility Timeout 変更

```bash
# 900秒 (15分) に変更
QUEUE_URL=$(aws sqs get-queue-url --queue-name file-processing-queue-production --output text)
aws sqs set-queue-attributes \
  --queue-url "${QUEUE_URL}" \
  --attributes VisibilityTimeout=900 \
  --region ap-northeast-1
```

### worker.py 置き換え

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker
cp worker.py worker_original_$(date +%Y%m%d).py
cp worker_fixed.py worker.py
```

---

## 📊 監視コマンド集

### SQS メッセージ数リアルタイム監視

```bash
watch -n 30 'aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name file-processing-queue-production --output text) \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-northeast-1 \
  --output json | jq -r ".Attributes.ApproximateNumberOfMessages"'
```

### CloudWatch Logs リアルタイム監視

```bash
aws logs tail /aws/ec2/file-processor --follow --region ap-northeast-1
```

### EC2 Auto Scaling Group 状態監視

```bash
watch -n 60 'aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names file-processor-asg-production \
  --region ap-northeast-1 \
  --query "AutoScalingGroups[0].[DesiredCapacity,Instances[].InstanceId]"'
```

---

## 🚨 根本原因チェックリスト

### 原因1: S3 Event Notification 重複 (90%)

```bash
# チェック
aws s3api get-bucket-notification-configuration \
  --bucket cis-filesearch-storage-production \
  --region ap-northeast-1 | jq '.QueueConfigurations | length'

# 期待値: 1
# 実際が2以上 → 🔴 これが原因
```

### 原因2: python-worker メッセージ削除失敗 (70%)

```bash
# CloudWatch Logs でエラー確認
aws logs filter-log-events \
  --log-group-name /aws/ec2/file-processor \
  --start-time $(($(date +%s) - 3600))000 \
  --filter-pattern "Failed to delete message" \
  --region ap-northeast-1

# エラーが多数 → 🔴 これが原因
```

### 原因3: Visibility Timeout 短すぎ (60%)

```bash
# チェック
aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name file-processing-queue-production --output text) \
  --attribute-names VisibilityTimeout \
  --region ap-northeast-1 | jq -r '.Attributes.VisibilityTimeout'

# 期待値: 900
# 実際が300以下 → 🟡 これが原因の可能性
```

---

## 🔄 復旧後の検証

### 1時間後の確認

```bash
# SQS メッセージが減少しているか
QUEUE_URL=$(aws sqs get-queue-url --queue-name file-processing-queue-production --output text)
aws sqs get-queue-attributes \
  --queue-url "${QUEUE_URL}" \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-northeast-1

# DLQ にメッセージが増えていないか
DLQ_URL=$(aws sqs get-queue-url --queue-name file-processing-dlq-production --output text)
aws sqs get-queue-attributes \
  --queue-url "${DLQ_URL}" \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-northeast-1

# OpenSearch にインデックスされているか
curl -X GET "https://YOUR_OPENSEARCH_ENDPOINT/file-index/_count" \
  -u admin:password
```

### 成功基準

- [ ] SQS メッセージ数が減少している
- [ ] DLQ メッセージ数が増えていない (±5件以内)
- [ ] CloudWatch Logs にエラーがない
- [ ] OpenSearch インデックス数が増加している

---

## 📋 環境変数チートシート

### 必須環境変数

```bash
export AWS_REGION=ap-northeast-1
export SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/ACCOUNT_ID/file-processing-queue-production
export DLQ_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/ACCOUNT_ID/file-processing-dlq-production
export S3_BUCKET=cis-filesearch-storage-production
export OPENSEARCH_ENDPOINT=https://search-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com
export SQS_VISIBILITY_TIMEOUT=900
```

### CloudFormation パラメータ

```bash
# sqs-with-dlq.yaml
VisibilityTimeout=900  # デフォルト値

# ec2-autoscaling.yaml
QueueURL=${SQS_QUEUE_URL}
DLQueueURL=${DLQ_QUEUE_URL}
```

---

## 🆘 緊急連絡先

### AWS Support
- **電話**: [AWS Support Console で確認]
- **チケット**: https://console.aws.amazon.com/support/

### エスカレーション基準
- SQS メッセージ数が10,000を超える
- DLQ メッセージ数が1,000を超える
- 2時間以上停止が必要
- データ損失の可能性がある

---

## 📚 詳細ドキュメント

- **詳細診断**: [EMERGENCY_DIAGNOSIS_REPORT.md](./EMERGENCY_DIAGNOSIS_REPORT.md)
- **完全マニュアル**: [EMERGENCY_RESPONSE_README.md](./EMERGENCY_RESPONSE_README.md)
- **設定変更**: [CONFIG_ADDITIONS.md](./CONFIG_ADDITIONS.md)

---

**最終更新**: 2025-12-12
**バージョン**: 1.0
