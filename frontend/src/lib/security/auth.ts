/**
 * 認証ユーティリティ
 * JWT検証、ユーザー認証、レート制限
 */

import { NextRequest } from 'next/server';
import { jwtVerify, SignJWT } from 'jose';

/**
 * JWT ペイロード型定義
 */
export interface JWTPayload {
  sub: string; // ユーザーID
  userId: string;
  email: string;
  role: string;
  iat: number; // Issued At
  exp: number; // Expiration Time
}

/**
 * JWT Secret（環境変数から取得）
 */
function getJWTSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return new TextEncoder().encode(secret);
}

/**
 * JWT トークンを検証
 */
export async function verifyJWT(token: string): Promise<JWTPayload> {
  try {
    const secret = getJWTSecret();
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      // トークンの有効期限を検証
      clockTolerance: 0,
    });

    // 必須フィールドの検証
    if (!payload.sub || !payload.userId || !payload.email) {
      throw new Error('Invalid token payload: missing required fields');
    }

    return payload as JWTPayload;
  } catch (error: any) {
    console.error('[Auth] JWT verification failed:', {
      error: error.message,
      code: error.code,
    });
    throw new Error('Invalid or expired token');
  }
}

/**
 * JWT トークンを生成
 */
export async function generateJWT(payload: Omit<JWTPayload, 'iat' | 'exp'>): Promise<string> {
  try {
    const secret = getJWTSecret();

    const token = await new SignJWT({
      sub: payload.sub,
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h') // 1時間で期限切れ
      .sign(secret);

    return token;
  } catch (error) {
    console.error('[Auth] JWT generation failed:', error);
    throw new Error('Failed to generate JWT token');
  }
}

/**
 * リクエストから認証情報を抽出
 */
export async function extractAuthFromRequest(
  request: NextRequest
): Promise<{ authenticated: boolean; userId?: string; payload?: JWTPayload }> {
  const authHeader = request.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authenticated: false };
  }

  const token = authHeader.substring(7);

  try {
    const payload = await verifyJWT(token);
    return {
      authenticated: true,
      userId: payload.userId,
      payload,
    };
  } catch (error) {
    return { authenticated: false };
  }
}

/**
 * リクエストからユーザーIDを取得（認証必須）
 */
export async function requireAuth(request: NextRequest): Promise<string> {
  const { authenticated, userId } = await extractAuthFromRequest(request);

  if (!authenticated || !userId) {
    throw new Error('Unauthorized: Valid authentication required');
  }

  return userId;
}

/**
 * IPアドレスを取得
 */
export function getClientIP(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') || // Cloudflare
    'unknown'
  );
}

/**
 * User-Agentを取得
 */
export function getUserAgent(request: NextRequest): string {
  return request.headers.get('user-agent') || 'unknown';
}

/**
 * IPアドレスをマスク（GDPR準拠）
 */
export function maskIP(ip: string): string {
  if (!ip || ip === 'unknown') {
    return 'unknown';
  }

  // IPv4: 最後のオクテットをマスク
  const ipv4Match = ip.match(/^(\d+\.\d+\.\d+)\.\d+$/);
  if (ipv4Match) {
    return `${ipv4Match[1]}.xxx`;
  }

  // IPv6: 最後の4つの16進数をマスク
  const ipv6Match = ip.match(/^([0-9a-f:]+):[0-9a-f]{1,4}$/i);
  if (ipv6Match) {
    return `${ipv6Match[1]}:xxxx`;
  }

  return 'masked';
}

/**
 * ファイル名のハッシュ化（PII保護）
 */
export function hashFileName(fileName: string): string {
  if (!fileName) {
    return '';
  }

  // SHA-256ハッシュ（最初の16文字のみ使用）
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(fileName).digest('hex').substring(0, 16);
}
