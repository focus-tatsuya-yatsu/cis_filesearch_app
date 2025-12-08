#!/bin/bash
# Auto Scaling Configuration for EC2 File Processing
# Scales based on SQS queue depth

echo "=========================================="
echo "Auto Scaling Configuration"
echo "=========================================="
echo ""

# Configuration variables
REGION="ap-northeast-1"
AMI_ID=""  # Set this to your DocuWorks AMI ID after creation
INSTANCE_TYPE="m5.xlarge"
MIN_SIZE=1
MAX_SIZE=10
DESIRED_SIZE=2
QUEUE_NAME="cis-file-processing-queue"
VPC_ID=""  # Set your VPC ID
SUBNET_IDS=""  # Comma-separated subnet IDs

# Step 1: Create Launch Template
echo "[1/7] Creating Launch Template..."
LAUNCH_TEMPLATE_ID=$(aws ec2 create-launch-template \
    --launch-template-name CISFileProcessorTemplate \
    --version-description "File processor with DocuWorks support" \
    --launch-template-data "{
        \"ImageId\": \"$AMI_ID\",
        \"InstanceType\": \"$INSTANCE_TYPE\",
        \"IamInstanceProfile\": {
            \"Name\": \"CISFileProcessorRole\"
        },
        \"SecurityGroupIds\": [\"sg-xxxxx\"],
        \"TagSpecifications\": [{
            \"ResourceType\": \"instance\",
            \"Tags\": [
                {\"Key\": \"Name\", \"Value\": \"CIS-FileProcessor\"},
                {\"Key\": \"Environment\", \"Value\": \"Production\"},
                {\"Key\": \"AutoScaling\", \"Value\": \"true\"}
            ]
        }],
        \"UserData\": \"$(base64 -w 0 ec2-userdata.ps1)\",
        \"BlockDeviceMappings\": [{
            \"DeviceName\": \"/dev/sda1\",
            \"Ebs\": {
                \"VolumeSize\": 100,
                \"VolumeType\": \"gp3\",
                \"Iops\": 3000,
                \"Throughput\": 125,
                \"DeleteOnTermination\": true
            }
        }],
        \"Monitoring\": {
            \"Enabled\": true
        }
    }" \
    --region $REGION \
    --query LaunchTemplate.LaunchTemplateId --output text)

echo "✓ Launch Template created: $LAUNCH_TEMPLATE_ID"

# Step 2: Create Auto Scaling Group
echo ""
echo "[2/7] Creating Auto Scaling Group..."
aws autoscaling create-auto-scaling-group \
    --auto-scaling-group-name CISFileProcessorASG \
    --launch-template "{
        \"LaunchTemplateId\": \"$LAUNCH_TEMPLATE_ID\",
        \"Version\": \"\$Latest\"
    }" \
    --min-size $MIN_SIZE \
    --max-size $MAX_SIZE \
    --desired-capacity $DESIRED_SIZE \
    --vpc-zone-identifier "$SUBNET_IDS" \
    --health-check-type EC2 \
    --health-check-grace-period 300 \
    --tags "Key=Name,Value=CIS-FileProcessor-ASG,PropagateAtLaunch=true" \
    --region $REGION

echo "✓ Auto Scaling Group created"

# Step 3: Create Scaling Policies
echo ""
echo "[3/7] Creating Scale-Out Policy..."
SCALE_OUT_POLICY_ARN=$(aws autoscaling put-scaling-policy \
    --auto-scaling-group-name CISFileProcessorASG \
    --policy-name ScaleOutPolicy \
    --policy-type TargetTrackingScaling \
    --target-tracking-configuration "{
        \"PredefinedMetricSpecification\": {
            \"PredefinedMetricType\": \"ASGAverageCPUUtilization\"
        },
        \"TargetValue\": 70.0
    }" \
    --region $REGION \
    --query PolicyARN --output text)

echo "✓ Scale-out policy created"

# Step 4: Create SQS-based scaling policy
echo ""
echo "[4/7] Creating SQS-based Scaling Policy..."

# First create custom metric for SQS
cat > sqs-scaling-policy.json <<EOF
{
    "TargetValue": 100.0,
    "CustomizedMetricSpecification": {
        "MetricName": "ApproximateNumberOfMessagesVisible",
        "Namespace": "AWS/SQS",
        "Dimensions": [
            {
                "Name": "QueueName",
                "Value": "$QUEUE_NAME"
            }
        ],
        "Statistic": "Average"
    },
    "ScaleInCooldown": 300,
    "ScaleOutCooldown": 60
}
EOF

SQS_POLICY_ARN=$(aws autoscaling put-scaling-policy \
    --auto-scaling-group-name CISFileProcessorASG \
    --policy-name SQSQueueDepthPolicy \
    --policy-type TargetTrackingScaling \
    --target-tracking-configuration file://sqs-scaling-policy.json \
    --region $REGION \
    --query PolicyARN --output text)

echo "✓ SQS-based scaling policy created"

# Step 5: Create Step Scaling Policy for aggressive scaling
echo ""
echo "[5/7] Creating Step Scaling Policy..."

# Create CloudWatch alarm for high queue depth
ALARM_ARN=$(aws cloudwatch put-metric-alarm \
    --alarm-name HighSQSQueueDepth \
    --alarm-description "Alarm when SQS queue has many messages" \
    --metric-name ApproximateNumberOfMessagesVisible \
    --namespace AWS/SQS \
    --statistic Average \
    --period 60 \
    --threshold 1000 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=QueueName,Value=$QUEUE_NAME \
    --evaluation-periods 1 \
    --region $REGION \
    --query AlarmArn --output text)

# Create step scaling policy
aws autoscaling put-scaling-policy \
    --auto-scaling-group-name CISFileProcessorASG \
    --policy-name StepScalingPolicy \
    --policy-type StepScaling \
    --adjustment-type ChangeInCapacity \
    --metric-aggregation-type Average \
    --step-adjustments \
        MetricIntervalLowerBound=0,MetricIntervalUpperBound=500,ScalingAdjustment=1 \
        MetricIntervalLowerBound=500,MetricIntervalUpperBound=1000,ScalingAdjustment=2 \
        MetricIntervalLowerBound=1000,ScalingAdjustment=3 \
    --region $REGION

echo "✓ Step scaling policy created"

# Step 6: Configure Auto Scaling Notifications
echo ""
echo "[6/7] Configuring Notifications..."

# Create SNS topic for notifications
TOPIC_ARN=$(aws sns create-topic \
    --name CISAutoScalingNotifications \
    --region $REGION \
    --query TopicArn --output text)

# Subscribe email to topic (replace with your email)
aws sns subscribe \
    --topic-arn $TOPIC_ARN \
    --protocol email \
    --notification-endpoint your-email@example.com \
    --region $REGION

# Configure Auto Scaling notifications
aws autoscaling put-notification-configuration \
    --auto-scaling-group-name CISFileProcessorASG \
    --topic-arn $TOPIC_ARN \
    --notification-types \
        autoscaling:EC2_INSTANCE_LAUNCH \
        autoscaling:EC2_INSTANCE_TERMINATE \
        autoscaling:EC2_INSTANCE_LAUNCH_ERROR \
        autoscaling:EC2_INSTANCE_TERMINATE_ERROR \
    --region $REGION

echo "✓ Notifications configured"

# Step 7: Create CloudWatch Dashboard
echo ""
echo "[7/7] Creating CloudWatch Dashboard..."

cat > dashboard.json <<EOF
{
    "widgets": [
        {
            "type": "metric",
            "properties": {
                "metrics": [
                    ["AWS/AutoScaling", "GroupDesiredCapacity", {"stat": "Average", "label": "Desired"}],
                    [".", "GroupInServiceInstances", {"stat": "Average", "label": "In Service"}],
                    [".", "GroupMinSize", {"stat": "Average", "label": "Min Size"}],
                    [".", "GroupMaxSize", {"stat": "Average", "label": "Max Size"}]
                ],
                "period": 300,
                "stat": "Average",
                "region": "$REGION",
                "title": "Auto Scaling Group Size",
                "yAxis": {"left": {"min": 0, "max": 10}}
            }
        },
        {
            "type": "metric",
            "properties": {
                "metrics": [
                    ["AWS/SQS", "ApproximateNumberOfMessagesVisible", {"dimensions": {"QueueName": "$QUEUE_NAME"}, "label": "Queue Depth"}],
                    [".", "NumberOfMessagesReceived", {"stat": "Sum", "label": "Messages Received"}],
                    [".", "NumberOfMessagesDeleted", {"stat": "Sum", "label": "Messages Processed"}]
                ],
                "period": 300,
                "stat": "Average",
                "region": "$REGION",
                "title": "SQS Queue Metrics"
            }
        },
        {
            "type": "metric",
            "properties": {
                "metrics": [
                    ["AWS/EC2", "CPUUtilization", {"stat": "Average", "label": "Avg CPU"}],
                    ["...", {"stat": "Maximum", "label": "Max CPU"}]
                ],
                "period": 300,
                "stat": "Average",
                "region": "$REGION",
                "title": "EC2 CPU Utilization",
                "yAxis": {"left": {"min": 0, "max": 100}}
            }
        },
        {
            "type": "metric",
            "properties": {
                "metrics": [
                    ["CIS/FileProcessing", "FilesProcessed", {"stat": "Sum"}],
                    [".", "ProcessingErrors", {"stat": "Sum"}]
                ],
                "period": 300,
                "stat": "Sum",
                "region": "$REGION",
                "title": "Processing Metrics"
            }
        }
    ]
}
EOF

aws cloudwatch put-dashboard \
    --dashboard-name CISAutoScaling \
    --dashboard-body file://dashboard.json \
    --region $REGION

echo "✓ CloudWatch dashboard created"

# Summary
echo ""
echo "=========================================="
echo "Auto Scaling Configuration Complete!"
echo "=========================================="
echo ""
echo "Configuration Summary:"
echo "  • Auto Scaling Group: CISFileProcessorASG"
echo "  • Min Size: $MIN_SIZE"
echo "  • Max Size: $MAX_SIZE"
echo "  • Desired Size: $DESIRED_SIZE"
echo ""
echo "Scaling Policies:"
echo "  • CPU-based: Scale at 70% CPU utilization"
echo "  • SQS-based: Target 100 messages per instance"
echo "  • Step Scaling: Aggressive scaling for high queue depth"
echo ""
echo "Monitoring:"
echo "  • CloudWatch Dashboard: CISAutoScaling"
echo "  • SNS Notifications: $TOPIC_ARN"
echo ""
echo "Next Steps:"
echo "1. Update AMI_ID with your DocuWorks AMI"
echo "2. Update VPC_ID and SUBNET_IDS"
echo "3. Confirm email subscription for notifications"
echo "4. Test scaling by adding messages to SQS queue"