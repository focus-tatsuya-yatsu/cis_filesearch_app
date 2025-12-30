# Backend Scripts - OpenSearch Image Search

本ディレクトリには、OpenSearchの画像検索機能（k-NN）を本番環境にデプロイするためのスクリプトが含まれています。

## スクリプト一覧

### 1. create-opensearch-knn-index.sh

OpenSearchにk-NN対応のインデックスを作成します。

**機能:**
- k-NNプラグインを有効化したインデックスの作成
- 1024次元のimage_embeddingフィールドの設定
- HNSWアルゴリズムとコサイン類似度の設定
- 日本語アナライザーの設定
- インデックス設定とマッピングの検証

**使用方法:**
```bash
# 基本的な使用
./create-opensearch-knn-index.sh

# カスタム設定
./create-opensearch-knn-index.sh --index custom-index --region ap-northeast-1

# ヘルプ
./create-opensearch-knn-index.sh --help
```

**環境変数:**
- `OPENSEARCH_ENDPOINT`: OpenSearchエンドポイントURL
- `OPENSEARCH_INDEX`: インデックス名（デフォルト: file-index-v2）
- `AWS_REGION`: AWSリージョン（デフォルト: ap-northeast-1）
- `AWS_ACCESS_KEY_ID`: AWS認証情報
- `AWS_SECRET_ACCESS_KEY`: AWS認証情報

### 2. index-sample-images.sh

テスト用のサンプル画像データをインデックスします。

**機能:**
- ランダムな1024次元ベクトルの生成
- バルクインデックス（高速）
- 個別インデックス（フォールバック）
- 多様なカテゴリのサンプル作成
- k-NN検索のテスト

**使用方法:**
```bash
# 基本的な使用（10個のサンプル）
./index-sample-images.sh

# カスタム数のサンプル
./index-sample-images.sh --count 50

# ヘルプ
./index-sample-images.sh --help
```

**環境変数:**
- `SAMPLE_COUNT`: サンプル数（デフォルト: 10）
- その他はcreate-opensearch-knn-index.shと同じ

### 3. test-image-search-integration.sh

画像検索APIの統合テストを実行します。

**機能:**
- Image Embedding APIのテスト
- Lambda Search APIのテスト（直接）
- Frontend Search APIのテスト
- OpenSearch直接クエリのテスト（オプション）
- パフォーマンステスト
- キャッシュヒットテスト

**使用方法:**
```bash
# テスト画像を指定
./test-image-search-integration.sh /path/to/test-image.jpg

# デフォルトのテスト画像を使用（自動生成）
./test-image-search-integration.sh

# ヘルプ
./test-image-search-integration.sh --help
```

**環境変数:**
- `NEXT_PUBLIC_APP_URL`: FrontendのURL（デフォルト: http://localhost:3000）
- `NEXT_PUBLIC_API_GATEWAY_URL`: Lambda Search APIのURL
- `OPENSEARCH_ENDPOINT`: OpenSearchエンドポイント（オプション）
- AWS認証情報（OpenSearch直接テスト用）

### 4. diagnose-opensearch-from-vpc.sh

VPC内からOpenSearchの診断を実行します。

**機能:**
- OpenSearchクラスタの接続確認
- クラスタヘルスチェック
- インデックスの確認
- k-NNプラグインの確認
- ネットワーク診断

**使用方法:**
```bash
./diagnose-opensearch-from-vpc.sh
```

## セットアップフロー

### 初回セットアップ（本番環境）

```bash
# 1. 環境変数の設定
export OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
export OPENSEARCH_INDEX="file-index-v2"
export AWS_REGION="ap-northeast-1"

# AWS認証情報も設定
export AWS_ACCESS_KEY_ID="your-access-key-id"
export AWS_SECRET_ACCESS_KEY="your-secret-access-key"

# 2. OpenSearchインデックスの作成
./create-opensearch-knn-index.sh

# 3. サンプルデータのインデックス（テスト用）
./index-sample-images.sh --count 20

# 4. 統合テストの実行
./test-image-search-integration.sh
```

### 既存インデックスの更新

既存のインデックスにk-NNフィールドを追加する場合は、Reindexが必要です:

```bash
# 1. 新しいk-NN対応インデックスを作成
./create-opensearch-knn-index.sh

# 2. 既存データを新しいインデックスにコピー（curl使用）
curl -X POST \
  --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{
    "source": {"index": "file-index"},
    "dest": {"index": "file-index-v2"}
  }' \
  "${OPENSEARCH_ENDPOINT}/_reindex"

# 3. 画像ファイルの再処理（ベクトル化）が必要
# （別途、画像処理バッチスクリプトを実行）
```

## トラブルシューティング

### 問題: OpenSearchに接続できない

**エラーメッセージ:**
```
[ERROR] Failed to connect to OpenSearch
Connection refused to https://vpc-cis-filesearch-opensearch-...
```

**解決策:**
1. VPC内からスクリプトを実行しているか確認
2. セキュリティグループで443ポートが許可されているか確認
3. AWS認証情報が正しいか確認

```bash
# 診断スクリプトを実行
./diagnose-opensearch-from-vpc.sh
```

### 問題: k-NN検索が機能しない

**エラーメッセージ:**
```
[illegal_argument_exception] No query registered for [knn]
```

**解決策:**
1. OpenSearchバージョンがk-NNをサポート（2.x以上）しているか確認
2. インデックス作成時に `"knn": true` が設定されているか確認

```bash
# インデックス設定を確認
curl -X GET \
  --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  "${OPENSEARCH_ENDPOINT}/${OPENSEARCH_INDEX}/_settings?pretty" | \
  grep -A 5 "knn"
```

### 問題: ベクトルの次元数が一致しない

**エラーメッセージ:**
```
[mapper_parsing_exception] failed to parse field [image_embedding]
```

**解決策:**
1. Bedrock Titan Multimodal Embeddingは1024次元を出力
2. インデックスマッピングで `"dimension": 1024` が設定されているか確認

```bash
# マッピングを確認
curl -X GET \
  --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  "${OPENSEARCH_ENDPOINT}/${OPENSEARCH_INDEX}/_mapping?pretty" | \
  grep -A 10 "image_embedding"
```

## パフォーマンス最適化

### k-NNパラメータの調整

インデックス作成スクリプト内で以下のパラメータを調整できます:

```json
{
  "image_embedding": {
    "method": {
      "parameters": {
        "ef_construction": 512,  // 精度重視: 512-1024, 速度重視: 128-256
        "m": 16                   // 精度重視: 24-48, 速度重視: 8-16
      }
    }
  }
}
```

### バルクインデックスのバッチサイズ

大量のデータをインデックスする場合は、バッチサイズを調整:

```bash
# デフォルト（10個ずつ）
./index-sample-images.sh --count 100

# カスタムバッチサイズ（スクリプト内で調整）
# bulk_index_documents 関数の chunk_size を変更
```

## 監視とメンテナンス

### インデックスの状態確認

```bash
# インデックス一覧
curl -X GET \
  --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  "${OPENSEARCH_ENDPOINT}/_cat/indices?v"

# ドキュメント数
curl -X GET \
  --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  "${OPENSEARCH_ENDPOINT}/${OPENSEARCH_INDEX}/_count?pretty"

# クラスタヘルス
curl -X GET \
  --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  "${OPENSEARCH_ENDPOINT}/_cluster/health?pretty"
```

### インデックスの最適化

```bash
# Force Merge（読み取り専用インデックス向け）
curl -X POST \
  --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  "${OPENSEARCH_ENDPOINT}/${OPENSEARCH_INDEX}/_forcemerge?max_num_segments=1"

# Refresh（検索結果を最新にする）
curl -X POST \
  --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  "${OPENSEARCH_ENDPOINT}/${OPENSEARCH_INDEX}/_refresh"
```

## セキュリティベストプラクティス

1. **環境変数の管理**
   - AWS Secrets Managerを使用
   - `.env`ファイルは`.gitignore`に追加
   - 本番環境ではIAM Roleを使用

2. **OpenSearchアクセス制御**
   - VPC内からのみアクセス可能にする
   - IAMポリシーで最小権限を付与
   - IP制限を設定（必要に応じて）

3. **監査ログ**
   - CloudTrailでAPIコールを記録
   - OpenSearchのスロークエリログを有効化

## 参考資料

- [OpenSearch k-NN Plugin](https://opensearch.org/docs/latest/search-plugins/knn/index/)
- [AWS Bedrock Titan Embeddings](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-multiemb-models.html)
- [デプロイメントガイド](../../docs/IMAGE_SEARCH_PRODUCTION_DEPLOYMENT.md)
- [クイックスタート](../../docs/IMAGE_SEARCH_QUICKSTART.md)

## サポート

問題が発生した場合は、以下の情報を収集してください:

1. スクリプトの実行ログ
2. OpenSearchのクラスタ状態
3. 環境変数の設定（機密情報は除く）
4. エラーメッセージとスタックトレース

---

最終更新: 2025-12-18
バージョン: 1.0.0
