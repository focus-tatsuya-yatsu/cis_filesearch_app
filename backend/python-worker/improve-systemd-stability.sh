#!/bin/bash
# systemd安定性改善スクリプト - 再起動制限追加
set -e

echo "🔧 systemd設定を改善して安定性を向上させます"

# 改善版User Dataスクリプト作成
cat > /tmp/improved_userdata.sh << 'EOF'
#!/bin/bash
set +e  # エラーでも継続

exec > >(tee /var/log/user-data.log)
exec 2>&1

echo "=== Improved User Data Script Started at $(date) ==="

# 環境変数設定
export AWS_REGION="ap-northeast-1"
export S3_BUCKET="cis-filesearch-worker-scripts"
export SQS_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
export DLQ_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq"
export OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"

echo "Step 1: System setup"
yum update -y || true
yum install -y python3 python3-pip || true

echo "Step 2: Install Python packages"
pip3 install boto3 --ignore-installed || true
pip3 install opensearch-py --ignore-installed || true
pip3 install pillow --ignore-installed || true
pip3 install PyPDF2 --ignore-installed || true

echo "Step 3: Download scripts from S3"
mkdir -p /opt/worker
cd /opt/worker
aws s3 cp s3://${S3_BUCKET}/scripts/worker.py /opt/worker/worker.py --region ${AWS_REGION}
aws s3 cp s3://${S3_BUCKET}/scripts/config.py /opt/worker/config.py --region ${AWS_REGION} || true
aws s3 cp s3://${S3_BUCKET}/scripts/file_router.py /opt/worker/file_router.py --region ${AWS_REGION} || true
aws s3 cp s3://${S3_BUCKET}/scripts/opensearch_client.py /opt/worker/opensearch_client.py --region ${AWS_REGION} || true

chmod +x /opt/worker/worker.py

echo "Step 4: Create IMPROVED systemd service with restart limits"
cat <<'EOFSERVICE' > /etc/systemd/system/worker.service
[Unit]
Description=File Processing Worker (IMPROVED STABILITY)
After=network.target
# 再起動制限：10分間に5回までの再起動を許可
StartLimitIntervalSec=600
StartLimitBurst=5

[Service]
Type=simple
User=root
WorkingDirectory=/opt/worker
ExecStart=/usr/bin/python3 /opt/worker/worker.py

# 再起動設定
Restart=on-failure
RestartSec=30
# タイムアウト設定（15分 = VisibilityTimeout）
TimeoutStartSec=900
TimeoutStopSec=30

# リソース制限（メモリリーク対策）
MemoryMax=2G
MemorySwapMax=0

# ログ設定
StandardOutput=journal
StandardError=journal

# 環境変数
Environment="AWS_REGION=ap-northeast-1"
Environment="SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
Environment="DLQ_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq"
Environment="OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
Environment="PYTHONUNBUFFERED=1"
Environment="LOG_LEVEL=INFO"

[Install]
WantedBy=multi-user.target
EOFSERVICE

echo "Step 5: Create monitoring script"
cat <<'EOFMON' > /opt/worker/monitor.sh
#!/bin/bash
# 簡易モニタリングスクリプト
while true; do
    STATUS=$(systemctl is-active worker.service)
    if [ "$STATUS" != "active" ]; then
        echo "$(date): Worker service is $STATUS" >> /var/log/worker-monitor.log

        # 再起動制限に達した場合の処理
        if [ "$STATUS" = "failed" ]; then
            echo "$(date): Worker service failed - checking restart limit" >> /var/log/worker-monitor.log
            systemctl status worker.service --no-pager >> /var/log/worker-monitor.log 2>&1

            # 5分待ってから再度試行
            sleep 300
            systemctl reset-failed worker.service
            systemctl start worker.service
        fi
    fi
    sleep 60
done
EOFMON

chmod +x /opt/worker/monitor.sh

echo "Step 6: Start services"
systemctl daemon-reload
systemctl enable worker.service
systemctl start worker.service

# モニタリングスクリプトをバックグラウンドで実行
nohup /opt/worker/monitor.sh > /dev/null 2>&1 &

sleep 5
systemctl status worker.service --no-pager

echo "=== Improved User Data Script Completed at $(date) ==="

# DLQメッセージを定期的にチェック
cat <<'EOFDLQ' > /opt/worker/check-dlq.sh
#!/bin/bash
# DLQチェックスクリプト（1時間ごとに実行）
DLQ_COUNT=$(aws sqs get-queue-attributes \
    --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq \
    --attribute-names ApproximateNumberOfMessages \
    --region ap-northeast-1 \
    --query 'Attributes.ApproximateNumberOfMessages' \
    --output text)

if [ "$DLQ_COUNT" -gt 1000 ]; then
    echo "$(date): WARNING - DLQ has $DLQ_COUNT messages" >> /var/log/dlq-warning.log
fi
EOFDLQ

chmod +x /opt/worker/check-dlq.sh

# crontabに追加
echo "0 * * * * /opt/worker/check-dlq.sh" | crontab -

EOF

echo "✅ 改善版User Dataスクリプト作成完了"
echo ""
echo "主な改善点:"
echo "  ✅ 再起動制限追加（10分間に5回まで）"
echo "  ✅ メモリ制限追加（2GBまで）"
echo "  ✅ 再起動間隔を30秒に延長"
echo "  ✅ モニタリングスクリプト追加"
echo "  ✅ DLQ監視機能追加"
echo ""
echo "デプロイするには以下を実行:"
echo "  1. このスクリプトでLaunch Template更新"
echo "  2. 現在のEC2インスタンスを再起動"
echo ""
echo "続行しますか？ (y/n)"