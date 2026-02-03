#!/usr/bin/env python3
"""
Lambda呼び出しのデバッグ
"""

import json
import boto3
from datetime import datetime

REGION = "ap-northeast-1"
LAMBDA_FUNCTION = "cis-search-api-prod"

def main():
    print("=" * 60)
    print("Lambda Debug Call")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print("=" * 60)

    client = boto3.client('lambda', region_name=REGION)

    # シンプルなイベント
    event = {
        "httpMethod": "GET",
        "path": "/search",
        "queryStringParameters": {
            "q": ".xdw",
            "size": "5",
            "limit": "5",
            "searchMode": "or",
            "fileType": "docuworks"
        },
        "headers": {},
        "body": None
    }

    print("\n[Request]")
    print(json.dumps(event, indent=2))

    response = client.invoke(
        FunctionName=LAMBDA_FUNCTION,
        InvocationType='RequestResponse',
        Payload=json.dumps(event)
    )

    print("\n[Response Metadata]")
    print(f"Status Code: {response['StatusCode']}")
    print(f"Function Error: {response.get('FunctionError', 'None')}")

    payload = response['Payload'].read().decode('utf-8')
    result = json.loads(payload)

    print("\n[Response Body]")
    print(f"Response Status Code: {result.get('statusCode')}")

    print(f"\n[Full Response]")
    print(json.dumps(result, indent=2, ensure_ascii=False)[:2000])

    if result.get('body'):
        body = json.loads(result['body']) if isinstance(result['body'], str) else result['body']
        print(f"\n[Parsed Body]")
        print(f"Total: {body.get('pagination', {}).get('total', body.get('total', 'N/A'))}")
        print(f"Results count: {len(body.get('results', []))}")

        if body.get('results'):
            print("\n[Sample Results]")
            for i, r in enumerate(body['results'][:3], 1):
                print(f"\n{i}. {r.get('file_name', 'N/A')}")
                print(f"   file_path: {r.get('file_path', 'N/A')}")
                print(f"   nas_path: {r.get('nas_path', 'N/A')}")
                print(f"   s3_key: {r.get('s3_key', 'N/A')}")

if __name__ == "__main__":
    main()
