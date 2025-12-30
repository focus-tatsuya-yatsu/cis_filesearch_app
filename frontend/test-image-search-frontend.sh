#!/bin/bash

echo "======================================"
echo "🔍 画像検索フロントエンドテスト"
echo "======================================"
echo ""

# テスト用の画像を生成（JPEGのダミー画像）
echo "📸 テスト用画像を生成中..."
python3 -c "
from PIL import Image
import numpy as np
import os

# テスト用ディレクトリ作成
os.makedirs('/tmp/test-images', exist_ok=True)

# 簡単なテスト画像生成
img = Image.fromarray(np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8), 'RGB')
img.save('/tmp/test-images/test.jpg', 'JPEG')
print('✅ テスト画像生成完了: /tmp/test-images/test.jpg')
" 2>/dev/null || echo "⚠️ PIL未インストール。既存の画像を使用してください。"

echo ""
echo "======================================"
echo "1️⃣ フロントエンド動作確認"
echo "======================================"

# フロントエンドの応答確認
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000)
if [ "$response" == "200" ]; then
    echo "✅ フロントエンドが正常に動作中 (http://localhost:3000)"
else
    echo "❌ フロントエンドが応答しません (Status: $response)"
    echo "   yarn dev を実行してください"
    exit 1
fi

echo ""
echo "======================================"
echo "2️⃣ API直接テスト（ランダムベクトル）"
echo "======================================"

# ランダムベクトルで画像検索テスト
vector=$(python3 -c "import random; random.seed(42); print(','.join([str(random.uniform(-1, 1)) for _ in range(1024)]))")

echo "🔍 画像検索APIをテスト中..."
response=$(curl -s -X POST "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d "{
    \"searchType\": \"image\",
    \"imageVector\": [$vector],
    \"limit\": 5
  }")

# 結果解析
success=$(echo "$response" | jq -r '.success')
total=$(echo "$response" | jq -r '.data.total')

if [ "$success" == "true" ]; then
    echo "✅ API応答成功"
    echo "📊 総結果数: $total"

    echo ""
    echo "🖼️ 検索結果（上位5件）:"
    echo "$response" | jq -r '.data.results[] | "  - \(.fileName) (部署: \(.department), スコア: \(.relevanceScore))"'
else
    echo "❌ API応答失敗:"
    echo "$response" | jq '.'
fi

echo ""
echo "======================================"
echo "3️⃣ テキスト検索機能確認"
echo "======================================"

echo "📝 テキスト検索をテスト中..."
text_response=$(curl -s -X POST "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search" \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{
    "q": "道路",
    "searchType": "text",
    "limit": 3
  }')

text_success=$(echo "$text_response" | jq -r '.success')
text_total=$(echo "$text_response" | jq -r '.data.total')

if [ "$text_success" == "true" ]; then
    echo "✅ テキスト検索成功"
    echo "📊 総結果数: $text_total"
    echo ""
    echo "📄 検索結果（上位3件）:"
    echo "$text_response" | jq -r '.data.results[] | "  - \(.fileName) (パス: \(.filePath | .[0:50])...)"' 2>/dev/null || echo "  結果表示エラー"
else
    echo "❌ テキスト検索失敗"
fi

echo ""
echo "======================================"
echo "4️⃣ メモリとパフォーマンス確認"
echo "======================================"

# Node.jsプロセスのメモリ使用量を確認
pid=$(lsof -i :3000 | grep LISTEN | awk '{print $2}' | head -1)
if [ -n "$pid" ]; then
    memory=$(ps -o rss= -p $pid | awk '{print $1/1024 " MB"}')
    echo "📊 Next.jsプロセスメモリ: $memory"
else
    echo "⚠️ プロセス情報を取得できません"
fi

# APIレスポンスタイム測定
echo ""
echo "⏱️ APIレスポンスタイム測定中..."
for i in {1..3}; do
    time=$(curl -s -o /dev/null -w "%{time_total}" -X POST "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search" \
      -H "Content-Type: application/json" \
      -H "Origin: http://localhost:3000" \
      -d "{\"searchType\":\"image\",\"imageVector\":[$vector],\"limit\":5}")
    echo "  テスト$i: ${time}秒"
done

echo ""
echo "======================================"
echo "5️⃣ フロントエンドでの確認手順"
echo "======================================"

echo "以下の手順で手動確認してください："
echo ""
echo "1. ブラウザで http://localhost:3000 を開く"
echo ""
echo "2. 画像検索タブをクリック"
echo ""
echo "3. 以下のいずれかの画像をアップロード："
echo "   - /tmp/test-images/test.jpg (テスト用)"
echo "   - 任意のJPEG/PNG画像"
echo ""
echo "4. 検索結果に以下が表示されることを確認："
echo "   ✓ ファイル名（例: CIMG0012.JPG）"
echo "   ✓ ファイルパス"
echo "   ✓ 部署（道路設計部）"
echo "   ✓ 類似度スコア"
echo ""
echo "5. パスコピー機能の動作確認"
echo "   - パス横のコピーアイコンをクリック"
echo "   - クリップボードにコピーされることを確認"
echo ""
echo "======================================"
echo "✅ 自動テスト完了"
echo "======================================"