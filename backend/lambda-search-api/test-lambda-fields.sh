#!/bin/bash

echo "🔍 Lambda関数のレスポンスフィールドを確認..."
echo "========================================"

# 1024次元のランダムベクトル生成（短縮版）
vector=$(python3 -c "import random; random.seed(123); print(','.join([str(random.uniform(-1, 1)) for _ in range(1024)]))")

# 検索実行して、最初の結果の構造を確認
echo "📊 画像検索レスポンスのフィールド構造:"
response=$(curl -s -X POST "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search" \
  -H "Content-Type: application/json" \
  -d "{
    \"imageVector\": [$vector],
    \"searchType\": \"image\",
    \"page\": 1,
    \"limit\": 1
  }")

echo "$response" | jq '.data.results[0] | keys'

echo ""
echo "📄 実際のレスポンス内容（最初の1件）:"
echo "$response" | jq '.data.results[0]'

echo ""
echo "🖼️ 実画像の検索結果（real_で始まるID）:"
response_real=$(curl -s -X POST "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search" \
  -H "Content-Type: application/json" \
  -d "{
    \"imageVector\": [$vector],
    \"searchType\": \"image\",
    \"page\": 1,
    \"limit\": 20
  }")

echo "$response_real" | jq '.data.results[] | select(.id | startswith("real")) | {id, fileName, filePath, fileType}'

echo ""
echo "========================================"
echo "✅ フィールド確認完了"