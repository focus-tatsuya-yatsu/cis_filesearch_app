# Lambda 503エラー - クイックスタートガイド

## 状況

Lambda関数 `cis-search-api-prod` が503エラーを返し、OpenSearchへの接続が失敗している状態です。

## 最速の解決方法（推奨）

### オプション1: ワンコマンド自動修正

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
./scripts/quick-fix-503.sh
```

このスクリプトは以下を自動的に実行します:
- Lambda環境変数の設定
- IAMロールの権限追加
- セキュリティグループの設定
- OpenSearchアクセスポリシーの更新
- 自動テスト実行

**実行時間**: 約2-3分

---

### オプション2: 段階的な手動修正

#### ステップ1: 診断実行

```bash
./scripts/diagnose-503-error.sh
```

現在の設定を診断し、問題箇所を特定します。

#### ステップ2: 環境変数の設定

AWS Console → Lambda → `cis-search-api-prod` → Configuration → Environment variables

以下を追加:
```
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index
AWS_REGION=ap-northeast-1
SKIP_SSL_VERIFY=true
DEBUG_MODE=true
```

#### ステップ3: コードのデプロイ

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
./scripts/deploy-fixed-lambda.sh
```

このスクリプトは:
1. 依存関係のインストール
2. TypeScriptのビルド
3. デプロイパッケージの作成
4. Lambdaへのデプロイ
5. 動作確認テスト

を自動実行します。

#### ステップ4: テスト

```bash
aws lambda invoke \
  --function-name cis-search-api-prod \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test"}}' \
  response.json

cat response.json | jq .
```

---

## 主な変更点

### 1. 拡張版OpenSearchサービス

新しい `opensearch.service.enhanced.ts` ファイルには以下の改善が含まれています:

- **詳細なエラーログ**: 接続エラーの原因を特定しやすくなりました
- **SSL証明書検証のスキップ**: VPCエンドポイントでの接続問題を回避
- **AWS認証情報のデバッグ**: 認証問題の診断が容易に
- **複数の接続方式サポート**: ドメイン名とIPアドレスの両方に対応
- **リトライロジック**: 一時的なネットワーク問題に対応

### 2. 環境変数の追加

| 変数名 | 値 | 説明 |
|--------|-----|------|
| SKIP_SSL_VERIFY | true | SSL証明書検証をスキップ（VPCエンドポイント用） |
| DEBUG_MODE | true | 詳細なデバッグログを出力 |
| OPENSEARCH_DOMAIN_NAME | vpc-cis-...amazonaws.com | IPアドレス使用時のHostヘッダー |

### 3. IAM権限の拡張

以下の権限が追加されました:
- `es:DescribeElasticsearchDomain`
- `es:ESHttpPut`

### 4. 詳細なエラーハンドリング

エラーコード別の診断メッセージ:
- `ENOTFOUND`: DNS解決の失敗
- `ECONNREFUSED`: 接続拒否（セキュリティグループ）
- `ETIMEDOUT`: タイムアウト（VPC設定）
- `403`: アクセス拒否（IAM/アクセスポリシー）
- `503`: サービス利用不可（クラスター状態）

---

## トラブルシューティング

### 問題: それでも503エラーが発生する

1. **OpenSearchクラスターの状態確認**
   ```bash
   aws opensearch describe-domain --domain-name cis-filesearch-opensearch
   ```

   `Processing: false` であることを確認

2. **CloudWatchログの確認**
   ```bash
   aws logs tail /aws/lambda/cis-search-api-prod --follow
   ```

3. **VPC接続の確認**
   - Lambda が Private Subnet に配置されているか
   - Route Table に NAT Gateway へのルートがあるか
   - NACL で 443 ポートが許可されているか

### 問題: "Response Error" が継続する

これは以下のいずれかが原因です:

1. **OpenSearch FGAC (Fine-Grained Access Control)**

   OpenSearchコンソール → Security → Internal user database

   Lambda IAMロールを `all_access` ロールにマッピング:
   ```json
   {
     "backend_roles": ["arn:aws:iam::ACCOUNT_ID:role/cis-lambda-search-api-role-prod"]
   }
   ```

2. **アクセスポリシーの問題**

   OpenSearchコンソール → Access policies

   以下のポリシーが含まれているか確認:
   ```json
   {
     "Effect": "Allow",
     "Principal": {
       "AWS": "arn:aws:iam::ACCOUNT_ID:role/cis-lambda-search-api-role-prod"
     },
     "Action": "es:*",
     "Resource": "arn:aws:es:REGION:ACCOUNT_ID:domain/cis-filesearch-opensearch/*"
   }
   ```

### 問題: タイムアウトが発生する

Lambda関数のタイムアウトを延長:

```bash
aws lambda update-function-configuration \
  --function-name cis-search-api-prod \
  --timeout 60
```

---

## 検証コマンド

### 1. Lambda直接テスト

```bash
aws lambda invoke \
  --function-name cis-search-api-prod \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test","limit":"5"}}' \
  response.json && cat response.json | jq .
```

### 2. API Gateway経由テスト

```bash
API_URL="https://YOUR_API_GATEWAY_ID.execute-api.ap-northeast-1.amazonaws.com/prod/search"

curl -X GET "${API_URL}?q=test&limit=5" \
  -H "Content-Type: application/json" | jq .
```

### 3. CloudWatchログ確認

```bash
# リアルタイム監視
aws logs tail /aws/lambda/cis-search-api-prod --follow

# 最新5分間のエラー
aws logs filter-log-events \
  --log-group-name /aws/lambda/cis-search-api-prod \
  --filter-pattern "ERROR" \
  --start-time $(($(date +%s) - 300))000
```

### 4. OpenSearch接続テスト（EC2から）

VPC内のEC2インスタンスから:

```bash
# AWS CLI v2必須
aws opensearch describe-domain \
  --domain-name cis-filesearch-opensearch \
  --query 'DomainStatus.Endpoints.vpc' \
  --output text

# curlでテスト
curl -XGET "https://OPENSEARCH_ENDPOINT/_cluster/health?pretty" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"
```

---

## 成功の確認

以下のレスポンスが返れば成功です:

```json
{
  "statusCode": 200,
  "body": {
    "results": [...],
    "pagination": {
      "total": 1234,
      "page": 1,
      "limit": 20,
      "totalPages": 62
    },
    "query": {
      "q": "test",
      "searchMode": "or"
    },
    "took": 45
  }
}
```

---

## ファイル構成

```
backend/lambda-search-api/
├── src/
│   ├── index.ts                              # Lambdaハンドラー（拡張版使用に更新済み）
│   └── services/
│       ├── opensearch.service.ts             # 元のサービス
│       └── opensearch.service.enhanced.ts    # 拡張版（503エラー対策）
├── scripts/
│   ├── diagnose-503-error.sh                 # 診断スクリプト
│   ├── quick-fix-503.sh                      # 自動修正スクリプト
│   └── deploy-fixed-lambda.sh                # デプロイスクリプト
├── EMERGENCY_FIX_503.md                      # 詳細な修正ガイド
└── QUICKSTART_503_FIX.md                     # このファイル
```

---

## 次のステップ

1. ✅ クイック修正スクリプトを実行
2. ✅ テストして動作確認
3. ✅ CloudWatchログで詳細確認
4. ⬜ 本番環境でエンドツーエンドテスト
5. ⬜ モニタリングアラートの設定
6. ⬜ ドキュメントの更新

---

## サポート

問題が解決しない場合は、以下の情報を添えて報告してください:

1. 診断スクリプトの出力
   ```bash
   ./scripts/diagnose-503-error.sh > diagnosis-report.txt
   ```

2. CloudWatchログの直近10件
   ```bash
   aws logs filter-log-events \
     --log-group-name /aws/lambda/cis-search-api-prod \
     --limit 10 > cloudwatch-logs.txt
   ```

3. Lambda設定
   ```bash
   aws lambda get-function-configuration \
     --function-name cis-search-api-prod > lambda-config.json
   ```

4. OpenSearchドメイン状態
   ```bash
   aws opensearch describe-domain \
     --domain-name cis-filesearch-opensearch > opensearch-status.json
   ```
