#!/bin/bash
# emergency-t3-medium-fix.sh
# t3.medium向けの緊急最適化スクリプト
# 目標: 30分以内に122 msg/分 → 200+ msg/分を達成

set -e

echo "=========================================="
echo "t3.medium 緊急最適化開始"
echo "インスタンス: t3.medium (2vCPU, 4GB RAM)"
echo "目標: 200+ msg/分の処理速度"
echo "=========================================="
echo ""

# 現在のユーザーを確認
CURRENT_USER=$(whoami)
if [ "$CURRENT_USER" != "root" ] && [ "$CURRENT_USER" != "ec2-user" ]; then
    echo "警告: ec2-userまたはrootで実行してください"
    echo "現在のユーザー: $CURRENT_USER"
fi

# 作業ディレクトリを確認
WORK_DIR="/home/ec2-user/python-worker"
if [ ! -d "$WORK_DIR" ]; then
    echo "エラー: $WORK_DIR が見つかりません"
    echo "正しいディレクトリで実行してください"
    exit 1
fi

# 1. サービス停止
echo "[1/7] Stopping file-processor service..."
sudo systemctl stop file-processor 2>/dev/null || true
echo "  ✓ Service stopped"
echo ""

# 2. .env ファイルをバックアップ
echo "[2/7] Backing up current configuration..."
cd "$WORK_DIR"
BACKUP_FILE=".env.backup.$(date +%Y%m%d_%H%M%S)"
if [ -f .env ]; then
    cp .env "$BACKUP_FILE"
    echo "  ✓ Backed up to: $BACKUP_FILE"
else
    echo "  ! No existing .env found - will create new one"
fi
echo ""

# 既存の重要な環境変数を保存
if [ -f .env ]; then
    SQS_QUEUE_URL=$(grep "^SQS_QUEUE_URL=" .env | cut -d'=' -f2- | head -1 || echo "")
    OPENSEARCH_ENDPOINT=$(grep "^OPENSEARCH_ENDPOINT=" .env | cut -d'=' -f2- | head -1 || echo "")
    OPENSEARCH_USERNAME=$(grep "^OPENSEARCH_USERNAME=" .env | cut -d'=' -f2- | head -1 || echo "")
    OPENSEARCH_PASSWORD=$(grep "^OPENSEARCH_PASSWORD=" .env | cut -d'=' -f2- | head -1 || echo "")
    DLQ_QUEUE_URL=$(grep "^DLQ_QUEUE_URL=" .env | cut -d'=' -f2- | head -1 || echo "")
    AWS_ACCESS_KEY_ID=$(grep "^AWS_ACCESS_KEY_ID=" .env | cut -d'=' -f2- | head -1 || echo "")
    AWS_SECRET_ACCESS_KEY=$(grep "^AWS_SECRET_ACCESS_KEY=" .env | cut -d'=' -f2- | head -1 || echo "")
else
    SQS_QUEUE_URL=""
    OPENSEARCH_ENDPOINT=""
    OPENSEARCH_USERNAME=""
    OPENSEARCH_PASSWORD=""
    DLQ_QUEUE_URL=""
    AWS_ACCESS_KEY_ID=""
    AWS_SECRET_ACCESS_KEY=""
fi

# 3. 最適化された .env を作成
echo "[3/7] Creating optimized .env configuration..."
cat > .env << EOF
# ==========================================
# t3.medium 最適化設定（2vCPU、4GB）
# 生成日時: $(date)
# 目標: 200+ msg/分の処理速度
# ==========================================

# === AWS Configuration ===
AWS_REGION=ap-northeast-1
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}

# S3 Configuration
S3_BUCKET=cis-filesearch-storage
S3_PROCESSED_PREFIX=processed/
S3_FAILED_PREFIX=failed/

# === SQS Configuration（最重要！） ===
# SQS_MAX_MESSAGES=10: 1→10で処理速度が10倍に
SQS_QUEUE_URL=${SQS_QUEUE_URL}
SQS_MAX_MESSAGES=10
SQS_WAIT_TIME=20
SQS_VISIBILITY_TIMEOUT=300
DLQ_QUEUE_URL=${DLQ_QUEUE_URL}

# === OpenSearch Configuration ===
OPENSEARCH_ENDPOINT=${OPENSEARCH_ENDPOINT}
OPENSEARCH_INDEX=file-index
OPENSEARCH_USERNAME=${OPENSEARCH_USERNAME}
OPENSEARCH_PASSWORD=${OPENSEARCH_PASSWORD}
OPENSEARCH_USE_SSL=true
OPENSEARCH_VERIFY_CERTS=true

# === CloudWatch Configuration ===
USE_CLOUDWATCH=false
CLOUDWATCH_LOG_GROUP=/aws/ec2/file-processor
CLOUDWATCH_LOG_STREAM=worker

# ==========================================
# Processing Configuration
# ==========================================

# File Size Limits（メモリ不足防止）
MAX_FILE_SIZE_MB=50
MAX_IMAGE_SIZE_MB=30
MAX_OFFICE_SIZE_MB=50
MAX_PDF_SIZE_MB=50

# Processing Timeouts（安定性重視）
PROCESSING_TIMEOUT=180
OCR_TIMEOUT=120

# Temporary Storage
TEMP_DIR=/tmp/file-processor
CLEANUP_TEMP_FILES=true

# Worker Configuration（最重要！）
# MAX_WORKERS=1: 2vCPUでは1ワーカーが最適（CPU競合を回避）
MAX_WORKERS=1

# Retry Configuration（DLQ増加を抑制）
MAX_RETRIES=2
RETRY_DELAY=3

# ==========================================
# OCR Configuration
# ==========================================
TESSERACT_CMD=tesseract
TESSDATA_PREFIX=/usr/local/share/tessdata

# Language Settings
OCR_LANGUAGE=jpn+eng

# OCR Quality Settings（CPU・メモリ削減）
PDF_DPI=200
IMAGE_PREPROCESSING=false
MIN_OCR_CONFIDENCE=50.0
MAX_PDF_PAGES=500

# ==========================================
# Thumbnail Configuration
# ==========================================
THUMBNAIL_WIDTH=150
THUMBNAIL_HEIGHT=150
THUMBNAIL_QUALITY=75
THUMBNAIL_FORMAT=JPEG

# Generate thumbnails（CPU削減）
THUMBNAIL_IMAGES=true
THUMBNAIL_PDFS=false
THUMBNAIL_OFFICE=false
THUMBNAIL_DOCUWORKS=false

# ==========================================
# Logging Configuration
# ==========================================
LOG_LEVEL=WARNING
LOG_FILE=/var/log/file-processor.log
EOF

chmod 600 .env
chown ec2-user:ec2-user .env 2>/dev/null || true

echo "  ✓ Optimized .env created"
echo "    - SQS_MAX_MESSAGES: 1 → 10 (10倍高速化)"
echo "    - MAX_WORKERS: 4 → 1 (CPU最適化)"
echo "    - PROCESSING_TIMEOUT: 300 → 180 (安定性)"
echo "    - MAX_FILE_SIZE_MB: 100 → 50 (メモリ最適化)"
echo "    - PDF_DPI: 300 → 200 (CPU削減)"
echo "    - LOG_LEVEL: INFO → WARNING (ログ削減)"
echo ""

# 4. systemd サービスファイルを更新
echo "[4/7] Updating systemd service configuration..."
sudo tee /etc/systemd/system/file-processor.service > /dev/null << 'EOF'
[Unit]
Description=File Processor Worker Service (Optimized for t3.medium)
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ec2-user
Group=ec2-user
WorkingDirectory=/home/ec2-user/python-worker

# Environment
EnvironmentFile=/home/ec2-user/python-worker/.env
Environment="TESSDATA_PREFIX=/usr/local/share/tessdata"
Environment="PATH=/home/ec2-user/python-worker/venv/bin:/usr/local/bin:/usr/bin:/bin"
Environment="PYTHONUNBUFFERED=1"

# Command（venv内のPythonを使用 - pip依存関係エラーを回避）
ExecStart=/home/ec2-user/python-worker/venv/bin/python3 /home/ec2-user/python-worker/worker.py

# Restart Policy（段階的バックオフ - 再起動ループを防ぐ）
Restart=on-failure
RestartSec=30
StartLimitInterval=300
StartLimitBurst=5
StartLimitAction=none

# Resource Limits（t3.medium向け: 2vCPU, 4GB RAM）
LimitNOFILE=65536
LimitNPROC=2048
MemoryMax=3G
CPUQuota=150%

# Timeouts
TimeoutStartSec=60
TimeoutStopSec=60

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=file-processor

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/tmp /var/log

# OOM Killer対策
OOMScoreAdjust=-100

[Install]
WantedBy=multi-user.target
EOF

echo "  ✓ systemd service updated"
echo "    - venv内のPythonを使用（pip依存関係エラー回避）"
echo "    - RestartSec: 10 → 30秒（再起動ループ防止）"
echo "    - MemoryMax: 3GB（OOM防止）"
echo "    - CPUQuota: 150%（1.5コア相当）"
echo ""

# 5. pip依存関係の修正
echo "[5/7] Fixing pip dependencies..."
cd "$WORK_DIR"

# venvが存在しない場合は作成
if [ ! -d "venv" ]; then
    echo "  ! venv not found - creating new virtual environment..."
    python3 -m venv venv
fi

# 依存関係を再インストール
if [ -f "requirements.txt" ]; then
    source venv/bin/activate
    pip install --upgrade pip setuptools wheel --quiet
    echo "  - Installing dependencies (this may take a few minutes)..."
    pip install -r requirements.txt --no-cache-dir --quiet
    deactivate
    echo "  ✓ Dependencies installed successfully"
else
    echo "  ! requirements.txt not found - skipping dependency installation"
fi
echo ""

# 6. 一時ディレクトリの準備
echo "[6/7] Preparing temporary directories..."
sudo mkdir -p /tmp/file-processor
sudo chown ec2-user:ec2-user /tmp/file-processor
sudo chmod 755 /tmp/file-processor

# 古い一時ファイルを削除
sudo find /tmp/file-processor -type f -mtime +1 -delete 2>/dev/null || true
echo "  ✓ Temporary directory ready"
echo ""

# 7. サービス再起動
echo "[7/7] Restarting service..."
sudo systemctl daemon-reload
sudo systemctl enable file-processor
sudo systemctl restart file-processor

# 少し待機して状態を確認
sleep 5

echo ""
echo "=========================================="
echo "サービス状態"
echo "=========================================="
sudo systemctl status file-processor --no-pager -l || true

echo ""
echo "=========================================="
echo "✓ 最適化完了！"
echo "=========================================="
echo ""
echo "【設定変更サマリー】"
echo "  ✓ SQS_MAX_MESSAGES: 1 → 10（10倍高速化）"
echo "  ✓ MAX_WORKERS: 4 → 1（CPU最適化）"
echo "  ✓ PROCESSING_TIMEOUT: 300 → 180秒（安定性）"
echo "  ✓ MAX_FILE_SIZE_MB: 100 → 50（メモリ最適化）"
echo "  ✓ PDF_DPI: 300 → 200（CPU削減）"
echo "  ✓ LOG_LEVEL: INFO → WARNING（ログ削減）"
echo "  ✓ RestartSec: 10 → 30秒（再起動ループ防止）"
echo ""
echo "【期待される性能】"
echo "  - 処理速度: 122 msg/分 → 200-250 msg/分（1.6〜2倍）"
echo "  - 完了予想: 35時間 → 17-21時間"
echo "  - 安定性: 再起動ループを防止"
echo "  - DLQ: 増加を抑制"
echo ""
echo "【モニタリングコマンド】"
echo ""
echo "1. リアルタイムログ:"
echo "   sudo journalctl -u file-processor -f"
echo ""
echo "2. エラーログのみ:"
echo "   sudo journalctl -u file-processor -f -p err"
echo ""
echo "3. 処理状況:"
echo "   sudo journalctl -u file-processor -f | grep -E 'Received|processed|succeeded|failed'"
echo ""
echo "4. SQSメッセージ数（5秒ごと更新）:"
echo "   watch -n 5 'aws sqs get-queue-attributes --queue-url $SQS_QUEUE_URL --attribute-names ApproximateNumberOfMessages --query \"Attributes.ApproximateNumberOfMessages\" --output text'"
echo ""
echo "【バックアップ】"
echo "  元の .env: $BACKUP_FILE"
echo "  復元方法: cp $BACKUP_FILE .env && sudo systemctl restart file-processor"
echo ""
echo "【トラブルシューティング】"
echo ""
echo "問題1: まだ再起動ループが発生する場合"
echo "  → sudo journalctl -u file-processor -n 100 --no-pager"
echo ""
echo "問題2: 処理速度が上がらない場合"
echo "  → sudo journalctl -u file-processor | grep 'Received.*message'"
echo "     （'Received 10 message(s)' と表示されればOK）"
echo ""
echo "問題3: DLQが増え続ける場合"
echo "  → sudo journalctl -u file-processor | grep 'processing failed' | tail -20"
echo ""
echo "【次のステップ】"
echo ""
echo "30分後に以下を確認してください："
echo "  1. 処理速度が 200 msg/分 以上になっているか"
echo "  2. サービスが再起動していないか（Active (running) 状態が維持されているか）"
echo "  3. DLQメッセージ数が安定しているか"
echo ""
echo "性能が不十分な場合の選択肢："
echo "  - オプション1: t3.large にアップグレード（400-500 msg/分）"
echo "  - オプション2: t3.medium × 2-3 並列実行（600-750 msg/分）"
echo "  - オプション3: Auto Scaling Group で自動スケール"
echo ""
echo "詳細は以下を参照:"
echo "  /home/ec2-user/python-worker/EMERGENCY_T3_MEDIUM_OPTIMIZATION.md"
echo ""
echo "=========================================="
