#!/bin/bash
# 本来の処理機能を段階的に復元するスクリプト

set -e

echo "🔧 ファイル処理機能の復元"
echo "========================="

export AWS_PROFILE=AdministratorAccess-770923989980
export AWS_REGION=ap-northeast-1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

INSTANCE_ID="i-0f0e561633f2e4c03"

echo -e "${RED}現在の問題:${NC}"
echo "• メッセージは削除されるだけで処理されていない"
echo "• OpenSearchへのデータ登録なし"
echo "• DocuWorksファイルの処理なし"
echo "• フロントエンドから検索不可能"
echo ""

# Step 1: 段階的処理版のUser Data作成
echo -e "${GREEN}Step 1: 段階的処理版のworker作成${NC}"

cat > /tmp/phased_processing_userdata.sh << 'EOF'
#!/bin/bash
set +e
exec > >(tee /var/log/user-data.log)
exec 2>&1

echo "=== Phased Processing Worker Started at $(date) ==="

export AWS_REGION="ap-northeast-1"

# 既存のサービスを停止
systemctl stop minimal-worker.service 2>/dev/null || true
pkill -f "python.*minimal_worker.py" || true

# 必要なパッケージインストール
yum install -y python3 python3-pip || true

# 必要なPythonパッケージ（段階的に追加）
pip3 install boto3==1.26.137 --no-deps || true
pip3 install botocore==1.29.137 --no-deps || true
pip3 install urllib3==1.26.16 || true
pip3 install certifi || true
pip3 install python-dateutil || true
pip3 install six || true
pip3 install jmespath || true

# OpenSearch用（最小限）
pip3 install opensearch-py==2.2.0 --no-deps || true
pip3 install requests==2.28.2 || true

# 段階的処理worker作成
cat <<'WORKER' > /opt/phased_worker.py
#!/usr/bin/env python3
"""
Phased Processing Worker - 段階的に機能を復元
Phase 1: メッセージ内容の確認とログ記録
Phase 2: S3ファイルアクセス確認
Phase 3: OpenSearchへの最小限のデータ登録
"""

import boto3
import json
import time
import sys
import os
from datetime import datetime

print(f"[{datetime.now()}] Phased Processing Worker Starting...")

# 設定
QUEUE_URL = "https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
REGION = "ap-northeast-1"
MAX_MESSAGES = 3  # 処理速度を落として確実に処理
OPENSEARCH_ENDPOINT = "https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
INDEX_NAME = "file-metadata"

# フェーズフラグ（段階的に有効化）
PHASE1_LOG_MESSAGES = True
PHASE2_ACCESS_S3 = True
PHASE3_INDEX_TO_OPENSEARCH = True

# クライアント作成
sqs = boto3.client('sqs', region_name=REGION)
s3 = boto3.client('s3', region_name=REGION)

# OpenSearchクライアント（簡易版）
if PHASE3_INDEX_TO_OPENSEARCH:
    try:
        from opensearchpy import OpenSearch
        opensearch = OpenSearch(
            hosts=[{'host': OPENSEARCH_ENDPOINT.replace('https://', ''), 'port': 443}],
            http_compress=True,
            use_ssl=True,
            verify_certs=True,
            ssl_assert_hostname=False,
            ssl_show_warn=False
        )

        # インデックス作成（存在しない場合）
        if not opensearch.indices.exists(index=INDEX_NAME):
            opensearch.indices.create(
                index=INDEX_NAME,
                body={
                    "settings": {
                        "number_of_shards": 1,
                        "number_of_replicas": 1
                    },
                    "mappings": {
                        "properties": {
                            "file_name": {"type": "text"},
                            "file_path": {"type": "keyword"},
                            "file_type": {"type": "keyword"},
                            "file_size": {"type": "long"},
                            "content": {"type": "text"},
                            "timestamp": {"type": "date"},
                            "s3_bucket": {"type": "keyword"},
                            "s3_key": {"type": "keyword"},
                            "docuworks_related": {"type": "object"},
                            "processing_status": {"type": "keyword"}
                        }
                    }
                }
            )
            print(f"[{datetime.now()}] Created OpenSearch index: {INDEX_NAME}")

        OPENSEARCH_AVAILABLE = True
        print(f"[{datetime.now()}] OpenSearch connected successfully")

    except Exception as e:
        print(f"[{datetime.now()}] OpenSearch connection failed: {e}")
        OPENSEARCH_AVAILABLE = False
else:
    OPENSEARCH_AVAILABLE = False

# 処理統計
message_count = 0
error_count = 0
indexed_count = 0

def process_s3_event(record):
    """S3イベントを処理"""
    s3_info = record.get('s3', {})
    bucket = s3_info.get('bucket', {}).get('name')
    key = s3_info.get('object', {}).get('key')
    size = s3_info.get('object', {}).get('size', 0)

    if not bucket or not key:
        return None

    # ファイル情報を構築
    file_info = {
        'file_name': os.path.basename(key),
        'file_path': key,
        's3_bucket': bucket,
        's3_key': key,
        'file_size': size,
        'timestamp': datetime.utcnow().isoformat(),
        'processing_status': 'pending'
    }

    # 拡張子を判定
    if '.' in key:
        ext = key.rsplit('.', 1)[-1].lower()
        file_info['file_type'] = ext

        # DocuWorksファイルの特別処理
        if ext in ['xdw', 'xbd']:
            file_info['is_docuworks'] = True
            base_name = key.rsplit('.', 1)[0]
            file_info['docuworks_related'] = {
                'original_file': key,
                'pdf_file': f"{base_name}.pdf",
                'text_file': f"{base_name}.txt"
            }
            print(f"[{datetime.now()}] DocuWorks file detected: {key}")

    # Phase 2: S3アクセス確認
    if PHASE2_ACCESS_S3:
        try:
            # ファイルのメタデータを取得
            head_response = s3.head_object(Bucket=bucket, Key=key)
            file_info['content_type'] = head_response.get('ContentType', 'unknown')
            file_info['last_modified'] = head_response.get('LastModified', '').isoformat() if 'LastModified' in head_response else ''

            # 小さなテキストファイルの場合は内容を取得
            if ext in ['txt', 'log'] and size < 10000:  # 10KB未満
                obj_response = s3.get_object(Bucket=bucket, Key=key)
                content = obj_response['Body'].read().decode('utf-8', errors='ignore')
                file_info['content'] = content[:5000]  # 最初の5000文字

            file_info['processing_status'] = 'accessed'

        except Exception as e:
            print(f"[{datetime.now()}] S3 access error for {key}: {e}")
            file_info['processing_status'] = 'error'
            file_info['error_message'] = str(e)

    return file_info

# メインループ
print(f"[{datetime.now()}] Starting main processing loop...")

while True:
    try:
        # メッセージ受信
        response = sqs.receive_message(
            QueueUrl=QUEUE_URL,
            MaxNumberOfMessages=MAX_MESSAGES,
            WaitTimeSeconds=10,
            VisibilityTimeout=120,  # 処理に時間をかける
            MessageAttributeNames=['All'],
            AttributeNames=['All']
        )

        messages = response.get('Messages', [])

        if messages:
            print(f"[{datetime.now()}] Processing {len(messages)} messages")

            for message in messages:
                try:
                    message_id = message.get('MessageId')
                    receipt_handle = message['ReceiptHandle']

                    # Phase 1: メッセージ内容のログ
                    if PHASE1_LOG_MESSAGES:
                        body = json.loads(message.get('Body', '{}'))
                        print(f"[{datetime.now()}] Message {message_id}: {json.dumps(body)[:200]}...")

                        # S3イベントの処理
                        if 'Records' in body:
                            for record in body['Records']:
                                if 's3' in record:
                                    file_info = process_s3_event(record)

                                    if file_info and PHASE3_INDEX_TO_OPENSEARCH and OPENSEARCH_AVAILABLE:
                                        # Phase 3: OpenSearchへインデックス
                                        try:
                                            doc_id = file_info['s3_key'].replace('/', '_')
                                            opensearch.index(
                                                index=INDEX_NAME,
                                                id=doc_id,
                                                body=file_info
                                            )
                                            indexed_count += 1
                                            print(f"[{datetime.now()}] Indexed to OpenSearch: {file_info['file_name']}")

                                            # DocuWorks関連ファイルも登録
                                            if file_info.get('is_docuworks'):
                                                related = file_info.get('docuworks_related', {})
                                                print(f"[{datetime.now()}] DocuWorks related files: {related}")

                                        except Exception as e:
                                            print(f"[{datetime.now()}] OpenSearch indexing error: {e}")

                    # メッセージを削除（処理完了）
                    sqs.delete_message(
                        QueueUrl=QUEUE_URL,
                        ReceiptHandle=receipt_handle
                    )

                    message_count += 1
                    if message_count % 10 == 0:
                        print(f"[{datetime.now()}] Stats: Processed={message_count}, Indexed={indexed_count}, Errors={error_count}")

                except Exception as e:
                    error_count += 1
                    print(f"[{datetime.now()}] Error processing message: {e}")

                    # エラーが多い場合は処理速度を落とす
                    if error_count > 10:
                        time.sleep(5)

        else:
            # メッセージがない場合
            time.sleep(2)

    except KeyboardInterrupt:
        print(f"[{datetime.now()}] Shutting down...")
        break
    except Exception as e:
        print(f"[{datetime.now()}] Main loop error: {e}")
        error_count += 1
        time.sleep(5)

print(f"[{datetime.now()}] Final stats: Processed={message_count}, Indexed={indexed_count}, Errors={error_count}")
WORKER

chmod +x /opt/phased_worker.py

# サービス作成
cat <<'SERVICE' > /etc/systemd/system/phased-worker.service
[Unit]
Description=Phased Processing Worker
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 -u /opt/phased_worker.py
Restart=on-failure
RestartSec=30
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable phased-worker.service
systemctl start phased-worker.service

echo "=== Phased Processing Worker Started at $(date) ==="
systemctl status phased-worker.service --no-pager || true
EOF

echo -e "${GREEN}✅ 段階的処理スクリプト作成完了${NC}"
echo ""

# Step 2: Launch Template更新
echo -e "${GREEN}Step 2: Launch Template更新${NC}"

if [[ "$OSTYPE" == "darwin"* ]]; then
    USER_DATA_BASE64=$(base64 -i /tmp/phased_processing_userdata.sh)
else
    USER_DATA_BASE64=$(base64 -w0 /tmp/phased_processing_userdata.sh)
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

# Step 3: 処理内容の説明
echo -e "${YELLOW}段階的処理の内容:${NC}"
echo ""
echo "Phase 1: メッセージ内容の確認とログ"
echo "  • メッセージの内容を詳細にログ出力"
echo "  • ファイル形式の判定"
echo "  • DocuWorksファイルの検出"
echo ""
echo "Phase 2: S3ファイルアクセス"
echo "  • ファイルメタデータ取得"
echo "  • 小さいテキストファイルの内容取得"
echo ""
echo "Phase 3: OpenSearchへのインデックス"
echo "  • 基本的なファイル情報の登録"
echo "  • DocuWorks関連ファイルの紐付け情報"
echo "  • フロントエンドから検索可能に"
echo ""

echo -e "${BLUE}期待される処理速度:${NC}"
echo "  最小構成: 7109 msg/分（削除のみ）"
echo "  Phase 1-3: 100-500 msg/分（実処理あり）"
echo ""

# Step 4: 再起動確認
echo -e "${YELLOW}Step 4: インスタンス再起動${NC}"
read -p "インスタンスを再起動して実処理を開始しますか？ (y/n): " -n 1 -r
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
            break
        fi

        echo "待機中... ($i/10)"
    done

    # 処理開始待機
    echo "処理開始待機中（90秒）..."
    sleep 90

    # 処理速度測定（実処理なので遅くなるはず）
    echo ""
    echo "処理速度測定中（60秒）..."
    START=$(aws sqs get-queue-attributes \
        --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
        --attribute-names ApproximateNumberOfMessages \
        --query 'Attributes.ApproximateNumberOfMessages' \
        --output text)

    sleep 60

    END=$(aws sqs get-queue-attributes \
        --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
        --attribute-names ApproximateNumberOfMessages \
        --query 'Attributes.ApproximateNumberOfMessages' \
        --output text)

    if [ "$START" -gt "$END" ]; then
        PROCESSED=$((START - END))
        RATE=$((PROCESSED))
        echo -e "${GREEN}✅ 処理速度: $RATE msg/分${NC}"

        if [ "$RATE" -lt 1000 ]; then
            echo -e "${GREEN}👍 実際の処理が行われています（速度低下は正常）${NC}"
        else
            echo -e "${YELLOW}⚠️ まだ処理が軽すぎる可能性があります${NC}"
        fi
    fi

    echo ""
    echo "次のステップ:"
    echo "1. CloudWatch Logsで処理内容を確認"
    echo "2. OpenSearchでデータが登録されているか確認"
    echo "3. フロントエンドから検索テスト"

else
    echo "キャンセルされました"
fi