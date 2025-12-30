# 🚀 クイックスタート - レジリエントアーキテクチャデプロイ

**所要時間**: 15分
**難易度**: 初級
**対象**: 本番環境のSQS Worker安定化

---

## ⚡ 5ステップでデプロイ

### Step 1: ファイルアップロード（3分）

```bash
# ローカルマシンから実行
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker

# EC2 IPアドレスを設定
export EC2_IP="your-ec2-ip-here"

# 全ファイルをアップロード
scp -i ~/.ssh/cis-filesearch-key.pem \
    health_check.py \
    dlq_reprocessor.py \
    spot_interruption_handler.py \
    auto_recovery.py \
    deploy-resilient-architecture.sh \
    ec2-user@${EC2_IP}:/home/ec2-user/python-worker/

# Systemdサービスファイルもアップロード
scp -i ~/.ssh/cis-filesearch-key.pem \
    deployment/file-processor-resilient.service \
    deployment/spot-interruption-handler.service \
    deployment/auto-recovery.service \
    ec2-user@${EC2_IP}:/home/ec2-user/python-worker/deployment/
```

---

### Step 2: EC2にSSH接続（1分）

```bash
ssh -i ~/.ssh/cis-filesearch-key.pem ec2-user@${EC2_IP}
```

---

### Step 3: 依存関係インストール（2分）

```bash
# Python依存関係
sudo python3.11 -m pip install psutil requests

# 実行権限付与
cd /home/ec2-user/python-worker
chmod +x *.py *.sh
```

---

### Step 4: デプロイ実行（5分）

```bash
# 自動デプロイスクリプト実行
sudo bash deploy-resilient-architecture.sh
```

**何が起こるか:**
- ✅ ヘルスチェックモジュール配置
- ✅ Resilient Systemdサービス更新
- ✅ DLQ自動再処理（15分ごと）セットアップ
- ✅ スポット中断ハンドラー起動
- ✅ 自動復旧システム起動
- ✅ Workerサービス再起動

---

### Step 5: 検証（4分）

```bash
# 1. サービス状態確認
sudo systemctl status file-processor.service

# 期待される出力:
# ● file-processor.service - File Processor Worker Service (Resilient Architecture)
#    Loaded: loaded
#    Active: active (running) since ...

# 2. ヘルスチェック実行
sudo python3.11 /home/ec2-user/python-worker/health_check.py

# 期待される出力:
# ✅ HEALTH CHECK PASSED - All systems operational

# 3. ログ監視（30秒間）
sudo journalctl -u file-processor.service -f

# 期待される出力:
# INFO - Starting to poll SQS queue...
# INFO - Received X message(s)
# INFO - Successfully processed: ...
# (エラーなし)
```

---

## ✅ 成功確認

### 即座確認（5分後）

```bash
# SQSメッセージ数を確認
aws sqs get-queue-attributes \
    --queue-url $(grep SQS_QUEUE_URL /home/ec2-user/python-worker/.env | cut -d'=' -f2) \
    --attribute-names ApproximateNumberOfMessages \
    --query "Attributes.ApproximateNumberOfMessages"
```

**期待値:**
- 減少傾向が確認できる（前回より少ない）

---

### 1時間後の確認

```bash
# 再起動回数チェック（ゼロであるべき）
sudo journalctl -u file-processor.service --since "1 hour ago" | grep -c "Started File"

# 期待値: 1（または0）
# 以前: 120（30秒ごと再起動）
```

---

## 🆘 トラブルシューティング

### 問題: ヘルスチェックが失敗する

**症状:**
```
❌ HEALTH CHECK FAILED - Critical issues detected
```

**解決:**
```bash
# 詳細ログを確認
sudo python3.11 /home/ec2-user/python-worker/health_check.py

# エラーを修正（例: 環境変数がない場合）
sudo nano /home/ec2-user/python-worker/.env

# 再度ヘルスチェック
sudo python3.11 /home/ec2-user/python-worker/health_check.py
```

---

### 問題: Workerが起動しない

**症状:**
```
● file-processor.service - failed
```

**解決:**
```bash
# エラーログ確認
sudo journalctl -u file-processor.service -n 50

# よくあるエラーと対処:
# - "ModuleNotFoundError: No module named 'boto3'"
#   → sudo python3.11 -m pip install -r requirements.txt

# - "SQS_QUEUE_URL is required"
#   → /home/ec2-user/python-worker/.env を確認

# - "Permission denied"
#   → sudo chown -R ec2-user:ec2-user /home/ec2-user/python-worker

# 修正後、再起動
sudo systemctl reset-failed file-processor.service
sudo systemctl start file-processor.service
```

---

### 問題: 処理速度が上がらない

**症状:**
- SQSメッセージ数が減らない

**解決:**
```bash
# 1. Workerが実際に動いているか確認
top -p $(pgrep -f worker.py)
# CPU使用率が0%なら問題あり

# 2. SQS設定確認
aws sqs get-queue-attributes \
    --queue-url $(grep SQS_QUEUE_URL /home/ec2-user/python-worker/.env | cut -d'=' -f2) \
    --attribute-names VisibilityTimeout

# 3. 並列処理数を増やす（.env編集）
sudo nano /home/ec2-user/python-worker/.env
# SQS_MAX_MESSAGES=10 → 20 に変更

# 4. Workerサービス再起動
sudo systemctl restart file-processor.service
```

---

## 🔄 ロールバック（緊急時）

```bash
# 1. 旧サービスファイルを復元
sudo cp /etc/systemd/system/file-processor.service.backup.* \
        /etc/systemd/system/file-processor.service

# 2. Systemd再読み込み
sudo systemctl daemon-reload

# 3. Workerサービス再起動
sudo systemctl restart file-processor.service

# 4. 補助サービス停止
sudo systemctl stop auto-recovery.service
sudo systemctl stop spot-interruption-handler.service
```

---

## 📊 期待される改善

| 指標 | Before | After | 改善 |
|------|--------|-------|------|
| 処理速度 | 122 msg/分 | 500+ msg/分 | **4.1倍** |
| 再起動頻度 | 120回/時間 | 0回/時間 | **-100%** |
| DLQ増加 | +100 msg/時 | 0 msg/時 | **-100%** |
| アップタイム | 50% | 99.9% | **+49.9%** |

---

## 📞 サポート

**問題が解決しない場合:**

1. **ログ収集**
   ```bash
   sudo journalctl -u file-processor.service --since "1 hour ago" > /tmp/worker-logs.txt
   ```

2. **環境情報収集**
   ```bash
   python3.11 --version > /tmp/environment.txt
   pip3.11 list >> /tmp/environment.txt
   cat /home/ec2-user/python-worker/.env >> /tmp/environment.txt
   ```

3. **詳細ガイド参照**
   ```bash
   cat /home/ec2-user/python-worker/ARCHITECTURE_RESILIENCE_GUIDE.md
   ```

---

**デプロイ完了！ 24時間後に最終確認してください。**

🎉 お疲れ様でした！
