#!/bin/bash
# SQS処理進捗モニタリングスクリプト

echo "📊 SQS処理進捗モニター"
echo "========================"
echo ""

# 開始時のメッセージ数
START_COUNT=$(aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-northeast-1 \
  --query 'Attributes.ApproximateNumberOfMessages' \
  --output text)

START_TIME=$(date +%s)

echo "開始時刻: $(date)"
echo "開始時メッセージ数: $START_COUNT"
echo ""
echo "10分ごとに進捗を表示します（Ctrl+Cで終了）"
echo ""
echo "時刻 | 残メッセージ | 処理済み | 処理速度(/h) | 完了予想"
echo "--------------------------------------------------------------"

while true; do
  sleep 600  # 10分待機

  CURRENT_COUNT=$(aws sqs get-queue-attributes \
    --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
    --attribute-names ApproximateNumberOfMessages \
    --region ap-northeast-1 \
    --query 'Attributes.ApproximateNumberOfMessages' \
    --output text)

  CURRENT_TIME=$(date +%s)
  ELAPSED=$((CURRENT_TIME - START_TIME))
  PROCESSED=$((START_COUNT - CURRENT_COUNT))

  # 処理速度計算（メッセージ/時）
  if [ $ELAPSED -gt 0 ]; then
    RATE=$((PROCESSED * 3600 / ELAPSED))
  else
    RATE=0
  fi

  # 完了予想時間
  if [ $RATE -gt 0 ]; then
    REMAINING_HOURS=$((CURRENT_COUNT / RATE))
    REMAINING_DAYS=$((REMAINING_HOURS / 24))
    REMAINING_HOURS_MOD=$((REMAINING_HOURS % 24))
    ETA="${REMAINING_DAYS}日${REMAINING_HOURS_MOD}時間"
  else
    ETA="計算中..."
  fi

  echo "$(date +%H:%M) | $CURRENT_COUNT | $PROCESSED | $RATE/h | $ETA"

  # 完了判定
  if [ $CURRENT_COUNT -lt 100 ]; then
    echo ""
    echo "🎉 処理がほぼ完了しました！"
    echo "最終メッセージ数: $CURRENT_COUNT"
    break
  fi
done

echo ""
echo "監視終了: $(date)"