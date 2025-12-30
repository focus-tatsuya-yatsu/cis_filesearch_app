# Image Search Integration Test Guide

画像検索機能の包括的な統合テストガイド

## 目次

1. [テスト概要](#テスト概要)
2. [テスト環境のセットアップ](#テスト環境のセットアップ)
3. [テストスイートの構成](#テストスイートの構成)
4. [テスト実行方法](#テスト実行方法)
5. [カバレッジレポート](#カバレッジレポート)
6. [トラブルシューティング](#トラブルシューティング)

---

## テスト概要

### テスト目的

画像検索機能のエンドツーエンドフローを検証し、以下を保証する:

- **機能性**: 画像アップロード、ベクトル化、検索が正しく動作する
- **パフォーマンス**: レスポンスタイムが許容範囲内である
- **信頼性**: エラーハンドリングが適切に機能する
- **精度**: OpenSearch k-NN検索の結果が期待通りである

### テストカバレッジ

- **ユニットテスト**: 個別の関数とコンポーネント
- **統合テスト**: APIエンドポイントとサービス連携
- **E2Eテスト**: 完全なユーザーフロー
- **パフォーマンステスト**: レスポンスタイムと負荷

目標カバレッジ: **80%以上**

---

## テスト環境のセットアップ

### 前提条件

```bash
# Node.js v20以上
node --version

# Yarn パッケージマネージャー
yarn --version

# 必要に応じて ImageMagick (テスト画像生成用)
convert --version
```

### 環境変数の設定

`.env.test` ファイルを作成:

```bash
# モックモードを有効化（AWS認証情報不要）
USE_MOCK_EMBEDDING=true

# APIエンドポイント
NEXT_PUBLIC_API_URL=http://localhost:3000

# OpenSearch設定（モック環境）
OPENSEARCH_ENDPOINT=http://localhost:9200
OPENSEARCH_USERNAME=admin
OPENSEARCH_PASSWORD=admin

# テスト用設定
NODE_ENV=test
```

### 依存パッケージのインストール

```bash
cd frontend
yarn install
```

---

## テストスイートの構成

### 1. APIクライアントテスト

**ファイル**: `src/lib/api/__tests__/imageSearch.test.ts`

**テスト内容**:
- 画像アップロードAPI (`uploadImageForEmbedding`)
- 画像検索API (`searchByImageEmbedding`)
- バリデーション関数
- エラーハンドリング

**実行**:
```bash
yarn test src/lib/api/__tests__/imageSearch.test.ts
```

### 2. ベクトル化処理テスト

**ファイル**: `src/app/api/image-embedding/__tests__/route.integration.test.ts`

**テスト内容**:
- AWS Bedrock統合（モックモード）
- 1024次元ベクトル生成
- キャッシュ機能
- CORS対応
- パフォーマンス

**実行**:
```bash
yarn test src/app/api/image-embedding/__tests__/route.integration.test.ts
```

### 3. E2E統合テスト

**ファイル**: `src/__tests__/integration/image-search-e2e.test.ts`

**テスト内容**:
- 完全なフロー（アップロード → ベクトル化 → 検索）
- OpenSearch k-NN検索精度
- 複数画像の連続処理
- データ整合性

**実行**:
```bash
yarn test src/__tests__/integration/image-search-e2e.test.ts
```

### 4. エラーハンドリングテスト

**ファイル**: `src/__tests__/error-handling/image-search-errors.test.ts`

**テスト内容**:
- OpenSearch接続エラー
- Lambda関数タイムアウト
- 無効なベクトルデータ
- ネットワークエラー
- レート制限
- エッジケース

**実行**:
```bash
yarn test src/__tests__/error-handling/image-search-errors.test.ts
```

---

## テスト実行方法

### すべてのテストを実行

```bash
# 全テストスイート実行
yarn test

# カバレッジ付きで実行
yarn test:coverage
```

### 画像検索関連のテストのみ実行

```bash
# 画像検索テストのみ
yarn test:image-search

# または
yarn test --testPathPattern="image"
```

### 特定のテストファイルを実行

```bash
# 特定のテストファイル
yarn test src/lib/api/__tests__/imageSearch.test.ts

# ウォッチモードで実行（開発中）
yarn test:watch src/lib/api/__tests__/imageSearch.test.ts
```

### パフォーマンステスト

```bash
# シェルスクリプトで実行
cd ../backend/scripts
./test-image-search-performance.sh

# 環境変数で設定をカスタマイズ
API_BASE_URL=http://localhost:3000 \
CONCURRENT_USERS=20 \
ITERATIONS=200 \
./test-image-search-performance.sh
```

### E2Eシェルスクリプトテスト

```bash
# 基本的なE2Eテスト
cd ../backend/scripts
./test-image-search-e2e.sh

# テスト画像を指定
TEST_IMAGE_PATH=./my-test-image.jpg \
CONFIDENCE_THRESHOLD=0.95 \
./test-image-search-e2e.sh
```

---

## カバレッジレポート

### カバレッジの確認

```bash
# カバレッジレポート生成
yarn test:coverage

# HTMLレポートを開く
open coverage/lcov-report/index.html
```

### カバレッジ目標

| カテゴリ | 目標 | 現在 |
|---------|------|------|
| Line Coverage | 80% | - |
| Branch Coverage | 75% | - |
| Function Coverage | 85% | - |
| Statement Coverage | 80% | - |

### カバレッジレポートの読み方

- **緑色**: 十分にカバーされている (80%以上)
- **黄色**: 改善の余地がある (60-80%)
- **赤色**: カバレッジ不足 (60%未満)

---

## CI/CD統合

### GitHub Actions ワークフロー

`.github/workflows/image-search-tests.yml`:

```yaml
name: Image Search Tests

on:
  push:
    branches: [main, develop]
    paths:
      - 'frontend/src/**'
      - 'frontend/__tests__/**'
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'yarn'

      - name: Install dependencies
        run: |
          cd frontend
          yarn install --frozen-lockfile

      - name: Run image search tests
        run: |
          cd frontend
          yarn test:image-search --ci --coverage
        env:
          USE_MOCK_EMBEDDING: true
          NODE_ENV: test

      - name: Upload coverage reports
        uses: codecov/codecov-action@v3
        with:
          directory: ./frontend/coverage
          flags: image-search
```

---

## トラブルシューティング

### よくある問題

#### 1. テストがタイムアウトする

**原因**: モックレスポンスが遅い、または実際のAPIを呼び出している

**解決策**:
```bash
# 環境変数でモックモードを確認
echo $USE_MOCK_EMBEDDING  # 'true' であるべき

# Jestタイムアウトを増やす
yarn test --testTimeout=10000
```

#### 2. AWS認証エラー

**原因**: モックモードが無効になっている

**解決策**:
```bash
# .env.testファイルを確認
cat .env.test | grep USE_MOCK_EMBEDDING

# 環境変数を設定
export USE_MOCK_EMBEDDING=true
yarn test
```

#### 3. OpenSearch接続エラー

**原因**: モック設定が不適切

**解決策**:
```typescript
// テストファイル内でモックを確認
jest.mock('@/lib/opensearch', () => ({
  searchClient: {
    search: jest.fn(),
  },
}));
```

#### 4. ファイルアップロードエラー

**原因**: テスト画像が見つからない

**解決策**:
```bash
# テストデータディレクトリを作成
mkdir -p frontend/test-data/images

# サンプル画像を作成（ImageMagick使用）
convert -size 800x600 xc:blue \
  -pointsize 72 -fill white -gravity center \
  -annotate +0+0 "Test Image" \
  frontend/test-data/images/test.jpg
```

#### 5. カバレッジが低い

**原因**: テストケースが不足している

**解決策**:
```bash
# カバレッジレポートで未カバー箇所を確認
yarn test:coverage
open coverage/lcov-report/index.html

# 不足しているテストを追加
```

---

## ベストプラクティス

### テスト作成のガイドライン

1. **AAA パターン**を使用
   - Arrange (準備)
   - Act (実行)
   - Assert (検証)

2. **明確なテスト名**
   ```typescript
   it('正常な画像アップロードが成功すること', async () => {
     // テストコード
   });
   ```

3. **適切なモック使用**
   - 外部APIは必ずモック
   - ファイルシステム操作はモック推奨

4. **エッジケースのカバー**
   - 0バイトファイル
   - 最大サイズファイル
   - 不正なデータ

5. **パフォーマンス考慮**
   - テストは高速に（1テスト < 5秒）
   - 並列実行を活用

---

## 参考リソース

- [Jest公式ドキュメント](https://jestjs.io/)
- [React Testing Library](https://testing-library.com/react)
- [Playwright E2Eテスト](https://playwright.dev/)
- [プロジェクトテスト戦略](/docs/test-strategy.md)

---

## 更新履歴

| 日付 | バージョン | 変更内容 |
|------|-----------|---------|
| 2024-12-18 | 1.0.0 | 初版作成 |

---

**作成者**: Claude Code QA Engineer
**最終更新**: 2024-12-18
