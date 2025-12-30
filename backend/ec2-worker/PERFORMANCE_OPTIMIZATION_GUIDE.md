# SQS Worker パフォーマンス最適化ガイド

## 概要

このガイドでは、CIS File Processor WorkerのSQSメッセージ処理速度を242 msg/分から500-1000 msg/分に向上させる方法を説明します。

## 現在の状況

### 改善前（オリジナル版）
- **処理速度**: 60 msg/分
- **再起動間隔**: 10秒ごと
- **設定**: 基本的な設定のみ

### 改善後（中間版）
- **処理速度**: 242 msg/分（4倍改善）
- **再起動間隔**: 30秒ごと
- **改善内容**: バッチ処理、スレッド数調整

### 目標（最適化版）
- **処理速度**: 500-1000 msg/分（2-4倍改善）
- **再起動**: 5秒ごと（高速復帰）
- **改善内容**: 12の最適化戦略実装

---

## 最適化戦略の詳細

### 1. マルチスレッド処理の最適化

**問題点**:
- スレッド数が4では並列処理が不十分
- t3.medium（2vCPU、4GB RAM）のリソースを活用しきれていない

**解決策**:
```bash
# .env.optimized
WORKER_THREADS=10  # 4 → 10 に増加
WORKER_AUTO_SCALE=true  # 動的調整を有効化
```

**効果**: 並列処理能力が2.5倍に向上

**実装コード** (`config_optimized.py`):
```python
def get_optimal_thread_count(self) -> int:
    cpu_cores = cpu_count()
    cpu_based_threads = cpu_cores * 4  # I/O bound処理
    memory_based_threads = int(available_memory_mb / 300)
    optimal = min(cpu_based_threads, memory_based_threads, 20)
    return max(optimal, 1)
```

---

### 2. 並列SQS受信リクエスト

**問題点**:
- 1回のSQS呼び出しで最大10メッセージしか取得できない
- メッセージ取得待機時間が処理のボトルネック

**解決策**:
```bash
# .env.optimized
SQS_PARALLEL_FETCH=3  # 3つの受信リクエストを並列実行
```

**効果**: 1回のポーリングで最大30メッセージ取得可能（10 × 3）

**実装コード** (`sqs_handler_optimized.py`):
```python
def _receive_messages_parallel(self, num_batches: int = 3) -> List[List[Dict]]:
    futures = []
    for _ in range(num_batches):
        future = self.sqs_fetch_executor.submit(self._receive_messages)
        futures.append(future)

    message_batches = []
    for future in as_completed(futures):
        messages = future.result(timeout=25)
        if messages:
            message_batches.append(messages)

    return message_batches
```

---

### 3. 動的な待機時間制御

**問題点**:
- メッセージがある時も一定間隔で待機してしまう
- キューが空でも短時間で再試行してリソースを浪費

**解決策**:
```bash
# .env.optimized
WORKER_POLL_INTERVAL=1  # 基本待機時間を1秒に短縮
```

**効果**: メッセージがある限り待機なしで連続処理

**実装コード**:
```python
if total_messages > 0:
    # メッセージあり: 即座に次の処理へ
    continue
else:
    consecutive_empty_batches += 1
    if consecutive_empty_batches >= 3:
        # キューが空: 長めに待機
        wait_time = min(20, consecutive_empty_batches * 5)
        time.sleep(wait_time)
    else:
        # まだメッセージがある可能性: 短時間待機
        time.sleep(1)
```

---

### 4. VisibilityTimeout の最適化

**問題点**:
- 300秒は長すぎる（処理が早く終わる場合に無駄）
- 処理失敗時のリトライが遅れる

**解決策**:
```bash
# .env.optimized
SQS_VISIBILITY_TIMEOUT=120  # 300 → 120 に短縮
DYNAMIC_TIMEOUT=true  # 動的調整を有効化
```

**効果**: 処理時間に応じた適切なタイムアウト設定

---

### 5. 機能フラグによる処理の軽量化

**問題点**:
- OCR、サムネイル、ベクトル化などの重い処理が速度を低下させている

**解決策（速度優先の場合）**:
```bash
# .env.optimized - 最速設定
ENABLE_OCR=false
ENABLE_THUMBNAIL=false
ENABLE_VECTOR_SEARCH=false
```

**効果**: 処理時間が約1/5に短縮（推定800-1000 msg/分）

**トレードオフ**:
| 設定 | 速度 (msg/分) | 機能 |
|------|--------------|------|
| 最速 | 800-1000 | メタデータのみ |
| バランス | 400-600 | + サムネイル |
| フル機能 | 150-250 | + OCR + ベクトル検索 |

**実装コード** (`main_optimized.py`):
```python
needs_download = (config.features.enable_ocr or
                 config.features.enable_thumbnail or
                 config.features.enable_vector_search)

if needs_download:
    temp_file = self.s3_client.download_file(bucket, key)
    # 有効な機能のみ処理
else:
    # ファイルダウンロードすらスキップ
    pass
```

---

### 6. メモリ管理の最適化

**問題点**:
- メモリリークが再起動の原因となっている可能性
- 一時ファイルのクリーンアップが不完全

**解決策**:
```python
# main_optimized.py
def process_file(self, bucket: str, key: str) -> bool:
    try:
        # 処理...
    finally:
        # 確実にクリーンアップ
        if temp_file:
            self.s3_client.cleanup_temp_file(temp_file)

        # 定期的にガベージコレクション
        if self.stats['processed'] % 100 == 0:
            gc.collect()
```

**メモリ監視**:
```python
def _check_memory_usage(self):
    memory = psutil.virtual_memory()
    if memory.percent > 80:
        logger.warning(f"High memory usage: {memory.percent:.1f}%")
        if memory.percent > 90:
            gc.collect()
```

---

### 7. systemd 設定の最適化

**問題点**:
- RestartSec=30s では再起動後の復帰が遅い
- リソース制限が厳しすぎる

**解決策** (`cis-worker-optimized.service`):
```ini
[Service]
# 再起動を高速化
Restart=always
RestartSec=5s  # 30s → 5s に短縮

# メモリ制限を緩和
MemoryMax=3584M  # 2G → 3.5G
MemoryHigh=3072M  # 1.5G → 3G

# CPU使用率の上限を緩和
CPUQuota=200%  # 80% → 200% (2コアフル活用)

# I/O優先度を上げる
IOSchedulingClass=best-effort
IOSchedulingPriority=2

# CPU優先度を上げる
Nice=-5
```

**効果**: 再起動時のダウンタイムが30秒 → 5秒に短縮

---

### 8. パフォーマンスモニタリング

**新機能**: リアルタイムパフォーマンス統計

**実装**:
```python
def _log_performance_stats(self):
    logger.info("=" * 80)
    logger.info("📊 PERFORMANCE STATISTICS")
    logger.info(f"✅ Processed: {total_processed} messages")
    logger.info(f"🚀 Speed: {messages_per_minute:.1f} msg/min")
    logger.info(f"🎯 Target: 500 msg/min")
    logger.info(f"📦 Queue Depth: {queue_depth} messages")
    logger.info(f"⏳ Estimated Completion: {estimated_hours:.1f} hours")
    logger.info("=" * 80)
```

**出力例**:
```
================================================================================
📊 PERFORMANCE STATISTICS
⏱️  Uptime: 120s (2.0m)
✅ Processed: 1234 messages
❌ Failed: 5 messages
📈 Success Rate: 99.6%
🚀 Speed: 617.0 msg/min (37020 msg/hour)
🎯 TARGET ACHIEVED! Current: 617 msg/min >= 500 msg/min
📦 Queue Depth: 256260 messages
⏳ Estimated Completion: 6.9 hours
================================================================================
```

---

## デプロイ手順

### ステップ1: EC2インスタンスにログイン

```bash
ssh -i your-key.pem ec2-user@your-instance-ip
```

### ステップ2: 最適化版ファイルをデプロイ

```bash
cd /opt/cis-file-processor

# バックアップを作成
sudo cp src/main.py src/main.py.backup
sudo cp src/sqs_handler.py src/sqs_handler.py.backup
sudo cp src/config.py src/config.py.backup
sudo cp .env .env.backup

# 最適化版ファイルをコピー（ローカルからSCPで転送）
# ローカルマシンで実行:
scp -i your-key.pem backend/ec2-worker/src/main_optimized.py ec2-user@your-instance:/tmp/
scp -i your-key.pem backend/ec2-worker/src/sqs_handler_optimized.py ec2-user@your-instance:/tmp/
scp -i your-key.pem backend/ec2-worker/src/config_optimized.py ec2-user@your-instance:/tmp/
scp -i your-key.pem backend/ec2-worker/.env.optimized ec2-user@your-instance:/tmp/
scp -i your-key.pem backend/ec2-worker/deploy/cis-worker-optimized.service ec2-user@your-instance:/tmp/

# EC2インスタンスで実行:
sudo mv /tmp/main_optimized.py /opt/cis-file-processor/src/
sudo mv /tmp/sqs_handler_optimized.py /opt/cis-file-processor/src/
sudo mv /tmp/config_optimized.py /opt/cis-file-processor/src/
sudo mv /tmp/.env.optimized /opt/cis-file-processor/.env
sudo chown -R cis-worker:cis-worker /opt/cis-file-processor/src/
```

### ステップ3: 環境変数を設定

```bash
cd /opt/cis-file-processor
sudo nano .env
```

**最速設定（推奨）**:
```bash
# 速度優先
ENABLE_OCR=false
ENABLE_THUMBNAIL=false
ENABLE_VECTOR_SEARCH=false
WORKER_THREADS=10
SQS_PARALLEL_FETCH=3
```

**バランス設定**:
```bash
# 速度と機能のバランス
ENABLE_OCR=false
ENABLE_THUMBNAIL=true
ENABLE_VECTOR_SEARCH=false
WORKER_THREADS=10
SQS_PARALLEL_FETCH=3
```

### ステップ4: systemd サービスを更新

```bash
# サービスファイルをコピー
sudo cp /tmp/cis-worker-optimized.service /etc/systemd/system/cis-worker.service

# systemd をリロード
sudo systemctl daemon-reload

# サービスを再起動
sudo systemctl restart cis-worker

# ステータス確認
sudo systemctl status cis-worker
```

### ステップ5: パフォーマンス監視

```bash
# ログをリアルタイムで確認
sudo tail -f /var/log/cis-worker/worker.log

# 30秒ごとにパフォーマンス統計が出力される
# 「🚀 Speed: XXX msg/min」を確認
```

---

## トラブルシューティング

### 問題1: メモリ不足でクラッシュする

**症状**: OOM Killer によってプロセスが強制終了される

**解決策**:
```bash
# .env
WORKER_THREADS=8  # 10 → 8 に減らす
SQS_PARALLEL_FETCH=2  # 3 → 2 に減らす
ENABLE_OCR=false
```

### 問題2: CPU使用率が低い（50%以下）

**症状**: リソースを使い切っていない

**解決策**:
```bash
# .env
WORKER_THREADS=12  # 10 → 12 に増やす
SQS_PARALLEL_FETCH=4  # 3 → 4 に増やす
```

### 問題3: 処理速度が目標に達しない

**段階的な最適化**:

1. **現在の設定を確認**:
```bash
cat /opt/cis-file-processor/.env | grep -E "ENABLE_|WORKER_THREADS"
```

2. **機能を無効化**:
```bash
ENABLE_OCR=false
ENABLE_THUMBNAIL=false
ENABLE_VECTOR_SEARCH=false
```

3. **スレッド数を増やす**:
```bash
WORKER_THREADS=10  # → 12 → 15 と段階的に
```

4. **インスタンスタイプのアップグレードを検討**:
- t3.medium (2vCPU, 4GB) → t3.large (2vCPU, 8GB)
- または c5.large (2vCPU, 4GB, CPU最適化)

### 問題4: 再起動が頻繁に発生

**原因特定**:
```bash
# エラーログを確認
sudo tail -100 /var/log/cis-worker/error.log

# systemd のログを確認
sudo journalctl -u cis-worker -n 100
```

**一般的な原因**:
1. **メモリ不足**: WORKER_THREADS を減らす
2. **依存関係エラー**: pip install で再インストール
3. **AWS認証エラー**: IAMロールの権限を確認

---

## パフォーマンス目標と期待値

### t3.medium (2vCPU, 4GB RAM) での目標

| 設定 | 目標速度 | 実現可能性 | 残り257,494メッセージの完了時間 |
|------|----------|-----------|-------------------------------|
| 最速 | 800-1000 msg/min | 高い | 4-5時間 |
| バランス | 500-600 msg/min | 非常に高い | 7-8時間 |
| フル機能 | 200-300 msg/min | 高い | 14-21時間 |

### 現在の242 msg/分からの改善予測

| 最適化施策 | 速度改善 | 累積速度 |
|-----------|---------|---------|
| 現在 | - | 242 msg/min |
| + スレッド数増加 (10) | +30% | 315 msg/min |
| + 並列SQS受信 (3) | +40% | 441 msg/min |
| + 動的待機時間 | +15% | 507 msg/min |
| + 機能無効化 | +60% | **811 msg/min** |

---

## まとめ

### 即座に実装可能な改善策（優先度順）

1. **機能無効化** (効果: 大)
   - ENABLE_OCR=false
   - ENABLE_THUMBNAIL=false
   - ENABLE_VECTOR_SEARCH=false

2. **スレッド数増加** (効果: 中)
   - WORKER_THREADS=10

3. **並列SQS受信** (効果: 中)
   - SQS_PARALLEL_FETCH=3

4. **systemd設定最適化** (効果: 小)
   - RestartSec=5s
   - CPUQuota=200%

5. **最適化版コードのデプロイ** (効果: 大)
   - main_optimized.py
   - sqs_handler_optimized.py
   - config_optimized.py

### 期待される結果

**保守的な予測**: 500-600 msg/分（現在の2.5倍）
**楽観的な予測**: 800-1000 msg/min（現在の4倍）

**完了時間の短縮**:
- 現在: 約18時間
- 最適化後: **4-8時間**（10-14時間短縮）

---

## 次のステップ

1. **即座に実装**: 機能無効化とスレッド数増加（.env編集のみ）
2. **検証**: 30分間実行してログで速度を確認
3. **段階的調整**: 目標に達しない場合はスレッド数を増やす
4. **完全版デプロイ**: 最適化版コードを本番環境にデプロイ
5. **長期監視**: CloudWatch メトリクスで継続的にモニタリング

---

## サポートとフィードバック

問題が発生した場合やさらなる最適化が必要な場合は、以下を確認してください:

1. **ログの確認**: `/var/log/cis-worker/worker.log`
2. **システムリソース**: `htop` または `top` でCPU/メモリ使用率を確認
3. **SQSキューの状態**: AWS Console でキューの深さを確認
4. **OpenSearchの応答時間**: インデックス処理がボトルネックになっていないか確認

パフォーマンス統計を30秒ごとに確認し、目標の500 msg/分を達成できているかモニタリングしてください。
