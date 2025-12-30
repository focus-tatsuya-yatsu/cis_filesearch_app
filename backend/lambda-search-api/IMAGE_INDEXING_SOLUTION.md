# 実画像インデックス化ソリューション - 実行サマリー

## 📌 現状の問題

### 1. サンプルデータのみインデックス化
- 画像検索で `/shared/images/sample_*.jpg` のみがヒット
- 実際のNAS画像のベクトルが存在しない
- テストデータと本番データが混在

### 2. ベクトル次元の不一致
- OpenSearchインデックス: 1024次元 (Titan想定)
- Lambda関数: 512次元 (CLIP使用)
- **次元が一致していない**

### 3. インデックス化プロセスの欠如
- 既存画像のベクトル生成プロセスがない
- 数百万ファイルのスケーラブルな処理方法がない

## ✅ 提供されたソリューション

### 作成したファイル一覧

```
backend/lambda-search-api/
├── IMAGE_INDEXING_STRATEGY.md          # 包括的な戦略ドキュメント
├── QUICKSTART_IMAGE_INDEXING.md        # 実行手順ガイド
├── IMAGE_INDEXING_SOLUTION.md          # このファイル
├── scripts/
│   ├── check-opensearch-index.sh       # インデックス状態確認スクリプト
│   ├── batch-index-images.py           # バッチインデックス化スクリプト
│   ├── monitor-batch-progress.py       # 進捗モニタリングスクリプト
│   └── requirements.txt                # Python依存関係
```

## 🎯 ソリューションの特徴

### 1. 既存Lambdaの活用
- `lambda-image-embedding` (CLIP 512次元) を使用
- DynamoDBキャッシュで高速化
- コスト効率的

### 2. スケーラブルなバッチ処理
- 並列Lambda呼び出し (最大30並列)
- 中断・再開機能 (Resume)
- 進捗状態の永続化

### 3. 包括的なモニタリング
- リアルタイム進捗表示
- CloudWatchメトリクス統合
- 完了時間の推定

## 🚀 即座に実行可能な手順

### ステップ1: 環境準備 (1分)

```bash
# 環境変数設定
export OPENSEARCH_ENDPOINT="your-endpoint.ap-northeast-1.es.amazonaws.com"
export AWS_REGION="ap-northeast-1"

# ディレクトリ移動
cd backend/lambda-search-api

# 依存関係インストール
pip install -r scripts/requirements.txt

# スクリプト実行権限
chmod +x scripts/*.sh scripts/*.py
```

### ステップ2: 現状確認 (2分)

```bash
# OpenSearchインデックスの状態確認
./scripts/check-opensearch-index.sh
```

**確認内容:**
- 総画像ファイル数
- ベクトル付き/なし画像数
- サンプルファイルのパス

### ステップ3: テスト実行 (5分)

```bash
# ドライラン (処理のプレビュー)
python scripts/batch-index-images.py --dry-run --max-files 100

# 10ファイルで実テスト
python scripts/batch-index-images.py --max-files 10 --concurrency 3
```

### ステップ4: 本番バッチ処理 (数時間)

```bash
# バッチ処理開始 (Terminal 1)
python scripts/batch-index-images.py \
  --concurrency 10 \
  --batch-size 100 \
  --resume

# モニタリング (Terminal 2)
python scripts/monitor-batch-progress.py --interval 10
```

## 📊 処理時間・コスト見積もり

### 画像数別の見積もり

| 画像数 | 処理時間 | Lambda実行コスト | 合計コスト | 推奨設定 |
|--------|----------|------------------|------------|----------|
| 1,000 | 10分 | $0.04 | $0.05 | concurrency=5 |
| 10,000 | 1時間 | $0.36 | $0.40 | concurrency=10 |
| 100,000 | 3-5時間 | $3.62 | $4.00 | concurrency=20 |
| 1,000,000 | 1-2日 | $36.20 | $40.00 | concurrency=30 |

### コスト内訳
- Lambda実行: $0.0000033/GB-秒 (2048MB)
- Lambda呼び出し: $0.20/100万リクエスト
- DynamoDBキャッシュ: $1.25/100万書き込み
- S3転送: 無料 (Lambda→S3)

## 🔧 技術的な詳細

### アーキテクチャ

```
┌─────────────────┐
│  OpenSearch     │
│  Query Images   │◄─── 1. ベクトルなし画像を検索
│  without Vector │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Batch Script   │
│  (Python)       │◄─── 2. 並列処理 (10-30並列)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Lambda         │
│  CLIP Model     │◄─── 3. 512次元ベクトル生成
│  (512D)         │      キャッシュ活用
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  OpenSearch     │
│  Update Vector  │◄─── 4. ドキュメント更新
└─────────────────┘
```

### 主要パラメータ

```python
# バッチ処理設定
CONCURRENCY = 10           # 並列Lambda実行数
BATCH_SIZE = 100           # 1バッチあたりのファイル数
VECTOR_DIMENSION = 512     # CLIPモデル次元
RETRY_MAX_ATTEMPTS = 3     # リトライ回数

# Lambda設定
LAMBDA_TIMEOUT = 300       # 5分
LAMBDA_MEMORY = 2048       # 2GB

# OpenSearch設定
REFRESH_INTERVAL = "30s"   # バッチ処理中
INDEX_NAME = "file-index-v2-knn"
```

### エラーハンドリング

```python
# 1. Lambda Timeout → Concurrencyを下げる
# 2. OpenSearch Throttling → バッチサイズを小さくする
# 3. メモリ不足 → ストリーミング処理
# 4. ネットワークエラー → 自動リトライ (Exponential Backoff)
```

## 📈 モニタリング

### リアルタイムメトリクス
- 処理済みファイル数
- 成功率
- スループット (files/min)
- Lambda キャッシュヒット率
- 推定完了時刻

### CloudWatchメトリクス
- `CIS/ImageIndexing/FilesProcessed`
- `CIS/ImageIndexing/SuccessRate`
- `CIS/ImageIndexing/CacheHitRate`

## 🎓 使用方法

### 基本的な実行

```bash
# デフォルト設定で実行
python scripts/batch-index-images.py
```

### カスタマイズ実行

```bash
# 並列度とバッチサイズを調整
python scripts/batch-index-images.py \
  --concurrency 20 \
  --batch-size 200 \
  --max-files 50000
```

### 中断から再開

```bash
# 進捗ファイルから自動再開
python scripts/batch-index-images.py --resume
```

### 進捗確認

```bash
# リアルタイムモニタリング
python scripts/monitor-batch-progress.py

# 1回だけ確認
python scripts/monitor-batch-progress.py --once
```

## ⚠️ 注意事項

### 1. ベクトル次元の統一

現在のインデックスが1024次元の場合:

**オプションA: 新インデックス作成 (推奨)**
```bash
# 512次元の新インデックスを作成
python scripts/create-index-512d.py

# エイリアスで切り替え
python scripts/switch-index-alias.py
```

**オプションB: 既存インデックス修正**
```bash
# 既存インデックスのマッピング確認
curl -X GET "$OPENSEARCH_ENDPOINT/file-index-v2-knn/_mapping"

# 512次元に対応しているか確認
```

### 2. Lambda同時実行制限

AWSアカウントのLambda同時実行制限を確認:
```bash
aws lambda get-account-settings
```

必要に応じて制限を引き上げ:
```bash
aws service-quotas request-service-quota-increase \
  --service-code lambda \
  --quota-code L-B99A9384 \
  --desired-value 1000
```

### 3. OpenSearchクラスタの負荷

大規模インデックス化中は:
- リフレッシュ間隔を長くする (30秒)
- レプリカを一時的に無効化
- バッチ処理後に復元

## 🔍 トラブルシューティング

### Q1: "No files to process" と表示される

**原因:** 全画像にベクトルが既に存在
**確認:**
```bash
./scripts/check-opensearch-index.sh
```

### Q2: Lambda Timeoutエラー

**原因:** ネットワーク遅延、大きな画像サイズ
**解決策:**
```bash
# Concurrencyを下げる
python scripts/batch-index-images.py --concurrency 5
```

### Q3: OpenSearch Throttlingエラー

**原因:** 書き込みレートが高すぎる
**解決策:**
```bash
# バッチサイズを小さくする
python scripts/batch-index-images.py --batch-size 50
```

### Q4: キャッシュヒット率が低い

**原因:** DynamoDBキャッシュテーブルが空
**確認:**
```bash
aws dynamodb describe-table \
  --table-name cis-image-embedding-cache

aws dynamodb scan \
  --table-name cis-image-embedding-cache \
  --select "COUNT"
```

## 📝 次のステップ

### 1. バッチ処理完了後

```bash
# インデックス状態の最終確認
./scripts/check-opensearch-index.sh

# 画像検索テスト
# フロントエンドで実際にテスト
```

### 2. EC2 Workerへの統合

新規画像を自動的にインデックス化:

```python
# backend/python-worker/worker.py に追加
def process_image_file(self, file_info):
    # Lambda経由でベクトル生成
    embedding = self.generate_image_embedding(file_info['s3_url'])

    # OpenSearchにインデックス
    document['image_vector'] = embedding
    self.opensearch.index_document(document)
```

### 3. モニタリングとアラート

CloudWatch Alarmsを設定:

```bash
# 成功率が90%を下回ったらアラート
aws cloudwatch put-metric-alarm \
  --alarm-name ImageIndexingFailureRate \
  --metric-name SuccessRate \
  --namespace CIS/ImageIndexing \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 90 \
  --comparison-operator LessThanThreshold
```

## 🎉 まとめ

このソリューションにより:

✅ **既存インデックスの状態を可視化**
✅ **数百万画像をスケーラブルにインデックス化**
✅ **既存Lambda関数を活用してコスト削減**
✅ **中断・再開機能で安全な処理**
✅ **リアルタイムモニタリングで進捗把握**
✅ **本番環境への即座の適用が可能**

## 📚 関連ドキュメント

- [詳細戦略ドキュメント](./IMAGE_INDEXING_STRATEGY.md)
- [クイックスタートガイド](./QUICKSTART_IMAGE_INDEXING.md)
- [Lambda関数README](../lambda-image-embedding/README.md)

## 🆘 サポート

問題が発生した場合:

1. **ログ確認**
   ```bash
   tail -f batch-indexing-*.log
   ```

2. **CloudWatchログ確認**
   ```bash
   aws logs tail /aws/lambda/cis-image-embedding --follow
   ```

3. **進捗状態確認**
   ```bash
   cat batch-progress.json | jq '.'
   ```

4. **GitHub Issueを作成**
   - エラーメッセージ
   - ログの関連部分
   - 環境情報 (画像数、AWS設定等)

---

**作成日:** 2025-12-19
**バージョン:** 1.0
**対応画像数:** 1,000 〜 1,000,000+
