#!/bin/bash

# =============================================================================
# DLQ Recovery Monitoring Script
# =============================================================================
# このスクリプトはDLQリカバリーの進捗を継続的に監視します
#
# 使用方法:
#   chmod +x monitor_recovery.sh
#   ./monitor_recovery.sh
# =============================================================================

set -e

# Configuration
DLQ_URL="https://sqs.ap-northeast-1.amazonaws.com/590183743917/file-metadata-queue-dlq.fifo"
MAIN_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/590183743917/file-metadata-queue.fifo"
REGION="ap-northeast-1"
INTERVAL=30  # 監視間隔（秒）

# ANSI color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 開始時刻を記録
START_TIME=$(date +%s)
INITIAL_DLQ_COUNT=0

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         DLQ Recovery Progress Monitor                          ║${NC}"
echo -e "${BLUE}║         Started at: $(date '+%Y-%m-%d %H:%M:%S')                        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# 初期カウントを取得
echo "Fetching initial message counts..."
INITIAL_DLQ_COUNT=$(aws sqs get-queue-attributes \
    --queue-url "$DLQ_URL" \
    --attribute-names ApproximateNumberOfMessages \
    --region "$REGION" \
    --query 'Attributes.ApproximateNumberOfMessages' \
    --output text)

echo -e "${YELLOW}Initial DLQ messages: $INITIAL_DLQ_COUNT${NC}"
echo ""

# メインループ
ITERATION=0
while true; do
    ITERATION=$((ITERATION + 1))
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))

    # 現在の時刻を表示
    echo -e "${BLUE}[$(date '+%H:%M:%S')] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # DLQの状態を取得
    DLQ_ATTRS=$(aws sqs get-queue-attributes \
        --queue-url "$DLQ_URL" \
        --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
        --region "$REGION" \
        --output json)

    DLQ_AVAILABLE=$(echo "$DLQ_ATTRS" | jq -r '.Attributes.ApproximateNumberOfMessages')
    DLQ_IN_FLIGHT=$(echo "$DLQ_ATTRS" | jq -r '.Attributes.ApproximateNumberOfMessagesNotVisible')

    # メインキューの状態を取得
    MAIN_ATTRS=$(aws sqs get-queue-attributes \
        --queue-url "$MAIN_QUEUE_URL" \
        --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
        --region "$REGION" \
        --output json)

    MAIN_AVAILABLE=$(echo "$MAIN_ATTRS" | jq -r '.Attributes.ApproximateNumberOfMessages')
    MAIN_IN_FLIGHT=$(echo "$MAIN_ATTRS" | jq -r '.Attributes.ApproximateNumberOfMessagesNotVisible')

    # 処理済みメッセージ数を計算
    PROCESSED=$((INITIAL_DLQ_COUNT - DLQ_AVAILABLE))

    # 進捗率を計算
    if [ "$INITIAL_DLQ_COUNT" -gt 0 ]; then
        PROGRESS=$(awk "BEGIN {printf \"%.2f\", ($PROCESSED / $INITIAL_DLQ_COUNT) * 100}")
    else
        PROGRESS="100.00"
    fi

    # 処理速度を計算（messages/sec）
    if [ "$ELAPSED" -gt 0 ]; then
        RATE=$(awk "BEGIN {printf \"%.2f\", $PROCESSED / $ELAPSED}")
    else
        RATE="0.00"
    fi

    # 残り時間を推定
    if [ "$DLQ_AVAILABLE" -gt 0 ] && [ "$(echo "$RATE > 0" | bc)" -eq 1 ]; then
        ETA_SECONDS=$(awk "BEGIN {printf \"%.0f\", $DLQ_AVAILABLE / $RATE}")
        ETA_MINUTES=$((ETA_SECONDS / 60))
        ETA_HOURS=$((ETA_MINUTES / 60))
        ETA_DISPLAY=$(printf "%dh %dm" $ETA_HOURS $((ETA_MINUTES % 60)))
    else
        ETA_DISPLAY="Calculating..."
    fi

    # 結果を表示
    echo -e "${GREEN}DLQ Status:${NC}"
    echo -e "  Available: ${YELLOW}$DLQ_AVAILABLE${NC}"
    echo -e "  In Flight: ${YELLOW}$DLQ_IN_FLIGHT${NC}"
    echo ""
    echo -e "${GREEN}Main Queue Status:${NC}"
    echo -e "  Available: ${YELLOW}$MAIN_AVAILABLE${NC}"
    echo -e "  In Flight: ${YELLOW}$MAIN_IN_FLIGHT${NC}"
    echo ""
    echo -e "${GREEN}Recovery Progress:${NC}"
    echo -e "  Processed: ${GREEN}$PROCESSED${NC} / $INITIAL_DLQ_COUNT"
    echo -e "  Progress: ${GREEN}$PROGRESS%${NC}"
    echo -e "  Rate: ${YELLOW}$RATE${NC} msg/sec"
    echo -e "  Elapsed: ${BLUE}$(printf '%02d:%02d:%02d' $((ELAPSED/3600)) $((ELAPSED%3600/60)) $((ELAPSED%60)))${NC}"
    echo -e "  ETA: ${YELLOW}$ETA_DISPLAY${NC}"
    echo ""

    # プログレスバーを表示
    BAR_LENGTH=50
    FILLED=$(awk "BEGIN {printf \"%.0f\", ($PROGRESS / 100) * $BAR_LENGTH}")
    BAR=$(printf "%${FILLED}s" | tr ' ' '█')
    EMPTY=$(printf "%$((BAR_LENGTH - FILLED))s" | tr ' ' '░')
    echo -e "  [${GREEN}$BAR${NC}${EMPTY}] $PROGRESS%"
    echo ""

    # 完了チェック
    if [ "$DLQ_AVAILABLE" -eq 0 ] && [ "$DLQ_IN_FLIGHT" -eq 0 ]; then
        echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║              🎉 RECOVERY COMPLETED! 🎉                         ║${NC}"
        echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "Total processed: ${GREEN}$PROCESSED${NC} messages"
        echo -e "Total time: ${BLUE}$(printf '%02d:%02d:%02d' $((ELAPSED/3600)) $((ELAPSED%3600/60)) $((ELAPSED%60)))${NC}"
        echo -e "Average rate: ${YELLOW}$RATE${NC} msg/sec"
        echo ""
        break
    fi

    # 警告チェック
    if [ "$MAIN_AVAILABLE" -gt 1000 ]; then
        echo -e "${RED}⚠️  WARNING: Main queue has $MAIN_AVAILABLE messages waiting${NC}"
        echo -e "${RED}   Consider scaling up workers${NC}"
        echo ""
    fi

    # 次の更新まで待機
    echo -e "Next update in ${INTERVAL}s... (Press Ctrl+C to stop)"
    sleep "$INTERVAL"
    echo ""
done

echo "Monitoring completed at $(date '+%Y-%m-%d %H:%M:%S')"
