# ハイブリッド検索 クイックスタート

## 🎯 概要

このガイドでは、**10分以内**にデュアルインデックス・ハイブリッド検索をデプロイする方法を説明します。

### 何が実現できるか？

- ✅ **テキスト検索**: `cis-files`インデックス（10,000+件）からの全文検索
- ✅ **画像検索**: `file-index-v2-knn`インデックスからのk-NNベクトル検索
- ✅ **ハイブリッド検索**: 両方のインデックスを同時に検索し、結果をマージ
- ✅ **ゼロダウンタイム**: 既存システムに影響なし
- ✅ **データ移行不要**: 既存の10,000件のデータをそのまま利用

---

## 📋 前提条件

### 必須

- [x] AWS CLIがインストールされている
- [x] Node.js 18.x以上がインストールされている
- [x] 適切なIAMクレデンシャルが設定されている
- [x] Lambda関数 `cis-search-api` が作成されている
- [x] OpenSearchインデックス `cis-files` と `file-index-v2-knn` が存在する

### IAM権限

Lambda実行ロールに以下の権限が必要です：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "es:ESHttpGet",
        "es:ESHttpPost"
      ],
      "Resource": [
        "arn:aws:es:ap-northeast-1:*:domain/cis-filesearch-opensearch/cis-files/*",
        "arn:aws:es:ap-northeast-1:*:domain/cis-filesearch-opensearch/file-index-v2-knn/*"
      ]
    }
  ]
}
```

---

## 🚀 デプロイ手順（10分）

### ステップ1: リポジトリのクローン/移動

```bash
cd /path/to/cis_filesearch_app/backend/lambda-search-api
```

### ステップ2: デプロイスクリプト実行

```bash
bash deploy-hybrid-search.sh
```

このスクリプトは以下を自動実行します：

1. ✅ 前提条件チェック
2. ✅ 依存関係インストール
3. ✅ TypeScriptビルド
4. ✅ デプロイパッケージ作成
5. ✅ Lambda関数コード更新
6. ✅ Lambda関数設定更新

### ステップ3: デプロイ検証

```bash
# すべてのテストを実行
bash verify-hybrid-search.sh all

# または個別テスト
bash verify-hybrid-search.sh health    # ヘルスチェック
bash verify-hybrid-search.sh text      # テキスト検索
bash verify-hybrid-search.sh image     # 画像検索
bash verify-hybrid-search.sh hybrid    # ハイブリッド検索
```

---

## 🧪 テスト例

### 1. テキスト検索（cis-filesインデックス）

```bash
aws lambda invoke \
  --function-name cis-search-api \
  --region ap-northeast-1 \
  --payload '{
    "httpMethod": "GET",
    "queryStringParameters": {
      "q": "契約書",
      "searchMode": "and",
      "size": "10"
    }
  }' \
  response.json

cat response.json | jq '.metadata'
```

**期待されるレスポンス**:

```json
{
  "results": [...],
  "total": 125,
  "took": 45,
  "metadata": {
    "queryType": "text",
    "textIndexHits": 125,
    "imageIndexHits": 0,
    "indices": {
      "text": "cis-files"
    }
  }
}
```

### 2. 画像検索（file-index-v2-knnインデックス）

```bash
# 1024次元のダミーベクトル生成
VECTOR=$(python3 -c "import json; print(json.dumps([0.1] * 1024))")

aws lambda invoke \
  --function-name cis-search-api \
  --region ap-northeast-1 \
  --payload "{
    \"httpMethod\": \"POST\",
    \"headers\": {\"Content-Type\": \"application/json\"},
    \"body\": \"{\\\"imageEmbedding\\\": ${VECTOR}, \\\"size\\\": 5}\"
  }" \
  response.json

cat response.json | jq '.metadata'
```

**期待されるレスポンス**:

```json
{
  "results": [...],
  "total": 5,
  "took": 120,
  "metadata": {
    "queryType": "image",
    "textIndexHits": 0,
    "imageIndexHits": 20,
    "indices": {
      "image": "file-index-v2-knn"
    }
  }
}
```

### 3. ハイブリッド検索（両インデックス）

```bash
# 1024次元のダミーベクトル生成
VECTOR=$(python3 -c "import json; print(json.dumps([0.1] * 1024))")

aws lambda invoke \
  --function-name cis-search-api \
  --region ap-northeast-1 \
  --payload "{
    \"httpMethod\": \"POST\",
    \"headers\": {\"Content-Type\": \"application/json\"},
    \"body\": \"{\\\"query\\\": \\\"契約書\\\", \\\"searchMode\\\": \\\"or\\\", \\\"imageEmbedding\\\": ${VECTOR}, \\\"size\\\": 20}\"
  }" \
  response.json

cat response.json | jq '.metadata'
```

**期待されるレスポンス**:

```json
{
  "results": [...],
  "total": 145,
  "took": 150,
  "metadata": {
    "queryType": "hybrid",
    "textIndexHits": 125,
    "imageIndexHits": 20,
    "indices": {
      "text": "cis-files",
      "image": "file-index-v2-knn"
    }
  }
}
```

---

## 🔍 API Gateway経由のテスト

### API Gatewayエンドポイント取得

```bash
# API Gateway REST APIのエンドポイントを取得
API_ID=$(aws apigateway get-rest-apis --region ap-northeast-1 --query "items[?name=='cis-filesearch-api'].id" --output text)

API_ENDPOINT="https://${API_ID}.execute-api.ap-northeast-1.amazonaws.com/prod"

echo "API Endpoint: ${API_ENDPOINT}"
```

### テキスト検索

```bash
curl -X GET "${API_ENDPOINT}/search?q=契約書&searchMode=and&size=10" | jq '.'
```

### ハイブリッド検索

```bash
# 1024次元のダミーベクトル生成
VECTOR=$(python3 -c "import json; print(json.dumps([0.1] * 1024))")

curl -X POST "${API_ENDPOINT}/search" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"契約書\", \"searchMode\": \"or\", \"imageEmbedding\": ${VECTOR}, \"size\": 20}" | jq '.'
```

---

## 📊 モニタリング

### CloudWatchログ確認

```bash
# 最新のログストリームを表示
aws logs tail /aws/lambda/cis-search-api --follow --region ap-northeast-1
```

### Lambda関数メトリクス確認

```bash
# 過去1時間の呼び出し統計
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=cis-search-api \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum \
  --region ap-northeast-1
```

---

## 🐛 トラブルシューティング

### 1. Lambda関数が見つからない

**エラー**:

```
An error occurred (ResourceNotFoundException) when calling the UpdateFunctionCode operation:
Function not found: arn:aws:lambda:ap-northeast-1:123456789012:function:cis-search-api
```

**解決策**:

```bash
# Lambda関数を手動作成
aws lambda create-function \
  --function-name cis-search-api \
  --runtime nodejs18.x \
  --role arn:aws:iam::123456789012:role/lambda-execution-role \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --region ap-northeast-1
```

### 2. OpenSearchインデックスが見つからない

**エラー**:

```json
{
  "error": "Index 'cis-files' not found",
  "type": "OpenSearchIndexNotFoundError"
}
```

**解決策**:

```bash
# インデックスの存在確認
curl -XGET "https://vpc-cis-filesearch-opensearch-xxxxx.ap-northeast-1.es.amazonaws.com/_cat/indices?v" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"

# インデックスが存在しない場合は作成
# (統合インデックス戦略ドキュメント参照)
```

### 3. 画像ベクトルの次元が不正

**エラー**:

```json
{
  "error": "Invalid image embedding dimension: expected 1024, got 512",
  "type": "OpenSearchError"
}
```

**解決策**:

画像埋め込みベクトルは必ず1024次元である必要があります。Bedrock Titan Embeddings Imageモデルを使用してベクトル生成してください。

### 4. タイムアウトエラー

**エラー**:

```
Task timed out after 30.00 seconds
```

**解決策**:

```bash
# Lambda関数のタイムアウトを延長
aws lambda update-function-configuration \
  --function-name cis-search-api \
  --timeout 60 \
  --region ap-northeast-1
```

---

## 🔧 設定のカスタマイズ

### 環境変数

デプロイスクリプト実行時に以下の環境変数を設定できます：

```bash
# Lambda関数名
export LAMBDA_FUNCTION_NAME="my-search-api"

# リージョン
export AWS_REGION="us-west-2"

# タイムアウト（秒）
export LAMBDA_TIMEOUT="60"

# メモリサイズ（MB）
export LAMBDA_MEMORY_SIZE="1024"

# デプロイ実行
bash deploy-hybrid-search.sh
```

### スコアの重み付け変更

テキストスコアと画像スコアの重み付けを変更する場合：

`src/services/opensearch.hybrid.service.ts` の以下の部分を編集：

```typescript
// デフォルト: テキスト60% + 画像40%
const textWeight = 0.6;
const imageWeight = 0.4;

// 例: テキスト重視（80% + 20%）
const textWeight = 0.8;
const imageWeight = 0.2;

// 例: 画像重視（30% + 70%）
const textWeight = 0.3;
const imageWeight = 0.7;
```

---

## 📚 関連ドキュメント

- [ハイブリッド検索統合戦略](./HYBRID_INDEX_INTEGRATION_STRATEGY.md) - 詳細な戦略説明
- [OpenSearch統合インデックス戦略](../../OPENSEARCH_UNIFIED_INDEX_STRATEGY.md) - 将来の統合パス
- [API仕様](../../docs/api-specification.md) - REST API仕様
- [アーキテクチャ](../../docs/architecture.md) - システムアーキテクチャ

---

## ✅ チェックリスト

デプロイ前：

- [ ] AWS CLIがインストールされている
- [ ] Node.js 18.x以上がインストールされている
- [ ] IAMクレデンシャルが設定されている
- [ ] Lambda関数が作成されている
- [ ] 両方のOpenSearchインデックスが存在する
- [ ] Lambda実行ロールに必要な権限がある

デプロイ後：

- [ ] デプロイスクリプトが正常に完了した
- [ ] ヘルスチェックがパスした
- [ ] テキスト検索が動作する
- [ ] 画像検索が動作する
- [ ] ハイブリッド検索が動作する
- [ ] CloudWatchログが正常に記録されている

---

## 🆘 サポート

問題が発生した場合：

1. **CloudWatchログを確認**
   ```bash
   aws logs tail /aws/lambda/cis-search-api --follow --region ap-northeast-1
   ```

2. **インデックスの状態を確認**
   ```bash
   bash verify-hybrid-search.sh health
   ```

3. **Lambda関数の設定を確認**
   ```bash
   aws lambda get-function-configuration \
     --function-name cis-search-api \
     --region ap-northeast-1
   ```

4. **詳細なドキュメントを参照**
   - [HYBRID_INDEX_INTEGRATION_STRATEGY.md](./HYBRID_INDEX_INTEGRATION_STRATEGY.md)

---

## 🎉 まとめ

このクイックスタートガイドに従うことで、**10分以内**にハイブリッド検索機能をデプロイできます：

1. ✅ `deploy-hybrid-search.sh` を実行
2. ✅ `verify-hybrid-search.sh` で検証
3. ✅ 本番環境で使用開始

既存の10,000件のデータはそのまま利用でき、ダウンタイムもゼロです！
