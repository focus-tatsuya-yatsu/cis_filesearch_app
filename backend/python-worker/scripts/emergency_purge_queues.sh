#!/bin/bash

###############################################################################
# SQS/DLQ キュークリアスクリプト
# CIS File Search Application
#
# 警告:
#   - このスクリプトはSQS/DLQの全メッセージを削除します
#   - 実行前に必ずバックアップを取得してください
#   - 削除したメッセージは復元できません
#
# 使用方法:
#   chmod +x emergency_purge_queues.sh
#   ./emergency_purge_queues.sh
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
SQS_QUEUE_NAME="${SQS_QUEUE_NAME:-file-processing-queue-production}"
DLQ_QUEUE_NAME="${DLQ_QUEUE_NAME:-file-processing-dlq-production}"

echo -e "${RED}========================================${NC}"
echo -e "${RED}  ⚠️  SQS/DLQ キュークリア  ⚠️${NC}"
echo -e "${RED}========================================${NC}"
echo ""
echo -e "${YELLOW}このスクリプトは以下のキューを完全にクリアします:${NC}"
echo "  - ${SQS_QUEUE_NAME}"
echo "  - ${DLQ_QUEUE_NAME}"
echo ""
echo -e "${RED}削除したメッセージは復元できません!${NC}"
echo ""

# キューURLを取得
QUEUE_URL=$(aws sqs get-queue-url --queue-name "${SQS_QUEUE_NAME}" --region "${AWS_REGION}" --output text 2>/dev/null || echo "")
DLQ_URL=$(aws sqs get-queue-url --queue-name "${DLQ_QUEUE_NAME}" --region "${AWS_REGION}" --output text 2>/dev/null || echo "")

if [ -z "$QUEUE_URL" ] || [ -z "$DLQ_URL" ]; then
    echo -e "${RED}ERROR: キューURLが取得できません${NC}"
    exit 1
fi

# 現在のメッセージ数を表示
echo -e "${BLUE}現在のメッセージ数:${NC}"
MAIN_MSG_COUNT=$(aws sqs get-queue-attributes \
    --queue-url "${QUEUE_URL}" \
    --attribute-names ApproximateNumberOfMessages \
    --region "${AWS_REGION}" \
    --output text --query 'Attributes.ApproximateNumberOfMessages')

DLQ_MSG_COUNT=$(aws sqs get-queue-attributes \
    --queue-url "${DLQ_URL}" \
    --attribute-names ApproximateNumberOfMessages \
    --region "${AWS_REGION}" \
    --output text --query 'Attributes.ApproximateNumberOfMessages')

echo "  メインキュー: ${MAIN_MSG_COUNT} メッセージ"
echo "  DLQ: ${DLQ_MSG_COUNT} メッセージ"
echo ""

# 確認
read -p "本当にクリアしますか? 'DELETE' と入力してください: " CONFIRM

if [ "$CONFIRM" != "DELETE" ]; then
    echo "キャンセルされました"
    exit 0
fi

echo ""
echo -e "${YELLOW}キューをクリアしています...${NC}"
echo ""

###############################################################################
# メインキューのクリア
###############################################################################
echo -e "${YELLOW}[1] メインキューのクリア${NC}"
echo "==========================================="

aws sqs purge-queue \
    --queue-url "${QUEUE_URL}" \
    --region "${AWS_REGION}"

echo -e "${GREEN}✓ メインキューをクリアしました${NC}"
echo ""

###############################################################################
# DLQのクリア
###############################################################################
echo -e "${YELLOW}[2] DLQのクリア${NC}"
echo "==========================================="

aws sqs purge-queue \
    --queue-url "${DLQ_URL}" \
    --region "${AWS_REGION}"

echo -e "${GREEN}✓ DLQをクリアしました${NC}"
echo ""

###############################################################################
# 確認
###############################################################################
echo -e "${YELLOW}[3] クリア後のメッセージ数確認 (60秒待機)${NC}"
echo "==========================================="
echo "※ SQS Purge APIは最大60秒かかることがあります"
echo ""

sleep 60

MAIN_MSG_COUNT_AFTER=$(aws sqs get-queue-attributes \
    --queue-url "${QUEUE_URL}" \
    --attribute-names ApproximateNumberOfMessages \
    --region "${AWS_REGION}" \
    --output text --query 'Attributes.ApproximateNumberOfMessages')

DLQ_MSG_COUNT_AFTER=$(aws sqs get-queue-attributes \
    --queue-url "${DLQ_URL}" \
    --attribute-names ApproximateNumberOfMessages \
    --region "${AWS_REGION}" \
    --output text --query 'Attributes.ApproximateNumberOfMessages')

echo "  メインキュー: ${MAIN_MSG_COUNT_AFTER} メッセージ"
echo "  DLQ: ${DLQ_MSG_COUNT_AFTER} メッセージ"
echo ""

if [ "$MAIN_MSG_COUNT_AFTER" -eq 0 ] && [ "$DLQ_MSG_COUNT_AFTER" -eq 0 ]; then
    echo -e "${GREEN}✓ 全てのメッセージがクリアされました${NC}"
else
    echo -e "${YELLOW}⚠️  一部メッセージが残っています (分散システムの特性上、完全にクリアされるまで数分かかる場合があります)${NC}"
fi

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  キュークリア完了${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

echo -e "${GREEN}次のステップ:${NC}"
echo "1. 根本原因が修正されたことを確認"
echo "2. emergency_diagnosis.sh で再診断"
echo "3. 問題なければ emergency_recovery.sh で復旧"
echo ""
