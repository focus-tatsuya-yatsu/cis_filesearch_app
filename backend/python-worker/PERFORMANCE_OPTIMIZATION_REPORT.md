# SQS Worker パフォーマンス最適化レポート

## 1. 現状分析

### 現在のパフォーマンス指標
- **処理速度**: 60メッセージ/分（1メッセージ/秒）
- **予想処理時間**: 259,399メッセージで約72時間
- **問題点**:
  - Worker が10秒ごとに再起動し、30%の効率低下
  - DLQに7,464メッセージ蓄積
  - t3.medium（2vCPU、4GBメモリ）リソースの非効率的使用

### ボトルネック分析

#### 1.1 再起動によるオーバーヘッド（最大の問題）
- **Python起動時間**: 各再起動で2-3秒のオーバーヘッド
- **ライブラリインポート**: boto3、opensearch-py、OCRライブラリの読み込み
- **AWS接続初期化**: S3、SQS、OpenSearchクライアントの再接続

#### 1.2 シングルメッセージ処理
- `sqs_max_messages: 1` で1メッセージずつ処理
- SQS API コールのオーバーヘッドが大きい

#### 1.3 メモリ管理の非効率
- ガベージコレクションが不定期
- 一時ファイルのクリーンアップが遅延

## 2. 最適化戦略（優先順位順）

---

## 🚀 Phase 1: 即効性のある短期改善（即座に実装可能）

### 2.1 SQS バッチサイズの最適化 ⭐⭐⭐⭐⭐

**期待効果**: 処理速度 3-5倍改善（60 → 180-300 msg/min）

**実装**:
```python
# config.py の修正
sqs_max_messages: int = int(os.environ.get('SQS_MAX_MESSAGES', '10'))  # 1 → 10
sqs_wait_time_seconds: int = int(os.environ.get('SQS_WAIT_TIME', '20'))  # 維持
```

**理由**:
- SQS は最大10メッセージを1回のAPIコールで取得可能
- APIコールのオーバーヘッドを90%削減
- ネットワークレイテンシの削減

**環境変数設定**:
```bash
export SQS_MAX_MESSAGES=10
```

---

### 2.2 Long Polling の最適化 ⭐⭐⭐⭐

**期待効果**: 空ポーリングの削減、コスト削減

**現在の設定は最適**:
```python
sqs_wait_time_seconds: int = 20  # ✅ すでに最適値
```

**追加の最適化**:
- Visibility Timeout を処理時間に合わせて調整

```python
# 現在: 300秒（5分）
# 推奨: 900秒（15分）- より長めに設定してリトライを防ぐ
sqs_visibility_timeout: int = int(os.environ.get('SQS_VISIBILITY_TIMEOUT', '900'))
```

---

### 2.3 worker_optimized.py の使用 ⭐⭐⭐⭐⭐

**期待効果**: 処理速度 5-8倍改善（60 → 300-500 msg/min）

`worker_optimized.py` はすでに実装されており、以下の最適化を含んでいます:

- **マルチプロセッシング**: CPU コア数-1 のワーカープロセス
- **バッチ処理**: 10メッセージを並列処理
- **リソース管理**: 自動メモリ監視とGC
- **バッチ削除**: 成功したメッセージを一括削除

**即座に実行可能**:
```bash
# 現在の worker.py から worker_optimized.py に切り替え
python /path/to/worker_optimized.py
```

**環境変数設定**:
```bash
export SQS_MAX_MESSAGES=10
export MAX_WORKERS=1  # t3.medium の場合は1（2vCPU - 1）
```

---

### 2.4 メモリ最適化の即時実装 ⭐⭐⭐⭐

**期待効果**: メモリ使用量30-40%削減

**実装**: `worker_optimized.py` にすでに含まれている機能

```python
# 自動ガベージコレクション（50ファイルごと）
if self.files_since_gc >= self.gc_interval:
    self._force_garbage_collection()
    self.files_since_gc = 0

# リソースヘルスチェック
if not self.resource_manager.check_memory_available(min_free_mb=500.0):
    self.logger.warning("Low memory - forcing GC")
    self._force_garbage_collection()
```

**追加設定**:
```bash
# 一時ファイルの自動クリーンアップ
export CLEANUP_TEMP_FILES=true

# 古い一時ファイルの削除（1時間以上前）
# worker_optimized.py で自動実行される
```

---

### 2.5 Boto3 接続プールの最適化 ⭐⭐⭐

**期待効果**: S3ダウンロード速度20-30%改善

**実装**:
```python
# worker_optimized.py にすでに実装済み
boto_config = BotoConfig(
    region_name=config.aws.region,
    retries={'max_attempts': 3, 'mode': 'adaptive'},
    max_pool_connections=50  # ← ここが重要！
)

self.sqs_client = boto3.client('sqs', config=boto_config)
```

**追加の最適化**:
```python
# process_single_message 関数内
# 50MB以上のファイルはマルチパートダウンロード
if file_size > 50 * 1024 * 1024:
    from boto3.s3.transfer import TransferConfig
    transfer_config = TransferConfig(
        multipart_threshold=50 * 1024 * 1024,
        max_concurrency=4,  # 並列ダウンロード
        multipart_chunksize=10 * 1024 * 1024,
        use_threads=True
    )
    s3_client.download_file(bucket, key, temp_file_path, Config=transfer_config)
```

---

## 📊 Phase 2: 中期改善（1-2日で実装可能）

### 2.6 Python 起動時間の最適化 ⭐⭐⭐⭐

**期待効果**: 再起動時のオーバーヘッド70%削減

#### オプション A: PyInstaller でバイナリ化

**利点**:
- 起動時間が3-5倍高速化
- ライブラリインポートの事前コンパイル

**実装**:
```bash
# PyInstaller のインストール
pip install pyinstaller

# バイナリのビルド
pyinstaller --onefile \
    --hidden-import=boto3 \
    --hidden-import=opensearchpy \
    --hidden-import=PIL \
    --hidden-import=pytesseract \
    worker_optimized.py

# 実行
./dist/worker_optimized
```

#### オプション B: systemd サービス化（再起動の排除）

**最も効果的！**

`/etc/systemd/system/file-worker.service`:
```ini
[Unit]
Description=File Processing Worker
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/home/ec2-user/python-worker
Environment="AWS_REGION=ap-northeast-1"
Environment="SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/.../file-processing-queue-production"
Environment="SQS_MAX_MESSAGES=10"
Environment="MAX_WORKERS=1"
Environment="CLEANUP_TEMP_FILES=true"
ExecStart=/usr/bin/python3 /home/ec2-user/python-worker/worker_optimized.py
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**起動**:
```bash
sudo systemctl daemon-reload
sudo systemctl enable file-worker
sudo systemctl start file-worker
sudo systemctl status file-worker

# ログの確認
sudo journalctl -u file-worker -f
```

**効果**:
- **再起動オーバーヘッドが完全に排除される**
- プロセスが異常終了した場合のみ再起動
- AWS接続が永続化される

---

### 2.7 DLQ メッセージの分析と再処理 ⭐⭐⭐

**現状**: 7,464メッセージがDLQに蓄積

**分析ツールの使用**:
```bash
python analyze_dlq_messages.py
```

**一般的なDLQ原因**:
1. **ファイルサイズ超過** → 設定を調整
2. **OCRタイムアウト** → タイムアウト値を増やす
3. **OpenSearch接続失敗** → リトライロジック追加
4. **サポート外のファイル形式** → 無視または別処理

**再処理スクリプト**:
```python
# services/dlq_service.py を使用
from services.dlq_service import DLQService

dlq_service = DLQService(config)

# DLQメッセージを分析
analysis = dlq_service.analyze_failed_messages(limit=100)

# 修正可能なメッセージを再処理
dlq_service.reprocess_messages(
    error_types=['Timeout', 'TemporaryError'],
    max_count=1000
)
```

---

### 2.8 OCR 処理の最適化 ⭐⭐⭐⭐

**期待効果**: OCR処理時間50-70%削減

**実装**:

#### PDF DPI の動的調整
```python
# config.py
pdf_dpi: int = int(os.environ.get('PDF_DPI', '200'))  # 300 → 200
```

**理由**:
- DPI 200 でも十分な精度（日本語）
- 処理時間が約50%削減
- メモリ使用量も削減

#### ページ数制限
```python
# config.py
max_pdf_pages: int = int(os.environ.get('MAX_PDF_PAGES', '100'))  # 1000 → 100
```

**理由**:
- 100ページ以上のPDFは稀
- 処理時間の予測可能性向上

#### 並列OCR処理（PDF の複数ページ）
```python
# processors/pdf_processor_optimized.py を使用
from processors.pdf_processor_optimized import OptimizedPDFProcessor

# すでに実装済み - マルチスレッドOCR
```

---

## 🏗️ Phase 3: 長期改善（インフラ変更を含む）

### 2.9 インスタンスタイプの最適化 ⭐⭐⭐⭐⭐

**現在**: t3.medium（2vCPU、4GB RAM）

#### オプション A: c6i.large に変更

**スペック**:
- 2vCPU（コンピュート最適化）
- 4GB RAM
- ネットワーク: 最大12.5 Gbps
- コスト: t3.medium とほぼ同じ

**期待効果**:
- CPU性能が約30-40%向上
- OCR処理が高速化

#### オプション B: t3.large に変更

**スペック**:
- 2vCPU
- 8GB RAM
- コスト: 約2倍

**期待効果**:
- メモリ余裕が増え、バッチサイズを増やせる
- 大きなPDFファイルの処理が安定

#### オプション C: Auto Scaling Group で複数インスタンス

**最も効果的！**

**構成**:
```
- t3.medium × 3台（ピーク時）
- t3.medium × 1台（通常時）
- Auto Scaling ポリシー: SQS ApproximateNumberOfMessages > 10,000
```

**期待効果**:
- 処理速度が3倍（3台の場合）
- コストは処理量に応じて変動
- 72時間 → 24時間に短縮

**実装**:
```bash
# Terraform または CloudFormation で定義
# Auto Scaling Group
# - MinSize: 1
# - MaxSize: 5
# - DesiredCapacity: 1
# - Scaling Policy: Target Tracking (SQS queue depth)
```

---

### 2.10 SQS FIFO キューへの移行検討 ⭐⭐

**現在**: Standard Queue（順序保証なし）

**FIFO Queue の利点**:
- 順序保証
- 重複排除（Exactly-Once処理）
- メッセージグループIDで並列処理可能

**欠点**:
- スループット制限: 300 msg/秒（バッチあり）、3,000 msg/秒（MessageGroupID あり）
- コストがやや高い

**推奨**: 現在の Standard Queue を維持
- 処理速度: 500 msg/min = 8.3 msg/秒で十分
- 順序は不要

---

## 📈 最適化後の予測パフォーマンス

### シナリオ 1: 最小限の変更（Phase 1 のみ）

**変更内容**:
- worker_optimized.py に切り替え
- SQS_MAX_MESSAGES=10
- systemd サービス化

**予測パフォーマンス**:
- 処理速度: 300-400 msg/min（5-6倍改善）
- 処理時間: 259,399メッセージで **10-14時間**
- メモリ使用量: 2-3GB（現状維持）

**実装時間**: 1時間
**コスト**: 変更なし

---

### シナリオ 2: 中期最適化を含む（Phase 1 + Phase 2）

**変更内容**:
- シナリオ1 + OCR最適化
- DPI 200、ページ制限100
- DLQ メッセージ再処理

**予測パフォーマンス**:
- 処理速度: 400-500 msg/min（6-8倍改善）
- 処理時間: 259,399メッセージで **8-11時間**
- メモリ使用量: 2-2.5GB

**実装時間**: 1-2日
**コスト**: 変更なし

---

### シナリオ 3: フル最適化（Phase 1 + Phase 2 + Phase 3）

**変更内容**:
- シナリオ2 + Auto Scaling（3台）
- または c6i.large × 1台

**予測パフォーマンス（Auto Scaling）**:
- 処理速度: 1,200-1,500 msg/min（20-25倍改善）
- 処理時間: 259,399メッセージで **3-4時間**
- メモリ使用量: 2-3GB × 3台

**実装時間**: 2-3日
**コスト**: 約3倍（処理中のみ）

---

## 🎯 推奨実装順序

### ステップ 1: 即座に実施（30分以内）

```bash
# 1. 環境変数の設定
export SQS_MAX_MESSAGES=10
export SQS_VISIBILITY_TIMEOUT=900
export MAX_WORKERS=1
export CLEANUP_TEMP_FILES=true

# 2. worker_optimized.py に切り替え
# 現在のworkerを停止
pkill -f worker.py

# 最適化版を起動
python /home/ec2-user/python-worker/worker_optimized.py
```

**期待効果**: 処理速度が即座に3-5倍向上

---

### ステップ 2: 当日中に実施（2時間以内）

```bash
# 1. systemd サービスの作成
sudo nano /etc/systemd/system/file-worker.service
# （上記の設定をコピー）

# 2. サービスの起動
sudo systemctl daemon-reload
sudo systemctl enable file-worker
sudo systemctl start file-worker

# 3. 動作確認
sudo systemctl status file-worker
sudo journalctl -u file-worker -f
```

**期待効果**: 再起動オーバーヘッドが完全に排除

---

### ステップ 3: 翌日以降に実施

1. **DLQ分析と再処理**（2-3時間）
2. **OCR最適化**（環境変数変更のみ、10分）
3. **パフォーマンス測定とチューニング**（1日）

---

## 📊 監視とメトリクス

### CloudWatch メトリクス

**追加すべきメトリクス**:
```python
# worker_optimized.py にすでに実装されている
# services/resource_manager.py の get_metrics_for_cloudwatch() を使用

cloudwatch = boto3.client('cloudwatch')
metrics = resource_manager.get_metrics_for_cloudwatch()

cloudwatch.put_metric_data(
    Namespace='CISFileSearch/Worker',
    MetricData=metrics
)
```

**重要なメトリクス**:
- `ProcessedMessages` - 処理メッセージ数
- `SuccessRate` - 成功率
- `MessageProcessingTime` - 平均処理時間
- `MemoryUtilization` - メモリ使用率
- `CPUUtilization` - CPU使用率

### CloudWatch Alarms

**設定すべきアラーム**:
```python
# 1. メモリ使用率が80%超過
# 2. 成功率が90%未満
# 3. DLQメッセージ数が1,000件超過
# 4. 処理速度が100 msg/min 未満
```

---

## 🔧 トラブルシューティング

### 問題1: メモリ不足エラー

**症状**: OOMKiller がプロセスを終了

**解決策**:
```python
# config.py
max_pdf_pages: int = 50  # さらに削減
pdf_dpi: int = 150  # DPI を下げる

# GC頻度を増やす
gc_interval = 20  # 50 → 20
```

### 問題2: OpenSearch接続エラー

**症状**: `ConnectionTimeout` エラー

**解決策**:
```python
# opensearch_client.py でリトライロジック追加
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests.adapters import HTTPAdapter
from requests.packages.urllib3.util.retry import Retry

retry_strategy = Retry(
    total=3,
    backoff_factor=2,
    status_forcelist=[429, 500, 502, 503, 504]
)
```

### 問題3: SQS VisibilityTimeout 超過

**症状**: メッセージが重複処理される

**解決策**:
```bash
# VisibilityTimeout を延長
export SQS_VISIBILITY_TIMEOUT=1800  # 30分
```

---

## 💰 コスト影響分析

### 現在のコスト（概算）

- **EC2**: t3.medium × 1台 × 24h × 30日 = 約 $30/月
- **SQS**: 260,000メッセージ × 3回処理 = 約 $0.31
- **OpenSearch**: 使用量に依存

### 最適化後のコスト

#### シナリオ 1（変更なし）
- **EC2**: $30/月（同じ）
- **SQS**: $0.10（API コール削減）
- **合計**: 約$0.20/月 削減

#### シナリオ 3（Auto Scaling）
- **EC2**: $30/月 × 3台 × 4時間/月 = $15 増加
- **SQS**: $0.10
- **合計**: 処理時間が72時間→4時間に短縮されるため、**実質コスト削減**

---

## 📝 設定ファイルのまとめ

### 推奨環境変数

```bash
# SQS設定
export SQS_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/.../file-processing-queue-production"
export SQS_MAX_MESSAGES=10
export SQS_WAIT_TIME=20
export SQS_VISIBILITY_TIMEOUT=900

# 処理設定
export MAX_WORKERS=1
export PROCESSING_TIMEOUT=600
export OCR_TIMEOUT=300

# OCR設定
export PDF_DPI=200
export MAX_PDF_PAGES=100
export OCR_LANGUAGE=jpn+eng

# メモリ管理
export CLEANUP_TEMP_FILES=true
export TEMP_DIR=/tmp/file-processor

# ログ設定
export LOG_LEVEL=INFO
export USE_CLOUDWATCH=true
```

### systemd サービス設定

```ini
[Unit]
Description=File Processing Worker - Optimized
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/home/ec2-user/python-worker
EnvironmentFile=/home/ec2-user/python-worker/.env
ExecStart=/usr/bin/python3 /home/ec2-user/python-worker/worker_optimized.py
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

# リソース制限
MemoryMax=3.5G
CPUQuota=180%

[Install]
WantedBy=multi-user.target
```

---

## ✅ チェックリスト

### 即座に実施（Phase 1）
- [ ] `SQS_MAX_MESSAGES=10` に設定
- [ ] `worker_optimized.py` に切り替え
- [ ] systemd サービス化
- [ ] CloudWatch メトリクスの確認
- [ ] 処理速度の測定（目標: 300+ msg/min）

### 1-2日以内に実施（Phase 2）
- [ ] DLQ メッセージの分析
- [ ] OCR設定の最適化（DPI, ページ制限）
- [ ] パフォーマンステスト実施
- [ ] メモリ使用量の監視

### 1週間以内に検討（Phase 3）
- [ ] Auto Scaling Group の設計
- [ ] インスタンスタイプの変更検討
- [ ] コスト分析
- [ ] 本番適用計画

---

## 🎓 まとめ

### 最も重要な3つのアクション

1. **worker_optimized.py に即座に切り替え** ⭐⭐⭐⭐⭐
   - 実装時間: 5分
   - 効果: 3-5倍の速度向上

2. **systemd サービス化** ⭐⭐⭐⭐⭐
   - 実装時間: 30分
   - 効果: 再起動オーバーヘッド完全排除

3. **SQS_MAX_MESSAGES=10 に設定** ⭐⭐⭐⭐⭐
   - 実装時間: 1分
   - 効果: 即座に速度向上

### 期待される最終結果

- **処理速度**: 60 → 400-500 msg/min（6-8倍改善）
- **処理時間**: 72時間 → 8-11時間
- **メモリ使用量**: 現状維持または削減
- **コスト**: ほぼ変わらない、またはわずかに削減
- **安定性**: 大幅に向上（再起動なし、自動リソース管理）

---

## 📞 サポート

質問や問題がある場合:
1. CloudWatch Logs を確認
2. `sudo journalctl -u file-worker -f` でリアルタイムログ確認
3. メトリクスダッシュボードで処理状況監視
