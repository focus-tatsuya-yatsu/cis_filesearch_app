# Lambda 503エラー 緊急修正ガイド

## 問題概要
- **症状**: Lambda関数が503 Service Unavailable エラーを返す
- **原因**: OpenSearchへの接続失敗（"Response Error"）
- **影響**: 検索API全体が利用不可

## 即座の解決手順

### ステップ1: Lambda環境変数の更新

AWS Consoleで以下の環境変数を追加:

```bash
# 必須
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index
AWS_REGION=ap-northeast-1

# SSL証明書検証をスキップ（VPCエンドポイントの場合に必要）
SKIP_SSL_VERIFY=true

# デバッグモード（詳細ログ出力）
DEBUG_MODE=true

# ドメイン名（IPアドレス使用時のみ）
OPENSEARCH_DOMAIN_NAME=vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
```

### ステップ2: OpenSearchアクセスポリシーの確認

OpenSearchコンソールで、アクセスポリシーに以下が含まれているか確認:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::YOUR_ACCOUNT_ID:role/cis-lambda-search-api-role-prod"
      },
      "Action": [
        "es:ESHttpGet",
        "es:ESHttpPost",
        "es:ESHttpHead"
      ],
      "Resource": "arn:aws:es:ap-northeast-1:YOUR_ACCOUNT_ID:domain/cis-filesearch-opensearch/*"
    }
  ]
}
```

### ステップ3: Lambda IAMロールの権限確認

IAMコンソールで `cis-lambda-search-api-role-prod` に以下のポリシーがアタッチされているか確認:

1. **AWSLambdaVPCAccessExecutionRole** (管理ポリシー)
2. **OpenSearch Access** (インラインポリシー):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OpenSearchAccess",
      "Effect": "Allow",
      "Action": [
        "es:ESHttpGet",
        "es:ESHttpPost",
        "es:ESHttpHead",
        "es:DescribeElasticsearchDomain",
        "es:ESHttpPut"
      ],
      "Resource": "arn:aws:es:ap-northeast-1:*:domain/*"
    }
  ]
}
```

### ステップ4: セキュリティグループの確認

Lambda Security Groupからの443ポートでのアウトバウンド接続が、OpenSearch Security Groupに許可されているか確認:

```bash
aws ec2 describe-security-groups \
  --group-ids sg-LAMBDA_SG_ID \
  --query 'SecurityGroups[0].IpPermissionsEgress'

aws ec2 describe-security-groups \
  --group-ids sg-OPENSEARCH_SG_ID \
  --query 'SecurityGroups[0].IpPermissions'
```

### ステップ5: コードの更新とデプロイ

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api

# 拡張版サービスを使用するようにindex.tsを更新
# (次のステップで提供するパッチを適用)

# 依存関係のインストール
npm install

# ビルド
npm run build

# デプロイパッケージの作成
npm run package

# Lambdaにデプロイ
aws lambda update-function-code \
  --function-name cis-search-api-prod \
  --zip-file fileb://lambda-deployment.zip
```

### ステップ6: テスト実行

```bash
# Lambda関数を直接テスト
aws lambda invoke \
  --function-name cis-search-api-prod \
  --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test"}}' \
  response.json

cat response.json | jq .
```

### ステップ7: CloudWatchログの確認

```bash
# 最新のログストリームを確認
aws logs tail /aws/lambda/cis-search-api-prod \
  --follow \
  --format short
```

## 根本原因の可能性

### 1. SSL証明書の不一致
- **問題**: VPCエンドポイントのSSL証明書がドメイン名と一致しない
- **解決**: `SKIP_SSL_VERIFY=true` で証明書検証をスキップ
- **注意**: 本番環境では証明書を正しく設定するのが望ましい

### 2. OpenSearch FGACの設定不足
- **問題**: Fine-Grained Access Control が有効で、IAMロールがマッピングされていない
- **解決**: OpenSearchのSecurity設定で、LambdaのIAMロールを `all_access` ロールにマッピング

### 3. ネットワーク接続の問題
- **問題**: Lambda → OpenSearch間のネットワーク経路に問題
- **解決**:
  - VPC内の Private Subnetにデプロイされているか確認
  - Security Groupで443ポートが開いているか確認
  - Route TableにNAT Gatewayへのルートがあるか確認

### 4. IAM権限の不足
- **問題**: LambdaのIAMロールにOpenSearchへのアクセス権限がない
- **解決**: 上記ステップ3のポリシーを追加

## 診断コマンド集

```bash
# OpenSearchドメインの状態確認
aws opensearch describe-domain \
  --domain-name cis-filesearch-opensearch

# Lambdaの設定確認
aws lambda get-function-configuration \
  --function-name cis-search-api-prod

# Lambda実行ログの確認（最新10件）
aws logs filter-log-events \
  --log-group-name /aws/lambda/cis-search-api-prod \
  --limit 10 \
  --start-time $(date -u -d '5 minutes ago' +%s)000

# VPCエンドポイントの確認
aws ec2 describe-vpc-endpoints \
  --filters "Name=vpc-id,Values=vpc-YOUR_VPC_ID"
```

## 代替接続方式: IPアドレス直接接続

OpenSearchのVPCエンドポイントのプライベートIPを使用する場合:

```bash
# OpenSearchのENIを取得
aws ec2 describe-network-interfaces \
  --filters "Name=description,Values=*opensearch*" \
  --query 'NetworkInterfaces[0].PrivateIpAddress'

# Lambda環境変数を更新
OPENSEARCH_ENDPOINT=https://10.0.10.145
OPENSEARCH_DOMAIN_NAME=vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
```

## トラブルシューティング

### 503エラーが継続する場合

1. **OpenSearchクラスターの状態確認**
   ```bash
   curl -XGET "https://YOUR_OPENSEARCH_ENDPOINT/_cluster/health?pretty" \
     --aws-sigv4 "aws:amz:ap-northeast-1:es" \
     --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"
   ```

2. **Lambdaから直接テスト**
   - VPC内のEC2インスタンスからOpenSearchに接続できるか確認
   - Lambda実行ロールを一時的に引き受けて、手動で接続テスト

3. **タイムアウトの確認**
   - Lambda関数のタイムアウトを60秒に延長
   - OpenSearch接続のタイムアウト設定を確認

### CloudWatchログにエラーが表示されない場合

```bash
# Lambda実行ロールにCloudWatch Logsの権限があるか確認
aws iam get-role-policy \
  --role-name cis-lambda-search-api-role-prod \
  --policy-name vpc-access

# ログストリームが作成されているか確認
aws logs describe-log-streams \
  --log-group-name /aws/lambda/cis-search-api-prod \
  --order-by LastEventTime \
  --descending \
  --max-items 5
```

## 成功確認

以下のコマンドで正常に結果が返れば成功:

```bash
curl -X GET "https://YOUR_API_GATEWAY_URL/search?q=test" \
  -H "Content-Type: application/json" | jq .
```

期待されるレスポンス:
```json
{
  "results": [...],
  "pagination": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "totalPages": 5
  },
  "took": 45
}
```

## 今後の恒久対策

1. **証明書の適切な設定**: VPCエンドポイントに対してカスタムドメインとSSL証明書を設定
2. **OpenSearch Service Linked Role**: IAM Service-Linked Roleを使用
3. **モニタリングの強化**: CloudWatch Alarmsで503エラーを検知
4. **リトライ戦略**: Lambdaにエクスポネンシャルバックオフのリトライロジックを実装

## 連絡先

問題が解決しない場合は、以下の情報を添えて報告:
- Lambda実行ID (CloudWatchログから)
- エラーメッセージ全文
- OpenSearchクラスターの状態
- 実施した手順と結果
