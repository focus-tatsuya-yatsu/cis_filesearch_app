# 画像検索機能 - ギャップ分析レポート

## 現状分析

### 現在の状況
- **画像検索UI**: 完全実装済み
- **検索結果**: サンプルデータ(sample_1.jpg ~ sample_10.jpg)のみ表示
- **実ファイル**: システムに存在するが、画像検索結果に表示されない

### デバッグログから判明した事実

```
OpenSearchレスポンス:
- 総件数: 10件
- 信頼度フィルタ後: 6件
- すべてサンプルデータ
```

## 根本原因の特定

### 1. アーキテクチャギャップ

現在のシステムには**2つの分離された処理パイプライン**が存在:

#### パイプライン A: テキスト検索用（稼働中）
```
S3 File Upload
    ↓
SQS Queue
    ↓
EC2 Worker (python-worker または ec2-worker)
    ↓
ファイル処理:
  - OCR処理
  - サムネイル生成
  - メタデータ抽出
    ↓
OpenSearch インデックス
  - テキストコンテンツ
  - ファイルメタデータ
  - ✗ image_embedding フィールド (未実装)
```

**問題**: EC2 Workerは画像ベクトル化を実装していない
- `bedrock_client.py`に`generate_image_embedding()`メソッドは存在
- しかし、**実際の処理パイプラインでは呼び出されていない**
- OpenSearchに`image_vector`フィールドなしでインデックス

#### パイプライン B: 画像検索用（部分実装）
```
ユーザーがアップロードした検索用画像
    ↓
Frontend (/api/image-embedding)
    ↓
Lambda (lambda-image-embedding)
    - CLIPモデルで512次元ベクトル生成
    ↓
Frontend → Lambda Search API
    ↓
OpenSearch k-NN検索
    - ✗ 既存ファイルに image_embedding がない
    - ✓ サンプルデータのみ image_embedding を持つ
```

**結果**: サンプルデータ(手動で埋め込みを付与)のみ検索可能

### 2. ベクトル次元数の不一致

| コンポーネント | ベクトル次元数 | モデル |
|---------------|---------------|--------|
| **Lambda Image Embedding** | 512 | CLIP (openai/clip-vit-base-patch32) |
| **EC2 Worker Bedrock** | 1024 | Titan Multimodal Embeddings |
| **OpenSearch Index** | 1024 | knn_vector定義 |

**問題**: 検索用画像は512次元、インデックスは1024次元を想定

### 3. インデックスマッピングの確認

OpenSearch `file-index-v2-knn` のマッピング:
```json
{
  "image_vector": {
    "type": "knn_vector",
    "dimension": 1024,
    "method": {
      "name": "hnsw",
      "space_type": "cosinesimil",
      "engine": "faiss"
    }
  }
}
```

**確認事項**:
- ✓ k-NN対応インデックス作成済み
- ✓ 1024次元設定
- ✗ 既存ファイルには`image_vector`フィールドが存在しない

## 解決策の提案

### Option 1: バッチ処理で既存ファイルにベクトル追加（推奨）

#### メリット
- 既存データを活用可能
- ユーザーは即座に全ファイルを検索可能
- 一度実行すれば完了

#### 実装手順

**Step 1: バッチ処理スクリプト作成**
```bash
# backend/scripts/batch-generate-embeddings.py
```

処理フロー:
1. OpenSearchから全画像ファイルを取得
2. S3から画像をダウンロード
3. Bedrock Titanで1024次元ベクトル生成
4. OpenSearchの既存ドキュメントを更新

**Step 2: Lambda Image Embeddingをベクトル次元統一**
- CLIPモデル(512次元) → Titan Multimodal(1024次元)に変更
- または、512次元用の新しいインデックスを作成

**Step 3: 実行**
```bash
# EC2インスタンス上で実行（VPC内からOpenSearchにアクセス）
python3 batch-generate-embeddings.py \
  --index file-index-v2-knn \
  --batch-size 10 \
  --file-types .jpg,.jpeg,.png,.gif
```

**推定処理時間**:
- 10,000ファイル × 2秒/ファイル = 約5.5時間
- 並列処理で短縮可能

### Option 2: オンデマンド処理（遅延インデックス）

#### メリット
- 初期負荷なし
- リソース消費を分散

#### デメリット
- ユーザーが検索時に「見つからない」体験
- 処理完了まで検索結果に表示されない

#### 実装手順

1. **検索時トリガー**: ユーザーが画像検索を実行
2. **バックグラウンド処理**:
   - 検索対象ファイルでベクトルがないものを検出
   - SQSキューに送信
   - 非同期でベクトル生成・インデックス更新
3. **再検索**: 数分後に再度検索すると結果に表示

**実装の複雑さ**: 高い

### Option 3: ハイブリッドアプローチ（推奨）

#### 1. 既存ファイルのバッチ処理
- まず重要な画像ファイル（最近追加されたもの、頻繁にアクセスされるもの）を優先処理
- 夜間バッチで残りを処理

#### 2. 新規ファイルの自動処理
- EC2 Workerのパイプラインに画像ベクトル化を追加
- 新しくアップロードされたファイルは自動的にベクトル付与

**修正箇所**: `backend/ec2-worker/src/main.py`

```python
# 272行目あたり、_generate_vector()メソッド
def _generate_vector(self, file_path: str, document: Dict) -> Dict:
    """ベクトル埋め込みを生成"""
    try:
        file_extension = Path(file_path).suffix.lower()

        # 画像ファイルの場合
        if file_extension in ['.jpg', '.jpeg', '.png', '.gif', '.bmp']:
            logger.debug(f"Generating image vector for {file_path}")

            # ✅ 画像ベクトル生成（既存コード、正常に動作）
            vector = self.bedrock_client.generate_image_embedding(file_path)

            if vector:
                return {'image_vector': vector}  # ✅ フィールド名を修正

        # ... 以下省略
```

**問題**: この処理は`config.features.enable_vector_search`フラグで制御されている

**確認事項**:
```bash
# EC2インスタンスで環境変数を確認
echo $ENABLE_VECTOR_SEARCH  # true に設定されているか？
```

## ベクトル次元数統一の必要性

### 現状の不一致
- **Lambda (検索用)**: 512次元 (CLIP)
- **EC2 Worker**: 1024次元 (Titan)
- **OpenSearch**: 1024次元

### 解決策: Lambda側をTitanに統一

**メリット**:
- EC2 Workerと同じモデル使用
- OpenSearchインデックスの再作成不要
- 一貫性のある検索精度

**修正内容**: `backend/lambda-image-embedding/handler.py`

```python
# 現在: CLIP (512次元)
MODEL_NAME = 'openai/clip-vit-base-patch32'
VECTOR_DIMENSION = 512

# 変更後: Titan Multimodal (1024次元)
# Bedrock APIを使用（EC2 Workerと同じ）
import boto3
bedrock = boto3.client('bedrock-runtime')

def generate_embedding_titan(image_base64):
    response = bedrock.invoke_model(
        modelId='amazon.titan-embed-image-v1',
        body=json.dumps({'inputImage': image_base64})
    )
    result = json.loads(response['body'].read())
    return result['embedding']  # 1024次元
```

## 実装チェックリスト

### Phase 1: 緊急対応（即座に実施）

- [ ] **EC2 Worker環境変数確認**
  ```bash
  # EC2にSSH接続
  cat /etc/environment | grep VECTOR
  systemctl status cis-worker
  ```

- [ ] **設定有効化**
  ```bash
  # .envファイル編集
  ENABLE_VECTOR_SEARCH=true
  BEDROCK_REGION=us-east-1
  BEDROCK_MODEL_ID=amazon.titan-embed-image-v1

  # サービス再起動
  sudo systemctl restart cis-worker
  ```

- [ ] **新規ファイルテスト**
  - テスト画像をS3にアップロード
  - SQS経由で処理されることを確認
  - OpenSearchで`image_vector`フィールドが追加されているか確認

### Phase 2: バッチ処理スクリプト作成

- [ ] **スクリプト実装**
  - OpenSearchクライアント初期化
  - S3ダウンロード処理
  - Bedrockベクトル生成
  - バルク更新処理

- [ ] **エラーハンドリング**
  - リトライロジック
  - 進捗状況保存（中断再開可能）
  - CloudWatchメトリクス送信

### Phase 3: Lambda統一

- [ ] **Lambda Image Embedding修正**
  - CLIPからTitan Multimodalに変更
  - 512次元 → 1024次元
  - テスト実行

- [ ] **フロントエンド検証**
  - 新しいベクトルで検索実行
  - 結果の精度確認

### Phase 4: バッチ実行

- [ ] **小規模テスト**
  - 100ファイルで試験実行
  - 処理時間、エラー率を測定

- [ ] **本番実行**
  - 全画像ファイルを処理
  - 進捗モニタリング

## パフォーマンス考慮事項

### Bedrockスロットリング対策

**制限**:
- Titan Multimodal: 10 TPS (Transactions Per Second)
- バッチ処理: 10ファイル/秒が上限

**対策**:
```python
import time
from botocore.exceptions import ClientError

def batch_process_with_throttle(files, tps=8):
    """スロットリング対策付きバッチ処理"""
    delay = 1.0 / tps  # 0.125秒 (8 TPS)

    for file in files:
        try:
            embedding = generate_embedding(file)
            update_opensearch(file, embedding)
            time.sleep(delay)
        except ClientError as e:
            if e.response['Error']['Code'] == 'ThrottlingException':
                time.sleep(5)  # 5秒待機して再試行
                retry_with_backoff(file)
```

### コスト見積もり

**Bedrock Titan Multimodal料金** (2024年価格):
- 画像エンベディング: $0.00006 per image

**10,000ファイルの場合**:
- 10,000 × $0.00006 = **$0.60**

**100,000ファイルの場合**:
- 100,000 × $0.00006 = **$6.00**

**結論**: 非常に低コスト

## 検証計画

### テストケース

1. **新規ファイルアップロード**
   - 画像をS3にアップロード
   - SQS → EC2 Worker → OpenSearch
   - `image_vector`フィールド確認

2. **バッチ処理**
   - サンプル100ファイル処理
   - OpenSearchで更新確認
   - エラーログ確認

3. **画像検索**
   - フロントエンドから検索実行
   - サンプルデータ以外のファイルも結果に表示されるか確認
   - 検索精度(スコア)確認

4. **パフォーマンス**
   - 検索レスポンスタイム < 1秒
   - バッチ処理: 8ファイル/秒

## まとめ

### 現在の問題
1. **EC2 Workerがベクトル生成していない** → 設定確認・有効化
2. **Lambda(512次元)とOpenSearch(1024次元)の不一致** → Lambda修正
3. **既存ファイルにベクトルなし** → バッチ処理で追加

### 推奨アクション順序

**今すぐ実施**:
1. EC2 Worker設定確認・有効化
2. 新規ファイルでテスト

**1-2日以内**:
3. Lambda Image EmbeddingをTitanに統一
4. バッチ処理スクリプト作成・テスト

**1週間以内**:
5. 既存ファイルのバッチ処理実行（夜間）
6. 全体的な検証

### 期待される結果

✅ 全画像ファイルが画像検索対象に
✅ サンプルデータだけでなく、実ファイルも検索結果に表示
✅ 高精度な類似画像検索
✅ 新規アップロードファイルは自動的にベクトル付与

---

**次のステップ**: EC2 Worker設定確認と環境変数の有効化から始めることを推奨します。
