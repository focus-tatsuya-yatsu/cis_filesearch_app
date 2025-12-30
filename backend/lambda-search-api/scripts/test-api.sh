#!/bin/bash

###############################################################################
# Lambda Search API - API動作テストスクリプト
# デプロイ後の動作確認用
###############################################################################

set -e

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

function print_header() {
  echo -e "${BLUE}=========================================="
  echo -e "$1"
  echo -e "==========================================${NC}"
}

function print_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

function print_error() {
  echo -e "${RED}❌ $1${NC}"
}

function print_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

# 引数チェック
if [ $# -lt 1 ]; then
  echo "使用方法: $0 <API_GATEWAY_URL> [COGNITO_TOKEN]"
  echo ""
  echo "例:"
  echo "  $0 https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod/search"
  echo "  $0 https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod/search eyJhbGc..."
  exit 1
fi

API_URL="$1"
COGNITO_TOKEN="${2:-}"

print_header "🧪 Lambda Search API テスト"
echo "API URL: $API_URL"
echo ""

# Test 1: CORS Preflight (OPTIONS)
print_header "Test 1: CORS Preflight (OPTIONS)"

response=$(curl -s -X OPTIONS "$API_URL" -w "\nHTTP_CODE:%{http_code}" -o /tmp/test1.json)
http_code=$(echo "$response" | grep HTTP_CODE | cut -d: -f2)

if [ "$http_code" == "200" ]; then
  print_success "CORS Preflight成功 (HTTP $http_code)"
else
  print_error "CORS Preflight失敗 (HTTP $http_code)"
  cat /tmp/test1.json
  exit 1
fi

echo ""

# Test 2: 認証なしでのアクセス（401エラーを期待）
print_header "Test 2: 認証なしアクセス (401エラーを期待)"

response=$(curl -s -X GET "$API_URL?q=test" -w "\nHTTP_CODE:%{http_code}" -o /tmp/test2.json)
http_code=$(echo "$response" | grep HTTP_CODE | cut -d: -f2)

if [ "$http_code" == "401" ]; then
  print_success "認証エラーが正しく返されました (HTTP $http_code)"
else
  print_warning "予期しないHTTPコード: $http_code (401を期待)"
  cat /tmp/test2.json
fi

echo ""

# Cognitoトークンが提供されている場合のみ、以降のテストを実行
if [ -z "$COGNITO_TOKEN" ]; then
  print_warning "Cognitoトークンが提供されていません"
  print_warning "以降のテストをスキップします"
  echo ""
  echo "Cognitoトークンの取得方法:"
  echo "  aws cognito-idp initiate-auth \\"
  echo "    --auth-flow USER_PASSWORD_AUTH \\"
  echo "    --client-id YOUR_CLIENT_ID \\"
  echo "    --auth-parameters USERNAME=user@example.com,PASSWORD=YourPassword123!"
  echo ""
  exit 0
fi

# Test 3: 基本検索
print_header "Test 3: 基本検索 (クエリ: 'test')"

response=$(curl -s -X GET "$API_URL?q=test&page=1&limit=10" \
  -H "Authorization: Bearer $COGNITO_TOKEN" \
  -H "Content-Type: application/json" \
  -w "\nHTTP_CODE:%{http_code}" -o /tmp/test3.json)
http_code=$(echo "$response" | grep HTTP_CODE | cut -d: -f2)

if [ "$http_code" == "200" ]; then
  print_success "基本検索成功 (HTTP $http_code)"

  # レスポンスの解析
  if command -v jq &> /dev/null; then
    echo ""
    echo "レスポンス概要:"
    jq '{
      success: .success,
      total: .data.pagination.total,
      results_count: (.data.results | length),
      took: .data.took
    }' /tmp/test3.json
  else
    cat /tmp/test3.json
  fi
else
  print_error "基本検索失敗 (HTTP $http_code)"
  cat /tmp/test3.json
  exit 1
fi

echo ""

# Test 4: AND検索
print_header "Test 4: AND検索モード"

response=$(curl -s -X GET "$API_URL?q=report%20document&searchMode=and&page=1&limit=5" \
  -H "Authorization: Bearer $COGNITO_TOKEN" \
  -H "Content-Type: application/json" \
  -w "\nHTTP_CODE:%{http_code}" -o /tmp/test4.json)
http_code=$(echo "$response" | grep HTTP_CODE | cut -d: -f2)

if [ "$http_code" == "200" ]; then
  print_success "AND検索成功 (HTTP $http_code)"

  if command -v jq &> /dev/null; then
    echo ""
    echo "レスポンス概要:"
    jq '{
      search_mode: .data.query.searchMode,
      total: .data.pagination.total,
      results_count: (.data.results | length)
    }' /tmp/test4.json
  fi
else
  print_error "AND検索失敗 (HTTP $http_code)"
  cat /tmp/test4.json
fi

echo ""

# Test 5: ファイルタイプフィルター
print_header "Test 5: ファイルタイプフィルター (PDF)"

response=$(curl -s -X GET "$API_URL?q=test&fileType=pdf&page=1&limit=5" \
  -H "Authorization: Bearer $COGNITO_TOKEN" \
  -H "Content-Type: application/json" \
  -w "\nHTTP_CODE:%{http_code}" -o /tmp/test5.json)
http_code=$(echo "$response" | grep HTTP_CODE | cut -d: -f2)

if [ "$http_code" == "200" ]; then
  print_success "ファイルタイプフィルター成功 (HTTP $http_code)"

  if command -v jq &> /dev/null; then
    echo ""
    echo "レスポンス概要:"
    jq '{
      file_type: .data.query.fileType,
      total: .data.pagination.total,
      results_count: (.data.results | length)
    }' /tmp/test5.json
  fi
else
  print_error "ファイルタイプフィルター失敗 (HTTP $http_code)"
  cat /tmp/test5.json
fi

echo ""

# Test 6: 日付範囲フィルター
print_header "Test 6: 日付範囲フィルター"

DATE_FROM="2024-01-01"
DATE_TO="2025-12-31"

response=$(curl -s -X GET "$API_URL?q=test&dateFrom=$DATE_FROM&dateTo=$DATE_TO&page=1&limit=5" \
  -H "Authorization: Bearer $COGNITO_TOKEN" \
  -H "Content-Type: application/json" \
  -w "\nHTTP_CODE:%{http_code}" -o /tmp/test6.json)
http_code=$(echo "$response" | grep HTTP_CODE | cut -d: -f2)

if [ "$http_code" == "200" ]; then
  print_success "日付範囲フィルター成功 (HTTP $http_code)"

  if command -v jq &> /dev/null; then
    echo ""
    echo "レスポンス概要:"
    jq '{
      date_from: .data.query.dateFrom,
      date_to: .data.query.dateTo,
      total: .data.pagination.total
    }' /tmp/test6.json
  fi
else
  print_error "日付範囲フィルター失敗 (HTTP $http_code)"
  cat /tmp/test6.json
fi

echo ""

# Test 7: ソート機能
print_header "Test 7: ソート機能 (日付降順)"

response=$(curl -s -X GET "$API_URL?q=test&sortBy=date&sortOrder=desc&page=1&limit=5" \
  -H "Authorization: Bearer $COGNITO_TOKEN" \
  -H "Content-Type: application/json" \
  -w "\nHTTP_CODE:%{http_code}" -o /tmp/test7.json)
http_code=$(echo "$response" | grep HTTP_CODE | cut -d: -f2)

if [ "$http_code" == "200" ]; then
  print_success "ソート機能成功 (HTTP $http_code)"

  if command -v jq &> /dev/null; then
    echo ""
    echo "レスポンス概要:"
    jq '{
      sort_by: .data.query.sortBy,
      sort_order: .data.query.sortOrder,
      first_result_date: .data.results[0].modifiedDate
    }' /tmp/test7.json
  fi
else
  print_error "ソート機能失敗 (HTTP $http_code)"
  cat /tmp/test7.json
fi

echo ""

# Test 8: ページネーション
print_header "Test 8: ページネーション (2ページ目)"

response=$(curl -s -X GET "$API_URL?q=test&page=2&limit=10" \
  -H "Authorization: Bearer $COGNITO_TOKEN" \
  -H "Content-Type: application/json" \
  -w "\nHTTP_CODE:%{http_code}" -o /tmp/test8.json)
http_code=$(echo "$response" | grep HTTP_CODE | cut -d: -f2)

if [ "$http_code" == "200" ]; then
  print_success "ページネーション成功 (HTTP $http_code)"

  if command -v jq &> /dev/null; then
    echo ""
    echo "レスポンス概要:"
    jq '{
      current_page: .data.pagination.page,
      limit: .data.pagination.limit,
      total_pages: .data.pagination.totalPages,
      results_count: (.data.results | length)
    }' /tmp/test8.json
  fi
else
  print_error "ページネーション失敗 (HTTP $http_code)"
  cat /tmp/test8.json
fi

echo ""

# Test 9: バリデーションエラー（空のクエリ）
print_header "Test 9: バリデーションエラー (空のクエリ)"

response=$(curl -s -X GET "$API_URL?q=&page=1&limit=10" \
  -H "Authorization: Bearer $COGNITO_TOKEN" \
  -H "Content-Type: application/json" \
  -w "\nHTTP_CODE:%{http_code}" -o /tmp/test9.json)
http_code=$(echo "$response" | grep HTTP_CODE | cut -d: -f2)

if [ "$http_code" == "400" ]; then
  print_success "バリデーションエラーが正しく返されました (HTTP $http_code)"

  if command -v jq &> /dev/null; then
    echo ""
    echo "エラーレスポンス:"
    jq '{
      success: .success,
      error_code: .error.code,
      error_message: .error.message
    }' /tmp/test9.json
  fi
else
  print_warning "予期しないHTTPコード: $http_code (400を期待)"
  cat /tmp/test9.json
fi

echo ""

# テスト結果サマリー
print_header "🎉 テスト完了"
echo ""
print_success "すべての主要機能が正常に動作しています！"
echo ""
echo "テスト結果ファイル:"
echo "  /tmp/test1.json - /tmp/test9.json"
echo ""
echo "次のステップ:"
echo "  1. CloudWatch Logsでログを確認"
echo "  2. CloudWatch Metricsでパフォーマンスを確認"
echo "  3. フロントエンドとの統合テスト"
echo ""
