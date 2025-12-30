# Quick Test Reference

画像検索機能のテスト実行クイックリファレンス

## テスト実行コマンド一覧

### 基本的なテスト

```bash
# すべてのテストを実行
yarn test

# ウォッチモードで実行（開発中）
yarn test:watch

# カバレッジ付きで実行
yarn test:coverage

# CI環境用（並列実行制限）
yarn test:ci
```

### 画像検索関連のテスト

```bash
# 画像検索のすべてのテスト
yarn test:image-search

# 特定のテストファイル
yarn test src/lib/api/__tests__/imageSearch.test.ts
yarn test src/app/api/image-embedding/__tests__/route.integration.test.ts
yarn test src/__tests__/integration/image-search-e2e.test.ts
yarn test src/__tests__/error-handling/image-search-errors.test.ts
```

### テストカテゴリ別

```bash
# ユニットテストのみ
yarn test:unit

# 統合テストのみ
yarn test:integration

# E2Eテスト
yarn test:e2e

# すべてのテストを順次実行
yarn test:all

# カバレッジ付きですべて実行
yarn test:all:coverage
```

### パフォーマンステスト

```bash
# パフォーマンステスト（シェルスクリプト）
cd ../backend/scripts
./test-image-search-performance.sh

# 設定をカスタマイズ
API_BASE_URL=http://localhost:3000 \
CONCURRENT_USERS=20 \
ITERATIONS=200 \
./test-image-search-performance.sh
```

### E2Eシナリオテスト

```bash
# E2E統合テスト（シェルスクリプト）
cd ../backend/scripts
./test-image-search-e2e.sh

# カスタム画像で実行
TEST_IMAGE_PATH=./my-test.jpg \
CONFIDENCE_THRESHOLD=0.95 \
./test-image-search-e2e.sh
```

---

## テスト対象ファイルパス

### フロントエンド (frontend/)

```
src/
├── lib/api/__tests__/
│   └── imageSearch.test.ts              # APIクライアントテスト
├── app/api/image-embedding/__tests__/
│   └── route.integration.test.ts        # ベクトル化処理テスト
├── __tests__/
│   ├── integration/
│   │   └── image-search-e2e.test.ts     # E2E統合テスト
│   └── error-handling/
│       └── image-search-errors.test.ts  # エラーハンドリングテスト
```

### バックエンドスクリプト (backend/scripts/)

```
backend/scripts/
├── test-image-search-performance.sh     # パフォーマンステスト
└── test-image-search-e2e.sh            # E2E統合テスト
```

---

## テスト環境変数

### .env.test

```bash
# モックモード（AWS認証不要）
USE_MOCK_EMBEDDING=true

# APIエンドポイント
NEXT_PUBLIC_API_URL=http://localhost:3000

# OpenSearch設定
OPENSEARCH_ENDPOINT=http://localhost:9200

# テスト環境
NODE_ENV=test
```

---

## カバレッジ目標

| メトリクス | 目標 |
|----------|------|
| Line Coverage | 80% |
| Branch Coverage | 75% |
| Function Coverage | 85% |
| Statement Coverage | 80% |

---

## よく使うコマンド

### 開発中

```bash
# 特定のファイルをウォッチ
yarn test:watch src/lib/api/__tests__/imageSearch.test.ts

# カバレッジを確認しながら開発
yarn test:coverage --watch
```

### デバッグ

```bash
# テスト失敗時に詳細を表示
yarn test --verbose

# 特定のテストのみ実行
yarn test -t "正常な画像アップロードが成功すること"

# Node.jsデバッガーで実行
node --inspect-brk node_modules/.bin/jest --runInBand
```

### CI/CD

```bash
# GitHub Actions用
yarn test:ci

# すべてのテストとカバレッジ
yarn test:all:coverage
```

---

## トラブルシューティング

### テストが失敗する場合

```bash
# キャッシュをクリア
yarn test --clearCache

# node_modulesを再インストール
rm -rf node_modules
yarn install

# モックモードを確認
echo $USE_MOCK_EMBEDDING  # 'true' であるべき
```

### カバレッジレポートが表示されない

```bash
# カバレッジディレクトリを削除して再実行
rm -rf coverage
yarn test:coverage

# HTMLレポートを開く
open coverage/lcov-report/index.html
```

---

## 関連ドキュメント

- [統合テストガイド](./IMAGE_SEARCH_INTEGRATION_TEST_GUIDE.md)
- [テスト戦略](/docs/test-strategy.md)
- [パフォーマンステスト結果](./PERFORMANCE_TEST_RESULTS.md)

---

**最終更新**: 2024-12-18
