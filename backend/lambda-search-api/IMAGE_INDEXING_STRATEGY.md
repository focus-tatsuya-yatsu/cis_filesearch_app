# 実画像のベクトルインデックス化戦略

## 現状分析

### 問題点
1. **サンプルデータのみがインデックス化されている**
   - `/shared/images/sample_*.jpg` のテストデータのみ
   - 実際のNAS画像のベクトルが存在しない

2. **既存インデックスの状態**
   - インデックス名: `file-index-v2-knn`
   - ベクトル次元: 1024 (AWS Bedrock Titan使用を想定)
   - 現在のベクトル: サンプル画像のみ

3. **ベクトル生成の不一致**
   - Lambda関数: CLIP model (512次元) を使用
   - OpenSearchインデックス: Titan (1024次元) を想定
   - **次元の不一致が発生している可能性**

## 解決策

### フェーズ1: インデックス構造の確認と修正 (即時)

#### 1.1 現在のインデックス状態を確認
```bash
# インデックス統計を確認
./scripts/check-opensearch-index.sh file-index-v2-knn

# マッピング確認
aws opensearchserverless get-index-mapping \
  --index-name file-index-v2-knn
```

#### 1.2 ベクトル次元の統一
以下のいずれかを選択:

**オプションA: CLIP (512次元) に統一**
- メリット: Lambda関数が既に実装済み、高速
- デメリット: Titanより精度が若干低い可能性

**オプションB: Titan (1024次元) に統一**
- メリット: AWS Bedrock統合、高精度
- デメリット: Bedrockコスト、スロットリング対策が必要

**推奨: オプションA (CLIP 512次元)**
- 理由: 既存実装の活用、コスト効率、実装速度

### フェーズ2: 新インデックスの作成 (推奨)

#### 2.1 新インデックス設計
```json
{
  "settings": {
    "index": {
      "knn": true,
      "knn.algo_param.ef_search": 100,
      "number_of_shards": 2,
      "number_of_replicas": 1
    }
  },
  "mappings": {
    "properties": {
      "file_name": { "type": "text" },
      "file_path": { "type": "keyword" },
      "file_extension": { "type": "keyword" },
      "file_size": { "type": "long" },
      "bucket": { "type": "keyword" },
      "file_key": { "type": "keyword" },
      "s3_url": { "type": "keyword" },
      "indexed_at": { "type": "date" },
      "image_vector": {
        "type": "knn_vector",
        "dimension": 512,
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
}
```

#### 2.2 新インデックス作成コマンド
```bash
# 新インデックス作成
aws opensearch create-index \
  --index-name file-index-v3-knn-512 \
  --body file://index-mapping-512.json

# エイリアス設定 (ゼロダウンタイム移行)
aws opensearch update-aliases \
  --actions '[
    {"add": {"index": "file-index-v3-knn-512", "alias": "file-index-current"}}
  ]'
```

### フェーズ3: バッチインデックス化戦略

#### 3.1 処理フロー
```
OpenSearch → ベクトルなし画像を検索
    ↓
S3から画像ダウンロード
    ↓
Lambda (CLIP) でベクトル生成
    ↓
OpenSearchに更新
```

#### 3.2 バッチサイズと並列度の設計

**画像数の見積もり**
- 想定: 100,000 〜 1,000,000 画像
- 処理速度: 1画像あたり 0.5〜2秒 (Lambda)

**バッチパラメータ**
```python
BATCH_SIZE = 100           # 1バッチあたりの画像数
CONCURRENCY = 10           # 並列Lambda実行数
LAMBDA_TIMEOUT = 300       # Lambda最大実行時間 (5分)
TPS_LIMIT = 10             # Lambda呼び出し制限 (TPS)
```

**処理時間の見積もり**
- 100,000画像 ÷ (10並列 × 100バッチ) = 100イテレーション
- 1イテレーション ≈ 30秒
- 合計: 約50分 〜 3時間

#### 3.3 スロットリング対策
```python
# Exponential backoff
retry_config = {
    'max_attempts': 5,
    'mode': 'adaptive',
    'base_delay': 1,
    'max_delay': 60
}

# バッチ間の待機時間
INTER_BATCH_DELAY = 0.5  # 秒
```

### フェーズ4: リアルタイムインデックス化 (継続的)

#### 4.1 EC2 Workerの拡張
```python
# worker.py の修正箇所

def process_file(self, file_info):
    # 既存の処理...

    # 画像ファイルの場合
    if self.is_image_file(file_info['extension']):
        # Lambda呼び出しでベクトル生成
        embedding = self.generate_image_embedding(
            s3_url=file_info['s3_url']
        )

        # OpenSearchドキュメントに追加
        document['image_vector'] = embedding

    # OpenSearchにインデックス
    self.opensearch.index_document(document)
```

#### 4.2 Lambda統合
```python
def generate_image_embedding(self, s3_url: str) -> List[float]:
    """Lambda経由で画像埋め込みを生成"""
    lambda_client = boto3.client('lambda')

    response = lambda_client.invoke(
        FunctionName='cis-image-embedding',
        InvocationType='RequestResponse',
        Payload=json.dumps({
            'imageUrl': s3_url,
            'useCache': True
        })
    )

    result = json.loads(response['Payload'].read())
    return result['data']['embedding']
```

### フェーズ5: モニタリングとメトリクス

#### 5.1 CloudWatchメトリクス
```python
metrics = {
    'TotalImagesProcessed': 0,
    'EmbeddingGenerationTime': [],
    'IndexingSuccessRate': 0,
    'ErrorRate': 0,
    'LambdaInvocations': 0,
    'CacheHitRate': 0
}
```

#### 5.2 進捗トラッキング
```python
# 進捗状態ファイル (S3保存)
state = {
    'last_processed_id': 'doc_12345',
    'total_processed': 50000,
    'total_remaining': 50000,
    'success_count': 49800,
    'failure_count': 200,
    'start_time': '2025-12-19T10:00:00Z',
    'estimated_completion': '2025-12-19T12:30:00Z'
}
```

## 実装手順

### ステップ1: 準備 (5分)
```bash
# 1. 環境変数設定
export OPENSEARCH_ENDPOINT="your-opensearch-endpoint"
export S3_BUCKET="your-s3-bucket"
export AWS_REGION="ap-northeast-1"

# 2. 現状確認
./scripts/check-opensearch-index.sh

# 3. 依存関係インストール
pip install -r requirements.txt
```

### ステップ2: インデックス準備 (10分)
```bash
# 1. 新インデックス作成
python scripts/create-new-index.py \
  --index-name file-index-v3-knn-512 \
  --vector-dimension 512

# 2. マッピング確認
python scripts/verify-index-mapping.py \
  --index-name file-index-v3-knn-512
```

### ステップ3: バッチ処理テスト (15分)
```bash
# 1. ドライラン (最初の100ファイル)
python scripts/batch-index-images.py \
  --dry-run \
  --max-files 100

# 2. 小規模テスト (実際に処理)
python scripts/batch-index-images.py \
  --max-files 100 \
  --concurrency 5
```

### ステップ4: 本番バッチ処理 (数時間)
```bash
# リジューム可能なバッチ処理
python scripts/batch-index-images.py \
  --batch-size 100 \
  --concurrency 10 \
  --resume \
  --state-file batch-progress.json

# モニタリング (別ターミナル)
watch -n 10 'python scripts/check-batch-progress.py'
```

### ステップ5: 検証 (10分)
```bash
# 1. ベクトル数の確認
./scripts/check-opensearch-index.sh file-index-v3-knn-512

# 2. サンプル検索テスト
python scripts/test-image-search.py \
  --test-image sample-street.jpg \
  --top-k 10

# 3. エイリアス切り替え (問題なければ)
python scripts/switch-index-alias.py \
  --new-index file-index-v3-knn-512
```

## コスト見積もり

### Lambda実行コスト
- 想定: 100,000画像
- 実行時間: 平均1秒/画像
- メモリ: 2048MB
- コスト: 約$0.33 (リクエスト) + $3.47 (実行時間) = **$3.80**

### OpenSearchコスト
- インデックスサイズ増加: 約5GB (100,000画像 × 512次元 × 4バイト)
- 追加コスト: ほぼなし (既存ドメイン内)

### S3転送コスト
- データ転送: 100,000画像 × 平均1MB = 100GB
- コスト: 約$0.90 (Lambda→S3は無料)

**合計見積もり: 約$5〜10**

## トラブルシューティング

### 問題1: Lambda Timeout
```python
# 解決策: バッチサイズを小さくする
BATCH_SIZE = 50  # 100から50に削減
```

### 問題2: OpenSearch Throttling
```python
# 解決策: リトライとバックオフ
retry_strategy = ExponentialBackoff(
    base=2,
    max_delay=60,
    max_attempts=5
)
```

### 問題3: メモリ不足
```python
# 解決策: ストリーミング処理
for batch in stream_batches(all_files, batch_size=100):
    process_batch(batch)
    gc.collect()  # メモリ解放
```

## まとめ

この戦略により、以下が達成されます:

1. ✅ 既存インデックスの問題を特定
2. ✅ 新しい512次元k-NNインデックスを作成
3. ✅ 数百万画像を効率的にインデックス化
4. ✅ リアルタイム処理を継続的に実行
5. ✅ モニタリングとエラーハンドリング

**次のアクション:**
1. `check-opensearch-index.sh` を実行して現状確認
2. `batch-index-images.py` でバッチ処理開始
3. 結果を検証して本番環境へ展開
