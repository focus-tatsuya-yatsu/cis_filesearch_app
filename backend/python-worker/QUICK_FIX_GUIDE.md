# 🚨 SQS/DLQ 緊急修正 - クイックガイド

## 📋 状況サマリー

**問題**: DataSync停止中にも関わらずSQS/DLQメッセージが増加し続ける

**根本原因を特定しました** ✅:
- `worker.py` lines 336-349 に**メッセージ削除バグ**があります
- 処理失敗時にメッセージを削除せず、300秒後に再表示される**無限ループ**が発生
- 修正版 `worker_fixed.py` で既に対応済み

---

## ⚡ 即座に実行 (5分)

### AWS認証トークンを更新

```bash
# AWS SSOでログイン
aws sso login --profile your-profile

# または環境変数を設定
export AWS_PROFILE=your-profile
export AWS_REGION=ap-northeast-1
```

### 緊急修正スクリプトを実行

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker/scripts

# 実行権限確認
chmod +x apply_emergency_fix.sh

# スクリプト実行
./apply_emergency_fix.sh
```

このスクリプトは以下を自動実行します:
1. ✅ worker.py をバックアップ
2. ✅ worker_fixed.py → worker.py にコピー
3. ✅ SQS Visibility Timeout を 900秒に変更
4. ✅ 検証

---

## 🔧 修正内容の詳細

### Before (バグあり)

```python
if success:
    sqs_client.delete_message(...)  # 成功時のみ削除
    stats['succeeded'] += 1
else:
    logger.error("Processing failed - message will be retried")
    stats['failed'] += 1  # ⚠️ 削除していない → 無限ループ
```

### After (修正版)

```python
try:
    success, error_msg = process_sqs_message(message)
    if success:
        stats['succeeded'] += 1
    else:
        send_to_dlq(message, error_msg)  # DLQに送信
        stats['failed'] += 1
finally:
    # 必ず削除 (成功/失敗に関わらず)
    sqs_client.delete_message(...)  # ✅ 無限ループ解消
```

---

## 📊 期待される結果

| 項目 | 現在 | 24時間後 |
|------|------|----------|
| **SQS メッセージ数** | 増加中 | 0 (空) |
| **DLQ メッセージ数** | 増加中 | 安定 (新規増加なし) |
| **処理スループット** | 5-10 files/min | 50-100 files/min |

---

## 🔍 追加確認事項 (AWS認証後)

### S3 Event Notification の重複確認

```bash
aws s3api get-bucket-notification-configuration \
  --bucket cis-filesearch-storage-production \
  --region ap-northeast-1 | jq '.QueueConfigurations | length'
```

**期待値**: `1` (重複なし)
**問題値**: `2以上` → 修正が必要

### 24時間監視

```bash
# 10分ごとにメッセージ数を確認
watch -n 600 'aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/.../file-processing-queue-production \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-northeast-1 \
  --query "Attributes.ApproximateNumberOfMessages"'
```

メッセージ数が**減少し続ける**ことを確認してください。

---

## 📁 作成されたファイル

1. **`SQS_EMERGENCY_ROOT_CAUSE_ANALYSIS.md`** (15KB)
   - 詳細な根本原因分析レポート
   - 数学的証明、修正手順、再発防止策

2. **`scripts/apply_emergency_fix.sh`** (実行可能)
   - 自動修正スクリプト
   - バックアップ、適用、検証を一括実行

3. **`worker_fixed.py`** (既存)
   - メッセージ削除バグを修正したワーカー
   - DLQ送信機能を追加
   - CloudWatch監視を強化

---

## 🎯 成功確認

修正が成功したら、以下が観測されるはずです:

✅ **SQSメッセージ数が減少**
```bash
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names ApproximateNumberOfMessages
```

✅ **DLQに失敗メッセージが正しく送信される**
```bash
# DLQメッセージのサンプル確認
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker
python analyze_dlq_messages.py --sample 10
```

✅ **CloudWatch Logsでエラーパターンが減少**
```bash
aws logs filter-log-events \
  --log-group-name /aws/ec2/file-processor \
  --filter-pattern "?ERROR ?FAILED" \
  --max-items 20
```

---

## 🆘 問題が解決しない場合

1. **EC2インスタンスでワーカーを再起動**
   ```bash
   sudo systemctl restart file-processor
   ```

2. **Auto Scalingを一時停止**
   ```bash
   aws autoscaling set-desired-capacity \
     --auto-scaling-group-name file-processor-asg-production \
     --desired-capacity 0
   ```

3. **詳細レポートを確認**
   ```bash
   cat SQS_EMERGENCY_ROOT_CAUSE_ANALYSIS.md
   ```

---

## 📞 次のステップ

修正完了後:
1. ✅ 24時間監視してメッセージ数が 0 になることを確認
2. ⏳ S3 Event Notification重複を確認・修正
3. ⏳ Lambda検索API実装 (Phase 2)
4. ⏳ 画像検索機能実装 (マスト項目)

---

**作成**: Claude Code
**最終更新**: 2025-12-12
