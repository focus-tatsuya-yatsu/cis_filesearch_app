#!/usr/bin/env python3
"""
テストメッセージをSQSに送信して、実際の処理を確認
"""

import boto3
import json
import time
from datetime import datetime

# 設定
QUEUE_URL = "https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
REGION = "ap-northeast-1"

def send_test_message():
    """テスト用のS3イベント通知メッセージを送信"""

    sqs = boto3.client('sqs', region_name=REGION)

    # S3イベント通知の形式でメッセージを作成
    test_messages = [
        {
            "type": "normal_file",
            "body": {
                "Records": [{
                    "eventName": "ObjectCreated:Put",
                    "s3": {
                        "bucket": {
                            "name": "cis-filesearch-test"
                        },
                        "object": {
                            "key": "test_files/sample_document.pdf",
                            "size": 102400
                        }
                    }
                }]
            }
        },
        {
            "type": "docuworks_file",
            "body": {
                "Records": [{
                    "eventName": "ObjectCreated:Put",
                    "s3": {
                        "bucket": {
                            "name": "cis-filesearch-test"
                        },
                        "object": {
                            "key": "test_files/important_document.xdw",
                            "size": 204800
                        }
                    }
                }]
            }
        },
        {
            "type": "docuworks_pdf",
            "body": {
                "Records": [{
                    "eventName": "ObjectCreated:Put",
                    "s3": {
                        "bucket": {
                            "name": "cis-filesearch-test"
                        },
                        "object": {
                            "key": "test_files/important_document.pdf",
                            "size": 184320
                        }
                    }
                }]
            }
        },
        {
            "type": "docuworks_text",
            "body": {
                "Records": [{
                    "eventName": "ObjectCreated:Put",
                    "s3": {
                        "bucket": {
                            "name": "cis-filesearch-test"
                        },
                        "object": {
                            "key": "test_files/important_document.txt",
                            "size": 4096
                        }
                    }
                }]
            }
        },
        {
            "type": "office_file",
            "body": {
                "Records": [{
                    "eventName": "ObjectCreated:Put",
                    "s3": {
                        "bucket": {
                            "name": "cis-filesearch-test"
                        },
                        "object": {
                            "key": "test_files/presentation.pptx",
                            "size": 512000
                        }
                    }
                }]
            }
        }
    ]

    print(f"[{datetime.now()}] テストメッセージ送信開始")
    print("=" * 60)

    for msg_info in test_messages:
        try:
            # メッセージ送信
            response = sqs.send_message(
                QueueUrl=QUEUE_URL,
                MessageBody=json.dumps(msg_info["body"]),
                MessageAttributes={
                    'TestMessage': {
                        'StringValue': 'true',
                        'DataType': 'String'
                    },
                    'MessageType': {
                        'StringValue': msg_info["type"],
                        'DataType': 'String'
                    }
                }
            )

            print(f"✅ {msg_info['type']}: {response['MessageId']}")

            if msg_info["type"] == "docuworks_file":
                print("   📄 DocuWorksファイル - 関連ファイルも送信済み")
                print("      - important_document.xdw (元ファイル)")
                print("      - important_document.pdf (PDF変換)")
                print("      - important_document.txt (テキスト抽出)")

        except Exception as e:
            print(f"❌ {msg_info['type']}: エラー - {e}")

    print("")
    print("=" * 60)
    print("📨 テストメッセージ送信完了")
    print("")

    # 少し待機してからキューの状態を確認
    print("10秒待機してから処理状況を確認...")
    time.sleep(10)

    # キューの状態確認
    try:
        attrs = sqs.get_queue_attributes(
            QueueUrl=QUEUE_URL,
            AttributeNames=['ApproximateNumberOfMessages']
        )

        remaining = int(attrs['Attributes']['ApproximateNumberOfMessages'])

        if remaining == 0:
            print("✅ すべてのメッセージが処理されました！")
        else:
            print(f"⏳ 処理中... (残り {remaining} メッセージ)")

            # さらに20秒待機
            print("さらに20秒待機...")
            time.sleep(20)

            attrs = sqs.get_queue_attributes(
                QueueUrl=QUEUE_URL,
                AttributeNames=['ApproximateNumberOfMessages']
            )

            new_remaining = int(attrs['Attributes']['ApproximateNumberOfMessages'])

            if new_remaining == 0:
                print("✅ すべてのメッセージが処理されました！")
            elif new_remaining < remaining:
                print(f"⏳ 処理進行中... ({remaining} → {new_remaining})")
                print("   実際にファイル処理が行われています！")
            else:
                print(f"⚠️ メッセージが処理されていない可能性があります")
                print(f"   残りメッセージ: {new_remaining}")

    except Exception as e:
        print(f"❌ キュー状態確認エラー: {e}")

    print("")
    print("💡 次のステップ:")
    print("1. CloudWatch Logsで処理ログを確認")
    print("2. OpenSearchでインデックスされたデータを確認")
    print("3. フロントエンドから検索テスト")

if __name__ == "__main__":
    send_test_message()