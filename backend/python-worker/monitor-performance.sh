#!/bin/bash
# パフォーマンス監視スクリプト - 現在の高速処理を継続監視

set -e

export AWS_PROFILE=AdministratorAccess-770923989980
export AWS_REGION=ap-northeast-1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
NC='\033[0m'

# 現在のインスタンス
INSTANCE_ID="i-0f0e561633f2e4c03"
QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
DLQ_URL="https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq"

echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${MAGENTA}  CIS File Search - リアルタイムパフォーマンスモニター  ${NC}"
echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# パフォーマンス目標
TARGET_RATE=500
HIGH_PERF_RATE=5000
CURRENT_BEST=7109

echo -e "${YELLOW}📊 パフォーマンス基準:${NC}"
echo -e "  最小目標: ${TARGET_RATE} msg/分"
echo -e "  高性能: ${HIGH_PERF_RATE} msg/分"
echo -e "  現在の記録: ${GREEN}${CURRENT_BEST} msg/分${NC} 🚀"
echo ""

# 継続監視関数
monitor_loop() {
    local iteration=0
    local total_processed=0
    local start_time=$(date +%s)
    local measurements=()

    while true; do
        iteration=$((iteration + 1))

        # ヘッダー表示
        clear
        echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${MAGENTA}  パフォーマンスモニター - $(date '+%Y-%m-%d %H:%M:%S')  ${NC}"
        echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""

        # 測定開始
        START=$(aws sqs get-queue-attributes \
            --queue-url $QUEUE_URL \
            --attribute-names ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible \
            --query 'Attributes.ApproximateNumberOfMessages' \
            --output text)

        # 30秒待機
        echo -e "${BLUE}⏱  30秒間測定中...${NC}"
        sleep 30

        # 測定終了
        END=$(aws sqs get-queue-attributes \
            --queue-url $QUEUE_URL \
            --attribute-names ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible \
            --query 'Attributes.ApproximateNumberOfMessages' \
            --output text)

        # 処理速度計算
        if [ "$START" -gt "$END" ]; then
            PROCESSED=$((START - END))
            RATE=$((PROCESSED * 2))  # msg/分に変換
            total_processed=$((total_processed + PROCESSED))
            measurements+=($RATE)
        else
            RATE=0
        fi

        # DLQ状態
        DLQ_COUNT=$(aws sqs get-queue-attributes \
            --queue-url $DLQ_URL \
            --attribute-names ApproximateNumberOfMessages \
            --query 'Attributes.ApproximateNumberOfMessages' \
            --output text)

        # パフォーマンス評価
        if [ "$RATE" -ge "$CURRENT_BEST" ]; then
            STATUS="${GREEN}🚀 新記録！${NC}"
            CURRENT_BEST=$RATE
        elif [ "$RATE" -ge "$HIGH_PERF_RATE" ]; then
            STATUS="${GREEN}✅ 高性能${NC}"
        elif [ "$RATE" -ge "$TARGET_RATE" ]; then
            STATUS="${YELLOW}⚡ 正常${NC}"
        elif [ "$RATE" -gt 0 ]; then
            STATUS="${RED}⚠️  低速${NC}"
        else
            STATUS="${RED}❌ 停止${NC}"
        fi

        # 結果表示
        echo ""
        echo -e "${BLUE}📊 現在のパフォーマンス:${NC}"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        printf "処理速度: %s%'d msg/分%s %s\n" "${GREEN}" "$RATE" "${NC}" "$STATUS"
        printf "残りメッセージ: %'d\n" "$END"
        printf "DLQメッセージ: %'d\n" "$DLQ_COUNT"
        echo ""

        # 統計情報
        if [ ${#measurements[@]} -gt 0 ]; then
            # 平均値計算
            local sum=0
            local max=0
            local min=999999
            for m in "${measurements[@]}"; do
                sum=$((sum + m))
                [ "$m" -gt "$max" ] && max=$m
                [ "$m" -lt "$min" ] && min=$m
            done
            local avg=$((sum / ${#measurements[@]}))

            echo -e "${BLUE}📈 統計情報:${NC}"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            printf "平均速度: %'d msg/分\n" "$avg"
            printf "最高速度: %'d msg/分\n" "$max"
            printf "最低速度: %'d msg/分\n" "$min"
            printf "測定回数: %d回\n" "${#measurements[@]}"

            # 実行時間
            local current_time=$(date +%s)
            local elapsed=$((current_time - start_time))
            local hours=$((elapsed / 3600))
            local minutes=$(( (elapsed % 3600) / 60 ))
            local seconds=$((elapsed % 60))
            printf "実行時間: %02d:%02d:%02d\n" "$hours" "$minutes" "$seconds"
            printf "総処理数: %'d messages\n" "$total_processed"
        fi

        echo ""

        # 警告チェック
        if [ "$RATE" -lt "$TARGET_RATE" ] && [ "$RATE" -gt 0 ]; then
            echo -e "${YELLOW}⚠️  警告: 処理速度が目標を下回っています${NC}"
        fi

        if [ "$DLQ_COUNT" -gt 1000 ]; then
            echo -e "${RED}⚠️  警告: DLQにメッセージが蓄積しています${NC}"
        fi

        # インスタンス状態確認（5分ごと）
        if [ $((iteration % 10)) -eq 0 ]; then
            echo ""
            echo -e "${BLUE}🔍 インスタンス状態確認:${NC}"
            aws ec2 describe-instances \
                --instance-ids $INSTANCE_ID \
                --query 'Reservations[0].Instances[0].State.Name' \
                --output text
        fi

        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "Ctrl+Cで終了 | 30秒ごとに自動更新"

        # 最高記録更新時は通知音
        if [ "$RATE" -ge "$CURRENT_BEST" ] && [ "$RATE" -gt 0 ]; then
            printf '\a'  # ビープ音
        fi
    done
}

# キーボード割り込みハンドラ
trap 'echo -e "\n\n${GREEN}✅ 監視終了${NC}\n"; exit 0' INT

# メイン処理
echo -e "${GREEN}🚀 監視開始...${NC}"
echo ""

# 初期状態表示
echo -e "${BLUE}📍 監視対象:${NC}"
echo "  インスタンス: $INSTANCE_ID"
echo "  Queue URL: $QUEUE_URL"
echo ""

# 監視ループ開始
monitor_loop