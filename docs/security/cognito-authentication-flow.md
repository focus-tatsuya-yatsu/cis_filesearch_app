# AWS Cognito 認証フロー図解

**OAuth 2.0 Authorization Code Grant with PKCE - 完全フロー解説**

---

## 🔄 認証フロー全体像

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CIS File Search Application                       │
│                    OAuth 2.0 PKCE Authentication Flow                │
└─────────────────────────────────────────────────────────────────────┘

User (ブラウザ)          Next.js App          AWS Cognito          Backend API
    │                        │                      │                    │
    │  1. アクセス            │                      │                    │
    ├───────────────────────>│                      │                    │
    │  http://localhost:3000 │                      │                    │
    │                        │                      │                    │
    │  2. 未認証を検知        │                      │                    │
    │<───────────────────────┤                      │                    │
    │  "Login" ボタン表示    │                      │                    │
    │                        │                      │                    │
    │  3. ログインクリック    │                      │                    │
    ├───────────────────────>│                      │                    │
    │                        │                      │                    │
    │                        │  4. PKCE Code Challenge生成              │
    │                        ├──────────────────────>│                    │
    │                        │  - code_verifier (ランダム文字列)        │
    │                        │  - code_challenge = SHA256(code_verifier) │
    │                        │  - response_type=code                     │
    │                        │  - scope=openid email profile             │
    │                        │  - redirect_uri=/auth/callback            │
    │                        │                      │                    │
    │  5. Hosted UIにリダイレクト                   │                    │
    │<───────────────────────┴──────────────────────┤                    │
    │  https://filesearch.auth.ap-northeast-1.      │                    │
    │  amazoncognito.com/login?...                  │                    │
    │                                               │                    │
    │  6. ログインフォーム表示                      │                    │
    │<──────────────────────────────────────────────┤                    │
    │                                               │                    │
    │  7. 認証情報入力                              │                    │
    ├──────────────────────────────────────────────>│                    │
    │  Email: user@example.com                      │                    │
    │  Password: ********                           │                    │
    │                                               │                    │
    │                                               │  8. 認証処理       │
    │                                               ├────┐               │
    │                                               │    │ユーザー検証   │
    │                                               │    │パスワード確認 │
    │                                               │<───┘               │
    │                                               │                    │
    │  9. Authorization Code返却                    │                    │
    │<──────────────────────────────────────────────┤                    │
    │  Redirect: http://localhost:3000/auth/        │                    │
    │  callback?code=AUTHORIZATION_CODE             │                    │
    │                        │                      │                    │
    │  10. Callbackページへ  │                      │                    │
    ├───────────────────────>│                      │                    │
    │                        │                      │                    │
    │                        │  11. トークン交換     │                    │
    │                        ├──────────────────────>│                    │
    │                        │  - code=AUTHORIZATION_CODE                │
    │                        │  - code_verifier (Step 4で生成)          │
    │                        │  - grant_type=authorization_code          │
    │                        │                      │                    │
    │                        │                      │  12. Code Verifier検証
    │                        │                      ├────┐               │
    │                        │                      │    │ code_challenge確認
    │                        │                      │<───┘               │
    │                        │                      │                    │
    │                        │  13. トークン発行     │                    │
    │                        │<──────────────────────┤                    │
    │                        │  {                   │                    │
    │                        │    "access_token": "...",                 │
    │                        │    "id_token": "...",                     │
    │                        │    "refresh_token": "...",                │
    │                        │    "expires_in": 3600                     │
    │                        │  }                   │                    │
    │                        │                      │                    │
    │                        │  14. LocalStorageに保存                   │
    │                        ├────┐                 │                    │
    │                        │    │ accessToken     │                    │
    │                        │    │ idToken         │                    │
    │                        │    │ refreshToken    │                    │
    │                        │<───┘                 │                    │
    │                        │                      │                    │
    │  15. ダッシュボードへリダイレクト             │                    │
    │<───────────────────────┤                      │                    │
    │  http://localhost:3000/dashboard              │                    │
    │                        │                      │                    │
    │  16. Protected API呼び出し                    │                    │
    │  (Authorization: Bearer <access_token>)       │                    │
    ├───────────────────────>│──────────────────────┴────────────────────>│
    │                        │                                           │
    │                        │                      17. トークン検証      │
    │                        │<──────────────────────────────────────────┤
    │                        │                      - 署名確認            │
    │                        │                      - 有効期限確認        │
    │                        │                      - スコープ確認        │
    │                        │                                           │
    │  18. データ返却         │                                           │
    │<───────────────────────┴───────────────────────────────────────────┤
    │                        │                                           │
    │  19. コンテンツ表示     │                                           │
    │<───────────────────────┤                                           │
    │                        │                                           │
```

---

## 📊 各ステップの詳細解説

### Step 1-2: 初回アクセスと未認証検知

**フロー:**
```javascript
// Next.js App (layout.tsx または ProtectedRoute.tsx)
useEffect(() => {
  const checkAuth = async () => {
    const user = await getCurrentUser()
    if (!user) {
      // 未認証
      setShowLoginButton(true)
    }
  }
  checkAuth()
}, [])
```

**状態:**
- LocalStorageにトークンが存在しない
- ログインボタンが表示される

---

### Step 3-4: ログインクリックとPKCE準備

**PKCE (Proof Key for Code Exchange) とは:**
- SPAで安全にOAuth 2.0を使用するための仕組み
- client secretを必要としない
- code_verifierとcode_challengeを使った検証

**フロー:**
```javascript
// Amplify内部処理（自動）
const code_verifier = generateRandomString(128) // ランダム文字列生成
const code_challenge = base64UrlEncode(sha256(code_verifier)) // SHA256ハッシュ化

// SessionStorageに保存（後で使用）
sessionStorage.setItem('pkce_code_verifier', code_verifier)

// Cognito Hosted UIにリダイレクト
const authUrl = `https://${COGNITO_DOMAIN}/login?`
  + `client_id=${APP_CLIENT_ID}`
  + `&response_type=code`
  + `&scope=openid+email+profile`
  + `&redirect_uri=${encodeURIComponent(CALLBACK_URL)}`
  + `&code_challenge=${code_challenge}`
  + `&code_challenge_method=S256`

window.location.href = authUrl
```

**生成される値の例:**
```
code_verifier:  dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
code_challenge: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
```

---

### Step 5-8: Cognito Hosted UIでの認証

**Hosted UIの役割:**
- ユーザーインターフェースの提供
- 認証情報の検証
- セキュアな認証処理

**処理フロー:**
```
1. Cognitoがログインフォームを表示
2. ユーザーがメール・パスワードを入力
3. Cognitoがデータベースで認証情報を検証
   - User Poolにユーザーが存在するか？
   - パスワードは正しいか？
   - メールアドレスは検証済みか？
4. すべて正しければ、Authorization Codeを生成
```

**セキュリティ:**
- パスワードは暗号化されて送信（HTTPS必須）
- 複数回の失敗でアカウントロック
- MFA（多要素認証）のオプション

---

### Step 9-10: Authorization Codeの返却

**リダイレクトURL:**
```
http://localhost:3000/auth/callback?code=abc123def456ghi789
```

**Authorization Codeの特性:**
- 有効期限: 10分（短い）
- 1回のみ使用可能
- トークンに交換するまで無効

**Next.js Callbackページ:**
```typescript
// /src/app/auth/callback/page.tsx
'use client'

export default function AuthCallback() {
  useEffect(() => {
    const handleCallback = async () => {
      // URLパラメータからcodeを取得
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')

      if (code) {
        // Amplifyが自動的にトークン交換を処理
        await fetchAuthSession()
        // ダッシュボードにリダイレクト
        router.push('/dashboard')
      }
    }
    handleCallback()
  }, [])

  return <div>Loading...</div>
}
```

---

### Step 11-13: トークン交換とPKCE検証

**トークンリクエスト:**
```javascript
// Amplify内部処理（自動）
const code_verifier = sessionStorage.getItem('pkce_code_verifier')

const tokenRequest = {
  grant_type: 'authorization_code',
  client_id: APP_CLIENT_ID,
  code: AUTHORIZATION_CODE,
  code_verifier: code_verifier,
  redirect_uri: CALLBACK_URL
}

// Cognitoにトークンリクエスト
const response = await fetch(`https://${COGNITO_DOMAIN}/oauth2/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(tokenRequest)
})
```

**Cognito側の検証:**
```
1. code_challengeの再計算:
   code_challenge_from_verifier = SHA256(code_verifier)

2. Step 4で受け取ったcode_challengeと比較:
   code_challenge_from_verifier === code_challenge_stored

3. 一致すれば、トークンを発行
```

**セキュリティポイント:**
- code_verifierは攻撃者が知らない
- code_challengeだけでは元の値（code_verifier）を計算できない（SHA256は一方向関数）
- Authorization Codeを盗まれてもトークンに交換できない

---

### Step 14: トークンの保存

**発行されるトークン:**

**1. Access Token (アクセストークン):**
```json
{
  "sub": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "cognito:groups": [],
  "token_use": "access",
  "scope": "openid email profile",
  "auth_time": 1705123456,
  "exp": 1705127056,
  "iat": 1705123456,
  "jti": "...",
  "client_id": "2s3km9tqr8bffn6bqc0ih0cma1",
  "username": "test@example.com"
}
```
**用途:** API呼び出し時の認証に使用

**2. ID Token (IDトークン):**
```json
{
  "sub": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "email_verified": true,
  "email": "test@example.com",
  "name": "Test User",
  "cognito:username": "test@example.com",
  "exp": 1705127056,
  "iat": 1705123456
}
```
**用途:** ユーザー情報の取得

**3. Refresh Token (リフレッシュトークン):**
- 長い有効期限（30日）
- Access TokenとID Tokenの再発行に使用
- ユーザーが再ログインせずにトークン更新可能

**LocalStorageの構造:**
```
CognitoIdentityServiceProvider.2s3km9tqr8bffn6bqc0ih0cma1.LastAuthUser
  = "test@example.com"

CognitoIdentityServiceProvider.2s3km9tqr8bffn6bqc0ih0cma1.test@example.com.accessToken
  = "eyJraWQiOiJ..."

CognitoIdentityServiceProvider.2s3km9tqr8bffn6bqc0ih0cma1.test@example.com.idToken
  = "eyJraWQiOiJ..."

CognitoIdentityServiceProvider.2s3km9tqr8bffn6bqc0ih0cma1.test@example.com.refreshToken
  = "eyJjdHkiOiJ..."
```

---

### Step 16-17: Protected API呼び出し

**APIリクエスト:**
```javascript
// Next.js App
const response = await fetch(`${API_GATEWAY_URL}/search`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`
  },
  body: JSON.stringify({ query: 'test' })
})
```

**Backend APIでのトークン検証:**
```javascript
// Express Backend (middleware/auth.ts)
import { CognitoJwtVerifier } from 'aws-jwt-verify'

const verifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'access',
  clientId: APP_CLIENT_ID
})

export const authenticateToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]

    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }

    // トークンを検証
    const payload = await verifier.verify(token)

    // 検証項目:
    // 1. 署名の検証（CognitoのJWKSから公開鍵を取得して検証）
    // 2. 有効期限（exp）の確認
    // 3. 発行者（iss）の確認
    // 4. トークンタイプ（token_use）の確認
    // 5. クライアントID（client_id）の確認

    // ユーザー情報をリクエストに追加
    req.user = {
      sub: payload.sub,
      username: payload.username,
      email: payload.email
    }

    next()
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' })
  }
}
```

---

## 🔄 トークンリフレッシュフロー

**Access Tokenが期限切れになった場合:**

```
User (ブラウザ)          Next.js App          AWS Cognito
    │                        │                      │
    │  1. API呼び出し         │                      │
    ├───────────────────────>│                      │
    │  (Access Token期限切れ) │                      │
    │                        │                      │
    │                        │  2. 403エラー検知    │
    │                        ├────┐                 │
    │                        │    │ Token期限切れ?  │
    │                        │<───┘                 │
    │                        │                      │
    │                        │  3. Refresh Token送信│
    │                        ├──────────────────────>│
    │                        │  {                   │
    │                        │    "grant_type": "refresh_token",
    │                        │    "client_id": "...",
    │                        │    "refresh_token": "..."
    │                        │  }                   │
    │                        │                      │
    │                        │  4. 新しいトークン発行│
    │                        │<──────────────────────┤
    │                        │  {                   │
    │                        │    "access_token": "...",
    │                        │    "id_token": "..."  │
    │                        │  }                   │
    │                        │                      │
    │                        │  5. LocalStorage更新 │
    │                        ├────┐                 │
    │                        │<───┘                 │
    │                        │                      │
    │                        │  6. API再試行        │
    │                        ├──────────────────────>Backend
    │                        │  (新しいAccess Token)│
    │                        │                      │
    │  7. データ返却          │                      │
    │<───────────────────────┤                      │
```

**Amplifyの自動処理:**
```javascript
// Amplify v6では自動的にリフレッシュ処理が行われる
const session = await fetchAuthSession({ forceRefresh: true })
const accessToken = session.tokens?.accessToken
```

---

## 🚪 サインアウトフロー

```
User (ブラウザ)          Next.js App          AWS Cognito
    │                        │                      │
    │  1. Sign outクリック    │                      │
    ├───────────────────────>│                      │
    │                        │                      │
    │                        │  2. Cognitoサインアウト│
    │                        ├──────────────────────>│
    │                        │  GET /logout?        │
    │                        │  client_id=...&      │
    │                        │  logout_uri=...      │
    │                        │                      │
    │                        │  3. セッション無効化  │
    │                        │<──────────────────────┤
    │                        │                      │
    │                        │  4. LocalStorageクリア│
    │                        ├────┐                 │
    │                        │    │ トークン削除    │
    │                        │<───┘                 │
    │                        │                      │
    │  5. ログインページへリダイレクト              │
    │<───────────────────────┤                      │
    │  http://localhost:3000 │                      │
```

**実装例:**
```typescript
// サインアウト処理
import { signOut } from 'aws-amplify/auth'

const handleSignOut = async () => {
  try {
    await signOut({ global: true }) // すべてのデバイスでサインアウト
    router.push('/')
  } catch (error) {
    console.error('Sign out error:', error)
  }
}
```

---

## 🔐 セキュリティ特性

### PKCE (Proof Key for Code Exchange)

**問題点（PKCEなしの場合）:**
```
攻撃者がAuthorization Codeを盗聴
→ トークンエンドポイントに直接送信
→ Access Tokenを取得
→ ユーザーになりすまし可能
```

**PKCEによる防御:**
```
攻撃者がAuthorization Codeを盗聴
→ トークンエンドポイントに送信
→ code_verifierがない（または間違っている）
→ Cognitoが拒否
→ Access Tokenを取得できない
```

### HTTPS必須

**理由:**
- パスワードの暗号化
- トークンの暗号化
- 中間者攻撃（MITM）の防止

**本番環境:**
```
✅ https://your-app.com
❌ http://your-app.com
```

**開発環境:**
```
✅ http://localhost:3000（例外的に許可）
```

### トークンの有効期限

**短い有効期限（Access Token）:**
- 盗まれても被害を最小限に
- 60分が推奨

**長い有効期限（Refresh Token）:**
- ユーザーが頻繁にログインし直す必要がない
- 30日が推奨

---

## 📊 エラーハンドリング

### よくあるエラーと対処法

**1. Invalid redirect_uri**
```
原因: Callback URLsの設定ミス
解決: AWS Console → Cognito → App client → Hosted UI
      → Callback URLs に正しいURLを追加
```

**2. Invalid client_id**
```
原因: App Client IDが間違っている
解決: .env.local の NEXT_PUBLIC_COGNITO_APP_CLIENT_ID を確認
```

**3. Token validation failed**
```
原因: トークンの署名検証失敗
解決:
- User Pool IDが正しいか確認
- トークンが期限切れでないか確認
- ログアウト→再ログイン
```

**4. CORS error**
```
原因: オリジンが許可されていない
解決: Callback URLs と Sign out URLs に現在のURLを追加
```

---

## 🎯 まとめ

### PKCE認証フローの利点

```markdown
✅ Client secretが不要（SPAに最適）
✅ Authorization Code盗聴への耐性
✅ CSRF攻撃への耐性
✅ 業界標準（RFC 7636）
```

### 実装のポイント

```markdown
✅ Amplify v6が自動的にPKCE処理を実行
✅ code_verifierとcode_challengeの生成は内部処理
✅ 開発者はHosted UIへのリダイレクトとCallback処理のみ実装
✅ トークン管理はLocalStorageに自動保存
```

### 次のステップ

1. **設定ガイド**: [aws-cognito-setup-guide.md](./aws-cognito-setup-guide.md)
2. **テスト**: [cognito-testing-checklist.md](./cognito-testing-checklist.md)
3. **トラブルシューティング**: [cognito-troubleshooting-flowchart.md](./cognito-troubleshooting-flowchart.md)

---

**最終更新日**: 2025-01-11
**ドキュメントバージョン**: 1.0.0
