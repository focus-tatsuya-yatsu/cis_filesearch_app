#!/bin/bash
# scripts/debug-worker.sh
# Worker診断スクリプト

set -euo pipefail

echo "==================================="
echo "Python Worker Diagnostics"
echo "Date: $(date)"
echo "==================================="
echo ""

# システム情報
echo "📋 [1/8] System Information"
echo "-----------------------------------"
echo "OS Release:"
cat /etc/os-release | grep -E "(PRETTY_NAME|VERSION_ID)"
echo ""
echo "Kernel:"
uname -r
echo ""
echo "Python Version:"
python3.11 --version
echo ""

# インスタンスメタデータ
echo "☁️  [2/8] Instance Metadata"
echo "-----------------------------------"
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
INSTANCE_ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
INSTANCE_TYPE=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-type)
AZ=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/availability-zone)

echo "Instance ID: $INSTANCE_ID"
echo "Instance Type: $INSTANCE_TYPE"
echo "Availability Zone: $AZ"
echo ""

# 環境変数
echo "🔧 [3/8] Environment Variables"
echo "-----------------------------------"
if [ -f /etc/file-processor/env ]; then
    echo "Loading from: /etc/file-processor/env"
    source /etc/file-processor/env
    env | grep -E "(AWS|SQS|OPENSEARCH|S3|LOG)" | sort
else
    echo "⚠️  Environment file not found at /etc/file-processor/env"
    env | grep -E "(AWS|SQS|OPENSEARCH|S3|LOG)" | sort || echo "No relevant environment variables found"
fi
echo ""

# Workerサービス状態
echo "⚙️  [4/8] Worker Service Status"
echo "-----------------------------------"
if systemctl is-active --quiet file-processor-worker.service; then
    echo "✅ Service is ACTIVE"
else
    echo "❌ Service is INACTIVE"
fi

sudo systemctl status file-processor-worker.service --no-pager -l || true
echo ""

# 最新ログ
echo "📝 [5/8] Recent Worker Logs (last 20 lines)"
echo "-----------------------------------"
sudo journalctl -u file-processor-worker.service -n 20 --no-pager || true
echo ""

# ディスク使用量
echo "💾 [6/8] Disk Usage"
echo "-----------------------------------"
df -h | grep -E "(Filesystem|/dev/)"
echo ""
echo "Temp directory:"
du -sh /tmp/file-processor 2>/dev/null || echo "/tmp/file-processor not found"
echo ""

# メモリ使用量
echo "🧠 [7/8] Memory Usage"
echo "-----------------------------------"
free -h
echo ""
echo "Top 5 memory-consuming processes:"
ps aux --sort=-%mem | head -6
echo ""

# ネットワーク接続テスト
echo "🌐 [8/8] Network Connectivity Tests"
echo "-----------------------------------"

# SQS接続テスト
if [ -n "${SQS_QUEUE_URL:-}" ]; then
    echo "Testing SQS connection..."
    if aws sqs get-queue-attributes \
        --queue-url ${SQS_QUEUE_URL} \
        --attribute-names ApproximateNumberOfMessages \
        --region ${AWS_REGION:-ap-northeast-1} \
        --output json 2>/dev/null; then
        echo "✅ SQS connection successful"
    else
        echo "❌ SQS connection failed"
    fi
else
    echo "⚠️  SQS_QUEUE_URL not set"
fi
echo ""

# OpenSearch接続テスト
if [ -n "${OPENSEARCH_ENDPOINT:-}" ]; then
    echo "Testing OpenSearch connection..."
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" ${OPENSEARCH_ENDPOINT}/_cluster/health 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "401" ]; then
        echo "✅ OpenSearch endpoint reachable (HTTP $HTTP_CODE)"
    else
        echo "❌ OpenSearch connection failed (HTTP $HTTP_CODE)"
    fi
else
    echo "⚠️  OPENSEARCH_ENDPOINT not set"
fi
echo ""

# S3接続テスト
if [ -n "${S3_BUCKET:-}" ]; then
    echo "Testing S3 access..."
    if aws s3 ls s3://${S3_BUCKET}/ --region ${AWS_REGION:-ap-northeast-1} --max-items 1 2>/dev/null; then
        echo "✅ S3 access successful"
    else
        echo "❌ S3 access failed"
    fi
else
    echo "⚠️  S3_BUCKET not set"
fi
echo ""

# Tesseract確認
echo "📄 Additional Checks"
echo "-----------------------------------"
echo "Tesseract OCR:"
if command -v tesseract &> /dev/null; then
    tesseract --version 2>&1 | head -1
    echo "Languages:"
    tesseract --list-langs 2>&1 | grep -E "(jpn|eng)" || echo "⚠️  Required languages (jpn, eng) not found"
else
    echo "❌ Tesseract not installed"
fi
echo ""

# Python依存関係確認
echo "Python packages (key dependencies):"
pip3.11 list 2>/dev/null | grep -E "(boto3|pytesseract|Pillow|opensearch)" || echo "⚠️  Some dependencies missing"
echo ""

echo "==================================="
echo "Diagnostics Complete"
echo "==================================="
echo ""
echo "🔍 Quick Status:"
echo "-----------------------------------"

# クイックサマリー
SERVICE_STATUS="❌ INACTIVE"
if systemctl is-active --quiet file-processor-worker.service; then
    SERVICE_STATUS="✅ ACTIVE"
fi

SQS_STATUS="⚠️  Not configured"
if [ -n "${SQS_QUEUE_URL:-}" ]; then
    if aws sqs get-queue-attributes --queue-url ${SQS_QUEUE_URL} --attribute-names All --region ${AWS_REGION:-ap-northeast-1} &>/dev/null; then
        SQS_STATUS="✅ Connected"
    else
        SQS_STATUS="❌ Failed"
    fi
fi

OPENSEARCH_STATUS="⚠️  Not configured"
if [ -n "${OPENSEARCH_ENDPOINT:-}" ]; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" ${OPENSEARCH_ENDPOINT}/_cluster/health 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "401" ]; then
        OPENSEARCH_STATUS="✅ Reachable"
    else
        OPENSEARCH_STATUS="❌ Failed"
    fi
fi

S3_STATUS="⚠️  Not configured"
if [ -n "${S3_BUCKET:-}" ]; then
    if aws s3 ls s3://${S3_BUCKET}/ --region ${AWS_REGION:-ap-northeast-1} --max-items 1 &>/dev/null; then
        S3_STATUS="✅ Accessible"
    else
        S3_STATUS="❌ Failed"
    fi
fi

echo "Worker Service: $SERVICE_STATUS"
echo "SQS: $SQS_STATUS"
echo "OpenSearch: $OPENSEARCH_STATUS"
echo "S3: $S3_STATUS"
echo ""

# 推奨アクション
echo "📌 Recommended Actions:"
if [[ "$SERVICE_STATUS" == *"INACTIVE"* ]]; then
    echo "  - Start worker: sudo systemctl start file-processor-worker.service"
fi
if [[ "$SQS_STATUS" == *"Failed"* ]] || [[ "$SQS_STATUS" == *"Not configured"* ]]; then
    echo "  - Check SQS_QUEUE_URL environment variable"
    echo "  - Verify IAM role permissions for SQS"
fi
if [[ "$OPENSEARCH_STATUS" == *"Failed"* ]]; then
    echo "  - Check OPENSEARCH_ENDPOINT environment variable"
    echo "  - Verify network connectivity and security groups"
fi
if [[ "$S3_STATUS" == *"Failed"* ]]; then
    echo "  - Check S3_BUCKET environment variable"
    echo "  - Verify IAM role permissions for S3"
fi
echo ""

echo "For detailed logs: sudo journalctl -u file-processor-worker.service -f"
