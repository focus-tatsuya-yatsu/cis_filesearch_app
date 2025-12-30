# 🚀 EC2 OpenSearch マイグレーション実行ガイド

## 📌 概要

ローカルマシンからはVPCエンドポイントにアクセスできないため、EC2インスタンス内からマイグレーションを実行する必要があります。

## 🔧 前提条件

- AWS CLIがインストールされていること
- EC2インスタンスへのSSMアクセス権限があること
- EC2インスタンスがOpenSearchと同じVPC内にあること

## 📝 手順

### ステップ 1: AWS認証情報の更新（必要な場合）

```bash
# AWS SSOを使用している場合
aws sso login

# または通常の認証情報を設定
aws configure
```

### ステップ 2: 利用可能なEC2インスタンスの確認

```bash
# 実行中のEC2インスタンスを一覧表示
aws ec2 describe-instances \
  --filters "Name=instance-state-name,Values=running" \
  --query 'Reservations[*].Instances[*].[InstanceId,Tags[?Key==`Name`].Value|[0],State.Name,PrivateIpAddress]' \
  --output table
```

### ステップ 3: EC2インスタンスへ接続

```bash
# SSM Session Managerを使用して接続
aws ssm start-session --target <INSTANCE_ID>

# 例:
# aws ssm start-session --target i-0123456789abcdef0
```

### ステップ 4: マイグレーションスクリプトをEC2にコピー

#### オプション A: S3経由でコピー

```bash
# ローカルからS3にアップロード
aws s3 cp scripts/ec2-opensearch-migration.sh s3://your-bucket/scripts/

# EC2内でS3からダウンロード
aws s3 cp s3://your-bucket/scripts/ec2-opensearch-migration.sh ./
```

#### オプション B: 直接作成

EC2インスタンス内で以下を実行:

```bash
cat > ec2-opensearch-migration.sh << 'EOF'
[スクリプト内容をここにペースト]
EOF
```

### ステップ 5: スクリプトに実行権限を付与

```bash
chmod +x ec2-opensearch-migration.sh
```

### ステップ 6: マイグレーションを実行

```bash
# 実行
./ec2-opensearch-migration.sh

# 実行時の流れ:
# 1. VPC内からの接続確認 ✓
# 2. 既存インデックスの確認
# 3. 現在のマッピングを確認
# 4. バックアップインデックス作成
# 5. 新しいインデックスを作成（knn_vector対応）
# 6. データを移行（image_embeddingフィールドは除外）
# 7. インデックスエイリアスの更新
```

### ステップ 7: 結果の確認

```bash
# インデックス一覧を確認
curl -s "$OPENSEARCH_ENDPOINT/_cat/indices?v"

# 新しいマッピングを確認
curl -s "$OPENSEARCH_ENDPOINT/cis-files/_mapping" | jq '.["cis-files"].mappings.properties.image_embedding'

# 期待される結果:
# {
#   "type": "knn_vector",
#   "dimension": 1024,
#   "method": {
#     "name": "hnsw",
#     "space_type": "innerproduct",
#     "engine": "faiss"
#   }
# }
```

## 🔍 トラブルシューティング

### 問題: EC2インスタンスが見つからない

**解決策**:

```bash
# すべてのリージョンでインスタンスを検索
for region in $(aws ec2 describe-regions --query "Regions[].RegionName" --output text); do
  echo "Checking region: $region"
  aws ec2 describe-instances --region $region \
    --query 'Reservations[*].Instances[*].[InstanceId,State.Name]' \
    --output table
done
```

### 問題: SSM接続ができない

**解決策**:

1. EC2インスタンスにSSMエージェントがインストールされているか確認
2. IAMロールに`AmazonSSMManagedInstanceCore`ポリシーがアタッチされているか確認
3. VPCエンドポイントが設定されているか確認

### 問題: OpenSearchに接続できない

**解決策**:

1. セキュリティグループの設定を確認（ポート443を許可）
2. VPCエンドポイントの設定を確認
3. EC2インスタンスが正しいVPC内にあるか確認

## ✅ マイグレーション後の確認事項

1. **インデックスマッピングの確認**
   - image_embeddingフィールドがknn_vectorタイプ
   - 次元数が1024

2. **データの整合性**
   - ドキュメント数が移行前後で一致（image_embeddingフィールド以外）
   - 既存の検索機能が正常に動作

3. **画像検索のテスト**
   - ローカルでテストスクリプトを実行:
   ```bash
   ./scripts/quick-test-image-search.sh
   ```

## 📊 移行完了後のステップ

1. **画像ベクトルの再生成**
   - 既存の画像ファイルを再処理してベクトル生成
   - 新規アップロードは自動的に1024次元ベクトルで保存保存

2. **アプリケーション設定の確認**
   - .env.localファイルのINDEX_NAME設定
   - エイリアス経由でアクセスするため変更は不要

3. **古いインデックスのクリーンアップ（オプション）**
   - バックアップが不要になったら削除
   - 元のインデックスも削除可能

## 🆘 サポート

問題が発生した場合は、以下の情報を収集してください:

- EC2インスタンスID
- OpenSearchエンドポイント
- エラーメッセージの全文
- 実行したコマンドと出力
