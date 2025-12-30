#!/bin/bash

# 画像アップロード機能診断スクリプト
# 実行方法: chmod +x scripts/diagnose-image-upload.sh && ./scripts/diagnose-image-upload.sh

echo "========================================"
echo "画像アップロード機能診断スクリプト"
echo "========================================"
echo ""

# カラー定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# チェック結果カウンター
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

# チェック関数
check_pass() {
  echo -e "${GREEN}✓${NC} $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

check_fail() {
  echo -e "${RED}✗${NC} $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

check_warn() {
  echo -e "${YELLOW}⚠${NC} $1"
  WARN_COUNT=$((WARN_COUNT + 1))
}

echo "1. AWS CLI インストール確認"
echo "----------------------------------------"
if command -v aws &> /dev/null; then
  AWS_VERSION=$(aws --version 2>&1)
  check_pass "AWS CLI インストール済み: $AWS_VERSION"
else
  check_fail "AWS CLI が見つかりません"
  echo "   インストール: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
fi
echo ""

echo "2. AWS 認証情報確認"
echo "----------------------------------------"
if aws sts get-caller-identity &> /dev/null; then
  CALLER_IDENTITY=$(aws sts get-caller-identity 2>&1)
  ACCOUNT_ID=$(echo $CALLER_IDENTITY | grep -o '"Account": "[^"]*"' | cut -d'"' -f4)
  USER_ID=$(echo $CALLER_IDENTITY | grep -o '"UserId": "[^"]*"' | cut -d'"' -f4)
  check_pass "AWS 認証情報が正しく設定されています"
  echo "   Account ID: $ACCOUNT_ID"
  echo "   User ID: $USER_ID"
else
  check_fail "AWS 認証情報が設定されていません"
  echo "   設定方法: aws configure"
fi
echo ""

echo "3. Bedrock アクセス権限確認"
echo "----------------------------------------"
if aws bedrock list-foundation-models --region ap-northeast-1 &> /dev/null; then
  check_pass "Bedrock へのアクセス権限があります"

  # Titan Embeddings モデルの確認
  TITAN_MODEL=$(aws bedrock list-foundation-models --region ap-northeast-1 2>&1 | grep -i "titan-embed-image")
  if [ ! -z "$TITAN_MODEL" ]; then
    check_pass "Titan Multimodal Embeddings モデルが利用可能です"
  else
    check_warn "Titan Multimodal Embeddings モデルが見つかりません"
    echo "   AWS Console → Bedrock → Model access で有効化してください"
  fi
else
  check_fail "Bedrock へのアクセス権限がありません"
  echo "   IAM ポリシーで bedrock:ListFoundationModels 権限を付与してください"
fi
echo ""

echo "4. .env.local 設定確認"
echo "----------------------------------------"
ENV_FILE="../.env.local"
if [ -f "$ENV_FILE" ]; then
  check_pass ".env.local ファイルが存在します"

  # AWS_REGION
  if grep -q "^AWS_REGION=" "$ENV_FILE"; then
    AWS_REGION=$(grep "^AWS_REGION=" "$ENV_FILE" | cut -d'=' -f2)
    check_pass "AWS_REGION が設定されています: $AWS_REGION"
  else
    check_warn "AWS_REGION が設定されていません（デフォルト: ap-northeast-1）"
  fi

  # AWS_ACCESS_KEY_ID
  if grep -q "^AWS_ACCESS_KEY_ID=" "$ENV_FILE"; then
    check_pass "AWS_ACCESS_KEY_ID が設定されています"
  else
    check_warn "AWS_ACCESS_KEY_ID が設定されていません"
    echo "   モックモードで動作します（開発環境のみ）"
  fi

  # AWS_SECRET_ACCESS_KEY
  if grep -q "^AWS_SECRET_ACCESS_KEY=" "$ENV_FILE"; then
    check_pass "AWS_SECRET_ACCESS_KEY が設定されています"
  else
    check_warn "AWS_SECRET_ACCESS_KEY が設定されていません"
  fi

else
  check_fail ".env.local ファイルが見つかりません"
  echo "   .env.example をコピーして .env.local を作成してください"
fi
echo ""

echo "5. Next.js 開発サーバー確認"
echo "----------------------------------------"
if lsof -ti:3000 &> /dev/null; then
  check_pass "Next.js 開発サーバーが起動しています (port 3000)"
else
  check_warn "Next.js 開発サーバーが起動していません"
  echo "   起動方法: yarn dev"
fi
echo ""

echo "6. 必要なnpmパッケージ確認"
echo "----------------------------------------"
PACKAGE_JSON="../package.json"
if [ -f "$PACKAGE_JSON" ]; then
  # AWS SDK Bedrock Runtime
  if grep -q "@aws-sdk/client-bedrock-runtime" "$PACKAGE_JSON"; then
    check_pass "@aws-sdk/client-bedrock-runtime がインストールされています"
  else
    check_fail "@aws-sdk/client-bedrock-runtime がインストールされていません"
    echo "   インストール: yarn add @aws-sdk/client-bedrock-runtime"
  fi

  # AWS SDK Credential Provider
  if grep -q "@aws-sdk/credential-provider-node" "$PACKAGE_JSON"; then
    check_pass "@aws-sdk/credential-provider-node がインストールされています"
  else
    check_fail "@aws-sdk/credential-provider-node がインストールされていません"
    echo "   インストール: yarn add @aws-sdk/credential-provider-node"
  fi
fi
echo ""

echo "7. APIエンドポイント疎通確認"
echo "----------------------------------------"
if lsof -ti:3000 &> /dev/null; then
  # OPTIONS リクエスト（CORS確認）
  OPTIONS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS http://localhost:3000/api/image-embedding)
  if [ "$OPTIONS_STATUS" = "200" ]; then
    check_pass "API エンドポイントが応答しています (OPTIONS)"
  else
    check_warn "API エンドポイントの OPTIONS リクエストが失敗しました (Status: $OPTIONS_STATUS)"
  fi
else
  check_warn "開発サーバーが起動していないためスキップ"
fi
echo ""

echo "========================================"
echo "診断結果サマリー"
echo "========================================"
echo -e "${GREEN}成功: $PASS_COUNT${NC}"
echo -e "${YELLOW}警告: $WARN_COUNT${NC}"
echo -e "${RED}失敗: $FAIL_COUNT${NC}"
echo ""

if [ $FAIL_COUNT -gt 0 ]; then
  echo -e "${RED}✗ 問題が検出されました。上記の失敗項目を修正してください。${NC}"
  exit 1
elif [ $WARN_COUNT -gt 0 ]; then
  echo -e "${YELLOW}⚠ 警告がありますが、開発環境では動作する可能性があります。${NC}"
  exit 0
else
  echo -e "${GREEN}✓ すべてのチェックが成功しました！${NC}"
  exit 0
fi
