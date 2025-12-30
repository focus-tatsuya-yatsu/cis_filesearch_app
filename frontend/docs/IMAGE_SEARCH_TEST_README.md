# 画像検索機能 - テスト実行ガイド

## 概要

画像検索機能のエラー解決のために作成されたテストスイートの実行方法と検証手順です。

---

## 実装済みのテスト

### 1. 単体テスト

#### `/src/lib/api/__tests__/search.test.ts`
- **対象**: `searchFiles`関数の画像検索POSTロジック
- **テスト数**: 20+
- **カバレッジ目標**: 85%+

**主なテストケース**:
- ✅ POST メソッドの使用確認
- ✅ ベクトルデータのリクエストボディ含有確認
- ✅ パラメータの正確なマッピング
- ✅ エラーハンドリング
- ✅ エッジケース（大きなベクトル、負の値、空配列）

#### `/src/app/api/search/__tests__/route.test.ts`
- **対象**: `/api/search` POSTハンドラ
- **テスト数**: 15+
- **カバレッジ目標**: 80%+

**主なテストケース**:
- ✅ Lambda APIへのベクトルデータ転送
- ✅ データ整合性の保持
- ✅ バリデーション
- ✅ エラーハンドリング
- ✅ コンソールログ出力

### 2. E2Eテスト

#### `/e2e/image-search.spec.ts` (既存)
- **対象**: 画像アップロード → 検索結果表示の完全フロー
- **テスト数**: 30+
- **カバレッジ**: 主要ユーザーパス100%

**主なテストケース**:
- ✅ 画像アップロード（JPEG, PNG）
- ✅ ドラッグ&ドロップ
- ✅ ファイルバリデーション
- ✅ 検索結果表示
- ✅ 信頼度フィルタリング（90%以上）
- ✅ エラーハンドリング
- ✅ パフォーマンス
- ✅ クロスブラウザ対応
- ✅ アクセシビリティ

### 3. デバッグツール

#### `/src/lib/api/debug-logger.ts`
- **機能**: 開発環境専用の詳細ログ出力
- **統合箇所**:
  - `/src/lib/api/search.ts`
  - `/src/components/search/SearchInterface.tsx`

**ログ機能**:
- 🔵 リクエスト/レスポンスのログ
- 🔢 ベクトルデータの統計情報
- ❌ エラーの詳細情報
- ⏱️ パフォーマンス計測
- 📊 テーブル形式のデータ表示

---

## テスト実行方法

### 前提条件

```bash
# 依存関係のインストール
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
yarn install

# Playwrightのインストール（初回のみ）
yarn playwright:install
```

### 1. 単体テストの実行

```bash
# 全単体テストを実行
yarn test:unit

# 画像検索関連のテストのみ実行
yarn test:image-search

# 特定のテストファイルを実行
yarn test src/lib/api/__tests__/search.test.ts

# カバレッジレポート付き実行
yarn test:coverage

# ウォッチモード（開発中に便利）
yarn test:watch
```

### 2. 統合テストの実行

```bash
# API統合テスト
yarn test:integration

# 特定のAPIルートテスト
yarn test src/app/api/search/__tests__/route.test.ts
```

### 3. E2Eテストの実行

```bash
# 全E2Eテストを実行
yarn test:e2e

# UIモード（デバッグに便利）
yarn test:e2e:ui

# デバッグモード（ステップバイステップ実行）
yarn test:e2e:debug

# 特定のテストファイルのみ
yarn test:e2e e2e/image-search.spec.ts

# レポート表示
yarn test:e2e:report
```

---

## テスト結果の確認

### 単体テスト・統合テスト

実行後、以下のような出力が表示されます：

```
PASS  src/lib/api/__tests__/search.test.ts
  searchFiles - Image Search POST Logic
    POST Method for Image Search
      ✓ should use POST method when imageEmbedding is provided (25ms)
      ✓ should NOT use POST method when imageEmbedding is empty (10ms)
      ✓ should NOT use POST method when imageEmbedding is undefined (8ms)
    Request Body with Image Embedding
      ✓ should include full embedding array in request body (12ms)
      ✓ should include searchType as "image" in request body (9ms)
      ...

Test Suites: 2 passed, 2 total
Tests:       35 passed, 35 total
Snapshots:   0 total
Time:        3.456 s
```

### カバレッジレポート

```bash
yarn test:coverage
```

実行後、`coverage/lcov-report/index.html` をブラウザで開くと、視覚的なカバレッジレポートが表示されます。

**カバレッジ目標**:
- `search.ts`: 85%+
- `route.ts`: 80%+
- 全体: 80%+

### E2Eテスト結果

```
Running 30 tests using 3 workers

  ✓ [chromium] › image-search.spec.ts:75:5 › should upload JPEG image (2.3s)
  ✓ [chromium] › image-search.spec.ts:99:5 › should upload PNG image (1.8s)
  ✓ [chromium] › image-search.spec.ts:161:5 › should display search results (3.5s)
  ...

  30 passed (45.2s)
```

---

## デバッグログの確認

開発環境（`NODE_ENV=development`）でアプリケーションを実行すると、コンソールに詳細なデバッグログが出力されます。

### デバッグログの読み方

#### 1. 画像検索フローの開始

```
[IMAGE SEARCH DEBUG] 🚀 Starting Flow: Image Search Flow
  ⏰ Start Time: 2025-01-17T12:00:00.000Z
```

#### 2. ベクトルデータの詳細

```
[IMAGE SEARCH DEBUG] 🔢 Received in handleImageSearch
  📐 Dimensions: 1024
  🔝 First 10 values: [0.123, 0.456, -0.789, ...]
  🔚 Last 10 values: [..., 0.321, 0.654, 0.987]
  📊 Statistics: {
    min: -0.891234,
    max: 0.987654,
    average: 0.045123,
    range: 1.878888
  }
```

#### 3. リクエスト情報

```
[IMAGE SEARCH DEBUG] 🔵 Request to /api/search
  📤 Method: POST
  📋 Data: {
    imageEmbedding: [Vector: 1024 dimensions],
    searchType: "image",
    searchMode: "or",
    page: 1,
    size: 20
  }
  ⏰ Timestamp: 2025-01-17T12:00:01.000Z
```

#### 4. レスポンス情報

```
[IMAGE SEARCH DEBUG] ✅ Response from /api/search
  📥 Status: 200
  📊 Data: {
    success: true,
    data: {
      results: [...],
      pagination: { total: 15, ... }
    }
  }
```

#### 5. パフォーマンス計測

```
[IMAGE SEARCH DEBUG] ⏱️ Performance: Image Search Request started
[IMAGE SEARCH DEBUG] ⏱️ Performance: Image Search Request completed in 1234.56ms
```

#### 6. 信頼度スコアのテーブル表示

```
[IMAGE SEARCH DEBUG] 📊 Table: Confidence Score Breakdown
┌─────────┬─────────────────────┬───────┬──────────┐
│ (index) │ fileName            │ score │ included │
├─────────┼─────────────────────┼───────┼──────────┤
│    0    │ 'document-001.pdf'  │ 0.95  │  'Yes'   │
│    1    │ 'image-002.jpg'     │ 0.92  │  'Yes'   │
│    2    │ 'report-003.docx'   │ 0.88  │  'No'    │
└─────────┴─────────────────────┴───────┴──────────┘
```

---

## トラブルシューティング

### テストが失敗する場合

#### 1. 依存関係の問題

```bash
# node_modulesを削除して再インストール
rm -rf node_modules
yarn install
```

#### 2. Jestキャッシュのクリア

```bash
yarn test --clearCache
```

#### 3. 環境変数の確認

`.env.local` ファイルが正しく設定されているか確認：

```bash
# 必要な環境変数
NEXT_PUBLIC_API_GATEWAY_URL=https://your-api-gateway-url.com/search
```

### E2Eテストが失敗する場合

#### 1. Playwrightの再インストール

```bash
yarn playwright:install --with-deps
```

#### 2. ヘッドレスモードの無効化（デバッグ用）

```bash
yarn test:e2e --headed
```

#### 3. スローモーション実行

```bash
yarn test:e2e --slow-mo=500
```

### デバッグログが表示されない場合

#### 環境変数の確認

```bash
# 開発環境で実行していることを確認
echo $NODE_ENV  # "development" であること

# または
yarn dev  # 開発サーバーで実行
```

---

## 期待される結果

すべてのテストが成功すると、以下が保証されます：

### ✅ 単体テスト
- `searchFiles`関数が画像検索時に**POSTメソッド**を使用
- ベクトルデータが完全にJSON bodyに含まれる
- エラーハンドリングが適切に動作

### ✅ 統合テスト
- `/api/search` が POST リクエストを正しく受け取る
- Lambda APIにベクトルデータが正確に転送される
- データの整合性が保たれる

### ✅ E2E
- 画像アップロードから検索結果表示まで正常動作
- 信頼度90%以上の結果のみ表示される
- エラー時に適切なメッセージが表示される

### ✅ デバッグログ
- 各レイヤーでベクトルデータが確認できる
- パフォーマンスボトルネックが特定できる
- エラー発生時の詳細情報が取得できる

---

## 次のステップ

テストが全てパスした後：

1. **本番環境での動作確認**
   - デバッグログは自動的に無効化される
   - パフォーマンスへの影響はゼロ

2. **継続的な改善**
   - カバレッジを90%以上に引き上げる
   - 追加のエッジケーステストを追加
   - パフォーマンステストの拡充

3. **ドキュメント更新**
   - 新しい機能追加時にテストも追加
   - テスト戦略の見直し

---

## 参考資料

- [テスト戦略ドキュメント](/docs/IMAGE_SEARCH_TEST_STRATEGY.md)
- [Jest公式ドキュメント](https://jestjs.io/)
- [Playwright公式ドキュメント](https://playwright.dev/)
- [React Testing Library](https://testing-library.com/react)

---

## サポート

問題が発生した場合は、以下を確認してください：

1. デバッグログの内容
2. テスト失敗時のエラーメッセージ
3. ブラウザのコンソールログ
4. ネットワークタブのリクエスト/レスポンス

それでも解決しない場合は、以下の情報を添えて報告してください：

- テスト実行結果の全ログ
- デバッグログのスクリーンショット
- 環境情報（Node.js バージョン、OS など）
