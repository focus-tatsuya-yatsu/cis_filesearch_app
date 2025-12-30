#!/bin/bash

###############################################################################
# AWS認証情報自動更新スクリプト
#
# EC2インスタンスのIAMロール認証情報を定期的に更新し、
# アプリケーションを再起動せずに認証トークンの期限切れを防ぎます。
#
# 使用方法:
#   1. 実行権限を付与: chmod +x scripts/refresh-aws-credentials.sh
#   2. cronで定期実行: 0 * * * * /path/to/refresh-aws-credentials.sh
#
# 推奨実行頻度: 1時間ごと
###############################################################################

set -euo pipefail

# ログファイル
LOG_FILE="/var/log/cis-filesearch/aws-credential-refresh.log"
mkdir -p "$(dirname "$LOG_FILE")"

# ログ関数
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "========================================="
log "AWS認証情報更新スクリプト開始"
log "========================================="

# EC2インスタンスメタデータから認証情報を取得
METADATA_URL="http://169.254.169.254/latest/meta-data/iam/security-credentials/"

log "EC2メタデータからIAMロール名を取得中..."
ROLE_NAME=$(curl -s "$METADATA_URL" || echo "")

if [ -z "$ROLE_NAME" ]; then
    log "ERROR: IAMロール名を取得できませんでした"
    log "EC2インスタンスにIAMロールがアタッチされているか確認してください"
    exit 1
fi

log "IAMロール: $ROLE_NAME"

# 認証情報を取得
log "認証情報を取得中..."
CREDENTIALS=$(curl -s "${METADATA_URL}${ROLE_NAME}")

if [ -z "$CREDENTIALS" ]; then
    log "ERROR: 認証情報を取得できませんでした"
    exit 1
fi

# JSONから各フィールドを抽出
ACCESS_KEY=$(echo "$CREDENTIALS" | grep -o '"AccessKeyId" : "[^"]*' | cut -d'"' -f4)
SECRET_KEY=$(echo "$CREDENTIALS" | grep -o '"SecretAccessKey" : "[^"]*' | cut -d'"' -f4)
SESSION_TOKEN=$(echo "$CREDENTIALS" | grep -o '"Token" : "[^"]*' | cut -d'"' -f4)
EXPIRATION=$(echo "$CREDENTIALS" | grep -o '"Expiration" : "[^"]*' | cut -d'"' -f4)

log "認証情報を取得しました"
log "有効期限: $EXPIRATION"

# 環境変数として設定（現在のシェルセッション用）
export AWS_ACCESS_KEY_ID="$ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$SECRET_KEY"
export AWS_SESSION_TOKEN="$SESSION_TOKEN"

log "環境変数を更新しました"

# PM2で管理されているNext.jsアプリケーションに環境変数を再注入
if command -v pm2 &> /dev/null; then
    log "PM2を検出しました。アプリケーションに環境変数を再注入中..."

    # PM2の環境変数を更新
    pm2 set pm2:env:AWS_ACCESS_KEY_ID "$ACCESS_KEY" 2>&1 | tee -a "$LOG_FILE"
    pm2 set pm2:env:AWS_SECRET_ACCESS_KEY "$SECRET_KEY" 2>&1 | tee -a "$LOG_FILE"
    pm2 set pm2:env:AWS_SESSION_TOKEN "$SESSION_TOKEN" 2>&1 | tee -a "$LOG_FILE"

    log "PM2環境変数を更新しました"

    # 注意: PM2の環境変数更新は即座に反映されないため、
    # アプリケーション側でクライアントの定期リフレッシュが必要です
    # (image-embedding/route.tsで実装済み)
else
    log "WARNING: PM2が見つかりません。手動でアプリケーションを再起動してください"
fi

# AWS CLIで認証テスト
log "AWS認証テスト実行中..."
CALLER_IDENTITY=$(aws sts get-caller-identity --output json 2>&1 || echo "ERROR")

if echo "$CALLER_IDENTITY" | grep -q "UserId"; then
    log "AWS認証成功"
    USER_ID=$(echo "$CALLER_IDENTITY" | grep -o '"UserId": "[^"]*' | cut -d'"' -f4)
    ACCOUNT=$(echo "$CALLER_IDENTITY" | grep -o '"Account": "[^"]*' | cut -d'"' -f4)
    log "UserId: $USER_ID"
    log "Account: $ACCOUNT"
else
    log "ERROR: AWS認証テスト失敗"
    log "$CALLER_IDENTITY"
    exit 1
fi

# Bedrock接続テスト（オプション）
if [ "${TEST_BEDROCK:-false}" = "true" ]; then
    log "Bedrock接続テスト実行中..."

    # Bedrockモデルリストを取得
    BEDROCK_MODELS=$(aws bedrock list-foundation-models \
        --region us-east-1 \
        --by-inference-type ON_DEMAND \
        --output json 2>&1 || echo "ERROR")

    if echo "$BEDROCK_MODELS" | grep -q "titan-embed-image"; then
        log "Bedrock接続成功"
    else
        log "WARNING: Bedrock接続テスト失敗（権限不足の可能性）"
    fi
fi

# OpenSearch接続テスト（オプション）
if [ "${TEST_OPENSEARCH:-false}" = "true" ]; then
    log "OpenSearch接続テスト実行中..."

    if [ -n "${OPENSEARCH_ENDPOINT:-}" ]; then
        # OpenSearchエンドポイントからクラスターヘルスを取得
        OPENSEARCH_HEALTH=$(curl -s -X GET "${OPENSEARCH_ENDPOINT}/_cluster/health" \
            --aws-sigv4 "aws:amz:${AWS_REGION:-ap-northeast-1}:es" \
            --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
            -H "x-amz-security-token: ${AWS_SESSION_TOKEN}" 2>&1 || echo "ERROR")

        if echo "$OPENSEARCH_HEALTH" | grep -q "cluster_name"; then
            log "OpenSearch接続成功"
            CLUSTER_STATUS=$(echo "$OPENSEARCH_HEALTH" | grep -o '"status":"[^"]*' | cut -d'"' -f4)
            log "Cluster Status: $CLUSTER_STATUS"
        else
            log "WARNING: OpenSearch接続テスト失敗"
        fi
    else
        log "WARNING: OPENSEARCH_ENDPOINT環境変数が設定されていません"
    fi
fi

log "========================================="
log "AWS認証情報更新スクリプト完了"
log "========================================="

exit 0
