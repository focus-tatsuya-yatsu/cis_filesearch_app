#!/usr/bin/env python3
"""
Lambda関数経由で画像をインデックス化（権限問題を回避）
"""

import boto3
import json
import base64
import requests
import time
from typing import List, Dict

# 設定
LAMBDA_FUNCTION = 'cis-image-embedding-prod'
SEARCH_API_URL = 'https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search'
S3_BUCKET = 'cis-filesearch-s3-landing'
REGION = 'ap-northeast-1'

def invoke_lambda_for_embedding(image_url):
    """Lambda関数を使用してembeddingを生成"""
    lambda_client = boto3.client('lambda', region_name=REGION)

    payload = {
        "image_url": image_url
    }

    response = lambda_client.invoke(
        FunctionName=LAMBDA_FUNCTION,
        InvocationType='RequestResponse',
        Payload=json.dumps(payload)
    )

    result = json.loads(response['Payload'].read())

    # Lambda関数の応答をチェック
    if response['StatusCode'] == 200:
        body = json.loads(result.get('body', '{}'))
        if body.get('success'):
            return body.get('embedding')

    raise Exception(f"Lambda embedding failed: {result}")

def test_single_image():
    """1つの画像でテスト"""
    print("🧪 Lambda経由での画像embedding生成テスト")

    # S3から1つの画像を選択
    s3 = boto3.client('s3')
    response = s3.list_objects_v2(
        Bucket=S3_BUCKET,
        Prefix='documents/',
        MaxKeys=10
    )

    image_found = None
    for obj in response.get('Contents', []):
        if obj['Key'].lower().endswith(('.jpg', '.jpeg', '.png')):
            image_found = obj['Key']
            break

    if not image_found:
        print("❌ テスト用画像が見つかりません")
        return

    print(f"📷 テスト画像: {image_found}")

    # S3 URLを生成
    image_url = f"https://{S3_BUCKET}.s3.{REGION}.amazonaws.com/{image_found}"

    try:
        # Lambda経由でembedding生成
        print("⚙️  Embedding生成中...")
        embedding = invoke_lambda_for_embedding(image_url)

        if embedding:
            print(f"✅ Embedding生成成功！")
            print(f"   次元数: {len(embedding)}")
            print(f"   最初の5要素: {embedding[:5]}")

            # 検索APIでテスト
            print("\n🔍 生成したembeddingで検索テスト...")
            search_response = requests.post(
                SEARCH_API_URL,
                headers={'Content-Type': 'application/json'},
                json={
                    "imageVector": embedding,
                    "searchType": "image",
                    "page": 1,
                    "limit": 3
                }
            )

            if search_response.status_code == 200:
                data = search_response.json()
                if data.get('success'):
                    results = data.get('data', {}).get('results', [])
                    print(f"✅ 検索成功！ {len(results)}件の結果")
                    for i, result in enumerate(results[:3], 1):
                        print(f"   {i}. {result.get('fileName')} (スコア: {result.get('relevanceScore', 'N/A')})")
                else:
                    print(f"❌ 検索失敗: {data.get('error')}")
            else:
                print(f"❌ 検索API呼び出し失敗: {search_response.status_code}")

    except Exception as e:
        print(f"❌ エラー: {str(e)}")

def main():
    """メイン処理"""
    print("=" * 50)
    print("Lambda経由画像インデックステスト")
    print("=" * 50)

    # AWS認証確認
    sts = boto3.client('sts')
    identity = sts.get_caller_identity()
    print(f"👤 AWS Account: {identity['Account']}")
    print(f"📍 Region: {REGION}")
    print()

    test_single_image()

if __name__ == "__main__":
    main()