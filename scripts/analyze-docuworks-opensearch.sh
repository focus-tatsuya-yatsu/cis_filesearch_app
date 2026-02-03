#!/bin/bash
#
# Docuworksファイル分析スクリプト（OpenSearch）
# このスクリプトはEC2インスタンスから実行する必要があります
#
# 使用方法:
#   1. EC2インスタンスにSSH接続またはSSMセッション開始
#   2. このスクリプトを転送または直接コピー
#   3. ./analyze-docuworks-opensearch.sh を実行
#

set -e

OPENSEARCH_ENDPOINT="vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
INDEX_NAME="cis-files"
REGION="ap-northeast-1"

echo "============================================================"
echo "Docuworks Files Analysis in OpenSearch"
echo "実行日時: $(date '+%Y-%m-%d %H:%M:%S')"
echo "Index: $INDEX_NAME"
echo "============================================================"

# AWS認証情報の取得（IAMロール使用）
get_signed_url() {
    local method="$1"
    local path="$2"
    local body="$3"

    # Python + boto3 + requests-aws4auth を使用
    python3 << EOF
import boto3
import json
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

session = boto3.Session()
credentials = session.get_credentials()

awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    '$REGION',
    'es',
    session_token=credentials.token
)

client = OpenSearch(
    hosts=[{'host': '$OPENSEARCH_ENDPOINT', 'port': 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection,
    timeout=30
)

# Execute query
body = json.loads('''$body''')
result = client.search(index='$INDEX_NAME', body=body)
print(json.dumps(result, indent=2, ensure_ascii=False))
EOF
}

echo ""
echo "============================================================"
echo "[1/5] Docuworksファイル総数カウント"
echo "============================================================"

python3 << 'EOF'
import boto3
import json
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

OPENSEARCH_ENDPOINT = "vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION = "ap-northeast-1"
INDEX_NAME = "cis-files"

session = boto3.Session()
credentials = session.get_credentials()

awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    REGION,
    'es',
    session_token=credentials.token
)

client = OpenSearch(
    hosts=[{'host': OPENSEARCH_ENDPOINT, 'port': 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection,
    timeout=30
)

# Count .xdw files
xdw_query = {"query": {"wildcard": {"file_name": "*.xdw"}}}
xdw_result = client.count(index=INDEX_NAME, body=xdw_query)
xdw_count = xdw_result.get('count', 0)

# Count .xbd files
xbd_query = {"query": {"wildcard": {"file_name": "*.xbd"}}}
xbd_result = client.count(index=INDEX_NAME, body=xbd_query)
xbd_count = xbd_result.get('count', 0)

print(f".xdw ファイル数: {xdw_count:,}")
print(f".xbd ファイル数: {xbd_count:,}")
print(f"Docuworks総数: {xdw_count + xbd_count:,}")
EOF

echo ""
echo "============================================================"
echo "[2/5] 破損したnas_pathの確認（ts-serverを含まない）"
echo "============================================================"

python3 << 'EOF'
import boto3
import json
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

OPENSEARCH_ENDPOINT = "vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION = "ap-northeast-1"
INDEX_NAME = "cis-files"

session = boto3.Session()
credentials = session.get_credentials()

awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    REGION,
    'es',
    session_token=credentials.token
)

client = OpenSearch(
    hosts=[{'host': OPENSEARCH_ENDPOINT, 'port': 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection,
    timeout=30
)

query = {
    "query": {
        "bool": {
            "should": [
                {"wildcard": {"file_name": "*.xdw"}},
                {"wildcard": {"file_name": "*.xbd"}}
            ],
            "minimum_should_match": 1,
            "must_not": [
                {"wildcard": {"nas_path": "*ts-server*"}}
            ]
        }
    },
    "size": 20,
    "_source": ["file_name", "file_path", "nas_path", "s3_key"]
}

result = client.search(index=INDEX_NAME, body=query)
total = result['hits']['total']['value']
hits = result['hits']['hits']

if total == 0:
    print("\033[0;32m破損したnas_pathを持つDocuworksファイルはありません\033[0m")
else:
    print(f"\033[0;31m破損したnas_pathを持つファイル: {total}件\033[0m")
    print("\nサンプル（最大20件）:")
    for i, hit in enumerate(hits, 1):
        source = hit['_source']
        print(f"\n{i}. {source.get('file_name', 'N/A')}")
        print(f"   file_path: {source.get('file_path', 'N/A')}")
        print(f"   nas_path:  {source.get('nas_path', 'N/A')}")
        print(f"   s3_key:    {source.get('s3_key', 'N/A')}")
EOF

echo ""
echo "============================================================"
echo "[3/5] 異常なfile_pathパターンの確認"
echo "============================================================"

python3 << 'EOF'
import boto3
import json
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

OPENSEARCH_ENDPOINT = "vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION = "ap-northeast-1"
INDEX_NAME = "cis-files"

session = boto3.Session()
credentials = session.get_credentials()

awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    REGION,
    'es',
    session_token=credentials.token
)

client = OpenSearch(
    hosts=[{'host': OPENSEARCH_ENDPOINT, 'port': 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection,
    timeout=30
)

query = {
    "query": {
        "bool": {
            "should": [
                {"wildcard": {"file_name": "*.xdw"}},
                {"wildcard": {"file_name": "*.xbd"}}
            ],
            "minimum_should_match": 1,
            "must_not": [
                {"wildcard": {"file_path": "*/ts-server*/*"}},
                {"wildcard": {"file_path": "ts-server*/*"}}
            ]
        }
    },
    "size": 20,
    "_source": ["file_name", "file_path", "nas_path", "s3_key"]
}

result = client.search(index=INDEX_NAME, body=query)
total = result['hits']['total']['value']
hits = result['hits']['hits']

if total == 0:
    print("\033[0;32m異常なfile_pathを持つDocuworksファイルはありません\033[0m")
else:
    print(f"\033[1;33m異常なfile_pathを持つファイル: {total}件\033[0m")
    print("\nサンプル（最大20件）:")
    for i, hit in enumerate(hits, 1):
        source = hit['_source']
        print(f"\n{i}. {source.get('file_name', 'N/A')}")
        print(f"   file_path: {source.get('file_path', 'N/A')}")
        print(f"   nas_path:  {source.get('nas_path', 'N/A')}")
EOF

echo ""
echo "============================================================"
echo "[4/5] サンプルレコードの取得"
echo "============================================================"

python3 << 'EOF'
import boto3
import json
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

OPENSEARCH_ENDPOINT = "vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION = "ap-northeast-1"
INDEX_NAME = "cis-files"

session = boto3.Session()
credentials = session.get_credentials()

awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    REGION,
    'es',
    session_token=credentials.token
)

client = OpenSearch(
    hosts=[{'host': OPENSEARCH_ENDPOINT, 'port': 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection,
    timeout=30
)

query = {
    "query": {
        "bool": {
            "should": [
                {"wildcard": {"file_name": "*.xdw"}},
                {"wildcard": {"file_name": "*.xbd"}}
            ],
            "minimum_should_match": 1
        }
    },
    "size": 10,
    "_source": ["file_name", "file_path", "nas_path", "s3_key", "file_size", "file_type", "created_at", "modified_at"]
}

result = client.search(index=INDEX_NAME, body=query)
hits = result['hits']['hits']

print(f"サンプルレコード（{len(hits)}件）:")
for i, hit in enumerate(hits, 1):
    source = hit['_source']
    print(f"\n{'-' * 50}")
    print(f"レコード {i}:")
    print(f"  file_name:   {source.get('file_name', 'N/A')}")
    print(f"  file_path:   {source.get('file_path', 'N/A')}")
    print(f"  nas_path:    {source.get('nas_path', 'N/A')}")
    print(f"  s3_key:      {source.get('s3_key', 'N/A')}")
    print(f"  file_size:   {source.get('file_size', 'N/A')}")
    print(f"  file_type:   {source.get('file_type', 'N/A')}")
EOF

echo ""
echo "============================================================"
echo "[5/5] サーバー別分布確認"
echo "============================================================"

python3 << 'EOF'
import boto3
import json
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

OPENSEARCH_ENDPOINT = "vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION = "ap-northeast-1"
INDEX_NAME = "cis-files"

session = boto3.Session()
credentials = session.get_credentials()

awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    REGION,
    'es',
    session_token=credentials.token
)

client = OpenSearch(
    hosts=[{'host': OPENSEARCH_ENDPOINT, 'port': 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection,
    timeout=30
)

servers = ["ts-server3", "ts-server5", "ts-server6", "ts-server7"]
distribution = {}

for server in servers:
    query = {
        "query": {
            "bool": {
                "should": [
                    {"wildcard": {"file_name": "*.xdw"}},
                    {"wildcard": {"file_name": "*.xbd"}}
                ],
                "minimum_should_match": 1,
                "filter": [
                    {"wildcard": {"nas_path": f"*{server}*"}}
                ]
            }
        }
    }
    try:
        result = client.count(index=INDEX_NAME, body=query)
        count = result.get('count', 0)
        distribution[server] = count
        print(f"  {server}: {count:,} 件")
    except Exception as e:
        print(f"  {server}: エラー - {e}")
        distribution[server] = -1

# Check for files not matching any known server
other_query = {
    "query": {
        "bool": {
            "should": [
                {"wildcard": {"file_name": "*.xdw"}},
                {"wildcard": {"file_name": "*.xbd"}}
            ],
            "minimum_should_match": 1,
            "must_not": [
                {"wildcard": {"nas_path": "*ts-server3*"}},
                {"wildcard": {"nas_path": "*ts-server5*"}},
                {"wildcard": {"nas_path": "*ts-server6*"}},
                {"wildcard": {"nas_path": "*ts-server7*"}}
            ]
        }
    },
    "size": 10,
    "_source": ["file_name", "nas_path"]
}

try:
    result = client.search(index=INDEX_NAME, body=other_query)
    other_count = result['hits']['total']['value']
    distribution["other"] = other_count

    if other_count > 0:
        print(f"\n  \033[1;33mその他（サーバー不明）: {other_count} 件\033[0m")
        print("  サンプル:")
        for hit in result['hits']['hits'][:5]:
            source = hit['_source']
            print(f"    - {source.get('file_name')}: {source.get('nas_path')}")
    else:
        print(f"\n  その他（サーバー不明）: 0 件")
except Exception as e:
    print(f"  その他: エラー - {e}")
EOF

echo ""
echo "============================================================"
echo "[追加] 空のnas_pathチェック"
echo "============================================================"

python3 << 'EOF'
import boto3
import json
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

OPENSEARCH_ENDPOINT = "vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION = "ap-northeast-1"
INDEX_NAME = "cis-files"

session = boto3.Session()
credentials = session.get_credentials()

awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    REGION,
    'es',
    session_token=credentials.token
)

client = OpenSearch(
    hosts=[{'host': OPENSEARCH_ENDPOINT, 'port': 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection,
    timeout=30
)

query = {
    "query": {
        "bool": {
            "should": [
                {"wildcard": {"file_name": "*.xdw"}},
                {"wildcard": {"file_name": "*.xbd"}}
            ],
            "minimum_should_match": 1,
            "must": [
                {
                    "bool": {
                        "should": [
                            {"bool": {"must_not": {"exists": {"field": "nas_path"}}}},
                            {"term": {"nas_path": ""}},
                            {"term": {"nas_path.keyword": ""}}
                        ],
                        "minimum_should_match": 1
                    }
                }
            ]
        }
    },
    "size": 10,
    "_source": ["file_name", "file_path", "nas_path", "s3_key"]
}

try:
    result = client.search(index=INDEX_NAME, body=query)
    total = result['hits']['total']['value']
    hits = result['hits']['hits']

    if total == 0:
        print("\033[0;32m空のnas_pathを持つDocuworksファイルはありません\033[0m")
    else:
        print(f"\033[0;31m空のnas_pathを持つファイル: {total}件\033[0m")
        print("\nサンプル:")
        for i, hit in enumerate(hits, 1):
            source = hit['_source']
            print(f"  {i}. {source.get('file_name', 'N/A')}")
            print(f"     file_path: {source.get('file_path', 'N/A')}")
except Exception as e:
    print(f"エラー: {e}")
EOF

echo ""
echo "============================================================"
echo "分析完了"
echo "============================================================"
