# OpenSearch統合インデックス移行 - クイックスタートガイド

## 概要

このガイドでは、テキスト検索と画像検索を統合した新しいOpenSearchインデックスへの移行を最短時間で実行する方法を説明します。

**所要時間:** 約1-2時間（データ量に依存）
**ダウンタイム:** 数秒（Worker再起動時のみ）
**リスク:** 低

---

## 前提条件

1. **EC2インスタンスへのSSHアクセス**
   ```bash
   ssh ec2-user@your-ec2-instance-ip
   ```

2. **必要な環境変数**
   ```bash
   export OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com"
   export AWS_REGION="ap-northeast-1"
   ```

3. **スクリプトのダウンロード**
   ```bash
   cd /home/ec2-user
   git clone https://github.com/your-repo/cis_filesearch_app.git
   cd cis_filesearch_app/scripts
   ```

---

## ステップ1: 統合インデックスの作成（5分）

```bash
# スクリプト実行
bash create-unified-index.sh
```

**期待される出力:**
```
=========================================
OpenSearch統合インデックス作成
=========================================
エンドポイント: https://vpc-cis-filesearch-xxxxx...
インデックス名: cis-files-unified-v1

インデックスを作成中...
✓ インデックス作成成功

レスポンス:
{
  "acknowledged": true,
  "shards_acknowledged": true,
  "index": "cis-files-unified-v1"
}

✓ 統合インデックス作成完了
```

**トラブルシューティング:**

- **エラー: "index already exists"**
  ```bash
  # 既存インデックスを削除して再実行
  curl -XDELETE "${OPENSEARCH_ENDPOINT}/cis-files-unified-v1" \
    --aws-sigv4 "aws:amz:${AWS_REGION}:es"
  ```

- **エラー: "connection refused"**
  ```bash
  # VPC内からアクセスできるか確認
  curl -s "${OPENSEARCH_ENDPOINT}/_cluster/health" \
    --aws-sigv4 "aws:amz:${AWS_REGION}:es" | jq
  ```

---

## ステップ2: データマイグレーション（30-60分）

```bash
# マイグレーションスクリプト実行
bash migrate-data-to-unified.sh
```

**期待される出力:**
```
=========================================
OpenSearchデータマイグレーション
=========================================
ソース: cis-files
ターゲット: cis-files-unified-v1

✓ ソースドキュメント数: 15000

Reindexジョブを開始します
✓ Reindexジョブ開始成功
タスクID: oTUltX_IQs...

進捗を監視中...
進捗: 15000/15000 (100%)

✓ Reindex完了
✓ すべてのドキュメントが正常にマイグレーションされました
```

**進捗確認（別ターミナル）:**
```bash
# リアルタイム進捗確認
watch -n 5 "curl -s '${OPENSEARCH_ENDPOINT}/cis-files-unified-v1/_count' \
  --aws-sigv4 'aws:amz:${AWS_REGION}:es' | jq '.count'"
```

**トラブルシューティング:**

- **マイグレーションが遅い**
  ```bash
  # バッチサイズを増やす（高スペッククラスタの場合）
  # migrate-data-to-unified.sh内の "size": 500 を "size": 1000 に変更
  ```

- **ドキュメント数が一致しない**
  ```bash
  # 差分を確認
  diff_count=$((source_count - target_count))
  echo "差分: ${diff_count}"

  # 再度マイグレーション実行（冪等性あり）
  bash migrate-data-to-unified.sh
  ```

---

## ステップ3: 検証（10分）

```bash
# 検証スクリプト実行
bash verify-unified-index.sh
```

**期待される出力:**
```
=========================================
統合インデックス検証
=========================================

1. インデックス統計
-------------------
ドキュメント数: 15000
ストレージサイズ: 2500 MB

2. k-NNフィールド確認
-------------------
✓ k-NNベクトルフィールド: 設定済み (1024次元)

3. 画像ベクトル統計
-------------------
ベクトル設定済み: 0 ドキュメント
ベクトル未設定: 15000 ドキュメント
画像ファイル数: 3200 ドキュメント

4. テキスト検索テスト
-------------------
検索クエリ: '契約'
検索結果数: 245

5. ファイルタイプ分布
-------------------
  pdf: 5000 ドキュメント
  image: 3200 ドキュメント
  office: 6800 ドキュメント

6. インデックス健全性
-------------------
✓ ステータス: green (正常)

✓ すべての検証に合格しました
```

**重要な確認ポイント:**

- ✅ ドキュメント数が元のインデックスと一致
- ✅ k-NNフィールドが設定されている
- ✅ テキスト検索が正常に動作
- ✅ インデックスステータスが `green`

---

## ステップ4: EC2 Workerの更新（5分）

### 4-1. 環境変数の更新

```bash
# systemd service fileを編集
sudo vi /etc/systemd/system/file-processor.service

# Environment行を以下に変更:
Environment="OPENSEARCH_INDEX=cis-files-unified-v1"
```

**または .env ファイルを使用している場合:**

```bash
sudo vi /home/ec2-user/file-processor/.env

# OPENSEARCH_INDEX行を変更:
OPENSEARCH_INDEX=cis-files-unified-v1
```

### 4-2. Workerの再起動

```bash
# systemdの設定をリロード
sudo systemctl daemon-reload

# Workerを再起動
sudo systemctl restart file-processor.service

# ステータス確認
sudo systemctl status file-processor.service
```

### 4-3. ログ確認

```bash
# リアルタイムログ
sudo journalctl -u file-processor.service -f

# 期待されるログ:
# "Connected to OpenSearch cluster: ..."
# "Index 'cis-files-unified-v1' exists"
# "Worker initialized successfully"
```

---

## ステップ5: Lambda関数の更新（5分）

### 5-1. 環境変数の更新（AWS CLI）

```bash
# Lambda関数の環境変数を更新
aws lambda update-function-configuration \
  --function-name cis-search-api \
  --environment "Variables={OPENSEARCH_INDEX=cis-files-unified-v1}" \
  --region ap-northeast-1
```

**または AWS Parameter Store経由:**

```bash
# Parameter Storeを更新
aws ssm put-parameter \
  --name "/cis-filesearch/opensearch/index-name" \
  --value "cis-files-unified-v1" \
  --type String \
  --overwrite \
  --region ap-northeast-1

# Lambda関数を再デプロイ（設定を再読み込み）
aws lambda update-function-code \
  --function-name cis-search-api \
  --s3-bucket your-lambda-bucket \
  --s3-key lambda-search-api.zip \
  --region ap-northeast-1
```

### 5-2. テスト実行

```bash
# Lambda関数をテスト
aws lambda invoke \
  --function-name cis-search-api \
  --payload '{
    "httpMethod": "GET",
    "queryStringParameters": {
      "q": "契約書",
      "searchMode": "and"
    }
  }' \
  response.json

# レスポンス確認
cat response.json | jq
```

**期待される出力:**
```json
{
  "statusCode": 200,
  "body": {
    "results": [...],
    "pagination": {
      "total": 245,
      "page": 1,
      "limit": 20
    }
  }
}
```

---

## ステップ6: フロントエンドの動作確認（10分）

### 6-1. テキスト検索のテスト

```bash
# API Gateway経由でテスト
curl -X GET "${API_GATEWAY_URL}/search?q=契約書&searchMode=and" \
  -H "Content-Type: application/json" | jq
```

### 6-2. 画像検索のテスト（UIから）

1. フロントエンドにアクセス
2. 画像検索タブを開く
3. テスト画像をアップロード
4. 検索結果が表示されることを確認

**注意:** 画像ベクトルはまだ未設定のため、結果は空の場合があります。次のステップでバックフィルを実行します。

---

## ステップ7: 画像ベクトルのバックフィル（オプション・バックグラウンド）

画像ファイルに対してベクトルを生成し、インデックスを更新します。

### 7-1. バックフィルスクリプトの準備

```python
# backfill_image_embeddings.py
import boto3
import json
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

# 設定
INDEX_NAME = 'cis-files-unified-v1'
BATCH_SIZE = 10  # 画像処理は重いため小さめのバッチサイズ
LAMBDA_FUNCTION_NAME = 'cis-image-embedding-generator'

# AWS clients
lambda_client = boto3.client('lambda', region_name='ap-northeast-1')
credentials = boto3.Session().get_credentials()

# OpenSearch接続
awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    'ap-northeast-1',
    'es',
    session_token=credentials.token
)

os_client = OpenSearch(
    hosts=[{'host': 'vpc-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com', 'port': 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection
)

def backfill_image_embeddings():
    """画像ファイルのベクトルを生成してインデックスを更新"""

    # 画像ファイルでベクトルが未設定のものを取得
    response = os_client.search(
        index=INDEX_NAME,
        body={
            "query": {
                "bool": {
                    "must": [
                        {"term": {"file_type": "image"}},
                        {"bool": {"must_not": {"term": {"has_image_embedding": True}}}}
                    ]
                }
            },
            "size": BATCH_SIZE,
            "_source": ["file_key", "bucket", "file_name"]
        }
    )

    hits = response['hits']['hits']

    if not hits:
        print("✓ すべての画像ファイルにベクトルが設定されています")
        return 0

    print(f"処理対象: {len(hits)} 画像ファイル")

    processed = 0

    for hit in hits:
        doc_id = hit['_id']
        source = hit['_source']
        bucket = source.get('bucket')
        file_key = source.get('file_key')

        print(f"処理中: {file_key}")

        try:
            # Lambda関数を呼び出してベクトル生成
            lambda_response = lambda_client.invoke(
                FunctionName=LAMBDA_FUNCTION_NAME,
                InvocationType='RequestResponse',
                Payload=json.dumps({
                    'bucket': bucket,
                    'key': file_key
                })
            )

            payload = json.loads(lambda_response['Payload'].read())

            if payload.get('statusCode') == 200:
                body = json.loads(payload['body'])
                embedding = body.get('embedding')

                if embedding:
                    # OpenSearchを更新
                    os_client.update(
                        index=INDEX_NAME,
                        id=doc_id,
                        body={
                            'doc': {
                                'image_embedding': embedding,
                                'has_image_embedding': True,
                                'embedding_generated_at': datetime.utcnow().isoformat()
                            }
                        }
                    )
                    processed += 1
                    print(f"  ✓ ベクトル更新完了")
            else:
                print(f"  ✗ Lambda実行失敗: {payload}")

        except Exception as e:
            print(f"  ✗ エラー: {e}")

    print(f"✓ {processed}/{len(hits)} ファイル処理完了")
    return len(hits)

if __name__ == '__main__':
    total_processed = 0

    while True:
        count = backfill_image_embeddings()
        total_processed += count

        if count == 0:
            break

        print(f"\n累計処理数: {total_processed}")
        print("次のバッチを処理中...\n")

    print(f"✓ バックフィル完了: 合計 {total_processed} ファイル")
```

### 7-2. バックフィル実行

```bash
# バックグラウンドで実行
nohup python3 backfill_image_embeddings.py > backfill.log 2>&1 &

# プロセスIDを確認
echo $!

# ログ監視
tail -f backfill.log
```

### 7-3. 進捗確認

```bash
# ベクトル設定済みの画像数を確認
watch -n 30 "curl -s '${OPENSEARCH_ENDPOINT}/cis-files-unified-v1/_count' \
  -H 'Content-Type: application/json' \
  --aws-sigv4 'aws:amz:${AWS_REGION}:es' \
  -d '{\"query\":{\"term\":{\"has_image_embedding\":true}}}' | jq '.count'"
```

---

## ステップ8: 旧インデックスのクリーンアップ（1週間後）

**重要:** 新インデックスが安定稼働していることを確認してから実行してください。

```bash
# 旧インデックスの削除
curl -XDELETE "${OPENSEARCH_ENDPOINT}/cis-files" \
  --aws-sigv4 "aws:amz:${AWS_REGION}:es"

curl -XDELETE "${OPENSEARCH_ENDPOINT}/file-index-v2-knn" \
  --aws-sigv4 "aws:amz:${AWS_REGION}:es"

# エイリアスの設定（オプション）
curl -XPOST "${OPENSEARCH_ENDPOINT}/_aliases" \
  -H 'Content-Type: application/json' \
  --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
  -d '{
    "actions": [
      { "add": { "index": "cis-files-unified-v1", "alias": "cis-files" } }
    ]
  }'
```

---

## トラブルシューティング

### 問題1: マイグレーション中にエラー

**症状:**
```
✗ Reindexジョブ開始失敗 (HTTP 500)
```

**解決策:**
```bash
# OpenSearchのログ確認
aws logs tail /aws/opensearch/vpc-cis-filesearch-xxx/index-slow-logs --follow

# クラスタの健全性確認
curl -s "${OPENSEARCH_ENDPOINT}/_cluster/health" \
  --aws-sigv4 "aws:amz:${AWS_REGION}:es" | jq

# ディスク容量確認
curl -s "${OPENSEARCH_ENDPOINT}/_cat/allocation?v" \
  --aws-sigv4 "aws:amz:${AWS_REGION}:es"
```

### 問題2: Worker起動失敗

**症状:**
```
✗ file-processor.service: Failed with result 'exit-code'
```

**解決策:**
```bash
# 詳細ログ確認
sudo journalctl -u file-processor.service -n 100 --no-pager

# 設定ファイル確認
cat /etc/systemd/system/file-processor.service

# 環境変数確認
sudo systemctl show file-processor.service -p Environment
```

### 問題3: Lambda実行エラー

**症状:**
```json
{
  "statusCode": 500,
  "body": "{\"error\":\"Internal server error\"}"
}
```

**解決策:**
```bash
# Lambdaログ確認
aws logs tail /aws/lambda/cis-search-api --follow

# Lambda環境変数確認
aws lambda get-function-configuration \
  --function-name cis-search-api \
  --query 'Environment.Variables' | jq
```

---

## ロールバック手順

問題が発生した場合、以下の手順でロールバックできます。

```bash
# 1. EC2 Workerをロールバック
sudo vi /etc/systemd/system/file-processor.service
# OPENSEARCH_INDEX=cis-files に変更

sudo systemctl daemon-reload
sudo systemctl restart file-processor.service

# 2. Lambdaをロールバック
aws lambda update-function-configuration \
  --function-name cis-search-api \
  --environment "Variables={OPENSEARCH_INDEX=cis-files}" \
  --region ap-northeast-1

# 3. 動作確認
bash verify-unified-index.sh
```

---

## サポート

問題が解決しない場合は、以下の情報を収集してサポートに連絡してください:

```bash
# システム情報収集
{
  echo "=== OpenSearch Cluster ==="
  curl -s "${OPENSEARCH_ENDPOINT}/_cluster/health" --aws-sigv4 "aws:amz:${AWS_REGION}:es" | jq

  echo "=== Indices ==="
  curl -s "${OPENSEARCH_ENDPOINT}/_cat/indices?v" --aws-sigv4 "aws:amz:${AWS_REGION}:es"

  echo "=== Worker Status ==="
  sudo systemctl status file-processor.service

  echo "=== Lambda Status ==="
  aws lambda get-function --function-name cis-search-api --query 'Configuration' | jq
} > support-info.txt
```

---

## 完了チェックリスト

- [ ] ステップ1: 統合インデックス作成完了
- [ ] ステップ2: データマイグレーション完了（ドキュメント数一致確認）
- [ ] ステップ3: 検証スクリプトで全テスト合格
- [ ] ステップ4: EC2 Worker更新完了（ログ確認）
- [ ] ステップ5: Lambda更新完了（テスト実行成功）
- [ ] ステップ6: フロントエンド動作確認（テキスト検索成功）
- [ ] ステップ7: 画像ベクトルバックフィル開始（オプション）
- [ ] 1週間後: 旧インデックスクリーンアップ

---

**おめでとうございます！** テキスト検索と画像検索の統合インデックス移行が完了しました。
