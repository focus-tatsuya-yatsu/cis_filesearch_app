#!/bin/bash

###############################################################################
# 画像検索機能 クイックテストスクリプト
#
# 最小限のテストで基本動作を確認します
#
# 使用方法:
#   ./scripts/quick-test-image-search.sh [image-file]
#
# 引数:
#   image-file - テスト用画像ファイルパス（省略可）
###############################################################################

set -e

# カラー出力
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# API URL
BASE_URL="http://localhost:3000"
IMAGE_EMBEDDING_API="${BASE_URL}/api/image-embedding/"
SEARCH_API="${BASE_URL}/api/search/"

# テスト画像
TEST_IMAGE="${1:-./test-data/images/test-small.jpg}"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}画像検索機能 クイックテスト${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 1. サーバー確認
echo -e "${YELLOW}[1/4] サーバー起動確認...${NC}"
if curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}" | grep -q "200\|301\|302"; then
  echo -e "${GREEN}✓ サーバーが起動しています${NC}"
else
  echo -e "${RED}✗ サーバーが起動していません${NC}"
  echo -e "${YELLOW}  'yarn dev' を実行してください${NC}"
  exit 1
fi
echo ""

# 2. テスト画像確認
echo -e "${YELLOW}[2/4] テスト画像確認...${NC}"
if [ -f "$TEST_IMAGE" ]; then
  FILE_SIZE=$(du -h "$TEST_IMAGE" | cut -f1)
  echo -e "${GREEN}✓ テスト画像が存在します${NC}"
  echo -e "  ファイル: $TEST_IMAGE"
  echo -e "  サイズ: $FILE_SIZE"
else
  echo -e "${RED}✗ テスト画像が見つかりません: $TEST_IMAGE${NC}"
  echo -e "${YELLOW}  使用方法: $0 [画像ファイルパス]${NC}"
  exit 1
fi
echo ""

# 3. 画像ベクトル化
echo -e "${YELLOW}[3/4] 画像ベクトル化実行...${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$IMAGE_EMBEDDING_API" \
  -F "image=@${TEST_IMAGE}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}✓ ベクトル化成功 (HTTP 200)${NC}"

  # ベクトル情報を取得
  DIMENSIONS=$(echo "$BODY" | jq -r '.data.dimensions // 0')
  FILE_NAME=$(echo "$BODY" | jq -r '.data.fileName // "unknown"')

  echo -e "  ファイル名: $FILE_NAME"
  echo -e "  次元数: $DIMENSIONS"

  if [ "$DIMENSIONS" = "1024" ]; then
    echo -e "${GREEN}✓ ベクトルが正しい次元数です（1024次元）${NC}"
  else
    echo -e "${RED}✗ ベクトルの次元数が異常です: $DIMENSIONS${NC}"
    exit 1
  fi

  # ベクトルを保存
  EMBEDDING=$(echo "$BODY" | jq -r '.data.embedding')
  echo "$EMBEDDING" > /tmp/quick-test-embedding.json
else
  echo -e "${RED}✗ ベクトル化失敗 (HTTP $HTTP_CODE)${NC}"
  echo -e "${RED}レスポンス:${NC}"
  echo "$BODY" | jq .
  exit 1
fi
echo ""

# 4. 画像検索
echo -e "${YELLOW}[4/4] 画像検索実行...${NC}"
EMBEDDING_VECTOR=$(cat /tmp/quick-test-embedding.json)

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$SEARCH_API" \
  -H "Content-Type: application/json" \
  -d "{
    \"imageEmbedding\": $EMBEDDING_VECTOR,
    \"page\": 1,
    \"size\": 5
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}✓ 検索成功 (HTTP 200)${NC}"

  # 検索結果を取得
  SUCCESS=$(echo "$BODY" | jq -r '.success // false')
  RESULT_COUNT=$(echo "$BODY" | jq -r '.data.results | length // 0' 2>/dev/null || echo "0")
  TOTAL=$(echo "$BODY" | jq -r '.data.pagination.total // 0' 2>/dev/null || echo "0")

  echo -e "  検索成功: $SUCCESS"
  echo -e "  取得件数: $RESULT_COUNT"
  echo -e "  総件数: $TOTAL"

  if [ "$SUCCESS" = "true" ]; then
    echo -e "${GREEN}✓ 検索が正常に完了しました${NC}"

    # 結果の一部を表示
    if [ "$RESULT_COUNT" -gt 0 ]; then
      echo -e "\n${BLUE}検索結果（上位5件）:${NC}"
      echo "$BODY" | jq -r '.data.results[] | "  - \(.fileName) (スコア: \(.score // "N/A"))"' | head -5
    else
      echo -e "${YELLOW}  検索結果が0件です（データが登録されていない可能性があります）${NC}"
    fi
  else
    echo -e "${RED}✗ 検索が失敗しました${NC}"
    echo "$BODY" | jq .
    exit 1
  fi
else
  echo -e "${RED}✗ 検索失敗 (HTTP $HTTP_CODE)${NC}"
  echo -e "${RED}レスポンス:${NC}"
  echo "$BODY" | jq .
  exit 1
fi
echo ""

# 完了
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ すべてのテストが成功しました${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}詳細なテストは以下のコマンドで実行できます:${NC}"
echo -e "  ./scripts/test-image-search.sh"
echo ""

# クリーンアップ
rm -f /tmp/quick-test-embedding.json
