# Amplify初期化のセキュリティベストプラクティス

## 🎯 概要

AWS Amplify v6 を使用したCognito認証において、セキュリティを最大化するための実装ガイドです。

---

## 1. 環境変数の安全な管理

### ❌ Bad: ハードコード

```typescript
// 絶対にしないこと
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: 'us-east-1_XXXXXXXXX',  // ❌ ハードコード
      userPoolClientId: 'abcdefghijklmnopqrstuvwxyz',  // ❌ ハードコード
    }
  }
});
```

### ✅ Good: 環境変数の使用

```typescript
// frontend/.env.local
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
NEXT_PUBLIC_COGNITO_CLIENT_ID=abcdefghijklmnopqrstuvwxyz
NEXT_PUBLIC_COGNITO_DOMAIN=your-domain.auth.us-east-1.amazoncognito.com
NEXT_PUBLIC_REDIRECT_SIGN_IN=https://search.cis-filesearch.com/auth/callback
NEXT_PUBLIC_REDIRECT_SIGN_OUT=https://search.cis-filesearch.com/

// frontend/src/lib/amplify.ts
import { Amplify } from 'aws-amplify';

export function configureAmplify() {
  // 環境変数の存在チェック
  const requiredEnvVars = [
    'NEXT_PUBLIC_COGNITO_USER_POOL_ID',
    'NEXT_PUBLIC_COGNITO_CLIENT_ID',
    'NEXT_PUBLIC_COGNITO_DOMAIN',
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
        userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
        loginWith: {
          oauth: {
            domain: process.env.NEXT_PUBLIC_COGNITO_DOMAIN!,
            scopes: ['openid', 'email', 'profile'],
            redirectSignIn: [process.env.NEXT_PUBLIC_REDIRECT_SIGN_IN!],
            redirectSignOut: [process.env.NEXT_PUBLIC_REDIRECT_SIGN_OUT!],
            responseType: 'code',  // ✅ PKCE使用（最も安全）
          },
        },
      },
    },
  });
}
```

### 🔒 .gitignore の設定

```gitignore
# 機密情報を含むファイルをコミットしない
.env
.env.local
.env.*.local
.env.production

# AWS設定
.aws/
aws-exports.js
```

### 📋 環境変数のバリデーション

```typescript
// frontend/src/lib/env.ts

import { z } from 'zod';

/**
 * 環境変数のスキーマ定義
 */
const envSchema = z.object({
  NEXT_PUBLIC_COGNITO_USER_POOL_ID: z
    .string()
    .regex(/^[a-z0-9-]+_[A-Za-z0-9]+$/, 'Invalid User Pool ID format'),

  NEXT_PUBLIC_COGNITO_CLIENT_ID: z
    .string()
    .min(26, 'Client ID must be at least 26 characters'),

  NEXT_PUBLIC_COGNITO_DOMAIN: z
    .string()
    .regex(/^[a-z0-9-]+\.auth\.[a-z0-9-]+\.amazoncognito\.com$/, 'Invalid Cognito domain'),

  NEXT_PUBLIC_REDIRECT_SIGN_IN: z
    .string()
    .url('Invalid redirect URL'),

  NEXT_PUBLIC_REDIRECT_SIGN_OUT: z
    .string()
    .url('Invalid redirect URL'),
});

/**
 * 環境変数を検証
 */
export function validateEnv() {
  try {
    return envSchema.parse({
      NEXT_PUBLIC_COGNITO_USER_POOL_ID: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
      NEXT_PUBLIC_COGNITO_CLIENT_ID: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
      NEXT_PUBLIC_COGNITO_DOMAIN: process.env.NEXT_PUBLIC_COGNITO_DOMAIN,
      NEXT_PUBLIC_REDIRECT_SIGN_IN: process.env.NEXT_PUBLIC_REDIRECT_SIGN_IN,
      NEXT_PUBLIC_REDIRECT_SIGN_OUT: process.env.NEXT_PUBLIC_REDIRECT_SIGN_OUT,
    });
  } catch (error) {
    console.error('Environment validation failed:', error);
    throw new Error('Invalid environment configuration');
  }
}
```

---

## 2. トークンのライフサイクル管理

### トークンの種類と有効期限

| トークン種類 | 用途 | デフォルト有効期限 | 推奨設定 |
|-------------|------|------------------|---------|
| **IDトークン** | ユーザー情報 | 1時間 | 1時間 |
| **アクセストークン** | API認証 | 1時間 | 1時間 |
| **リフレッシュトークン** | トークン更新 | 30日 | 7日 |

### ✅ セキュアなトークン管理

```typescript
// frontend/src/lib/auth/token-manager.ts

import { fetchAuthSession } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';

/**
 * トークンマネージャークラス
 */
export class TokenManager {
  private refreshInterval: NodeJS.Timeout | null = null;
  private readonly REFRESH_THRESHOLD = 5 * 60 * 1000; // 5分前

  /**
   * トークンの自動リフレッシュを開始
   */
  startAutoRefresh() {
    // 既存のインターバルをクリア
    this.stopAutoRefresh();

    // 1分ごとにトークンをチェック
    this.refreshInterval = setInterval(async () => {
      await this.checkAndRefreshToken();
    }, 60 * 1000);

    console.log('Token auto-refresh started');
  }

  /**
   * トークンの自動リフレッシュを停止
   */
  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      console.log('Token auto-refresh stopped');
    }
  }

  /**
   * トークンをチェックして必要に応じてリフレッシュ
   */
  private async checkAndRefreshToken() {
    try {
      const session = await fetchAuthSession();
      const tokens = session.tokens;

      if (!tokens?.idToken) {
        console.warn('No tokens found');
        return;
      }

      // トークンの有効期限をチェック
      const payload = tokens.idToken.payload;
      const exp = (payload.exp as number) * 1000;
      const now = Date.now();
      const timeUntilExpiry = exp - now;

      // 有効期限まで5分以内の場合、リフレッシュ
      if (timeUntilExpiry < this.REFRESH_THRESHOLD) {
        console.log('Token expiring soon, refreshing...');
        await fetchAuthSession({ forceRefresh: true });
        console.log('Token refreshed successfully');
      }
    } catch (error) {
      console.error('Token refresh failed:', error);

      // リフレッシュ失敗時はログアウト
      this.handleRefreshFailure();
    }
  }

  /**
   * リフレッシュ失敗時の処理
   */
  private handleRefreshFailure() {
    // セッションをクリア
    this.stopAutoRefresh();

    // カスタムイベントを発火
    Hub.dispatch('auth', {
      event: 'tokenRefreshFailure',
      data: {},
    });

    // ログインページにリダイレクト
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
  }
}

// シングルトンインスタンス
export const tokenManager = new TokenManager();
```

### Hub イベントリスナーの設定

```typescript
// frontend/src/app/providers.tsx

'use client';

import { useEffect } from 'react';
import { Hub } from 'aws-amplify/utils';
import { tokenManager } from '@/lib/auth/token-manager';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Hubイベントリスナーを設定
    const unsubscribe = Hub.listen('auth', (data) => {
      const { event } = data.payload;

      switch (event) {
        case 'signedIn':
          console.log('User signed in');
          tokenManager.startAutoRefresh();
          break;

        case 'signedOut':
          console.log('User signed out');
          tokenManager.stopAutoRefresh();
          break;

        case 'tokenRefresh':
          console.log('Token refreshed');
          break;

        case 'tokenRefresh_failure':
          console.error('Token refresh failed');
          tokenManager.stopAutoRefresh();
          // ログインページにリダイレクト
          window.location.href = '/';
          break;

        case 'tokenRefreshFailure':
          console.error('Custom token refresh failure event');
          break;
      }
    });

    return () => {
      unsubscribe();
      tokenManager.stopAutoRefresh();
    };
  }, []);

  return <>{children}</>;
}
```

---

## 3. セキュアな初期化フロー

### ✅ 推奨される初期化パターン

```typescript
// frontend/src/app/layout.tsx

import { configureAmplify } from '@/lib/amplify';
import { validateEnv } from '@/lib/env';
import { AuthProvider } from './providers';

// ✅ GOOD: サーバーサイドでAmplifyを設定（SSR対応）
configureAmplify();

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 環境変数を検証（開発環境のみ）
  if (process.env.NODE_ENV === 'development') {
    validateEnv();
  }

  return (
    <html lang="ja">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

### 🔒 静的エクスポート環境での初期化

```typescript
// frontend/src/app/providers.tsx

'use client';

import { useEffect, useState } from 'react';
import { configureAmplify } from '@/lib/amplify';

export function AmplifyProvider({ children }: { children: React.ReactNode }) {
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    // ✅ クライアントサイドで初期化（静的エクスポート環境）
    try {
      configureAmplify();
      setIsConfigured(true);
    } catch (error) {
      console.error('Amplify configuration failed:', error);
    }
  }, []);

  if (!isConfigured) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  return <>{children}</>;
}
```

---

## 4. セキュリティ監査ログ

### 認証イベントのログ記録

```typescript
// frontend/src/lib/auth/audit-logger.ts

interface AuditLog {
  timestamp: string;
  event: string;
  userId?: string;
  userAgent: string;
  ipAddress?: string;
  success: boolean;
  error?: string;
}

/**
 * 監査ログをCloudWatchに送信
 */
export async function logAuthEvent(log: AuditLog) {
  try {
    // CloudWatch Logs APIまたはカスタムAPIにログを送信
    await fetch('/api/audit-log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(log),
    });
  } catch (error) {
    console.error('Failed to send audit log:', error);
  }
}

/**
 * 認証成功のログ記録
 */
export function logSignInSuccess(userId: string) {
  logAuthEvent({
    timestamp: new Date().toISOString(),
    event: 'signIn',
    userId,
    userAgent: navigator.userAgent,
    success: true,
  });
}

/**
 * 認証失敗のログ記録
 */
export function logSignInFailure(error: string) {
  logAuthEvent({
    timestamp: new Date().toISOString(),
    event: 'signIn',
    userAgent: navigator.userAgent,
    success: false,
    error,
  });
}
```

---

## 5. エラーハンドリング

### ✅ セキュアなエラーメッセージ

```typescript
// frontend/src/lib/auth/error-handler.ts

/**
 * 認証エラーをユーザーフレンドリーなメッセージに変換
 */
export function getAuthErrorMessage(error: any): string {
  const errorCode = error.name || error.code;

  switch (errorCode) {
    case 'UserNotFoundException':
    case 'NotAuthorizedException':
      // ❌ Bad: "ユーザーが見つかりません"
      // ✅ Good: 具体的な情報を漏らさない
      return 'メールアドレスまたはパスワードが正しくありません';

    case 'UserNotConfirmedException':
      return 'メール確認が必要です。送信されたメールを確認してください';

    case 'PasswordResetRequiredException':
      return 'パスワードのリセットが必要です';

    case 'TooManyRequestsException':
      return '試行回数が多すぎます。しばらく待ってから再度お試しください';

    case 'InvalidParameterException':
      return '入力内容に誤りがあります';

    case 'CodeMismatchException':
      return '確認コードが正しくありません';

    default:
      // ❌ Bad: error.messageをそのまま表示
      // ✅ Good: 一般的なメッセージ
      return '認証エラーが発生しました。もう一度お試しください';
  }
}
```

---

## 📋 セキュリティチェックリスト

### Amplify設定

- [ ] 環境変数を使用（ハードコードなし）
- [ ] 環境変数のバリデーション実装
- [ ] .env ファイルを .gitignore に追加
- [ ] PKCE使用（`responseType: 'code'`）
- [ ] HttpOnly Cookie使用（推奨）

### トークン管理

- [ ] トークン自動リフレッシュ実装
- [ ] リフレッシュ失敗時のログアウト処理
- [ ] トークン有効期限の適切な設定（ID/Access: 1時間、Refresh: 7日）
- [ ] Hub イベントリスナーの設定

### エラーハンドリング

- [ ] セキュアなエラーメッセージ
- [ ] 監査ログ記録
- [ ] エラー時の適切なリダイレクト

### セキュリティ

- [ ] HTTPS強制
- [ ] CORS設定の検証
- [ ] セキュリティヘッダーの設定
- [ ] XSS/CSRF対策

---

## 🚨 よくあるセキュリティミス

### 1. ❌ クライアントシークレットの使用

```typescript
// ❌ Bad: クライアントシークレットを使用（SPAでは非推奨）
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolClientId: 'xxx',
      userPoolClientSecret: 'yyy',  // ❌ SPAでは使用しない
    }
  }
});
```

**理由**: クライアントシークレットはJavaScriptコードに埋め込まれ、誰でもアクセス可能になります。

**解決策**: Cognitoアプリクライアントで「クライアントシークレットを生成」を無効化し、PKCEを使用します。

### 2. ❌ Local Storageへの機密情報保存

```typescript
// ❌ Bad: Local Storageに直接トークンを保存
localStorage.setItem('userToken', token);
```

**理由**: XSS攻撃でトークンが窃取される可能性があります。

**解決策**: HttpOnly Cookieを使用します。

### 3. ❌ 詳細なエラーメッセージの表示

```typescript
// ❌ Bad: エラーの詳細を表示
alert(`Error: ${error.message}`);
```

**理由**: 攻撃者に有用な情報を提供します（ユーザーの存在確認など）。

**解決策**: 一般的なエラーメッセージを表示し、詳細はログに記録します。

---

## 🔗 参考資料

- [AWS Amplify Security Best Practices](https://docs.amplify.aws/javascript/build-a-backend/auth/concepts/security-best-practices/)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OAuth 2.0 Security Best Current Practice](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)
