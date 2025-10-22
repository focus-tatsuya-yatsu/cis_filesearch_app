/** @type {import('next').NextConfig} */
const nextConfig = {
  // ✅ Static Export有効化
  output: 'export',

  // ✅ 厳格モード
  reactStrictMode: true,

  // ✅ 画像最適化設定（Static Export対応）
  images: {
    unoptimized: true, // S3では動的最適化不可
    domains: ['localhost'],
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

  // ✅ 本番環境ではESLintチェックを有効化推奨
  eslint: {
    ignoreDuringBuilds: process.env.SKIP_ESLINT === 'true',
  },

  // ✅ Turbopack設定
  turbopack: {},
}

module.exports = nextConfig
