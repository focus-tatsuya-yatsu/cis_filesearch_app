#!/usr/bin/env python3
"""
Lambda検索APIのテスト
"""

import json
import boto3
from datetime import datetime

REGION = "ap-northeast-1"
LAMBDA_FUNCTION = "cis-search-api-prod"

def invoke_search_lambda(query_params: dict):
    """Lambda関数を直接呼び出して検索"""
    client = boto3.client('lambda', region_name=REGION)

    event = {
        "httpMethod": "GET",
        "path": "/search",
        "queryStringParameters": query_params,
        "headers": {},
        "body": None
    }

    print(f"Sending event: {json.dumps(event, indent=2)}")

    response = client.invoke(
        FunctionName=LAMBDA_FUNCTION,
        InvocationType='RequestResponse',
        Payload=json.dumps(event)
    )

    result = json.loads(response['Payload'].read().decode('utf-8'))
    print(f"Status Code: {result.get('statusCode')}")

    if result.get('statusCode') == 200:
        body = json.loads(result.get('body', '{}'))
        return body
    else:
        print(f"Error response: {json.dumps(result, indent=2)}")
        return None

def main():
    print("=" * 60)
    print("Lambda Search API Test")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print("=" * 60)

    # Test 1: Simple search
    print("\n[Test 1] Simple search for any files")
    print("-" * 40)
    result = invoke_search_lambda({
        "q": "test",
        "size": "5"
    })
    if result:
        print(f"Total: {result.get('pagination', {}).get('total', result.get('total', 0))}")
        for r in result.get('results', [])[:3]:
            print(f"  - {r.get('file_name')}")

    # Test 2: Search with docuworks file type
    print("\n[Test 2] Search with docuworks file type")
    print("-" * 40)
    result = invoke_search_lambda({
        "q": "xdw",
        "size": "5",
        "fileType": "docuworks"
    })
    if result:
        print(f"Total: {result.get('pagination', {}).get('total', result.get('total', 0))}")
        for r in result.get('results', [])[:3]:
            print(f"  - {r.get('file_name')}")
            print(f"    nas_path: {r.get('nas_path')}")

    # Test 3: Search all files
    print("\n[Test 3] Search all files (no filter)")
    print("-" * 40)
    result = invoke_search_lambda({
        "q": "*",
        "size": "10"
    })
    if result:
        print(f"Total: {result.get('pagination', {}).get('total', result.get('total', 0))}")
        for r in result.get('results', [])[:5]:
            print(f"  - {r.get('file_name')} ({r.get('file_type', 'unknown')})")

    # Test 4: List file types in results
    print("\n[Test 4] File types distribution")
    print("-" * 40)
    result = invoke_search_lambda({
        "q": "*",
        "size": "100"
    })
    if result:
        file_types = {}
        for r in result.get('results', []):
            ft = r.get('file_type', 'unknown')
            file_types[ft] = file_types.get(ft, 0) + 1
        print("File types in first 100 results:")
        for ft, count in sorted(file_types.items(), key=lambda x: -x[1]):
            print(f"  {ft}: {count}")

    # Test 5: Search with specific extension
    print("\n[Test 5] Search for .xdw extension in filename")
    print("-" * 40)
    result = invoke_search_lambda({
        "q": ".xdw",
        "size": "5"
    })
    if result:
        print(f"Total: {result.get('pagination', {}).get('total', result.get('total', 0))}")
        for r in result.get('results', [])[:5]:
            print(f"  - {r.get('file_name')}")
            print(f"    file_path: {r.get('file_path')}")
            print(f"    nas_path: {r.get('nas_path')}")

if __name__ == "__main__":
    main()
