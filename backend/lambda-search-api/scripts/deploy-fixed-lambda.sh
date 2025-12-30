#!/bin/bash

#############################################################################
# Lambda 503エラー修正版デプロイスクリプト
# 拡張版OpenSearchサービスを含む修正版Lambdaをデプロイ
#############################################################################

set -e

# 色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 設定
LAMBDA_FUNCTION_NAME="cis-search-api-prod"
REGION="ap-northeast-1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Lambda 503エラー修正版デプロイ${NC}"
echo -e "${BLUE}========================================${NC}\n"

echo "Project Directory: $PROJECT_DIR"
echo "Lambda Function: $LAMBDA_FUNCTION_NAME"
echo ""

# 1. 依存関係のインストール
echo -e "${YELLOW}[1/5] 依存関係のインストール...${NC}"
cd "$PROJECT_DIR"

if [ ! -d "node_modules" ]; then
  echo "  npm install を実行中..."
  npm install
else
  echo "  node_modules は既に存在します"
fi

echo -e "${GREEN}✓ 依存関係のインストール完了${NC}"

# 2. TypeScriptコンパイル
echo -e "\n${YELLOW}[2/5] TypeScriptコンパイル...${NC}"

if [ ! -f "tsconfig.json" ]; then
  echo -e "${RED}✗ tsconfig.json が見つかりません${NC}"
  exit 1
fi

npm run build

if [ ! -d "dist" ]; then
  echo -e "${RED}✗ distディレクトリが作成されていません${NC}"
  exit 1
fi

echo -e "${GREEN}✓ TypeScriptコンパイル完了${NC}"

# 3. デプロイパッケージの作成
echo -e "\n${YELLOW}[3/5] デプロイパッケージ作成...${NC}"

# 既存のZIPファイルを削除
rm -f lambda-deployment.zip

# node_modulesをdistにコピー
echo "  node_modulesをコピー中..."
cp -r node_modules dist/ 2>/dev/null || true

# ZIPファイルを作成
cd dist
echo "  ZIPファイル作成中..."
zip -r ../lambda-deployment.zip . -q

cd ..

# ファイルサイズ確認
ZIP_SIZE=$(du -h lambda-deployment.zip | cut -f1)
echo "  パッケージサイズ: $ZIP_SIZE"

echo -e "${GREEN}✓ デプロイパッケージ作成完了${NC}"

# 4. Lambda関数の更新
echo -e "\n${YELLOW}[4/5] Lambda関数の更新...${NC}"

UPDATE_RESULT=$(aws lambda update-function-code \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --zip-file fileb://lambda-deployment.zip \
  --region "$REGION" 2>&1)

if [ $? -ne 0 ]; then
  echo -e "${RED}✗ Lambda更新に失敗しました${NC}"
  echo "$UPDATE_RESULT"
  exit 1
fi

echo -e "${GREEN}✓ Lambda関数の更新完了${NC}"

# Lambda更新の完了を待機
echo "  Lambda更新を待機中..."
sleep 10

# 5. デプロイ確認
echo -e "\n${YELLOW}[5/5] デプロイ確認...${NC}"

# Lambda設定を取得
LAMBDA_CONFIG=$(aws lambda get-function-configuration \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --region "$REGION")

LAST_MODIFIED=$(echo "$LAMBDA_CONFIG" | jq -r '.LastModified')
CODE_SIZE=$(echo "$LAMBDA_CONFIG" | jq -r '.CodeSize')
RUNTIME=$(echo "$LAMBDA_CONFIG" | jq -r '.Runtime')
HANDLER=$(echo "$LAMBDA_CONFIG" | jq -r '.Handler')

echo "  最終更新: $LAST_MODIFIED"
echo "  コードサイズ: $CODE_SIZE bytes"
echo "  ランタイム: $RUNTIME"
echo "  ハンドラー: $HANDLER"

echo -e "${GREEN}✓ デプロイ確認完了${NC}"

# テスト実行
echo -e "\n${BLUE}========================================${NC}"
echo -e "${GREEN}デプロイ完了!${NC}"
echo -e "${BLUE}========================================${NC}\n"

read -p "デプロイしたLambdaをテストしますか? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo -e "\n${YELLOW}Lambdaテスト実行中...${NC}\n"

  TEST_PAYLOAD='{"httpMethod":"GET","queryStringParameters":{"q":"test","limit":"3"}}'

  aws lambda invoke \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --payload "$TEST_PAYLOAD" \
    --region "$REGION" \
    /tmp/deploy-test-response.json

  echo -e "\n${BLUE}レスポンス:${NC}"
  cat /tmp/deploy-test-response.json | jq '.'

  STATUS_CODE=$(cat /tmp/deploy-test-response.json | jq -r '.statusCode')

  if [ "$STATUS_CODE" == "200" ]; then
    echo -e "\n${GREEN}✓✓✓ 成功! デプロイされたLambdaが正常に動作しています ✓✓✓${NC}"
  else
    echo -e "\n${RED}✗ エラーが発生しました${NC}"
    echo ""
    echo "CloudWatchログを確認:"
    echo "  aws logs tail /aws/lambda/$LAMBDA_FUNCTION_NAME --follow"
  fi

  rm -f /tmp/deploy-test-response.json
fi

echo ""
echo "次のステップ:"
echo "  1. CloudWatchログで詳細確認: aws logs tail /aws/lambda/$LAMBDA_FUNCTION_NAME --follow"
echo "  2. API Gateway経由でテスト"
echo "  3. 本番環境で動作確認"
