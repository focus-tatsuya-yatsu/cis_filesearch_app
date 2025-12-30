# Image Search E2E Testing Guide

画像検索機能の包括的なテストガイド

## 目次

1. [概要](#概要)
2. [テスト戦略](#テスト戦略)
3. [テスト環境](#テスト環境)
4. [テストの種類](#テストの種類)
5. [実行方法](#実行方法)
6. [トラブルシューティング](#トラブルシューティング)

---

## 概要

このドキュメントは、CIS File Search Applicationの画像検索機能に対する包括的なE2Eテストの実行方法を説明します。

### テスト対象

- **画像アップロードAPI** (`/api/image-embedding`)
  - AWS Bedrock Titan Multimodal Embeddingsを使用したベクトル化
  - 入力バリデーション（ファイルタイプ、サイズ）
  - エラーハンドリング

- **検索API** (`/api/search`)
  - ベクトル類似度検索
  - OpenSearch KNN検索
  - フィルタリング機能

- **エンドツーエンドワークフロー**
  - 画像アップロード → ベクトル化 → 検索 → 結果表示

---

## テスト戦略

### Test Pyramid

```
        ┌─────────────┐
        │   E2E (10%) │  ← Playwright
        └─────────────┘
       ┌───────────────┐
       │Integration(20%)│  ← API Route Tests
       └───────────────┘
      ┌─────────────────┐
      │   Unit (70%)    │  ← Jest + React Testing Library
      └─────────────────┘
```

### カバレッジ目標

- **Line Coverage**: 80%+
- **Branch Coverage**: 75%+
- **Function Coverage**: 85%+
- **Zero Flaky Tests**

---

## テスト環境

### ローカル環境

- **OS**: macOS / Linux
- **Node.js**: 20.x+
- **Package Manager**: yarn
- **必要なサービス**:
  - Next.js Dev Server (localhost:3000)
  - (Optional) AWS Bedrock Access

### VPC環境（EC2）

- **インスタンスタイプ**: t3.medium以上推奨
- **VPC**: OpenSearchエンドポイントと同一VPC
- **セキュリティグループ**: OpenSearchへのアクセス許可
- **必要なソフトウェア**:
  - Node.js, yarn, git, curl, jq

---

## テストの種類

### 1. Unit Tests (Jest)

APIルートの単体テスト

```bash
# 全てのユニットテスト実行
yarn test:unit

# 画像検索関連のテストのみ
yarn test:image-search

# カバレッジレポート付き
yarn test:coverage
```

**テストファイル**:
- `/src/app/api/image-embedding/route.test.ts`
- `/src/app/api/search/__tests__/route.test.ts`

**テスト内容**:
- ✅ Valid JPEG/PNG upload
- ✅ File size validation (5MB limit)
- ✅ File type validation
- ✅ Bedrock API error handling
- ✅ Vector data integrity
- ✅ Pagination validation

---

### 2. Integration Tests (TypeScript)

APIエンドポイント間の統合テスト

```bash
# ローカル環境で実行
yarn test:image-integration

# VPC環境で実行（EC2内）
yarn test:image-integration:vpc
```

**テストファイル**:
- `/scripts/test-image-search-integration.ts`

**テストフロー**:
```
1. 画像アップロード
   ↓
2. ベクトル化（1024次元）
   ↓
3. OpenSearch KNN検索
   ↓
4. 結果検証
```

**テスト項目**:
- ✅ Upload → Vectorization workflow
- ✅ Vector dimension validation (1024)
- ✅ Search with image embedding
- ✅ Pagination & filtering
- ✅ Performance benchmarks

---

### 3. OpenSearch Integration Tests (Bash)

OpenSearchの設定とKNN検索機能のテスト

```bash
# ローカル（プロキシ経由）
yarn test:opensearch

# VPC内（直接アクセス）
yarn test:opensearch:vpc
```

**テストファイル**:
- `/scripts/test-opensearch-image-search.sh`

**テスト項目**:
- ✅ Cluster health check
- ✅ Index mapping verification
- ✅ `image_embedding` field exists
- ✅ Field type: `knn_vector`
- ✅ Dimension: 1024
- ✅ KNN search query execution
- ✅ Filter combination

---

### 4. E2E Tests (Playwright)

ブラウザベースのエンドツーエンドテスト

```bash
# 全てのE2Eテスト実行
yarn test:e2e

# UIモード（インタラクティブ）
yarn test:e2e:ui

# デバッグモード
yarn test:e2e:debug

# レポート表示
yarn test:e2e:report
```

**テストファイル**:
- `/e2e/image-search.spec.ts`

**テストシナリオ**:
- ✅ Image upload via file selection
- ✅ Image upload via drag & drop
- ✅ File validation (type, size)
- ✅ Search results display
- ✅ Confidence score filtering (90%+)
- ✅ Combined text + image search
- ✅ AND/OR search mode toggle
- ✅ Error handling & retry logic
- ✅ Performance (< 15s)
- ✅ Cross-browser compatibility
- ✅ Keyboard navigation
- ✅ ARIA labels

---

## 実行方法

### ローカル環境でのテスト実行

#### 前提条件

```bash
# 依存関係のインストール
yarn install

# テスト画像の生成
bash e2e/fixtures/create-test-images.sh

# (Optional) Playwright ブラウザのインストール
yarn playwright:install
```

#### 1. 全テスト実行（推奨）

```bash
# 開発サーバーを起動
yarn dev

# 別のターミナルで全テスト実行
yarn test:all
```

#### 2. 個別テスト実行

```bash
# ユニットテストのみ
yarn test:unit

# 統合テストのみ
yarn test:image-integration

# E2Eテストのみ
yarn test:e2e
```

---

### VPC環境（EC2）でのテスト実行

#### EC2インスタンスへの接続

```bash
# SSHでEC2に接続
ssh -i ~/.ssh/your-key.pem ec2-user@<EC2_PUBLIC_IP>

# プロジェクトディレクトリに移動
cd /path/to/cis_filesearch_app/frontend
```

#### 全VPCテスト実行

```bash
# 一括実行スクリプト（推奨）
./scripts/run-tests-vpc.sh
```

このスクリプトは以下を自動実行します：
1. 前提条件のチェック（Node.js, yarn, curl, jq）
2. OpenSearch接続テスト
3. 画像検索統合テスト
4. (Optional) E2Eテスト

#### 個別テスト実行（VPC）

```bash
# OpenSearchテストのみ
VPC_MODE=true yarn test:opensearch:vpc

# 統合テストのみ
VPC_MODE=true yarn test:image-integration:vpc
```

---

## テストコマンド一覧

### 基本テストコマンド

| コマンド | 説明 | 環境 |
|---------|------|------|
| `yarn test` | Jest全テスト実行 | Local |
| `yarn test:coverage` | カバレッジレポート付きテスト | Local |
| `yarn test:watch` | Watchモードでテスト | Local |
| `yarn test:ci` | CI環境用テスト | CI |

### 画像検索専用コマンド

| コマンド | 説明 | 環境 |
|---------|------|------|
| `yarn test:image-search` | 画像検索関連ユニットテスト | Local |
| `yarn test:image-integration` | 画像検索統合テスト | Local |
| `yarn test:image-integration:vpc` | 画像検索統合テスト（VPC） | EC2 |
| `yarn test:opensearch` | OpenSearch接続テスト | Local |
| `yarn test:opensearch:vpc` | OpenSearch接続テスト（VPC） | EC2 |

### E2Eテストコマンド

| コマンド | 説明 | 環境 |
|---------|------|------|
| `yarn test:e2e` | Playwright E2E実行 | Local |
| `yarn test:e2e:ui` | UIモードで実行 | Local |
| `yarn test:e2e:debug` | デバッグモードで実行 | Local |
| `yarn test:e2e:report` | HTMLレポート表示 | Local |

### 複合テストコマンド

| コマンド | 説明 | 環境 |
|---------|------|------|
| `yarn test:all` | 全テスト実行 | Local |
| `yarn test:all:coverage` | 全テスト（カバレッジ付き） | Local |
| `yarn test:vpc` | VPC環境一括テスト | EC2 |

---

## テスト結果の確認

### カバレッジレポート

```bash
# カバレッジレポート生成
yarn test:coverage

# HTMLレポート確認
open coverage/lcov-report/index.html
```

### E2Eテストレポート

```bash
# Playwrightレポート生成（自動）
yarn test:e2e

# HTMLレポート表示
yarn test:e2e:report
```

### CI/CD統合

GitHub Actionsでの自動テスト実行例：

```yaml
name: Image Search Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: yarn install

      - name: Run unit tests
        run: yarn test:ci

      - name: Run integration tests
        run: yarn test:image-integration

      - name: Install Playwright
        run: yarn playwright:install

      - name: Run E2E tests
        run: yarn test:e2e

      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

---

## トラブルシューティング

### 問題1: テスト画像が見つからない

**エラー**:
```
⚠️  Test images not found
```

**解決方法**:
```bash
bash e2e/fixtures/create-test-images.sh
```

---

### 問題2: OpenSearchに接続できない

**エラー**:
```
✗ Cluster health check
Connection refused
```

**解決方法（ローカル環境）**:
1. VPC内のEC2インスタンスから実行
2. または、SSHトンネル経由でアクセス：
```bash
ssh -L 9200:vpc-opensearch-endpoint:443 ec2-user@<EC2_IP>
```

**解決方法（VPC環境）**:
1. セキュリティグループの確認
2. IAMロールの確認
3. エンドポイントURLの確認

---

### 問題3: AWS Bedrock認証エラー

**エラー**:
```
AWS credentials not configured
```

**解決方法**:
```bash
# .env.local に以下を追加
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
```

または、モックモードで実行：
- `route.ts` の `USE_MOCK_MODE` を `true` に設定

---

### 問題4: Playwright ブラウザが起動しない

**エラー**:
```
Executable doesn't exist
```

**解決方法**:
```bash
yarn playwright:install
```

---

### 問題5: E2Eテストがタイムアウト

**エラー**:
```
Timeout 30000ms exceeded
```

**解決方法**:
1. `playwright.config.ts` でタイムアウトを延長
2. サーバーが起動しているか確認：
```bash
curl http://localhost:3000
```

---

## ベストプラクティス

### テスト作成時

1. **AAA パターンを使用**
   ```typescript
   // Arrange: テストデータ準備
   const file = createMockFile('test.jpg', 1024, 'image/jpeg');

   // Act: 実行
   const response = await POST(request);

   // Assert: 検証
   expect(response.status).toBe(200);
   ```

2. **明確なテスト名**
   ```typescript
   it('should return 400 when file size exceeds 5MB limit', async () => {
     // ...
   });
   ```

3. **適切なモック**
   - 外部サービス（AWS Bedrock）はモック
   - 内部ロジックは実際に実行

### テスト実行時

1. **並列実行を避ける（E2E）**
   - Playwrightは自動で並列実行
   - CI環境では `workers: 1` に設定

2. **定期的なカバレッジチェック**
   ```bash
   yarn test:coverage
   ```

3. **Flaky Testの撲滅**
   - リトライロジックを実装
   - タイムアウトを適切に設定

---

## リファレンス

### テストファイル構造

```
frontend/
├── e2e/
│   ├── fixtures/
│   │   ├── images/          # テスト用画像
│   │   └── create-test-images.sh
│   └── image-search.spec.ts # E2Eテスト
├── scripts/
│   ├── test-image-search-integration.ts
│   ├── test-opensearch-image-search.sh
│   └── run-tests-vpc.sh
├── src/
│   └── app/
│       └── api/
│           ├── image-embedding/
│           │   └── route.test.ts
│           └── search/
│               └── __tests__/
│                   └── route.test.ts
├── jest.config.js
├── playwright.config.ts
└── package.json
```

### 関連ドキュメント

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Playwright Documentation](https://playwright.dev/docs/intro)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [AWS Bedrock Titan Embeddings](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-embedding-models.html)
- [OpenSearch KNN Plugin](https://opensearch.org/docs/latest/search-plugins/knn/index/)

---

## チェックリスト

実装前に確認：

- [ ] テスト環境のセットアップ完了
- [ ] テスト画像の生成完了
- [ ] 依存関係のインストール完了
- [ ] OpenSearchエンドポイントの設定完了
- [ ] AWS認証情報の設定完了（または Mock Mode）

テスト実行前に確認：

- [ ] 開発サーバーが起動している
- [ ] OpenSearchへのアクセス可能
- [ ] テストデータが準備されている

テスト完了後に確認：

- [ ] 全テストがPass
- [ ] カバレッジ目標達成（80%+）
- [ ] Flaky Testが存在しない
- [ ] CI/CDパイプラインが正常動作

---

## お問い合わせ

テストに関する質問や問題がある場合：

1. このドキュメントを確認
2. [トラブルシューティング](#トラブルシューティング)セクションを確認
3. チームSlackチャネルで質問
4. GitHubでIssueを作成

---

**最終更新**: 2025-12-18
**作成者**: QA Engineering Team
**バージョン**: 1.0.0
