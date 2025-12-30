#!/bin/bash
# scripts/ami-cleanup.sh
# AMI作成前のクリーンアップスクリプト

set -euo pipefail

echo "==================================="
echo "AMI Cleanup Script"
echo "==================================="

# 1. 一時ファイルの削除
echo "[1/8] Removing temporary files..."
sudo rm -rf /tmp/*
sudo rm -rf /var/tmp/*
sudo rm -rf /tmp/file-processor/*

# 2. ログファイルの削除
echo "[2/8] Clearing log files..."
sudo find /var/log -type f -name "*.log" -exec truncate -s 0 {} \;
sudo rm -rf /var/log/file-processor/*

# 3. Pythonキャッシュの削除
echo "[3/8] Removing Python cache..."
sudo find /app -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
sudo find /app -type f -name "*.pyc" -delete 2>/dev/null || true
sudo find /app -type f -name "*.pyo" -delete 2>/dev/null || true

# 4. コマンド履歴の削除
echo "[4/8] Clearing command history..."
sudo rm -f /root/.bash_history
rm -f /home/ec2-user/.bash_history 2>/dev/null || true
rm -f /home/appuser/.bash_history 2>/dev/null || true

# 5. SSH Host Keysの削除 (起動時に再生成)
echo "[5/8] Removing SSH host keys..."
sudo rm -f /etc/ssh/ssh_host_*

# 6. クラウドinitログの削除
echo "[6/8] Clearing cloud-init logs..."
sudo rm -rf /var/lib/cloud/instances/*
sudo rm -rf /var/log/cloud-init*.log

# 7. パッケージキャッシュの削除
echo "[7/8] Cleaning package cache..."
sudo dnf clean all

# 8. 環境変数の削除確認
echo "[8/8] Checking for sensitive environment variables..."
SENSITIVE_VARS=$(env | grep -E "(SQS_QUEUE_URL|OPENSEARCH|AWS_ACCESS_KEY|AWS_SECRET)" || true)

if [ -n "$SENSITIVE_VARS" ]; then
    echo "⚠️  WARNING: Sensitive environment variables detected!"
    echo "$SENSITIVE_VARS"
    echo ""
    echo "Please unset these variables before creating AMI:"
    echo "  unset SQS_QUEUE_URL"
    echo "  unset OPENSEARCH_ENDPOINT"
    echo "  unset AWS_ACCESS_KEY_ID"
    echo "  unset AWS_SECRET_ACCESS_KEY"
    exit 1
fi

echo "==================================="
echo "AMI Cleanup Complete!"
echo "==================================="
echo ""
echo "✅ Ready to create AMI"
echo ""
echo "Create AMI using AWS CLI:"
echo "aws ec2 create-image \\"
echo "  --instance-id i-xxxxxxxxx \\"
echo "  --name \"python-worker-v\$(date +%Y%m%d-%H%M%S)\" \\"
echo "  --description \"Python Worker for File Processing\" \\"
echo "  --no-reboot"
