#!/bin/bash

# より詳しい検索テスト（20件取得して実画像を確認）

echo "🔍 画像検索テスト（20件取得）..."

# 1024次元のベクトル生成（異なる値）
vector=$(python3 -c "import random; random.seed(42); print(','.join([str(random.uniform(-1, 1)) for _ in range(1024)]))")

response=$(curl -s -X POST "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search" \
  -H "Content-Type: application/json" \
  -d "{
    \"imageVector\": [$vector],
    \"searchType\": \"image\",
    \"page\": 1,
    \"limit\": 20
  }")

# エラーの詳細を表示
echo "📝 完全なレスポンス:"
echo "$response" | jq '.' || echo "$response"

echo "✅ 成功ステータス:"
echo "$response" | jq '.success'

echo -e "\n📊 総結果数:"
echo "$response" | jq '.data.total'

echo -e "\n📄 実画像を検索中..."
echo "$response" | jq '.data.results[] | select(.fileName | contains("RIMG")) | {fileName, relevanceScore}'

echo -e "\n📑 すべての結果（ファイル名のみ）:"
echo "$response" | jq -r '.data.results[].fileName'