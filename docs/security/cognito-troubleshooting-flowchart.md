# AWS Cognito トラブルシューティング フローチャート

## エラー診断フローチャート

```
起動時にエラーが発生した？
│
├─ YES → どんなエラーメッセージ？
│   │
│   ├─ "Missing required environment variables"
│   │   │
│   │   ├─ .env.local ファイルは存在する？
│   │   │   │
│   │   │   ├─ NO → サンプルファイルをコピー
│   │   │   │       `cp .env.local.example .env.local`
│   │   │   │       → 実際の値を入力
│   │   │   │
│   │   │   └─ YES → 環境変数は設定されている？
│   │   │           │
│   │   │           ├─ NO → AWS Consoleから値を取得
│   │   │           │       → .env.localに貼り付け
│   │   │           │
│   │   │           └─ YES → 開発サーバーを再起動
│   │   │                   `yarn dev`
│   │
│   ├─ "Invalid User Pool ID format"
│   │   │
│   │   └─ User Pool IDの形式を確認
│   │       ✅ ap-northeast-1_abc123XYZ
│   │       ❌ ap-northeast-1
│   │       → AWS Console → Cognito → User pools
│   │         → Pool Id を**全文**コピー
│   │
│   ├─ "Domain should NOT include http//"
│   │   │
│   │   └─ Cognito Domainから https:// を削除
│   │       ✅ filesearch.auth.ap-northeast-1.amazoncognito.com
│   │       ❌ https://filesearch.auth.ap-northeast-1.amazoncognito.com
│   │
│   └─ "App URL must start with http://"
│       │
│       └─ App URLに http:// または https:// を追加
│           ✅ https://your-app.com
│           ✅ http://localhost:3000
│           ❌ your-app.com
│
└─ NO → ログイン時にエラーが発生した？
    │
    ├─ YES → どんなエラーメッセージ？
    │   │
    │   ├─ "Invalid redirect_uri"
    │   │   │
    │   │   ├─ Cognitoの設定を確認
    │   │   │   AWS Console → Cognito → User pools
    │   │   │   → App integration → App client
    │   │   │   → Hosted UI → Callback URLs
    │   │   │   │
    │   │   │   ├─ 開発環境: http://localhost:3000/auth/callback
    │   │   │   └─ 本番環境: https://your-app.com/auth/callback
    │   │   │
    │   │   ├─ URLの完全一致を確認
    │   │   │   ✅ http://localhost:3000/auth/callback
    │   │   │   ❌ http://localhost:3000/auth/callback/
    │   │   │   ❌ http://localhost:3000
    │   │   │
    │   │   └─ 設定変更後は再起動
    │   │       `yarn dev`
    │   │
    │   ├─ CORS error
    │   │   │
    │   │   ├─ Callback URLs と Sign out URLs を確認
    │   │   │   → 現在のオリジン（http://localhost:3000）が
    │   │   │     含まれているか確認
    │   │   │
    │   │   ├─ ブラウザのキャッシュをクリア
    │   │   │   Chrome: Ctrl+Shift+Delete
    │   │   │
    │   │   └─ 開発サーバーを再起動
    │   │       `yarn dev`
    │   │
    │   ├─ "Invalid client_id"
    │   │   │
    │   │   └─ App Client IDを確認
    │   │       AWS Console → Cognito → User pools
    │   │       → App integration → App client
    │   │       → Client ID をコピー
    │   │       → .env.local に貼り付け
    │   │
    │   └─ "Token validation failed"
    │       │
    │       ├─ ログアウトして再ログイン
    │       │   → LocalStorageをクリア
    │       │     F12 → Application → Local Storage → Clear
    │       │
    │       ├─ トークンの有効期限を確認
    │       │   AWS Console → Cognito → User pools
    │       │   → App integration → App client
    │       │   → Token validity units
    │       │   → Access token: 60 minutes (推奨)
    │       │
    │       └─ App Client IDの一致を確認
    │           .env.local の App Client ID ==
    │           AWS Consoleの Client ID
    │
    └─ NO → 正常に動作している
        → テストチェックリストを実行
```

---

## エラーメッセージ別クイックリファレンス

### 起動時エラー

| エラーメッセージ | 原因 | 解決コマンド |
|----------------|------|-------------|
| `Missing required environment variables` | `.env.local`が存在しない or 空 | `cp .env.local.example .env.local` |
| `Invalid User Pool ID format` | Pool IDの形式が不正 | AWS Consoleで完全なPool IDを取得 |
| `Domain should NOT include http://` | ドメインに`https://`が含まれる | `https://`を削除 |
| `App URL must start with http://` | URLにプロトコルがない | `http://` or `https://`を追加 |

---

### ログイン時エラー

| エラーメッセージ | 原因 | 解決方法 |
|----------------|------|----------|
| `Invalid redirect_uri` | Callback URLが不一致 | Cognitoの設定を確認・更新 |
| `CORS error` | オリジンが許可されていない | Callback/Sign out URLsに追加 |
| `Invalid client_id` | App Client IDが間違っている | AWS Consoleで正しいClient IDを取得 |
| `Token validation failed` | トークンが無効/期限切れ | ログアウト→再ログイン |
| `404 Not Found` | Cognito Domainが間違っている | AWS Consoleでドメインを確認 |

---

## ステップバイステップ診断

### Step 1: 環境変数の確認

```bash
# .env.local ファイルの存在確認
ls -la .env.local

# 内容の確認
cat .env.local

# 期待される出力:
# NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_XXXXX
# NEXT_PUBLIC_COGNITO_APP_CLIENT_ID=XXXXXXXX
# NEXT_PUBLIC_COGNITO_DOMAIN=filesearch.auth.ap-northeast-1.amazoncognito.com
# NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**チェック項目:**
- [ ] `.env.local` ファイルが存在する
- [ ] すべての環境変数が設定されている（空文字列でない）
- [ ] User Pool IDが`ap-northeast-1_XXXXX`形式
- [ ] Cognito Domainに`https://`が含まれていない
- [ ] App URLが`http://`または`https://`で始まる

---

### Step 2: AWS Console設定の確認

**Cognito User Pool:**
```
AWS Console → Cognito → User pools → [Your Pool]
```

**確認項目:**

1. **Pool Id:**
   ```
   ✅ 形式: ap-northeast-1_abc123XYZ
   ✅ .env.localと完全一致
   ```

2. **App Client ID:**
   ```
   App integration タブ → App clients
   ✅ Client IDが表示されている
   ✅ .env.localと完全一致
   ```

3. **Cognito Domain:**
   ```
   App integration タブ → Domain
   ✅ ドメインが設定されている
   ✅ .env.localと完全一致（https://なし）
   ```

4. **Callback URLs:**
   ```
   App integration タブ → App client → Hosted UI → Callback URLs
   ✅ http://localhost:3000/auth/callback が含まれている
   ✅ 本番環境のURLも必要に応じて追加
   ```

5. **Sign out URLs:**
   ```
   App integration タブ → App client → Hosted UI → Sign out URLs
   ✅ http://localhost:3000 が含まれている
   ✅ 本番環境のURLも必要に応じて追加
   ```

---

### Step 3: Hosted UIのテスト

**ログインURLの生成:**
```
https://[COGNITO_DOMAIN]/login?client_id=[APP_CLIENT_ID]&response_type=code&scope=openid+email+profile&redirect_uri=[APP_URL]/auth/callback
```

**実際の例:**
```
https://filesearch.auth.ap-northeast-1.amazoncognito.com/login?client_id=2s3km9tqr8bffn6bqc0ih0cma1&response_type=code&scope=openid+email+profile&redirect_uri=http://localhost:3000/auth/callback
```

**期待される結果:**
- ✅ Cognitoのログイン画面が表示される
- ✅ "Sign in" と "Sign up" のオプションがある
- ❌ "Invalid redirect_uri" エラーが出る → Callback URLsを確認
- ❌ "Invalid client_id" エラーが出る → App Client IDを確認
- ❌ "404 Not Found" エラーが出る → Cognito Domainを確認

---

### Step 4: 開発サーバーの起動確認

```bash
# 開発サーバーを起動
yarn dev

# 期待される出力:
# ✅ Amplify環境変数の検証が完了しました
# ▲ Next.js 15.x.x
# - Local:        http://localhost:3000
# - Environments: .env.local
```

**エラーが出る場合:**

```bash
# ❌ 以下の環境変数が設定されていません:
#   - NEXT_PUBLIC_COGNITO_USER_POOL_ID
→ Step 1に戻って.env.localを確認

# ❌ User Pool IDの形式が不正です:
#   実際の値: ap-northeast-1
#   期待する形式: ap-northeast-1_XXXXXXXXX
→ AWS ConsoleでPool Idを**全文**コピー

# ❌ Cognito Domainにプロトコル（http/https）を含めないでください:
#   実際の値: https://filesearch.auth.ap-northeast-1.amazoncognito.com
→ https:// を削除
```

---

### Step 5: ブラウザのテスト

**1. アプリケーションにアクセス:**
```
http://localhost:3000
```

**2. "Login" ボタンをクリック:**
- ✅ Cognito Hosted UIにリダイレクトされる
- ❌ CORS errorが出る → Callback URLsを確認
- ❌ "Invalid redirect_uri" エラー → Callback URLsを確認

**3. テストユーザーでログイン:**
```
Email: test@example.com
Password: Test1234!
```

**4. 期待される動作:**
- ✅ http://localhost:3000/auth/callback にリダイレクトされる
- ✅ トークンが発行される
- ✅ ダッシュボードに遷移する
- ❌ "Token validation failed" → Step 2のApp Client IDを確認

---

## よくある設定ミス

### ミス1: User Pool IDが不完全

```bash
# ❌ 間違い
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1

# ✅ 正しい
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_abc123XYZ
```

**解決方法:**
AWS Console → Cognito → User pools → [Pool name] → "Pool Id" を**全文**コピー

---

### ミス2: Cognito Domainにプロトコルが含まれている

```bash
# ❌ 間違い
NEXT_PUBLIC_COGNITO_DOMAIN=https://filesearch.auth.ap-northeast-1.amazoncognito.com

# ✅ 正しい
NEXT_PUBLIC_COGNITO_DOMAIN=filesearch.auth.ap-northeast-1.amazoncognito.com
```

**解決方法:**
`https://` を削除してドメイン名のみを設定

---

### ミス3: App URLにプロトコルがない

```bash
# ❌ 間違い
NEXT_PUBLIC_APP_URL=localhost:3000

# ✅ 正しい
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**解決方法:**
`http://` または `https://` を追加

---

### ミス4: Callback URLの末尾にスラッシュが含まれている

```bash
# Cognitoに登録されているURL
http://localhost:3000/auth/callback/

# 実際のリダイレクト先
http://localhost:3000/auth/callback
```

**エラー:**
```
Invalid redirect_uri: http://localhost:3000/auth/callback
```

**解決方法:**
Cognitoの設定を更新して末尾のスラッシュを削除

---

### ミス5: .env.local ファイル名の間違い

```bash
# ❌ 間違い
.env
env.local
.env.local.example

# ✅ 正しい
.env.local
```

**解決方法:**
ファイル名を `.env.local` に変更

---

## 緊急時のデバッグコマンド

```bash
# 環境変数の値を確認（開発時のみ！本番環境では実行しない）
echo $NEXT_PUBLIC_COGNITO_USER_POOL_ID
echo $NEXT_PUBLIC_COGNITO_APP_CLIENT_ID
echo $NEXT_PUBLIC_COGNITO_DOMAIN
echo $NEXT_PUBLIC_APP_URL

# .env.local ファイルの内容を確認
cat .env.local

# Node.jsプロセスで環境変数を確認
node -e "console.log('User Pool ID:', process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID)"

# ブラウザのコンソールで環境変数を確認
# （開発サーバー起動後、ブラウザのコンソールで実行）
console.log('User Pool ID:', process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID)

# LocalStorageに保存されているトークンを確認
localStorage.getItem('CognitoIdentityServiceProvider.2s3km9tqr8bffn6bqc0ih0cma1.LastAuthUser')

# キャッシュをクリア（問題が解決しない場合）
# ブラウザ: Ctrl+Shift+Delete
# または
yarn clean
rm -rf .next
yarn dev
```

---

## 最終チェックリスト

```markdown
### 環境変数設定
- [ ] .env.local ファイルが存在する
- [ ] NEXT_PUBLIC_COGNITO_USER_POOL_ID が設定されている
- [ ] NEXT_PUBLIC_COGNITO_APP_CLIENT_ID が設定されている
- [ ] NEXT_PUBLIC_COGNITO_DOMAIN が設定されている（https://なし）
- [ ] NEXT_PUBLIC_APP_URL が設定されている（http/https付き）

### AWS Console設定
- [ ] User Pool が作成されている
- [ ] App Client が作成されている
- [ ] Cognito Domain が設定されている
- [ ] Callback URLs に http://localhost:3000/auth/callback が含まれている
- [ ] Sign out URLs に http://localhost:3000 が含まれている
- [ ] OAuth scopes に openid, email, profile が含まれている
- [ ] Authorization code grant が有効化されている
- [ ] Client secret が生成されていない（PKCE使用のため）

### 動作確認
- [ ] yarn dev でエラーが出ない
- [ ] Hosted UIにアクセスできる
- [ ] サインアップができる
- [ ] サインインができる
- [ ] トークンが発行される
- [ ] サインアウトができる
- [ ] Protected routeが正常に動作する
```

---

**トラブルが解決しない場合:**
1. このフローチャートを最初から再度確認
2. AWS Cognitoの設定をすべてリセットして再作成
3. プロジェクト管理者に連絡

---

**最終更新日**: 2025-01-11
**ドキュメントバージョン**: 1.0.0
