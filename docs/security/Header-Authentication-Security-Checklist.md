# Header 認証統合 - セキュリティチェックリスト

## エグゼクティブサマリー

**全体リスクレベル**: 🟡 **MEDIUM** → 🟢 **LOW**（緩和策実装後）

AWS Cognito OAuth 2.0 PKCE フローは業界標準のセキュアな実装ですが、**クライアントサイドのみの静的エクスポート環境**では固有のセキュリティ制約があります。

### 重要な前提条件

✅ **このアーキテクチャでは、すべてのセキュリティクリティカルな操作はバックエンド API で検証する必要があります**

クライアントサイドの認証状態は **UI表示の最適化のみ** に使用し、セキュリティ境界として扱ってはいけません。

---

## 📋 セキュリティリスク評価サマリー

| リスク項目 | CVSS | 優先度 | 状態 | 推定工数 |
|-----------|------|-------|------|---------|
| **XSS によるトークン漏洩** | 7.1 (High) | P0 | 🔴 要対応 | 8時間 |
| **クライアントサイド認証状態の信頼性** | 5.3 (Medium) | P1 | 🟡 要対応 | 16時間 |
| **CSRF 攻撃** | 4.3 (Medium) | P2 | 🟢 対応済み | 0時間 |
| **エラー情報の漏洩** | 3.1 (Low) | P3 | 🟡 要改善 | 2時間 |
| **セッション管理** | 2.0 (Low) | P3 | 🟢 対応済み | 0時間 |

---

## 🚨 P0: Critical - 即座の対応が必要

### 1. XSS によるトークン漏洩リスク (CVSS 7.1)

**問題**: JWT トークンが localStorage に保存されており、XSS 攻撃に脆弱

**緩和策**:

#### ✅ 必須: Content Security Policy (CSP)

```javascript
// next.config.mjs
async headers() {
  return [
    {
      source: '/:path*',
      headers: [
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cognito-idp.ap-northeast-1.amazonaws.com",
            "connect-src 'self' https://*.amazoncognito.com https://*.amazonaws.com",
            "frame-ancestors 'none'",
          ].join('; ')
        }
      ]
    }
  ]
}
```

**工数**: 2時間
**効果**: XSS 攻撃の実行を防止

#### ✅ 必須: Refresh Token 有効期限の短縮

```hcl
# Terraform
resource "aws_cognito_user_pool" "cis_file_search" {
  refresh_token_validity = 7  # 30日間 → 7日間に短縮
}
```

**工数**: 1時間
**効果**: トークン漏洩時の影響範囲を最小化

#### ✅ 推奨: DOMPurify による入力サニタイズ

```typescript
// src/utils/sanitize.ts
import DOMPurify from 'dompurify'

export const sanitizeHTML = (dirty: string): string => {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: []
  })
}
```

**工数**: 4時間
**効果**: Stored XSS 攻撃の防止

---

## 🟡 P1: High Priority - 今週中に対応

### 2. クライアントサイド認証状態の信頼性 (CVSS 5.3)

**問題**: `isAuthenticated` はクライアントサイドで改ざん可能

**アーキテクチャの原則**:
- ✅ クライアントサイドの `isAuthenticated` は **UI 表示の最適化のみ** に使用
- ✅ すべてのセキュリティクリティカルな操作は **バックエンド API で JWT 検証**

**緩和策**:

#### ✅ 必須: API Gateway Cognito Authorizer

```hcl
# Terraform
resource "aws_api_gateway_authorizer" "cognito" {
  name            = "cognito-authorizer"
  type            = "COGNITO_USER_POOLS"
  provider_arns   = [aws_cognito_user_pool.cis_file_search.arn]
  identity_source = "method.request.header.Authorization"
}
```

**工数**: 4時間
**効果**: すべての API エンドポイントで JWT 検証を強制

#### ✅ 必須: Lambda 内での JWT 検証（二重チェック）

```typescript
// backend/src/handlers/search.ts
import { CognitoJwtVerifier } from 'aws-jwt-verify'

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID!,
  tokenUse: 'access',
  clientId: process.env.COGNITO_APP_CLIENT_ID!,
})

export const handler = async (event) => {
  const token = event.headers.Authorization?.substring(7)
  const payload = await verifier.verify(token) // ✅ JWT検証
  // ビジネスロジック
}
```

**工数**: 8時間
**効果**: トークン改ざん防止、不正アクセス遮断

#### ✅ 必須: フロントエンドでの 401 エラーハンドリング

```typescript
// src/lib/apiClient.ts
async get<T>(endpoint: string): Promise<T> {
  const token = await getAccessToken()
  const response = await fetch(`${this.baseURL}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` }
  })

  if (response.status === 401) {
    window.location.href = '/logout' // 強制ログアウト
    throw new Error('Unauthorized')
  }

  return response.json()
}
```

**工数**: 4時間
**効果**: 無効なトークンの即座の検出

---

## 🟢 P2: Medium Priority - 今週中に対応

### 3. CSRF 攻撃 (CVSS 4.3)

**問題**: OAuth 2.0 フローでの CSRF リスク

**現状**: ✅ **既に対応済み** - AWS Amplify が自動的に PKCE と state 検証を実装

**追加推奨**:

#### OAuth エラーハンドリングの強化

```typescript
// src/app/auth/callback/page.tsx
const AuthCallbackPage = () => {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  if (error) {
    return <ErrorPage error={errorDescription} />
  }
  // 通常フロー
}
```

**工数**: 2時間
**効果**: ユーザーへの明確なエラーメッセージ表示

---

## 📊 P3: Low Priority - 今月中に対応

### 4. エラー情報の漏洩 (CVSS 3.1)

**問題**: エラーメッセージで内部実装の詳細が漏洩する可能性

**緩和策**:

```typescript
// ❌ 悪い例
catch (error) {
  console.error('JWT verification failed:', error.stack)
  return { error: error.message } // スタックトレースが漏洩
}

// ✅ 良い例
catch (error) {
  console.error('JWT verification failed:', error) // サーバーログのみ
  return { error: 'Authentication failed' } // 一般的なメッセージ
}
```

**工数**: 2時間
**効果**: 内部実装の詳細を隠蔽

---

## 🔒 セキュアコーディングベストプラクティス

### 1. トークン管理

```typescript
// ✅ 良い例: アクセストークンを直接扱わない
const { getAccessToken } = useAuth()
const token = await getAccessToken() // 必要な時のみ取得

// ❌ 悪い例: トークンを変数に保存
const [token, setToken] = useState(null)
useEffect(() => {
  const t = await getAccessToken()
  setToken(t) // メモリ上に長期間保存されるリスク
}, [])
```

### 2. ユーザー情報の表示

```typescript
// ✅ 良い例: PII を最小限に表示
<UserMenu user={{ name: user.name }} />

// ❌ 悪い例: 不要な PII を表示
<UserMenu user={user} /> // email, phone, address など全て表示
```

### 3. ログアウト処理

```typescript
// ✅ 良い例: 完全なクリーンアップ
const logout = async () => {
  await signOut() // Cognito セッション削除
  localStorage.clear() // ローカルデータ削除
  sessionStorage.clear()
  window.location.href = '/' // 完全なページリロード
}

// ❌ 悪い例: 不完全なクリーンアップ
const logout = async () => {
  await signOut()
  router.push('/') // SPAの遷移のみ（メモリ上にデータが残る）
}
```

### 4. エラーハンドリング

```typescript
// ✅ 良い例: セキュアなエラーハンドリング
const handleLogin = async () => {
  try {
    await loginWithHostedUI()
  } catch (error) {
    console.error('Login failed:', error) // サーバーログのみ
    showToast('ログインに失敗しました。もう一度お試しください。') // 一般的なメッセージ
  }
}

// ❌ 悪い例: 詳細なエラーを表示
const handleLogin = async () => {
  try {
    await loginWithHostedUI()
  } catch (error) {
    alert(JSON.stringify(error)) // 内部実装の詳細が漏洩
  }
}
```

---

## ✅ 実装チェックリスト

### Phase 1: P0 対応（今日中）

- [ ] CSP ヘッダーを `next.config.mjs` に追加
- [ ] Cognito User Pool の Refresh Token 有効期限を 7日間 に短縮
- [ ] セキュリティヘッダーの動作確認
  - [ ] X-Frame-Options: DENY
  - [ ] X-Content-Type-Options: nosniff
  - [ ] X-XSS-Protection: 1; mode=block

### Phase 2: P1 対応（今週中）

- [ ] API Gateway Cognito Authorizer を全エンドポイントに設定
- [ ] Lambda 内で JWT 検証を実装（`aws-jwt-verify` 使用）
- [ ] API クライアント作成（`src/lib/apiClient.ts`）
- [ ] 401 エラーハンドリング実装
- [ ] DOMPurify インストール・実装

### Phase 3: P2 対応（今週中）

- [ ] OAuth エラーハンドリングを `/auth/callback/page.tsx` に追加
- [ ] エラー表示コンポーネント作成

### Phase 4: P3 対応（今月中）

- [ ] エラーメッセージのサニタイズ
- [ ] ログ出力のレビュー（機密情報が含まれていないか）

### Phase 5: テスト（今月中）

- [ ] セキュリティテストの実装
  - [ ] 無効な JWT で 401 が返されるか
  - [ ] トークンなしで 401 が返されるか
  - [ ] XSS スクリプトが CSP でブロックされるか
- [ ] 手動テスト
  - [ ] Postman で JWT 検証をテスト
  - [ ] ブラウザで CSP 違反を確認
  - [ ] OAuth エラーフローのテスト

### Phase 6: モニタリング（今月中）

- [ ] CloudWatch Logs で認証エラーをモニタリング
- [ ] CloudWatch Alarms で異常なログイン試行を検知
- [ ] CSP 違反レポートの収集（`report-uri` ディレクティブ）

---

## 📚 参考資料

### OWASP

- [OWASP Top 10 2021](https://owasp.org/Top10/)
- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)

### AWS

- [AWS Amplify Security Best Practices](https://docs.amplify.aws/javascript/build-a-backend/auth/security/)
- [API Gateway Cognito Authorizer](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-integrate-with-cognito.html)
- [AWS Cognito Security Best Practices](https://docs.aws.amazon.com/cognito/latest/developerguide/security.html)

### OAuth 2.0

- [RFC 7636: Proof Key for Code Exchange (PKCE)](https://datatracker.ietf.org/doc/html/rfc7636)
- [OAuth 2.0 Security Best Current Practice](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)

---

## 🎯 成功基準

実装完了時、以下の基準を満たしていること:

1. ✅ すべての P0/P1 対策が実装されている
2. ✅ すべてのセキュリティテストが合格している
3. ✅ CSP ヘッダーが正しく設定され、XSS 攻撃がブロックされる
4. ✅ API Gateway Cognito Authorizer が全エンドポイントで有効
5. ✅ 無効な JWT で 401 Unauthorized が返される
6. ✅ CloudWatch Logs で認証イベントが記録されている
7. ✅ GDPR/SOC 2/ISO 27001 要件を満たしている

---

## 🔐 最終推奨事項

### 短期（今週中）

1. ✅ P0 対策の実装（CSP、Refresh Token 有効期限）
2. ✅ P1 対策の実装（API Gateway Authorizer、JWT 検証）
3. ✅ セキュリティテストの実施

### 中期（今月中）

1. ✅ P2/P3 対策の実装
2. ✅ CloudWatch モニタリングの設定
3. ✅ ペネトレーションテストの実施

### 長期（四半期ごと）

1. ✅ 脆弱性診断の実施
2. ✅ セキュリティレビューの実施
3. ✅ コンプライアンス監査の実施

---

## 🚀 次のステップ

1. このチェックリストを `/docs/security/` に保存
2. プロジェクト管理ツールにタスクを追加
3. セキュリティレビュー会議を開催
4. 実装開始

---

**レビュー実施日**: 2025-01-11
**次回レビュー予定日**: 2025-02-11
**担当**: Security & Compliance Expert
