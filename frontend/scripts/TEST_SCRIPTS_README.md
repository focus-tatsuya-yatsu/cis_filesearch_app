# Test Scripts - Image Search Feature

画像検索機能のテストスクリプト集

## Quick Start

### ローカル環境

```bash
# 1. テスト画像の生成
bash e2e/fixtures/create-test-images.sh

# 2. 開発サーバー起動
yarn dev

# 3. 別ターミナルでテスト実行
yarn test:image-integration
```

### VPC環境（EC2）

```bash
# EC2にSSH接続後
./scripts/run-tests-vpc.sh
```

---

## Available Scripts

### Integration Tests

#### `test-image-search-integration.ts`

画像検索のエンドツーエンド統合テスト

**実行方法**:
```bash
# ローカル
yarn test:image-integration

# VPC
VPC_MODE=true yarn test:image-integration:vpc
```

**テスト内容**:
1. 画像アップロード & ベクトル化
2. ベクトル検索
3. エンドツーエンドワークフロー
4. パフォーマンステスト

**環境変数**:
- `VPC_MODE`: VPC環境での実行（true/false）
- `BASE_URL`: APIエンドポイント（デフォルト: http://localhost:3000）

---

#### `test-opensearch-image-search.sh`

OpenSearch接続とKNN検索のテスト

**実行方法**:
```bash
# ローカル
yarn test:opensearch

# VPC
yarn test:opensearch:vpc
```

**テスト内容**:
1. クラスター健全性チェック
2. インデックスマッピング検証
3. `image_embedding` フィールド確認
4. KNN検索クエリ実行
5. インデックス統計情報

**環境変数**:
- `VPC_MODE`: VPC環境での実行
- `OPENSEARCH_ENDPOINT`: OpenSearchエンドポイント
- `INDEX_NAME`: インデックス名（デフォルト: files）

---

### VPC Test Runner

#### `run-tests-vpc.sh`

VPC環境での一括テスト実行

**実行方法**:
```bash
./scripts/run-tests-vpc.sh
```

**実行内容**:
1. 前提条件チェック（Node.js, yarn, curl, jq）
2. OpenSearch接続テスト
3. 画像検索統合テスト
4. (Optional) E2Eテスト

**前提条件**:
- EC2インスタンス内で実行
- OpenSearchと同一VPC
- 必要なソフトウェアがインストール済み

---

## Test Fixtures

### `e2e/fixtures/create-test-images.sh`

E2Eテスト用の画像ファイル生成

**実行方法**:
```bash
bash e2e/fixtures/create-test-images.sh
```

**生成されるファイル**:
- `test-image.jpg` - 最小限の有効なJPEG（1x1ピクセル）
- `test-image.png` - 最小限の有効なPNG（1x1ピクセル）
- `large-image.jpg` - サイズ制限テスト用（6MB）
- `document.pdf` - 無効なファイルタイプテスト用
- `テスト画像.jpg` - 日本語ファイル名テスト用
- `test-image (1).jpg` - 特殊文字ファイル名テスト用
- `realistic-test.jpg` - リアルな画像（ImageMagick必須）

---

## Test Execution Flow

```
┌─────────────────────────────────────────┐
│  1. Setup Phase                         │
│  - Install dependencies                 │
│  - Generate test images                 │
│  - Start dev server                     │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│  2. Unit Tests (Jest)                   │
│  - API route handlers                   │
│  - Validation logic                     │
│  - Error handling                       │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│  3. Integration Tests (TypeScript)      │
│  - Image upload → Vectorization         │
│  - Vector search                        │
│  - End-to-end workflow                  │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│  4. OpenSearch Tests (Bash)             │
│  - Cluster health                       │
│  - Mapping verification                 │
│  - KNN search                           │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│  5. E2E Tests (Playwright)              │
│  - UI interaction                       │
│  - Cross-browser testing                │
│  - Performance validation               │
└─────────────────────────────────────────┘
```

---

## Test Coverage Goals

| Category | Target | Current |
|----------|--------|---------|
| Line Coverage | 80%+ | TBD |
| Branch Coverage | 75%+ | TBD |
| Function Coverage | 85%+ | TBD |
| Flaky Tests | 0 | 0 |

---

## Environment Variables

### Required

- `OPENSEARCH_ENDPOINT` - OpenSearchエンドポイントURL
  - VPC: `vpc-cis-filesearch-opensearch-*.ap-northeast-1.es.amazonaws.com`

### Optional

- `VPC_MODE` - VPC環境フラグ（true/false）
- `BASE_URL` - APIベースURL（デフォルト: http://localhost:3000）
- `INDEX_NAME` - OpenSearchインデックス名（デフォルト: files）
- `AWS_ACCESS_KEY_ID` - AWS認証情報
- `AWS_SECRET_ACCESS_KEY` - AWS認証情報
- `AWS_REGION` - AWSリージョン（デフォルト: us-east-1）

---

## Troubleshooting

### テスト画像が見つからない

```bash
bash e2e/fixtures/create-test-images.sh
```

### OpenSearchに接続できない

**ローカル環境**:
- VPC内のEC2から実行
- またはSSHトンネル経由でアクセス

**VPC環境**:
- セキュリティグループを確認
- IAMロールを確認

### Bedrock認証エラー

```bash
# .env.local に追加
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-east-1
```

または `route.ts` で `USE_MOCK_MODE=true` に設定

---

## Example Output

### Successful Test Run

```
╔════════════════════════════════════════════════════════╗
║  Image Search Integration Test Suite                  ║
╚════════════════════════════════════════════════════════╝

📤 Test 1: Image Upload & Vectorization
==========================================

[1-1] Uploading valid JPEG image...
  ✓ HTTP status should be 200
  ✓ Response should have success=true
  ✓ Embedding should be an array
  ✓ Embedding should have 1024 dimensions

🔍 Test 2: Image Vector Search
==============================

[2-1] Performing image vector search...
  ✓ HTTP status should be 200
  ✓ Response should contain data

╔════════════════════════════════════════════════════════╗
║  Test Summary                                          ║
╚════════════════════════════════════════════════════════╝

Total tests: 25
Passed: 25
Failed: 0
Skipped: 0

Pass rate: 100.00%

✅ All tests passed!
```

---

## Additional Resources

- [Complete Test Guide](../docs/testing/IMAGE_SEARCH_TEST_GUIDE.md)
- [Jest Documentation](https://jestjs.io/)
- [Playwright Documentation](https://playwright.dev/)
- [OpenSearch KNN Plugin](https://opensearch.org/docs/latest/search-plugins/knn/)

---

**Last Updated**: 2025-12-18
