/**
 * HTTP Security Headers Middleware
 *
 * このミドルウェアは、OWASP推奨のHTTPセキュリティヘッダーを設定します。
 * OWASP Top 10 2021 - A05: Security Misconfiguration対策
 */

import { Request, Response, NextFunction } from 'express';

/**
 * セキュリティヘッダー設定オプション
 */
export interface SecurityHeadersOptions {
  /** Content Security Policy */
  contentSecurityPolicy?: {
    enabled?: boolean;
    directives?: Record<string, string[]>;
  };
  /** Strict-Transport-Security (HSTS) */
  hsts?: {
    enabled?: boolean;
    maxAge?: number;
    includeSubDomains?: boolean;
    preload?: boolean;
  };
  /** X-Frame-Options */
  xFrameOptions?: 'DENY' | 'SAMEORIGIN' | false;
  /** X-Content-Type-Options */
  noSniff?: boolean;
  /** X-XSS-Protection (非推奨だが後方互換性のため残す) */
  xssProtection?: boolean;
  /** Referrer-Policy */
  referrerPolicy?: string;
  /** Permissions-Policy */
  permissionsPolicy?: Record<string, string[]>;
}

/**
 * デフォルト設定
 */
const DEFAULT_OPTIONS: Required<SecurityHeadersOptions> = {
  contentSecurityPolicy: {
    enabled: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'"],  // TODO: Remove unsafe-inline in production
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'https:'],
      'font-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
    },
  },
  hsts: {
    enabled: true,
    maxAge: 31536000,  // 1 year
    includeSubDomains: true,
    preload: true,
  },
  xFrameOptions: 'DENY',
  noSniff: true,
  xssProtection: true,
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: {
    camera: ['none'],
    microphone: ['none'],
    geolocation: ['none'],
    payment: ['none'],
  },
};

/**
 * Content Security Policyディレクティブを文字列に変換
 */
function buildCSPHeader(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(' ')}`)
    .join('; ');
}

/**
 * Permissions-Policyヘッダーを文字列に変換
 */
function buildPermissionsPolicyHeader(policy: Record<string, string[]>): string {
  return Object.entries(policy)
    .map(([feature, allowlist]) => `${feature}=(${allowlist.join(' ')})`)
    .join(', ');
}

/**
 * セキュリティヘッダーミドルウェアを作成
 *
 * @param options - セキュリティヘッダー設定オプション
 * @returns Express middleware
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { securityHeaders } from './middleware/securityHeaders';
 *
 * const app = express();
 * app.use(securityHeaders());
 * ```
 */
export const securityHeaders = (
  options: SecurityHeadersOptions = {}
): ((req: Request, res: Response, next: NextFunction) => void) => {
  const config = { ...DEFAULT_OPTIONS, ...options };

  return (req: Request, res: Response, next: NextFunction) => {
    // 1. Content Security Policy (CSP)
    if (config.contentSecurityPolicy.enabled) {
      const csp = buildCSPHeader(config.contentSecurityPolicy.directives!);
      res.setHeader('Content-Security-Policy', csp);
    }

    // 2. Strict-Transport-Security (HSTS)
    if (config.hsts.enabled) {
      let hstsValue = `max-age=${config.hsts.maxAge}`;
      if (config.hsts.includeSubDomains) {
        hstsValue += '; includeSubDomains';
      }
      if (config.hsts.preload) {
        hstsValue += '; preload';
      }
      res.setHeader('Strict-Transport-Security', hstsValue);
    }

    // 3. X-Frame-Options
    if (config.xFrameOptions) {
      res.setHeader('X-Frame-Options', config.xFrameOptions);
    }

    // 4. X-Content-Type-Options
    if (config.noSniff) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }

    // 5. X-XSS-Protection (非推奨だが後方互換性のため)
    if (config.xssProtection) {
      res.setHeader('X-XSS-Protection', '1; mode=block');
    }

    // 6. Referrer-Policy
    if (config.referrerPolicy) {
      res.setHeader('Referrer-Policy', config.referrerPolicy);
    }

    // 7. Permissions-Policy
    if (config.permissionsPolicy && Object.keys(config.permissionsPolicy).length > 0) {
      const permissionsPolicy = buildPermissionsPolicyHeader(config.permissionsPolicy);
      res.setHeader('Permissions-Policy', permissionsPolicy);
    }

    // 8. Remove X-Powered-By header (セキュリティ情報の漏洩を防ぐ)
    res.removeHeader('X-Powered-By');

    next();
  };
};

/**
 * 本番環境用のストリクトなセキュリティヘッダー設定
 */
export const strictSecurityHeaders = (): ReturnType<typeof securityHeaders> => {
  return securityHeaders({
    contentSecurityPolicy: {
      enabled: true,
      directives: {
        'default-src': ["'none'"],
        'script-src': ["'self'"],  // unsafe-inline削除
        'style-src': ["'self'"],   // unsafe-inline削除
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': [],
      },
    },
    hsts: {
      enabled: true,
      maxAge: 63072000,  // 2 years
      includeSubDomains: true,
      preload: true,
    },
    xFrameOptions: 'DENY',
    noSniff: true,
    xssProtection: true,
    referrerPolicy: 'no-referrer',
    permissionsPolicy: {
      camera: ['none'],
      microphone: ['none'],
      geolocation: ['none'],
      payment: ['none'],
      usb: ['none'],
      magnetometer: ['none'],
      accelerometer: ['none'],
      gyroscope: ['none'],
    },
  });
};

/**
 * 開発環境用の緩和されたセキュリティヘッダー設定
 */
export const developmentSecurityHeaders = (): ReturnType<typeof securityHeaders> => {
  return securityHeaders({
    contentSecurityPolicy: {
      enabled: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],  // HMR対応
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'https:', 'http:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'", 'ws:', 'wss:'],  // WebSocket対応
        'frame-ancestors': ["'self'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
      },
    },
    hsts: {
      enabled: false,  // 開発環境ではHTTPを許可
    },
    xFrameOptions: 'SAMEORIGIN',
    noSniff: true,
    xssProtection: true,
    referrerPolicy: 'strict-origin-when-cross-origin',
  });
};
