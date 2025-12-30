# 緊急修正クイックスタート（5分で実行、30分で効果確認）

## 現状

- **処理速度**: 122 msg/分（過去最低）
- **メッセージ数**: 256,196
- **完了予想**: 35時間
- **問題**: exit status 1で再起動ループ、DLQ増加中

## 目標

- **処理速度**: 200+ msg/分（1.6〜2倍）
- **完了予想**: 17-21時間
- **安定性**: 再起動ループを解消、DLQ増加を抑制

## 実行手順（5分）

### Step 1: EC2インスタンスにログイン

```bash
ssh ec2-user@YOUR_INSTANCE_IP
```

### Step 2: スクリプトをダウンロード

```bash
cd /home/ec2-user/python-worker

# GitHubから直接ダウンロード（推奨）
wget https://raw.githubusercontent.com/YOUR_REPO/emergency-t3-medium-fix.sh
chmod +x emergency-t3-medium-fix.sh

# または、手動で作成
# （別途提供されるスクリプトの内容をコピー＆ペースト）
```

### Step 3: スクリプトを実行

```bash
sudo ./emergency-t3-medium-fix.sh
```

**実行時間**: 約3-5分

**実行内容**:
1. サービス停止
2. 現在の.envをバックアップ
3. t3.medium最適化済み.envを作成
4. systemd設定を更新（再起動ループ防止）
5. pip依存関係を修正
6. 一時ディレクトリを準備
7. サービス再起動

### Step 4: 動作確認（即座）

```bash
# サービスが起動しているか確認
sudo systemctl status file-processor

# ログをリアルタイムで確認
sudo journalctl -u file-processor -f
```

期待されるログ:
```
Received 10 message(s)  ← これが重要！10メッセージずつ処理されているか確認
Message xxx processed successfully
Message xxx deleted from queue
```

## 効果確認（30分後）

### パフォーマンスモニタリングツールを実行

```bash
# モニタリングスクリプトに実行権限を付与
chmod +x /home/ec2-user/python-worker/monitor-performance.sh

# 実行
/home/ec2-user/python-worker/monitor-performance.sh
```

**確認ポイント**:

1. **処理速度**: 200 msg/分以上
2. **サービス状態**: Active (running)、再起動なし
3. **DLQ**: 増加が止まっている
4. **CPU使用率**: 100-150%
5. **メモリ使用量**: 3GB以下

### 手動確認コマンド

```bash
# 1. 現在のSQSメッセージ数
aws sqs get-queue-attributes \
  --queue-url YOUR_QUEUE_URL \
  --attribute-names ApproximateNumberOfMessages \
  --query 'Attributes.ApproximateNumberOfMessages' \
  --output text

# 2. 1分間の処理速度を計測
MSG_BEFORE=$(aws sqs get-queue-attributes --queue-url YOUR_QUEUE_URL --attribute-names ApproximateNumberOfMessages --query 'Attributes.ApproximateNumberOfMessages' --output text)
echo "Before: $MSG_BEFORE"
sleep 60
MSG_AFTER=$(aws sqs get-queue-attributes --queue-url YOUR_QUEUE_URL --attribute-names ApproximateNumberOfMessages --query 'Attributes.ApproximateNumberOfMessages' --output text)
echo "After: $MSG_AFTER"
echo "Processed: $((MSG_BEFORE - MSG_AFTER)) msg/min"

# 3. エラーログ確認
sudo journalctl -u file-processor --since "10 minutes ago" -p err

# 4. 処理統計
sudo journalctl -u file-processor --since "30 minutes ago" | grep -E "succeeded|failed|DLQ"
```

## 期待される結果

### 最適化前

```
処理速度: 122 msg/分
完了予想: 35時間
再起動: 頻繁（exit status 1）
DLQ: 増加中（7,959+）
```

### 最適化後

```
処理速度: 200-250 msg/分
完了予想: 17-21時間
再起動: なし（安定動作）
DLQ: 増加停止
```

## トラブルシューティング

### 問題1: 処理速度が上がらない（150 msg/分以下）

**原因**: SQS_MAX_MESSAGESが反映されていない

**確認**:
```bash
# .envファイルを確認
cat /home/ec2-user/python-worker/.env | grep SQS_MAX_MESSAGES
# → SQS_MAX_MESSAGES=10 であることを確認

# ログでバッチサイズを確認
sudo journalctl -u file-processor | grep "Received.*message" | tail -10
# → "Received 10 message(s)" と表示されればOK
# → "Received 1 message(s)" の場合、設定が反映されていない
```

**対策**:
```bash
# サービスを再起動
sudo systemctl restart file-processor

# 環境変数が読み込まれているか確認
sudo systemctl show file-processor -p Environment
```

### 問題2: まだ再起動ループが発生する

**原因**: pip依存関係エラー、またはコード内のエラー

**確認**:
```bash
# エラーログを確認
sudo journalctl -u file-processor -n 100 --no-pager | grep -i error

# venv内のpip依存関係を確認
cd /home/ec2-user/python-worker
source venv/bin/activate
pip check
deactivate
```

**対策**:
```bash
# 依存関係を再インストール
cd /home/ec2-user/python-worker
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt --force-reinstall
deactivate

# サービス再起動
sudo systemctl restart file-processor
```

### 問題3: DLQが増え続ける

**原因**: 特定のファイルタイプでエラー、またはタイムアウト

**確認**:
```bash
# DLQメッセージの内容を確認
aws sqs receive-message \
  --queue-url YOUR_DLQ_URL \
  --max-number-of-messages 1 \
  --query 'Messages[0].Body' \
  --output text | jq .

# 失敗パターンを確認
sudo journalctl -u file-processor | grep "processing failed" | tail -20
```

**対策**:

特定のファイルタイプでエラーが多い場合:
```bash
# .envで該当ファイルタイプのサイズ制限を下げる
# 例: PDF処理でエラーが多い場合
echo "MAX_PDF_SIZE_MB=30" >> /home/ec2-user/python-worker/.env
sudo systemctl restart file-processor
```

タイムアウトが多い場合:
```bash
# タイムアウトを延長
echo "PROCESSING_TIMEOUT=240" >> /home/ec2-user/python-worker/.env
echo "OCR_TIMEOUT=180" >> /home/ec2-user/python-worker/.env
sudo systemctl restart file-processor
```

### 問題4: メモリ不足（OOM）

**確認**:
```bash
# OOMエラーを確認
dmesg | grep -i "out of memory"
sudo journalctl -u file-processor | grep -i "memory"
```

**対策**:
```bash
# .envでファイルサイズ制限をさらに下げる
cd /home/ec2-user/python-worker
cat >> .env << EOF
MAX_FILE_SIZE_MB=30
MAX_PDF_SIZE_MB=30
MAX_IMAGE_SIZE_MB=20
EOF

sudo systemctl restart file-processor
```

## さらなる最適化（200 msg/分で不十分な場合）

### オプション1: インスタンスタイプ変更

```bash
# t3.large にアップグレード（4vCPU、8GB）
# 期待速度: 400-500 msg/分
# AWS コンソールまたはCLIでインスタンスタイプを変更

# インスタンスタイプ変更後の最適化
cat > /home/ec2-user/python-worker/.env.large << EOF
SQS_MAX_MESSAGES=10
MAX_WORKERS=3  # 4vCPU - 1 = 3ワーカー
MAX_FILE_SIZE_MB=100
PDF_DPI=300
EOF

# .envを置き換え
cp /home/ec2-user/python-worker/.env.large /home/ec2-user/python-worker/.env
sudo systemctl restart file-processor
```

### オプション2: 複数インスタンス並列実行

```bash
# 同じt3.mediumインスタンスを2-3台起動
# すべて同じSQSキューをポーリング
# 期待速度: 200 × 台数 = 400-600 msg/分

# スポットインスタンスを使用してコスト削減可能
```

### オプション3: Auto Scaling Group（推奨）

```bash
# CloudFormationまたはTerraformでASGを構成
# メリット:
#   - 処理完了後は自動でスケールダウン
#   - 負荷に応じて自動スケール
#   - スポットインスタンス併用で低コスト
```

## まとめ

### 実行ステップ

1. **緊急修正スクリプト実行**（5分）
   ```bash
   sudo ./emergency-t3-medium-fix.sh
   ```

2. **動作確認**（即座）
   ```bash
   sudo journalctl -u file-processor -f
   ```

3. **効果確認**（30分後）
   ```bash
   /home/ec2-user/python-worker/monitor-performance.sh
   ```

### 重要な設定値（t3.medium向け）

- `SQS_MAX_MESSAGES=10` ← 最も重要！
- `MAX_WORKERS=1` ← 2vCPUでは1ワーカーが最適
- `PROCESSING_TIMEOUT=180`
- `MAX_FILE_SIZE_MB=50`
- `PDF_DPI=200`
- `LOG_LEVEL=WARNING`

### 期待される効果

- 処理速度: **1.6〜2倍** (122 → 200-250 msg/分)
- 完了時間: **約半分** (35時間 → 17-21時間)
- 安定性: **再起動ループ解消**
- DLQ: **増加抑制**

### サポート

問題が解決しない場合は、以下の情報を収集してください:

```bash
# 診断情報を収集
cat > /tmp/diagnostic-info.txt << EOF
=== System Info ===
$(uname -a)
$(free -h)
$(df -h)

=== Service Status ===
$(sudo systemctl status file-processor --no-pager)

=== Configuration ===
$(cat /home/ec2-user/python-worker/.env | grep -v "PASSWORD\|SECRET\|KEY")

=== Recent Logs ===
$(sudo journalctl -u file-processor -n 100 --no-pager)

=== SQS Status ===
$(aws sqs get-queue-attributes --queue-url YOUR_QUEUE_URL --attribute-names All --query 'Attributes' --output json)
EOF

cat /tmp/diagnostic-info.txt
```

この診断情報を基に、さらなる最適化を検討できます。
