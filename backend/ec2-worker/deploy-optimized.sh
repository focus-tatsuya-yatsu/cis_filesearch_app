#!/bin/bash
#
# CIS File Processor Worker - 最適化版デプロイスクリプト
# Usage: ./deploy-optimized.sh [EC2_HOST]
#

set -e

# カラー出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ログ関数
log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

# EC2ホストアドレス
EC2_HOST=$1
if [ -z "$EC2_HOST" ]; then
    log_error "EC2 host address is required"
    echo "Usage: $0 [EC2_HOST]"
    echo "Example: $0 ec2-user@your-instance-ip"
    exit 1
fi

log_info "CIS File Processor Worker - Optimized Deployment"
echo "=========================================="
echo "Target: $EC2_HOST"
echo "=========================================="
echo ""

# 確認
read -p "Deploy optimized version? This will update the worker. (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_warning "Deployment cancelled"
    exit 0
fi

# デプロイするファイルのリスト
DEPLOY_FILES=(
    "src/main_optimized.py"
    "src/sqs_handler_optimized.py"
    "src/config_optimized.py"
    ".env.optimized"
    "deploy/cis-worker-optimized.service"
)

# ファイルの存在確認
log_info "Checking local files..."
for file in "${DEPLOY_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        log_error "File not found: $file"
        exit 1
    fi
    log_success "Found: $file"
done

# EC2にファイルを転送
log_info "Transferring files to EC2..."
for file in "${DEPLOY_FILES[@]}"; do
    log_info "Uploading $file..."
    scp "$file" "$EC2_HOST:/tmp/$(basename $file)" || {
        log_error "Failed to upload $file"
        exit 1
    }
done
log_success "All files transferred"

# EC2で実行するコマンド
REMOTE_COMMANDS=$(cat << 'EOF'
set -e

echo "=========================================="
echo "Installing optimized version..."
echo "=========================================="

# バックアップを作成
echo "Creating backups..."
sudo cp /opt/cis-file-processor/src/main.py /opt/cis-file-processor/src/main.py.backup || true
sudo cp /opt/cis-file-processor/src/sqs_handler.py /opt/cis-file-processor/src/sqs_handler.py.backup || true
sudo cp /opt/cis-file-processor/src/config.py /opt/cis-file-processor/src/config.py.backup || true
sudo cp /opt/cis-file-processor/.env /opt/cis-file-processor/.env.backup || true

# 最適化版ファイルをインストール
echo "Installing optimized files..."
sudo mv /tmp/main_optimized.py /opt/cis-file-processor/src/
sudo mv /tmp/sqs_handler_optimized.py /opt/cis-file-processor/src/
sudo mv /tmp/config_optimized.py /opt/cis-file-processor/src/

# .env ファイルの更新確認
echo ""
echo "=========================================="
echo "Environment Configuration"
echo "=========================================="
echo "Current .env settings will be replaced with optimized settings."
echo "Please review the new .env.optimized file."
read -p "Replace .env with optimized version? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    sudo mv /tmp/.env.optimized /opt/cis-file-processor/.env
    echo "✓ .env updated"
else
    echo "⚠ Keeping existing .env file"
    echo "ℹ You can manually update it later with values from .env.optimized"
    sudo mv /tmp/.env.optimized /opt/cis-file-processor/.env.optimized.template
fi

# systemd サービスファイルの更新
echo ""
echo "Installing systemd service..."
sudo mv /tmp/cis-worker-optimized.service /etc/systemd/system/cis-worker.service

# 権限設定
echo "Setting permissions..."
sudo chown -R cis-worker:cis-worker /opt/cis-file-processor/src/
sudo chown cis-worker:cis-worker /opt/cis-file-processor/.env

# systemd リロード
echo "Reloading systemd..."
sudo systemctl daemon-reload

echo ""
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Review configuration: sudo nano /opt/cis-file-processor/.env"
echo "2. Restart service: sudo systemctl restart cis-worker"
echo "3. Check status: sudo systemctl status cis-worker"
echo "4. Monitor logs: sudo tail -f /var/log/cis-worker/worker.log"
echo ""
echo "Performance monitoring:"
echo "- Statistics are logged every 30 seconds"
echo "- Look for '📊 PERFORMANCE STATISTICS' in logs"
echo "- Target: 500-1000 messages/minute"
echo ""
EOF
)

# EC2でリモートコマンドを実行
log_info "Installing on EC2..."
ssh "$EC2_HOST" "$REMOTE_COMMANDS" || {
    log_error "Remote installation failed"
    exit 1
}

log_success "Deployment successful!"
echo ""
echo "=========================================="
echo "Post-Deployment Actions"
echo "=========================================="
echo ""
echo "To restart the worker with optimized version:"
echo "  ssh $EC2_HOST"
echo "  sudo systemctl restart cis-worker"
echo "  sudo tail -f /var/log/cis-worker/worker.log"
echo ""
echo "To monitor performance:"
echo "  watch -n 30 'sudo journalctl -u cis-worker -n 50 | grep \"PERFORMANCE STATISTICS\" -A 10'"
echo ""
echo "=========================================="
