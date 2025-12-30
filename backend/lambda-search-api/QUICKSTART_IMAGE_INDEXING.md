# 画像検索 - 実画像インデックス化クイックスタート

## 概要

このガイドでは、実際のNAS画像にベクトル埋め込みを生成し、OpenSearchにインデックス化する手順を説明します。

## 前提条件

- AWS認証情報が設定済み
- OpenSearchドメインへのアクセス権限
- Lambda関数 `cis-image-embedding` がデプロイ済み
- Python 3.9以上

## 📋 ステップ1: 環境準備 (5分)

### 1.1 環境変数の設定

```bash
# 必須環境変数
export OPENSEARCH_ENDPOINT="your-opensearch-endpoint.ap-northeast-1.es.amazonaws.com"
export AWS_REGION="ap-northeast-1"

# オプション (デフォルト値あり)
export OPENSEARCH_INDEX="file-index-v2-knn"
export LAMBDA_FUNCTION_NAME="cis-image-embedding"
```

### 1.2 依存関係のインストール

```bash
cd backend/lambda-search-api

# Python依存関係
pip install -r requirements.txt

# または、仮想環境を使用
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 1.3 スクリプトに実行権限を付与

```bash
chmod +x scripts/check-opensearch-index.sh
chmod +x scripts/batch-index-images.py
chmod +x scripts/monitor-batch-progress.py
```

## 🔍 ステップ2: 現状確認 (5分)

### 2.1 OpenSearchインデックスの状態を確認

```bash
# インデックス統計を確認
./scripts/check-opensearch-index.sh file-index-v2-knn
```

**確認項目:**
- ✅ 総画像ファイル数
- ✅ ベクトル付き画像数
- ✅ ベクトルなし画像数
- ✅ インデックスサイズ

### 2.2 Lambda関数の動作確認

```bash
# Lambda関数のテスト
aws lambda invoke \
  --function-name cis-image-embedding \
  --payload '{"imageUrl":"s3://your-bucket/test-image.jpg","useCache":false}' \
  response.json

# レスポンス確認
cat response.json | jq '.'
```

**期待される出力:**
```json
{
  "statusCode": 200,
  "body": {
    "success": true,
    "data": {
      "embedding": [0.123, -0.456, ...],  // 512次元
      "dimension": 512,
      "model": "openai/clip-vit-base-patch32",
      "inferenceTime": 0.234,
      "cached": false
    }
  }
}
```

## 🧪 ステップ3: 小規模テスト (10分)

### 3.1 ドライラン (実際の処理なし)

```bash
# 最初の100ファイルをプレビュー
python scripts/batch-index-images.py \
  --dry-run \
  --max-files 100
```

**確認内容:**
- 処理対象ファイルのリスト
- ファイル名とパス
- ドキュメントID

### 3.2 小規模テスト (10ファイル)

```bash
# 10ファイルで実際に処理
python scripts/batch-index-images.py \
  --max-files 10 \
  --concurrency 3

# ログ確認
tail -f batch-indexing-*.log
```

**成功の確認:**
```
✓ Successfully indexed: image1.jpg
✓ Successfully indexed: image2.jpg
...
Batch Indexing Complete
Success Rate: 100.0%
```

### 3.3 結果の検証

```bash
# インデックス状態を再確認
./scripts/check-opensearch-index.sh

# ベクトルが追加されたことを確認
# "docs_with_image_vector" が増加しているはず
```

## 🚀 ステップ4: 本番バッチ処理 (数時間)

### 4.1 処理パラメータの決定

**画像数に応じたパラメータ:**

| 画像数 | Concurrency | Batch Size | 推定時間 |
|--------|-------------|------------|----------|
| ~1,000 | 5 | 50 | 10分 |
| ~10,000 | 10 | 100 | 1時間 |
| ~100,000 | 20 | 200 | 3-5時間 |
| ~1,000,000 | 30 | 300 | 1-2日 |

### 4.2 バッチ処理の開始

```bash
# 推奨設定でバッチ処理を開始
python scripts/batch-index-images.py \
  --concurrency 10 \
  --batch-size 100 \
  --resume \
  --state-file batch-progress.json \
  2>&1 | tee batch-processing.log
```

**パラメータの説明:**
- `--concurrency 10`: 10並列でLambda実行
- `--batch-size 100`: 100ファイルごとにバッチ処理
- `--resume`: 中断時に再開可能
- `--state-file`: 進捗状態を保存

### 4.3 別ターミナルで進捗モニタリング

```bash
# リアルタイムモニタリング (10秒ごと更新)
python scripts/monitor-batch-progress.py \
  --interval 10

# または1回だけ確認
python scripts/monitor-batch-progress.py --once
```

**モニタリング画面の例:**
```
==============================================================
  BATCH IMAGE INDEXING - PROGRESS MONITOR
==============================================================
Time: 2025-12-19 12:30:45 UTC

📄 STATE FILE
--------------------------------------------------------------
  Total Processed:     5,234
  Succeeded:           5,198
  Failed:              36
  Success Rate:        99.3%
  Throughput:          87.2 files/min
  Runtime:             60.0 minutes

🔍 OPENSEARCH INDEX
--------------------------------------------------------------
  Total Images:        100,000
  With Vectors:        5,198
  Without Vectors:     94,802
  Completion:          5.2%
  Progress: [██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]

  Estimated Completion: 2025-12-19 20:15:30 UTC
```

## 🛠️ トラブルシューティング

### 問題1: Lambda Timeout

**症状:**
```
Error: Lambda invocation timeout
```

**解決策:**
```bash
# Concurrencyを下げる
python scripts/batch-index-images.py \
  --concurrency 5 \
  --batch-size 50 \
  --resume
```

### 問題2: OpenSearch Throttling

**症状:**
```
Error: TooManyRequestsException
```

**解決策:**
```bash
# バッチ間に待機時間を追加 (スクリプト修正)
# またはConcurrencyを下げる
python scripts/batch-index-images.py \
  --concurrency 3 \
  --resume
```

### 問題3: Lambda Cache Miss率が高い

**症状:**
```
Cache Hit Rate: 5.0%  # 期待: 80%以上
```

**解決策:**
1. DynamoDBキャッシュテーブルの確認
2. Lambda関数のキャッシュロジック確認
3. 画像ハッシュの生成確認

```bash
# DynamoDBテーブルの確認
aws dynamodb describe-table \
  --table-name cis-image-embedding-cache

# テーブルアイテム数の確認
aws dynamodb scan \
  --table-name cis-image-embedding-cache \
  --select "COUNT"
```

### 問題4: 処理が途中で停止

**症状:**
バッチ処理が進まない

**解決策:**
```bash
# 1. ログファイルを確認
tail -100 batch-indexing-*.log

# 2. プロセスを確認
ps aux | grep batch-index-images

# 3. 安全に再開
# 進捗ファイルが保存されているので、--resumeで再開可能
python scripts/batch-index-images.py --resume
```

## 📊 完了後の検証

### 検証1: ベクトル数の確認

```bash
# 全画像にベクトルが付いたか確認
./scripts/check-opensearch-index.sh

# 期待される出力:
# docs_with_image_vector: 100,000 (例)
# docs_without_image_vector: 0
```

### 検証2: 画像検索テスト

```bash
# テスト画像で類似検索
curl -X POST "https://$OPENSEARCH_ENDPOINT/file-index-v2-knn/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "size": 10,
    "query": {
      "knn": {
        "image_vector": {
          "vector": [...],  # テスト画像のベクトル
          "k": 10
        }
      }
    }
  }'
```

### 検証3: フロントエンドでの動作確認

```bash
# フロントエンドを起動
cd frontend
npm run dev

# ブラウザで http://localhost:3000 にアクセス
# 画像検索機能をテスト
```

## 🎯 パフォーマンス最適化

### 最適化1: 並列度の調整

```bash
# システムリソースに応じて調整
# CPU: 4コア → Concurrency: 8-10
# CPU: 8コア → Concurrency: 15-20
# CPU: 16コア → Concurrency: 30-40
```

### 最適化2: Lambda関数の最適化

```bash
# Lambda関数のメモリを増やす
aws lambda update-function-configuration \
  --function-name cis-image-embedding \
  --memory-size 3008  # デフォルト: 2048

# タイムアウトを延長
aws lambda update-function-configuration \
  --function-name cis-image-embedding \
  --timeout 300  # デフォルト: 60
```

### 最適化3: OpenSearchの最適化

```bash
# リフレッシュ間隔を調整 (バッチ処理中)
curl -X PUT "https://$OPENSEARCH_ENDPOINT/file-index-v2-knn/_settings" \
  -H "Content-Type: application/json" \
  -d '{
    "index": {
      "refresh_interval": "30s"  # デフォルト: 1s
    }
  }'

# バッチ処理完了後、元に戻す
curl -X PUT "https://$OPENSEARCH_ENDPOINT/file-index-v2-knn/_settings" \
  -H "Content-Type: application/json" \
  -d '{
    "index": {
      "refresh_interval": "1s"
    }
  }'
```

## 📈 コスト見積もり

### 100,000画像の場合

| サービス | 使用量 | 単価 | コスト |
|----------|--------|------|--------|
| Lambda実行 | 100,000リクエスト | $0.20/100万 | $0.02 |
| Lambda実行時間 | 100,000秒 (2048MB) | $0.0000033/GB-秒 | $3.47 |
| DynamoDB (キャッシュ) | 100,000書き込み | $1.25/100万 | $0.13 |
| S3転送 (Lambda) | 100GB | 無料 | $0.00 |
| OpenSearch | インデックス増加 5GB | 既存ドメイン内 | $0.00 |
| **合計** | | | **$3.62** |

## 🔄 継続的インデックス化 (EC2 Worker統合)

バッチ処理完了後、新規画像を自動的にインデックス化するには:

### EC2 Workerの修正

```python
# backend/python-worker/worker.py に追加

from image_embedding_client import ImageEmbeddingClient

class FileProcessingWorker:
    def __init__(self, config):
        # 既存の初期化...
        self.embedding_client = ImageEmbeddingClient(
            lambda_function_name='cis-image-embedding'
        )

    def process_sqs_message(self, message):
        # 既存の処理...

        # 画像ファイルの場合
        if self.is_image_file(file_ext):
            # ベクトル生成
            embedding = self.embedding_client.generate_embedding(s3_url)
            if embedding:
                document['image_vector'] = embedding
                document['vector_dimension'] = len(embedding)

        # OpenSearchにインデックス
        self.opensearch.index_document(document)
```

### デプロイ

```bash
# EC2 Workerを再デプロイ
cd backend/python-worker
./deploy.sh
```

## ✅ チェックリスト

バッチ処理開始前:
- [ ] 環境変数が設定されている
- [ ] Lambda関数が正常に動作する
- [ ] OpenSearchへの接続が確認できる
- [ ] ドライランで対象ファイルを確認した
- [ ] 小規模テストが成功した

バッチ処理中:
- [ ] ログファイルを監視している
- [ ] 進捗モニターで状態を確認している
- [ ] エラー率が5%未満である
- [ ] スロットリングエラーが発生していない

バッチ処理完了後:
- [ ] 全画像にベクトルが付いた
- [ ] 画像検索が正常に動作する
- [ ] フロントエンドでテストした
- [ ] EC2 Workerに統合した
- [ ] モニタリングを設定した

## 📚 関連ドキュメント

- [画像検索戦略](./IMAGE_INDEXING_STRATEGY.md)
- [Lambda関数README](../lambda-image-embedding/README.md)
- [OpenSearch設定ガイド](./docs/opensearch-setup.md)

## 🆘 サポート

問題が発生した場合:
1. ログファイルを確認: `batch-indexing-*.log`
2. CloudWatchログを確認: `/aws/lambda/cis-image-embedding`
3. 進捗状態ファイルを確認: `batch-progress.json`
4. GitHubでIssueを作成
