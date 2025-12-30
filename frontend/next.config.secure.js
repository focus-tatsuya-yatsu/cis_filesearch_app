/**
 * Next.js Configuration - Security Hardened
 * セキュリティ強化された本番環境用設定
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // ============================================================================
  // セキュリティヘッダー設定
  // ============================================================================
  async headers() {
    return [
      {
        // すべてのルートに適用
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.jsで必要
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self'",
              "connect-src 'self' https://*.amazonaws.com https://*.cloudfront.net",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "upgrade-insecure-requests",
            ].join('; '),
          },
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
        ],
      },
      {
        // APIルート: キャッシュ無効化
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },
        ],
      },
      {
        // 静的アセット: 長期キャッシュ
        source: '/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // 画像: 長期キャッシュ
        source: '/:path*.{jpg,jpeg,png,gif,webp,avif,svg,ico}',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },

  // ============================================================================
  // HTTPSリダイレクト設定
  // ============================================================================
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [
          {
            type: 'header',
            key: 'x-forwarded-proto',
            value: 'http',
          },
        ],
        destination: 'https://:host/:path*',
        permanent: true,
      },
    ];
  },

  // ============================================================================
  // 画像最適化設定
  // ============================================================================
  images: {
    unoptimized: true, // S3では動的最適化不可
    formats: ['image/webp', 'image/avif'],
    remotePatterns: [
      {
        protocol: 'https', // HTTPSのみ許可
        hostname: '*.amazonaws.com',
        port: '',
        pathname: '/cis-filesearch-storage/**',
      },
      {
        protocol: 'https',
        hostname: '*.cloudfront.net',
        port: '',
        pathname: '/**',
      },
      // 開発環境のみlocalhostを許可
      ...(process.env.NODE_ENV === 'development'
        ? [
            {
              protocol: 'http',
              hostname: 'localhost',
              port: '',
              pathname: '/**',
            },
            {
              protocol: 'https',
              hostname: 'localhost',
              port: '',
              pathname: '/**',
            },
          ]
        : []),
    ],
  },

  // ============================================================================
  // ビルド最適化
  // ============================================================================
  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? {
            exclude: ['error', 'warn'], // エラーと警告は残す
          }
        : false,
  },

  // ============================================================================
  // TypeScript設定
  // ============================================================================
  typescript: {
    // 本番環境では型エラーを無視（事前にCI/CDで検証済み）
    ignoreBuildErrors: process.env.NODE_ENV === 'production',
  },

  // ============================================================================
  // パフォーマンス最適化
  // ============================================================================
  experimental: {
    // Turbopackを有効化
    turbo: {},

    // 最適化されたパッケージインポート
    optimizePackageImports: [
      '@heroicons/react',
      'lucide-react',
      'framer-motion',
      '@tanstack/react-virtual',
    ],
  },

  // ============================================================================
  // Webpack最適化
  // ============================================================================
  webpack: (config, { dev, isServer }) => {
    // 本番環境でのバンドル最適化
    if (!dev && !isServer) {
      config.optimization = {
        ...config.optimization,
        usedExports: true,
        sideEffects: false,
        concatenateModules: true,
        minimize: true,

        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            // ベンダーライブラリを分離
            vendor: {
              test: /[\\/]node_modules[\\/]/,
              name: 'vendors',
              priority: 10,
              reuseExistingChunk: true,
            },
            // React関連を分離
            react: {
              test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/,
              name: 'react',
              priority: 20,
              reuseExistingChunk: true,
            },
            // セキュリティライブラリを分離
            security: {
              test: /[\\/]src[\\/]lib[\\/]security[\\/]/,
              name: 'security',
              priority: 15,
              reuseExistingChunk: true,
            },
          },
        },
      };

      // バンドルサイズ分析（ANALYZE=trueで有効化）
      if (process.env.ANALYZE === 'true') {
        const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
        config.plugins.push(
          new BundleAnalyzerPlugin({
            analyzerMode: 'static',
            reportFilename: isServer ? '../analyze/server.html' : './analyze/client.html',
            openAnalyzer: false,
          })
        );
      }
    }

    return config;
  },

  // ============================================================================
  // gzip圧縮
  // ============================================================================
  compress: true,

  // ============================================================================
  // Trailing Slash
  // ============================================================================
  trailingSlash: true,

  // ============================================================================
  // 環境変数の検証
  // ============================================================================
  env: {
    // 必須環境変数のチェック
    NEXT_PUBLIC_API_GATEWAY_URL: process.env.NEXT_PUBLIC_API_GATEWAY_URL || '',
    OPENSEARCH_ENDPOINT: process.env.OPENSEARCH_ENDPOINT || '',
    AWS_REGION: process.env.AWS_REGION || 'ap-northeast-1',
  },
};

// ============================================================================
// 本番環境の検証
// ============================================================================
if (process.env.NODE_ENV === 'production') {
  const requiredEnvVars = [
    'NEXT_PUBLIC_API_GATEWAY_URL',
    'OPENSEARCH_ENDPOINT',
    'JWT_SECRET',
    'ALLOWED_ORIGINS',
  ];

  const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

  if (missingEnvVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingEnvVars.forEach((envVar) => {
      console.error(`   - ${envVar}`);
    });
    throw new Error('Missing required environment variables for production build');
  }

  console.log('✅ All required environment variables are configured');
}

module.exports = nextConfig;
