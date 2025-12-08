# Performance Monitoring & Optimization Guide

## Table of Contents
1. [CloudWatch Metrics](#cloudwatch-metrics)
2. [Custom Metrics](#custom-metrics)
3. [Dashboard Configuration](#dashboard-configuration)
4. [Alarms & Alerts](#alarms--alerts)
5. [Bottleneck Identification](#bottleneck-identification)
6. [Cost Monitoring](#cost-monitoring)
7. [Performance Benchmarks](#performance-benchmarks)

---

## CloudWatch Metrics

### Key Metrics to Monitor

#### 1. EC2 Metrics

**CPU Utilization**
```
Metric: CPUUtilization
Namespace: AWS/EC2
Target: 70-90% (efficient utilization)
Alert if: > 95% sustained (need more instances)
Alert if: < 30% sustained (over-provisioned)
```

**Memory Usage (Custom Metric)**
```
Metric: MemoryUtilization
Namespace: CWAgent
Target: < 80%
Alert if: > 90% (risk of OOM)
```

**Disk I/O**
```
Metrics:
- EBSReadBytes
- EBSWriteBytes
- EBSReadOps
- EBSWriteOps

Target: < 80% of provisioned IOPS
Alert if: > 90% (bottleneck)
```

**Network Throughput**
```
Metrics:
- NetworkIn
- NetworkOut

Target: < 8 Gbps (c5.xlarge network limit)
Alert if: > 7 Gbps (saturation)
```

#### 2. SQS Metrics

**Queue Depth**
```
Metric: ApproximateNumberOfMessagesVisible
Namespace: AWS/SQS
Target: < 500 (with auto-scaling)
Alert if: > 1000 (backlog building)
```

**Age of Oldest Message**
```
Metric: ApproximateAgeOfOldestMessage
Namespace: AWS/SQS
Target: < 600s (10 minutes)
Alert if: > 1800s (30 minutes)
```

**Messages In-Flight**
```
Metric: ApproximateNumberOfMessagesNotVisible
Namespace: AWS/SQS
Use for: Track active processing
Alert if: High but queue not draining (stuck workers)
```

#### 3. S3 Metrics

**Request Metrics**
```
Metrics:
- GetRequests
- PutRequests
- BytesDownloaded
- BytesUploaded

Use for: Track file transfer volume
Cost correlation: Data transfer costs
```

**Error Rates**
```
Metrics:
- 4xxErrors
- 5xxErrors

Target: < 1%
Alert if: > 5% (investigate)
```

#### 4. Auto Scaling Metrics

**Group Size**
```
Metrics:
- GroupDesiredCapacity
- GroupInServiceInstances
- GroupPendingInstances
- GroupTerminatingInstances

Use for: Track scaling behavior
```

**Scaling Activity**
```
Metric: GroupTotalInstances
Use for: Visualize scaling events
Correlate with queue depth
```

---

## Custom Metrics

### Publishing Custom Metrics

**CloudWatch Agent Configuration**

```json
{
  "agent": {
    "metrics_collection_interval": 60
  },
  "metrics": {
    "namespace": "CIS/FileProcessing",
    "metrics_collected": {
      "mem": {
        "measurement": [
          {
            "name": "mem_used_percent",
            "rename": "MemoryUtilization",
            "unit": "Percent"
          }
        ]
      },
      "disk": {
        "measurement": [
          {
            "name": "used_percent",
            "rename": "DiskUtilization",
            "unit": "Percent"
          }
        ],
        "resources": ["/"]
      }
    }
  }
}
```

**Application-Level Metrics**

```python
import boto3
from datetime import datetime

cloudwatch = boto3.client('cloudwatch')

def publish_processing_metrics(
    processing_time: float,
    file_size: int,
    success: bool
):
    """Publish custom processing metrics"""

    cloudwatch.put_metric_data(
        Namespace='CIS/FileProcessing',
        MetricData=[
            {
                'MetricName': 'ProcessingTime',
                'Value': processing_time,
                'Unit': 'Seconds',
                'Timestamp': datetime.utcnow(),
                'Dimensions': [
                    {'Name': 'InstanceId', 'Value': get_instance_id()},
                    {'Name': 'Status', 'Value': 'Success' if success else 'Failed'}
                ]
            },
            {
                'MetricName': 'FileSize',
                'Value': file_size / 1024 / 1024,  # MB
                'Unit': 'Megabytes',
                'Timestamp': datetime.utcnow()
            },
            {
                'MetricName': 'FilesProcessed',
                'Value': 1,
                'Unit': 'Count',
                'Timestamp': datetime.utcnow(),
                'Dimensions': [
                    {'Name': 'Status', 'Value': 'Success' if success else 'Failed'}
                ]
            }
        ]
    )

def publish_ocr_metrics(
    download_time: float,
    ocr_time: float,
    index_time: float
):
    """Publish OCR stage timings"""

    cloudwatch.put_metric_data(
        Namespace='CIS/FileProcessing',
        MetricData=[
            {
                'MetricName': 'DownloadTime',
                'Value': download_time,
                'Unit': 'Seconds',
                'StatisticValues': {
                    'SampleCount': 1,
                    'Sum': download_time,
                    'Minimum': download_time,
                    'Maximum': download_time
                }
            },
            {
                'MetricName': 'OCRTime',
                'Value': ocr_time,
                'Unit': 'Seconds'
            },
            {
                'MetricName': 'IndexTime',
                'Value': index_time,
                'Unit': 'Seconds'
            }
        ]
    )
```

**Batch Publishing (Efficient)**

```python
class MetricsBuffer:
    """Buffer metrics and publish in batches"""

    def __init__(self, max_size=20):
        self.buffer = []
        self.max_size = max_size

    def add(self, metric_name, value, unit='None', dimensions=None):
        metric = {
            'MetricName': metric_name,
            'Value': value,
            'Unit': unit,
            'Timestamp': datetime.utcnow()
        }

        if dimensions:
            metric['Dimensions'] = dimensions

        self.buffer.append(metric)

        # Flush if buffer full
        if len(self.buffer) >= self.max_size:
            self.flush()

    def flush(self):
        if not self.buffer:
            return

        cloudwatch.put_metric_data(
            Namespace='CIS/FileProcessing',
            MetricData=self.buffer
        )

        logger.debug(f"Published {len(self.buffer)} metrics")
        self.buffer = []

# Usage
metrics = MetricsBuffer()

for file in files:
    start = time.time()
    process_file(file)
    duration = time.time() - start

    metrics.add('ProcessingTime', duration, 'Seconds')
    metrics.add('FilesProcessed', 1, 'Count')

# Flush remaining metrics
metrics.flush()
```

---

## Dashboard Configuration

### CloudFormation Dashboard Template

```yaml
FileProcessingDashboard:
  Type: AWS::CloudWatch::Dashboard
  Properties:
    DashboardName: CIS-FileProcessing-Performance
    DashboardBody: !Sub |
      {
        "widgets": [
          {
            "type": "metric",
            "properties": {
              "metrics": [
                ["AWS/SQS", "ApproximateNumberOfMessagesVisible", {"stat": "Average", "label": "Queue Depth"}],
                [".", "ApproximateAgeOfOldestMessage", {"stat": "Maximum", "label": "Oldest Message Age (s)"}]
              ],
              "period": 60,
              "stat": "Average",
              "region": "${AWS::Region}",
              "title": "SQS Queue Status",
              "yAxis": {
                "left": {"label": "Messages"}
              }
            }
          },
          {
            "type": "metric",
            "properties": {
              "metrics": [
                ["AWS/AutoScaling", "GroupDesiredCapacity", {"stat": "Average", "label": "Desired"}],
                [".", "GroupInServiceInstances", {"stat": "Average", "label": "In Service"}],
                [".", "GroupPendingInstances", {"stat": "Average", "label": "Pending"}]
              ],
              "period": 60,
              "stat": "Average",
              "region": "${AWS::Region}",
              "title": "Auto Scaling Group Size",
              "yAxis": {
                "left": {"label": "Instances"}
              }
            }
          },
          {
            "type": "metric",
            "properties": {
              "metrics": [
                ["CIS/FileProcessing", "ProcessingTime", {"stat": "Average", "label": "Avg"}],
                ["...", {"stat": "p95", "label": "P95"}],
                ["...", {"stat": "Maximum", "label": "Max"}]
              ],
              "period": 300,
              "stat": "Average",
              "region": "${AWS::Region}",
              "title": "Processing Time",
              "yAxis": {
                "left": {"label": "Seconds"}
              }
            }
          },
          {
            "type": "metric",
            "properties": {
              "metrics": [
                ["CIS/FileProcessing", "FilesProcessed", {"stat": "Sum", "label": "Success"}, {"dimensions": {"Status": "Success"}}],
                ["...", {"dimensions": {"Status": "Failed"}, "label": "Failed"}]
              ],
              "period": 300,
              "stat": "Sum",
              "region": "${AWS::Region}",
              "title": "Files Processed (5min)",
              "yAxis": {
                "left": {"label": "Count"}
              }
            }
          },
          {
            "type": "metric",
            "properties": {
              "metrics": [
                ["CIS/FileProcessing", "DownloadTime", {"stat": "Average", "label": "Download"}],
                [".", "OCRTime", {"stat": "Average", "label": "OCR"}],
                [".", "IndexTime", {"stat": "Average", "label": "Index"}]
              ],
              "period": 300,
              "stat": "Average",
              "region": "${AWS::Region}",
              "title": "Processing Stage Breakdown",
              "yAxis": {
                "left": {"label": "Seconds"}
              },
              "view": "timeSeries",
              "stacked": true
            }
          },
          {
            "type": "metric",
            "properties": {
              "metrics": [
                ["AWS/EC2", "CPUUtilization", {"stat": "Average"}]
              ],
              "period": 60,
              "stat": "Average",
              "region": "${AWS::Region}",
              "title": "CPU Utilization (All Instances)",
              "yAxis": {
                "left": {"min": 0, "max": 100}
              }
            }
          }
        ]
      }
```

### Operational Dashboard (Console)

**Create manually for quick access:**

1. **Navigate to CloudWatch Console**
2. **Create Dashboard**: "CIS-FileProcessing-Ops"

3. **Add Widgets:**

**Widget 1: Key Metrics (Number)**
```
- Queue Depth (latest)
- In-Service Instances (latest)
- Processing Rate (files/hour)
- Error Rate (%)
```

**Widget 2: Queue & Scaling (Line)**
```
- Queue Depth (left Y-axis)
- In-Service Instances (right Y-axis)
- Time range: Last 6 hours
```

**Widget 3: Processing Performance (Stacked Area)**
```
- Download Time
- OCR Time
- Index Time
- Shows bottleneck visually
```

**Widget 4: Cost Tracking (Line)**
```
- EC2 Instance Hours
- S3 Data Transfer (GB)
- SQS Requests
- Estimated daily cost
```

---

## Alarms & Alerts

### Critical Alarms

**1. High Queue Backlog**

```yaml
QueueBacklogAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: CIS-HighQueueBacklog-Critical
    AlarmDescription: Queue depth exceeds 1000 messages
    MetricName: ApproximateNumberOfMessagesVisible
    Namespace: AWS/SQS
    Statistic: Average
    Period: 300
    EvaluationPeriods: 2
    Threshold: 1000
    ComparisonOperator: GreaterThanThreshold
    Dimensions:
      - Name: QueueName
        Value: cis-filesearch-queue-prod
    AlarmActions:
      - !Ref AlertSNSTopic
    TreatMissingData: notBreaching
```

**2. Processing Time Degradation**

```yaml
ProcessingTimeDegradationAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: CIS-SlowProcessing-Warning
    AlarmDescription: P95 processing time exceeds 180 seconds
    MetricName: ProcessingTime
    Namespace: CIS/FileProcessing
    ExtendedStatistic: p95
    Period: 300
    EvaluationPeriods: 3
    Threshold: 180
    ComparisonOperator: GreaterThanThreshold
    AlarmActions:
      - !Ref AlertSNSTopic
```

**3. High Error Rate**

```yaml
HighErrorRateAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: CIS-HighErrorRate-Critical
    AlarmDescription: Error rate exceeds 10%
    Metrics:
      - Id: error_rate
        Expression: "m2 / (m1 + m2) * 100"
        Label: Error Rate (%)
      - Id: m1
        MetricStat:
          Metric:
            Namespace: CIS/FileProcessing
            MetricName: FilesProcessed
            Dimensions:
              - Name: Status
                Value: Success
          Period: 300
          Stat: Sum
        ReturnData: false
      - Id: m2
        MetricStat:
          Metric:
            Namespace: CIS/FileProcessing
            MetricName: FilesProcessed
            Dimensions:
              - Name: Status
                Value: Failed
          Period: 300
          Stat: Sum
        ReturnData: false
    EvaluationPeriods: 2
    Threshold: 10
    ComparisonOperator: GreaterThanThreshold
    AlarmActions:
      - !Ref AlertSNSTopic
```

**4. Dead Letter Queue Not Empty**

```yaml
DLQNotEmptyAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: CIS-DLQHasMessages-Critical
    AlarmDescription: Messages in Dead Letter Queue require investigation
    MetricName: ApproximateNumberOfMessagesVisible
    Namespace: AWS/SQS
    Statistic: Average
    Period: 60
    EvaluationPeriods: 1
    Threshold: 1
    ComparisonOperator: GreaterThanOrEqualToThreshold
    Dimensions:
      - Name: QueueName
        Value: cis-filesearch-dlq-prod
    AlarmActions:
      - !Ref AlertSNSTopic
```

**5. Auto Scaling at Max Capacity**

```yaml
MaxCapacityReachedAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: CIS-MaxCapacity-Warning
    AlarmDescription: Auto Scaling Group at maximum capacity
    MetricName: GroupDesiredCapacity
    Namespace: AWS/AutoScaling
    Statistic: Average
    Period: 300
    EvaluationPeriods: 2
    Threshold: 50  # Max instances
    ComparisonOperator: GreaterThanOrEqualToThreshold
    Dimensions:
      - Name: AutoScalingGroupName
        Value: cis-file-worker-asg
    AlarmActions:
      - !Ref AlertSNSTopic
```

### SNS Alert Topic

```yaml
AlertSNSTopic:
  Type: AWS::SNS::Topic
  Properties:
    TopicName: cis-filesearch-alerts
    DisplayName: CIS File Search Alerts
    Subscription:
      - Endpoint: devops@company.com
        Protocol: email
      - Endpoint: !GetAtt AlertLambda.Arn
        Protocol: lambda  # For Slack integration

AlertLambda:
  Type: AWS::Lambda::Function
  Properties:
    FunctionName: cis-alert-to-slack
    Runtime: python3.11
    Handler: index.lambda_handler
    Code:
      ZipFile: |
        import json
        import urllib3
        import os

        http = urllib3.PoolManager()

        def lambda_handler(event, context):
            message = json.loads(event['Records'][0]['Sns']['Message'])

            alarm_name = message['AlarmName']
            new_state = message['NewStateValue']
            reason = message['NewStateReason']

            slack_message = {
                'text': f':warning: *{alarm_name}* is in {new_state} state',
                'blocks': [
                    {
                        'type': 'section',
                        'text': {
                            'type': 'mrkdwn',
                            'text': f'*Alarm:* {alarm_name}\n*State:* {new_state}\n*Reason:* {reason}'
                        }
                    }
                ]
            }

            http.request(
                'POST',
                os.environ['SLACK_WEBHOOK_URL'],
                body=json.dumps(slack_message),
                headers={'Content-Type': 'application/json'}
            )

            return {'statusCode': 200}
    Environment:
      Variables:
        SLACK_WEBHOOK_URL: https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

---

## Bottleneck Identification

### Performance Profiling Workflow

**1. Capture Baseline Metrics**

```bash
# Run for 1 hour under normal load
aws cloudwatch get-metric-statistics \
  --namespace CIS/FileProcessing \
  --metric-name ProcessingTime \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum \
  --dimensions Name=Status,Value=Success
```

**2. Identify Slowest Stage**

Query stage timings:

```python
# Analyze stage breakdown
import boto3
from datetime import datetime, timedelta

cloudwatch = boto3.client('cloudwatch')

end_time = datetime.utcnow()
start_time = end_time - timedelta(hours=1)

stages = ['DownloadTime', 'OCRTime', 'IndexTime']
results = {}

for stage in stages:
    response = cloudwatch.get_metric_statistics(
        Namespace='CIS/FileProcessing',
        MetricName=stage,
        StartTime=start_time,
        EndTime=end_time,
        Period=3600,
        Statistics=['Average']
    )

    if response['Datapoints']:
        avg = response['Datapoints'][0]['Average']
        results[stage] = avg

# Print results
total = sum(results.values())
for stage, time in sorted(results.items(), key=lambda x: -x[1]):
    pct = (time / total) * 100
    print(f"{stage}: {time:.2f}s ({pct:.1f}%)")

# Expected output:
# OCRTime: 108.5s (93.9%)  <-- Bottleneck
# DownloadTime: 5.2s (4.5%)
# IndexTime: 1.8s (1.6%)
```

**3. Drill Down into Bottleneck**

For OCR bottleneck:

```python
# Profile Tesseract performance by file size
import pytesseract
import time
from PIL import Image

def profile_ocr_by_size():
    test_files = {
        'small': 'test_5mb.pdf',
        'medium': 'test_50mb.pdf',
        'large': 'test_100mb.pdf'
    }

    for size, file_path in test_files.items():
        start = time.time()

        # Convert PDF to images
        images = convert_from_path(file_path, dpi=200)

        # OCR each page
        for image in images:
            text = pytesseract.image_to_string(image, config='--psm 1 --oem 2')

        duration = time.time() - start

        file_size = os.path.getsize(file_path) / 1024 / 1024  # MB
        pages = len(images)

        print(f"{size.capitalize()}: {file_size:.1f}MB, {pages} pages, {duration:.2f}s")
        print(f"  Time per page: {duration/pages:.2f}s")
        print(f"  Time per MB: {duration/file_size:.2f}s")
```

**4. Test Optimizations**

Compare baseline vs optimized:

```python
# Test different DPI settings
for dpi in [150, 200, 250, 300]:
    start = time.time()

    images = convert_from_path(test_pdf, dpi=dpi)
    for image in images:
        text = pytesseract.image_to_string(image)

    duration = time.time() - start

    print(f"DPI {dpi}: {duration:.2f}s")

# Expected output:
# DPI 150: 85.2s (acceptable quality)
# DPI 200: 120.5s (good quality) <-- Recommended
# DPI 250: 165.8s (better quality)
# DPI 300: 215.3s (best quality, slow)
```

### Common Bottlenecks & Solutions

| Bottleneck | Symptom | Solution |
|------------|---------|----------|
| **OCR (CPU)** | OCRTime > 100s | Optimize Tesseract config, lower DPI |
| **Download (Network)** | DownloadTime > 10s | Use VPC endpoint, multipart download |
| **Index (I/O)** | IndexTime > 5s | Batch indexing, tune OpenSearch |
| **Queue Depth** | Depth > 1000 | Scale out more aggressively |
| **Memory** | Swap usage | Reduce workers, explicit cleanup |
| **Disk I/O** | High wait time | Use tmpfs, upgrade to gp3 |

---

## Cost Monitoring

### Cost Allocation Tags

**Tag all resources:**

```yaml
Tags:
  - Key: Project
    Value: CISFileSearch
  - Key: Environment
    Value: Production
  - Key: CostCenter
    Value: IT-Infrastructure
  - Key: Owner
    Value: DevOps
```

### Cost Breakdown Dashboard

**Estimated Monthly Costs:**

| Service | Usage | Unit Cost | Monthly Cost |
|---------|-------|-----------|--------------|
| **EC2 (on-demand)** | 2 × 24/7 | $0.192/hr | $276.48 |
| **EC2 (spot)** | 30 × 8hr/day | $0.058/hr | $417.60 |
| **EBS (gp3)** | 50GB × 40 instances | $0.08/GB-mo | $160.00 |
| **S3 (storage)** | 10TB | $0.023/GB | $235.52 |
| **S3 (transfer out)** | 0GB (VPC endpoint) | $0.00 | $0.00 |
| **SQS (requests)** | 10M requests | Free tier | $0.00 |
| **CloudWatch (metrics)** | 100 custom | $0.30/metric | $30.00 |
| **CloudWatch (logs)** | 50GB | $0.50/GB | $25.00 |
| **OpenSearch (t3.medium)** | 1 instance | $0.073/hr | $52.56 |
| **Data transfer (inter-AZ)** | 5TB | $0.01/GB | $51.20 |
| **Total** | | | **$1,248.36** |

**With optimizations:**
- Spot instances: Save $418/month (vs all on-demand)
- VPC endpoint: Save $900/month (data transfer)
- gp3 vs gp2: Save $10/month
- **Optimized total: ~$1,250/month**

### Cost Optimization Checklist

- [ ] Use spot instances (80% of fleet)
- [ ] Enable VPC endpoints (S3, SQS)
- [ ] Use gp3 EBS (20% cheaper than gp2)
- [ ] Set S3 lifecycle policies (delete temp files after 7 days)
- [ ] Right-size instances (not over-provisioned)
- [ ] Delete idle resources (dev/test environments)
- [ ] Use CloudWatch Logs retention (30 days)
- [ ] Monitor unused EBS volumes
- [ ] Use S3 Intelligent-Tiering for long-term storage
- [ ] Schedule scaling (scale in during nights/weekends)

---

## Performance Benchmarks

### Target Metrics

**Processing Performance:**
```
Single file (50MB PDF):
- Download: 5s
- OCR: 110s
- Index: 2s
- Total: 117s (target: < 120s)

Throughput per instance:
- c5.xlarge: 30 files/hour
- Target with 3 workers: 80 files/hour
```

**System Performance:**
```
SLA Targets:
- 95% of files processed within 10 minutes
- 99% of files processed within 30 minutes
- Error rate < 2%
- Queue age < 15 minutes (average)
```

**Scalability:**
```
Baseline (2 instances):
- 60 files/hour

Peak (40 instances):
- 1,200 files/hour

Scale-out time:
- Without warm pool: 3 minutes
- With warm pool: 30 seconds
```

### Load Test Results (Sample)

```
Test: 10,000 files over 4 hours
File sizes: 10-100MB (avg 50MB)
Instance type: c5.xlarge
Workers: 3 per instance

Results:
- Files processed: 9,987 (99.87% success)
- Failed: 13 (0.13% - network timeouts)
- Avg processing time: 118.5s
- P95 processing time: 155.2s
- P99 processing time: 203.7s
- Peak instances: 38
- Avg instances: 22
- Total cost: $12.45 (spot instances)
```

---

## Summary & Recommendations

### Monitoring Setup Checklist

- [ ] Deploy CloudWatch agent on all instances
- [ ] Configure custom metrics publishing
- [ ] Create operational dashboard
- [ ] Set up critical alarms
- [ ] Configure SNS alerts (email + Slack)
- [ ] Enable detailed EC2 monitoring
- [ ] Set up cost allocation tags
- [ ] Create weekly performance review dashboard
- [ ] Document baseline metrics
- [ ] Schedule monthly performance reviews

### Key Metrics to Watch

**Daily:**
- Queue depth
- Processing rate (files/hour)
- Error rate
- In-service instances

**Weekly:**
- P95 processing time
- Cost trends
- DLQ messages
- Resource utilization (CPU, memory, disk)

**Monthly:**
- Total files processed
- Total cost vs budget
- Performance trends
- Optimization opportunities

---

**Document Version**: 1.0
**Last Updated**: 2025-01-17
**Author**: CIS Performance Engineering Team
