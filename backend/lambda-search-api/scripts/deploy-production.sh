#!/bin/bash

###############################################################################
# Lambda Search API - 本番環境デプロイスクリプト
# VPC内OpenSearchエンドポイントへの接続に対応
###############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TERRAFORM_DIR="$PROJECT_DIR/terraform"

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

function print_header() {
  echo -e "${BLUE}=========================================="
  echo -e "$1"
  echo -e "==========================================${NC}"
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

function check_prerequisites() {
  print_header "前提条件チェック"

  # Node.js
  if ! command -v node &> /dev/null; then
    print_error "Node.js がインストールされていません"
    exit 1
  fi
  print_success "Node.js: $(node --version)"

  # npm
  if ! command -v npm &> /dev/null; then
    print_error "npm がインストールされていません"
    exit 1
  fi
  print_success "npm: $(npm --version)"

  # AWS CLI
  if ! command -v aws &> /dev/null; then
    print_error "AWS CLI がインストールされていません"
    exit 1
  fi
  print_success "AWS CLI: $(aws --version | head -n1)"

  # Terraform
  if ! command -v terraform &> /dev/null; then
    print_error "Terraform がインストールされていません"
    exit 1
  fi
  print_success "Terraform: $(terraform version | head -n1)"

  # AWS認証情報
  if ! aws sts get-caller-identity &> /dev/null; then
    print_error "AWS認証情報が設定されていません"
    exit 1
  fi

  AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
  AWS_USER=$(aws sts get-caller-identity --query Arn --output text)
  print_success "AWS Account: $AWS_ACCOUNT"
  print_success "AWS User: $AWS_USER"

  echo ""
}

function install_dependencies() {
  print_header "依存関係のインストール"

  cd "$PROJECT_DIR"

  if [ ! -d "node_modules" ]; then
    print_warning "node_modules が存在しません。npm install を実行します..."
    npm install
  else
    print_success "node_modules は既に存在します"
  fi

  echo ""
}

function run_tests() {
  print_header "テストの実行"

  cd "$PROJECT_DIR"

  print_warning "テストをスキップしますか? (y/N)"
  read -r skip_tests

  if [[ "$skip_tests" != "y" && "$skip_tests" != "Y" ]]; then
    npm test
    print_success "すべてのテストが成功しました"
  else
    print_warning "テストをスキップしました"
  fi

  echo ""
}

function build_lambda() {
  print_header "Lambda関数のビルド"

  cd "$PROJECT_DIR"

  # ビルド
  npm run build
  print_success "TypeScriptのビルドが完了しました"

  # デプロイパッケージの作成
  npm run package
  print_success "デプロイパッケージが作成されました: lambda-deployment.zip"

  # ZIPファイルのサイズを確認
  ZIP_SIZE=$(du -h lambda-deployment.zip | cut -f1)
  print_success "ZIPサイズ: $ZIP_SIZE"

  # distディレクトリに移動（Terraformが参照）
  if [ ! -d "dist" ]; then
    mkdir -p dist
  fi
  cp lambda-deployment.zip dist/

  echo ""
}

function check_terraform_vars() {
  print_header "Terraform変数の確認"

  if [ ! -f "$TERRAFORM_DIR/terraform.tfvars" ]; then
    print_error "terraform.tfvars が見つかりません"
    print_warning "VPC情報取得スクリプトを実行しますか? (y/N)"
    read -r run_vpc_script

    if [[ "$run_vpc_script" == "y" || "$run_vpc_script" == "Y" ]]; then
      bash "$SCRIPT_DIR/get-vpc-info.sh"
    else
      print_error "terraform.tfvars を手動で作成してください"
      print_error "テンプレート: $TERRAFORM_DIR/terraform.tfvars.example"
      exit 1
    fi
  else
    print_success "terraform.tfvars が見つかりました"
    echo ""
    echo "現在の設定:"
    cat "$TERRAFORM_DIR/terraform.tfvars"
    echo ""
  fi

  echo ""
}

function deploy_terraform() {
  print_header "Terraformデプロイ"

  cd "$TERRAFORM_DIR"

  # Terraform初期化
  if [ ! -d ".terraform" ]; then
    print_warning "Terraform初期化を実行します..."
    terraform init
  else
    print_success "Terraformは既に初期化されています"
  fi

  # Terraform planの実行
  print_warning "Terraform plan を実行します..."
  terraform plan -out=tfplan

  echo ""
  print_warning "デプロイを実行しますか? (y/N)"
  read -r proceed

  if [[ "$proceed" != "y" && "$proceed" != "Y" ]]; then
    print_error "デプロイがキャンセルされました"
    exit 0
  fi

  # Terraform apply
  terraform apply tfplan

  print_success "Terraformデプロイが完了しました"

  # Outputsを表示
  echo ""
  print_header "デプロイ結果"
  terraform output

  # 環境変数にエクスポート
  export API_GATEWAY_URL=$(terraform output -raw api_gateway_url)
  export LAMBDA_FUNCTION_NAME=$(terraform output -raw lambda_function_name)

  echo ""
  print_success "Lambda関数名: $LAMBDA_FUNCTION_NAME"
  print_success "API Gateway URL: $API_GATEWAY_URL"

  echo ""
}

function verify_deployment() {
  print_header "デプロイの検証"

  # Lambda関数の確認
  print_warning "Lambda関数の状態を確認中..."
  LAMBDA_STATE=$(aws lambda get-function \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --query 'Configuration.State' \
    --output text)

  if [ "$LAMBDA_STATE" == "Active" ]; then
    print_success "Lambda関数がアクティブです"
  else
    print_error "Lambda関数の状態: $LAMBDA_STATE"
  fi

  # VPC設定の確認
  print_warning "VPC設定を確認中..."
  VPC_CONFIG=$(aws lambda get-function-configuration \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --query 'VpcConfig.VpcId' \
    --output text)

  if [ "$VPC_CONFIG" != "None" ]; then
    print_success "VPC設定: $VPC_CONFIG"
  else
    print_error "VPC設定が見つかりません"
  fi

  # CloudWatch Logsの確認
  print_warning "CloudWatch Logsを確認中..."
  sleep 5

  LOG_STREAM=$(aws logs describe-log-streams \
    --log-group-name "/aws/lambda/$LAMBDA_FUNCTION_NAME" \
    --order-by LastEventTime \
    --descending \
    --max-items 1 \
    --query 'logStreams[0].logStreamName' \
    --output text 2>/dev/null || echo "")

  if [ -n "$LOG_STREAM" ] && [ "$LOG_STREAM" != "None" ]; then
    print_success "CloudWatch Logs: 正常に動作しています"
  else
    print_warning "CloudWatch Logs: まだログが出力されていません（初回実行時は正常）"
  fi

  echo ""
}

function display_next_steps() {
  print_header "次のステップ"

  echo "1. API Gatewayのテスト:"
  echo "   curl -X GET \"$API_GATEWAY_URL?q=test&page=1&limit=10\" \\"
  echo "     -H \"Authorization: Bearer YOUR_COGNITO_TOKEN\""
  echo ""

  echo "2. CloudWatch Logsの確認:"
  echo "   aws logs tail /aws/lambda/$LAMBDA_FUNCTION_NAME --follow"
  echo ""

  echo "3. フロントエンドの環境変数を更新:"
  echo "   NEXT_PUBLIC_API_GATEWAY_URL=$API_GATEWAY_URL"
  echo ""

  echo "4. パフォーマンスモニタリング:"
  echo "   - CloudWatch Dashboard"
  echo "   - X-Ray Traces"
  echo "   - API Gateway Metrics"
  echo ""

  print_success "デプロイが完了しました！"
}

# メイン実行フロー
main() {
  clear

  print_header "🚀 Lambda Search API - 本番環境デプロイ"
  echo "OpenSearch VPC Endpoint対応版"
  echo ""

  check_prerequisites
  install_dependencies
  run_tests
  build_lambda
  check_terraform_vars
  deploy_terraform
  verify_deployment
  display_next_steps
}

# スクリプト実行
main "$@"
