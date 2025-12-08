# 🚀 CIS File Scanner - 本番環境セットアップガイド

このガイドでは、スキャナーPCでFile Scannerを本番環境にセットアップする手順を説明します。

**🖥️ Windows環境の方へ**: このガイドはLinux/Mac向けです。Windows 11 Proの方は[Windows専用ガイド](/docs/deployment/windows-scanner-pc-setup-guide.md)を参照してください。

---

## 📋 前提条件チェックリスト

実行前に以下を確認してください：

- [ ] Node.js 18以上がインストールされている
- [ ] yarnがインストールされている（`npm install -g yarn`）
- [ ] NASがマウントされている（または接続可能）
- [ ] AWS IAMユーザーまたはRoleが作成されている
- [ ] S3バケット `cis-filesearch-s3-landing` が作成されている
- [ ] スキャナーPCからインターネット接続が可能（AWS APIアクセス用）

---

## ⚡ クイックスタート（推奨）

セットアップ状態を自動的に検証するスクリプトを用意しています。

```bash
# プロジェクトディレクトリに移動
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/file-scanner

# 検証スクリプトを実行
./verify-setup.sh
```

このスクリプトは以下を自動チェックします：
- ✅ Node.js/yarnのバージョン
- ✅ .envファイルの存在と必須変数
- ✅ NASマウント状態とアクセス権限
- ✅ AWS認証情報とS3バケット接続
- ✅ 依存関係インストール状態
- ✅ ビルド成功確認
- ✅ オプション：ドライラン実行

**推奨**: まずこのスクリプトを実行して、問題がある箇所のみ以下の手順を参照してください。

---

## 🔧 セットアップ手順（詳細）

以下は手動セットアップの詳細手順です。上記の検証スクリプトで問題が見つかった場合に参照してください。

### Step 1: プロジェクトディレクトリに移動

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/file-scanner
```

### Step 2: 依存関係のインストール

```bash
# 依存パッケージをインストール
yarn install

# インストール確認
yarn --version
node --version
```

**期待される出力:**
```
yarn: 1.22.x以上
node: 18.x.x以上
```

---

### Step 3: 本番環境設定ファイルの作成

```bash
# .env.productionを.envにコピー
cp .env.production .env

# エディタで編集
vi .env
# または
nano .env
```

#### 必須設定項目

`.env`ファイルで以下を設定してください：

#### 3.1 AWS認証情報（2つの方法）

**方法A: IAM Role使用（推奨 - EC2上で実行の場合）**

```env
# AWS_ACCESS_KEY_IDとAWS_SECRET_ACCESS_KEYは空のまま（コメントアウト可）
# EC2のIAM Roleが自動的に使用されます
```

IAM Roleに必要な権限:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::cis-filesearch-s3-landing",
        "arn:aws:s3:::cis-filesearch-s3-landing/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:GetQueueUrl"
      ],
      "Resource": "arn:aws:sqs:ap-northeast-1:*:cis-filesearch-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricData"
      ],
      "Resource": "*"
    }
  ]
}
```

**方法B: アクセスキー使用（ローカルPC実行の場合）**

```env
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

⚠️ **セキュリティ注意**: アクセスキーは厳重に管理してください。

#### 3.2 S3バケット名

```env
S3_BUCKET_NAME=cis-filesearch-s3-landing
```

#### 3.3 NASマウントパス

```bash
# マウントポイントを確認
mount | grep nas
# または
df -h | grep nas
```

確認した実際のパスを設定:
```env
NAS_MOUNT_PATH=/mnt/nas  # 実際のパスに変更
```

#### 3.4 SQS Queue URL（SQS作成後）

```bash
# AWS Consoleでキュー作成後、URLを取得して設定
SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-queue
```

SQS Queue作成方法は後述。

---

### Step 4: NASマウント確認

#### マウント状態の確認

```bash
# マウントされているか確認
mount | grep nas

# アクセス権限確認
ls -la /mnt/nas

# テストファイル読み込み
ls /mnt/nas | head -10
```

#### マウントされていない場合（手動マウント）

**NFSの場合:**
```bash
sudo mkdir -p /mnt/nas
sudo mount -t nfs 192.168.1.100:/volume1 /mnt/nas
```

**SMB/CIFSの場合:**
```bash
sudo mkdir -p /mnt/nas
sudo mount -t cifs //192.168.1.100/share /mnt/nas -o username=USER,password=PASS
```

---

### Step 5: ビルド

```bash
# TypeScriptをJavaScriptにコンパイル
yarn build

# ビルド成功確認
ls -la dist/index.js
```

---

### Step 6: ドライラン実行（テスト）

実際のアップロードを行わずにスキャン機能をテストします。

```bash
# ドライランモード実行
DRY_RUN=true node dist/index.js scan
```

**期待される出力:**
```
[INFO] Starting Full Scan
[INFO] DRY RUN MODE ENABLED - No actual uploads will be performed
[INFO] Scanning directory: /mnt/nas
[INFO] Scan progress: 10% (1000/10000)
[INFO] Scan progress: 20% (2000/10000)
...
[INFO] Scan completed:
[INFO]   Total files: 10000
[INFO]   Total size: 150.00 GB
[INFO]   New files: 10000
[INFO] Full scan completed successfully
```

**エラーが出た場合:**

| エラー | 原因 | 対処法 |
|-------|------|--------|
| `ENOENT: no such file or directory` | NASマウントされていない | Step 4を確認 |
| `Access Denied` (AWS) | AWS認証情報が間違い | Step 3.1を確認 |
| `Bucket not found` | S3バケット名が間違い | Step 3.2を確認 |

---

### Step 7: 小規模テスト実行

小さなディレクトリで実際のアップロードをテストします。

```bash
# 特定のサブディレクトリのみスキャン（例）
# 環境変数でパスを一時的に変更
NAS_MOUNT_PATH=/mnt/nas/test-folder node dist/index.js scan
```

**確認項目:**
- [ ] ファイルがS3にアップロードされたか（AWS Console確認）
- [ ] エラーログがないか
- [ ] データベース（./data/scanner.db）が作成されたか

---

### Step 8: 本番フルスキャン実行

⚠️ **重要**: データ量によっては数時間〜数日かかります。

```bash
# フルスキャン開始
node dist/index.js scan

# または、バックグラウンド実行（推奨）
nohup node dist/index.js scan > scan.log 2>&1 &

# 進捗確認
tail -f scan.log
```

**処理時間の目安:**

| ファイル数 | データ量 | 推定時間 |
|----------|---------|---------|
| 10万 | 100GB | 2-3時間 |
| 100万 | 1TB | 12-18時間 |
| 500万 | 5TB | 2-3日 |

---

## 📊 モニタリング

### 進捗確認

```bash
# 統計情報表示
node dist/index.js stats

# ログ確認
tail -f logs/combined.log

# データベース内容確認
sqlite3 data/scanner.db "SELECT COUNT(*) FROM files"
```

### S3アップロード確認

```bash
# AWS CLIでS3確認
aws s3 ls s3://cis-filesearch-s3-landing/ --recursive --human-readable --summarize --profile AdministratorAccess-770923989980

# オブジェクト数確認
aws s3 ls s3://cis-filesearch-s3-landing/ --recursive --profile AdministratorAccess-770923989980 | wc -l
```

---

## 🔄 定期実行設定（オプション）

### 方法1: cronジョブ（推奨）

```bash
# crontabを編集
crontab -e

# 以下を追加（6時間ごとに差分スキャン）
0 */6 * * * cd /path/to/file-scanner && /usr/local/bin/node dist/index.js diff >> logs/cron.log 2>&1
```

### 方法2: File Scanner組み込みスケジューラ

```bash
# スケジュール実行開始（6時間ごと）
node dist/index.js schedule "0 */6 * * *"

# バックグラウンド実行
nohup node dist/index.js schedule "0 */6 * * *" > schedule.log 2>&1 &
```

### 方法3: systemdサービス（Linux推奨）

`/etc/systemd/system/cis-file-scanner.service`を作成:

```ini
[Unit]
Description=CIS File Scanner Service
After=network.target

[Service]
Type=simple
User=scanner
WorkingDirectory=/path/to/file-scanner
ExecStart=/usr/local/bin/node dist/index.js schedule "0 */6 * * *"
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

有効化:
```bash
sudo systemctl daemon-reload
sudo systemctl enable cis-file-scanner
sudo systemctl start cis-file-scanner
sudo systemctl status cis-file-scanner
```

---

## 🛠️ トラブルシューティング

### Issue 1: メモリ不足エラー

```bash
# Node.jsメモリ制限を増やす
NODE_OPTIONS="--max-old-space-size=8192" node dist/index.js scan
```

または`.env`で設定:
```env
MEMORY_LIMIT_MB=8192
```

### Issue 2: アップロード速度が遅い

```env
# 並列数を増やす
S3_UPLOAD_CONCURRENCY=30
SCAN_PARALLELISM=30
```

### Issue 3: データベースロックエラー

```bash
# 既存プロセスを確認
ps aux | grep node

# プロセスを停止
kill -9 [PID]

# データベースを削除して再実行
rm -f data/scanner.db
```

### Issue 4: NAS接続が切れる

```bash
# 自動再マウント設定（/etc/fstab）
192.168.1.100:/volume1 /mnt/nas nfs defaults,auto,nofail 0 0
```

---

## 📞 サポート

問題が発生した場合:

1. **ログを確認**: `logs/error.log`
2. **統計表示**: `node dist/index.js stats`
3. **ドライラン再実行**: `DRY_RUN=true node dist/index.js scan`

---

## ✅ セットアップ完了チェックリスト

- [ ] 依存関係インストール完了
- [ ] `.env`ファイル設定完了
- [ ] AWS認証情報設定完了
- [ ] NASマウント確認完了
- [ ] ビルド成功
- [ ] ドライラン成功
- [ ] 小規模テスト成功
- [ ] 本番フルスキャン実行中/完了
- [ ] 定期実行設定完了（オプション）

---

## 🎉 次のステップ

スキャン完了後:

1. **フロントエンドでの検索テスト**: デプロイ済みUIで検索機能を確認
2. **モニタリング設定**: CloudWatch Alarmsの設定
3. **バックアップ設定**: データベースの定期バックアップ

お疲れ様でした！🚀
