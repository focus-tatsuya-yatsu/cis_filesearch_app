# t3.medium 緊急最適化ガイド（30分で200 msg/分達成）

## 現状分析

- **インスタンス**: t3.medium (2vCPU, 4GB RAM)
- **現在の処理速度**: 122 msg/分
- **メッセージ数**: 256,196
- **完了予想**: 35時間
- **DLQ**: 7,959（増加中）
- **問題**: exit status 1で再起動ループ

## 緊急対策：3ステップで最適化

### Step 1: 環境変数の最適化（最も効果的）

t3.mediumに最適化された設定値：

```bash
# /home/ec2-user/python-worker/.env
# または export で環境変数として設定

# === SQS設定（最重要） ===
SQS_MAX_MESSAGES=10          # 1→10に変更（10倍高速化の鍵）
SQS_WAIT_TIME=20             # ロングポーリングを維持
SQS_VISIBILITY_TIMEOUT=300   # 5分（処理時間に余裕を持たせる）

# === ワーカー設定 ===
MAX_WORKERS=1                # 2vCPU - 1（メインプロセス）= 1ワーカー
                             # ※2vCPUでは1ワーカーが最も効率的

# === 処理タイムアウト（安定性重視） ===
PROCESSING_TIMEOUT=180       # 3分（デフォルト5分から短縮）
OCR_TIMEOUT=120              # 2分（デフォルト3分から短縮）

# === メモリ管理 ===
MAX_FILE_SIZE_MB=50          # 100→50に削減（メモリ不足防止）
MAX_PDF_SIZE_MB=50           # 100→50に削減
TEMP_DIR=/tmp/file-processor
CLEANUP_TEMP_FILES=true      # 必須：メモリリーク防止

# === リトライ設定（DLQ増加を抑制） ===
MAX_RETRIES=2                # 3→2に削減（失敗時の無駄な再試行を減らす）
RETRY_DELAY=3                # 5→3秒に短縮

# === OCR最適化 ===
PDF_DPI=200                  # 300→200に削減（メモリとCPU使用量削減）
MAX_PDF_PAGES=500            # 1000→500に削減
IMAGE_PREPROCESSING=false    # 前処理を無効化（CPU削減）

# === ログレベル ===
LOG_LEVEL=WARNING            # INFO→WARNINGで不要なログを削減
```

#### 期待効果

- **SQS_MAX_MESSAGES=10**: 122 msg/分 → **200-250 msg/分**（1.6〜2倍）
- **MAX_WORKERS=1**: CPU競合を排除、安定動作
- **タイムアウト短縮**: ハングアップファイルの影響を最小化
- **メモリ削減**: OOM（メモリ不足）エラーを防止
- **DLQ増加抑制**: 無駄な再試行を削減

### Step 2: systemd設定の最適化（安定性向上）

現在の問題：
- exit status 1で再起動ループ
- pip依存関係エラー
- 再起動制限に達する可能性

最適化された systemd 設定：

```bash
# /etc/systemd/system/file-processor.service

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

# 重要：venv内のPythonを使用（pip依存関係エラーを回避）
ExecStart=/home/ec2-user/python-worker/venv/bin/python3 /home/ec2-user/python-worker/worker.py

# 再起動ポリシー（段階的バックオフ）
Restart=on-failure                # 失敗時のみ再起動
RestartSec=30                     # 10→30秒に延長（再起動ループを防ぐ）
StartLimitInterval=300            # 5分以内に
StartLimitBurst=5                 # 5回まで再起動を許可（それ以上は停止）
StartLimitAction=none             # 制限到達時は停止（無限ループを防ぐ）

# リソース制限（t3.medium向け）
LimitNOFILE=65536
LimitNPROC=2048                   # 4096→2048に削減
MemoryMax=3G                      # 4GBのうち3GBまで使用可能
CPUQuota=150%                     # 2vCPUのうち150%（1.5コア相当）
                                  # ※1ワーカー＋メインプロセスで十分

# タイムアウト設定
TimeoutStartSec=60                # 起動タイムアウト
TimeoutStopSec=60                 # 停止タイムアウト

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=file-processor

# Security（最小限の権限）
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict              # システムファイルを保護
ReadWritePaths=/tmp /var/log      # 書き込み可能なパスを制限

# OOMKiller対策（重要）
OOMScoreAdjust=-100               # OOMで優先的にkillされないように

[Install]
WantedBy=multi-user.target
```

#### 主な改善点

1. **venv内のPythonを使用** - pip依存関係エラーを完全に回避
2. **段階的バックオフ** - 再起動間隔を30秒に延長
3. **再起動制限** - 5分間に5回までで停止（無限ループ防止）
4. **リソース制限** - メモリ3GB、CPU 150%に制限
5. **OOMKiller対策** - メモリ不足時に優先的にkillされない

### Step 3: 緊急修正スクリプト（ワンコマンド実行）

以下のスクリプトをEC2インスタンス上で実行：

```bash
#!/bin/bash
# emergency-t3-medium-fix.sh
# t3.medium向けの緊急最適化スクリプト

set -e

echo "=========================================="
echo "t3.medium 緊急最適化開始"
echo "=========================================="

# 1. サービス停止
echo "[1/6] Stopping service..."
sudo systemctl stop file-processor || true

# 2. .env ファイルをバックアップ
echo "[2/6] Backing up .env..."
cd /home/ec2-user/python-worker
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)

# 3. 最適化された .env を作成
echo "[3/6] Creating optimized .env..."
cat > .env.optimized << 'EOF'
# t3.medium 最適化設定（2vCPU、4GB）
# 生成日時: $(date)

# === AWS設定 ===
AWS_REGION=ap-northeast-1
S3_BUCKET=cis-filesearch-storage
S3_PROCESSED_PREFIX=processed/
S3_FAILED_PREFIX=failed/

# === SQS設定（最重要） ===
SQS_MAX_MESSAGES=10
SQS_WAIT_TIME=20
SQS_VISIBILITY_TIMEOUT=300

# === ワーカー設定 ===
MAX_WORKERS=1

# === 処理タイムアウト ===
PROCESSING_TIMEOUT=180
OCR_TIMEOUT=120

# === メモリ管理 ===
MAX_FILE_SIZE_MB=50
MAX_IMAGE_SIZE_MB=30
MAX_OFFICE_SIZE_MB=50
MAX_PDF_SIZE_MB=50
TEMP_DIR=/tmp/file-processor
CLEANUP_TEMP_FILES=true

# === リトライ設定 ===
MAX_RETRIES=2
RETRY_DELAY=3

# === OCR設定 ===
TESSERACT_CMD=tesseract
TESSDATA_PREFIX=/usr/local/share/tessdata
OCR_LANGUAGE=jpn+eng
PDF_DPI=200
IMAGE_PREPROCESSING=false
MIN_OCR_CONFIDENCE=50.0
MAX_PDF_PAGES=500

# === サムネイル設定 ===
THUMBNAIL_WIDTH=150
THUMBNAIL_HEIGHT=150
THUMBNAIL_QUALITY=75
THUMBNAIL_FORMAT=JPEG
THUMBNAIL_IMAGES=true
THUMBNAIL_PDFS=false
THUMBNAIL_OFFICE=false
THUMBNAIL_DOCUWORKS=false

# === ログ設定 ===
LOG_LEVEL=WARNING
LOG_FILE=/var/log/file-processor.log

# === OpenSearch設定（既存の値を保持） ===
OPENSEARCH_ENDPOINT=${OPENSEARCH_ENDPOINT}
OPENSEARCH_INDEX=${OPENSEARCH_INDEX}
OPENSEARCH_USERNAME=${OPENSEARCH_USERNAME}
OPENSEARCH_PASSWORD=${OPENSEARCH_PASSWORD}
OPENSEARCH_USE_SSL=true
OPENSEARCH_VERIFY_CERTS=true

# === CloudWatch設定 ===
USE_CLOUDWATCH=false
CLOUDWATCH_LOG_GROUP=/aws/ec2/file-processor
CLOUDWATCH_LOG_STREAM=worker
EOF

# 既存の .env から重要な値をコピー
if [ -f .env ]; then
    # SQS_QUEUE_URL を保持
    SQS_URL=$(grep "^SQS_QUEUE_URL=" .env | head -1)
    if [ ! -z "$SQS_URL" ]; then
        echo "" >> .env.optimized
        echo "# 既存設定から引き継ぎ" >> .env.optimized
        echo "$SQS_URL" >> .env.optimized
    fi

    # OpenSearch設定を保持
    grep "^OPENSEARCH_" .env >> .env.optimized || true

    # DLQ設定を保持
    grep "^DLQ_" .env >> .env.optimized || true
fi

# .env を置き換え
mv .env.optimized .env
chmod 600 .env
chown ec2-user:ec2-user .env

echo "  ✓ Optimized .env created"

# 4. systemd サービスファイルを更新
echo "[4/6] Updating systemd service..."
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

EnvironmentFile=/home/ec2-user/python-worker/.env
Environment="TESSDATA_PREFIX=/usr/local/share/tessdata"
Environment="PATH=/home/ec2-user/python-worker/venv/bin:/usr/local/bin:/usr/bin:/bin"
Environment="PYTHONUNBUFFERED=1"

ExecStart=/home/ec2-user/python-worker/venv/bin/python3 /home/ec2-user/python-worker/worker.py

Restart=on-failure
RestartSec=30
StartLimitInterval=300
StartLimitBurst=5
StartLimitAction=none

LimitNOFILE=65536
LimitNPROC=2048
MemoryMax=3G
CPUQuota=150%

TimeoutStartSec=60
TimeoutStopSec=60

StandardOutput=journal
StandardError=journal
SyslogIdentifier=file-processor

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/tmp /var/log

OOMScoreAdjust=-100

[Install]
WantedBy=multi-user.target
EOF

echo "  ✓ systemd service updated"

# 5. pip依存関係の修正（重要）
echo "[5/6] Fixing pip dependencies..."
cd /home/ec2-user/python-worker

# venvが存在しない場合は作成
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

# 依存関係を再インストール
source venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt --no-cache-dir
deactivate

echo "  ✓ Dependencies fixed"

# 6. サービス再起動
echo "[6/6] Restarting service..."
sudo systemctl daemon-reload
sudo systemctl enable file-processor
sudo systemctl restart file-processor

# 状態確認
sleep 5
echo ""
echo "=========================================="
echo "サービス状態"
echo "=========================================="
sudo systemctl status file-processor --no-pager

echo ""
echo "=========================================="
echo "最適化完了！"
echo "=========================================="
echo ""
echo "設定変更:"
echo "  ✓ SQS_MAX_MESSAGES: 1→10（10倍高速化）"
echo "  ✓ MAX_WORKERS: 4→1（CPU最適化）"
echo "  ✓ PROCESSING_TIMEOUT: 300→180（安定性）"
echo "  ✓ MAX_FILE_SIZE_MB: 100→50（メモリ最適化）"
echo "  ✓ PDF_DPI: 300→200（CPU削減）"
echo "  ✓ LOG_LEVEL: INFO→WARNING（ログ削減）"
echo ""
echo "期待される性能:"
echo "  - 処理速度: 122 msg/分 → 200-250 msg/分"
echo "  - 完了予想: 35時間 → 17-21時間"
echo "  - 安定性: 再起動ループを防止"
echo ""
echo "監視コマンド:"
echo "  sudo journalctl -u file-processor -f"
echo "  watch -n 5 'aws sqs get-queue-attributes --queue-url YOUR_QUEUE_URL --attribute-names ApproximateNumberOfMessages'"
echo ""
echo "バックアップ:"
echo "  元の .env: $(ls -t .env.backup.* | head -1)"
echo "=========================================="
```

## 実行手順

### EC2インスタンスにログイン後：

```bash
# 1. スクリプトをダウンロード（または作成）
cd /home/ec2-user
cat > emergency-t3-medium-fix.sh << 'EOF'
# （上記のスクリプト内容をここに貼り付け）
EOF

# 2. 実行権限を付与
chmod +x emergency-t3-medium-fix.sh

# 3. 実行
sudo ./emergency-t3-medium-fix.sh

# 4. ログで動作を確認（別ターミナル）
sudo journalctl -u file-processor -f
```

## モニタリング

### 1. リアルタイムログ

```bash
# エラーのみ表示
sudo journalctl -u file-processor -f -p err

# 処理状況を表示
sudo journalctl -u file-processor -f | grep -E "Received|processed|succeeded|failed"
```

### 2. SQSメッセージ数監視

```bash
# 5秒ごとに更新
watch -n 5 'aws sqs get-queue-attributes \
  --queue-url YOUR_QUEUE_URL \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
  --query "Attributes" --output table'
```

### 3. パフォーマンス計測

```bash
# 1分間の処理メッセージ数を計測
echo "現在のメッセージ数:"
MSG_BEFORE=$(aws sqs get-queue-attributes --queue-url YOUR_QUEUE_URL --attribute-names ApproximateNumberOfMessages --query 'Attributes.ApproximateNumberOfMessages' --output text)
echo $MSG_BEFORE

sleep 60

echo "1分後のメッセージ数:"
MSG_AFTER=$(aws sqs get-queue-attributes --queue-url YOUR_QUEUE_URL --attribute-names ApproximateNumberOfMessages --query 'Attributes.ApproximateNumberOfMessages' --output text)
echo $MSG_AFTER

PROCESSED=$((MSG_BEFORE - MSG_AFTER))
echo "処理速度: $PROCESSED msg/分"
```

## 効果の検証（30分後）

以下を確認：

1. **処理速度**: 200 msg/分以上
2. **再起動なし**: `sudo systemctl status file-processor` でActive (running)
3. **DLQ増加なし**: DLQメッセージ数が安定
4. **メモリ使用量**: 3GB以下（`free -h`で確認）
5. **CPU使用率**: 150%以下（`top`で確認）

## トラブルシューティング

### 問題1: まだ再起動ループが発生する

```bash
# ログで原因を確認
sudo journalctl -u file-processor -n 100 --no-pager

# よくある原因：
# - pip依存関係エラー → requirements.txtを確認
# - 設定ファイルエラー → .envの構文を確認
# - 権限エラー → chown ec2-user:ec2-user -R /home/ec2-user/python-worker
```

### 問題2: 処理速度が上がらない

```bash
# SQS_MAX_MESSAGESが反映されているか確認
sudo journalctl -u file-processor | grep "Received.*message"
# → "Received 10 message(s)" と表示されればOK

# MAX_WORKERSを確認
ps aux | grep python | grep worker
# → プロセスが1-2個であればOK（多すぎる場合は設定ミス）
```

### 問題3: DLQが増え続ける

```bash
# DLQメッセージの内容を確認
aws sqs receive-message \
  --queue-url YOUR_DLQ_URL \
  --max-number-of-messages 1 \
  --query 'Messages[0].Body' \
  --output text | jq .

# 共通の失敗パターンを確認
sudo journalctl -u file-processor | grep "processing failed" | tail -20

# 対策：
# - 特定のファイルタイプでエラー → そのタイプを除外
# - タイムアウト → PROCESSING_TIMEOUTを延長
# - メモリ不足 → MAX_FILE_SIZE_MBをさらに削減
```

## さらなる最適化（200 msg/分で不十分な場合）

### オプション1: インスタンスタイプ変更

```bash
# t3.large (2vCPU → 4vCPU, 4GB → 8GB)
# 期待速度: 400-500 msg/分
# 追加コスト: 約2倍
```

### オプション2: 複数インスタンス並列実行

```bash
# t3.medium × 2インスタンス
# 期待速度: 400-500 msg/分（合計）
# 柔軟性: スポットインスタンスで低コスト化可能
```

### オプション3: Auto Scaling Group

```bash
# 負荷に応じて自動スケール
# 最小: 1インスタンス
# 最大: 5インスタンス
# メリット: 処理完了後は自動でスケールダウン
```

## 予想される結果

### 現在の状況

- 処理速度: 122 msg/分
- メッセージ数: 256,196
- 完了予想: 35時間

### 最適化後（t3.medium × 1）

- 処理速度: **200-250 msg/分**（1.6〜2倍）
- メッセージ数: 256,196
- 完了予想: **17-21時間**

### さらなる最適化（t3.large × 1）

- 処理速度: **400-500 msg/分**（3〜4倍）
- 完了予想: **8-11時間**

### 最速（t3.medium × 3並列）

- 処理速度: **600-750 msg/分**（5〜6倍）
- 完了予想: **5-7時間**

## まとめ

1. **Step 1**: 環境変数最適化（SQS_MAX_MESSAGES=10が最重要）
2. **Step 2**: systemd設定最適化（再起動ループ防止）
3. **Step 3**: 緊急修正スクリプト実行（ワンコマンド）

**実行時間**: 約5-10分
**期待効果**: 30分以内に処理速度が1.6〜2倍に向上

この設定で、t3.mediumの限界性能を引き出し、安定した200 msg/分以上の処理速度を達成できます。
