#!/usr/bin/env python3
"""
ts-server6/ts-server7 のプレビュー・実ファイルオープン機能確認スクリプト

このスクリプトは VPC 内の EC2 インスタンスから実行してください。

確認項目:
1. file_path (S3 URL) - プレビュー用presigned URL生成に必要
2. nas_path (UNC path) - 実ファイルオープンに必要
3. nas_server - サーバー識別に必要

Usage:
    python verify-preview-realfile-data.py
"""

import json
import ssl
import urllib.request
from typing import Any, Dict, Optional

import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

# Configuration
OPENSEARCH_ENDPOINT = 'https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com'
OPENSEARCH_INDEX = 'cis-files-v2'
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


def get_sample_documents(query: Dict[str, Any], size: int = 5, fields: list = None) -> list:
    """Get sample documents for a query."""
    url = f"{OPENSEARCH_ENDPOINT}/{OPENSEARCH_INDEX}/_search"
    body = {
        "query": query.get("query", {"match_all": {}}),
        "size": size,
    }
    if fields:
        body["_source"] = fields
    result = signed_request('POST', url, body)
    return result.get('hits', {}).get('hits', [])


def check_server_stats(server_name: str):
    """Check stats for a specific server."""
    print(f"\n{'='*70}")
    print(f" {server_name} 統計")
    print(f"{'='*70}")

    # Total documents for this server
    server_query = {"query": {"term": {"nas_server": server_name}}}
    total = get_count(server_query)
    print(f"\n総ドキュメント数: {total:,}")

    if total == 0:
        print(f"  -> {server_name} のドキュメントが見つかりません")
        return

    # Check file_path (S3 URL) - Required for preview
    with_file_path_query = {
        "query": {
            "bool": {
                "must": [
                    {"term": {"nas_server": server_name}},
                    {"exists": {"field": "file_path"}}
                ]
            }
        }
    }
    with_file_path = get_count(with_file_path_query)
    file_path_rate = (with_file_path / total * 100) if total > 0 else 0

    print(f"\n[プレビュー機能] file_path (S3 URL):")
    print(f"  設定済み: {with_file_path:,} ({file_path_rate:.1f}%)")
    print(f"  未設定:   {total - with_file_path:,} ({100 - file_path_rate:.1f}%)")

    # Check nas_path (UNC path) - Required for real file open
    with_nas_path_query = {
        "query": {
            "bool": {
                "must": [
                    {"term": {"nas_server": server_name}},
                    {"exists": {"field": "nas_path"}}
                ]
            }
        }
    }
    with_nas_path = get_count(with_nas_path_query)
    nas_path_rate = (with_nas_path / total * 100) if total > 0 else 0

    print(f"\n[実ファイルオープン機能] nas_path (UNC path):")
    print(f"  設定済み: {with_nas_path:,} ({nas_path_rate:.1f}%)")
    print(f"  未設定:   {total - with_nas_path:,} ({100 - nas_path_rate:.1f}%)")

    # Check both are set (fully functional)
    both_set_query = {
        "query": {
            "bool": {
                "must": [
                    {"term": {"nas_server": server_name}},
                    {"exists": {"field": "file_path"}},
                    {"exists": {"field": "nas_path"}}
                ]
            }
        }
    }
    both_set = get_count(both_set_query)
    both_rate = (both_set / total * 100) if total > 0 else 0

    print(f"\n[完全機能] file_path + nas_path 両方設定:")
    print(f"  設定済み: {both_set:,} ({both_rate:.1f}%)")

    # Sample documents with both fields
    print(f"\n--- サンプルドキュメント (nas_path設定済み、5件) ---")
    sample_query = {
        "query": {
            "bool": {
                "must": [
                    {"term": {"nas_server": server_name}},
                    {"exists": {"field": "nas_path"}}
                ]
            }
        }
    }
    samples = get_sample_documents(
        sample_query,
        size=5,
        fields=["file_name", "file_path", "nas_path", "file_extension", "nas_server", "file_size"]
    )

    for i, doc in enumerate(samples, 1):
        source = doc.get('_source', {})
        print(f"\n  {i}. {source.get('file_name', 'N/A')}")
        print(f"     拡張子: {source.get('file_extension', 'N/A')}")
        print(f"     サイズ: {source.get('file_size', 0):,} bytes")
        file_path = source.get('file_path', 'N/A')
        if file_path and len(file_path) > 80:
            print(f"     file_path: {file_path[:80]}...")
        else:
            print(f"     file_path: {file_path}")
        nas_path = source.get('nas_path', 'N/A')
        print(f"     nas_path: {nas_path}")

    # Check nas_path format
    print(f"\n--- nas_path フォーマット確認 ---")
    if samples:
        first_nas_path = samples[0].get('_source', {}).get('nas_path', '')
        if first_nas_path:
            if first_nas_path.startswith('\\\\'):
                print(f"  OK: UNCパス形式 (\\\\server\\share\\...)")
            elif first_nas_path.startswith('/'):
                print(f"  NG: Linuxパス形式 (/mount/...)")
            else:
                print(f"  不明: {first_nas_path[:50]}")
        else:
            print(f"  nas_path が空です")

    # Sample documents without nas_path (if any)
    without_nas_path = total - with_nas_path
    if without_nas_path > 0:
        print(f"\n--- nas_path 未設定のサンプル (5件) ---")
        no_nas_query = {
            "query": {
                "bool": {
                    "must": [
                        {"term": {"nas_server": server_name}}
                    ],
                    "must_not": [
                        {"exists": {"field": "nas_path"}}
                    ]
                }
            }
        }
        no_nas_samples = get_sample_documents(
            no_nas_query,
            size=5,
            fields=["file_name", "file_path", "nas_path", "file_extension", "nas_server"]
        )

        for i, doc in enumerate(no_nas_samples, 1):
            source = doc.get('_source', {})
            print(f"\n  {i}. {source.get('file_name', 'N/A')}")
            print(f"     拡張子: {source.get('file_extension', 'N/A')}")
            file_path = source.get('file_path', 'N/A')
            if file_path and len(file_path) > 80:
                print(f"     file_path: {file_path[:80]}...")
            else:
                print(f"     file_path: {file_path}")

    # File extension breakdown
    print(f"\n--- ファイル拡張子別統計 (上位10件) ---")
    agg_query = {
        "size": 0,
        "query": {"term": {"nas_server": server_name}},
        "aggs": {
            "extensions": {
                "terms": {
                    "field": "file_extension",
                    "size": 10
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
        pct = (count / total * 100) if total > 0 else 0
        print(f"  {ext}: {count:,} ({pct:.1f}%)")


def main():
    print("=" * 70)
    print(" ts-server6/ts-server7 プレビュー・実ファイルオープン機能確認")
    print("=" * 70)
    print(f"Endpoint: {OPENSEARCH_ENDPOINT}")
    print(f"Index: {OPENSEARCH_INDEX}")

    # Get overall stats
    print(f"\n{'='*70}")
    print(" 全体統計")
    print(f"{'='*70}")

    total_count = get_count({"query": {"match_all": {}}})
    print(f"\n総ドキュメント数 (全サーバー): {total_count:,}")

    # Server breakdown
    print(f"\nサーバー別ドキュメント数:")
    server_agg_query = {
        "size": 0,
        "aggs": {
            "servers": {
                "terms": {
                    "field": "nas_server",
                    "size": 20
                }
            }
        }
    }
    url = f"{OPENSEARCH_ENDPOINT}/{OPENSEARCH_INDEX}/_search"
    server_result = signed_request('POST', url, server_agg_query)
    server_buckets = server_result.get('aggregations', {}).get('servers', {}).get('buckets', [])

    for bucket in server_buckets:
        server = bucket['key']
        count = bucket['doc_count']
        pct = (count / total_count * 100) if total_count > 0 else 0
        print(f"  {server}: {count:,} ({pct:.1f}%)")

    # Check for documents without nas_server
    no_server_query = {"query": {"bool": {"must_not": [{"exists": {"field": "nas_server"}}]}}}
    no_server_count = get_count(no_server_query)
    if no_server_count > 0:
        print(f"  (nas_server未設定): {no_server_count:,}")

    # Check ts-server6 and ts-server7 specifically
    check_server_stats("ts-server6")
    check_server_stats("ts-server7")

    # Summary
    print(f"\n{'='*70}")
    print(" サマリー")
    print(f"{'='*70}")

    # ts-server6 summary
    ts6_total = get_count({"query": {"term": {"nas_server": "ts-server6"}}})
    ts6_nas = get_count({"query": {"bool": {"must": [
        {"term": {"nas_server": "ts-server6"}},
        {"exists": {"field": "nas_path"}}
    ]}}})

    # ts-server7 summary
    ts7_total = get_count({"query": {"term": {"nas_server": "ts-server7"}}})
    ts7_nas = get_count({"query": {"bool": {"must": [
        {"term": {"nas_server": "ts-server7"}},
        {"exists": {"field": "nas_path"}}
    ]}}})

    print(f"\n  ts-server6: {ts6_nas:,}/{ts6_total:,} nas_path設定済み ({(ts6_nas/ts6_total*100) if ts6_total > 0 else 0:.1f}%)")
    print(f"  ts-server7: {ts7_nas:,}/{ts7_total:,} nas_path設定済み ({(ts7_nas/ts7_total*100) if ts7_total > 0 else 0:.1f}%)")

    if ts6_total > 0 and ts6_nas == ts6_total and ts7_total > 0 and ts7_nas == ts7_total:
        print(f"\n  [OK] 両サーバーとも全ドキュメントにnas_pathが設定されています")
        print(f"  プレビュー機能・実ファイルオープン機能が利用可能です")
    elif (ts6_nas / ts6_total if ts6_total > 0 else 0) > 0.9 and (ts7_nas / ts7_total if ts7_total > 0 else 0) > 0.9:
        print(f"\n  [OK] 90%以上のドキュメントにnas_pathが設定されています")
    else:
        print(f"\n  [NG] nas_pathが未設定のドキュメントが多数あります")
        print(f"  実ファイルオープン機能が一部のファイルで利用できない可能性があります")

    print(f"\n{'='*70}")
    print(" 確認完了")
    print(f"{'='*70}")


if __name__ == '__main__':
    main()
