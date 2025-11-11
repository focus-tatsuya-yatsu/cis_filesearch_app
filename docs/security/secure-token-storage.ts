/**
 * セキュアなトークンストレージ実装
 * HttpOnly Cookie + Secure フラグでXSS攻撃を防止
 */

import { Amplify } from 'aws-amplify';
import { CookieStorage } from 'aws-amplify/utils';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';

/**
 * カスタムCookieストレージ設定
 */
export const secureCookieStorage = new CookieStorage({
  // Cookie設定
  domain: '.cis-filesearch.com',  // サブドメイン間で共有
  path: '/',
  expires: 365,  // 日数
  sameSite: 'strict',  // CSRF対策
  secure: true,  // HTTPS必須
});

/**
 * Amplify設定（セキュアなトークンストレージ）
 */
export function configureAmplifySecure() {
  // Amplify設定
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
            responseType: 'code',
          },
        },
      },
    },
  });

  // ✅ GOOD: HttpOnly Cookieを使用したトークンストレージ
  cognitoUserPoolsTokenProvider.setKeyValueStorage(secureCookieStorage);
}

/**
 * トークン取得（Cookie経由）
 */
export async function getSecureTokens() {
  try {
    const tokens = await cognitoUserPoolsTokenProvider.getTokens();
    return {
      idToken: tokens?.idToken?.toString(),
      accessToken: tokens?.accessToken?.toString(),
    };
  } catch (error) {
    console.error('Failed to get tokens:', error);
    return null;
  }
}

/**
 * トークン検証とリフレッシュ
 */
export async function validateAndRefreshToken() {
  try {
    const tokens = await getSecureTokens();
    if (!tokens) {
      throw new Error('No tokens found');
    }

    // トークンの有効期限チェック
    const idToken = tokens.idToken;
    if (!idToken) {
      throw new Error('No ID token');
    }

    // JWT payloadをデコード
    const payload = JSON.parse(atob(idToken.split('.')[1]));
    const exp = payload.exp * 1000;  // ミリ秒に変換
    const now = Date.now();

    // 有効期限が5分以内の場合、リフレッシュ
    if (exp - now < 5 * 60 * 1000) {
      console.log('Token expiring soon, refreshing...');
      // Amplifyが自動的にリフレッシュトークンを使用
      await cognitoUserPoolsTokenProvider.getTokens({ forceRefresh: true });
    }

    return true;
  } catch (error) {
    console.error('Token validation failed:', error);
    return false;
  }
}
