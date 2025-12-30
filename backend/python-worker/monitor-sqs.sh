#!/bin/bash
# SQSメッセージ数監視スクリプト
# 無限ループ修正後のメッセージ処理状況を監視

set -u

# 設定
REGION="${AWS_REGION:-ap-northeast-1}"
REFRESH_INTERVAL="${REFRESH_INTERVAL:-30}"  # 秒

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Queue URLを取得
if [ -z "${SQS_QUEUE_URL:-}" ]; then
    echo -e "${YELLOW}SQS_QUEUE_URLが設定されていません。自動取得中...${NC}"
    SQS_QUEUE_URL=$(aws sqs list-queues --queue-name-prefix file-processing-queue --region ${REGION} --query 'QueueUrls[0]' --output text 2>/dev/null)
    if [ -z "$SQS_QUEUE_URL" ] || [ "$SQS_QUEUE_URL" == "None" ]; then
        echo -e "${RED}エラー: SQS Queue URLを取得できませんでした${NC}"
        echo "手動で設定してください: export SQS_QUEUE_URL='your-queue-url'"
        exit 1
    fi
fi

if [ -z "${DLQ_QUEUE_URL:-}" ]; then
    DLQ_QUEUE_URL=$(aws sqs list-queues --queue-name-prefix file-processing-dlq --region ${REGION} --query 'QueueUrls[0]' --output text 2>/dev/null)
fi

# 前回の値を保持
PREV_VISIBLE=0
PREV_IN_FLIGHT=0
START_TIME=$(date +%s)

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}SQS メッセージ監視${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Queue: ${CYAN}${SQS_QUEUE_URL}${NC}"
echo -e "DLQ: ${CYAN}${DLQ_QUEUE_URL:-未設定}${NC}"
echo -e "更新間隔: ${REFRESH_INTERVAL}秒"
echo -e "${BLUE}========================================${NC}"
echo ""

# Ctrl+C ハンドラ
trap 'echo -e "\n${YELLOW}監視を終了します${NC}"; exit 0' INT TERM

while true; do
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))
    ELAPSED_MIN=$((ELAPSED / 60))

    # メインキューの属性取得
    MAIN_ATTRS=$(aws sqs get-queue-attributes \
        --queue-url "${SQS_QUEUE_URL}" \
        --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateNumberOfMessagesDelayed \
        --region ${REGION} \
        --query 'Attributes' \
        --output json 2>/dev/null)

    if [ $? -ne 0 ]; then
        echo -e "${RED}エラー: SQS属性の取得に失敗しました${NC}"
        sleep ${REFRESH_INTERVAL}
        continue
    fi

    VISIBLE=$(echo ${MAIN_ATTRS} | jq -r '.ApproximateNumberOfMessages // "0"')
    IN_FLIGHT=$(echo ${MAIN_ATTRS} | jq -r '.ApproximateNumberOfMessagesNotVisible // "0"')
    DELAYED=$(echo ${MAIN_ATTRS} | jq -r '.ApproximateNumberOfMessagesDelayed // "0"')
    TOTAL=$((VISIBLE + IN_FLIGHT + DELAYED))

    # DLQの属性取得（設定されている場合）
    DLQ_COUNT=0
    if [ ! -z "${DLQ_QUEUE_URL:-}" ] && [ "${DLQ_QUEUE_URL}" != "None" ]; then
        DLQ_ATTRS=$(aws sqs get-queue-attributes \
            --queue-url "${DLQ_QUEUE_URL}" \
            --attribute-names ApproximateNumberOfMessages \
            --region ${REGION} \
            --query 'Attributes.ApproximateNumberOfMessages' \
            --output text 2>/dev/null)
        DLQ_COUNT=${DLQ_ATTRS:-0}
    fi

    # 変化量計算
    VISIBLE_CHANGE=$((VISIBLE - PREV_VISIBLE))
    IN_FLIGHT_CHANGE=$((IN_FLIGHT - PREV_IN_FLIGHT))

    # 変化量の色設定
    if [ ${VISIBLE_CHANGE} -lt 0 ]; then
        VISIBLE_COLOR=${GREEN}
        VISIBLE_SYMBOL="↓"
    elif [ ${VISIBLE_CHANGE} -gt 0 ]; then
        VISIBLE_COLOR=${RED}
        VISIBLE_SYMBOL="↑"
    else
        VISIBLE_COLOR=${NC}
        VISIBLE_SYMBOL="→"
    fi

    # 画面クリア
    clear

    # ヘッダー
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}SQS メッセージ監視${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo -e "監視開始: $(date -r ${START_TIME} '+%Y-%m-%d %H:%M:%S')"
    echo -e "経過時間: ${ELAPSED_MIN} 分"
    echo -e "最終更新: $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""

    # メインキューの状態
    echo -e "${CYAN}【メインキュー】${NC}"
    echo -e "  待機中:     ${VISIBLE_COLOR}${VISIBLE}${NC} ${VISIBLE_SYMBOL} (${VISIBLE_CHANGE:+${VISIBLE_COLOR}}${VISIBLE_CHANGE}${NC})"
    echo -e "  処理中:     ${YELLOW}${IN_FLIGHT}${NC} (${IN_FLIGHT_CHANGE:+${YELLOW}}${IN_FLIGHT_CHANGE}${NC})"
    echo -e "  遅延中:     ${DELAYED}"
    echo -e "  合計:       ${TOTAL}"
    echo ""

    # DLQ
    if [ ${DLQ_COUNT} -gt 0 ]; then
        echo -e "${RED}【Dead Letter Queue】${NC}"
        echo -e "  失敗:       ${RED}${DLQ_COUNT}${NC}"
        echo ""
    fi

    # ステータス判定
    echo -e "${CYAN}【ステータス】${NC}"
    if [ ${VISIBLE_CHANGE} -lt 0 ]; then
        echo -e "  ${GREEN}✓ メッセージが正常に処理されています${NC}"
        PROCESSING_RATE=$(echo "scale=2; (${VISIBLE_CHANGE} * -1) / ${REFRESH_INTERVAL} * 60" | bc)
        echo -e "  処理速度: 約 ${PROCESSING_RATE} メッセージ/分"
    elif [ ${VISIBLE_CHANGE} -gt 0 ]; then
        echo -e "  ${RED}✗ メッセージが増加しています（新規追加 or 処理遅延）${NC}"
    else
        if [ ${VISIBLE} -eq 0 ] && [ ${IN_FLIGHT} -eq 0 ]; then
            echo -e "  ${GREEN}✓ キューは空です${NC}"
        else
            echo -e "  ${YELLOW}⚠ 処理中または待機中${NC}"
        fi
    fi

    # 無限ループチェック
    if [ ${IN_FLIGHT} -gt 100 ] && [ ${VISIBLE_CHANGE} -ge 0 ]; then
        echo -e "  ${RED}⚠ 警告: 処理中メッセージが多く、減少していません${NC}"
        echo -e "  ${RED}   無限ループの可能性があります${NC}"
    fi

    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "次の更新まで ${REFRESH_INTERVAL} 秒... (Ctrl+C で終了)"

    # 前回の値を保存
    PREV_VISIBLE=${VISIBLE}
    PREV_IN_FLIGHT=${IN_FLIGHT}

    sleep ${REFRESH_INTERVAL}
done
