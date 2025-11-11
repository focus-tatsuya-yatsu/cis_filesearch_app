/**
 * Lambda@Edge Authentication Function
 * CloudFront Viewer Request で実行される認証チェック
 */

import { CloudFrontRequestHandler, CloudFrontRequestEvent } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

// Cognito JWT検証器の初期化
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID!,
  tokenUse: 'id',
  clientId: process.env.COGNITO_CLIENT_ID!,
});

// 保護が必要なパス
const PROTECTED_PATHS = ['/search', '/search.html', '/search/index.html'];

// 公開パス（認証不要）
const PUBLIC_PATHS = ['/', '/index.html', '/auth', '/auth/callback'];

export const handler: CloudFrontRequestHandler = async (
  event: CloudFrontRequestEvent
) => {
  const request = event.Records[0].cf.request;
  const uri = request.uri;

  // 公開パスは認証チェックをスキップ
  if (PUBLIC_PATHS.some(path => uri.startsWith(path))) {
    return request;
  }

  // 保護されたパスの認証チェック
  if (PROTECTED_PATHS.some(path => uri.includes(path))) {
    try {
      // Cookieからトークンを取得
      const cookies = parseCookies(request.headers.cookie);
      const idToken = cookies['CognitoIdToken'];

      if (!idToken) {
        return unauthorizedResponse('Missing authentication token');
      }

      // Cognito JWTトークンを検証
      const payload = await verifier.verify(idToken);

      console.log('Token verified for user:', payload.sub);

      // トークンが有効な場合、リクエストを続行
      return request;
    } catch (error) {
      console.error('Token verification failed:', error);
      return unauthorizedResponse('Invalid authentication token');
    }
  }

  // その他のパスは許可
  return request;
};

/**
 * Cookieヘッダーをパースする
 */
function parseCookies(
  cookieHeader?: Array<{ key?: string; value?: string }>
): Record<string, string> {
  if (!cookieHeader || cookieHeader.length === 0) {
    return {};
  }

  const cookies: Record<string, string> = {};
  const cookieString = cookieHeader[0].value || '';

  cookieString.split(';').forEach(cookie => {
    const [key, value] = cookie.trim().split('=');
    if (key && value) {
      cookies[key] = decodeURIComponent(value);
    }
  });

  return cookies;
}

/**
 * 401 Unauthorized レスポンスを返す
 */
function unauthorizedResponse(message: string) {
  return {
    status: '401',
    statusDescription: 'Unauthorized',
    headers: {
      'content-type': [{ key: 'Content-Type', value: 'text/html' }],
      'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
    },
    body: `
      <!DOCTYPE html>
      <html>
        <head>
          <title>401 Unauthorized</title>
          <meta charset="utf-8">
        </head>
        <body>
          <h1>401 Unauthorized</h1>
          <p>${message}</p>
          <p><a href="/">ログインページに戻る</a></p>
        </body>
      </html>
    `,
  };
}
