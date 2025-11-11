# AWS Cognito テスト & 検証チェックリスト

**完全テストガイド - すべての機能が正常に動作することを確認**

---

## 📋 テスト環境の準備

### 前提条件チェック

```markdown
- [ ] Node.js 18以上がインストールされている
- [ ] yarn がインストールされている
- [ ] プロジェクトが正しくクローンされている
- [ ] .env.local ファイルが作成されている
- [ ] すべての環境変数が設定されている
```

**確認コマンド:**
```bash
# Node.jsのバージョン確認
node --version
# 出力例: v18.17.0 以上であればOK

# yarnのバージョン確認
yarn --version
# 出力例: 1.22.x

# プロジェクトディレクトリに移動
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

# .env.local の存在確認
ls -la .env.local
# ファイルが表示されればOK

# 環境変数の内容確認
cat .env.local
# すべての変数が設定されていることを確認
```

---

## Phase 1: 環境変数の検証

### Test 1.1: .env.local ファイルの存在確認

**手順:**
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
ls -la .env.local
```

**期待される結果:**
```
✅ -rw-r--r--  1 user  staff  1234 Jan 11 10:00 .env.local
```

**エラーの場合:**
```
❌ ls: .env.local: No such file or directory
→ サンプルファイルをコピー: cp .env.local.example .env.local
```

---

### Test 1.2: 環境変数の形式検証

**手順:**
```bash
yarn dev
```

**期待される結果:**
```
✅ Amplify環境変数の検証が完了しました
▲ Next.js 15.x.x
- Local:        http://localhost:3000
- Environments: .env.local
```

**エラーパターンと解決策:**

**パターン1: 環境変数が欠けている**
```
❌ 以下の環境変数が設定されていません:
  - NEXT_PUBLIC_COGNITO_USER_POOL_ID
  - NEXT_PUBLIC_COGNITO_APP_CLIENT_ID

解決策:
→ .env.local を開いて各変数を設定
```

**パターン2: User Pool IDの形式が不正**
```
❌ User Pool IDの形式が不正です:
  実際の値: ap-northeast-1
  期待する形式: ap-northeast-1_XXXXXXXXX

解決策:
→ AWS Console → Cognito → User pools → Pool Id を**全文**コピー
→ .env.local を更新
→ yarn dev で再起動
```

**パターン3: Cognito Domainにプロトコルが含まれている**
```
❌ Cognito Domainにプロトコル（http/https）を含めないでください:
  実際の値: https://filesearch.auth.ap-northeast-1.amazoncognito.com
  期待する形式: filesearch.auth.ap-northeast-1.amazoncognito.com

解決策:
→ .env.local を開いて https:// を削除
→ yarn dev で再起動
```

**パターン4: App URLにプロトコルがない**
```
❌ App URLはhttp://またはhttps://で始まる必要があります:
  実際の値: localhost:3000
  期待する形式: http://localhost:3000

解決策:
→ .env.local を開いて http:// を追加
→ yarn dev で再起動
```

---

### Test 1.3: ブラウザでの環境変数確認

**手順:**
1. 開発サーバーを起動: `yarn dev`
2. ブラウザで `http://localhost:3000` にアクセス
3. F12キーを押してデベロッパーツールを開く
4. Console タブを選択
5. 以下のコマンドを実行:

```javascript
console.log('User Pool ID:', process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID)
console.log('App Client ID:', process.env.NEXT_PUBLIC_COGNITO_APP_CLIENT_ID)
console.log('Cognito Domain:', process.env.NEXT_PUBLIC_COGNITO_DOMAIN)
console.log('App URL:', process.env.NEXT_PUBLIC_APP_URL)
```

**期待される結果:**
```
User Pool ID: ap-northeast-1_abc123XYZ
App Client ID: 7uvwxyz1234567890abcdefghijklmn
Cognito Domain: filesearch.auth.ap-northeast-1.amazoncognito.com
App URL: http://localhost:3000
```

**エラーの場合:**
```
User Pool ID: undefined
→ 環境変数が読み込まれていない
→ 開発サーバーを再起動: Ctrl+C → yarn dev
```

---

## Phase 2: AWS Console設定の検証

### Test 2.1: User Pool IDの確認

**手順:**
1. AWS Console にログイン: https://console.aws.amazon.com/
2. リージョンを Tokyo (ap-northeast-1) に変更
3. 検索バーに "Cognito" と入力
4. "Amazon Cognito" をクリック
5. 左サイドバー → "User pools" をクリック
6. 該当のUser Pool名をクリック
7. 画面上部の "Pool Id" を確認

**期待される結果:**
```
✅ Pool Id: ap-northeast-1_abc123XYZ
✅ .env.local の NEXT_PUBLIC_COGNITO_USER_POOL_ID と完全一致
```

**不一致の場合:**
```
❌ Pool Id: ap-northeast-1_abc123XYZ
❌ .env.local: ap-northeast-1_different123

解決策:
→ Pool Id を**全文**コピー
→ .env.local を更新
→ 開発サーバーを再起動
```

---

### Test 2.2: App Client IDの確認

**手順:**
1. User Pool画面から "App integration" タブをクリック
2. 下にスクロールして "App clients and analytics" セクションを探す
3. App client listに表示されている "Client ID" を確認

**期待される結果:**
```
✅ Client ID: 7uvwxyz1234567890abcdefghijklmn
✅ .env.local の NEXT_PUBLIC_COGNITO_APP_CLIENT_ID と完全一致
```

**不一致の場合:**
```
❌ Client ID: 7uvwxyz1234567890abcdefghijklmn
❌ .env.local: different1234567890abcdefghijklmn

解決策:
→ Client ID をコピー
→ .env.local を更新
→ 開発サーバーを再起動
```

---

### Test 2.3: Cognito Domainの確認

**手順:**
1. User Pool画面の "App integration" タブ
2. "Domain" セクションを確認

**期待される結果:**
```
✅ Domain: filesearch.auth.ap-northeast-1.amazoncognito.com
✅ .env.local の NEXT_PUBLIC_COGNITO_DOMAIN と完全一致（https://なし）
```

**ドメインが未設定の場合:**
```
❌ No domain configured

解決策:
→ "Actions" → "Create Cognito domain" をクリック
→ Domain prefix: "filesearch" を入力（または任意の名前）
→ "Create" をクリック
→ 生成されたドメインをコピー（https://なし）
→ .env.local を更新
→ 開発サーバーを再起動
```

---

### Test 2.4: Callback URLsの確認

**手順:**
1. User Pool画面の "App integration" タブ
2. "App clients and analytics" セクション
3. 該当のApp client名をクリック
4. "Hosted UI" セクションを確認
5. "Callback URLs" を確認

**期待される結果:**
```
✅ 開発環境: http://localhost:3000/auth/callback が含まれている
✅ 本番環境: https://your-app.com/auth/callback が含まれている（必要な場合）
```

**未設定の場合:**
```
❌ Callback URLs: (empty)

解決策:
→ "Edit" ボタンをクリック
→ Callback URLs欄に以下を1行ずつ追加:
  http://localhost:3000/auth/callback
  https://your-app.com/auth/callback（本番環境用）
→ "Save changes" をクリック
```

**⚠️ 重要な注意点:**
- 末尾のスラッシュ（/）の有無を統一する
- 完全一致が必要（ワイルドカード不可）
- 複数のURLを設定する場合は1行ずつ入力

---

### Test 2.5: Sign out URLsの確認

**手順:**
1. 同じく "Hosted UI" セクション
2. "Sign out URLs" を確認

**期待される結果:**
```
✅ 開発環境: http://localhost:3000 が含まれている
✅ 本番環境: https://your-app.com が含まれている（必要な場合）
```

**未設定の場合:**
```
❌ Sign out URLs: (empty)

解決策:
→ "Edit" ボタンをクリック
→ Sign out URLs欄に以下を1行ずつ追加:
  http://localhost:3000
  https://your-app.com（本番環境用）
→ "Save changes" をクリック
```

---

### Test 2.6: OAuth設定の確認

**手順:**
1. App client画面の "Hosted UI" セクション
2. 以下の設定を確認

**期待される結果:**

**1. OAuth 2.0 grant types:**
```
✅ Authorization code grant（チェックあり）
❌ Implicit grant（チェックなし）
```

**2. OpenID Connect scopes:**
```
✅ openid（チェックあり）
✅ email（チェックあり）
✅ profile（チェックあり）
```

**3. Authentication flows:**
```
✅ ALLOW_USER_SRP_AUTH（チェックあり）
✅ ALLOW_REFRESH_TOKEN_AUTH（チェックあり）
❌ ALLOW_USER_PASSWORD_AUTH（チェックなし - セキュリティリスク）
```

**4. Client secret:**
```
✅ Client secret: Not generated
```

**⚠️ PKCE使用のため、client secretは不要**
もしsecretが生成されている場合:
- 新しいApp clientを作成
- "Don't generate a client secret" を選択

---

## Phase 3: Cognito Hosted UIのテスト

### Test 3.1: ログインURLの生成とアクセス

**手順:**
1. 以下のテンプレートを使ってURLを生成:
```
https://[COGNITO_DOMAIN]/login?client_id=[APP_CLIENT_ID]&response_type=code&scope=openid+email+profile&redirect_uri=[APP_URL]/auth/callback
```

2. 実際の値を代入:
```
https://filesearch.auth.ap-northeast-1.amazoncognito.com/login?client_id=2s3km9tqr8bffn6bqc0ih0cma1&response_type=code&scope=openid+email+profile&redirect_uri=http://localhost:3000/auth/callback
```

3. ブラウザの新しいタブで上記URLにアクセス

**期待される結果:**
```
✅ Cognitoのログイン画面が表示される
✅ "Sign in" ボタンがある
✅ "Sign up" リンクがある
✅ メールアドレスとパスワードの入力欄がある
```

**エラーパターンと解決策:**

**パターン1: "Invalid redirect_uri" エラー**
```
❌ Invalid redirect_uri: http://localhost:3000/auth/callback

解決策:
→ AWS Console → Cognito → User pools → App client → Hosted UI
→ Callback URLs に http://localhost:3000/auth/callback を追加
→ ブラウザのキャッシュをクリア（Ctrl+Shift+Delete）
→ 再度URLにアクセス
```

**パターン2: "Invalid client_id" エラー**
```
❌ Invalid client_id

解決策:
→ .env.local の NEXT_PUBLIC_COGNITO_APP_CLIENT_ID を確認
→ AWS Console → Cognito → App client → Client ID と一致しているか確認
→ 不一致の場合は .env.local を更新して開発サーバー再起動
```

**パターン3: "404 Not Found" エラー**
```
❌ 404 Not Found

解決策:
→ .env.local の NEXT_PUBLIC_COGNITO_DOMAIN を確認
→ AWS Console → Cognito → Domain と一致しているか確認
→ https:// が含まれていないか確認（含まれている場合は削除）
```

---

### Test 3.2: サインアップフローのテスト

**手順:**
1. Cognito Hosted UI画面で "Sign up" リンクをクリック
2. 以下の情報を入力:
   ```
   Email: test-user@example.com
   Password: TestPassword123!
   Name: Test User
   ```
3. "Sign up" ボタンをクリック
4. メールボックスを確認（test-user@example.comのメール）
5. 検証コードをコピー
6. Cognito画面に検証コードを入力
7. "Confirm" ボタンをクリック

**期待される結果:**

**Step 1-3: サインアップ**
```
✅ サインアップフォームが表示される
✅ エラーなく送信できる
✅ "Confirm your account" 画面に遷移する
```

**Step 4-5: 検証メール**
```
✅ test-user@example.com にメールが届く
✅ 件名: "Your verification code"
✅ 本文に6桁の検証コードが記載されている
```

**Step 6-7: 検証**
```
✅ 検証コードが受理される
✅ "Your account has been confirmed" メッセージが表示される
✅ 自動的にログインされる
✅ http://localhost:3000/auth/callback にリダイレクトされる
```

**エラーパターン:**

**パターン1: パスワードポリシー違反**
```
❌ Password did not conform with policy: Password must have uppercase characters

解決策:
→ パスワードに大文字を含める（例: TestPassword123!）
```

**パターン2: メールが届かない**
```
❌ 検証メールが届かない

解決策:
→ 迷惑メールフォルダを確認
→ 5分待ってから確認
→ AWS Console → Cognito → User pool → Users → [test-user@example.com]
  → "Resend confirmation code" をクリック
```

**パターン3: リダイレクトエラー**
```
❌ http://localhost:3000/auth/callback にリダイレクトされない

解決策:
→ Callback URLs の設定を確認
→ Test 2.4に戻って設定を確認
```

---

### Test 3.3: サインインフローのテスト

**手順:**
1. アプリケーションのトップページにアクセス: `http://localhost:3000`
2. "Login" ボタンをクリック
3. Cognito Hosted UIにリダイレクトされる
4. 以下の情報を入力:
   ```
   Email: test-user@example.com
   Password: TestPassword123!
   ```
5. "Sign in" ボタンをクリック

**期待される結果:**

**Step 1-3: ログイン画面への遷移**
```
✅ "Login" ボタンがクリックできる
✅ Cognito Hosted UIにリダイレクトされる
✅ ログインフォームが表示される
```

**Step 4-5: ログイン**
```
✅ メールアドレスとパスワードが入力できる
✅ "Sign in" ボタンがクリックできる
✅ エラーなくログインできる
✅ http://localhost:3000/auth/callback にリダイレクトされる
✅ ダッシュボードページに遷移する（またはホームページ）
```

**エラーパターン:**

**パターン1: "Incorrect username or password" エラー**
```
❌ Incorrect username or password

解決策:
→ メールアドレスとパスワードを再確認
→ パスワードをリセット: "Forgot your password?" リンクをクリック
```

**パターン2: CORS エラー**
```
❌ Access to fetch at '...' from origin 'http://localhost:3000' has been blocked by CORS policy

解決策:
→ AWS Console → Cognito → App client → Hosted UI
→ Callback URLs と Sign out URLs に http://localhost:3000 が含まれているか確認
→ ブラウザのキャッシュをクリア（Ctrl+Shift+Delete）
→ 開発サーバーを再起動: yarn dev
```

**パターン3: 無限ループ（ログイン画面に戻される）**
```
❌ ログイン後、再びログイン画面にリダイレクトされる

解決策:
→ ブラウザのコンソール（F12 → Console）でエラーを確認
→ LocalStorageをクリア: F12 → Application → Local Storage → Clear
→ 再度ログイン
```

---

## Phase 4: トークンの検証

### Test 4.1: LocalStorageのトークン確認

**手順:**
1. ログイン後、ブラウザでF12キーを押す
2. "Application" タブ（Chromeの場合）または "Storage" タブ（Firefoxの場合）を選択
3. 左サイドバー → "Local Storage" → "http://localhost:3000" を展開
4. 以下のキーを確認:

```
CognitoIdentityServiceProvider.[APP_CLIENT_ID].LastAuthUser
CognitoIdentityServiceProvider.[APP_CLIENT_ID].[USERNAME].accessToken
CognitoIdentityServiceProvider.[APP_CLIENT_ID].[USERNAME].idToken
CognitoIdentityServiceProvider.[APP_CLIENT_ID].[USERNAME].refreshToken
```

**期待される結果:**
```
✅ LastAuthUser: test-user@example.com
✅ accessToken: eyJraWQiOiJ... (長いJWT文字列)
✅ idToken: eyJraWQiOiJ... (長いJWT文字列)
✅ refreshToken: eyJjdHkiOiJ... (長いJWT文字列)
```

**トークンが存在しない場合:**
```
❌ LocalStorageにトークンが保存されていない

解決策:
→ サインアウトして再度サインイン
→ ブラウザのコンソール（F12 → Console）でエラーを確認
→ Callback URLsの設定を確認（Test 2.4）
```

---

### Test 4.2: トークンのデコード確認

**手順:**
1. ブラウザのコンソール（F12 → Console）を開く
2. 以下のコマンドを実行:

```javascript
// accessTokenを取得
const accessToken = localStorage.getItem('CognitoIdentityServiceProvider.2s3km9tqr8bffn6bqc0ih0cma1.test-user@example.com.accessToken')

// トークンをデコード（base64）
const payload = JSON.parse(atob(accessToken.split('.')[1]))
console.log('Token Payload:', payload)
```

**期待される結果:**
```javascript
{
  "sub": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "cognito:groups": [],
  "iss": "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_abc123XYZ",
  "client_id": "2s3km9tqr8bffn6bqc0ih0cma1",
  "origin_jti": "...",
  "event_id": "...",
  "token_use": "access",
  "scope": "openid email profile",
  "auth_time": 1705123456,
  "exp": 1705127056,
  "iat": 1705123456,
  "jti": "...",
  "username": "test-user@example.com"
}
```

**重要なフィールド:**
```
✅ token_use: "access"（アクセストークン）
✅ scope: "openid email profile"（要求したスコープ）
✅ client_id: .env.localのApp Client IDと一致
✅ exp: 有効期限（UNIXタイムスタンプ）
```

---

### Test 4.3: トークンの有効期限確認

**手順:**
1. ブラウザのコンソールで以下のコマンドを実行:

```javascript
// accessTokenを取得
const accessToken = localStorage.getItem('CognitoIdentityServiceProvider.2s3km9tqr8bffn6bqc0ih0cma1.test-user@example.com.accessToken')

// トークンをデコード
const payload = JSON.parse(atob(accessToken.split('.')[1]))

// 有効期限をチェック
const now = Math.floor(Date.now() / 1000)
const expiresAt = payload.exp
const remainingSeconds = expiresAt - now

console.log('現在時刻:', new Date(now * 1000).toLocaleString())
console.log('有効期限:', new Date(expiresAt * 1000).toLocaleString())
console.log('残り時間:', Math.floor(remainingSeconds / 60), '分')

if (remainingSeconds > 0) {
  console.log('✅ トークンは有効です')
} else {
  console.log('❌ トークンは期限切れです')
}
```

**期待される結果:**
```
✅ トークンは有効です
残り時間: 59 分（または60分未満）
```

**トークンが期限切れの場合:**
```
❌ トークンは期限切れです

解決策:
→ サインアウトして再度サインイン
→ または、リフレッシュトークンを使って自動更新（実装による）
```

---

## Phase 5: サインアウトフローのテスト

### Test 5.1: サインアウトボタンのテスト

**手順:**
1. ログイン後、ダッシュボードページで "Sign out" ボタンをクリック
2. ブラウザの動作を確認

**期待される結果:**
```
✅ "Sign out" ボタンがクリックできる
✅ LocalStorageからトークンが削除される
✅ http://localhost:3000 にリダイレクトされる
✅ ログインページが表示される
```

---

### Test 5.2: LocalStorageのクリア確認

**手順:**
1. サインアウト後、F12 → Application → Local Storage → http://localhost:3000 を確認
2. 以下のキーが削除されていることを確認:

```
CognitoIdentityServiceProvider.[APP_CLIENT_ID].LastAuthUser
CognitoIdentityServiceProvider.[APP_CLIENT_ID].[USERNAME].accessToken
CognitoIdentityServiceProvider.[APP_CLIENT_ID].[USERNAME].idToken
CognitoIdentityServiceProvider.[APP_CLIENT_ID].[USERNAME].refreshToken
```

**期待される結果:**
```
✅ すべてのCognitoトークンが削除されている
✅ LocalStorageがクリーンになっている
```

**トークンが残っている場合:**
```
❌ トークンが削除されていない

解決策:
→ サインアウト処理の実装を確認
→ 手動でLocalStorageをクリア: localStorage.clear()
```

---

### Test 5.3: サインアウト後のアクセス制限確認

**手順:**
1. サインアウト後、protected routeにアクセス:
   ```
   http://localhost:3000/search
   ```

**期待される結果:**
```
✅ 自動的にログインページにリダイレクトされる
✅ または Cognito Hosted UIが表示される
✅ コンテンツは表示されない
```

**エラーの場合:**
```
❌ ログインせずにコンテンツが表示される

解決策:
→ ProtectedRoute コンポーネントの実装を確認
→ /src/components/Auth/ProtectedRoute.tsx
```

---

## Phase 6: Protected Routeのテスト

### Test 6.1: 未認証時のリダイレクト

**手順:**
1. ブラウザでLocalStorageをクリア（F12 → Application → Local Storage → Clear）
2. protected routeにアクセス: `http://localhost:3000/search`

**期待される結果:**
```
✅ 自動的にログインページにリダイレクトされる
✅ または Cognito Hosted UIが表示される
✅ URLに `?redirect=/search` のようなパラメータが含まれる（実装による）
```

---

### Test 6.2: 認証後の元ページへのリダイレクト

**手順:**
1. 未認証状態で `http://localhost:3000/search` にアクセス
2. ログインページにリダイレクトされる
3. ログイン情報を入力してサインイン

**期待される結果:**
```
✅ ログイン後、元のページ（/search）にリダイレクトされる
✅ コンテンツが正常に表示される
```

**エラーの場合:**
```
❌ ホームページにリダイレクトされる（元のページに戻らない）

解決策:
→ リダイレクトロジックの実装を確認
→ URLパラメータ（?redirect=...）の処理を確認
```

---

### Test 6.3: トークン有効期限切れ時の処理

**手順:**
1. ログイン後、ブラウザのコンソールで以下のコマンドを実行:
   ```javascript
   // accessTokenを削除（有効期限切れをシミュレート）
   const keys = Object.keys(localStorage)
   keys.forEach(key => {
     if (key.includes('accessToken')) {
       localStorage.removeItem(key)
     }
   })
   ```
2. ページをリロード（F5）

**期待される結果:**
```
✅ 自動的にログインページにリダイレクトされる
✅ または、リフレッシュトークンを使って自動更新される（実装による）
```

---

## 完全テストチェックリスト

### Phase 1: 環境変数検証
```markdown
- [ ] .env.local ファイルが存在する
- [ ] yarn dev でエラーが出ない
- [ ] "✅ Amplify環境変数の検証が完了しました" が表示される
- [ ] ブラウザのコンソールで環境変数を確認できる
```

### Phase 2: AWS Console設定検証
```markdown
- [ ] User Pool IDが .env.local と一致する
- [ ] App Client IDが .env.local と一致する
- [ ] Cognito Domainが .env.local と一致する
- [ ] Callback URLs に http://localhost:3000/auth/callback が含まれる
- [ ] Sign out URLs に http://localhost:3000 が含まれる
- [ ] OAuth scopesに openid, email, profile が含まれる
- [ ] Authorization code grant が有効化されている
- [ ] Client secretが生成されていない
```

### Phase 3: Hosted UIテスト
```markdown
- [ ] ログインURLにアクセスできる
- [ ] ログイン画面が正常に表示される
- [ ] サインアップができる
- [ ] 検証メールが届く
- [ ] 検証コードで認証できる
- [ ] サインインができる
- [ ] リダイレクトが正常に動作する
```

### Phase 4: トークン検証
```markdown
- [ ] accessTokenが発行される
- [ ] idTokenが発行される
- [ ] refreshTokenが発行される
- [ ] トークンのペイロードが正しい
- [ ] トークンの有効期限が適切
```

### Phase 5: サインアウトテスト
```markdown
- [ ] サインアウトボタンがクリックできる
- [ ] LocalStorageからトークンが削除される
- [ ] ログインページにリダイレクトされる
- [ ] Protected routeにアクセスできなくなる
```

### Phase 6: Protected Routeテスト
```markdown
- [ ] 未認証時にリダイレクトされる
- [ ] 認証後に元のページに戻る
- [ ] トークン期限切れ時に適切に処理される
```

---

## テスト結果レポート

**テスト実施日:** __________

**テスト環境:**
- Node.js バージョン: __________
- Next.js バージョン: __________
- ブラウザ: __________

**結果サマリー:**
- ✅ 成功: ______ / 30
- ❌ 失敗: ______ / 30
- ⚠️ 警告: ______ / 30

**失敗したテスト:**
1. __________________________________________
2. __________________________________________
3. __________________________________________

**備考:**
_____________________________________________
_____________________________________________
_____________________________________________

---

**最終更新日**: 2025-01-11
**ドキュメントバージョン**: 1.0.0
