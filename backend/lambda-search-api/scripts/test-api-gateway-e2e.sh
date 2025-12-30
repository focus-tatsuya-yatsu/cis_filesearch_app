#!/bin/bash
# API Gateway経由のE2Eテスト

set -e

API_ENDPOINT="${API_GATEWAY_ENDPOINT:-https://5xbn5nq51f.execute-api.ap-northeast-1.amazonaws.com/prod/search}"

echo "========================================="
echo "API Gateway E2E Tests"
echo "Endpoint: $API_ENDPOINT"
echo "========================================="

# テスト結果カウンター
PASSED=0
FAILED=0

# テスト結果を記録する関数
log_test_result() {
  local test_name=$1
  local expected=$2
  local actual=$3

  if [ "$expected" == "$actual" ]; then
    echo "✅ $test_name: PASSED"
    ((PASSED++))
  else
    echo "❌ $test_name: FAILED (expected: $expected, got: $actual)"
    ((FAILED++))
  fi
}

# 1. テキスト検索（宇都宮）
echo -e "\n----------------------------------------"
echo "Test 1: Text search - 宇都宮"
echo "----------------------------------------"
HTTP_STATUS=$(curl -s -o /tmp/api-response-text.json -w "%{http_code}" \
  -X GET "$API_ENDPOINT?q=宇都宮&page=1&limit=10" \
  -H "Content-Type: application/json")

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
cat /tmp/api-response-text.json | jq .

log_test_result "Text search (宇都宮)" "200" "$HTTP_STATUS"

if [ "$HTTP_STATUS" == "200" ]; then
  SUCCESS=$(cat /tmp/api-response-text.json | jq -r '.success')
  if [ "$SUCCESS" == "true" ]; then
    echo "  ✓ Response is valid"
    TOTAL=$(cat /tmp/api-response-text.json | jq -r '.data.pagination.total')
    echo "  ✓ Total results: $TOTAL"
  fi
fi

# 2. AND検索モード
echo -e "\n----------------------------------------"
echo "Test 2: AND search mode"
echo "----------------------------------------"
HTTP_STATUS=$(curl -s -o /tmp/api-response-and.json -w "%{http_code}" \
  -X GET "$API_ENDPOINT?q=営業%20報告書&searchMode=and&page=1&limit=10" \
  -H "Content-Type: application/json")

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
cat /tmp/api-response-and.json | jq .

log_test_result "AND search mode" "200" "$HTTP_STATUS"

# 3. OR検索モード
echo -e "\n----------------------------------------"
echo "Test 3: OR search mode"
echo "----------------------------------------"
HTTP_STATUS=$(curl -s -o /tmp/api-response-or.json -w "%{http_code}" \
  -X GET "$API_ENDPOINT?q=PDF%20Excel&searchMode=or&page=1&limit=10" \
  -H "Content-Type: application/json")

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
cat /tmp/api-response-or.json | jq .

log_test_result "OR search mode" "200" "$HTTP_STATUS"

# 4. フィルター付き検索
echo -e "\n----------------------------------------"
echo "Test 4: Search with filters"
echo "----------------------------------------"
HTTP_STATUS=$(curl -s -o /tmp/api-response-filter.json -w "%{http_code}" \
  -X GET "$API_ENDPOINT?q=test&fileType=pdf&dateFrom=2025-01-01&page=1&limit=10" \
  -H "Content-Type: application/json")

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
cat /tmp/api-response-filter.json | jq .

log_test_result "Search with filters" "200" "$HTTP_STATUS"

# 5. 画像検索（512次元）
echo -e "\n----------------------------------------"
echo "Test 5: Image search (512 dimensions)"
echo "----------------------------------------"
EMBEDDING_512=$(node -e "console.log(JSON.stringify(Array(512).fill(0.5)))")
HTTP_STATUS=$(curl -s -o /tmp/api-response-image-512.json -w "%{http_code}" \
  -X POST "$API_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "{\"imageEmbedding\":$EMBEDDING_512,\"page\":1,\"limit\":10}")

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
cat /tmp/api-response-image-512.json | jq .

log_test_result "Image search (512D)" "200" "$HTTP_STATUS"

# 6. 画像検索（1024次元）
echo -e "\n----------------------------------------"
echo "Test 6: Image search (1024 dimensions)"
echo "----------------------------------------"
EMBEDDING_1024=$(node -e "console.log(JSON.stringify(Array(1024).fill(0.3)))")
HTTP_STATUS=$(curl -s -o /tmp/api-response-image-1024.json -w "%{http_code}" \
  -X POST "$API_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "{\"imageEmbedding\":$EMBEDDING_1024,\"page\":1,\"limit\":10}")

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
cat /tmp/api-response-image-1024.json | jq .

log_test_result "Image search (1024D)" "200" "$HTTP_STATUS"

# 7. ハイブリッド検索（テキスト + 画像）
echo -e "\n----------------------------------------"
echo "Test 7: Hybrid search (text + image)"
echo "----------------------------------------"
HTTP_STATUS=$(curl -s -o /tmp/api-response-hybrid.json -w "%{http_code}" \
  -X POST "$API_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "{\"q\":\"宇都宮\",\"imageEmbedding\":$EMBEDDING_512,\"page\":1,\"limit\":10}")

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
cat /tmp/api-response-hybrid.json | jq .

log_test_result "Hybrid search" "200" "$HTTP_STATUS"

# 8. ハイブリッド検索 + フィルター
echo -e "\n----------------------------------------"
echo "Test 8: Hybrid search with filters"
echo "----------------------------------------"
HTTP_STATUS=$(curl -s -o /tmp/api-response-hybrid-filter.json -w "%{http_code}" \
  -X POST "$API_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "{\"q\":\"test\",\"imageEmbedding\":$EMBEDDING_512,\"fileType\":\"pdf\",\"page\":1,\"limit\":10}")

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
cat /tmp/api-response-hybrid-filter.json | jq .

log_test_result "Hybrid search with filters" "200" "$HTTP_STATUS"

# 9. ページネーション
echo -e "\n----------------------------------------"
echo "Test 9: Pagination"
echo "----------------------------------------"
HTTP_STATUS=$(curl -s -o /tmp/api-response-page2.json -w "%{http_code}" \
  -X GET "$API_ENDPOINT?q=test&page=2&limit=5" \
  -H "Content-Type: application/json")

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
cat /tmp/api-response-page2.json | jq .

log_test_result "Pagination (page 2)" "200" "$HTTP_STATUS"

# 10. ソート設定
echo -e "\n----------------------------------------"
echo "Test 10: Sort by date"
echo "----------------------------------------"
HTTP_STATUS=$(curl -s -o /tmp/api-response-sort.json -w "%{http_code}" \
  -X GET "$API_ENDPOINT?q=test&sortBy=date&sortOrder=desc" \
  -H "Content-Type: application/json")

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
cat /tmp/api-response-sort.json | jq .

log_test_result "Sort by date" "200" "$HTTP_STATUS"

# 11. CORSヘッダー検証
echo -e "\n----------------------------------------"
echo "Test 11: CORS headers validation"
echo "----------------------------------------"
CORS_RESPONSE=$(curl -s -I -X OPTIONS "$API_ENDPOINT")
echo "$CORS_RESPONSE"

CORS_ORIGIN=$(echo "$CORS_RESPONSE" | grep -i "access-control-allow-origin" | tr -d '\r')
CORS_METHODS=$(echo "$CORS_RESPONSE" | grep -i "access-control-allow-methods" | tr -d '\r')

if [ -n "$CORS_ORIGIN" ]; then
  echo "  ✓ CORS Origin header found: $CORS_ORIGIN"
  log_test_result "CORS headers present" "true" "true"
else
  echo "  ✗ CORS Origin header not found"
  log_test_result "CORS headers present" "true" "false"
fi

# 12. エラーケース - 空のクエリ
echo -e "\n----------------------------------------"
echo "Test 12: Error case - Empty query"
echo "----------------------------------------"
HTTP_STATUS=$(curl -s -o /tmp/api-response-error-empty.json -w "%{http_code}" \
  -X GET "$API_ENDPOINT" \
  -H "Content-Type: application/json")

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
cat /tmp/api-response-error-empty.json | jq .

log_test_result "Error handling (empty query)" "400" "$HTTP_STATUS"

# 13. エラーケース - 無効なページ番号
echo -e "\n----------------------------------------"
echo "Test 13: Error case - Invalid page number"
echo "----------------------------------------"
HTTP_STATUS=$(curl -s -o /tmp/api-response-error-page.json -w "%{http_code}" \
  -X GET "$API_ENDPOINT?q=test&page=0" \
  -H "Content-Type: application/json")

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
cat /tmp/api-response-error-page.json | jq .

log_test_result "Error handling (invalid page)" "400" "$HTTP_STATUS"

# 14. エラーケース - 無効な画像埋め込み
echo -e "\n----------------------------------------"
echo "Test 14: Error case - Invalid image embedding"
echo "----------------------------------------"
INVALID_EMBEDDING=$(node -e "console.log(JSON.stringify(Array(256).fill(0.5)))")
HTTP_STATUS=$(curl -s -o /tmp/api-response-error-embedding.json -w "%{http_code}" \
  -X POST "$API_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "{\"imageEmbedding\":$INVALID_EMBEDDING}")

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
cat /tmp/api-response-error-embedding.json | jq .

log_test_result "Error handling (invalid embedding)" "400" "$HTTP_STATUS"

# 15. レスポンスタイム測定
echo -e "\n----------------------------------------"
echo "Test 15: Response time measurement"
echo "----------------------------------------"
echo "Measuring response time (10 requests)..."

TOTAL_TIME=0
for i in {1..10}; do
  START=$(date +%s%3N)
  curl -s -o /dev/null "$API_ENDPOINT?q=test&page=1&limit=10"
  END=$(date +%s%3N)
  DURATION=$((END - START))
  TOTAL_TIME=$((TOTAL_TIME + DURATION))
  echo "  Request $i: ${DURATION}ms"
done

AVERAGE=$((TOTAL_TIME / 10))
echo "  Average response time: ${AVERAGE}ms"

if [ $AVERAGE -lt 1000 ]; then
  echo "  ✓ Response time is acceptable (<1000ms)"
  log_test_result "Response time" "acceptable" "acceptable"
else
  echo "  ⚠ Response time is slow (>1000ms)"
  log_test_result "Response time" "acceptable" "slow"
fi

# テスト結果サマリー
echo -e "\n========================================="
echo "Test Results Summary"
echo "========================================="
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo "Total:  $((PASSED + FAILED))"

if [ $FAILED -eq 0 ]; then
  echo -e "\n✅ All API Gateway E2E tests passed!"
  exit 0
else
  echo -e "\n❌ Some tests failed. Please review the output above."
  exit 1
fi
