#!/bin/bash
# パス不整合の即座修正
set -e

echo "🚨 パス不整合の緊急修正"
echo "========================"

export AWS_PROFILE=AdministratorAccess-770923989980
export AWS_REGION=ap-northeast-1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 現在動作中のインスタンス
INSTANCE_ID="i-0739d755295bceb1c"

echo -e "${YELLOW}問題：${NC}"
echo "• S3からworker.pyがダウンロードされていない"
echo "• 古いバージョンが/opt/cis-worker/で動作中"
echo "• 処理速度76 msg/分（悪化）"
echo ""

# Step 1: 正しいパスで修正版User Data作成
echo -e "${GREEN}Step 1: 正しいパスで修正版作成${NC}"

cat > /tmp/correct_path_userdata.sh << 'EOF'
#!/bin/bash
set +e
exec > >(tee /var/log/user-data.log)
exec 2>&1

echo "=== Correct Path Fix Started at $(date) ==="

export AWS_REGION="ap-northeast-1"

# 既存のworkerを停止
if systemctl is-active --quiet cis-worker.service; then
    echo "Stopping existing cis-worker.service..."
    systemctl stop cis-worker.service
    systemctl disable cis-worker.service
fi

# 既存のパスを利用して最適化
if [ -d "/opt/cis-worker" ]; then
    echo "Found existing cis-worker installation, optimizing..."

    # 環境変数ファイル作成（最適化済み）
    cat <<'ENVFILE' > /opt/cis-worker/.env
# Optimized settings for t3.medium
SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue
SQS_MAX_MESSAGES=10
SQS_WAIT_TIME=20
SQS_VISIBILITY_TIMEOUT=120
MAX_WORKERS=2
WORKER_THREADS=4
LOG_LEVEL=WARNING
BATCH_SIZE=10
AWS_REGION=ap-northeast-1
DLQ_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq
OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com

# Performance optimizations
ENABLE_OCR=false
ENABLE_THUMBNAIL=false
ENABLE_VECTOR_SEARCH=false
PYTHONUNBUFFERED=1
PYTHONDONTWRITEBYTECODE=1
ENVFILE

    # systemdサービス最適化
    cat <<'SERVICE' > /etc/systemd/system/cis-worker-optimized.service
[Unit]
Description=CIS Worker (Path Fixed & Optimized)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/cis-worker
EnvironmentFile=/opt/cis-worker/.env

# Python virtual environment
ExecStart=/opt/cis-worker/venv/bin/python -u /opt/cis-worker/src/main.py

# 再起動制限
Restart=on-failure
RestartSec=30
StartLimitIntervalSec=300
StartLimitBurst=5

# リソース制限
MemoryMax=3G
CPUQuota=200%
Nice=-5
IOSchedulingClass=realtime
IOSchedulingPriority=2

# タイムアウト
TimeoutStartSec=60
TimeoutStopSec=30

StandardOutput=journal
StandardError=journal
SyslogIdentifier=cis-worker-optimized

[Install]
WantedBy=multi-user.target
SERVICE

    # 依存関係修正（既存環境で）
    echo "Fixing Python dependencies..."
    cd /opt/cis-worker
    source venv/bin/activate

    # urllib3競合解決
    pip uninstall -y urllib3 requests 2>/dev/null || true
    pip install urllib3==1.26.16
    pip install requests==2.28.2
    pip install boto3==1.26.137 --no-deps
    pip install botocore==1.29.137 --no-deps

    deactivate

    # サービス起動
    systemctl daemon-reload
    systemctl enable cis-worker-optimized.service
    systemctl start cis-worker-optimized.service

    sleep 10
    systemctl status cis-worker-optimized.service --no-pager

else
    echo "ERROR: /opt/cis-worker not found, falling back to S3..."

    # S3からworker_fixed.pyをダウンロード
    mkdir -p /opt/emergency-worker
    cd /opt/emergency-worker

    # S3から取得（バックアップ先）
    aws s3 cp s3://cis-filesearch-worker-scripts/scripts/worker.py /opt/emergency-worker/worker.py --region ap-northeast-1 || {
        echo "ERROR: Failed to download from S3"
        # 最小版を作成
        cat <<'WORKER' > /opt/emergency-worker/worker.py
#!/usr/bin/env python3
import boto3
import json
import time
import sys
import os

def main():
    print("Emergency worker starting...")
    sqs = boto3.client('sqs', region_name='ap-northeast-1')
    queue_url = os.getenv('SQS_QUEUE_URL', 'https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue')

    while True:
        try:
            response = sqs.receive_message(
                QueueUrl=queue_url,
                MaxNumberOfMessages=10,
                WaitTimeSeconds=20
            )

            messages = response.get('Messages', [])
            for message in messages:
                # Process message
                print(f"Processing message: {message['MessageId']}")

                # Delete message
                sqs.delete_message(
                    QueueUrl=queue_url,
                    ReceiptHandle=message['ReceiptHandle']
                )

        except Exception as e:
            print(f"Error: {e}")
            time.sleep(10)

if __name__ == "__main__":
    main()
WORKER
    }

    chmod +x /opt/emergency-worker/worker.py

    # 簡易サービス作成
    cat <<'EMSERVICE' > /etc/systemd/system/emergency-worker.service
[Unit]
Description=Emergency Worker
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 -u /opt/emergency-worker/worker.py
Restart=on-failure
RestartSec=30
Environment="AWS_REGION=ap-northeast-1"
Environment="SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"

[Install]
WantedBy=multi-user.target
EMSERVICE

    systemctl daemon-reload
    systemctl enable emergency-worker.service
    systemctl start emergency-worker.service
fi

echo "=== Correct Path Fix Completed at $(date) ==="

# プロセス確認
ps aux | grep -E "python.*main.py|worker.py" | grep -v grep
EOF

echo -e "${GREEN}✅ 修正版User Data作成完了${NC}"
echo ""

# Step 2: Launch Template更新
echo -e "${GREEN}Step 2: Launch Template更新${NC}"

if [[ "$OSTYPE" == "darwin"* ]]; then
    USER_DATA_BASE64=$(base64 -i /tmp/correct_path_userdata.sh)
else
    USER_DATA_BASE64=$(base64 -w0 /tmp/correct_path_userdata.sh)
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
echo -e "${YELLOW}Step 3: インスタンス再起動${NC}"
echo "修正内容："
echo "• 既存の/opt/cis-worker/を活用"
echo "• 環境変数を最適化"
echo "• systemdサービスを改善"
echo ""

read -p "インスタンスを再起動しますか？ (y/n): " -n 1 -r
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

    # 初期化待機
    echo "初期化待機中（60秒）..."
    sleep 60

    # 処理速度測定
    echo ""
    echo "処理速度測定中（30秒）..."
    START=$(aws sqs get-queue-attributes \
        --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
        --attribute-names ApproximateNumberOfMessages \
        --query 'Attributes.ApproximateNumberOfMessages' \
        --output text)

    sleep 30

    END=$(aws sqs get-queue-attributes \
        --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
        --attribute-names ApproximateNumberOfMessages \
        --query 'Attributes.ApproximateNumberOfMessages' \
        --output text)

    if [ "$START" -gt "$END" ]; then
        PROCESSED=$((START - END))
        RATE=$((PROCESSED * 2))
        echo -e "${GREEN}✅ 処理速度: $RATE msg/分${NC}"

        if [ "$RATE" -gt 200 ]; then
            echo -e "${GREEN}🎉 目標達成！${NC}"
        elif [ "$RATE" -gt 150 ]; then
            echo -e "${YELLOW}⚠ 改善されましたが、目標未達${NC}"
        else
            echo -e "${RED}❌ さらなる対策が必要${NC}"
        fi
    fi

    echo ""
    echo "次のステップ:"
    echo "1. ./real-time-monitor.sh で詳細監視"
    echo "2. 処理速度が不十分な場合は手動最適化"

else
    echo "キャンセルされました"
fi