# AWS Cognito クイックリファレンスカード

**印刷推奨: A4サイズ 1枚で収まる簡易リファレンス**

---

## 📋 環境変数設定（30秒でコピペ）

```bash
# 1. サンプルファイルをコピー
cp .env.local.example .env.local

# 2. エディタで開く
code .env.local
# または
vi .env.local

# 3. 以下の4つの値を設定
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_abc123XYZ
NEXT_PUBLIC_COGNITO_APP_CLIENT_ID=7uvwxyz1234567890abcdefghijklmn
NEXT_PUBLIC_COGNITO_DOMAIN=filesearch.auth.ap-northeast-1.amazoncognito.com
NEXT_PUBLIC_APP_URL=http://localhost:3000

# 4. 開発サーバーを起動
yarn dev
```

---

## 🔍 AWS Console 取得パス

### User Pool ID
```
AWS Console → Cognito → User pools → [Pool名] → Pool Id
✅ 形式: ap-northeast-1_abc123XYZ
```

### App Client ID
```
AWS Console → Cognito → User pools → [Pool名] → App integration → App clients → Client ID
✅ 形式: 7uvwxyz1234567890abcdefghijklmn
```

### Cognito Domain
```
AWS Console → Cognito → User pools → [Pool名] → App integration → Domain
✅ 形式: filesearch.auth.ap-northeast-1.amazoncognito.com
⚠️ https:// は不要
```

### Callback URLs設定
```
AWS Console → Cognito → User pools → [Pool名] → App integration → App client → Hosted UI → Callback URLs
✅ 開発: http://localhost:3000/auth/callback
✅ 本番: https://your-app.com/auth/callback
```

### Sign out URLs設定
```
同上 → Sign out URLs
✅ 開発: http://localhost:3000
✅ 本番: https://your-app.com
```

---

## ⚡ よくあるエラー（3秒で解決）

| エラー | 解決策 |
|--------|--------|
| `Missing required environment variables` | `cp .env.local.example .env.local` |
| `Invalid User Pool ID format` | Pool IDを**全文**コピー（`_`以降も含む） |
| `Domain should NOT include http://` | `https://`を削除 |
| `App URL must start with http://` | `http://`を追加 |
| `Invalid redirect_uri` | Callback URLsを確認・更新 |
| `CORS error` | Callback/Sign out URLsに現在のURLを追加 |
| `Token validation failed` | ログアウト→再ログイン（LocalStorageクリア） |

---

## 🧪 テストコマンド（1分で検証）

```bash
# 1. 環境変数の確認
cat .env.local

# 2. 開発サーバー起動
yarn dev
# ✅ "Amplify環境変数の検証が完了しました" が表示されればOK

# 3. ブラウザでアクセス
http://localhost:3000

# 4. Hosted UIの確認（URLを生成してアクセス）
https://[COGNITO_DOMAIN]/login?client_id=[APP_CLIENT_ID]&response_type=code&scope=openid+email+profile&redirect_uri=[APP_URL]/auth/callback
```

---

## 📝 形式チェック（コピペ前に確認）

| 変数名 | 正しい形式 | 間違った形式 |
|--------|-----------|------------|
| User Pool ID | `ap-northeast-1_abc123XYZ` | `ap-northeast-1` |
| App Client ID | `7uvwxyz123...` | （特に制約なし） |
| Cognito Domain | `filesearch.auth.ap-northeast-1.amazoncognito.com` | `https://filesearch.auth...` |
| App URL | `http://localhost:3000` | `localhost:3000` |

---

## 🔧 緊急デバッグコマンド

```bash
# .env.local の存在確認
ls -la .env.local

# 内容確認
cat .env.local

# キャッシュクリア
rm -rf .next
yarn dev

# ブラウザのコンソールで環境変数確認
console.log(process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID)

# LocalStorageのトークン確認
localStorage.getItem('CognitoIdentityServiceProvider.[APP_CLIENT_ID].LastAuthUser')
```

---

## 🎯 App Client 必須設定（コピペ用）

```
✅ Authentication flows:
   - ALLOW_USER_SRP_AUTH
   - ALLOW_REFRESH_TOKEN_AUTH

✅ OAuth 2.0 grant types:
   - Authorization code grant

❌ Client secret:
   - Don't generate (PKCE使用のため不要)

✅ OpenID Connect scopes:
   - openid
   - email
   - profile

✅ Token expiration:
   - Access token: 60 minutes
   - ID token: 60 minutes
   - Refresh token: 30 days
```

---

## 🚀 新規User Pool作成（5分で完了）

```
1. AWS Console → Cognito → Create user pool

2. Sign-in options:
   ✅ Email
   ✅ Username

3. Password policy:
   ✅ Cognito defaults

4. MFA:
   ✅ Optional

5. Required attributes:
   ✅ email
   ✅ name

6. Email provider:
   ✅ Send email with Cognito（開発環境）
   ✅ Send email with Amazon SES（本番環境）

7. User pool name:
   filesearch-user-pool

8. App client name:
   filesearch-web-client

9. Cognito domain:
   filesearch（プレフィックス）
```

---

## 📦 Vercel環境変数設定（3分で完了）

```
Vercel Dashboard → Project → Settings → Environment Variables

追加する変数:
┌──────────────────────────────────────────┬───────────────────────┬─────────────┐
│ Key                                      │ Value                 │ Environment │
├──────────────────────────────────────────┼───────────────────────┼─────────────┤
│ NEXT_PUBLIC_COGNITO_USER_POOL_ID         │ ap-northeast-1_XXX    │ Production  │
│ NEXT_PUBLIC_COGNITO_APP_CLIENT_ID        │ your-client-id        │ Production  │
│ NEXT_PUBLIC_COGNITO_DOMAIN               │ filesearch.auth...    │ Production  │
│ NEXT_PUBLIC_APP_URL                      │ https://your-app.com  │ Production  │
└──────────────────────────────────────────┴───────────────────────┴─────────────┘

⚠️ 設定後は Redeploy が必要
```

---

## 🔒 セキュリティチェックリスト

```markdown
- [ ] .env.local は .gitignore に含まれている
- [ ] 本番環境の認証情報をGitにコミットしていない
- [ ] Client secretを生成していない（PKCE使用）
- [ ] HTTPS を使用している（本番環境）
- [ ] Callback URLsが完全一致している
- [ ] トークンの有効期限が適切に設定されている
```

---

## 📞 サポート連絡先

```
プロジェクト管理者: [担当者名]
メール: [support@your-company.com]
Slack: #cis-filesearch-support

AWS公式ドキュメント:
https://docs.aws.amazon.com/cognito/

Amplify公式ドキュメント:
https://docs.amplify.aws/
```

---

## 🎓 学習リソース

```
✅ 初心者向け: /docs/security/aws-cognito-setup-guide.md
✅ トラブルシューティング: /docs/security/cognito-troubleshooting-flowchart.md
✅ このクイックリファレンス: /docs/security/cognito-quick-reference.md
```

---

**印刷推奨:** このページを印刷してデスクに置いておくと便利です

**最終更新日**: 2025-01-11
**ドキュメントバージョン**: 1.0.0
