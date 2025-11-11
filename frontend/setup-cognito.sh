#!/bin/bash

###############################################################################
# AWS Cognito Environment Variables Setup Script
# CIS File Search Application
#
# このスクリプトは .env.local ファイルを自動的に作成し、
# AWS Cognitoの環境変数を設定します。
#
# 使用方法:
#   chmod +x setup-cognito.sh
#   ./setup-cognito.sh
#
# または:
#   bash setup-cognito.sh
###############################################################################

set -e  # エラーが発生したら即座に終了

# 色の定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ロゴ表示
echo -e "${CYAN}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║         CIS File Search Application                           ║"
echo "║         AWS Cognito Environment Setup                         ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# 現在のディレクトリを確認
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo -e "${BLUE}Current directory: ${SCRIPT_DIR}${NC}"

# .env.local.example の存在確認
if [ ! -f "${SCRIPT_DIR}/.env.local.example" ]; then
    echo -e "${RED}❌ Error: .env.local.example file not found${NC}"
    echo -e "${YELLOW}Please ensure you are in the frontend directory${NC}"
    exit 1
fi

# 既存の .env.local ファイルの確認
if [ -f "${SCRIPT_DIR}/.env.local" ]; then
    echo -e "${YELLOW}⚠️  Warning: .env.local file already exists${NC}"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${BLUE}Setup cancelled. Existing .env.local preserved.${NC}"
        exit 0
    fi
    # バックアップを作成
    cp "${SCRIPT_DIR}/.env.local" "${SCRIPT_DIR}/.env.local.backup"
    echo -e "${GREEN}✅ Backup created: .env.local.backup${NC}"
fi

# 環境変数の入力
echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}Step 1: AWS Cognito設定値の入力${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

echo -e "${YELLOW}AWS Console → Cognito → User pools → [Your Pool] から以下の値を取得してください${NC}\n"

# User Pool ID
echo -e "${GREEN}1. User Pool ID${NC}"
echo -e "${BLUE}   場所: Pool overview → Pool Id${NC}"
echo -e "${BLUE}   形式例: ap-northeast-1_abc123XYZ${NC}"
read -p "   入力: " USER_POOL_ID

# 形式チェック（User Pool ID）
if [[ ! $USER_POOL_ID =~ ^[a-z]{2}-[a-z]+-[0-9]+_[a-zA-Z0-9]+$ ]]; then
    echo -e "${RED}❌ Error: Invalid User Pool ID format${NC}"
    echo -e "${YELLOW}Expected format: ap-northeast-1_XXXXXXXXX${NC}"
    exit 1
fi
echo -e "${GREEN}✅ User Pool ID format validated${NC}\n"

# App Client ID
echo -e "${GREEN}2. App Client ID${NC}"
echo -e "${BLUE}   場所: App integration → App clients → Client ID${NC}"
echo -e "${BLUE}   形式例: 7uvwxyz1234567890abcdefghijklmn${NC}"
read -p "   入力: " APP_CLIENT_ID

# 空チェック（App Client ID）
if [ -z "$APP_CLIENT_ID" ]; then
    echo -e "${RED}❌ Error: App Client ID cannot be empty${NC}"
    exit 1
fi
echo -e "${GREEN}✅ App Client ID validated${NC}\n"

# Cognito Domain
echo -e "${GREEN}3. Cognito Domain${NC}"
echo -e "${BLUE}   場所: App integration → Domain${NC}"
echo -e "${BLUE}   形式例: filesearch.auth.ap-northeast-1.amazoncognito.com${NC}"
echo -e "${RED}   ⚠️  注意: https:// は含めないでください${NC}"
read -p "   入力: " COGNITO_DOMAIN

# 形式チェック（Cognito Domain）
if [[ $COGNITO_DOMAIN =~ ^https?:// ]]; then
    echo -e "${RED}❌ Error: Domain should NOT include http:// or https://${NC}"
    echo -e "${YELLOW}Please remove the protocol and enter domain name only${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Cognito Domain format validated${NC}\n"

# App URL
echo -e "${GREEN}4. Application URL${NC}"
echo -e "${BLUE}   開発環境: http://localhost:3000${NC}"
echo -e "${BLUE}   本番環境: https://your-cloudfront-domain.cloudfront.net${NC}"
echo -e "${RED}   ⚠️  注意: http:// または https:// で始まる必要があります${NC}"
read -p "   入力: " APP_URL

# 形式チェック（App URL）
if [[ ! $APP_URL =~ ^https?:// ]]; then
    echo -e "${RED}❌ Error: App URL must start with http:// or https://${NC}"
    echo -e "${YELLOW}Please add the protocol (http:// or https://)${NC}"
    exit 1
fi
echo -e "${GREEN}✅ App URL format validated${NC}\n"

# API Gateway URL（オプショナル）
echo -e "${GREEN}5. API Gateway URL (オプショナル)${NC}"
echo -e "${BLUE}   場所: API Gateway → [Your API] → Stages → Invoke URL${NC}"
echo -e "${BLUE}   形式例: https://abcdefghij.execute-api.ap-northeast-1.amazonaws.com/v1${NC}"
echo -e "${YELLOW}   スキップする場合はEnterを押してください${NC}"
read -p "   入力: " API_GATEWAY_URL

# .env.local ファイルの作成
echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}Step 2: .env.local ファイルの作成${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

cat > "${SCRIPT_DIR}/.env.local" <<EOF
# ========================================
# AWS Cognito 認証設定
# ========================================
# 自動生成日時: $(date '+%Y-%m-%d %H:%M:%S')

# Cognito User Pool ID
# 取得方法: AWS Console → Cognito → User pools → [Your Pool] → Pool Id
NEXT_PUBLIC_COGNITO_USER_POOL_ID=${USER_POOL_ID}

# Cognito App Client ID
# 取得方法: AWS Console → Cognito → User pools → [Your Pool] → App integration → App clients → Client ID
NEXT_PUBLIC_COGNITO_APP_CLIENT_ID=${APP_CLIENT_ID}

# Cognito Hosted UI Domain
# 取得方法: AWS Console → Cognito → User pools → [Your Pool] → App integration → Domain
# 注意: https:// は不要（ドメイン名のみ）
NEXT_PUBLIC_COGNITO_DOMAIN=${COGNITO_DOMAIN}

# アプリケーションURL
# 開発環境: http://localhost:3000
# 本番環境: https://your-cloudfront-domain.cloudfront.net
# 注意: 必ず http:// または https:// で始まる完全なURL
NEXT_PUBLIC_APP_URL=${APP_URL}

EOF

# API Gateway URLが設定されている場合のみ追加
if [ -n "$API_GATEWAY_URL" ]; then
cat >> "${SCRIPT_DIR}/.env.local" <<EOF
# ========================================
# API Gateway設定（バックエンドAPI）
# ========================================

# API Gateway URL
# 取得方法: AWS Console → API Gateway → [Your API] → Stages → [Stage Name] → Invoke URL
NEXT_PUBLIC_API_GATEWAY_URL=${API_GATEWAY_URL}
EOF
fi

echo -e "${GREEN}✅ .env.local file created successfully${NC}\n"

# ファイルの内容を表示（確認用）
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}Step 3: 設定内容の確認${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

echo -e "${BLUE}作成されたファイル: .env.local${NC}\n"
cat "${SCRIPT_DIR}/.env.local"

# 次のステップの案内
echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}Step 4: 次のステップ${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

echo -e "${GREEN}1. AWS Console設定の確認:${NC}"
echo -e "   ${BLUE}- Callback URLs: ${APP_URL}/auth/callback${NC}"
echo -e "   ${BLUE}- Sign out URLs: ${APP_URL}${NC}"
echo -e "   ${YELLOW}場所: AWS Console → Cognito → User pools → App integration → App client → Hosted UI${NC}\n"

echo -e "${GREEN}2. 開発サーバーの起動:${NC}"
echo -e "   ${BLUE}cd ${SCRIPT_DIR}${NC}"
echo -e "   ${BLUE}yarn dev${NC}\n"

echo -e "${GREEN}3. 動作確認:${NC}"
echo -e "   ${BLUE}ブラウザで ${APP_URL} にアクセス${NC}"
echo -e "   ${BLUE}ログイン機能をテスト${NC}\n"

echo -e "${GREEN}4. トラブルシューティング:${NC}"
echo -e "   ${BLUE}エラーが発生した場合は以下を参照:${NC}"
echo -e "   ${YELLOW}- /docs/security/cognito-troubleshooting-flowchart.md${NC}"
echo -e "   ${YELLOW}- /docs/security/cognito-testing-checklist.md${NC}\n"

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

echo -e "${GREEN}✅ Setup completed successfully!${NC}"
echo -e "${BLUE}Happy coding! 🚀${NC}\n"

exit 0
