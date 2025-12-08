#!/bin/bash
###############################################################################
# 02-enable-s3-eventbridge.sh
# 目的: S3バケットでEventBridge通知を有効化
# 実行タイミング: 自社オフィス
###############################################################################

set -e

# 環境変数読み込み
source /tmp/cis-aws-env.sh

echo "=========================================="
echo "S3 EventBridge有効化"
echo "Bucket: $S3_LANDING_BUCKET"
echo "=========================================="

# 現在の設定確認
echo "📋 現在の通知設定を確認中..."
CURRENT_CONFIG=$(aws s3api get-bucket-notification-configuration \
  --bucket $S3_LANDING_BUCKET \
  --region $AWS_REGION 2>/dev/null || echo "{}")

echo "現在の設定:"
echo "$CURRENT_CONFIG" | jq .

# EventBridge有効化
echo ""
echo "🔧 EventBridge通知を有効化中..."
aws s3api put-bucket-notification-configuration \
  --bucket $S3_LANDING_BUCKET \
  --region $AWS_REGION \
  --notification-configuration '{
    "EventBridgeConfiguration": {}
  }'

# 確認
echo ""
echo "✅ EventBridge有効化完了"
echo ""
echo "📋 設定確認:"
aws s3api get-bucket-notification-configuration \
  --bucket $S3_LANDING_BUCKET \
  --region $AWS_REGION | jq .

echo ""
echo "=========================================="
echo "S3 EventBridge有効化完了"
echo "=========================================="
