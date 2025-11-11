/**
 * AWS Amplify設定
 *
 * Cognito User Poolとの接続設定を管理
 */

import { Amplify } from 'aws-amplify'

/**
 * Amplifyの初期設定を行う
 *
 * @remarks
 * アプリケーション起動時に一度だけ呼び出す必要があります。
 * 通常は `app/layout.tsx` の最上位で呼び出します。
 */
export const configureAmplify = (): void => {
  Amplify.configure(
    {
      Auth: {
        Cognito: {
          // User Pool ID
          userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,

          // App Client ID
          userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_APP_CLIENT_ID!,

          // サインアップ検証方法
          signUpVerificationMethod: 'code', // メールまたはSMSコード

          // ログイン方法
          loginWith: {
            email: true,
            username: true,

            // OAuth 2.0 PKCE (Authorization Code Grant with Proof Key for Code Exchange)
            oauth: {
              // Cognito Hosted UIドメイン
              domain: process.env.NEXT_PUBLIC_COGNITO_DOMAIN!,

              // OAuth 2.0 スコープ
              scopes: ['openid', 'email', 'profile'],

              // サインイン後のリダイレクトURL
              redirectSignIn: [process.env.NEXT_PUBLIC_APP_URL! + '/auth/callback'],

              // サインアウト後のリダイレクトURL
              redirectSignOut: [process.env.NEXT_PUBLIC_APP_URL!],

              // Authorization Code Flow (PKCE)
              responseType: 'code',
            },
          },

          // MFA（多要素認証）設定
          mfa: {
            status: 'optional', // optional | on | off
            totpEnabled: true, // Google Authenticator等
            smsEnabled: true, // SMS認証
          },

          // パスワードポリシー（参考情報）
          passwordFormat: {
            minLength: 8,
            requireLowercase: true,
            requireUppercase: true,
            requireNumbers: true,
            requireSpecialCharacters: true,
          },
        },
      },
    },
    {
      // Next.js App RouterではSSRを無効化
      ssr: false,
    }
  )
}

/**
 * 環境変数が正しく設定されているかチェック
 *
 * @throws {Error} 必須の環境変数が欠けている、または形式が不正な場合
 */
export const validateAmplifyConfig = (): void => {
  const requiredEnvVars = {
    NEXT_PUBLIC_COGNITO_USER_POOL_ID: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
    NEXT_PUBLIC_COGNITO_APP_CLIENT_ID: process.env.NEXT_PUBLIC_COGNITO_APP_CLIENT_ID,
    NEXT_PUBLIC_COGNITO_DOMAIN: process.env.NEXT_PUBLIC_COGNITO_DOMAIN,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  }

  // 1. 欠損チェック
  const missingVars = Object.entries(requiredEnvVars)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missingVars.length > 0) {
    console.error('❌ 以下の環境変数が設定されていません:')
    missingVars.forEach((varName) => {
      console.error(`  - ${varName}`)
    })
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}\n` +
        'Please check your .env.local file and ensure all required variables are set.'
    )
  }

  // 2. User Pool IDの形式チェック (例: ap-northeast-1_XXXXXXXXX)
  const userPoolId = requiredEnvVars.NEXT_PUBLIC_COGNITO_USER_POOL_ID!
  const userPoolIdPattern = /^[a-z]{2}-[a-z]+-\d+_[a-zA-Z0-9]+$/
  if (!userPoolIdPattern.test(userPoolId)) {
    console.error('❌ User Pool IDの形式が不正です:')
    console.error(`  実際の値: ${userPoolId}`)
    console.error(`  期待する形式: ap-northeast-1_XXXXXXXXX`)
    throw new Error(
      `Invalid NEXT_PUBLIC_COGNITO_USER_POOL_ID format: "${userPoolId}"\n` +
        'Expected format: <region>_<pool-id> (e.g., ap-northeast-1_abc123XYZ)'
    )
  }

  // 3. Cognito Domainの形式チェック（http/httpsを含まないこと）
  const domain = requiredEnvVars.NEXT_PUBLIC_COGNITO_DOMAIN!
  if (domain.startsWith('http://') || domain.startsWith('https://')) {
    console.error('❌ Cognito Domainにプロトコル（http/https）を含めないでください:')
    console.error(`  実際の値: ${domain}`)
    console.error(`  期待する形式: your-app.auth.ap-northeast-1.amazoncognito.com`)
    throw new Error(
      `Invalid NEXT_PUBLIC_COGNITO_DOMAIN format: "${domain}"\n` +
        'Domain should NOT include http:// or https://'
    )
  }

  // 4. App URLの形式チェック（http/httpsで始まること）
  const appUrl = requiredEnvVars.NEXT_PUBLIC_APP_URL!
  if (!appUrl.startsWith('http://') && !appUrl.startsWith('https://')) {
    console.error('❌ App URLはhttp://またはhttps://で始まる必要があります:')
    console.error(`  実際の値: ${appUrl}`)
    console.error(`  期待する形式: https://your-app.com または http://localhost:3000`)
    throw new Error(
      `Invalid NEXT_PUBLIC_APP_URL format: "${appUrl}"\n` +
        'App URL must start with http:// or https://'
    )
  }

  console.log('✅ Amplify環境変数の検証が完了しました')
}
