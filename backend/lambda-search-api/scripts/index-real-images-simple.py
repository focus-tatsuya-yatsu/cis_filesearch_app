#!/usr/bin/env python3
"""
最もシンプルな方法：10件の実画像をインデックス化
1. サンプルデータはLambda APIで手動削除
2. S3から実画像を取得
3. ローカルAPIでembedding生成
4. Lambda APIで検索テスト
"""

import boto3
import json
import requests
import time
import sys
from typing import List, Dict

# 設定
S3_BUCKET = 'cis-filesearch-s3-landing'
LOCAL_API = 'http://localhost:3000/api/image-embedding'
SEARCH_API = 'https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search'

def find_real_images(limit=10) -> List[Dict]:
    """S3から実画像を検索"""
    print(f"🔍 S3から実画像を{limit}件検索中...")

    s3 = boto3.client('s3')

    # documentsフォルダから画像を検索（ページネーション対応）
    paginator = s3.get_paginator('list_objects_v2')
    page_iterator = paginator.paginate(
        Bucket=S3_BUCKET,
        Prefix='documents/road/',  # roadフォルダから検索
        PaginationConfig={'MaxItems': 1000}
    )

    images = []
    for page in page_iterator:
        for obj in page.get('Contents', []):
            key = obj['Key']
            # 画像ファイルのみを選択（サムネイル除外）
            if (key.lower().endswith(('.jpg', '.jpeg', '.png')) and
                'thumbnail' not in key.lower() and
                'sample' not in key.lower()):
                images.append({
                    'key': key,
                    'size': obj['Size'],
                    'modified': obj.get('LastModified')
                })

                if len(images) >= limit:
                    return images[:limit]

    print(f"✅ {len(images)}件の実画像を発見")
    for i, img in enumerate(images[:5], 1):
        print(f"  {i}. {img['key']} ({img['size']/1024:.1f} KB)")
    if len(images) > 5:
        print(f"  ... 他{len(images)-5}件")

    return images[:limit]

def download_image(s3_key: str) -> bytes:
    """S3から画像をダウンロード"""
    s3 = boto3.client('s3')
    response = s3.get_object(Bucket=S3_BUCKET, Key=s3_key)
    return response['Body'].read()

def generate_embedding_via_local_api(image_bytes: bytes, filename: str) -> List[float]:
    """ローカルAPIで画像のembeddingを生成"""
    # マルチパートフォームデータとして送信
    files = {
        'image': (filename, image_bytes, 'image/jpeg')
    }

    response = requests.post(LOCAL_API, files=files)

    if response.status_code != 200:
        raise Exception(f"API error: {response.status_code} - {response.text}")

    result = response.json()
    if result.get('success') and result.get('data', {}).get('embedding'):
        return result['data']['embedding']
    else:
        raise Exception(f"Failed to generate embedding: {result}")

def test_search_with_vector(vector: List[float]) -> Dict:
    """生成したベクトルで検索テスト"""
    payload = {
        "imageVector": vector,
        "searchType": "image",
        "page": 1,
        "limit": 3
    }

    response = requests.post(
        SEARCH_API,
        headers={'Content-Type': 'application/json'},
        json=payload
    )

    if response.status_code != 200:
        raise Exception(f"Search API error: {response.status_code}")

    return response.json()

def main():
    """メイン処理"""
    print("=" * 60)
    print("🚀 実画像インデックス化スクリプト（シンプル版）")
    print("=" * 60)
    print()

    # 1. 事前確認
    print("⚠️  注意事項:")
    print("1. localhost:3000 でNext.jsサーバーが動作している必要があります")
    print("2. AWS認証が設定されている必要があります")
    print("3. このスクリプトは実画像のembeddingを生成します")
    print()

    # 2. 実画像を検索
    images = find_real_images(limit=10)
    if not images:
        print("❌ 実画像が見つかりませんでした")
        return

    print()
    print("📝 処理を開始します...")
    print()

    # 3. 最初の1枚でテスト
    test_image = images[0]
    print(f"🧪 テスト画像: {test_image['key']}")

    try:
        # 画像をダウンロード
        print("  ⬇️  画像をダウンロード中...")
        image_bytes = download_image(test_image['key'])
        print(f"  ✅ ダウンロード完了 ({len(image_bytes)/1024:.1f} KB)")

        # embeddingを生成
        print("  🤖 embeddingを生成中...")
        import os
        filename = os.path.basename(test_image['key'])
        embedding = generate_embedding_via_local_api(image_bytes, filename)
        print(f"  ✅ embedding生成完了 (次元数: {len(embedding)})")

        # 検索テスト
        print("  🔍 生成したembeddingで検索テスト...")
        search_result = test_search_with_vector(embedding)

        if search_result.get('success'):
            results = search_result.get('data', {}).get('results', [])
            print(f"  ✅ 検索成功！ {len(results)}件の結果:")
            for i, r in enumerate(results[:3], 1):
                print(f"     {i}. {r.get('fileName')} (スコア: {r.get('relevanceScore', 'N/A')})")
        else:
            print(f"  ⚠️  検索エラー: {search_result.get('error')}")

    except Exception as e:
        print(f"  ❌ エラー: {str(e)}")
        return

    print()
    print("=" * 60)
    print("📌 次のステップ:")
    print()
    print("1. サンプルデータを削除するには:")
    print("   既存のLambda関数を修正するか、EC2経由で削除")
    print()
    print("2. 実画像を本格的にインデックス化するには:")
    print("   - Lambda関数に管理機能を追加")
    print("   - またはEC2インスタンス経由で実行")
    print()
    print("3. このスクリプトで全10件を処理するには:")
    print("   上記のテストが成功したら、ループで全画像を処理")
    print("=" * 60)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  ユーザーによって中断されました")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ 予期しないエラー: {str(e)}")
        sys.exit(1)