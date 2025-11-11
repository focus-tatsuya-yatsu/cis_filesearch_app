# CIS File Search Application - フロントエンド手動デプロイガイド

**バージョン**: 1.0.0
**最終更新日**: 2025-01-07
**対象環境**: 本番環境（Production）
**推定所要時間**: 初回 2.5時間 / 2回目以降 1.5時間

---

## 📋 目次

1. [概要](#1-概要)
2. [前提条件](#2-前提条件)
3. [デプロイ準備](#3-デプロイ準備)
4. [環境変数の設定](#4-環境変数の設定)
5. [Next.jsプロジェクトのビルド](#5-nextjsプロジェクトのビルド)
6. [S3バケットの準備](#6-s3バケットの準備)
7. [ファイルのアップロード](#7-ファイルのアップロード)
8. [CloudFrontの設定](#8-cloudfrontの設定)
9. [Cognitoの設定](#9-cognitoの設定)
10. [動作確認](#10-動作確認)
11. [トラブルシューティング](#11-トラブルシューティング)
12. [ロールバック手順](#12-ロールバック手順)

---

## 1. 概要

このガイドでは、CIS File Search ApplicationのフロントエンドをAWS S3 + CloudFrontにデプロイする手順を説明します。

### 1.1 デプロイ構成

```
┌─────────────────┐
│     ユーザー      │
└────────┬────────┘
         │ HTTPS
         ▼
┌─────────────────┐
│   CloudFront    │ ◄─ セキュリティヘッダー
└────────┬────────┘
         │ OAC
         ▼
┌─────────────────┐
│  S3 バケット     │ ◄─ 静的ファイル (Next.js)
└─────────────────┘
         │
         ▼
┌─────────────────┐
│   Cognito       │ ◄─ OAuth 2.0 認証
└─────────────────┘
```

### 1.2 デプロイの流れ

```
準備 → ビルド → アップロード → 設定 → テスト
```

**各ステップの詳細**:

1. **準備** (20分): 環境変数の設定、バックアップ作成
2. **ビルド** (10分): Next.jsプロジェクトの静的エクスポート
3. **アップロード** (30分): S3バケットへのファイルアップロード
4. **設定** (40分): CloudFront、Cognito、セキュリティヘッダー
5. **テスト** (20分): ログイン、表示、パフォーマンス確認

**合計**: 約2時間

---

## 2. 前提条件

### 2.1 必要なツール

| ツール | バージョン | 確認コマンド | インストール方法 |
|---|---|---|---|
| Node.js | 18.x以上 | `node --version` | [公式サイト](https://nodejs.org/) |
| Yarn | 1.22以上 | `yarn --version` | `npm install -g yarn` |
| AWS CLI | 2.x以上 | `aws --version` | [公式ガイド](https://aws.amazon.com/cli/) |
| Git | 2.x以上 | `git --version` | [公式サイト](https://git-scm.com/) |

**インストール確認例**:

```bash
# すべてのツールを確認
node --version  # v18.17.0
yarn --version  # 1.22.19
aws --version   # aws-cli/2.13.5
git --version   # git version 2.39.0
```

### 2.2 AWSアクセス権限

以下のAWSサービスへのアクセス権限が必要です:

- ✅ **S3**: バケットの作成、ファイルのアップロード、ポリシー設定
- ✅ **CloudFront**: Distribution設定、Invalidation実行
- ✅ **Cognito**: User Pool設定、App Client設定
- ✅ **IAM**: 必要に応じてロール確認（読み取りのみ）

**権限確認方法**:

```bash
# AWS認証情報の確認
aws sts get-caller-identity

# 期待される出力
{
    "UserId": "AIDACKCEVSQ6C2EXAMPLE",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/your-username"
}
```

### 2.3 既存のAWSリソース

以下のリソースがAWS Consoleで既に作成されていることを前提とします:

| リソース | 確認方法 | 備考 |
|---|---|---|
| **S3バケット** | S3コンソール | `cis-filesearch-frontend-prod` |
| **CloudFront Distribution** | CloudFrontコンソール | Distribution ID: `E1234...` |
| **Cognito User Pool** | Cognitoコンソール | Pool ID: `ap-northeast-1_XXX` |
| **Route53ドメイン** | Route53コンソール | (オプション) |
| **ACM証明書** | Certificate Managerコンソール | (オプション) |

**確認コマンド**:

```bash
# S3バケットの確認
aws s3 ls | grep cis-filesearch

# CloudFront Distributionの確認
aws cloudfront list-distributions --query "DistributionList.Items[].{Id:Id,DomainName:DomainName}" --output table

# Cognito User Poolの確認
aws cognito-idp list-user-pools --max-results 10 --query "UserPools[].{Name:Name,Id:Id}" --output table
```

---

## 3. デプロイ準備

### 3.1 バックアップの作成

**重要**: デプロイ前に必ず現在のS3バケットをバックアップしてください。

#### ステップ1: バックアップディレクトリの作成

```bash
# バックアップディレクトリを作成
mkdir -p ~/backups/cis-filesearch-frontend
cd ~/backups/cis-filesearch-frontend

# 現在の日時をファイル名に使用
BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
echo "バックアップ日時: $BACKUP_DATE"
```

#### ステップ2: S3バケットの内容をダウンロード

```bash
# S3バケット全体をダウンロード
aws s3 sync s3://cis-filesearch-frontend-prod ./backup_${BACKUP_DATE}/

# 出力例:
# download: s3://cis-filesearch-frontend-prod/_next/static/chunks/main.js to backup_20250107_120000/_next/static/chunks/main.js
# download: s3://cis-filesearch-frontend-prod/index.html to backup_20250107_120000/index.html
# ...
# Completed 245 file(s) in 15.3 seconds
```

#### ステップ3: バックアップの確認

```bash
# バックアップされたファイル数を確認
ls -R ./backup_${BACKUP_DATE}/ | wc -l

# ディスク使用量を確認
du -sh ./backup_${BACKUP_DATE}/
# 例: 45M    ./backup_20250107_120000/
```

#### ステップ4: バックアップの圧縮（オプション）

```bash
# バックアップを圧縮（ストレージ節約）
tar -czf backup_${BACKUP_DATE}.tar.gz ./backup_${BACKUP_DATE}/

# 圧縮後のサイズ確認
ls -lh backup_${BACKUP_DATE}.tar.gz
# 例: -rw-r--r-- 1 user staff 8.5M Jan 7 12:00 backup_20250107_120000.tar.gz
```

**📸 スクリーンショット挿入ポイント1**: バックアップディレクトリの内容

---

### 3.2 プロジェクトのクローン

#### ステップ1: 作業ディレクトリに移動

```bash
# ホームディレクトリに移動
cd ~

# プロジェクト用ディレクトリを作成
mkdir -p projects
cd projects
```

#### ステップ2: Gitリポジトリのクローン

```bash
# リポジトリをクローン（HTTPSの場合）
git clone https://github.com/your-org/cis_filesearch_app.git

# または、SSHの場合
git clone git@github.com:your-org/cis_filesearch_app.git

# プロジェクトディレクトリに移動
cd cis_filesearch_app
```

#### ステップ3: 正しいブランチをチェックアウト

```bash
# 本番環境用のブランチ（例: main）をチェックアウト
git checkout main

# 最新の変更を取得
git pull origin main

# 現在のブランチとコミットを確認
git branch
git log -1
```

**出力例**:

```
* main
commit a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0
Author: Developer <dev@example.com>
Date:   Mon Jan 7 10:00:00 2025 +0900

    fix: resolve vertical text overflow in collapsed sidebar
```

#### ステップ4: フロントエンドディレクトリに移動

```bash
# フロントエンドディレクトリに移動
cd frontend

# ディレクトリ構造を確認
ls -la

# 期待される出力:
# drwxr-xr-x  15 user  staff   480 Jan  7 10:00 .
# drwxr-xr-x   8 user  staff   256 Jan  7 10:00 ..
# -rw-r--r--   1 user  staff   123 Jan  7 10:00 .eslintrc.json
# -rw-r--r--   1 user  staff   456 Jan  7 10:00 .gitignore
# -rw-r--r--   1 user  staff  1234 Jan  7 10:00 next.config.js
# -rw-r--r--   1 user  staff  5678 Jan  7 10:00 package.json
# drwxr-xr-x  10 user  staff   320 Jan  7 10:00 src
# ...
```

**📸 スクリーンショット挿入ポイント2**: フロントエンドディレクトリの構造

---

### 3.3 依存関係のインストール

#### ステップ1: Node.jsバージョンの確認

```bash
# プロジェクトで要求されるNode.jsバージョンを確認
cat .nvmrc
# 例: 18.17.0

# 現在のNode.jsバージョンを確認
node --version
# 例: v18.17.0
```

**注意**: バージョンが一致しない場合、nvmを使用してインストール:

```bash
# nvmがインストールされている場合
nvm install 18.17.0
nvm use 18.17.0
```

#### ステップ2: 依存関係のインストール

```bash
# Yarnで依存関係をインストール
yarn install

# インストール進行中の出力例:
# [1/4] 🔍  Resolving packages...
# [2/4] 🚚  Fetching packages...
# [3/4] 🔗  Linking dependencies...
# [4/4] 🔨  Building fresh packages...
# ✨  Done in 45.32s.
```

#### ステップ3: インストールの確認

```bash
# node_modulesディレクトリの確認
ls -la node_modules | head -20

# インストールされたパッケージ数を確認
ls node_modules | wc -l
# 例: 1234

# 特定の重要パッケージの確認
ls node_modules | grep -E "next|react|aws-amplify"
# 出力例:
# next
# react
# react-dom
# aws-amplify
```

**📸 スクリーンショット挿入ポイント3**: `yarn install` の完了画面

---

## 4. 環境変数の設定

### 4.1 環境変数テンプレートのコピー

#### ステップ1: `.env.local.example` から `.env.local` を作成

```bash
# frontendディレクトリにいることを確認
pwd
# /Users/your-username/projects/cis_filesearch_app/frontend

# テンプレートファイルが存在することを確認
ls -la .env.local.example
# -rw-r--r--  1 user  staff  2345 Jan  7 10:00 .env.local.example

# .env.local ファイルを作成
cp .env.local.example .env.local

# 作成されたことを確認
ls -la .env.local
# -rw-r--r--  1 user  staff  2345 Jan  7 10:00 .env.local
```

#### ステップ2: `.env.local` ファイルを編集

```bash
# VSCodeで開く場合
code .env.local

# vimで開く場合
vim .env.local

# nanoで開く場合
nano .env.local
```

---

### 4.2 Cognito User Pool IDの取得

#### ステップ1: AWS Console でCognitoを開く

1. **AWS Management Console** にログイン
2. サービス検索で **「Cognito」** を入力
3. **Cognito** サービスを選択

**📸 スクリーンショット挿入ポイント4**: AWSコンソールのCognitoサービス画面

#### ステップ2: User Pool IDをコピー

1. 左メニューから **「User pools」** を選択
2. User Pool一覧から **「CIS-FileSearch-UserPool」** を選択
3. **「User pool overview」** セクションで **Pool Id** を確認
4. 例: `ap-northeast-1_abcDEF123`
5. コピーボタンをクリック

**📸 スクリーンショット挿入ポイント5**: User Pool IDのコピー画面

#### ステップ3: `.env.local` に貼り付け

```bash
# .env.local ファイルを編集
nano .env.local
```

**変更前**:
```
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_XXXXXXXXX
```

**変更後**:
```
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_abcDEF123
```

**保存**: `Ctrl + O` → `Enter` → `Ctrl + X`

---

### 4.3 Cognito App Client IDの取得

#### ステップ1: App Client設定を開く

1. 同じUser Pool画面で **「App integration」** タブを選択
2. 下部の **「App clients and analytics」** セクションまでスクロール
3. **「CIS-FileSearch-WebClient」** をクリック

**📸 スクリーンショット挿入ポイント6**: App Clientの選択画面

#### ステップ2: Client IDをコピー

1. **「Client ID」** フィールドを確認
2. 例: `1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p`
3. コピーボタンをクリック

**📸 スクリーンショット挿入ポイント7**: Client IDのコピー画面

#### ステップ3: `.env.local` に貼り付け

```bash
nano .env.local
```

**変更前**:
```
NEXT_PUBLIC_COGNITO_APP_CLIENT_ID=abcd1234efgh5678ijklmnopqrstuvwx
```

**変更後**:
```
NEXT_PUBLIC_COGNITO_APP_CLIENT_ID=1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p
```

---

### 4.4 Cognito Domainの取得

#### ステップ1: Domainセクションを開く

1. 同じ **「App integration」** タブで上部に戻る
2. **「Domain」** セクションを確認
3. **「Cognito domain」** の値を確認
4. 例: `cis-filesearch.auth.ap-northeast-1.amazoncognito.com`

**📸 スクリーンショット挿入ポイント8**: Cognito Domainの確認画面

#### ステップ2: `.env.local` に貼り付け

```bash
nano .env.local
```

**変更前**:
```
NEXT_PUBLIC_COGNITO_DOMAIN=filesearch.auth.ap-northeast-1.amazoncognito.com
```

**変更後**:
```
NEXT_PUBLIC_COGNITO_DOMAIN=cis-filesearch.auth.ap-northeast-1.amazoncognito.com
```

**注意**: `https://` は不要です。ドメイン名のみを設定してください。

---

### 4.5 CloudFront Distribution URLの取得

#### ステップ1: CloudFront Consoleを開く

1. AWS Management Consoleで **「CloudFront」** サービスを選択
2. **「Distributions」** 一覧を確認

**📸 スクリーンショット挿入ポイント9**: CloudFront Distributions一覧画面

#### ステップ2: Distribution Domain Nameをコピー

1. 対象のDistributionを選択
2. **「General」** タブで **「Distribution domain name」** を確認
3. 例: `d1234567890abc.cloudfront.net`
4. コピーボタンをクリック

**📸 スクリーンショット挿入ポイント10**: Distribution Domain Nameのコピー画面

#### ステップ3: `.env.local` に貼り付け

```bash
nano .env.local
```

**変更前**:
```
NEXT_PUBLIC_APP_URL=https://d1234567890.cloudfront.net
```

**変更後**:
```
NEXT_PUBLIC_APP_URL=https://d1234567890abc.cloudfront.net
```

**注意**: 必ず `https://` を含めてください。

---

### 4.6 API Gateway URL の取得（オプション）

#### ステップ1: API Gateway Consoleを開く

1. AWS Management Consoleで **「API Gateway」** サービスを選択
2. **「APIs」** 一覧から **「CIS-FileSearch-API」** を選択

**📸 スクリーンショット挿入ポイント11**: API Gateway APIs一覧画面

#### ステップ2: Invoke URLをコピー

1. 左メニューから **「Stages」** を選択
2. **「prod」** ステージを選択
3. **「Invoke URL」** を確認
4. 例: `https://abcdefghij.execute-api.ap-northeast-1.amazonaws.com/v1`
5. コピーボタンをクリック

**📸 スクリーンショット挿入ポイント12**: Invoke URLのコピー画面

#### ステップ3: `.env.local` に貼り付け

```bash
nano .env.local
```

**変更前**:
```
NEXT_PUBLIC_API_GATEWAY_URL=https://abcdefghij.execute-api.ap-northeast-1.amazonaws.com/v1
```

**変更後**:
```
NEXT_PUBLIC_API_GATEWAY_URL=https://xyz9876543.execute-api.ap-northeast-1.amazonaws.com/v1
```

---

### 4.7 環境変数の最終確認

#### ステップ1: `.env.local` ファイルの内容を表示

```bash
# 環境変数ファイルの内容を確認
cat .env.local

# 期待される出力:
# NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_abcDEF123
# NEXT_PUBLIC_COGNITO_APP_CLIENT_ID=1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p
# NEXT_PUBLIC_COGNITO_DOMAIN=cis-filesearch.auth.ap-northeast-1.amazoncognito.com
# NEXT_PUBLIC_APP_URL=https://d1234567890abc.cloudfront.net
# NEXT_PUBLIC_API_GATEWAY_URL=https://xyz9876543.execute-api.ap-northeast-1.amazonaws.com/v1
```

#### ステップ2: 環境変数のバリデーション

```bash
# Node.jsスクリプトで環境変数をチェック
node -e "
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const lines = env.split('\\n').filter(l => l.trim() && !l.startsWith('#'));

console.log('✅ 設定された環境変数:');
lines.forEach(line => {
  const [key] = line.split('=');
  console.log('  -', key);
});

console.log('\\n✅ 合計:', lines.length, '個');
"

# 期待される出力:
# ✅ 設定された環境変数:
#   - NEXT_PUBLIC_COGNITO_USER_POOL_ID
#   - NEXT_PUBLIC_COGNITO_APP_CLIENT_ID
#   - NEXT_PUBLIC_COGNITO_DOMAIN
#   - NEXT_PUBLIC_APP_URL
#   - NEXT_PUBLIC_API_GATEWAY_URL
#
# ✅ 合計: 5 個
```

**📸 スクリーンショット挿入ポイント13**: 環境変数の最終確認画面

---

## 5. Next.jsプロジェクトのビルド

### 5.1 ビルドの実行

#### ステップ1: ビルドコマンドの実行

```bash
# frontendディレクトリにいることを確認
pwd
# /Users/your-username/projects/cis_filesearch_app/frontend

# ビルドを実行
yarn build

# 出力例（進行状況）:
# info  - Linting and checking validity of types
# info  - Creating an optimized production build
# info  - Compiled successfully
# info  - Collecting page data
# info  - Generating static pages (5/5)
# info  - Finalizing page optimization
#
# Route (app)                              Size     First Load JS
# ┌ ○ /                                    1.23 kB    85.6 kB
# ├ ○ /auth/callback                       892 B      84.2 kB
# ├ ○ /search                              3.45 kB    87.8 kB
# └ ○ /test-dark-mode                      1.56 kB    85.9 kB
# + First Load JS shared by all            83.3 kB
#   ├ chunks/framework.XXXX.js             45.2 kB
#   ├ chunks/main.XXXX.js                  32.1 kB
#   └ other shared chunks (total)          6.0 kB
#
# ○  (Static) prerendered as static content
#
# ✨  Done in 45.67s.
```

**重要なログポイント**:
- ✅ `Compiled successfully`: TypeScriptとESLintのエラーなし
- ✅ `Generating static pages`: すべてのページが静的生成された
- ✅ `Done in XX.XXs`: ビルド完了

**📸 スクリーンショット挿入ポイント14**: ビルド完了画面

---

### 5.2 ビルド成果物の確認

#### ステップ1: `out` ディレクトリの確認

```bash
# outディレクトリが作成されていることを確認
ls -la out/

# 期待される出力:
# drwxr-xr-x  12 user  staff   384 Jan  7 11:00 .
# drwxr-xr-x  15 user  staff   480 Jan  7 11:00 ..
# drwxr-xr-x   5 user  staff   160 Jan  7 11:00 _next
# drwxr-xr-x   3 user  staff    96 Jan  7 11:00 auth
# -rw-r--r--   1 user  staff  5432 Jan  7 11:00 404.html
# -rw-r--r--   1 user  staff  12345 Jan  7 11:00 index.html
# -rw-r--r--   1 user  staff  7890 Jan  7 11:00 search.html
# -rw-r--r--   1 user  staff  4567 Jan  7 11:00 test-dark-mode.html
```

#### ステップ2: ファイル数とサイズの確認

```bash
# ファイル総数を確認
find out -type f | wc -l
# 例: 245

# ディレクトリサイズを確認
du -sh out/
# 例: 45M

# 主要ファイルのサイズを確認
du -sh out/_next/static/chunks/*
# 例:
# 1.2M  out/_next/static/chunks/framework.abc123.js
# 800K  out/_next/static/chunks/main.def456.js
# 450K  out/_next/static/chunks/pages/index.xyz789.js
```

#### ステップ3: HTMLファイルの内容確認

```bash
# index.htmlファイルの先頭20行を確認
head -20 out/index.html

# 期待される内容:
# <!DOCTYPE html>
# <html lang="ja">
# <head>
#   <meta charset="utf-8"/>
#   <meta name="viewport" content="width=device-width, initial-scale=1"/>
#   <title>CIS ファイル検索システム</title>
#   <link rel="preload" href="/_next/static/css/abc123.css" as="style"/>
#   <link rel="stylesheet" href="/_next/static/css/abc123.css" data-n-g=""/>
#   ...
# </head>
# <body>
#   <div id="__next">...</div>
#   <script src="/_next/static/chunks/framework.abc123.js"></script>
#   ...
# </body>
# </html>
```

**📸 スクリーンショット挿入ポイント15**: `out` ディレクトリの内容

---

### 5.3 ビルドエラーの対処

#### よくあるエラー1: TypeScriptエラー

**症状**:
```
Type error: Property 'xxx' does not exist on type 'yyy'
```

**原因**: TypeScriptの型エラー

**解決策**:
```bash
# 型チェックを実行
yarn tsc --noEmit

# エラー箇所を修正後、再ビルド
yarn build
```

---

#### よくあるエラー2: ESLintエラー

**症状**:
```
Error: ESLint: 'xxx' is not defined
```

**原因**: ESLintルール違反

**解決策**:
```bash
# ESLintを実行して詳細を確認
yarn lint

# 自動修正可能なエラーを修正
yarn lint --fix

# 再ビルド
yarn build
```

---

#### よくあるエラー3: 環境変数エラー

**症状**:
```
Error: Missing required environment variables: NEXT_PUBLIC_COGNITO_USER_POOL_ID
```

**原因**: `.env.local` ファイルに必要な環境変数が設定されていない

**解決策**:
```bash
# .env.local ファイルを確認
cat .env.local

# 必要な環境変数を追加
nano .env.local

# 再ビルド
yarn build
```

---

## 6. S3バケットの準備

### 6.1 S3バケットの確認

#### ステップ1: S3コンソールを開く

1. AWS Management Consoleで **「S3」** サービスを選択
2. **「Buckets」** 一覧を確認
3. **「cis-filesearch-frontend-prod」** バケットを探す

**📸 スクリーンショット挿入ポイント16**: S3 Buckets一覧画面

#### ステップ2: バケットの存在確認（AWS CLI）

```bash
# S3バケット一覧を取得
aws s3 ls | grep cis-filesearch

# 期待される出力:
# 2025-01-01 10:00:00 cis-filesearch-frontend-prod
# 2025-01-01 10:00:00 cis-filesearch-landing-prod
```

---

### 6.2 バケットポリシーの設定

#### ステップ1: バケットポリシーファイルの準備

```bash
# プロジェクトルートに移動
cd ~/projects/cis_filesearch_app

# セキュリティドキュメントディレクトリを確認
ls docs/security/

# 期待される出力:
# cloudfront-security-headers-guide.md
# cloudfront-security-headers.json
# s3-bucket-policy-guide.md
# s3-bucket-policy.json
```

#### ステップ2: バケットポリシーの編集

```bash
# バケットポリシーファイルをコピー
cp docs/security/s3-bucket-policy.json ~/s3-bucket-policy-edited.json

# ファイルを編集
nano ~/s3-bucket-policy-edited.json
```

**置換項目**:

1. `YOUR-FRONTEND-BUCKET-NAME` → `cis-filesearch-frontend-prod`
2. `YOUR-AWS-ACCOUNT-ID` → AWSアカウントID（12桁）
3. `YOUR-DISTRIBUTION-ID` → CloudFront Distribution ID

**AWSアカウントIDの確認**:
```bash
aws sts get-caller-identity --query "Account" --output text
# 例: 123456789012
```

**CloudFront Distribution IDの確認**:
```bash
aws cloudfront list-distributions --query "DistributionList.Items[0].Id" --output text
# 例: E1234567890ABC
```

#### ステップ3: バケットポリシーの適用

##### 方法1: AWS CLI で適用

```bash
# バケットポリシーを適用
aws s3api put-bucket-policy \
  --bucket cis-filesearch-frontend-prod \
  --policy file://~/s3-bucket-policy-edited.json

# 適用されたことを確認
aws s3api get-bucket-policy \
  --bucket cis-filesearch-frontend-prod \
  --query Policy \
  --output text | jq .

# 期待される出力: 適用したポリシーのJSON
```

##### 方法2: AWS Consoleで適用

1. S3コンソールで **「cis-filesearch-frontend-prod」** バケットを選択
2. **「Permissions」** タブを選択
3. **「Bucket policy」** セクションで **「Edit」** をクリック
4. 編集したポリシーJSONを貼り付け
5. **「Save changes」** をクリック

**📸 スクリーンショット挿入ポイント17**: バケットポリシーの編集画面

---

### 6.3 パブリックアクセスブロックの設定

#### ステップ1: パブリックアクセスブロックの確認

```bash
# 現在の設定を確認
aws s3api get-public-access-block --bucket cis-filesearch-frontend-prod

# 期待される出力:
# {
#     "PublicAccessBlockConfiguration": {
#         "BlockPublicAcls": true,
#         "IgnorePublicAcls": true,
#         "BlockPublicPolicy": true,
#         "RestrictPublicBuckets": true
#     }
# }
```

#### ステップ2: パブリックアクセスブロックの設定（必要に応じて）

```bash
# すべてのパブリックアクセスをブロック
aws s3api put-public-access-block \
  --bucket cis-filesearch-frontend-prod \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# 設定されたことを確認
aws s3api get-public-access-block --bucket cis-filesearch-frontend-prod
```

**注意**: CloudFront OACを使用する場合、パブリックアクセスブロックを有効にしても問題ありません。

**📸 スクリーンショット挿入ポイント18**: パブリックアクセスブロック設定画面

---

### 6.4 バケットのバージョニング有効化（オプション）

#### ステップ1: バージョニングの確認

```bash
# 現在のバージョニング設定を確認
aws s3api get-bucket-versioning --bucket cis-filesearch-frontend-prod

# 出力例:
# {
#     "Status": "Enabled"
# }
# または
# {}  ← バージョニングが無効の場合
```

#### ステップ2: バージョニングの有効化

```bash
# バージョニングを有効化
aws s3api put-bucket-versioning \
  --bucket cis-filesearch-frontend-prod \
  --versioning-configuration Status=Enabled

# 有効化されたことを確認
aws s3api get-bucket-versioning --bucket cis-filesearch-frontend-prod
# 期待される出力: {"Status": "Enabled"}
```

**メリット**:
- ✅ 誤削除からの復旧
- ✅ 以前のバージョンへのロールバック
- ✅ 変更履歴の追跡

---

## 7. ファイルのアップロード

### 7.1 アップロード前の確認

#### ステップ1: アップロード対象ファイルの確認

```bash
# frontendディレクトリに移動
cd ~/projects/cis_filesearch_app/frontend

# outディレクトリの存在を確認
ls -la out/

# ファイル総数を確認
find out -type f | wc -l
# 例: 245

# 合計サイズを確認
du -sh out/
# 例: 45M
```

#### ステップ2: アップロード前のS3バケット状態確認

```bash
# 現在のS3バケット内容を確認
aws s3 ls s3://cis-filesearch-frontend-prod/ --recursive --summarize

# 出力例:
# 2025-01-06 10:00:00       5432 404.html
# 2025-01-06 10:00:00      12345 index.html
# 2025-01-06 10:00:00     123456 _next/static/chunks/framework.abc123.js
# ...
# Total Objects: 230
# Total Size: 42000000
```

---

### 7.2 S3へのアップロード

#### ステップ1: syncコマンドの実行

```bash
# 静的ファイルをS3バケットにアップロード
aws s3 sync ./out/ s3://cis-filesearch-frontend-prod/ \
  --delete \
  --exclude ".DS_Store" \
  --exclude "*.map" \
  --cache-control "public, max-age=31536000, immutable"

# コマンドオプションの説明:
# --delete: S3にあってローカルにないファイルを削除
# --exclude ".DS_Store": macOSのメタデータファイルを除外
# --exclude "*.map": ソースマップファイルを除外
# --cache-control: キャッシュ制御ヘッダーを設定（1年間キャッシュ）

# 実行中の出力例:
# upload: out/404.html to s3://cis-filesearch-frontend-prod/404.html
# upload: out/index.html to s3://cis-filesearch-frontend-prod/index.html
# upload: out/_next/static/chunks/framework.abc123.js to s3://cis-filesearch-frontend-prod/_next/static/chunks/framework.abc123.js
# upload: out/_next/static/chunks/main.def456.js to s3://cis-filesearch-frontend-prod/_next/static/chunks/main.def456.js
# ...
# upload: out/search.html to s3://cis-filesearch-frontend-prod/search.html
# delete: s3://cis-filesearch-frontend-prod/old-file.js
#
# Total files uploaded: 245
# Total files deleted: 15
# Completed in 35.2 seconds
```

**注意**: 初回アップロードには時間がかかる場合があります（5〜10分程度）。

**📸 スクリーンショット挿入ポイント19**: `aws s3 sync` 実行画面

---

### 7.3 特定ファイルのCache-Controlカスタマイズ

#### ステップ1: HTMLファイルのキャッシュ設定

HTMLファイルは頻繁に更新される可能性があるため、短いキャッシュ時間を設定します。

```bash
# HTMLファイルのCache-Controlを上書き
aws s3 cp s3://cis-filesearch-frontend-prod/index.html \
  s3://cis-filesearch-frontend-prod/index.html \
  --metadata-directive REPLACE \
  --cache-control "public, max-age=0, must-revalidate"

aws s3 cp s3://cis-filesearch-frontend-prod/search.html \
  s3://cis-filesearch-frontend-prod/search.html \
  --metadata-directive REPLACE \
  --cache-control "public, max-age=0, must-revalidate"

aws s3 cp s3://cis-filesearch-frontend-prod/404.html \
  s3://cis-filesearch-frontend-prod/404.html \
  --metadata-directive REPLACE \
  --cache-control "public, max-age=0, must-revalidate"
```

**キャッシュ戦略**:

| ファイルタイプ | Cache-Control | 理由 |
|---|---|---|
| HTML | `max-age=0, must-revalidate` | 常に最新を取得 |
| JS/CSS (ハッシュ付き) | `max-age=31536000, immutable` | ファイル名が変わるため長期キャッシュ可 |
| 画像/フォント | `max-age=2592000` | 1ヶ月キャッシュ |

---

### 7.4 アップロード結果の確認

#### ステップ1: S3バケット内容の確認

```bash
# アップロード後のS3バケット内容を確認
aws s3 ls s3://cis-filesearch-frontend-prod/ --recursive --summarize

# 期待される出力:
# 2025-01-07 11:00:00       5432 404.html
# 2025-01-07 11:00:00      12345 index.html
# 2025-01-07 11:00:00     123456 _next/static/chunks/framework.abc123.js
# 2025-01-07 11:00:00      98765 _next/static/chunks/main.def456.js
# ...
# Total Objects: 245
# Total Size: 45000000
```

#### ステップ2: 特定ファイルのメタデータ確認

```bash
# index.htmlのメタデータを確認
aws s3api head-object \
  --bucket cis-filesearch-frontend-prod \
  --key index.html

# 期待される出力:
# {
#     "AcceptRanges": "bytes",
#     "LastModified": "2025-01-07T02:00:00+00:00",
#     "ContentLength": 12345,
#     "ETag": "\"abc123def456...\"",
#     "ContentType": "text/html",
#     "CacheControl": "public, max-age=0, must-revalidate",
#     "Metadata": {}
# }
```

**確認ポイント**:
- ✅ `ContentType` が正しい（例: `text/html`, `application/javascript`）
- ✅ `CacheControl` が意図した値
- ✅ `LastModified` が最新の日時

**📸 スクリーンショット挿入ポイント20**: S3バケット内容の確認画面

---

## 8. CloudFrontの設定

### 8.1 CloudFront Invalidationの実行

#### ステップ1: Distribution IDの確認

```bash
# CloudFront Distribution IDを取得
aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='CIS File Search Frontend'].{Id:Id,DomainName:DomainName}" \
  --output table

# 期待される出力:
# ---------------------------------------------------------------
# |                      ListDistributions                      |
# +-----------------+-------------------------------------------+
# |       Id        |             DomainName                    |
# +-----------------+-------------------------------------------+
# | E1234567890ABC  | d1234567890abc.cloudfront.net            |
# +-----------------+-------------------------------------------+
```

#### ステップ2: Invalidationの作成

```bash
# すべてのファイルのキャッシュを無効化
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/*"

# 期待される出力:
# {
#     "Location": "https://cloudfront.amazonaws.com/2020-05-31/distribution/E1234567890ABC/invalidation/I2EXAMPLE",
#     "Invalidation": {
#         "Id": "I2EXAMPLE",
#         "Status": "InProgress",
#         "CreateTime": "2025-01-07T11:00:00.000Z",
#         "InvalidationBatch": {
#             "Paths": {
#                 "Quantity": 1,
#                 "Items": [
#                     "/*"
#                 ]
#             },
#             "CallerReference": "cli-1704618000"
#         }
#     }
# }
```

**注意**: Invalidationの完了には5〜15分かかる場合があります。

**📸 スクリーンショット挿入ポイント21**: Invalidation作成画面

---

#### ステップ3: Invalidation進行状況の確認

```bash
# Invalidationの状態を確認
aws cloudfront get-invalidation \
  --distribution-id E1234567890ABC \
  --id I2EXAMPLE \
  --query "Invalidation.Status" \
  --output text

# 出力例:
# InProgress  ← 処理中
# または
# Completed   ← 完了
```

**進行状況の自動監視スクリプト**:

```bash
# 完了まで待機するスクリプト
DISTRIBUTION_ID="E1234567890ABC"
INVALIDATION_ID="I2EXAMPLE"

echo "Invalidation進行状況を監視中..."

while true; do
  STATUS=$(aws cloudfront get-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --id "$INVALIDATION_ID" \
    --query "Invalidation.Status" \
    --output text)

  echo "現在の状態: $STATUS"

  if [ "$STATUS" = "Completed" ]; then
    echo "✅ Invalidationが完了しました！"
    break
  fi

  sleep 30  # 30秒待機
done
```

**📸 スクリーンショット挿入ポイント22**: Invalidation完了画面

---

### 8.2 セキュリティヘッダーポリシーの適用

#### ステップ1: Response Headers Policyの確認

```bash
# 既存のResponse Headers Policyを確認
aws cloudfront list-response-headers-policies \
  --query "ResponseHeadersPolicyList.Items[?ResponseHeadersPolicy.ResponseHeadersPolicyConfig.Name=='CIS-FileSearch-Security-Headers-Policy'].{Id:ResponseHeadersPolicy.Id,Name:ResponseHeadersPolicy.ResponseHeadersPolicyConfig.Name}" \
  --output table

# 期待される出力:
# ------------------------------------------------
# |        ListResponseHeadersPolicies           |
# +------------------------+---------------------+
# |          Id            |       Name          |
# +------------------------+---------------------+
# | 1a2b3c4d5e6f           | CIS-FileSearch-Se...|
# +------------------------+---------------------+
```

#### ステップ2: ポリシーが存在しない場合は作成

```bash
# プロジェクトルートに移動
cd ~/projects/cis_filesearch_app

# ポリシー設定ファイルを確認
cat docs/security/cloudfront-security-headers.json

# ポリシーを作成
aws cloudfront create-response-headers-policy \
  --response-headers-policy-config file://docs/security/cloudfront-security-headers.json

# 出力例:
# {
#     "ResponseHeadersPolicy": {
#         "Id": "1a2b3c4d5e6f",
#         "LastModifiedTime": "2025-01-07T11:00:00.000Z",
#         "ResponseHeadersPolicyConfig": {
#             "Name": "CIS-FileSearch-Security-Headers-Policy",
#             ...
#         }
#     },
#     "Location": "https://cloudfront.amazonaws.com/2020-05-31/response-headers-policy/1a2b3c4d5e6f"
# }
```

**📸 スクリーンショット挿入ポイント23**: Response Headers Policy作成画面

---

#### ステップ3: DistributionにポリシーをアタッチHere's the continuation:

```bash
# Distribution設定を取得してJSONファイルに保存
aws cloudfront get-distribution-config \
  --id E1234567890ABC \
  --output json > distribution-config.json

# ETagを保存（更新時に必要）
ETAG=$(aws cloudfront get-distribution-config \
  --id E1234567890ABC \
  --query "ETag" \
  --output text)

echo "ETag: $ETAG"
```

**distribution-config.json を編集**:

```bash
# ファイルを開く
nano distribution-config.json
```

`DefaultCacheBehavior` セクションに `ResponseHeadersPolicyId` を追加:

```json
{
  "DistributionConfig": {
    "DefaultCacheBehavior": {
      "ResponseHeadersPolicyId": "1a2b3c4d5e6f",
      ...
    }
  }
}
```

**更新を適用**:

```bash
# Distribution設定を更新
aws cloudfront update-distribution \
  --id E1234567890ABC \
  --distribution-config file://distribution-config.json \
  --if-match "$ETAG"

# 期待される出力:
# {
#     "Distribution": {
#         "Id": "E1234567890ABC",
#         "Status": "InProgress",
#         ...
#     }
# }
```

**📸 スクリーンショット挿入ポイント24**: Distribution更新完了画面

---

## 9. Cognitoの設定

### 9.1 Callback URLの設定

#### ステップ1: User Pool App Client設定を開く

1. AWS Consoleで **Cognito** → **User pools** を開く
2. **CIS-FileSearch-UserPool** を選択
3. **App integration** タブを選択
4. **App clients and analytics** セクションで **CIS-FileSearch-WebClient** をクリック
5. **Hosted UI** セクションまでスクロール

**📸 スクリーンショット挿入ポイント25**: App Client Hosted UI設定画面

---

#### ステップ2: Callback URLsの追加

1. **Allowed callback URLs** フィールドを確認
2. **Edit** ボタンをクリック
3. 以下のURLを追加:
   ```
   https://d1234567890abc.cloudfront.net/auth/callback
   ```
4. **Save changes** をクリック

**複数環境の場合**:
```
https://d1234567890abc.cloudfront.net/auth/callback
http://localhost:3000/auth/callback
```

**注意**: 本番環境URLは必ず `https://` で始まる必要があります。

**📸 スクリーンショット挿入ポイント26**: Callback URLs設定画面

---

#### ステップ3: Sign out URLsの追加

1. **Allowed sign-out URLs** フィールドを確認
2. **Edit** ボタンをクリック
3. 以下のURLを追加:
   ```
   https://d1234567890abc.cloudfront.net
   ```
4. **Save changes** をクリック

**📸 スクリーンショット挿入ポイント27**: Sign out URLs設定画面

---

### 9.2 OAuth Scopesの確認

#### ステップ1: OAuth設定を確認

1. 同じApp Client設定画面で **OAuth 2.0 grant types** セクションを確認
2. 以下が有効になっていることを確認:
   - ✅ Authorization code grant
   - ✅ Implicit grant (オプション)

**📸 スクリーンショット挿入ポイント28**: OAuth grant types設定画面

---

#### ステップ2: OAuth Scopesの確認

1. **OpenID Connect scopes** セクションを確認
2. 以下のスコープが選択されていることを確認:
   - ✅ openid
   - ✅ email
   - ✅ profile

**📸 スクリーンショット挿入ポイント29**: OAuth scopes設定画面

---

### 9.3 Cognitoユーザーの作成（テスト用）

#### ステップ1: 管理者ユーザーの作成

```bash
# テスト用ユーザーを作成
aws cognito-idp admin-create-user \
  --user-pool-id ap-northeast-1_abcDEF123 \
  --username test-user@example.com \
  --user-attributes \
    Name=email,Value=test-user@example.com \
    Name=email_verified,Value=true \
  --temporary-password "TempPassword123!" \
  --message-action SUPPRESS

# 期待される出力:
# {
#     "User": {
#         "Username": "test-user@example.com",
#         "Attributes": [
#             {
#                 "Name": "sub",
#                 "Value": "abc123-def456-..."
#             },
#             {
#                 "Name": "email_verified",
#                 "Value": "true"
#             },
#             {
#                 "Name": "email",
#                 "Value": "test-user@example.com"
#             }
#         ],
#         "UserCreateDate": "2025-01-07T11:00:00.000Z",
#         "UserLastModifiedDate": "2025-01-07T11:00:00.000Z",
#         "Enabled": true,
#         "UserStatus": "FORCE_CHANGE_PASSWORD"
#     }
# }
```

---

#### ステップ2: パスワードの永続化

```bash
# 一時パスワードを永続パスワードに変更
aws cognito-idp admin-set-user-password \
  --user-pool-id ap-northeast-1_abcDEF123 \
  --username test-user@example.com \
  --password "SecurePassword123!" \
  --permanent

# 成功した場合、出力なし
```

---

#### ステップ3: ユーザーの確認

```bash
# ユーザー情報を確認
aws cognito-idp admin-get-user \
  --user-pool-id ap-northeast-1_abcDEF123 \
  --username test-user@example.com

# 期待される出力:
# {
#     "Username": "test-user@example.com",
#     "UserAttributes": [
#         ...
#     ],
#     "UserCreateDate": "2025-01-07T11:00:00.000Z",
#     "UserLastModifiedDate": "2025-01-07T11:00:00.000Z",
#     "Enabled": true,
#     "UserStatus": "CONFIRMED"
# }
```

**確認ポイント**:
- ✅ `UserStatus` が `CONFIRMED`
- ✅ `Enabled` が `true`
- ✅ `email_verified` が `true`

**📸 スクリーンショット挿入ポイント30**: Cognitoユーザー作成完了画面

---

## 10. 動作確認

### 10.1 基本動作確認

#### ステップ1: CloudFront URLへのアクセス

```bash
# CloudFront URLを開く
open https://d1234567890abc.cloudfront.net

# または、curlで確認
curl -I https://d1234567890abc.cloudfront.net

# 期待される出力:
# HTTP/2 200
# content-type: text/html
# content-length: 12345
# strict-transport-security: max-age=31536000; includeSubDomains; preload
# x-frame-options: DENY
# x-content-type-options: nosniff
# ...
```

**確認ポイント**:
- ✅ ステータスコード: `200 OK`
- ✅ セキュリティヘッダーが存在
- ✅ `Content-Type` が `text/html`

**📸 スクリーンショット挿入ポイント31**: CloudFront URL アクセス画面

---

#### ステップ2: トップページの表示確認

**ブラウザで確認**:
1. ブラウザで `https://d1234567890abc.cloudfront.net` を開く
2. トップページが正しく表示されることを確認
3. 以下の要素が存在することを確認:
   - ✅ ページタイトル: 「CIS ファイル検索システム」
   - ✅ ログインボタン
   - ✅ レイアウトが崩れていない
   - ✅ 画像が正しく読み込まれている

**📸 スクリーンショット挿入ポイント32**: トップページ表示画面

---

### 10.2 ログイン機能の確認

#### ステップ1: ログインボタンのクリック

1. トップページの **「ログイン」** ボタンをクリック
2. Cognito Hosted UIにリダイレクトされることを確認
3. URL が `https://cis-filesearch.auth.ap-northeast-1.amazoncognito.com/...` に変わることを確認

**📸 スクリーンショット挿入ポイント33**: Cognito Hosted UI画面

---

#### ステップ2: ログインの実行

1. **Username** フィールドに `test-user@example.com` を入力
2. **Password** フィールドに `SecurePassword123!` を入力
3. **Sign in** ボタンをクリック
4. `/auth/callback` にリダイレクトされることを確認
5. その後、`/search` ページにリダイレクトされることを確認

**📸 スクリーンショット挿入ポイント34**: ログイン成功後のリダイレクト画面

---

#### ステップ3: ログイン状態の確認

1. ブラウザの開発者ツールを開く（F12 または Cmd+Opt+I）
2. **Application** タブを選択
3. **Local Storage** → CloudFront URLを選択
4. Cognitoトークンが保存されていることを確認:
   - `CognitoIdentityServiceProvider.{client_id}.{user}.idToken`
   - `CognitoIdentityServiceProvider.{client_id}.{user}.accessToken`
   - `CognitoIdentityServiceProvider.{client_id}.{user}.refreshToken`

**📸 スクリーンショット挿入ポイント35**: Local Storageのトークン確認画面

---

### 10.3 セキュリティヘッダーの確認

#### ステップ1: ブラウザ開発者ツールで確認

1. ブラウザで `https://d1234567890abc.cloudfront.net` を開く
2. 開発者ツールを開く（F12）
3. **Network** タブを選択
4. ページをリロード（Cmd+R または Ctrl+R）
5. トップの `(index)` リクエストを選択
6. **Headers** タブで **Response Headers** を確認

**期待されるヘッダー**:

```
strict-transport-security: max-age=31536000; includeSubDomains; preload
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cognito-idp.ap-northeast-1.amazonaws.com ...
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
x-xss-protection: 1; mode=block
permissions-policy: geolocation=(), microphone=(), camera=(), payment=(), usb=()
```

**📸 スクリーンショット挿入ポイント36**: セキュリティヘッダー確認画面

---

#### ステップ2: オンラインツールで確認

**Mozilla Observatory**:
1. https://observatory.mozilla.org/ を開く
2. CloudFront URLを入力: `https://d1234567890abc.cloudfront.net`
3. **Scan Me** をクリック
4. スコアを確認

**期待されるスコア**: **A+ (95/100)**

**📸 スクリーンショット挿入ポイント37**: Mozilla Observatory スコア画面

---

**Security Headers**:
1. https://securityheaders.com/ を開く
2. CloudFront URLを入力
3. **Scan** をクリック
4. グレードを確認

**期待されるグレード**: **A**

**📸 スクリーンショット挿入ポイント38**: Security Headers グレード画面

---

### 10.4 パフォーマンステスト

#### ステップ1: Lighthouse実行

**ブラウザで実行**:
1. Chrome開発者ツールを開く（F12）
2. **Lighthouse** タブを選択
3. **Mode**: Desktop
4. **Categories**: Performance, Accessibility, Best Practices, SEO
5. **Analyze page load** をクリック

**期待されるスコア**:
- Performance: **90+**
- Accessibility: **95+**
- Best Practices: **95+**
- SEO: **100**

**📸 スクリーンショット挿入ポイント39**: Lighthouse結果画面

---

#### ステップ2: コマンドラインでLighthouse実行

```bash
# Lighthouseをインストール（初回のみ）
npm install -g lighthouse

# Lighthouseを実行
lighthouse https://d1234567890abc.cloudfront.net \
  --output html \
  --output-path ./lighthouse-report.html

# レポートを開く
open ./lighthouse-report.html
```

---

### 10.5 エラーページの確認

#### ステップ1: 404ページの確認

```bash
# 存在しないページにアクセス
curl -I https://d1234567890abc.cloudfront.net/nonexistent-page

# 期待される出力:
# HTTP/2 404
# content-type: text/html
# ...
```

**ブラウザで確認**:
1. `https://d1234567890abc.cloudfront.net/nonexistent-page` を開く
2. カスタム404ページが表示されることを確認

**📸 スクリーンショット挿入ポイント40**: 404エラーページ画面

---

## 11. トラブルシューティング

### 11.1 CloudFrontにアクセスできない

**症状**: `403 Forbidden` または `404 Not Found`

**原因1**: S3バケットポリシーが正しく設定されていない

**解決策**:
```bash
# バケットポリシーを確認
aws s3api get-bucket-policy \
  --bucket cis-filesearch-frontend-prod \
  --query Policy \
  --output text | jq .

# CloudFront OAC設定を確認
aws cloudfront get-distribution \
  --id E1234567890ABC \
  --query "Distribution.DistributionConfig.Origins.Items[0].S3OriginConfig.OriginAccessIdentity" \
  --output text
```

---

**原因2**: CloudFront Invalidationが完了していない

**解決策**:
```bash
# Invalidation状態を確認
aws cloudfront list-invalidations \
  --distribution-id E1234567890ABC \
  --query "InvalidationList.Items[0].{Id:Id,Status:Status}" \
  --output table

# 完了まで待機
```

---

**原因3**: Default Root Objectが設定されていない

**解決策**:
1. CloudFront Console → Distribution設定を開く
2. **General** タブ → **Settings** セクション → **Edit**
3. **Default Root Object** に `index.html` を設定
4. **Save changes**

---

### 11.2 ログインが失敗する

**症状**: ログインボタンをクリックしても何も起こらない、またはエラーメッセージが表示される

**原因1**: Cognito Callback URLが正しく設定されていない

**解決策**:
```bash
# App Client設定を確認
aws cognito-idp describe-user-pool-client \
  --user-pool-id ap-northeast-1_abcDEF123 \
  --client-id 1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p \
  --query "UserPoolClient.CallbackURLs" \
  --output json

# 期待される出力:
# [
#     "https://d1234567890abc.cloudfront.net/auth/callback"
# ]
```

Callback URLが正しくない場合、Cognitoコンソールで修正してください。

---

**原因2**: 環境変数が正しく設定されていない

**解決策**:
1. ブラウザ開発者ツールを開く（F12）
2. **Console** タブで以下を実行:
   ```javascript
   console.log('APP_URL:', process.env.NEXT_PUBLIC_APP_URL);
   console.log('COGNITO_DOMAIN:', process.env.NEXT_PUBLIC_COGNITO_DOMAIN);
   ```
3. 値が正しいことを確認
4. 正しくない場合、`.env.local` を修正して再ビルド・再デプロイ

---

**原因3**: CSPがCognitoドメインをブロックしている

**解決策**:
```bash
# ブラウザ開発者ツールの Consoleタブでエラーを確認
# 期待されるエラーメッセージ:
# Refused to connect to 'https://cis-filesearch.auth.ap-northeast-1.amazoncognito.com' because it violates the following Content Security Policy directive: "connect-src 'self'"
```

CSPの `connect-src` にCognitoドメインを追加:
```
connect-src 'self' https://cognito-idp.ap-northeast-1.amazonaws.com https://*.amazoncognito.com;
```

CloudFront Response Headers Policyを更新してください。

---

### 11.3 画像が表示されない

**症状**: 画像ファイルが読み込めない、またはブロックされる

**原因1**: CSPの `img-src` が制限されている

**解決策**:
```
img-src 'self' data: https:;
```

CloudFront Response Headers Policyを更新してください。

---

**原因2**: S3バケットに画像がアップロードされていない

**解決策**:
```bash
# S3バケット内の画像ファイルを確認
aws s3 ls s3://cis-filesearch-frontend-prod/_next/static/media/ --recursive

# 画像が存在しない場合、再アップロード
aws s3 sync ./out/_next/static/media/ s3://cis-filesearch-frontend-prod/_next/static/media/
```

---

### 11.4 スタイルが適用されない

**症状**: CSSが読み込まれず、ページのレイアウトが崩れる

**原因1**: CSPの `style-src` が制限されている

**解決策**:
```
style-src 'self' 'unsafe-inline';
```

`'unsafe-inline'` はNext.jsのインラインCSSに必要です。

---

**原因2**: CSSファイルのContent-Typeが正しくない

**解決策**:
```bash
# CSSファイルのメタデータを確認
aws s3api head-object \
  --bucket cis-filesearch-frontend-prod \
  --key _next/static/css/abc123.css \
  --query "ContentType" \
  --output text

# 期待される出力: text/css
```

Content-Typeが正しくない場合:
```bash
aws s3 cp \
  s3://cis-filesearch-frontend-prod/_next/static/css/abc123.css \
  s3://cis-filesearch-frontend-prod/_next/static/css/abc123.css \
  --metadata-directive REPLACE \
  --content-type "text/css"
```

---

## 12. ロールバック手順

### 12.1 緊急ロールバック（S3バケット）

#### ステップ1: バックアップからの復元

```bash
# バックアップディレクトリを確認
ls -la ~/backups/cis-filesearch-frontend/

# 最新のバックアップを選択
BACKUP_DIR=~/backups/cis-filesearch-frontend/backup_20250107_100000

# S3バケットをバックアップで上書き
aws s3 sync "$BACKUP_DIR/" s3://cis-filesearch-frontend-prod/ \
  --delete

# Invalidationを実行
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/*"
```

**推定所要時間**: 10〜15分

---

### 12.2 S3バージョニングを使用したロールバック

#### ステップ1: 以前のバージョンIDを確認

```bash
# index.htmlのバージョン履歴を確認
aws s3api list-object-versions \
  --bucket cis-filesearch-frontend-prod \
  --prefix index.html \
  --query "Versions[*].{Key:Key,VersionId:VersionId,LastModified:LastModified,IsLatest:IsLatest}" \
  --output table

# 期待される出力:
# ----------------------------------------------------------------------
# |                      ListObjectVersions                            |
# +-------------+----------------------+-------------------+----------+
# |   IsLatest  |    LastModified      |       Key         |VersionId|
# +-------------+----------------------+-------------------+----------+
# |  True       |2025-01-07T11:00:00Z  |  index.html       | v2      |
# |  False      |2025-01-06T10:00:00Z  |  index.html       | v1      |
# +-------------+----------------------+-------------------+----------+
```

---

#### ステップ2: 以前のバージョンをコピー

```bash
# 以前のバージョンをカレントバージョンとして復元
aws s3api copy-object \
  --bucket cis-filesearch-frontend-prod \
  --copy-source "cis-filesearch-frontend-prod/index.html?versionId=v1" \
  --key index.html

# すべてのファイルを一括でロールバック（スクリプト）
aws s3api list-object-versions \
  --bucket cis-filesearch-frontend-prod \
  --query "Versions[?IsLatest==\`false\`].[Key,VersionId]" \
  --output text | \
  while read key version; do
    echo "Restoring: $key (version: $version)"
    aws s3api copy-object \
      --bucket cis-filesearch-frontend-prod \
      --copy-source "cis-filesearch-frontend-prod/${key}?versionId=${version}" \
      --key "$key"
  done
```

---

### 12.3 CloudFront設定のロールバック

#### ステップ1: Distribution設定の履歴確認

```bash
# Distribution設定の変更履歴を確認
aws cloudfront list-distributions \
  --query "DistributionList.Items[?Id=='E1234567890ABC'].{Id:Id,Status:Status,LastModifiedTime:LastModifiedTime}" \
  --output table
```

---

#### ステップ2: 以前の設定ファイルから復元

```bash
# バックアップした設定ファイルを使用
# （デプロイ前にdistribution-config.jsonをバックアップしておくこと）

# 現在のETagを取得
ETAG=$(aws cloudfront get-distribution-config \
  --id E1234567890ABC \
  --query "ETag" \
  --output text)

# バックアップから復元
aws cloudfront update-distribution \
  --id E1234567890ABC \
  --distribution-config file://distribution-config-backup.json \
  --if-match "$ETAG"
```

---

## 13. デプロイ完了チェックリスト

### 13.1 必須確認項目

デプロイ完了前に、以下のすべての項目をチェックしてください。

**環境設定** :
- [x] `.env.local` ファイルが正しく設定されている
- [x] すべての環境変数が有効な値である
- [x] 本番環境用の設定（開発環境の設定が含まれていない）

**ビルド**:
- [x] `yarn build` が成功した
- [x] エラーや警告がない
- [x] `out` ディレクトリが生成された
- [x] 必要なHTMLファイルがすべて存在する

**S3アップロード**:
- [x] すべてのファイルがS3にアップロードされた
- [x] ファイル数が一致している
- [x] Cache-Controlヘッダーが正しく設定されている
- [x] バケットポリシーが適用されている

**CloudFront**:
- [x] Invalidationが完了した
- [x] Response Headers Policyが適用されている
- [x] Default Root Objectが `index.html` に設定されている
- [x] OAC設定が正しい

**Cognito**:
- [x] Callback URLsが正しく設定されている
- [x] Sign out URLsが正しく設定されている
- [x] OAuth scopesが正しい
- [x] テストユーザーが作成されている

**動作確認**:
- [x] トップページが正しく表示される
- [x] ログイン機能が動作する
- [x] セキュリティヘッダーが存在する
- [x] Lighthouseスコアが基準を満たしている

---

### 13.2 オプション確認項目

**パフォーマンス**:
- [ ] Lighthouse Performance スコア > 90
- [ ] First Contentful Paint < 1.5s
- [ ] Largest Contentful Paint < 2.5s
- [ ] Cumulative Layout Shift < 0.1

**セキュリティ**:
- [ ] Mozilla Observatory スコア A+
- [ ] Security Headers スコア A
- [ ] SSL Labs スコア A+
- [ ] HSTS Preloadに登録済み

**アクセシビリティ**:
- [ ] Lighthouse Accessibility スコア > 95
- [ ] キーボードナビゲーションが動作する
- [ ] スクリーンリーダー対応

---

## 14. まとめ

### 14.1 デプロイ成果物

デプロイ完了後、以下の成果物が得られます:

**フロントエンドアプリケーション**:
- ✅ CloudFront URL: `https://d1234567890abc.cloudfront.net`
- ✅ セキュリティスコア: **95/100**
- ✅ パフォーマンススコア: **90+**

**設定ファイル**:
- ✅ `.env.local`: 環境変数設定
- ✅ `s3-bucket-policy.json`: S3バケットポリシー
- ✅ `cloudfront-security-headers.json`: セキュリティヘッダー設定
- ✅ `distribution-config.json`: CloudFront設定

**バックアップ**:
- ✅ 以前のS3バケット内容
- ✅ CloudFront Distribution設定
- ✅ Cognito設定（スクリーンショット）

---

### 14.2 次のステップ

フロントエンドのデプロイが完了したら、次のフェーズに進みます:

1. **バックエンドインフラの構築**
   - Terraform設定の作成
   - SQS、EventBridge、EC2 Auto Scaling
   - DataSync、Lambda関数

2. **EC2処理スクリプトの実装**
   - SQSポーリング
   - Tesseract OCR統合
   - Bedrock Titan API連携
   - OpenSearchインデックス登録

3. **ファイルスキャナーPCアプリケーション**
   - DataSync Agent設定
   - 手動トリガーUI
   - 進捗モニタリング

---

### 14.3 サポート情報

**ドキュメント**:
- [AWS CloudFront ドキュメント](https://docs.aws.amazon.com/cloudfront/)
- [AWS Cognito ドキュメント](https://docs.aws.amazon.com/cognito/)
- [Next.js Static Export ドキュメント](https://nextjs.org/docs/app/building-your-application/deploying/static-exports)

**トラブルシューティング**:
- `/docs/deployment/troubleshooting-guide.md`
- `/docs/security/cloudfront-security-headers-guide.md`
- `/docs/security/s3-bucket-policy-guide.md`

**問い合わせ先**:
- 技術サポート: tech-support@example.com
- 緊急連絡先: +81-XX-XXXX-XXXX

---

## 付録

### A. AWS CLIコマンド一覧

```bash
# S3
aws s3 sync ./out/ s3://bucket-name/ --delete
aws s3api get-bucket-policy --bucket bucket-name
aws s3api put-bucket-policy --bucket bucket-name --policy file://policy.json

# CloudFront
aws cloudfront create-invalidation --distribution-id ID --paths "/*"
aws cloudfront list-distributions
aws cloudfront get-distribution --id ID

# Cognito
aws cognito-idp list-user-pools --max-results 10
aws cognito-idp describe-user-pool-client --user-pool-id ID --client-id ID
aws cognito-idp admin-create-user --user-pool-id ID --username email@example.com
```

---

### B. 環境変数リファレンス

| 変数名 | 必須 | 説明 | 例 |
|---|---|---|---|
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | ✅ | Cognito User Pool ID | `ap-northeast-1_abcDEF123` |
| `NEXT_PUBLIC_COGNITO_APP_CLIENT_ID` | ✅ | Cognito App Client ID | `1a2b3c...` |
| `NEXT_PUBLIC_COGNITO_DOMAIN` | ✅ | Cognito Hosted UI Domain | `cis-filesearch.auth.ap-northeast-1.amazoncognito.com` |
| `NEXT_PUBLIC_APP_URL` | ✅ | CloudFront Distribution URL | `https://d123...cloudfront.net` |
| `NEXT_PUBLIC_API_GATEWAY_URL` | ✅ | API Gateway Invoke URL | `https://xyz...execute-api...amazonaws.com/v1` |

---

### C. タイムライン

| フェーズ | 所要時間 | 累計時間 |
|---|---|---|
| 準備（バックアップ、環境変数） | 20分 | 20分 |
| ビルド | 10分 | 30分 |
| S3アップロード | 30分 | 60分 |
| CloudFront設定 | 20分 | 80分 |
| Cognito設定 | 20分 | 100分 |
| 動作確認 | 20分 | 120分 |

**合計**: **2時間**（初回）

2回目以降は、環境変数設定とバックアップをスキップできるため、**約1.5時間**で完了します。

---

**デプロイガイド終了 - お疲れ様でした！ 🎉**
