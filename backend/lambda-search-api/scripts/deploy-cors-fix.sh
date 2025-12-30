#!/bin/bash

# Lambda Search API デプロイスクリプト（CORS修正版）
# CORSヘッダーにPOSTメソッドを追加し、画像検索をサポート

set -e  # エラー時に即座に停止

# カラー定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 環境変数
LAMBDA_FUNCTION_NAME="cis-search-api"
AWS_REGION="ap-northeast-1"

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}Lambda Search API - CORS Fix Deployment${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# 前提条件チェック
echo -e "${YELLOW}[1/6] Checking prerequisites...${NC}"

# Node.js がインストールされているか確認
if ! command -v node &> /dev/null; then
    echo -e "${RED}ERROR: Node.js is not installed${NC}"
    exit 1
fi

# AWS CLI がインストールされているか確認
if ! command -v aws &> /dev/null; then
    echo -e "${RED}ERROR: AWS CLI is not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Prerequisites satisfied${NC}"
echo ""

# プロジェクトディレクトリに移動
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo -e "${YELLOW}[2/6] Installing dependencies...${NC}"
npm install --production=false
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

echo -e "${YELLOW}[3/6] Building TypeScript...${NC}"
npm run build

if [ ! -d "dist" ]; then
    echo -e "${RED}ERROR: Build failed - dist directory not found${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Build completed${NC}"
echo ""

echo -e "${YELLOW}[4/6] Creating deployment package...${NC}"

# 既存のzipファイルを削除
rm -f lambda-deployment.zip

# 本番用依存関係のみをインストール
npm install --production

# デプロイパッケージを作成
cd dist
zip -r ../lambda-deployment.zip .
cd ..

# node_modulesを含める
zip -r lambda-deployment.zip node_modules

# パッケージサイズを確認
PACKAGE_SIZE=$(du -h lambda-deployment.zip | cut -f1)
echo -e "${GREEN}✓ Deployment package created${NC}"
echo -e "  Package size: ${PACKAGE_SIZE}"
echo ""

echo -e "${YELLOW}[5/6] Deploying to AWS Lambda...${NC}"

# Lambda関数を更新
aws lambda update-function-code \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --zip-file fileb://lambda-deployment.zip \
  --region "$AWS_REGION" \
  --no-cli-pager

echo -e "${GREEN}✓ Lambda function updated${NC}"
echo ""

# 関数が更新されるまで待機
echo -e "${YELLOW}[6/6] Waiting for function update to complete...${NC}"
aws lambda wait function-updated \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --region "$AWS_REGION"

echo -e "${GREEN}✓ Function update completed${NC}"
echo ""

# デプロイ後の情報を表示
echo -e "${BLUE}================================================${NC}"
echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""
echo -e "Function Name: ${LAMBDA_FUNCTION_NAME}"
echo -e "Region: ${AWS_REGION}"
echo -e "Package Size: ${PACKAGE_SIZE}"
echo ""

# 最新の関数設定を表示
echo -e "${YELLOW}Latest Function Configuration:${NC}"
aws lambda get-function-configuration \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --region "$AWS_REGION" \
  --query '{
    Runtime: Runtime,
    Timeout: Timeout,
    MemorySize: MemorySize,
    LastModified: LastModified,
    State: State
  }' \
  --output table

echo ""
echo -e "${GREEN}CORS Fix Applied:${NC}"
echo -e "  - Added POST method to Access-Control-Allow-Methods"
echo -e "  - Image search API now supports POST requests"
echo -e "  - Both GET (text search) and POST (image search) are now enabled"
echo ""

# クリーンアップ
echo -e "${YELLOW}Cleaning up...${NC}"
npm install  # 開発用依存関係を再インストール

echo -e "${GREEN}✓ Cleanup completed${NC}"
echo ""
echo -e "${BLUE}================================================${NC}"
echo -e "${GREEN}Done! You can now test the image search API.${NC}"
echo -e "${BLUE}================================================${NC}"
