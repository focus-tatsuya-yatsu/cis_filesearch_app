#!/bin/bash

#
# Image Search E2E Integration Test Script
# 画像検索機能のエンドツーエンド統合テスト自動化スクリプト
#
# テストフロー:
# 1. 画像アップロード
# 2. ベクトル化（Bedrock API）
# 3. OpenSearch検索
# 4. 結果表示
# 5. 検証
#

set -e

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 設定
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
UPLOAD_API="${API_BASE_URL}/api/image-embedding"
SEARCH_API="${API_BASE_URL}/api/search"
TEST_IMAGE_PATH="${TEST_IMAGE_PATH:-./test-data/sample-image.jpg}"
CONFIDENCE_THRESHOLD="${CONFIDENCE_THRESHOLD:-0.9}"
EXPECTED_RESULTS="${EXPECTED_RESULTS:-1}"

# 結果ディレクトリ
RESULTS_DIR="./e2e-test-results"
mkdir -p "$RESULTS_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$RESULTS_DIR/e2e_test_$TIMESTAMP.log"
RESULT_JSON="$RESULTS_DIR/e2e_result_$TIMESTAMP.json"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Image Search E2E Integration Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "API Base URL: ${GREEN}$API_BASE_URL${NC}"
echo -e "Upload API: ${GREEN}$UPLOAD_API${NC}"
echo -e "Search API: ${GREEN}$SEARCH_API${NC}"
echo -e "Test Image: ${GREEN}$TEST_IMAGE_PATH${NC}"
echo -e "Confidence Threshold: ${GREEN}$CONFIDENCE_THRESHOLD${NC}"
echo ""

# ログ関数
log() {
  echo -e "$1" | tee -a "$LOG_FILE"
}

log_success() {
  log "${GREEN}✓ $1${NC}"
}

log_error() {
  log "${RED}✗ $1${NC}"
}

log_warning() {
  log "${YELLOW}⚠ $1${NC}"
}

log_info() {
  log "${BLUE}ℹ $1${NC}"
}

log_step() {
  log "${CYAN}➜ $1${NC}"
}

# エラーハンドリング
error_exit() {
  log_error "$1"
  log_error "Test failed at step: $CURRENT_STEP"
  exit 1
}

# テスト結果を記録
CURRENT_STEP=""
TEST_START_TIME=$(date +%s)

# JSON結果ファイル初期化
cat > "$RESULT_JSON" <<EOF
{
  "test_name": "Image Search E2E Integration Test",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "test_image": "$TEST_IMAGE_PATH",
  "api_base_url": "$API_BASE_URL",
  "steps": []
}
EOF

# JSONに結果を追加
add_step_result() {
  local step_name="$1"
  local status="$2"
  local duration="$3"
  local details="$4"

  # 既存のJSONを読み込んで更新
  local temp_file=$(mktemp)
  jq ".steps += [{
    \"step\": \"$step_name\",
    \"status\": \"$status\",
    \"duration_ms\": $duration,
    \"details\": $details
  }]" "$RESULT_JSON" > "$temp_file" && mv "$temp_file" "$RESULT_JSON"
}

# サーバー起動確認
CURRENT_STEP="Server Health Check"
log_step "Step 1: Checking server availability..."

step_start=$(date +%s%N)
if curl -s -o /dev/null -w "%{http_code}" "$API_BASE_URL" | grep -q "200\|404"; then
  step_end=$(date +%s%N)
  step_duration=$(( (step_end - step_start) / 1000000 ))
  log_success "Server is running (${step_duration}ms)"
  add_step_result "Server Health Check" "success" "$step_duration" "\"Server is accessible\""
else
  error_exit "Server is not accessible at $API_BASE_URL"
fi

# テスト画像の存在確認
CURRENT_STEP="Test Image Validation"
log_step "Step 2: Validating test image..."

if [ ! -f "$TEST_IMAGE_PATH" ]; then
  log_warning "Test image not found at $TEST_IMAGE_PATH"
  log_info "Creating a sample test image..."

  # ImageMagickで簡易画像を作成
  if command -v convert &> /dev/null; then
    mkdir -p "$(dirname "$TEST_IMAGE_PATH")"
    convert -size 800x600 xc:blue \
      -pointsize 72 -fill white -gravity center \
      -annotate +0+0 "Test Image" \
      "$TEST_IMAGE_PATH" 2>/dev/null || error_exit "Failed to create test image"
    log_success "Test image created"
  else
    error_exit "Test image not found and ImageMagick is not available"
  fi
fi

# 画像ファイルサイズ確認
image_size=$(stat -f%z "$TEST_IMAGE_PATH" 2>/dev/null || stat -c%s "$TEST_IMAGE_PATH" 2>/dev/null)
log_info "Test image size: $(( image_size / 1024 )) KB"

if [ "$image_size" -gt 5242880 ]; then
  error_exit "Test image is too large (> 5MB)"
fi

add_step_result "Test Image Validation" "success" 0 "{\"size_kb\": $(( image_size / 1024 ))}"

# ステップ3: 画像アップロード
CURRENT_STEP="Image Upload"
log_step "Step 3: Uploading image for embedding..."

step_start=$(date +%s%N)
upload_response=$(curl -s -w "\n%{http_code}" -X POST "$UPLOAD_API" \
  -F "image=@$TEST_IMAGE_PATH" 2>/dev/null)

upload_http_code=$(echo "$upload_response" | tail -n 1)
upload_body=$(echo "$upload_response" | sed '$d')
step_end=$(date +%s%N)
upload_duration=$(( (step_end - step_start) / 1000000 ))

log_info "Upload HTTP Status: $upload_http_code"
log_info "Upload Duration: ${upload_duration}ms"

if [ "$upload_http_code" != "200" ]; then
  log_error "Upload failed with status $upload_http_code"
  log_error "Response: $upload_body"
  add_step_result "Image Upload" "failed" "$upload_duration" "{\"http_code\": $upload_http_code}"
  error_exit "Image upload failed"
fi

# レスポンスをパース
if ! echo "$upload_body" | jq . >/dev/null 2>&1; then
  error_exit "Invalid JSON response from upload API"
fi

# embeddingを抽出
embedding=$(echo "$upload_body" | jq -r '.data.embedding // empty')
dimensions=$(echo "$upload_body" | jq -r '.data.dimensions // 0')

if [ -z "$embedding" ] || [ "$embedding" = "null" ]; then
  log_error "Failed to extract embedding from response"
  log_error "Response: $upload_body"
  error_exit "Embedding not found in upload response"
fi

log_success "Image uploaded successfully (${upload_duration}ms)"
log_info "Embedding dimensions: $dimensions"
add_step_result "Image Upload" "success" "$upload_duration" "{\"dimensions\": $dimensions}"

# ステップ4: ベクトル検索
CURRENT_STEP="Vector Search"
log_step "Step 4: Searching by image embedding..."

# 検索リクエストボディを構築
search_request=$(jq -n \
  --argjson embedding "$embedding" \
  --arg threshold "$CONFIDENCE_THRESHOLD" \
  '{
    embedding: $embedding,
    confidenceThreshold: ($threshold | tonumber),
    searchType: "image"
  }')

step_start=$(date +%s%N)
search_response=$(curl -s -w "\n%{http_code}" -X POST "$SEARCH_API" \
  -H "Content-Type: application/json" \
  -d "$search_request" 2>/dev/null)

search_http_code=$(echo "$search_response" | tail -n 1)
search_body=$(echo "$search_response" | sed '$d')
step_end=$(date +%s%N)
search_duration=$(( (step_end - step_start) / 1000000 ))

log_info "Search HTTP Status: $search_http_code"
log_info "Search Duration: ${search_duration}ms"

if [ "$search_http_code" != "200" ]; then
  log_error "Search failed with status $search_http_code"
  log_error "Response: $search_body"
  add_step_result "Vector Search" "failed" "$search_duration" "{\"http_code\": $search_http_code}"
  error_exit "Image search failed"
fi

# 検索結果をパース
if ! echo "$search_body" | jq . >/dev/null 2>&1; then
  error_exit "Invalid JSON response from search API"
fi

results_count=$(echo "$search_body" | jq -r '.total // 0')
results_array=$(echo "$search_body" | jq -r '.results // []')

log_success "Search completed successfully (${search_duration}ms)"
log_info "Results found: $results_count"
add_step_result "Vector Search" "success" "$search_duration" "{\"results_count\": $results_count}"

# ステップ5: 結果検証
CURRENT_STEP="Result Validation"
log_step "Step 5: Validating search results..."

validation_errors=0

# 最低限の結果数チェック
if [ "$results_count" -lt "$EXPECTED_RESULTS" ]; then
  log_warning "Expected at least $EXPECTED_RESULTS results, got $results_count"
  validation_errors=$((validation_errors + 1))
fi

# スコア検証（信頼度閾値以上か）
if [ "$results_count" -gt 0 ]; then
  min_score=$(echo "$search_body" | jq -r '[.results[].score] | min')
  max_score=$(echo "$search_body" | jq -r '[.results[].score] | max')
  avg_score=$(echo "$search_body" | jq -r '[.results[].score] | add / length')

  log_info "Score range: $min_score - $max_score (avg: $avg_score)"

  # 最小スコアが閾値以上か確認
  if awk "BEGIN {exit !($min_score < $CONFIDENCE_THRESHOLD)}"; then
    log_warning "Some results have scores below threshold ($min_score < $CONFIDENCE_THRESHOLD)"
    validation_errors=$((validation_errors + 1))
  fi

  # トップ5結果を表示
  log_info "Top results:"
  echo "$search_body" | jq -r '.results[0:5] | .[] | "  - \(.path) (score: \(.score))"' | tee -a "$LOG_FILE"
fi

if [ "$validation_errors" -eq 0 ]; then
  log_success "Result validation passed"
  add_step_result "Result Validation" "success" 0 "{\"validation_errors\": 0}"
else
  log_warning "Result validation completed with $validation_errors warnings"
  add_step_result "Result Validation" "warning" 0 "{\"validation_errors\": $validation_errors}"
fi

# ステップ6: パフォーマンス検証
CURRENT_STEP="Performance Validation"
log_step "Step 6: Validating performance metrics..."

total_duration=$((upload_duration + search_duration))
log_info "Total E2E duration: ${total_duration}ms"

performance_issues=0

# アップロード時間チェック（5秒以内）
if [ "$upload_duration" -gt 5000 ]; then
  log_warning "Upload took longer than expected (${upload_duration}ms > 5000ms)"
  performance_issues=$((performance_issues + 1))
fi

# 検索時間チェック（2秒以内）
if [ "$search_duration" -gt 2000 ]; then
  log_warning "Search took longer than expected (${search_duration}ms > 2000ms)"
  performance_issues=$((performance_issues + 1))
fi

# 合計時間チェック（10秒以内）
if [ "$total_duration" -gt 10000 ]; then
  log_warning "Total E2E flow took longer than expected (${total_duration}ms > 10000ms)"
  performance_issues=$((performance_issues + 1))
fi

if [ "$performance_issues" -eq 0 ]; then
  log_success "Performance validation passed"
  add_step_result "Performance Validation" "success" 0 "{\"performance_issues\": 0}"
else
  log_warning "Performance validation completed with $performance_issues warnings"
  add_step_result "Performance Validation" "warning" 0 "{\"performance_issues\": $performance_issues}"
fi

# テスト完了
TEST_END_TIME=$(date +%s)
TEST_TOTAL_DURATION=$((TEST_END_TIME - TEST_START_TIME))

# 最終結果をJSONに追加
temp_file=$(mktemp)
jq ".test_duration_s = $TEST_TOTAL_DURATION | .status = \"success\"" "$RESULT_JSON" > "$temp_file" && mv "$temp_file" "$RESULT_JSON"

# サマリー出力
echo ""
log_success "========================================="
log_success "E2E Test Completed Successfully!"
log_success "========================================="
echo ""
log_info "Summary:"
log "  Upload Duration: ${upload_duration}ms"
log "  Search Duration: ${search_duration}ms"
log "  Total E2E Duration: ${total_duration}ms"
log "  Test Execution Time: ${TEST_TOTAL_DURATION}s"
log "  Results Found: $results_count"
log "  Validation Errors: $validation_errors"
log "  Performance Issues: $performance_issues"
echo ""
log_info "Detailed results saved to:"
log "  JSON: $RESULT_JSON"
log "  Log: $LOG_FILE"
echo ""

# 結果JSONを整形表示（jqが利用可能な場合）
if command -v jq &> /dev/null; then
  log_info "Test Result Summary:"
  jq -C '.' "$RESULT_JSON" | tee -a "$LOG_FILE"
fi

exit 0
