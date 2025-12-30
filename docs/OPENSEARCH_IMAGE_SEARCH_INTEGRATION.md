# OpenSearch画像検索統合ガイド

本番環境のOpenSearchと統合した画像検索APIの実装ガイド

## 概要

CIS File Search Applicationの画像検索機能は、AWS Bedrock Titan Multimodal Embeddingsモデル（1024次元ベクトル）とOpenSearchのk-NN（k-nearest neighbor）プラグインを使用して実装されています。

### アーキテクチャ

```
ユーザー → Next.js Frontend → /api/image-embedding → Bedrock Titan (1024次元ベクトル化)
                           ↓
                      /api/search → API Gateway → Lambda Search API → OpenSearch k-NN
                           ↓
                      類似画像結果を返却
```

## 1. OpenSearchインデックスマッピング

### 1.1 インデックス作成

OpenSearchに画像ベクトル検索対応のインデックスを作成します。

```bash
# OpenSearchエンドポイント
export OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh5x3uqe.ap-northeast-1.es.amazonaws.com"

# インデックスマッピングを作成
curl -X PUT "${OPENSEARCH_ENDPOINT}/file-index-v2" \
  -H 'Content-Type: application/json' \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  -d '{
  "settings": {
    "index": {
      "number_of_shards": 2,
      "number_of_replicas": 1,
      "knn": true,
      "knn.algo_param.ef_search": 512,
      "refresh_interval": "10s"
    },
    "analysis": {
      "analyzer": {
        "japanese_analyzer": {
          "type": "custom",
          "tokenizer": "kuromoji_tokenizer",
          "filter": [
            "kuromoji_baseform",
            "kuromoji_part_of_speech",
            "cjk_width",
            "ja_stop",
            "lowercase"
          ]
        }
      },
      "filter": {
        "ja_stop": {
          "type": "stop",
          "stopwords": "_japanese_"
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "file_name": {
        "type": "text",
        "analyzer": "japanese_analyzer",
        "fields": {
          "keyword": {
            "type": "keyword",
            "ignore_above": 256
          }
        }
      },
      "file_path": {
        "type": "text",
        "analyzer": "japanese_analyzer",
        "fields": {
          "keyword": {
            "type": "keyword",
            "ignore_above": 2048
          }
        }
      },
      "file_type": {
        "type": "keyword"
      },
      "file_size": {
        "type": "long"
      },
      "processed_at": {
        "type": "date"
      },
      "extracted_text": {
        "type": "text",
        "analyzer": "japanese_analyzer"
      },
      "s3_key": {
        "type": "keyword"
      },
      "image_embedding": {
        "type": "knn_vector",
        "dimension": 1024,
        "method": {
          "name": "hnsw",
          "space_type": "cosinesimil",
          "engine": "lucene",
          "parameters": {
            "ef_construction": 512,
            "m": 16
          }
        }
      },
      "has_image_embedding": {
        "type": "boolean"
      }
    }
  }
}'
```

### 1.2 インデックスマッピングの説明

#### `image_embedding` フィールド

- **type**: `knn_vector` - k-NN検索に対応したベクトル型
- **dimension**: `1024` - Bedrock Titan Multimodal Embeddingsの出力次元
- **method.name**: `hnsw` - Hierarchical Navigable Small World アルゴリズム
- **space_type**: `cosinesimil` - コサイン類似度（正規化済みベクトルに最適）
- **engine**: `lucene` - OpenSearch 2.xではLuceneエンジンを推奨
- **ef_construction**: `512` - インデックス構築時の精度パラメータ（高いほど精度向上）
- **m**: `16` - グラフの接続数（メモリとパフォーマンスのバランス）

#### パフォーマンスチューニング

```json
{
  "settings": {
    "index.knn.algo_param.ef_search": 512
  }
}
```

- **ef_search**: 検索時の精度パラメータ（デフォルト: 512）
  - 高い値 → 精度向上、レイテンシ増加
  - 低い値 → 高速、精度低下
  - 推奨範囲: 100-1000

### 1.3 インデックスの確認

```bash
# マッピングを確認
curl -X GET "${OPENSEARCH_ENDPOINT}/file-index-v2/_mapping" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}"

# インデックス設定を確認
curl -X GET "${OPENSEARCH_ENDPOINT}/file-index-v2/_settings" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}"
```

## 2. 画像ベクトル化API

### 2.1 エンドポイント

**POST** `/api/image-embedding`

画像ファイルをアップロードし、AWS Bedrock Titan Multimodal Embeddingsで1024次元のベクトルに変換します。

### 2.2 リクエスト

```typescript
// Content-Type: multipart/form-data
const formData = new FormData();
formData.append('image', imageFile); // File object (JPEG, PNG)

const response = await fetch('/api/image-embedding', {
  method: 'POST',
  body: formData,
});
```

### 2.3 レスポンス

```typescript
interface ImageEmbeddingResponse {
  success: true;
  data: {
    embedding: number[];      // 1024次元ベクトル
    dimensions: number;       // 1024
    fileName: string;
    fileSize: number;
    fileType: string;
    cached: boolean;          // キャッシュヒットフラグ
  };
}
```

### 2.4 エラーレスポンス

```typescript
interface ImageEmbeddingError {
  error: string;
  code: 'MISSING_IMAGE' | 'FILE_TOO_LARGE' | 'INVALID_FILE_TYPE'
      | 'MISSING_CREDENTIALS' | 'ACCESS_DENIED' | 'INTERNAL_ERROR';
  message?: string;
}
```

### 2.5 制限事項

- **最大ファイルサイズ**: 5MB
- **対応形式**: JPEG, PNG
- **Bedrockリージョン**: us-east-1（Titan Multimodal専用）

## 3. 画像検索API

### 3.1 エンドポイント

**POST** `/api/search`

画像ベクトルを使ってOpenSearchで類似画像を検索します。

### 3.2 リクエスト

```typescript
const response = await fetch('/api/search', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    imageEmbedding: embedding,  // 1024次元ベクトル
    searchMode: 'or',           // 'and' | 'or'
    fileType: 'image',          // オプション: ファイルタイプフィルター
    page: 1,
    size: 20,
    sortBy: 'relevance',
    sortOrder: 'desc',
  }),
});
```

### 3.3 レスポンス

```typescript
interface SearchResponse {
  success: true;
  data: {
    results: SearchResult[];
    pagination: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
    query: {
      searchType: 'image';
      searchMode: 'and' | 'or';
      fileType?: string;
      sortBy: string;
      sortOrder: string;
    };
    took: number;  // 検索時間（ms）
  };
}

interface SearchResult {
  id: string;
  fileName: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  modifiedDate: string;
  snippet: string;
  relevanceScore: number;  // コサイン類似度スコア（0-1）
}
```

## 4. Lambda Search API実装

### 4.1 画像検索クエリ構造

Lambda関数（`/backend/lambda-search-api/src/services/opensearch.service.enhanced.ts`）では、以下のクエリを使用します:

#### シンプルなk-NN検索（フィルターなし）

```typescript
{
  query: {
    knn: {
      image_embedding: {
        vector: imageEmbedding,  // 1024次元ベクトル
        k: 50,                   // 候補数（size * 3以上を推奨）
      },
    },
  },
  size: 20,
  from: 0,
}
```

#### フィルター付きk-NN検索

```typescript
{
  query: {
    bool: {
      must: [
        {
          script_score: {
            query: {
              bool: {
                filter: [
                  { term: { file_type: 'image' } },
                  { range: { processed_at: { gte: '2024-01-01' } } },
                ],
              },
            },
            script: {
              source: 'knn_score',
              lang: 'knn',
              params: {
                field: 'image_embedding',
                query_value: imageEmbedding,
                space_type: 'cosinesimil',
              },
            },
          },
        },
      ],
    },
  },
  size: 20,
  from: 0,
}
```

### 4.2 類似度スコアの解釈

OpenSearchのコサイン類似度スコアは0から1の範囲:

- **0.95-1.0**: ほぼ同一の画像
- **0.85-0.95**: 非常に類似
- **0.75-0.85**: 類似
- **0.60-0.75**: やや類似
- **0.00-0.60**: 類似度低い

### 4.3 パフォーマンス最適化

```typescript
// k値の設定: size * 3以上を推奨
const k = Math.max(size * 3, 50);

// ef_searchの動的調整
if (requireHighAccuracy) {
  // 高精度検索（レイテンシ増加）
  await client.indices.putSettings({
    index: 'file-index-v2',
    body: {
      'index.knn.algo_param.ef_search': 1000,
    },
  });
} else {
  // 高速検索（精度低下）
  await client.indices.putSettings({
    index: 'file-index-v2',
    body: {
      'index.knn.algo_param.ef_search': 200,
    },
  });
}
```

## 5. 環境変数設定

### 5.1 Frontend（Next.js）

```env
# ========================================
# API Gateway Configuration
# ========================================
NEXT_PUBLIC_API_GATEWAY_URL=https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search

# ========================================
# AWS Bedrock Configuration
# ========================================
BEDROCK_MODEL_ID=amazon.titan-embed-image-v1
BEDROCK_REGION=us-east-1
USE_MOCK_EMBEDDING=false

# ========================================
# OpenSearch Configuration
# ========================================
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh5x3uqe.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index-v2
```

### 5.2 Lambda Search API

Terraform（`/terraform/lambda_search_api.tf`）で自動設定:

```hcl
environment {
  variables = {
    OPENSEARCH_ENDPOINT = "https://${aws_opensearch_domain.main.endpoint}"
    OPENSEARCH_INDEX    = "file-index-v2"
    AWS_REGION          = "ap-northeast-1"
    LOG_LEVEL           = "info"
  }
}
```

## 6. デプロイメント

### 6.1 Lambda関数のビルドとデプロイ

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api

# 依存関係のインストール
npm install

# ビルドとパッケージング
npm run package

# Lambdaにデプロイ
aws lambda update-function-code \
  --function-name cis-search-api-production \
  --zip-file fileb://lambda-deployment.zip \
  --region ap-northeast-1
```

### 6.2 Terraformでのデプロイ

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/terraform

# Lambda関数をデプロイ
terraform apply -target=aws_lambda_function.search_api_prod
```

## 7. テストと検証

### 7.1 画像ベクトル化のテスト

```bash
# テスト画像をアップロード
curl -X POST "https://your-frontend-domain.com/api/image-embedding" \
  -F "image=@test-image.jpg" \
  | jq .
```

期待されるレスポンス:

```json
{
  "success": true,
  "data": {
    "embedding": [0.123, -0.456, ...],
    "dimensions": 1024,
    "fileName": "test-image.jpg",
    "fileSize": 245678,
    "fileType": "image/jpeg",
    "cached": false
  }
}
```

### 7.2 画像検索のテスト

```bash
# 画像ベクトルで検索
curl -X POST "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search" \
  -H "Content-Type: application/json" \
  -d '{
    "imageEmbedding": [0.123, -0.456, ...],
    "size": 10
  }' \
  | jq .
```

### 7.3 OpenSearchへの直接クエリテスト

```bash
# k-NN検索のテスト
curl -X POST "${OPENSEARCH_ENDPOINT}/file-index-v2/_search" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {
      "knn": {
        "image_embedding": {
          "vector": [0.1, 0.2, ..., 0.9],
          "k": 10
        }
      }
    },
    "size": 10
  }' | jq .
```

## 8. モニタリングとトラブルシューティング

### 8.1 CloudWatch Logs

```bash
# Lambda関数のログを確認
aws logs tail /aws/lambda/cis-search-api-production \
  --follow \
  --region ap-northeast-1
```

### 8.2 OpenSearchのパフォーマンスメトリクス

```bash
# クラスターステータス
curl -X GET "${OPENSEARCH_ENDPOINT}/_cluster/health" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"

# k-NNプラグインの統計
curl -X GET "${OPENSEARCH_ENDPOINT}/_plugins/_knn/stats" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"
```

### 8.3 よくある問題と解決策

#### 問題1: 503 Service Unavailable

**原因**: OpenSearchクラスターが初期化中、またはVPC設定の問題

**解決策**:
```bash
# クラスターステータスを確認
aws opensearch describe-domain \
  --domain-name cis-filesearch-opensearch \
  --region ap-northeast-1

# Lambda関数がVPC内にあることを確認
aws lambda get-function-configuration \
  --function-name cis-search-api-production \
  --region ap-northeast-1 \
  | jq .VpcConfig
```

#### 問題2: 検索結果が0件

**原因**: インデックスにデータがない、または`image_embedding`フィールドがnull

**解決策**:
```bash
# インデックスのドキュメント数を確認
curl -X GET "${OPENSEARCH_ENDPOINT}/file-index-v2/_count" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"

# image_embeddingが存在するドキュメントを確認
curl -X GET "${OPENSEARCH_ENDPOINT}/file-index-v2/_search" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {
      "exists": {
        "field": "image_embedding"
      }
    }
  }'
```

#### 問題3: 検索が遅い

**原因**: `ef_search`が高すぎる、またはk値が大きすぎる

**解決策**:
```typescript
// k値を調整（size * 2程度に減らす）
const k = size * 2;

// ef_searchを下げる（精度とのトレードオフ）
await client.indices.putSettings({
  index: 'file-index-v2',
  body: {
    'index.knn.algo_param.ef_search': 256,
  },
});
```

## 9. セキュリティ考慮事項

### 9.1 IAMロール権限

Lambda関数には以下の権限が必要:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "es:ESHttpGet",
        "es:ESHttpPost",
        "es:ESHttpHead"
      ],
      "Resource": "arn:aws:es:ap-northeast-1:ACCOUNT_ID:domain/cis-filesearch-opensearch/*"
    }
  ]
}
```

### 9.2 OpenSearchアクセスポリシー

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::ACCOUNT_ID:role/cis-lambda-search-api-role-production"
      },
      "Action": "es:*",
      "Resource": "arn:aws:es:ap-northeast-1:ACCOUNT_ID:domain/cis-filesearch-opensearch/*"
    }
  ]
}
```

### 9.3 VPCセキュリティグループ

Lambda関数とOpenSearchが同じVPC内に配置され、適切なセキュリティグループルールが設定されていることを確認:

```hcl
# Lambda → OpenSearch (HTTPS)
resource "aws_security_group_rule" "opensearch_from_lambda_search" {
  type                     = "ingress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  security_group_id        = aws_security_group.opensearch.id
  source_security_group_id = aws_security_group.lambda_search_api.id
}
```

## 10. パフォーマンスベンチマーク

### 10.1 目標レイテンシ

- **画像ベクトル化（Bedrock）**: < 2秒
- **k-NN検索（OpenSearch）**: < 500ms
- **エンドツーエンド**: < 3秒

### 10.2 スループット

- **同時リクエスト**: 最大10（Lambda予約同時実行数）
- **画像キャッシュヒット率**: 目標 > 30%

### 10.3 ベンチマークコマンド

```bash
# 負荷テスト（Apache Bench）
ab -n 100 -c 10 \
  -p request-body.json \
  -T "application/json" \
  "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search"
```

## 参考資料

- [AWS Bedrock Titan Multimodal Embeddings](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-multimodal-models.html)
- [OpenSearch k-NN Plugin](https://opensearch.org/docs/latest/search-plugins/knn/index/)
- [HNSW Algorithm](https://arxiv.org/abs/1603.09320)
- [Lambda VPC Configuration](https://docs.aws.amazon.com/lambda/latest/dg/configuration-vpc.html)
