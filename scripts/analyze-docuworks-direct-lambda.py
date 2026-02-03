#!/usr/bin/env python3
"""
Lambda関数を直接呼び出してDocuworksファイルを分析
"""

import json
import boto3
from datetime import datetime

REGION = "ap-northeast-1"
LAMBDA_FUNCTION = "cis-search-api-prod"
API_ENDPOINT = "https://rqntt5qbs0.execute-api.ap-northeast-1.amazonaws.com/prod"

def invoke_search_lambda(query: str, size: int = 10, search_mode: str = "or", file_type: str = None, limit: int = None):
    """Lambda関数を直接呼び出して検索"""
    client = boto3.client('lambda', region_name=REGION)

    # API Gateway形式のイベントを作成
    query_params = {
        "q": query,
        "size": str(limit if limit else size),
        "limit": str(limit if limit else size),
        "searchMode": search_mode
    }
    if file_type:
        query_params["fileType"] = file_type

    event = {
        "httpMethod": "GET",
        "path": "/search",
        "queryStringParameters": query_params,
        "headers": {},
        "body": None
    }

    response = client.invoke(
        FunctionName=LAMBDA_FUNCTION,
        InvocationType='RequestResponse',
        Payload=json.dumps(event)
    )

    result = json.loads(response['Payload'].read().decode('utf-8'))

    if result.get('statusCode') == 200:
        body = json.loads(result.get('body', '{}'))
        # Lambda returns { success: true, data: { results: [...], pagination: {...} } }
        if body.get('success') and body.get('data'):
            return body['data']
        return body
    else:
        body = result.get('body', '{}')
        if isinstance(body, str):
            try:
                body = json.loads(body)
            except:
                pass
        print(f"Error (status {result.get('statusCode')}): {body}")
        return None

def main():
    print("=" * 60)
    print("Docuworks Files Analysis via Lambda")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print(f"Lambda Function: {LAMBDA_FUNCTION}")
    print("=" * 60)

    # 1. Count Docuworks files
    print("\n[1/5] Docuworksファイル総数カウント")
    print("-" * 40)

    # .xdw検索（ファイルタイプフィルターを使用）
    xdw_result = invoke_search_lambda(".xdw", size=1, search_mode="or", file_type="docuworks")
    xdw_count = 0
    if xdw_result:
        xdw_count = xdw_result.get('pagination', {}).get('total', xdw_result.get('total', 0))

    # .xbd検索
    xbd_result = invoke_search_lambda(".xbd", size=1, search_mode="or", file_type="docuworks")
    xbd_count = 0
    if xbd_result:
        xbd_count = xbd_result.get('pagination', {}).get('total', xbd_result.get('total', 0))

    print(f".xdw ファイル数: {xdw_count:,}")
    print(f".xbd ファイル数: {xbd_count:,}")
    print(f"Docuworks総数: {xdw_count + xbd_count:,}")

    # 2. Sample records
    print("\n[2/5] サンプルレコードの取得")
    print("-" * 40)

    sample_result = invoke_search_lambda(".xdw", size=10, search_mode="or", file_type="docuworks")
    if sample_result and sample_result.get('results'):
        for i, r in enumerate(sample_result['results'][:10], 1):
            # API returns camelCase fields: fileName, filePath, nasPath, etc.
            print(f"\n{i}. {r.get('fileName', r.get('file_name', 'N/A'))}")
            print(f"   file_path: {r.get('filePath', r.get('file_path', 'N/A'))}")
            print(f"   nas_path:  {r.get('nasPath', r.get('nas_path', 'N/A'))}")
            print(f"   s3_key:    {r.get('s3Key', r.get('s3_key', 'N/A'))}")

    # 3. Server distribution
    print("\n[3/5] サーバー別分布確認")
    print("-" * 40)

    servers = ["ts-server3", "ts-server5", "ts-server6", "ts-server7"]
    for server in servers:
        result = invoke_search_lambda(server, size=1, search_mode="or", file_type="docuworks")
        count = 0
        if result:
            count = result.get('pagination', {}).get('total', result.get('total', 0))
        print(f"  {server}: {count:,} 件")

    # 4. Check path patterns
    print("\n[4/5] パスパターン確認")
    print("-" * 40)

    # 各サーバーからサンプルを取得してパスパターンを確認
    for server in servers:
        result = invoke_search_lambda(server, size=3, search_mode="or", file_type="docuworks")
        if result and result.get('results'):
            print(f"\n{server} のサンプル:")
            for r in result['results'][:3]:
                nas_path = r.get('nasPath', r.get('nas_path', 'N/A'))
                has_ts_server = 'ts-server' in str(nas_path) if nas_path else False
                status = "OK" if has_ts_server else "WARN"
                file_name = r.get('fileName', r.get('file_name', 'N/A'))
                print(f"  [{status}] {file_name}")
                print(f"       nas_path: {nas_path}")

    print("\n" + "=" * 60)
    print("分析完了")
    print("=" * 60)
    print("\n注意: より詳細な分析（破損パスの検出など）を行うには、")
    print("OpenSearchに直接アクセスできる環境（VPC内のEC2など）から")
    print("analyze-docuworks-opensearch.py を実行してください。")

if __name__ == "__main__":
    main()
