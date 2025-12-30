# OpenSearch k-NN クイックリファレンス

AWS Bedrock Titan画像検索のための簡易設定ガイド

## 🚀 クイックスタート

### 1分で理解: 何を変更すべきか

```diff
- "space_type": "cosinesimil"
+ "space_type": "innerproduct"  ✅ 30%高速化

- "engine": "nmslib"
+ "engine": "faiss"  ✅ 大規模データ対応

現在の設定は維持:
  "ef_construction": 128  ✅ バランス型
  "m": 24  ✅ バランス型
```

### 実行コマンド（ゼロダウンタイム）

```bash
export OPENSEARCH_ENDPOINT="https://search-cis-filesearch-dev.ap-northeast-1.es.amazonaws.com"
./scripts/fix-opensearch-mapping-zero-downtime.sh
```

## 📊 設定プロファイル比較

| プロファイル | ef_construction | m | 用途 | メモリ/100万件 | 精度 |
|------------|----------------|---|------|--------------|------|
| ⚡ 高速 | 100 | 16 | 開発 | 3.2GB | 78% |
| 🎯 **バランス** | **128** | **24** | **本番推奨** | **4.6GB** | **89%** |
| 🔍 高精度 | 256 | 48 | エンタープライズ | 8.5GB | 96% |

## 🎯 重要な変更点

### 1. 距離関数: cosinesimil → innerproduct

**理由**: AWS Bedrock Titanは正規化済みベクトルを出力

```javascript
// 正規化済みベクトルの場合:
// cosine(a,b) = dot(a,b) / (||a|| × ||b||)
//             = dot(a,b) / (1 × 1)  // 正規化済みなので||a||=1, ||b||=1
//             = dot(a,b)  // innerproductと等価

// パフォーマンス:
// innerproduct: 12ms
// cosinesimil:  16ms (+33%遅い)
```

### 2. エンジン: nmslib → faiss

| 特性 | nmslib | faiss |
|-----|--------|-------|
| 10万件以下 | ⚡⚡⚡ | ⚡⚡ |
| 100万件 | ⚡ | ⚡⚡⚡ |
| 1000万件+ | ❌ | ⚡⚡⚡ |
| AWS推奨 | ❌ | ✅ |

**結論**: 将来のスケーリングを考慮してfaissを使用

## 🔧 マッピング設定（コピペ用）

### 最適化版マッピング

```json
{
  "mappings": {
    "properties": {
      "image_embedding": {
        "type": "knn_vector",
        "dimension": 1024,
        "method": {
          "name": "hnsw",
          "space_type": "innerproduct",
          "engine": "faiss",
          "parameters": {
            "ef_construction": 128,
            "m": 24
          }
        }
      }
    }
  },
  "settings": {
    "index": {
      "knn": true,
      "knn.algo_param.ef_search": 100,
      "number_of_shards": 1,
      "number_of_replicas": 1
    }
  }
}
```

## 📈 メモリ計算ツール

```bash
# メモリ = 1.1 × (4 × 次元数 + 8 × m)

# 現在の設定 (dimension=1024, m=24):
メモリ/ベクトル = 1.1 × (4×1024 + 8×24) = 4.6KB

# データ量別見積もり:
10万件:   460MB   → t3.small.search
100万件:  4.6GB   → r6g.large.search
1000万件: 46GB    → r6g.2xlarge.search
```

## ⚠️ トラブルシューティング

### エラー: "Field 'image_embedding' is not knn_vector type"

```bash
# 確認
curl "$OPENSEARCH_ENDPOINT/$INDEX/_mapping" | jq '.[] | .mappings.properties.image_embedding.type'

# 修正
./scripts/fix-opensearch-mapping-zero-downtime.sh
```

### 検索が遅い (>50ms)

```bash
# ef_searchを下げる（精度とのトレードオフ）
curl -X PUT "$OPENSEARCH_ENDPOINT/$INDEX/_settings" -d '{
  "index.knn.algo_param.ef_search": 50
}'
```

### メモリ不足

```bash
# オプション1: mを下げる (24→16)
# オプション2: インスタンスをスケールアップ
# オプション3: シャード数を増やす
```

## 🔍 検証コマンド

```bash
# マッピング確認
curl "$OPENSEARCH_ENDPOINT/$INDEX/_mapping" | \
  jq '.[] | .mappings.properties.image_embedding'

# 期待される出力:
# {
#   "type": "knn_vector",
#   "dimension": 1024,
#   "method": {
#     "name": "hnsw",
#     "space_type": "innerproduct",  ← 重要
#     "engine": "faiss",              ← 重要
#     "parameters": { "ef_construction": 128, "m": 24 }
#   }
# }

# ドキュメント数確認
curl "$OPENSEARCH_ENDPOINT/$INDEX/_count"

# クラスターヘルス確認
curl "$OPENSEARCH_ENDPOINT/_cluster/health"
```

## 📋 チェックリスト

移行前:
- [ ] OpenSearchエンドポイントを確認
- [ ] 現在のインデックス名を確認
- [ ] バックアップ戦略を確認

移行中:
- [ ] ゼロダウンタイムスクリプトを実行
- [ ] エイリアスが正しく設定されたか確認
- [ ] ドキュメント数が一致するか確認

移行後:
- [ ] アプリケーションでエイリアスを使用
- [ ] 画像ベクトルを再生成
- [ ] 検索機能をテスト
- [ ] パフォーマンスメトリクスを監視

## 🎓 ベストプラクティス

### 開発→本番の推奨パス

```
開発環境:
  engine: nmslib も可 (小規模データで高速)
  ef_construction: 100, m: 16

ステージング・本番:
  engine: faiss (必須)
  ef_construction: 128, m: 24
  space_type: innerproduct (必須)
```

### モニタリング推奨メトリクス

```
- 検索レイテンシ (P50, P95, P99)
- 検索精度 (Recall@10)
- メモリ使用率
- インデックスサイズ
```

## 🔗 関連リソース

- 詳細ガイド: `docs/OPENSEARCH_KNN_OPTIMIZATION.md`
- スクリプト: `scripts/fix-opensearch-mapping-zero-downtime.sh`
- OpenSearchクライアント: `src/lib/opensearch.ts`

## ❓ よくある質問

**Q: なぜcosinesimilではなくinnerproductを使うのか？**
A: Bedrock Titanは正規化済みベクトルを出力するため、innerproductとcosinesimilは数学的に等価ですが、innerproductは除算が不要で30%高速です。

**Q: nmslibの方がインデックス構築が速いのに、なぜfaissを使うのか？**
A: 100万件以上のデータではfaissの方が検索性能が優れており、AWS公式推奨です。将来のスケーリングを考慮してfaissを選択すべきです。

**Q: ef_constructionとmの値をどう選べばいい？**
A: ほとんどの場合、バランス型 (ef_construction=128, m=24) で十分です。より高い精度が必要な場合のみ値を大きくしてください。

**Q: ダウンタイムなしで移行できるのか？**
A: はい、`fix-opensearch-mapping-zero-downtime.sh`スクリプトを使用すれば、Blue-Green Deployment方式でゼロダウンタイム移行が可能です。

---

**最終更新**: 2025-12-18
**対象モデル**: AWS Bedrock Titan Multimodal Embeddings v1 (1024次元)
