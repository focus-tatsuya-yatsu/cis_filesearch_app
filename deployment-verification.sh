#!/bin/bash
# SQS無限ループ修正デプロイ検証スクリプト

set -e

QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/590183872752/CISFileSearchQueue"
DLQ_URL="https://sqs.ap-northeast-1.amazonaws.com/590183872752/CISFileSearchQueue-DLQ"

echo "=== デプロイ検証開始 ==="
echo "実行時刻: $(date)"

# 1. SQSメッセージ数確認
echo -e "\n[1] SQSメッセージ数チェック"
MAIN_COUNT=$(aws sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages \
  --query 'Attributes.ApproximateNumberOfMessages' \
  --output text)

DLQ_COUNT=$(aws sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names ApproximateNumberOfMessages \
  --query 'Attributes.ApproximateNumberOfMessages' \
  --output text)

echo "  メインキュー: $MAIN_COUNT メッセージ"
echo "  DLQ: $DLQ_COUNT メッセージ"

# 2. EC2インスタンス状態確認
echo -e "\n[2] EC2インスタンス確認"
aws ec2 describe-instances \
  --filters "Name=tag:aws:autoscaling:groupName,Values=cis-filesearch-worker-asg" \
            "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].[InstanceId,State.Name,LaunchTime]' \
  --output table

# 3. CloudWatch Logs確認（最新5分）
echo -e "\n[3] CloudWatch Logs確認（エラーチェック）"
aws logs filter-log-events \
  --log-group-name /aws/ec2/file-scanner-worker \
  --start-time $(date -u -d '5 minutes ago' +%s)000 \
  --filter-pattern "ERROR" \
  --query 'events[*].[timestamp,message]' \
  --output text | head -10

# 4. 成功基準チェック
echo -e "\n=== デプロイ成功基準判定 ==="

SUCCESS=true

if [ "$MAIN_COUNT" -gt 58000 ]; then
  echo "❌ SQSメッセージ数が減少していません（現在: $MAIN_COUNT）"
  SUCCESS=false
else
  echo "✅ SQSメッセージ数が減少中（現在: $MAIN_COUNT）"
fi

if [ "$DLQ_COUNT" -gt 100 ]; then
  echo "⚠️  DLQメッセージ数が多い（現在: $DLQ_COUNT）- 要監視"
else
  echo "✅ DLQ安定（現在: $DLQ_COUNT）"
fi

if [ "$SUCCESS" = true ]; then
  echo -e "\n🎉 デプロイ検証成功！24時間監視を開始してください"
  exit 0
else
  echo -e "\n🚨 デプロイ検証失敗 - ロールバックを検討してください"
  exit 1
fi
