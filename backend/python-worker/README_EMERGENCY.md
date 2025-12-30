# 緊急デプロイパッケージ: SQS無限ループ修正

## 📋 概要

本番環境で発生した58,524メッセージのSQS無限ループを修正するための緊急デプロイパッケージです。

**問題**: `worker.py` lines 336-349でメッセージ削除ロジックが欠如
**修正**: `worker_fixed.py`で必ずメッセージを削除する実装に変更
**デプロイ方式**: User Data + S3 (SSH/SSM接続不要)

---

## 🚀 クイックスタート（最速5分）

### 1. 前提条件確認

```bash
# AWS認証確認
aws sts get-caller-identity
```

### 2. デプロイ実行（1コマンド）

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker
./deploy-emergency-fix.sh
```

### 3. 監視開始

```bash
./monitor-sqs.sh
```

詳細は `QUICK_START.md` を参照してください。

---

## 📁 ファイル構成

| ファイル | 説明 | 用途 |
|---------|------|------|
| `worker_fixed.py` | 修正済みWorker | メッセージ削除ロジック修正版 |
| `deploy-emergency-fix.sh` | 自動デプロイスクリプト | ワンコマンドでデプロイ実行 |
| `monitor-sqs.sh` | SQS監視スクリプト | リアルタイムでメッセージ数監視 |
| `QUICK_START.md` | クイックスタートガイド | 最速でデプロイする手順 |
| `EMERGENCY_DEPLOY.md` | 詳細デプロイ手順 | ステップバイステップの手動実行手順 |
| `README_EMERGENCY.md` | このファイル | 全体概要 |

---

## 🔧 技術的な修正内容

### 修正前 (worker.py)

```python
# 問題: 成功時のみ削除、失敗時は削除されない
if success:
    self.sqs_client.delete_message(...)  # ここだけ
```

### 修正後 (worker_fixed.py)

```python
# 解決: 必ず削除、失敗時はDLQに送信
should_delete = True  # 常にTrue

# 処理失敗時
if not success:
    self._send_to_dlq(message, error_msg)  # DLQに送信

# 必ず削除
if should_delete:
    self.sqs_client.delete_message(...)  # 成功/失敗に関わらず実行
```

### 主な変更点

1. **メッセージ削除の保証**: 成功/失敗に関わらず必ず削除
2. **DLQ明示的送信**: 失敗メッセージを `_send_to_dlq()` で明示的に送信
3. **削除失敗のメトリクス送信**: 削除失敗時にCloudWatchメトリクスを送信
4. **処理状態の追跡**: `(success, error_message)` タプルで状態を明確化

---

## 📊 デプロイ方式の比較

| 方式 | 実装時間 | SSH/SSM | リスク | 再現性 | 推奨度 |
|------|---------|---------|--------|--------|--------|
| **A: UserData+S3** | 15-20分 | 不要 | 低 | 高 | ⭐⭐⭐⭐⭐ |
| B: AMI再作成 | 60分+ | 必要 | 中 | 中 | ⭐⭐ |
| C: 手動AMI作成 | 90分+ | 必要 | 高 | 低 | ⭐ |

**選定理由**:
- 既存インスタンスへのアクセス不要
- Launch Templateバージョン管理でロールバック容易
- 今後の更新も同じ手順で実施可能

---

## 🛡️ リスク評価と軽減策

### 高リスク
なし

### 中リスク

**⚠️ UserData内の環境変数設定ミス**
- 軽減策: デプロイスクリプトが自動取得を試みる
- バックアップ: 手動で環境変数を設定可能

**⚠️ 依存ファイルの不足**
- 軽減策: 全ての.pyファイルをS3にアップロード
- 確認: デプロイスクリプトがアップロード確認を実施

### 低リスク

**ℹ️ 一時的なダウンタイム（2-3分）**
- 影響: メッセージ処理が一時停止
- 軽減策: Auto Scalingにより自動復旧

**ℹ️ S3アクセス権限不足**
- 確認: デプロイスクリプトが事前チェック
- 軽減策: IAMロールの権限確認手順を提供

---

## 📈 成功判定基準

以下を全て満たせば成功:

- ✅ **SQSメッセージ数が減少**: 30秒ごとに確認して減少傾向
- ✅ **メッセージ削除ログ確認**: CloudWatch Logsに `Message ... deleted from queue`
- ✅ **DLQ正常動作**: 失敗メッセージがDLQに送信されている
- ✅ **新インスタンス正常稼働**: Auto Scalingで起動完了

---

## 🔄 ロールバック手順

問題が発生した場合、即座にロールバック可能:

```bash
# Launch Templateを前のバージョンに戻す
aws ec2 modify-launch-template \
  --launch-template-name cis-filesearch-worker-template \
  --default-version <前のバージョン番号> \
  --region ap-northeast-1

# 新インスタンスを終了（前のバージョンで再起動）
aws autoscaling terminate-instance-in-auto-scaling-group \
  --instance-id <新インスタンスID> \
  --should-decrement-desired-capacity false \
  --region ap-northeast-1
```

**所要時間**: 5分以内

---

## 📞 トラブルシューティング

### デプロイスクリプトがエラーになる

**AWS認証エラー**
```bash
aws sso login --profile YOUR_PROFILE
# または
aws configure
```

**S3バケットが見つからない**
```bash
# バケット一覧確認
aws s3 ls

# 正しいバケット名を設定
export S3_WORKER_BUCKET="実際のバケット名"
```

**SQS Queue URLを取得できない**
```bash
# 手動取得
aws sqs list-queues

# 環境変数に設定
export SQS_QUEUE_URL="取得したURL"
```

### デプロイ後もメッセージが減らない

1. **Workerログを確認**
   ```bash
   aws logs tail /aws/ec2/worker --follow --region ap-northeast-1
   ```

2. **エラーログを確認**
   - `Failed to delete message` が出ていないか
   - 処理エラーが頻発していないか

3. **DLQメッセージを確認**
   ```bash
   aws sqs receive-message --queue-url <DLQ_URL> --max-number-of-messages 1
   ```

4. **ロールバックを検討**
   - 上記「ロールバック手順」を参照

---

## 📚 参考資料

- **詳細デプロイ手順**: `EMERGENCY_DEPLOY.md`
- **クイックスタート**: `QUICK_START.md`
- **修正済みWorker**: `worker_fixed.py`
- **自動デプロイスクリプト**: `deploy-emergency-fix.sh`
- **監視スクリプト**: `monitor-sqs.sh`

---

## 📝 デプロイ後のアクション

1. **監視継続（24時間）**: `monitor-sqs.sh` でメッセージ数を監視
2. **CloudWatch Alarmの設定**: メッセージ数異常増加のアラート
3. **DLQメッセージの分析**: 失敗理由を分析して改善
4. **本番環境の安定化確認**: 1週間程度監視

---

## 🎯 想定タイムライン

| 時刻 | アクション | 所要時間 |
|------|----------|---------|
| T+0 | デプロイ開始 | - |
| T+2分 | S3アップロード完了 | 2分 |
| T+5分 | Launch Template更新完了 | 3分 |
| T+8分 | 既存インスタンス終了 | 3分 |
| T+11分 | 新インスタンス起動完了 | 3分 |
| T+15分 | Worker稼働開始 | 4分 |
| T+20分 | メッセージ減少確認 | 5分 |

**合計所要時間**: 約20分

---

## ✅ チェックリスト

### デプロイ前
- [ ] AWS認証が有効
- [ ] S3バケット名確認
- [ ] SQS Queue URL取得
- [ ] DLQ URL取得
- [ ] OpenSearchエンドポイント取得

### デプロイ中
- [ ] worker_fixed.py アップロード
- [ ] 依存ファイルアップロード
- [ ] UserDataスクリプト生成
- [ ] Launch Template新バージョン作成
- [ ] デフォルトバージョン更新
- [ ] 既存インスタンス終了
- [ ] 新インスタンス起動確認

### デプロイ後
- [ ] Workerログ確認
- [ ] SQSメッセージ数減少確認
- [ ] DLQ正常動作確認
- [ ] CloudWatch Alarms設定
- [ ] 24時間監視継続

---

**作成日**: 2025-12-13
**緊急度**: 🔴 最高
**想定実施時間**: 15-20分
**ロールバック時間**: 5分以内
