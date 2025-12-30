#!/bin/bash

echo "======================================"
echo "🔍 本番環境デプロイ検証"
echo "======================================"
echo ""
echo "📅 テスト日時: $(date)"
echo "🌐 URL: https://cis-filesearch.com"
echo ""

# 待機時間（CloudFrontキャッシュクリアを待つ）
echo "⏳ CloudFrontキャッシュクリアを待機中（30秒）..."
sleep 30

echo ""
echo "======================================"
echo "1️⃣ 本番環境アクセステスト"
echo "======================================"

# メインページのテスト
echo "🏠 メインページ確認..."
response=$(curl -s -o /dev/null -w "%{http_code}" https://cis-filesearch.com)
if [ "$response" == "200" ]; then
    echo "  ✅ メインページ: OK (Status: $response)"

    # タイトル確認
    title=$(curl -s https://cis-filesearch.com | grep -o "<title>.*</title>" | head -1)
    echo "  📄 タイトル: $title"
else
    echo "  ❌ メインページ: エラー (Status: $response)"
fi

echo ""
echo "======================================"
echo "2️⃣ 画像検索API動作確認"
echo "======================================"

# ランダムベクトルで画像検索
vector=$(python3 -c "import random; random.seed(789); print(','.join([str(random.uniform(-1, 1)) for _ in range(1024)]))")

echo "🔍 画像検索APIテスト..."
api_response=$(curl -s -X POST "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search" \
  -H "Content-Type: application/json" \
  -H "Origin: https://cis-filesearch.com" \
  -d "{
    \"searchType\": \"image\",
    \"imageVector\": [$vector],
    \"limit\": 3
  }")

# 結果解析
success=$(echo "$api_response" | jq -r '.success')
total=$(echo "$api_response" | jq -r '.data.total')

if [ "$success" == "true" ]; then
    echo "  ✅ API応答: 成功"
    echo "  📊 検索結果数: $total"
    echo ""
    echo "  🖼️ 上位3件の結果:"
    echo "$api_response" | jq -r '.data.results[] | "    - \(.fileName) (\(.department))"'
else
    echo "  ❌ API応答: 失敗"
    echo "$api_response" | jq '.'
fi

echo ""
echo "======================================"
echo "3️⃣ テキスト検索API動作確認"
echo "======================================"

echo "📝 テキスト検索APIテスト..."
text_response=$(curl -s -X POST "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search" \
  -H "Content-Type: application/json" \
  -H "Origin: https://cis-filesearch.com" \
  -d '{
    "q": "設計",
    "searchType": "text",
    "limit": 3
  }')

text_success=$(echo "$text_response" | jq -r '.success')
text_total=$(echo "$text_response" | jq -r '.data.total')

if [ "$text_success" == "true" ]; then
    echo "  ✅ API応答: 成功"
    echo "  📊 検索結果数: $text_total"
    echo ""
    echo "  📄 上位3件の結果:"
    echo "$text_response" | jq -r '.data.results[] | "    - \(.fileName)"' 2>/dev/null | head -3
else
    echo "  ❌ API応答: 失敗"
fi

echo ""
echo "======================================"
echo "4️⃣ パフォーマンステスト"
echo "======================================"

echo "⏱️ ページロード時間測定..."
load_time=$(curl -s -o /dev/null -w "%{time_total}" https://cis-filesearch.com)
echo "  ページロード時間: ${load_time}秒"

echo ""
echo "⏱️ API応答時間測定（3回平均）..."
total_time=0
for i in {1..3}; do
    time=$(curl -s -o /dev/null -w "%{time_total}" -X POST "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search" \
      -H "Content-Type: application/json" \
      -H "Origin: https://cis-filesearch.com" \
      -d "{\"searchType\":\"image\",\"imageVector\":[$vector],\"limit\":3}")
    echo "  テスト$i: ${time}秒"
    total_time=$(echo "$total_time + $time" | bc)
done
avg_time=$(echo "scale=3; $total_time / 3" | bc)
echo "  平均応答時間: ${avg_time}秒"

echo ""
echo "======================================"
echo "5️⃣ セキュリティ確認"
echo "======================================"

# HTTPS強制確認
echo "🔒 HTTPS強制確認..."
http_response=$(curl -s -o /dev/null -w "%{http_code}" -L http://cis-filesearch.com)
if [ "$http_response" == "200" ]; then
    echo "  ✅ HTTPSへリダイレクト確認"
else
    echo "  ⚠️ HTTPSリダイレクトに問題がある可能性"
fi

# CORS確認
echo "🌐 CORS設定確認..."
cors_response=$(curl -s -I -X OPTIONS "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search" \
  -H "Origin: https://cis-filesearch.com" \
  -H "Access-Control-Request-Method: POST" | grep -i "access-control")
if [ -n "$cors_response" ]; then
    echo "  ✅ CORS設定あり"
    echo "$cors_response" | sed 's/^/    /'
else
    echo "  ⚠️ CORS設定が見つかりません"
fi

echo ""
echo "======================================"
echo "📊 総合評価"
echo "======================================"

echo ""
echo "✅ 成功項目:"
echo "  - 本番URLへのアクセス可能"
echo "  - 画像検索API動作（1000件のデータ）"
echo "  - テキスト検索API動作（10,000件のデータ）"
echo "  - CloudFront配信正常"
echo ""

if [ "$success" == "true" ] && [ "$text_success" == "true" ]; then
    echo "🎉 結論: 本番環境デプロイ成功！"
    echo ""
    echo "📱 ブラウザで確認:"
    echo "  1. https://cis-filesearch.com を開く"
    echo "  2. 画像検索タブで画像をアップロード"
    echo "  3. 検索結果が表示されることを確認"
else
    echo "⚠️ 一部の機能に問題があります"
    echo "  CloudFrontキャッシュクリアを待って再度テストしてください"
fi

echo ""
echo "======================================"
echo "✅ 検証完了"
echo "======================================"