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
  Amplify.configure({
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
  })
}

/**
 * 環境変数が正しく設定されているかチェック
 */
export const validateAmplifyConfig = (): void => {
  const requiredEnvVars = ['NEXT_PUBLIC_COGNITO_USER_POOL_ID', 'NEXT_PUBLIC_COGNITO_APP_CLIENT_ID']

  const missingVars = requiredEnvVars.filter((varName) => !process.env[varName])

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`)
  }
}
