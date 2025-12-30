# OpenSearch Fine-Grained Access Control (FGAC) 設定ガイド

## 概要

Lambda関数 `cis-search-api-prod` がOpenSearchに接続できるようにするため、OpenSearchのFine-Grained Access Control (FGAC) でIAMロールマッピングを設定します。

## 前提条件

- OpenSearchドメイン: `cis-filesearch-opensearch`
- Lambda IAMロール: `arn:aws:iam::770923989980:role/cis-lambda-search-api-role`
- OpenSearchマスターユーザーの認証情報

## 設定手順

### 方法1: OpenSearch Dashboards (推奨)

#### ステップ1: OpenSearch Dashboardsにアクセス

1. **VPC内からアクセス** (EC2 bastion host経由、または一時的にパブリックアクセスを有効化)

   ```bash
   # EC2インスタンスからアクセスする場合
   ssh -L 9200:vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com:443 ec2-user@<BASTION_IP>

   # ブラウザで開く
   https://localhost:9200/_dashboards/
   ```

2. **マスターユーザーでログイン**
   - Username: (マスターユーザー名)
   - Password: (マスターユーザーパスワード)

#### ステップ2: IAMロールマッピング設定

1. **Dashboards左側メニュー → Security → Roles** に移動

2. **`all_access` ロールを選択** (または読み取り専用の場合は `readall`)

3. **「Mapped users」タブをクリック**

4. **「Map users」ボタンをクリック**

5. **Backend rolesに以下を追加**:
   ```
   arn:aws:iam::770923989980:role/cis-lambda-search-api-role
   ```

6. **「Map」ボタンをクリックして保存**

#### ステップ3: カスタムロール作成 (オプション - 最小権限の原則)

より細かい権限制御が必要な場合:

1. **Security → Roles → Create role**

2. **ロール設定**:
   ```json
   {
     "cluster_permissions": [
       "cluster:monitor/health",
       "cluster:monitor/state"
     ],
     "index_permissions": [
       {
         "index_patterns": [
           "file-index"
         ],
         "allowed_actions": [
           "indices:data/read/search",
           "indices:data/read/get",
           "indices:data/read/mget",
           "indices:data/read/msearch",
           "indices:monitor/stats"
         ]
       }
     ]
   }
   ```

3. **Role name**: `lambda_search_readonly`

4. **保存後、Role Mappingsで以下を設定**:
   - Role: `lambda_search_readonly`
   - Backend role: `arn:aws:iam::770923989980:role/cis-lambda-search-api-role`

### 方法2: AWS CLI + OpenSearch REST API

#### 前提条件

- awscurl または AWS署名付きリクエストツールが必要
- マスターユーザー認証情報

#### コマンド例

```bash
# awscurl (pip install awscurl)
awscurl --service es \
  --region ap-northeast-1 \
  -X PATCH \
  "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_opendistro/_security/api/rolesmapping/all_access" \
  -H "Content-Type: application/json" \
  -d '{
    "backend_roles": [
      "arn:aws:iam::770923989980:role/cis-lambda-search-api-role"
    ]
  }'
```

### 方法3: Terraform (インフラストラクチャコード)

Terraform OpenSearch Providerを使用:

```hcl
# terraform/opensearch_fgac.tf

terraform {
  required_providers {
    opensearch = {
      source  = "opensearch-project/opensearch"
      version = "~> 2.0"
    }
  }
}

provider "opensearch" {
  url         = "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
  aws_region  = "ap-northeast-1"

  # Use AWS credentials
  aws_assume_role_arn = "arn:aws:iam::770923989980:role/opensearch-admin-role"
}

# Role mapping for Lambda function
resource "opensearch_role_mapping" "lambda_search_api" {
  role_name = "all_access"

  backend_roles = [
    "arn:aws:iam::770923989980:role/cis-lambda-search-api-role"
  ]
}
```

## 設定確認

### Lambda関数でテスト

```bash
aws lambda invoke \
  --function-name cis-search-api-prod \
  --region ap-northeast-1 \
  --cli-binary-format raw-in-base64-out \
  --payload '{"httpMethod":"GET","path":"/search","queryStringParameters":{"q":"test","searchMode":"or","page":"1","limit":"10"},"headers":{"Content-Type":"application/json"},"requestContext":{"requestId":"test-fgac","http":{"method":"GET","path":"/search"}}}' \
  /tmp/lambda-test-response.json

# 結果確認
cat /tmp/lambda-test-response.json | jq .
```

### 期待される成功レスポンス

```json
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  },
  "body": "{\"results\":[],\"pagination\":{\"total\":0,\"page\":1,\"limit\":10,\"totalPages\":0},\"query\":{\"q\":\"test\",\"searchMode\":\"or\"},\"took\":10}"
}
```

### CloudWatch Logsで確認

```bash
aws logs tail /aws/lambda/cis-search-api-prod \
  --region ap-northeast-1 \
  --since 5m \
  --format short \
  --filter-pattern "OpenSearch"
```

成功時のログ例:
```
2025-12-17T05:30:00 INFO Initializing OpenSearch client {"endpoint":"https://10.0.10.145","region":"ap-northeast-1"}
2025-12-17T05:30:00 INFO OpenSearch client initialized successfully
2025-12-17T05:30:00 INFO Executing search query {"query":"test","searchMode":"or"}
2025-12-17T05:30:00 INFO Search query completed {"took":10,"hits":0}
```

## トラブルシューティング

### エラー: Unauthorized (403)

**症状**:
```json
{
  "statusCode": 503,
  "body": "{\"error\":{\"code\":\"OPENSEARCH_UNAVAILABLE\",\"message\":\"Failed to connect to OpenSearch\"}}"
}
```

**ログ**:
```
Failed to initialize OpenSearch client {"error":"Response Error"}
```

**原因**: IAMロールマッピングが正しく設定されていない

**解決方法**:
1. OpenSearch Dashboards → Security → Role Mappings を確認
2. `cis-lambda-search-api-role` が正しいロールにマッピングされているか確認
3. ロール名のスペルミスがないか確認

### エラー: Connection timeout

**症状**: Lambda関数がタイムアウト

**原因**:
- セキュリティグループの設定ミス
- VPC設定の問題

**解決方法**:
```bash
# セキュリティグループ確認
aws ec2 describe-security-groups --group-ids sg-06ee622d64e67f12f sg-0c482a057b356a0c3

# Lambda VPC設定確認
aws lambda get-function-configuration --function-name cis-search-api-prod --query 'VpcConfig'
```

### エラー: DNS resolution failed

**症状**: `getaddrinfo ENOTFOUND`

**解決方法**: 既にIPアドレス直接指定で回避済み
```bash
# 環境変数確認
aws lambda get-function-configuration \
  --function-name cis-search-api-prod \
  --query 'Environment.Variables' \
  --output json
```

期待値:
```json
{
  "OPENSEARCH_ENDPOINT": "https://10.0.10.145",
  "OPENSEARCH_USE_IP": "true"
}
```

## セキュリティベストプラクティス

### 最小権限の原則

カスタムロールを作成し、必要最小限の権限のみを付与:

```json
{
  "cluster_permissions": [
    "cluster:monitor/health"
  ],
  "index_permissions": [
    {
      "index_patterns": ["file-index"],
      "allowed_actions": [
        "indices:data/read/search",
        "indices:data/read/get"
      ]
    }
  ]
}
```

### 監査ログの有効化

OpenSearch設定で監査ログを有効化:

```bash
aws opensearch update-domain-config \
  --domain-name cis-filesearch-opensearch \
  --advanced-security-options '{
    "Enabled": true,
    "InternalUserDatabaseEnabled": false,
    "AnonymousAuthEnabled": false
  }' \
  --log-publishing-options '{
    "AUDIT_LOGS": {
      "CloudWatchLogsLogGroupArn": "arn:aws:logs:ap-northeast-1:770923989980:log-group:/aws/opensearch/cis-filesearch-opensearch/audit-logs",
      "Enabled": true
    }
  }'
```

### ネットワークセキュリティ

- VPCエンドポイントのみ使用（パブリックアクセス無効）
- セキュリティグループで特定のソースのみ許可
- TLS 1.2以上を使用

## 参考資料

- [OpenSearch Fine-Grained Access Control](https://opensearch.org/docs/latest/security/access-control/)
- [AWS IAM Authentication for OpenSearch](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/fgac.html)
- [OpenSearch Role Mapping API](https://opensearch.org/docs/latest/security/access-control/api/#role-mapping)

## チェックリスト

設定完了後、以下を確認:

- [ ] OpenSearch Dashboardsにアクセス可能
- [ ] IAMロールマッピングが正しく設定されている
- [ ] Lambda関数がOpenSearchに接続できる
- [ ] 検索クエリが正常に実行される
- [ ] CloudWatch Logsでエラーがないことを確認
- [ ] セキュリティグループ設定が適切
- [ ] 最小権限の原則が適用されている
- [ ] 監査ログが有効化されている (本番環境)

## 次のステップ

FGAC設定完了後:

1. **API Gateway統合**
   - `/backend/lambda-search-api/terraform/lambda.tf` でAPI Gatewayリソースをデプロイ
   - エンドポイント: `https://<api-id>.execute-api.ap-northeast-1.amazonaws.com/prod/search`

2. **フロントエンド統合**
   - Next.jsアプリケーションから API Gateway経由で検索APIを呼び出し
   - `/frontend/src/lib/opensearch.ts` を更新

3. **認証追加 (オプション)**
   - Cognito User Poolを作成
   - API GatewayにCognitoオーソライザーを追加
   - terraform.tfvarsで `enable_authentication = true` に設定
