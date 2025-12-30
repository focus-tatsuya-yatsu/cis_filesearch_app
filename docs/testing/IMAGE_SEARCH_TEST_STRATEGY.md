# 画像検索機能 テスト戦略

## 概要

CIS File Search アプリケーションの画像検索機能に対する包括的なテスト戦略です。このドキュメントでは、ユニットテスト、インテグレーションテスト、E2Eテストの実装方針と、カバレッジ目標を定義します。

## テスト戦略の原則

### 1. テストピラミッド

```
        E2E Tests (10%)
       ┌───────────────┐
      │ User Journeys │
     │   Cross-browser │
    └───────────────────┘

    Integration Tests (20%)
   ┌───────────────────────┐
  │  API Routes           │
 │   Component Integration│
└─────────────────────────┘

      Unit Tests (70%)
 ┌───────────────────────────┐
│ Utils │ Validation │ Helpers│
│  Pure Functions            │
└───────────────────────────┘
```

### 2. カバレッジ目標

| テストレベル | 目標カバレッジ | 優先度 |
|------------|--------------|--------|
| ユニットテスト | 85%+ | 高 |
| インテグレーションテスト | 80%+ | 高 |
| E2Eテスト | クリティカルパスのみ | 中 |
| **全体** | **80%+** | **必須** |

### 3. TDD アプローチ

1. **Red**: 失敗するテストを先に書く
2. **Green**: テストを通過する最小限のコードを実装
3. **Refactor**: コードをリファクタリング（テストは維持）

## テスト構成

### ディレクトリ構造

```
frontend/
├── src/
│   ├── utils/
│   │   ├── imageValidation.ts
│   │   └── imageValidation.test.ts
│   ├── components/
│   │   └── features/
│   │       ├── ImageUpload.tsx
│   │       └── ImageUpload.test.tsx
│   ├── app/
│   │   └── api/
│   │       └── image-embedding/
│   │           ├── route.ts
│   │           └── route.test.ts
│   └── __tests__/
│       └── fixtures/
│           └── imageFixtures.ts
├── e2e/
│   ├── image-search.spec.ts
│   └── fixtures/
│       └── images/
└── playwright.config.ts
```

## 1. ユニットテスト (70%)

### 対象ファイル

#### `imageValidation.ts`

**テスト項目:**
- ✅ ファイルタイプバリデーション
  - JPEG, PNG, JPG のサポート確認
  - GIF, WebP, PDF などの拒否確認
- ✅ ファイルサイズバリデーション
  - 最大5MBの制限確認
  - 空ファイルの拒否確認
- ✅ ベクトル次元数バリデーション
  - 1024次元の確認
  - 不正な次元数の拒否
- ✅ ベクトル値バリデーション
  - NaN, Infinity の検出
  - 非数値の検出
- ✅ 信頼度スコアフィルタリング
  - 90%以上のフィルタリング
  - 結果の正確性確認

**カバレッジ目標:** 100% (ユーティリティ関数は完全にテスト)

**実行コマンド:**
```bash
yarn test src/utils/imageValidation.test.ts --coverage
```

**テストファイル:** `/Users/tatsuya/focus_project/cis_filesearch_app/frontend/src/utils/imageValidation.test.ts`

## 2. コンポーネントテスト (React Testing Library)

### 対象コンポーネント

#### `ImageUpload.tsx`

**テスト項目:**
- ✅ レンダリング
  - 初期状態の表示確認
  - アップロードエリアの表示
  - 説明文の表示
- ✅ ファイル選択 (クリック)
  - ファイルダイアログの起動
  - プレビューの表示
  - アップロード処理の実行
- ✅ ドラッグ&ドロップ
  - ドラッグオーバー状態の表示
  - ドロップ処理
  - プレビューの表示
- ✅ バリデーションエラー
  - 無効なファイルタイプ
  - ファイルサイズ超過
  - 空ファイル
- ✅ アップロードエラー
  - ネットワークエラー
  - APIエラーレスポンス
- ✅ クリア機能
  - プレビューの削除
  - 入力値のリセット
- ✅ 無効化状態
  - disabled プロパティ
  - アップロード中の無効化
- ✅ アクセシビリティ
  - キーボード操作
  - ARIA属性

**カバレッジ目標:** 90%+

**実行コマンド:**
```bash
yarn test src/components/features/ImageUpload.test.tsx --coverage
```

**テストファイル:** `/Users/tatsuya/focus_project/cis_filesearch_app/frontend/src/components/features/ImageUpload.test.tsx`

## 3. インテグレーションテスト (20%)

### 対象 API ルート

#### `/api/image-embedding`

**テスト項目:**
- ✅ 成功ケース
  - JPEGアップロード成功
  - PNGアップロード成功
  - ベクトル生成の確認
  - レスポンス形式の確認
- ✅ バリデーションエラー
  - ファイルなし
  - 無効なファイルタイプ
  - ファイルサイズ超過
- ✅ Bedrockエラー
  - サービスエラー
  - タイムアウト
  - レート制限
- ✅ CORS対応
  - OPTIONSリクエスト
  - ヘッダーの確認

**カバレッジ目標:** 85%+

**実行コマンド:**
```bash
yarn test src/app/api/image-embedding/route.test.ts --coverage
```

**テストファイル:** `/Users/tatsuya/focus_project/cis_filesearch_app/frontend/src/app/api/image-embedding/route.test.ts`

## 4. E2Eテスト (10%)

### Playwright テストシナリオ

#### 画像アップロード via ファイル選択

**テストケース:**
1. JPEGファイルのアップロード
2. PNGファイルのアップロード
3. 無効なファイルタイプのエラー表示
4. ファイルサイズ超過のエラー表示

#### 画像アップロード via ドラッグ&ドロップ

**テストケース:**
1. ドラッグオーバー状態の表示
2. ドロップによるアップロード
3. プレビューの表示

#### 検索結果表示

**テストケース:**
1. アップロード後の検索結果表示
2. 信頼度90%以上のフィルタリング確認
3. 結果なしメッセージの表示

#### テキスト + 画像の複合検索

**テストケース:**
1. テキストクエリと画像の組み合わせ
2. AND/OR モードの切り替え

#### エラーハンドリング

**テストケース:**
1. ネットワークエラー
2. APIエラーレスポンス
3. リトライ処理

#### パフォーマンス

**テストケース:**
1. アップロード完了時間 (15秒以内)
2. 同時アップロード

#### クロスブラウザ

**テストケース:**
1. Chromium での動作確認
2. Firefox での動作確認
3. WebKit での動作確認

**実行コマンド:**
```bash
# 全ブラウザでテスト
yarn test:e2e

# 特定ブラウザでテスト
yarn test:e2e --project=chromium

# UIモード
yarn test:e2e:ui

# デバッグモード
yarn test:e2e:debug
```

**テストファイル:** `/Users/tatsuya/focus_project/cis_filesearch_app/frontend/e2e/image-search.spec.ts`

## テストデータとフィクスチャ

### Mock File オブジェクト

**フィクスチャファイル:** `/Users/tatsuya/focus_project/cis_filesearch_app/frontend/src/__tests__/fixtures/imageFixtures.ts`

**提供されるデータ:**
- ✅ 有効な画像ファイル (JPEG, PNG, JPG)
- ✅ 無効なファイル (PDF, GIF, WebP, 空ファイル、サイズ超過)
- ✅ 特殊なファイル名 (日本語、スペース、括弧)
- ✅ モックベクトルデータ (1024次元)
- ✅ モック検索結果
- ✅ モックAPIレスポンス
- ✅ Base64エンコード画像データ

## CI/CD パイプライン

### GitHub Actions ワークフロー

**ファイル:** `/Users/tatsuya/focus_project/cis_filesearch_app/.github/workflows/frontend-tests.yml`

**ジョブ構成:**

#### 1. ユニット & インテグレーションテスト
- Node.js 18.x, 20.x でのマトリックステスト
- リント、型チェック
- カバレッジレポート生成
- Codecov へのアップロード
- PRへのカバレッジコメント

#### 2. E2Eテスト (Playwright)
- Chromium, Firefox, WebKit でのマトリックステスト
- テストレポートのアーティファクト保存
- スクリーンショット、ビデオの保存

#### 3. 画像検索専用テスト
- 画像検索関連テストのみ実行
- 最低カバレッジ80%の確認
- 詳細なカバレッジレポート

#### 4. パフォーマンステスト
- Lighthouse CI による計測

#### 5. テストサマリー
- 全ジョブの結果集約
- 失敗時のCI失敗

**トリガー:**
- `main`, `develop` ブランチへのプッシュ
- `frontend/**` 配下の変更時
- プルリクエスト

## テスト実行コマンド一覧

### ローカル開発

```bash
# 全テスト実行
yarn test

# ウォッチモード
yarn test:watch

# カバレッジ付き実行
yarn test:coverage

# 画像検索機能のみ
yarn test:image-search

# ユニットテストのみ
yarn test:unit

# インテグレーションテストのみ
yarn test:integration

# E2Eテスト
yarn test:e2e

# E2E UIモード
yarn test:e2e:ui

# E2E デバッグモード
yarn test:e2e:debug

# E2E レポート表示
yarn test:e2e:report
```

### CI環境

```bash
# CI用テスト (並列実行制限、カバレッジ付き)
yarn test:ci

# Playwrightブラウザインストール
yarn playwright:install
```

## カバレッジレポート

### 閲覧方法

```bash
# テスト実行後
yarn test:coverage

# HTMLレポートを開く
open coverage/lcov-report/index.html
```

### カバレッジ目標の確認

```bash
# 最低カバレッジ要件をチェック
yarn test --coverage --coverageThreshold='{"global":{"lines":80,"functions":80,"branches":75}}'
```

## ベストプラクティス

### 1. テスト作成時

- ✅ **AAA パターン**: Arrange (準備) → Act (実行) → Assert (検証)
- ✅ **明確なテスト名**: `should [expected behavior] when [condition]`
- ✅ **1テスト1検証**: 各テストは1つの側面のみをテスト
- ✅ **独立性**: テストは他のテストに依存しない
- ✅ **再現性**: 何度実行しても同じ結果

### 2. モック使用時

- ✅ **最小限のモック**: 必要最小限のみモック化
- ✅ **実装詳細を避ける**: 公開APIのみテスト
- ✅ **モックのリセット**: 各テスト後にクリーンアップ

### 3. 非同期処理

- ✅ **waitFor 使用**: 非同期処理の完了を待機
- ✅ **適切なタイムアウト**: 必要に応じてタイムアウトを設定
- ✅ **Promise ハンドリング**: async/await を適切に使用

### 4. アクセシビリティ

- ✅ **data-testid 使用**: 安定したセレクター
- ✅ **role ベースクエリ**: アクセシビリティを考慮
- ✅ **キーボード操作**: キーボードナビゲーションをテスト

## トラブルシューティング

### よくある問題

#### 1. FileReader が動作しない

**原因:** Jest環境でのFileReaderのモック不足

**解決策:**
```typescript
// テストファイルで MockFileReader を使用
import { MockFileReader } from '@/__tests__/fixtures/imageFixtures';
global.FileReader = MockFileReader as any;
```

#### 2. Playwright ブラウザが見つからない

**原因:** ブラウザがインストールされていない

**解決策:**
```bash
yarn playwright:install
```

#### 3. E2Eテストがタイムアウト

**原因:** 開発サーバーが起動していない、またはレスポンスが遅い

**解決策:**
- `webServer` 設定を確認
- タイムアウトを延長
- ネットワーク環境を確認

#### 4. カバレッジが目標に達しない

**原因:** テストされていないコードパスがある

**解決策:**
```bash
# カバレッジレポートで未テスト箇所を特定
yarn test:coverage
open coverage/lcov-report/index.html
```

## メンテナンス

### 定期的な実施事項

- ✅ **月次**: カバレッジレポートのレビュー
- ✅ **月次**: Flaky テストの特定と修正
- ✅ **四半期**: テスト戦略の見直し
- ✅ **リリース前**: 全テストスイートの実行

### 依存関係の更新

```bash
# テスト関連パッケージの更新
yarn upgrade-interactive --latest

# 更新後は全テスト実行
yarn test:ci
yarn test:e2e
```

## 参考リソース

- [Jest 公式ドキュメント](https://jestjs.io/)
- [React Testing Library](https://testing-library.com/react)
- [Playwright 公式ドキュメント](https://playwright.dev/)
- [Testing Best Practices](https://testingjavascript.com/)

## まとめ

この画像検索機能のテスト戦略により、以下が達成されます:

✅ **高品質**: 80%以上のコードカバレッジ
✅ **信頼性**: 自動化されたテストによるバグの早期発見
✅ **保守性**: 明確なテスト構造とドキュメント
✅ **継続的改善**: CI/CDによる自動テスト実行
✅ **開発者体験**: TDDによる設計品質の向上

---

**最終更新:** 2025-12-17
**担当:** QA Engineer
**レビュー:** Tech Lead
