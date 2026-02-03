#!/usr/bin/env python3
"""
Docuworks Files Analysis in OpenSearch
Purpose: Analyze Docuworks files (.xdw, .xbd) for path issues
Usage: python3 analyze-docuworks-opensearch.py
"""

import sys
import json
from typing import Dict, Any, Optional
from datetime import datetime

try:
    import boto3
    from opensearchpy import OpenSearch, RequestsHttpConnection
    from requests_aws4auth import AWS4Auth
except ImportError as e:
    print(f"Error: Missing required package - {e}")
    print("\nInstalling required packages...")
    import subprocess
    subprocess.check_call([
        sys.executable, "-m", "pip", "install", "-q",
        "boto3", "opensearch-py", "requests-aws4auth"
    ])
    import boto3
    from opensearchpy import OpenSearch, RequestsHttpConnection
    from requests_aws4auth import AWS4Auth

# Configuration
OPENSEARCH_ENDPOINT = "vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION = "ap-northeast-1"
INDEX_NAME = "cis-files"

def print_colored(message: str, color: str = "green"):
    """Print colored output"""
    colors = {
        "green": "\033[0;32m",
        "red": "\033[0;31m",
        "yellow": "\033[1;33m",
        "blue": "\033[0;34m",
        "cyan": "\033[0;36m",
        "reset": "\033[0m"
    }
    print(f"{colors.get(color, colors['green'])}{message}{colors['reset']}")

def get_opensearch_client() -> OpenSearch:
    """Create OpenSearch client with AWS SigV4 authentication"""
    try:
        session = boto3.Session()
        credentials = session.get_credentials()

        if not credentials:
            raise ValueError("No AWS credentials found")

        awsauth = AWS4Auth(
            credentials.access_key,
            credentials.secret_key,
            REGION,
            'es',
            session_token=credentials.token
        )

        client = OpenSearch(
            hosts=[{
                'host': OPENSEARCH_ENDPOINT,
                'port': 443
            }],
            http_auth=awsauth,
            use_ssl=True,
            verify_certs=True,
            connection_class=RequestsHttpConnection,
            timeout=30
        )

        print_colored("OpenSearch client connected successfully", "green")
        return client

    except Exception as e:
        print_colored(f"Failed to connect to OpenSearch: {e}", "red")
        raise

def count_docuworks_files(client: OpenSearch) -> Dict[str, int]:
    """Count total Docuworks files by extension"""
    print("\n" + "=" * 60)
    print_colored("[1/5] Docuworksファイル総数カウント", "cyan")
    print("=" * 60)

    # Count .xdw files
    xdw_query = {
        "query": {
            "wildcard": {
                "file_name": "*.xdw"
            }
        }
    }

    # Count .xbd files
    xbd_query = {
        "query": {
            "wildcard": {
                "file_name": "*.xbd"
            }
        }
    }

    try:
        xdw_result = client.count(index=INDEX_NAME, body=xdw_query)
        xbd_result = client.count(index=INDEX_NAME, body=xbd_query)

        xdw_count = xdw_result.get('count', 0)
        xbd_count = xbd_result.get('count', 0)
        total_count = xdw_count + xbd_count

        print(f"\n.xdw ファイル数: {xdw_count:,}")
        print(f".xbd ファイル数: {xbd_count:,}")
        print_colored(f"Docuworks総数: {total_count:,}", "green")

        return {"xdw": xdw_count, "xbd": xbd_count, "total": total_count}

    except Exception as e:
        print_colored(f"Error counting files: {e}", "red")
        return {"xdw": 0, "xbd": 0, "total": 0}

def check_corrupted_nas_path(client: OpenSearch) -> Dict[str, Any]:
    """Check for Docuworks files with corrupted nas_path (not containing 'ts-server')"""
    print("\n" + "=" * 60)
    print_colored("[2/5] 破損したnas_pathの確認", "cyan")
    print("=" * 60)

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

    try:
        result = client.search(index=INDEX_NAME, body=query)
        total = result['hits']['total']['value']
        hits = result['hits']['hits']

        if total == 0:
            print_colored("破損したnas_pathを持つDocuworksファイルはありません", "green")
        else:
            print_colored(f"破損したnas_pathを持つファイル: {total}件", "red")
            print("\nサンプル（最大20件）:")
            for i, hit in enumerate(hits, 1):
                source = hit['_source']
                print(f"\n{i}. {source.get('file_name', 'N/A')}")
                print(f"   file_path: {source.get('file_path', 'N/A')}")
                print(f"   nas_path:  {source.get('nas_path', 'N/A')}")
                print(f"   s3_key:    {source.get('s3_key', 'N/A')}")

        return {"count": total, "samples": hits}

    except Exception as e:
        print_colored(f"Error checking corrupted paths: {e}", "red")
        return {"count": -1, "samples": [], "error": str(e)}

def check_unusual_file_paths(client: OpenSearch) -> Dict[str, Any]:
    """Check for unusual file_path patterns in Docuworks files"""
    print("\n" + "=" * 60)
    print_colored("[3/5] 異常なfile_pathパターンの確認", "cyan")
    print("=" * 60)

    # Check for paths not starting with expected patterns
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

    try:
        result = client.search(index=INDEX_NAME, body=query)
        total = result['hits']['total']['value']
        hits = result['hits']['hits']

        if total == 0:
            print_colored("異常なfile_pathを持つDocuworksファイルはありません", "green")
        else:
            print_colored(f"異常なfile_pathを持つファイル: {total}件", "yellow")
            print("\nサンプル（最大20件）:")
            for i, hit in enumerate(hits, 1):
                source = hit['_source']
                print(f"\n{i}. {source.get('file_name', 'N/A')}")
                print(f"   file_path: {source.get('file_path', 'N/A')}")
                print(f"   nas_path:  {source.get('nas_path', 'N/A')}")

        return {"count": total, "samples": hits}

    except Exception as e:
        print_colored(f"Error checking file paths: {e}", "red")
        return {"count": -1, "samples": [], "error": str(e)}

def get_sample_records(client: OpenSearch) -> list:
    """Get sample Docuworks file records to understand data structure"""
    print("\n" + "=" * 60)
    print_colored("[4/5] サンプルレコードの取得", "cyan")
    print("=" * 60)

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

    try:
        result = client.search(index=INDEX_NAME, body=query)
        hits = result['hits']['hits']

        print(f"\nサンプルレコード（{len(hits)}件）:")
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

        return hits

    except Exception as e:
        print_colored(f"Error getting sample records: {e}", "red")
        return []

def check_server_distribution(client: OpenSearch) -> Dict[str, int]:
    """Check distribution of Docuworks files across servers"""
    print("\n" + "=" * 60)
    print_colored("[5/5] サーバー別分布確認", "cyan")
    print("=" * 60)

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
            print_colored(f"  {server}: エラー - {e}", "red")
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
            print_colored(f"\n  その他（サーバー不明）: {other_count} 件", "yellow")
            print("  サンプル:")
            for hit in result['hits']['hits'][:5]:
                source = hit['_source']
                print(f"    - {source.get('file_name')}: {source.get('nas_path')}")
        else:
            print(f"\n  その他（サーバー不明）: 0 件")

    except Exception as e:
        print_colored(f"  その他: エラー - {e}", "red")
        distribution["other"] = -1

    return distribution

def check_empty_paths(client: OpenSearch) -> Dict[str, Any]:
    """Check for Docuworks files with empty or null nas_path"""
    print("\n" + "=" * 60)
    print_colored("[追加] 空のnas_pathチェック", "cyan")
    print("=" * 60)

    # Check for empty string or missing nas_path
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
            print_colored("空のnas_pathを持つDocuworksファイルはありません", "green")
        else:
            print_colored(f"空のnas_pathを持つファイル: {total}件", "red")
            print("\nサンプル:")
            for i, hit in enumerate(hits, 1):
                source = hit['_source']
                print(f"  {i}. {source.get('file_name', 'N/A')}")
                print(f"     file_path: {source.get('file_path', 'N/A')}")

        return {"count": total, "samples": hits}

    except Exception as e:
        print_colored(f"Error checking empty paths: {e}", "red")
        return {"count": -1, "samples": [], "error": str(e)}

def generate_summary(results: Dict[str, Any]):
    """Generate analysis summary"""
    print("\n" + "=" * 60)
    print_colored("分析結果サマリー", "cyan")
    print("=" * 60)

    print(f"\n1. Docuworksファイル総数:")
    print(f"   - .xdw: {results['counts']['xdw']:,}")
    print(f"   - .xbd: {results['counts']['xbd']:,}")
    print(f"   - 合計: {results['counts']['total']:,}")

    print(f"\n2. 破損したnas_path:")
    corrupted = results['corrupted_nas_path']['count']
    if corrupted == 0:
        print_colored("   問題なし", "green")
    else:
        print_colored(f"   {corrupted}件の問題あり", "red")

    print(f"\n3. 異常なfile_path:")
    unusual = results['unusual_file_paths']['count']
    if unusual == 0:
        print_colored("   問題なし", "green")
    else:
        print_colored(f"   {unusual}件の問題あり", "yellow")

    print(f"\n4. サーバー別分布:")
    for server, count in results['distribution'].items():
        if count >= 0:
            print(f"   - {server}: {count:,}")
        else:
            print(f"   - {server}: エラー")

    print(f"\n5. 空のnas_path:")
    empty = results['empty_paths']['count']
    if empty == 0:
        print_colored("   問題なし", "green")
    else:
        print_colored(f"   {empty}件の問題あり", "red")

def main():
    """Main analysis function"""
    print("=" * 60)
    print("Docuworks Files Analysis in OpenSearch")
    print(f"実行日時: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Index: {INDEX_NAME}")
    print("=" * 60)

    results = {}

    try:
        # Connect to OpenSearch
        client = get_opensearch_client()

        # Run all analyses
        results['counts'] = count_docuworks_files(client)
        results['corrupted_nas_path'] = check_corrupted_nas_path(client)
        results['unusual_file_paths'] = check_unusual_file_paths(client)
        results['samples'] = get_sample_records(client)
        results['distribution'] = check_server_distribution(client)
        results['empty_paths'] = check_empty_paths(client)

        # Generate summary
        generate_summary(results)

        # Save results to JSON
        output_file = f"/tmp/docuworks-analysis-{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

        # Convert results to JSON-serializable format
        json_results = {
            'timestamp': datetime.now().isoformat(),
            'index': INDEX_NAME,
            'counts': results['counts'],
            'corrupted_nas_path': {
                'count': results['corrupted_nas_path']['count'],
                'samples': [hit['_source'] for hit in results['corrupted_nas_path'].get('samples', [])]
            },
            'unusual_file_paths': {
                'count': results['unusual_file_paths']['count'],
                'samples': [hit['_source'] for hit in results['unusual_file_paths'].get('samples', [])]
            },
            'distribution': results['distribution'],
            'empty_paths': {
                'count': results['empty_paths']['count']
            }
        }

        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(json_results, f, ensure_ascii=False, indent=2)

        print(f"\n結果をJSONファイルに保存しました: {output_file}")

        print("\n" + "=" * 60)
        print_colored("分析完了", "green")
        print("=" * 60)

        return 0

    except Exception as e:
        print("\n" + "=" * 60)
        print_colored(f"分析失敗: {e}", "red")
        print("=" * 60)

        print("\nトラブルシューティング:")
        print("  1. VPC内のEC2インスタンスから実行してください")
        print("  2. IAMロールにOpenSearchへのアクセス権限があることを確認")
        print("  3. セキュリティグループでEC2からOpenSearchへの443ポートが許可されていることを確認")

        return 1

if __name__ == "__main__":
    sys.exit(main())
