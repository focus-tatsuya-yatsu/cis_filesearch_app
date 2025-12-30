/**
 * CORS (Cross-Origin Resource Sharing) セキュリティ設定
 * オリジン検証、セキュリティヘッダーの設定
 */

import { NextResponse } from 'next/server';

/**
 * 許可されるオリジンのリスト
 * 環境変数から取得、またはデフォルト値
 */
function getAllowedOrigins(): string[] {
  const envOrigins = process.env.ALLOWED_ORIGINS;

  if (envOrigins) {
    return envOrigins.split(',').map((origin) => origin.trim());
  }

  // デフォルト: 本番環境のドメイン
  const defaultOrigins = [
    'https://cis-filesearch.example.com',
    'https://app.cis-filesearch.example.com',
  ];

  // 開発環境の場合は localhost を追加
  if (process.env.NODE_ENV === 'development') {
    defaultOrigins.push('http://localhost:3000', 'http://localhost:3001');
  }

  return defaultOrigins;
}

/**
 * オリジンが許可されているかチェック
 */
export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) {
    return false;
  }

  const allowedOrigins = getAllowedOrigins();
  return allowedOrigins.includes(origin);
}

/**
 * セキュリティヘッダーを取得
 */
export function getSecurityHeaders(origin: string | null): Record<string, string> {
  const allowedOrigins = getAllowedOrigins();

  // オリジンが許可されている場合はそのまま、そうでなければデフォルトのオリジンを使用
  const allowedOrigin = origin && isOriginAllowed(origin) ? origin : allowedOrigins[0];

  return {
    // ✅ CORS設定
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400', // 24時間

    // ✅ セキュリティヘッダー
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',

    // ✅ Content Security Policy
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.jsで必要
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
      "connect-src 'self' https://*.amazonaws.com https://*.cloudfront.net",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  };
}

/**
 * CORS対応のJSONレスポンスを生成
 */
export function createCorsResponse(
  data: any,
  status: number,
  origin: string | null,
  additionalHeaders?: Record<string, string>
): NextResponse {
  const headers = {
    ...getSecurityHeaders(origin),
    ...additionalHeaders,
  };

  return NextResponse.json(data, {
    status,
    headers,
  });
}

/**
 * OPTIONSリクエスト（プリフライト）のレスポンスを生成
 */
export function createOptionsResponse(origin: string | null): NextResponse {
  const headers = getSecurityHeaders(origin);

  return new NextResponse(null, {
    status: 204, // No Content
    headers,
  });
}

/**
 * オリジン検証失敗時のエラーレスポンス
 */
export function createOriginErrorResponse(origin: string | null): NextResponse {
  return NextResponse.json(
    {
      error: 'Origin not allowed',
      code: 'INVALID_ORIGIN',
      origin: origin || 'null',
    },
    {
      status: 403,
      headers: {
        'X-Content-Type-Options': 'nosniff',
      },
    }
  );
}
