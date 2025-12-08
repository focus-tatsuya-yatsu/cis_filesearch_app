#!/bin/bash

# ==========================================
# CIS File Scanner - Production Setup Verification Script
# ==========================================
# このスクリプトは本番環境のセットアップ状態を検証します
# 実行方法: chmod +x verify-setup.sh && ./verify-setup.sh
# ==========================================

set -e  # エラー発生時に停止

# カラー出力用
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# チェック結果カウンター
PASSED=0
FAILED=0
WARNINGS=0

# ヘッダー表示
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 CIS File Scanner - Production Setup Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ==========================================
# Step 1: Node.js バージョン確認
# ==========================================
echo -e "${BLUE}[Step 1/8]${NC} Node.js Version Check"
echo "----------------------------------------"

if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')

    if [ "$NODE_MAJOR" -ge 18 ]; then
        echo -e "  ${GREEN}✓${NC} Node.js: $NODE_VERSION (OK)"
        ((PASSED++))
    else
        echo -e "  ${RED}✗${NC} Node.js: $NODE_VERSION (require v18+)"
        ((FAILED++))
    fi
else
    echo -e "  ${RED}✗${NC} Node.js not found"
    echo "  → Install: https://nodejs.org/"
    ((FAILED++))
fi
echo ""

# ==========================================
# Step 2: yarn インストール確認
# ==========================================
echo -e "${BLUE}[Step 2/8]${NC} Yarn Installation Check"
echo "----------------------------------------"

if command -v yarn &> /dev/null; then
    YARN_VERSION=$(yarn --version)
    echo -e "  ${GREEN}✓${NC} Yarn: v$YARN_VERSION"
    ((PASSED++))
else
    echo -e "  ${RED}✗${NC} Yarn not found"
    echo "  → Install: npm install -g yarn"
    ((FAILED++))
fi
echo ""

# ==========================================
# Step 3: .env ファイル存在確認
# ==========================================
echo -e "${BLUE}[Step 3/8]${NC} Environment File Check"
echo "----------------------------------------"

if [ -f ".env" ]; then
    echo -e "  ${GREEN}✓${NC} .env file exists"
    ((PASSED++))

    # 必須環境変数のチェック
    source .env 2>/dev/null || true

    MISSING_VARS=()

    [ -z "$AWS_REGION" ] && MISSING_VARS+=("AWS_REGION")
    [ -z "$S3_BUCKET_NAME" ] && MISSING_VARS+=("S3_BUCKET_NAME")
    [ -z "$NAS_MOUNT_PATH" ] && MISSING_VARS+=("NAS_MOUNT_PATH")

    if [ ${#MISSING_VARS[@]} -eq 0 ]; then
        echo -e "  ${GREEN}✓${NC} All required environment variables are set"
        ((PASSED++))
    else
        echo -e "  ${YELLOW}⚠${NC} Missing required variables: ${MISSING_VARS[*]}"
        ((WARNINGS++))
    fi
else
    echo -e "  ${RED}✗${NC} .env file not found"
    echo "  → Copy: cp .env.production .env"
    ((FAILED++))
fi
echo ""

# ==========================================
# Step 4: NAS マウント確認
# ==========================================
echo -e "${BLUE}[Step 4/8]${NC} NAS Mount Check"
echo "----------------------------------------"

if [ -n "$NAS_MOUNT_PATH" ]; then
    if [ -d "$NAS_MOUNT_PATH" ]; then
        echo -e "  ${GREEN}✓${NC} NAS mount path exists: $NAS_MOUNT_PATH"
        ((PASSED++))

        # 読み取り権限確認
        if [ -r "$NAS_MOUNT_PATH" ]; then
            echo -e "  ${GREEN}✓${NC} Read permission: OK"
            ((PASSED++))

            # ファイル数確認（サンプル）
            FILE_COUNT=$(ls -1 "$NAS_MOUNT_PATH" 2>/dev/null | wc -l)
            echo -e "  ${GREEN}ℹ${NC} Sample file count: $FILE_COUNT files/folders"
        else
            echo -e "  ${RED}✗${NC} No read permission"
            ((FAILED++))
        fi
    else
        echo -e "  ${RED}✗${NC} NAS mount path not found: $NAS_MOUNT_PATH"
        echo "  → Check: mount | grep nas"
        ((FAILED++))
    fi
else
    echo -e "  ${YELLOW}⚠${NC} NAS_MOUNT_PATH not set in .env"
    ((WARNINGS++))
fi
echo ""

# ==========================================
# Step 5: AWS 認証情報確認
# ==========================================
echo -e "${BLUE}[Step 5/8]${NC} AWS Credentials Check"
echo "----------------------------------------"

# AWS CLI インストール確認
if command -v aws &> /dev/null; then
    echo -e "  ${GREEN}✓${NC} AWS CLI installed: $(aws --version | head -n1)"
    ((PASSED++))

    # AWS_PROFILE が設定されているか確認
    if [ -z "$AWS_PROFILE" ]; then
        echo -e "  ${YELLOW}⚠${NC} AWS_PROFILE not set - using default credentials"
        echo "  → For SSO: export AWS_PROFILE=AdministratorAccess-770923989980"
        ((WARNINGS++))
    else
        echo -e "  ${GREEN}✓${NC} AWS_PROFILE: $AWS_PROFILE"
        ((PASSED++))
    fi

    # AWS認証状態を確認
    if aws sts get-caller-identity &>/dev/null; then
        echo -e "  ${GREEN}✓${NC} AWS credentials valid"
        IDENTITY=$(aws sts get-caller-identity)
        ACCOUNT=$(echo $IDENTITY | grep -o '"Account": "[^"]*"' | cut -d'"' -f4)
        echo -e "  ${GREEN}✓${NC} Account: $ACCOUNT"
        ((PASSED+=2))

        # AWS認証テスト（S3バケット存在確認）
        if [ -n "$S3_BUCKET_NAME" ]; then
            if aws s3 ls s3://$S3_BUCKET_NAME &>/dev/null; then
                echo -e "  ${GREEN}✓${NC} S3 bucket accessible: $S3_BUCKET_NAME"
                ((PASSED++))
            else
                echo -e "  ${RED}✗${NC} Cannot access S3 bucket: $S3_BUCKET_NAME"
                echo "  → Check AWS credentials and bucket name"
                ((FAILED++))
            fi
        else
            echo -e "  ${YELLOW}⚠${NC} S3_BUCKET_NAME not set in .env"
            ((WARNINGS++))
        fi
    else
        echo -e "  ${RED}✗${NC} AWS authentication failed"
        echo "  → Your SSO token may have expired"
        echo "  → Run: aws sso login --profile AdministratorAccess-770923989980"
        echo "  → Then: export AWS_PROFILE=AdministratorAccess-770923989980"
        ((FAILED++))
    fi
else
    echo -e "  ${YELLOW}⚠${NC} AWS CLI not installed (optional)"
    echo "  → Install: https://aws.amazon.com/cli/"
    ((WARNINGS++))
fi
echo ""

# ==========================================
# Step 6: 依存関係インストール確認
# ==========================================
echo -e "${BLUE}[Step 6/8]${NC} Dependencies Check"
echo "----------------------------------------"

if [ -d "node_modules" ]; then
    echo -e "  ${GREEN}✓${NC} node_modules exists"
    ((PASSED++))
else
    echo -e "  ${YELLOW}⚠${NC} node_modules not found"
    echo "  → Run: yarn install"
    ((WARNINGS++))

    read -p "  Install dependencies now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "  Installing..."
        yarn install
        echo -e "  ${GREEN}✓${NC} Dependencies installed"
        ((PASSED++))
    fi
fi
echo ""

# ==========================================
# Step 7: ビルド確認
# ==========================================
echo -e "${BLUE}[Step 7/8]${NC} Build Check"
echo "----------------------------------------"

if [ -f "dist/index.js" ]; then
    echo -e "  ${GREEN}✓${NC} dist/index.js exists"
    ((PASSED++))
else
    echo -e "  ${YELLOW}⚠${NC} Built files not found"
    echo "  → Run: yarn build"
    ((WARNINGS++))

    read -p "  Build now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "  Building..."
        yarn build
        if [ -f "dist/index.js" ]; then
            echo -e "  ${GREEN}✓${NC} Build successful"
            ((PASSED++))
        else
            echo -e "  ${RED}✗${NC} Build failed"
            ((FAILED++))
        fi
    fi
fi
echo ""

# ==========================================
# Step 8: ドライラン実行（オプション）
# ==========================================
echo -e "${BLUE}[Step 8/8]${NC} Dry Run Test (Optional)"
echo "----------------------------------------"

if [ -f "dist/index.js" ]; then
    read -p "  Run dry-run test? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "  Running dry-run scan..."
        echo ""
        DRY_RUN=true node dist/index.js scan

        if [ $? -eq 0 ]; then
            echo ""
            echo -e "  ${GREEN}✓${NC} Dry-run completed successfully"
            ((PASSED++))
        else
            echo ""
            echo -e "  ${RED}✗${NC} Dry-run failed"
            ((FAILED++))
        fi
    else
        echo -e "  ${BLUE}ℹ${NC} Dry-run skipped"
    fi
else
    echo -e "  ${YELLOW}⚠${NC} Cannot run dry-run (build required)"
    ((WARNINGS++))
fi
echo ""

# ==========================================
# 結果サマリー
# ==========================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Verification Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "  ${GREEN}✓ Passed:${NC}   $PASSED"
echo -e "  ${YELLOW}⚠ Warnings:${NC} $WARNINGS"
echo -e "  ${RED}✗ Failed:${NC}   $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "  ${GREEN}🎉 Setup verification completed successfully!${NC}"
    echo ""
    echo "  Next steps:"
    echo "  1. Review your .env configuration"
    echo "  2. Run: DRY_RUN=true node dist/index.js scan"
    echo "  3. If dry-run succeeds, run: node dist/index.js scan"
    echo ""
    exit 0
else
    echo -e "  ${RED}⚠️  Setup verification failed!${NC}"
    echo ""
    echo "  Please fix the issues above before proceeding."
    echo "  Refer to SETUP_PRODUCTION.md for detailed instructions."
    echo ""
    exit 1
fi
