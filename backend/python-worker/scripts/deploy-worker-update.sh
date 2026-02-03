#!/bin/bash
# worker.py 更新デプロイスクリプト
# 既存のEC2インスタンスに対してSSM経由で worker.py を更新します

set -e

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 設定
REGION="ap-northeast-1"
S3_BUCKET="cis-filesearch-worker-scripts"
INSTANCE_ID="${WORKER_INSTANCE_ID:-i-0e6ac1e4d535a4ab2}"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
WORKER_DIR="$( cd "${SCRIPT_DIR}/.." && pwd )"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo ""
log_info "=========================================="
log_info "Worker.py 更新デプロイ"
log_info "=========================================="
echo ""

# Step 1: AWS認証確認
log_info "Step 1: AWS認証確認"
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    log_error "AWS認証が無効です"
    exit 1
fi
log_success "AWS認証OK"

# Step 2: worker.py 存在確認
log_info "Step 2: worker.py 確認"
if [ ! -f "${WORKER_DIR}/worker.py" ]; then
    log_error "worker.py が見つかりません: ${WORKER_DIR}/worker.py"
    exit 1
fi
log_success "worker.py 確認OK"

# Step 3: S3にアップロード
log_info "Step 3: worker.py を S3 にアップロード"
aws s3 cp "${WORKER_DIR}/worker.py" "s3://${S3_BUCKET}/scripts/worker.py" --region ${REGION}
log_success "S3アップロード完了"

# Step 4: 関連ファイルもアップロード
log_info "Step 4: 関連ファイルを S3 にアップロード"
for file in config.py file_router.py opensearch_client.py; do
    if [ -f "${WORKER_DIR}/${file}" ]; then
        aws s3 cp "${WORKER_DIR}/${file}" "s3://${S3_BUCKET}/scripts/${file}" --region ${REGION}
        log_success "${file} アップロード完了"
    fi
done

# processorsディレクトリがある場合
if [ -d "${WORKER_DIR}/processors" ]; then
    log_info "processors ディレクトリをアップロード"
    aws s3 sync "${WORKER_DIR}/processors/" "s3://${S3_BUCKET}/scripts/processors/" --region ${REGION} --exclude "__pycache__/*" --exclude "*.pyc"
    log_success "processors アップロード完了"
fi

# Step 5: EC2インスタンスに更新を適用
log_info "Step 5: EC2インスタンスに更新を適用"
log_info "対象インスタンス: ${INSTANCE_ID}"

# SSM経由でコマンド実行
UPDATE_COMMAND='#!/bin/bash
set -e
echo "=== Worker Update Started at $(date) ==="

# S3から最新ファイルをダウンロード
cd /home/ec2-user/python-worker || cd /opt/worker

aws s3 cp s3://cis-filesearch-worker-scripts/scripts/worker.py ./worker.py --region ap-northeast-1
echo "worker.py updated"

# 関連ファイルがあれば更新
for file in config.py file_router.py opensearch_client.py; do
    if aws s3 ls s3://cis-filesearch-worker-scripts/scripts/${file} --region ap-northeast-1 > /dev/null 2>&1; then
        aws s3 cp s3://cis-filesearch-worker-scripts/scripts/${file} ./${file} --region ap-northeast-1
        echo "${file} updated"
    fi
done

# processorsディレクトリ
if aws s3 ls s3://cis-filesearch-worker-scripts/scripts/processors/ --region ap-northeast-1 > /dev/null 2>&1; then
    mkdir -p processors
    aws s3 sync s3://cis-filesearch-worker-scripts/scripts/processors/ ./processors/ --region ap-northeast-1
    echo "processors updated"
fi

# サービス再起動
if systemctl is-active --quiet file-processor; then
    sudo systemctl restart file-processor
    echo "file-processor service restarted"
elif systemctl is-active --quiet worker; then
    sudo systemctl restart worker
    echo "worker service restarted"
else
    echo "Warning: No known service found to restart"
fi

sleep 3

# ステータス確認
if systemctl is-active --quiet file-processor; then
    systemctl status file-processor --no-pager
elif systemctl is-active --quiet worker; then
    systemctl status worker --no-pager
fi

echo "=== Worker Update Completed at $(date) ==="
'

COMMAND_ID=$(aws ssm send-command \
    --instance-ids "${INSTANCE_ID}" \
    --region "${REGION}" \
    --document-name "AWS-RunShellScript" \
    --comment "Deploy worker.py update" \
    --parameters "commands=['${UPDATE_COMMAND}']" \
    --query 'Command.CommandId' \
    --output text 2>/dev/null || echo "")

if [ -z "${COMMAND_ID}" ]; then
    log_error "SSMコマンド送信に失敗しました"
    log_warning "インスタンスに直接SSM接続して更新してください:"
    log_info "  ./ssm-connect.sh (選択肢1でインタラクティブセッション開始)"
    log_info "  cd /home/ec2-user/python-worker"
    log_info "  aws s3 cp s3://${S3_BUCKET}/scripts/worker.py ./worker.py"
    log_info "  sudo systemctl restart file-processor"
    exit 1
fi

log_success "SSMコマンド送信完了 (Command ID: ${COMMAND_ID})"

# Step 6: コマンド実行結果を待機
log_info "Step 6: コマンド実行結果を待機中..."
sleep 5

for i in {1..12}; do
    STATUS=$(aws ssm get-command-invocation \
        --command-id "${COMMAND_ID}" \
        --instance-id "${INSTANCE_ID}" \
        --region "${REGION}" \
        --query 'Status' \
        --output text 2>/dev/null || echo "Pending")

    if [ "${STATUS}" = "Success" ]; then
        log_success "コマンド実行成功"
        echo ""
        log_info "実行結果:"
        aws ssm get-command-invocation \
            --command-id "${COMMAND_ID}" \
            --instance-id "${INSTANCE_ID}" \
            --region "${REGION}" \
            --query 'StandardOutputContent' \
            --output text
        break
    elif [ "${STATUS}" = "Failed" ] || [ "${STATUS}" = "Cancelled" ]; then
        log_error "コマンド実行失敗: ${STATUS}"
        aws ssm get-command-invocation \
            --command-id "${COMMAND_ID}" \
            --instance-id "${INSTANCE_ID}" \
            --region "${REGION}" \
            --query 'StandardErrorContent' \
            --output text
        exit 1
    else
        log_info "待機中... (${STATUS}) ${i}/12"
        sleep 5
    fi
done

echo ""
log_success "=========================================="
log_success "デプロイ完了"
log_success "=========================================="
echo ""
log_info "次のステップ:"
log_info "1. ログを確認: ./ssm-connect.sh (選択肢2)"
log_info "2. 処理状況を監視: ./monitor-sqs.sh"
echo ""
