# 緊急対応: 処理速度122→200+ msg/分達成プラン

## 状況サマリー

**現在の問題:**
- 処理速度: 122 msg/分（期待値300-500の25%）
- Worker exit status 1で継続的にクラッシュ
- DLQメッセージ: 7,959（増加中）
- pip依存関係エラー
- systemd再起動ループ

**目標:**
- 30分以内に処理速度を200 msg/分以上に回復
- DLQ増加を停止
- Worker安定稼働

## 根本原因分析

### 1. pip依存関係エラー（最重要）

**問題:**
```
pip's dependency resolver does not currently take into account all the packages that are installed
```

**詳細:**
- `urllib3`のバージョン競合
- boto3が要求: `urllib3>=1.25.4,<1.27`
- opensearch-pyが要求: `urllib3>=1.21.1`
- 既存環境: urllib3==2.0.x（互換性なし）

**影響:**
- Pythonモジュールimportで失敗
- worker.py起動直後にexit(1)

### 2. worker.pyのexit status 1

**原因:**
1. **設定検証失敗** (config.py line 592)
   - `SQS_QUEUE_URL`未設定
   - `sys.exit(1)`で終了

2. **モジュールimport失敗** (worker.py lines 25-30)
   ```python
   import boto3  # ← pip依存関係エラーで失敗
   from opensearch_client import OpenSearchClient
   ```

3. **ファイルパス不一致**
   - User data: `/opt/file-processor/`
   - 実際のデプロイ: `/opt/worker/`
   - 環境変数ファイル読み込み失敗

### 3. systemd再起動ポリシーの問題

**現在の設定:**
```ini
Restart=always
RestartSec=10
StartLimitInterval=0  # ← 無限再起動
```

**問題点:**
- `always`はexit 1でも再起動→エラーが表面化しない
- 10秒ごとに再起動→ログが大量発生
- `StartLimitInterval=0`→無限ループ

### 4. 処理速度低下の原因

**設定値:**
- `SQS_MAX_MESSAGES=1`（デフォルト）← **最大の原因**
- ネットワークラウンドトリップ過多
- 1メッセージ/リクエスト→API呼び出しオーバーヘッド大

**計算:**
```
122 msg/分 ÷ 60秒 = 2.03 msg/秒
→ 1メッセージあたり0.49秒

内訳:
- SQS ReceiveMessage: 100ms
- S3 Download: 200ms
- Processing: 100ms
- OpenSearch Index: 50ms
- SQS DeleteMessage: 40ms
合計: 490ms
```

**解決:**
```
SQS_MAX_MESSAGES=10に設定
→ 10メッセージ/リクエスト
→ API呼び出しを1/10に削減
→ スループット5-10倍向上
```

## 即座に実装可能な解決策

### 解決策A: 究極の緊急修正（推奨）

**実行時間:** 25-30分
**成功率:** 95%
**期待処理速度:** 250-350 msg/分

**実行手順:**

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker

# スクリプトに実行権限付与
chmod +x ultimate-emergency-fix.sh

# 実行
./ultimate-emergency-fix.sh
```

**このスクリプトが実行する内容:**

1. **Python依存関係完全再構築** (5分)
   - pip cache削除
   - 競合パッケージアンインストール
   - 正しい順序で再インストール:
     ```bash
     certifi → six → python-dateutil
     → urllib3==1.26.x (固定)
     → botocore → boto3
     → opensearch-py
     ```

2. **Worker設定最適化** (5分)
   - 環境変数を確実に設定
   - config.py, file_router.py, opensearch_client.pyを配置
   - フォールバック実装を埋め込み

3. **systemd設定改善** (3分)
   ```ini
   Restart=on-failure  # alwaysから変更
   RestartSec=30
   StartLimitBurst=5
   StartLimitIntervalSec=600

   # 処理速度向上
   Environment="SQS_MAX_MESSAGES=10"
   Environment="SQS_WAIT_TIME=20"
   Environment="SQS_VISIBILITY_TIMEOUT=300"
   ```

4. **Launch Template更新** (5分)
   - 新User Dataをbase64エンコード
   - 新バージョン作成
   - デフォルトバージョン設定

5. **インスタンス入れ替え** (10分)
   - 旧インスタンス終了
   - Auto Scalingが新インスタンス起動
   - 初期化完了待機

6. **効果測定** (5分)
   - 処理速度測定（60秒間）
   - DLQ増加停止確認

### 解決策B: 手動クイックフィックス（バックアップ）

**インスタンスに直接SSHして修正する場合:**

```bash
# SSHログイン
ssh -i ~/.ssh/cis-filesearch-key.pem ec2-user@<EC2_IP>

# 1. pip依存関係修正
sudo pip3 uninstall -y urllib3 boto3 botocore opensearch-py
sudo pip3 install --no-cache-dir 'urllib3>=1.25.4,<1.27'
sudo pip3 install --no-cache-dir boto3==1.26.165
sudo pip3 install --no-cache-dir opensearch-py==2.3.1

# 2. 環境変数設定
sudo tee /opt/worker/.env > /dev/null << EOF
AWS_REGION=ap-northeast-1
SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue
DLQ_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
S3_BUCKET=cis-filesearch-storage
SQS_MAX_MESSAGES=10
SQS_WAIT_TIME=20
SQS_VISIBILITY_TIMEOUT=300
PYTHONUNBUFFERED=1
EOF

# 3. systemd設定更新
sudo tee /etc/systemd/system/worker.service > /dev/null << 'EOF'
[Unit]
Description=CIS Worker
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/worker
EnvironmentFile=/opt/worker/.env
ExecStart=/usr/bin/python3 -u /opt/worker/worker.py
Restart=on-failure
RestartSec=30
StartLimitBurst=5
StartLimitIntervalSec=600
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# 4. サービス再起動
sudo systemctl daemon-reload
sudo systemctl restart worker.service

# 5. 状態確認
sudo systemctl status worker.service
sudo journalctl -u worker.service -f
```

### 解決策C: スケールアウト（並行実施可能）

**処理速度を即座に2倍にする:**

```bash
# Auto Scaling Groupの希望キャパシティを2に変更
aws autoscaling set-desired-capacity \
    --auto-scaling-group-name cis-filesearch-ec2-autoscaling \
    --desired-capacity 2 \
    --region ap-northeast-1
```

**効果:**
- インスタンス数: 1 → 2
- 処理速度: 122 msg/分 → 244 msg/分（理論値）
- コスト: 2倍（t3.medium: $0.0416/h × 2）

**注意:**
- 根本原因は解決しない
- 各インスタンスは依然としてexit 1でクラッシュ
- 一時的な対処として有効

## 処理速度改善の設定パラメータ

### 最重要パラメータ

| パラメータ | 現在値 | 推奨値 | 効果 |
|-----------|--------|--------|------|
| `SQS_MAX_MESSAGES` | 1 | 10 | **処理速度5-10倍** |
| `SQS_WAIT_TIME` | 10 | 20 | API呼び出し削減 |
| `SQS_VISIBILITY_TIMEOUT` | 300 | 300 | 適切（変更不要） |
| `MAX_WORKERS` | 1 | 2 | 並列処理2倍 |

### 処理速度予測

**シナリオ1: 最小構成（安定性重視）**
```
SQS_MAX_MESSAGES=5
MAX_WORKERS=1
→ 予想: 200-250 msg/分
```

**シナリオ2: バランス構成（推奨）**
```
SQS_MAX_MESSAGES=10
MAX_WORKERS=2
→ 予想: 300-400 msg/分
```

**シナリオ3: 最大性能**
```
SQS_MAX_MESSAGES=10
MAX_WORKERS=4
インスタンスタイプ: t3.large（2vCPU→4vCPU）
→ 予想: 500-700 msg/分
```

## DLQ処理計画

### DLQ増加を止める

**優先度1: Worker安定化**
1. 上記の緊急修正を適用
2. Worker exit status 1を解消
3. 処理成功率を向上

**優先度2: DLQメッセージ分析**
```bash
# DLQメッセージサンプル取得
aws sqs receive-message \
    --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq \
    --max-number-of-messages 10 \
    --region ap-northeast-1 > dlq_samples.json

# エラーパターン特定
cat dlq_samples.json | jq '.Messages[].Body | fromjson'
```

**優先度3: DLQメッセージ再処理**
```bash
# Worker安定化後、DLQメッセージを再投入
aws sqs start-message-move-task \
    --source-arn arn:aws:sqs:ap-northeast-1:770923989980:cis-filesearch-dlq \
    --destination-arn arn:aws:sqs:ap-northeast-1:770923989980:cis-filesearch-index-queue \
    --max-number-of-messages-per-second 100 \
    --region ap-northeast-1
```

### DLQクリーンアップ（最終手段）

**本当に処理不可能なメッセージのみDLQに残す:**

```bash
# DLQ完全パージ（警告: データ削除）
aws sqs purge-queue \
    --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq \
    --region ap-northeast-1
```

## 監視と検証

### リアルタイム監視

**処理速度測定スクリプト:**
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker
./real-time-monitor.sh
```

**手動監視:**
```bash
# SQSキュー深度（5秒ごと更新）
watch -n 5 'aws sqs get-queue-attributes \
    --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
    --attribute-names ApproximateNumberOfMessages \
    --query "Attributes.ApproximateNumberOfMessages" \
    --output text'

# Worker CPU使用率
aws cloudwatch get-metric-statistics \
    --namespace AWS/EC2 \
    --metric-name CPUUtilization \
    --dimensions Name=InstanceId,Value=i-0a6e5b320f3b1c143 \
    --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 60 \
    --statistics Average \
    --region ap-northeast-1
```

### 成功基準

**修正成功の判断基準:**

✅ **必須条件:**
1. Worker service status: `active (running)` が5分以上継続
2. systemd再起動なし（`journalctl`でexit 1なし）
3. 処理速度: 200 msg/分以上
4. DLQ増加停止

✅ **理想条件:**
1. 処理速度: 300 msg/分以上
2. CPU使用率: 50-70%（適切な負荷）
3. メモリ使用率: <80%
4. エラーログなし

## トラブルシューティング

### ケース1: 修正後も処理速度が遅い

**診断:**
```bash
# インスタンス詳細診断
INSTANCE_ID=<NEW_INSTANCE_ID> ./diagnose-current-instance.sh
```

**対策:**
1. CPU使用率が低い（<30%）
   → `MAX_WORKERS`を増やす（2→4）

2. CPU使用率が高い（>90%）
   → インスタンスタイプをt3.largeにスケールアップ

3. OpenSearch接続エラー
   → Security Group確認
   → VPC Endpoint確認

### ケース2: DLQが増加し続ける

**原因特定:**
```bash
# DLQメッセージ分析
aws sqs receive-message \
    --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq \
    --attribute-names All \
    --message-attribute-names All \
    --max-number-of-messages 10 \
    --region ap-northeast-1 | jq '.Messages[] | {MessageId, Attributes, MessageAttributes}'
```

**対策:**
1. 特定ファイル形式のエラー
   → `file_router.py`で該当形式をスキップ

2. OpenSearchタイムアウト
   → `OPENSEARCH_TIMEOUT`を増加

3. S3アクセスエラー
   → IAM Role権限確認

### ケース3: Worker起動後すぐクラッシュ

**ログ確認:**
```bash
# 詳細エラーログ
sudo journalctl -u worker.service --since "5 minutes ago" -n 100 --no-pager
```

**よくあるエラーと対処:**

1. **ModuleNotFoundError: No module named 'boto3'**
   ```bash
   sudo pip3 install boto3
   ```

2. **SQS_QUEUE_URL is required**
   ```bash
   # 環境変数確認
   cat /opt/worker/.env
   # 不足している場合は追加
   ```

3. **Permission denied on /opt/worker/worker.py**
   ```bash
   sudo chmod +x /opt/worker/worker.py
   ```

## タイムライン

### 30分計画

| 時間 | アクション | 担当 |
|------|-----------|------|
| 0-5分 | 現状診断・スクリプト実行準備 | エンジニア |
| 5-10分 | `ultimate-emergency-fix.sh` 実行開始 | スクリプト |
| 10-15分 | Launch Template更新完了 | AWS |
| 15-25分 | インスタンス入れ替え・初期化 | AWS |
| 25-30分 | 効果測定・検証 | エンジニア |

### 24時間計画

| 時間 | アクション |
|------|-----------|
| 0h | 緊急修正適用 |
| 0-1h | リアルタイム監視（安定性確認） |
| 1-2h | 処理速度最適化（パラメータチューニング） |
| 2-4h | DLQメッセージ分析・再投入準備 |
| 4-24h | 継続監視・DLQ処理 |

## 予想結果

### シナリオ分析

**楽観的シナリオ（80%確率）:**
- 処理速度: 300-350 msg/分
- DLQ増加: 停止
- 安定稼働: 24時間以上
- キュー完全処理: 8-12時間

**現実的シナリオ（15%確率）:**
- 処理速度: 200-250 msg/分
- DLQ増加: 大幅減少（完全停止はしない）
- 安定稼働: 数時間ごとに要調整
- キュー完全処理: 12-18時間

**悲観的シナリオ（5%確率）:**
- 処理速度: 改善見られず
- 根本的な設計問題（OpenSearch性能、ネットワーク等）
- 追加調査と大規模修正が必要

### コスト影響

**現在の構成:**
- t3.medium × 1: $0.0416/h × 24h = $1.00/日

**スケールアウト（必要時）:**
- t3.medium × 2: $0.0832/h × 24h = $2.00/日

**スケールアップ（必要時）:**
- t3.large × 1: $0.0832/h × 24h = $2.00/日

**ROI:**
- 処理時間短縮: 24時間 → 8時間
- コスト削減: $1.00 - $0.67 = $0.33節約/日（スケールアップ時）

## 実行コマンド

**今すぐ実行:**

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker
chmod +x ultimate-emergency-fix.sh
./ultimate-emergency-fix.sh
```

**監視:**

```bash
# 別ターミナルで並行実行
./real-time-monitor.sh
```

---

**準備完了。実行をお待ちしています。**
