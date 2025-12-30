# 統合検索ソリューション - テキスト検索と画像検索の両立

## 🎯 現在の状況

✅ **テキスト検索**: 復旧完了（`cis-files`インデックス使用）
❌ **画像検索**: 一時停止（`file-index-v2-knn`との統合待ち）

## 🚀 統合ソリューションの実装手順

### 方法1: デュアルインデックス戦略（推奨）

テキスト検索と画像検索で別々のインデックスを使い分ける方法：

```javascript
// Lambda関数の修正案
exports.handler = async (event) => {
  const { searchType } = JSON.parse(event.body);

  // 検索タイプによってインデックスを切り替え
  const indexName = searchType === 'image'
    ? 'file-index-v2-knn'
    : 'cis-files';

  // 検索実行...
};
```

#### 実装手順：

1. **Lambda関数の更新**
```bash
# backend/lambda-search-api/index.jsを修正
# searchTypeパラメータでインデックスを動的に選択
```

2. **フロントエンドの更新**
```typescript
// frontend/src/lib/api/search.ts
const searchFiles = async (query, options) => {
  const searchType = options.imageVector ? 'image' : 'text';
  // searchTypeをAPIに送信
};
```

### 方法2: 統合インデックス（長期的ソリューション）

既存の`cis-files`にk-NNフィールドを追加：

```bash
# EC2上で実行するスクリプト
#!/bin/bash

ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"

# 1. 既存インデックスの設定を取得
curl -X GET "$ENDPOINT/cis-files/_settings" > current-settings.json
curl -X GET "$ENDPOINT/cis-files/_mapping" > current-mapping.json

# 2. 新しいインデックスを作成（k-NN対応）
curl -X PUT "$ENDPOINT/cis-files-enhanced" \
  -H "Content-Type: application/json" \
  -d '{
  "settings": {
    "index": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "knn": true,
      "knn.algo_param.ef_search": 100
    }
  },
  "mappings": {
    "properties": {
      // 既存のフィールド +
      "image_embedding": {
        "type": "knn_vector",
        "dimension": 1024,
        "method": {
          "engine": "nmslib",
          "space_type": "cosinesimil",
          "name": "hnsw"
        }
      }
    }
  }
}'

# 3. データを移行
curl -X POST "$ENDPOINT/_reindex" \
  -H "Content-Type: application/json" \
  -d '{
    "source": {"index": "cis-files"},
    "dest": {"index": "cis-files-enhanced"}
  }'

# 4. エイリアスを切り替え
curl -X POST "$ENDPOINT/_aliases" \
  -H "Content-Type: application/json" \
  -d '{
    "actions": [
      {"remove": {"index": "cis-files", "alias": "search-index"}},
      {"add": {"index": "cis-files-enhanced", "alias": "search-index"}}
    ]
  }'
```

## 📋 即座に実行可能な対策

### オプション1: Lambda関数のクイックフィックス

```javascript
// backend/lambda-search-api/index.js の修正
const { Client } = require('@opensearch-project/opensearch');

exports.handler = async (event) => {
  const { query, searchType, imageVector } = JSON.parse(event.body || '{}');

  // 検索タイプによってインデックスを選択
  let indexName = 'cis-files'; // デフォルトはテキスト検索
  let searchBody;

  if (searchType === 'image' && imageVector) {
    indexName = 'file-index-v2-knn';
    searchBody = {
      query: {
        knn: {
          image_embedding: {
            vector: imageVector,
            k: 10
          }
        }
      }
    };
  } else {
    // テキスト検索
    searchBody = {
      query: {
        multi_match: {
          query: query,
          fields: ['file_name^2', 'content', 'file_path']
        }
      }
    };
  }

  const client = new Client({
    node: `https://${process.env.OPENSEARCH_ENDPOINT}`,
  });

  const response = await client.search({
    index: indexName,
    body: searchBody
  });

  return {
    statusCode: 200,
    body: JSON.stringify(response.body.hits)
  };
};
```

### オプション2: EC2でのインデックス統合

```bash
# EC2インスタンスにSSH接続後
aws ssm start-session --target i-083047855b68fe1c1

# スクリプトを実行
bash /tmp/ec2-unified-index-migration.sh
```

## 🔄 移行タイムライン

1. **即座（5分）**: Lambda関数のクイックフィックス
   - テキスト検索と画像検索を別インデックスで動作

2. **短期（1時間）**: デュアルインデックス戦略
   - 両方の検索を完全サポート

3. **長期（2-3時間）**: 統合インデックス
   - 単一インデックスで全機能をサポート

## ✅ 検証手順

1. **テキスト検索の確認**
```bash
curl http://localhost:3000/api/search \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"query": "test", "searchType": "text"}'
```

2. **画像検索の確認**
```bash
# フロントエンドから画像をアップロード
# または直接APIをテスト
```

## 📝 注意事項

- VPC内のOpenSearchへのアクセスはEC2経由が必要
- インデックス移行中は一時的にパフォーマンスが低下する可能性
- 本番環境では段階的な移行を推奨

## 🎉 最終目標

- ✅ テキスト検索: 高速で正確な日本語検索
- ✅ 画像検索: k-NNによる類似画像検索
- ✅ 統合UI: シームレスな検索体験