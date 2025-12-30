#!/bin/bash
# 現在のインスタンス診断スクリプト（Auto Scaling Group対応）
set +e  # エラーでも続行

echo "======================================"
echo "Current Instance Diagnostic"
echo "======================================"
echo ""

# AWS設定
export AWS_PROFILE=AdministratorAccess-770923989980
export AWS_REGION=ap-northeast-1

# 色設定
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Auto Scaling Groupから現在のインスタンスを自動取得
echo -e "${BLUE}[1/10] Getting current instance from Auto Scaling Group...${NC}"
INSTANCE_ID=$(aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names cis-filesearch-ec2-autoscaling \
    --query 'AutoScalingGroups[0].Instances[0].InstanceId' \
    --output text)

if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then
    echo -e "${RED}ERROR: No instance found in Auto Scaling Group${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Found instance: $INSTANCE_ID${NC}"

# インスタンス詳細取得
echo ""
echo -e "${BLUE}[2/10] Getting instance details...${NC}"
INSTANCE_INFO=$(aws ec2 describe-instances \
    --instance-ids $INSTANCE_ID \
    --query 'Reservations[0].Instances[0]' \
    --output json)

STATE=$(echo $INSTANCE_INFO | jq -r '.State.Name')
PRIVATE_IP=$(echo $INSTANCE_INFO | jq -r '.PrivateIpAddress')
PUBLIC_IP=$(echo $INSTANCE_INFO | jq -r '.PublicIpAddress // "None"')
SPOT_REQUEST=$(echo $INSTANCE_INFO | jq -r '.SpotInstanceRequestId // "Not a spot instance"')
LAUNCH_TIME=$(echo $INSTANCE_INFO | jq -r '.LaunchTime')

echo "Instance ID: $INSTANCE_ID"
echo "State: $STATE"
echo "Private IP: $PRIVATE_IP"
echo "Public IP: $PUBLIC_IP"
echo "Spot Request: $SPOT_REQUEST"
echo "Launch Time: $LAUNCH_TIME"

if [ "$STATE" != "running" ]; then
    echo -e "${RED}ERROR: Instance is not running (state: $STATE)${NC}"
    exit 1
fi

# SQS状態確認
echo ""
echo -e "${BLUE}[3/10] Checking SQS queue status...${NC}"
QUEUE_MSG=$(aws sqs get-queue-attributes \
    --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
    --attribute-names ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible \
    --query 'Attributes' \
    --output json)

echo "Main Queue Messages: $(echo $QUEUE_MSG | jq -r '.ApproximateNumberOfMessages')"
echo "In Flight Messages: $(echo $QUEUE_MSG | jq -r '.ApproximateNumberOfMessagesNotVisible')"

DLQ_MSG=$(aws sqs get-queue-attributes \
    --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq \
    --attribute-names ApproximateNumberOfMessages \
    --query 'Attributes.ApproximateNumberOfMessages' \
    --output text)

echo "DLQ Messages: $DLQ_MSG"

# 処理速度測定（30秒）
echo ""
echo -e "${BLUE}[4/10] Measuring processing speed (30 seconds)...${NC}"
START_COUNT=$(aws sqs get-queue-attributes \
    --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
    --attribute-names ApproximateNumberOfMessages \
    --query 'Attributes.ApproximateNumberOfMessages' \
    --output text)

echo "Start count: $START_COUNT"
echo "Waiting 30 seconds..."
sleep 30

END_COUNT=$(aws sqs get-queue-attributes \
    --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
    --attribute-names ApproximateNumberOfMessages \
    --query 'Attributes.ApproximateNumberOfMessages' \
    --output text)

echo "End count: $END_COUNT"

if [ "$START_COUNT" -gt "$END_COUNT" ]; then
    PROCESSED=$((START_COUNT - END_COUNT))
    RATE=$((PROCESSED * 2))  # per minute
    echo -e "${GREEN}✓ Processing: $PROCESSED messages in 30 seconds ($RATE msg/min)${NC}"
else
    echo -e "${RED}⚠ No processing detected or messages increased${NC}"
fi

# コンソール出力取得（systemd状態確認）
echo ""
echo -e "${BLUE}[5/10] Getting console output (systemd status)...${NC}"
aws ec2 get-console-output \
    --instance-id $INSTANCE_ID \
    --latest \
    --query 'Output' \
    --output text > /tmp/console_output_$INSTANCE_ID.txt 2>/dev/null

if [ -f /tmp/console_output_$INSTANCE_ID.txt ]; then
    echo "Checking for systemd service status..."
    grep -A5 "worker.service" /tmp/console_output_$INSTANCE_ID.txt | tail -20 || echo "No worker.service entries found"

    echo ""
    echo "Checking for Python errors..."
    grep -E "ERROR|CRITICAL|Traceback|ImportError|ModuleNotFoundError" /tmp/console_output_$INSTANCE_ID.txt | tail -20 || echo "No critical errors found"
else
    echo -e "${YELLOW}⚠ Could not retrieve console output${NC}"
fi

# CloudWatch Logsチェック（もし設定されていれば）
echo ""
echo -e "${BLUE}[6/10] Checking CloudWatch Logs...${NC}"
LOG_GROUPS=$(aws logs describe-log-groups \
    --log-group-name-prefix "/aws/ec2" \
    --query 'logGroups[].logGroupName' \
    --output text 2>/dev/null)

if [ -n "$LOG_GROUPS" ]; then
    echo "Found log groups: $LOG_GROUPS"
    # 最新のログを取得
    for GROUP in $LOG_GROUPS; do
        echo "Checking $GROUP..."
        aws logs tail $GROUP --since 5m 2>/dev/null | head -20
    done
else
    echo "No CloudWatch Logs configured for this instance"
fi

# SSMエージェント状態確認
echo ""
echo -e "${BLUE}[7/10] Checking SSM Agent status...${NC}"
SSM_STATUS=$(aws ssm describe-instance-information \
    --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
    --query 'InstanceInformationList[0].PingStatus' \
    --output text 2>/dev/null || echo "Not Available")

echo "SSM Agent Status: $SSM_STATUS"

if [ "$SSM_STATUS" = "Online" ]; then
    echo -e "${GREEN}✓ SSM is available for remote commands${NC}"
else
    echo -e "${YELLOW}⚠ SSM not available - manual SSH required${NC}"
    echo "Use: ssh -i ~/.ssh/your-key.pem ec2-user@$PRIVATE_IP (via bastion/VPN)"
fi

# メモリとCPU使用率（CloudWatch Metrics）
echo ""
echo -e "${BLUE}[8/10] Checking resource metrics...${NC}"
END_TIME=$(date -u +"%Y-%m-%dT%H:%M:%S")
START_TIME=$(date -u -d '5 minutes ago' +"%Y-%m-%dT%H:%M:%S" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%S")

CPU_USAGE=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/EC2 \
    --metric-name CPUUtilization \
    --dimensions Name=InstanceId,Value=$INSTANCE_ID \
    --start-time $START_TIME \
    --end-time $END_TIME \
    --period 300 \
    --statistics Average \
    --query 'Datapoints[0].Average' \
    --output text 2>/dev/null || echo "N/A")

echo "Average CPU Usage (last 5 min): $CPU_USAGE%"

# Launch Template確認
echo ""
echo -e "${BLUE}[9/10] Checking Launch Template version...${NC}"
LATEST_VERSION=$(aws ec2 describe-launch-template-versions \
    --launch-template-name cis-filesearch-worker-template \
    --versions '$Latest' \
    --query 'LaunchTemplateVersions[0].VersionNumber' \
    --output text)

DEFAULT_VERSION=$(aws ec2 describe-launch-template-versions \
    --launch-template-name cis-filesearch-worker-template \
    --versions '$Default' \
    --query 'LaunchTemplateVersions[0].VersionNumber' \
    --output text)

echo "Latest Launch Template Version: $LATEST_VERSION"
echo "Default Launch Template Version: $DEFAULT_VERSION"

if [ "$LATEST_VERSION" != "$DEFAULT_VERSION" ]; then
    echo -e "${YELLOW}⚠ Default version is not the latest. Consider updating.${NC}"
fi

# 診断サマリー
echo ""
echo "======================================"
echo -e "${GREEN}Diagnostic Summary${NC}"
echo "======================================"

# 処理状態判定
if [ "$RATE" -gt 0 ]; then
    echo -e "${GREEN}✓ Worker is processing messages${NC}"
    echo "  Rate: $RATE messages/minute"

    if [ "$RATE" -lt 100 ]; then
        echo -e "${YELLOW}  ⚠ Processing rate is low (expected: 200-500 msg/min)${NC}"
    elif [ "$RATE" -lt 200 ]; then
        echo -e "${YELLOW}  ⚠ Processing rate is below optimal (expected: 300-500 msg/min)${NC}"
    else
        echo -e "${GREEN}  ✓ Processing rate is good${NC}"
    fi
else
    echo -e "${RED}✗ Worker appears to be not processing messages${NC}"
fi

# スポットインスタンス警告
if [ "$SPOT_REQUEST" != "Not a spot instance" ]; then
    echo -e "${YELLOW}⚠ This is a SPOT instance - may be interrupted${NC}"
    echo "  Consider using On-Demand for critical workloads"
fi

# DLQ警告
if [ "$DLQ_MSG" -gt 1000 ]; then
    echo -e "${YELLOW}⚠ High DLQ message count: $DLQ_MSG${NC}"
    echo "  Consider investigating failed messages"
fi

# 推奨アクション
echo ""
echo "======================================"
echo -e "${BLUE}Recommended Actions${NC}"
echo "======================================"

if [ "$RATE" -lt 200 ] || [ "$RATE" -eq 0 ]; then
    echo "1. Check worker logs for errors:"
    echo "   - Use SSM if available"
    echo "   - Or SSH to $PRIVATE_IP"
    echo ""
    echo "2. Review systemd service status:"
    echo "   sudo systemctl status worker.service"
    echo ""
    echo "3. Check for Python import errors:"
    echo "   sudo journalctl -u worker.service -n 100"
fi

if [ "$DLQ_MSG" -gt 1000 ]; then
    echo ""
    echo "4. Analyze DLQ messages:"
    echo "   aws sqs receive-message --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq --max-number-of-messages 10"
fi

echo ""
echo "======================================"
echo "Diagnostic Complete"
echo "======================================"