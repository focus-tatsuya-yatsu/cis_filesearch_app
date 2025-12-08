# 📖 CIS File Scanner - Quick Reference

よく使うコマンドのクイックリファレンスです。

---

## 🚀 セットアップ

```bash
# 1. プロジェクトディレクトリに移動
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend/backend/file-scanner

# 2. 環境設定ファイル作成
cp .env.production .env
vi .env  # または nano .env

# 3. 依存関係インストール
yarn install

# 4. ビルド
yarn build

# 5. セットアップ検証（推奨）
./verify-setup.sh
```

---

## 🔍 スキャンコマンド

### ドライラン（テスト実行）
実際のアップロードなし、スキャンのみ確認

```bash
DRY_RUN=true node dist/index.js scan
```

### フルスキャン（初回実行）
全ファイルをスキャンしてS3にアップロード

```bash
# フォアグラウンド実行
node dist/index.js scan

# バックグラウンド実行（推奨）
nohup node dist/index.js scan > scan.log 2>&1 &

# 進捗確認
tail -f scan.log
```

### 差分スキャン（2回目以降）
変更されたファイルのみをスキャン

```bash
node dist/index.js diff
```

### スケジュール実行
定期的に差分スキャンを実行

```bash
# 6時間ごとに実行
node dist/index.js schedule "0 */6 * * *"

# バックグラウンド実行
nohup node dist/index.js schedule "0 */6 * * *" > schedule.log 2>&1 &
```

---

## 📊 モニタリング

### 統計情報表示
```bash
node dist/index.js stats
```

### ログ確認
```bash
# 全ログ
tail -f logs/combined.log

# エラーログのみ
tail -f logs/error.log

# スキャンログ
tail -f scan.log
```

### データベース確認
```bash
# ファイル数
sqlite3 data/scanner.db "SELECT COUNT(*) FROM files"

# 最近のスキャン履歴
sqlite3 data/scanner.db "SELECT * FROM scan_history ORDER BY scan_time DESC LIMIT 5"

# エラー数
sqlite3 data/scanner.db "SELECT COUNT(*) FROM error_logs"
```

---

## ☁️ AWS 確認コマンド

### S3バケット内容確認
```bash
# オブジェクト一覧
aws s3 ls s3://cis-filesearch-s3-landing/ --recursive --profile AdministratorAccess-770923989980

# サマリー（ファイル数・合計サイズ）
aws s3 ls s3://cis-filesearch-s3-landing/ --recursive --summarize --human-readable --profile AdministratorAccess-770923989980

# オブジェクト数のみ
aws s3 ls s3://cis-filesearch-s3-landing/ --recursive --profile AdministratorAccess-770923989980 | wc -l
```

### SQSメッセージ確認
```bash
# キュー内のメッセージ数
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-queue \
  --attribute-names ApproximateNumberOfMessages \
  --profile AdministratorAccess-770923989980
```

---

## 🛠️ トラブルシューティング

### プロセス確認・停止
```bash
# 実行中のプロセス確認
ps aux | grep "node dist/index.js"

# プロセス停止
kill -9 [PID]

# または
pkill -f "node dist/index.js"
```

### データベースリセット
```bash
# ⚠️ 注意: すべてのスキャン履歴が削除されます
rm -f data/scanner.db
```

### NASマウント確認
```bash
# マウント状態確認
mount | grep nas

# または
df -h | grep nas

# アクセス権限確認
ls -la /mnt/nas

# 読み込みテスト
ls /mnt/nas | head -10
```

### ビルドやり直し
```bash
# distディレクトリ削除
rm -rf dist/

# 再ビルド
yarn build

# ビルド確認
ls -la dist/index.js
```

---

## 🔄 定期実行設定

### cronジョブ設定
```bash
# crontab編集
crontab -e

# 以下を追加（6時間ごとに差分スキャン）
0 */6 * * * cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend/backend/file-scanner && /usr/local/bin/node dist/index.js diff >> logs/cron.log 2>&1
```

### systemdサービス設定（Linux）
```bash
# サービスファイル作成
sudo vi /etc/systemd/system/cis-file-scanner.service

# サービス有効化
sudo systemctl daemon-reload
sudo systemctl enable cis-file-scanner
sudo systemctl start cis-file-scanner

# 状態確認
sudo systemctl status cis-file-scanner

# ログ確認
sudo journalctl -u cis-file-scanner -f
```

---

## 💡 便利なTips

### 特定のディレクトリのみスキャン
```bash
NAS_MOUNT_PATH=/mnt/nas/specific-folder node dist/index.js scan
```

### メモリ制限を増やす
```bash
NODE_OPTIONS="--max-old-space-size=8192" node dist/index.js scan
```

### 並列度を調整（高速化）
```bash
# .envファイルで設定
S3_UPLOAD_CONCURRENCY=30
SCAN_PARALLELISM=30
```

### デバッグモード
```bash
LOG_LEVEL=debug node dist/index.js scan
```

---

## 📞 よくある質問

### Q: スキャンにどのくらい時間がかかりますか？
| ファイル数 | データ量 | 推定時間 |
|----------|---------|---------|
| 10万 | 100GB | 2-3時間 |
| 100万 | 1TB | 12-18時間 |
| 500万 | 5TB | 2-3日 |

### Q: スキャンを中断したらどうなりますか？
処理済みのファイルはデータベースに記録されているため、再実行時はスキップされます。

### Q: 差分スキャンはどのように動作しますか？
データベースに記録された最終更新日時と、実際のファイルの更新日時を比較して、変更されたファイルのみを処理します。

### Q: エラーが出たファイルはどうなりますか？
エラーは `error_logs` テーブルに記録され、該当ファイルは `status='error'` としてマークされます。再実行時に再試行されます。

---

## 🎯 推奨ワークフロー

### 初回セットアップ時
1. `./verify-setup.sh` - 環境確認
2. `DRY_RUN=true node dist/index.js scan` - ドライラン
3. `NAS_MOUNT_PATH=/mnt/nas/test node dist/index.js scan` - 小規模テスト
4. `node dist/index.js scan` - 本番フルスキャン

### 運用時（定期実行）
1. cronまたはsystemdで6時間ごとに `node dist/index.js diff` を実行
2. CloudWatchでメトリクスを監視
3. 週1回 `node dist/index.js stats` で統計確認

---

詳細は `SETUP_PRODUCTION.md` を参照してください。
