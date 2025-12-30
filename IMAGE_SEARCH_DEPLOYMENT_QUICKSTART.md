# 🚀 画像検索機能 - 本番デプロイ クイックスタート

## 📋 現在の状況

### ✅ 実装済み
- **フロントエンド**: 画像アップロード、ベクトル化、検索UI完成
- **API**: `/api/image-embedding/` と `/api/search/` 実装済み
- **Lambda**: k-NN検索対応済み（最新のOpenSearch 2.x形式）
- **スクリプト**: インデックス作成とサンプルデータ登録スクリプト準備完了

### ⚠️ 本番環境での作業が必要
1. OpenSearchにk-NNインデックスを作成
2. Lambda関数の最新版をデプロイ
3. サンプルデータでテスト

## 🔥 5分で完了！デプロイ手順

### Step 1: EC2インスタンス経由でOpenSearchインデックス作成

```bash
# ローカルからEC2にスクリプトをコピー
scp frontend/scripts/create-opensearch-knn-index.sh ec2-user@your-ec2-ip:/tmp/
scp frontend/scripts/index-sample-images.sh ec2-user@your-ec2-ip:/tmp/
scp frontend/scripts/opensearch-mapping-template.json ec2-user@your-ec2-ip:/tmp/

# EC2にSSH接続
ssh ec2-user@your-ec2-ip

# EC2内で実行
cd /tmp
chmod +x *.sh
./create-opensearch-knn-index.sh ./opensearch-mapping-template.json
./index-sample-images.sh 20  # 20件のサンプルデータを登録
```

### Step 2: Lambda関数を更新

```bash
# ローカルで実行
cd backend/lambda-search-api

# ビルド
npm install
npm run build

# デプロイパッケージ作成
zip -r lambda-deploy.zip dist/ node_modules/ package.json

# Lambda関数を更新
aws lambda update-function-code \
  --function-name cis-filesearch-search-api \
  --zip-file fileb://lambda-deploy.zip \
  --region ap-northeast-1

# 環境変数を更新（新しいインデックス名を設定）
aws lambda update-function-configuration \
  --function-name cis-filesearch-search-api \
  --environment Variables='{"OPENSEARCH_INDEX":"file-index-v2-knn"}' \
  --region ap-northeast-1
```

### Step 3: 動作確認

```bash
# フロントエンドを起動
cd frontend
yarn dev
```

ブラウザで http://localhost:3000/test-image-search.html を開いて:
1. 画像をドラッグ&ドロップ
2. 「画像をベクトル化」をクリック
3. 「類似画像を検索」をクリック
4. 結果が表示されることを確認

## 🎯 動作確認コマンド（EC2から実行）

```bash
# インデックス確認
curl -s "$OPENSEARCH_ENDPOINT/_cat/indices/*knn*?v"

# ドキュメント数確認
curl -s "$OPENSEARCH_ENDPOINT/file-index-v2-knn/_count" | jq .

# テストk-NN検索
echo '{
  "query": {
    "knn": {
      "image_embedding": {
        "vector": ['$(python3 -c "import random; print(','.join([str(random.uniform(-1,1)) for _ in range(1024)]))")'],
        "k": 5
      }
    }
  }
}' | curl -X POST "$OPENSEARCH_ENDPOINT/file-index-v2-knn/_search" \
  -H 'Content-Type: application/json' \
  --data-binary @- | jq '.hits.total'
```

## ⚡ トラブルシューティング

### VPCエンドポイントにアクセスできない
→ **必ずEC2経由で実行**してください

### 403 Forbiddenエラー
→ Lambda関数のIAMロールに以下を追加:
```json
{
  "Effect": "Allow",
  "Action": "es:*",
  "Resource": "arn:aws:es:*:*:domain/cis-filesearch-opensearch/*"
}
```

### 検索結果が0件
→ インデックス名が正しいか確認:
- Lambda環境変数: `OPENSEARCH_INDEX=file-index-v2-knn`
- フロントエンド: `.env.local`の`OPENSEARCH_INDEX=file-index-v2-knn`

## ✅ 完了チェックリスト

- [ ] EC2経由でk-NNインデックス作成完了
- [ ] サンプルデータ20件以上登録
- [ ] Lambda関数の更新完了
- [ ] テストページで画像検索が動作
- [ ] 検索結果にスコアが表示される

## 📝 メモ

- **インデックス名**: `file-index-v2-knn`
- **ベクトル次元数**: 1024
- **類似度計算**: コサイン類似度（innerproduct）
- **k-NNアルゴリズム**: HNSW (Hierarchical Navigable Small World)

これで画像検索機能が完全に動作するようになります！ 🎉