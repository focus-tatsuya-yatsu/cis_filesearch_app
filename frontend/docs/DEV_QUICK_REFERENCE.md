# 開発クイックリファレンス

## 🚀 一般的なコマンド

```bash
# 開発サーバー起動
yarn dev                    # 通常起動
yarn dev:clean              # クリーンな状態で再起動
yarn dev:stop               # すべてのプロセスを停止
yarn dev:status             # プロセス状態確認

# ビルド
yarn build                  # 本番ビルド
yarn build:production       # 画像最適化 + ビルド
yarn start                  # 本番サーバー起動

# コード品質
yarn lint                   # リント実行
yarn lint:fix               # リント自動修正
yarn format                 # コードフォーマット
yarn format:check           # フォーマット確認

# テスト
yarn test                   # すべてのユニットテスト
yarn test:watch             # ウォッチモード
yarn test:coverage          # カバレッジ付き
yarn test:e2e               # E2Eテスト
yarn test:all               # すべてのテスト
```

## 🛑 トラブルシューティング

### ポート競合エラー

```bash
# 症状: Error: listen EADDRINUSE: address already in use :::3000

# 解決策
yarn dev:stop
yarn dev:clean
```

### ロックファイルエラー

```bash
# 症状: Error: Failed to acquire lock

# 解決策
yarn dev:clean
```

### ビルドエラー

```bash
# 症状: Type errors during build

# 解決策
rm -rf .next
yarn build
```

## 📂 重要なファイル

```
frontend/
├── next.config.js              # Next.js設定（最新仕様）
├── package.json                # npm scripts定義
├── scripts/dev-manager.sh      # プロセス管理スクリプト
├── .next/dev/lock              # ロックファイル（問題時に削除）
└── docs/
    ├── DEV_QUICK_REFERENCE.md  # このファイル
    └── DEVELOPMENT_PROCESS_MANAGEMENT.md  # 詳細ガイド
```

## 🔧 設定変更ポイント（Next.js 16対応）

### next.config.js

```javascript
// ✅ 最新仕様
images: {
  remotePatterns: [
    { protocol: 'http', hostname: 'localhost', pathname: '/**' }
  ]
}

typescript: {
  ignoreBuildErrors: process.env.NODE_ENV === 'production'
}

// ❌ 非推奨（削除済み）
// images: { domains: ['localhost'] }
// eslint: { ignoreDuringBuilds: true }
```

## 🚨 緊急時の対応

### すべてのプロセスを強制停止

```bash
pkill -9 -f "next dev"
rm -f .next/dev/lock
yarn dev
```

### 完全クリーンアップ

```bash
./scripts/dev-manager.sh clean  # インタラクティブ
# または
rm -rf .next node_modules
yarn install
yarn dev
```

## 📚 詳細ドキュメント

- [開発プロセス管理ガイド](./DEVELOPMENT_PROCESS_MANAGEMENT.md) - 完全版
- [Next.js 16公式ドキュメント](https://nextjs.org/docs)
- [プロジェクト要件](../../docs/requirement.md)
