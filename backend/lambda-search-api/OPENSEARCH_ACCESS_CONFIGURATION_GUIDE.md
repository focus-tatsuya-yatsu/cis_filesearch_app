# OpenSearch Fine-Grained Access Control Configuration Guide

## Overview

このガイドでは、Lambda関数がOpenSearchにアクセスできるようにするため、Fine-Grained Access Control (FGAC)を設定する手順を説明します。

## 問題の本質

Lambda関数 `cis-search-api-prod` が OpenSearch ドメイン `cis-filesearch-opensearch` に接続する際、以下の2つの問題が発生しています:

1. **DNS解決エラー** (断続的): `getaddrinfo ENOTFOUND`
2. **権限エラー** (接続成功時): `security_exception: no permissions for [indices:data/read/search]`

DNS解決は断続的に成功していますが、権限エラーが主な問題です。

## 前提条件

- OpenSearchドメインのマスターユーザー認証情報
- OpenSearch Dashboardsへのアクセス権限
- Lambda IAMロールのARN: `arn:aws:iam::770923989980:role/cis-lambda-search-api-role`

## Solution 1: OpenSearch Dashboards経由での設定（推奨）

### Step 1: OpenSearch Dashboardsにアクセス

```bash
# OpenSearch Dashboards URL
https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_dashboards
```

**注意**: このURLはVPC内からのみアクセス可能です。以下のいずれかの方法でアクセスしてください:

- EC2インスタンスからブラウザでアクセス
- VPN経由でVPCに接続
- AWS Systems Manager Session Managerでポートフォワーディング

### Step 2: マスターユーザーでログイン

- ユーザー名: `<マスターユーザー名>`
- パスワード: `<マスターパスワード>`

### Step 3: ロールを作成または編集

1. 左サイドバーから **Security** → **Roles** を選択
2. **Create role** をクリック（または既存のロールを編集）

#### ロール設定:

**ロール名**: `lambda_search_role`

**Cluster permissions**:
```json
[
  "cluster_composite_ops_ro",
  "cluster:monitor/health"
]
```

**Index permissions**:

| Index | Index permissions | Document level security | Field level security |
|-------|-------------------|-------------------------|----------------------|
| `file-index` | `indices_all` または `indices:data/read/*`, `indices:data/write/*` | なし | なし |

詳細な権限:
```json
{
  "index_patterns": [
    "file-index"
  ],
  "dls": "",
  "fls": [],
  "masked_fields": [],
  "allowed_actions": [
    "indices:data/read/search",
    "indices:data/read/msearch",
    "indices:data/read/get",
    "indices:data/read/mget",
    "indices:data/write/index",
    "indices:data/write/update",
    "indices:data/write/bulk"
  ]
}
```

### Step 4: ロールマッピングを作成

1. **Security** → **Role Mappings** を選択
2. `lambda_search_role` を探して **Manage mapping** をクリック

#### マッピング設定:

**Backend roles**:
```
arn:aws:iam::770923989980:role/cis-lambda-search-api-role
```

**注意**: Backend rolesはLambda関数が実行時に使用するIAMロールのARNです。

### Step 5: 保存して確認

1. **Submit** をクリックして設定を保存
2. Role Mappingsページで設定が反映されていることを確認

## Solution 2: AWS CLI経由での設定（高度）

### 前提条件

OpenSearch DashboardsにアクセスできないAPI経由で設定する場合、マスターユーザー認証情報を使用してREST APIを呼び出します。

### ロールの作成

```bash
OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
MASTER_USER="<マスターユーザー名>"
MASTER_PASS="<マスターパスワード>"

# ロールを作成
curl -X PUT "${OPENSEARCH_ENDPOINT}/_plugins/_security/api/roles/lambda_search_role" \
  -H 'Content-Type: application/json' \
  -u "${MASTER_USER}:${MASTER_PASS}" \
  -d '{
    "cluster_permissions": [
      "cluster_composite_ops_ro",
      "cluster:monitor/health"
    ],
    "index_permissions": [{
      "index_patterns": ["file-index"],
      "allowed_actions": [
        "indices:data/read/search",
        "indices:data/read/msearch",
        "indices:data/read/get",
        "indices:data/read/mget",
        "indices:data/write/index",
        "indices:data/write/update",
        "indices:data/write/bulk"
      ]
    }]
  }'
```

### ロールマッピングの作成

```bash
# ロールマッピングを作成
curl -X PUT "${OPENSEARCH_ENDPOINT}/_plugins/_security/api/rolesmapping/lambda_search_role" \
  -H 'Content-Type: application/json' \
  -u "${MASTER_USER}:${MASTER_PASS}" \
  -d '{
    "backend_roles": [
      "arn:aws:iam::770923989980:role/cis-lambda-search-api-role"
    ]
  }'
```

### 設定の確認

```bash
# ロールマッピングを確認
curl -X GET "${OPENSEARCH_ENDPOINT}/_plugins/_security/api/rolesmapping/lambda_search_role" \
  -u "${MASTER_USER}:${MASTER_PASS}" | jq '.'
```

## Solution 3: IAMアクセスポリシーのみを使用（FGAC無効化）

**警告**: この方法はセキュリティレベルが低下するため、本番環境では推奨されません。

### OpenSearch ドメインの設定を更新

```bash
aws opensearch update-domain-config \
  --domain-name cis-filesearch-opensearch \
  --region ap-northeast-1 \
  --advanced-security-options '{
    "Enabled": true,
    "AnonymousAuthEnabled": true,
    "MasterUserOptions": {
      "MasterUserARN": "arn:aws:iam::770923989980:role/cis-lambda-search-api-role"
    }
  }'
```

## 検証手順

### 1. Lambda関数のテスト

```bash
curl -X GET "https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search?q=test&limit=5"
```

**期待される結果**:
```json
{
  "success": true,
  "data": {
    "results": [...],
    "total": <number>,
    "took": <number>
  }
}
```

### 2. CloudWatch Logsの確認

```bash
aws logs tail /aws/lambda/cis-search-api-prod --region ap-northeast-1 --follow
```

**成功時のログ**:
```
INFO: OpenSearch client initialized successfully
INFO: Search query completed
```

**失敗時のログ（権限エラー）**:
```
ERROR: security_exception: no permissions for [indices:data/read/search]
```

**失敗時のログ（DNS エラー）**:
```
ERROR: getaddrinfo ENOTFOUND vpc-cis-filesearch-opensearch...
```

### 3. 直接OpenSearchクエリのテスト

```bash
# マスターユーザーで検索クエリをテスト
curl -X GET "${OPENSEARCH_ENDPOINT}/file-index/_search?pretty" \
  -H 'Content-Type: application/json' \
  -u "${MASTER_USER}:${MASTER_PASS}" \
  -d '{
    "query": {
      "match": {
        "file_name": "test"
      }
    },
    "size": 5
  }'
```

## トラブルシューティング

### DNS解決エラーが継続する場合

1. **Lambda VPCリセット** (既に実施済み):
   ```bash
   ./scripts/reset-lambda-vpc.sh
   ```

2. **Route 53プライベートホストゾーン確認** (既に作成済み):
   ```bash
   aws route53 list-resource-record-sets \
     --hosted-zone-id Z00961932K6CIIM22B6VP \
     --query 'ResourceRecordSets[?Type==`A`]'
   ```

3. **OpenSearch ENIのステータス確認**:
   ```bash
   aws ec2 describe-network-interfaces \
     --filters "Name=description,Values=ES cis-filesearch-opensearch" \
     --region ap-northeast-1 \
     --query 'NetworkInterfaces[?Status==`in-use`]'
   ```

### 権限エラーが継続する場合

1. **Lambda IAMロールの確認**:
   ```bash
   aws iam get-role --role-name cis-lambda-search-api-role \
     --query 'Role.Arn'
   ```

2. **OpenSearch アクセスポリシーの確認**:
   ```bash
   aws opensearch describe-domain \
     --domain-name cis-filesearch-opensearch \
     --region ap-northeast-1 \
     --query 'DomainStatus.AccessPolicies' | jq -r '.' | jq '.'
   ```

3. **ロールマッピングの再確認**:
   - OpenSearch Dashboardsで Security → Role Mappings を確認
   - `lambda_search_role` に `cis-lambda-search-api-role` が正しくマッピングされているか確認

## 参考情報

### Lambda IAMロールに必要な権限

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "es:ESHttpGet",
        "es:ESHttpPost",
        "es:ESHttpPut",
        "es:ESHttpDelete",
        "es:ESHttpHead"
      ],
      "Resource": "arn:aws:es:ap-northeast-1:770923989980:domain/cis-filesearch-opensearch/*"
    }
  ]
}
```

### OpenSearch Fine-Grained Access Controlのドキュメント

- [Fine-Grained Access Control in Amazon OpenSearch Service](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/fgac.html)
- [Identity and Access Management for Amazon OpenSearch Service](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/ac.html)

### 関連スクリプト

- `/scripts/configure-opensearch-access.sh` - FGAC設定ガイド
- `/scripts/verify-vpc-endpoint.sh` - VPCエンドポイント検証
- `/scripts/reset-lambda-vpc.sh` - Lambda VPCリセット

## まとめ

OpenSearchへのアクセス設定は以下の手順で完了します:

1. ✅ OpenSearch Dashboardsにアクセス
2. ✅ ロール `lambda_search_role` を作成
3. ✅ Lambda IAMロールをロールマッピングに追加
4. ✅ API Gatewayエンドポイントでテスト

DNS解決の問題は断続的ですが、FGAC設定が完了すれば、安定した接続が期待できます。
