# 🚨 OpenSearchマイグレーション - クイックフィックス

## 今すぐ実行できること

### 1️⃣ AWS認証を確認
```bash
aws sso login
# または
aws configure
```

### 2️⃣ EC2インスタンスを探す
```bash
aws ec2 describe-instances \
  --region ap-northeast-1 \
  --filters "Name=instance-state-name,Values=running" \
  --query 'Reservations[*].Instances[*].[InstanceId,Tags[?Key==`Name`].Value|[0]]' \
  --output table
```

### 3️⃣ EC2に接続
```bash
# インスタンスIDを上記から取得して実行
aws ssm start-session --target i-xxxxxxxxx
```

### 4️⃣ EC2内でマイグレーションスクリプトを作成
EC2内で以下を実行:
```bash
# スクリプトをダウンロード（S3経由の場合）
aws s3 cp s3://your-bucket/ec2-opensearch-migration.sh ./

# またはスクリプトを直接作成
cat > migrate.sh << 'SCRIPT_END'
#!/bin/bash
OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
INDEX_NAME="cis-files"

echo "Checking connection..."
curl -s "$OPENSEARCH_ENDPOINT/_cat/indices?v"

echo "Creating new index with knn_vector..."
# ... (完全なスクリプトはec2-opensearch-migration.shを参照)
SCRIPT_END

chmod +x migrate.sh
```

### 5️⃣ 実行
```bash
./migrate.sh
```

## ✅ 成功の確認

マイグレーション後、EC2内で:
```bash
# マッピングを確認
curl -s "$OPENSEARCH_ENDPOINT/cis-files/_mapping" | grep knn_vector

# 期待される出力: "type": "knn_vector"
```

ローカルに戻って:
```bash
# テスト実行
./scripts/quick-test-image-search.sh
```

## 🆘 うまくいかない場合

### EC2が見つからない
→ 別のリージョンを確認:
```bash
for region in us-east-1 us-west-2 ap-northeast-1; do
  echo "Checking $region..."
  aws ec2 describe-instances --region $region --output table
done
```

### SSM接続できない
→ 通常のSSH接続を試す:
```bash
ssh -i your-key.pem ec2-user@<public-ip>
```

### それでもダメな場合
→ Lambda関数を使用:
1. AWS Lambdaコンソールを開く
2. `lambda-opensearch-migration.js`のコードをコピー
3. VPC設定してデプロイ
4. テスト実行

---

**重要**: データは安全です。前回の失敗はVPCアクセス制限によるもので、削除は実行されていません。