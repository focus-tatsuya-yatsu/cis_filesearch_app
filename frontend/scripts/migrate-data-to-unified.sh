#!/bin/bash

# データ移行スクリプト
# cis-filesインデックスからcis-files-unifiedインデックスへデータを移行

ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
SOURCE_INDEX="cis-files"
TARGET_INDEX="cis-files-unified"

echo "==================================="
echo "データ移行開始"
echo "移行元: $SOURCE_INDEX"
echo "移行先: $TARGET_INDEX"
echo "==================================="

# 移行前のドキュメント数を確認
echo "移行前のドキュメント数を確認中..."
SOURCE_COUNT=$(curl -s "$ENDPOINT/$SOURCE_INDEX/_count" | grep -o '"count":[0-9]*' | cut -d: -f2)
echo "移行元のドキュメント数: $SOURCE_COUNT"

# Reindex APIを使用してデータを移行
echo ""
echo "データ移行を開始します..."
echo "この処理には時間がかかる場合があります..."

RESPONSE=$(curl -X POST "$ENDPOINT/_reindex?wait_for_completion=false" \
  -H "Content-Type: application/json" \
  -d "{
    \"source\": {
      \"index\": \"$SOURCE_INDEX\"
    },
    \"dest\": {
      \"index\": \"$TARGET_INDEX\"
    }
  }")

# タスクIDを取得
TASK_ID=$(echo $RESPONSE | grep -o '"task":"[^"]*' | cut -d'"' -f4)
echo "移行タスクID: $TASK_ID"

# 移行の進捗を確認
echo ""
echo "移行進捗を監視中..."
while true; do
  TASK_STATUS=$(curl -s "$ENDPOINT/_tasks/$TASK_ID")
  COMPLETED=$(echo $TASK_STATUS | grep -o '"completed":true')

  if [ ! -z "$COMPLETED" ]; then
    echo "移行が完了しました！"
    break
  fi

  # 進捗を表示
  CREATED=$(echo $TASK_STATUS | grep -o '"created":[0-9]*' | cut -d: -f2)
  if [ ! -z "$CREATED" ]; then
    echo "処理済みドキュメント: $CREATED / $SOURCE_COUNT"
  fi

  sleep 5
done

# 移行後のドキュメント数を確認
echo ""
echo "移行後のドキュメント数を確認中..."
TARGET_COUNT=$(curl -s "$ENDPOINT/$TARGET_INDEX/_count" | grep -o '"count":[0-9]*' | cut -d: -f2)
echo "移行先のドキュメント数: $TARGET_COUNT"

# サンプルドキュメントを確認
echo ""
echo "サンプルドキュメントを確認中..."
curl -X GET "$ENDPOINT/$TARGET_INDEX/_search?size=1&pretty"

echo ""
echo "==================================="
echo "データ移行が完了しました"
echo "移行されたドキュメント: $TARGET_COUNT 件"
echo "==================================="