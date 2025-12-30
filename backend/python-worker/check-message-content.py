#!/usr/bin/env python3
"""
SQSメッセージ内容確認スクリプト
実際にどのようなメッセージが来ているか確認
"""

import boto3
import json
from datetime import datetime
import sys

# SQS設定
QUEUE_URL = "https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
REGION = "ap-northeast-1"

def main():
    """メッセージ内容を確認（削除せずに表示のみ）"""
    print(f"[{datetime.now()}] SQSメッセージ内容確認開始...")
    print("=" * 80)

    try:
        # SQSクライアント作成
        sqs = boto3.client('sqs', region_name=REGION)

        # メッセージ受信（削除せず、表示のみ）
        response = sqs.receive_message(
            QueueUrl=QUEUE_URL,
            MaxNumberOfMessages=5,
            MessageAttributeNames=['All'],
            AttributeNames=['All'],
            VisibilityTimeout=30  # 30秒後に他のワーカーが処理可能
        )

        messages = response.get('Messages', [])

        if not messages:
            print("⚠️  キューにメッセージがありません")
            return

        print(f"📨 {len(messages)}件のメッセージを確認:")
        print("")

        for i, message in enumerate(messages, 1):
            print(f"--- メッセージ {i} ---")
            print(f"MessageId: {message.get('MessageId', 'N/A')}")
            print(f"ReceiptHandle: {message.get('ReceiptHandle', 'N/A')[:50]}...")

            # 属性
            attributes = message.get('Attributes', {})
            print(f"ApproximateReceiveCount: {attributes.get('ApproximateReceiveCount', 'N/A')}")
            print(f"SentTimestamp: {attributes.get('SentTimestamp', 'N/A')}")

            # メッセージ本文
            body_str = message.get('Body', '{}')
            try:
                body = json.loads(body_str)
                print(f"\nメッセージ本文:")
                print(json.dumps(body, indent=2, ensure_ascii=False))

                # 重要な情報を抽出
                if 'Records' in body:
                    # S3イベント通知の場合
                    for record in body['Records']:
                        if 's3' in record:
                            s3_info = record['s3']
                            bucket = s3_info.get('bucket', {}).get('name', 'N/A')
                            key = s3_info.get('object', {}).get('key', 'N/A')
                            size = s3_info.get('object', {}).get('size', 'N/A')
                            print(f"\n🗂️  S3ファイル情報:")
                            print(f"  Bucket: {bucket}")
                            print(f"  Key: {key}")
                            print(f"  Size: {size} bytes")

                            # ファイル拡張子を確認
                            if '.' in key:
                                ext = key.rsplit('.', 1)[-1].lower()
                                print(f"  拡張子: .{ext}")

                                # DocuWorksファイルか確認
                                if ext in ['xdw', 'xbd']:
                                    print(f"  📄 DocuWorksファイル検出！")

                                    # 関連PDFやテキストファイルを探す
                                    base_name = key.rsplit('.', 1)[0]
                                    print(f"  関連ファイル候補:")
                                    print(f"    - {base_name}.pdf")
                                    print(f"    - {base_name}.txt")
                                    print(f"    - {base_name}_text.txt")

                elif 'file_path' in body:
                    # 直接的なファイル処理メッセージ
                    print(f"\n📁 ファイル処理メッセージ:")
                    print(f"  Path: {body.get('file_path', 'N/A')}")
                    print(f"  Type: {body.get('file_type', 'N/A')}")
                    print(f"  Operation: {body.get('operation', 'N/A')}")

                    if 'metadata' in body:
                        print(f"  メタデータ:")
                        for k, v in body['metadata'].items():
                            print(f"    {k}: {v}")

                else:
                    # その他のメッセージ形式
                    print(f"\n❓ 不明なメッセージ形式")

            except json.JSONDecodeError as e:
                print(f"\n❌ JSONパースエラー: {e}")
                print(f"生のメッセージ本文: {body_str[:200]}...")

            print("")
            print("-" * 40)

        print("")
        print("=" * 80)
        print("⚠️  注意: これらのメッセージは削除されていません")
        print("⚠️  現在のworkerは実際の処理を行っていません！")
        print("")
        print("📋 確認されたファイル形式:")

        # 統計を集計
        file_types = {}
        for message in messages:
            try:
                body = json.loads(message.get('Body', '{}'))
                if 'Records' in body:
                    for record in body['Records']:
                        if 's3' in record:
                            key = record['s3'].get('object', {}).get('key', '')
                            if '.' in key:
                                ext = key.rsplit('.', 1)[-1].lower()
                                file_types[ext] = file_types.get(ext, 0) + 1
            except:
                pass

        for ext, count in file_types.items():
            print(f"  .{ext}: {count}件")

        if not file_types:
            print("  ファイル形式を特定できませんでした")

    except Exception as e:
        print(f"❌ エラー: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()