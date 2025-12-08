#!/bin/bash

# EventBridge Setup Script for CIS File Search
# S3 → EventBridge → SQS の設定

set -e

REGION="ap-northeast-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET_NAME="cis-filesearch-s3-landing"
QUEUE_NAME="cis-filesearch-index-queue"
RULE_NAME="cis-s3-to-sqs-rule"

echo "============================================"
echo "EventBridge Configuration for CIS File Search"
echo "Account: $ACCOUNT_ID"
echo "Region: $REGION"
echo "============================================"
echo ""

# 1. S3バケットのEventBridge通知を有効化
echo "📦 Enabling EventBridge on S3 bucket..."
aws s3api put-bucket-notification-configuration \
    --bucket "$BUCKET_NAME" \
    --notification-configuration '{"EventBridgeConfiguration": {}}' \
    --region $REGION

echo "✅ EventBridge enabled on $BUCKET_NAME"
echo ""

# 2. SQSキューのARNを取得
echo "📨 Getting SQS Queue ARN..."
QUEUE_URL=$(aws sqs get-queue-url --queue-name "$QUEUE_NAME" --region $REGION --query 'QueueUrl' --output text)
QUEUE_ARN=$(aws sqs get-queue-attributes \
    --queue-url "$QUEUE_URL" \
    --attribute-names QueueArn \
    --region $REGION \
    --query 'Attributes.QueueArn' \
    --output text)

echo "Queue ARN: $QUEUE_ARN"
echo ""

# 3. EventBridgeルール作成
echo "🌉 Creating EventBridge rule..."
aws events put-rule \
    --name "$RULE_NAME" \
    --event-pattern "{
        \"source\": [\"aws.s3\"],
        \"detail-type\": [\"Object Created\"],
        \"detail\": {
            \"bucket\": {
                \"name\": [\"$BUCKET_NAME\"]
            }
        }
    }" \
    --state ENABLED \
    --region $REGION

echo "✅ Rule created: $RULE_NAME"

# 4. ルールのARN取得
RULE_ARN="arn:aws:events:$REGION:$ACCOUNT_ID:rule/$RULE_NAME"

# 5. SQSをターゲットとして追加
echo "🎯 Adding SQS as target..."
aws events put-targets \
    --rule "$RULE_NAME" \
    --targets "Id=1,Arn=$QUEUE_ARN" \
    --region $REGION

echo "✅ Target added"

# 6. SQSキューポリシーを更新（EventBridgeからのアクセス許可）
echo "🔐 Updating SQS queue policy..."
cat > /tmp/sqs-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "events.amazonaws.com"
      },
      "Action": "sqs:SendMessage",
      "Resource": "$QUEUE_ARN",
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "$RULE_ARN"
        }
      }
    }
  ]
}
EOF

aws sqs set-queue-attributes \
    --queue-url "$QUEUE_URL" \
    --attributes Policy="$(cat /tmp/sqs-policy.json | jq -c .)" \
    --region $REGION

rm /tmp/sqs-policy.json

echo "✅ Queue policy updated"
echo ""

# 7. メッセージ保持期間を7日に延長（オプション）
echo "⏰ Updating message retention period to 7 days..."
aws sqs set-queue-attributes \
    --queue-url "$QUEUE_URL" \
    --attributes MessageRetentionPeriod=604800 \
    --region $REGION

echo "✅ Message retention updated"
echo ""

echo "============================================"
echo "✅ EventBridge Configuration Complete!"
echo "============================================"
echo ""
echo "Configuration Summary:"
echo "  - S3 Bucket: $BUCKET_NAME (EventBridge enabled)"
echo "  - EventBridge Rule: $RULE_NAME"
echo "  - Target SQS: $QUEUE_NAME"
echo "  - Message Retention: 7 days"
echo ""
echo "Next step: Upload a test file to S3 to verify the pipeline"
echo "============================================"