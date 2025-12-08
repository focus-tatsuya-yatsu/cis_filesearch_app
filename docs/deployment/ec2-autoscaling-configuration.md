# EC2 Auto Scaling Configuration for File Processing

## Table of Contents
1. [Overview](#overview)
2. [Target Tracking Scaling Policy](#target-tracking-scaling-policy)
3. [Queue Depth Calculation](#queue-depth-calculation)
4. [Scaling Configuration](#scaling-configuration)
5. [Warm Pool Setup](#warm-pool-setup)
6. [Predictive Scaling](#predictive-scaling)
7. [Testing & Validation](#testing--validation)

---

## Overview

### Architecture
```
┌─────────────────┐
│  File Scanner   │
│      (PC)       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│   SQS Queue     │────▶│ CloudWatch Alarm │
│  (File Tasks)   │     │  (Queue Depth)   │
└─────────────────┘     └────────┬─────────┘
         │                       │
         │                       ▼
         │              ┌──────────────────┐
         │              │  Auto Scaling    │
         │              │  Group           │
         │              └────────┬─────────┘
         │                       │
         ▼                       ▼
┌─────────────────────────────────────────┐
│  EC2 Instances (c5.xlarge)              │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │
│  │ OCR  │ │ OCR  │ │ OCR  │ │ OCR  │   │
│  │Worker│ │Worker│ │Worker│ │Worker│   │
│  └──────┘ └──────┘ └──────┘ └──────┘   │
└─────────────────────────────────────────┘
```

### Key Metrics
- **Target**: Process 1000 files/hour
- **Processing Time**: Average 120 seconds/file with OCR
- **Queue Depth Target**: 100-200 messages per instance

---

## Target Tracking Scaling Policy

### Recommended Configuration

**Queue Depth per Instance: 100 messages**

#### Why 100 Messages per Instance?

**Calculation**:
```
Files per hour target: 1000 files/hour
Processing time per file: 120 seconds (with OCR)
Processing capacity per instance: 3600s/hour ÷ 120s/file = 30 files/hour per instance

Minimum instances needed: 1000 ÷ 30 = 34 instances (theoretical)

With buffer for bursts: 40 instances (recommended)

Queue depth per instance: 100 messages
- Provides 3.3 hours of work per instance
- Allows time for scale-out
- Prevents over-aggressive scaling
```

**Key Considerations**:

1. **Too Low (< 50)**:
   - Aggressive scaling (frequent scale-out)
   - Higher EC2 costs
   - More stable response times
   - Better for bursty workloads

2. **Sweet Spot (100-200)**:
   - Balanced scaling
   - Cost-effective
   - Good queue buffer
   - **Recommended for CIS project**

3. **Too High (> 300)**:
   - Slow scale-out
   - Long queue wait times
   - Cost savings but poor user experience
   - Risk of SLA violations

### CloudFormation Template

```yaml
# auto-scaling-group.yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: 'EC2 Auto Scaling for File Processing Workers'

Parameters:
  QueueURL:
    Type: String
    Description: SQS Queue URL for file processing tasks

  MinSize:
    Type: Number
    Default: 2
    Description: Minimum number of instances

  MaxSize:
    Type: Number
    Default: 50
    Description: Maximum number of instances

  DesiredCapacity:
    Type: Number
    Default: 5
    Description: Initial desired capacity

  TargetQueueDepthPerInstance:
    Type: Number
    Default: 100
    Description: Target queue depth per instance

Resources:
  # Launch Template
  WorkerLaunchTemplate:
    Type: AWS::EC2::LaunchTemplate
    Properties:
      LaunchTemplateName: cis-file-worker-template
      LaunchTemplateData:
        ImageId: !Ref LatestAmiId  # Amazon Linux 2023 with Python 3.11
        InstanceType: c5.xlarge
        IamInstanceProfile:
          Arn: !GetAtt WorkerInstanceProfile.Arn

        # Storage optimization
        BlockDeviceMappings:
          - DeviceName: /dev/xvda
            Ebs:
              VolumeSize: 50
              VolumeType: gp3
              Iops: 3000
              Throughput: 125
              DeleteOnTermination: true

        # Network optimization
        NetworkInterfaces:
          - DeviceIndex: 0
            AssociatePublicIpAddress: false
            Groups:
              - !Ref WorkerSecurityGroup
            DeleteOnTermination: true

        # User data for worker setup
        UserData:
          Fn::Base64: !Sub |
            #!/bin/bash
            set -e

            # Update system
            yum update -y

            # Install dependencies
            yum install -y python3.11 python3.11-pip tesseract poppler-utils

            # Install Python packages
            pip3.11 install --upgrade pip
            pip3.11 install boto3 Pillow pytesseract pdf2image pillow-heif

            # Download worker script
            aws s3 cp s3://cis-filesearch-deployment/worker/file_processor.py /opt/worker/

            # Configure CloudWatch agent
            wget https://s3.amazonaws.com/amazoncloudwatch-agent/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm
            rpm -U ./amazon-cloudwatch-agent.rpm

            # Start CloudWatch agent
            /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
              -a fetch-config \
              -m ec2 \
              -s \
              -c ssm:cis-cloudwatch-config

            # Start worker
            cd /opt/worker
            python3.11 file_processor.py &

        # Metadata for tracking
        TagSpecifications:
          - ResourceType: instance
            Tags:
              - Key: Name
                Value: cis-file-worker
              - Key: Project
                Value: CISFileSearch
              - Key: Environment
                Value: Production
              - Key: ManagedBy
                Value: AutoScaling

  # Auto Scaling Group
  WorkerAutoScalingGroup:
    Type: AWS::AutoScaling::AutoScalingGroup
    Properties:
      AutoScalingGroupName: cis-file-worker-asg
      LaunchTemplate:
        LaunchTemplateId: !Ref WorkerLaunchTemplate
        Version: !GetAtt WorkerLaunchTemplate.LatestVersionNumber

      MinSize: !Ref MinSize
      MaxSize: !Ref MaxSize
      DesiredCapacity: !Ref DesiredCapacity

      VPCZoneIdentifier:
        - !Ref PrivateSubnet1
        - !Ref PrivateSubnet2

      HealthCheckType: EC2
      HealthCheckGracePeriod: 300

      # Termination policies
      TerminationPolicies:
        - OldestInstance

      # Metrics collection
      MetricsCollection:
        - Granularity: 1Minute
          Metrics:
            - GroupInServiceInstances
            - GroupPendingInstances
            - GroupTerminatingInstances

      Tags:
        - Key: Name
          Value: cis-file-worker
          PropagateAtLaunch: true

  # Target Tracking Scaling Policy (Primary)
  QueueDepthScalingPolicy:
    Type: AWS::AutoScaling::ScalingPolicy
    Properties:
      AutoScalingGroupName: !Ref WorkerAutoScalingGroup
      PolicyType: TargetTrackingScaling

      TargetTrackingConfiguration:
        # Custom metric: Queue depth per instance
        CustomizedMetricSpecification:
          MetricName: BacklogPerInstance
          Namespace: CIS/FileProcessing
          Statistic: Average

          Dimensions:
            - Name: QueueName
              Value: cis-filesearch-queue-prod

        TargetValue: !Ref TargetQueueDepthPerInstance

        # Scale-out fast, scale-in slow
        ScaleOutCooldown: 60  # 1 minute
        ScaleInCooldown: 600  # 10 minutes

  # Step Scaling Policy (Backup for aggressive scaling)
  AggressiveScaleOutPolicy:
    Type: AWS::AutoScaling::ScalingPolicy
    Properties:
      AutoScalingGroupName: !Ref WorkerAutoScalingGroup
      PolicyType: StepScaling
      AdjustmentType: PercentChangeInCapacity

      StepAdjustments:
        # Queue depth 5000+: Scale out 100%
        - MetricIntervalLowerBound: 4000
          ScalingAdjustment: 100

        # Queue depth 2000-5000: Scale out 50%
        - MetricIntervalLowerBound: 1000
          MetricIntervalUpperBound: 4000
          ScalingAdjustment: 50

        # Queue depth 1000-2000: Scale out 25%
        - MetricIntervalLowerBound: 0
          MetricIntervalUpperBound: 1000
          ScalingAdjustment: 25

      MetricAggregationType: Average
      EstimatedInstanceWarmup: 180  # 3 minutes for instance to start processing

  # CloudWatch Alarm for aggressive scale-out
  HighQueueDepthAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmName: cis-file-worker-high-queue-depth
      AlarmDescription: Trigger aggressive scale-out when queue depth is very high

      MetricName: ApproximateNumberOfMessagesVisible
      Namespace: AWS/SQS
      Statistic: Average
      Period: 60
      EvaluationPeriods: 1
      Threshold: 1000
      ComparisonOperator: GreaterThanThreshold

      Dimensions:
        - Name: QueueName
          Value: cis-filesearch-queue-prod

      AlarmActions:
        - !Ref AggressiveScaleOutPolicy

  # Custom Metric Lambda (publishes BacklogPerInstance)
  BacklogPerInstanceCalculator:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: cis-backlog-per-instance-calculator
      Runtime: python3.11
      Handler: index.lambda_handler
      Timeout: 60

      Role: !GetAtt LambdaExecutionRole.Arn

      Environment:
        Variables:
          QUEUE_URL: !Ref QueueURL
          ASG_NAME: !Ref WorkerAutoScalingGroup

      Code:
        ZipFile: |
          import boto3
          import os
          from datetime import datetime

          cloudwatch = boto3.client('cloudwatch')
          sqs = boto3.client('sqs')
          autoscaling = boto3.client('autoscaling')

          def lambda_handler(event, context):
              queue_url = os.environ['QUEUE_URL']
              asg_name = os.environ['ASG_NAME']

              # Get queue depth
              queue_attrs = sqs.get_queue_attributes(
                  QueueUrl=queue_url,
                  AttributeNames=['ApproximateNumberOfMessages']
              )
              queue_depth = int(queue_attrs['Attributes']['ApproximateNumberOfMessages'])

              # Get ASG capacity
              asg_response = autoscaling.describe_auto_scaling_groups(
                  AutoScalingGroupNames=[asg_name]
              )

              if not asg_response['AutoScalingGroups']:
                  return {'statusCode': 400, 'body': 'ASG not found'}

              asg = asg_response['AutoScalingGroups'][0]
              in_service = len([i for i in asg['Instances'] if i['LifecycleState'] == 'InService'])

              # Avoid division by zero
              if in_service == 0:
                  in_service = 1

              # Calculate backlog per instance
              backlog_per_instance = queue_depth / in_service

              # Publish custom metric
              cloudwatch.put_metric_data(
                  Namespace='CIS/FileProcessing',
                  MetricData=[
                      {
                          'MetricName': 'BacklogPerInstance',
                          'Value': backlog_per_instance,
                          'Unit': 'Count',
                          'Timestamp': datetime.utcnow(),
                          'Dimensions': [
                              {'Name': 'QueueName', 'Value': 'cis-filesearch-queue-prod'}
                          ]
                      }
                  ]
              )

              print(f"Queue depth: {queue_depth}, In-service instances: {in_service}, Backlog/instance: {backlog_per_instance}")

              return {
                  'statusCode': 200,
                  'body': f'Backlog per instance: {backlog_per_instance}'
              }

  # EventBridge rule to invoke Lambda every minute
  BacklogCalculatorSchedule:
    Type: AWS::Events::Rule
    Properties:
      Name: cis-backlog-per-instance-schedule
      Description: Calculate backlog per instance every minute
      ScheduleExpression: rate(1 minute)
      State: ENABLED
      Targets:
        - Arn: !GetAtt BacklogPerInstanceCalculator.Arn
          Id: BacklogCalculatorTarget

  # Lambda permission for EventBridge
  BacklogCalculatorPermission:
    Type: AWS::Lambda::Permission
    Properties:
      FunctionName: !Ref BacklogPerInstanceCalculator
      Action: lambda:InvokeFunction
      Principal: events.amazonaws.com
      SourceArn: !GetAtt BacklogCalculatorSchedule.Arn

Outputs:
  AutoScalingGroupName:
    Value: !Ref WorkerAutoScalingGroup
    Export:
      Name: CISFileWorkerASG

  LaunchTemplateId:
    Value: !Ref WorkerLaunchTemplate
    Export:
      Name: CISFileWorkerLaunchTemplate
```

---

## Queue Depth Calculation

### Formula

```
Backlog per Instance = Queue Depth ÷ In-Service Instances

Target Queue Depth = Target Backlog per Instance × In-Service Instances
```

### Example Scenarios

#### Scenario 1: Steady State
```
Queue depth: 500 messages
In-service instances: 5
Backlog per instance: 500 ÷ 5 = 100 messages/instance

✓ Matches target (100), no scaling action
```

#### Scenario 2: Queue Building Up
```
Queue depth: 1500 messages
In-service instances: 5
Backlog per instance: 1500 ÷ 5 = 300 messages/instance

⚠️ Exceeds target (100), scale out triggered
New desired capacity: 1500 ÷ 100 = 15 instances
```

#### Scenario 3: Queue Draining
```
Queue depth: 250 messages
In-service instances: 10
Backlog per instance: 250 ÷ 10 = 25 messages/instance

⚠️ Below target (100), scale in triggered (after cooldown)
New desired capacity: 250 ÷ 100 = 3 instances (with minimum 2)
```

---

## Scaling Configuration

### Scale-Out Settings

**Fast scale-out for responsiveness:**

```yaml
ScaleOutCooldown: 60  # 1 minute
```

**Why 60 seconds?**
- New instances take ~3 minutes to boot and start processing
- 1-minute cooldown allows for rapid consecutive scale-outs
- Multiple instances can be launched in parallel
- Prevents under-provisioning during bursts

**Warmup Period:**
```yaml
EstimatedInstanceWarmup: 180  # 3 minutes
```

**Breakdown:**
- Instance launch: ~90 seconds
- User data script execution: ~60 seconds
- Worker initialization: ~30 seconds
- Total: ~180 seconds

### Scale-In Settings

**Slow scale-in for stability:**

```yaml
ScaleInCooldown: 600  # 10 minutes
```

**Why 10 minutes?**
- Prevents flapping (rapid scale-out/in cycles)
- Allows queue to fully drain before terminating instances
- Reduces costs from frequent instance churn
- Provides buffer for traffic variations

**Scale-In Protection:**

```bash
# Protect instances processing critical files
aws autoscaling set-instance-protection \
  --instance-ids i-xxxxx \
  --auto-scaling-group-name cis-file-worker-asg \
  --protected-from-scale-in
```

### Minimum and Maximum Capacity

**Recommendations:**

```yaml
MinSize: 2    # Always-on for baseline processing
MaxSize: 50   # Cap for cost control
DesiredCapacity: 5  # Starting point
```

**Capacity Planning:**

```
Minimum (2 instances):
- Handles 60 files/hour baseline
- Always available for immediate processing
- Cost: ~$300/month (c5.xlarge on-demand)

Maximum (50 instances):
- Handles 1500 files/hour peak
- Sufficient for 10TB/month processing
- Peak cost: ~$7500/month (transient)
```

---

## Warm Pool Setup

### What is Warm Pool?

Warm Pool keeps pre-initialized instances ready for faster scale-out.

**Benefits:**
- Reduces scale-out time from 3 minutes to ~30 seconds
- Instances are pre-configured (software installed, scripts ready)
- Pay only for storage (no compute costs until activated)

### Configuration

```yaml
WarmPoolConfiguration:
  Type: AWS::AutoScaling::WarmPool
  Properties:
    AutoScalingGroupName: !Ref WorkerAutoScalingGroup

    # Pool size
    MinSize: 5  # Keep 5 instances warm
    MaxGroupPreparedCapacity: 10  # Max warm + in-service

    # Instance state
    PoolState: Stopped  # Cheapest (EBS-only charges)
    # Alternatives:
    # - Stopped: Pay for EBS only (~$5/month per instance)
    # - Hibernated: Pay for EBS + RAM snapshot (~$10/month)
    # - Running: Pay full price (~$150/month per instance)

    # Reuse instances
    InstanceReusePolicy:
      ReuseOnScaleIn: true  # Return instances to warm pool on scale-in
```

### Cost Comparison

**Without Warm Pool:**
```
Scale-out time: 3 minutes
Instances launched on-demand
Cost: EC2 on-demand pricing
```

**With Warm Pool (Stopped):**
```
Scale-out time: 30 seconds (6x faster)
5 instances warm (50GB EBS each)
Cost: 5 × $4/month = $20/month for warm pool
Savings: Faster response, minimal cost
```

**ROI Calculation:**
```
If queue builds up for 3 minutes without warm pool:
- 1000 files/hour = 16.67 files/minute
- 3-minute delay = 50 files delayed
- With SLA of 10-minute processing, delay is acceptable

Warm pool cost: $20/month
Benefit: Improved user experience, faster burst handling
Decision: Enable warm pool for production
```

---

## Predictive Scaling

### What is Predictive Scaling?

Predictive scaling uses machine learning to forecast traffic and scale proactively.

**Benefits:**
- Instances ready before queue builds up
- Better for known patterns (daily/weekly cycles)
- Reduces scale-out delays

**When to Use:**
- Predictable workload patterns
- Daily batch processing
- Scheduled file uploads

### Configuration

```yaml
PredictiveScalingPolicy:
  Type: AWS::AutoScaling::ScalingPolicy
  Properties:
    AutoScalingGroupName: !Ref WorkerAutoScalingGroup
    PolicyType: PredictiveScaling

    PredictiveScalingConfiguration:
      # Forecast parameters
      MetricSpecifications:
        - TargetValue: 100  # Target backlog per instance
          CustomizedScalingMetricSpecification:
            MetricName: BacklogPerInstance
            Namespace: CIS/FileProcessing
            Statistic: Average

          CustomizedLoadMetricSpecification:
            MetricName: ApproximateNumberOfMessagesVisible
            Namespace: AWS/SQS
            Statistic: Average
            Dimensions:
              - Name: QueueName
                Value: cis-filesearch-queue-prod

      # Forecast-only mode (test first)
      Mode: ForecastOnly
      # Switch to ForecastAndScale after validation

      # Scheduling
      SchedulingBufferTime: 300  # Pre-scale 5 minutes ahead
      MaxCapacityBreachBehavior: IncreaseMaxCapacity
      MaxCapacityBuffer: 10  # Allow 10% above max for predictions
```

### When to Enable Predictive Scaling

**Enable if:**
- ✓ Consistent daily/weekly patterns (e.g., batch uploads at 9 AM)
- ✓ At least 14 days of historical data
- ✓ Traffic variations > 50% (worth predicting)

**Skip if:**
- ✗ Completely random workload
- ✗ Infrequent usage (< 1000 files/day)
- ✗ Already using warm pool (diminishes benefit)

**For CIS Project:**
- Start with **Target Tracking + Warm Pool**
- Enable **Predictive Scaling** after 1 month of data collection
- Use **ForecastOnly** mode first to validate predictions

---

## Testing & Validation

### Load Test Script

```bash
#!/bin/bash
# load-test-autoscaling.sh

QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/ACCOUNT/cis-filesearch-queue-prod"
ASG_NAME="cis-file-worker-asg"

echo "=== Auto Scaling Load Test ==="
echo "Queue: $QUEUE_URL"
echo "ASG: $ASG_NAME"
echo ""

# Function to get ASG metrics
get_asg_status() {
  aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names $ASG_NAME \
    --query 'AutoScalingGroups[0].[DesiredCapacity,MinSize,MaxSize]' \
    --output text
}

# Function to get queue depth
get_queue_depth() {
  aws sqs get-queue-attributes \
    --queue-url $QUEUE_URL \
    --attribute-names ApproximateNumberOfMessages \
    --query 'Attributes.ApproximateNumberOfMessages' \
    --output text
}

# Initial state
echo "Initial State:"
echo "ASG Capacity: $(get_asg_status)"
echo "Queue Depth: $(get_queue_depth)"
echo ""

# Send 5000 test messages
echo "Sending 5000 test messages to trigger scale-out..."
for i in {1..500}; do
  # Send batch of 10
  BATCH="["
  for j in {1..10}; do
    MSG="{\"Id\":\"$((i*10+j))\",\"MessageBody\":\"{\\\"fileId\\\":\\\"test-$((i*10+j))\\\",\\\"timestamp\\\":\\\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\\"}\"}"
    if [ $j -eq 10 ]; then
      BATCH+="$MSG"
    else
      BATCH+="$MSG,"
    fi
  done
  BATCH+="]"

  aws sqs send-message-batch \
    --queue-url $QUEUE_URL \
    --entries "$BATCH" > /dev/null

  if [ $((i % 50)) -eq 0 ]; then
    echo "Sent $((i*10)) messages..."
  fi
done

echo ""
echo "All messages sent. Monitoring scaling..."
echo ""

# Monitor for 30 minutes
for minute in {1..30}; do
  CAPACITY=$(get_asg_status | awk '{print $1}')
  QUEUE_DEPTH=$(get_queue_depth)
  BACKLOG_PER_INSTANCE=$((QUEUE_DEPTH / CAPACITY))

  echo "[$minute min] Capacity: $CAPACITY, Queue: $QUEUE_DEPTH, Backlog/Instance: $BACKLOG_PER_INSTANCE"

  sleep 60
done

echo ""
echo "=== Test Complete ==="
```

### Validation Checklist

- [ ] **Scale-out triggers correctly**
  - Send 1000 messages
  - Verify instances scale from 2 → 10+ within 5 minutes

- [ ] **Scale-in works after cooldown**
  - Wait 15 minutes after queue drains
  - Verify instances scale back to minimum

- [ ] **Warm pool activates quickly**
  - Check instance launch time < 60 seconds (with warm pool)
  - Compare to ~180 seconds (without warm pool)

- [ ] **Custom metric publishes**
  - Check CloudWatch for `BacklogPerInstance` metric
  - Verify data points every minute

- [ ] **Alarms trigger appropriately**
  - High queue depth alarm at 1000+ messages
  - Step scaling activates for 2000+ messages

- [ ] **Instance health checks pass**
  - All instances report healthy
  - Workers successfully process messages

---

## Summary & Recommendations

### Recommended Configuration

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| **Target Queue Depth/Instance** | 100 | Balanced responsiveness & cost |
| **Min Instances** | 2 | Baseline processing (60 files/hr) |
| **Max Instances** | 50 | Peak capacity (1500 files/hr) |
| **Scale-out Cooldown** | 60s | Fast response to bursts |
| **Scale-in Cooldown** | 600s | Prevent flapping |
| **Warm Pool Size** | 5 | 30s scale-out vs 3min |
| **Warmup Period** | 180s | Instance boot + initialization |

### Next Steps

1. **Deploy CloudFormation stack**
2. **Run load test to validate scaling**
3. **Enable CloudWatch dashboard for monitoring**
4. **Collect 2 weeks of data**
5. **Tune target queue depth based on actual patterns**
6. **Enable predictive scaling after 1 month**

---

**Document Version**: 1.0
**Last Updated**: 2025-01-17
**Author**: CIS Performance Engineering Team
