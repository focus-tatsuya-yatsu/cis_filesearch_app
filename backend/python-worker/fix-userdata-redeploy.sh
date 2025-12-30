#!/bin/bash
# User Data修正版の再デプロイスクリプト
set -e

echo "🔧 User Data修正版を作成中..."

# 正しいOpenSearchエンドポイント設定
export OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"

# 修正版User Dataスクリプト作成
cat > /tmp/fixed_userdata.sh << 'EOF'
#!/bin/bash
set -e
set -x

exec > >(tee /var/log/user-data.log)
exec 2>&1

echo "=== User Data Script Started at $(date) ==="

export AWS_REGION="ap-northeast-1"
export S3_BUCKET="cis-filesearch-worker-scripts"
export SQS_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
export DLQ_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq"
export OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"

yum update -y
yum install -y python3 python3-pip

pip3 install boto3 opensearch-py requests pillow PyPDF2

mkdir -p /opt/worker
cd /opt/worker

aws s3 cp s3://${S3_BUCKET}/scripts/worker.py /opt/worker/worker.py --region ${AWS_REGION}
aws s3 cp s3://${S3_BUCKET}/scripts/config.py /opt/worker/config.py --region ${AWS_REGION} || true
aws s3 cp s3://${S3_BUCKET}/scripts/file_router.py /opt/worker/file_router.py --region ${AWS_REGION} || true
aws s3 cp s3://${S3_BUCKET}/scripts/opensearch_client.py /opt/worker/opensearch_client.py --region ${AWS_REGION} || true

chmod +x /opt/worker/worker.py

cat <<'EOFSERVICE' > /etc/systemd/system/worker.service
[Unit]
Description=File Processing Worker (FIXED)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/worker
ExecStart=/usr/bin/python3 /opt/worker/worker.py
Restart=always
RestartSec=10
Environment="AWS_REGION=ap-northeast-1"
Environment="SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
Environment="DLQ_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq"
Environment="OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
Environment="LOG_LEVEL=INFO"

[Install]
WantedBy=multi-user.target
EOFSERVICE

systemctl daemon-reload
systemctl enable worker.service
systemctl start worker.service

sleep 5
systemctl status worker.service --no-pager

echo "=== User Data Script Completed at $(date) ==="
EOF

echo "✅ 修正版User Dataスクリプト作成完了"

# Launch Template新バージョン作成
echo "📝 Launch Template新バージョン作成中..."

if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    USER_DATA_BASE64=$(base64 -i /tmp/fixed_userdata.sh)
else
    # Linux
    USER_DATA_BASE64=$(base64 -w0 /tmp/fixed_userdata.sh)
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
echo "🎉 修正版デプロイ完了！"
echo ""
echo "次のステップ:"
echo "1. 5分後にSQSメッセージが減少しているか確認"
echo "2. CloudWatch Logsでworkerログを確認:"
echo "   aws logs tail /aws/ec2/cis-filesearch-processor/application --follow --region ap-northeast-1"
echo ""
