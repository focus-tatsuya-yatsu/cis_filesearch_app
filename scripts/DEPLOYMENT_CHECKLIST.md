# EC2 OpenSearch k-NN デプロイメントチェックリスト

## 前提条件の確認

### EC2インスタンス
- [ ] EC2インスタンスが起動している（ip-10-0-3-24 または類似）
- [ ] EC2がOpenSearchと同じVPC内にある
- [ ] EC2インスタンスにSSH接続できる
- [ ] EC2インスタンスに適切なIAMロールがアタッチされている

### OpenSearch
- [ ] OpenSearchドメインが起動している（cis-filesearch-opensearch）
- [ ] OpenSearchエンドポイントが取得できている
- [ ] OpenSearchのセキュリティグループがEC2からのHTTPS(443)を許可している

### ローカル環境
- [ ] SSHキーファイルが存在する（~/.ssh/your-key.pem）
- [ ] EC2のIPアドレスまたはホスト名を把握している
- [ ] スクリプトファイルが存在する（scripts/ディレクトリ）

## デプロイメント手順

### ステップ1: スクリプトのコピー
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/scripts

scp -i ~/.ssh/your-key.pem \
  ec2-create-opensearch-knn-index.sh \
  ec2-verify-index.sh \
  ec2-index-sample-data.sh \
  ec2-test-knn-search.sh \
  ec2-opensearch-quick-reference.md \
  DEPLOY_TO_EC2.md \
  QUICK_START.txt \
  ec2-user@<EC2_IP>:/home/ec2-user/
```

- [ ] スクリプトのコピーが成功した

### ステップ2: EC2に接続
```bash
ssh -i ~/.ssh/your-key.pem ec2-user@<EC2_IP>
```

- [ ] EC2に接続できた

### ステップ3: 環境確認
```bash
# AWS認証情報の確認
aws sts get-caller-identity

# 必要なツールのインストール（必要に応じて）
sudo yum install -y jq curl python3

# ツールの確認
which jq curl python3
```

- [ ] AWS認証情報が正しい
- [ ] jq, curl, python3がインストールされている

### ステップ4: スクリプトの実行権限付与
```bash
chmod +x *.sh
ls -l ec2-*.sh
```

- [ ] すべてのスクリプトに実行権限が付与された

### ステップ5: OpenSearch接続テスト
```bash
ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
curl -s ${ENDPOINT}/_cluster/health | jq '.'
```

- [ ] OpenSearchに接続できた
- [ ] クラスターステータスが"green"または"yellow"

### ステップ6: k-NNインデックス作成
```bash
./ec2-create-opensearch-knn-index.sh
```

期待される出力:
```
✓ Successfully connected to OpenSearch
✓ Index created successfully
✓ k-NN is properly enabled
✓ Mapping verified successfully
```

- [ ] インデックスが正常に作成された
- [ ] エラーが発生しなかった

### ステップ7: インデックス検証
```bash
./ec2-verify-index.sh
```

確認事項:
- [ ] クラスターヘルスが表示される
- [ ] インデックスが存在する
- [ ] k-NN設定が"true"
- [ ] image_embeddingフィールドがknn_vector型

### ステップ8: サンプルデータのインデックス
```bash
./ec2-index-sample-data.sh 10
```

期待される結果:
- [ ] 10件のドキュメントが正常にインデックスされた
- [ ] "Successful: 10"と表示される
- [ ] エラーが発生しなかった

### ステップ9: k-NN検索テスト
```bash
./ec2-test-knn-search.sh 5
```

確認事項:
- [ ] 検索が成功した（HTTP 200）
- [ ] 5件の結果が返された
- [ ] 各結果にスコアとファイル情報が含まれる
- [ ] 検索時間が表示される（通常<100ms）

### ステップ10: 手動検証（オプション）
```bash
ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION="ap-northeast-1"

# ドキュメント数確認
curl -X GET "${ENDPOINT}/cis-files/_count" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" | jq '.count'
```

- [ ] ドキュメント数が正しい（10件）

## トラブルシューティング

### 問題が発生した場合

#### 接続エラー
```bash
# セキュリティグループの確認
aws ec2 describe-security-groups | grep -A 10 "opensearch"

# VPC設定の確認
aws opensearch describe-domain --domain-name cis-filesearch-opensearch | jq '.DomainStatus.VPCOptions'
```

#### 認証エラー
```bash
# IAMロールの確認
aws sts get-caller-identity

# 必要な権限:
# - es:ESHttpPut
# - es:ESHttpPost
# - es:ESHttpGet
# - es:ESHttpDelete
```

#### インデックス作成エラー
```bash
# 既存インデックスの削除
curl -X DELETE "${ENDPOINT}/cis-files" \
  --aws-sigv4 "aws:amz:${REGION}:es" \
  --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)"

# 再度作成
./ec2-create-opensearch-knn-index.sh
```

## 完了確認

すべてのチェックボックスが完了していることを確認:

- [ ] EC2とOpenSearchの接続が確認できた
- [ ] k-NNインデックスが正常に作成された
- [ ] サンプルデータがインデックスされた
- [ ] k-NN検索が正常に動作した
- [ ] エラーが発生していない

## 次のステップ

デプロイメントが完了したら:

1. **Lambda関数の統合**
   - 画像埋め込み生成Lambda関数の作成
   - S3イベントトリガーの設定

2. **EC2ワーカーの統合**
   - ファイル処理ワーカーの更新
   - OpenSearchへの自動インデックス機能の追加

3. **フロントエンド統合**
   - Next.jsアプリからの画像検索API呼び出し
   - UI/UXの実装

4. **監視とアラート**
   - CloudWatchダッシュボードの作成
   - パフォーマンスアラートの設定

## リファレンス

- **クイックスタート**: `QUICK_START.txt`
- **デプロイガイド**: `DEPLOY_TO_EC2.md`
- **コマンドリファレンス**: `ec2-opensearch-quick-reference.md`
- **詳細ガイド**: `../docs/EC2_OPENSEARCH_KNN_SETUP.md`
- **サマリー**: `../EC2_OPENSEARCH_SETUP_SUMMARY.md`
