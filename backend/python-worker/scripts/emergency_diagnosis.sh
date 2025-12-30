#!/bin/bash

###############################################################################
# 緊急診断スクリプト - SQS/DLQ異常増加の原因特定
# CIS File Search Application
#
# 使用方法:
#   chmod +x emergency_diagnosis.sh
#   ./emergency_diagnosis.sh > diagnosis_report_$(date +%Y%m%d_%H%M%S).txt 2>&1
###############################################################################

set -e

# カラー出力
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 設定 (環境変数から取得、デフォルト値あり)
AWS_REGION="${AWS_REGION:-ap-northeast-1}"
SQS_QUEUE_NAME="${SQS_QUEUE_NAME:-file-processing-queue-production}"
DLQ_QUEUE_NAME="${DLQ_QUEUE_NAME:-file-processing-dlq-production}"
S3_BUCKET_NAME="${S3_BUCKET_NAME:-cis-filesearch-storage-production}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  SQS/DLQ 緊急診断レポート${NC}"
echo -e "${BLUE}  実行時刻: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# AWS CLI がインストールされているか確認
if ! command -v aws &> /dev/null; then
    echo -e "${RED}ERROR: AWS CLI がインストールされていません${NC}"
    exit 1
fi

echo -e "${GREEN}AWS CLI バージョン: $(aws --version)${NC}"
echo -e "${GREEN}リージョン: ${AWS_REGION}${NC}"
echo ""

###############################################################################
# 1. SQS キュー属性の確認
###############################################################################
echo -e "${YELLOW}[1] SQS メインキュー属性の確認${NC}"
echo "==========================================="

# キューURLを取得
QUEUE_URL=$(aws sqs get-queue-url --queue-name "${SQS_QUEUE_NAME}" --region "${AWS_REGION}" --output text 2>/dev/null || echo "")

if [ -z "$QUEUE_URL" ]; then
    echo -e "${RED}ERROR: キューが見つかりません: ${SQS_QUEUE_NAME}${NC}"
else
    echo "Queue URL: ${QUEUE_URL}"
    echo ""

    # キュー属性を取得
    aws sqs get-queue-attributes \
        --queue-url "${QUEUE_URL}" \
        --attribute-names All \
        --region "${AWS_REGION}" \
        --output json | jq -r '
        .Attributes |
        "キュー名: " + (.QueueArn | split(":") | last) + "\n" +
        "可視メッセージ数: " + .ApproximateNumberOfMessages + "\n" +
        "処理中メッセージ数: " + .ApproximateNumberOfMessagesNotVisible + "\n" +
        "遅延メッセージ数: " + .ApproximateNumberOfMessagesDelayed + "\n" +
        "VisibilityTimeout: " + .VisibilityTimeout + "秒\n" +
        "MessageRetentionPeriod: " + .MessageRetentionPeriod + "秒\n" +
        "MaximumMessageSize: " + .MaximumMessageSize + "バイト\n" +
        "ReceiveMessageWaitTimeSeconds: " + .ReceiveMessageWaitTimeSeconds + "秒\n" +
        "CreatedTimestamp: " + (.CreatedTimestamp | tonumber | strftime("%Y-%m-%d %H:%M:%S")) + "\n" +
        "LastModifiedTimestamp: " + (.LastModifiedTimestamp | tonumber | strftime("%Y-%m-%d %H:%M:%S"))'
fi
echo ""

###############################################################################
# 2. DLQ (Dead Letter Queue) の確認
###############################################################################
echo -e "${YELLOW}[2] DLQ (Dead Letter Queue) 属性の確認${NC}"
echo "==========================================="

DLQ_URL=$(aws sqs get-queue-url --queue-name "${DLQ_QUEUE_NAME}" --region "${AWS_REGION}" --output text 2>/dev/null || echo "")

if [ -z "$DLQ_URL" ]; then
    echo -e "${RED}ERROR: DLQが見つかりません: ${DLQ_QUEUE_NAME}${NC}"
else
    echo "DLQ URL: ${DLQ_URL}"
    echo ""

    aws sqs get-queue-attributes \
        --queue-url "${DLQ_URL}" \
        --attribute-names All \
        --region "${AWS_REGION}" \
        --output json | jq -r '
        .Attributes |
        "DLQメッセージ数: " + .ApproximateNumberOfMessages + "\n" +
        "処理中メッセージ数: " + .ApproximateNumberOfMessagesNotVisible + "\n" +
        "CreatedTimestamp: " + (.CreatedTimestamp | tonumber | strftime("%Y-%m-%d %H:%M:%S"))'

    # DLQメッセージ数が多い場合は警告
    DLQ_MSG_COUNT=$(aws sqs get-queue-attributes \
        --queue-url "${DLQ_URL}" \
        --attribute-names ApproximateNumberOfMessages \
        --region "${AWS_REGION}" \
        --output text --query 'Attributes.ApproximateNumberOfMessages')

    if [ "$DLQ_MSG_COUNT" -gt 10 ]; then
        echo -e "${RED}⚠️  警告: DLQに ${DLQ_MSG_COUNT} 件のメッセージがあります${NC}"
    fi
fi
echo ""

###############################################################################
# 3. DLQメッセージのサンプル取得 (先頭5件)
###############################################################################
echo -e "${YELLOW}[3] DLQ メッセージサンプル (先頭5件)${NC}"
echo "==========================================="

if [ -n "$DLQ_URL" ]; then
    for i in {1..5}; do
        MESSAGE=$(aws sqs receive-message \
            --queue-url "${DLQ_URL}" \
            --max-number-of-messages 1 \
            --region "${AWS_REGION}" \
            --output json 2>/dev/null)

        if [ -z "$MESSAGE" ] || [ "$MESSAGE" = "{}" ]; then
            echo "メッセージなし (${i}件目)"
            break
        fi

        echo "--- メッセージ ${i} ---"
        echo "$MESSAGE" | jq -r '.Messages[0] |
            "MessageId: " + .MessageId + "\n" +
            "ReceiptHandle: " + .ReceiptHandle[:50] + "...\n" +
            "Body: " + .Body'
        echo ""
    done
else
    echo "DLQ URLが取得できないためスキップ"
fi
echo ""

###############################################################################
# 4. EventBridge Rules の確認
###############################################################################
echo -e "${YELLOW}[4] EventBridge Rules の確認${NC}"
echo "==========================================="

aws events list-rules \
    --region "${AWS_REGION}" \
    --output json | jq -r '
    .Rules[] |
    select(.Name | contains("file") or contains("sync") or contains("s3")) |
    "Name: " + .Name + "\n" +
    "State: " + .State + "\n" +
    "ScheduleExpression: " + (.ScheduleExpression // "N/A") + "\n" +
    "EventPattern: " + (.EventPattern // "N/A") + "\n" +
    "---"'

echo ""

###############################################################################
# 5. S3 Event Notification 設定の確認
###############################################################################
echo -e "${YELLOW}[5] S3 Event Notification 設定の確認${NC}"
echo "==========================================="

S3_NOTIFICATION=$(aws s3api get-bucket-notification-configuration \
    --bucket "${S3_BUCKET_NAME}" \
    --region "${AWS_REGION}" \
    --output json 2>/dev/null || echo "{}")

if [ "$S3_NOTIFICATION" = "{}" ]; then
    echo -e "${GREEN}S3 Event Notification: 設定なし${NC}"
else
    echo "S3 Event Notification 設定:"
    echo "$S3_NOTIFICATION" | jq '.'

    # QueueConfigurations が複数ある場合は警告
    QUEUE_CONFIG_COUNT=$(echo "$S3_NOTIFICATION" | jq '.QueueConfigurations | length')
    if [ "$QUEUE_CONFIG_COUNT" -gt 1 ]; then
        echo -e "${RED}⚠️  警告: 複数のQueue設定が存在します (${QUEUE_CONFIG_COUNT}件)${NC}"
    fi

    # EventBridgeConfiguration がある場合
    EVENTBRIDGE_ENABLED=$(echo "$S3_NOTIFICATION" | jq '.EventBridgeConfiguration.Enabled // false')
    if [ "$EVENTBRIDGE_ENABLED" = "true" ]; then
        echo -e "${YELLOW}⚠️  EventBridge統合が有効になっています${NC}"
    fi
fi
echo ""

###############################################################################
# 6. CloudWatch Logs - 最近のエラーパターン分析
###############################################################################
echo -e "${YELLOW}[6] CloudWatch Logs エラーパターン分析 (過去1時間)${NC}"
echo "==========================================="

LOG_GROUP_NAME="/aws/ec2/file-processor"

# ログストリームが存在するか確認
LOG_STREAMS=$(aws logs describe-log-streams \
    --log-group-name "${LOG_GROUP_NAME}" \
    --order-by LastEventTime \
    --descending \
    --max-items 5 \
    --region "${AWS_REGION}" \
    --output json 2>/dev/null || echo "{}")

if [ "$LOG_STREAMS" = "{}" ]; then
    echo "ログストリームが見つかりません"
else
    echo "最新のログストリーム (5件):"
    echo "$LOG_STREAMS" | jq -r '.logStreams[] |
        .logStreamName + " (最終イベント: " + (.lastEventTimestamp | tonumber / 1000 | strftime("%Y-%m-%d %H:%M:%S")) + ")"'

    echo ""
    echo "エラーパターン検索 (ERROR, FAILED, Exception):"

    START_TIME=$(($(date +%s) - 3600))000  # 1時間前
    END_TIME=$(date +%s)000

    aws logs filter-log-events \
        --log-group-name "${LOG_GROUP_NAME}" \
        --start-time "${START_TIME}" \
        --end-time "${END_TIME}" \
        --filter-pattern "?ERROR ?FAILED ?Exception" \
        --region "${AWS_REGION}" \
        --max-items 10 \
        --output json 2>/dev/null | jq -r '
        .events[] |
        (.timestamp | tonumber / 1000 | strftime("%Y-%m-%d %H:%M:%S")) + " | " + .message' || echo "エラーログなし"
fi
echo ""

###############################################################################
# 7. EC2 Auto Scaling Group の状態確認
###############################################################################
echo -e "${YELLOW}[7] EC2 Auto Scaling Group 状態確認${NC}"
echo "==========================================="

ASG_NAME="file-processor-asg-production"

ASG_INFO=$(aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names "${ASG_NAME}" \
    --region "${AWS_REGION}" \
    --output json 2>/dev/null || echo "{}")

if [ "$ASG_INFO" = "{}" ]; then
    echo "Auto Scaling Group が見つかりません: ${ASG_NAME}"
else
    echo "$ASG_INFO" | jq -r '
    .AutoScalingGroups[0] |
    "Name: " + .AutoScalingGroupName + "\n" +
    "DesiredCapacity: " + (.DesiredCapacity | tostring) + "\n" +
    "MinSize: " + (.MinSize | tostring) + "\n" +
    "MaxSize: " + (.MaxSize | tostring) + "\n" +
    "インスタンス数: " + (.Instances | length | tostring) + "\n" +
    "インスタンス状態:\n" +
    (.Instances[] | "  - " + .InstanceId + " (" + .LifecycleState + ", " + .HealthStatus + ")")'
fi
echo ""

###############################################################################
# 8. 根本原因の推定
###############################################################################
echo -e "${YELLOW}[8] 根本原因の推定${NC}"
echo "==========================================="

# 可能性のある原因をリストアップ
echo "以下の可能性を確認してください:"
echo ""

if [ "$QUEUE_CONFIG_COUNT" -gt 1 ]; then
    echo -e "${RED}[高確率] S3に複数のEvent Notification設定が存在 → 重複メッセージ送信${NC}"
fi

if [ "$EVENTBRIDGE_ENABLED" = "true" ]; then
    echo -e "${RED}[高確率] EventBridge統合が有効 + SQS直接送信 → 二重メッセージ送信${NC}"
fi

if [ "$DLQ_MSG_COUNT" -gt 100 ]; then
    echo -e "${RED}[高確率] python-workerがメッセージ削除に失敗している → 再送信ループ${NC}"
fi

# SQS Visibility Timeout チェック
if [ -n "$QUEUE_URL" ]; then
    VISIBILITY_TIMEOUT=$(aws sqs get-queue-attributes \
        --queue-url "${QUEUE_URL}" \
        --attribute-names VisibilityTimeout \
        --region "${AWS_REGION}" \
        --output text --query 'Attributes.VisibilityTimeout')

    if [ "$VISIBILITY_TIMEOUT" -lt 300 ]; then
        echo -e "${YELLOW}[中確率] VisibilityTimeoutが短すぎる (${VISIBILITY_TIMEOUT}秒) → メッセージ再表示${NC}"
    fi
fi

echo ""

###############################################################################
# 診断レポート完了
###############################################################################
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  診断レポート完了${NC}"
echo -e "${BLUE}  完了時刻: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

echo -e "${GREEN}次のステップ:${NC}"
echo "1. このレポートを確認し、根本原因を特定"
echo "2. 緊急停止が必要な場合は emergency_stop.sh を実行"
echo "3. 修正後、emergency_recovery.sh でキュークリア"
echo ""
