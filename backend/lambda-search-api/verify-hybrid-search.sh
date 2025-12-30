#!/bin/bash
#
# ハイブリッド検索検証スクリプト
#
# デプロイされたLambda関数のハイブリッド検索機能を検証します
#
# 使用方法:
#   bash verify-hybrid-search.sh [test-type]
#
# test-type:
#   health  - インデックスヘルスチェック
#   text    - テキスト検索テスト
#   image   - 画像検索テスト
#   hybrid  - ハイブリッド検索テスト
#   all     - すべてのテスト実行（デフォルト）
#

set -e

# カラー定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 設定
FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-cis-search-api}"
REGION="${AWS_REGION:-ap-northeast-1}"
TEST_TYPE="${1:-all}"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  ハイブリッド検索検証${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "Lambda関数: ${GREEN}${FUNCTION_NAME}${NC}"
echo -e "リージョン: ${GREEN}${REGION}${NC}"
echo -e "テストタイプ: ${GREEN}${TEST_TYPE}${NC}"
echo ""

# jqがインストールされているか確認
if ! command -v jq &> /dev/null; then
    echo -e "${RED}❌ jqがインストールされていません${NC}"
    echo -e "${YELLOW}   インストール: brew install jq${NC}"
    exit 1
fi

# Lambda関数呼び出しヘルパー関数
invoke_lambda() {
    local payload="$1"
    local output_file="test_result.json"

    echo -e "${YELLOW}📤 Lambda関数呼び出し中...${NC}"

    aws lambda invoke \
      --function-name "${FUNCTION_NAME}" \
      --region "${REGION}" \
      --payload "${payload}" \
      "${output_file}" \
      > /dev/null

    # レスポンス表示
    if [ -f "${output_file}" ]; then
        cat "${output_file}" | jq '.'
        rm -f "${output_file}"
    else
        echo -e "${RED}❌ レスポンスファイルが見つかりません${NC}"
        return 1
    fi
}

# ヘルスチェック
test_health_check() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Test 1: インデックスヘルスチェック${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    local payload=$(cat <<EOF
{
  "httpMethod": "GET",
  "path": "/health",
  "queryStringParameters": {}
}
EOF
)

    invoke_lambda "${payload}"

    echo -e "${GREEN}✅ ヘルスチェック完了${NC}"
}

# テキスト検索テスト
test_text_search() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Test 2: テキスト検索（cis-filesインデックス）${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    local payload=$(cat <<EOF
{
  "httpMethod": "GET",
  "path": "/search",
  "queryStringParameters": {
    "q": "契約書",
    "searchMode": "and",
    "size": "5"
  }
}
EOF
)

    echo -e "${YELLOW}検索クエリ: '契約書' (AND検索)${NC}"
    echo ""

    invoke_lambda "${payload}"

    echo ""
    echo -e "${GREEN}✅ テキスト検索完了${NC}"
    echo -e "${YELLOW}期待される結果:${NC}"
    echo -e "  - metadata.queryType: 'text'"
    echo -e "  - metadata.indices.text: 'cis-files'"
    echo -e "  - results配列に検索結果が含まれる"
}

# 画像検索テスト
test_image_search() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Test 3: 画像検索（file-index-v2-knnインデックス）${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # ダミーの1024次元ベクトル生成（実際の画像埋め込みの代わり）
    local dummy_vector=$(python3 -c "import json; print(json.dumps([0.1] * 1024))")

    local payload=$(cat <<EOF
{
  "httpMethod": "POST",
  "path": "/search",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": "{\"imageEmbedding\": ${dummy_vector}, \"size\": 5}"
}
EOF
)

    echo -e "${YELLOW}検索方法: 画像ベクトル検索（1024次元ベクトル）${NC}"
    echo ""

    invoke_lambda "${payload}"

    echo ""
    echo -e "${GREEN}✅ 画像検索完了${NC}"
    echo -e "${YELLOW}期待される結果:${NC}"
    echo -e "  - metadata.queryType: 'image'"
    echo -e "  - metadata.indices.image: 'file-index-v2-knn'"
    echo -e "  - results配列にk-NN検索結果が含まれる"
}

# ハイブリッド検索テスト
test_hybrid_search() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Test 4: ハイブリッド検索（両インデックス）${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # ダミーの1024次元ベクトル生成
    local dummy_vector=$(python3 -c "import json; print(json.dumps([0.1] * 1024))")

    local payload=$(cat <<EOF
{
  "httpMethod": "POST",
  "path": "/search",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": "{\"query\": \"契約書\", \"searchMode\": \"or\", \"imageEmbedding\": ${dummy_vector}, \"size\": 10}"
}
EOF
)

    echo -e "${YELLOW}検索クエリ: '契約書' + 画像ベクトル${NC}"
    echo ""

    invoke_lambda "${payload}"

    echo ""
    echo -e "${GREEN}✅ ハイブリッド検索完了${NC}"
    echo -e "${YELLOW}期待される結果:${NC}"
    echo -e "  - metadata.queryType: 'hybrid'"
    echo -e "  - metadata.indices.text: 'cis-files'"
    echo -e "  - metadata.indices.image: 'file-index-v2-knn'"
    echo -e "  - results配列に両インデックスからの結果がマージされている"
}

# ファイルタイプフィルターテスト
test_file_type_filter() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  Test 5: ファイルタイプフィルター${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    local payload=$(cat <<EOF
{
  "httpMethod": "GET",
  "path": "/search",
  "queryStringParameters": {
    "q": "契約",
    "fileType": "pdf",
    "size": "5"
  }
}
EOF
)

    echo -e "${YELLOW}検索クエリ: '契約' (PDFファイルのみ)${NC}"
    echo ""

    invoke_lambda "${payload}"

    echo ""
    echo -e "${GREEN}✅ ファイルタイプフィルター完了${NC}"
    echo -e "${YELLOW}期待される結果:${NC}"
    echo -e "  - すべての結果のfileTypeが'pdf'である"
}

# テスト実行
case "${TEST_TYPE}" in
    health)
        test_health_check
        ;;
    text)
        test_text_search
        ;;
    image)
        test_image_search
        ;;
    hybrid)
        test_hybrid_search
        ;;
    filter)
        test_file_type_filter
        ;;
    all)
        test_health_check
        test_text_search
        test_image_search
        test_hybrid_search
        test_file_type_filter
        ;;
    *)
        echo -e "${RED}❌ 不明なテストタイプ: ${TEST_TYPE}${NC}"
        echo ""
        echo "使用方法: bash verify-hybrid-search.sh [test-type]"
        echo ""
        echo "test-type:"
        echo "  health  - インデックスヘルスチェック"
        echo "  text    - テキスト検索テスト"
        echo "  image   - 画像検索テスト"
        echo "  hybrid  - ハイブリッド検索テスト"
        echo "  filter  - ファイルタイプフィルターテスト"
        echo "  all     - すべてのテスト実行（デフォルト）"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  🎉 すべての検証が完了しました！${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
