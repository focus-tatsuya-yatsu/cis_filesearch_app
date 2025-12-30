#!/bin/bash

###############################################################################
# 緊急修正適用スクリプト - SQS/DLQ無限ループバグ修正
# CIS File Search Application
#
# このスクリプトは以下を実行します:
# 1. worker.py をバックアップ
# 2. worker_fixed.py を worker.py にコピー
# 3. SQS Visibility Timeout を 900秒に変更
# 4. 修正の検証
#
# 使用方法:
#   chmod +x apply_emergency_fix.sh
#   ./apply_emergency_fix.sh
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
WORKER_DIR="/Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  緊急修正適用スクリプト${NC}"
echo -e "${BLUE}  実行時刻: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

###############################################################################
# Step 1: 環境確認
###############################################################################
echo -e "${YELLOW}[Step 1] 環境確認${NC}"
echo "==========================================="

# ディレクトリ確認
if [ ! -d "$WORKER_DIR" ]; then
    echo -e "${RED}ERROR: ディレクトリが見つかりません: ${WORKER_DIR}${NC}"
    exit 1
fi

cd "$WORKER_DIR"

# worker_fixed.py の存在確認
if [ ! -f "worker_fixed.py" ]; then
    echo -e "${RED}ERROR: worker_fixed.py が見つかりません${NC}"
    exit 1
fi

echo -e "${GREEN}✓ ディレクトリ: ${WORKER_DIR}${NC}"
echo -e "${GREEN}✓ worker_fixed.py: 存在確認${NC}"
echo ""

###############################################################################
# Step 2: worker.py のバックアップ
###############################################################################
echo -e "${YELLOW}[Step 2] worker.py のバックアップ${NC}"
echo "==========================================="

BACKUP_FILE="worker.py.backup.$(date +%Y%m%d_%H%M%S)"

if [ -f "worker.py" ]; then
    cp worker.py "$BACKUP_FILE"
    echo -e "${GREEN}✓ バックアップ作成: ${BACKUP_FILE}${NC}"
else
    echo -e "${YELLOW}⚠ worker.py が存在しません (新規作成)${NC}"
fi
echo ""

###############################################################################
# Step 3: 修正版の適用
###############################################################################
echo -e "${YELLOW}[Step 3] 修正版の適用${NC}"
echo "==========================================="

cp worker_fixed.py worker.py

echo -e "${GREEN}✓ worker_fixed.py → worker.py にコピー完了${NC}"
echo ""

# 差分表示
echo "主要な変更点:"
echo "  1. _send_to_dlq() メソッド追加 (失敗メッセージをDLQに送信)"
echo "  2. メッセージ削除の保証 (成功/失敗に関わらず削除)"
echo "  3. CloudWatch メトリクス送信 (削除失敗の監視)"
echo ""

###############################################################################
# Step 4: SQS Visibility Timeout の変更
###############################################################################
echo -e "${YELLOW}[Step 4] SQS Visibility Timeout の変更${NC}"
echo "==========================================="

# AWS CLIの確認
if ! command -v aws &> /dev/null; then
    echo -e "${RED}ERROR: AWS CLI がインストールされていません${NC}"
    echo "AWS CLI をインストールしてから再実行してください"
    exit 1
fi

# AWS認証確認
echo "AWS認証確認..."
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}ERROR: AWS認証が失敗しました${NC}"
    echo "以下のコマンドで認証してから再実行してください:"
    echo "  aws sso login --profile your-profile"
    echo ""
    echo "または環境変数を設定:"
    echo "  export AWS_PROFILE=your-profile"
    echo "  export AWS_REGION=ap-northeast-1"
    exit 1
fi

echo -e "${GREEN}✓ AWS認証成功${NC}"
echo ""

# キューURLを取得
echo "SQSキューURL取得中..."
QUEUE_URL=$(aws sqs get-queue-url \
    --queue-name "${SQS_QUEUE_NAME}" \
    --region "${AWS_REGION}" \
    --output text 2>/dev/null || echo "")

if [ -z "$QUEUE_URL" ]; then
    echo -e "${RED}ERROR: キューが見つかりません: ${SQS_QUEUE_NAME}${NC}"
    echo "キュー名を確認してください"
    exit 1
fi

echo -e "${GREEN}✓ キューURL: ${QUEUE_URL}${NC}"
echo ""

# 現在のVisibility Timeoutを確認
echo "現在のVisibility Timeout確認中..."
CURRENT_TIMEOUT=$(aws sqs get-queue-attributes \
    --queue-url "${QUEUE_URL}" \
    --attribute-names VisibilityTimeout \
    --region "${AWS_REGION}" \
    --output text --query 'Attributes.VisibilityTimeout')

echo "現在の設定: ${CURRENT_TIMEOUT}秒"
echo ""

# 変更確認
echo -e "${YELLOW}Visibility Timeout を 900秒 (15分) に変更します${NC}"
read -p "続行しますか? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "キャンセルされました"
    exit 0
fi

# Visibility Timeout を変更
aws sqs set-queue-attributes \
    --queue-url "${QUEUE_URL}" \
    --attributes VisibilityTimeout=900 \
    --region "${AWS_REGION}"

echo -e "${GREEN}✓ Visibility Timeout を 900秒に変更しました${NC}"
echo ""

# 変更確認
NEW_TIMEOUT=$(aws sqs get-queue-attributes \
    --queue-url "${QUEUE_URL}" \
    --attribute-names VisibilityTimeout \
    --region "${AWS_REGION}" \
    --output text --query 'Attributes.VisibilityTimeout')

echo "新しい設定: ${NEW_TIMEOUT}秒"
echo ""

###############################################################################
# Step 5: 検証
###############################################################################
echo -e "${YELLOW}[Step 5] 検証${NC}"
echo "==========================================="

# worker.py の存在確認
if [ -f "worker.py" ]; then
    echo -e "${GREEN}✓ worker.py が存在します${NC}"

    # ファイルヘッダーチェック (FIXED VERSIONが含まれているか)
    if grep -q "FIXED VERSION" worker.py; then
        echo -e "${GREEN}✓ worker.py は修正版です${NC}"
    else
        echo -e "${RED}⚠ worker.py が修正版でない可能性があります${NC}"
    fi
else
    echo -e "${RED}✗ worker.py が見つかりません${NC}"
fi

# バックアップファイルの確認
if [ -f "$BACKUP_FILE" ]; then
    echo -e "${GREEN}✓ バックアップファイル: ${BACKUP_FILE}${NC}"
fi

# SQS設定確認
if [ "$NEW_TIMEOUT" == "900" ]; then
    echo -e "${GREEN}✓ Visibility Timeout: 900秒 (正常)${NC}"
else
    echo -e "${RED}⚠ Visibility Timeout: ${NEW_TIMEOUT}秒 (期待値: 900秒)${NC}"
fi

echo ""

###############################################################################
# Step 6: 次のアクション
###############################################################################
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  修正適用完了${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

echo -e "${GREEN}次のステップ:${NC}"
echo ""

echo "1. EC2インスタンスで実行中の場合、workerを再起動:"
echo "   ${BLUE}sudo systemctl restart file-processor${NC}"
echo ""

echo "2. Auto Scalingで管理している場合、AMIを更新:"
echo "   ${BLUE}# 現在のインスタンスからAMIを作成${NC}"
echo "   ${BLUE}# Launch Templateを更新${NC}"
echo "   ${BLUE}# インスタンスをローリング更新${NC}"
echo ""

echo "3. S3 Event Notification設定を確認:"
echo "   ${BLUE}aws s3api get-bucket-notification-configuration \\${NC}"
echo "   ${BLUE}  --bucket cis-filesearch-storage-production \\${NC}"
echo "   ${BLUE}  --region ap-northeast-1 | jq '.QueueConfigurations | length'${NC}"
echo ""
echo "   期待値: 1 (重複設定がない)"
echo ""

echo "4. 24時間監視:"
echo "   ${BLUE}watch -n 600 'aws sqs get-queue-attributes \\${NC}"
echo "   ${BLUE}  --queue-url \"${QUEUE_URL}\" \\${NC}"
echo "   ${BLUE}  --attribute-names ApproximateNumberOfMessages \\${NC}"
echo "   ${BLUE}  --region ap-northeast-1 \\${NC}"
echo "   ${BLUE}  --query \"Attributes.ApproximateNumberOfMessages\"'${NC}"
echo ""
echo "   期待される動作: メッセージ数が減少し続ける"
echo ""

echo -e "${GREEN}詳細なレポート: SQS_EMERGENCY_ROOT_CAUSE_ANALYSIS.md${NC}"
echo ""

###############################################################################
# 完了
###############################################################################
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  スクリプト完了${NC}"
echo -e "${BLUE}  完了時刻: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${BLUE}========================================${NC}"
