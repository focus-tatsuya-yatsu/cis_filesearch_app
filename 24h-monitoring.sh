#!/bin/bash
# 24時間監視スクリプト（1時間ごと実行推奨）

QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/590183872752/CISFileSearchQueue"
DLQ_URL="https://sqs.ap-northeast-1.amazonaws.com/590183872752/CISFileSearchQueue-DLQ"
LOG_FILE="/Users/tatsuya/focus_project/cis_filesearch_app/monitoring-$(date +%Y%m%d).log"

echo "=== 監視レポート ===" | tee -a "$LOG_FILE"
echo "実行時刻: $(date)" | tee -a "$LOG_FILE"

# SQSメッセージ数
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

echo "SQSメインキュー: $MAIN_COUNT" | tee -a "$LOG_FILE"
echo "DLQ: $DLQ_COUNT" | tee -a "$LOG_FILE"

# アラート判定
if [ "$DLQ_COUNT" -gt 50 ]; then
  echo "🚨 アラート: DLQメッセージ数異常（$DLQ_COUNT）" | tee -a "$LOG_FILE"
fi

if [ "$MAIN_COUNT" -gt 55000 ]; then
  echo "🚨 アラート: SQSメッセージ減少なし（$MAIN_COUNT）" | tee -a "$LOG_FILE"
fi

# EC2ヘルスチェック
INSTANCE_COUNT=$(aws ec2 describe-instances \
  --filters "Name=tag:aws:autoscaling:groupName,Values=cis-filesearch-worker-asg" \
            "Name=instance-state-name,Values=running" \
  --query 'length(Reservations[0].Instances)' \
  --output text)

echo "実行中EC2台数: $INSTANCE_COUNT" | tee -a "$LOG_FILE"

if [ "$INSTANCE_COUNT" -ne 1 ]; then
  echo "⚠️  警告: EC2台数が1台でない" | tee -a "$LOG_FILE"
fi

echo "---" | tee -a "$LOG_FILE"
