# EC2 OpenSearch k-NN セットアップガイド

## 概要

このガイドでは、EC2インスタンスから直接OpenSearch k-NNインデックスを作成・管理する方法を説明します。VPC内のEC2インスタンスはOpenSearchドメインに直接アクセスできるため、SSHトンネルは不要です。

## 前提条件

### EC2インスタンス要件
- **VPC**: OpenSearchドメインと同じVPC内に配置
- **サブネット**: プライベートサブネット推奨
- **セキュリティグループ**: OpenSearchのセキュリティグループがEC2からのHTTPS(443)アクセスを許可
- **IAMロール**: OpenSearchへのアクセス権限を持つロールが必要

### 必要なツール
```bash
# EC2インスタンスで実行
sudo yum install -y jq curl python3

# AWS CLIの設定確認
aws sts get-caller-identity
```

## セットアップ手順

### 1. スクリプトのデプロイ

開発マシンからEC2にスクリプトを転送:

```bash
# ローカルマシンから実行
cd /Users/tatsuya/focus_project/cis_filesearch_app/scripts

# EC2にスクリプトをコピー
scp -i ~/.ssh/your-key.pem \
  ec2-create-opensearch-knn-index.sh \
  ec2-verify-index.sh \
  ec2-index-sample-data.sh \
  ec2-test-knn-search.sh \
  ec2-user@<EC2_IP>:/home/ec2-user/

# SSH接続
ssh -i ~/.ssh/your-key.pem ec2-user@<EC2_IP>

# 実行権限付与
chmod +x *.sh
```

### 2. インデックス作成

```bash
# EC2インスタンス上で実行
./ec2-create-opensearch-knn-index.sh
```

このスクリプトは以下を実行します:
1. OpenSearch接続確認
2. 既存インデックスの確認
3. k-NN設定でインデックス作成
4. マッピングの検証

#### 期待される出力

```
========================================
OpenSearch k-NN Index Creation (EC2)
========================================

OpenSearch Endpoint: https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe...
Index Name: cis-files
Region: ap-northeast-1

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

### 3. インデックス検証

```bash
./ec2-verify-index.sh
```

検証内容:
- クラスターヘルス
- インデックスの存在確認
- 設定の確認
- マッピングの確認
- 統計情報の取得
- サンプルドキュメントの表示

### 4. サンプルデータのインデックス

```bash
# 10件のサンプルドキュメントをインデックス
./ec2-index-sample-data.sh 10

# より多くのサンプルが必要な場合
./ec2-index-sample-data.sh 100
```

このスクリプトは:
- ランダムな512次元ベクトルを生成
- 様々なファイルタイプのサンプルドキュメントを作成
- OpenSearchにインデックス
- インデックスの自動リフレッシュ

### 5. k-NN検索のテスト

```bash
# Top 5の類似ドキュメントを検索
./ec2-test-knn-search.sh 5

# Top 10の類似ドキュメントを検索
./ec2-test-knn-search.sh 10
```

テスト内容:
- ランダムクエリベクトルの生成
- k-NN検索の実行
- 検索時間の測定
- ハイブリッド検索のテスト（テキスト + k-NN）

## 手動コマンド（スクリプトなし）

### インデックス作成

```bash
ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION="ap-northeast-1"

curl -X PUT "${ENDPOINT}/cis-files" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d '{
  "settings": {
    "index": {
      "knn": true,
      "knn.algo_param.ef_search": 512,
      "number_of_shards": 2,
      "number_of_replicas": 1
    }
  },
  "mappings": {
    "properties": {
      "file_path": { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
      "file_name": { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
      "file_extension": { "type": "keyword" },
      "image_embedding": {
        "type": "knn_vector",
        "dimension": 512,
        "method": {
          "name": "hnsw",
          "space_type": "l2",
          "engine": "nmslib",
          "parameters": { "ef_construction": 512, "m": 16 }
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

# ドキュメントをインデックス
curl -X POST "${ENDPOINT}/cis-files/_doc/1" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d "{
  \"file_name\": \"sample.jpg\",
  \"file_path\": \"/images/sample.jpg\",
  \"file_extension\": \"jpg\",
  \"image_embedding\": ${VECTOR}
}"
```

### k-NN検索の実行

```bash
# クエリベクトル生成
QUERY_VECTOR=$(python3 -c "import random; print('[' + ','.join([str(random.uniform(-1, 1)) for _ in range(512)]) + ']')")

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
        \"vector\": ${QUERY_VECTOR},
        \"k\": 5
      }
    }
  }
}"
```

## トラブルシューティング

### 接続エラー

**症状**: `Connection refused` または タイムアウト

**確認事項**:
```bash
# セキュリティグループの確認
aws ec2 describe-security-groups --group-ids <opensearch-sg-id> | jq '.SecurityGroups[0].IpPermissions'

# OpenSearchドメインのVPC設定確認
aws opensearch describe-domain --domain-name cis-filesearch-opensearch | jq '.DomainStatus.VPCOptions'

# EC2のVPC/サブネット確認
aws ec2 describe-instances --instance-ids $(ec2-metadata --instance-id | cut -d ' ' -f 2) | jq '.Reservations[0].Instances[0] | {VpcId, SubnetId}'
```

**解決策**:
- OpenSearchのセキュリティグループにEC2のセキュリティグループからのHTTPS(443)アクセスを許可
- EC2とOpenSearchが同じVPC内にあることを確認

### 認証エラー

**症状**: `403 Forbidden` または `Access denied`

**確認事項**:
```bash
# IAMロールの確認
aws sts get-caller-identity

# OpenSearchアクセスポリシーの確認
aws opensearch describe-domain --domain-name cis-filesearch-opensearch | jq '.DomainStatus.AccessPolicies'
```

**解決策**:
- EC2インスタンスにOpenSearchへのアクセス権限を持つIAMロールをアタッチ
- OpenSearchのアクセスポリシーでEC2のIAMロールを許可

### k-NN検索が結果を返さない

**確認事項**:
```bash
# ドキュメント数の確認
curl -X GET "${ENDPOINT}/cis-files/_count" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)"

# ドキュメントにembeddingがあるか確認
curl -X GET "${ENDPOINT}/cis-files/_search?size=1" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  | jq '.hits.hits[0]._source.image_embedding | length'
```

**解決策**:
- サンプルデータをインデックス: `./ec2-index-sample-data.sh 10`
- インデックスをリフレッシュ: `curl -X POST "${ENDPOINT}/cis-files/_refresh" ...`

## パフォーマンス最適化

### ef_search パラメータの調整

```bash
# より高精度な検索（遅くなる）
curl -X PUT "${ENDPOINT}/cis-files/_settings" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d '{ "index": { "knn.algo_param.ef_search": 1024 } }'

# より高速な検索（精度が下がる）
curl -X PUT "${ENDPOINT}/cis-files/_settings" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d '{ "index": { "knn.algo_param.ef_search": 256 } }'
```

### インデックスパフォーマンスの監視

```bash
# インデックス統計
curl -X GET "${ENDPOINT}/_cat/indices/cis-files?v" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)"

# 検索パフォーマンス
curl -X GET "${ENDPOINT}/cis-files/_stats/search" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  | jq '.indices["cis-files"].total.search'
```

## 本番環境への展開

### セキュリティ強化

1. **暗号化の有効化**
   - 転送中の暗号化（HTTPS）: デフォルトで有効
   - 保存時の暗号化: Terraformで設定

2. **アクセス制御**
   - IAMベースの認証
   - VPCによるネットワーク分離
   - セキュリティグループによるアクセス制限

3. **監査ログ**
   - CloudWatch Logsへのログ記録
   - 検索ログの有効化

### バックアップとリカバリ

```bash
# スナップショット作成
aws opensearch create-domain-snapshot \
  --domain-name cis-filesearch-opensearch \
  --snapshot-name "cis-files-$(date +%Y%m%d)"

# スナップショットからのリストア
aws opensearch restore-domain-from-snapshot \
  --domain-name cis-filesearch-opensearch \
  --snapshot-name cis-files-20250101
```

### スケーリング

データ量に応じたシャード数の調整:

- **小規模** (< 1M ドキュメント): 2 shards
- **中規模** (1M - 10M): 5 shards
- **大規模** (> 10M): 10+ shards

```bash
# 新しいシャード数で再インデックス
# 注: 既存インデックスのシャード数は変更不可、再作成が必要
```

## 次のステップ

1. **Lambda統合**: 画像埋め込み自動生成のLambda関数を作成
2. **バッチ処理**: 大量の既存ファイルをバッチでインデックス
3. **監視**: CloudWatchアラームの設定
4. **フロントエンド統合**: Next.jsアプリから画像検索APIを呼び出し

## リファレンス

- スクリプト: `/Users/tatsuya/focus_project/cis_filesearch_app/scripts/`
- クイックリファレンス: `/Users/tatsuya/focus_project/cis_filesearch_app/scripts/ec2-opensearch-quick-reference.md`
- OpenSearchドキュメント: https://opensearch.org/docs/latest/
- k-NNプラグインドキュメント: https://opensearch.org/docs/latest/search-plugins/knn/
