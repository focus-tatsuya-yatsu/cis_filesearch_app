#!/usr/bin/env python3
"""
10件の実画像を素早くインデックス化するスクリプト
サンプルデータを削除してから実画像を追加
"""

import boto3
import json
import os
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth
import requests
import base64
import time
from typing import List, Dict

# AWS設定
REGION = 'ap-northeast-1'
OPENSEARCH_ENDPOINT = 'vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com'
S3_BUCKET = 'cis-filesearch-s3-landing'
INDEX_NAME = 'file-index-v2-knn'

# Bedrock設定
BEDROCK_MODEL = 'amazon.titan-embed-image-v1'

def get_aws_credentials():
    """AWS認証情報を取得"""
    session = boto3.Session()
    credentials = session.get_credentials()
    return credentials

def get_opensearch_client():
    """OpenSearchクライアントを取得"""
    credentials = get_aws_credentials()
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

def delete_sample_data(client):
    """サンプルデータを削除"""
    print("🗑️  サンプルデータを削除中...")

    # sample_で始まるファイル名のドキュメントを削除
    query = {
        "query": {
            "wildcard": {
                "fileName": "sample_*"
            }
        }
    }

    response = client.delete_by_query(
        index=INDEX_NAME,
        body=query
    )

    deleted = response.get('deleted', 0)
    print(f"✅ {deleted}件のサンプルデータを削除しました")
    return deleted

def find_real_images(limit=10):
    """S3から実画像を検索"""
    print(f"🔍 S3から実画像を{limit}件検索中...")

    s3 = boto3.client('s3')

    # documentsフォルダから画像を検索
    paginator = s3.get_paginator('list_objects_v2')
    page_iterator = paginator.paginate(
        Bucket=S3_BUCKET,
        Prefix='documents/'
    )

    images = []
    for page in page_iterator:
        for obj in page.get('Contents', []):
            key = obj['Key']
            # 画像ファイルのみを選択（jpg, jpeg, png）
            if key.lower().endswith(('.jpg', '.jpeg', '.png')) and not key.startswith('documents/thumbnails/'):
                images.append({
                    'key': key,
                    'size': obj['Size'],
                    'modified': obj['LastModified'].isoformat()
                })

                if len(images) >= limit:
                    break

        if len(images) >= limit:
            break

    print(f"✅ {len(images)}件の実画像を発見")
    for img in images[:5]:  # 最初の5件を表示
        print(f"  - {img['key']} ({img['size']/1024:.1f} KB)")
    if len(images) > 5:
        print(f"  ... 他{len(images)-5}件")

    return images[:limit]

def generate_embedding(s3_key):
    """Bedrockを使用して画像のembeddingを生成"""
    bedrock = boto3.client('bedrock-runtime', region_name=REGION)
    s3 = boto3.client('s3')

    # S3から画像を取得
    response = s3.get_object(Bucket=S3_BUCKET, Key=s3_key)
    image_bytes = response['Body'].read()

    # Base64エンコード
    image_base64 = base64.b64encode(image_bytes).decode('utf-8')

    # Bedrock APIを呼び出し
    request_body = {
        "inputImage": image_base64
    }

    response = bedrock.invoke_model(
        modelId=BEDROCK_MODEL,
        contentType='application/json',
        accept='application/json',
        body=json.dumps(request_body)
    )

    result = json.loads(response['body'].read())
    return result['embedding']  # 1024次元のベクトル

def index_images(client, images):
    """画像をOpenSearchにインデックス"""
    print(f"📝 {len(images)}件の画像をインデックス化中...")

    success_count = 0
    error_count = 0

    for i, img in enumerate(images, 1):
        try:
            print(f"  [{i}/{len(images)}] {img['key']}を処理中...")

            # ベクトル生成
            embedding = generate_embedding(img['key'])

            # ドキュメント作成
            doc = {
                "fileName": os.path.basename(img['key']),
                "filePath": f"s3://{S3_BUCKET}/{img['key']}",
                "fileSize": img['size'],
                "fileType": os.path.splitext(img['key'])[1][1:].lower(),  # 拡張子
                "modifiedDate": img['modified'],
                "image_vector": embedding,
                "department": "実画像テスト",  # 部署情報（仮）
                "tags": ["実画像", "テスト"]  # タグ（仮）
            }

            # OpenSearchにインデックス
            doc_id = f"real_img_{i:03d}"  # real_img_001, real_img_002...
            response = client.index(
                index=INDEX_NAME,
                id=doc_id,
                body=doc
            )

            if response['result'] in ['created', 'updated']:
                success_count += 1
                print(f"    ✅ インデックス成功 (ID: {doc_id})")
            else:
                error_count += 1
                print(f"    ⚠️  予期しない結果: {response['result']}")

        except Exception as e:
            error_count += 1
            print(f"    ❌ エラー: {str(e)}")

        # レート制限対策
        time.sleep(0.5)

    print(f"\n📊 結果:")
    print(f"  - 成功: {success_count}件")
    print(f"  - エラー: {error_count}件")

    return success_count, error_count

def verify_index(client):
    """インデックスの状態を確認"""
    print("\n🔍 インデックスの状態を確認中...")

    # ドキュメント数を確認
    response = client.count(index=INDEX_NAME)
    total_docs = response['count']

    # 最新のドキュメントを取得
    search_response = client.search(
        index=INDEX_NAME,
        body={
            "size": 5,
            "sort": [
                {"modifiedDate": {"order": "desc"}}
            ],
            "_source": ["fileName", "filePath", "fileType"]
        }
    )

    print(f"✅ 総ドキュメント数: {total_docs}件")
    print("📄 最新のドキュメント:")
    for hit in search_response['hits']['hits']:
        source = hit['_source']
        print(f"  - {source['fileName']} ({source['fileType']})")

    return total_docs

def main():
    """メイン処理"""
    print("=" * 50)
    print("🚀 10件の実画像インデックス化スクリプト")
    print("=" * 50)

    try:
        # OpenSearchクライアント作成
        client = get_opensearch_client()
        print("✅ OpenSearchに接続成功")

        # 1. サンプルデータ削除
        delete_sample_data(client)

        # 2. 実画像を検索
        images = find_real_images(limit=10)

        if not images:
            print("❌ 実画像が見つかりませんでした")
            return

        # 3. 画像をインデックス化
        success, errors = index_images(client, images)

        # 4. 最終確認
        total = verify_index(client)

        print("\n" + "=" * 50)
        print("✅ 処理完了！")
        print(f"インデックス内の総ドキュメント数: {total}件")
        print("=" * 50)

    except Exception as e:
        print(f"\n❌ エラーが発生しました: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()