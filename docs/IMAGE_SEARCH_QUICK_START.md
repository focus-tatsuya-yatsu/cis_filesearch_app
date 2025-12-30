# 画像検索機能パフォーマンス最適化 - クイックスタートガイド

## 概要

CISファイル検索システムの画像検索機能を最適化するための実装手順を提供します。

---

## 1. 最適化ファイルの配置

以下のファイルが作成されました：

### フロントエンド（Next.js）

```
frontend/
├── src/
│   ├── services/
│   │   ├── image-processing.service.ts        # 画像処理最適化
│   │   ├── embedding-cache.service.ts         # キャッシング戦略
│   │   └── performance-monitor.service.ts     # パフォーマンス監視
│   ├── components/
│   │   └── ImageSearchOptimized.tsx           # 最適化UIコンポーネント
│   └── app/
│       └── api/
│           └── image-embedding/
│               └── route.optimized.ts          # 最適化APIルート
└── scripts/
    ├── benchmark-image-search.ts              # ベンチマークツール
    ├── load-test-config.yml                   # ロードテスト設定
    └── load-test-processor.js                 # ロードテストプロセッサー
```

### バックエンド（Lambda）

```
backend/lambda-search-api/
└── src/
    └── services/
        └── opensearch.knn.optimized.ts        # k-NN最適化
```

---

## 2. 環境変数の設定

### `.env.local` (フロントエンド)

```bash
# API Gateway URL
NEXT_PUBLIC_API_GATEWAY_URL=https://your-api-id.execute-api.ap-northeast-1.amazonaws.com/prod

# AWS設定
AWS_REGION=ap-northeast-1

# OpenSearch設定
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xxx.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index
```

### `.env.production` (バックエンドLambda)

```bash
AWS_REGION=ap-northeast-1
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xxx.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index
```

---

## 3. 最適化機能の有効化

### Step 1: 最適化APIルートに切り替え

既存の画像埋め込みAPIルートを最適化版に置き換え：

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend
mv src/app/api/image-embedding/route.ts src/app/api/image-embedding/route.old.ts
mv src/app/api/image-embedding/route.optimized.ts src/app/api/image-embedding/route.ts
```

### Step 2: UIコンポーネントを最適化版に変更

既存の画像検索コンポーネントを置き換え、または新規ページを作成：

```tsx
// src/app/image-search/page.tsx
import { ImageSearchOptimized } from '@/components/ImageSearchOptimized';

export default function ImageSearchPage() {
  return (
    <div className="container">
      <h1>画像検索</h1>
      <ImageSearchOptimized
        onSearchResults={(results) => {
          console.log('Search results:', results);
        }}
      />
    </div>
  );
}
```

### Step 3: OpenSearch k-NN最適化の適用

Lambda関数のOpenSearchサービスを最適化版に更新：

```typescript
// backend/lambda-search-api/src/services/opensearch.service.ts
import {
  buildOptimizedKNNQuery,
  buildHybridSearchQuery,
  warmupKNNIndex,
} from './opensearch.knn.optimized';

// 検索クエリ構築時に最適化関数を使用
const query = buildOptimizedKNNQuery({
  vector: imageEmbedding,
  k: 20,
  efSearch: 512,
  minScore: 0.7,
});
```

---

## 4. OpenSearchインデックス最適化

### Step 1: 最適化インデックス設定を適用

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api

# インデックステンプレート適用スクリプトを実行
node scripts/apply-knn-optimization.js
```

### Step 2: インデックスウォーミング

```bash
# Lambda関数のウォームアップ
aws lambda invoke \
  --function-name cis-search-api \
  --payload '{"warmup": true}' \
  response.json
```

---

## 5. パフォーマンステスト

### ベンチマーク実行

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

# テスト画像の準備
mkdir -p test-images
# test-imagesディレクトリにJPEG/PNG画像を配置

# ベンチマーク実行
npm run benchmark

# または
npx ts-node scripts/benchmark-image-search.ts
```

### ロードテスト実行

```bash
# Artilleryのインストール（初回のみ）
npm install -g artillery

# ロードテスト実行
export API_GATEWAY_URL=https://your-api-id.execute-api.ap-northeast-1.amazonaws.com/prod
artillery run scripts/load-test-config.yml

# レポート生成
artillery run --output report.json scripts/load-test-config.yml
artillery report report.json
```

---

## 6. パフォーマンス監視

### CloudWatchダッシュボード設定

```bash
# CloudWatchダッシュボード作成
aws cloudwatch put-dashboard \
  --dashboard-name CIS-ImageSearch-Performance \
  --dashboard-body file://cloudwatch-dashboard.json
```

### カスタムメトリクスの確認

```bash
# Lambda関数のメトリクス
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=cis-search-api \
  --statistics Average,Maximum,Minimum \
  --start-time 2025-12-17T00:00:00Z \
  --end-time 2025-12-17T23:59:59Z \
  --period 3600
```

---

## 7. 期待されるパフォーマンス改善

| メトリクス | 最適化前 | 最適化後（目標） | 改善率 |
|----------|---------|---------------|-------|
| 画像アップロード | 5秒 | 0.5秒 | 90% |
| ベクトル生成 | 2.5秒 | 2.0秒 | 20% |
| ベクトル検索 | 3秒 | 0.8秒 | 73% |
| 総レスポンス時間 | 8秒 | 1.3秒 | 84% |
| キャッシュヒット時 | - | 0.05秒 | 99% |

---

## 8. トラブルシューティング

### 問題1: 画像アップロードがエラーになる

**原因**: API Routeのボディサイズ制限

**解決策**:
```typescript
// src/app/api/image-embedding/route.ts
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb' // サイズ制限を拡大
    }
  }
};
```

### 問題2: OpenSearch接続エラー

**原因**: VPCエンドポイント設定またはIAMロール不足

**解決策**:
```bash
# Lambda関数のVPC設定を確認
aws lambda get-function --function-name cis-search-api

# IAMロールにOpenSearchアクセス権限を追加
aws iam attach-role-policy \
  --role-name cis-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonOpenSearchServiceFullAccess
```

### 問題3: キャッシュが機能しない

**原因**: IndexedDBが無効、またはストレージ容量不足

**解決策**:
```typescript
// ブラウザのIndexedDB確認
// Chrome DevTools > Application > IndexedDB > CISFileSearchDB

// キャッシュ統計の確認
const stats = await embeddingCache.getStats();
console.log('Cache stats:', stats);
```

---

## 9. 次のステップ

### 実装完了後のチェックリスト

- [ ] 最適化APIルートに切り替え完了
- [ ] UIコンポーネントを最適化版に変更
- [ ] OpenSearch k-NN設定を最適化
- [ ] ベンチマークテストを実施
- [ ] ロードテストを実施
- [ ] CloudWatch監視を設定
- [ ] パフォーマンスメトリクスを記録

### 本番デプロイ前の検証項目

- [ ] 開発環境でのパフォーマンステスト完了
- [ ] キャッシュヒット率が50%以上
- [ ] エラー率が1%未満
- [ ] P95レスポンスタイムが5秒未満
- [ ] 同時接続50ユーザーで問題なし

---

## 10. サポート

質問や問題が発生した場合は、以下のドキュメントを参照してください：

- **詳細ガイド**: `/docs/IMAGE_SEARCH_PERFORMANCE_OPTIMIZATION.md`
- **アーキテクチャ**: `/docs/architecture.md`
- **API仕様**: `/docs/api-specification.md`

---

**更新日**: 2025-12-17
**バージョン**: 1.0
