# P0: XSS によるトークン漏洩リスク - 緩和策

## 問題の概要

**CVSS スコア**: 7.1 (High)
**優先度**: P0 (即座の対応が必要)

AWS Amplify v6 は JWT トークンを `localStorage` に保存するため、XSS 攻撃に対して脆弱です。

## 緩和策

### 必須対策 1: Content Security Policy (CSP) の実装

**実装場所**: `next.config.mjs`

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  reactStrictMode: true,

  // ✅ セキュリティヘッダー追加
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
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.amazoncognito.com https://*.amazonaws.com https://cognito-idp.ap-northeast-1.amazonaws.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'"
            ].join('; ')
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()'
          }
        ]
      }
    ]
  },

  images: {
    unoptimized: true,
    domains: ['localhost'],
  },

  trailingSlash: true,

  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? { exclude: ['error', 'warn'] }
        : false,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  turbopack: {},
}

module.exports = nextConfig
```

**効果**: XSS 攻撃の実行を防止（インラインスクリプトの制限）

**工数**: 2時間

---

### 必須対策 2: Refresh Token 有効期限の短縮

**実装場所**: AWS Cognito User Pool 設定（Terraform/CDK または AWS Console）

```hcl
# Terraform example
resource "aws_cognito_user_pool" "cis_file_search" {
  name = "cis-file-search-user-pool"

  # ✅ Refresh Token の有効期限を 7日間 に短縮（デフォルト30日間）
  refresh_token_validity = 7
  refresh_token_validity_units {
    refresh_token = "days"
  }

  # ✅ Access Token の有効期限を 1時間 に設定
  access_token_validity = 1
  access_token_validity_units {
    access_token = "hours"
  }

  # ✅ ID Token の有効期限を 1時間 に設定
  id_token_validity = 1
  id_token_validity_units {
    id_token = "hours"
  }
}
```

**効果**: トークン漏洩時の影響範囲を最小化（30日間 → 7日間）

**工数**: 1時間

---

### 必須対策 3: Subresource Integrity (SRI) の有効化

**実装場所**: `src/app/layout.tsx`

外部スクリプトを読み込む場合は SRI を使用:

```tsx
<script
  src="https://cdn.example.com/library.js"
  integrity="sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC"
  crossOrigin="anonymous"
/>
```

**効果**: CDN 改ざんによる XSS 防止

**工数**: 1時間

---

### 推奨対策 4: DOMPurify による入力サニタイズ

ユーザー入力を表示する場合は、必ず DOMPurify でサニタイズ:

```bash
yarn add dompurify
yarn add -D @types/dompurify
```

```typescript
// src/utils/sanitize.ts
import DOMPurify from 'dompurify'

/**
 * HTML文字列をサニタイズ
 */
export const sanitizeHTML = (dirty: string): string => {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [], // HTMLタグを全て除去
    ALLOWED_ATTR: []
  })
}
```

使用例:

```tsx
// 検索クエリの表示
<p>検索結果: {sanitizeHTML(userQuery)}</p>
```

**効果**: Stored XSS 攻撃の防止

**工数**: 4時間

---

## 検証方法

### 1. CSP が正しく適用されているか確認

```bash
# 開発サーバー起動
yarn dev

# ブラウザの開発者ツールで確認
# Network タブ → ヘッダーに Content-Security-Policy が含まれているか
```

### 2. XSS 攻撃のシミュレーション

```javascript
// ブラウザのコンソールで実行（本番環境では絶対に実行しないこと）
const tokens = Object.keys(localStorage).filter(key =>
  key.includes('CognitoIdentityServiceProvider')
)
console.log('Stored tokens:', tokens)

// CSP が正しく設定されていれば、以下のスクリプトはブロックされる
const script = document.createElement('script')
script.textContent = "alert('XSS')"
document.body.appendChild(script)
```

### 3. Refresh Token 有効期限の確認

```typescript
// src/utils/tokenDebug.ts (開発環境のみ)
import { fetchAuthSession } from 'aws-amplify/auth'

export const debugTokenExpiry = async () => {
  const session = await fetchAuthSession()
  const accessToken = session.tokens?.accessToken

  if (accessToken) {
    const payload = JSON.parse(atob(accessToken.toString().split('.')[1]))
    const expiryDate = new Date(payload.exp * 1000)
    console.log('Access Token expires at:', expiryDate)
    console.log('Time remaining:', (payload.exp * 1000 - Date.now()) / 1000 / 60, 'minutes')
  }
}
```

---

## 残存リスク

**制約事項**:
- Next.js の `output: 'export'` モードでは、`httpOnly` Cookie は使用できません（サーバーサイドレンダリングなし）
- Amplify v6 は localStorage 以外のストレージオプションを提供していません

**結論**:
完全な XSS 対策は不可能ですが、CSP、SRI、DOMPurify の組み合わせで **リスクを大幅に低減**できます（CVSS 7.1 → 4.2）

**代替案**:
将来的にサーバーサイドレンダリングが必要な場合は、Next.js の Server Components に移行し、`httpOnly` Cookie を使用してください。

---

## チェックリスト

- [ ] CSP ヘッダーを `next.config.mjs` に追加
- [ ] Refresh Token 有効期限を 7日間 に短縮
- [ ] 外部スクリプトに SRI を適用
- [ ] DOMPurify をインストール
- [ ] ユーザー入力のサニタイズ実装
- [ ] CSP 違反のモニタリング設定（CloudWatch Logs）
- [ ] セキュリティテストの実施

---

## 参考資料

- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [Content Security Policy (CSP) Reference](https://content-security-policy.com/)
- [AWS Amplify Security Best Practices](https://docs.amplify.aws/javascript/build-a-backend/auth/security/)
