#!/bin/bash

################################################################################
# 画像検索機能 包括的テスト実行スクリプト
#
# このスクリプトは以下のテストを順次実行します：
# 1. Unit Tests (Jest)
# 2. Integration Tests (Jest)
# 3. E2E Tests (Playwright)
# 4. Performance Tests
#
# 使用方法:
#   ./scripts/run-image-search-tests.sh [オプション]
#
# オプション:
#   --unit-only       : ユニットテストのみ実行
#   --e2e-only        : E2Eテストのみ実行
#   --performance     : パフォーマンステストも実行
#   --coverage        : カバレッジレポート生成
#   --production      : 本番データを使用したテスト実行
#   --report          : HTML レポート生成
################################################################################

set -e  # エラー時に停止

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# スクリプトのディレクトリ
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# デフォルト設定
RUN_UNIT=true
RUN_INTEGRATION=true
RUN_E2E=true
RUN_PERFORMANCE=false
GENERATE_COVERAGE=false
USE_PRODUCTION_DATA=false
GENERATE_REPORT=false

# ログファイル
LOG_DIR="$PROJECT_DIR/test-results"
mkdir -p "$LOG_DIR"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="$LOG_DIR/test-run-$TIMESTAMP.log"

# 引数解析
while [[ $# -gt 0 ]]; do
  case $1 in
    --unit-only)
      RUN_INTEGRATION=false
      RUN_E2E=false
      shift
      ;;
    --e2e-only)
      RUN_UNIT=false
      RUN_INTEGRATION=false
      shift
      ;;
    --performance)
      RUN_PERFORMANCE=true
      shift
      ;;
    --coverage)
      GENERATE_COVERAGE=true
      shift
      ;;
    --production)
      USE_PRODUCTION_DATA=true
      shift
      ;;
    --report)
      GENERATE_REPORT=true
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# ヘルパー関数
log() {
  echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

log_success() {
  echo -e "${GREEN}✓${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
  echo -e "${RED}✗${NC} $1" | tee -a "$LOG_FILE"
}

log_warning() {
  echo -e "${YELLOW}⚠${NC} $1" | tee -a "$LOG_FILE"
}

# テスト結果カウンター
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# テスト実行関数
run_test_suite() {
  local suite_name=$1
  local command=$2

  log "Running $suite_name..."
  TOTAL_TESTS=$((TOTAL_TESTS + 1))

  if eval "$command" >> "$LOG_FILE" 2>&1; then
    log_success "$suite_name passed"
    PASSED_TESTS=$((PASSED_TESTS + 1))
    return 0
  else
    log_error "$suite_name failed"
    FAILED_TESTS=$((FAILED_TESTS + 1))
    return 1
  fi
}

# バナー表示
echo -e "${BLUE}"
cat << "EOF"
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   画像検索機能 包括的テストスイート                        ║
║   Image Search Comprehensive Test Suite                  ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}"

log "Test execution started"
log "Log file: $LOG_FILE"

# 環境確認
log "Checking environment..."

if ! command -v node &> /dev/null; then
  log_error "Node.js is not installed"
  exit 1
fi

if ! command -v yarn &> /dev/null; then
  log_error "Yarn is not installed"
  exit 1
fi

log_success "Environment check passed"

# 依存関係の確認
log "Checking dependencies..."
cd "$PROJECT_DIR"

if [ ! -d "node_modules" ]; then
  log_warning "node_modules not found, installing dependencies..."
  yarn install
fi

log_success "Dependencies ready"

# テスト環境のセットアップ
log "Setting up test environment..."

# テスト用画像が存在しない場合は作成
if [ ! -d "e2e/fixtures/images" ]; then
  log "Creating test images..."
  mkdir -p e2e/fixtures/images

  # 1x1 JPEG (最小)
  echo "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=" | base64 -d > e2e/fixtures/images/test-image.jpg

  # 1x1 PNG (最小)
  echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" | base64 -d > e2e/fixtures/images/test-image.png

  log_success "Test images created"
fi

log_success "Test environment ready"

# 1. Unit Tests
if [ "$RUN_UNIT" = true ]; then
  echo ""
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "1. Running Unit Tests"
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  JEST_CMD="yarn test --testPathPattern='(ImageSearchContainer|ImageSearchResults|imageSearch)' --passWithNoTests"

  if [ "$GENERATE_COVERAGE" = true ]; then
    JEST_CMD="$JEST_CMD --coverage"
  fi

  run_test_suite "Unit Tests" "$JEST_CMD"
fi

# 2. Integration Tests
if [ "$RUN_INTEGRATION" = true ]; then
  echo ""
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "2. Running Integration Tests"
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  run_test_suite "Integration Tests" "yarn test --testPathPattern='integration.*image' --passWithNoTests"
fi

# 3. E2E Tests
if [ "$RUN_E2E" = true ]; then
  echo ""
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "3. Running E2E Tests"
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # 開発サーバーが起動しているか確認
  if ! curl -s http://localhost:3000 > /dev/null 2>&1; then
    log_warning "Development server is not running"
    log "Starting development server..."
    yarn dev &
    DEV_SERVER_PID=$!
    sleep 10  # サーバー起動待機
    log_success "Development server started (PID: $DEV_SERVER_PID)"
  else
    log_success "Development server is already running"
    DEV_SERVER_PID=""
  fi

  # E2Eテスト実行
  if [ "$USE_PRODUCTION_DATA" = true ]; then
    log "Running E2E tests with production data..."
    run_test_suite "E2E Tests (Production)" "yarn test:e2e e2e/image-search-production.spec.ts"
  else
    run_test_suite "E2E Tests" "yarn test:e2e e2e/image-search.spec.ts"
  fi

  # 開発サーバーを停止（このスクリプトで起動した場合）
  if [ -n "$DEV_SERVER_PID" ]; then
    log "Stopping development server..."
    kill $DEV_SERVER_PID
    log_success "Development server stopped"
  fi
fi

# 4. Performance Tests
if [ "$RUN_PERFORMANCE" = true ]; then
  echo ""
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "4. Running Performance Tests"
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  run_test_suite "Performance Tests" "yarn benchmark:image"
fi

# テスト結果サマリー
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Test Results Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "Total test suites:  $TOTAL_TESTS"
echo -e "${GREEN}Passed:${NC}             $PASSED_TESTS"
echo -e "${RED}Failed:${NC}             $FAILED_TESTS"
echo ""

# カバレッジレポート
if [ "$GENERATE_COVERAGE" = true ] && [ -d "coverage" ]; then
  log "Coverage report generated: coverage/lcov-report/index.html"

  # カバレッジサマリーを表示
  if command -v jq &> /dev/null && [ -f "coverage/coverage-summary.json" ]; then
    echo -e "${BLUE}Coverage Summary:${NC}"
    jq -r '.total | "Lines: \(.lines.pct)% | Statements: \(.statements.pct)% | Functions: \(.functions.pct)% | Branches: \(.branches.pct)%"' coverage/coverage-summary.json
  fi
fi

# HTML レポート生成
if [ "$GENERATE_REPORT" = true ]; then
  log "Generating HTML test report..."

  REPORT_FILE="$LOG_DIR/test-report-$TIMESTAMP.html"

  cat > "$REPORT_FILE" << EOF
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>画像検索機能テストレポート</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    .header { background: #007AFF; color: white; padding: 20px; border-radius: 8px; }
    .summary { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .pass { color: #28a745; }
    .fail { color: #dc3545; }
    .metric { display: inline-block; margin: 10px 20px; }
    pre { background: #f8f9fa; padding: 15px; border-radius: 4px; overflow-x: auto; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🧪 画像検索機能テストレポート</h1>
    <p>実行日時: $(date)</p>
  </div>

  <div class="summary">
    <h2>テスト結果サマリー</h2>
    <div class="metric">総テストスイート: <strong>$TOTAL_TESTS</strong></div>
    <div class="metric pass">成功: <strong>$PASSED_TESTS</strong></div>
    <div class="metric fail">失敗: <strong>$FAILED_TESTS</strong></div>
  </div>

  <div class="summary">
    <h2>詳細ログ</h2>
    <pre>$(cat "$LOG_FILE")</pre>
  </div>
</body>
</html>
EOF

  log_success "HTML report generated: $REPORT_FILE"
fi

# Playwright レポート
if [ "$RUN_E2E" = true ] && [ -d "playwright-report" ]; then
  log "Playwright report: playwright-report/index.html"
  log "To view: yarn test:e2e:report"
fi

# 終了コード
echo ""
if [ $FAILED_TESTS -eq 0 ]; then
  log_success "All tests passed! 🎉"
  exit 0
else
  log_error "Some tests failed. Please check the logs."
  exit 1
fi
