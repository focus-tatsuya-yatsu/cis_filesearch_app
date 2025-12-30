# EC2 OpenSearch k-NN セットアップ - 完了サマリー

## 問題の解決

### 元の問題
- EC2インスタンス（ip-10-0-3-24）からOpenSearch k-NNインデックスを作成しようとした際、スクリプトがSSHトンネルのセットアップを要求
- EC2はVPC内にあり、OpenSearchに直接アクセス可能なため、SSHトンネルは不要

### 解決策
EC2専用のスクリプトを作成し、VPC内からの直接アクセスに対応しました。

## 作成されたファイル

### 1. メインスクリプト

| ファイル | 用途 | サイズ |
|---------|------|--------|
| `scripts/ec2-create-opensearch-knn-index.sh` | k-NNインデックスの作成 | 8.2KB |
| `scripts/ec2-verify-index.sh` | インデックスの検証 | 3.7KB |
| `scripts/ec2-index-sample-data.sh` | サンプルデータのインデックス | 4.6KB |
| `scripts/ec2-test-knn-search.sh` | k-NN検索のテスト | 5.3KB |

### 2. ドキュメント

| ファイル | 内容 |
|---------|------|
| `scripts/ec2-opensearch-quick-reference.md` | コピー&ペースト可能なコマンドリファレンス |
| `scripts/DEPLOY_TO_EC2.md` | EC2へのデプロイ手順 |
| `docs/EC2_OPENSEARCH_KNN_SETUP.md` | 包括的なセットアップガイド |

## 使用方法

### ステップ1: スクリプトをEC2にコピー

```bash
# ローカルマシンから実行
cd /Users/tatsuya/focus_project/cis_filesearch_app/scripts

scp -i ~/.ssh/your-key.pem \
  ec2-*.sh \
  ec2-opensearch-quick-reference.md \
  DEPLOY_TO_EC2.md \
  ec2-user@<EC2_IP>:/home/ec2-user/
```

### ステップ2: EC2で実行

```bash
# EC2に接続
ssh -i ~/.ssh/your-key.pem ec2-user@<EC2_IP>

# 実行権限付与
chmod +x *.sh

# インデックス作成
./ec2-create-opensearch-knn-index.sh

# 検証
./ec2-verify-index.sh

# サンプルデータをインデックス
./ec2-index-sample-data.sh 10

# k-NN検索テスト
./ec2-test-knn-search.sh 5
```

## 主な機能

### 1. インデックス作成スクリプト (`ec2-create-opensearch-knn-index.sh`)

**機能**:
- OpenSearch接続の自動確認
- 既存インデックスの検出と削除オプション
- k-NN対応のインデックス作成
- 512次元ベクトルのHNSWアルゴリズム設定
- 自動検証

**設定内容**:
```json
{
  "settings": {
    "knn": true,
    "knn.algo_param.ef_search": 512,
    "number_of_shards": 2,
    "number_of_replicas": 1
  },
  "mappings": {
    "properties": {
      "image_embedding": {
        "type": "knn_vector",
        "dimension": 512,
        "method": {
          "name": "hnsw",
          "space_type": "l2",
          "engine": "nmslib",
          "parameters": {
            "ef_construction": 512,
            "m": 16
          }
        }
      }
    }
  }
}
```

### 2. 検証スクリプト (`ec2-verify-index.sh`)

**確認項目**:
- クラスターヘルス（status, nodes, shards）
- インデックスの存在確認
- k-NN設定の確認
- マッピングの確認
- ドキュメント統計
- サンプルドキュメントの表示

### 3. サンプルデータ投入 (`ec2-index-sample-data.sh`)

**機能**:
- ランダムな512次元ベクトルの生成
- 様々なファイルタイプのサンプル作成（jpg, png, pdf, docx, etc.）
- バッチインデックス処理
- 自動リフレッシュ
- 成功/失敗の統計表示

### 4. k-NN検索テスト (`ec2-test-knn-search.sh`)

**テスト内容**:
- 純粋なk-NN検索
- ハイブリッド検索（テキスト + k-NN）
- 検索時間の測定
- スコアの表示

## 手動コマンド（スクリプトなしの場合）

### インデックス作成

```bash
ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION="ap-northeast-1"

curl -X PUT "${ENDPOINT}/cis-files" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d '{
  "settings": {"index": {"knn": true}},
  "mappings": {
    "properties": {
      "image_embedding": {
        "type": "knn_vector",
        "dimension": 512,
        "method": {"name": "hnsw", "space_type": "l2", "engine": "nmslib"}
      }
    }
  }
}'
```

### ドキュメントのインデックス

```bash
VECTOR=$(python3 -c "import random; print('[' + ','.join([str(random.uniform(-1, 1)) for _ in range(512)]) + ']')")

curl -X POST "${ENDPOINT}/cis-files/_doc/1" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d "{\"file_name\":\"test.jpg\",\"image_embedding\":${VECTOR}}"
```

### k-NN検索

```bash
QUERY=$(python3 -c "import random; print('[' + ','.join([str(random.uniform(-1, 1)) for _ in range(512)]) + ']')")

curl -X POST "${ENDPOINT}/cis-files/_search" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d "{\"size\":5,\"query\":{\"knn\":{\"image_embedding\":{\"vector\":${QUERY},\"k\":5}}}}"
```

### インデックスの確認

```bash
# ドキュメント数
curl -X GET "${ENDPOINT}/cis-files/_count" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" | jq '.count'

# 設定確認
curl -X GET "${ENDPOINT}/cis-files/_settings" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" | jq '.["cis-files"].settings.index.knn'

# マッピング確認
curl -X GET "${ENDPOINT}/cis-files/_mapping" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" | jq '.["cis-files"].mappings.properties.image_embedding'
```

## トラブルシューティング

### 1. 接続エラー (Connection refused)

**原因**: ネットワーク/セキュリティグループの問題

**確認**:
```bash
# OpenSearchへの接続テスト
curl -v https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com

# セキュリティグループ確認
aws ec2 describe-security-groups --group-ids <sg-id>

# VPC確認
aws opensearch describe-domain --domain-name cis-filesearch-opensearch | jq '.DomainStatus.VPCOptions'
```

**解決策**:
- OpenSearchのセキュリティグループでEC2からのHTTPS(443)を許可
- EC2とOpenSearchが同じVPC内にあることを確認

### 2. 認証エラー (403 Forbidden)

**原因**: IAM権限の問題

**確認**:
```bash
# 現在の認証情報確認
aws sts get-caller-identity

# 必要な権限:
# - es:ESHttpPut
# - es:ESHttpPost
# - es:ESHttpGet
```

**解決策**:
- EC2インスタンスに適切なIAMロールをアタッチ
- OpenSearchのアクセスポリシーでIAMロールを許可

### 3. k-NN検索が結果を返さない

**原因**: データがインデックスされていない

**確認**:
```bash
# ドキュメント数確認
curl -X GET "${ENDPOINT}/cis-files/_count" ... | jq '.count'

# サンプルドキュメント確認
curl -X GET "${ENDPOINT}/cis-files/_search?size=1" ... | jq '.hits.hits[0]._source.image_embedding | length'
```

**解決策**:
```bash
# サンプルデータをインデックス
./ec2-index-sample-data.sh 10

# インデックスをリフレッシュ
curl -X POST "${ENDPOINT}/cis-files/_refresh" ...
```

## パフォーマンスチューニング

### ef_search パラメータ

```bash
# 高精度（遅い）
curl -X PUT "${ENDPOINT}/cis-files/_settings" ... \
  -d '{"index": {"knn.algo_param.ef_search": 1024}}'

# 高速（精度低下）
curl -X PUT "${ENDPOINT}/cis-files/_settings" ... \
  -d '{"index": {"knn.algo_param.ef_search": 256}}'
```

### シャード数の最適化

- **< 1M ドキュメント**: 2 shards（デフォルト）
- **1M - 10M**: 5 shards
- **> 10M**: 10+ shards

## 次のステップ

### 1. Lambda関数の作成
画像埋め込み生成用のLambda関数を作成:
```
/Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-image-embedding/
```

### 2. EC2ワーカーの統合
ファイル処理ワーカーでOpenSearchに自動インデックス:
```
/Users/tatsuya/focus_project/cis_filesearch_app/backend/ec2-worker/
```

### 3. フロントエンド統合
Next.jsアプリから画像検索APIを呼び出し:
```
/Users/tatsuya/focus_project/cis_filesearch_app/frontend/src/lib/api/imageSearch.ts
```

### 4. 監視とアラート
CloudWatchでインデックスのパフォーマンスを監視

## まとめ

### 解決したこと
✅ EC2からOpenSearchへの直接アクセススクリプトの作成
✅ SSHトンネル不要の設定
✅ k-NNインデックスの自動作成
✅ サンプルデータの投入と検証
✅ 包括的なトラブルシューティングガイド

### 提供したツール
- 4つの実行可能なBashスクリプト
- 3つの詳細なドキュメント
- コピー&ペースト可能なコマンド集
- トラブルシューティングガイド

### 次のアクション
1. スクリプトをEC2にコピー
2. `./ec2-create-opensearch-knn-index.sh` を実行
3. `./ec2-verify-index.sh` で検証
4. `./ec2-index-sample-data.sh 10` でテストデータ投入
5. `./ec2-test-knn-search.sh 5` で動作確認

すべてのファイルは以下の場所にあります:
- **スクリプト**: `/Users/tatsuya/focus_project/cis_filesearch_app/scripts/`
- **ドキュメント**: `/Users/tatsuya/focus_project/cis_filesearch_app/docs/`
