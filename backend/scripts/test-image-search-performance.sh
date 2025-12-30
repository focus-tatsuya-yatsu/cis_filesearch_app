#!/bin/bash

#
# Image Search Performance Test Script
# 画像検索機能のパフォーマンステスト自動化スクリプト
#
# テスト項目:
# - レスポンスタイム測定
# - 同時アクセステスト
# - 負荷テスト
# - スループット測定
#

set -e

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 設定
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
UPLOAD_API="${API_BASE_URL}/api/image-embedding"
SEARCH_API="${API_BASE_URL}/api/search"
TEST_IMAGE_DIR="${TEST_IMAGE_DIR:-./test-data/images}"
RESULTS_DIR="${RESULTS_DIR:-./performance-results}"
CONCURRENT_USERS="${CONCURRENT_USERS:-10}"
ITERATIONS="${ITERATIONS:-100}"

# 結果ディレクトリ作成
mkdir -p "$RESULTS_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULT_FILE="$RESULTS_DIR/perf_test_$TIMESTAMP.json"
LOG_FILE="$RESULTS_DIR/perf_test_$TIMESTAMP.log"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Image Search Performance Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "API Base URL: ${GREEN}$API_BASE_URL${NC}"
echo -e "Concurrent Users: ${GREEN}$CONCURRENT_USERS${NC}"
echo -e "Iterations: ${GREEN}$ITERATIONS${NC}"
echo -e "Results: ${GREEN}$RESULT_FILE${NC}"
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

# テスト画像の作成
create_test_images() {
  log_info "Creating test images..."
  mkdir -p "$TEST_IMAGE_DIR"

  # ImageMagickがインストールされているか確認
  if command -v convert &> /dev/null; then
    for i in {1..5}; do
      if [ ! -f "$TEST_IMAGE_DIR/test_image_$i.jpg" ]; then
        convert -size 800x600 xc:blue \
          -pointsize 72 -fill white -gravity center \
          -annotate +0+0 "Test Image $i" \
          "$TEST_IMAGE_DIR/test_image_$i.jpg" 2>/dev/null || true
      fi
    done
    log_success "Test images created"
  else
    log_warning "ImageMagick not found, using existing images"
  fi
}

# サーバーの起動確認
check_server() {
  log_info "Checking server availability..."

  if curl -s -o /dev/null -w "%{http_code}" "$API_BASE_URL" | grep -q "200\|404"; then
    log_success "Server is running at $API_BASE_URL"
    return 0
  else
    log_error "Server is not accessible at $API_BASE_URL"
    return 1
  fi
}

# 単一リクエストのレスポンスタイム測定
measure_single_request() {
  local test_image="$1"
  local start_time=$(date +%s%N)

  # 画像アップロード
  local response=$(curl -s -w "\n%{http_code}" -X POST "$UPLOAD_API" \
    -F "image=@$test_image" 2>/dev/null)

  local http_code=$(echo "$response" | tail -n 1)
  local body=$(echo "$response" | sed '$d')
  local end_time=$(date +%s%N)

  # ミリ秒に変換
  local duration=$(( (end_time - start_time) / 1000000 ))

  echo "$duration|$http_code"
}

# レスポンスタイムテスト
test_response_time() {
  log_info "Running response time test..."

  local total_time=0
  local success_count=0
  local fail_count=0
  local min_time=999999
  local max_time=0

  # 最初のテスト画像を使用
  local test_image=$(find "$TEST_IMAGE_DIR" -name "*.jpg" -o -name "*.png" | head -n 1)

  if [ -z "$test_image" ]; then
    log_error "No test images found in $TEST_IMAGE_DIR"
    return 1
  fi

  log_info "Running $ITERATIONS iterations..."

  for i in $(seq 1 $ITERATIONS); do
    local result=$(measure_single_request "$test_image")
    local duration=$(echo "$result" | cut -d'|' -f1)
    local http_code=$(echo "$result" | cut -d'|' -f2)

    total_time=$((total_time + duration))

    if [ "$http_code" = "200" ]; then
      success_count=$((success_count + 1))
    else
      fail_count=$((fail_count + 1))
    fi

    # 最小/最大時間を更新
    if [ "$duration" -lt "$min_time" ]; then
      min_time=$duration
    fi
    if [ "$duration" -gt "$max_time" ]; then
      max_time=$duration
    fi

    # 進捗表示（10%ごと）
    if [ $((i % (ITERATIONS / 10))) -eq 0 ]; then
      echo -ne "\rProgress: $i / $ITERATIONS"
    fi
  done

  echo "" # 改行

  # 統計計算
  local avg_time=$((total_time / ITERATIONS))
  local success_rate=$(awk "BEGIN {printf \"%.2f\", ($success_count / $ITERATIONS) * 100}")

  log_success "Response Time Test Completed"
  log "  Total Requests: $ITERATIONS"
  log "  Success: $success_count (${success_rate}%)"
  log "  Failed: $fail_count"
  log "  Average Response Time: ${avg_time}ms"
  log "  Min Response Time: ${min_time}ms"
  log "  Max Response Time: ${max_time}ms"

  # 結果をJSONに記録
  cat >> "$RESULT_FILE" <<EOF
{
  "test": "response_time",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "iterations": $ITERATIONS,
  "success_count": $success_count,
  "fail_count": $fail_count,
  "success_rate": $success_rate,
  "avg_response_time_ms": $avg_time,
  "min_response_time_ms": $min_time,
  "max_response_time_ms": $max_time
}
EOF
}

# 同時アクセステスト
test_concurrent_access() {
  log_info "Running concurrent access test with $CONCURRENT_USERS users..."

  local test_image=$(find "$TEST_IMAGE_DIR" -name "*.jpg" | head -n 1)
  local start_time=$(date +%s)

  # 一時ファイルで結果を収集
  local temp_results=$(mktemp)

  # 並列実行
  for i in $(seq 1 $CONCURRENT_USERS); do
    (
      local duration=$(measure_single_request "$test_image" | cut -d'|' -f1)
      echo "$duration" >> "$temp_results"
    ) &
  done

  # すべてのバックグラウンドジョブの完了を待機
  wait

  local end_time=$(date +%s)
  local total_duration=$((end_time - start_time))

  # 結果集計
  local total_response_time=0
  local request_count=$(wc -l < "$temp_results")

  while read -r duration; do
    total_response_time=$((total_response_time + duration))
  done < "$temp_results"

  local avg_response_time=$((total_response_time / request_count))
  local throughput=$(awk "BEGIN {printf \"%.2f\", $request_count / $total_duration}")

  rm "$temp_results"

  log_success "Concurrent Access Test Completed"
  log "  Concurrent Users: $CONCURRENT_USERS"
  log "  Total Duration: ${total_duration}s"
  log "  Requests Completed: $request_count"
  log "  Average Response Time: ${avg_response_time}ms"
  log "  Throughput: ${throughput} req/s"

  # 結果をJSONに追記
  cat >> "$RESULT_FILE" <<EOF
,
{
  "test": "concurrent_access",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "concurrent_users": $CONCURRENT_USERS,
  "total_duration_s": $total_duration,
  "requests_completed": $request_count,
  "avg_response_time_ms": $avg_response_time,
  "throughput_req_per_s": $throughput
}
EOF
}

# エンドツーエンドテスト（アップロード → 検索）
test_e2e_flow() {
  log_info "Running E2E flow test (upload + search)..."

  local test_image=$(find "$TEST_IMAGE_DIR" -name "*.jpg" | head -n 1)
  local start_time=$(date +%s%N)

  # ステップ1: 画像アップロード
  local upload_response=$(curl -s -X POST "$UPLOAD_API" \
    -F "image=@$test_image" 2>/dev/null)

  local upload_time=$(date +%s%N)
  local upload_duration=$(( (upload_time - start_time) / 1000000 ))

  # embeddingを抽出
  local embedding=$(echo "$upload_response" | jq -r '.data.embedding // empty' 2>/dev/null)

  if [ -z "$embedding" ] || [ "$embedding" = "null" ]; then
    log_error "Failed to extract embedding from upload response"
    return 1
  fi

  # ステップ2: ベクトル検索
  local search_response=$(curl -s -X POST "$SEARCH_API" \
    -H "Content-Type: application/json" \
    -d "{\"embedding\": $embedding, \"confidenceThreshold\": 0.9, \"searchType\": \"image\"}" \
    2>/dev/null)

  local end_time=$(date +%s%N)
  local search_duration=$(( (end_time - upload_time) / 1000000 ))
  local total_duration=$(( (end_time - start_time) / 1000000 ))

  local result_count=$(echo "$search_response" | jq -r '.results | length // 0' 2>/dev/null)

  log_success "E2E Flow Test Completed"
  log "  Upload Duration: ${upload_duration}ms"
  log "  Search Duration: ${search_duration}ms"
  log "  Total Duration: ${total_duration}ms"
  log "  Results Found: $result_count"

  # 結果をJSONに追記
  cat >> "$RESULT_FILE" <<EOF
,
{
  "test": "e2e_flow",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "upload_duration_ms": $upload_duration,
  "search_duration_ms": $search_duration,
  "total_duration_ms": $total_duration,
  "results_found": $result_count
}
EOF
}

# メモリ使用量監視（オプション）
monitor_memory() {
  if command -v ps &> /dev/null; then
    local pid=$(pgrep -f "next-server" | head -n 1)
    if [ -n "$pid" ]; then
      local memory=$(ps -o rss= -p "$pid" 2>/dev/null | awk '{print $1/1024}')
      log_info "Server Memory Usage: ${memory}MB"
    fi
  fi
}

# メインテスト実行
main() {
  # 準備
  create_test_images

  if ! check_server; then
    log_error "Server check failed. Please start the server first."
    exit 1
  fi

  # JSONファイル開始
  echo "[" > "$RESULT_FILE"

  # テスト実行
  test_response_time
  test_concurrent_access
  test_e2e_flow

  # JSONファイル終了
  echo "]" >> "$RESULT_FILE"

  # メモリ使用量確認
  monitor_memory

  # サマリー
  echo ""
  log_success "All performance tests completed!"
  log_info "Results saved to: $RESULT_FILE"
  log_info "Logs saved to: $LOG_FILE"

  # 簡易レポート生成
  if command -v jq &> /dev/null; then
    echo ""
    log_info "Performance Summary:"
    jq -r '.[] | "\(.test): \(.avg_response_time_ms // .total_duration_ms)ms"' "$RESULT_FILE" 2>/dev/null || true
  fi
}

# スクリプト実行
main "$@"
