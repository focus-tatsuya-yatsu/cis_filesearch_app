#!/usr/bin/env python3
"""
OpenSearch Role Mapping Setup Script
Sets up role mapping for Lambda execution role to access OpenSearch
"""

import json
import boto3
from opensearchpy import OpenSearch, RequestsHttpConnection, AWSV4SignerAuth

# Configuration
OPENSEARCH_ENDPOINT = "vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
LAMBDA_ROLE_ARN = "arn:aws:iam::770923989980:role/cis-lambda-search-api-role"
REGION = "ap-northeast-1"

def setup_role_mapping():
    """Set up OpenSearch role mapping for Lambda execution role"""

    print("=" * 50)
    print("OpenSearch Role Mapping Setup")
    print("=" * 50)
    print()

    # AWS認証情報を取得
    print("1️⃣ AWS認証情報を取得中...")
    credentials = boto3.Session().get_credentials()
    auth = AWSV4SignerAuth(credentials, REGION, 'es')

    # OpenSearchクライアントを作成
    print(f"2️⃣ OpenSearchに接続中: {OPENSEARCH_ENDPOINT}")
    client = OpenSearch(
        hosts=[{'host': OPENSEARCH_ENDPOINT, 'port': 443}],
        http_auth=auth,
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection,
        timeout=30
    )

    # クラスター情報を確認
    try:
        info = client.info()
        print(f"✅ 接続成功: OpenSearch {info['version']['number']}")
    except Exception as e:
        print(f"❌ 接続失敗: {e}")
        return False

    print()

    # ロールマッピングを設定
    print("3️⃣ ロールマッピングを設定中...")

    # all_access ロールにLambda実行ロールをマッピング
    role_mapping = {
        "backend_roles": [LAMBDA_ROLE_ARN],
        "hosts": [],
        "users": []
    }

    try:
        response = client.transport.perform_request(
            'PUT',
            '/_plugins/_security/api/rolesmapping/all_access',
            body=json.dumps(role_mapping)
        )
        print(f"✅ all_access ロールマッピング設定完了")
        print(f"   レスポンス: {response}")
    except Exception as e:
        print(f"❌ ロールマッピング設定失敗: {e}")
        return False

    print()

    # security_manager ロールにもマッピング
    print("4️⃣ security_manager ロールにもマッピング中...")
    try:
        response = client.transport.perform_request(
            'PUT',
            '/_plugins/_security/api/rolesmapping/security_manager',
            body=json.dumps(role_mapping)
        )
        print(f"✅ security_manager ロールマッピング設定完了")
    except Exception as e:
        print(f"⚠️ security_manager ロールマッピング設定スキップ: {e}")

    print()

    # 設定を確認
    print("5️⃣ ロールマッピングを確認中...")
    try:
        response = client.transport.perform_request(
            'GET',
            '/_plugins/_security/api/rolesmapping/all_access'
        )
        print("✅ all_access ロールマッピング:")
        print(json.dumps(response, indent=2))
    except Exception as e:
        print(f"❌ ロールマッピング確認失敗: {e}")

    print()
    print("=" * 50)
    print("✅ セットアップ完了！")
    print("=" * 50)
    print()
    print("次のステップ:")
    print("1. Lambda関数をテスト: ./scripts/test-lambda-connection.sh")
    print()

    return True

if __name__ == "__main__":
    try:
        success = setup_role_mapping()
        exit(0 if success else 1)
    except Exception as e:
        print(f"❌ エラー: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
