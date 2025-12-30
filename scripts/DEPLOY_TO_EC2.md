# EC2へのデプロイ手順

## 1. スクリプトをEC2にコピー

### ローカルマシンから実行

```bash
# プロジェクトディレクトリに移動
cd /Users/tatsuya/focus_project/cis_filesearch_app/scripts

# EC2のIPアドレスとSSHキーを設定
EC2_IP="your-ec2-ip-address"
SSH_KEY="~/.ssh/your-key.pem"

# スクリプトをコピー
scp -i ${SSH_KEY} \
  ec2-create-opensearch-knn-index.sh \
  ec2-verify-index.sh \
  ec2-index-sample-data.sh \
  ec2-test-knn-search.sh \
  ec2-opensearch-quick-reference.md \
  ec2-user@${EC2_IP}:/home/ec2-user/
```

## 2. EC2にSSH接続

```bash
ssh -i ${SSH_KEY} ec2-user@${EC2_IP}
```

## 3. 必要なツールをインストール（未インストールの場合）

```bash
sudo yum install -y jq curl python3

# AWS CLIの確認
aws --version

# 認証情報の確認
aws sts get-caller-identity
```

## 4. スクリプトに実行権限を付与

```bash
chmod +x *.sh
```

## 5. OpenSearch k-NNインデックスを作成

```bash
./ec2-create-opensearch-knn-index.sh
```

期待される出力:
```
========================================
OpenSearch k-NN Index Creation (EC2)
========================================

[1/5] Verifying OpenSearch connectivity...
✓ Successfully connected to OpenSearch

[2/5] Checking if index 'cis-files' exists...
✓ Index does not exist, proceeding with creation

[3/5] Creating index with k-NN mapping...
✓ Index created successfully

[4/5] Verifying index settings...
✓ k-NN is properly enabled

[5/5] Verifying index mapping...
✓ Mapping verified successfully
```

## 6. インデックスを検証

```bash
./ec2-verify-index.sh
```

## 7. サンプルデータをインデックス

```bash
# 10件のサンプルドキュメント
./ec2-index-sample-data.sh 10
```

## 8. k-NN検索をテスト

```bash
# Top 5の類似ドキュメントを検索
./ec2-test-knn-search.sh 5
```

## トラブルシューティング

### エラー: "Connection refused"

**原因**: OpenSearchへのネットワーク接続の問題

**確認**:
```bash
# OpenSearchエンドポイントへの接続テスト
curl -v https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com

# セキュリティグループの確認
# EC2とOpenSearchが同じVPC内にあり、セキュリティグループでHTTPS(443)が許可されているか確認
```

### エラー: "403 Forbidden"

**原因**: IAM権限の問題

**確認**:
```bash
# EC2インスタンスのIAMロールを確認
aws sts get-caller-identity

# 必要な権限:
# - es:ESHttpPut
# - es:ESHttpPost
# - es:ESHttpGet
# - es:ESHttpDelete
```

### エラー: k-NN検索が結果を返さない

**原因**: インデックスが空、またはドキュメントにembeddingがない

**確認**:
```bash
# ドキュメント数を確認
ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION="ap-northeast-1"

curl -X GET "${ENDPOINT}/cis-files/_count" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)"
```

## クイックコマンドリファレンス

### インデックスの削除と再作成

```bash
# インデックス削除
ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION="ap-northeast-1"

curl -X DELETE "${ENDPOINT}/cis-files" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)"

# 再作成
./ec2-create-opensearch-knn-index.sh
```

### ドキュメント数の確認

```bash
curl -X GET "${ENDPOINT}/cis-files/_count" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" | jq '.count'
```

### インデックスのリフレッシュ

```bash
curl -X POST "${ENDPOINT}/cis-files/_refresh" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)"
```

## 次のステップ

セットアップが完了したら:

1. **Lambda関数の作成**: 画像埋め込み生成用のLambda関数を作成
2. **バッチ処理**: 既存の画像ファイルを一括でインデックス
3. **フロントエンド統合**: Next.jsアプリケーションから検索APIを呼び出し
4. **監視**: CloudWatchでインデックスのパフォーマンスを監視

詳細は `ec2-opensearch-quick-reference.md` を参照してください。
