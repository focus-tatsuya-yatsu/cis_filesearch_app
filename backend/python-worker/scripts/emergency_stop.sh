#!/bin/bash

###############################################################################
# 緊急停止スクリプト - SQS/DLQ異常増加を即座に停止
# CIS File Search Application
#
# 実行前確認:
#   - このスクリプトは本番環境に影響を与えます
#   - 実行前にバックアップを取得してください
#   - 実行後は recovery スクリプトで復旧が必要です
#
# 使用方法:
#   chmod +x emergency_stop.sh
#   ./emergency_stop.sh
###############################################################################

set -e

# カラー出力
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 設定
AWS_REGION="${AWS_REGION:-ap-northeast-1}"
ASG_NAME="file-processor-asg-production"
EVENTBRIDGE_RULE_NAME="file-processing-schedule-production"

echo -e "${RED}========================================${NC}"
echo -e "${RED}  ⚠️  緊急停止スクリプト  ⚠️${NC}"
echo -e "${RED}========================================${NC}"
echo ""
echo -e "${YELLOW}このスクリプトは以下の操作を実行します:${NC}"
echo "1. EventBridge Rule の無効化"
echo "2. Auto Scaling Group のスケールダウン (MinSize=0)"
echo "3. 実行中のEC2インスタンスの停止"
echo ""
echo -e "${RED}本番環境に影響があります。続行しますか?${NC}"
read -p "続行するには 'YES' と入力してください: " CONFIRM

if [ "$CONFIRM" != "YES" ]; then
    echo "キャンセルされました"
    exit 0
fi

echo ""
echo -e "${BLUE}緊急停止を開始します...${NC}"
echo ""

###############################################################################
# 1. EventBridge Rule の無効化
###############################################################################
echo -e "${YELLOW}[1] EventBridge Rule の無効化${NC}"
echo "==========================================="

RULES=$(aws events list-rules --region "${AWS_REGION}" --output json | jq -r '.Rules[] | select(.Name | contains("file") or contains("sync")) | .Name')

if [ -z "$RULES" ]; then
    echo "該当するEventBridge Ruleが見つかりません"
else
    for RULE_NAME in $RULES; do
        echo "Rule を無効化: ${RULE_NAME}"
        aws events disable-rule \
            --name "${RULE_NAME}" \
            --region "${AWS_REGION}" || echo "Failed to disable ${RULE_NAME}"
    done
    echo -e "${GREEN}✓ EventBridge Rules を無効化しました${NC}"
fi
echo ""

###############################################################################
# 2. Auto Scaling Group のスケールダウン
###############################################################################
echo -e "${YELLOW}[2] Auto Scaling Group のスケールダウン${NC}"
echo "==========================================="

# 現在の設定を取得
ASG_INFO=$(aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names "${ASG_NAME}" \
    --region "${AWS_REGION}" \
    --output json 2>/dev/null || echo "{}")

if [ "$ASG_INFO" = "{}" ]; then
    echo "Auto Scaling Group が見つかりません: ${ASG_NAME}"
else
    CURRENT_DESIRED=$(echo "$ASG_INFO" | jq -r '.AutoScalingGroups[0].DesiredCapacity')
    CURRENT_MIN=$(echo "$ASG_INFO" | jq -r '.AutoScalingGroups[0].MinSize')
    CURRENT_MAX=$(echo "$ASG_INFO" | jq -r '.AutoScalingGroups[0].MaxSize')

    echo "現在の設定: Desired=${CURRENT_DESIRED}, Min=${CURRENT_MIN}, Max=${CURRENT_MAX}"

    # 設定をバックアップファイルに保存
    BACKUP_FILE="/tmp/asg_backup_$(date +%Y%m%d_%H%M%S).json"
    echo "{\"desired\": ${CURRENT_DESIRED}, \"min\": ${CURRENT_MIN}, \"max\": ${CURRENT_MAX}}" > "${BACKUP_FILE}"
    echo "バックアップファイル: ${BACKUP_FILE}"

    # MinSize を 0 に設定
    echo "MinSize を 0 に設定..."
    aws autoscaling update-auto-scaling-group \
        --auto-scaling-group-name "${ASG_NAME}" \
        --min-size 0 \
        --desired-capacity 0 \
        --region "${AWS_REGION}"

    echo -e "${GREEN}✓ Auto Scaling Group をスケールダウンしました${NC}"
fi
echo ""

###############################################################################
# 3. 実行中のEC2インスタンスの停止
###############################################################################
echo -e "${YELLOW}[3] 実行中のEC2インスタンスの停止${NC}"
echo "==========================================="

if [ "$ASG_INFO" != "{}" ]; then
    INSTANCE_IDS=$(echo "$ASG_INFO" | jq -r '.AutoScalingGroups[0].Instances[] | .InstanceId')

    if [ -z "$INSTANCE_IDS" ]; then
        echo "実行中のインスタンスなし"
    else
        for INSTANCE_ID in $INSTANCE_IDS; do
            echo "インスタンスを停止: ${INSTANCE_ID}"
            aws ec2 terminate-instances \
                --instance-ids "${INSTANCE_ID}" \
                --region "${AWS_REGION}" || echo "Failed to stop ${INSTANCE_ID}"
        done
        echo -e "${GREEN}✓ EC2インスタンスを停止しました${NC}"
    fi
else
    echo "Auto Scaling Group情報が取得できないためスキップ"
fi
echo ""

###############################################################################
# 4. S3 Event Notification の一時無効化 (オプション)
###############################################################################
echo -e "${YELLOW}[4] S3 Event Notification の一時無効化 (オプション)${NC}"
echo "==========================================="
echo ""
echo -e "${RED}S3 Event Notificationを無効化しますか?${NC}"
echo "※ 無効化すると新規ファイルアップロード時のイベントが送信されなくなります"
read -p "無効化する場合は 'YES' と入力: " S3_CONFIRM

if [ "$S3_CONFIRM" = "YES" ]; then
    S3_BUCKET_NAME="${S3_BUCKET_NAME:-cis-filesearch-storage-production}"

    # 現在の設定をバックアップ
    S3_BACKUP_FILE="/tmp/s3_notification_backup_$(date +%Y%m%d_%H%M%S).json"
    aws s3api get-bucket-notification-configuration \
        --bucket "${S3_BUCKET_NAME}" \
        --region "${AWS_REGION}" > "${S3_BACKUP_FILE}" 2>/dev/null || echo "{}" > "${S3_BACKUP_FILE}"

    echo "バックアップファイル: ${S3_BACKUP_FILE}"

    # Event Notificationを削除 (空の設定を適用)
    aws s3api put-bucket-notification-configuration \
        --bucket "${S3_BUCKET_NAME}" \
        --notification-configuration '{}' \
        --region "${AWS_REGION}"

    echo -e "${GREEN}✓ S3 Event Notification を無効化しました${NC}"
else
    echo "S3 Event Notification はそのままです"
fi
echo ""

###############################################################################
# 完了
###############################################################################
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  緊急停止完了${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

echo -e "${GREEN}実行した操作:${NC}"
echo "✓ EventBridge Rules を無効化"
echo "✓ Auto Scaling Group をスケールダウン (MinSize=0)"
echo "✓ EC2インスタンスを停止"
if [ "$S3_CONFIRM" = "YES" ]; then
    echo "✓ S3 Event Notification を無効化"
fi
echo ""

echo -e "${YELLOW}次のステップ:${NC}"
echo "1. SQS/DLQのメッセージ数を再確認 (emergency_diagnosis.sh)"
echo "2. 根本原因を修正"
echo "3. 復旧スクリプトで設定を戻す (emergency_recovery.sh)"
echo ""

echo -e "${RED}バックアップファイルは削除しないでください:${NC}"
if [ -f "${BACKUP_FILE}" ]; then
    echo "  - ${BACKUP_FILE}"
fi
if [ -f "${S3_BACKUP_FILE}" ]; then
    echo "  - ${S3_BACKUP_FILE}"
fi
echo ""
