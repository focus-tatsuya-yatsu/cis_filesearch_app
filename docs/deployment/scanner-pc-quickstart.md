# ⚡ Windows スキャナーPC クイックスタートガイド

**対象読者**: とりあえず動かしたい人
**所要時間**: 30-40分
**前提条件**: Windows 11 Pro セットアップ済み、インターネット接続あり

このガイドは最短で動作確認するための簡易版です。詳細は[完全版ガイド](./windows-scanner-pc-setup-guide.md)を参照してください。

---

## 📋 5ステップで開始

### Step 1: ソフトウェアインストール（10分）

**Node.js**
```
ブラウザで https://nodejs.org/ にアクセス
→ LTS版ダウンロード → インストール（デフォルト設定でOK）
```

**Yarn**
```powershell
# PowerShell（管理者権限）で実行
npm install -g yarn
```

**Git for Windows**
```
ブラウザで https://git-scm.com/download/win にアクセス
→ ダウンロード → インストール
重要: "Git Bash Here" オプションを必ずチェック
```

**AWS CLI**
```powershell
# PowerShell（管理者権限）で実行
winget install Amazon.AWSCLI
```

**確認**
```powershell
node --version  # v18以上ならOK
yarn --version  # 1.22.x以上ならOK
git --version   # 2.x.x以上ならOK
aws --version   # 2.x.x以上ならOK
```

---

### Step 2: ファイル転送（5分）

**Git Clone（推奨）**
```bash
# Git Bash起動
cd /c/
mkdir CIS
cd CIS
git clone https://github.com/your-org/cis-filesearch-app.git
cd cis-filesearch-app/frontend/backend/file-scanner
```

**USBメモリ経由（代替）**
```bash
# Mac側でアーカイブ作成
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend/backend/file-scanner
tar -czf ~/Desktop/scanner.tar.gz --exclude='node_modules' --exclude='dist' --exclude='.env' src/ package.json yarn.lock tsconfig.json .env.production *.md

# Windows側で展開（Git Bash）
cd /c/CIS
mkdir file-scanner
cd file-scanner
tar -xzf /d/scanner.tar.gz  # USBがD:の場合
```

---

### Step 3: 設定ファイル作成（10分）

```bash
# Git Bash起動
cd /c/CIS/file-scanner

# 依存関係インストール（5-10分）
yarn install

# 環境設定ファイル作成
cp .env.production .env
notepad .env
```

**.env ファイルの編集内容（最小限）**
```env
# AWS設定
AWS_REGION=ap-northeast-1
S3_BUCKET_NAME=cis-filesearch-s3-landing
SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-queue

# NAS設定（Windowsドライブレター）
NAS_MOUNT_PATH=Z:\
NAS_PROTOCOL=mounted

# その他はデフォルトのままでOK
```

保存して閉じる（Ctrl+S → 閉じる）

**AWS認証情報設定（重要！）**
```powershell
# PowerShellで実行
aws configure

# 入力:
AWS Access Key ID: [IAMで取得したキー]
AWS Secret Access Key: [IAMで取得したシークレット]
Default region: ap-northeast-1
Default output format: json
```

**NASドライブマッピング**
```powershell
# PowerShellで実行
# 実際のIPアドレス、共有名、ユーザー名、パスワードに置き換え
net use Z: \\192.168.1.100\share /user:admin パスワード /persistent:yes

# 確認
dir Z:\
```

---

### Step 4: ビルド（2分）

```bash
# Git Bash起動
cd /c/CIS/file-scanner

# ビルド
yarn build

# 確認
ls -la dist/index.js
```

---

### Step 5: テスト実行（3分）

**ドライラン（アップロードなし）**
```bash
# Git Bash起動
cd /c/CIS/file-scanner

# テスト実行
DRY_RUN=true node dist/index.js scan
```

**成功すれば以下のような出力:**
```
[INFO] Starting Full Scan
[INFO] DRY RUN MODE ENABLED
[INFO] Scanning directory: Z:\
[INFO] Scan progress: 10% (1000/10000)
...
[INFO] Scan completed successfully
```

---

## 🚀 本番実行

ドライランが成功したら本番スキャンを開始:

```bash
# Git Bash起動
cd /c/CIS/file-scanner

# バックグラウンド実行
nohup node dist/index.js scan > scan.log 2>&1 &

# 進捗確認
tail -f scan.log

# 終了: Ctrl+C
```

---

## ⚠️ よくあるエラー

### エラー1: `node: command not found`
**原因**: Node.jsがインストールされていない
**対処法**: Step 1を実行、PowerShellを再起動

### エラー2: `ENOENT: no such file or directory`
**原因**: NASマウントされていない
**対処法**:
```powershell
net use Z: \\192.168.1.100\share /user:admin パスワード /persistent:yes
dir Z:\  # 確認
```

### エラー3: `Access Denied` (AWS)
**原因**: AWS認証情報が間違い
**対処法**:
```powershell
aws configure  # 再設定
aws s3 ls  # 接続テスト
```

---

## ✅ 次のステップ

クイックスタートが完了したら:

1. **定期実行設定**
   ```powershell
   # タスクスケジューラで6時間ごとに差分スキャン
   # Win + R → taskschd.msc → タスク作成
   ```

2. **セキュリティ強化**
   - [セキュリティチェックリスト](./scanner-pc-security-checklist.md)を確認
   - `.env`ファイルのアクセス権限制限

3. **完全版ガイド確認**
   - [Windows Scanner PC Setup Guide](./windows-scanner-pc-setup-guide.md)
   - 詳細な設定、トラブルシューティング、長期運用方法

---

## 📞 ヘルプ

詳細なドキュメント:
- **完全版ガイド**: `/docs/deployment/windows-scanner-pc-setup-guide.md`
- **セットアップ検証**: `/frontend/backend/file-scanner/verify-setup.ps1`
- **コマンドリファレンス**: `/frontend/backend/file-scanner/QUICK_REFERENCE.md`

お疲れ様でした！🎉
