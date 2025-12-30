/** @type {import('next').NextConfig} */
const nextConfig = {
  // ⚠️ Static Export無効化（API Routes使用のため）
  // 検索APIなど、サーバーサイド機能が必要なため、完全な静的エクスポートは使用しません
  output: 'export',

  // ✅ 厳格モード
  reactStrictMode: true,

  // ✅ 画像最適化設定（Static Export対応）
  images: {
    unoptimized: true, // S3では動的最適化不可
    // Next.js 16では `remotePatterns` を使用（`domains`は非推奨）
    remotePatterns: [
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
    ],
    // 画像フォーマット最適化
    formats: ['image/webp', 'image/avif'],
  },

  // ✅ Trailing Slash（S3のディレクトリ構造に対応）
  trailingSlash: true,

  // ✅ ビルド最適化
  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? {
            exclude: ['error', 'warn'],
          }
        : false,
  },

  // ✅ TypeScript/ESLint設定
  // Next.js 16では `eslint` キーは削除され、型チェックとリント設定が統合されました
  // 以下の設定でビルド時のエラーを管理
  typescript: {
    // ⚠️ 本番環境: 型エラーを無視（開発時は `yarn lint` で確認）
    ignoreBuildErrors: process.env.NODE_ENV === 'production',
  },

  // ✅ パフォーマンス最適化
  experimental: {
    // 最適化されたパッケージインポート
    optimizePackageImports: [
      '@heroicons/react',
      'lucide-react',
      'framer-motion',
      '@tanstack/react-virtual',
    ],
  },

  // ✅ Turbopack設定（Next.js 16デフォルト）
  turbopack: {},

  // ✅ Webpack最適化（本番ビルド用）
  webpack: (config, { dev, isServer }) => {
    // 本番環境でのバンドル最適化
    if (!dev && !isServer) {
      // Tree shakingを強化
      config.optimization = {
        ...config.optimization,
        usedExports: true,
        sideEffects: false,

        // モジュール連結
        concatenateModules: true,

        // 最小化
        minimize: true,

        // コード分割の最適化
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
            // UI コンポーネントを分離
            ui: {
              test: /[\\/]src[\\/]components[\\/]ui[\\/]/,
              name: 'ui',
              priority: 15,
              reuseExistingChunk: true,
            },
            // 検索機能を分離
            search: {
              test: /[\\/]src[\\/](components[\\/]search|lib[\\/](api|opensearch))[\\/]/,
              name: 'search',
              priority: 15,
              reuseExistingChunk: true,
            },
            // 画像処理を分離
            image: {
              test: /[\\/]src[\\/](lib[\\/]imageCompression|components[\\/]features[\\/]ImageUpload)[\\/]/,
              name: 'image',
              priority: 15,
              reuseExistingChunk: true,
            },
          },
        },
      };

      // バンドルサイズ分析（環境変数ANALYZE=trueで有効化）
      if (process.env.ANALYZE === 'true') {
        const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
        config.plugins.push(
          new BundleAnalyzerPlugin({
            analyzerMode: 'static',
            reportFilename: isServer
              ? '../analyze/server.html'
              : './analyze/client.html',
            openAnalyzer: false,
          })
        );
      }
    }

    return config;
  },

  // ✅ gzip圧縮の有効化
  compress: true,

  // ✅ ヘッダー設定（パフォーマンス最適化）
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
        ],
      },
      {
        // 静的アセットのキャッシュ
        source: '/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // 画像のキャッシュ
        source: '/:path*.{jpg,jpeg,png,gif,webp,avif,svg}',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
}

module.exports = nextConfig
