/**
 * Lambda@Edge Origin Response Function
 * セキュリティヘッダーを追加
 */

import { CloudFrontResponseHandler, CloudFrontResponseEvent } from 'aws-lambda';

export const handler: CloudFrontResponseHandler = async (
  event: CloudFrontResponseEvent
) => {
  const response = event.Records[0].cf.response;
  const headers = response.headers;

  // Content Security Policy
  headers['content-security-policy'] = [
    {
      key: 'Content-Security-Policy',
      value: [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.amazonaws.com",
        "connect-src 'self' https://*.amazonaws.com https://cognito-idp.*.amazonaws.com",
        "img-src 'self' data: https:",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self' data:",
        "frame-ancestors 'none'",
      ].join('; '),
    },
  ];

  // Strict Transport Security
  headers['strict-transport-security'] = [
    {
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains; preload',
    },
  ];

  // X-Frame-Options (クリックジャッキング防止)
  headers['x-frame-options'] = [
    {
      key: 'X-Frame-Options',
      value: 'DENY',
    },
  ];

  // X-Content-Type-Options (MIMEスニッフィング防止)
  headers['x-content-type-options'] = [
    {
      key: 'X-Content-Type-Options',
      value: 'nosniff',
    },
  ];

  // Referrer-Policy
  headers['referrer-policy'] = [
    {
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin',
    },
  ];

  // Permissions-Policy
  headers['permissions-policy'] = [
    {
      key: 'Permissions-Policy',
      value: 'geolocation=(), microphone=(), camera=()',
    },
  ];

  // X-XSS-Protection (古いブラウザ向け)
  headers['x-xss-protection'] = [
    {
      key: 'X-XSS-Protection',
      value: '1; mode=block',
    },
  ];

  // Cache-Control (認証が必要なページ)
  const uri = event.Records[0].cf.request.uri;
  if (uri.includes('/search')) {
    headers['cache-control'] = [
      {
        key: 'Cache-Control',
        value: 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    ];
    headers['pragma'] = [
      {
        key: 'Pragma',
        value: 'no-cache',
      },
    ];
    headers['expires'] = [
      {
        key: 'Expires',
        value: '0',
      },
    ];
  }

  return response;
};
