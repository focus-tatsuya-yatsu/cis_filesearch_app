# Lambda Search API - テスト実行ガイド

## 概要

このドキュメントは、Lambda Search APIのテストを実行するための手順をまとめたものです。

## 前提条件

### 必須
- Node.js 20.x以上
- AWS CLI設定済み
- AWS認証情報が設定されている

### テスト実行に必要な環境変数

```bash
# OpenSearch接続情報
export OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
export OPENSEARCH_INDEX="cis-files"
export AWS_REGION="ap-northeast-1"

# Lambda関数名（E2Eテスト用）
export LAMBDA_FUNCTION_NAME="cis-search-api-prod"

# API Gatewayエンドポイント（E2Eテスト用）
export API_GATEWAY_ENDPOINT="https://5xbn5nq51f.execute-api.ap-northeast-1.amazonaws.com/prod/search"
```

## クイックスタート

### 1. 依存関係のインストール

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
npm install
```

### 2. すべてのユニットテストを実行

```bash
npm test
```

### 3. カバレッジ付きでテスト実行

```bash
npm run test:coverage
```

### 4. 統合テストを実行（OpenSearch接続が必要）

```bash
# 環境変数を設定
export OPENSEARCH_ENDPOINT="your-opensearch-endpoint"
export OPENSEARCH_INDEX="cis-files"
export RUN_INTEGRATION_TESTS="true"

# 統合テスト実行
npm test -- --testPathPattern=integration
```

### 5. E2Eテストを実行

```bash
# Lambda関数のE2Eテスト
cd scripts
./test-lambda-e2e.sh

# API GatewayのE2Eテスト
./test-api-gateway-e2e.sh
```

## テストの種類

### 1. ユニットテスト

**場所:** `/src/__tests__/*.test.ts`

**実行方法:**
```bash
# すべてのユニットテスト
npm test

# 特定のテストファイル
npm test validator.test.ts

# ウォッチモード
npm run test:watch
```

**カバレッジ:**
```bash
npm run test:coverage
open coverage/lcov-report/index.html
```

### 2. 統合テスト

**場所:** `/src/__tests__/integration/*.test.ts`

**実行方法:**
```bash
# 統合テスト実行
export RUN_INTEGRATION_TESTS="true"
npm test -- --testPathPattern=integration

# 特定の統合テスト
npm test -- text-search.integration.test.ts
```

**注意:** 統合テストは実際のOpenSearchインスタンスに接続します。

### 3. E2Eテスト

**場所:** `/scripts/test-*.sh`

**実行方法:**
```bash
cd scripts

# Lambda関数のE2Eテスト
./test-lambda-e2e.sh

# API GatewayのE2Eテスト
./test-api-gateway-e2e.sh
```

## テストコマンド一覧

| コマンド | 説明 |
|---------|------|
| `npm test` | すべてのユニットテストを実行 |
| `npm run test:watch` | ウォッチモードでテスト |
| `npm run test:coverage` | カバレッジ付きでテスト |
| `npm test -- validator.test.ts` | 特定のテストファイルのみ実行 |
| `npm test -- --testPathPattern=integration` | 統合テストのみ実行 |
| `./scripts/test-lambda-e2e.sh` | Lambda E2Eテスト |
| `./scripts/test-api-gateway-e2e.sh` | API Gateway E2Eテスト |

## 環境別のテスト実行

### ローカル環境

```bash
# ユニットテストのみ実行（OpenSearch不要）
npm test

# モックを使用してテスト
npm test -- --testPathPattern="^((?!integration).)*$"
```

### 開発環境（OpenSearch接続あり）

```bash
# 環境変数設定
export OPENSEARCH_ENDPOINT="dev-opensearch-endpoint"
export OPENSEARCH_INDEX="cis-files-dev"
export RUN_INTEGRATION_TESTS="true"

# すべてのテスト実行
npm test

# 統合テスト実行
npm test -- --testPathPattern=integration
```

### 本番環境（テスト環境で実行）

```bash
# 本番環境のエンドポイントを使用
export OPENSEARCH_ENDPOINT="prod-opensearch-endpoint"
export OPENSEARCH_INDEX="cis-files"
export LAMBDA_FUNCTION_NAME="cis-search-api-prod"
export RUN_INTEGRATION_TESTS="true"

# 統合テストとE2Eテスト
npm test -- --testPathPattern=integration
./scripts/test-lambda-e2e.sh
./scripts/test-api-gateway-e2e.sh
```

## テストシナリオ

### テキスト検索テスト

```bash
# 日本語検索（宇都宮）
npm test -- text-search.integration.test.ts -t "宇都宮"

# AND検索
npm test -- text-search.integration.test.ts -t "AND検索"

# フィルター付き検索
npm test -- text-search.integration.test.ts -t "フィルター"
```

### 画像検索テスト

```bash
# 512次元埋め込み
npm test -- image-search.integration.test.ts -t "512次元"

# 1024次元埋め込み
npm test -- image-search.integration.test.ts -t "1024次元"
```

### ハイブリッド検索テスト

```bash
# テキスト + 画像
npm test -- hybrid-search.integration.test.ts -t "ハイブリッド"
```

## トラブルシューティング

### 1. 403 Forbiddenエラー

**原因:** OpenSearchのロールマッピング未設定

**解決方法:**
```bash
cd scripts
./setup-role-mapping.py
```

### 2. タイムアウトエラー

**原因:** OpenSearch接続が遅い

**解決方法:**
```bash
# jest.config.jsでタイムアウトを延長
# または環境変数で設定
export JEST_TIMEOUT=30000
npm test
```

### 3. 環境変数未設定エラー

**原因:** OPENSEARCH_ENDPOINTなどが未設定

**解決方法:**
```bash
# .env.testファイル作成
cat > .env.test <<EOF
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=cis-files
AWS_REGION=ap-northeast-1
EOF

# 読み込んでテスト実行
source .env.test
npm test
```

### 4. AWS認証エラー

**原因:** AWS認証情報が未設定

**解決方法:**
```bash
# AWS CLIで認証情報を設定
aws configure

# または環境変数で設定
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_REGION="ap-northeast-1"
```

### 5. インデックスが見つからないエラー

**原因:** OpenSearchインデックスが存在しない

**解決方法:**
```bash
# インデックス確認
aws opensearch describe-domain --domain-name cis-filesearch-opensearch

# インデックス作成（必要に応じて）
# 詳細はドキュメント参照
```

## カバレッジレポート

### カバレッジ目標

| テストタイプ | カバレッジ目標 | 現在の状況 |
|------------|--------------|----------|
| ユニットテスト | 80%以上 | 確認中 |
| 統合テスト | 70%以上 | 確認中 |
| E2Eテスト | 主要シナリオ100% | 確認中 |

### カバレッジレポート生成

```bash
# カバレッジレポート生成
npm run test:coverage

# HTMLレポート閲覧
open coverage/lcov-report/index.html

# コンソールでサマリー確認
npm run test:coverage | grep -A 10 "Coverage summary"
```

## CI/CD統合

### GitHub Actions

テストはGitHub Actionsで自動実行されます：

- **プッシュ時**: ユニットテスト
- **プルリクエスト時**: ユニットテスト + 統合テスト
- **マージ前**: すべてのテスト（E2E含む）

詳細は `.github/workflows/lambda-tests.yml` を参照してください。

## パフォーマンステスト

### レスポンスタイム測定

```bash
# 10回のリクエストで平均レスポンスタイムを測定
cd scripts
./test-performance.sh
```

### 負荷テスト

```bash
# 100リクエスト、10並列で負荷テスト
cd scripts
./test-load.sh
```

## テスト結果の記録

テスト実行後、結果を記録してください：

```bash
# テスト結果をファイルに保存
npm test > test-results-$(date +%Y%m%d).txt 2>&1

# カバレッジレポートを保存
npm run test:coverage
cp -r coverage coverage-backup-$(date +%Y%m%d)
```

## よくある質問

### Q1: テストが失敗する場合の確認ポイントは？

1. 環境変数が正しく設定されているか
2. AWS認証情報が有効か
3. OpenSearchエンドポイントに接続できるか
4. Lambda関数がデプロイされているか
5. ロールマッピングが設定されているか

### Q2: 統合テストをスキップするには？

```bash
# 統合テストをスキップ
npm test -- --testPathPattern="^((?!integration).)*$"

# または環境変数を設定しない
unset RUN_INTEGRATION_TESTS
npm test
```

### Q3: 特定のテストのみ実行するには？

```bash
# テスト名でフィルター
npm test -- -t "宇都宮"

# ファイル名でフィルター
npm test -- validator.test.ts

# パスパターンでフィルター
npm test -- --testPathPattern=integration
```

### Q4: デバッグモードでテストを実行するには？

```bash
# Node.jsのデバッグモード
node --inspect-brk node_modules/.bin/jest --runInBand

# Jestのverboseモード
npm test -- --verbose

# 詳細なログ出力
export LOG_LEVEL=debug
npm test
```

## 参考資料

- [包括的テスト計画](/backend/lambda-search-api/TEST_PLAN_COMPREHENSIVE.md)
- [Jestドキュメント](https://jestjs.io/)
- [AWS Lambda開発ガイド](https://docs.aws.amazon.com/lambda/)
- [OpenSearch APIリファレンス](https://opensearch.org/docs/latest/)

## サポート

問題が発生した場合は、以下を確認してください：

1. ログファイル: `/tmp/lambda-*.json`
2. カバレッジレポート: `coverage/lcov-report/index.html`
3. テスト計画: `TEST_PLAN_COMPREHENSIVE.md`
