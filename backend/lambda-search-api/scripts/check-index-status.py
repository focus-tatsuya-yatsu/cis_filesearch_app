#!/usr/bin/env python3
"""
現在のOpenSearchインデックスの状態を確認
"""

import boto3
import json
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

# 設定
REGION = 'ap-northeast-1'
OPENSEARCH_ENDPOINT = 'vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com'
INDEX_NAME = 'file-index-v2-knn'

def get_opensearch_client():
    """OpenSearchクライアントを取得"""
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
        connection_class=RequestsHttpConnection
    )
    return client

def check_index_status():
    """インデックスの状態を確認"""
    print("=" * 50)
    print("📊 OpenSearchインデックス状態確認")
    print("=" * 50)
    print(f"インデックス名: {INDEX_NAME}")
    print(f"エンドポイント: {OPENSEARCH_ENDPOINT}")
    print()

    try:
        client = get_opensearch_client()

        # 1. ドキュメント数を確認
        count_response = client.count(index=INDEX_NAME)
        total_docs = count_response['count']
        print(f"📄 総ドキュメント数: {total_docs}件")

        # 2. サンプルデータの数を確認
        sample_query = {
            "query": {
                "wildcard": {
                    "fileName": "sample_*"
                }
            }
        }
        sample_response = client.count(index=INDEX_NAME, body=sample_query)
        sample_count = sample_response['count']
        print(f"🎯 サンプルデータ数: {sample_count}件")

        # 3. 実データの数を確認
        real_count = total_docs - sample_count
        print(f"📸 実画像データ数: {real_count}件")

        # 4. 最新の3件を表示
        print("\n📋 最新の3件:")
        search_response = client.search(
            index=INDEX_NAME,
            body={
                "size": 3,
                "sort": [{"modifiedDate": {"order": "desc"}}],
                "_source": ["fileName", "filePath", "fileType", "fileSize"]
            }
        )

        for i, hit in enumerate(search_response['hits']['hits'], 1):
            source = hit['_source']
            file_size_kb = source.get('fileSize', 0) / 1024
            print(f"  {i}. {source['fileName']}")
            print(f"     タイプ: {source.get('fileType', 'unknown')}")
            print(f"     サイズ: {file_size_kb:.1f} KB")
            print(f"     パス: {source['filePath'][:50]}...")

        return total_docs, sample_count, real_count

    except Exception as e:
        print(f"❌ エラー: {str(e)}")
        return None, None, None

if __name__ == "__main__":
    total, samples, real = check_index_status()

    print("\n" + "=" * 50)
    if samples is not None and samples > 0:
        print(f"💡 {samples}件のサンプルデータが存在します")
        print("   quick-index-10-images.pyを実行すると、")
        print("   これらを削除して実画像に置き換えます")
    elif samples is not None:
        print("✅ サンプルデータはありません")
    print("=" * 50)