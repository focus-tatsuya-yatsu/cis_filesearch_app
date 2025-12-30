#!/bin/bash
# 緊急デプロイスクリプト: SQS無限ループ修正
# 実行前に環境変数を設定してください

set -e
set -u

# カラー出力
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

# 設定値（環境変数で上書き可能）
REGION="${AWS_REGION:-ap-northeast-1}"
S3_BUCKET="${S3_WORKER_BUCKET:-cis-filesearch-worker-scripts}"
LAUNCH_TEMPLATE_NAME="${LAUNCH_TEMPLATE_NAME:-cis-filesearch-worker-template}"
ASG_NAME="${ASG_NAME:-cis-filesearch-ec2-autoscaling}"
INSTANCE_ID="${CURRENT_INSTANCE_ID:-i-01343f804e6b0a7e6}"

# スクリプトディレクトリ
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

log_info "=========================================="
log_info "緊急デプロイ: SQS無限ループ修正"
log_info "=========================================="

# ステップ1: AWS認証確認
log_info "ステップ1: AWS認証確認"
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    log_error "AWS認証が無効です。aws configureまたはSSO認証を実行してください"
    exit 1
fi
log_success "AWS認証OK"

# ステップ2: 必要な環境変数確認
log_info "ステップ2: 環境変数確認"

if [ -z "${SQS_QUEUE_URL:-}" ]; then
    log_warning "SQS_QUEUE_URLが設定されていません。自動取得を試みます..."
    SQS_QUEUE_URL=$(aws sqs list-queues --queue-name-prefix file-processing-queue --region ${REGION} --query 'QueueUrls[0]' --output text)
    if [ -z "$SQS_QUEUE_URL" ]; then
        log_error "SQS Queue URLを取得できませんでした"
        exit 1
    fi
    log_success "SQS Queue URL: ${SQS_QUEUE_URL}"
fi

if [ -z "${DLQ_QUEUE_URL:-}" ]; then
    log_warning "DLQ_QUEUE_URLが設定されていません。自動取得を試みます..."
    DLQ_QUEUE_URL=$(aws sqs list-queues --queue-name-prefix file-processing-dlq --region ${REGION} --query 'QueueUrls[0]' --output text)
    if [ -z "$DLQ_QUEUE_URL" ]; then
        log_warning "DLQ URLを取得できませんでした（オプション）"
    else
        log_success "DLQ URL: ${DLQ_QUEUE_URL}"
    fi
fi

if [ -z "${OPENSEARCH_ENDPOINT:-}" ]; then
    log_warning "OPENSEARCH_ENDPOINTが設定されていません。自動取得を試みます..."
    OPENSEARCH_ENDPOINT=$(aws opensearch describe-domain --domain-name cis-filesearch --region ${REGION} --query 'DomainStatus.Endpoint' --output text 2>/dev/null || echo "")
    if [ -z "$OPENSEARCH_ENDPOINT" ]; then
        log_error "OpenSearchエンドポイントを取得できませんでした"
        exit 1
    fi
    log_success "OpenSearch Endpoint: ${OPENSEARCH_ENDPOINT}"
fi

# ステップ3: S3バケット確認
log_info "ステップ3: S3バケット確認"
if ! aws s3 ls s3://${S3_BUCKET} --region ${REGION} > /dev/null 2>&1; then
    log_error "S3バケット ${S3_BUCKET} が存在しないか、アクセス権限がありません"
    exit 1
fi
log_success "S3バケットアクセスOK"

# ステップ4: worker_fixed.pyのアップロード
log_info "ステップ4: worker_fixed.py をS3にアップロード"
if [ ! -f "${SCRIPT_DIR}/worker_fixed.py" ]; then
    log_error "worker_fixed.py が見つかりません: ${SCRIPT_DIR}/worker_fixed.py"
    exit 1
fi

aws s3 cp "${SCRIPT_DIR}/worker_fixed.py" "s3://${S3_BUCKET}/scripts/worker.py" --region ${REGION}
log_success "worker.py アップロード完了"

# ステップ5: 依存ファイルのアップロード
log_info "ステップ5: 依存ファイルをS3にアップロード"
for file in config.py file_router.py opensearch_client.py; do
    if [ -f "${SCRIPT_DIR}/${file}" ]; then
        aws s3 cp "${SCRIPT_DIR}/${file}" "s3://${S3_BUCKET}/scripts/${file}" --region ${REGION}
        log_success "${file} アップロード完了"
    else
        log_warning "${file} が見つかりません（スキップ）"
    fi
done

# ステップ6: S3アップロード確認
log_info "ステップ6: S3アップロード確認"
aws s3 ls s3://${S3_BUCKET}/scripts/ --region ${REGION}

# ステップ7: UserDataスクリプト生成
log_info "ステップ7: UserDataスクリプト生成"

cat > /tmp/new_userdata.sh <<EOF
#!/bin/bash
set -e
set -x

# ログ設定
exec > >(tee /var/log/user-data.log)
exec 2>&1

echo "=== User Data Script Started at \$(date) ==="

# 環境変数
export AWS_REGION="${REGION}"
export S3_BUCKET="${S3_BUCKET}"
export SQS_QUEUE_URL="${SQS_QUEUE_URL}"
export DLQ_QUEUE_URL="${DLQ_QUEUE_URL:-}"
export OPENSEARCH_ENDPOINT="${OPENSEARCH_ENDPOINT}"

# 必要なパッケージインストール
yum update -y
yum install -y python3 python3-pip

# Pythonパッケージインストール
pip3 install boto3 opensearch-py requests pillow PyPDF2

# 作業ディレクトリ作成
mkdir -p /opt/worker
cd /opt/worker

# S3から最新スクリプトをダウンロード
aws s3 cp s3://\${S3_BUCKET}/scripts/worker.py /opt/worker/worker.py --region \${AWS_REGION}
aws s3 cp s3://\${S3_BUCKET}/scripts/config.py /opt/worker/config.py --region \${AWS_REGION} || true
aws s3 cp s3://\${S3_BUCKET}/scripts/file_router.py /opt/worker/file_router.py --region \${AWS_REGION} || true
aws s3 cp s3://\${S3_BUCKET}/scripts/opensearch_client.py /opt/worker/opensearch_client.py --region \${AWS_REGION} || true

# 実行権限付与
chmod +x /opt/worker/worker.py

# Systemdサービス作成
cat <<'EOFSERVICE' > /etc/systemd/system/worker.service
[Unit]
Description=File Processing Worker (FIXED)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/worker
ExecStart=/usr/bin/python3 /opt/worker/worker.py
Restart=always
RestartSec=10
Environment="AWS_REGION=${REGION}"
Environment="SQS_QUEUE_URL=${SQS_QUEUE_URL}"
Environment="DLQ_QUEUE_URL=${DLQ_QUEUE_URL:-}"
Environment="OPENSEARCH_ENDPOINT=${OPENSEARCH_ENDPOINT}"
Environment="LOG_LEVEL=INFO"

[Install]
WantedBy=multi-user.target
EOFSERVICE

# サービス起動
systemctl daemon-reload
systemctl enable worker.service
systemctl start worker.service

# ステータス確認
sleep 5
systemctl status worker.service --no-pager

echo "=== User Data Script Completed at \$(date) ==="
EOF

log_success "UserDataスクリプト生成完了: /tmp/new_userdata.sh"

# ステップ8: Launch Template新バージョン作成
log_info "ステップ8: Launch Template新バージョン作成"

# UserDataをBase64エンコード
USER_DATA_BASE64=$(base64 -i /tmp/new_userdata.sh)

# 現在のLaunch Template取得
CURRENT_VERSION=$(aws ec2 describe-launch-template-versions \
    --launch-template-name ${LAUNCH_TEMPLATE_NAME} \
    --versions '$Latest' \
    --region ${REGION} \
    --query 'LaunchTemplateVersions[0].VersionNumber' \
    --output text)

log_info "現在のバージョン: ${CURRENT_VERSION}"

# 新バージョン作成
NEW_VERSION_RESPONSE=$(aws ec2 create-launch-template-version \
    --launch-template-name ${LAUNCH_TEMPLATE_NAME} \
    --source-version '$Latest' \
    --launch-template-data "{\"UserData\":\"${USER_DATA_BASE64}\"}" \
    --region ${REGION})

NEW_VERSION=$(echo ${NEW_VERSION_RESPONSE} | jq -r '.LaunchTemplateVersion.VersionNumber')
log_success "新しいバージョン作成: ${NEW_VERSION}"

# ステップ9: デフォルトバージョン更新
log_info "ステップ9: デフォルトバージョンを ${NEW_VERSION} に更新"

aws ec2 modify-launch-template \
    --launch-template-name ${LAUNCH_TEMPLATE_NAME} \
    --default-version ${NEW_VERSION} \
    --region ${REGION} > /dev/null

log_success "デフォルトバージョン更新完了"

# ステップ10: 既存インスタンスの終了確認
log_info "ステップ10: 既存インスタンスの終了"
log_warning "インスタンス ${INSTANCE_ID} を終了します"
read -p "続行しますか？ (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_warning "デプロイを中止しました"
    log_info "ロールバックする場合:"
    log_info "  aws ec2 modify-launch-template --launch-template-name ${LAUNCH_TEMPLATE_NAME} --default-version ${CURRENT_VERSION} --region ${REGION}"
    exit 0
fi

# インスタンス終了
aws autoscaling terminate-instance-in-auto-scaling-group \
    --instance-id ${INSTANCE_ID} \
    --should-decrement-desired-capacity false \
    --region ${REGION}

log_success "インスタンス終了リクエスト送信完了"
log_info "Auto Scalingが新しいインスタンスを起動中..."

# ステップ11: 新インスタンスの起動監視
log_info "ステップ11: 新インスタンスの起動監視（最大5分）"

for i in {1..30}; do
    sleep 10

    INSTANCES=$(aws autoscaling describe-auto-scaling-groups \
        --auto-scaling-group-names ${ASG_NAME} \
        --region ${REGION} \
        --query 'AutoScalingGroups[0].Instances[*].[InstanceId,LifecycleState,HealthStatus]' \
        --output json)

    RUNNING_COUNT=$(echo ${INSTANCES} | jq -r '.[] | select(.[1]=="InService") | .[0]' | wc -l)

    if [ ${RUNNING_COUNT} -ge 1 ]; then
        NEW_INSTANCE_ID=$(echo ${INSTANCES} | jq -r '.[] | select(.[1]=="InService") | .[0]' | head -n 1)
        log_success "新しいインスタンス起動完了: ${NEW_INSTANCE_ID}"
        break
    fi

    log_info "待機中... (${i}/30)"
done

if [ -z "${NEW_INSTANCE_ID:-}" ]; then
    log_error "新インスタンスの起動を確認できませんでした"
    log_warning "Auto Scaling Groupを手動で確認してください"
    exit 1
fi

# ステップ12: SQSメッセージ数確認
log_info "ステップ12: SQSメッセージ数確認"
log_info "初期メッセージ数:"
aws sqs get-queue-attributes \
    --queue-url ${SQS_QUEUE_URL} \
    --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
    --region ${REGION} \
    --query 'Attributes' \
    --output table

log_success "=========================================="
log_success "デプロイ完了"
log_success "=========================================="
log_info "新インスタンスID: ${NEW_INSTANCE_ID}"
log_info ""
log_info "次のステップ:"
log_info "1. CloudWatch Logsでworkerログを確認:"
log_info "   aws logs tail /aws/ec2/worker --follow --region ${REGION}"
log_info ""
log_info "2. SQSメッセージ数を監視:"
log_info "   watch -n 30 'aws sqs get-queue-attributes --queue-url ${SQS_QUEUE_URL} --attribute-names ApproximateNumberOfMessages --region ${REGION} --query \"Attributes.ApproximateNumberOfMessages\" --output text'"
log_info ""
log_info "3. ロールバックが必要な場合:"
log_info "   aws ec2 modify-launch-template --launch-template-name ${LAUNCH_TEMPLATE_NAME} --default-version ${CURRENT_VERSION} --region ${REGION}"
log_info "   aws autoscaling terminate-instance-in-auto-scaling-group --instance-id ${NEW_INSTANCE_ID} --should-decrement-desired-capacity false --region ${REGION}"
log_info ""
log_success "デプロイスクリプト終了"
