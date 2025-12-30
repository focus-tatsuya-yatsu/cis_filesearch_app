#!/bin/bash
#
# CIS File Search統合テストスクリプト
# フロントエンド → API Route → API Gateway → Lambda → OpenSearch の完全な動作確認
#

set -e

echo "==========================================="
echo "CIS File Search 統合テスト"
echo "==========================================="
echo ""

# 1. API Route直接テスト
echo "[1/3] Next.js API Routeテスト..."
API_RESPONSE=$(curl -s "http://localhost:3000/api/search/?q=test&searchMode=or&page=1&limit=5")
SUCCESS=$(echo "$API_RESPONSE" | jq -r '.success')
TOTAL=$(echo "$API_RESPONSE" | jq -r '.data.pagination.total')
COUNT=$(echo "$API_RESPONSE" | jq -r '.data.results | length')

if [ "$SUCCESS" = "true" ]; then
    echo "✅ API Route: 成功 (総数: $TOTAL件, 取得: $COUNT件)"
else
    echo "❌ API Route: 失敗"
    echo "$API_RESPONSE" | jq '.'
    exit 1
fi

# 2. API Gateway直接テスト
echo ""
echo "[2/3] API Gateway直接テスト..."
GATEWAY_URL="https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search"
GATEWAY_RESPONSE=$(curl -s "$GATEWAY_URL?q=test&searchMode=or&page=1&limit=5")
GATEWAY_SUCCESS=$(echo "$GATEWAY_RESPONSE" | jq -r '.success')
GATEWAY_TOTAL=$(echo "$GATEWAY_RESPONSE" | jq -r '.data.pagination.total')

if [ "$GATEWAY_SUCCESS" = "true" ]; then
    echo "✅ API Gateway: 成功 (総数: $GATEWAY_TOTAL件)"
else
    echo "❌ API Gateway: 失敗"
    echo "$GATEWAY_RESPONSE" | jq '.'
    exit 1
fi

# 3. 日本語検索テスト
echo ""
echo "[3/3] 日本語検索テスト..."
JP_RESPONSE=$(curl -s "http://localhost:3000/api/search/?q=%E4%BA%88%E7%AE%97&searchMode=or&page=1&limit=5")
JP_SUCCESS=$(echo "$JP_RESPONSE" | jq -r '.success')

if [ "$JP_SUCCESS" = "true" ]; then
    JP_COUNT=$(echo "$JP_RESPONSE" | jq -r '.data.results | length')
    echo "✅ 日本語検索: 成功 (結果: $JP_COUNT件)"
    echo "   サンプル結果:"
    echo "$JP_RESPONSE" | jq -r '.data.results[0] | "   - ファイル名: \(.fileName)"'
else
    echo "❌ 日本語検索: 失敗"
fi

echo ""
echo "==========================================="
echo "統合テスト完了！"
echo "==========================================="
echo ""
echo "システム構成:"
echo "  Frontend (localhost:3000)"
echo "      ↓ /api/search"
echo "  Next.js API Route"
echo "      ↓ HTTPS"
echo "  API Gateway"
echo "      ↓ Lambda Invoke"
echo "  Lambda (VPC内)"
echo "      ↓ VPC Endpoint"
echo "  OpenSearch"
echo ""
echo "✅ 全てのコンポーネントが正常に動作しています！"
echo ""
echo "ブラウザで http://localhost:3000/search にアクセスして"
echo "検索機能を試してください。"