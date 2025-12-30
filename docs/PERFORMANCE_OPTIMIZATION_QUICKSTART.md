# パフォーマンス最適化 クイックスタートガイド

## 5分で始める画像検索パフォーマンス最適化

このガイドでは、最も重要な最適化を短時間で適用する方法を説明します。

---

## 前提条件

- Node.js 18+ インストール済み
- AWS認証情報設定済み
- OpenSearchエンドポイント設定済み

---

## Step 1: 依存パッケージのインストール（1分）

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

# 必要なパッケージをインストール
yarn add lru-cache
```

---

## Step 2: OpenSearch設定の最適化（2分）

### 現在のインデックス統計を確認

```bash
# ドキュメント数を確認
curl -X GET "https://$OPENSEARCH_ENDPOINT/file-index/_count" \
  --aws-sigv4 "aws:amz:$AWS_REGION:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"
```

### 最適なef_searchを設定

```bash
# ドキュメント数に応じてef_searchを設定
# 例: 100K documents以下 → ef_search=128
# 例: 100K-1M documents → ef_search=256
# 例: 1M+ documents → ef_search=512

curl -X PUT "https://$OPENSEARCH_ENDPOINT/file-index/_settings" \
  -H 'Content-Type: application/json' \
  -d '{
    "index": {
      "knn.algo_param.ef_search": 256
    }
  }'
```

---

## Step 3: キャッシュの有効化（1分）

### コードに統合

```typescript
// src/lib/api/imageSearch.ts に追加

import { vectorSearchCache } from '@/lib/cache/vector-search-cache';

export const searchByImageEmbedding = async (
  embedding: number[],
  confidenceThreshold: number = 0.9
) => {
  // キャッシュをチェック
  const cached = await vectorSearchCache.get(embedding);
  if (cached) {
    console.log('[Cache] Hit!');
    return cached.results;
  }

  // OpenSearchクエリを実行
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embedding,
      confidenceThreshold,
      searchType: 'image',
    }),
  });

  const results = await response.json();

  // 結果をキャッシュに保存
  await vectorSearchCache.set(embedding, {
    results,
    total: results.length,
    took: Date.now(),
    timestamp: Date.now(),
  });

  return results;
};
```

---

## Step 4: 画像圧縮の適用（1分）

### アップロード前に画像を圧縮

```typescript
// src/components/features/ImageUpload.tsx に追加

import { compressImage } from '@/lib/image-processing-optimizer';

const handleImageUpload = async (file: File) => {
  // 画像を圧縮
  const compressed = await compressImage(file, {
    maxWidth: 2048,
    maxHeight: 2048,
    quality: 0.85,
  });

  console.log(
    `Compression: ${compressed.originalSize} → ${compressed.compressedSize} bytes ` +
    `(${compressed.compressionRatio.toFixed(2)}x)`
  );

  // 圧縮後の画像をアップロード
  await uploadImageForEmbedding(compressed.file);
};
```

---

## Step 5: パフォーマンステスト（オプション）

```bash
# テストを実行
yarn ts-node scripts/run-performance-test.ts

# 結果を確認
cat benchmark-sequential.json
```

---

## 期待される改善効果

| 項目 | 改善前 | 改善後 | 改善率 |
|------|--------|--------|--------|
| 検索レイテンシ | 300ms | 100ms | **67%削減** |
| キャッシュヒット率 | 0% | 60% | **60%向上** |
| ネットワーク転送量 | 5MB | 1MB | **80%削減** |

---

## トラブルシューティング

### キャッシュが効かない

```typescript
// 統計を確認
const stats = vectorSearchCache.getCombinedStats();
console.log('Cache stats:', stats);
```

### レイテンシが高い

```bash
# ef_searchを下げる
curl -X PUT "https://$OPENSEARCH_ENDPOINT/file-index/_settings" \
  -H 'Content-Type: application/json' \
  -d '{"index": {"knn.algo_param.ef_search": 128}}'
```

---

## 次のステップ

より詳細な最適化については、以下のドキュメントを参照してください:

- **包括的ガイド**: `/docs/IMAGE_SEARCH_PERFORMANCE_IMPLEMENTATION_GUIDE.md`
- **OpenSearch最適化**: `/docs/OPENSEARCH_KNN_PERFORMANCE_OPTIMIZATION.md`
- **Lambda最適化**: `/backend/lambda-image-embedding/optimization.py`

---

## サポート

問題が発生した場合は、以下を確認してください:

1. 環境変数が正しく設定されているか
2. OpenSearchエンドポイントにアクセスできるか
3. AWS認証情報が有効か
4. ログにエラーがないか

すべての最適化モジュールは実装済みで、即座に使用可能です。
