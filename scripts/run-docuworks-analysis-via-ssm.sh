#!/bin/bash
#
# SSM経由でEC2上でDocuworks分析を実行
# このスクリプトはローカルマシンから実行します
#
# 前提条件:
#   - AWS CLI設定済み
#   - SSM Agentがインストールされた実行中のEC2インスタンス
#   - 適切なIAM権限
#

set -e

# 設定
EC2_INSTANCE_ID="${EC2_INSTANCE_ID:-i-0e6ac1e4d535a4ab2}"  # 実際のEC2インスタンスIDに変更
REGION="${AWS_REGION:-ap-northeast-1}"

echo "============================================================"
echo "SSM経由でDocuworks分析を実行"
echo "EC2 Instance: $EC2_INSTANCE_ID"
echo "Region: $REGION"
echo "============================================================"

# Python分析スクリプトをSSMコマンドとして実行
ANALYSIS_SCRIPT=$(cat << 'PYTHON_EOF'
import boto3
import json
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth
from datetime import datetime

OPENSEARCH_ENDPOINT = "vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION = "ap-northeast-1"
INDEX_NAME = "cis-files"

def get_client():
    session = boto3.Session()
    credentials = session.get_credentials()
    awsauth = AWS4Auth(
        credentials.access_key,
        credentials.secret_key,
        REGION,
        'es',
        session_token=credentials.token
    )
    return OpenSearch(
        hosts=[{'host': OPENSEARCH_ENDPOINT, 'port': 443}],
        http_auth=awsauth,
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection,
        timeout=30
    )

def main():
    print("=" * 60)
    print("Docuworks Files Analysis in OpenSearch")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print("=" * 60)

    client = get_client()
    print("OpenSearch connected.")

    # 1. Count Docuworks files
    print("\n[1/5] Counting Docuworks files...")
    xdw_count = client.count(index=INDEX_NAME, body={"query": {"wildcard": {"file_name": "*.xdw"}}}).get('count', 0)
    xbd_count = client.count(index=INDEX_NAME, body={"query": {"wildcard": {"file_name": "*.xbd"}}}).get('count', 0)
    print(f"  .xdw: {xdw_count:,}")
    print(f"  .xbd: {xbd_count:,}")
    print(f"  Total: {xdw_count + xbd_count:,}")

    # 2. Check corrupted nas_path
    print("\n[2/5] Checking corrupted nas_path...")
    corrupted_query = {
        "query": {
            "bool": {
                "should": [{"wildcard": {"file_name": "*.xdw"}}, {"wildcard": {"file_name": "*.xbd"}}],
                "minimum_should_match": 1,
                "must_not": [{"wildcard": {"nas_path": "*ts-server*"}}]
            }
        },
        "size": 10,
        "_source": ["file_name", "file_path", "nas_path", "s3_key"]
    }
    corrupted = client.search(index=INDEX_NAME, body=corrupted_query)
    corrupted_count = corrupted['hits']['total']['value']
    print(f"  Corrupted nas_path count: {corrupted_count}")
    if corrupted_count > 0:
        print("  Samples:")
        for hit in corrupted['hits']['hits'][:5]:
            s = hit['_source']
            print(f"    - {s.get('file_name')}")
            print(f"      nas_path: {s.get('nas_path')}")

    # 3. Check unusual file_path
    print("\n[3/5] Checking unusual file_path...")
    unusual_query = {
        "query": {
            "bool": {
                "should": [{"wildcard": {"file_name": "*.xdw"}}, {"wildcard": {"file_name": "*.xbd"}}],
                "minimum_should_match": 1,
                "must_not": [{"wildcard": {"file_path": "*/ts-server*/*"}}, {"wildcard": {"file_path": "ts-server*/*"}}]
            }
        },
        "size": 10,
        "_source": ["file_name", "file_path", "nas_path"]
    }
    unusual = client.search(index=INDEX_NAME, body=unusual_query)
    unusual_count = unusual['hits']['total']['value']
    print(f"  Unusual file_path count: {unusual_count}")
    if unusual_count > 0:
        print("  Samples:")
        for hit in unusual['hits']['hits'][:5]:
            s = hit['_source']
            print(f"    - {s.get('file_name')}")
            print(f"      file_path: {s.get('file_path')}")

    # 4. Sample records
    print("\n[4/5] Sample records...")
    sample_query = {
        "query": {"bool": {"should": [{"wildcard": {"file_name": "*.xdw"}}, {"wildcard": {"file_name": "*.xbd"}}], "minimum_should_match": 1}},
        "size": 5,
        "_source": ["file_name", "file_path", "nas_path", "s3_key", "file_size"]
    }
    samples = client.search(index=INDEX_NAME, body=sample_query)
    for hit in samples['hits']['hits']:
        s = hit['_source']
        print(f"  - {s.get('file_name')}")
        print(f"    file_path: {s.get('file_path')}")
        print(f"    nas_path:  {s.get('nas_path')}")
        print(f"    s3_key:    {s.get('s3_key')}")

    # 5. Server distribution
    print("\n[5/5] Server distribution...")
    servers = ["ts-server3", "ts-server5", "ts-server6", "ts-server7"]
    for server in servers:
        q = {
            "query": {
                "bool": {
                    "should": [{"wildcard": {"file_name": "*.xdw"}}, {"wildcard": {"file_name": "*.xbd"}}],
                    "minimum_should_match": 1,
                    "filter": [{"wildcard": {"nas_path": f"*{server}*"}}]
                }
            }
        }
        count = client.count(index=INDEX_NAME, body=q).get('count', 0)
        print(f"  {server}: {count:,}")

    # Check other
    other_query = {
        "query": {
            "bool": {
                "should": [{"wildcard": {"file_name": "*.xdw"}}, {"wildcard": {"file_name": "*.xbd"}}],
                "minimum_should_match": 1,
                "must_not": [
                    {"wildcard": {"nas_path": "*ts-server3*"}},
                    {"wildcard": {"nas_path": "*ts-server5*"}},
                    {"wildcard": {"nas_path": "*ts-server6*"}},
                    {"wildcard": {"nas_path": "*ts-server7*"}}
                ]
            }
        }
    }
    other_count = client.count(index=INDEX_NAME, body=other_query).get('count', 0)
    print(f"  Other (unknown server): {other_count}")

    print("\n" + "=" * 60)
    print("Analysis Complete")
    print("=" * 60)

if __name__ == "__main__":
    main()
PYTHON_EOF
)

# SSMコマンドを実行
echo ""
echo "SSMコマンドを送信中..."

COMMAND_ID=$(aws ssm send-command \
    --instance-ids "$EC2_INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters "commands=[\"cd /tmp && python3 -c '$ANALYSIS_SCRIPT'\"]" \
    --region "$REGION" \
    --output text \
    --query "Command.CommandId")

echo "Command ID: $COMMAND_ID"
echo "結果を待機中（最大60秒）..."

# コマンドの完了を待機
for i in {1..60}; do
    STATUS=$(aws ssm list-commands \
        --command-id "$COMMAND_ID" \
        --region "$REGION" \
        --output text \
        --query "Commands[0].Status")

    if [ "$STATUS" = "Success" ] || [ "$STATUS" = "Failed" ] || [ "$STATUS" = "TimedOut" ]; then
        break
    fi

    sleep 1
done

echo ""
echo "コマンドステータス: $STATUS"
echo ""

# 結果を取得
if [ "$STATUS" = "Success" ]; then
    echo "============================================================"
    echo "分析結果:"
    echo "============================================================"
    aws ssm get-command-invocation \
        --command-id "$COMMAND_ID" \
        --instance-id "$EC2_INSTANCE_ID" \
        --region "$REGION" \
        --output text \
        --query "StandardOutputContent"
else
    echo "エラー出力:"
    aws ssm get-command-invocation \
        --command-id "$COMMAND_ID" \
        --instance-id "$EC2_INSTANCE_ID" \
        --region "$REGION" \
        --output text \
        --query "StandardErrorContent"
fi
