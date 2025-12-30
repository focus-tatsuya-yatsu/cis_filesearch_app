# 本番環境クイックスタート

CIS File Search Application - 画像検索機能を本番環境で動かすための最短手順

## 🚀 5分でデプロイ

### 1. 環境変数を設定

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/frontend

# .env.productionをコピー
cp .env.production.example .env.production

# 必須の設定を編集
vi .env.production
```

**最低限必要な設定:**

```bash
# モックモードを無効化（本番では必須）
USE_MOCK_EMBEDDING=false

# OpenSearchエンドポイント
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh5x3uqe.ap-northeast-1.es.amazonaws.com

# AWS設定
AWS_REGION=ap-northeast-1
BEDROCK_REGION=us-east-1

# 監視を有効化
ENABLE_CLOUDWATCH_LOGS=true
ENABLE_PERFORMANCE_METRICS=true
```

### 2. ビルド＆デプロイ

```bash
# 依存関係をインストール
yarn install

# 本番ビルド
NODE_ENV=production yarn build

# 起動（PM2使用）
pm2 start yarn --name "cis-filesearch" -- start
pm2 save
```

### 3. 動作確認

```bash
# ヘルスチェック
curl http://localhost:3000/

# 画像エンベディングテスト
curl -X POST http://localhost:3000/api/image-embedding \
  -F "image=@test.jpg"
```

---

## ✅ デプロイ前チェック（必須）

- [ ] `USE_MOCK_EMBEDDING=false` に設定
- [ ] EC2 IAMロールにBedrock権限がある
- [ ] OpenSearchにVPC内からアクセスできる
- [ ] テストが全て成功している

---

## 🔍 トラブルシューティング

### エラー: "AWS credentials not configured"

**原因:** EC2 IAMロールにBedrock権限がない

**解決:**
```bash
# IAMロールを確認
aws iam get-role --role-name <EC2-ROLE-NAME>

# Bedrock権限を追加
aws iam attach-role-policy \
  --role-name <EC2-ROLE-NAME> \
  --policy-arn arn:aws:iam::aws:policy/AmazonBedrockFullAccess
```

### エラー: "OpenSearch client is not available"

**原因:** VPCエンドポイントに接続できない

**解決:**
```bash
# セキュリティグループでポート443を開放
aws ec2 authorize-security-group-ingress \
  --group-id <SG-ID> \
  --protocol tcp \
  --port 443 \
  --source-group <EC2-SG-ID>
```

### パフォーマンスが遅い

**解決:**
```bash
# キャッシュサイズを増やす（.env.production）
EMBEDDING_CACHE_MAX_SIZE=20000
EMBEDDING_CACHE_TTL=86400

# 再起動
pm2 restart cis-filesearch
```

---

## 📊 監視

### CloudWatchログを確認

```bash
aws logs tail /aws/lambda/cis-filesearch --follow
```

### パフォーマンスメトリクス

```bash
# キャッシュヒット率を確認
aws cloudwatch get-metric-statistics \
  --namespace CISFileSearch \
  --metric-name CacheHitRate \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average
```

---

## 🎯 期待されるパフォーマンス

- **画像エンベディング生成（初回）:** ~2秒
- **画像エンベディング生成（キャッシュヒット）:** ~50ms（**97.5%高速化**）
- **キャッシュヒット率:** 80-90%
- **OpenSearch検索:** ~300ms

---

## 📚 詳細ドキュメント

より詳しい情報は以下を参照：

- [完全デプロイメントガイド](/docs/PRODUCTION_DEPLOYMENT_GUIDE.md)
- [パフォーマンス最適化レポート](/docs/PERFORMANCE_OPTIMIZATION_REPORT.md)
- [トラブルシューティングガイド](/docs/TROUBLESHOOTING.md)

---

**最終更新日:** 2025-01-18
