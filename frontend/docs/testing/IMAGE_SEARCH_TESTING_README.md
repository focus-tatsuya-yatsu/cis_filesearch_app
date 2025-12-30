# 画像検索機能 包括的テストドキュメント

画像検索機能（localhost:3000）の完全なテストスイートとガイドライン

## 📚 ドキュメント構成

このディレクトリには、画像検索機能のテストに関する包括的なドキュメントが含まれています：

### 1. [クイックスタートガイド](./IMAGE_SEARCH_TEST_QUICKSTART.md)
**対象**: すべての開発者
**所要時間**: 5分

最速でテストを実行する方法。開発中の機能確認やプルリクエスト前のチェックに最適。

**含まれる内容**:
- 5分でテスト実行する手順
- テストコマンド一覧
- シナリオ別テスト実行方法
- トラブルシューティング

### 2. [手動テストガイド](./IMAGE_SEARCH_MANUAL_TEST_GUIDE.md)
**対象**: QAエンジニア、テスター
**所要時間**: 30-60分

ブラウザでの詳細な手動テスト手順。本番リリース前の最終確認に使用。

**含まれる内容**:
- 10の主要テストシナリオ
- チェックリスト形式のテスト手順
- テスト結果記録シート
- レスポンシブデザインテスト
- アクセシビリティテスト

### 3. [テストレポートテンプレート](./IMAGE_SEARCH_TEST_REPORT_TEMPLATE.md)
**対象**: QAリード、プロジェクトマネージャー
**所要時間**: 15-30分（記入）

テスト実行後のレポート作成用テンプレート。

**含まれる内容**:
- エグゼクティブサマリー
- 詳細テスト結果フォーマット
- パフォーマンスメトリクス
- カバレッジレポート
- 発見された問題の記録
- 改善提案セクション

---

## 🎯 テスト戦略

### テストピラミッド

```
        E2E Tests (10%)
       /              \
      /    複雑なユーザー  \
     /     ジャーニー       \
    /________________________\
   Integration Tests (20%)
  /         API統合          \
 /      OpenSearch連携        \
/______________________________\
     Unit Tests (70%)
   コンポーネント、関数、ロジック
```

### カバレッジ目標

| カテゴリ | 目標 | 優先度 |
|---------|------|--------|
| Lines | 80% | High |
| Statements | 80% | High |
| Functions | 85% | High |
| Branches | 75% | Medium |

---

## 🧪 テストの種類

### 1. ユニットテスト（Jest + React Testing Library）

**場所**: `/Users/tatsuya/focus_project/cis_filesearch_app/frontend/src/**/*.test.{ts,tsx}`

**対象**:
- React コンポーネント
- API クライアント関数
- ユーティリティ関数
- カスタムフック

**実行コマンド**:
```bash
yarn test                      # すべてのユニットテスト
yarn test:watch               # ウォッチモード
yarn test:coverage            # カバレッジ付き
```

**主要なテストファイル**:
- `ImageSearchContainer.test.tsx` - メインコンテナコンポーネント
- `ImageSearchResults.test.tsx` - 検索結果表示
- `imageSearch.test.ts` - API クライアント
- `useToast.test.ts` - トースト通知フック

### 2. インテグレーションテスト（Jest）

**場所**: `/Users/tatsuya/focus_project/cis_filesearch_app/frontend/src/__tests__/integration/`

**対象**:
- APIエンドポイントの統合
- OpenSearch との連携
- エラーハンドリング

**実行コマンド**:
```bash
yarn test:integration              # すべての統合テスト
yarn test:image-integration        # 画像検索統合テスト
```

**主要なテストファイル**:
- `image-search-e2e.test.ts` - 画像検索E2Eフロー
- `route.integration.test.ts` - APIルートテスト

### 3. E2Eテスト（Playwright）

**場所**: `/Users/tatsuya/focus_project/cis_filesearch_app/frontend/e2e/`

**対象**:
- 完全なユーザージャーニー
- クロスブラウザテスト
- レスポンシブデザイン
- アクセシビリティ

**実行コマンド**:
```bash
yarn test:e2e                      # すべてのE2Eテスト
yarn test:e2e:ui                   # UIモード
yarn test:e2e:debug                # デバッグモード
```

**主要なテストファイル**:
- `image-search.spec.ts` - 基本的な画像検索テスト
- `image-search-production.spec.ts` - 本番データ（1000件）テスト

### 4. パフォーマンステスト

**場所**: `/Users/tatsuya/focus_project/cis_filesearch_app/frontend/scripts/`

**対象**:
- 検索レスポンスタイム
- メモリ使用量
- レンダリング速度

**実行コマンド**:
```bash
yarn benchmark:image               # 画像検索ベンチマーク
yarn load-test                     # 負荷テスト
```

---

## 🚀 クイックスタート

### 初回セットアップ

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

# 1. 依存関係インストール
yarn install

# 2. Playwrightブラウザインストール
yarn playwright:install

# 3. テスト用画像生成（必要に応じて）
mkdir -p e2e/fixtures/images
# または
yarn run create-test-image.sh
```

### 開発中

```bash
# ウォッチモードでユニットテスト
yarn test:watch

# カバレッジ確認
yarn test:coverage
open coverage/lcov-report/index.html
```

### プルリクエスト前

```bash
# すべてのテスト実行
./scripts/run-image-search-tests.sh --coverage

# または個別実行
yarn test:ci
yarn test:e2e
```

### リリース前

```bash
# 本番データで包括的テスト
./scripts/run-image-search-tests.sh --production --performance --coverage --report
```

---

## 📊 テスト環境

### フロントエンド

```
URL: http://localhost:3000
Framework: Next.js 15
Runtime: Node.js v20+
Test Framework: Jest 30, Playwright 1.48
```

### バックエンド

```
API URL: https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search
Region: ap-northeast-1
Service: AWS Lambda
```

### データベース

```
Type: Amazon OpenSearch
Index: file-index-v2-knn
Documents: 1000件
Data Source: 道路設計部の画像ファイル
Vector Dimension: 1024 (AWS Bedrock Titan Multimodal)
```

### サンプルデータ

インデックスに含まれるファイル例:
- `CIMG0012.JPG`
- `CIMG0004.JPG`
- `53.jpg`
- その他 997件

部署情報: 道路設計部

---

## 🎯 テストシナリオ概要

### 基本機能

1. **画像アップロード**
   - JPEGアップロード成功
   - PNGアップロード成功
   - 無効なファイル形式エラー
   - ファイルサイズ超過エラー

2. **検索実行**
   - ベクトル生成（AWS Bedrock）
   - OpenSearch検索
   - 結果表示（2秒以内）

3. **検索結果表示**
   - ファイル名、パス、サイズ、日付
   - 信頼度スコア（90%以上）
   - 部署情報
   - スコア降順ソート

4. **パスコピー機能**
   - クリップボードへのコピー
   - 成功トースト表示

### エラーハンドリング

5. **バリデーションエラー**
   - ファイル形式チェック
   - ファイルサイズチェック

6. **ネットワークエラー**
   - API接続エラー
   - タイムアウト
   - リトライロジック

7. **空の結果**
   - 結果0件の場合の表示
   - 適切なメッセージ

### パフォーマンス

8. **レスポンスタイム**
   - 目標: 平均2秒以内
   - 最大: 5秒以内

9. **大量データ処理**
   - 1000件のインデックスから検索
   - ページネーション
   - メモリ効率

### UX

10. **レスポンシブデザイン**
    - デスクトップ（1920x1080）
    - タブレット（768x1024）
    - モバイル（375x667）

11. **アクセシビリティ**
    - キーボードナビゲーション
    - ARIAラベル
    - スクリーンリーダー対応

---

## 📈 継続的インテグレーション (CI)

### GitHub Actions

**ワークフローファイル**: `.github/workflows/frontend-tests.yml`

**トリガー**:
- プッシュ時（main, developブランチ）
- プルリクエスト時

**実行内容**:
1. 依存関係インストール
2. ユニットテスト（カバレッジ付き）
3. インテグレーションテスト
4. E2Eテスト（Chrome, Firefox）
5. カバレッジレポート生成

**成功基準**:
- すべてのテストがパス
- カバレッジ80%以上

---

## 🐛 トラブルシューティング

### よくある問題と解決策

#### 1. テストが実行されない

**原因**: 依存関係の問題

**解決策**:
```bash
rm -rf node_modules yarn.lock
yarn install
```

#### 2. E2Eテストがタイムアウト

**原因**: 開発サーバーが起動していない

**解決策**:
```bash
yarn dev  # 別ターミナルで起動
```

#### 3. Playwrightエラー

**原因**: ブラウザがインストールされていない

**解決策**:
```bash
yarn playwright:install
```

#### 4. カバレッジが低い

**原因**: テストが不足

**解決策**:
```bash
# カバレッジレポートで未カバー箇所を確認
open coverage/lcov-report/index.html
```

#### 5. パフォーマンステスト失敗

**原因**: バックエンドAPI遅延

**解決策**:
```bash
# OpenSearch状態確認
yarn run check-opensearch-local.sh

# API応答時間確認
curl -w "%{time_total}" https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search
```

---

## 📝 テストレポート作成

### 自動生成

```bash
./scripts/run-image-search-tests.sh --report
open test-results/test-report-*.html
```

### 手動作成

1. テンプレートをコピー
```bash
cp docs/testing/IMAGE_SEARCH_TEST_REPORT_TEMPLATE.md test-results/my-report.md
```

2. テストを実行して結果を記録

3. テンプレートを記入

4. レビュー・承認

---

## 🔗 関連リソース

### ドキュメント

- [クイックスタートガイド](./IMAGE_SEARCH_TEST_QUICKSTART.md)
- [手動テストガイド](./IMAGE_SEARCH_MANUAL_TEST_GUIDE.md)
- [テストレポートテンプレート](./IMAGE_SEARCH_TEST_REPORT_TEMPLATE.md)

### テストコード

- [ユニットテスト](/Users/tatsuya/focus_project/cis_filesearch_app/frontend/src/components/features/ImageSearchContainer.test.tsx)
- [統合テスト](/Users/tatsuya/focus_project/cis_filesearch_app/frontend/src/__tests__/integration/image-search-e2e.test.ts)
- [E2Eテスト](/Users/tatsuya/focus_project/cis_filesearch_app/frontend/e2e/image-search.spec.ts)
- [本番データテスト](/Users/tatsuya/focus_project/cis_filesearch_app/frontend/e2e/image-search-production.spec.ts)

### ツール

- [Jest](https://jestjs.io/) - ユニットテストフレームワーク
- [React Testing Library](https://testing-library.com/react) - Reactコンポーネントテスト
- [Playwright](https://playwright.dev/) - E2Eテストフレームワーク

---

## 📞 サポート

### 質問・問題報告

- GitHub Issues
- Slack: #cis-filesearch-dev
- Email: dev-team@example.com

### コントリビューション

新しいテストケースや改善提案は大歓迎です！

1. ブランチを作成
2. テストを追加・修正
3. `yarn test:all` でテストをパス
4. プルリクエストを作成

---

## 📅 更新履歴

| 日付 | バージョン | 変更内容 |
|------|-----------|---------|
| 2025-01-21 | 1.0.0 | 初版リリース |
| - | - | - |

---

## ✅ チェックリスト

### 開発者向け

- [ ] ユニットテストを理解した
- [ ] ウォッチモードでテストを実行できる
- [ ] カバレッジレポートを読める
- [ ] E2Eテストを実行できる

### QAエンジニア向け

- [ ] 手動テストガイドを読んだ
- [ ] すべてのシナリオを実行できる
- [ ] テストレポートを作成できる
- [ ] 問題を適切に報告できる

### プロジェクトマネージャー向け

- [ ] テスト戦略を理解した
- [ ] カバレッジ目標を把握した
- [ ] リリース前のテスト手順を知っている
- [ ] テストレポートをレビューできる

---

**最終更新**: 2025-01-21
**バージョン**: 1.0.0
**メンテナー**: QA Team
