#!/bin/bash
# DLQリカバリースクリプト - 8,158件のメッセージを処理

set -e

echo "🔧 DLQリカバリープロセス"
echo "========================"

export AWS_PROFILE=AdministratorAccess-770923989980
export AWS_REGION=ap-northeast-1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

DLQ_URL="https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq"
MAIN_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"

# Step 1: DLQの状態確認
echo -e "${BLUE}Step 1: DLQ状態確認${NC}"

DLQ_COUNT=$(aws sqs get-queue-attributes \
    --queue-url $DLQ_URL \
    --attribute-names ApproximateNumberOfMessages \
    --region $AWS_REGION \
    --output text --query 'Attributes.ApproximateNumberOfMessages')

echo -e "DLQメッセージ数: ${RED}${DLQ_COUNT}${NC}"
echo ""

if [ "$DLQ_COUNT" -eq "0" ]; then
    echo -e "${GREEN}✅ DLQは空です${NC}"
    exit 0
fi

# Step 2: リカバリー確認
echo -e "${YELLOW}警告: ${DLQ_COUNT}件のメッセージを再処理します${NC}"
echo "これらのメッセージは処理に失敗したものです"
echo ""

read -p "DLQメッセージをメインキューに戻しますか？ (y/n): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "キャンセルされました"
    exit 0
fi

# Step 3: DLQメッセージを段階的に移動
echo -e "${GREEN}Step 3: DLQメッセージの段階的リカバリー${NC}"

BATCH_SIZE=10
TOTAL_MOVED=0
MAX_BATCHES=100  # 最大1000メッセージまで（安全のため）

echo "バッチサイズ: ${BATCH_SIZE}メッセージ"
echo "最大バッチ数: ${MAX_BATCHES}"
echo ""

for ((i=1; i<=MAX_BATCHES; i++)); do
    # メッセージ受信
    MESSAGES=$(aws sqs receive-message \
        --queue-url $DLQ_URL \
        --max-number-of-messages $BATCH_SIZE \
        --region $AWS_REGION \
        --output json)

    # メッセージが無い場合は終了
    if [ -z "$MESSAGES" ] || [ "$MESSAGES" = "{}" ]; then
        echo "これ以上メッセージはありません"
        break
    fi

    MESSAGE_COUNT=$(echo "$MESSAGES" | jq '.Messages | length')

    if [ "$MESSAGE_COUNT" -eq "0" ]; then
        echo "メッセージが無くなりました"
        break
    fi

    echo -e "バッチ ${i}: ${MESSAGE_COUNT}件処理中..."

    # 各メッセージを処理
    echo "$MESSAGES" | jq -c '.Messages[]' | while read -r message; do
        # メッセージ本文を抽出
        BODY=$(echo "$message" | jq -r '.Body')
        RECEIPT_HANDLE=$(echo "$message" | jq -r '.ReceiptHandle')

        # エラー情報を解析
        IS_ERROR_WRAPPER=$(echo "$BODY" | jq -r 'has("original_message")')

        if [ "$IS_ERROR_WRAPPER" = "true" ]; then
            # エラーラッパーから元のメッセージを抽出
            ORIGINAL_MESSAGE=$(echo "$BODY" | jq -r '.original_message.Body')
            ERROR_MSG=$(echo "$BODY" | jq -r '.error')

            echo "  エラー修正: ${ERROR_MSG}"

            # 元のメッセージをメインキューに送信
            aws sqs send-message \
                --queue-url $MAIN_QUEUE_URL \
                --message-body "$ORIGINAL_MESSAGE" \
                --region $AWS_REGION > /dev/null
        else
            # 通常のメッセージをそのまま送信
            aws sqs send-message \
                --queue-url $MAIN_QUEUE_URL \
                --message-body "$BODY" \
                --region $AWS_REGION > /dev/null
        fi

        # DLQから削除
        aws sqs delete-message \
            --queue-url $DLQ_URL \
            --receipt-handle "$RECEIPT_HANDLE" \
            --region $AWS_REGION

        TOTAL_MOVED=$((TOTAL_MOVED + 1))
    done

    echo -e "  ${GREEN}✓${NC} ${MESSAGE_COUNT}件移動完了"

    # 処理速度調整（過負荷防止）
    if [ $((i % 10)) -eq 0 ]; then
        echo ""
        echo "進捗: ${TOTAL_MOVED}件処理済み"

        # メインキューの状態確認
        MAIN_COUNT=$(aws sqs get-queue-attributes \
            --queue-url $MAIN_QUEUE_URL \
            --attribute-names ApproximateNumberOfMessages \
            --region $AWS_REGION \
            --output text --query 'Attributes.ApproximateNumberOfMessages')

        echo "メインキュー: ${MAIN_COUNT}件待機中"

        if [ "$MAIN_COUNT" -gt "1000" ]; then
            echo -e "${YELLOW}⚠ メインキューが混雑しています。30秒待機...${NC}"
            sleep 30
        fi
        echo ""
    fi

    # 短い待機（API制限対策）
    sleep 1
done

# Step 4: 最終確認
echo ""
echo -e "${BLUE}Step 4: 最終確認${NC}"

# 最終的なDLQカウント
FINAL_DLQ_COUNT=$(aws sqs get-queue-attributes \
    --queue-url $DLQ_URL \
    --attribute-names ApproximateNumberOfMessages \
    --region $AWS_REGION \
    --output text --query 'Attributes.ApproximateNumberOfMessages')

# メインキューカウント
FINAL_MAIN_COUNT=$(aws sqs get-queue-attributes \
    --queue-url $MAIN_QUEUE_URL \
    --attribute-names ApproximateNumberOfMessages \
    --region $AWS_REGION \
    --output text --query 'Attributes.ApproximateNumberOfMessages')

echo ""
echo "================================"
echo -e "${GREEN}リカバリー完了${NC}"
echo "================================"
echo "移動したメッセージ: ${TOTAL_MOVED}件"
echo "残りのDLQメッセージ: ${FINAL_DLQ_COUNT}件"
echo "メインキューメッセージ: ${FINAL_MAIN_COUNT}件"
echo ""

if [ "$FINAL_DLQ_COUNT" -gt "0" ]; then
    echo -e "${YELLOW}注意: まだ${FINAL_DLQ_COUNT}件のメッセージがDLQに残っています${NC}"
    echo "すべて処理するには、このスクリプトを再実行してください"
else
    echo -e "${GREEN}✅ DLQは完全に空になりました！${NC}"
fi

echo ""
echo "次のステップ:"
echo "1. メインキューの処理状況を監視"
echo "2. worker-logsでエラーを確認"
echo "3. 必要に応じて処理能力をスケールアップ"