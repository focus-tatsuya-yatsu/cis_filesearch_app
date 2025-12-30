#!/bin/bash
# 最終修正版デプロイスクリプト - pip installエラーを回避
set -e

echo "🚨 最終修正版デプロイ開始..."
echo "pip installエラーを回避する修正版を適用します"

# 修正版User Dataスクリプト作成（エラーを無視）
cat > /tmp/final_userdata.sh << 'EOF'
#!/bin/bash
# エラーが発生しても継続する設定
set +e

exec > >(tee /var/log/user-data.log)
exec 2>&1

echo "=== User Data Script Started at $(date) ==="

# 環境変数設定
export AWS_REGION="ap-northeast-1"
export S3_BUCKET="cis-filesearch-worker-scripts"
export SQS_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
export DLQ_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq"
export OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"

echo "Step 1: System update"
yum update -y || true

echo "Step 2: Install Python"
yum install -y python3 python3-pip || true

echo "Step 3: Install Python packages (ignore errors)"
# requestsパッケージの競合を回避
pip3 install boto3 --ignore-installed || true
pip3 install opensearch-py --ignore-installed || true
pip3 install pillow --ignore-installed || true
pip3 install PyPDF2 --ignore-installed || true

echo "Step 4: Create work directory"
mkdir -p /opt/worker
cd /opt/worker

echo "Step 5: Download scripts from S3"
aws s3 cp s3://${S3_BUCKET}/scripts/worker.py /opt/worker/worker.py --region ${AWS_REGION}
if [ $? -ne 0 ]; then
  echo "ERROR: Failed to download worker.py from S3"
  exit 1
fi

aws s3 cp s3://${S3_BUCKET}/scripts/config.py /opt/worker/config.py --region ${AWS_REGION} || true
aws s3 cp s3://${S3_BUCKET}/scripts/file_router.py /opt/worker/file_router.py --region ${AWS_REGION} || true
aws s3 cp s3://${S3_BUCKET}/scripts/opensearch_client.py /opt/worker/opensearch_client.py --region ${AWS_REGION} || true

echo "Step 6: Set permissions"
chmod +x /opt/worker/worker.py

echo "Step 7: Create systemd service"
cat <<'EOFSERVICE' > /etc/systemd/system/worker.service
[Unit]
Description=File Processing Worker (FIXED VERSION)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/worker
ExecStart=/usr/bin/python3 /opt/worker/worker.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment="AWS_REGION=ap-northeast-1"
Environment="SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
Environment="DLQ_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq"
Environment="OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
Environment="LOG_LEVEL=INFO"

[Install]
WantedBy=multi-user.target
EOFSERVICE

echo "Step 8: Start service"
systemctl daemon-reload
systemctl enable worker.service
systemctl start worker.service

# ステータス確認
sleep 5
systemctl status worker.service --no-pager

echo "Step 9: Verify worker is running"
ps aux | grep worker.py | grep -v grep

echo "=== User Data Script Completed at $(date) ==="

# CloudWatch Logsエージェント設定
cat <<'EOFCWL' > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/user-data.log",
            "log_group_name": "/aws/ec2/cis-filesearch-processor/userdata",
            "log_stream_name": "{instance_id}"
          }
        ]
      }
    }
  }
}
EOFCWL

# CloudWatch Logsエージェント再起動
systemctl restart amazon-cloudwatch-agent || true

EOF

echo "✅ 最終修正版User Dataスクリプト作成完了"

# Launch Template新バージョン作成
echo "📝 Launch Template新バージョン作成中..."

if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    USER_DATA_BASE64=$(base64 -i /tmp/final_userdata.sh)
else
    # Linux
    USER_DATA_BASE64=$(base64 -w0 /tmp/final_userdata.sh)
fi

NEW_VERSION=$(aws ec2 create-launch-template-version \
  --launch-template-name cis-filesearch-worker-template \
  --source-version '$Latest' \
  --launch-template-data "{\"UserData\":\"${USER_DATA_BASE64}\"}" \
  --region ap-northeast-1 \
  --query 'LaunchTemplateVersion.VersionNumber' \
  --output text)

echo "✅ 新バージョン作成: $NEW_VERSION"

# デフォルトバージョン更新
echo "📌 デフォルトバージョンを $NEW_VERSION に更新中..."

aws ec2 modify-launch-template \
  --launch-template-name cis-filesearch-worker-template \
  --default-version $NEW_VERSION \
  --region ap-northeast-1 > /dev/null

echo "✅ デフォルトバージョン更新完了"

# 現在のインスタンスIDを取得
echo "🔍 現在のインスタンスIDを取得中..."

CURRENT_INSTANCE=$(aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names cis-filesearch-ec2-autoscaling \
  --region ap-northeast-1 \
  --query 'AutoScalingGroups[0].Instances[0].InstanceId' \
  --output text)

echo "現在のインスタンス: $CURRENT_INSTANCE"

# インスタンス入れ替え
echo "🔄 インスタンス入れ替え中..."

aws autoscaling terminate-instance-in-auto-scaling-group \
  --instance-id $CURRENT_INSTANCE \
  --no-should-decrement-desired-capacity \
  --region ap-northeast-1 > /dev/null

echo "✅ インスタンス終了リクエスト送信完了"

# 新インスタンス起動監視
echo "⏳ 新インスタンスの起動を監視中（最大5分）..."

for i in {1..10}; do
  sleep 30

  NEW_INSTANCE=$(aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names cis-filesearch-ec2-autoscaling \
    --region ap-northeast-1 \
    --query 'AutoScalingGroups[0].Instances[?LifecycleState==`InService`].InstanceId' \
    --output text)

  if [ -n "$NEW_INSTANCE" ]; then
    echo "✅ 新インスタンス起動完了: $NEW_INSTANCE"
    break
  fi

  echo "待機中... ($i/10)"
done

if [ -z "$NEW_INSTANCE" ]; then
  echo "❌ 新インスタンスの起動を確認できませんでした"
  exit 1
fi

# 少し待ってからログ確認
echo "⏳ User Dataスクリプトの実行を待機中（60秒）..."
sleep 60

# SQSメッセージ数確認
echo ""
echo "📊 SQSメッセージ数確認"
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
  --region ap-northeast-1 \
  --query 'Attributes' \
  --output table

echo ""
echo "🎉 最終修正版デプロイ完了！"
echo ""
echo "重要な変更点:"
echo "  ✅ pip installエラーを無視して続行"
echo "  ✅ systemdサービスにログ出力設定を追加"
echo "  ✅ プロセス確認を追加"
echo ""
echo "次のステップ:"
echo "1. 2-3分待ってから、SQSメッセージが減少しているか確認"
echo "2. コンソール出力を確認:"
echo "   aws ec2 get-console-output --instance-id $NEW_INSTANCE --region ap-northeast-1 --output text | tail -100"
echo ""