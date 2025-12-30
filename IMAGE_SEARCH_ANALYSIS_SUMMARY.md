# 画像検索機能 - 分析サマリー

## 📊 現状

### 問題の症状
- **画像検索結果**: サンプルデータ(sample_1.jpg ~ sample_10.jpg)のみ表示
- **実ファイル**: OpenSearchに存在するが、画像検索結果に表示されない
- **デバッグログ**: 10件→6件（信頼度フィルタ後）、すべてサンプルデータ

## 🔍 根本原因

### 1. アーキテクチャギャップ

システムに**2つの独立した処理パイプライン**が存在し、連携できていない:

#### 🔵 パイプライン A: ファイル処理（稼働中）
```
S3 Upload → SQS → EC2 Worker → OpenSearch
```
- **処理内容**: OCR、サムネイル生成、メタデータ抽出
- **問題**: 画像ベクトル化が**実装されているが無効化**されている
- **結果**: `image_vector`フィールドなしでインデックス

#### 🔴 パイプライン B: 画像検索（部分実装）
```
画像アップロード → Lambda Image Embedding → OpenSearch k-NN検索
```
- **処理内容**: アップロードされた検索用画像のベクトル化
- **問題**: 既存ファイルに`image_vector`がないため検索対象外
- **結果**: サンプルデータ(手動でベクトル付与)のみ検索可能

### 2. ベクトル次元数の不一致

| コンポーネント | 次元数 | モデル |
|---------------|--------|--------|
| Lambda Image Embedding | **512** | CLIP (openai/clip-vit-base-patch32) |
| EC2 Worker Bedrock | **1024** | Titan Multimodal Embeddings |
| OpenSearch Index | **1024** | knn_vector定義 |

### 3. EC2 Worker設定の問題

**コードは実装済み**だが、環境変数で無効化されている可能性:

```python
# backend/ec2-worker/src/main.py (272行目)
def _generate_vector(self, file_path: str, document: Dict) -> Dict:
    if file_extension in ['.jpg', '.jpeg', '.png', '.gif', '.bmp']:
        # ✓ コードは正常に実装されている
        vector = self.bedrock_client.generate_image_embedding(file_path)
        if vector:
            return {'image_vector': vector}  # ← このフィールドが重要
```

**しかし**:
```python
# config.features.enable_vector_search がFalseの可能性
if config.features.enable_vector_search:
    vector_result = self._generate_vector(temp_file, document)
```

## ✅ 解決策

### 即座に実施（今日中）

#### Step 1: EC2 Worker設定確認

```bash
# EC2にSSH接続
ssh ec2-user@your-ec2-ip

# 環境変数確認
env | grep -E "ENABLE_VECTOR|BEDROCK"

# 期待される値:
# ENABLE_VECTOR_SEARCH=true
# BEDROCK_REGION=us-east-1
# BEDROCK_MODEL_ID=amazon.titan-embed-image-v1
```

#### Step 2: 設定修正（必要な場合）

```bash
# 設定ファイル編集
sudo vi /opt/cis-worker/.env

# 追加・修正:
ENABLE_VECTOR_SEARCH=true
BEDROCK_REGION=us-east-1
BEDROCK_MODEL_ID=amazon.titan-embed-image-v1

# サービス再起動
sudo systemctl restart cis-worker

# ログ確認
sudo journalctl -u cis-worker -f | grep -E "Bedrock|vector|embedding"
```

#### Step 3: テスト実行

```bash
# テスト画像をアップロード
aws s3 cp test-image.jpg s3://your-landing-bucket/test/

# SQSメッセージ送信
aws sqs send-message --queue-url YOUR_QUEUE_URL --message-body '{
  "Records": [{
    "s3": {
      "bucket": {"name": "your-landing-bucket"},
      "object": {"key": "test/test-image.jpg"}
    }
  }]
}'

# OpenSearchで確認
curl "$OPENSEARCH_ENDPOINT/file-index-v2-knn/_search?q=test-image.jpg" | \
  jq '.hits.hits[]._source | {file_name, has_vector: (.image_vector != null)}'
```

**期待される結果**:
```json
{
  "file_name": "test-image.jpg",
  "has_vector": true  // ← これがtrueならOK
}
```

### 1-2日以内に実施

#### Step 4: Lambda Image Embeddingを1024次元に統一

**現在の問題**:
- Lambda: 512次元 (CLIP)
- OpenSearch: 1024次元 (想定)

**解決策**: LambdaをTitan Multimodalに変更

```python
# backend/lambda-image-embedding/handler.py
# 変更前:
# MODEL_NAME = 'openai/clip-vit-base-patch32'
# VECTOR_DIMENSION = 512

# 変更後: Bedrockを使用
bedrock = boto3.client('bedrock-runtime', region_name='us-east-1')

def generate_embedding_titan(image_base64):
    response = bedrock.invoke_model(
        modelId='amazon.titan-embed-image-v1',
        body=json.dumps({'inputImage': image_base64})
    )
    result = json.loads(response['body'].read())
    return result['embedding']  # 1024次元
```

#### Step 5: バッチ処理スクリプト実行

**既存ファイルにベクトルを追加**:

```bash
# EC2上で実行（VPC内からOpenSearchにアクセス可能）
cd /opt/cis-worker/scripts

# ドライラン（プレビュー）
python3 batch-generate-image-embeddings.py \
  --dry-run \
  --max-files 10

# 小規模テスト（100ファイル）
python3 batch-generate-image-embeddings.py \
  --max-files 100 \
  --tps-limit 8

# 本番実行（全ファイル、夜間推奨）
python3 batch-generate-image-embeddings.py \
  --tps-limit 8 \
  --batch-size 10
```

**進捗モニタリング**:
```bash
# 別ターミナルでログ監視
tail -f batch-embedding-*.log

# CloudWatchメトリクス確認
aws cloudwatch get-metric-statistics \
  --namespace CIS/BatchEmbedding \
  --metric-name FilesProcessed \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

## 📈 パフォーマンス見積もり

### 処理時間

| ファイル数 | 処理時間（8 TPS） | コスト |
|-----------|------------------|--------|
| 100 | 約12秒 | $0.006 |
| 1,000 | 約2分 | $0.06 |
| 10,000 | 約20分 | $0.60 |
| 100,000 | 約3.5時間 | $6.00 |

**計算根拠**:
- Bedrock TPS制限: 10 TPS（安全マージンで8 TPS使用）
- 1ファイルあたり処理時間: 0.125秒（8 TPS）
- Bedrock料金: $0.00006/image

### リソース使用量

**EC2インスタンス**:
- CPU: 中程度（画像処理時にスパイク）
- メモリ: 低～中程度（一時ファイル保存）
- ディスクI/O: 中程度（S3ダウンロード/アップロード）

**Bedrock**:
- スロットリング対策: 自動リトライ実装済み
- エラーハンドリング: ThrottlingException検出時は5秒待機

## 🎯 検証方法

### 1. 新規ファイルの自動ベクトル化確認

```bash
# 最近処理されたファイルを確認
curl -X POST "$OPENSEARCH_ENDPOINT/file-index-v2-knn/_search" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {"match_all": {}},
    "sort": [{"indexed_at": "desc"}],
    "size": 10,
    "_source": ["file_name", "indexed_at", "image_vector"]
  }' | jq '.hits.hits[]._source | {
    file_name,
    indexed_at,
    has_vector: (.image_vector != null),
    vector_dim: (.image_vector | length)
  }'
```

### 2. ベクトル付きファイル数カウント

```bash
# ベクトルがあるファイル数
curl -X POST "$OPENSEARCH_ENDPOINT/file-index-v2-knn/_search" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {"exists": {"field": "image_vector"}},
    "size": 0
  }' | jq '.hits.total.value'

# ベクトルがないファイル数
curl -X POST "$OPENSEARCH_ENDPOINT/file-index-v2-knn/_search" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {
      "bool": {
        "must": [{"terms": {"file_extension": [".jpg", ".jpeg", ".png", ".gif"]}}],
        "must_not": [{"exists": {"field": "image_vector"}}]
      }
    },
    "size": 0
  }' | jq '.hits.total.value'
```

### 3. 画像検索機能テスト

1. **フロントエンドから画像をアップロード**
2. **検索実行**
3. **結果確認**:
   - ✅ サンプルデータ以外のファイルも表示される
   - ✅ スコアが適切（90%以上の類似度）
   - ✅ レスポンスタイム < 1秒

## 📋 チェックリスト

### 緊急対応（今日）
- [ ] EC2 Worker環境変数確認
- [ ] `ENABLE_VECTOR_SEARCH=true` 設定
- [ ] サービス再起動
- [ ] テストファイルでベクトル生成確認
- [ ] OpenSearchで`image_vector`フィールド確認

### 短期対応（1-2日）
- [ ] Lambda Image EmbeddingをTitan(1024次元)に変更
- [ ] デプロイ・テスト
- [ ] バッチ処理スクリプトのテスト実行(100ファイル)
- [ ] エラーハンドリング検証

### 中期対応（1週間）
- [ ] 既存ファイルのバッチ処理実行（夜間）
- [ ] 進捗モニタリング
- [ ] エラー対応
- [ ] 全体的な検証

### 完了確認
- [ ] 新規ファイルが自動的にベクトル付与
- [ ] 画像検索で実ファイルが結果に表示
- [ ] 検索精度が適切
- [ ] エラーログなし
- [ ] パフォーマンス目標達成（検索 < 1秒）

## 📖 参考ドキュメント

作成したドキュメント:
1. **詳細分析**: `/docs/IMAGE_SEARCH_GAP_ANALYSIS.md`
2. **クイックフィックス**: `/docs/IMAGE_SEARCH_QUICK_FIX.md`
3. **バッチスクリプト**: `/backend/scripts/batch-generate-image-embeddings.py`

既存ドキュメント:
- `/IMAGE_SEARCH_DEPLOYMENT_QUICKSTART.md`
- `/frontend/IMAGE_SEARCH_README.md`

## 🚨 トラブルシューティング

### 問題: Bedrock権限エラー

```bash
# エラー: AccessDeniedException
# 解決: EC2インスタンスロールにポリシー追加
{
  "Effect": "Allow",
  "Action": "bedrock:InvokeModel",
  "Resource": "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-image-v1"
}
```

### 問題: OpenSearchマッピングエラー

```bash
# エラー: mapper_parsing_exception
# 原因: インデックスに image_vector フィールド定義なし
# 解決: インデックス再作成（または既存インデックス確認）
```

### 問題: ベクトル次元数エラー

```bash
# エラー: KNN vector dimension mismatch
# 原因: Lambda(512次元)とOpenSearch(1024次元)の不一致
# 解決: Lambdaを1024次元に変更
```

## 🎉 期待される成果

すべての対策実施後:

✅ **新規ファイル**: 自動的に画像ベクトル付与
✅ **既存ファイル**: バッチ処理で全ファイルにベクトル追加
✅ **画像検索**: 全画像ファイルが検索対象
✅ **検索精度**: 高精度な類似画像検索
✅ **ユーザー体験**: サンプルデータだけでなく実ファイルも検索可能

---

**推奨される次のアクション**: EC2 Workerの設定確認から始めてください。

詳細な手順は `/docs/IMAGE_SEARCH_QUICK_FIX.md` を参照してください。
