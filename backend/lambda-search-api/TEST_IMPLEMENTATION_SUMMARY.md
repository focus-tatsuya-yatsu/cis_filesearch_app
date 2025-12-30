# Lambda Search API - テスト実装サマリー

## 作成日: 2025-12-19

## 概要

Lambda-OpenSearch接続修正後の包括的なテスト計画とテストコードを実装しました。

## 作成したファイル

### 1. テスト計画書

**ファイル:** `TEST_PLAN_COMPREHENSIVE.md`

包括的なテスト計画書（約500行）：
- ユニットテスト戦略
- 統合テスト戦略
- E2Eテスト戦略
- パフォーマンステスト
- エラーケーステスト
- 「宇都宮」などの日本語検索を含む具体的なテストケース

### 2. ユニットテスト

#### a. バリデーションテスト
**ファイル:** `src/__tests__/validator.test.ts` (既存)

**カバレッジ:**
- テキストクエリバリデーション
- 画像埋め込みバリデーション（512次元/1024次元）
- ページネーションバリデーション
- フィルターバリデーション
- エラーケース

#### b. エラーハンドラーテスト
**ファイル:** `src/__tests__/error-handler.test.ts` (新規作成)

**カバレッジ:**
- ValidationErrorの処理
- OpenSearchErrorの処理
- 403/503/404エラーの処理
- CORSヘッダーの検証
- レスポンス構造の検証

#### c. Lambda Handlerテスト
**ファイル:** `src/__tests__/index.test.ts` (新規作成)

**カバレッジ:**
- GETリクエスト（テキスト検索）
  - 日本語検索（宇都宮）
  - AND/OR検索モード
  - フィルター適用
  - ページネーション
  - ソート設定
- POSTリクエスト（画像検索）
  - 512次元埋め込み
  - 1024次元埋め込み
  - ハイブリッド検索
- OPTIONSリクエスト（CORS）
- エラーハンドリング
- HTTP API v2形式の対応

### 3. 統合テスト

**ファイル:** `src/__tests__/integration/text-search.integration.test.ts` (新規作成)

**カバレッジ:**
- 日本語検索（宇都宮、営業報告書など）
- AND/OR検索モード
- ファイルタイプフィルター
- 日付範囲フィルター
- 複数フィルターの組み合わせ
- ページネーション
- ソート（関連度、日付、名前、サイズ）
- ハイライト表示
- パフォーマンス測定

**注意:**
- 環境変数 `RUN_INTEGRATION_TESTS=true` が必要
- 実際のOpenSearchインスタンスに接続

### 4. E2Eテスト

#### a. Lambda関数E2Eテスト
**ファイル:** `scripts/test-lambda-e2e.sh` (新規作成)

**テストケース:** 13個
1. テキスト検索（宇都宮）
2. AND検索モード
3. OR検索モード
4. フィルター付き検索
5. 画像検索（512次元）
6. 画像検索（1024次元）
7. ハイブリッド検索
8. ページネーション
9. ソート設定
10. エラーケース（空のクエリ）
11. エラーケース（無効なページ番号）
12. エラーケース（無効な画像埋め込み）
13. CORS Preflight

**実行方法:**
```bash
cd scripts
./test-lambda-e2e.sh
```

#### b. API Gateway E2Eテスト
**ファイル:** `scripts/test-api-gateway-e2e.sh` (新規作成)

**テストケース:** 15個
1. テキスト検索（宇都宮）
2. AND検索モード
3. OR検索モード
4. フィルター付き検索
5. 画像検索（512次元）
6. 画像検索（1024次元）
7. ハイブリッド検索
8. ハイブリッド検索 + フィルター
9. ページネーション
10. ソート設定
11. CORSヘッダー検証
12. エラーケース（空のクエリ）
13. エラーケース（無効なページ番号）
14. エラーケース（無効な画像埋め込み）
15. レスポンスタイム測定

**実行方法:**
```bash
cd scripts
./test-api-gateway-e2e.sh
```

### 5. ドキュメント

**ファイル:** `TEST_README.md` (新規作成)

**内容:**
- クイックスタートガイド
- テストの種類と実行方法
- 環境別テスト実行手順
- トラブルシューティング
- カバレッジレポート生成
- CI/CD統合
- よくある質問

---

## テストカバレッジ

### ユニットテスト

| ファイル | テストケース数 | カバレッジ目標 |
|---------|--------------|--------------|
| validator.test.ts | 20+ | 80%以上 |
| error-handler.test.ts | 15+ | 80%以上 |
| index.test.ts | 25+ | 80%以上 |

### 統合テスト

| ファイル | テストケース数 | カバレッジ目標 |
|---------|--------------|--------------|
| text-search.integration.test.ts | 25+ | 70%以上 |

### E2Eテスト

| スクリプト | テストケース数 | カバレッジ目標 |
|---------|--------------|--------------|
| test-lambda-e2e.sh | 13 | 主要シナリオ100% |
| test-api-gateway-e2e.sh | 15 | 主要シナリオ100% |

**合計テストケース数:** 100+

---

## テスト実行手順

### 1. ユニットテストのみ実行

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api

# 依存関係インストール
npm install

# ユニットテスト実行
npm test

# カバレッジ付き
npm run test:coverage
```

### 2. 統合テスト実行（OpenSearch接続必要）

```bash
# 環境変数設定
export OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
export OPENSEARCH_INDEX="cis-files"
export AWS_REGION="ap-northeast-1"
export RUN_INTEGRATION_TESTS="true"

# 統合テスト実行
npm test -- --testPathPattern=integration
```

### 3. E2Eテスト実行

```bash
# Lambda関数のE2Eテスト
cd scripts
chmod +x test-lambda-e2e.sh test-api-gateway-e2e.sh
./test-lambda-e2e.sh

# API GatewayのE2Eテスト
./test-api-gateway-e2e.sh
```

---

## 特定のテストシナリオ

### 「宇都宮」検索テスト

```bash
# ユニットテスト
npm test -- -t "宇都宮"

# 統合テスト
export RUN_INTEGRATION_TESTS="true"
npm test -- text-search.integration.test.ts -t "宇都宮"

# E2Eテスト（Lambda）
./scripts/test-lambda-e2e.sh  # Test 1で実行

# E2Eテスト（API Gateway）
./scripts/test-api-gateway-e2e.sh  # Test 1で実行
```

### 画像検索テスト

```bash
# ユニットテスト
npm test -- -t "画像埋め込み"

# E2Eテスト（512次元）
./scripts/test-lambda-e2e.sh  # Test 5で実行

# E2Eテスト（1024次元）
./scripts/test-lambda-e2e.sh  # Test 6で実行
```

### ハイブリッド検索テスト（テキスト + 画像）

```bash
# ユニットテスト
npm test -- index.test.ts -t "画像検索とテキスト検索の組み合わせ"

# E2Eテスト
./scripts/test-lambda-e2e.sh  # Test 7で実行
./scripts/test-api-gateway-e2e.sh  # Test 7, 8で実行
```

---

## 既知の問題と対応

### 1. 403 Forbiddenエラー

**ステータス:** 対応中（ロールマッピング設定待ち）

**テストへの影響:**
- 統合テストとE2Eテストが失敗する可能性あり
- ユニットテストは影響なし（モックを使用）

**解決方法:**
```bash
cd scripts
./setup-role-mapping.py
```

**テストでの検証:**
- `src/__tests__/integration/error-cases.test.ts` に403エラーハンドリングテストを追加予定

### 2. インデックス未作成

**テストへの影響:**
- 統合テストで404エラーが発生する可能性

**確認方法:**
```bash
# インデックスの存在確認
aws opensearch describe-domain --domain-name cis-filesearch-opensearch

# インデックス一覧確認
curl -X GET "$OPENSEARCH_ENDPOINT/_cat/indices?v"
```

---

## CI/CD統合（予定）

### GitHub Actions設定

**ファイル:** `.github/workflows/lambda-tests.yml` (作成予定)

**トリガー:**
- プッシュ時（main, developブランチ）
- プルリクエスト時

**ジョブ:**
1. ユニットテスト（常に実行）
2. 統合テスト（PRのみ）
3. E2Eテスト（PRのみ）

---

## 次のステップ

### 優先度1: ロールマッピング設定完了

```bash
cd scripts
./setup-role-mapping.py
```

### 優先度2: 全テスト実行

```bash
# ユニットテスト
npm run test:coverage

# 統合テスト
export RUN_INTEGRATION_TESTS="true"
npm test -- --testPathPattern=integration

# E2Eテスト
./scripts/test-lambda-e2e.sh
./scripts/test-api-gateway-e2e.sh
```

### 優先度3: カバレッジ確認と不足テストの追加

```bash
# カバレッジレポート確認
npm run test:coverage
open coverage/lcov-report/index.html

# 80%未満の場合、追加テストを作成
```

### 優先度4: CI/CD統合

```bash
# GitHub Actionsワークフロー作成
# .github/workflows/lambda-tests.yml
```

---

## テスト結果の記録

### テスト実行ログ

```bash
# テスト結果を記録
npm test > test-results-$(date +%Y%m%d-%H%M%S).txt 2>&1

# E2Eテスト結果を記録
./scripts/test-lambda-e2e.sh > e2e-lambda-$(date +%Y%m%d-%H%M%S).txt 2>&1
./scripts/test-api-gateway-e2e.sh > e2e-api-gateway-$(date +%Y%m%d-%H%M%S).txt 2>&1
```

### カバレッジレポート保存

```bash
# カバレッジレポート生成
npm run test:coverage

# レポート保存
cp -r coverage coverage-backup-$(date +%Y%m%d)
```

---

## サマリー

### 作成したファイル数

- **テスト計画書:** 1ファイル
- **ユニットテスト:** 3ファイル（60+ テストケース）
- **統合テスト:** 1ファイル（25+ テストケース）
- **E2Eテスト:** 2ファイル（28 テストケース）
- **ドキュメント:** 2ファイル

**合計:** 9ファイル、100+ テストケース

### カバレッジ目標

- **ユニットテスト:** 80%以上
- **統合テスト:** 70%以上
- **E2Eテスト:** 主要シナリオ100%

### 重点テストシナリオ

1. ✅ 日本語検索（宇都宮）
2. ✅ AND/OR検索モード
3. ✅ 画像検索（512次元/1024次元）
4. ✅ ハイブリッド検索（テキスト + 画像）
5. ✅ フィルター適用（ファイルタイプ、日付範囲）
6. ✅ ページネーション
7. ✅ ソート設定
8. ✅ エラーハンドリング
9. ✅ CORS対応

---

## 参考資料

- **包括的テスト計画:** `TEST_PLAN_COMPREHENSIVE.md`
- **テスト実行ガイド:** `TEST_README.md`
- **Jestドキュメント:** https://jestjs.io/
- **AWS Lambda開発ガイド:** https://docs.aws.amazon.com/lambda/
- **OpenSearch APIリファレンス:** https://opensearch.org/docs/latest/

---

**作成者:** Claude (QA Engineer Specialist)
**作成日:** 2025-12-19
**ステータス:** テスト実装完了、ロールマッピング設定待ち
