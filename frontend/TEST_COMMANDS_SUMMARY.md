# Image Search Test Commands - Quick Reference

画像検索機能テストコマンド一覧

## 目次

- [ローカル環境でのテスト](#ローカル環境でのテスト)
- [VPC環境（EC2）でのテスト](#vpc環境ec2でのテスト)
- [コマンド詳細](#コマンド詳細)
- [トラブルシューティング](#トラブルシューティング)

---

## ローカル環境でのテスト

### セットアップ

```bash
# 1. 依存関係のインストール
yarn install

# 2. テスト画像の生成
bash e2e/fixtures/create-test-images.sh

# 3. Playwright ブラウザのインストール（E2Eテスト実行時のみ）
yarn playwright:install
```

### 実行コマンド

#### すべてのテストを実行

```bash
# 開発サーバーを起動（別ターミナル）
yarn dev

# すべてのテストを実行
yarn test:all
```

#### 個別テスト実行

```bash
# ユニットテストのみ
yarn test:unit

# カバレッジレポート付き
yarn test:coverage

# 画像検索関連のユニットテスト
yarn test:image-search

# 統合テスト（画像アップロード → ベクトル化 → 検索）
yarn test:image-integration

# OpenSearch接続テスト
yarn test:opensearch

# E2Eテスト（Playwright）
yarn test:e2e

# E2Eテスト（UIモード）
yarn test:e2e:ui
```

---

## VPC環境（EC2）でのテスト

### EC2インスタンスへの接続

```bash
# SSHで接続
ssh -i ~/.ssh/your-key.pem ec2-user@<EC2_PUBLIC_IP>

# プロジェクトディレクトリに移動
cd /path/to/cis_filesearch_app/frontend
```

### 実行コマンド

#### すべてのテストを一括実行（推奨）

```bash
# VPC環境の全テストを自動実行
./scripts/run-tests-vpc.sh
```

このスクリプトは以下を実行します：
1. 前提条件チェック
2. OpenSearch接続テスト
3. 画像検索統合テスト
4. (Optional) E2Eテスト

#### 個別テスト実行

```bash
# OpenSearch接続テスト（VPC内から）
VPC_MODE=true yarn test:opensearch:vpc

# 統合テスト（VPC内から）
VPC_MODE=true yarn test:image-integration:vpc
```

---

## コマンド詳細

### Unit Tests (Jest)

| コマンド | 説明 | 実行時間 |
|---------|------|----------|
| `yarn test` | すべてのユニットテスト実行 | ~30秒 |
| `yarn test:unit` | ユニットテストのみ（カバレッジ付き） | ~30秒 |
| `yarn test:coverage` | カバレッジレポート生成 | ~40秒 |
| `yarn test:watch` | Watchモードでテスト | - |
| `yarn test:image-search` | 画像検索関連のテストのみ | ~10秒 |

**カバレッジレポート確認**:
```bash
yarn test:coverage
open coverage/lcov-report/index.html
```

---

### Integration Tests (TypeScript)

| コマンド | 説明 | 実行時間 |
|---------|------|----------|
| `yarn test:image-integration` | 画像検索統合テスト（ローカル） | ~60秒 |
| `yarn test:image-integration:vpc` | 画像検索統合テスト（VPC） | ~60秒 |

**テスト内容**:
- 画像アップロード & ベクトル化
- ベクトル検索
- エンドツーエンドワークフロー
- パフォーマンステスト

**環境変数**:
```bash
# カスタムベースURLで実行
BASE_URL=http://custom-url:3000 yarn test:image-integration

# VPCモードで実行
VPC_MODE=true yarn test:image-integration:vpc
```

---

### OpenSearch Tests (Bash)

| コマンド | 説明 | 実行時間 |
|---------|------|----------|
| `yarn test:opensearch` | OpenSearch接続テスト（ローカル） | ~20秒 |
| `yarn test:opensearch:vpc` | OpenSearch接続テスト（VPC） | ~20秒 |

**テスト内容**:
- クラスター健全性チェック
- インデックスマッピング検証
- `image_embedding` フィールド確認（knn_vector, dimension: 1024）
- KNN検索クエリ実行

**環境変数**:
```bash
# カスタムエンドポイントで実行
OPENSEARCH_ENDPOINT=vpc-custom-endpoint.es.amazonaws.com yarn test:opensearch

# カスタムインデックス名で実行
INDEX_NAME=custom_index yarn test:opensearch
```

---

### E2E Tests (Playwright)

| コマンド | 説明 | 実行時間 |
|---------|------|----------|
| `yarn test:e2e` | すべてのE2Eテスト実行 | ~3分 |
| `yarn test:e2e:ui` | UIモードで実行（インタラクティブ） | - |
| `yarn test:e2e:debug` | デバッグモードで実行 | - |
| `yarn test:e2e:report` | HTMLレポート表示 | - |

**ブラウザ指定**:
```bash
# Chromiumのみ実行
yarn test:e2e --project=chromium

# Firefoxのみ実行
yarn test:e2e --project=firefox
```

**特定のテストのみ実行**:
```bash
# ファイル指定
yarn test:e2e e2e/image-search.spec.ts

# テスト名でフィルタ
yarn test:e2e --grep "should upload JPEG"
```

---

### Combined Tests

| コマンド | 説明 | 実行時間 |
|---------|------|----------|
| `yarn test:all` | ユニット + 統合 + E2E | ~5分 |
| `yarn test:all:coverage` | カバレッジ付き全テスト | ~6分 |
| `yarn test:vpc` | VPC環境一括テスト | ~10分 |

---

## テストフロー

### 1. 初回セットアップ

```bash
# プロジェクトのクローン
git clone <repository-url>
cd frontend

# 依存関係インストール
yarn install

# テスト画像生成
bash e2e/fixtures/create-test-images.sh

# Playwright ブラウザインストール
yarn playwright:install
```

### 2. 日常的なテスト実行

```bash
# 開発中のユニットテスト（Watchモード）
yarn test:watch

# コミット前の全テスト実行
yarn test:all
```

### 3. CI/CD パイプライン

```bash
# CI環境用テスト
yarn test:ci

# カバレッジレポート生成
yarn test:coverage

# E2Eテスト実行
yarn playwright:install
yarn test:e2e
```

---

## テスト対象API

### POST /api/image-embedding

画像をベクトル化（1024次元）

**テスト項目**:
- ✅ Valid JPEG/PNG upload
- ✅ File size validation (max 5MB)
- ✅ File type validation
- ✅ Bedrock API integration
- ✅ Error handling

**テストファイル**: `src/app/api/image-embedding/route.test.ts`

---

### POST /api/search

ベクトル類似度検索

**テスト項目**:
- ✅ Image embedding forwarding
- ✅ Vector data integrity
- ✅ Pagination parameters
- ✅ Sort parameters
- ✅ Lambda API integration

**テストファイル**: `src/app/api/search/__tests__/route.test.ts`

---

## トラブルシューティング

### 問題: テスト画像が見つからない

```bash
bash e2e/fixtures/create-test-images.sh
```

### 問題: OpenSearchに接続できない

**ローカル環境**:
```bash
# VPC内のEC2から実行
ssh -i key.pem ec2-user@<EC2_IP>
cd /path/to/frontend
VPC_MODE=true yarn test:opensearch:vpc
```

**VPC環境**:
```bash
# セキュリティグループを確認
aws ec2 describe-security-groups --group-ids <SG_ID>

# IAMロールを確認
aws sts get-caller-identity
```

### 問題: Bedrock認証エラー

```bash
# .env.local に追加
cat > .env.local <<EOF
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
EOF
```

または、モックモードを使用:
- `src/app/api/image-embedding/route.ts` の `USE_MOCK_MODE` を `true` に設定

### 問題: E2Eテストがタイムアウト

```bash
# サーバーが起動しているか確認
curl http://localhost:3000

# サーバーを起動
yarn dev
```

### 問題: Playwright ブラウザエラー

```bash
# ブラウザを再インストール
yarn playwright:install --force
```

---

## 期待される結果

### ユニットテスト成功例

```
 PASS  src/app/api/image-embedding/route.test.ts
  POST /api/image-embedding
    Success Cases
      ✓ should successfully process valid JPEG image (125 ms)
      ✓ should successfully process valid PNG image (98 ms)
    Validation Error Cases
      ✓ should return 400 when no image file is provided (23 ms)
      ✓ should return 400 for file size exceeding limit (31 ms)
    ...

Test Suites: 2 passed, 2 total
Tests:       45 passed, 45 total
Coverage:    85.3% lines covered
```

### 統合テスト成功例

```
╔════════════════════════════════════════════════════════╗
║  Image Search Integration Test Suite                  ║
╚════════════════════════════════════════════════════════╝

📤 Test 1: Image Upload & Vectorization
  ✓ HTTP status should be 200
  ✓ Embedding should have 1024 dimensions

🔍 Test 2: Image Vector Search
  ✓ HTTP status should be 200
  ✓ Vector data integrity verified

Pass rate: 100.00%
✅ All tests passed!
```

### E2Eテスト成功例

```
Running 18 tests using 3 workers

  ✓ [chromium] › image-search.spec.ts:75:5 › should upload JPEG image (2.3s)
  ✓ [chromium] › image-search.spec.ts:99:5 › should upload PNG image (1.8s)
  ✓ [firefox] › image-search.spec.ts:161:5 › should display search results (3.1s)
  ...

  18 passed (45.2s)
```

---

## カバレッジ目標

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Lines | 80%+ | TBD | 🎯 |
| Branches | 75%+ | TBD | 🎯 |
| Functions | 85%+ | TBD | 🎯 |
| Statements | 80%+ | TBD | 🎯 |

---

## 追加リソース

- **詳細ガイド**: [IMAGE_SEARCH_TEST_GUIDE.md](docs/testing/IMAGE_SEARCH_TEST_GUIDE.md)
- **スクリプト説明**: [scripts/TEST_SCRIPTS_README.md](scripts/TEST_SCRIPTS_README.md)
- **Jest公式ドキュメント**: https://jestjs.io/
- **Playwright公式ドキュメント**: https://playwright.dev/
- **OpenSearch KNN**: https://opensearch.org/docs/latest/search-plugins/knn/

---

## よくある質問

**Q: どのテストから始めるべきですか？**

A: まずユニットテストから：
```bash
yarn test:unit
```

**Q: VPC環境でのテストが必須ですか？**

A: OpenSearchへの接続テストのみVPC環境が必要です。他はローカルで実行可能。

**Q: テストにどれくらい時間がかかりますか？**

A:
- ユニットテスト: ~30秒
- 統合テスト: ~60秒
- E2Eテスト: ~3分
- 全テスト: ~5分

**Q: CI/CDでテストを自動化できますか？**

A: はい、GitHub Actionsで自動実行可能：
```yaml
- run: yarn test:ci
- run: yarn test:e2e
```

---

**最終更新**: 2025-12-18
**作成者**: QA Engineering Team
