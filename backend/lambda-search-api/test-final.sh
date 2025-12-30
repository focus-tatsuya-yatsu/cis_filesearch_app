#!/bin/bash

echo "🔍 最終画像検索テスト..."
echo "======================================"

# 1024次元のランダムベクトル生成
vector=$(python3 -c "import random; random.seed(123); print(','.join([str(random.uniform(-1, 1)) for _ in range(1024)]))")

# 検索実行
response=$(curl -s -X POST "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search" \
  -H "Content-Type: application/json" \
  -d "{
    \"imageVector\": [$vector],
    \"searchType\": \"image\",
    \"page\": 1,
    \"limit\": 20
  }")

# 成功確認
success=$(echo "$response" | jq '.success')
total=$(echo "$response" | jq '.data.total')

echo "✅ 成功ステータス: $success"
echo "📊 総結果数: $total"
echo ""

# 実画像を探す（real_imgで始まるID）
echo "🖼️  実画像（RIMG）の検索結果:"
echo "$response" | jq '.data.results[] | select(.id | startswith("real")) | {id, fileName, relevanceScore}' 2>/dev/null

echo ""
echo "🏷️  サンプル画像の検索結果（最初の3件）:"
echo "$response" | jq '.data.results[] | select(.id | startswith("real") | not) | {id, fileName, relevanceScore}' 2>/dev/null | head -15

echo ""
echo "📋 全結果のファイル名一覧:"
echo "$response" | jq -r '.data.results[].fileName' 2>/dev/null || echo "（ファイル名が取得できません）"

echo ""
echo "======================================"
echo "✅ テスト完了"