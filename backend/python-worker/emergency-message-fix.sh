#!/bin/bash
# 緊急修正：SQSメッセージが削除されない問題の修正

set -e

echo "🚨 緊急修正：SQSメッセージ処理の問題"
echo "====================================="

export AWS_PROFILE=AdministratorAccess-770923989980
export AWS_REGION=ap-northeast-1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

INSTANCE_ID="i-0e6ac1e4d535a4ab2"

echo -e "${RED}現在の問題:${NC}"
echo "• 処理中メッセージ: 5件（削除されない）"
echo "• DLQメッセージ: 8,158件"
echo "• 根本原因: OpenSearchエラー時にメッセージ削除されない"
echo ""

# Step 1: 修正版Worker作成
echo -e "${GREEN}Step 1: 修正版Worker作成${NC}"

cat > /tmp/fixed_worker_userdata.sh << 'EOF'
#!/bin/bash
set +e
exec > >(tee /var/log/user-data.log)
exec 2>&1

echo "=== Fixed Worker Deployment Started at $(date) ==="

export AWS_REGION="ap-northeast-1"

# 既存サービス停止
systemctl stop phased-worker.service 2>/dev/null || true
systemctl stop minimal-worker.service 2>/dev/null || true

# 必要なパッケージ
yum install -y python3 python3-pip || true
pip3 install boto3==1.26.137 --no-deps || true
pip3 install botocore==1.29.137 --no-deps || true
pip3 install urllib3==1.26.16 || true
pip3 install opensearch-py==2.2.0 --no-deps || true
pip3 install requests==2.28.2 || true

# 修正版Worker作成
cat <<'WORKER' > /opt/fixed_worker.py
#!/usr/bin/env python3
"""
Fixed Worker - メッセージを必ず削除する修正版
"""

import boto3
import json
import time
import sys
import os
import traceback
from datetime import datetime

print(f"[{datetime.now()}] Fixed Worker Starting...")

# 設定
QUEUE_URL = "https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
DLQ_URL = "https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq"
REGION = "ap-northeast-1"
MAX_MESSAGES = 3
OPENSEARCH_ENDPOINT = "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
INDEX_NAME = "file-metadata"

# クライアント
sqs = boto3.client('sqs', region_name=REGION)
s3 = boto3.client('s3', region_name=REGION)

# OpenSearch設定（エラーを許容）
OPENSEARCH_AVAILABLE = False
try:
    from opensearchpy import OpenSearch
    opensearch = OpenSearch(
        hosts=[{'host': OPENSEARCH_ENDPOINT.replace('https://', ''), 'port': 443}],
        http_compress=True,
        use_ssl=True,
        verify_certs=True,
        ssl_assert_hostname=False,
        ssl_show_warn=False,
        timeout=30,
        max_retries=1,
        retry_on_timeout=False
    )

    # テスト接続
    opensearch.info()
    OPENSEARCH_AVAILABLE = True
    print(f"[{datetime.now()}] OpenSearch connected")
except Exception as e:
    print(f"[{datetime.now()}] OpenSearch not available: {e}")
    OPENSEARCH_AVAILABLE = False

# 統計
stats = {
    'processed': 0,
    'deleted': 0,
    'indexed': 0,
    'errors': 0,
    'dlq_sent': 0
}

def process_message(message):
    """メッセージを処理（エラーでも必ず削除）"""

    message_id = message.get('MessageId')
    receipt_handle = message['ReceiptHandle']

    # 処理成功フラグ
    processing_success = False
    error_message = None

    try:
        # メッセージ本文をパース
        body = json.loads(message.get('Body', '{}'))

        # ファイル情報抽出（S3イベント形式）
        file_info = None
        if 'Records' in body:
            for record in body['Records']:
                if 's3' in record:
                    s3_info = record['s3']
                    bucket = s3_info.get('bucket', {}).get('name')
                    key = s3_info.get('object', {}).get('key')
                    size = s3_info.get('object', {}).get('size', 0)

                    if bucket and key:
                        file_info = {
                            'file_name': os.path.basename(key),
                            'file_path': key,
                            's3_bucket': bucket,
                            's3_key': key,
                            'file_size': size,
                            'timestamp': datetime.utcnow().isoformat(),
                            'processing_status': 'processed'
                        }

                        # ファイルタイプ判定
                        if '.' in key:
                            ext = key.rsplit('.', 1)[-1].lower()
                            file_info['file_type'] = ext

                        print(f"[{datetime.now()}] Processing: {file_info['file_name']}")
                        processing_success = True

        # OpenSearchへのインデックス（失敗を許容）
        if file_info and OPENSEARCH_AVAILABLE:
            try:
                doc_id = file_info['s3_key'].replace('/', '_')
                opensearch.index(
                    index=INDEX_NAME,
                    id=doc_id,
                    body=file_info,
                    refresh=False  # パフォーマンス改善
                )
                stats['indexed'] += 1
                print(f"[{datetime.now()}] Indexed: {file_info['file_name']}")
            except Exception as e:
                # OpenSearchエラーは無視（ファイル処理は成功扱い）
                print(f"[{datetime.now()}] OpenSearch error (ignored): {e}")
                error_message = f"OpenSearch: {str(e)}"

    except json.JSONDecodeError as e:
        error_message = f"Invalid JSON: {e}"
        print(f"[{datetime.now()}] JSON error: {e}")
    except Exception as e:
        error_message = f"Processing error: {e}"
        print(f"[{datetime.now()}] Processing error: {e}")
        traceback.print_exc()

    finally:
        # 重要：必ずメッセージを削除
        try:
            sqs.delete_message(
                QueueUrl=QUEUE_URL,
                ReceiptHandle=receipt_handle
            )
            stats['deleted'] += 1
            print(f"[{datetime.now()}] Message deleted: {message_id}")

            # エラーがあった場合はDLQに記録（削除後）
            if error_message:
                try:
                    sqs.send_message(
                        QueueUrl=DLQ_URL,
                        MessageBody=json.dumps({
                            'original_message': message,
                            'error': error_message,
                            'timestamp': datetime.utcnow().isoformat()
                        })
                    )
                    stats['dlq_sent'] += 1
                except:
                    pass

        except Exception as e:
            print(f"[{datetime.now()}] CRITICAL: Failed to delete message: {e}")
            stats['errors'] += 1

# メインループ
print(f"[{datetime.now()}] Starting main loop...")

while True:
    try:
        # メッセージ受信
        response = sqs.receive_message(
            QueueUrl=QUEUE_URL,
            MaxNumberOfMessages=MAX_MESSAGES,
            WaitTimeSeconds=10,
            VisibilityTimeout=120  # 短縮して早期リトライ
        )

        messages = response.get('Messages', [])

        if messages:
            print(f"[{datetime.now()}] Processing {len(messages)} messages")

            for message in messages:
                stats['processed'] += 1
                process_message(message)

                # 定期的に統計出力
                if stats['processed'] % 10 == 0:
                    print(f"[{datetime.now()}] Stats: {stats}")
        else:
            time.sleep(2)

    except KeyboardInterrupt:
        print(f"[{datetime.now()}] Shutting down...")
        break
    except Exception as e:
        print(f"[{datetime.now()}] Main loop error: {e}")
        stats['errors'] += 1
        time.sleep(5)

print(f"[{datetime.now()}] Final stats: {stats}")
WORKER

chmod +x /opt/fixed_worker.py

# サービス作成
cat <<'SERVICE' > /etc/systemd/system/fixed-worker.service
[Unit]
Description=Fixed SQS Worker
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 -u /opt/fixed_worker.py
Restart=on-failure
RestartSec=30
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE

# 起動
systemctl daemon-reload
systemctl enable fixed-worker.service
systemctl start fixed-worker.service

echo "=== Fixed Worker Started at $(date) ==="
systemctl status fixed-worker.service --no-pager || true
EOF

echo -e "${GREEN}✅ 修正版Worker作成完了${NC}"
echo ""

# Step 2: Launch Template更新
echo -e "${GREEN}Step 2: Launch Template更新${NC}"

if [[ "$OSTYPE" == "darwin"* ]]; then
    USER_DATA_BASE64=$(base64 -i /tmp/fixed_worker_userdata.sh)
else
    USER_DATA_BASE64=$(base64 -w0 /tmp/fixed_worker_userdata.sh)
fi

NEW_VERSION=$(aws ec2 create-launch-template-version \
    --launch-template-name cis-filesearch-worker-template \
    --source-version '$Latest' \
    --launch-template-data "{\"UserData\":\"${USER_DATA_BASE64}\"}" \
    --query 'LaunchTemplateVersion.VersionNumber' \
    --output text)

echo "新バージョン作成: v$NEW_VERSION"

aws ec2 modify-launch-template \
    --launch-template-name cis-filesearch-worker-template \
    --default-version $NEW_VERSION > /dev/null

echo -e "${GREEN}✅ Launch Template更新完了${NC}"
echo ""

# Step 3: インスタンス再起動
echo -e "${YELLOW}Step 3: 修正版デプロイ${NC}"
echo ""
echo -e "${BLUE}修正内容:${NC}"
echo "✅ メッセージを必ず削除（finally句）"
echo "✅ OpenSearchエラーを許容"
echo "✅ エラー時はDLQに記録"
echo "✅ Visibility Timeout短縮（120秒）"
echo ""

read -p "インスタンスを再起動して修正を適用しますか？ (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "インスタンス再起動中..."

    aws autoscaling terminate-instance-in-auto-scaling-group \
        --instance-id $INSTANCE_ID \
        --no-should-decrement-desired-capacity > /dev/null

    echo "終了リクエスト送信..."

    # 新インスタンス待機
    for i in {1..10}; do
        sleep 30

        NEW_INSTANCE=$(aws autoscaling describe-auto-scaling-groups \
            --auto-scaling-group-names cis-filesearch-ec2-autoscaling \
            --query 'AutoScalingGroups[0].Instances[?LifecycleState==`InService`].InstanceId' \
            --output text)

        if [ -n "$NEW_INSTANCE" ] && [ "$NEW_INSTANCE" != "$INSTANCE_ID" ]; then
            echo -e "${GREEN}✅ 新インスタンス起動: $NEW_INSTANCE${NC}"
            INSTANCE_ID=$NEW_INSTANCE
            break
        fi

        echo "待機中... ($i/10)"
    done

    # 処理開始待機
    echo "処理開始待機中（60秒）..."
    sleep 60

    # 結果確認
    echo ""
    echo -e "${BLUE}処理状況確認:${NC}"

    # キューの状態確認
    QUEUE_STATUS=$(aws sqs get-queue-attributes \
        --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
        --attribute-names ApproximateNumberOfMessagesNotVisible \
        --region ap-northeast-1 \
        --output json)

    IN_FLIGHT=$(echo $QUEUE_STATUS | jq -r '.Attributes.ApproximateNumberOfMessagesNotVisible')

    echo -e "処理中メッセージ: ${IN_FLIGHT}"

    if [ "$IN_FLIGHT" -eq "0" ]; then
        echo -e "${GREEN}✅ 修正成功！メッセージが正しく削除されています${NC}"
    else
        echo -e "${YELLOW}⚠ まだ処理中です。しばらくお待ちください${NC}"
    fi

    echo ""
    echo "次のステップ:"
    echo "1. DLQのメッセージをリカバリー"
    echo "2. ./recover-dlq.sh を実行"

else
    echo "キャンセルされました"
fi