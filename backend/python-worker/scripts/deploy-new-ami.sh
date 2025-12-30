#!/bin/bash
# scripts/deploy-new-ami.sh
# ローリングアップデートによるAMI更新

set -euo pipefail

# 引数チェック
if [ $# -eq 0 ]; then
    echo "Usage: $0 <NEW_AMI_ID>"
    echo "Example: $0 ami-0123456789abcdef0"
    exit 1
fi

NEW_AMI_ID=$1
LAUNCH_TEMPLATE_NAME="${LAUNCH_TEMPLATE_NAME:-python-worker-template-v1}"
ASG_NAME="${ASG_NAME:-python-worker-asg}"

echo "==================================="
echo "Rolling Update Deployment"
echo "New AMI: $NEW_AMI_ID"
echo "Launch Template: $LAUNCH_TEMPLATE_NAME"
echo "Auto Scaling Group: $ASG_NAME"
echo "==================================="

# 1. 新しいLaunch Templateバージョンの作成
echo "[1/5] Creating new Launch Template version..."
aws ec2 create-launch-template-version \
    --launch-template-name $LAUNCH_TEMPLATE_NAME \
    --source-version '$Latest' \
    --launch-template-data "{\"ImageId\":\"$NEW_AMI_ID\"}" \
    --version-description "AMI Update: $NEW_AMI_ID - $(date +%Y-%m-%d)"

# 最新バージョンを取得
LATEST_VERSION=$(aws ec2 describe-launch-templates \
    --launch-template-names $LAUNCH_TEMPLATE_NAME \
    --query 'LaunchTemplates[0].LatestVersionNumber' \
    --output text)

echo "✅ Created version: $LATEST_VERSION"

# 2. Launch Templateのデフォルトバージョンを更新
echo "[2/5] Setting default version..."
aws ec2 modify-launch-template \
    --launch-template-name $LAUNCH_TEMPLATE_NAME \
    --default-version $LATEST_VERSION

echo "✅ Default version updated to: $LATEST_VERSION"

# 3. Auto Scaling Groupの更新
echo "[3/5] Updating Auto Scaling Group..."
aws autoscaling update-auto-scaling-group \
    --auto-scaling-group-name $ASG_NAME \
    --launch-template LaunchTemplateName=$LAUNCH_TEMPLATE_NAME,Version='$Latest'

echo "✅ Auto Scaling Group updated"

# 4. インスタンスリフレッシュの開始
echo "[4/5] Starting instance refresh..."
REFRESH_ID=$(aws autoscaling start-instance-refresh \
    --auto-scaling-group-name $ASG_NAME \
    --preferences '{
        "MinHealthyPercentage": 90,
        "InstanceWarmup": 300,
        "CheckpointPercentages": [50, 100],
        "CheckpointDelay": 300
    }' \
    --query 'InstanceRefreshId' \
    --output text)

echo "✅ Instance Refresh ID: $REFRESH_ID"

# 5. リフレッシュの進捗監視
echo "[5/5] Monitoring instance refresh progress..."
echo "This may take several minutes depending on instance count..."
echo ""

LAST_STATUS=""
while true; do
    REFRESH_STATUS=$(aws autoscaling describe-instance-refreshes \
        --auto-scaling-group-name $ASG_NAME \
        --instance-refresh-ids $REFRESH_ID \
        --query 'InstanceRefreshes[0]' \
        --output json)

    STATUS=$(echo $REFRESH_STATUS | jq -r '.Status')
    PERCENTAGE=$(echo $REFRESH_STATUS | jq -r '.PercentageComplete // 0')
    INSTANCES_TO_UPDATE=$(echo $REFRESH_STATUS | jq -r '.InstancesToUpdate // 0')

    # 状態が変わった時のみ表示
    if [ "$STATUS" != "$LAST_STATUS" ]; then
        echo "$(date +%H:%M:%S) - Status: $STATUS - Progress: ${PERCENTAGE}% - Instances to update: $INSTANCES_TO_UPDATE"
        LAST_STATUS=$STATUS
    else
        echo -ne "\r$(date +%H:%M:%S) - Status: $STATUS - Progress: ${PERCENTAGE}% - Instances to update: $INSTANCES_TO_UPDATE"
    fi

    if [[ "$STATUS" == "Successful" ]]; then
        echo ""
        echo "✅ Instance refresh completed successfully!"
        break
    elif [[ "$STATUS" == "Failed" ]]; then
        echo ""
        echo "❌ Instance refresh failed!"
        echo ""
        echo "Status details:"
        echo "$REFRESH_STATUS" | jq '.'
        exit 1
    elif [[ "$STATUS" == "Cancelled" ]]; then
        echo ""
        echo "⚠️  Instance refresh was cancelled!"
        exit 1
    fi

    sleep 10
done

# 最終確認
echo ""
echo "==================================="
echo "Deployment Summary"
echo "==================================="

# ASG状態確認
ASG_STATUS=$(aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names $ASG_NAME \
    --query 'AutoScalingGroups[0]' \
    --output json)

DESIRED=$(echo $ASG_STATUS | jq -r '.DesiredCapacity')
RUNNING=$(echo $ASG_STATUS | jq -r '.Instances | length')
HEALTHY=$(echo $ASG_STATUS | jq -r '[.Instances[] | select(.HealthStatus=="Healthy")] | length')

echo "Auto Scaling Group: $ASG_NAME"
echo "Desired Capacity: $DESIRED"
echo "Running Instances: $RUNNING"
echo "Healthy Instances: $HEALTHY"
echo ""

# 新しいAMIを使用しているインスタンス数を確認
NEW_AMI_INSTANCES=$(echo $ASG_STATUS | jq -r "[.Instances[] | select(.LaunchTemplate.Version==\"$LATEST_VERSION\")] | length")
echo "Instances using new AMI ($NEW_AMI_ID): $NEW_AMI_INSTANCES"

if [ $NEW_AMI_INSTANCES -eq $RUNNING ]; then
    echo "✅ All instances successfully updated to new AMI"
else
    echo "⚠️  Warning: Not all instances are using the new AMI"
    echo "Please verify manually"
fi

echo "==================================="
echo "Deployment Complete!"
echo "==================================="
