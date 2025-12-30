#!/bin/bash
# DLQリカバリー高速化スクリプト - 5-10倍速化

set -e

export AWS_PROFILE=AdministratorAccess-770923989980
export AWS_REGION=ap-northeast-1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

DLQ_URL="https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq"
MAIN_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}     DLQリカバリー高速化ツール (5-10倍速)     ${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 現在のDLQ数を確認
CURRENT_DLQ=$(aws sqs get-queue-attributes \
    --queue-url $DLQ_URL \
    --attribute-names ApproximateNumberOfMessages \
    --region $AWS_REGION \
    --output text --query 'Attributes.ApproximateNumberOfMessages')

echo -e "${BLUE}現在のDLQメッセージ数: ${YELLOW}${CURRENT_DLQ}件${NC}"
echo ""

if [ "$CURRENT_DLQ" -eq "0" ]; then
    echo -e "${GREEN}✅ DLQは既に空です！${NC}"
    exit 0
fi

echo -e "${YELLOW}⚡ 高速化オプション:${NC}"
echo "1. 並列処理モード（推奨） - 5並列でバッチ処理"
echo "2. バーストモード - 最大限の速度で処理"
echo "3. Lambda並列処理 - Lambda関数で超高速処理"
echo ""

read -p "オプションを選択 (1-3): " -n 1 -r OPTION
echo ""
echo ""

case $OPTION in
    1)
        echo -e "${GREEN}並列処理モードを開始${NC}"
        echo "5つの並列プロセスでDLQを処理します"
        echo ""

        # 並列処理スクリプト作成
        cat > /tmp/parallel_dlq_processor.sh << 'EOF'
#!/bin/bash
PROCESS_ID=$1
DLQ_URL=$2
MAIN_QUEUE_URL=$3
BATCH_SIZE=10
PROCESSED=0

echo "[Process $PROCESS_ID] 開始"

while true; do
    # メッセージ受信
    MESSAGES=$(aws sqs receive-message \
        --queue-url $DLQ_URL \
        --max-number-of-messages $BATCH_SIZE \
        --region ap-northeast-1 \
        --output json 2>/dev/null)

    if [ -z "$MESSAGES" ] || [ "$MESSAGES" = "{}" ]; then
        break
    fi

    MESSAGE_COUNT=$(echo "$MESSAGES" | jq '.Messages | length')

    if [ "$MESSAGE_COUNT" -eq "0" ]; then
        break
    fi

    # バッチ処理
    echo "$MESSAGES" | jq -c '.Messages[]' | while read -r message; do
        BODY=$(echo "$message" | jq -r '.Body')
        RECEIPT_HANDLE=$(echo "$message" | jq -r '.ReceiptHandle')

        # メインキューに送信
        aws sqs send-message \
            --queue-url $MAIN_QUEUE_URL \
            --message-body "$BODY" \
            --region ap-northeast-1 > /dev/null

        # DLQから削除
        aws sqs delete-message \
            --queue-url $DLQ_URL \
            --receipt-handle "$RECEIPT_HANDLE" \
            --region ap-northeast-1

        PROCESSED=$((PROCESSED + 1))
    done

    echo "[Process $PROCESS_ID] ${MESSAGE_COUNT}件処理 (合計: $PROCESSED)"
done

echo "[Process $PROCESS_ID] 完了 (処理済み: $PROCESSED件)"
EOF

        chmod +x /tmp/parallel_dlq_processor.sh

        # 5つの並列プロセスを起動
        echo -e "${BLUE}並列プロセス起動中...${NC}"
        for i in {1..5}; do
            /tmp/parallel_dlq_processor.sh $i "$DLQ_URL" "$MAIN_QUEUE_URL" &
            PIDS[$i]=$!
            echo "Process $i: PID ${PIDS[$i]}"
        done

        echo ""
        echo -e "${YELLOW}処理中... (Ctrl+Cで中断)${NC}"

        # 進捗モニタリング
        while true; do
            REMAINING=$(aws sqs get-queue-attributes \
                --queue-url $DLQ_URL \
                --attribute-names ApproximateNumberOfMessages \
                --region $AWS_REGION \
                --output text --query 'Attributes.ApproximateNumberOfMessages')

            if [ "$REMAINING" -eq "0" ]; then
                echo -e "\r${GREEN}✅ 完了！すべてのメッセージを処理しました${NC}"
                break
            fi

            PROCESSED=$((CURRENT_DLQ - REMAINING))
            PERCENT=$((PROCESSED * 100 / CURRENT_DLQ))
            echo -ne "\r進捗: [${PROCESSED}/${CURRENT_DLQ}] ${PERCENT}% | 残り: ${REMAINING}件"

            sleep 2
        done

        # プロセス終了待ち
        for pid in ${PIDS[@]}; do
            wait $pid 2>/dev/null
        done
        ;;

    2)
        echo -e "${GREEN}バーストモードを開始${NC}"
        echo "最大速度でメッセージを転送します"
        echo ""

        BATCH_SIZE=10  # SQSの最大値
        TOTAL_PROCESSED=0
        START_TIME=$(date +%s)

        while [ "$CURRENT_DLQ" -gt "0" ]; do
            # 10メッセージずつ高速処理
            for i in {1..10}; do
                MESSAGES=$(aws sqs receive-message \
                    --queue-url $DLQ_URL \
                    --max-number-of-messages $BATCH_SIZE \
                    --region $AWS_REGION \
                    --visibility-timeout 60 \
                    --output json 2>/dev/null)

                if [ -z "$MESSAGES" ] || [ "$MESSAGES" = "{}" ]; then
                    break 2
                fi

                # 高速バッチ送信・削除
                echo "$MESSAGES" | jq -c '.Messages[]' | \
                while read -r message; do
                    BODY=$(echo "$message" | jq -r '.Body')
                    RECEIPT=$(echo "$message" | jq -r '.ReceiptHandle')

                    # 非同期送信
                    aws sqs send-message \
                        --queue-url $MAIN_QUEUE_URL \
                        --message-body "$BODY" \
                        --region $AWS_REGION > /dev/null &

                    # 即座に削除
                    aws sqs delete-message \
                        --queue-url $DLQ_URL \
                        --receipt-handle "$RECEIPT" \
                        --region $AWS_REGION &

                    TOTAL_PROCESSED=$((TOTAL_PROCESSED + 1))
                done

                # バックグラウンドジョブ待ち
                wait

                echo -ne "\r処理済み: ${TOTAL_PROCESSED}件"
            done

            # 現在のDLQ数を更新
            CURRENT_DLQ=$(aws sqs get-queue-attributes \
                --queue-url $DLQ_URL \
                --attribute-names ApproximateNumberOfMessages \
                --region $AWS_REGION \
                --output text --query 'Attributes.ApproximateNumberOfMessages')
        done

        END_TIME=$(date +%s)
        ELAPSED=$((END_TIME - START_TIME))
        echo ""
        echo -e "${GREEN}✅ バースト処理完了！${NC}"
        echo "処理件数: ${TOTAL_PROCESSED}件"
        echo "所要時間: ${ELAPSED}秒"
        echo "処理速度: $((TOTAL_PROCESSED * 60 / ELAPSED)) msg/分"
        ;;

    3)
        echo -e "${GREEN}Lambda並列処理を準備${NC}"
        echo ""

        # Lambda関数コード作成
        cat > /tmp/dlq_lambda.py << 'EOF'
import boto3
import json
import os

sqs = boto3.client('sqs', region_name='ap-northeast-1')

DLQ_URL = os.environ['DLQ_URL']
MAIN_QUEUE_URL = os.environ['MAIN_QUEUE_URL']

def lambda_handler(event, context):
    batch_size = 10
    processed = 0

    for _ in range(10):  # 各Lambda実行で最大100メッセージ
        response = sqs.receive_message(
            QueueUrl=DLQ_URL,
            MaxNumberOfMessages=batch_size,
            VisibilityTimeout=60
        )

        messages = response.get('Messages', [])
        if not messages:
            break

        # バッチ処理
        for message in messages:
            # メインキューに送信
            sqs.send_message(
                QueueUrl=MAIN_QUEUE_URL,
                MessageBody=message['Body']
            )

            # DLQから削除
            sqs.delete_message(
                QueueUrl=DLQ_URL,
                ReceiptHandle=message['ReceiptHandle']
            )

            processed += 1

    return {
        'statusCode': 200,
        'body': json.dumps(f'Processed {processed} messages')
    }
EOF

        echo -e "${YELLOW}Lambda関数の手動デプロイが必要です:${NC}"
        echo ""
        echo "1. AWS Lambdaコンソールを開く"
        echo "2. 新規関数作成（Python 3.9）"
        echo "3. /tmp/dlq_lambda.py のコードをコピー"
        echo "4. 環境変数を設定:"
        echo "   DLQ_URL=$DLQ_URL"
        echo "   MAIN_QUEUE_URL=$MAIN_QUEUE_URL"
        echo "5. 実行ロールにSQS権限を追加"
        echo "6. 並列実行数を10-20に設定"
        echo ""
        echo "設定後、以下のコマンドで並列実行:"
        echo -e "${CYAN}for i in {1..20}; do aws lambda invoke --function-name dlq-processor --async /dev/null; done${NC}"
        ;;

    *)
        echo -e "${RED}無効なオプションです${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# 最終確認
FINAL_DLQ=$(aws sqs get-queue-attributes \
    --queue-url $DLQ_URL \
    --attribute-names ApproximateNumberOfMessages \
    --region $AWS_REGION \
    --output text --query 'Attributes.ApproximateNumberOfMessages')

echo ""
if [ "$FINAL_DLQ" -eq "0" ]; then
    echo -e "${GREEN}🎉 DLQリカバリー完全完了！${NC}"
else
    echo -e "${YELLOW}残りDLQメッセージ: ${FINAL_DLQ}件${NC}"
    echo "必要に応じて再実行してください"
fi