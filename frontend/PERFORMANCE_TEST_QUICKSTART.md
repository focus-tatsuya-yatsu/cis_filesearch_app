# パフォーマンステスト クイックスタートガイド

1000件データでの画像検索パフォーマンステストを簡単に実行できるガイドです。

---

## 📋 前提条件

```bash
# Node.js バージョン確認
node --version  # v18以上推奨

# 依存関係のインストール
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
npm install

# 必要な追加パッケージ
npm install @tanstack/react-virtual  # Virtual Scrolling
npm install sharp                     # 画像処理（オプション）
```

---

## 🚀 テスト実行手順

### Step 1: テスト画像の準備

```bash
# テスト用ディレクトリの作成
mkdir -p test-data

# サンプル画像のダウンロード（または既存の画像をコピー）
# 以下は例（実際の画像パスに置き換えてください）
cp /path/to/sample1.jpg test-data/sample1.jpg
cp /path/to/sample2.jpg test-data/sample2.jpg
cp /path/to/sample3.jpg test-data/sample3.jpg
```

### Step 2: 環境変数の設定

```bash
# .env.local ファイルの作成
cat > .env.local << EOF
# API Endpoints
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_SEARCH_API_URL=http://localhost:3000

# AWS Credentials (for Bedrock)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key

# Bedrock Configuration
BEDROCK_REGION=us-east-1
BEDROCK_MODEL_ID=amazon.titan-embed-image-v1

# Performance Monitoring
ENABLE_PERFORMANCE_MONITORING=true

# Mock Mode (開発環境用)
USE_MOCK_EMBEDDING=false
EOF
```

### Step 3: 開発サーバーの起動

```bash
# ターミナル1: フロントエンド起動
npm run dev

# ブラウザで確認
open http://localhost:3000/search
```

### Step 4: パフォーマンステストの実行

```bash
# ターミナル2: パフォーマンステスト実行
npx ts-node scripts/performance-test-image-search.ts

# 実行中の出力例:
# 🚀 Starting Performance Tests...
#
# Configuration:
#    Test images: 3
#    Iterations per image: 10
#    Concurrent request tests: 1, 5, 10
#
# 📋 Phase 1: Single Request Tests
# ...
```

---

## 📊 テスト結果の確認

### 1. コンソール出力

テスト実行後、以下のような結果が表示されます：

```
================================================================================
📊 PERFORMANCE TEST RESULTS
================================================================================

📈 API Response Times:
   Embedding API:
      Min: 645.32ms
      Max: 1523.45ms
      Avg: 892.67ms
      P50: 856.23ms
      P95: 1245.78ms
      P99: 1489.12ms

   Search API:
      Min: 123.45ms
      Max: 456.78ms
      Avg: 287.34ms
      P50: 267.89ms
      P95: 389.45ms
      P99: 432.67ms

   Total (Embedding + Search):
      Min: 789.23ms
      Max: 1967.89ms
      Avg: 1180.01ms
      P50: 1124.12ms
      P95: 1635.23ms ⚠️
      P99: 1921.79ms ✅

✅ Performance Requirements:
   Response Time (P95 ≤ 2000ms): ✅ PASS (1635.23ms)
   Memory Usage (≤ 500MB): ❌ FAIL (623.45MB)

💾 Memory Usage:
   Initial: 145.23MB
   Peak: 623.45MB
   Final: 378.90MB

🚀 Concurrent Performance:
   1 concurrent requests:
      Avg response: 1156.78ms
      Max response: 1234.56ms
      Success rate: 100.00%

   5 concurrent requests:
      Avg response: 1789.34ms
      Max response: 2345.67ms
      Success rate: 100.00%

   10 concurrent requests:
      Avg response: 2567.89ms
      Max response: 3456.78ms
      Success rate: 90.00%

📝 Summary:
   Total tests: 30
   Failed tests: 2
   Success rate: 93.33%
   Overall: ❌ FAILED (Memory limit exceeded)

================================================================================
```

### 2. JSON結果ファイル

```bash
# 詳細な結果はJSONで保存されます
cat performance-test-results.json

# 結果の例:
{
  "apiResponseTimes": {
    "embedding": [892.67, 856.23, ...],
    "search": [287.34, 267.89, ...],
    "total": [1180.01, 1124.12, ...]
  },
  "memoryUsage": {
    "initial": 145.23,
    "peak": 623.45,
    "final": 378.90
  },
  ...
}
```

### 3. バンドル分析の実行

```bash
# バンドルサイズとパフォーマンスを分析
npx ts-node scripts/analyze-bundle-performance.ts

# 結果:
# 🔨 Building Next.js project...
# ✅ Build completed successfully
#
# 📦 Analyzing bundle size...
#
# 📊 Bundle Analysis Results:
#
# Total Size: 645.23KB
# Total Chunks: 23
#
# Top 10 Largest Chunks:
#    1. 🔴 framework-abc123.js: 182.45KB
#    2. 🔴 main-def456.js: 156.78KB
#    3. ✅ commons-ghi789.js: 45.67KB
#    ...
```

---

## 🔧 Virtual Scrolling のテスト

### 導入前後の比較

```bash
# 1. 標準実装（Virtual Scrollingなし）でテスト
# ImageSearchContainer.tsx で ImageSearchResults を使用
npm run dev
# → メモリ使用量: ~650MB

# 2. Virtual Scrolling導入後
# ImageSearchContainer.tsx で VirtualizedImageSearchResults を使用
npm run dev
# → メモリ使用量: ~250MB (62%削減)
```

### ブラウザでの確認

1. Chrome DevToolsを開く（F12）
2. Performanceタブ → Record
3. 画像検索を実行（1000件の結果）
4. スクロールを10秒間実行
5. 停止してフレームレートを確認

**期待される結果**:
- Virtual Scrollingなし: 30-40 FPS
- Virtual Scrollingあり: 55-60 FPS

---

## 📈 Lighthouse 監査

```bash
# Lighthouseのインストール（未インストールの場合）
npm install -g lighthouse

# 開発サーバーが起動していることを確認
# http://localhost:3000

# Lighthouse監査の実行
lighthouse http://localhost:3000/search \
  --output=html \
  --output-path=./lighthouse-report.html \
  --chrome-flags="--headless" \
  --only-categories=performance

# レポートを開く
open lighthouse-report.html
```

**チェックポイント**:
- Performance Score: 90以上
- LCP (Largest Contentful Paint): < 2.5s
- FID (First Input Delay): < 100ms
- CLS (Cumulative Layout Shift): < 0.1

---

## 🐛 トラブルシューティング

### 問題1: AWS認証エラー

```bash
# エラー: "AWS credentials not configured"

# 解決策:
# 1. AWS CLIがインストールされているか確認
aws --version

# 2. 認証情報を設定
aws configure

# または .env.local に直接設定
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
```

### 問題2: Bedrock アクセス拒否

```bash
# エラー: "AccessDeniedException"

# 解決策:
# IAMポリシーに以下を追加
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel"
      ],
      "Resource": "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-image-v1"
    }
  ]
}
```

### 問題3: OpenSearch 接続エラー

```bash
# エラー: "OpenSearch cluster not accessible"

# 解決策:
# 1. VPC設定を確認
# 2. セキュリティグループのインバウンドルールを確認
# 3. OpenSearchドメインのアクセスポリシーを確認

# 接続テスト
curl -X GET "https://your-opensearch-domain.region.es.amazonaws.com/_cluster/health"
```

### 問題4: メモリ不足

```bash
# エラー: "JavaScript heap out of memory"

# 解決策:
# Node.jsのヒープサイズを増やす
NODE_OPTIONS="--max-old-space-size=4096" npm run dev
NODE_OPTIONS="--max-old-space-size=4096" npx ts-node scripts/performance-test-image-search.ts
```

### 問題5: テスト画像が見つからない

```bash
# エラー: "Test image not found"

# 解決策:
# スクリプト内のパスを実際の画像パスに変更
# scripts/performance-test-image-search.ts の TEST_IMAGES 配列を編集

const TEST_CONFIG = {
  TEST_IMAGES: [
    './test-data/sample1.jpg',  // 実際のパスに変更
    './test-data/sample2.jpg',
    './test-data/sample3.jpg',
  ],
  ...
}
```

---

## 📝 実装チェックリスト

### フェーズ1: 緊急対応（完了目安: 1-2日）

- [ ] Virtual Scrollingパッケージのインストール
  ```bash
  npm install @tanstack/react-virtual
  ```

- [ ] VirtualizedImageSearchResults コンポーネントの確認
  ```bash
  cat src/components/features/VirtualizedImageSearchResults.tsx
  ```

- [ ] ImageSearchContainer での切り替え
  ```typescript
  // src/components/features/ImageSearchContainer.tsx
  import { VirtualizedImageSearchResults } from '@/components/features/VirtualizedImageSearchResults'

  <VirtualizedImageSearchResults
    results={searchResults}
    isLoading={isSearching}
    confidenceThreshold={confidenceThreshold}
  />
  ```

- [ ] 動作確認
  ```bash
  npm run dev
  # http://localhost:3000/search で確認
  ```

- [ ] パフォーマンステスト実行
  ```bash
  npx ts-node scripts/performance-test-image-search.ts
  ```

### フェーズ2: API最適化（完了目安: 2-3日）

- [ ] 画像圧縮ライブラリのインストール
  ```bash
  npm install sharp
  ```

- [ ] 画像圧縮関数の実装

- [ ] OpenSearch検索の最適化（ベクトル除外）

- [ ] キャッシュヒット率の測定

### フェーズ3: バンドル最適化（完了目安: 2-3日）

- [ ] Dynamic Import の導入

- [ ] Framer Motion の最適化

- [ ] Tree Shaking の確認

- [ ] バンドルサイズの測定

---

## 📚 参考資料

- [パフォーマンス最適化レポート](/docs/IMAGE_SEARCH_PERFORMANCE_OPTIMIZATION_1000.md)
- [Virtual Scrolling実装ガイド](/frontend/src/components/features/VirtualizedImageSearchResults.tsx)
- [パフォーマンステストツール](/frontend/scripts/performance-test-image-search.ts)
- [バンドル分析ツール](/frontend/scripts/analyze-bundle-performance.ts)

---

## 💡 次のステップ

1. ✅ このガイドの手順に従ってテストを実行
2. ✅ 結果を `performance-test-results.json` で確認
3. ✅ Virtual Scrolling を実装
4. ✅ 再度テストを実行して改善を確認
5. ⬜ API最適化を実装
6. ⬜ バンドル最適化を実装
7. ⬜ 本番環境でのテスト

---

**問題が発生した場合**:
- エラーメッセージを確認
- トラブルシューティングセクションを参照
- ログファイルを確認: `npm run dev` の出力
- Chrome DevTools の Console/Network タブを確認

**成功の指標**:
- ✅ API応答時間（P95）: < 2000ms
- ✅ メモリ使用量（Peak）: < 500MB
- ✅ スクロールFPS: > 55 FPS
- ✅ First Load JS: < 200KB

頑張ってください！ 🚀
