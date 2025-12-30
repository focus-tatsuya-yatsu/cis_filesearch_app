# OpenSearch Fine-Grained Access Control (FGAC) 設定ガイド

## 現在の状況

Lambda Search API (`cis-search-api-prod`) は正常にデプロイされ、OpenSearchに接続できていますが、**Fine-Grained Access Control (FGAC)** により検索権限がブロックされています。

### エラー内容

```json
{
  "success": false,
  "error": {
    "code": "OPENSEARCH_UNAVAILABLE",
    "message": "Search operation failed: security_exception: [security_exception] Reason: no permissions for [indices:data/read/search] and User [name=arn:aws:iam::770923989980:role/cis-lambda-search-api-role, backend_roles=[arn:aws:iam::770923989980:role/cis-lambda-search-api-role], requestedTenant=null]"
  }
}
```

## 問題の原因

1. OpenSearchのFine-Grained Access Control (FGAC)が有効
2. Lambda IAMロール (`cis-lambda-search-api-role`) がFGACのロールマッピングに含まれていない
3. IAMアクセスポリシーには含まれているが、FGAC層で権限がブロックされている

## 解決方法

### 方法1: EC2インスタンスから設定（推奨）

VPC内にEC2インスタンス（bastion host）がある場合、そこからPythonスクリプトを実行してFGACを設定できます。

#### ステップ1: EC2インスタンスに接続

```bash
# EC2インスタンスにSSH接続
ssh -i your-key.pem ec2-user@<bastion-host-ip>

# または AWS Systems Manager Session Manager
aws ssm start-session --target <instance-id>
```

#### ステップ2: 必要なパッケージをインストール

```bash
pip3 install boto3 requests requests-aws4auth
```

#### ステップ3: FGACスクリプトを作成

```python
# configure_opensearch_fgac.py
import boto3
import requests
from requests_aws4auth import AWS4Auth
import json

# Configuration
region = 'ap-northeast-1'
service = 'es'
host = 'https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com'
lambda_role = 'arn:aws:iam::770923989980:role/cis-lambda-search-api-role'

# Get AWS credentials
session = boto3.Session()
credentials = session.get_credentials()
awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    region,
    service,
    session_token=credentials.token
)

# Get current all_access role mapping
path = '/_plugins/_security/api/rolesmapping/all_access'
url = host + path

print("Fetching current role mapping...")
response = requests.get(url, auth=awsauth)
print(f"Status: {response.status_code}")

if response.status_code == 200:
    current_mapping = response.json()
    print(f"Current mapping: {json.dumps(current_mapping, indent=2)}")

    # Add Lambda role to backend_roles
    all_access_config = current_mapping.get('all_access', {})
    backend_roles = all_access_config.get('backend_roles', [])

    if lambda_role not in backend_roles:
        backend_roles.append(lambda_role)
        print(f"\nAdding Lambda role: {lambda_role}")

        # Update mapping
        mapping = {
            "backend_roles": backend_roles,
            "hosts": all_access_config.get('hosts', []),
            "users": all_access_config.get('users', [])
        }

        response = requests.put(url, auth=awsauth, json=mapping)
        print(f"Update status: {response.status_code}")
        print(f"Response: {response.text}")

        if response.status_code in [200, 201]:
            print("\n✓ Successfully added Lambda role to all_access mapping!")
        else:
            print("\n✗ Failed to update role mapping")
    else:
        print("\n✓ Lambda role already in backend_roles")
else:
    print(f"✗ Failed to fetch current mapping: {response.text}")
```

#### ステップ4: スクリプトを実行

```bash
python3 configure_opensearch_fgac.py
```

### 方法2: AWS Lambda関数を使用（VPC内から実行）

既存のLambda関数を一時的に使用してFGACを設定することもできます。

```python
import json
import boto3
import requests
from requests_aws4auth import AWS4Auth

def lambda_handler(event, context):
    region = 'ap-northeast-1'
    service = 'es'
    host = 'https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com'
    lambda_role = 'arn:aws:iam::770923989980:role/cis-lambda-search-api-role'

    # Get credentials
    session = boto3.Session()
    credentials = session.get_credentials()
    awsauth = AWS4Auth(
        credentials.access_key,
        credentials.secret_key,
        region,
        service,
        session_token=credentials.token
    )

    # Update role mapping
    path = '/_plugins/_security/api/rolesmapping/all_access'
    url = host + path

    # Get current mapping
    response = requests.get(url, auth=awsauth)
    current_mapping = response.json()

    # Add Lambda role
    all_access_config = current_mapping.get('all_access', {})
    backend_roles = all_access_config.get('backend_roles', [])

    if lambda_role not in backend_roles:
        backend_roles.append(lambda_role)

        mapping = {
            "backend_roles": backend_roles,
            "hosts": all_access_config.get('hosts', []),
            "users": all_access_config.get('users', [])
        }

        response = requests.put(url, auth=awsauth, json=mapping)

        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Role mapping updated',
                'status': response.status_code,
                'response': response.text
            })
        }

    return {
        'statusCode': 200,
        'body': json.dumps({'message': 'Role already mapped'})
    }
```

### 方法3: Terraform を使用（推奨・自動化）

Terraformでロールマッピングを管理する:

```hcl
# terraform/opensearch_fgac.tf

resource "null_resource" "opensearch_role_mapping" {
  provisioner "local-exec" {
    command = <<-EOT
      python3 << PYTHON
import boto3
import requests
from requests_aws4auth import AWS4Auth
import json

region = 'ap-northeast-1'
service = 'es'
host = '${var.opensearch_endpoint}'
lambda_role = '${var.lambda_role_arn}'

session = boto3.Session()
credentials = session.get_credentials()
awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    region,
    service,
    session_token=credentials.token
)

path = '/_plugins/_security/api/rolesmapping/all_access'
url = host + path

response = requests.get(url, auth=awsauth)
current_mapping = response.json()
all_access_config = current_mapping.get('all_access', {})
backend_roles = all_access_config.get('backend_roles', [])

if lambda_role not in backend_roles:
    backend_roles.append(lambda_role)
    mapping = {
        "backend_roles": backend_roles,
        "hosts": all_access_config.get('hosts', []),
        "users": all_access_config.get('users', [])
    }
    response = requests.put(url, auth=awsauth, json=mapping)
    print(f"Updated: {response.status_code}")
PYTHON
    EOT
  }

  depends_on = [
    aws_lambda_function.search_api
  ]
}
```

## 検証方法

設定完了後、APIエンドポイントをテストして正常に動作することを確認:

```bash
curl -X GET 'https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search?q=test&limit=5' | jq '.'
```

成功レスポンス:
```json
{
  "success": true,
  "data": {
    "results": [...],
    "pagination": {...},
    "query": {...},
    "took": 123
  }
}
```

## 現在のOpenSearch設定

- **ドメイン名**: cis-filesearch-opensearch
- **VPCエンドポイント**: vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com
- **FGAC**: Enabled
- **内部ユーザーデータベース**: Disabled
- **匿名アクセス**: Disabled

## 必要なロールマッピング

```json
{
  "all_access": {
    "backend_roles": [
      "arn:aws:iam::770923989980:role/cis-filesearch-worker-role",
      "arn:aws:iam::770923989980:role/CIS-Lambda-S3EventHandler-Role",
      "arn:aws:iam::770923989980:role/cis-lambda-search-api-role"  // この行を追加
    ],
    "hosts": [],
    "users": []
  }
}
```

## トラブルシューティング

### ローカルマシンからの接続タイムアウト

**原因**: OpenSearchがVPC内にあり、ローカルマシンから直接アクセスできない

**解決策**: VPC内のリソース（EC2、Lambda）から設定スクリプトを実行

### 権限エラー

**エラー**: `security_exception: no permissions for [indices:data/read/search]`

**確認事項**:
1. IAMアクセスポリシーにLambdaロールが含まれているか
2. FGACロールマッピングにLambdaロールが含まれているか
3. OpenSearchインデックスが存在するか

### 既存ロールマッピングの確認

```bash
# VPC内のEC2/Lambda から実行
curl -X GET \
  'https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_plugins/_security/api/rolesmapping/all_access' \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"
```

## 次のステップ

1. 上記のいずれかの方法でFGACを設定
2. APIエンドポイントをテスト
3. フロントエンドとの統合
4. 本番環境への移行計画

## 参考リンク

- [OpenSearch Fine-Grained Access Control](https://opensearch.org/docs/latest/security/access-control/)
- [AWS OpenSearch Service IAM Access](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/ac.html)
- [OpenSearch Security Plugin API](https://opensearch.org/docs/latest/security/access-control/api/)
