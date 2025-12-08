#!/bin/bash
###############################################################################
# 01-setup-env.sh
# 目的: AWS環境変数を設定
# 実行タイミング: 自社オフィス - 最初に実行
###############################################################################

set -e

echo "=========================================="
echo "環境変数設定"
echo "=========================================="

# AWS基本設定
export AWS_REGION="ap-northeast-1"
export AWS_DEFAULT_REGION="ap-northeast-1"

# AWSアカウントID取得
echo "📋 AWSアカウントIDを取得中..."
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "   Account ID: $AWS_ACCOUNT_ID"

# プロジェクト設定
export PROJECT_NAME="cis-filesearch"
export ENVIRONMENT="production"

# S3設定
export S3_LANDING_BUCKET="cis-filesearch-s3-landing"
export S3_THUMBNAIL_BUCKET="cis-filesearch-s3-thumbnail"

# SQS設定
export SQS_QUEUE_NAME="cis-filesearch-index-queue"
export SQS_QUEUE_URL=$(aws sqs get-queue-url --queue-name $SQS_QUEUE_NAME --query 'QueueUrl' --output text)
export SQS_QUEUE_ARN=$(aws sqs get-queue-attributes --queue-url $SQS_QUEUE_URL --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

# EventBridge設定
export EVENTBRIDGE_RULE_NAME="cis-s3-to-sqs-file-upload"

# DataSync設定
export DATASYNC_AGENT_ID="agent-05e538aed6b309353"
export DATASYNC_AGENT_ARN="arn:aws:datasync:ap-northeast-1:$AWS_ACCOUNT_ID:agent/$DATASYNC_AGENT_ID"

# 環境変数をファイルに保存
cat > /tmp/cis-aws-env.sh <<EOF
export AWS_REGION="$AWS_REGION"
export AWS_DEFAULT_REGION="$AWS_DEFAULT_REGION"
export AWS_ACCOUNT_ID="$AWS_ACCOUNT_ID"
export PROJECT_NAME="$PROJECT_NAME"
export ENVIRONMENT="$ENVIRONMENT"
export S3_LANDING_BUCKET="$S3_LANDING_BUCKET"
export S3_THUMBNAIL_BUCKET="$S3_THUMBNAIL_BUCKET"
export SQS_QUEUE_NAME="$SQS_QUEUE_NAME"
export SQS_QUEUE_URL="$SQS_QUEUE_URL"
export SQS_QUEUE_ARN="$SQS_QUEUE_ARN"
export EVENTBRIDGE_RULE_NAME="$EVENTBRIDGE_RULE_NAME"
export DATASYNC_AGENT_ID="$DATASYNC_AGENT_ID"
export DATASYNC_AGENT_ARN="$DATASYNC_AGENT_ARN"
EOF

echo ""
echo "✅ 環境変数設定完了"
echo "   設定ファイル: /tmp/cis-aws-env.sh"
echo ""
echo "次回セッションで使用する場合:"
echo "   source /tmp/cis-aws-env.sh"
echo ""
echo "=========================================="
