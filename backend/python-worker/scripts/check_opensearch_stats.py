#!/usr/bin/env python3
"""
OpenSearch 変換パイプライン統計確認スクリプト

このスクリプトは VPC 内の EC2 インスタンスから実行してください。

Usage:
    python check_opensearch_stats.py
    python check_opensearch_stats.py --detailed
"""

import argparse
import json
import ssl
import urllib.request
from typing import Any, Dict, Optional

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

# Configuration
OPENSEARCH_ENDPOINT = 'https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com'
OPENSEARCH_INDEX = 'cis-files'
AWS_REGION = 'ap-northeast-1'


def get_aws_credentials():
    """Get AWS credentials from boto3 session."""
    session = boto3.Session()
    credentials = session.get_credentials()
    return credentials.get_frozen_credentials()


def signed_request(method: str, url: str, body: Optional[Dict] = None) -> Dict:
    """Make a signed request to OpenSearch."""
    credentials = get_aws_credentials()
    headers = {'Content-Type': 'application/json'}

    data = json.dumps(body).encode('utf-8') if body else None
    aws_request = AWSRequest(method=method, url=url, data=data, headers=headers)
    SigV4Auth(credentials, 'es', AWS_REGION).add_auth(aws_request)

    req = urllib.request.Request(url, data=data, headers=dict(aws_request.headers), method=method)

    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    try:
        with urllib.request.urlopen(req, context=ssl_context, timeout=60) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8') if e.fp else ''
        print(f"HTTP Error {e.code}: {e.reason}")
        print(f"Response body: {error_body}")
        raise


def get_count(query: Dict[str, Any]) -> int:
    """Get document count for a query."""
    url = f"{OPENSEARCH_ENDPOINT}/{OPENSEARCH_INDEX}/_count"
    result = signed_request('POST', url, query)
    return result.get('count', 0)


def get_sample_documents(query: Dict[str, Any], size: int = 5) -> list:
    """Get sample documents for a query."""
    url = f"{OPENSEARCH_ENDPOINT}/{OPENSEARCH_INDEX}/_search"
    body = {
        "query": query.get("query", {"match_all": {}}),
        "size": size,
        "_source": ["file_name", "file_path", "nas_path", "file_extension", "nas_server", "category"]
    }
    result = signed_request('POST', url, body)
    return result.get('hits', {}).get('hits', [])


def main():
    parser = argparse.ArgumentParser(description='Check OpenSearch conversion pipeline stats')
    parser.add_argument('--detailed', action='store_true', help='Show detailed information with sample documents')
    args = parser.parse_args()

    print("=" * 60)
    print("OpenSearch 変換パイプライン統計")
    print("=" * 60)
    print(f"Endpoint: {OPENSEARCH_ENDPOINT}")
    print(f"Index: {OPENSEARCH_INDEX}")
    print("-" * 60)

    # 1. 総ドキュメント数
    total_count = get_count({"query": {"match_all": {}}})
    print(f"\n1. 総ドキュメント数: {total_count:,}")

    # 2. Docuworks ファイル数
    docuworks_query = {
        "query": {
            "bool": {
                "should": [
                    {"term": {"file_extension": ".xdw"}},
                    {"term": {"file_extension": ".xbd"}}
                ]
            }
        }
    }
    docuworks_count = get_count(docuworks_query)
    print(f"\n2. Docuworks ファイル数: {docuworks_count:,}")
    print(f"   (.xdw + .xbd)")

    # 3. nas_path が設定されている Docuworks ファイル数
    docuworks_with_nas_path_query = {
        "query": {
            "bool": {
                "must": [
                    {"bool": {"should": [
                        {"term": {"file_extension": ".xdw"}},
                        {"term": {"file_extension": ".xbd"}}
                    ]}},
                    {"exists": {"field": "nas_path"}}
                ]
            }
        }
    }
    docuworks_with_nas_path = get_count(docuworks_with_nas_path_query)
    docuworks_without_nas_path = docuworks_count - docuworks_with_nas_path
    nas_path_rate = (docuworks_with_nas_path / docuworks_count * 100) if docuworks_count > 0 else 0

    print(f"\n3. Docuworks + nas_path 設定済み: {docuworks_with_nas_path:,} ({nas_path_rate:.1f}%)")
    print(f"   Docuworks + nas_path 未設定: {docuworks_without_nas_path:,} ({100 - nas_path_rate:.1f}%)")

    # 4. 全ファイルの nas_path 状況
    with_nas_path_query = {"query": {"exists": {"field": "nas_path"}}}
    with_nas_path = get_count(with_nas_path_query)
    without_nas_path = total_count - with_nas_path
    overall_nas_path_rate = (with_nas_path / total_count * 100) if total_count > 0 else 0

    print(f"\n4. 全ファイル nas_path 状況:")
    print(f"   nas_path 設定済み: {with_nas_path:,} ({overall_nas_path_rate:.1f}%)")
    print(f"   nas_path 未設定: {without_nas_path:,} ({100 - overall_nas_path_rate:.1f}%)")

    # 5. preview_images が設定されている Docuworks ファイル数
    docuworks_with_preview_query = {
        "query": {
            "bool": {
                "must": [
                    {"bool": {"should": [
                        {"term": {"file_extension": ".xdw"}},
                        {"term": {"file_extension": ".xbd"}}
                    ]}},
                    {"exists": {"field": "preview_images"}}
                ]
            }
        }
    }
    docuworks_with_preview = get_count(docuworks_with_preview_query)
    preview_rate = (docuworks_with_preview / docuworks_count * 100) if docuworks_count > 0 else 0

    print(f"\n5. Docuworks プレビュー生成状況:")
    print(f"   preview_images 設定済み: {docuworks_with_preview:,} ({preview_rate:.1f}%)")
    print(f"   preview_images 未設定: {docuworks_count - docuworks_with_preview:,}")

    # 6. ファイル種別ごとの統計
    print(f"\n6. ファイル種別ごとの統計:")

    # 拡張子でグループ化
    agg_query = {
        "size": 0,
        "aggs": {
            "extensions": {
                "terms": {
                    "field": "file_extension",
                    "size": 20
                }
            }
        }
    }
    url = f"{OPENSEARCH_ENDPOINT}/{OPENSEARCH_INDEX}/_search"
    agg_result = signed_request('POST', url, agg_query)

    buckets = agg_result.get('aggregations', {}).get('extensions', {}).get('buckets', [])
    for bucket in buckets:
        ext = bucket['key']
        count = bucket['doc_count']
        pct = (count / total_count * 100) if total_count > 0 else 0
        print(f"   {ext}: {count:,} ({pct:.1f}%)")

    # 7. サーバー別の統計
    print(f"\n7. NASサーバー別の統計:")
    server_agg_query = {
        "size": 0,
        "aggs": {
            "servers": {
                "terms": {
                    "field": "nas_server",
                    "size": 10
                }
            }
        }
    }
    server_result = signed_request('POST', url, server_agg_query)
    server_buckets = server_result.get('aggregations', {}).get('servers', {}).get('buckets', [])
    for bucket in server_buckets:
        server = bucket['key']
        count = bucket['doc_count']
        pct = (count / total_count * 100) if total_count > 0 else 0
        print(f"   {server}: {count:,} ({pct:.1f}%)")

    # nas_serverが未設定のドキュメント数
    no_server_query = {"query": {"bool": {"must_not": [{"exists": {"field": "nas_server"}}]}}}
    no_server_count = get_count(no_server_query)
    if no_server_count > 0:
        print(f"   (nas_server未設定): {no_server_count:,}")

    # Detailed output
    if args.detailed:
        print("\n" + "=" * 60)
        print("詳細情報 (サンプルドキュメント)")
        print("=" * 60)

        # nas_path が未設定の Docuworks ファイルのサンプル
        if docuworks_without_nas_path > 0:
            print("\n■ nas_path 未設定の Docuworks ファイル (5件):")
            no_nas_path_query = {
                "query": {
                    "bool": {
                        "must": [
                            {"bool": {"should": [
                                {"term": {"file_extension": ".xdw"}},
                                {"term": {"file_extension": ".xbd"}}
                            ]}},
                        ],
                        "must_not": [
                            {"exists": {"field": "nas_path"}}
                        ]
                    }
                }
            }
            samples = get_sample_documents(no_nas_path_query)
            for i, doc in enumerate(samples, 1):
                source = doc.get('_source', {})
                print(f"  {i}. {source.get('file_name', 'N/A')}")
                print(f"     file_path: {source.get('file_path', 'N/A')[:80]}...")
                print(f"     nas_server: {source.get('nas_server', 'N/A')}")

        # preview_images が未設定の Docuworks ファイルのサンプル
        no_preview = docuworks_count - docuworks_with_preview
        if no_preview > 0:
            print("\n■ preview_images 未設定の Docuworks ファイル (5件):")
            no_preview_query = {
                "query": {
                    "bool": {
                        "must": [
                            {"bool": {"should": [
                                {"term": {"file_extension": ".xdw"}},
                                {"term": {"file_extension": ".xbd"}}
                            ]}},
                        ],
                        "must_not": [
                            {"exists": {"field": "preview_images"}}
                        ]
                    }
                }
            }
            samples = get_sample_documents(no_preview_query)
            for i, doc in enumerate(samples, 1):
                source = doc.get('_source', {})
                print(f"  {i}. {source.get('file_name', 'N/A')}")
                print(f"     nas_path: {source.get('nas_path', 'N/A')[:80] if source.get('nas_path') else 'N/A'}...")

    print("\n" + "=" * 60)
    print("確認完了")
    print("=" * 60)


if __name__ == '__main__':
    main()
