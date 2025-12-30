# 画像検索機能 本番環境デプロイメントガイド

## 概要

本ガイドでは、本番環境のOpenSearchで画像検索機能を完全に動作させるための手順を説明します。

## アーキテクチャ

```
┌─────────────────┐
│   Frontend      │
│   (Next.js)     │
└────────┬────────┘
         │
         │ 1. 画像アップロード
         ▼
┌─────────────────────────┐
│ Lambda Image Embedding  │
│ (AWS Bedrock Titan)     │
└────────┬────────────────┘
         │
         │ 2. ベクトル生成
         ▼
┌─────────────────────────┐
│   Lambda Search API     │
│   (API Gateway)         │
└────────┬────────────────┘
         │
         │ 3. k-NN検索
         ▼
┌─────────────────────────┐
│   OpenSearch Cluster    │
│   (k-NN Plugin)         │
└─────────────────────────┘
```

## 前提条件

1. **AWS環境**
   - OpenSearchドメイン: `vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com`
   - リージョン: `ap-northeast-1`
   - OpenSearchバージョン: 2.x以上（k-NN対応）

2. **必要なツール**
   - AWS CLI (v2)
   - curl
   - jq (推奨)
   - bash 4.0以上

3. **認証情報**
   - AWS_ACCESS_KEY_ID
   - AWS_SECRET_ACCESS_KEY
   - OpenSearchドメインへのアクセス権限

## デプロイメント手順

### ステップ1: 環境変数の設定

```bash
# frontend/.env ファイルを作成または更新
cat > frontend/.env << 'ENVFILE'
# OpenSearch Configuration
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index-v2
AWS_REGION=ap-northeast-1

# API Gateway Configuration
NEXT_PUBLIC_API_GATEWAY_URL=https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search

# AWS Credentials (Lambda実行用)
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key

# Debug Mode (開発時のみ)
DEBUG_MODE=false
SKIP_SSL_VERIFY=false
ENVFILE
```

### ステップ2: OpenSearch k-NNインデックスの作成

既存のスクリプトを使用してk-NN対応インデックスを作成します。

```bash
# スクリプトディレクトリに移動
cd backend/scripts

# インデックス作成スクリプトを実行
./create-opensearch-knn-index.sh

# インデックスが既に存在する場合は、以下のオプションを使用
# --force: 既存インデックスを削除して再作成
# ./create-opensearch-knn-index.sh (対話モードで確認)
```

**出力例:**
```
==========================================
OpenSearch k-NN Index Creation Script
==========================================

Index Name: file-index-v2
OpenSearch Endpoint: https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
AWS Region: ap-northeast-1

[INFO] Checking prerequisites...
[INFO] Prerequisites check completed.

[INFO] Checking OpenSearch connection...
[INFO] OpenSearch connection successful
{
  "cluster_name": "vpc-cis-filesearch-opensearch",
  "status": "green",
  "number_of_nodes": 2
}

[INFO] Creating index: file-index-v2
[INFO] Index created successfully: file-index-v2
```

### ステップ3: インデックスの検証

インデックスが正しく作成されたことを確認します。

```bash
# インデックス設定の確認
curl -X GET \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  "${OPENSEARCH_ENDPOINT}/file-index-v2/_settings?pretty"

# マッピングの確認
curl -X GET \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  "${OPENSEARCH_ENDPOINT}/file-index-v2/_mapping?pretty"
```

**確認ポイント:**
- `"knn": true` の設定がある
- `image_embedding` フィールドが `knn_vector` タイプで定義されている
- `dimension: 1024` の設定がある
- HNSWアルゴリズムが設定されている

### ステップ4: サンプルデータのインデックス（テスト用）

```bash
# サンプル画像データをインデックス
./index-sample-images.sh

# カスタム設定でインデックス（オプション）
./index-sample-images.sh --count 50  # 50個のサンプルを作成
```

**出力例:**
```
========================================
Sample Image Data Indexing Script
========================================

Configuration:
  Index Name: file-index-v2
  OpenSearch Endpoint: https://...
  AWS Region: ap-northeast-1
  Sample Count: 10

This will index 10 sample documents. Continue? (y/N): y

[INFO] Generating bulk indexing data for 10 documents...
..........
[INFO] Sending bulk request to OpenSearch...
[INFO] Bulk indexing completed successfully
  Took: 542ms
  Items: 10
  Errors: false

[INFO] Total documents in index: 10
```

### ステップ5: Lambda Search APIの検証

Lambda Search APIが正しく動作することを確認します。

```bash
# 統合テストスクリプトを実行
./test-image-search-integration.sh /path/to/test-image.jpg

# または、ImageMagickがインストールされている場合
./test-image-search-integration.sh
```

**期待される出力:**
```
========================================
Image Search Integration Test Suite
========================================

========================================
Test 1: Image Embedding API
========================================
[INFO] Testing: POST http://localhost:3000/api/image-embedding
[INFO] Image: test-image.jpg
HTTP Status: 200
[INFO] Image embedding API: SUCCESS

========================================
Test 2: Lambda Search API (Direct)
========================================
[INFO] Testing: POST https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search
HTTP Status: 200
[INFO] Lambda Search API: SUCCESS
```

### ステップ6: 本番データの移行（既存インデックスがある場合）

既存のインデックスにk-NNフィールドを追加する場合は、Reindexを使用します。

```bash
# Reindex APIを使用してデータを新しいインデックスに移行
curl -X POST \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{
    "source": {
      "index": "file-index"
    },
    "dest": {
      "index": "file-index-v2"
    }
  }' \
  "${OPENSEARCH_ENDPOINT}/_reindex"
```

**注意:** 既存のドキュメントには `image_embedding` フィールドがないため、画像ファイルについては再処理が必要です。

## トラブルシューティング

### 問題1: OpenSearchに接続できない

**症状:**
```
[ERROR] Failed to connect to OpenSearch
Connection refused to https://vpc-cis-filesearch-opensearch-...
```

**解決策:**
1. VPC内からアクセスしていることを確認
2. セキュリティグループの設定を確認
3. AWS認証情報が正しいことを確認

```bash
# VPC内のEC2から診断スクリプトを実行
./diagnose-opensearch-from-vpc.sh
```

### 問題2: k-NN検索が機能しない

**症状:**
```
OpenSearch returned an error: [illegal_argument_exception] No query registered for [knn]
```

**解決策:**
1. OpenSearchバージョンがk-NNをサポートしているか確認（2.x以上）
2. k-NNプラグインが有効化されているか確認

```bash
# OpenSearchのプラグインを確認
curl -X GET \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  "${OPENSEARCH_ENDPOINT}/_cat/plugins?v"
```

### 問題3: ベクトルの次元数が一致しない

**症状:**
```
[mapper_parsing_exception] failed to parse field [image_embedding]
```

**解決策:**
1. Bedrock Titan Multimodal Embeddingのベクトル次元は1024次元
2. インデックスマッピングで `"dimension": 1024` が設定されていることを確認

### 問題4: Lambda関数のタイムアウト

**症状:**
```
Task timed out after 30.00 seconds
```

**解決策:**
1. Lambda関数のタイムアウト設定を60秒以上に増やす
2. OpenSearchクエリのタイムアウトを調整

```typescript
// opensearch.service.enhanced.ts
const response = await client.search({
  index: config.index,
  body: searchBody,
  requestTimeout: 30000, // 30秒
});
```

## パフォーマンス最適化

### 1. k-NNパラメータの調整

インデックス作成時に以下のパラメータを調整することで、精度と速度のバランスを取ることができます。

```json
{
  "image_embedding": {
    "type": "knn_vector",
    "dimension": 1024,
    "method": {
      "name": "hnsw",
      "space_type": "cosinesimil",
      "engine": "lucene",
      "parameters": {
        "ef_construction": 512,  // 精度重視: 512-1024, 速度重視: 128-256
        "m": 16                   // 精度重視: 24-48, 速度重視: 8-16
      }
    }
  }
}
```

**パラメータ説明:**
- `ef_construction`: インデックス構築時の探索範囲（大きいほど精度高、時間長）
- `m`: グラフの接続数（大きいほど精度高、メモリ消費大）
- `space_type`:
  - `cosinesimil`: コサイン類似度（画像検索に推奨）
  - `l2`: ユークリッド距離
  - `innerproduct`: 内積

### 2. 検索クエリの最適化

```typescript
// 精度重視（遅い）
{
  "query": {
    "knn": {
      "image_embedding": {
        "vector": embedding,
        "k": 100  // 多くの候補を検索
      }
    }
  }
}

// 速度重視（速い）
{
  "query": {
    "knn": {
      "image_embedding": {
        "vector": embedding,
        "k": 20   // 少ない候補を検索
      }
    }
  }
}
```

### 3. OpenSearchクラスタのスケーリング

本番環境では以下のインスタンスタイプを推奨します:

- **小規模（< 100万ドキュメント）:** `r6g.large.search` x 2
- **中規模（100万-1000万）:** `r6g.xlarge.search` x 3
- **大規模（> 1000万）:** `r6g.2xlarge.search` x 5以上

## モニタリング

### CloudWatchメトリクス

以下のメトリクスを監視してください:

1. **OpenSearch**
   - `SearchLatency`: 検索レイテンシ
   - `SearchRate`: 検索リクエスト数
   - `ClusterStatus`: クラスタステータス（green/yellow/red）
   - `CPUUtilization`: CPU使用率
   - `JVMMemoryPressure`: JVMメモリ圧力

2. **Lambda Search API**
   - `Duration`: 実行時間
   - `Errors`: エラー数
   - `ConcurrentExecutions`: 同時実行数

3. **Lambda Image Embedding**
   - `Duration`: Bedrock API呼び出し時間
   - `Errors`: エラー数
   - `Invocations`: 呼び出し回数

### ログの確認

```bash
# Lambda Search API のログ
aws logs tail /aws/lambda/cis-search-api --follow

# OpenSearchのスロークエリログ
curl -X GET \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
  "${OPENSEARCH_ENDPOINT}/_cluster/settings?include_defaults=true&pretty" | \
  grep -A 10 "slowlog"
```

## セキュリティ考慮事項

1. **OpenSearchアクセス**
   - VPC内からのみアクセス可能にする
   - IAMポリシーで適切なアクセス制御を設定
   - SSL/TLS暗号化を有効化

2. **Lambda関数**
   - 環境変数でシークレットを管理しない
   - AWS Secrets Managerを使用
   - VPC内で実行（必要に応じて）

3. **API Gateway**
   - レート制限を設定
   - API Keyまたは認証を実装
   - CORS設定を適切に構成

## 次のステップ

1. **本番データの移行**
   - 既存の画像ファイルを処理してベクトル化
   - バッチ処理スクリプトを作成

2. **パフォーマンステスト**
   - 負荷テストを実施
   - ボトルネックを特定

3. **モニタリングの設定**
   - CloudWatchダッシュボードを作成
   - アラートを設定

4. **ドキュメンテーション**
   - 運用手順書を作成
   - トラブルシューティングガイドを充実

## 参考資料

- [OpenSearch k-NN Plugin Documentation](https://opensearch.org/docs/latest/search-plugins/knn/index/)
- [AWS Bedrock Titan Multimodal Embeddings](https://docs.aws.amazon.com/bedrock/latest/userguide/titan-multiemb-models.html)
- [Lambda Function Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)

## サポート

問題が発生した場合は、以下の情報を収集してください:

1. エラーメッセージとスタックトレース
2. CloudWatchログ
3. OpenSearchクラスタの状態
4. 再現手順

---

最終更新: 2025-12-18
バージョン: 1.0.0
