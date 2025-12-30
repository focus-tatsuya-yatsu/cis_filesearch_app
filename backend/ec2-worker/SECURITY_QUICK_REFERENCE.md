# 🚨 CIS File Search - セキュリティ クイックリファレンス

**緊急時の対応手順**

---

## 🔥 緊急対応（今すぐ実行）

### 1. サービスを安全な設定で再起動

```bash
# 現在のサービスを停止
sudo systemctl stop cis-worker.service

# セキュアな設定ファイルをコピー
sudo cp /opt/cis-file-processor/deploy/cis-worker.service /etc/systemd/system/

# systemdをリロード
sudo systemctl daemon-reload

# サービスを起動
sudo systemctl start cis-worker.service

# ステータス確認
sudo systemctl status cis-worker.service
```

### 2. 再起動原因を特定

```bash
# 最近のログを確認（エラーを探す）
sudo journalctl -u cis-worker.service --since "10 minutes ago" | grep -E "ERROR|CRITICAL|Exception"

# メモリ使用状況を確認
free -h
ps aux | grep python | grep cis

# AWS接続をテスト
cd /opt/cis-file-processor
source venv/bin/activate
python verify_aws_config.py
```

### 3. DLQを分析

```bash
# DLQ URLを取得
DLQ_URL=$(aws sqs get-queue-url --queue-name cis-filesearch-index-queue-dlq --query 'QueueUrl' --output text)

# DLQを分析（最初の100メッセージ）
python /opt/cis-file-processor/scripts/analyze_dlq.py $DLQ_URL 100
```

---

## 📋 日次チェックリスト

### 毎朝確認すること

```bash
# 1. サービスステータス
sudo systemctl status cis-worker.service

# 2. 再起動回数（0であるべき）
sudo systemctl show cis-worker.service | grep NRestarts

# 3. DLQメッセージ数（100未満であるべき）
aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name cis-filesearch-index-queue-dlq --query 'QueueUrl' --output text) \
  --attribute-names ApproximateNumberOfMessages \
  --query 'Attributes.ApproximateNumberOfMessages'

# 4. メモリ使用率（80%未満であるべき）
free -h

# 5. ディスク使用率（80%未満であるべき）
df -h /
```

---

## 🔧 トラブルシューティング

### 問題: サービスが起動しない

```bash
# Step 1: エラーログを確認
sudo journalctl -u cis-worker.service -n 100 --no-pager

# Step 2: 権限を確認
sudo ls -la /opt/cis-file-processor/
sudo ls -la /var/log/cis-worker/

# Step 3: ユーザーが存在するか確認
id cis-worker

# Step 4: 手動でテスト実行
sudo -u cis-worker /opt/cis-file-processor/venv/bin/python /opt/cis-file-processor/src/main.py
```

**解決策:**
```bash
# ユーザーが存在しない場合
sudo useradd -m -s /bin/bash cis-worker

# 権限を修正
sudo chown -R cis-worker:cis-worker /opt/cis-file-processor
sudo chown -R cis-worker:cis-worker /var/log/cis-worker
```

---

### 問題: 10秒ごとに再起動

**原因を特定:**
```bash
# エラーメッセージを確認
sudo journalctl -u cis-worker.service --since "1 hour ago" | grep -E "ERROR|Exception|Traceback" | tail -20

# 一般的な原因:
# 1. OpenSearch接続エラー
# 2. SQS認証エラー
# 3. メモリ不足
# 4. Python依存関係エラー
```

**解決策:**

#### A. OpenSearch接続エラー
```bash
# 接続テスト
curl -XGET https://<opensearch-endpoint>/_cluster/health

# VPC Endpoint確認
aws ec2 describe-vpc-endpoints --filters "Name=service-name,Values=com.amazonaws.ap-northeast-1.es"
```

#### B. SQS認証エラー
```bash
# IAMロール確認
curl http://169.254.169.254/latest/meta-data/iam/security-credentials/

# キューにアクセステスト
aws sqs receive-message --queue-url <QUEUE_URL> --max-number-of-messages 1
```

#### C. メモリ不足
```bash
# メモリ使用状況確認
free -h

# systemdのメモリ制限を増加
sudo sed -i 's/MemoryMax=2G/MemoryMax=4G/' /etc/systemd/system/cis-worker.service
sudo systemctl daemon-reload
sudo systemctl restart cis-worker.service
```

#### D. Python依存関係エラー
```bash
cd /opt/cis-file-processor
source venv/bin/activate
pip install -r requirements.txt --force-reinstall
```

---

### 問題: DLQメッセージが蓄積

```bash
# Step 1: DLQを分析
python scripts/analyze_dlq.py <DLQ_URL> 100

# Step 2: 共通エラーパターンを確認
# - 大容量PDF（>50MB）が多い → OCRタイムアウトを延長
# - OpenSearch接続エラー → VPC Endpoint確認
# - メモリエラー → メモリ制限を増加

# Step 3: SQS Visibility Timeoutを延長
aws sqs set-queue-attributes \
  --queue-url <QUEUE_URL> \
  --attributes VisibilityTimeout=600

# Step 4: DLQメッセージを再処理（慎重に！）
# まず10メッセージでテスト
python scripts/redrive_dlq.py <DLQ_URL> <MAIN_QUEUE_URL> --max-messages 10
```

---

## 🔒 セキュリティ確認

### AWS認証情報が漏れていないか確認

```bash
# 1. 環境変数に認証情報がないことを確認
env | grep AWS_ACCESS_KEY_ID  # 何も出力されないこと

# 2. .envファイルに認証情報がないことを確認
grep -E "AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY" /opt/cis-file-processor/.env

# 3. ログに認証情報が記録されていないことを確認
sudo grep -r "AKIA" /var/log/cis-worker/  # 何も出力されないこと
```

### ログに機密情報が含まれていないか確認

```bash
# パターン検索
sudo grep -r -E "(password|passwd|secret)" /var/log/cis-worker/ | grep -v "***"
```

---

## 📊 モニタリング

### CloudWatchメトリクスを確認

```bash
# ワーカーの処理数
aws cloudwatch get-metric-statistics \
  --namespace CIS/FileProcessor \
  --metric-name FileProcessed \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum

# エラー数
aws cloudwatch get-metric-statistics \
  --namespace CIS/FileProcessor \
  --metric-name ProcessingErrors \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

---

## 🛠️ 定期メンテナンス（週次）

```bash
#!/bin/bash
# weekly_maintenance.sh

echo "=== CIS Worker Weekly Maintenance ==="

# 1. セキュリティスキャン
cd /opt/cis-file-processor
source venv/bin/activate
pip-audit --format json --output /var/log/cis-worker/vulnerabilities_$(date +%Y%m%d).json

# 2. ログローテーション確認
sudo logrotate -d /etc/logrotate.d/cis-worker

# 3. ディスク使用量確認
df -h / | grep -E "Use%|/$"

# 4. DLQ確認
DLQ_URL=$(aws sqs get-queue-url --queue-name cis-filesearch-index-queue-dlq --query 'QueueUrl' --output text)
DLQ_COUNT=$(aws sqs get-queue-attributes --queue-url $DLQ_URL --attribute-names ApproximateNumberOfMessages --query 'Attributes.ApproximateNumberOfMessages' --output text)
echo "DLQ Messages: $DLQ_COUNT"

# 5. サービス再起動回数確認
RESTART_COUNT=$(sudo systemctl show cis-worker.service | grep NRestarts | cut -d'=' -f2)
echo "Service Restarts: $RESTART_COUNT"

# 6. メモリ使用量確認
free -h

echo "=== Maintenance Complete ==="
```

---

## 📞 エスカレーション

### いつエスカレートすべきか

| 症状 | しきい値 | エスカレート先 |
|------|---------|--------------|
| サービス再起動 | > 5回/時間 | インフラチーム |
| DLQメッセージ | > 1000件 | 開発チーム |
| OpenSearch接続エラー率 | > 10% | データベースチーム |
| メモリ使用率 | > 90% | インフラチーム |
| AWS認証エラー | 1回でも | セキュリティチーム |
| ログに機密情報 | 1回でも | セキュリティチーム |

### 連絡先
- **緊急:** security@your-company.com
- **Slack:** #cis-file-search-support
- **オンコール:** +81-XX-XXXX-XXXX

---

## 🔐 セキュリティベストプラクティス

### ✅ すべきこと

1. **IAMロールを使用**
   - EC2インスタンスにIAMロールをアタッチ
   - AWS認証情報を環境変数に設定しない

2. **最小権限原則**
   - 必要最小限のIAM権限のみ付与
   - VPC Endpointを使用

3. **ログのサニタイズ**
   - 機密情報をログに出力しない
   - ログフィルタを使用

4. **定期的なスキャン**
   - 週次でpip-audit実行
   - 脆弱性を即座に修正

### ❌ してはいけないこと

1. **Root権限での実行**
   - systemdサービスをrootで実行しない

2. **認証情報のハードコード**
   - .envファイルにAWS認証情報を記載しない
   - コードに認証情報を埋め込まない

3. **セキュリティグループの開放**
   - 0.0.0.0/0へのegress許可（VPC Endpoint使用）

4. **ログの無制限保持**
   - ログローテーションを設定
   - 古いログを自動削除

---

## 📚 関連ドキュメント

- **詳細セキュリティレポート:** `SECURITY_AUDIT_REPORT.md`
- **セキュリティ監査スクリプト:** `scripts/security_audit.sh`
- **DLQ分析スクリプト:** `scripts/analyze_dlq.py`
- **冪等性管理:** `src/idempotency.py`
- **ログフィルタ:** `src/log_filter.py`

---

**最終更新:** 2025-12-15
**メンテナ:** Security Team
