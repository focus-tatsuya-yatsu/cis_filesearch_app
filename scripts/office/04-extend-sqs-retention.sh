#!/bin/bash
###############################################################################
# 04-extend-sqs-retention.sh
# 目的: SQSメッセージ保持期間を7日間に延長
# 実行タイミング: 自社オフィス
###############################################################################

set -e

# 環境変数読み込み
source /tmp/cis-aws-env.sh

echo "=========================================="
echo "SQS Message Retention延長"
echo "Queue: $SQS_QUEUE_NAME"
echo "=========================================="

# 現在の設定確認
echo "📋 現在のMessage Retention Periodを確認中..."
CURRENT_RETENTION=$(aws sqs get-queue-attributes \
  --queue-url $SQS_QUEUE_URL \
  --attribute-names MessageRetentionPeriod \
  --query 'Attributes.MessageRetentionPeriod' \
  --output text)

CURRENT_DAYS=$((CURRENT_RETENTION / 86400))
echo "   現在: $CURRENT_RETENTION秒 ($CURRENT_DAYS日)"

# 7日間に延長
NEW_RETENTION=604800  # 7日間
NEW_DAYS=$((NEW_RETENTION / 86400))

echo ""
echo "🔧 Message Retention Periodを更新中..."
echo "   新しい値: $NEW_RETENTION秒 ($NEW_DAYS日)"

aws sqs set-queue-attributes \
  --queue-url $SQS_QUEUE_URL \
  --attributes MessageRetentionPeriod=$NEW_RETENTION

# 確認
echo ""
echo "✅ Message Retention延長完了"
echo ""
echo "📋 設定確認:"
UPDATED_RETENTION=$(aws sqs get-queue-attributes \
  --queue-url $SQS_QUEUE_URL \
  --attribute-names MessageRetentionPeriod \
  --query 'Attributes.MessageRetentionPeriod' \
  --output text)

UPDATED_DAYS=$((UPDATED_RETENTION / 86400))
echo "   更新後: $UPDATED_RETENTION秒 ($UPDATED_DAYS日)"

echo ""
echo "=========================================="
echo "SQS Message Retention延長完了"
echo "=========================================="
