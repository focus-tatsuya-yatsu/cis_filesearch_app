# 画像検索機能 クイックスタートガイド

本ガイドでは、画像検索機能を最短で動作させる手順を説明します。

## 5分でセットアップ

### 1. 環境変数の設定

```bash
# プロジェクトルートに移動
cd /Users/tatsuya/focus_project/cis_filesearch_app

# 環境変数ファイルを作成
cat > frontend/.env << 'ENVFILE'
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index-v2
AWS_REGION=ap-northeast-1
NEXT_PUBLIC_API_GATEWAY_URL=https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
ENVFILE

# 環境変数を読み込み
source frontend/.env
export $(grep -v '^#' frontend/.env | xargs)
```

### 2. OpenSearchインデックスの作成

```bash
# スクリプトディレクトリに移動
cd backend/scripts

# インデックス作成（約1分）
./create-opensearch-knn-index.sh
```

**期待される出力:**
```
[INFO] OpenSearch connection successful
[INFO] Creating index: file-index-v2
[INFO] Index created successfully: file-index-v2
```

### 3. サンプルデータのインデックス

```bash
# サンプル画像データをインデックス（約30秒）
./index-sample-images.sh --count 10
```

**期待される出力:**
```
[INFO] Bulk indexing completed successfully
  Took: 542ms
  Items: 10
  Errors: false
```

### 4. 動作確認

```bash
# 統合テストを実行
./test-image-search-integration.sh
```

**期待される出力:**
```
[INFO] Image embedding API: SUCCESS
[INFO] Lambda Search API: SUCCESS
[INFO] Frontend Search API: SUCCESS
All critical tests passed!
```

## トラブルシューティング

### OpenSearchに接続できない

```bash
# VPC内のEC2から実行する必要があります
# ローカルから実行する場合は、VPN接続が必要です
```

### AWS認証エラー

```bash
# AWS認証情報を確認
aws sts get-caller-identity

# 認証情報が正しく設定されていれば、以下のような出力が表示されます
# {
#     "UserId": "AIDAI...",
#     "Account": "123456789012",
#     "Arn": "arn:aws:iam::123456789012:user/your-user"
# }
```

### k-NN検索が動作しない

```bash
# インデックスマッピングを確認
curl -X GET \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  "${OPENSEARCH_ENDPOINT}/file-index-v2/_mapping?pretty" | \
  grep -A 10 "image_embedding"

# 以下が表示されればOK
# "image_embedding": {
#   "type": "knn_vector",
#   "dimension": 1024,
#   ...
# }
```

## 次のステップ

詳細な設定やパフォーマンス最適化については、[IMAGE_SEARCH_PRODUCTION_DEPLOYMENT.md](./IMAGE_SEARCH_PRODUCTION_DEPLOYMENT.md) を参照してください。

## よく使うコマンド

```bash
# インデックスの状態確認
curl -X GET \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  "${OPENSEARCH_ENDPOINT}/_cat/indices/file-index-v2?v"

# ドキュメント数確認
curl -X GET \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  "${OPENSEARCH_ENDPOINT}/file-index-v2/_count?pretty"

# インデックス削除（注意！）
curl -X DELETE \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  "${OPENSEARCH_ENDPOINT}/file-index-v2"
```

---

最終更新: 2025-12-18
