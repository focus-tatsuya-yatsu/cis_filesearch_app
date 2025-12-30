# CIS File Search - Frontend

Next.js 16ベースのモダンなフロントエンドアプリケーション。

## 🚀 クイックスタート

```bash
# 依存関係のインストール
yarn install

# 開発サーバー起動
yarn dev

# ブラウザで開く
# → http://localhost:3000
```

## 📋 主要コマンド

```bash
# 開発
yarn dev                # 開発サーバー起動
yarn dev:clean          # クリーンな状態で再起動
yarn dev:stop           # プロセス停止
yarn dev:status         # プロセス状態確認

# ビルド
yarn build              # 本番ビルド
yarn start              # 本番サーバー起動

# コード品質
yarn lint               # リント実行
yarn format             # コードフォーマット
yarn test               # テスト実行
```

## 🛠️ 技術スタック

- **Framework**: Next.js 16
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **State Management**: Zustand
- **UI Components**:
  - Framer Motion（アニメーション）
  - Lucide React（アイコン）
  - Sonner（トースト通知）
- **Testing**: Jest + Playwright

## 📂 プロジェクト構造

```
frontend/
├── src/
│   ├── app/              # Next.js App Router
│   │   ├── api/          # APIルート
│   │   └── page.tsx      # ページコンポーネント
│   ├── components/       # Reactコンポーネント
│   │   ├── ui/           # 基本UIコンポーネント
│   │   ├── search/       # 検索機能コンポーネント
│   │   └── features/     # 機能別コンポーネント
│   ├── hooks/            # カスタムフック
│   ├── lib/              # ユーティリティとAPI
│   ├── stores/           # Zustand状態管理
│   ├── types/            # TypeScript型定義
│   └── styles/           # グローバルスタイル
├── scripts/              # 開発・デプロイスクリプト
├── docs/                 # ドキュメント
├── e2e/                  # E2Eテスト
└── public/               # 静的ファイル
```

## 🔧 環境変数

```bash
# .env.local を作成
cp .env.example .env.local

# 必要な環境変数
NEXT_PUBLIC_OPENSEARCH_ENDPOINT=<OpenSearch endpoint>
NEXT_PUBLIC_AWS_REGION=<AWS region>
AWS_ACCESS_KEY_ID=<access key>
AWS_SECRET_ACCESS_KEY=<secret key>
```

## 🚨 トラブルシューティング

### ポート競合エラー

```bash
# 解決策
yarn dev:stop
yarn dev:clean
```

### ビルドエラー

```bash
# 解決策
rm -rf .next
yarn build
```

詳細: [開発クイックリファレンス](./docs/DEV_QUICK_REFERENCE.md)

## 📚 ドキュメント

- [開発クイックリファレンス](./docs/DEV_QUICK_REFERENCE.md)
- [開発プロセス管理ガイド](./docs/DEVELOPMENT_PROCESS_MANAGEMENT.md)
- [プロジェクト要件](../docs/requirement.md)
- [アーキテクチャ](../docs/architecture.md)

## 🧪 テスト

```bash
# ユニットテスト
yarn test                   # すべてのテスト
yarn test:watch             # ウォッチモード
yarn test:coverage          # カバレッジ付き

# E2Eテスト
yarn test:e2e               # E2Eテスト実行
yarn test:e2e:ui            # UIモード
yarn test:e2e:debug         # デバッグモード

# すべてのテスト
yarn test:all               # ユニット + インテグレーション + E2E
```

## 🎨 コーディング規約

- **ES modules必須** (import/export)
- **アロー関数でReactコンポーネント定義**
- **分割代入を使用** (props, hooks, imports)
- **名前付きエクスポート優先**
- **TypeScript型安全性を最大限活用**

詳細: [コーディング規約](../docs/coding-standards.md)

## 🚀 デプロイ

```bash
# ビルド
yarn build:production

# 本番サーバー起動
yarn start
```

詳細: [デプロイガイド](../docs/deployment-guide.md)

## 📄 ライセンス

ISC

---

**Next.js バージョン**: 16.0.10
**Node.js バージョン**: 22.20.0
**最終更新**: 2025-12-18
