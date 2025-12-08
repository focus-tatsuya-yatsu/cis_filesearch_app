# 🖥️ Windows 11 Pro スキャナーPC セットアップ完全ガイド

**対象読者**: 初心者〜中級者
**所要時間**: Day 1（4-6時間）+ Day 2（2-3時間）
**前提知識**: 基本的なPC操作ができればOK

このガイドでは、新しいWindows 11 Pro PCを箱から出して、24/7稼働するファイルスキャナーとしてセットアップする全手順を説明します。

---

## 📋 目次

- [Day 1 午前: Windows準備とソフトウェアインストール](#day-1-午前-windows準備とソフトウェアインストール)
- [Day 1 午後: ファイル転送とプロジェクト配置](#day-1-午後-ファイル転送とプロジェクト配置)
- [Day 1 夕方: 環境設定とNAS接続](#day-1-夕方-環境設定とnas接続)
- [Day 1 夜: ビルド＆テスト実行](#day-1-夜-ビルドテスト実行)
- [Day 2: 本番稼働とモニタリング](#day-2-本番稼働とモニタリング)
- [Week 1: 安定化と最適化](#week-1-安定化と最適化)
- [長期運用: メンテナンス計画](#長期運用-メンテナンス計画)
- [トラブルシューティング](#トラブルシューティング)

---

## 🎯 全体の流れ（ビッグピクチャー）

```
📦 箱から出す
    ↓
⚙️ Windows初期設定 (Day 1 午前)
    ↓
💾 ファイル転送 (Day 1 午後)
    ↓
🔧 環境設定 (Day 1 夕方)
    ↓
🧪 テスト実行 (Day 1 夜)
    ↓
🚀 本番稼働 (Day 2)
    ↓
📊 監視・最適化 (Week 1)
    ↓
🔄 定期メンテナンス (長期)
```

---

## Day 1 午前: Windows準備とソフトウェアインストール

**⏱️ 所要時間**: 2-3時間
**📚 必要スキル**: 基本的なPC操作
**✅ 成功基準**: 必須ソフトウェアがすべてインストールされている

### ステップ1-1: Windows 11 Pro 初期設定

1. **PCを箱から出して電源投入**
   ```
   - モニター、キーボード、マウス接続
   - 有線LANケーブル接続（推奨）
   - 電源ON
   ```

2. **Windows 11 セットアップウィザード**
   ```
   ✅ 地域: 日本
   ✅ キーボードレイアウト: 日本語
   ✅ ネットワーク接続: 有線LAN（Wi-Fiよりも安定）
   ✅ Microsoftアカウント: 企業アカウントまたは個人アカウント
   ✅ プライバシー設定: すべて「オフ」推奨（監視PC用途のため）
   ```

3. **Windows Update実行（重要！）**
   ```powershell
   # 設定 → Windows Update → 更新プログラムのチェック
   # すべての更新をインストール（再起動が必要な場合あり）
   ```

   ⚠️ **重要**: セキュリティパッチ適用のため必ず実行してください。

---

### ステップ1-2: 必須ソフトウェアのインストール

#### A. Node.js のインストール

**目的**: ファイルスキャナーの実行環境

```powershell
# 1. ブラウザで以下にアクセス
https://nodejs.org/

# 2. LTS版（Long Term Support）をダウンロード
#    例: v20.11.0 LTS

# 3. インストーラーを実行
#    - すべてデフォルト設定でOK
#    - 「Add to PATH」が必ずチェックされていることを確認

# 4. インストール確認（新しいPowerShellウィンドウで）
node --version
# 期待される出力: v18.20.0 または v20.x.x

npm --version
# 期待される出力: 9.x.x または 10.x.x
```

✅ **成功基準**: `node --version`が正しく表示される

---

#### B. Yarn のインストール

**目的**: パッケージ管理ツール（npmより高速）

```powershell
# 管理者権限でPowerShellを起動
# （スタートメニュー → PowerShell → 右クリック → 管理者として実行）

npm install -g yarn

# インストール確認
yarn --version
# 期待される出力: 1.22.x
```

✅ **成功基準**: `yarn --version`が表示される

---

#### C. Git for Windows のインストール

**目的**: バージョン管理 + Git Bash（Linuxコマンド実行環境）

```powershell
# 1. ブラウザで以下にアクセス
https://git-scm.com/download/win

# 2. 64-bit版インストーラーをダウンロード

# 3. インストーラーを実行
#    【重要な設定】以下を必ず選択:
#    ✅ Select Components: "Git Bash Here" をチェック
#    ✅ Adjusting PATH: "Git from the command line and also from 3rd-party software"
#    ✅ Choosing the default editor: "Use Visual Studio Code" または "Use Notepad"
#    ✅ その他はデフォルトでOK

# 4. インストール確認
git --version
# 期待される出力: git version 2.x.x.windows.x
```

**Git Bash の起動方法**:
```
エクスプローラーで任意のフォルダを開く
→ 右クリック → 「Git Bash Here」
```

✅ **成功基準**: `git --version`が表示され、右クリックメニューに「Git Bash Here」が表示される

---

#### D. AWS CLI のインストール（推奨）

**目的**: AWS認証情報の安全な管理、S3動作確認

```powershell
# 方法1: winget使用（Windows 11推奨）
winget install Amazon.AWSCLI

# 方法2: インストーラーダウンロード
# https://aws.amazon.com/cli/ からダウンロード

# インストール確認
aws --version
# 期待される出力: aws-cli/2.x.x Python/3.x.x Windows/xxx
```

✅ **成功基準**: `aws --version`が表示される

---

#### E. Visual Studio Code のインストール（推奨）

**目的**: `.env`ファイルや設定ファイルの編集

```powershell
# 1. ブラウザで以下にアクセス
https://code.visualstudio.com/

# 2. Windows版をダウンロード＆インストール
#    デフォルト設定でOK

# 3. インストール確認
code --version
```

✅ **成功基準**: VS Codeが起動する

---

### ステップ1-3: Windows セキュリティ設定（30分）

#### A. Windows Defender の有効化確認

```powershell
# 管理者権限でPowerShell起動

# 現在の状態確認
Get-MpComputerStatus

# リアルタイム保護が有効か確認
# RealTimeProtectionEnabled : True であればOK

# 無効の場合は有効化
Set-MpPreference -DisableRealtimeMonitoring $false
```

---

#### B. ファイアウォール ログ有効化

```powershell
# 管理者権限でPowerShell起動

# すべてのプロファイルでログを有効化
Set-NetFirewallProfile -All -LogBlocked True -LogAllowed True

# ログファイル場所（後で確認できます）
# C:\Windows\System32\LogFiles\Firewall\pfirewall.log
```

---

#### C. 定期再起動の設定（セキュリティ更新適用）

```powershell
# 管理者権限でPowerShell起動

# 毎週日曜日の午前3時に再起動
schtasks /create /tn "Weekly Security Reboot" /tr "shutdown /r /f" /sc weekly /d SUN /st 03:00
```

⚠️ **注意**: この設定により、毎週日曜日3時にPCが自動再起動します。

---

### ✅ Day 1 午前 完了チェックリスト

- [ ] Windows 11 Pro セットアップ完了
- [ ] Windows Update 完了
- [ ] Node.js インストール確認（`node --version`）
- [ ] Yarn インストール確認（`yarn --version`）
- [ ] Git for Windows インストール確認（`git --version`）
- [ ] AWS CLI インストール確認（`aws --version`）
- [ ] VS Code インストール確認（任意）
- [ ] Windows Defender 有効
- [ ] ファイアウォールログ有効化
- [ ] 定期再起動設定完了

---

## Day 1 午後: ファイル転送とプロジェクト配置

**⏱️ 所要時間**: 1-2時間
**📚 必要スキル**: ファイル操作、コマンド入力
**✅ 成功基準**: プロジェクトファイルがWindows上に配置され、開ける

### 転送方法の選択

| 方法 | メリット | デメリット | 推奨度 |
|------|---------|----------|--------|
| **Git Clone** | 最も簡単、最新コード取得 | Gitリポジトリが必要 | ⭐⭐⭐⭐⭐ |
| **USBメモリ** | インターネット不要 | 物理的な移動が必要 | ⭐⭐⭐⭐ |
| **ネットワーク共有** | 高速 | ネットワーク設定が必要 | ⭐⭐⭐ |

---

### 方法A: Git Clone（推奨）

**前提条件**: Gitリポジトリが存在する

#### Mac側での準備（リポジトリがない場合）

```bash
# 開発Mac上で実行
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend/backend/file-scanner

# Gitリポジトリ初期化（まだの場合）
git init
git add .
git commit -m "Initial commit for scanner deployment"

# リモートリポジトリにプッシュ（GitHub/GitLab/Bitbucket等）
git remote add origin https://github.com/your-org/cis-filesearch-app.git
git push -u origin main
```

#### Windows側でのクローン

```bash
# Git Bashを起動（スタートメニュー → Git Bash）

# プロジェクトディレクトリ作成
cd /c/
mkdir CIS
cd CIS

# リポジトリをクローン
git clone https://github.com/your-org/cis-filesearch-app.git
cd cis-filesearch-app/frontend/backend/file-scanner

# 確認
ls -la
# src/, package.json, tsconfig.json 等が表示されればOK
```

✅ **成功基準**: `/c/CIS/cis-filesearch-app/frontend/backend/file-scanner` ディレクトリにファイルが存在

---

### 方法B: USBメモリ経由

#### Mac側でのアーカイブ作成

```bash
# 開発Mac上で実行
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend/backend/file-scanner

# 必要なファイルのみアーカイブ作成（不要ファイル除外）
tar -czf ~/Desktop/cis-scanner.tar.gz \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='data' \
  --exclude='logs' \
  --exclude='.env' \
  --exclude='test-data' \
  --exclude='coverage' \
  --exclude='*.log' \
  src/ package.json yarn.lock tsconfig.json .env.production *.md

# デスクトップに cis-scanner.tar.gz が作成される
# このファイルをUSBメモリにコピー
```

#### Windows側での展開

```bash
# Git Bashを起動

# プロジェクトディレクトリ作成
cd /c/
mkdir -p CIS/file-scanner
cd CIS/file-scanner

# USBメモリがDドライブの場合
tar -xzf /d/cis-scanner.tar.gz

# 確認
ls -la
# src/, package.json 等が表示されればOK
```

✅ **成功基準**: `/c/CIS/file-scanner` ディレクトリにファイルが存在

---

### ✅ Day 1 午後 完了チェックリスト

- [ ] プロジェクトディレクトリ作成完了（`C:\CIS\file-scanner`）
- [ ] ソースコード転送完了（`src/` フォルダ存在確認）
- [ ] `package.json` と `yarn.lock` 存在確認
- [ ] `.env.production` 存在確認
- [ ] ドキュメント類存在確認（README.md, SETUP_PRODUCTION.md）
- [ ] `node_modules`, `dist` が **存在しない**ことを確認（重要）

---

## Day 1 夕方: 環境設定とNAS接続

**⏱️ 所要時間**: 1-2時間
**📚 必要スキル**: テキスト編集、ネットワーク基礎知識
**✅ 成功基準**: NASにアクセスでき、AWS認証情報が設定されている

### ステップ3-1: 依存関係のインストール

```bash
# Git Bash起動
cd /c/CIS/file-scanner

# 依存パッケージをインストール（5-10分かかります）
yarn install

# エラーが出なければ成功
# node_modules/ フォルダが作成される
```

**よくあるエラーと対処法**:

| エラーメッセージ | 原因 | 対処法 |
|----------------|------|--------|
| `node-gyp` エラー | Visual Studio Build Toolsが不足 | `npm install -g windows-build-tools` |
| `EPERM` エラー | ウイルススキャン干渉 | Windows Defenderの例外に追加 |
| ネットワークタイムアウト | プロキシ設定 | `yarn config set proxy http://proxy:port` |

---

### ステップ3-2: .env ファイルの作成

```bash
# Git Bash起動
cd /c/CIS/file-scanner

# .env.productionをコピー
cp .env.production .env

# VS Codeで編集
code .env

# または Git Bash内蔵エディタで編集
vi .env
```

#### .env ファイル設定内容

```env
# ==========================================
# CIS File Scanner - Production Configuration
# ==========================================

# Node Environment
NODE_ENV=production

# ==========================================
# AWS Configuration
# ==========================================

# AWS Region (Tokyo)
AWS_REGION=ap-northeast-1

# ⚠️ 認証情報はAWS CLIで管理（後述）
# AWS_ACCESS_KEY_ID=  # ← ここには何も書かない！
# AWS_SECRET_ACCESS_KEY=  # ← ここには何も書かない！

# ==========================================
# S3 Configuration
# ==========================================

# S3 Bucket Name
S3_BUCKET_NAME=cis-filesearch-s3-landing

# S3 Upload Performance
S3_UPLOAD_CONCURRENCY=20
S3_MULTIPART_THRESHOLD_MB=100
S3_MULTIPART_CHUNK_SIZE_MB=20

# ==========================================
# SQS Configuration
# ==========================================

# SQS Queue URL（AWS Consoleで取得）
SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-queue

# ==========================================
# NAS Configuration（Windows用）
# ==========================================

# NASマウントパス（ネットワークドライブ）
NAS_MOUNT_PATH=Z:\

# NASプロトコル
NAS_PROTOCOL=mounted

# ==========================================
# Scanning Configuration
# ==========================================

SCAN_BATCH_SIZE=1000
SCAN_PARALLELISM=20
SCAN_EXCLUDE_PATTERNS=.git,node_modules,.DS_Store,Thumbs.db,System Volume Information,RECYCLE.BIN
SCAN_MAX_FILE_SIZE_MB=5000

# ==========================================
# Database Configuration
# ==========================================

DB_PATH=./data/scanner.db

# ==========================================
# Logging Configuration
# ==========================================

LOG_LEVEL=info
LOG_DIR=./logs
LOG_MAX_FILES=30
LOG_MAX_SIZE=50m

# ==========================================
# Performance Configuration
# ==========================================

MEMORY_LIMIT_MB=4096
CPU_CORES=4

# ==========================================
# Monitoring
# ==========================================

ENABLE_CLOUDWATCH=true
CLOUDWATCH_NAMESPACE=CIS/FileScanner
CLOUDWATCH_METRIC_INTERVAL_SECONDS=60

# ==========================================
# Operational Flags
# ==========================================

DRY_RUN=false
```

保存して閉じる（VS Code: `Ctrl+S` → 閉じる）

---

### ステップ3-3: AWS認証情報の安全な設定

**🔒 セキュリティ重要**: `.env`ファイルに認証情報を書くのはNG！

#### AWS CLI で認証情報を暗号化保存

```powershell
# PowerShellを起動

# AWS CLI設定（対話式）
aws configure

# 以下のように入力:
AWS Access Key ID [None]: AKIA...................  # IAMで取得したアクセスキー
AWS Secret Access Key [None]: ..................  # IAMで取得したシークレットキー
Default region name [None]: ap-northeast-1
Default output format [None]: json
```

**認証情報の保存場所**:
```
C:\Users\<ユーザー名>\.aws\credentials
```

このファイルはWindows DPAPIにより暗号化されます。

#### 接続テスト

```powershell
# S3バケット一覧取得
aws s3 ls

# 特定のバケットアクセステスト
aws s3 ls s3://cis-filesearch-s3-landing/

# 成功すれば認証情報が正しく設定されています
```

✅ **成功基準**: `aws s3 ls`でバケット一覧が表示される

---

### ステップ3-4: NASネットワークドライブのマッピング

#### PowerShellでマッピング

```powershell
# PowerShellを起動

# 構文: net use [ドライブレター]: \\NASサーバー\共有名 /user:ユーザー名 パスワード /persistent:yes

# 例: NASサーバーが192.168.1.100、共有名がshare、Z:ドライブにマッピング
net use Z: \\192.168.1.100\share /user:admin P@ssw0rd /persistent:yes

# 成功メッセージ
# コマンドは正常に終了しました。
```

**パラメータ説明**:
- `Z:` - ドライブレター（Z以外でもOK、A-Z任意）
- `\\192.168.1.100\share` - NASのUNCパス
- `/user:admin` - NASのユーザー名
- `P@ssw0rd` - NASのパスワード
- `/persistent:yes` - 再起動後も自動接続

#### GUIでマッピング（初心者向け）

1. **エクスプローラーを開く**
2. **左メニュー「PC」を右クリック → 「ネットワークドライブの割り当て」**
3. **設定画面**:
   - ドライブ: `Z:`
   - フォルダー: `\\192.168.1.100\share`
   - ✅ 「別の資格情報を使用して接続する」にチェック
   - ✅ 「ログオン時に再接続する」にチェック
4. **ユーザー名とパスワードを入力**
5. **「完了」をクリック**

#### 接続確認

```powershell
# PowerShellまたはGit Bash

# Z:ドライブの内容確認
dir Z:\

# ファイル数確認
dir Z:\ | Measure-Object

# 正常にファイルが表示されればOK
```

✅ **成功基準**: `dir Z:\` でNAS内のファイル/フォルダが表示される

---

### ステップ3-5: .env ファイルのアクセス権限設定（セキュリティ）

```powershell
# 管理者権限でPowerShellを起動

# プロジェクトディレクトリに移動
cd C:\CIS\file-scanner

# 継承を無効化し、現在のユーザーのみ読み取り許可
icacls .env /inheritance:r
icacls .env /grant:r "$env:USERNAME:(R)"
icacls .env /grant:r "SYSTEM:(F)"
icacls .env /grant:r "Administrators:(F)"

# 確認
icacls .env
```

✅ **成功基準**: `.env`のアクセス許可が制限されている

---

### ✅ Day 1 夕方 完了チェックリスト

- [ ] `yarn install` 完了（`node_modules/`存在確認）
- [ ] `.env` ファイル作成・編集完了
- [ ] AWS認証情報設定完了（AWS CLIで保存）
- [ ] `aws s3 ls` でバケット一覧表示
- [ ] NASネットワークドライブマッピング完了（Z:）
- [ ] `dir Z:\` でNASファイル表示
- [ ] `.env` ファイルのアクセス権限制限完了

---

## Day 1 夜: ビルド＆テスト実行

**⏱️ 所要時間**: 30分-1時間
**📚 必要スキル**: コマンド実行、ログ確認
**✅ 成功基準**: ドライラン実行が成功し、エラーなく完了

### ステップ4-1: TypeScriptビルド

```bash
# Git Bash起動
cd /c/CIS/file-scanner

# TypeScriptをJavaScriptにコンパイル
yarn build

# 成功すると以下のようなメッセージ
# ✔ Build completed successfully
# dist/ フォルダが作成される
```

**ビルド確認**:
```bash
# dist/index.js が存在するか確認
ls -la dist/index.js

# ファイルサイズを確認（数十KB程度）
```

✅ **成功基準**: `dist/index.js` が存在し、エラーメッセージがない

---

### ステップ4-2: ドライラン実行（テスト）

**ドライランとは**: 実際のS3アップロードを行わず、スキャン機能のみをテストするモード

```bash
# Git Bash起動
cd /c/CIS/file-scanner

# ドライランモードで実行
DRY_RUN=true node dist/index.js scan
```

**期待される出力**:
```
[INFO] Starting Full Scan
[INFO] DRY RUN MODE ENABLED - No actual uploads will be performed
[INFO] Scanning directory: Z:\
[INFO] Adapter: WindowsMountedAdapter initialized
[INFO] Database initialized: C:\CIS\file-scanner\data\scanner.db
[INFO] Scan progress: 10% (1,000/10,000 files)
[INFO] Scan progress: 20% (2,000/10,000 files)
...
[INFO] Scan completed:
[INFO]   Total files: 10,000
[INFO]   Total size: 150.00 GB
[INFO]   New files: 10,000
[INFO]   Modified files: 0
[INFO]   Deleted files: 0
[INFO] Full scan completed successfully in 5m 32s
```

---

### トラブルシューティング（ドライラン失敗時）

| エラーメッセージ | 原因 | 対処法 |
|----------------|------|--------|
| `ENOENT: no such file or directory` | NASマウントされていない | ステップ3-4を確認 |
| `Access Denied` (AWS) | AWS認証情報が間違い | ステップ3-3を確認、`aws configure`再実行 |
| `Cannot find module` | ビルドされていない | `yarn build`を再実行 |
| `Database is locked` | 既存プロセスが実行中 | `taskkill /F /IM node.exe` で強制終了 |
| `Out of memory` | メモリ不足 | `.env`で`MEMORY_LIMIT_MB=8192`に増やす |

---

### ステップ4-3: 小規模テスト（実際のアップロード）

ドライランが成功したら、小規模なディレクトリで実際のアップロードをテストします。

```bash
# Git Bash起動
cd /c/CIS/file-scanner

# 特定のサブフォルダのみスキャン（例: Z:\test-folder）
NAS_MOUNT_PATH=Z:\\test-folder node dist/index.js scan
```

**確認項目**:

1. **S3バケット確認**
```powershell
# PowerShellで実行
aws s3 ls s3://cis-filesearch-s3-landing/

# アップロードされたファイルが表示されればOK
```

2. **データベース確認**
```bash
# Git Bashで実行
ls -la data/scanner.db

# ファイルが存在すればOK
```

3. **ログ確認**
```bash
# エラーログを確認
cat logs/error.log

# エラーがなければOK
```

✅ **成功基準**:
- S3にファイルがアップロードされている
- `data/scanner.db` が作成されている
- `logs/error.log` にエラーがない

---

### ✅ Day 1 夜 完了チェックリスト

- [ ] `yarn build` 成功（`dist/index.js`存在）
- [ ] ドライラン実行成功（エラーなし）
- [ ] 小規模テスト実行成功
- [ ] S3バケットにファイルアップロード確認
- [ ] `data/scanner.db` 作成確認
- [ ] ログファイルにエラーなし

---

## Day 2: 本番稼働とモニタリング

**⏱️ 所要時間**: 2-3時間（スキャン時間除く）
**📚 必要スキル**: バックグラウンド実行、ログ監視
**✅ 成功基準**: 本番スキャンが開始され、進捗が確認できる

### ステップ5-1: 本番フルスキャン実行

**⚠️ 注意**: データ量によっては数時間〜数日かかります。

#### 処理時間の目安

| ファイル数 | データ量 | 推定時間 |
|----------|---------|---------|
| 10万 | 100GB | 2-3時間 |
| 100万 | 1TB | 12-18時間 |
| 500万 | 5TB | 2-3日 |

#### フォアグラウンド実行（テスト用）

```bash
# Git Bash起動
cd /c/CIS/file-scanner

# フォアグラウンドで実行（ターミナルを閉じると停止）
node dist/index.js scan
```

#### バックグラウンド実行（本番推奨）

**方法1: nohup使用（Linux風）**
```bash
# Git Bash起動
cd /c/CIS/file-scanner

# バックグラウンド実行（ターミナルを閉じても継続）
nohup node dist/index.js scan > scan.log 2>&1 &

# プロセスID（PID）が表示される
# [1] 12345

# 進捗確認
tail -f scan.log

# 終了するには Ctrl+C
```

**方法2: PowerShellのStart-Job使用**
```powershell
# PowerShellを起動
cd C:\CIS\file-scanner

# バックグラウンドジョブとして実行
Start-Job -ScriptBlock { node dist/index.js scan }

# ジョブ一覧確認
Get-Job

# ジョブのログ確認
Receive-Job -Id 1 -Keep

# ジョブ停止
Stop-Job -Id 1
Remove-Job -Id 1
```

**方法3: Windowsサービス化（長期運用推奨）**
```powershell
# NSSM (Non-Sucking Service Manager)を使用
# https://nssm.cc/download からダウンロード

# 管理者権限でPowerShell起動
cd C:\nssm\win64

# サービスインストール
.\nssm.exe install CISFileScanner "C:\Program Files\nodejs\node.exe" "C:\CIS\file-scanner\dist\index.js"
.\nssm.exe set CISFileScanner AppDirectory "C:\CIS\file-scanner"
.\nssm.exe set CISFileScanner AppStdout "C:\CIS\file-scanner\logs\service-stdout.log"
.\nssm.exe set CISFileScanner AppStderr "C:\CIS\file-scanner\logs\service-stderr.log"

# サービス開始
.\nssm.exe start CISFileScanner

# サービス状態確認
.\nssm.exe status CISFileScanner
```

---

### ステップ5-2: 進捗モニタリング

#### リアルタイムログ確認

```bash
# Git Bash起動

# 全ログ確認
tail -f logs/combined.log

# エラーログのみ確認
tail -f logs/error.log
```

#### 統計情報表示

```bash
# Git Bash起動
cd /c/CIS/file-scanner

# 統計情報を表示
node dist/index.js stats
```

**期待される出力**:
```
=== File Scanner Statistics ===

Database: C:\CIS\file-scanner\data\scanner.db

Total Files: 125,432
Total Size: 2.34 TB
Last Scan: 2025-11-12 14:35:22

File Types:
  .pdf: 42,154 (33.6%)
  .docx: 28,921 (23.0%)
  .xlsx: 15,678 (12.5%)
  .jpg: 12,543 (10.0%)
  .png: 9,876 (7.9%)

Recent Scan History:
  2025-11-12 14:35:22 - Completed - 125,432 files (2.34 TB)
  2025-11-11 09:15:10 - Completed - 120,005 files (2.28 TB)
```

#### データベース内容確認

```bash
# SQLiteクライアントでデータベース確認
# （SQLite Browserインストール推奨）

# コマンドラインで確認
sqlite3 data/scanner.db "SELECT COUNT(*) FROM files"

# 最近のスキャン履歴
sqlite3 data/scanner.db "SELECT * FROM scan_history ORDER BY scan_time DESC LIMIT 5"
```

---

### ステップ5-3: 定期実行設定（Windowsタスクスケジューラ）

**目的**: 6時間ごとに差分スキャンを自動実行

#### GUIで設定（初心者向け）

1. **タスクスケジューラを開く**
   ```
   Win + R → taskschd.msc → Enter
   ```

2. **新しいタスクを作成**
   - 右メニュー → 「タスクの作成」

3. **全般タブ**
   - 名前: `CIS File Scanner - Differential Scan`
   - 説明: `6時間ごとに差分スキャンを実行`
   - セキュリティオプション: `ユーザーがログオンしているかどうかにかかわらず実行する`
   - ✅ `最上位の特権で実行する`

4. **トリガータブ**
   - 「新規」をクリック
   - タスクの開始: `スケジュールに従う`
   - 設定: `毎日`
   - 繰り返し間隔: `6時間`
   - 継続時間: `無期限`

5. **操作タブ**
   - 「新規」をクリック
   - プログラム/スクリプト: `C:\Program Files\nodejs\node.exe`
   - 引数の追加: `dist\index.js diff`
   - 開始: `C:\CIS\file-scanner`

6. **条件タブ**
   - ✅ 「コンピューターをAC電源で使用している場合のみタスクを開始する」の**チェックを外す**

7. **設定タブ**
   - ✅ 「タスクが失敗した場合の再起動の間隔」: `1分`
   - ✅ 「タスクを停止するまでの時間」: `3日`

8. **「OK」をクリック**
   - ユーザー名とパスワードを入力（Windowsログインパスワード）

#### PowerShellで自動作成

```powershell
# 管理者権限でPowerShell起動

# タスク作成スクリプト
$action = New-ScheduledTaskAction -Execute "C:\Program Files\nodejs\node.exe" `
  -Argument "dist\index.js diff" `
  -WorkingDirectory "C:\CIS\file-scanner"

$trigger = New-ScheduledTaskTrigger -Daily -At "00:00" -RepetitionInterval (New-TimeSpan -Hours 6)

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName "CIS File Scanner - Differential Scan" `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "6時間ごとに差分スキャンを実行" `
  -User "SYSTEM" `
  -RunLevel Highest
```

#### タスク動作確認

```powershell
# PowerShellで実行

# タスク一覧確認
Get-ScheduledTask | Where-Object {$_.TaskName -like "*CIS*"}

# 手動実行してテスト
Start-ScheduledTask -TaskName "CIS File Scanner - Differential Scan"

# タスク履歴確認
Get-ScheduledTaskInfo -TaskName "CIS File Scanner - Differential Scan"
```

---

### ✅ Day 2 完了チェックリスト

- [ ] 本番フルスキャン実行開始
- [ ] バックグラウンド実行設定完了
- [ ] ログ監視方法確認
- [ ] 統計情報表示確認（`node dist/index.js stats`）
- [ ] データベース作成確認（`data/scanner.db`）
- [ ] 定期実行タスク設定完了（タスクスケジューラ）
- [ ] タスク手動実行テスト成功

---

## Week 1: 安定化と最適化

**⏱️ 所要時間**: 1日30分〜1時間の監視
**📚 必要スキル**: ログ分析、パフォーマンスチューニング
**✅ 成功基準**: エラーなく安定稼働、パフォーマンスが最適化されている

### 日次確認タスク

#### Day 3-7: 毎日の確認項目

```bash
# 1. ログ確認（エラーがないか）
tail -n 100 logs/error.log

# 2. 統計情報確認
node dist/index.js stats

# 3. S3アップロード確認
aws s3 ls s3://cis-filesearch-s3-landing/ --recursive --summarize

# 4. ディスク容量確認
df -h

# 5. プロセス確認（サービスが動いているか）
Get-Process | Where-Object {$_.ProcessName -eq "node"}
```

---

### パフォーマンスチューニング

#### メモリ不足の場合

`.env`ファイルを編集:
```env
# メモリ制限を8GBに増やす
MEMORY_LIMIT_MB=8192
```

#### アップロード速度が遅い場合

`.env`ファイルを編集:
```env
# 並列数を増やす
S3_UPLOAD_CONCURRENCY=30
SCAN_PARALLELISM=30
```

#### データベースロックエラーが頻発する場合

```bash
# 既存プロセスを確認
tasklist | findstr node

# プロセスを停止
taskkill /F /PID [PID番号]

# データベースを削除して再実行
rm data/scanner.db
node dist/index.js scan
```

---

### ✅ Week 1 完了チェックリスト

- [ ] 7日間エラーなく稼働
- [ ] 定期差分スキャンが正常動作
- [ ] パフォーマンスチューニング完了
- [ ] ディスク容量に余裕あり（90%以下）
- [ ] CloudWatchメトリクス送信確認（AWS Console）

---

## 長期運用: メンテナンス計画

### 週次タスク（毎週月曜日）

- [ ] エラーログ確認（`logs/error.log`）
- [ ] ディスク容量確認（`df -h`）
- [ ] Windows Update実行
- [ ] データベースバックアップ

```powershell
# データベースバックアップスクリプト
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item "C:\CIS\file-scanner\data\scanner.db" "C:\Backups\CIS\scanner_$timestamp.db"
```

### 月次タスク（毎月1日）

- [ ] Node.js/Yarn/パッケージ更新確認
- [ ] AWS認証情報ローテーション（セキュリティ）
- [ ] パフォーマンスレポート作成
- [ ] 古いログ削除（30日以上前）

```bash
# 古いログ削除
find logs/ -name "*.log" -mtime +30 -delete
```

### 四半期タスク（3ヶ月ごと）

- [ ] セキュリティ監査（`scanner-pc-security-checklist.md`参照）
- [ ] データベース最適化（`VACUUM`）
- [ ] 災害復旧テスト

---

## トラブルシューティング

### Issue 1: スキャンが途中で止まる

**症状**: スキャンが進まなくなる

**原因と対処法**:

| 原因 | 確認方法 | 対処法 |
|------|---------|--------|
| メモリ不足 | タスクマネージャー | `.env`で`MEMORY_LIMIT_MB=8192`に増やす |
| NAS接続切断 | `dir Z:\` | ネットワークドライブ再接続 |
| ディスク容量不足 | `df -h` | 古いログ削除、データベースVACUUM |

```bash
# プロセス強制終了
taskkill /F /IM node.exe

# 再実行（差分スキャン）
node dist/index.js diff
```

---

### Issue 2: AWS認証エラー

**症状**: `Access Denied` または `Invalid credentials`

**対処法**:
```powershell
# 認証情報再設定
aws configure

# 接続テスト
aws s3 ls s3://cis-filesearch-s3-landing/

# IAM権限確認（AWS Console）
# S3: PutObject, GetObject, ListBucket
# SQS: SendMessage, GetQueueUrl
# CloudWatch: PutMetricData
```

---

### Issue 3: NAS接続エラー

**症状**: `ENOENT: no such file or directory` または `Access Denied`

**対処法**:
```powershell
# ネットワークドライブ確認
net use

# 再マッピング
net use Z: /delete
net use Z: \\192.168.1.100\share /user:admin パスワード /persistent:yes

# アクセステスト
dir Z:\
```

---

### Issue 4: データベースロックエラー

**症状**: `database is locked`

**対処法**:
```bash
# 実行中のプロセス確認
tasklist | findstr node

# プロセス停止
taskkill /F /PID [PID]

# データベースファイル確認
ls -la data/scanner.db

# 破損している場合は削除して再スキャン
rm data/scanner.db
node dist/index.js scan
```

---

## 📞 サポート・ヘルプ

### ドキュメント参照

- **詳細セットアップ**: `/backend/file-scanner/SETUP_PRODUCTION.md`
- **コマンドリファレンス**: `/backend/file-scanner/QUICK_REFERENCE.md`
- **セキュリティ**: `/docs/deployment/scanner-pc-security-checklist.md`
- **クイックスタート**: `/docs/deployment/scanner-pc-quickstart.md`

### よくある質問

**Q: スキャンにどのくらい時間がかかりますか？**
A: ファイル数とデータ量によります。100万ファイル・1TBで12-18時間程度です。

**Q: スキャン中にPCを使えますか？**
A: 使えますが、バックグラウンド実行推奨です。CPUとネットワークを使用するため、他の作業に影響する可能性があります。

**Q: エラーが出たファイルはどうなりますか？**
A: `error_logs`テーブルに記録され、再実行時に再試行されます。

**Q: 差分スキャンはどのように動作しますか？**
A: データベースの最終更新日時と実際のファイルの更新日時を比較し、変更されたファイルのみを処理します。

---

## ✅ 最終確認チェックリスト

### セットアップ完了

- [ ] Windows 11 Pro セットアップ完了
- [ ] すべての必須ソフトウェアインストール完了
- [ ] プロジェクトファイル転送完了
- [ ] `.env` 設定完了
- [ ] AWS認証情報設定完了（AWS CLI）
- [ ] NASドライブマッピング完了
- [ ] ビルド成功
- [ ] ドライラン成功
- [ ] 小規模テスト成功
- [ ] 本番フルスキャン実行開始

### セキュリティ

- [ ] Windows Defender有効
- [ ] ファイアウォールログ有効
- [ ] `.env`ファイルアクセス権限制限
- [ ] AWS認証情報暗号化保存（`.env`に平文なし）
- [ ] NAS認証情報Windows認証情報マネージャーに保存
- [ ] 定期再起動設定完了

### 運用

- [ ] 定期実行タスク設定完了（タスクスケジューラ）
- [ ] ログ監視方法確認
- [ ] バックアップスクリプト作成
- [ ] トラブルシューティング手順確認

---

## 🎉 おめでとうございます！

スキャナーPCのセットアップが完了しました！

次のステップ:
1. 本番スキャン完了を待つ
2. フロントエンドUIで検索機能をテスト
3. CloudWatchでメトリクスを監視
4. 週次・月次メンテナンス計画に従って運用

お疲れ様でした！🚀
