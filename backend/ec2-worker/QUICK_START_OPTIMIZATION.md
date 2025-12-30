# 🚀 クイックスタート: 5分でパフォーマンス2倍改善

現在の処理速度: **242 msg/分**
目標: **500-1000 msg/分**

## 📋 3ステップで即座に改善

### ステップ1: EC2にログイン（1分）

```bash
ssh -i your-key.pem ec2-user@your-ec2-instance
```

### ステップ2: 環境変数を変更（2分）

```bash
cd /opt/cis-file-processor
sudo nano .env
```

以下の値を変更:

```bash
# 速度優先設定（推奨）
ENABLE_OCR=false           # true → false
ENABLE_THUMBNAIL=false     # true → false
ENABLE_VECTOR_SEARCH=false # true → false
WORKER_THREADS=10          # 4 → 10
```

保存して終了: `Ctrl+X` → `Y` → `Enter`

### ステップ3: サービスを再起動（1分）

```bash
sudo systemctl restart cis-worker
```

### ステップ4: 結果を確認（1分）

```bash
sudo tail -f /var/log/cis-worker/worker.log
```

30秒ごとに以下のような統計が表示されます:

```
================================================================================
📊 PERFORMANCE STATISTICS
🚀 Speed: 617.0 msg/min (37020 msg/hour)
🎯 TARGET ACHIEVED! Current: 617 msg/min >= 500 msg/min
📦 Queue Depth: 256260 messages
⏳ Estimated Completion: 6.9 hours
================================================================================
```

**期待される結果**: 500-600 msg/分（2.5倍改善）

---

## 🔥 さらなる改善: 最適化版コードのデプロイ（15分）

より高い処理速度（800-1000 msg/分）を実現するには、最適化版コードをデプロイしてください。

### ローカルマシンで実行:

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/ec2-worker
./deploy-optimized.sh ec2-user@your-ec2-instance
```

スクリプトが自動的に:
1. ファイルをバックアップ
2. 最適化版コードを転送
3. systemd設定を更新
4. サービスを準備

### EC2インスタンスで再起動:

```bash
sudo systemctl restart cis-worker
sudo tail -f /var/log/cis-worker/worker.log
```

**期待される結果**: 800-1000 msg/分（4倍改善）

---

## 📊 設定別の処理速度比較

| 設定 | 速度 | 完了時間 | 機能 |
|------|------|---------|------|
| 現在 | 242 msg/分 | 18時間 | フル機能 |
| 環境変数のみ変更 | 500-600 msg/分 | 7-8時間 | メタデータのみ |
| 最適化版コード | 800-1000 msg/分 | 4-5時間 | メタデータのみ |

---

## ⚙️ 設定オプション

### 最速設定（800-1000 msg/分）
```bash
ENABLE_OCR=false
ENABLE_THUMBNAIL=false
ENABLE_VECTOR_SEARCH=false
WORKER_THREADS=10
```

### バランス設定（500-600 msg/分）
```bash
ENABLE_OCR=false
ENABLE_THUMBNAIL=true    # サムネイルのみ有効
ENABLE_VECTOR_SEARCH=false
WORKER_THREADS=10
```

### フル機能設定（200-300 msg/分）
```bash
ENABLE_OCR=true
ENABLE_THUMBNAIL=true
ENABLE_VECTOR_SEARCH=true
WORKER_THREADS=8
```

---

## 🔍 トラブルシューティング

### メモリ不足でクラッシュする場合

```bash
# スレッド数を減らす
WORKER_THREADS=8  # 10 → 8
```

### 速度が上がらない場合

1. 機能がすべて無効化されているか確認:
```bash
cat /opt/cis-file-processor/.env | grep ENABLE_
```

2. すべて `false` になっていることを確認
3. サービスを再起動:
```bash
sudo systemctl restart cis-worker
```

### ログを確認する方法

```bash
# リアルタイムログ
sudo tail -f /var/log/cis-worker/worker.log

# エラーログ
sudo tail -f /var/log/cis-worker/error.log

# systemdログ
sudo journalctl -u cis-worker -f
```

---

## 📈 モニタリングコマンド

### パフォーマンス統計を監視
```bash
watch -n 30 'sudo journalctl -u cis-worker -n 50 | grep "PERFORMANCE STATISTICS" -A 10'
```

### システムリソースを監視
```bash
htop
```

### SQSキューの深さを確認
```bash
aws sqs get-queue-attributes \
  --queue-url YOUR_QUEUE_URL \
  --attribute-names ApproximateNumberOfMessages
```

---

## ✅ 成功の確認

以下を確認してください:

1. ✅ ログに「📊 PERFORMANCE STATISTICS」が30秒ごとに表示される
2. ✅ 「🚀 Speed: XXX msg/min」が500以上
3. ✅ 「🎯 TARGET ACHIEVED!」と表示される
4. ✅ メモリ使用率が80%未満
5. ✅ エラー率が5%未満

---

## 📞 サポート

問題が発生した場合は、以下のドキュメントを参照してください:

- **詳細ガイド**: `PERFORMANCE_OPTIMIZATION_GUIDE.md`
- **完全サマリー**: `OPTIMIZATION_SUMMARY.md`
- **デプロイスクリプト**: `deploy-optimized.sh`

---

## 🎯 まとめ

- **5分で実装**: 環境変数の変更のみで500-600 msg/分を達成
- **15分で実装**: 最適化版コードで800-1000 msg/分を達成
- **10-14時間の時間節約**: 完了時間を18時間から4-8時間に短縮

今すぐ始めましょう！
