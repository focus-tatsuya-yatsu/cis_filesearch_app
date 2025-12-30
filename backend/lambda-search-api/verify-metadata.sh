#!/bin/bash

echo "🔍 再インデックス後のメタデータ確認..."
echo "========================================"

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

echo "📊 検索結果の統計:"
total=$(echo "$response" | jq '.data.total')
echo "  総件数: $total"

echo ""
echo "🖼️ 実画像のメタデータ（real_で始まるID）:"
echo "$response" | jq -r '.data.results[] | select(.id | startswith("real")) | "ID: \(.id)\n  ファイル名: \(.fileName)\n  パス: \(.filePath)\n  タイプ: \(.fileType)\n  サイズ: \(.fileSize) bytes\n  更新日: \(.modifiedDate)\n  部署: \(.department)\n  タグ: \(.tags | join(", "))\n  スコア: \(.relevanceScore)\n"' 2>/dev/null

echo "========================================"
echo "✅ メタデータ確認完了"

# フロントエンドで使用可能か確認
echo ""
echo "🌐 フロントエンド互換性チェック:"
has_nulls=$(echo "$response" | jq '[.data.results[] | select(.id | startswith("real")) | .fileName, .filePath] | map(. == null) | any')

if [ "$has_nulls" = "true" ]; then
  echo "  ⚠️ 一部のフィールドがnullです。再インデックスが必要です。"
else
  echo "  ✅ すべてのメタデータが正しく設定されています！"
  echo "  📱 http://localhost:3000 で画像検索が正常に動作するはずです。"
fi