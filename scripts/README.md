# EC2 OpenSearch k-NN スクリプト集

EC2インスタンスから直接OpenSearch k-NNインデックスを作成・管理するための完全なツールセット

## 概要

このディレクトリには、EC2インスタンス（VPC内）からOpenSearchドメインに直接アクセスし、k-NN（k-Nearest Neighbors）検索用のインデックスを作成・管理するためのスクリプトとドキュメントが含まれています。

**重要**: これらのスクリプトはEC2インスタンス上で実行するように設計されており、SSHトンネルは不要です。

## ファイル一覧

### 実行可能スクリプト

| ファイル | サイズ | 説明 |
|---------|--------|------|
| `ec2-create-opensearch-knn-index.sh` | 8.2KB | k-NNインデックスの作成と自動検証 |
| `ec2-verify-index.sh` | 3.7KB | インデックスの詳細検証（設定、マッピング、統計） |
| `ec2-index-sample-data.sh` | 4.6KB | テスト用サンプルデータの投入 |
| `ec2-test-knn-search.sh` | 5.3KB | k-NN検索の実行とパフォーマンステスト |

### ドキュメント

| ファイル | 説明 |
|---------|------|
| `ec2-opensearch-quick-reference.md` | コピー&ペースト可能なコマンドリファレンス |
| `DEPLOY_TO_EC2.md` | ステップバイステップのデプロイ手順 |
| `QUICK_START.txt` | 3分で完了するクイックスタートガイド |
| `DEPLOYMENT_CHECKLIST.md` | デプロイメント前後のチェックリスト |
| `README.md` | このファイル |

## クイックスタート

### 1. EC2にファイルをコピー

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/scripts

scp -i ~/.ssh/your-key.pem \
  ec2-*.sh \
  ec2-user@<EC2_IP>:/home/ec2-user/
```

### 2. EC2で実行

```bash
ssh -i ~/.ssh/your-key.pem ec2-user@<EC2_IP>

# 実行権限付与
chmod +x *.sh

# インデックス作成
./ec2-create-opensearch-knn-index.sh

# サンプルデータ投入
./ec2-index-sample-data.sh 10

# k-NN検索テスト
./ec2-test-knn-search.sh 5
```

## 各スクリプトの詳細

### 1. ec2-create-opensearch-knn-index.sh

**用途**: OpenSearch k-NNインデックスの作成

**実行内容**:
- OpenSearch接続の確認
- 既存インデックスの検出と削除オプション
- 512次元ベクトル用のk-NNインデックス作成
- HNSW アルゴリズムの設定
- 設定とマッピングの自動検証

**使用方法**:
```bash
./ec2-create-opensearch-knn-index.sh
```

**期待される結果**:
```
✓ Successfully connected to OpenSearch
✓ Index created successfully
✓ k-NN is properly enabled
✓ Mapping verified successfully
```

### 2. ec2-verify-index.sh

**用途**: インデックスの包括的な検証

**確認項目**:
- クラスターヘルス
- インデックスの存在
- k-NN設定
- マッピング構造
- ドキュメント統計
- サンプルドキュメント

**使用方法**:
```bash
./ec2-verify-index.sh [index_name]

# 例
./ec2-verify-index.sh cis-files
```

### 3. ec2-index-sample-data.sh

**用途**: テスト用サンプルデータの投入

**機能**:
- ランダムな512次元ベクトルの生成
- 様々なファイルタイプのサンプル作成
- バッチインデックス処理
- 自動リフレッシュ

**使用方法**:
```bash
./ec2-index-sample-data.sh [number_of_samples]

# 例: 10件のサンプル
./ec2-index-sample-data.sh 10

# 100件のサンプル
./ec2-index-sample-data.sh 100
```

### 4. ec2-test-knn-search.sh

**用途**: k-NN検索のテストとパフォーマンス測定

**テスト内容**:
- 純粋なk-NN検索
- ハイブリッド検索（テキスト + k-NN）
- 検索時間の測定
- 結果の詳細表示

**使用方法**:
```bash
./ec2-test-knn-search.sh [k_value]

# 例: Top 5の類似ドキュメント
./ec2-test-knn-search.sh 5

# Top 10の類似ドキュメント
./ec2-test-knn-search.sh 10
```

## 前提条件

### EC2インスタンス要件
- OpenSearchと同じVPC内に配置
- 適切なIAMロールがアタッチされている
- セキュリティグループでOpenSearchへのHTTPS(443)アクセスが許可されている

### 必要なツール
```bash
# EC2インスタンスで実行
sudo yum install -y jq curl python3
```

### AWS認証情報
```bash
# 認証情報の確認
aws sts get-caller-identity

# 必要な権限:
# - es:ESHttpPut
# - es:ESHttpPost
# - es:ESHttpGet
# - es:ESHttpDelete
```

## 手動コマンド

スクリプトを使わずに手動でコマンドを実行する場合:

```bash
# 環境変数設定
ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION="ap-northeast-1"

# インデックス作成
curl -X PUT "${ENDPOINT}/cis-files" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d '{"settings":{"index":{"knn":true}},"mappings":{"properties":{"image_embedding":{"type":"knn_vector","dimension":512}}}}'

# ドキュメントのインデックス
VECTOR=$(python3 -c "import random; print('[' + ','.join([str(random.uniform(-1, 1)) for _ in range(512)]) + ']')")
curl -X POST "${ENDPOINT}/cis-files/_doc/1" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d "{\"file_name\":\"test.jpg\",\"image_embedding\":${VECTOR}}"

# k-NN検索
QUERY=$(python3 -c "import random; print('[' + ','.join([str(random.uniform(-1, 1)) for _ in range(512)]) + ']')")
curl -X POST "${ENDPOINT}/cis-files/_search" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
  -d "{\"size\":5,\"query\":{\"knn\":{\"image_embedding\":{\"vector\":${QUERY},\"k\":5}}}}"
```

## トラブルシューティング

### 接続エラー
```bash
# OpenSearchへの接続テスト
curl -v ${ENDPOINT}

# セキュリティグループ確認
aws ec2 describe-security-groups

# VPC設定確認
aws opensearch describe-domain --domain-name cis-filesearch-opensearch
```

### 認証エラー
```bash
# IAMロール確認
aws sts get-caller-identity

# OpenSearchアクセスポリシー確認
aws opensearch describe-domain --domain-name cis-filesearch-opensearch | jq '.DomainStatus.AccessPolicies'
```

### 検索結果が返らない
```bash
# ドキュメント数確認
curl -X GET "${ENDPOINT}/cis-files/_count" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)"

# サンプルデータ投入
./ec2-index-sample-data.sh 10
```

### インデックス作成エラー
```bash
# 既存インデックス削除
curl -X DELETE "${ENDPOINT}/cis-files" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)"

# 再作成
./ec2-create-opensearch-knn-index.sh
```

## パフォーマンスチューニング

### ef_search パラメータの調整

```bash
# 高精度設定（遅い）
curl -X PUT "${ENDPOINT}/cis-files/_settings" ... \
  -d '{"index":{"knn.algo_param.ef_search":1024}}'

# 高速設定（精度低）
curl -X PUT "${ENDPOINT}/cis-files/_settings" ... \
  -d '{"index":{"knn.algo_param.ef_search":256}}'
```

推奨値:
- **開発**: 256-512
- **本番**: 512-1024
- **高精度**: 1024+

### パフォーマンス監視

```bash
# インデックス統計
curl -X GET "${ENDPOINT}/_cat/indices/cis-files?v" ...

# 検索統計
curl -X GET "${ENDPOINT}/cis-files/_stats/search" ...
```

## ベストプラクティス

1. **インデックス作成前に接続を確認**
   ```bash
   curl -s ${ENDPOINT}/_cluster/health | jq '.'
   ```

2. **小規模なサンプルでテスト**
   ```bash
   ./ec2-index-sample-data.sh 10
   ```

3. **パフォーマンスを測定**
   ```bash
   ./ec2-test-knn-search.sh 5
   ```

4. **本番データを投入する前にバックアップ**
   ```bash
   # スナップショット作成
   aws opensearch create-domain-snapshot ...
   ```

## よくある質問

**Q: SSHトンネルは必要ですか？**
A: いいえ。EC2インスタンスはVPC内でOpenSearchに直接アクセスできます。

**Q: インデックスのシャード数は変更できますか？**
A: インデックス作成後は変更不可。再作成が必要です。

**Q: 512次元以外のベクトルは使えますか？**
A: はい。スクリプト内の`dimension`パラメータを変更してください。

**Q: 検索が遅い場合の対処法は？**
A: `ef_search`パラメータを下げるか、シャード数を増やしてください。

## 次のステップ

セットアップ完了後:

1. **Lambda統合** - 画像埋め込み生成の自動化
2. **EC2ワーカー統合** - ファイル処理パイプラインとの連携
3. **フロントエンド統合** - Next.jsアプリからの検索機能
4. **監視設定** - CloudWatchアラームの構成

## 関連ドキュメント

- [詳細セットアップガイド](../docs/EC2_OPENSEARCH_KNN_SETUP.md)
- [デプロイチェックリスト](./DEPLOYMENT_CHECKLIST.md)
- [クイックスタート](./QUICK_START.txt)
- [コマンドリファレンス](./ec2-opensearch-quick-reference.md)

## サポート

問題が発生した場合:

1. `DEPLOY_TO_EC2.md` のトラブルシューティングセクションを確認
2. `ec2-opensearch-quick-reference.md` で手動コマンドを確認
3. `../docs/EC2_OPENSEARCH_KNN_SETUP.md` で詳細なガイドを確認

---

作成者: Claude Code  
最終更新: 2025-12-19  
バージョン: 1.0.0
