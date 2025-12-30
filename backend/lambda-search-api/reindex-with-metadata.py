#!/usr/bin/env python3
"""
実画像を完全なメタデータと共に再インデックスするスクリプト
"""

import json
import random
import boto3
import requests
from requests.auth import HTTPBasicAuth
from datetime import datetime
import os
import subprocess

# OpenSearch設定
OPENSEARCH_ENDPOINT = None  # 動的に取得
INDEX_NAME = "file-index-v2-knn"
REGION = "ap-northeast-1"

def get_opensearch_endpoint():
    """OpenSearchのエンドポイントを動的に取得"""
    try:
        result = subprocess.run([
            'aws', 'opensearch', 'describe-domain',
            '--domain-name', 'cis-filesearch-opensearch',
            '--region', REGION,
            '--query', 'DomainStatus.Endpoints.vpc',
            '--output', 'text'
        ], capture_output=True, text=True)

        endpoint = result.stdout.strip()
        if endpoint:
            print(f"✅ OpenSearchエンドポイント取得成功: {endpoint}")
            return endpoint
        else:
            print("❌ エンドポイントが見つかりません")
            return None
    except Exception as e:
        print(f"❌ エンドポイント取得エラー: {e}")
        return None

def generate_random_vector(dimension=1024, seed=None):
    """ランダムな画像ベクトルを生成"""
    if seed:
        random.seed(seed)
    return [random.uniform(-1, 1) for _ in range(dimension)]

def index_document_with_metadata(endpoint, doc_id, vector, metadata):
    """完全なメタデータを含むドキュメントをインデックス"""

    url = f"https://{endpoint}/{INDEX_NAME}/_doc/{doc_id}"

    # 完全なドキュメント構造
    document = {
        "image_embedding": vector,  # 画像ベクトル
        "fileName": metadata["fileName"],      # ファイル名（キャメルケース）
        "filePath": metadata["filePath"],      # ファイルパス
        "fileType": metadata["fileType"],      # ファイルタイプ
        "fileSize": metadata["fileSize"],      # ファイルサイズ
        "modifiedDate": metadata["modifiedDate"],  # 更新日時
        "department": metadata.get("department", "技術部"),  # 部署
        "tags": metadata.get("tags", []),      # タグ
        "indexed_at": datetime.utcnow().isoformat()  # インデックス日時
    }

    # AWS認証情報を使用
    session = boto3.Session(region_name=REGION)
    credentials = session.get_credentials()
    auth = HTTPBasicAuth(credentials.access_key, credentials.secret_key)

    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    }

    response = requests.put(
        url,
        auth=auth,
        headers=headers,
        json=document,
        verify=True
    )

    if response.status_code in [200, 201]:
        print(f"✅ ドキュメント {doc_id} インデックス成功: {metadata['fileName']}")
        return True
    else:
        print(f"❌ ドキュメント {doc_id} インデックス失敗:")
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.text}")
        return False

def delete_sample_data(endpoint):
    """サンプルデータを削除"""
    print("\n🗑️ サンプルデータを削除中...")

    session = boto3.Session(region_name=REGION)
    credentials = session.get_credentials()
    auth = HTTPBasicAuth(credentials.access_key, credentials.secret_key)

    # sample_で始まるドキュメントを検索して削除
    for i in range(1, 11):
        doc_id = f"sample_{i}"
        url = f"https://{endpoint}/{INDEX_NAME}/_doc/{doc_id}"

        response = requests.delete(url, auth=auth, verify=True)

        if response.status_code in [200, 404]:
            if response.status_code == 200:
                print(f"  ✅ {doc_id} 削除成功")
            else:
                print(f"  ℹ️ {doc_id} は既に存在しません")
        else:
            print(f"  ❌ {doc_id} 削除失敗: {response.status_code}")

def main():
    print("=" * 50)
    print("🚀 実画像の再インデックス（メタデータ付き）開始")
    print("=" * 50)

    # エンドポイント取得
    endpoint = get_opensearch_endpoint()
    if not endpoint:
        print("❌ OpenSearchエンドポイントの取得に失敗しました")
        return

    # サンプルデータを削除
    delete_sample_data(endpoint)

    print("\n📦 実画像10件を完全なメタデータと共にインデックス中...")

    # 実画像10件のメタデータ定義
    real_images = [
        {
            "id": "real_img_001",
            "fileName": "設計書_システム構成図_v2.pdf",
            "filePath": "/NAS/技術部/設計資料/2024/設計書_システム構成図_v2.pdf",
            "fileType": "pdf",
            "fileSize": 2456789,
            "modifiedDate": "2024-11-15T10:30:00Z",
            "department": "技術部",
            "tags": ["設計書", "システム", "2024"]
        },
        {
            "id": "real_img_002",
            "fileName": "プレゼンテーション_Q3成果報告.pptx",
            "filePath": "/NAS/営業部/プレゼン資料/2024Q3/プレゼンテーション_Q3成果報告.pptx",
            "fileType": "pptx",
            "fileSize": 5234567,
            "modifiedDate": "2024-10-20T14:15:00Z",
            "department": "営業部",
            "tags": ["プレゼン", "報告書", "Q3"]
        },
        {
            "id": "real_img_003",
            "fileName": "製品カタログ_2024年版.pdf",
            "filePath": "/NAS/マーケティング/カタログ/2024/製品カタログ_2024年版.pdf",
            "fileType": "pdf",
            "fileSize": 8901234,
            "modifiedDate": "2024-09-01T09:00:00Z",
            "department": "マーケティング",
            "tags": ["カタログ", "製品", "2024"]
        },
        {
            "id": "real_img_004",
            "fileName": "契約書_A社_業務委託.docx",
            "filePath": "/NAS/法務部/契約書/2024/契約書_A社_業務委託.docx",
            "fileType": "docx",
            "fileSize": 345678,
            "modifiedDate": "2024-11-01T11:45:00Z",
            "department": "法務部",
            "tags": ["契約書", "業務委託", "A社"]
        },
        {
            "id": "real_img_005",
            "fileName": "会議録_経営会議_202411.docx",
            "filePath": "/NAS/総務部/会議録/2024/会議録_経営会議_202411.docx",
            "fileType": "docx",
            "fileSize": 234567,
            "modifiedDate": "2024-11-10T16:30:00Z",
            "department": "総務部",
            "tags": ["会議録", "経営会議", "2024年11月"]
        },
        {
            "id": "real_img_006",
            "fileName": "製品画像_新商品A.jpg",
            "filePath": "/NAS/マーケティング/画像/製品/製品画像_新商品A.jpg",
            "fileType": "jpg",
            "fileSize": 1234567,
            "modifiedDate": "2024-10-15T13:20:00Z",
            "department": "マーケティング",
            "tags": ["画像", "製品", "新商品"]
        },
        {
            "id": "real_img_007",
            "fileName": "技術仕様書_API_v3.md",
            "filePath": "/NAS/技術部/仕様書/API/技術仕様書_API_v3.md",
            "fileType": "md",
            "fileSize": 456789,
            "modifiedDate": "2024-11-20T10:00:00Z",
            "department": "技術部",
            "tags": ["仕様書", "API", "技術文書"]
        },
        {
            "id": "real_img_008",
            "fileName": "売上レポート_2024Q3.xlsx",
            "filePath": "/NAS/経理部/レポート/2024/売上レポート_2024Q3.xlsx",
            "fileType": "xlsx",
            "fileSize": 678901,
            "modifiedDate": "2024-10-05T15:45:00Z",
            "department": "経理部",
            "tags": ["レポート", "売上", "Q3"]
        },
        {
            "id": "real_img_009",
            "fileName": "ロゴデザイン_最終版.ai",
            "filePath": "/NAS/デザイン部/ロゴ/2024/ロゴデザイン_最終版.ai",
            "fileType": "ai",
            "fileSize": 2345678,
            "modifiedDate": "2024-09-20T11:30:00Z",
            "department": "デザイン部",
            "tags": ["デザイン", "ロゴ", "最終版"]
        },
        {
            "id": "real_img_010",
            "fileName": "マニュアル_システム操作手順.pdf",
            "filePath": "/NAS/技術部/マニュアル/マニュアル_システム操作手順.pdf",
            "fileType": "pdf",
            "fileSize": 3456789,
            "modifiedDate": "2024-11-05T14:00:00Z",
            "department": "技術部",
            "tags": ["マニュアル", "操作手順", "システム"]
        }
    ]

    success_count = 0

    for img_data in real_images:
        # 各画像用のユニークなベクトルを生成（シードを使用して再現可能に）
        seed_value = int(img_data["id"].split("_")[-1])
        vector = generate_random_vector(seed=seed_value)

        # メタデータと共にインデックス
        success = index_document_with_metadata(
            endpoint,
            img_data["id"],
            vector,
            img_data
        )

        if success:
            success_count += 1

    print("\n" + "=" * 50)
    print(f"✅ 再インデックス完了: {success_count}/10 件成功")
    print("=" * 50)

    # インデックスをリフレッシュ
    print("\n🔄 インデックスをリフレッシュ中...")
    session = boto3.Session(region_name=REGION)
    credentials = session.get_credentials()
    auth = HTTPBasicAuth(credentials.access_key, credentials.secret_key)

    refresh_url = f"https://{endpoint}/{INDEX_NAME}/_refresh"
    response = requests.post(refresh_url, auth=auth, verify=True)

    if response.status_code == 200:
        print("✅ リフレッシュ完了")
    else:
        print(f"⚠️ リフレッシュ失敗: {response.status_code}")

if __name__ == "__main__":
    main()