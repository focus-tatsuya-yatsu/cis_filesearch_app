# AWS Cognito Environment Variables Setup Guide

**完全版設定ガイド - 初心者から経験者まで対応**

このガイドでは、CIS File Search ApplicationでAWS Cognitoを使用した認証を設定するための手順を説明します。

---

## 📋 目次

1. [前提条件](#前提条件)
2. [環境変数の概要](#環境変数の概要)
3. [AWS Console完全ナビゲーション](#aws-console完全ナビゲーション)
4. [.env.localファイルの作成](#envlocalファイルの作成)
5. [App Client詳細設定](#app-client詳細設定)
6. [トラブルシューティング](#トラブルシューティング)
7. [開発環境 vs 本番環境](#開発環境-vs-本番環境)
8. [テストと検証](#テストと検証)

---

## 前提条件

### 必要なもの
- ✅ AWSアカウント（IAM権限: Cognito作成/編集権限）
- ✅ Node.js 18以上
- ✅ yarn（パッケージマネージャー）
- ✅ プロジェクトのクローン完了

### 使用技術スタック
- **認証SDK**: AWS Amplify v6
- **認証フロー**: OAuth 2.0 Authorization Code Grant with PKCE
- **フレームワーク**: Next.js 15 (App Router, Static Export)
- **推奨リージョン**: ap-northeast-1 (東京)

---

## 環境変数の概要

### 必須の4つの環境変数

```bash
# 1. Cognito User Pool ID
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_abc123XYZ

# 2. Cognito App Client ID
NEXT_PUBLIC_COGNITO_APP_CLIENT_ID=7uvwxyz1234567890abcdefghijklmn

# 3. Cognito Domain (プロトコル不要)
NEXT_PUBLIC_COGNITO_DOMAIN=filesearch.auth.ap-northeast-1.amazoncognito.com

# 4. アプリケーションURL (http/https必須)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 形式チェックルール

| 変数名 | 形式ルール | 正しい例 | 間違った例 |
|--------|-----------|----------|------------|
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | `^[a-z]{2}-[a-z]+-\d+_[a-zA-Z0-9]+$` | `ap-northeast-1_abc123XYZ` | `ap-northeast-1` |
| `NEXT_PUBLIC_COGNITO_DOMAIN` | プロトコル（http/https）を含まない | `filesearch.auth.ap-northeast-1.amazoncognito.com` | `https://filesearch.auth...` |
| `NEXT_PUBLIC_APP_URL` | `http://`または`https://`で始まる | `https://example.com` | `example.com` |

---

## AWS Console完全ナビゲーション

### Step 1: User Pool IDの取得

#### 1-1. AWS Consoleにログイン
```
https://console.aws.amazon.com/
```

#### 1-2. リージョンの選択
1. 右上のリージョン選択ドロップダウンをクリック
2. **Tokyo (ap-northeast-1)** を選択

#### 1-3. Cognitoサービスへ移動
```
検索バー → "Cognito" と入力 → "Amazon Cognito" をクリック
```

#### 1-4. User Pool IDの確認

**既存のUser Poolがある場合:**
```
左サイドバー → "User pools" → [既存のPool名をクリック]
→ 画面上部に "Pool Id" が表示される
```

**新規作成の場合:**
```
"Create user pool" ボタンをクリック
→ 以下の設定を進める（詳細は後述）
```

#### 新規User Pool作成の推奨設定

**1. Configure sign-in experience**
- ✅ `Email` (メールアドレスでログイン)
- ✅ `Username` (ユーザー名でログイン)
- Cognito user pool sign-in options: Email + Username

**2. Configure security requirements**
- Password policy: `Cognito defaults` (推奨)
  - 最小8文字
  - 大文字、小文字、数字、特殊文字を含む
- Multi-factor authentication: `Optional` (必要に応じて変更)
- User account recovery: `Email only` (推奨)

**3. Configure sign-up experience**
- Self-registration: `Enable self-registration` (ユーザーが自分で登録可能)
- Attribute verification: `Send email message, verify email address`
- Required attributes:
  - ✅ `email`
  - ✅ `name`
  - ✅ `profile` (任意)

**4. Configure message delivery**
- Email provider: `Send email with Amazon SES` (本番環境推奨)
  - 開発環境の場合: `Send email with Cognito` (日50通まで無料)
- FROM email address: `no-reply@verificationemail.com` (デフォルト)

**5. Integrate your app**
- User pool name: `filesearch-user-pool` (任意)
- App client name: `filesearch-web-client` (任意)
- Client secret: **生成しない** (重要: PKCE使用のため)

**6. Review and create**
- すべての設定を確認して "Create user pool" をクリック

#### User Pool ID取得完了
作成後、以下の画面で確認できます:
```
Pool overview → Pool Id: ap-northeast-1_XXXXXXXXX
```

**📋 コピー方法:**
```
Pool IdをクリックしてCtrl+C (Windows) / Cmd+C (Mac)でコピー
```

---

### Step 2: App Client IDの取得

#### 2-1. User Pool画面から移動
```
[User Pool名] → "App integration" タブをクリック
```

#### 2-2. App clientセクションへスクロール
```
下にスクロールして "App clients and analytics" セクションを探す
```

#### 2-3. App Client IDの確認

**既存のApp Clientがある場合:**
```
App client listに表示されている "Client ID" をコピー
例: 7uvwxyz1234567890abcdefghijklmn
```

**新規作成の場合:**
```
"Create app client" ボタンをクリック
```

#### 新規App Client作成の推奨設定

**1. App client configuration**
- App client name: `filesearch-web-client`
- Client secret: **Don't generate a client secret** (重要!)
  - ⚠️ PKCEを使用するため、client secretは不要

**2. Authentication flows**
- ✅ `ALLOW_USER_SRP_AUTH` (SRP認証)
- ✅ `ALLOW_REFRESH_TOKEN_AUTH` (リフレッシュトークン)
- ❌ `ALLOW_USER_PASSWORD_AUTH` (非推奨: セキュリティリスク)

**3. OAuth 2.0 grant types**
- ✅ `Authorization code grant` (PKCE使用)
- ❌ `Implicit grant` (非推奨: 脆弱性あり)

**4. OpenID Connect scopes**
- ✅ `openid` (必須)
- ✅ `email` (必須)
- ✅ `profile` (必須)

**5. Callback URLs**
```
開発環境: http://localhost:3000/auth/callback
本番環境: https://your-cloudfront-domain.cloudfront.net/auth/callback
```
**⚠️ 注意:** 両方追加する場合は1行ずつ入力

**6. Sign out URLs**
```
開発環境: http://localhost:3000
本番環境: https://your-cloudfront-domain.cloudfront.net
```

**7. Identity providers**
- ✅ `Cognito user pool` (デフォルト)
- 必要に応じてGoogle/Facebook等を追加

**8. Advanced app client settings**
- Access token expiration: `60 minutes` (推奨)
- ID token expiration: `60 minutes` (推奨)
- Refresh token expiration: `30 days` (推奨)

#### App Client ID取得完了
```
App client listに表示される "Client ID" をコピー
```

---

### Step 3: Cognito Domainの取得/作成

#### 3-1. Domain設定画面へ移動
```
[User Pool名] → "App integration" タブ → "Domain" セクション
```

#### 3-2. Domainの確認/作成

**既存のDomainがある場合:**
```
"Domain" 欄に表示されているドメインをコピー
例: filesearch.auth.ap-northeast-1.amazoncognito.com
```

**新規作成の場合:**
```
"Actions" → "Create Cognito domain" または "Create custom domain" をクリック
```

#### Cognito Domain作成の推奨設定

**Option 1: Cognito Domain (推奨 - 簡単)**
```
Cognito domain prefix: filesearch
→ 自動的に生成されるドメイン:
  filesearch.auth.ap-northeast-1.amazoncognito.com
```

**⚠️ 重要:**
- プレフィックスはグローバルで一意である必要がある
- 既に使われている場合は別の名前を試す（例: `filesearch-company`）

**Option 2: Custom Domain (高度 - 独自ドメイン使用)**
```
Custom domain: auth.your-company.com
ACM certificate: [Route 53で作成したSSL証明書を選択]
```

#### Domain取得完了
```
作成後、"Domain" 欄に表示されるドメインをコピー
例: filesearch.auth.ap-northeast-1.amazoncognito.com
```

**📋 注意:**
- ✅ コピーするのはドメイン名のみ
- ❌ `https://` は含めない

---

### Step 4: アプリケーションURLの設定

#### 開発環境の場合
```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

#### 本番環境の場合

**CloudFrontを使用する場合:**
1. AWS Console → CloudFront → Distributions
2. 該当のDistributionを選択
3. "Distribution domain name" をコピー
```bash
NEXT_PUBLIC_APP_URL=https://d1234567890abc.cloudfront.net
```

**Vercelを使用する場合:**
```bash
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

**カスタムドメインを使用する場合:**
```bash
NEXT_PUBLIC_APP_URL=https://filesearch.your-company.com
```

---

## .env.localファイルの作成

### Step 1: サンプルファイルのコピー

```bash
# プロジェクトルートディレクトリで実行
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

# サンプルファイルをコピー
cp .env.local.example .env.local
```

### Step 2: .env.localファイルの編集

```bash
# お好みのエディタで開く
code .env.local
# または
vi .env.local
```

### Step 3: 実際の値に置き換える

**開発環境の例:**
```bash
# ========================================
# AWS Cognito 認証設定 (開発環境)
# ========================================

# Step 1で取得したUser Pool ID
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_abc123XYZ

# Step 2で取得したApp Client ID
NEXT_PUBLIC_COGNITO_APP_CLIENT_ID=7uvwxyz1234567890abcdefghijklmn

# Step 3で取得したCognito Domain (https://は不要)
NEXT_PUBLIC_COGNITO_DOMAIN=filesearch.auth.ap-northeast-1.amazoncognito.com

# Step 4で設定したアプリケーションURL
NEXT_PUBLIC_APP_URL=http://localhost:3000

# ========================================
# API Gateway設定（バックエンドAPI）
# ========================================

# API Gateway URL (バックエンド構築後に設定)
NEXT_PUBLIC_API_GATEWAY_URL=https://abcdefghij.execute-api.ap-northeast-1.amazonaws.com/v1
```

### Step 4: ファイルの保存と確認

```bash
# ファイルが正しく作成されたか確認
ls -la .env.local

# 内容の確認（機密情報に注意）
cat .env.local
```

### Step 5: 環境変数の読み込み確認

```bash
# 開発サーバーを起動
yarn dev

# ✅ 正常な場合の出力例:
# ✅ Amplify環境変数の検証が完了しました
# ▲ Next.js 15.x.x
# - Local:        http://localhost:3000

# ❌ エラーがある場合の出力例:
# ❌ 以下の環境変数が設定されていません:
#   - NEXT_PUBLIC_COGNITO_USER_POOL_ID
```

---

## App Client詳細設定

### 必須設定チェックリスト

#### 1. OAuth 2.0 Grant Types
```
✅ Authorization code grant (PKCE使用)
❌ Implicit grant (セキュリティリスクのため無効化)
```

#### 2. OpenID Connect Scopes
```
✅ openid
✅ email
✅ profile
```

#### 3. Callback URLs設定

**設定場所:**
```
User pools → [Pool name] → App integration →
App client → Edit → Hosted UI settings → Callback URLs
```

**開発環境:**
```
http://localhost:3000/auth/callback
```

**本番環境:**
```
https://your-cloudfront-domain.cloudfront.net/auth/callback
https://filesearch.your-company.com/auth/callback
```

**⚠️ 重要な注意点:**
- 複数のURLを設定する場合は、1行ずつ入力
- 末尾のスラッシュ（/）の有無を統一する
- 完全一致が必要（ワイルドカード不可）

#### 4. Sign out URLs設定

**設定場所:**
```
同上 → Sign out URLs
```

**開発環境:**
```
http://localhost:3000
```

**本番環境:**
```
https://your-cloudfront-domain.cloudfront.net
https://filesearch.your-company.com
```

#### 5. Token有効期限設定

**推奨値:**
```
Access token expiration: 60 minutes
ID token expiration: 60 minutes
Refresh token expiration: 30 days
```

**セキュリティ重視の場合:**
```
Access token expiration: 15 minutes
ID token expiration: 15 minutes
Refresh token expiration: 7 days
```

### App Client設定変更の反映

```bash
# 設定変更後は開発サーバーを再起動
# Ctrl+C で停止後、再度起動
yarn dev
```

---

## トラブルシューティング

### 問題1: "Invalid User Pool ID format" エラー

**エラーメッセージ:**
```
❌ User Pool IDの形式が不正です:
  実際の値: ap-northeast-1
  期待する形式: ap-northeast-1_XXXXXXXXX
```

**原因:**
- User Pool IDの後半部分（アンダースコア以降）が欠けている

**解決方法:**
1. AWS Console → Cognito → User pools → [Pool name]
2. "Pool Id" を**全文**コピー（例: `ap-northeast-1_abc123XYZ`）
3. `.env.local`ファイルを更新
4. 開発サーバーを再起動

**正しい形式の例:**
```bash
✅ NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_abc123XYZ
❌ NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1
```

---

### 問題2: "Domain should NOT include http//" エラー

**エラーメッセージ:**
```
❌ Cognito Domainにプロトコル（http/https）を含めないでください:
  実際の値: https://filesearch.auth.ap-northeast-1.amazoncognito.com
  期待する形式: filesearch.auth.ap-northeast-1.amazoncognito.com
```

**原因:**
- Cognito Domainに`https://`が含まれている

**解決方法:**
```bash
# ❌ 間違い
NEXT_PUBLIC_COGNITO_DOMAIN=https://filesearch.auth.ap-northeast-1.amazoncognito.com

# ✅ 正しい
NEXT_PUBLIC_COGNITO_DOMAIN=filesearch.auth.ap-northeast-1.amazoncognito.com
```

---

### 問題3: Callback URL Mismatch エラー

**エラーメッセージ:**
```
Invalid redirect_uri: http://localhost:3000/auth/callback
```

**原因:**
- Cognitoに登録されているCallback URLと実際のリダイレクト先が一致していない

**解決方法:**

**1. Cognitoの設定を確認:**
```
User pools → [Pool name] → App integration →
App client → Hosted UI → Callback URLs
```

**2. 登録されているURLを確認:**
```
登録されているURL: http://localhost:3000/auth/callback
実際のURL:         http://localhost:3000/auth/callback
→ 完全一致が必要
```

**3. よくある不一致パターン:**
```
❌ 登録: http://localhost:3000/auth/callback/
   実際: http://localhost:3000/auth/callback
   → 末尾のスラッシュが違う

❌ 登録: http://localhost:3000
   実際: http://localhost:3000/auth/callback
   → パスが違う

❌ 登録: https://localhost:3000/auth/callback
   実際: http://localhost:3000/auth/callback
   → プロトコルが違う
```

**4. 修正方法:**
```
1. Cognitoの設定を更新
2. キャッシュをクリア（ブラウザ）
3. 開発サーバーを再起動
```

---

### 問題4: CORS エラー

**エラーメッセージ:**
```
Access to fetch at 'https://filesearch.auth.ap-northeast-1.amazoncognito.com/oauth2/token'
from origin 'http://localhost:3000' has been blocked by CORS policy
```

**原因:**
- Cognitoの設定で許可されていないオリジンからのリクエスト

**解決方法:**

**1. App Clientの設定確認:**
```
User pools → [Pool name] → App integration → App client
→ Allowed callback URLs と Allowed sign-out URLs に
  http://localhost:3000 が含まれているか確認
```

**2. ブラウザのキャッシュをクリア:**
```
Chrome: Ctrl+Shift+Delete → キャッシュクリア
Firefox: Ctrl+Shift+Delete → キャッシュクリア
```

**3. 開発サーバーを再起動:**
```bash
# Ctrl+C で停止
yarn dev
```

---

### 問題5: Token Validation Failures

**エラーメッセージ:**
```
Token validation failed: Invalid token
```

**原因:**
- トークンの有効期限切れ
- 不正なトークン
- App Client IDの不一致

**解決方法:**

**1. ログアウトして再ログイン:**
```
ブラウザのLocalStorageをクリア:
- F12 → Application → Local Storage → Clear
- または Sign outボタンをクリック
```

**2. App Client IDの確認:**
```bash
# .env.localのApp Client IDが正しいか確認
cat .env.local | grep NEXT_PUBLIC_COGNITO_APP_CLIENT_ID

# AWS Consoleで確認
User pools → [Pool name] → App integration → App client → Client ID
```

**3. トークンの有効期限設定確認:**
```
App client → Token validity units
→ Access token: 60 minutes (推奨)
→ ID token: 60 minutes (推奨)
```

---

### 問題6: "Missing required environment variables" エラー

**エラーメッセージ:**
```
❌ 以下の環境変数が設定されていません:
  - NEXT_PUBLIC_COGNITO_USER_POOL_ID
  - NEXT_PUBLIC_COGNITO_APP_CLIENT_ID
  - NEXT_PUBLIC_COGNITO_DOMAIN
  - NEXT_PUBLIC_APP_URL
```

**原因:**
- `.env.local`ファイルが存在しない
- 環境変数が空文字列
- ファイル名の間違い

**解決方法:**

**1. ファイルの存在確認:**
```bash
ls -la /Users/tatsuya/focus_project/cis_filesearch_app/frontend/.env.local

# ファイルが存在しない場合
# ❌ ls: .env.local: No such file or directory
```

**2. サンプルファイルからコピー:**
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
cp .env.local.example .env.local
```

**3. 環境変数の値を設定:**
```bash
# エディタで開いて実際の値を入力
code .env.local
```

**4. 正しいファイル名の確認:**
```bash
# ✅ 正しい
.env.local

# ❌ 間違い
.env
env.local
.env.local.example
```

---

### デバッグ用コマンド集

```bash
# 環境変数の読み込み確認
yarn dev

# Node.jsプロセスで環境変数を確認（開発時のみ）
node -e "console.log(process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID)"

# .env.localファイルの内容確認
cat .env.local

# 環境変数がNext.jsに読み込まれているか確認
# ブラウザのコンソールで実行:
console.log(process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID)
```

---

## 開発環境 vs 本番環境

### 環境ごとのUser Pool戦略

#### Option 1: 単一User Pool（推奨 - 小規模プロジェクト）

**メリット:**
- 管理が簡単
- コスト削減
- ユーザーデータの一元管理

**デメリット:**
- 開発環境でのテストが本番環境に影響する可能性

**設定例:**
```bash
# 開発環境も本番環境も同じUser Pool
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_PROD123
```

---

#### Option 2: 環境別User Pool（推奨 - 本番環境）

**メリット:**
- 開発環境と本番環境が完全分離
- セキュリティ向上
- テストが本番に影響しない

**デメリット:**
- 管理コストが増加
- 2つのUser Poolを維持する必要

**設定例:**

**開発環境 (.env.local):**
```bash
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_DEV123
NEXT_PUBLIC_COGNITO_APP_CLIENT_ID=dev-client-id
NEXT_PUBLIC_COGNITO_DOMAIN=filesearch-dev.auth.ap-northeast-1.amazoncognito.com
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**本番環境 (.env.production または Vercel環境変数):**
```bash
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_PROD456
NEXT_PUBLIC_COGNITO_APP_CLIENT_ID=prod-client-id
NEXT_PUBLIC_COGNITO_DOMAIN=filesearch.auth.ap-northeast-1.amazoncognito.com
NEXT_PUBLIC_APP_URL=https://filesearch.your-company.com
```

---

### Vercel環境変数の設定

**1. Vercelダッシュボードにログイン:**
```
https://vercel.com/dashboard
```

**2. プロジェクトを選択:**
```
Your Projects → [cis-filesearch-app]
```

**3. 環境変数設定画面へ移動:**
```
Settings → Environment Variables
```

**4. 環境変数を追加:**

| Key | Value | Environment |
|-----|-------|-------------|
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | `ap-northeast-1_PROD456` | Production |
| `NEXT_PUBLIC_COGNITO_APP_CLIENT_ID` | `prod-client-id` | Production |
| `NEXT_PUBLIC_COGNITO_DOMAIN` | `filesearch.auth.ap-northeast-1.amazoncognito.com` | Production |
| `NEXT_PUBLIC_APP_URL` | `https://your-app.vercel.app` | Production |

**5. Preview環境用の設定（任意）:**

| Key | Value | Environment |
|-----|-------|-------------|
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | `ap-northeast-1_DEV123` | Preview |
| `NEXT_PUBLIC_COGNITO_APP_CLIENT_ID` | `dev-client-id` | Preview |
| `NEXT_PUBLIC_COGNITO_DOMAIN` | `filesearch-dev.auth.ap-northeast-1.amazoncognito.com` | Preview |
| `NEXT_PUBLIC_APP_URL` | `https://your-app-git-branch.vercel.app` | Preview |

**6. デプロイをトリガー:**
```
Deployments → Redeploy → Use existing Build Cache のチェックを外す
```

---

### CloudFront + S3環境の設定

**1. ビルド時に環境変数を埋め込む:**

```bash
# package.jsonのbuildスクリプト
{
  "scripts": {
    "build": "next build",
    "export": "next export"
  }
}
```

**2. GitHub Actions / CI/CD設定:**

`.github/workflows/deploy.yml`:
```yaml
name: Deploy to Production

on:
  push:
    branches:
      - main

env:
  NEXT_PUBLIC_COGNITO_USER_POOL_ID: ${{ secrets.COGNITO_USER_POOL_ID }}
  NEXT_PUBLIC_COGNITO_APP_CLIENT_ID: ${{ secrets.COGNITO_APP_CLIENT_ID }}
  NEXT_PUBLIC_COGNITO_DOMAIN: ${{ secrets.COGNITO_DOMAIN }}
  NEXT_PUBLIC_APP_URL: ${{ secrets.APP_URL }}

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install dependencies
        run: yarn install
      - name: Build
        run: yarn build
      - name: Deploy to S3
        run: aws s3 sync out/ s3://your-bucket-name --delete
      - name: Invalidate CloudFront
        run: aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"
```

**3. GitHub Secretsに環境変数を追加:**
```
GitHub Repository → Settings → Secrets and variables → Actions
→ New repository secret
```

---

## テストと検証

### Phase 1: 環境変数の検証

```bash
# Step 1: 開発サーバーを起動
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
yarn dev

# Step 2: ターミナル出力を確認
# ✅ 成功の場合:
# ✅ Amplify環境変数の検証が完了しました
# ▲ Next.js 15.x.x
# - Local:        http://localhost:3000

# ❌ 失敗の場合:
# ❌ 以下の環境変数が設定されていません:
#   - NEXT_PUBLIC_COGNITO_USER_POOL_ID
```

---

### Phase 2: Cognito Hosted UIの確認

**1. ログインURLの生成:**
```
https://[COGNITO_DOMAIN]/login?client_id=[APP_CLIENT_ID]&response_type=code&scope=openid+email+profile&redirect_uri=[APP_URL]/auth/callback
```

**実際の例:**
```
https://filesearch.auth.ap-northeast-1.amazoncognito.com/login?client_id=7uvwxyz1234567890abcdefghijklmn&response_type=code&scope=openid+email+profile&redirect_uri=http://localhost:3000/auth/callback
```

**2. ブラウザでアクセス:**
```
上記URLをブラウザに貼り付けてEnter
```

**3. 期待される動作:**
```
✅ Cognitoのログイン画面が表示される
✅ "Sign in" と "Sign up" のオプションがある
✅ メールアドレスとパスワードの入力欄がある
```

**4. エラーが発生する場合:**
```
❌ "Invalid redirect_uri" エラー
   → Callback URLsの設定を確認

❌ "Invalid client_id" エラー
   → App Client IDが正しいか確認

❌ "404 Not Found" エラー
   → Cognito Domainが正しいか確認
```

---

### Phase 3: サインアップフローのテスト

**1. テストユーザーの作成:**
```
Cognito Hosted UI → Sign up をクリック
```

**2. ユーザー情報を入力:**
```
Email: test@example.com
Password: Test1234!
Name: Test User
```

**3. 検証コードの確認:**
```
メールボックスを確認 → 検証コードをコピー
```

**4. 検証コードを入力:**
```
Cognito Hosted UI → 検証コード入力欄にペースト → Submit
```

**5. 期待される動作:**
```
✅ メールアドレスが検証される
✅ ユーザーアカウントが作成される
✅ 自動的にログインされる
✅ http://localhost:3000/auth/callback にリダイレクトされる
```

---

### Phase 4: サインインフローのテスト

**1. アプリケーションのログインボタンをクリック:**
```
http://localhost:3000 → "Login" ボタンをクリック
```

**2. Cognito Hosted UIにリダイレクト:**
```
✅ ログイン画面が表示される
```

**3. テストユーザーでログイン:**
```
Email: test@example.com
Password: Test1234!
→ "Sign in" ボタンをクリック
```

**4. 期待される動作:**
```
✅ ログインが成功する
✅ http://localhost:3000/auth/callback にリダイレクトされる
✅ トークンが発行される
✅ ダッシュボードページに遷移する
```

---

### Phase 5: トークンの検証

**ブラウザのコンソールで実行:**
```javascript
// Local Storageに保存されているトークンを確認
localStorage.getItem('CognitoIdentityServiceProvider.[APP_CLIENT_ID].LastAuthUser')
localStorage.getItem('CognitoIdentityServiceProvider.[APP_CLIENT_ID].[USERNAME].accessToken')
localStorage.getItem('CognitoIdentityServiceProvider.[APP_CLIENT_ID].[USERNAME].idToken')
```

**期待される値:**
```
✅ LastAuthUser: "test@example.com"
✅ accessToken: "eyJraWQiOiJ..." (長いJWT文字列)
✅ idToken: "eyJraWQiOiJ..." (長いJWT文字列)
```

---

### Phase 6: サインアウトフローのテスト

**1. サインアウトボタンをクリック:**
```
Dashboard → "Sign out" ボタンをクリック
```

**2. 期待される動作:**
```
✅ Local Storageからトークンが削除される
✅ http://localhost:3000 にリダイレクトされる
✅ ログインページが表示される
```

**3. トークンの削除確認:**
```javascript
// ブラウザのコンソールで実行
localStorage.getItem('CognitoIdentityServiceProvider.[APP_CLIENT_ID].[USERNAME].accessToken')
// null が返ってくることを確認
```

---

### Phase 7: Protected Routeのテスト

**1. ログアウトした状態でprotectedページにアクセス:**
```
http://localhost:3000/search
```

**2. 期待される動作:**
```
✅ 自動的にログインページにリダイレクトされる
✅ またはCognito Hosted UIが表示される
```

**3. ログイン後の動作:**
```
✅ 元のページ（/search）にリダイレクトされる
✅ コンテンツが正常に表示される
```

---

### テストチェックリスト

```markdown
## 環境変数検証
- [ ] yarn dev でエラーが出ない
- [ ] ✅ Amplify環境変数の検証が完了しました が表示される

## Cognito Hosted UI
- [ ] ログインURLにアクセスできる
- [ ] ログイン画面が表示される
- [ ] "Sign up" オプションがある

## サインアップ
- [ ] 新規ユーザー登録ができる
- [ ] 検証メールが届く
- [ ] 検証コードで認証できる

## サインイン
- [ ] メール+パスワードでログインできる
- [ ] トークンが発行される
- [ ] ダッシュボードに遷移する

## トークン
- [ ] accessTokenが取得できる
- [ ] idTokenが取得できる
- [ ] refreshTokenが取得できる

## サインアウト
- [ ] サインアウトできる
- [ ] トークンが削除される
- [ ] ログインページにリダイレクトされる

## Protected Route
- [ ] 未認証時にログインページにリダイレクトされる
- [ ] 認証後に元のページにリダイレクトされる
```

---

## クイックリファレンス

### 必須環境変数一覧

| 変数名 | 取得場所 | 例 |
|--------|---------|-----|
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | Cognito → User pools → Pool Id | `ap-northeast-1_abc123XYZ` |
| `NEXT_PUBLIC_COGNITO_APP_CLIENT_ID` | Cognito → User pools → App integration → Client ID | `7uvwxyz1234567890abcdefghijklmn` |
| `NEXT_PUBLIC_COGNITO_DOMAIN` | Cognito → User pools → App integration → Domain | `filesearch.auth.ap-northeast-1.amazoncognito.com` |
| `NEXT_PUBLIC_APP_URL` | CloudFront → Distribution domain name | `https://d123.cloudfront.net` |

---

### よくあるエラーと解決策

| エラーメッセージ | 原因 | 解決策 |
|----------------|------|--------|
| "Invalid User Pool ID format" | User Pool IDが不完全 | 完全なPool IDをコピー（`ap-northeast-1_XXXXX`形式） |
| "Domain should NOT include http//" | ドメインに`https://`が含まれる | プロトコルを削除（ドメイン名のみ） |
| "Invalid redirect_uri" | Callback URLが不一致 | Cognitoの設定を確認・更新 |
| "CORS error" | オリジンが許可されていない | Callback/Sign out URLsに追加 |
| "Token validation failed" | トークンが無効/期限切れ | ログアウト→再ログイン |

---

### サポートリソース

- **AWS Cognito公式ドキュメント**: https://docs.aws.amazon.com/cognito/
- **AWS Amplify公式ドキュメント**: https://docs.amplify.aws/
- **Next.js環境変数**: https://nextjs.org/docs/app/building-your-application/configuring/environment-variables

---

### トラブル時の連絡先

```
プロジェクト管理者: [担当者名]
メール: [support@your-company.com]
Slack: #cis-filesearch-support
```

---

**最終更新日**: 2025-01-11
**ドキュメントバージョン**: 1.0.0
