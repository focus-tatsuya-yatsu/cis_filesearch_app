#!/bin/bash

###############################################################################
# 緊急復旧スクリプト - 停止したサービスを復旧
# CIS File Search Application
#
# 前提条件:
#   - emergency_stop.sh で作成されたバックアップファイルが存在すること
#   - 根本原因が修正されていること
#
# 使用方法:
#   chmod +x emergency_recovery.sh
#   ./emergency_recovery.sh [backup_asg_file] [backup_s3_file]
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

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  緊急復旧スクリプト${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# バックアップファイルの自動検出
if [ -z "$1" ]; then
    ASG_BACKUP_FILE=$(ls -t /tmp/asg_backup_*.json 2>/dev/null | head -1 || echo "")
else
    ASG_BACKUP_FILE="$1"
fi

if [ -z "$2" ]; then
    S3_BACKUP_FILE=$(ls -t /tmp/s3_notification_backup_*.json 2>/dev/null | head -1 || echo "")
else
    S3_BACKUP_FILE="$2"
fi

echo -e "${YELLOW}使用するバックアップファイル:${NC}"
if [ -n "$ASG_BACKUP_FILE" ] && [ -f "$ASG_BACKUP_FILE" ]; then
    echo "  Auto Scaling: ${ASG_BACKUP_FILE}"
else
    echo -e "${RED}  Auto Scaling: バックアップファイルが見つかりません${NC}"
    ASG_BACKUP_FILE=""
fi

if [ -n "$S3_BACKUP_FILE" ] && [ -f "$S3_BACKUP_FILE" ]; then
    echo "  S3 Notification: ${S3_BACKUP_FILE}"
else
    echo "  S3 Notification: バックアップファイルなし (スキップ)"
    S3_BACKUP_FILE=""
fi
echo ""

# 確認
echo -e "${RED}復旧を開始しますか?${NC}"
read -p "続行するには 'YES' と入力してください: " CONFIRM

if [ "$CONFIRM" != "YES" ]; then
    echo "キャンセルされました"
    exit 0
fi

echo ""
echo -e "${BLUE}復旧を開始します...${NC}"
echo ""

###############################################################################
# 1. EventBridge Rules の有効化
###############################################################################
echo -e "${YELLOW}[1] EventBridge Rules の有効化${NC}"
echo "==========================================="

RULES=$(aws events list-rules --region "${AWS_REGION}" --output json | jq -r '.Rules[] | select(.State == "DISABLED") | select(.Name | contains("file") or contains("sync")) | .Name')

if [ -z "$RULES" ]; then
    echo "無効化されたEventBridge Ruleが見つかりません"
else
    for RULE_NAME in $RULES; do
        echo "Rule を有効化: ${RULE_NAME}"
        aws events enable-rule \
            --name "${RULE_NAME}" \
            --region "${AWS_REGION}" || echo "Failed to enable ${RULE_NAME}"
    done
    echo -e "${GREEN}✓ EventBridge Rules を有効化しました${NC}"
fi
echo ""

###############################################################################
# 2. Auto Scaling Group の復旧
###############################################################################
echo -e "${YELLOW}[2] Auto Scaling Group の復旧${NC}"
echo "==========================================="

if [ -z "$ASG_BACKUP_FILE" ]; then
    echo -e "${YELLOW}バックアップファイルがないため、手動で設定してください${NC}"
    echo ""
    read -p "Desired Capacity を入力: " DESIRED
    read -p "Min Size を入力: " MIN
    read -p "Max Size を入力: " MAX
else
    DESIRED=$(jq -r '.desired' "${ASG_BACKUP_FILE}")
    MIN=$(jq -r '.min' "${ASG_BACKUP_FILE}")
    MAX=$(jq -r '.max' "${ASG_BACKUP_FILE}")
    echo "バックアップファイルから復元: Desired=${DESIRED}, Min=${MIN}, Max=${MAX}"
fi

echo "Auto Scaling Group を復旧..."
aws autoscaling update-auto-scaling-group \
    --auto-scaling-group-name "${ASG_NAME}" \
    --min-size "${MIN}" \
    --max-size "${MAX}" \
    --desired-capacity "${DESIRED}" \
    --region "${AWS_REGION}"

echo -e "${GREEN}✓ Auto Scaling Group を復旧しました${NC}"
echo ""

###############################################################################
# 3. S3 Event Notification の復旧
###############################################################################
echo -e "${YELLOW}[3] S3 Event Notification の復旧${NC}"
echo "==========================================="

if [ -z "$S3_BACKUP_FILE" ]; then
    echo "バックアップファイルがないためスキップ"
else
    S3_BUCKET_NAME="${S3_BUCKET_NAME:-cis-filesearch-storage-production}"

    # バックアップファイルが空でないか確認
    if [ "$(jq -r '. | length' "${S3_BACKUP_FILE}")" -eq 0 ]; then
        echo "元々Event Notificationは設定されていませんでした (スキップ)"
    else
        echo "S3 Event Notification を復元..."
        aws s3api put-bucket-notification-configuration \
            --bucket "${S3_BUCKET_NAME}" \
            --notification-configuration "file://${S3_BACKUP_FILE}" \
            --region "${AWS_REGION}"

        echo -e "${GREEN}✓ S3 Event Notification を復旧しました${NC}"
    fi
fi
echo ""

###############################################################################
# 4. EC2インスタンスの起動確認
###############################################################################
echo -e "${YELLOW}[4] EC2インスタンスの起動確認 (60秒待機)${NC}"
echo "==========================================="
echo "Auto Scaling Group が新しいインスタンスを起動するまで待機..."
echo ""

sleep 60

ASG_INFO=$(aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names "${ASG_NAME}" \
    --region "${AWS_REGION}" \
    --output json)

INSTANCE_COUNT=$(echo "$ASG_INFO" | jq -r '.AutoScalingGroups[0].Instances | length')

echo "起動中のインスタンス数: ${INSTANCE_COUNT}"
echo ""

if [ "$INSTANCE_COUNT" -gt 0 ]; then
    echo "インスタンス一覧:"
    echo "$ASG_INFO" | jq -r '.AutoScalingGroups[0].Instances[] |
        "  - " + .InstanceId + " (" + .LifecycleState + ", " + .HealthStatus + ")"'
    echo -e "${GREEN}✓ インスタンスが起動しています${NC}"
else
    echo -e "${YELLOW}⚠️  まだインスタンスが起動していません (数分待ってから再確認してください)${NC}"
fi
echo ""

###############################################################################
# 完了
###############################################################################
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  復旧完了${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

echo -e "${GREEN}実行した操作:${NC}"
echo "✓ EventBridge Rules を有効化"
echo "✓ Auto Scaling Group を復旧 (Desired=${DESIRED}, Min=${MIN}, Max=${MAX})"
if [ -n "$S3_BACKUP_FILE" ]; then
    echo "✓ S3 Event Notification を復旧"
fi
echo ""

echo -e "${YELLOW}次のステップ:${NC}"
echo "1. emergency_diagnosis.sh で再診断"
echo "2. CloudWatch Logsでエラーがないか確認"
echo "3. SQS/DLQのメッセージ数を監視 (数時間)"
echo "4. 問題なければバックアップファイルを削除"
echo ""

echo -e "${BLUE}監視コマンド:${NC}"
echo "  watch -n 30 'aws sqs get-queue-attributes --queue-url <QUEUE_URL> --attribute-names ApproximateNumberOfMessages --region ${AWS_REGION}'"
echo ""
