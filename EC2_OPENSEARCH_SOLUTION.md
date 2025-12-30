# EC2 OpenSearch k-NN セットアップ - 完全ガイド

## 問題の概要

EC2インスタンス（ip-10-0-3-24）からOpenSearch k-NNインデックスを作成しようとした際、既存のスクリプトがSSHトンネルのセットアップを要求していました。しかし、EC2インスタンスはVPC内にあり、OpenSearchドメインに直接アクセス可能なため、SSHトンネルは不要です。

## 解決策

EC2から直接OpenSearchにアクセスするための専用スクリプトセットを作成しました。

## 作成されたファイル一覧

### 実行可能スクリプト（4ファイル、合計約22KB）

| ファイル名 | サイズ | 用途 |
|-----------|--------|------|
| `ec2-create-opensearch-knn-index.sh` | 8.2KB | k-NNインデックスの作成と検証 |
| `ec2-verify-index.sh` | 3.7KB | インデックスの詳細検証 |
| `ec2-index-sample-data.sh` | 4.6KB | サンプルデータの投入 |
| `ec2-test-knn-search.sh` | 5.3KB | k-NN検索のテスト |

### ドキュメント（4ファイル、合計約24KB）

| ファイル名 | サイズ | 内容 |
|-----------|--------|------|
| `ec2-opensearch-quick-reference.md` | 7.1KB | コマンドリファレンス |
| `DEPLOY_TO_EC2.md` | 4.5KB | デプロイ手順 |
| `QUICK_START.txt` | 6.3KB | クイックスタートガイド |
| `DEPLOYMENT_CHECKLIST.md` | 5.8KB | デプロイチェックリスト |

### 追加ドキュメント（2ファイル）

- `docs/EC2_OPENSEARCH_KNN_SETUP.md` - 包括的なセットアップガイド
- `EC2_OPENSEARCH_SETUP_SUMMARY.md` - サマリーと次のステップ

**合計**: 10ファイル、約1,541行のコードとドキュメント

## クイックスタート（3分で完了）

### 1. スクリプトをEC2にコピー

```bash
# ローカルマシンから実行
cd /Users/tatsuya/focus_project/cis_filesearch_app/scripts

scp -i ~/.ssh/your-key.pem \
  ec2-*.sh \
  *.md \
  *.txt \
  ec2-user@<EC2_IP>:/home/ec2-user/
```

### 2. EC2で実行

```bash
# EC2に接続
ssh -i ~/.ssh/your-key.pem ec2-user@<EC2_IP>

# 実行権限付与
chmod +x *.sh

# インデックス作成
./ec2-create-opensearch-knn-index.sh

# サンプルデータ投入
./ec2-index-sample-data.sh 10

# 検索テスト
./ec2-test-knn-search.sh 5
```

## 詳細な使用方法

### スクリプト1: インデックス作成

```bash
./ec2-create-opensearch-knn-index.sh
```

**実行内容**:
1. OpenSearch接続確認
2. 既存インデックスのチェック
3. k-NN設定でインデックス作成
4. 設定とマッピングの検証

**期待される出力**:
```
========================================
OpenSearch k-NN Index Creation (EC2)
========================================

[1/5] Verifying OpenSearch connectivity...
✓ Successfully connected to OpenSearch
  Cluster status: green

[2/5] Checking if index 'cis-files' exists...
✓ Index does not exist, proceeding with creation

[3/5] Creating index with k-NN mapping...
✓ Index created successfully

[4/5] Verifying index settings...
  k-NN enabled: true
✓ k-NN is properly enabled

[5/5] Verifying index mapping...
  image_embedding type: knn_vector
  vector dimension: 512
✓ Mapping verified successfully
```

### スクリプト2: インデックス検証

```bash
./ec2-verify-index.sh
```

**確認項目**:
- クラスターヘルス（status, nodes, shards）
- インデックスの存在
- k-NN設定
- マッピング構造
- ドキュメント統計
- サンプルドキュメント

### スクリプト3: サンプルデータ投入

```bash
# 引数: サンプル数（デフォルト: 10）
./ec2-index-sample-data.sh 10
```

**処理内容**:
- ランダムな512次元ベクトル生成
- 様々なファイルタイプのサンプル作成
- OpenSearchへのバッチインデックス
- 自動リフレッシュ

**期待される出力**:
```
Indexing document 1/10: sample_file_1.jpg
  ✓ Indexed successfully
...
Results:
  Successful: 10
  Failed: 0

Total documents in index: 10
```

### スクリプト4: k-NN検索テスト

```bash
# 引数: k値（デフォルト: 5）
./ec2-test-knn-search.sh 5
```

**テスト内容**:
1. 純粋なk-NN検索（Top-k類似ドキュメント）
2. ハイブリッド検索（テキスト条件 + k-NN）
3. 検索時間の測定
4. 結果の詳細表示

**期待される出力**:
```
========================================
Search Results
========================================

Total Hits: 10
Query Time: 45ms
Total Time: 52ms

Top 5 Similar Documents:

  [0.85] sample_file_3.jpg
    Path: /home/user/Pictures/sample_file_3.jpg
    Type: jpg | Size: 45231 bytes

  [1.23] sample_file_7.png
    Path: /home/user/Documents/sample_file_7.png
    Type: png | Size: 67890 bytes
...
```

## 手動コマンド（スクリプトなし）

スクリプトが使えない場合の手動コマンド:

### 環境変数の設定

```bash
ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION="ap-northeast-1"
```

### インデックス作成

```bash
curl -X PUT "${ENDPOINT}/cis-files" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d '{
  "settings": {
    "index": {
      "knn": true,
      "number_of_shards": 2,
      "number_of_replicas": 1
    }
  },
  "mappings": {
    "properties": {
      "file_name": {"type": "text"},
      "file_path": {"type": "text"},
      "file_extension": {"type": "keyword"},
      "image_embedding": {
        "type": "knn_vector",
        "dimension": 512,
        "method": {
          "name": "hnsw",
          "space_type": "l2",
          "engine": "nmslib",
          "parameters": {"ef_construction": 512, "m": 16}
        }
      }
    }
  }
}'
```

### ドキュメントのインデックス

```bash
# ベクトル生成
VECTOR=$(python3 -c "import random; print('[' + ','.join([str(random.uniform(-1, 1)) for _ in range(512)]) + ']')")

# ドキュメント投入
curl -X POST "${ENDPOINT}/cis-files/_doc/1" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d "{
  \"file_name\": \"test.jpg\",
  \"file_path\": \"/test/test.jpg\",
  \"image_embedding\": ${VECTOR}
}"
```

### k-NN検索

```bash
# クエリベクトル生成
QUERY=$(python3 -c "import random; print('[' + ','.join([str(random.uniform(-1, 1)) for _ in range(512)]) + ']')")

# 検索実行
curl -X POST "${ENDPOINT}/cis-files/_search" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d "{
  \"size\": 5,
  \"query\": {
    \"knn\": {
      \"image_embedding\": {
        \"vector\": ${QUERY},
        \"k\": 5
      }
    }
  }
}" | jq '.hits.hits[]'
```

## トラブルシューティング

### 1. 接続エラー（Connection refused / Timeout）

**症状**: OpenSearchに接続できない

**原因**:
- セキュリティグループの設定不備
- VPCの不一致
- ネットワークの問題

**確認コマンド**:
```bash
# 接続テスト
curl -v ${ENDPOINT}

# セキュリティグループ確認
aws ec2 describe-security-groups | grep -A 10 "opensearch"

# VPC確認
aws opensearch describe-domain --domain-name cis-filesearch-opensearch | jq '.DomainStatus.VPCOptions'
```

**解決策**:
- OpenSearchのセキュリティグループでEC2からのHTTPS(443)を許可
- EC2とOpenSearchが同じVPC内にあることを確認

### 2. 認証エラー（403 Forbidden / Access Denied）

**症状**: `{"Message":"User: ... is not authorized"}`

**原因**: IAM権限の不足

**確認コマンド**:
```bash
# 現在の認証情報確認
aws sts get-caller-identity

# OpenSearchアクセスポリシー確認
aws opensearch describe-domain --domain-name cis-filesearch-opensearch | jq '.DomainStatus.AccessPolicies'
```

**必要な権限**:
- `es:ESHttpPut`
- `es:ESHttpPost`
- `es:ESHttpGet`
- `es:ESHttpDelete`

**解決策**:
- EC2インスタンスに適切なIAMロールをアタッチ
- OpenSearchのアクセスポリシーでIAMロールを許可

### 3. k-NN検索が結果を返さない

**症状**: 検索は成功するが結果が0件

**原因**:
- インデックスが空
- ドキュメントにembeddingフィールドがない
- インデックスがリフレッシュされていない

**確認コマンド**:
```bash
# ドキュメント数確認
curl -X GET "${ENDPOINT}/cis-files/_count" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" | jq '.count'

# サンプルドキュメント確認
curl -X GET "${ENDPOINT}/cis-files/_search?size=1" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" | jq '.hits.hits[0]._source.image_embedding | length'
```

**解決策**:
```bash
# サンプルデータをインデックス
./ec2-index-sample-data.sh 10

# または手動でリフレッシュ
curl -X POST "${ENDPOINT}/cis-files/_refresh" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)"
```

### 4. インデックス作成エラー

**症状**: `resource_already_exists_exception`

**解決策**:
```bash
# 既存インデックスを削除
curl -X DELETE "${ENDPOINT}/cis-files" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)"

# 再作成
./ec2-create-opensearch-knn-index.sh
```

## パフォーマンスチューニング

### ef_search パラメータの調整

精度と速度のトレードオフを調整:

```bash
# 高精度（遅い）
curl -X PUT "${ENDPOINT}/cis-files/_settings" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d '{"index": {"knn.algo_param.ef_search": 1024}}'

# 高速（精度低）
curl -X PUT "${ENDPOINT}/cis-files/_settings" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d '{"index": {"knn.algo_param.ef_search": 256}}'
```

**推奨値**:
- **開発環境**: 256-512
- **本番環境**: 512-1024
- **高精度要求**: 1024+

### インデックスパフォーマンスの監視

```bash
# インデックス統計
curl -X GET "${ENDPOINT}/_cat/indices/cis-files?v" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)"

# 検索パフォーマンス
curl -X GET "${ENDPOINT}/cis-files/_stats/search" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" | jq '.indices["cis-files"].total.search'
```

## 次のステップ

### 1. Lambda関数の統合

画像埋め込み生成用のLambda関数を作成:

```
/Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-image-embedding/
```

**実装内容**:
- S3イベントトリガー（新規画像アップロード時）
- CLIP/ResNetモデルで512次元ベクトル生成
- OpenSearchへの自動インデックス

### 2. EC2ワーカーの統合

ファイル処理ワーカーの更新:

```
/Users/tatsuya/focus_project/cis_filesearch_app/backend/ec2-worker/
```

**実装内容**:
- SQSメッセージから画像ファイルを検出
- Lambda関数を呼び出して埋め込み生成
- OpenSearchへのインデックス処理

### 3. フロントエンド統合

Next.jsアプリケーションからの画像検索:

```
/Users/tatsuya/focus_project/cis_filesearch_app/frontend/src/lib/api/imageSearch.ts
```

**実装内容**:
- 画像アップロードUI
- 埋め込み生成とk-NN検索
- 検索結果の表示

### 4. 監視とアラート

CloudWatchでパフォーマンスを監視:

- 検索レイテンシーの追跡
- インデックスサイズの監視
- エラーレートのアラート

## まとめ

### 解決した問題
✅ EC2からOpenSearchへの直接アクセス（SSHトンネル不要）
✅ k-NNインデックスの自動作成と検証
✅ サンプルデータでの動作確認
✅ 包括的なトラブルシューティングガイド

### 提供したツール
- **4つの実行可能スクリプト** - インデックス作成、検証、テスト
- **6つのドキュメント** - セットアップガイド、リファレンス、チェックリスト
- **約1,541行** のコードとドキュメント

### ファイルの場所

```
/Users/tatsuya/focus_project/cis_filesearch_app/
├── scripts/
│   ├── ec2-create-opensearch-knn-index.sh  # メインスクリプト
│   ├── ec2-verify-index.sh                  # 検証
│   ├── ec2-index-sample-data.sh             # サンプルデータ
│   ├── ec2-test-knn-search.sh               # 検索テスト
│   ├── ec2-opensearch-quick-reference.md    # コマンドリファレンス
│   ├── DEPLOY_TO_EC2.md                     # デプロイ手順
│   ├── QUICK_START.txt                      # クイックスタート
│   └── DEPLOYMENT_CHECKLIST.md              # チェックリスト
├── docs/
│   └── EC2_OPENSEARCH_KNN_SETUP.md         # 詳細ガイド
└── EC2_OPENSEARCH_SETUP_SUMMARY.md         # サマリー
```

### 今すぐ始める

```bash
# 1. スクリプトをEC2にコピー
cd /Users/tatsuya/focus_project/cis_filesearch_app/scripts
scp -i ~/.ssh/your-key.pem ec2-*.sh ec2-user@<EC2_IP>:~/

# 2. EC2で実行
ssh -i ~/.ssh/your-key.pem ec2-user@<EC2_IP>
chmod +x *.sh
./ec2-create-opensearch-knn-index.sh

# 3. テスト
./ec2-index-sample-data.sh 10
./ec2-test-knn-search.sh 5
```

完了です！
