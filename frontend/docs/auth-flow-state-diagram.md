# 認証フロー状態遷移図

## 概要

AWS Cognito認証フローにおける各状態とその遷移パターンを定義します。

## 状態一覧

| 状態 | 説明 | コンポーネント |
|------|------|----------------|
| `login` | 初期状態。メール・パスワード入力 | `LoginForm` |
| `new-password` | 初回ログイン時のパスワード変更 | `NewPasswordForm` |
| `forgot-password` | パスワード忘れ（検証コード送信） | `ForgotPasswordForm` |
| `reset-password` | パスワードリセット（新パスワード設定） | `ResetPasswordForm` |

## 状態遷移フロー

```
┌─────────────────────────────────────────────────────────────────┐
│                        認証フロー状態遷移                        │
└─────────────────────────────────────────────────────────────────┘

                           ┌──────────┐
                           │  START   │
                           └────┬─────┘
                                │
                                ▼
                        ┌───────────────┐
                    ┌───│ login (初期)  │───┐
                    │   └───────┬───────┘   │
                    │           │           │
                    │           │           │
        「パスワード忘れ」   ログイン実行   「戻る」ボタン
        クリック            │              (各画面から)
                    │           │           │
                    │           ▼           │
                    │    ┌─────────────┐   │
                    │    │ signIn API  │   │
                    │    └──────┬──────┘   │
                    │           │           │
                    │           ├───────────┴──────────┐
                    │           │                      │
                    │           │                      │
                    ▼           ▼                      ▼
            ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
            │ forgot-      │  │ new-password │  │  DONE        │
            │ password     │  │              │  │ (success)    │
            └──────┬───────┘  └──────┬───────┘  └──────────────┘
                   │                 │                  │
                   │                 │                  │
        検証コード送信成功   confirmNewPassword        ▼
                   │           実行成功        ┌──────────────┐
                   │                 │         │ /search      │
                   ▼                 │         │ リダイレクト │
            ┌──────────────┐        │         └──────────────┘
            │ reset-       │        │
            │ password     │        │
            └──────┬───────┘        │
                   │                 │
                   │                 │
        confirmResetPassword        │
        実行成功                     │
                   │                 │
                   ├─────────────────┘
                   │
                   ▼
            ┌──────────────┐
            │    login     │
            │   (戻る)     │
            └──────────────┘
```

## 詳細な遷移パターン

### 1. 通常ログインフロー

```
login
  │
  ├─ ログイン成功 (signInStep === 'DONE')
  │    └─> /search にリダイレクト
  │
  ├─ 新しいパスワード必要 (signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED')
  │    └─> new-password 状態へ遷移
  │
  └─ MFA必要 (signInStep === 'CONFIRM_SIGN_IN_WITH_SMS_CODE' | 'CONFIRM_SIGN_IN_WITH_TOTP_CODE')
       └─> エラー表示（未実装）
```

### 2. 初回ログインフロー（NEW_PASSWORD_REQUIRED）

```
login (仮パスワード入力)
  │
  └─> signIn API
       │
       └─ signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED'
            │
            └─> new-password 状態へ遷移
                 │
                 └─ 新しいパスワード設定
                      │
                      └─> confirmSignIn({ challengeResponse: newPassword })
                           │
                           └─ 成功 → /search にリダイレクト
```

### 3. パスワード忘れフロー

```
login
  │
  └─ 「パスワードを忘れた方」クリック
       │
       └─> forgot-password 状態へ遷移
            │
            └─ メールアドレス入力 & 検証コード送信
                 │
                 └─> resetPassword API
                      │
                      └─ 成功 → reset-password 状態へ遷移
                                 │
                                 └─ 検証コード & 新しいパスワード入力
                                      │
                                      └─> confirmResetPassword API
                                           │
                                           └─ 成功 → login 状態へ戻る
```

## LoginResult インターフェース

```typescript
interface LoginResult {
  success: boolean              // ログイン成功フラグ
  requiresMFA: boolean          // MFA必要フラグ
  mfaType?: 'SMS_MFA' | 'SOFTWARE_TOKEN_MFA'  // MFAタイプ
  requiresNewPassword: boolean  // 新しいパスワード必要フラグ
}
```

## 各状態での処理

### login状態（LoginForm）

**責務:**
- ユーザーのメールアドレスとパスワードを入力
- `signIn` API呼び出し
- レスポンスに応じて適切な状態に遷移

**遷移先:**
- `success: true` → `/search` へリダイレクト
- `requiresNewPassword: true` → `new-password` 状態
- `requiresMFA: true` → エラー表示（未実装）
- 「パスワードを忘れた方」クリック → `forgot-password` 状態

### new-password状態（NewPasswordForm）

**責務:**
- 新しいパスワード入力（強度チェック付き）
- パスワード確認入力
- `confirmSignIn({ challengeResponse: newPassword })` API呼び出し

**遷移先:**
- 成功 → `/search` へリダイレクト
- 「ログイン画面に戻る」クリック → `login` 状態

**特徴:**
- `PasswordStrengthIndicator` でリアルタイム強度表示
- Cognitoパスワードポリシー準拠チェック

### forgot-password状態（ForgotPasswordForm）

**責務:**
- メールアドレス入力
- `resetPassword` API呼び出し（検証コード送信）

**遷移先:**
- 成功 → `reset-password` 状態
- 「ログイン画面に戻る」クリック → `login` 状態

### reset-password状態（ResetPasswordForm）

**責務:**
- 検証コード入力（6桁）
- 新しいパスワード入力
- `confirmResetPassword` API呼び出し

**遷移先:**
- 成功 → `login` 状態
- 「検証コード再送信」クリック → `forgot-password` 状態

## エラーハンドリング

各フォームで以下のエラーを処理:

1. **バリデーションエラー（クライアント側）**
   - メールアドレス形式
   - パスワード強度（8文字以上、大文字、小文字、数字、記号）
   - パスワード一致確認
   - 検証コード形式（6桁数字）

2. **Cognitoエラー（サーバー側）**
   - `UserNotFoundException`: ユーザーが存在しない
   - `NotAuthorizedException`: パスワード不正
   - `InvalidPasswordException`: パスワードポリシー違反
   - `CodeMismatchException`: 検証コード不一致
   - `ExpiredCodeException`: 検証コード期限切れ
   - `LimitExceededException`: リクエスト制限超過

全てのエラーは `getCognitoErrorMessage()` ユーティリティで日本語化されます。

## セキュリティ考慮事項

1. **パスワード強度**
   - AWS Cognitoデフォルトポリシーに準拠
   - クライアント側で事前検証
   - リアルタイムフィードバック

2. **状態管理**
   - 認証状態は `AuthContext` で集中管理
   - セッション情報はAWS Amplifyが管理
   - トークンは自動リフレッシュ

3. **エラー表示**
   - センシティブな情報を含まない
   - ユーザーフレンドリーなメッセージ
   - ログには詳細情報を記録

## 今後の拡張

- [ ] MFA（SMS/TOTP）フロー実装
- [ ] ソーシャルログイン（Google, Microsoft）
- [ ] パスワードレス認証（WebAuthn）
- [ ] アカウントロック機能
- [ ] セッション管理画面
