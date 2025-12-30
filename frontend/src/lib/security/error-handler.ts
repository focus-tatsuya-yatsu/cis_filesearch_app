/**
 * セキュアなエラーハンドリング
 * 本番環境では詳細なエラー情報を露出しない
 */

import { NextResponse } from 'next/server';
import { createCorsResponse } from './cors';

/**
 * エラーレスポンスの型定義
 */
export interface ErrorResponse {
  error: string;
  code: string;
  errorId: string;
  details?: any; // 開発環境のみ
  timestamp: string;
}

/**
 * エラーID生成
 */
export function generateErrorId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9).toUpperCase();
  return `ERR-${timestamp}-${random}`;
}

/**
 * エラータイプの判定と公開エラーメッセージの生成
 */
function classifyError(error: any): {
  statusCode: number;
  publicError: string;
  errorCode: string;
} {
  // AWS認証エラー
  if (
    error.message?.includes('credentials') ||
    error.name === 'CredentialsProviderError' ||
    error.message?.toLowerCase().includes('could not load credentials')
  ) {
    return {
      statusCode: 401,
      publicError: 'Authentication failed',
      errorCode: 'AUTHENTICATION_ERROR',
    };
  }

  // AWS Bedrockアクセス拒否
  if (error.code === 'AccessDeniedException' || error.name === 'AccessDeniedException') {
    return {
      statusCode: 403,
      publicError: 'Access denied',
      errorCode: 'ACCESS_DENIED',
    };
  }

  // バリデーションエラー
  if (
    error.code === 'ValidationException' ||
    error.name === 'ValidationException' ||
    error.message?.includes('validation')
  ) {
    return {
      statusCode: 400,
      publicError: 'Invalid request',
      errorCode: 'VALIDATION_ERROR',
    };
  }

  // レート制限エラー
  if (error.name === 'RateLimitError' || error.message?.includes('rate limit')) {
    return {
      statusCode: 429,
      publicError: 'Too many requests',
      errorCode: 'RATE_LIMIT_EXCEEDED',
    };
  }

  // サービス利用不可
  if (
    error.code === 'ServiceUnavailableException' ||
    error.name === 'ServiceUnavailableException' ||
    error.message?.includes('unavailable')
  ) {
    return {
      statusCode: 503,
      publicError: 'Service temporarily unavailable',
      errorCode: 'SERVICE_UNAVAILABLE',
    };
  }

  // タイムアウト
  if (error.code === 'TimeoutError' || error.message?.includes('timeout')) {
    return {
      statusCode: 504,
      publicError: 'Request timeout',
      errorCode: 'REQUEST_TIMEOUT',
    };
  }

  // 認証トークンエラー
  if (error.message?.includes('token') || error.message?.includes('Unauthorized')) {
    return {
      statusCode: 401,
      publicError: 'Invalid or expired token',
      errorCode: 'INVALID_TOKEN',
    };
  }

  // デフォルト: 内部サーバーエラー
  return {
    statusCode: 500,
    publicError: 'Internal server error',
    errorCode: 'INTERNAL_ERROR',
  };
}

/**
 * セキュアなエラーレスポンスを生成
 * 本番環境では詳細なエラー情報を隠蔽
 */
export function createSecureErrorResponse(error: any, origin: string | null): NextResponse {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const errorId = generateErrorId();

  // エラー詳細をCloudWatchに記録（本番環境でも）
  console.error('[Security] Error occurred:', {
    errorId,
    timestamp: new Date().toISOString(),
    errorName: error.name,
    errorCode: error.code,
    errorMessage: error.message,
    // スタックトレースは開発環境のみ
    ...(isDevelopment && { stack: error.stack }),
  });

  // エラータイプの分類
  const { statusCode, publicError, errorCode } = classifyError(error);

  // レスポンスボディ
  const responseBody: ErrorResponse = {
    error: publicError,
    code: errorCode,
    errorId, // サポート問い合わせ用のID
    timestamp: new Date().toISOString(),
  };

  // 開発環境のみ詳細を追加
  if (isDevelopment) {
    responseBody.details = {
      message: error.message,
      name: error.name,
      code: error.code,
      // 特定のエラーの追加情報
      ...(error.statusCode && { statusCode: error.statusCode }),
      ...(error.$metadata && { metadata: error.$metadata }),
    };
  }

  return createCorsResponse(responseBody, statusCode, origin);
}

/**
 * レート制限エラーレスポンス
 */
export function createRateLimitErrorResponse(
  limit: number,
  reset: number,
  origin: string | null
): NextResponse {
  const retryAfter = Math.ceil((reset - Date.now()) / 1000);

  return createCorsResponse(
    {
      error: 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter,
      errorId: generateErrorId(),
      timestamp: new Date().toISOString(),
    },
    429,
    origin,
    {
      'Retry-After': retryAfter.toString(),
      'X-RateLimit-Limit': limit.toString(),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': new Date(reset).toISOString(),
    }
  );
}

/**
 * バリデーションエラーレスポンス
 */
export function createValidationErrorResponse(
  message: string,
  code: string,
  origin: string | null
): NextResponse {
  return createCorsResponse(
    {
      error: message,
      code,
      errorId: generateErrorId(),
      timestamp: new Date().toISOString(),
    },
    400,
    origin
  );
}

/**
 * 認証エラーレスポンス
 */
export function createAuthErrorResponse(message: string, origin: string | null): NextResponse {
  return createCorsResponse(
    {
      error: message,
      code: 'UNAUTHORIZED',
      errorId: generateErrorId(),
      timestamp: new Date().toISOString(),
    },
    401,
    origin
  );
}
