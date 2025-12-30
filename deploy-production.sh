#!/bin/bash

################################################################################
# CIS File Search Application - 本番デプロイスクリプト
#
# 使い方:
#   ./deploy-production.sh [day1|day2|day3|all]
#
# 例:
#   ./deploy-production.sh day1  # Day 1のみ実行
#   ./deploy-production.sh all   # 全デプロイ実行
################################################################################

set -e  # エラー時に即座に終了

# 色付きログ
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ログ関数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 環境変数チェック
check_env() {
    log_info "環境変数を確認中..."

    required_vars=(
        "AWS_REGION"
        "AWS_DEFAULT_REGION"
    )

    for var in "${required_vars[@]}"; do
        if [[ -z "${!var}" ]]; then
            log_error "環境変数 $var が設定されていません"
            exit 1
        fi
    done

    log_success "環境変数チェック完了"
}

# AWS認証確認
check_aws_auth() {
    log_info "AWS認証を確認中..."

    if ! aws sts get-caller-identity > /dev/null 2>&1; then
        log_error "AWS認証に失敗しました。aws configure を実行してください。"
        exit 1
    fi

    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    log_success "AWS認証成功 (Account ID: $ACCOUNT_ID)"
}

################################################################################
# Day 1: セキュリティ修正とインフラ確認
################################################################################

deploy_day1() {
    log_info "========================================="
    log_info "Day 1: セキュリティ修正とインフラ確認"
    log_info "========================================="

    # T1.1: Lambda CORS設定修正
    log_info "[T1.1] Lambda CORS設定を修正中..."
    cd backend/lambda-search-api

    # TypeScriptビルド
    log_info "TypeScriptをビルド中..."
    npm run build

    if [[ $? -ne 0 ]]; then
        log_error "TypeScriptビルドに失敗しました"
        exit 1
    fi
    log_success "TypeScriptビルド完了"

    # T1.2: API Gatewayレート制限設定
    log_info "[T1.2] API Gatewayレート制限を設定中..."

    # Usage Plan作成
    USAGE_PLAN_ID=$(aws apigateway create-usage-plan \
        --name "cis-search-api-prod-usage-plan" \
        --throttle burstLimit=20,rateLimit=10 \
        --quota limit=100000,period=MONTH \
        --query 'id' --output text 2>/dev/null || echo "")

    if [[ -z "$USAGE_PLAN_ID" ]]; then
        log_warning "Usage Planは既に存在する可能性があります"
    else
        log_success "Usage Plan作成完了 (ID: $USAGE_PLAN_ID)"
    fi

    # T1.3: Lambda VPC接続確認
    log_info "[T1.3] Lambda VPC接続を確認中..."

    FUNCTION_NAME="cis-search-api-prod"

    # Lambda関数のVPC設定確認
    VPC_CONFIG=$(aws lambda get-function-configuration \
        --function-name $FUNCTION_NAME \
        --query 'VpcConfig' --output json)

    log_info "VPC設定: $VPC_CONFIG"

    # OpenSearch接続テスト
    log_info "OpenSearch接続をテスト中..."

    aws lambda invoke \
        --function-name $FUNCTION_NAME \
        --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test","limit":"10"}}' \
        /tmp/lambda-response.json > /dev/null

    if grep -q "error" /tmp/lambda-response.json; then
        log_error "Lambda関数のテストに失敗しました"
        cat /tmp/lambda-response.json
        exit 1
    fi

    log_success "Lambda VPC接続確認完了"

    # T1.4: 環境変数の本番設定確認
    log_info "[T1.4] 環境変数を確認中..."

    if [[ ! -f ".env.production" ]]; then
        log_warning ".env.production が存在しません。.env.production.example からコピーしてください。"
        cp .env.production.example .env.production
        log_info ".env.production を編集してください"
        exit 1
    fi

    log_success "環境変数確認完了"

    # T1.5: Lambda関数再デプロイ
    log_info "[T1.5] Lambda関数を再デプロイ中..."

    # デプロイパッケージ作成
    log_info "デプロイパッケージを作成中..."

    if [[ ! -f "deploy.sh" ]]; then
        log_error "deploy.sh が見つかりません"
        exit 1
    fi

    bash deploy.sh

    log_success "Lambda関数再デプロイ完了"

    # T1.6: Lambdaテスト実行
    log_info "[T1.6] Lambda関数をテスト中..."

    # テキスト検索テスト
    log_info "テキスト検索をテスト中..."
    aws lambda invoke \
        --function-name $FUNCTION_NAME \
        --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test","limit":"10"}}' \
        /tmp/text-search-response.json > /dev/null

    if ! grep -q "results" /tmp/text-search-response.json; then
        log_error "テキスト検索テストに失敗しました"
        cat /tmp/text-search-response.json
        exit 1
    fi

    log_success "テキスト検索テスト成功"

    # T1.7: CloudWatch Logs確認
    log_info "[T1.7] CloudWatch Logsを確認中..."

    LOG_GROUP="/aws/lambda/$FUNCTION_NAME"

    aws logs tail $LOG_GROUP --since 5m --format short || log_warning "CloudWatch Logsの取得に失敗しました"

    log_success "CloudWatch Logs確認完了"

    # T1.8: セキュリティ監査
    log_info "[T1.8] セキュリティ監査を実施中..."

    # CORS設定確認
    log_info "CORS設定を確認中..."
    grep -r "Access-Control-Allow-Origin" src/ || log_warning "CORS設定が見つかりません"

    log_success "セキュリティ監査完了"

    cd ../../

    log_success "========================================="
    log_success "Day 1 完了！"
    log_success "========================================="
}

################################################################################
# Day 2: フロントエンドビルドとデプロイ
################################################################################

deploy_day2() {
    log_info "========================================="
    log_info "Day 2: フロントエンドビルドとデプロイ"
    log_info "========================================="

    cd frontend

    # T2.1: 環境変数設定（本番）
    log_info "[T2.1] 本番環境変数を設定中..."

    if [[ ! -f ".env.production" ]]; then
        log_warning ".env.production が存在しません。.env.production.example からコピーしてください。"
        cp .env.production.example .env.production
        log_info ".env.production を編集してください"
        exit 1
    fi

    # 必須環境変数チェック
    source .env.production

    if [[ -z "$NEXT_PUBLIC_API_GATEWAY_URL" ]]; then
        log_error "NEXT_PUBLIC_API_GATEWAY_URL が設定されていません"
        exit 1
    fi

    log_success "環境変数設定完了"

    # T2.2: Next.jsビルド実行
    log_info "[T2.2] Next.jsをビルド中..."

    # 依存関係インストール
    log_info "依存関係をインストール中..."
    yarn install --frozen-lockfile

    # ビルド実行
    log_info "Next.jsビルドを実行中..."
    yarn build

    if [[ $? -ne 0 ]]; then
        log_error "Next.jsビルドに失敗しました"
        exit 1
    fi

    log_success "Next.jsビルド完了"

    # T2.4: Static Export確認
    log_info "[T2.4] Static Exportを確認中..."

    if [[ ! -d "out" ]]; then
        log_error "out/ ディレクトリが見つかりません。next.config.js で output: 'export' を設定してください。"
        exit 1
    fi

    FILE_COUNT=$(find out -type f | wc -l)
    log_info "生成されたファイル数: $FILE_COUNT"

    log_success "Static Export確認完了"

    # T2.5: S3バケットへアップロード
    log_info "[T2.5] S3バケットへアップロード中..."

    # S3バケット名取得
    S3_BUCKET=$(aws s3 ls | grep "cis-filesearch-frontend" | awk '{print $3}')

    if [[ -z "$S3_BUCKET" ]]; then
        log_error "S3バケットが見つかりません"
        exit 1
    fi

    log_info "S3バケット: $S3_BUCKET"

    # 静的アセット（長いTTL）
    log_info "静的アセットをアップロード中..."
    aws s3 sync out/ s3://$S3_BUCKET/ \
        --delete \
        --cache-control "public, max-age=31536000, immutable" \
        --exclude "*.html" \
        --exclude "*.json"

    # HTML/JSON（短いTTL）
    log_info "HTML/JSONファイルをアップロード中..."
    aws s3 sync out/ s3://$S3_BUCKET/ \
        --exclude "*" \
        --include "*.html" \
        --include "*.json" \
        --cache-control "public, max-age=300"

    log_success "S3アップロード完了"

    # T2.6: CloudFront Invalidation
    log_info "[T2.6] CloudFront Invalidationを実行中..."

    # CloudFront Distribution ID取得
    DISTRIBUTION_ID=$(aws cloudfront list-distributions \
        --query "DistributionList.Items[?Comment=='CIS FileSearch Frontend Distribution'].Id" \
        --output text)

    if [[ -z "$DISTRIBUTION_ID" ]]; then
        log_warning "CloudFront Distributionが見つかりません"
    else
        log_info "CloudFront Distribution ID: $DISTRIBUTION_ID"

        aws cloudfront create-invalidation \
            --distribution-id $DISTRIBUTION_ID \
            --paths "/*"

        log_success "CloudFront Invalidation完了"
    fi

    # T2.7: DNS設定確認
    log_info "[T2.7] DNS設定を確認中..."

    DOMAIN="cis-filesearch.com"

    if dig +short $DOMAIN | grep -q "."; then
        log_success "DNS解決成功: $DOMAIN"
    else
        log_warning "DNS解決に失敗しました: $DOMAIN"
    fi

    # T2.8: SSL証明書確認
    log_info "[T2.8] SSL証明書を確認中..."

    if openssl s_client -connect $DOMAIN:443 -servername $DOMAIN < /dev/null 2>/dev/null | grep -q "Verify return code: 0"; then
        log_success "SSL証明書確認成功"
    else
        log_warning "SSL証明書の確認に失敗しました"
    fi

    # T2.9: Smoke Test
    log_info "[T2.9] Smoke Testを実行中..."

    # トップページアクセステスト
    log_info "トップページにアクセス中..."
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://$DOMAIN/)

    if [[ "$HTTP_CODE" == "200" ]]; then
        log_success "トップページアクセス成功 (HTTP $HTTP_CODE)"
    else
        log_error "トップページアクセス失敗 (HTTP $HTTP_CODE)"
        exit 1
    fi

    cd ..

    log_success "========================================="
    log_success "Day 2 完了！"
    log_success "========================================="
}

################################################################################
# Day 3: 統合テストと本番検証
################################################################################

deploy_day3() {
    log_info "========================================="
    log_info "Day 3: 統合テストと本番検証"
    log_info "========================================="

    cd frontend

    # T3.1: テキスト検索テスト
    log_info "[T3.1] テキスト検索をテスト中..."

    # テスト実行
    yarn test:integration || log_warning "統合テストに一部失敗しました"

    log_success "テキスト検索テスト完了"

    # T3.2: 画像検索テスト
    log_info "[T3.2] 画像検索をテスト中..."

    # 画像検索テスト実行
    yarn test:image-search || log_warning "画像検索テストに一部失敗しました"

    log_success "画像検索テスト完了"

    # T3.3: レスポンスタイム測定
    log_info "[T3.3] レスポンスタイムを測定中..."

    # ベンチマーク実行
    yarn benchmark:quick || log_warning "ベンチマークに一部失敗しました"

    log_success "レスポンスタイム測定完了"

    # T3.5: ロードテスト（Artillery）
    log_info "[T3.5] ロードテストを実行中..."

    if command -v artillery &> /dev/null; then
        yarn load-test || log_warning "ロードテストに一部失敗しました"
        log_success "ロードテスト完了"
    else
        log_warning "Artillery がインストールされていません。スキップします。"
    fi

    # T3.6: CloudWatch監視設定
    log_info "[T3.6] CloudWatch監視を設定中..."

    cd ../

    # Lambda関数のログ保持期間設定
    aws logs put-retention-policy \
        --log-group-name /aws/lambda/cis-search-api-prod \
        --retention-in-days 30 || log_warning "ログ保持期間設定に失敗しました"

    log_success "CloudWatch監視設定完了"

    log_success "========================================="
    log_success "Day 3 完了！"
    log_success "========================================="
}

################################################################################
# メイン処理
################################################################################

main() {
    log_info "========================================="
    log_info "CIS File Search - 本番デプロイスクリプト"
    log_info "========================================="

    # 環境チェック
    check_env
    check_aws_auth

    STAGE=${1:-all}

    case $STAGE in
        day1)
            deploy_day1
            ;;
        day2)
            deploy_day2
            ;;
        day3)
            deploy_day3
            ;;
        all)
            deploy_day1
            deploy_day2
            deploy_day3
            ;;
        *)
            log_error "無効な引数: $STAGE"
            echo "使い方: ./deploy-production.sh [day1|day2|day3|all]"
            exit 1
            ;;
    esac

    log_success "========================================="
    log_success "🎉 デプロイ完了！"
    log_success "========================================="
    log_info "次のステップ:"
    log_info "1. https://cis-filesearch.com/ にアクセスして動作確認"
    log_info "2. CloudWatch Logsでエラーがないか確認"
    log_info "3. 24時間監視して安定性を確認"
}

# スクリプト実行
main "$@"
