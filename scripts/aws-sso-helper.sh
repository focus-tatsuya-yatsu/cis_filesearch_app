#!/bin/bash

# ==========================================
# AWS SSO Helper Script
# ==========================================
# このスクリプトはAWS SSOの認証と環境設定を簡単にします
# 使用方法:
#   source scripts/aws-sso-helper.sh
#   aws-sso-login
#   aws-check
# ==========================================

# カラー出力用
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# デフォルトのAWSプロファイル
DEFAULT_AWS_PROFILE="AdministratorAccess-770923989980"

# AWS SSOログイン関数
aws-sso-login() {
    local PROFILE="${1:-$DEFAULT_AWS_PROFILE}"

    echo -e "${BLUE}🔐 AWS SSO Login${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Profile: $PROFILE"
    echo ""

    # SSOログイン実行
    if aws sso login --profile "$PROFILE"; then
        echo ""
        echo -e "${GREEN}✓ SSO Login successful!${NC}"
        echo ""

        # 環境変数をエクスポート
        export AWS_PROFILE="$PROFILE"
        echo -e "Environment variable set: ${GREEN}AWS_PROFILE=$AWS_PROFILE${NC}"
        echo ""

        # 認証情報を確認
        aws-check

        return 0
    else
        echo ""
        echo -e "${RED}✗ SSO Login failed!${NC}"
        echo ""
        return 1
    fi
}

# AWS認証確認関数
aws-check() {
    echo -e "${BLUE}🔍 Checking AWS Authentication${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # 現在のプロファイル確認
    if [ -n "$AWS_PROFILE" ]; then
        echo -e "Current profile: ${GREEN}$AWS_PROFILE${NC}"
    else
        echo -e "${YELLOW}⚠ AWS_PROFILE not set (using default)${NC}"
    fi
    echo ""

    # 認証情報確認
    if aws sts get-caller-identity 2>/dev/null; then
        echo ""
        echo -e "${GREEN}✓ AWS credentials are valid!${NC}"
        echo ""

        # トークン有効期限確認
        aws-token-expiry

        return 0
    else
        echo ""
        echo -e "${RED}✗ AWS authentication failed!${NC}"
        echo ""
        echo "Possible causes:"
        echo "  1. SSO token expired (run: aws-sso-login)"
        echo "  2. Invalid credentials"
        echo "  3. Network issues"
        echo ""
        return 1
    fi
}

# SSOトークン有効期限確認関数
aws-token-expiry() {
    local PROFILE="${AWS_PROFILE:-$DEFAULT_AWS_PROFILE}"
    local CACHE_DIR="$HOME/.aws/sso/cache"

    if [ -d "$CACHE_DIR" ]; then
        # 最新のキャッシュファイルを取得
        local LATEST_CACHE=$(ls -t "$CACHE_DIR"/*.json 2>/dev/null | head -1)

        if [ -n "$LATEST_CACHE" ]; then
            # expiresAt を取得 (jqがあれば)
            if command -v jq &> /dev/null; then
                local EXPIRES_AT=$(jq -r '.expiresAt // empty' "$LATEST_CACHE" 2>/dev/null)

                if [ -n "$EXPIRES_AT" ]; then
                    # ISO 8601形式をタイムスタンプに変換
                    local EXPIRES_TS=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${EXPIRES_AT%Z*}" "+%s" 2>/dev/null)
                    local CURRENT_TS=$(date +%s)

                    if [ -n "$EXPIRES_TS" ] && [ "$EXPIRES_TS" -gt "$CURRENT_TS" ]; then
                        local REMAINING=$((EXPIRES_TS - CURRENT_TS))
                        local HOURS=$((REMAINING / 3600))
                        local MINUTES=$(((REMAINING % 3600) / 60))

                        echo -e "Token expires in: ${GREEN}${HOURS}h ${MINUTES}m${NC}"
                    else
                        echo -e "${RED}Token expired!${NC} Run: aws-sso-login"
                    fi
                fi
            else
                echo -e "${YELLOW}Install 'jq' to see token expiry time${NC}"
            fi
        fi
    fi
}

# AWS SSOログアウト関数
aws-sso-logout() {
    local PROFILE="${AWS_PROFILE:-$DEFAULT_AWS_PROFILE}"

    echo -e "${BLUE}🔓 AWS SSO Logout${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    if aws sso logout --profile "$PROFILE" 2>/dev/null; then
        echo -e "${GREEN}✓ Logged out successfully${NC}"
    fi

    unset AWS_PROFILE
    echo ""
}

# AWS リソース一覧表示関数
aws-list-resources() {
    echo -e "${BLUE}📦 AWS Resources for CIS FileSearch${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # S3バケット
    echo -e "${YELLOW}S3 Buckets:${NC}"
    aws s3 ls | grep cis-filesearch || echo "  No buckets found"
    echo ""

    # SQSキュー
    echo -e "${YELLOW}SQS Queues:${NC}"
    aws sqs list-queues | grep -i cis || echo "  No queues found"
    echo ""

    # OpenSearchドメイン
    echo -e "${YELLOW}OpenSearch Domains:${NC}"
    aws opensearch list-domain-names || echo "  No domains found"
    echo ""

    # IAMロール
    echo -e "${YELLOW}IAM Roles (filtered):${NC}"
    aws iam list-roles --query 'Roles[?contains(RoleName, `cis`) || contains(RoleName, `filesearch`)].RoleName' --output table 2>/dev/null || echo "  No roles found"
    echo ""
}

# 使用方法を表示
aws-sso-help() {
    echo ""
    echo -e "${BLUE}AWS SSO Helper - Available Commands${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo -e "  ${GREEN}aws-sso-login [profile]${NC}    - Login to AWS SSO"
    echo -e "  ${GREEN}aws-check${NC}                  - Check current authentication status"
    echo -e "  ${GREEN}aws-token-expiry${NC}           - Show SSO token expiry time"
    echo -e "  ${GREEN}aws-sso-logout${NC}             - Logout from AWS SSO"
    echo -e "  ${GREEN}aws-list-resources${NC}         - List CIS FileSearch AWS resources"
    echo -e "  ${GREEN}aws-sso-help${NC}               - Show this help message"
    echo ""
    echo "Current AWS_PROFILE: ${AWS_PROFILE:-not set}"
    echo "Default profile: $DEFAULT_AWS_PROFILE"
    echo ""
}

# スクリプト読み込み時のメッセージ
echo ""
echo -e "${GREEN}✓ AWS SSO Helper loaded!${NC}"
echo "  Run 'aws-sso-help' to see available commands"
echo ""

# プロファイルが設定されていない場合は警告
if [ -z "$AWS_PROFILE" ]; then
    echo -e "${YELLOW}⚠ AWS_PROFILE not set${NC}"
    echo "  Run: ${GREEN}aws-sso-login${NC} to authenticate"
    echo ""
fi
