# Testing Guide - CIS File Search Frontend

このドキュメントでは、CIS File Search アプリケーションのフロントエンドテストの実行方法と構成について説明します。

## 📋 目次

- [クイックスタート](#クイックスタート)
- [テスト構成](#テスト構成)
- [テストの種類](#テストの種類)
- [テスト実行コマンド](#テスト実行コマンド)
- [カバレッジレポート](#カバレッジレポート)
- [CI/CD統合](#cicd統合)
- [トラブルシューティング](#トラブルシューティング)

## 🚀 クイックスタート

### 前提条件

```bash
# Node.js 18.x または 20.x
node --version

# 依存関係のインストール
yarn install

# Playwright ブラウザのインストール (E2Eテスト用)
yarn playwright:install
```

### 全テスト実行

```bash
# すべてのテストを実行
yarn test

# カバレッジ付きで実行
yarn test:coverage

# ウォッチモード (開発時に便利)
yarn test:watch
```

## 🗂 テスト構成

### ディレクトリ構造

```
frontend/
├── src/
│   ├── utils/
│   │   ├── imageValidation.ts          # ユーティリティ関数
│   │   └── imageValidation.test.ts     # ユニットテスト
│   ├── components/
│   │   └── features/
│   │       ├── ImageUpload.tsx         # コンポーネント
│   │       └── ImageUpload.test.tsx    # コンポーネントテスト
│   ├── app/
│   │   └── api/
│   │       └── image-embedding/
│   │           ├── route.ts            # API Route
│   │           └── route.test.ts       # APIテスト
│   └── __tests__/
│       └── fixtures/
│           └── imageFixtures.ts        # テストデータ
├── e2e/
│   ├── image-search.spec.ts            # E2Eテスト
│   └── fixtures/
│       └── images/                     # テスト用画像
├── jest.config.js                       # Jest設定
├── jest.setup.js                        # Jestセットアップ
└── playwright.config.ts                 # Playwright設定
```

### テストフレームワーク

| フレームワーク | 用途 | バージョン |
|--------------|------|-----------|
| Jest | ユニット・インテグレーションテスト | ^30.2.0 |
| React Testing Library | コンポーネントテスト | ^16.3.0 |
| Playwright | E2Eテスト | ^1.48.0 |
| @testing-library/user-event | ユーザー操作シミュレーション | ^14.6.1 |
| jest-axe | アクセシビリティテスト | ^10.0.0 |

## 🧪 テストの種類

### 1. ユニットテスト (70%)

**目的:** 個々の関数やメソッドの動作を検証

**例: 画像バリデーションユーティリティ**
```typescript
// src/utils/imageValidation.test.ts
describe('isImageFile', () => {
  it('should return true for JPEG files', () => {
    const file = createMockFile('test.jpg', 1024, 'image/jpeg');
    expect(isImageFile(file)).toBe(true);
  });
});
```

**実行:**
```bash
yarn test:unit
```

**カバレッジ目標:** 85%+

### 2. コンポーネントテスト (20%)

**目的:** React コンポーネントのレンダリングと相互作用を検証

**例: 画像アップロードコンポーネント**
```typescript
// src/components/features/ImageUpload.test.tsx
describe('ImageUpload', () => {
  it('should handle file selection', async () => {
    render(<ImageUpload onUploadSuccess={mockCallback} />);

    const file = createMockFile('test.jpg', 1024, 'image/jpeg');
    const input = screen.getByTestId('file-input');

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId('preview-image')).toBeInTheDocument();
    });
  });
});
```

**実行:**
```bash
yarn test src/components/ --coverage
```

**カバレッジ目標:** 90%+

### 3. インテグレーションテスト (10%)

**目的:** API ルートとサービス層の統合を検証

**例: 画像埋め込み API**
```typescript
// src/app/api/image-embedding/route.test.ts
describe('POST /api/image-embedding', () => {
  it('should successfully process valid JPEG image', async () => {
    const file = createMockFile('test.jpg', 1024, 'image/jpeg');
    const request = createMockRequest(file);

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.embedding).toHaveLength(1024);
  });
});
```

**実行:**
```bash
yarn test:integration
```

**カバレッジ目標:** 80%+

### 4. E2Eテスト (CI/CDのみ)

**目的:** 完全なユーザージャーニーをブラウザで検証

**例: 画像検索フロー**
```typescript
// e2e/image-search.spec.ts
test('should upload image via file selection', async ({ page }) => {
  await page.goto('/');

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles('fixtures/images/test.jpg');

  await expect(page.getByTestId('preview-image')).toBeVisible();
  await expect(page.getByTestId('search-results')).toBeVisible({ timeout: 15000 });
});
```

**実行:**
```bash
# 全ブラウザでテスト
yarn test:e2e

# 特定ブラウザ
yarn test:e2e --project=chromium

# UIモード (開発時に便利)
yarn test:e2e:ui

# デバッグモード
yarn test:e2e:debug
```

## 📊 テスト実行コマンド

### 基本コマンド

```bash
# 全テスト実行
yarn test

# ウォッチモード
yarn test:watch

# カバレッジ付き
yarn test:coverage

# CI用 (並列実行制限)
yarn test:ci
```

### 特定のテスト実行

```bash
# 画像検索機能のみ
yarn test:image-search

# ユニットテストのみ
yarn test:unit

# インテグレーションテストのみ
yarn test:integration

# 特定ファイル
yarn test src/utils/imageValidation.test.ts

# パターンマッチ
yarn test --testPathPattern="image"
```

### E2Eテスト

```bash
# 全ブラウザ
yarn test:e2e

# 特定ブラウザ
yarn test:e2e --project=chromium
yarn test:e2e --project=firefox
yarn test:e2e --project=webkit

# UIモード (インタラクティブ)
yarn test:e2e:ui

# デバッグモード
yarn test:e2e:debug

# レポート表示
yarn test:e2e:report
```

### その他

```bash
# リント
yarn lint

# 型チェック
npx tsc --noEmit

# フォーマット
yarn format

# ビルド
yarn build
```

## 📈 カバレッジレポート

### カバレッジの確認

```bash
# カバレッジ付きテスト実行
yarn test:coverage

# HTMLレポートを開く
open coverage/lcov-report/index.html
```

### カバレッジ目標

| メトリクス | 目標 | 現在 |
|----------|------|------|
| Lines | 80%+ | - |
| Functions | 80%+ | - |
| Branches | 75%+ | - |
| Statements | 80%+ | - |

### カバレッジ閾値チェック

```bash
# 最低カバレッジ要件をチェック
yarn test --coverage --coverageThreshold='{"global":{"lines":80,"functions":80,"branches":75}}'
```

## 🔄 CI/CD統合

### GitHub Actions ワークフロー

`.github/workflows/frontend-tests.yml` で自動テストが実行されます。

**トリガー:**
- `main`, `develop` ブランチへのプッシュ
- `frontend/**` 配下の変更時
- プルリクエスト

**ジョブ:**
1. **ユニット & インテグレーションテスト**
   - Node.js 18.x, 20.x でマトリックステスト
   - リント、型チェック
   - カバレッジレポート生成
   - Codecov へアップロード

2. **E2Eテスト (Playwright)**
   - Chromium, Firefox, WebKit でマトリックステスト
   - テストレポートのアーティファクト保存

3. **画像検索専用テスト**
   - 画像検索関連テストのみ実行
   - 最低カバレッジ80%の確認

4. **パフォーマンステスト**
   - Lighthouse CI による計測

### ローカルでCI環境を再現

```bash
# CI環境と同じコマンドを実行
yarn lint
npx tsc --noEmit
yarn test:ci
yarn build
```

## 🐛 トラブルシューティング

### よくある問題と解決策

#### 1. テストがタイムアウトする

**症状:**
```
Timeout - Async callback was not invoked within the 5000 ms timeout
```

**解決策:**
```typescript
// テストのタイムアウトを延長
test('slow test', async () => {
  // ...
}, 10000); // 10秒

// または waitFor のタイムアウトを延長
await waitFor(() => {
  expect(element).toBeInTheDocument();
}, { timeout: 10000 });
```

#### 2. FileReader が動作しない

**症状:**
```
TypeError: FileReader is not defined
```

**解決策:**
```typescript
// テストファイルで MockFileReader を使用
import { MockFileReader } from '@/__tests__/fixtures/imageFixtures';
global.FileReader = MockFileReader as any;
```

#### 3. Playwright ブラウザが見つからない

**症状:**
```
Error: Executable doesn't exist
```

**解決策:**
```bash
yarn playwright:install
```

#### 4. Jest のキャッシュ問題

**症状:**
```
Tests pass locally but fail in CI
```

**解決策:**
```bash
# キャッシュをクリア
yarn test --clearCache

# 再実行
yarn test
```

#### 5. Next.js のモジュール解決エラー

**症状:**
```
Cannot find module '@/...'
```

**解決策:**
```javascript
// jest.config.js で moduleNameMapper を確認
moduleNameMapper: {
  '^@/(.*)$': '<rootDir>/src/$1',
}
```

### デバッグ方法

#### Jest テストのデバッグ

```bash
# VSCode のデバッガーを使用
# または
node --inspect-brk node_modules/.bin/jest --runInBand src/path/to/test.ts
```

#### Playwright テストのデバッグ

```bash
# デバッグモード
yarn test:e2e:debug

# ブラウザを表示して実行
yarn test:e2e --headed

# 特定のテストのみ
yarn test:e2e --grep "upload image"
```

## 📚 参考リソース

### 公式ドキュメント
- [Jest](https://jestjs.io/)
- [React Testing Library](https://testing-library.com/react)
- [Playwright](https://playwright.dev/)
- [Testing Library User Events](https://testing-library.com/docs/user-event/intro)

### テストベストプラクティス
- [Kent C. Dodds - Testing Implementation Details](https://kentcdodds.com/blog/testing-implementation-details)
- [Common mistakes with React Testing Library](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)

### プロジェクト固有ドキュメント
- [画像検索テスト戦略](../docs/testing/IMAGE_SEARCH_TEST_STRATEGY.md)
- [コーディング規約](../docs/coding-standards.md)
- [アーキテクチャ](../docs/architecture.md)

## 🎯 テストチェックリスト

新しい機能を追加する際は、以下を確認してください:

- [ ] ユニットテストを作成 (カバレッジ 85%+)
- [ ] コンポーネントテストを作成 (必要に応じて)
- [ ] インテグレーションテストを作成 (API がある場合)
- [ ] エッジケースをカバー (エラー、境界値)
- [ ] アクセシビリティをテスト
- [ ] 全テストがパス (`yarn test`)
- [ ] リントエラーなし (`yarn lint`)
- [ ] 型エラーなし (`npx tsc --noEmit`)
- [ ] カバレッジ目標を達成

## 📞 サポート

テストに関する質問や問題がある場合:

1. このドキュメントの「トラブルシューティング」セクションを確認
2. プロジェクトの Issue を検索
3. チームメンバーに相談
4. 新しい Issue を作成

---

**最終更新:** 2025-12-17
**メンテナー:** QA Team
