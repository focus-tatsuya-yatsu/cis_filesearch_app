#!/bin/bash
# リアルタイム進捗モニタリングスクリプト

# AWSプロファイル設定
export AWS_PROFILE=AdministratorAccess-770923989980
export AWS_REGION=ap-northeast-1

# 色設定
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# クリア画面関数
clear_screen() {
    printf "\033c"
}

# プログレスバー描画関数
draw_progress_bar() {
    local current=$1
    local total=$2
    local width=50

    if [ $total -eq 0 ]; then
        percentage=100
    else
        percentage=$((100 - (current * 100 / total)))
    fi

    filled=$((percentage * width / 100))
    empty=$((width - filled))

    printf "["
    printf "%0.s█" $(seq 1 $filled 2>/dev/null)
    printf "%0.s░" $(seq 1 $empty 2>/dev/null)
    printf "] %d%%" $percentage
}

# 開始時刻と初期メッセージ数
START_TIME=$(date +%s)
INITIAL_COUNT=$(aws sqs get-queue-attributes \
    --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
    --attribute-names ApproximateNumberOfMessages \
    --query 'Attributes.ApproximateNumberOfMessages' \
    --output text)

echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}          SQS メッセージ処理 リアルタイムモニター          ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}開始時刻:${NC} $(date)"
echo -e "${BLUE}初期メッセージ数:${NC} $(printf "%'d" $INITIAL_COUNT)"
echo ""
echo -e "${YELLOW}10秒ごとに更新します（Ctrl+Cで終了）${NC}"
echo ""

# メイン監視ループ
LOOP_COUNT=0
while true; do
    LOOP_COUNT=$((LOOP_COUNT + 1))

    # 現在の統計取得
    CURRENT_COUNT=$(aws sqs get-queue-attributes \
        --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
        --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
        --query 'Attributes.ApproximateNumberOfMessages' \
        --output text)

    IN_FLIGHT=$(aws sqs get-queue-attributes \
        --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
        --attribute-names ApproximateNumberOfMessagesNotVisible \
        --query 'Attributes.ApproximateNumberOfMessagesNotVisible' \
        --output text)

    DLQ_COUNT=$(aws sqs get-queue-attributes \
        --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq \
        --attribute-names ApproximateNumberOfMessages \
        --query 'Attributes.ApproximateNumberOfMessages' \
        --output text 2>/dev/null || echo "0")

    # 統計計算
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))
    PROCESSED=$((INITIAL_COUNT - CURRENT_COUNT))

    # 処理速度（メッセージ/分）
    if [ $ELAPSED -gt 0 ]; then
        RATE_PER_MIN=$((PROCESSED * 60 / ELAPSED))
        RATE_PER_HOUR=$((PROCESSED * 3600 / ELAPSED))
    else
        RATE_PER_MIN=0
        RATE_PER_HOUR=0
    fi

    # 残り時間推定
    if [ $RATE_PER_MIN -gt 0 ]; then
        REMAINING_MINS=$((CURRENT_COUNT / RATE_PER_MIN))
        REMAINING_HOURS=$((REMAINING_MINS / 60))
        REMAINING_DAYS=$((REMAINING_HOURS / 24))
        REMAINING_HOURS_MOD=$((REMAINING_HOURS % 24))
        REMAINING_MINS_MOD=$((REMAINING_MINS % 60))

        if [ $REMAINING_DAYS -gt 0 ]; then
            ETA="${REMAINING_DAYS}日 ${REMAINING_HOURS_MOD}時間 ${REMAINING_MINS_MOD}分"
        elif [ $REMAINING_HOURS -gt 0 ]; then
            ETA="${REMAINING_HOURS}時間 ${REMAINING_MINS_MOD}分"
        else
            ETA="${REMAINING_MINS}分"
        fi
    else
        ETA="計算中..."
    fi

    # 経過時間フォーマット
    ELAPSED_HOURS=$((ELAPSED / 3600))
    ELAPSED_MINS=$(((ELAPSED % 3600) / 60))
    ELAPSED_SECS=$((ELAPSED % 60))
    ELAPSED_STR=$(printf "%02d:%02d:%02d" $ELAPSED_HOURS $ELAPSED_MINS $ELAPSED_SECS)

    # 画面クリアと再描画
    clear_screen

    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}          SQS メッセージ処理 リアルタイムモニター          ${NC}"
    echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
    echo ""

    # 現在時刻
    echo -e "${BLUE}現在時刻:${NC} $(date '+%Y-%m-%d %H:%M:%S')"
    echo -e "${BLUE}経過時間:${NC} $ELAPSED_STR"
    echo ""

    # メッセージ統計
    echo -e "${YELLOW}▶ メッセージ統計${NC}"
    echo -e "  残りメッセージ:    $(printf "%'7d" $CURRENT_COUNT)"
    echo -e "  処理中:           $(printf "%'7d" $IN_FLIGHT)"
    echo -e "  処理済み:         $(printf "%'7d" $PROCESSED)"
    echo -e "  DLQメッセージ:    $(printf "%'7d" $DLQ_COUNT)"
    echo ""

    # 処理速度
    echo -e "${YELLOW}▶ 処理速度${NC}"
    echo -e "  毎分:  $(printf "%'d" $RATE_PER_MIN) メッセージ/分"
    echo -e "  毎時:  $(printf "%'d" $RATE_PER_HOUR) メッセージ/時"
    echo ""

    # プログレスバー
    echo -e "${YELLOW}▶ 進捗状況${NC}"
    echo -n "  "
    draw_progress_bar $CURRENT_COUNT $INITIAL_COUNT
    echo ""
    echo ""

    # 完了予想
    echo -e "${YELLOW}▶ 完了予想時刻${NC}"
    echo -e "  残り時間: $ETA"

    if [ $RATE_PER_MIN -gt 0 ]; then
        COMPLETION_TIME=$((CURRENT_TIME + REMAINING_MINS * 60))
        COMPLETION_DATE=$(date -d "@$COMPLETION_TIME" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r $COMPLETION_TIME '+%Y-%m-%d %H:%M:%S')
        echo -e "  完了予想: $COMPLETION_DATE"
    fi
    echo ""

    # EC2インスタンス状態
    echo -e "${YELLOW}▶ ワーカー状態${NC}"
    INSTANCE_ID=$(aws autoscaling describe-auto-scaling-groups \
        --auto-scaling-group-names cis-filesearch-ec2-autoscaling \
        --query 'AutoScalingGroups[0].Instances[0].InstanceId' \
        --output text 2>/dev/null || echo "Unknown")

    if [ "$INSTANCE_ID" != "Unknown" ] && [ "$INSTANCE_ID" != "None" ]; then
        INSTANCE_STATE=$(aws ec2 describe-instances \
            --instance-ids $INSTANCE_ID \
            --query 'Reservations[0].Instances[0].State.Name' \
            --output text 2>/dev/null || echo "Unknown")
        echo -e "  インスタンスID: $INSTANCE_ID"
        echo -e "  状態: $INSTANCE_STATE"
    else
        echo -e "  状態: 確認不可"
    fi
    echo ""

    # 警告チェック
    if [ $DLQ_COUNT -gt 100 ]; then
        echo -e "${RED}⚠ 警告: DLQに多数のメッセージがあります！${NC}"
    fi

    if [ $RATE_PER_MIN -lt 10 ] && [ $LOOP_COUNT -gt 6 ]; then
        echo -e "${RED}⚠ 警告: 処理速度が低下しています！${NC}"
    fi

    # 完了判定
    if [ $CURRENT_COUNT -lt 100 ]; then
        echo ""
        echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
        echo -e "${GREEN}    🎉 処理がほぼ完了しました！ 🎉${NC}"
        echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
        echo -e "  最終メッセージ数: $CURRENT_COUNT"
        echo -e "  総処理数: $(printf "%'d" $PROCESSED)"
        echo -e "  処理時間: $ELAPSED_STR"
        echo -e "  平均速度: $(printf "%'d" $RATE_PER_HOUR) メッセージ/時"
        echo ""
        exit 0
    fi

    # 次の更新まで待機
    echo -e "${NC}次回更新まで10秒..."
    sleep 10
done