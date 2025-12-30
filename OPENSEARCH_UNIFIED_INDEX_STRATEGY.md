# OpenSearch統合インデックス戦略

## 現状分析

### 既存インデックス構造

1. **`cis-files` インデックス**
   - 実際のファイルデータを含む（テキスト検索用）
   - EC2 Workerが継続的にデータを投入
   - マッピング: `file_name`, `file_path`, `extracted_text`, `file_type`, etc.
   - **k-NNベクトルフィールドなし**

2. **`file-index-v2-knn` インデックス**
   - サンプルデータのみ（画像検索用テスト）
   - k-NNベクトルフィールド: `image_embedding` (1024次元)
   - **実ファイルデータが少ない**

3. **現在の問題**
   - Lambda関数が `file-index-v2-knn` を参照 → テキスト検索が機能しない
   - EC2 Workerが `cis-files` に書き込み → 画像検索が機能しない
   - データが分散しており統合されていない

---

## 推奨戦略: ハイブリッドアプローチ（段階的移行）

**最適な理由:**
- ダウンタイムを最小化
- データ損失のリスクなし
- 段階的な検証が可能
- ロールバック容易

### フェーズ1: デュアルインデックス運用（移行期間）

両方のインデックスを並行運用し、段階的にデータを統合

### フェーズ2: 新統合インデックスへの完全移行

すべてのコンポーネントを新インデックスに移行

---

## 実装計画

### Step 1: 新統合インデックスの作成（5-10分）

**目的:** テキスト検索とk-NN画像検索の両方をサポートする統合インデックスを作成

**インデックス名:** `cis-files-unified-v1`

**マッピング構造:**

```json
{
  "settings": {
    "index": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "refresh_interval": "5s",
      "knn": true,
      "knn.algo_param.ef_search": 512
    },
    "analysis": {
      "analyzer": {
        "japanese_analyzer": {
          "type": "custom",
          "tokenizer": "kuromoji_tokenizer",
          "filter": ["kuromoji_baseform", "lowercase", "cjk_width"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "file_key": { "type": "keyword" },
      "file_name": {
        "type": "text",
        "analyzer": "japanese_analyzer",
        "fields": { "keyword": { "type": "keyword" } }
      },
      "file_path": {
        "type": "text",
        "analyzer": "japanese_analyzer",
        "fields": { "keyword": { "type": "keyword" } }
      },
      "file_type": { "type": "keyword" },
      "mime_type": { "type": "keyword" },
      "file_size": { "type": "long" },
      "extracted_text": {
        "type": "text",
        "analyzer": "japanese_analyzer"
      },
      "image_embedding": {
        "type": "knn_vector",
        "dimension": 1024,
        "method": {
          "name": "hnsw",
          "space_type": "innerproduct",
          "engine": "nmslib",
          "parameters": {
            "ef_construction": 512,
            "m": 16
          }
        }
      },
      "has_image_embedding": { "type": "boolean" },
      "page_count": { "type": "integer" },
      "word_count": { "type": "integer" },
      "char_count": { "type": "integer" },
      "metadata": { "type": "object", "enabled": true },
      "processor_name": { "type": "keyword" },
      "processor_version": { "type": "keyword" },
      "processing_time_seconds": { "type": "float" },
      "processed_at": { "type": "date" },
      "indexed_at": { "type": "date" },
      "bucket": { "type": "keyword" },
      "s3_url": { "type": "keyword" },
      "thumbnail_url": { "type": "keyword" },
      "success": { "type": "boolean" },
      "error_message": { "type": "text" }
    }
  }
}
```

**実行コマンド（EC2上で）:**

```bash
#!/bin/bash
# create-unified-index.sh

OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com"
INDEX_NAME="cis-files-unified-v1"

# インデックス作成リクエスト
curl -XPUT "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}" \
  -H 'Content-Type: application/json' \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -d @unified-index-mapping.json

echo "✓ 統合インデックス作成完了: ${INDEX_NAME}"
```

**リスク:** 低（既存データに影響なし）
**所要時間:** 5分

---

### Step 2: 既存データの統合マイグレーション（30-60分）

**目的:** `cis-files` から新インデックスへデータをコピー

**方法1: Reindex API（推奨）**

```bash
#!/bin/bash
# migrate-data-reindex.sh

OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com"
SOURCE_INDEX="cis-files"
TARGET_INDEX="cis-files-unified-v1"

# Reindex実行（非同期）
curl -XPOST "${OPENSEARCH_ENDPOINT}/_reindex?wait_for_completion=false" \
  -H 'Content-Type: application/json' \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -d '{
    "source": {
      "index": "'"${SOURCE_INDEX}"'"
    },
    "dest": {
      "index": "'"${TARGET_INDEX}"'"
    }
  }'

echo "✓ Reindexジョブ開始（非同期）"
echo "進捗確認: curl -XGET '${OPENSEARCH_ENDPOINT}/_tasks?actions=*reindex&detailed'"
```

**進捗監視:**

```bash
# 進捗確認スクリプト
watch -n 10 "curl -s -XGET '${OPENSEARCH_ENDPOINT}/_tasks?actions=*reindex&detailed' --aws-sigv4 'aws:amz:ap-northeast-1:es' | jq '.nodes[].tasks[]'"
```

**方法2: Pythonスクリプト（バッチ処理）**

```python
# migrate_to_unified_index.py
import boto3
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

# 設定
SOURCE_INDEX = 'cis-files'
TARGET_INDEX = 'cis-files-unified-v1'
BATCH_SIZE = 500

# OpenSearch接続
credentials = boto3.Session().get_credentials()
awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    'ap-northeast-1',
    'es',
    session_token=credentials.token
)

client = OpenSearch(
    hosts=[{'host': 'vpc-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com', 'port': 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection
)

# データマイグレーション
def migrate_data():
    page = 0
    total_migrated = 0

    while True:
        # ソースからデータ取得
        response = client.search(
            index=SOURCE_INDEX,
            body={
                "query": {"match_all": {}},
                "size": BATCH_SIZE,
                "from": page * BATCH_SIZE
            }
        )

        hits = response['hits']['hits']
        if not hits:
            break

        # バルクインデックス準備
        bulk_body = []
        for hit in hits:
            doc = hit['_source']
            doc_id = hit['_id']

            # image_embeddingフィールドがなければNoneを設定
            if 'image_embedding' not in doc:
                doc['image_embedding'] = None
                doc['has_image_embedding'] = False
            else:
                doc['has_image_embedding'] = True

            bulk_body.append({'index': {'_index': TARGET_INDEX, '_id': doc_id}})
            bulk_body.append(doc)

        # バルク投入
        client.bulk(body=bulk_body)
        total_migrated += len(hits)

        print(f"✓ {total_migrated} documents migrated")
        page += 1

    print(f"✓ Migration complete: {total_migrated} total documents")

if __name__ == '__main__':
    migrate_data()
```

**実行:**

```bash
# EC2上で実行
python3 migrate_to_unified_index.py
```

**リスク:** 低（読み取り専用操作）
**所要時間:** 30-60分（データ量に依存）

---

### Step 3: EC2 Workerの更新（5分）

**目的:** 新インデックスへの書き込みに切り替え

**変更箇所:**

1. **環境変数の更新**

```bash
# /etc/environment または systemd service file
OPENSEARCH_INDEX=cis-files-unified-v1
```

2. **Workerの再起動**

```bash
sudo systemctl restart file-processor.service
```

**検証:**

```bash
# ログ確認
sudo journalctl -u file-processor.service -f

# 新インデックスのドキュメント数確認
curl -XGET "${OPENSEARCH_ENDPOINT}/cis-files-unified-v1/_count" --aws-sigv4 "aws:amz:ap-northeast-1:es"
```

**リスク:** 中（Workerの再起動が必要）
**ダウンタイム:** 数秒
**所要時間:** 5分

---

### Step 4: Lambda関数の更新（5分）

**目的:** 新インデックスを参照するように変更

**変更箇所:**

1. **環境変数の更新**

```bash
# AWS Console or AWS CLI
aws lambda update-function-configuration \
  --function-name cis-search-api \
  --environment "Variables={OPENSEARCH_INDEX=cis-files-unified-v1}"
```

2. **または Parameter Storeを更新**

```bash
aws ssm put-parameter \
  --name "/cis-filesearch/opensearch/index-name" \
  --value "cis-files-unified-v1" \
  --type String \
  --overwrite
```

3. **Lambda関数の再デプロイ（設定変更のみの場合は不要）**

**検証:**

```bash
# Lambda関数をテスト呼び出し
aws lambda invoke \
  --function-name cis-search-api \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test"}}' \
  response.json

cat response.json | jq
```

**リスク:** 低（環境変数の変更のみ）
**ダウンタイム:** なし（即座に反映）
**所要時間:** 5分

---

### Step 5: フロントエンドの検証（10分）

**テストシナリオ:**

1. **テキスト検索のテスト**
```bash
# API経由でテキスト検索
curl -X GET "${API_GATEWAY_URL}?q=契約書&searchMode=and" | jq
```

2. **画像検索のテスト**
```bash
# 画像アップロード → ベクトル生成 → 検索
# フロントエンドUIから実行
```

3. **ハイブリッド検索のテスト**
```bash
# テキスト+画像の組み合わせ検索
```

**リスク:** 低
**所要時間:** 10分

---

### Step 6: 画像ベクトルのバックフィル（オプション・バックグラウンド）

**目的:** 既存の画像ファイルに対してベクトルを生成・追加

**実装方法:**

1. **画像ファイルのリスト取得**

```python
# backfill_image_embeddings.py
import boto3
from opensearchpy import OpenSearch

# 画像ファイルのみを抽出
response = client.search(
    index='cis-files-unified-v1',
    body={
        "query": {
            "bool": {
                "must": [
                    {"term": {"file_type": "image"}},
                    {"bool": {"must_not": {"exists": {"field": "image_embedding"}}}}
                ]
            }
        },
        "size": 1000
    }
)

# 各画像に対してLambda（画像埋め込み生成）を呼び出し
# その後、OpenSearchを更新
```

2. **バッチ処理の実行（非同期）**

```bash
# バックグラウンドで実行
nohup python3 backfill_image_embeddings.py > backfill.log 2>&1 &
```

**リスク:** 低（既存データへの追加のみ）
**所要時間:** 数時間〜（画像ファイル数に依存）

---

### Step 7: 旧インデックスのクリーンアップ（移行完了後）

**タイミング:** すべての検証が完了し、1週間程度安定稼働後

**手順:**

1. **旧インデックスの削除**

```bash
# cis-files インデックスを削除
curl -XDELETE "${OPENSEARCH_ENDPOINT}/cis-files" --aws-sigv4 "aws:amz:ap-northeast-1:es"

# file-index-v2-knn インデックスを削除
curl -XDELETE "${OPENSEARCH_ENDPOINT}/file-index-v2-knn" --aws-sigv4 "aws:amz:ap-northeast-1:es"
```

2. **エイリアスの設定（オプション）**

```bash
# cis-files エイリアスを新インデックスに向ける
curl -XPOST "${OPENSEARCH_ENDPOINT}/_aliases" \
  -H 'Content-Type: application/json' \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -d '{
    "actions": [
      { "add": { "index": "cis-files-unified-v1", "alias": "cis-files" } }
    ]
  }'
```

**リスク:** 中（削除は不可逆）
**所要時間:** 5分

---

## 将来のファイルアップロード処理

### EC2 Workerの処理フロー

```python
# opensearch_client.py (更新版)

def index_document(self, document: Dict[str, Any], document_id: Optional[str] = None):
    """
    ドキュメントをインデックス

    - 画像ファイルの場合: image_embedding フィールドは None（後でLambdaが更新）
    - その他のファイル: 通常のテキストインデックス
    """
    # image_embeddingフィールドの初期化
    if document.get('file_type') == 'image':
        document['image_embedding'] = None
        document['has_image_embedding'] = False

    # インデックス投入
    self.client.index(
        index=self.config.aws.opensearch_index,  # cis-files-unified-v1
        id=document_id,
        body=document
    )
```

### Lambda（画像埋め込み生成）の処理フロー

```typescript
// lambda-image-embedding/index.ts

export async function handler(event: S3Event) {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = record.s3.object.key;

    // 画像ファイルかチェック
    if (!isImageFile(key)) continue;

    // Bedrock Titan Embeddingsで画像ベクトル生成
    const embedding = await generateImageEmbedding(bucket, key);

    // OpenSearchを更新（部分更新）
    await opensearchClient.update({
      index: 'cis-files-unified-v1',
      id: key,
      body: {
        doc: {
          image_embedding: embedding,
          has_image_embedding: true,
          embedding_generated_at: new Date().toISOString()
        }
      }
    });
  }
}
```

---

## リスクアセスメント

| ステップ | リスクレベル | ダウンタイム | 対策 |
|---------|-------------|-------------|------|
| Step 1: インデックス作成 | 低 | なし | 既存データに影響なし |
| Step 2: データマイグレーション | 低 | なし | 読み取り専用操作 |
| Step 3: EC2 Worker更新 | 中 | 数秒 | Workerの再起動のみ |
| Step 4: Lambda更新 | 低 | なし | 環境変数変更のみ |
| Step 5: 検証 | 低 | なし | テスト実行 |
| Step 6: バックフィル | 低 | なし | バックグラウンド処理 |
| Step 7: クリーンアップ | 中 | なし | 十分な検証期間を設ける |

**総合リスク:** 低〜中
**総ダウンタイム:** 数秒（Worker再起動時のみ）
**総所要時間:** 1-2時間（バックフィルを除く）

---

## ロールバック計画

### 問題が発生した場合

**Step 3-4でロールバック:**

1. EC2 Workerの環境変数を `cis-files` に戻す
2. Lambda関数の環境変数を `cis-files` に戻す
3. 両方のサービスを再起動

```bash
# EC2
sudo sed -i 's/OPENSEARCH_INDEX=cis-files-unified-v1/OPENSEARCH_INDEX=cis-files/' /etc/environment
sudo systemctl restart file-processor.service

# Lambda
aws lambda update-function-configuration \
  --function-name cis-search-api \
  --environment "Variables={OPENSEARCH_INDEX=cis-files}"
```

**リカバリ時間:** 5分

---

## モニタリング

### CloudWatchメトリクス

- インデックスのドキュメント数
- 検索レイテンシ
- エラー率
- Worker処理速度

### ログ確認

```bash
# EC2 Workerログ
sudo journalctl -u file-processor.service -f

# Lambdaログ
aws logs tail /aws/lambda/cis-search-api --follow

# OpenSearchインデックス統計
curl -XGET "${OPENSEARCH_ENDPOINT}/cis-files-unified-v1/_stats" --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq
```

---

## まとめ

### 推奨アプローチ

**ハイブリッド移行戦略**により:

- ✅ ダウンタイム最小（数秒）
- ✅ データ損失リスクなし
- ✅ 段階的検証が可能
- ✅ 簡単なロールバック
- ✅ テキスト検索と画像検索の統合

### 実装順序

1. 新統合インデックス作成（5分）
2. データマイグレーション（30-60分）
3. EC2 Worker更新（5分）
4. Lambda更新（5分）
5. 検証（10分）
6. （オプション）画像ベクトルバックフィル（バックグラウンド）
7. 旧インデックスクリーンアップ（1週間後）

**総所要時間:** 約1-2時間
**総リスク:** 低〜中
**推奨実施タイミング:** メンテナンスウィンドウまたは低トラフィック時間帯

---

## 次のステップ

準備ができたら以下のコマンドで開始してください:

```bash
# 1. EC2にSSH接続
ssh ec2-user@your-ec2-instance

# 2. 統合インデックス作成スクリプトを実行
bash create-unified-index.sh

# 3. データマイグレーション開始
bash migrate-data-reindex.sh

# 4. 進捗監視
watch -n 10 'curl -s -XGET "${OPENSEARCH_ENDPOINT}/_cat/indices?v" --aws-sigv4 "aws:amz:ap-northeast-1:es"'
```

ご質問があれば、いつでもお聞きください。
