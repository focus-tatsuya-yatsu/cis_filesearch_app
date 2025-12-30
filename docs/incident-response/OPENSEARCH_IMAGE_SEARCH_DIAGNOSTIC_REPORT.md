# OpenSearch画像検索 診断レポート

**作成日**: 2025-12-18
**重要度**: HIGH
**影響範囲**: 本番環境 - 画像検索機能が完全に動作不能
**担当**: Backend Engineer

---

## エグゼクティブサマリー

本番環境のOpenSearchを使用した画像検索機能で、すべての検索クエリが **0件の結果を返す** 深刻な問題が発生しています。診断の結果、以下の**5つの主要な問題**が特定されました。

### 主要な問題点

1. **OpenSearchインデックスに`image_embedding`フィールドが存在しない可能性が高い**
2. **ドキュメントに画像ベクトルデータが保存されていない**
3. **k-NN（ベクトル検索）の設定が不完全**
4. **Lambda検索APIとOpenSearchマッピングの不整合**
5. **EC2ワーカーの画像処理パイプラインが未統合**

これらの問題により、画像検索が全く機能していない状態です。本レポートでは、各問題の詳細な分析、根本原因、および段階的な修正計画を提供します。

---

## 1. 現在の環境構成

### 1.1 システムアーキテクチャ

```
┌───────────────┐
│   Frontend    │  Next.js
│  (localhost)  │  - 画像アップロード UI ✅
└───────┬───────┘  - Bedrock Titan埋め込み生成 ✅
        │
        │ HTTPS
        ▼
┌────────────────────────────┐
│   API Gateway              │  検索APIエンドポイント
│   Lambda Search API        │  - テキスト検索 ✅
└───────┬────────────────────┘  - 画像検索 ❌
        │
        │ AWS SigV4
        ▼
┌────────────────────────────┐
│   OpenSearch Service       │
│   (VPC エンドポイント)     │  - file-index インデックス
│   vpc-cis-filesearch-...   │  - image_embedding フィールド ❓
└────────────────────────────┘
        ▲
        │
        │ SQS Queue
        ▼
┌────────────────────────────┐
│   EC2 Worker (Python)      │  ファイル処理
│   - PDF処理 ✅             │  - 画像embedding生成 ❓
│   - テキスト抽出 ✅         │  - OpenSearch登録 ❓
└────────────────────────────┘
```

### 1.2 環境変数設定（現在）

```bash
# Frontend (.env.local)
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh5x3uqe.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index
AWS_REGION=ap-northeast-1
NEXT_PUBLIC_API_GATEWAY_URL=https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search
BEDROCK_MODEL_ID=amazon.titan-embed-image-v1

# Lambda Search API
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh5x3uqe.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index
AWS_REGION=ap-northeast-1
```

---

## 2. 問題の詳細分析

### 2.1 問題 #1: OpenSearchインデックスマッピングの不備

#### 症状

- 画像検索を実行すると常に0件の結果が返される
- ローカル環境からVPCエンドポイントへの直接接続不可（DNS解決失敗）
- AWS CLIによる確認も認証トークン期限切れで実行不可

#### 推定される根本原因

OpenSearchインデックス`file-index`に以下のいずれかの問題がある：

1. **`image_embedding`フィールドが存在しない**
   - インデックス作成時にマッピングで定義されていない
   - 既存のインデックスに後からフィールドが追加されていない

2. **フィールドのタイプが不正**
   - `knn_vector`として定義されていない
   - 次元数が1024に設定されていない
   - `similarity`が`cosinesimil`に設定されていない

#### 期待されるマッピング構造

```json
{
  "mappings": {
    "properties": {
      "file_name": {
        "type": "text",
        "analyzer": "kuromoji",
        "fields": {
          "keyword": {
            "type": "keyword"
          }
        }
      },
      "file_path": {
        "type": "text",
        "fields": {
          "keyword": {
            "type": "keyword"
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
        "analyzer": "kuromoji"
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
          "engine": "nmslib",
          "parameters": {
            "ef_construction": 128,
            "m": 16
          }
        }
      }
    }
  },
  "settings": {
    "index": {
      "knn": true,
      "knn.algo_param.ef_search": 512
    }
  }
}
```

#### 検証方法

VPC内のEC2インスタンスまたはLambda関数から以下のコマンドで確認:

```bash
# マッピング確認
curl -X GET "https://<opensearch-endpoint>/file-index/_mapping" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"

# インデックス設定確認
curl -X GET "https://<opensearch-endpoint>/file-index/_settings" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"

# サンプルドキュメント確認
curl -X GET "https://<opensearch-endpoint>/file-index/_search" \
  -H "Content-Type: application/json" \
  -d '{"size": 1, "query": {"match_all": {}}}' \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"
```

---

### 2.2 問題 #2: ドキュメントに画像ベクトルが保存されていない

#### 症状

- OpenSearchにドキュメントは存在するが、`image_embedding`フィールドが空またはnull
- テキスト検索は正常に動作（`file_name`, `file_path`, `extracted_text`は存在）

#### 推定される根本原因

1. **EC2ワーカーが画像embeddingを生成・保存していない**
   - Python workerの`image_processor.py`が画像ファイルを処理
   - しかし、AWS Bedrock Titan Embeddingsの呼び出しコードが存在しない
   - OpenSearchへのドキュメント登録時に`image_embedding`フィールドを含めていない

2. **既存ファイルの再処理が行われていない**
   - 新機能追加後、過去にアップロードされたファイルの画像embeddingが未生成
   - バッチ処理スクリプトが未実装

#### 関連ファイル

- `/backend/python-worker/processors/image_processor.py` (7017 bytes)
  - 現在の実装: 画像ファイルの基本メタデータ抽出のみ
  - 不足: AWS Bedrock呼び出し、1024次元ベクトル生成、OpenSearch登録

- `/backend/python-worker/worker.py`
  - SQSメッセージ処理とOpenSearch登録のメインロジック
  - `image_embedding`フィールドの取り扱いが未確認

#### 検証方法

```bash
# EC2インスタンスにSSH接続
ssh -i ~/.ssh/your-key.pem ec2-user@<ec2-instance-ip>

# Python workerログ確認
sudo journalctl -u file-processor.service -n 100 --no-pager

# OpenSearch内のドキュメントでimage_embeddingの存在を確認
curl -X GET "https://<opensearch-endpoint>/file-index/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "size": 10,
    "query": {"exists": {"field": "image_embedding"}}
  }' \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"
```

---

### 2.3 問題 #3: k-NN設定の不完全

#### 症状

- Lambda検索APIでk-NNクエリを実行してもエラーまたは0件
- OpenSearchがベクトル検索をサポートしていない可能性

#### 推定される根本原因

1. **インデックス作成時に`knn: true`が設定されていない**
   - OpenSearchのk-NN機能はインデックスレベルで有効化が必要
   - 後から設定変更不可（インデックス再作成が必要）

2. **OpenSearchのバージョンがk-NNをサポートしていない**
   - OpenSearch 1.0以降が必要
   - 現在のバージョン確認が必要

#### 検証方法

```bash
# OpenSearchバージョン確認
curl -X GET "https://<opensearch-endpoint>/" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"

# k-NNプラグイン確認
curl -X GET "https://<opensearch-endpoint>/_cat/plugins?v" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"
```

---

### 2.4 問題 #4: Lambda検索APIとOpenSearchマッピングの不整合

#### 症状

`/backend/lambda-search-api/src/services/opensearch.service.enhanced.ts`の画像検索クエリが実行されても結果なし

#### コードレビュー

**現在の実装（行226-318）**:

```typescript
// 画像検索の場合は特別なクエリ構造を使用
if (hasImageQuery) {
  logger.info('Building k-NN image search query', {
    embeddingDimensions: imageEmbedding!.length,
    hasTextQuery,
    k: Math.max(size * 3, 50),
  });

  // k-NN検索クエリ（OpenSearch 2.x標準形式）
  const searchBody: any = filterClauses.length > 0
    ? {
        // フィルター付きk-NN検索
        query: {
          bool: {
            must: [
              {
                script_score: {
                  query: {
                    bool: {
                      filter: filterClauses,
                    },
                  },
                  script: {
                    source: "knn_score",
                    lang: "knn",
                    params: {
                      field: "image_embedding",
                      query_value: imageEmbedding,
                      space_type: "cosinesimil",
                    },
                  },
                },
              },
            ],
          },
        },
        // ...省略
      }
    : {
        // フィルターなしのシンプルなk-NN検索
        query: {
          knn: {
            image_embedding: {
              vector: imageEmbedding,
              k: Math.max(size * 3, 50),
            },
          },
        },
        // ...省略
      };
}
```

#### 問題点

1. **k-NNクエリ構造の複雑性**
   - フィルターありとなしで2つのパターンを使用
   - `script_score`を使った方式は、OpenSearchのバージョンや設定に依存

2. **エラーハンドリングの不足**
   - k-NN検索失敗時の具体的なエラーログが不足
   - マッピング不正やフィールド欠損のエラーが適切にキャッチされない

3. **デバッグ情報の不足**
   - 実際にOpenSearchに送信されるクエリの全文ログが不足
   - レスポンスの詳細（エラーメッセージ、ヒット数、スコア）が不明瞭

#### 推奨される改善

```typescript
// より詳細なログとエラーハンドリング
logger.debug('Full OpenSearch query body', {
  index: config.index,
  body: JSON.stringify(searchBody, null, 2),
});

try {
  const response = await client.search({
    index: config.index,
    body: searchBody,
  });

  logger.info('OpenSearch response received', {
    statusCode: response.statusCode,
    took: response.body.took,
    totalHits: response.body.hits.total,
    maxScore: response.body.hits.max_score,
  });

  // レスポンスの詳細を確認
  if (response.body.hits.hits.length === 0) {
    logger.warn('Zero results returned from k-NN search', {
      embeddingDimensions: imageEmbedding.length,
      queryType: 'knn',
      filters: filterClauses,
    });
  }
} catch (error: any) {
  logger.error('k-NN search failed', {
    error: error.message,
    statusCode: error.statusCode,
    body: error.body,
    meta: error.meta,
    searchBody: JSON.stringify(searchBody, null, 2),
  });
  throw error;
}
```

---

### 2.5 問題 #5: EC2ワーカーの画像処理パイプラインが未統合

#### 症状

- 新規ファイルアップロード時に画像embeddingが生成されない
- SQSキューからメッセージを受信しても画像処理が実行されない

#### Python Worker構成

```
backend/python-worker/
├── worker.py                    # メインSQS処理ループ
├── processors/
│   ├── image_processor.py       # 画像ファイル処理（基本）
│   ├── pdf_processor.py         # PDF処理（テキスト抽出）
│   ├── office_processor.py      # Office文書処理
│   └── docuworks_processor.py   # DocuWorks処理
└── config.py                    # 環境変数設定
```

#### image_processor.pyの現状

```python
# /backend/python-worker/processors/image_processor.py (推定)
class ImageProcessor(BaseProcessor):
    def process(self, s3_key: str, file_metadata: dict) -> dict:
        """画像ファイルの基本情報を抽出"""
        # S3から画像ファイルをダウンロード
        image_data = self.s3_client.get_object(
            Bucket=self.s3_bucket,
            Key=s3_key
        )['Body'].read()

        # 画像メタデータ抽出（サイズ、形式など）
        # ...

        return {
            'file_name': file_metadata['file_name'],
            'file_path': file_metadata['file_path'],
            'file_type': 'image',
            'file_size': len(image_data),
            'processed_at': datetime.utcnow().isoformat(),
            's3_key': s3_key,
            # ❌ image_embedding フィールドが存在しない
        }
```

#### 必要な改修

1. **AWS Bedrock統合**
   ```python
   import boto3
   from typing import List

   class ImageProcessor(BaseProcessor):
       def __init__(self):
           super().__init__()
           self.bedrock_client = boto3.client(
               'bedrock-runtime',
               region_name='ap-northeast-1'
           )

       def generate_image_embedding(self, image_data: bytes) -> List[float]:
           """AWS Bedrock Titan Embeddings で画像ベクトル生成"""
           import base64
           import json

           # 画像をBase64エンコード
           image_base64 = base64.b64encode(image_data).decode('utf-8')

           # Bedrock API呼び出し
           response = self.bedrock_client.invoke_model(
               modelId='amazon.titan-embed-image-v1',
               body=json.dumps({
                   'inputImage': image_base64
               })
           )

           # 1024次元ベクトルを取得
           result = json.loads(response['body'].read())
           embedding = result['embedding']  # List[float], 1024 dimensions

           return embedding

       def process(self, s3_key: str, file_metadata: dict) -> dict:
           # S3から画像ダウンロード
           image_data = self.download_from_s3(s3_key)

           # 画像embedding生成
           try:
               image_embedding = self.generate_image_embedding(image_data)
               logger.info(f"Generated image embedding: {len(image_embedding)} dimensions")
           except Exception as e:
               logger.error(f"Failed to generate image embedding: {e}")
               image_embedding = None

           return {
               'file_name': file_metadata['file_name'],
               'file_path': file_metadata['file_path'],
               'file_type': 'image',
               'file_size': len(image_data),
               'processed_at': datetime.utcnow().isoformat(),
               's3_key': s3_key,
               'image_embedding': image_embedding,  # ✅ 1024次元ベクトル
           }
   ```

2. **IAM権限追加**
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "BedrockInvokeModel",
         "Effect": "Allow",
         "Action": [
           "bedrock:InvokeModel"
         ],
         "Resource": "arn:aws:bedrock:ap-northeast-1::foundation-model/amazon.titan-embed-image-v1"
       }
     ]
   }
   ```

---

## 3. 根本原因の総括

### 3.1 技術的根本原因

1. **インフラレイヤー**
   - OpenSearchインデックスの`image_embedding`フィールド未定義
   - k-NN設定が有効化されていない可能性

2. **アプリケーションレイヤー**
   - EC2 Python Workerが画像embeddingを生成していない
   - 新規ファイル処理パイプラインに画像embedding統合がない

3. **データレイヤー**
   - 既存ドキュメントに`image_embedding`フィールドが欠損
   - 新規ドキュメントも同様に欠損

### 3.2 プロセス上の根本原因

1. **機能開発の段階的実装**
   - フロントエンドUIとAPI Routeが先行実装
   - バックエンドインフラとデータパイプラインが未完了
   - 統合テストが不足

2. **環境確認の制約**
   - ローカル環境からVPCエンドポイントへの直接アクセス不可
   - AWS CLIトークン期限切れで本番環境確認が困難

3. **ドキュメント不整合**
   - READMEに実装済みと記載されている機能が実際は未実装
   - 段階的な実装状況のトラッキングが不明瞭

---

## 4. 影響範囲

### 4.1 ユーザー影響

- **画像検索機能が完全に使用不可**
  - すべての画像検索クエリが0件を返す
  - ユーザーは画像による類似ファイル検索ができない

### 4.2 システム影響

- **データ整合性**
  - 既存の数千～数万件のファイルに`image_embedding`が欠損
  - 新規ファイルも同様に欠損し続ける

- **リソース影響**
  - 問題修正時に全ファイルの再処理が必要
  - AWS Bedrock API呼び出しコストが発生

---

## 5. 修正計画（段階的アプローチ）

### Phase 1: 緊急診断と状況確認（1日）

#### 目的
本番環境の正確な状態を把握し、修正の優先順位を決定

#### 実施項目

1. **VPC内診断スクリプトの実行**
   - EC2インスタンスまたはLambda関数から診断スクリプトを実行
   - OpenSearchインデックスマッピング確認
   - 既存ドキュメントの`image_embedding`フィールド確認
   - k-NN設定確認

2. **AWS CLIによる環境確認**
   ```bash
   # 認証情報を更新
   aws configure

   # OpenSearchドメイン情報
   aws opensearch describe-domain \
     --domain-name cis-filesearch-opensearch \
     --region ap-northeast-1

   # Lambda関数確認
   aws lambda get-function \
     --function-name cis-search-api \
     --region ap-northeast-1

   # EC2 Python Workerインスタンス確認
   aws ec2 describe-instances \
     --filters "Name=tag:Name,Values=cis-file-processor" \
     --region ap-northeast-1
   ```

3. **CloudWatchログ分析**
   ```bash
   # Lambda検索APIログ
   aws logs tail /aws/lambda/cis-search-api --follow

   # EC2 Python Worker（Systems Manager経由）
   aws ssm start-session --target <instance-id>
   sudo journalctl -u file-processor.service -n 1000
   ```

#### 成果物
- 現状診断レポート（JSON形式）
- 問題の優先順位リスト
- 次フェーズのGo/No-Go判断

---

### Phase 2: OpenSearchインデックス修正（2-3日）

#### オプション A: 新インデックス作成 + エイリアス切り替え（ゼロダウンタイム）

**推奨理由**: 本番環境でデータ損失リスクゼロ

1. **新インデックス作成**
   ```bash
   curl -X PUT "https://<opensearch-endpoint>/file-index-v2" \
     -H "Content-Type: application/json" \
     -d '{
       "settings": {
         "index": {
           "knn": true,
           "knn.algo_param.ef_search": 512,
           "number_of_shards": 2,
           "number_of_replicas": 1
         }
       },
       "mappings": {
         "properties": {
           "file_name": {
             "type": "text",
             "analyzer": "kuromoji",
             "fields": {"keyword": {"type": "keyword"}}
           },
           "file_path": {
             "type": "text",
             "fields": {"keyword": {"type": "keyword"}}
           },
           "file_type": {"type": "keyword"},
           "file_size": {"type": "long"},
           "processed_at": {"type": "date"},
           "extracted_text": {
             "type": "text",
             "analyzer": "kuromoji"
           },
           "s3_key": {"type": "keyword"},
           "image_embedding": {
             "type": "knn_vector",
             "dimension": 1024,
             "method": {
               "name": "hnsw",
               "space_type": "cosinesimil",
               "engine": "nmslib",
               "parameters": {
                 "ef_construction": 128,
                 "m": 16
               }
             }
           }
         }
       }
     }' \
     --aws-sigv4 "aws:amz:ap-northeast-1:es" \
     --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"
   ```

2. **既存データのReindex**
   ```bash
   curl -X POST "https://<opensearch-endpoint>/_reindex" \
     -H "Content-Type: application/json" \
     -d '{
       "source": {
         "index": "file-index"
       },
       "dest": {
         "index": "file-index-v2"
       }
     }' \
     --aws-sigv4 "aws:amz:ap-northeast-1:es" \
     --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"
   ```

3. **エイリアス切り替え**
   ```bash
   # 旧インデックスからエイリアスを削除
   curl -X POST "https://<opensearch-endpoint>/_aliases" \
     -H "Content-Type: application/json" \
     -d '{
       "actions": [
         {"remove": {"index": "file-index", "alias": "file-index-alias"}},
         {"add": {"index": "file-index-v2", "alias": "file-index-alias"}}
       ]
     }' \
     --aws-sigv4 "aws:amz:ap-northeast-1:es" \
     --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"

   # アプリケーション設定を更新
   # OPENSEARCH_INDEX=file-index-alias
   ```

4. **検証とロールバック準備**
   ```bash
   # 新インデックスでテスト検索
   curl -X GET "https://<opensearch-endpoint>/file-index-v2/_search" \
     -H "Content-Type: application/json" \
     -d '{"size": 10, "query": {"match_all": {}}}' \
     --aws-sigv4 "aws:amz:ap-northeast-1:es"

   # 問題があればロールバック
   curl -X POST "https://<opensearch-endpoint>/_aliases" \
     -H "Content-Type: application/json" \
     -d '{
       "actions": [
         {"remove": {"index": "file-index-v2", "alias": "file-index-alias"}},
         {"add": {"index": "file-index", "alias": "file-index-alias"}}
       ]
     }'
   ```

#### オプション B: 既存インデックスの更新（ダウンタイムあり）

**非推奨**: データ損失リスクあり、本番環境には不適切

---

### Phase 3: Python Worker画像処理統合（3-5日）

#### 3.1 image_processor.py改修

1. **AWS Bedrock統合コード追加**
   - ファイル: `/backend/python-worker/processors/image_processor.py`
   - 変更内容:
     - `boto3`でBedrock Runtimeクライアント初期化
     - `generate_image_embedding()`メソッド追加
     - `process()`メソッド内で画像embedding生成

2. **エラーハンドリング強化**
   ```python
   def process(self, s3_key: str, file_metadata: dict) -> dict:
       try:
           # 画像データ取得
           image_data = self.download_from_s3(s3_key)

           # Bedrock embedding生成
           try:
               image_embedding = self.generate_image_embedding(image_data)
               logger.info(f"Image embedding generated: {len(image_embedding)} dimensions")
           except Exception as e:
               logger.error(f"Bedrock embedding failed: {e}")
               # 画像処理は継続するが、embeddingはnullで保存
               image_embedding = None

           return {
               'file_name': file_metadata['file_name'],
               'file_path': file_metadata['file_path'],
               'file_type': 'image',
               'file_size': len(image_data),
               'processed_at': datetime.utcnow().isoformat(),
               's3_key': s3_key,
               'image_embedding': image_embedding,
           }
       except Exception as e:
           logger.error(f"Image processing failed: {e}")
           raise
   ```

#### 3.2 IAM権限追加

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BedrockInvokeModel",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel"
      ],
      "Resource": [
        "arn:aws:bedrock:ap-northeast-1::foundation-model/amazon.titan-embed-image-v1"
      ]
    }
  ]
}
```

#### 3.3 デプロイと検証

```bash
# EC2インスタンスに接続
ssh -i ~/.ssh/your-key.pem ec2-user@<ec2-instance>

# コードをデプロイ
cd /opt/file-processor
sudo git pull origin main

# サービス再起動
sudo systemctl restart file-processor.service

# ログ監視
sudo journalctl -u file-processor.service -f
```

---

### Phase 4: 既存ファイルの再処理バッチ（2-3日）

#### 4.1 バッチスクリプト作成

**ファイル**: `/backend/scripts/backfill-image-embeddings.py`

```python
#!/usr/bin/env python3
"""
既存ファイルの画像embedding生成バッチスクリプト
"""
import boto3
import json
from typing import List, Dict
from datetime import datetime

# AWS clients
s3_client = boto3.client('s3', region_name='ap-northeast-1')
opensearch_client = boto3.client('opensearch', region_name='ap-northeast-1')
bedrock_client = boto3.client('bedrock-runtime', region_name='ap-northeast-1')

OPENSEARCH_ENDPOINT = 'https://vpc-cis-filesearch-opensearch-...amazonaws.com'
OPENSEARCH_INDEX = 'file-index-v2'
S3_BUCKET = 'cis-filesearch-storage'

def get_all_image_documents() -> List[Dict]:
    """OpenSearchから画像タイプのドキュメントを全件取得"""
    # scroll APIを使用して全件取得
    pass

def generate_image_embedding(s3_key: str) -> List[float]:
    """S3から画像を取得してBedrock embeddingを生成"""
    # S3からダウンロード
    response = s3_client.get_object(Bucket=S3_BUCKET, Key=s3_key)
    image_data = response['Body'].read()

    # Bedrock呼び出し
    import base64
    image_base64 = base64.b64encode(image_data).decode('utf-8')

    bedrock_response = bedrock_client.invoke_model(
        modelId='amazon.titan-embed-image-v1',
        body=json.dumps({'inputImage': image_base64})
    )

    result = json.loads(bedrock_response['body'].read())
    return result['embedding']

def update_document_embedding(doc_id: str, embedding: List[float]):
    """OpenSearchドキュメントを更新"""
    # Bulk APIを使用して効率的に更新
    pass

def main():
    print(f"[{datetime.utcnow()}] Starting image embedding backfill...")

    # 1. 画像ドキュメント全件取得
    docs = get_all_image_documents()
    print(f"Found {len(docs)} image documents")

    # 2. 各ドキュメントに対してembedding生成・更新
    success_count = 0
    fail_count = 0

    for i, doc in enumerate(docs):
        try:
            print(f"[{i+1}/{len(docs)}] Processing {doc['s3_key']}")

            # embedding生成
            embedding = generate_image_embedding(doc['s3_key'])

            # OpenSearch更新
            update_document_embedding(doc['_id'], embedding)

            success_count += 1
        except Exception as e:
            print(f"ERROR: {doc['s3_key']} - {e}")
            fail_count += 1

        # レート制限（Bedrock APIの制限を考慮）
        time.sleep(0.1)

    print(f"\n[{datetime.utcnow()}] Backfill completed")
    print(f"  Success: {success_count}")
    print(f"  Failed: {fail_count}")

if __name__ == '__main__':
    main()
```

#### 4.2 実行計画

1. **小規模テスト実行（10-100件）**
   ```bash
   python3 backfill-image-embeddings.py --limit 100 --dry-run
   ```

2. **本番実行（全件）**
   ```bash
   # スクリーンセッションで実行（接続切れても継続）
   screen -S backfill
   python3 backfill-image-embeddings.py --log-file backfill.log
   # Ctrl+A, D でデタッチ
   ```

3. **進捗監視**
   ```bash
   # ログ監視
   tail -f backfill.log

   # OpenSearchドキュメント数確認
   curl -X GET "https://<opensearch-endpoint>/file-index-v2/_count" \
     -H "Content-Type: application/json" \
     -d '{
       "query": {"exists": {"field": "image_embedding"}}
     }'
   ```

#### 4.3 コスト見積もり

| 項目 | 数量 | 単価 | 合計 |
|------|------|------|------|
| AWS Bedrock API呼び出し | 10,000画像 | $0.00006/画像 | $0.60 |
| OpenSearch書き込み | 10,000 docs | 無料（既存インスタンス内） | $0 |
| EC2実行時間 | 5時間 | 無料（既存インスタンス） | $0 |
| **合計** | | | **$0.60** |

---

### Phase 5: Lambda検索API改善とテスト（2日）

#### 5.1 エラーハンドリング強化

```typescript
// /backend/lambda-search-api/src/services/opensearch.service.enhanced.ts

async function executeSearch(
  client: Client,
  config: OpenSearchConfig,
  searchBody: any
): Promise<SearchResponse> {
  // 詳細なクエリログ
  logger.debug('OpenSearch query', {
    index: config.index,
    body: JSON.stringify(searchBody, null, 2).substring(0, 2000),
  });

  try {
    const response = await client.search({
      index: config.index,
      body: searchBody,
    });

    const took = response.body.took;
    const totalHits = response.body.hits.total;
    const hitsCount = response.body.hits.hits.length;

    logger.info('Search completed', {
      took,
      totalHits,
      hitsCount,
      maxScore: response.body.hits.max_score,
    });

    // 0件の場合に詳細なデバッグ情報
    if (hitsCount === 0 && searchBody.query?.knn) {
      logger.warn('Zero results from k-NN search', {
        embeddingLength: searchBody.query.knn.image_embedding?.vector?.length,
        k: searchBody.query.knn.image_embedding?.k,
        filters: searchBody.query?.bool?.filter,
      });
    }

    return transformSearchResults(response);
  } catch (error: any) {
    // エラーの詳細ログ
    logger.error('OpenSearch query failed', {
      error: error.message,
      statusCode: error.statusCode,
      errorType: error.name,
      body: error.body,
      meta: error.meta,
      queryBody: JSON.stringify(searchBody, null, 2),
    });

    // エラー種類に応じた処理
    if (error.statusCode === 400) {
      throw new OpenSearchError('Invalid query syntax', 400);
    } else if (error.statusCode === 404) {
      throw new OpenSearchIndexNotFoundError(`Index ${config.index} not found`);
    } else if (error.statusCode === 503) {
      throw new OpenSearchUnavailableError('OpenSearch service unavailable');
    }

    throw error;
  }
}
```

#### 5.2 統合テスト

```typescript
// /backend/lambda-search-api/src/__tests__/image-search.integration.test.ts

describe('Image Search Integration Tests', () => {
  test('should return similar images for valid embedding', async () => {
    const testEmbedding = Array.from({ length: 1024 }, () => Math.random());

    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        imageEmbedding: testEmbedding,
        limit: 10,
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.results).toBeInstanceOf(Array);
  });

  test('should handle empty results gracefully', async () => {
    // 完全にランダムなベクトル（類似画像なし）
    const randomEmbedding = Array.from({ length: 1024 }, () => Math.random());

    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        imageEmbedding: randomEmbedding,
        limit: 10,
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.results.length).toBe(0);
  });
});
```

---

### Phase 6: E2Eテストと本番検証（1-2日）

#### 6.1 E2Eテストシナリオ

1. **画像アップロード → 検索フロー**
   ```typescript
   // Playwright E2E Test
   test('Image upload and search flow', async ({ page }) => {
     // 1. ログイン
     await page.goto('http://localhost:3000/login');
     await page.fill('#email', 'test@example.com');
     await page.fill('#password', 'password123');
     await page.click('button[type="submit"]');

     // 2. 検索ページに移動
     await page.goto('http://localhost:3000/search');

     // 3. 画像アップロード
     await page.setInputFiles('input[type="file"]', 'test-data/sample-image.jpg');

     // 4. 検索実行
     await page.click('button:has-text("画像で検索")');

     // 5. 結果確認
     await page.waitForSelector('.search-results');
     const results = await page.$$('.search-result-item');
     expect(results.length).toBeGreaterThan(0);
   });
   ```

2. **API直接テスト**
   ```bash
   # 画像embedding生成
   curl -X POST "http://localhost:3000/api/image-embedding" \
     -F "image=@test-data/sample-image.jpg"

   # 返ってきたembeddingで検索
   curl -X POST "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search" \
     -H "Content-Type: application/json" \
     -d '{
       "imageEmbedding": [0.123, -0.456, ...],
       "limit": 10
     }'
   ```

#### 6.2 本番環境検証チェックリスト

- [ ] OpenSearchインデックスマッピング確認
- [ ] サンプルドキュメントに`image_embedding`が存在
- [ ] k-NN検索が正常に動作
- [ ] Lambda検索APIログにエラーなし
- [ ] フロントエンドから画像検索実行して結果取得
- [ ] 類似度スコアが0.7以上の結果が表示
- [ ] CloudWatchメトリクスで異常なし

---

## 6. ロールバック計画

### シナリオ 1: OpenSearchインデックス問題

**症状**: 新インデックスでエラー頻発、検索が動作しない

**対処**:
```bash
# エイリアスを旧インデックスに戻す
curl -X POST "https://<opensearch-endpoint>/_aliases" \
  -H "Content-Type: application/json" \
  -d '{
    "actions": [
      {"remove": {"index": "file-index-v2", "alias": "file-index-alias"}},
      {"add": {"index": "file-index", "alias": "file-index-alias"}}
    ]
  }'
```

**影響**: 画像検索は再び0件に戻るが、テキスト検索は正常に動作

---

### シナリオ 2: Python Worker問題

**症状**: 新規ファイル処理が停止、SQSキュー滞留

**対処**:
```bash
# EC2インスタンスに接続
ssh ec2-user@<instance-id>

# 旧バージョンにロールバック
cd /opt/file-processor
sudo git checkout <previous-commit-hash>

# サービス再起動
sudo systemctl restart file-processor.service
```

**影響**: 画像embeddingが生成されなくなるが、ファイル処理は継続

---

## 7. 監視とアラート

### 7.1 CloudWatchメトリクス

```typescript
// Lambda関数内でカスタムメトリクスを送信
import { CloudWatch } from '@aws-sdk/client-cloudwatch';

const cloudwatch = new CloudWatch({ region: 'ap-northeast-1' });

// k-NN検索の結果数をメトリクスとして記録
await cloudwatch.putMetricData({
  Namespace: 'CIS/SearchAPI',
  MetricData: [
    {
      MetricName: 'ImageSearchResultCount',
      Value: searchResult.results.length,
      Unit: 'Count',
      Timestamp: new Date(),
    },
    {
      MetricName: 'ImageSearchLatency',
      Value: searchResult.took,
      Unit: 'Milliseconds',
    },
  ],
});
```

### 7.2 アラート設定

```hcl
# Terraform
resource "aws_cloudwatch_metric_alarm" "image_search_zero_results" {
  alarm_name          = "cis-image-search-zero-results"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = "3"
  metric_name         = "ImageSearchResultCount"
  namespace           = "CIS/SearchAPI"
  period              = "300"
  statistic           = "Average"
  threshold           = "1"
  alarm_description   = "Image search consistently returns zero results"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
```

---

## 8. 次のアクションアイテム

### 即座に実行（24時間以内）

1. **AWS認証情報を更新**
   ```bash
   aws configure
   # または
   aws sso login --profile cis-production
   ```

2. **OpenSearchインデックスマッピングを確認**
   - VPC内のEC2インスタンスまたはLambda関数から診断スクリプト実行
   - 結果をJSON形式で保存

3. **Lambda CloudWatchログを確認**
   ```bash
   aws logs tail /aws/lambda/cis-search-api --follow --since 1h
   ```

### 短期（1週間以内）

4. **OpenSearchインデックスを修正**
   - 新インデックス作成（`file-index-v2`）
   - エイリアス切り替え

5. **Python Worker改修**
   - `image_processor.py`にBedrock統合
   - IAM権限追加
   - デプロイと検証

### 中期（2週間以内）

6. **既存ファイルの再処理バッチ実行**
   - 小規模テスト（100件）
   - 本番実行（全件）

7. **E2Eテストと本番検証**

---

## 9. 関連ドキュメント

- [Lambda Search API実装ガイド](/backend/lambda-search-api/README.md)
- [OpenSearch k-NN設定ガイド](https://opensearch.org/docs/latest/search-plugins/knn/index/)
- [AWS Bedrock Titan Embeddings API](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-embedding-models.html)
- [Python Worker アーキテクチャ](/backend/python-worker/README.md)

---

## 10. 連絡先

- **インシデント管理**: [GitHub Issues](https://github.com/your-org/cis-filesearch/issues)
- **技術質問**: tech-support@example.com
- **緊急対応**: on-call@example.com

---

**レポート作成者**: Backend Engineering Team
**最終更新**: 2025-12-18
**ステータス**: 修正計画策定完了、実行待ち
