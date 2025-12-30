#!/bin/bash
# E2Eテスト: 実際のLambda関数を呼び出してテスト

set -e

FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-cis-search-api-prod}"
REGION="${AWS_REGION:-ap-northeast-1}"

echo "========================================="
echo "Lambda E2E Tests"
echo "Function: $FUNCTION_NAME"
echo "Region: $REGION"
echo "========================================="

# テスト結果カウンター
PASSED=0
FAILED=0

# テスト結果を記録する関数
log_test_result() {
  local test_name=$1
  local expected_status=$2
  local actual_status=$3

  if [ "$expected_status" == "$actual_status" ]; then
    echo "✅ $test_name: PASSED"
    ((PASSED++))
  else
    echo "❌ $test_name: FAILED (expected: $expected_status, got: $actual_status)"
    ((FAILED++))
  fi
}

# 1. テキスト検索テスト（宇都宮）
echo -e "\n----------------------------------------"
echo "Test 1: Text search - 宇都宮"
echo "----------------------------------------"
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"宇都宮","page":"1","limit":"10"}}' \
  /tmp/lambda-response-text.json > /dev/null 2>&1

echo "Response:"
cat /tmp/lambda-response-text.json | jq .

RESULT=$(cat /tmp/lambda-response-text.json | jq -r '.statusCode')
log_test_result "Text search (宇都宮)" "200" "$RESULT"

# 検索結果の検証
if [ "$RESULT" == "200" ]; then
  BODY=$(cat /tmp/lambda-response-text.json | jq -r '.body')
  SUCCESS=$(echo "$BODY" | jq -r '.success')
  if [ "$SUCCESS" == "true" ]; then
    echo "  ✓ Response body is valid"
    TOTAL=$(echo "$BODY" | jq -r '.data.pagination.total')
    echo "  ✓ Total results: $TOTAL"
  fi
fi

# 2. AND検索テスト
echo -e "\n----------------------------------------"
echo "Test 2: AND search mode"
echo "----------------------------------------"
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"営業 報告書","searchMode":"and","page":"1","limit":"10"}}' \
  /tmp/lambda-response-and.json > /dev/null 2>&1

echo "Response:"
cat /tmp/lambda-response-and.json | jq .

RESULT=$(cat /tmp/lambda-response-and.json | jq -r '.statusCode')
log_test_result "AND search mode" "200" "$RESULT"

# 3. OR検索テスト
echo -e "\n----------------------------------------"
echo "Test 3: OR search mode"
echo "----------------------------------------"
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"PDF Excel","searchMode":"or","page":"1","limit":"10"}}' \
  /tmp/lambda-response-or.json > /dev/null 2>&1

echo "Response:"
cat /tmp/lambda-response-or.json | jq .

RESULT=$(cat /tmp/lambda-response-or.json | jq -r '.statusCode')
log_test_result "OR search mode" "200" "$RESULT"

# 4. フィルター付き検索テスト
echo -e "\n----------------------------------------"
echo "Test 4: Search with filters"
echo "----------------------------------------"
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test","fileType":"pdf","dateFrom":"2025-01-01","page":"1","limit":"10"}}' \
  /tmp/lambda-response-filter.json > /dev/null 2>&1

echo "Response:"
cat /tmp/lambda-response-filter.json | jq .

RESULT=$(cat /tmp/lambda-response-filter.json | jq -r '.statusCode')
log_test_result "Search with filters" "200" "$RESULT"

# 5. 画像検索テスト（512次元）
echo -e "\n----------------------------------------"
echo "Test 5: Image search (512 dimensions)"
echo "----------------------------------------"
# 512次元のダミー埋め込み生成
EMBEDDING_512=$(node -e "console.log(JSON.stringify(Array(512).fill(0.5)))")
PAYLOAD_512=$(cat <<EOF
{
  "httpMethod": "POST",
  "body": "{\"imageEmbedding\":$EMBEDDING_512,\"page\":1,\"limit\":10}"
}
EOF
)

echo "$PAYLOAD_512" > /tmp/lambda-payload-image-512.json

aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --cli-binary-format raw-in-base64-out \
  --payload file:///tmp/lambda-payload-image-512.json \
  /tmp/lambda-response-image-512.json > /dev/null 2>&1

echo "Response:"
cat /tmp/lambda-response-image-512.json | jq .

RESULT=$(cat /tmp/lambda-response-image-512.json | jq -r '.statusCode')
log_test_result "Image search (512D)" "200" "$RESULT"

# 6. 画像検索テスト（1024次元）
echo -e "\n----------------------------------------"
echo "Test 6: Image search (1024 dimensions)"
echo "----------------------------------------"
# 1024次元のダミー埋め込み生成
EMBEDDING_1024=$(node -e "console.log(JSON.stringify(Array(1024).fill(0.3)))")
PAYLOAD_1024=$(cat <<EOF
{
  "httpMethod": "POST",
  "body": "{\"imageEmbedding\":$EMBEDDING_1024,\"page\":1,\"limit\":10}"
}
EOF
)

echo "$PAYLOAD_1024" > /tmp/lambda-payload-image-1024.json

aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --cli-binary-format raw-in-base64-out \
  --payload file:///tmp/lambda-payload-image-1024.json \
  /tmp/lambda-response-image-1024.json > /dev/null 2>&1

echo "Response:"
cat /tmp/lambda-response-image-1024.json | jq .

RESULT=$(cat /tmp/lambda-response-image-1024.json | jq -r '.statusCode')
log_test_result "Image search (1024D)" "200" "$RESULT"

# 7. ハイブリッド検索テスト（テキスト + 画像）
echo -e "\n----------------------------------------"
echo "Test 7: Hybrid search (text + image)"
echo "----------------------------------------"
HYBRID_PAYLOAD=$(cat <<EOF
{
  "httpMethod": "POST",
  "body": "{\"q\":\"宇都宮\",\"imageEmbedding\":$EMBEDDING_512,\"page\":1,\"limit\":10}"
}
EOF
)

echo "$HYBRID_PAYLOAD" > /tmp/lambda-payload-hybrid.json

aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --cli-binary-format raw-in-base64-out \
  --payload file:///tmp/lambda-payload-hybrid.json \
  /tmp/lambda-response-hybrid.json > /dev/null 2>&1

echo "Response:"
cat /tmp/lambda-response-hybrid.json | jq .

RESULT=$(cat /tmp/lambda-response-hybrid.json | jq -r '.statusCode')
log_test_result "Hybrid search" "200" "$RESULT"

# 8. ページネーションテスト
echo -e "\n----------------------------------------"
echo "Test 8: Pagination"
echo "----------------------------------------"
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test","page":"2","limit":"5"}}' \
  /tmp/lambda-response-page2.json > /dev/null 2>&1

echo "Response:"
cat /tmp/lambda-response-page2.json | jq .

RESULT=$(cat /tmp/lambda-response-page2.json | jq -r '.statusCode')
log_test_result "Pagination (page 2)" "200" "$RESULT"

# 9. ソート設定テスト
echo -e "\n----------------------------------------"
echo "Test 9: Sort by date"
echo "----------------------------------------"
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test","sortBy":"date","sortOrder":"desc"}}' \
  /tmp/lambda-response-sort.json > /dev/null 2>&1

echo "Response:"
cat /tmp/lambda-response-sort.json | jq .

RESULT=$(cat /tmp/lambda-response-sort.json | jq -r '.statusCode')
log_test_result "Sort by date" "200" "$RESULT"

# 10. エラーケーステスト - 空のクエリ
echo -e "\n----------------------------------------"
echo "Test 10: Error case - Empty query"
echo "----------------------------------------"
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload '{"httpMethod":"GET","queryStringParameters":{}}' \
  /tmp/lambda-response-error-empty.json > /dev/null 2>&1

echo "Response:"
cat /tmp/lambda-response-error-empty.json | jq .

RESULT=$(cat /tmp/lambda-response-error-empty.json | jq -r '.statusCode')
log_test_result "Error handling (empty query)" "400" "$RESULT"

# 11. エラーケーステスト - 無効なページ番号
echo -e "\n----------------------------------------"
echo "Test 11: Error case - Invalid page number"
echo "----------------------------------------"
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test","page":"0"}}' \
  /tmp/lambda-response-error-page.json > /dev/null 2>&1

echo "Response:"
cat /tmp/lambda-response-error-page.json | jq .

RESULT=$(cat /tmp/lambda-response-error-page.json | jq -r '.statusCode')
log_test_result "Error handling (invalid page)" "400" "$RESULT"

# 12. エラーケーステスト - 無効な画像埋め込み
echo -e "\n----------------------------------------"
echo "Test 12: Error case - Invalid image embedding"
echo "----------------------------------------"
INVALID_EMBEDDING=$(node -e "console.log(JSON.stringify(Array(256).fill(0.5)))")
INVALID_PAYLOAD=$(cat <<EOF
{
  "httpMethod": "POST",
  "body": "{\"imageEmbedding\":$INVALID_EMBEDDING}"
}
EOF
)

echo "$INVALID_PAYLOAD" > /tmp/lambda-payload-invalid.json

aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --cli-binary-format raw-in-base64-out \
  --payload file:///tmp/lambda-payload-invalid.json \
  /tmp/lambda-response-error-embedding.json > /dev/null 2>&1

echo "Response:"
cat /tmp/lambda-response-error-embedding.json | jq .

RESULT=$(cat /tmp/lambda-response-error-embedding.json | jq -r '.statusCode')
log_test_result "Error handling (invalid embedding)" "400" "$RESULT"

# 13. CORSテスト
echo -e "\n----------------------------------------"
echo "Test 13: CORS preflight"
echo "----------------------------------------"
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload '{"httpMethod":"OPTIONS","path":"/search"}' \
  /tmp/lambda-response-cors.json > /dev/null 2>&1

echo "Response:"
cat /tmp/lambda-response-cors.json | jq .

RESULT=$(cat /tmp/lambda-response-cors.json | jq -r '.statusCode')
log_test_result "CORS preflight" "200" "$RESULT"

# CORSヘッダーの確認
if [ "$RESULT" == "200" ]; then
  BODY=$(cat /tmp/lambda-response-cors.json | jq -r '.body')
  HEADERS=$(cat /tmp/lambda-response-cors.json | jq -r '.headers')
  CORS_HEADER=$(echo "$HEADERS" | jq -r '."Access-Control-Allow-Origin"')
  if [ "$CORS_HEADER" == "*" ]; then
    echo "  ✓ CORS headers are correct"
  else
    echo "  ✗ CORS headers are missing or incorrect"
  fi
fi

# テスト結果サマリー
echo -e "\n========================================="
echo "Test Results Summary"
echo "========================================="
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo "Total:  $((PASSED + FAILED))"

if [ $FAILED -eq 0 ]; then
  echo -e "\n✅ All E2E tests passed!"
  exit 0
else
  echo -e "\n❌ Some tests failed. Please review the output above."
  exit 1
fi
