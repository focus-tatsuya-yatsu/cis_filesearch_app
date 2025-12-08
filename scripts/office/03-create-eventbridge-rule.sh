#!/bin/bash
###############################################################################
# 03-create-eventbridge-rule.sh
# 目的: S3→SQS EventBridgeルールを作成
# 実行タイミング: 自社オフィス
###############################################################################

set -e

# 環境変数読み込み
source /tmp/cis-aws-env.sh

echo "=========================================="
echo "EventBridge Rule作成"
echo "Rule: $EVENTBRIDGE_RULE_NAME"
echo "=========================================="

# 作業ディレクトリ作成
WORK_DIR="/tmp/cis-eventbridge-setup"
mkdir -p $WORK_DIR
cd $WORK_DIR

# イベントパターン作成
echo "📝 イベントパターンを作成中..."
cat > s3-event-pattern.json <<EOF
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["$S3_LANDING_BUCKET"]
    },
    "object": {
      "key": [{
        "prefix": "files/"
      }]
    }
  }
}
EOF

echo "イベントパターン:"
cat s3-event-pattern.json | jq .

# Input Transformer作成
echo ""
echo "📝 Input Transformerを作成中..."
cat > input-transformer.json <<'EOF'
{
  "InputPathsMap": {
    "bucket": "$.detail.bucket.name",
    "key": "$.detail.object.key",
    "size": "$.detail.object.size",
    "etag": "$.detail.object.etag",
    "time": "$.time"
  },
  "InputTemplate": "{\"eventType\":\"S3_OBJECT_CREATED\",\"s3Bucket\":\"<bucket>\",\"s3Key\":\"<key>\",\"fileSize\":<size>,\"etag\":\"<etag>\",\"eventTime\":\"<time>\",\"processingRequired\":true}"
}
EOF

echo "Input Transformer:"
cat input-transformer.json | jq .

# EventBridgeルール作成
echo ""
echo "🔧 EventBridgeルールを作成中..."
aws events put-rule \
  --name $EVENTBRIDGE_RULE_NAME \
  --description "Route S3 file upload events to SQS for processing" \
  --event-pattern file://s3-event-pattern.json \
  --state ENABLED \
  --region $AWS_REGION

# ターゲット追加（SQS）
echo ""
echo "🔧 SQSターゲットを追加中..."
aws events put-targets \
  --rule $EVENTBRIDGE_RULE_NAME \
  --targets "[{
    \"Id\": \"1\",
    \"Arn\": \"$SQS_QUEUE_ARN\",
    \"InputTransformer\": $(cat input-transformer.json | jq -c .)
  }]" \
  --region $AWS_REGION

# SQS Policy更新
echo ""
echo "🔧 SQS Policyを更新中..."

# 既存のポリシー取得
EXISTING_POLICY=$(aws sqs get-queue-attributes \
  --queue-url $SQS_QUEUE_URL \
  --attribute-names Policy \
  --query 'Attributes.Policy' \
  --output text 2>/dev/null || echo "")

# 新しいStatementを追加
cat > sqs-policy-statement.json <<EOF
{
  "Sid": "AllowEventBridgeToSendMessages",
  "Effect": "Allow",
  "Principal": {
    "Service": "events.amazonaws.com"
  },
  "Action": "sqs:SendMessage",
  "Resource": "$SQS_QUEUE_ARN",
  "Condition": {
    "ArnEquals": {
      "aws:SourceArn": "arn:aws:events:$AWS_REGION:$AWS_ACCOUNT_ID:rule/$EVENTBRIDGE_RULE_NAME"
    }
  }
}
EOF

# 既存ポリシーに新しいStatementをマージ
if [ "$EXISTING_POLICY" != "None" ] && [ -n "$EXISTING_POLICY" ]; then
  echo "$EXISTING_POLICY" | jq --argjson newStatement "$(cat sqs-policy-statement.json)" \
    '.Statement += [$newStatement]' > merged-policy.json
else
  # ポリシーが存在しない場合は新規作成
  cat > merged-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    $(cat sqs-policy-statement.json)
  ]
}
EOF
fi

# ポリシー適用
aws sqs set-queue-attributes \
  --queue-url $SQS_QUEUE_URL \
  --attributes "Policy=$(cat merged-policy.json | jq -c .)"

echo ""
echo "✅ EventBridge Rule作成完了"
echo ""
echo "📋 設定確認:"
echo ""
echo "Rule:"
aws events describe-rule --name $EVENTBRIDGE_RULE_NAME --region $AWS_REGION | jq .
echo ""
echo "Targets:"
aws events list-targets-by-rule --rule $EVENTBRIDGE_RULE_NAME --region $AWS_REGION | jq .

echo ""
echo "=========================================="
echo "EventBridge Rule作成完了"
echo "=========================================="
