# 画像検索機能テスト クイックスタートガイド

このガイドでは、画像検索機能のテストを最速で実行する方法を説明します。

## 🚀 5分でテスト実行

### ステップ1: 環境準備（1分）

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

# 依存関係がインストールされていない場合のみ
yarn install
```

### ステップ2: 開発サーバー起動（1分）

```bash
# 新しいターミナルウィンドウで
yarn dev
```

ブラウザで http://localhost:3000 が開けることを確認してください。

### ステップ3: テスト実行（3分）

#### オプションA: すべてのテストを実行

```bash
# 包括的テストスイート（推奨）
./scripts/run-image-search-tests.sh --coverage --report
```

#### オプションB: クイックテスト（E2Eのみ）

```bash
# E2Eテストのみ（最速）
./scripts/run-image-search-tests.sh --e2e-only
```

#### オプションC: ユニットテストのみ

```bash
# ユニットテストのみ
./scripts/run-image-search-tests.sh --unit-only --coverage
```

### ステップ4: 結果確認

テスト完了後、以下のレポートが生成されます：

```bash
# カバレッジレポート
open coverage/lcov-report/index.html

# Playwrightレポート
yarn test:e2e:report

# テストログ
cat test-results/test-run-*.log
```

---

## 📋 テストコマンド一覧

### ユニットテスト

```bash
# すべてのユニットテスト
yarn test

# 画像検索関連のみ
yarn test --testPathPattern="image"

# カバレッジ付き
yarn test:coverage

# ウォッチモード（開発中）
yarn test:watch
```

### インテグレーションテスト

```bash
# すべてのインテグレーションテスト
yarn test:integration

# 画像検索統合テスト
yarn test:image-integration
```

### E2Eテスト

```bash
# すべてのE2Eテスト
yarn test:e2e

# UIモード（デバッグ用）
yarn test:e2e:ui

# デバッグモード
yarn test:e2e:debug

# 特定のブラウザのみ
yarn test:e2e --project=chromium
yarn test:e2e --project=firefox
yarn test:e2e --project=webkit
```

### パフォーマンステスト

```bash
# 画像検索パフォーマンス
yarn benchmark:image

# クイックベンチマーク
yarn benchmark:quick
```

---

## 🎯 シナリオ別テスト実行

### シナリオ1: 開発中の機能テスト

**目的**: 開発した機能が正しく動作するか確認

```bash
# ウォッチモードでユニットテスト
yarn test:watch

# 対象ファイルのみテスト
yarn test ImageSearchContainer
```

### シナリオ2: プルリクエスト前のテスト

**目的**: すべてのテストがパスすることを確認

```bash
# CI相当のテスト実行
yarn test:ci

# E2Eテストを追加
yarn test:e2e
```

### シナリオ3: 本番リリース前のテスト

**目的**: 本番データで包括的にテスト

```bash
# 本番データを使用した完全テスト
./scripts/run-image-search-tests.sh --production --performance --coverage --report
```

### シナリオ4: パフォーマンス検証

**目的**: レスポンスタイムを測定

```bash
# パフォーマンスベンチマーク
yarn benchmark:image

# 負荷テスト
yarn load-test
```

---

## 🔍 手動テストクイックチェック

ブラウザで http://localhost:3000 を開き、以下を確認：

### 基本フロー（2分）

1. ✅ 「画像で検索」ボタンをクリック
2. ✅ ドロップダウンが開く
3. ✅ 画像を選択（JPEG/PNG）
4. ✅ アップロード進捗が表示される
5. ✅ 検索結果が2秒以内に表示される
6. ✅ 結果にファイル名、パス、サイズ、日付が表示される
7. ✅ 信頼度スコアが90%以上
8. ✅ パスコピーボタンが機能する

### エラーケース（1分）

1. ✅ PDFファイルをアップロード → エラーメッセージ表示
2. ✅ 5MB以上の画像 → エラーメッセージ表示

### レスポンシブ（1分）

1. ✅ DevTools で 375px に変更 → モバイル表示確認
2. ✅ 768px に変更 → タブレット表示確認
3. ✅ 1920px に変更 → デスクトップ表示確認

---

## 📊 テスト結果の読み方

### ✅ 成功の場合

```
✓ すべてのテストがパス
✓ カバレッジが80%以上
✓ E2Eテストがすべてのブラウザで成功
✓ パフォーマンステストが目標値を達成
```

→ **リリース準備完了**

### ⚠️ 警告がある場合

```
⚠ 一部のテストが失敗
⚠ カバレッジが目標未達
⚠ パフォーマンスが遅い
```

→ **修正が必要**

詳細は以下を確認：
- ログファイル: `test-results/test-run-*.log`
- カバレッジレポート: `coverage/lcov-report/index.html`
- Playwrightレポート: `playwright-report/index.html`

### ❌ 失敗の場合

```
✗ 複数のテストが失敗
✗ 重大なエラーが発生
```

→ **即座に修正が必要**

トラブルシューティング手順：

1. ログファイルでエラー内容を確認
2. DevToolsのConsoleタブでエラーを確認
3. 該当テストをデバッグモードで再実行

```bash
yarn test:e2e:debug e2e/image-search.spec.ts
```

---

## 🐛 トラブルシューティング

### 問題: テストが実行されない

**解決策**:

```bash
# 依存関係を再インストール
rm -rf node_modules
yarn install

# Playwrightブラウザをインストール
yarn playwright:install
```

### 問題: E2Eテストがタイムアウトする

**解決策**:

```bash
# 開発サーバーが起動しているか確認
curl http://localhost:3000

# 起動していない場合
yarn dev
```

### 問題: カバレッジが低い

**解決策**:

未カバーのファイルを確認：

```bash
open coverage/lcov-report/index.html
```

赤色でハイライトされた行のテストを追加してください。

### 問題: パフォーマンステストが失敗

**原因**: バックエンドAPIまたはOpenSearchの応答が遅い

**解決策**:

```bash
# OpenSearchの状態を確認
yarn run check-opensearch-local.sh

# APIの応答時間を確認
curl -w "@curl-format.txt" https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search
```

---

## 📝 テストレポート作成

### 自動レポート生成

```bash
# HTMLレポート生成
./scripts/run-image-search-tests.sh --report

# レポートを開く
open test-results/test-report-*.html
```

### 手動レポート作成

テンプレートを使用：

```bash
cp docs/testing/IMAGE_SEARCH_TEST_REPORT_TEMPLATE.md test-results/my-test-report.md

# テンプレートを編集
code test-results/my-test-report.md
```

---

## 🔗 関連ドキュメント

- [手動テストガイド](./IMAGE_SEARCH_MANUAL_TEST_GUIDE.md) - 詳細な手動テスト手順
- [テストレポートテンプレート](./IMAGE_SEARCH_TEST_REPORT_TEMPLATE.md) - レポート記入用テンプレート
- [E2Eテスト実装](/Users/tatsuya/focus_project/cis_filesearch_app/frontend/e2e/image-search.spec.ts) - Playwrightテストコード
- [統合テスト](/Users/tatsuya/focus_project/cis_filesearch_app/frontend/src/__tests__/integration/image-search-e2e.test.ts) - Jest統合テスト

---

## 💡 ベストプラクティス

### 開発中

- ✅ ウォッチモードでユニットテストを常時実行
- ✅ 機能追加時は必ずテストも追加（TDD）
- ✅ カバレッジを確認して未テスト箇所を特定

### プルリクエスト前

- ✅ すべてのユニットテストをパス
- ✅ E2Eテストを実行
- ✅ カバレッジ80%以上を維持

### リリース前

- ✅ 本番データでテスト
- ✅ パフォーマンステスト実行
- ✅ すべてのブラウザでE2Eテスト
- ✅ 手動テストで主要シナリオを確認

---

## 📈 テストカバレッジ目標

| カテゴリ | 目標 | 現状 |
|---------|------|------|
| Lines | 80% | - |
| Statements | 80% | - |
| Functions | 85% | - |
| Branches | 75% | - |

現状を確認：

```bash
yarn test:coverage
```

---

## 🎓 テスト実行の学習パス

### レベル1: 初心者

1. ユニットテストを実行してみる
2. カバレッジレポートを見てみる
3. 簡単なテストを追加してみる

```bash
yarn test
open coverage/lcov-report/index.html
```

### レベル2: 中級者

1. E2Eテストを実行してみる
2. UIモードでテストを見てみる
3. テストをデバッグしてみる

```bash
yarn test:e2e:ui
```

### レベル3: 上級者

1. 本番データでテストを実行
2. パフォーマンステストを実行
3. CIパイプラインでテストを実行

```bash
./scripts/run-image-search-tests.sh --production --performance
```

---

**最終更新**: 2025-01-21
**バージョン**: 1.0.0
