#!/bin/bash
# systemdエラーの即座修正とインスタンス再起動
set -e

echo "🚨 systemdエラーの緊急修正を実行"
echo "=================================="

export AWS_PROFILE=AdministratorAccess-770923989980
export AWS_REGION=ap-northeast-1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 修正版User Data（コメントを別行に配置）
cat > /tmp/quick_fix_userdata.sh << 'EOF'
#!/bin/bash
set +e
exec > >(tee /var/log/user-data.log)
exec 2>&1

echo "=== Quick Fix User Data Started at $(date) ==="

export AWS_REGION="ap-northeast-1"
export S3_BUCKET="cis-filesearch-worker-scripts"

# システム準備
yum update -y || true
yum install -y python3 python3-pip || true
pip3 install boto3 opensearch-py pillow PyPDF2 psutil --ignore-installed || true

# スクリプトダウンロード
mkdir -p /opt/worker
cd /opt/worker
aws s3 cp s3://${S3_BUCKET}/scripts/worker.py /opt/worker/worker.py --region ${AWS_REGION}
aws s3 cp s3://${S3_BUCKET}/scripts/config.py /opt/worker/config.py --region ${AWS_REGION} || true
aws s3 cp s3://${S3_BUCKET}/scripts/file_router.py /opt/worker/file_router.py --region ${AWS_REGION} || true
aws s3 cp s3://${S3_BUCKET}/scripts/opensearch_client.py /opt/worker/opensearch_client.py --region ${AWS_REGION} || true
chmod +x /opt/worker/worker.py

# 修正版systemdサービス（コメントを別行に）
cat <<'EOFSERVICE' > /etc/systemd/system/worker.service
[Unit]
Description=CIS File Search Worker
After=network.target
StartLimitIntervalSec=600
StartLimitBurst=3

[Service]
Type=simple
# Security note: Will change to dedicated user later
User=root
WorkingDirectory=/opt/worker
ExecStart=/usr/bin/python3 -u /opt/worker/worker.py
Restart=on-failure
RestartSec=30
MemoryMax=3G
CPUQuota=200%
StandardOutput=journal
StandardError=journal

# Environment variables
Environment="AWS_REGION=ap-northeast-1"
Environment="SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
Environment="DLQ_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq"
Environment="OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
Environment="PYTHONUNBUFFERED=1"
Environment="SQS_MAX_MESSAGES=10"

[Install]
WantedBy=multi-user.target
EOFSERVICE

systemctl daemon-reload
systemctl enable worker.service
systemctl start worker.service

echo "Waiting for service to start..."
sleep 10

# ステータス確認
systemctl status worker.service --no-pager

# プロセス確認
ps aux | grep worker.py | grep -v grep

echo "=== Quick Fix Completed at $(date) ==="
EOF

echo -e "${GREEN}✅ 修正版User Data作成完了${NC}"

# Launch Template新バージョン作成
echo "Launch Template更新中..."

if [[ "$OSTYPE" == "darwin"* ]]; then
    USER_DATA_BASE64=$(base64 -i /tmp/quick_fix_userdata.sh)
else
    USER_DATA_BASE64=$(base64 -w0 /tmp/quick_fix_userdata.sh)
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

# 現在の問題のあるインスタンスを終了
CURRENT_INSTANCE="i-0e19cc464c446afe6"
echo ""
echo -e "${YELLOW}問題のあるインスタンス($CURRENT_INSTANCE)を再起動します${NC}"

aws autoscaling terminate-instance-in-auto-scaling-group \
    --instance-id $CURRENT_INSTANCE \
    --no-should-decrement-desired-capacity > /dev/null

echo "インスタンス終了リクエスト送信..."

# 新インスタンス起動待ち
echo "新インスタンスの起動を待機中..."
for i in {1..10}; do
    sleep 30

    NEW_INSTANCE=$(aws autoscaling describe-auto-scaling-groups \
        --auto-scaling-group-names cis-filesearch-ec2-autoscaling \
        --query 'AutoScalingGroups[0].Instances[?LifecycleState==`InService`].InstanceId' \
        --output text)

    if [ -n "$NEW_INSTANCE" ] && [ "$NEW_INSTANCE" != "$CURRENT_INSTANCE" ]; then
        echo -e "${GREEN}✅ 新インスタンス起動完了: $NEW_INSTANCE${NC}"
        break
    fi

    echo "待機中... ($i/10)"
done

# 60秒待ってから確認
echo "サービス起動待機中（60秒）..."
sleep 60

# SQS確認
echo ""
echo "📊 処理状況確認:"
QUEUE_COUNT=$(aws sqs get-queue-attributes \
    --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
    --attribute-names ApproximateNumberOfMessages \
    --query 'Attributes.ApproximateNumberOfMessages' \
    --output text)

echo "現在のメッセージ数: $(printf "%'d" $QUEUE_COUNT)"

# コンソール出力確認
echo ""
echo "systemdサービス状態確認:"
aws ec2 get-console-output --instance-id $NEW_INSTANCE --output text | grep -A5 "worker.service" | tail -20

echo ""
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}✅ 緊急修正完了！${NC}"
echo -e "${GREEN}================================${NC}"
echo ""
echo "次のステップ:"
echo "1. ./real-time-monitor.sh でメッセージ処理を確認"
echo "2. ログ確認: aws ec2 get-console-output --instance-id $NEW_INSTANCE --output text | tail -100"