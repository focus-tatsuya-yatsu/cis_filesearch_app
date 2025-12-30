#!/bin/bash

###############################################################################
# Lambda Search API - デプロイ診断スクリプト
# 現在のデプロイ状態を確認し、必要な次のステップを提示
###############################################################################

set -e

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

function print_header() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e " $1"
  echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

function print_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

function print_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

function print_error() {
  echo -e "${RED}❌ $1${NC}"
}

function print_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

# スクリプトのディレクトリ
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════════╗"
echo -e "║       Lambda Search API - デプロイ診断レポート                  ║"
echo -e "║       診断日時: $(date '+%Y-%m-%d %H:%M:%S')                        ║"
echo -e "╚═══════════════════════════════════════════════════════════════════╝${NC}"

# カウンター
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNING_CHECKS=0

###############################################################################
# 1. ローカル環境チェック
###############################################################################

print_header "1. ローカル環境チェック"

# Node.js
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version)
  print_success "Node.js: $NODE_VERSION"
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  print_error "Node.js がインストールされていません"
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi

# npm
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if command -v npm &> /dev/null; then
  NPM_VERSION=$(npm --version)
  print_success "npm: $NPM_VERSION"
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  print_error "npm がインストールされていません"
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi

# AWS CLI
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if command -v aws &> /dev/null; then
  AWS_VERSION=$(aws --version 2>&1 | head -n1)
  print_success "AWS CLI: $AWS_VERSION"
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  print_error "AWS CLI がインストールされていません"
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi

# Terraform
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if command -v terraform &> /dev/null; then
  TF_VERSION=$(terraform --version | head -n1)
  print_success "Terraform: $TF_VERSION"
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  print_error "Terraform がインストールされていません"
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi

###############################################################################
# 2. AWS認証情報チェック
###############################################################################

print_header "2. AWS認証情報チェック"

TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if aws sts get-caller-identity &> /dev/null; then
  AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null)
  AWS_USER_ARN=$(aws sts get-caller-identity --query Arn --output text 2>/dev/null)
  AWS_REGION=$(aws configure get region)

  print_success "AWS認証: 有効"
  print_info "  Account: $AWS_ACCOUNT"
  print_info "  User: $AWS_USER_ARN"
  print_info "  Region: $AWS_REGION"
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  print_error "AWS認証: 無効"
  print_info "  修正方法: aws configure を実行してください"
  FAILED_CHECKS=$((FAILED_CHECKS + 1))
fi

###############################################################################
# 3. ローカルビルド状態チェック
###############################################################################

print_header "3. ローカルビルド状態チェック"

# node_modules
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if [ -d "$PROJECT_DIR/node_modules" ]; then
  print_success "依存関係: インストール済み"
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  print_warning "依存関係: 未インストール"
  print_info "  実行: npm install"
  WARNING_CHECKS=$((WARNING_CHECKS + 1))
fi

# dist directory
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if [ -d "$PROJECT_DIR/dist" ]; then
  print_success "ビルド成果物: 存在する (dist/)"
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  print_warning "ビルド成果物: 未作成"
  print_info "  実行: npm run build"
  WARNING_CHECKS=$((WARNING_CHECKS + 1))
fi

# lambda-deployment.zip
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if [ -f "$PROJECT_DIR/lambda-deployment.zip" ]; then
  ZIP_SIZE=$(ls -lh "$PROJECT_DIR/lambda-deployment.zip" | awk '{print $5}')
  print_success "デプロイパッケージ: 存在する ($ZIP_SIZE)"
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  print_warning "デプロイパッケージ: 未作成"
  print_info "  実行: npm run package"
  WARNING_CHECKS=$((WARNING_CHECKS + 1))
fi

###############################################################################
# 4. Terraform状態チェック
###############################################################################

print_header "4. Terraform状態チェック"

TERRAFORM_DIR="$PROJECT_DIR/terraform"

# Terraform初期化
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if [ -d "$TERRAFORM_DIR/.terraform" ]; then
  print_success "Terraform: 初期化済み"
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  print_warning "Terraform: 未初期化"
  print_info "  実行: cd terraform && terraform init"
  WARNING_CHECKS=$((WARNING_CHECKS + 1))
fi

# terraform.tfvars
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if [ -f "$TERRAFORM_DIR/terraform.tfvars" ]; then
  print_success "Terraform変数: 設定済み (terraform.tfvars)"
  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  print_warning "Terraform変数: 未設定"
  print_info "  実行: scripts/get-vpc-info.sh"
  WARNING_CHECKS=$((WARNING_CHECKS + 1))
fi

# terraform.tfstate
TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
if [ -f "$TERRAFORM_DIR/terraform.tfstate" ]; then
  print_success "Terraform State: 存在する"

  # State内のリソース確認
  if command -v jq &> /dev/null && [ -f "$TERRAFORM_DIR/terraform.tfstate" ]; then
    RESOURCE_COUNT=$(jq '.resources | length' "$TERRAFORM_DIR/terraform.tfstate" 2>/dev/null || echo "0")
    if [ "$RESOURCE_COUNT" -gt 0 ]; then
      print_info "  デプロイ済みリソース: $RESOURCE_COUNT個"
    fi
  fi

  PASSED_CHECKS=$((PASSED_CHECKS + 1))
else
  print_warning "Terraform State: 未作成（デプロイ未実施）"
  print_info "  実行: cd terraform && terraform apply"
  WARNING_CHECKS=$((WARNING_CHECKS + 1))
fi

###############################################################################
# 5. AWS環境チェック（認証が有効な場合のみ）
###############################################################################

if aws sts get-caller-identity &> /dev/null; then
  print_header "5. AWS環境チェック"

  # Lambda関数
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  LAMBDA_FUNCTION_NAME="cis-search-api-prod"
  if aws lambda get-function --function-name "$LAMBDA_FUNCTION_NAME" &> /dev/null; then
    LAMBDA_STATE=$(aws lambda get-function-configuration --function-name "$LAMBDA_FUNCTION_NAME" --query State --output text 2>/dev/null)
    LAMBDA_RUNTIME=$(aws lambda get-function-configuration --function-name "$LAMBDA_FUNCTION_NAME" --query Runtime --output text 2>/dev/null)
    LAMBDA_MEMORY=$(aws lambda get-function-configuration --function-name "$LAMBDA_FUNCTION_NAME" --query MemorySize --output text 2>/dev/null)

    print_success "Lambda関数: デプロイ済み ($LAMBDA_FUNCTION_NAME)"
    print_info "  State: $LAMBDA_STATE"
    print_info "  Runtime: $LAMBDA_RUNTIME"
    print_info "  Memory: ${LAMBDA_MEMORY}MB"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
  else
    print_warning "Lambda関数: 未デプロイ"
    WARNING_CHECKS=$((WARNING_CHECKS + 1))
  fi

  # API Gateway
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  API_NAME="cis-search-api-prod"
  API_ID=$(aws apigateway get-rest-apis --query "items[?name=='$API_NAME'].id" --output text 2>/dev/null)
  if [ -n "$API_ID" ] && [ "$API_ID" != "None" ]; then
    print_success "API Gateway: デプロイ済み ($API_NAME)"
    print_info "  API ID: $API_ID"
    print_info "  URL: https://${API_ID}.execute-api.${AWS_REGION}.amazonaws.com/prod"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
  else
    print_warning "API Gateway: 未デプロイ"
    WARNING_CHECKS=$((WARNING_CHECKS + 1))
  fi

  # OpenSearch
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  OPENSEARCH_DOMAIN="cis-filesearch-opensearch"
  if aws opensearch describe-domain --domain-name "$OPENSEARCH_DOMAIN" &> /dev/null; then
    OS_ENDPOINT=$(aws opensearch describe-domain --domain-name "$OPENSEARCH_DOMAIN" --query 'DomainStatus.Endpoints.vpc' --output text 2>/dev/null)
    OS_STATE=$(aws opensearch describe-domain --domain-name "$OPENSEARCH_DOMAIN" --query 'DomainStatus.Processing' --output text 2>/dev/null)

    print_success "OpenSearch: 存在する ($OPENSEARCH_DOMAIN)"
    print_info "  Endpoint: $OS_ENDPOINT"
    print_info "  Processing: $OS_STATE"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
  else
    print_error "OpenSearch: ドメインが見つかりません"
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
  fi

  # CloudWatch Logs
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  LOG_GROUP="/aws/lambda/$LAMBDA_FUNCTION_NAME"
  if aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" --query "logGroups[?logGroupName=='$LOG_GROUP']" --output text &> /dev/null; then
    RETENTION=$(aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" --query "logGroups[?logGroupName=='$LOG_GROUP'].retentionInDays" --output text 2>/dev/null)
    print_success "CloudWatch Logs: 設定済み"
    print_info "  Log Group: $LOG_GROUP"
    print_info "  Retention: ${RETENTION:-unlimited} days"
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
  else
    print_warning "CloudWatch Logs: 未作成"
    WARNING_CHECKS=$((WARNING_CHECKS + 1))
  fi
fi

###############################################################################
# 6. サマリーと推奨アクション
###############################################################################

print_header "診断サマリー"

echo ""
echo -e "${BLUE}チェック結果:${NC}"
echo -e "  ✅ 成功: ${GREEN}$PASSED_CHECKS${NC}/${TOTAL_CHECKS}"
echo -e "  ⚠️  警告: ${YELLOW}$WARNING_CHECKS${NC}/${TOTAL_CHECKS}"
echo -e "  ❌ 失敗: ${RED}$FAILED_CHECKS${NC}/${TOTAL_CHECKS}"
echo ""

# デプロイステータス判定
if [ "$FAILED_CHECKS" -eq 0 ] && [ "$WARNING_CHECKS" -eq 0 ]; then
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "🎉 全てのチェックに合格しました！"
  echo -e "Lambda Search APIは正常にデプロイされています。"
  echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

elif [ "$FAILED_CHECKS" -gt 0 ]; then
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "❌ 重大な問題が検出されました"
  echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "${YELLOW}推奨アクション:${NC}"
  echo ""

  # AWS認証エラーの場合
  if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "1️⃣  ${YELLOW}AWS認証情報を設定${NC}"
    echo "   aws configure"
    echo ""
  fi

  # Node.js未インストール
  if ! command -v node &> /dev/null; then
    echo -e "2️⃣  ${YELLOW}Node.jsをインストール${NC}"
    echo "   https://nodejs.org/"
    echo ""
  fi

  # Terraform未インストール
  if ! command -v terraform &> /dev/null; then
    echo -e "3️⃣  ${YELLOW}Terraformをインストール${NC}"
    echo "   https://www.terraform.io/downloads"
    echo ""
  fi

else
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "⚠️  デプロイの準備ができています"
  echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "${BLUE}次のステップ:${NC}"
  echo ""

  # ビルドが必要
  if [ ! -d "$PROJECT_DIR/dist" ]; then
    echo -e "1️⃣  ${BLUE}Lambda関数をビルド${NC}"
    echo "   cd $PROJECT_DIR"
    echo "   npm install"
    echo "   npm run build"
    echo "   npm run package"
    echo ""
  fi

  # VPC情報取得が必要
  if [ ! -f "$TERRAFORM_DIR/terraform.tfvars" ]; then
    echo -e "2️⃣  ${BLUE}VPC情報を取得${NC}"
    echo "   cd $SCRIPT_DIR"
    echo "   ./get-vpc-info.sh"
    echo ""
  fi

  # Terraformデプロイが必要
  if [ ! -f "$TERRAFORM_DIR/terraform.tfstate" ]; then
    echo -e "3️⃣  ${BLUE}Terraformでデプロイ${NC}"
    echo "   cd $TERRAFORM_DIR"
    echo "   terraform init"
    echo "   terraform plan"
    echo "   terraform apply"
    echo ""
  fi

  echo -e "${GREEN}または、統合デプロイスクリプトを実行:${NC}"
  echo "   cd $SCRIPT_DIR"
  echo "   ./deploy-production.sh"
  echo ""
fi

print_header "詳細情報"

echo ""
echo -e "${BLUE}関連ドキュメント:${NC}"
echo "  📄 DEPLOYMENT_STATUS_REPORT.md - デプロイステータスレポート"
echo "  📄 DEPLOYMENT_STEPS.md - デプロイ手順"
echo "  📄 PRODUCTION_DEPLOYMENT_GUIDE.md - 本番デプロイガイド"
echo "  📄 QUICK_START.md - クイックスタート"
echo ""

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "診断完了: $(date '+%Y-%m-%d %H:%M:%S')"
echo -e "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
