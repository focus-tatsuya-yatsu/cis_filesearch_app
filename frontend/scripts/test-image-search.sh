#!/bin/bash

###############################################################################
# 画像検索機能 統合テストスクリプト
#
# 使用方法:
#   ./scripts/test-image-search.sh [mock|prod]
#
# 引数:
#   mock - モックモードでテスト（デフォルト）
#   prod - 本番モード（AWS Bedrock使用）
#
# 前提条件:
#   - 開発サーバーが起動していること（yarn dev）
#   - テスト用画像ファイルが存在すること
###############################################################################

set -e

# カラー出力設定
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# テストモード（デフォルト: mock）
MODE="${1:-mock}"

# API URL
BASE_URL="http://localhost:3000"
IMAGE_EMBEDDING_API="${BASE_URL}/api/image-embedding/"
SEARCH_API="${BASE_URL}/api/search/"

# テスト用画像ファイルパス
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_IMAGES_DIR="${SCRIPT_DIR}/../test-data/images"
TEST_IMAGE_SMALL="${TEST_IMAGES_DIR}/test-small.jpg"
TEST_IMAGE_MEDIUM="${TEST_IMAGES_DIR}/test-medium.png"
TEST_IMAGE_LARGE="${TEST_IMAGES_DIR}/test-large.jpg"

# テスト結果カウンター
TESTS_TOTAL=0
TESTS_PASSED=0
TESTS_FAILED=0

# ログファイル
LOG_FILE="/tmp/cis-image-search-test-$(date +%Y%m%d-%H%M%S).log"

###############################################################################
# ユーティリティ関数
###############################################################################

log() {
  echo -e "${1}" | tee -a "$LOG_FILE"
}

log_success() {
  log "${GREEN}✓ ${1}${NC}"
}

log_error() {
  log "${RED}✗ ${1}${NC}"
}

log_warning() {
  log "${YELLOW}⚠ ${1}${NC}"
}

log_info() {
  log "${BLUE}ℹ ${1}${NC}"
}

log_header() {
  log ""
  log "═══════════════════════════════════════════════════════════════"
  log "${BLUE}${1}${NC}"
  log "═══════════════════════════════════════════════════════════════"
}

increment_total() {
  TESTS_TOTAL=$((TESTS_TOTAL + 1))
}

increment_passed() {
  TESTS_PASSED=$((TESTS_PASSED + 1))
  log_success "$1"
}

increment_failed() {
  TESTS_FAILED=$((TESTS_FAILED + 1))
  log_error "$1"
}

###############################################################################
# テスト前チェック
###############################################################################

check_prerequisites() {
  log_header "前提条件チェック"

  # 開発サーバーの起動確認
  increment_total
  if curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}" | grep -q "200\|301\|302"; then
    increment_passed "開発サーバーが起動しています"
  else
    increment_failed "開発サーバーが起動していません。'yarn dev'を実行してください"
    exit 1
  fi

  # テスト画像ディレクトリの存在確認
  increment_total
  if [ -d "$TEST_IMAGES_DIR" ]; then
    increment_passed "テスト画像ディレクトリが存在します: $TEST_IMAGES_DIR"
  else
    increment_failed "テスト画像ディレクトリが存在しません: $TEST_IMAGES_DIR"
    log_info "作成中..."
    mkdir -p "$TEST_IMAGES_DIR"
    log_warning "テスト画像を手動で配置してください"
  fi

  # テスト画像ファイルの存在確認
  increment_total
  if [ -f "$TEST_IMAGE_SMALL" ]; then
    increment_passed "テスト画像（小）が存在します: $TEST_IMAGE_SMALL"
  else
    log_warning "テスト画像（小）が存在しません。ダミー画像を生成します"
    # ImageMagickがインストールされている場合はダミー画像を生成
    if command -v convert &> /dev/null; then
      convert -size 100x100 xc:blue "$TEST_IMAGE_SMALL"
      increment_passed "ダミー画像を生成しました: $TEST_IMAGE_SMALL"
    else
      increment_failed "テスト画像が存在せず、ImageMagickもインストールされていません"
      log_info "手動でテスト画像を配置してください: $TEST_IMAGE_SMALL"
    fi
  fi

  # モード確認
  log_info "テストモード: $MODE"
  if [ "$MODE" = "prod" ]; then
    log_warning "本番モードでテストします（AWS Bedrock使用）"
    log_warning "AWS認証情報が正しく設定されているか確認してください"
  else
    log_info "モックモードでテストします"
  fi
}

###############################################################################
# Test 1: 画像ベクトル化API - 正常系
###############################################################################

test_image_embedding_success() {
  log_header "Test 1: 画像ベクトル化API - 正常系"

  if [ ! -f "$TEST_IMAGE_SMALL" ]; then
    log_warning "テスト画像が存在しないため、このテストをスキップします"
    return
  fi

  increment_total
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$IMAGE_EMBEDDING_API" \
    -F "image=@${TEST_IMAGE_SMALL}")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  echo "$BODY" > /tmp/cis-test-embedding-response.json

  if [ "$HTTP_CODE" = "200" ]; then
    increment_passed "HTTPステータスコード: 200 OK"
  else
    increment_failed "HTTPステータスコード: $HTTP_CODE (期待値: 200)"
    log_info "レスポンス: $BODY"
    return
  fi

  # レスポンスのJSON検証
  increment_total
  if echo "$BODY" | jq -e '.success == true' > /dev/null 2>&1; then
    increment_passed "success フィールドが true"
  else
    increment_failed "success フィールドが true ではありません"
    log_info "レスポンス: $BODY"
  fi

  increment_total
  if echo "$BODY" | jq -e '.data.embedding' > /dev/null 2>&1; then
    increment_passed "embedding フィールドが存在します"
  else
    increment_failed "embedding フィールドが存在しません"
  fi

  increment_total
  EMBEDDING_LENGTH=$(echo "$BODY" | jq -r '.data.dimensions // 0')
  if [ "$EMBEDDING_LENGTH" = "1024" ]; then
    increment_passed "embedding が 1024次元です"
  else
    increment_failed "embedding が 1024次元ではありません（実際: $EMBEDDING_LENGTH）"
  fi

  # embeddingを保存（次のテストで使用）
  echo "$BODY" | jq -r '.data.embedding' > /tmp/cis-test-embedding-vector.json
  log_info "ベクトルを保存しました: /tmp/cis-test-embedding-vector.json"
}

###############################################################################
# Test 2: 画像ベクトル化API - ファイルサイズエラー
###############################################################################

test_image_embedding_file_too_large() {
  log_header "Test 2: 画像ベクトル化API - ファイルサイズエラー"

  # 6MBのダミーファイルを作成
  TEMP_LARGE_FILE="/tmp/cis-test-large-image.jpg"
  dd if=/dev/zero of="$TEMP_LARGE_FILE" bs=1M count=6 2>/dev/null

  increment_total
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$IMAGE_EMBEDDING_API" \
    -F "image=@${TEMP_LARGE_FILE}")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  rm -f "$TEMP_LARGE_FILE"

  if [ "$HTTP_CODE" = "400" ]; then
    increment_passed "HTTPステータスコード: 400 Bad Request（ファイルサイズエラー）"
  else
    increment_failed "HTTPステータスコード: $HTTP_CODE (期待値: 400)"
    log_info "レスポンス: $BODY"
  fi

  increment_total
  if echo "$BODY" | jq -e '.code == "FILE_TOO_LARGE"' > /dev/null 2>&1; then
    increment_passed "エラーコードが FILE_TOO_LARGE"
  else
    increment_failed "エラーコードが FILE_TOO_LARGE ではありません"
    log_info "レスポンス: $BODY"
  fi
}

###############################################################################
# Test 3: 画像ベクトル化API - ファイル形式エラー
###############################################################################

test_image_embedding_invalid_file_type() {
  log_header "Test 3: 画像ベクトル化API - ファイル形式エラー"

  # BMPファイルのダミーを作成
  TEMP_BMP_FILE="/tmp/cis-test-invalid.bmp"
  echo "BM" > "$TEMP_BMP_FILE"

  increment_total
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$IMAGE_EMBEDDING_API" \
    -F "image=@${TEMP_BMP_FILE}")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  rm -f "$TEMP_BMP_FILE"

  if [ "$HTTP_CODE" = "400" ]; then
    increment_passed "HTTPステータスコード: 400 Bad Request（ファイル形式エラー）"
  else
    increment_failed "HTTPステータスコード: $HTTP_CODE (期待値: 400)"
    log_info "レスポンス: $BODY"
  fi

  increment_total
  if echo "$BODY" | jq -e '.code == "INVALID_FILE_TYPE"' > /dev/null 2>&1; then
    increment_passed "エラーコードが INVALID_FILE_TYPE"
  else
    increment_failed "エラーコードが INVALID_FILE_TYPE ではありません"
    log_info "レスポンス: $BODY"
  fi
}

###############################################################################
# Test 4: 画像検索API - 正常系
###############################################################################

test_image_search_success() {
  log_header "Test 4: 画像検索API - 正常系"

  # 保存されたベクトルを読み込み
  if [ ! -f /tmp/cis-test-embedding-vector.json ]; then
    log_warning "ベクトルファイルが存在しないため、このテストをスキップします"
    log_info "先にTest 1を実行してください"
    return
  fi

  EMBEDDING_VECTOR=$(cat /tmp/cis-test-embedding-vector.json)

  increment_total
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$SEARCH_API" \
    -H "Content-Type: application/json" \
    -d "{
      \"imageEmbedding\": $EMBEDDING_VECTOR,
      \"page\": 1,
      \"size\": 20
    }")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  echo "$BODY" > /tmp/cis-test-search-response.json

  if [ "$HTTP_CODE" = "200" ]; then
    increment_passed "HTTPステータスコード: 200 OK"
  else
    increment_failed "HTTPステータスコード: $HTTP_CODE (期待値: 200)"
    log_info "レスポンス: $BODY"
    return
  fi

  # レスポンスのJSON検証
  increment_total
  if echo "$BODY" | jq -e '.success == true' > /dev/null 2>&1; then
    increment_passed "success フィールドが true"
  else
    increment_failed "success フィールドが true ではありません"
    log_info "レスポンス: $BODY"
  fi

  increment_total
  if echo "$BODY" | jq -e '.data.results' > /dev/null 2>&1; then
    RESULT_COUNT=$(echo "$BODY" | jq -r '.data.results | length')
    increment_passed "検索結果が返されました（${RESULT_COUNT}件）"
  else
    increment_failed "検索結果が存在しません"
  fi

  increment_total
  if echo "$BODY" | jq -e '.data.pagination' > /dev/null 2>&1; then
    increment_passed "pagination 情報が存在します"
  else
    increment_failed "pagination 情報が存在しません"
  fi
}

###############################################################################
# Test 5: 画像検索API - バリデーションエラー
###############################################################################

test_image_search_validation_error() {
  log_header "Test 5: 画像検索API - バリデーションエラー"

  # imageEmbeddingなし、queryもなし
  increment_total
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$SEARCH_API" \
    -H "Content-Type: application/json" \
    -d '{
      "page": 1,
      "size": 20
    }')

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "400" ]; then
    increment_passed "HTTPステータスコード: 400 Bad Request（バリデーションエラー）"
  else
    increment_failed "HTTPステータスコード: $HTTP_CODE (期待値: 400)"
    log_info "レスポンス: $BODY"
  fi

  increment_total
  if echo "$BODY" | jq -e '.code == "INVALID_QUERY"' > /dev/null 2>&1; then
    increment_passed "エラーコードが INVALID_QUERY"
  else
    increment_failed "エラーコードが INVALID_QUERY ではありません"
    log_info "レスポンス: $BODY"
  fi
}

###############################################################################
# Test 6: CORS ヘッダー確認
###############################################################################

test_cors_headers() {
  log_header "Test 6: CORS ヘッダー確認"

  # OPTIONSリクエスト（画像ベクトル化API）
  increment_total
  RESPONSE=$(curl -s -I -X OPTIONS "$IMAGE_EMBEDDING_API" \
    -H "Origin: http://localhost:3000")

  if echo "$RESPONSE" | grep -i "Access-Control-Allow-Origin" > /dev/null; then
    increment_passed "画像ベクトル化API: Access-Control-Allow-Origin ヘッダーが存在します"
  else
    increment_failed "画像ベクトル化API: Access-Control-Allow-Origin ヘッダーが存在しません"
    log_info "レスポンスヘッダー: $RESPONSE"
  fi

  # OPTIONSリクエスト（検索API）
  increment_total
  RESPONSE=$(curl -s -I -X OPTIONS "$SEARCH_API" \
    -H "Origin: http://localhost:3000")

  if echo "$RESPONSE" | grep -i "Access-Control-Allow-Origin" > /dev/null; then
    increment_passed "検索API: Access-Control-Allow-Origin ヘッダーが存在します"
  else
    increment_failed "検索API: Access-Control-Allow-Origin ヘッダーが存在しません"
    log_info "レスポンスヘッダー: $RESPONSE"
  fi
}

###############################################################################
# テスト結果サマリー
###############################################################################

print_summary() {
  log_header "テスト結果サマリー"

  log "総テスト数: ${TESTS_TOTAL}"
  log_success "成功: ${TESTS_PASSED}"
  if [ "$TESTS_FAILED" -gt 0 ]; then
    log_error "失敗: ${TESTS_FAILED}"
  else
    log_success "失敗: ${TESTS_FAILED}"
  fi

  SUCCESS_RATE=$((TESTS_PASSED * 100 / TESTS_TOTAL))
  log ""
  log "成功率: ${SUCCESS_RATE}%"
  log ""

  if [ "$TESTS_FAILED" -eq 0 ]; then
    log_success "すべてのテストが成功しました！"
    log ""
    log_info "ログファイル: $LOG_FILE"
    exit 0
  else
    log_error "一部のテストが失敗しました"
    log ""
    log_info "ログファイル: $LOG_FILE"
    log_info "詳細なエラー情報は上記のログを参照してください"
    exit 1
  fi
}

###############################################################################
# メイン処理
###############################################################################

main() {
  log_header "画像検索機能 統合テスト開始"
  log "モード: $MODE"
  log "日時: $(date)"
  log ""

  # 前提条件チェック
  check_prerequisites

  # テスト実行
  test_image_embedding_success
  test_image_embedding_file_too_large
  test_image_embedding_invalid_file_type
  test_image_search_success
  test_image_search_validation_error
  test_cors_headers

  # 結果表示
  print_summary
}

# スクリプト実行
main
