#!/bin/bash
# Quick Deploy Script - Lambda関数を迅速にデプロイ
# KNN検索の修正を反映させるための緊急デプロイスクリプト

set -e

echo "=== Quick Lambda Deploy ==="
echo "Deploying OpenSearch service fix..."

# Lambda関数名
LAMBDA_FUNCTION_NAME="cis-search-api"
REGION="ap-northeast-1"

# 一時ディレクトリ作成
TEMP_DIR=$(mktemp -d)
echo "Using temporary directory: $TEMP_DIR"

# 必要なファイルをコピー
echo "Copying source files..."
mkdir -p "$TEMP_DIR/src/services"
mkdir -p "$TEMP_DIR/src/types"
mkdir -p "$TEMP_DIR/src/utils"

cp src/services/opensearch.service.enhanced.ts "$TEMP_DIR/src/services/"
cp src/services/logger.service.ts "$TEMP_DIR/src/services/"
cp src/index.ts "$TEMP_DIR/src/"
cp -r src/types "$TEMP_DIR/src/"
cp -r src/utils "$TEMP_DIR/src/"
cp package.json "$TEMP_DIR/"
cp tsconfig.json "$TEMP_DIR/"

# 依存関係をインストール
echo "Installing dependencies..."
cd "$TEMP_DIR"
npm install --production

# TypeScriptをコンパイル
echo "Compiling TypeScript..."
npx tsc

# デプロイパッケージを作成
echo "Creating deployment package..."
zip -r lambda-deployment.zip node_modules dist package.json

# Lambda関数を更新
echo "Updating Lambda function: $LAMBDA_FUNCTION_NAME"
aws lambda update-function-code \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --zip-file "fileb://lambda-deployment.zip" \
  --region "$REGION"

echo "Waiting for Lambda update to complete..."
aws lambda wait function-updated \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --region "$REGION"

echo "=== Deployment Complete ==="
echo "Lambda function updated successfully: $LAMBDA_FUNCTION_NAME"
echo "Region: $REGION"

# クリーンアップ
rm -rf "$TEMP_DIR"
echo "Temporary files cleaned up"
