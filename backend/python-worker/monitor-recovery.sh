#!/bin/bash
# リアルタイムDLQリカバリーモニタリング

set -e

export AWS_PROFILE=AdministratorAccess-770923989980
export AWS_REGION=ap-northeast-1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
NC='\033[0m'

DLQ_URL="https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq"
MAIN_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"

clear
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${MAGENTA}     DLQリカバリー リアルタイムモニター      ${NC}"
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 初期値記録
START_TIME=$(date +%s)
INITIAL_DLQ=$(aws sqs get-queue-attributes \
    --queue-url $DLQ_URL \
    --attribute-names ApproximateNumberOfMessages \
    --region $AWS_REGION \
    --output text --query 'Attributes.ApproximateNumberOfMessages' 2>/dev/null || echo "0")

INITIAL_DLQ=${INITIAL_DLQ:-8163}
TOTAL_TO_PROCESS=$INITIAL_DLQ
echo -e "${BLUE}初期DLQメッセージ数: ${YELLOW}${INITIAL_DLQ}${NC}"
echo ""

# プログレスバー表示関数
show_progress() {
    local current=$1
    local total=$2
    local processed=$((total - current))
    local percent=$((processed * 100 / total))
    local bar_length=40
    local filled_length=$((percent * bar_length / 100))

    # プログレスバー作成
    printf "\r["
    printf "%0.s█" $(seq 1 $filled_length)
    printf "%0.s░" $(seq 1 $((bar_length - filled_length)))
    printf "] %3d%% (%d/%d)" $percent $processed $total
}

# メインモニタリングループ
COUNTER=0
while true; do
    # 現在のキュー状態取得
    QUEUE_STATUS=$(aws sqs get-queue-attributes \
        --queue-url $DLQ_URL \
        --attribute-names ApproximateNumberOfMessages,ApproximateNumberOfMessagesDelayed \
        --region $AWS_REGION \
        --output json 2>/dev/null || echo "{}")

    MAIN_STATUS=$(aws sqs get-queue-attributes \
        --queue-url $MAIN_QUEUE_URL \
        --attribute-names ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible \
        --region $AWS_REGION \
        --output json 2>/dev/null || echo "{}")

    # 値抽出
    CURRENT_DLQ=$(echo $QUEUE_STATUS | jq -r '.Attributes.ApproximateNumberOfMessages // 0')
    MAIN_QUEUE=$(echo $MAIN_STATUS | jq -r '.Attributes.ApproximateNumberOfMessages // 0')
    IN_FLIGHT=$(echo $MAIN_STATUS | jq -r '.Attributes.ApproximateNumberOfMessagesNotVisible // 0')

    # 処理済み計算
    PROCESSED=$((INITIAL_DLQ - CURRENT_DLQ))

    # 経過時間計算
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))
    ELAPSED_MIN=$((ELAPSED / 60))
    ELAPSED_SEC=$((ELAPSED % 60))

    # 処理速度計算
    if [ $ELAPSED -gt 0 ] && [ $PROCESSED -gt 0 ]; then
        RATE=$((PROCESSED * 60 / ELAPSED))
        REMAINING_TIME=$((CURRENT_DLQ * 60 / RATE))
        REMAINING_MIN=$((REMAINING_TIME / 60))
        REMAINING_SEC=$((REMAINING_TIME % 60))
        ETA=$(date -d "+${REMAINING_MIN} minutes" +"%H:%M:%S")
    else
        RATE=0
        REMAINING_MIN=0
        REMAINING_SEC=0
        ETA="計算中..."
    fi

    # 表示更新（10回に1回ヘッダー再表示）
    if [ $((COUNTER % 10)) -eq 0 ]; then
        clear
        echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${MAGENTA}     DLQリカバリー リアルタイムモニター      ${NC}"
        echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
    fi

    # ステータス表示
    echo -e "\033[K${BLUE}[$(date +"%H:%M:%S")]${NC} 処理状況"
    echo -e "\033[K━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # DLQステータス
    if [ "$CURRENT_DLQ" -eq "0" ]; then
        echo -e "\033[K${GREEN}✅ DLQ: 完了！${NC}"
    else
        echo -e "\033[K${YELLOW}📦 DLQ残り: ${CURRENT_DLQ}件${NC}"
    fi

    echo -e "\033[K${BLUE}📊 処理済み: ${GREEN}${PROCESSED}件${NC} / ${INITIAL_DLQ}件"
    echo -e "\033[K${BLUE}⚡ 処理速度: ${RATE} msg/分${NC}"
    echo -e "\033[K${BLUE}⏱️ 経過時間: ${ELAPSED_MIN}分${ELAPSED_SEC}秒${NC}"

    if [ "$CURRENT_DLQ" -gt "0" ] && [ "$RATE" -gt "0" ]; then
        echo -e "\033[K${BLUE}🎯 完了予想: ${REMAINING_MIN}分${REMAINING_SEC}秒後 (${ETA})${NC}"
    fi

    # メインキューステータス
    echo -e "\033[K"
    echo -e "\033[K${BLUE}メインキュー:${NC}"
    echo -e "\033[K  待機中: ${MAIN_QUEUE}件"
    echo -e "\033[K  処理中: ${IN_FLIGHT}件"

    # プログレスバー
    echo -e "\033[K"
    show_progress $CURRENT_DLQ $INITIAL_DLQ

    # 完了チェック
    if [ "$CURRENT_DLQ" -eq "0" ]; then
        echo ""
        echo ""
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}🎉 DLQリカバリー完了！${NC}"
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "処理件数: ${PROCESSED}件"
        echo -e "所要時間: ${ELAPSED_MIN}分${ELAPSED_SEC}秒"
        echo -e "平均速度: ${RATE} msg/分"
        echo ""

        # Workerログ確認
        echo -e "${BLUE}最新のWorker処理状況:${NC}"
        aws logs tail /aws/ec2/instance/i-093467957171d5586 \
            --follow=false \
            --format short \
            --since 5m | tail -10

        break
    fi

    # 警告表示
    if [ "$RATE" -lt "10" ] && [ "$PROCESSED" -gt "10" ]; then
        echo ""
        echo -e "${RED}⚠️ 処理速度が遅い可能性があります${NC}"
        echo -e "${YELLOW}💡 ./optimize-recovery.sh で高速化できます${NC}"
    fi

    COUNTER=$((COUNTER + 1))

    # 更新間隔
    sleep 5

    # カーソル位置を戻す（20行上）
    echo -e "\033[20A"
done

echo ""
echo -e "${BLUE}次のステップ:${NC}"
echo "1. OpenSearchデータ確認: ./check-opensearch-simple.sh"
echo "2. Workerログ確認: aws logs tail worker-logs --follow"
echo "3. フロントエンドでの検索テスト"