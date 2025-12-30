#!/bin/bash
# scripts/user-data.sh.tpl
# EC2起動時に実行されるUser Dataスクリプト (Terraform Template)

set -euo pipefail

# ログファイル
exec > >(tee -a /var/log/user-data.log)
exec 2>&1

echo "==================================="
echo "User Data Execution Started"
echo "Date: $(date)"
echo "==================================="

# 1. 環境変数の設定
echo "[1/6] Setting environment variables..."
cat << 'EOF' > /etc/file-processor/env
AWS_REGION="${aws_region}"
S3_BUCKET="${s3_bucket}"
SQS_QUEUE_URL="${sqs_queue_url}"
OPENSEARCH_ENDPOINT="${opensearch_endpoint}"
OPENSEARCH_INDEX="${opensearch_index}"
LOG_LEVEL="${log_level}"
TEMP_DIR="/tmp/file-processor"
MAX_FILE_SIZE_MB="100"
MAX_WORKERS="4"
PROCESSING_TIMEOUT="300"
CLOUDWATCH_LOG_GROUP="${cloudwatch_log_group}"
EOF

chmod 600 /etc/file-processor/env
source /etc/file-processor/env

# 2. インスタンスメタデータの取得
echo "[2/6] Retrieving instance metadata..."
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
INSTANCE_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
AZ=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/availability-zone)
REGION=$(echo $AZ | sed 's/[a-z]$//')

echo "Instance ID: $INSTANCE_ID"
echo "Availability Zone: $AZ"
echo "Region: $REGION"

# 3. CloudWatch Agentの起動
echo "[3/6] Starting CloudWatch Agent..."
# CloudWatch Agent設定を動的に生成
cat << EOF > /opt/aws/amazon-cloudwatch-agent/etc/cloudwatch-config.json
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/log/file-processor.log",
            "log_group_name": "${cloudwatch_log_group}",
            "log_stream_name": "$INSTANCE_ID",
            "timezone": "Local"
          },
          {
            "file_path": "/var/log/user-data.log",
            "log_group_name": "${cloudwatch_log_group}",
            "log_stream_name": "$INSTANCE_ID-userdata",
            "timezone": "Local"
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "FileProcessor",
    "metrics_collected": {
      "cpu": {
        "measurement": [{"name": "cpu_usage_idle", "rename": "CPU_IDLE", "unit": "Percent"}],
        "totalcpu": false
      },
      "disk": {
        "measurement": [{"name": "used_percent", "rename": "DISK_USED", "unit": "Percent"}],
        "resources": ["/"]
      },
      "mem": {
        "measurement": [{"name": "mem_used_percent", "rename": "MEM_USED", "unit": "Percent"}]
      }
    },
    "append_dimensions": {
      "InstanceId": "$INSTANCE_ID",
      "InstanceType": "\${aws:InstanceType}",
      "AutoScalingGroupName": "\${aws:AutoScalingGroupName}"
    }
  }
}
EOF

sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -s \
    -c file:/opt/aws/amazon-cloudwatch-agent/etc/cloudwatch-config.json

# 4. ヘルスチェック確認
echo "[4/6] Verifying health..."
python3.11 /app/worker.py --validate-only
if [ $? -ne 0 ]; then
    echo "❌ Configuration validation failed!"
    exit 1
fi

# 5. Worker起動
echo "[5/6] Starting File Processor Worker..."
sudo systemctl start file-processor-worker.service
sudo systemctl status file-processor-worker.service

# 6. 起動確認
echo "[6/6] Verifying worker startup..."
sleep 10
if sudo systemctl is-active --quiet file-processor-worker.service; then
    echo "✅ Worker started successfully"
else
    echo "❌ Worker failed to start"
    sudo journalctl -u file-processor-worker.service -n 50
    exit 1
fi

echo "==================================="
echo "User Data Execution Completed"
echo "Date: $(date)"
echo "==================================="
