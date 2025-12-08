# AWS CloudWatch Configuration Guide for CIS File Scanner

## Table of Contents
1. [Why This Matters - Understanding CloudWatch](#why-this-matters)
2. [Log Groups Creation](#log-groups-creation)
3. [Log Retention Policies](#log-retention-policies)
4. [Custom Metrics](#custom-metrics)
5. [Alarms Configuration](#alarms-configuration)
6. [Dashboard Creation](#dashboard-creation)
7. [CloudWatch Insights Queries](#cloudwatch-insights-queries)
8. [Cost Optimization](#cost-optimization)
9. [Verification and Testing](#verification-and-testing)
10. [Troubleshooting](#troubleshooting)

---

## Why This Matters - Understanding CloudWatch

### What is CloudWatch?

AWS CloudWatch is a monitoring and observability service that provides:

1. **Logging**: Centralized log storage and analysis
2. **Metrics**: Performance monitoring and tracking
3. **Alarms**: Automated alerting on thresholds
4. **Dashboards**: Visual monitoring interfaces
5. **Insights**: Log querying and analysis

### CloudWatch for CIS File Scanner

**Our monitoring needs:**

```
┌─────────────────┐
│  File Scanner   │
│     (EC2)       │
└────────┬────────┘
         │
         │ Logs: Scan progress, errors, file counts
         ▼
┌─────────────────┐      ┌──────────────────┐
│   CloudWatch    │─────▶│   Alarms/SNS     │
│   Logs          │      │   (Alerts)       │
└────────┬────────┘      └──────────────────┘
         │
         │ Metrics: Files/sec, errors, memory
         ▼
┌─────────────────┐      ┌──────────────────┐
│   CloudWatch    │─────▶│   Dashboard      │
│   Metrics       │      │   (Visualization)│
└─────────────────┘      └──────────────────┘
```

### Key CloudWatch Concepts

- **Log Group**: Container for log streams (e.g., `/aws/cis-file-scanner`)
- **Log Stream**: Sequence of log events from one source (e.g., `scanner-01/2025-01-12`)
- **Log Event**: Individual log entry with timestamp and message
- **Metric**: Time-ordered data points (e.g., files scanned per minute)
- **Dimension**: Name-value pair for metric filtering (e.g., `Environment=Production`)
- **Alarm**: Automated notification based on metric thresholds
- **Dashboard**: Visual representation of metrics and logs

### Cost Implications

**Pricing** (Tokyo region):

| Service | Free Tier | After Free Tier |
|---------|-----------|-----------------|
| **Logs Ingestion** | 5 GB/month | $0.76 per GB |
| **Logs Storage** | 5 GB | $0.033 per GB/month |
| **Custom Metrics** | 10 metrics | $0.30 per metric/month |
| **API Calls** | 1M PutLogEvents | $0.01 per 1000 calls |
| **Alarms** | 10 alarms | $0.10 per alarm/month |
| **Dashboards** | 3 dashboards | $3.00 per dashboard/month |

**Expected costs for our workload** (100K files/month):

**Logging:**
- Scanner logs: ~100 MB/day = 3 GB/month
- Application logs: ~50 MB/day = 1.5 GB/month
- **Total: 4.5 GB/month = FREE** (under 5 GB)

**Metrics:**
- Files scanned, error rate, duration, memory
- ~5 custom metrics = FREE (under 10)

**Alarms:**
- 5-8 alarms = FREE (under 10)

**Dashboards:**
- 1 main dashboard = FREE (under 3)

**Estimated monthly cost**: $0 for typical workload with free tier!

**At scale** (1M files/month, 30 GB logs):
- Logs: (30 - 5) × $0.76 = $19/month
- Storage: 30 × $0.033 = $1/month
- **Total: ~$20/month**

---

## Log Groups Creation

### Log Group Naming Convention

```
/aws/{service}/{environment}/{component}

Examples:
/aws/cis-file-scanner/dev/application      # Main scanner logs
/aws/cis-file-scanner/dev/errors           # Error logs only
/aws/cis-file-scanner/dev/audit            # Audit trail
/aws/cis-file-scanner/prod/application     # Production logs
/aws/cis-file-processor/dev/lambda         # Processor Lambda logs
```

**Why this structure?**
- `/aws/` prefix: AWS convention, easier filtering
- Service name: Identifies project
- Environment: Separates dev/staging/prod
- Component: Separates different log types

### Create Log Groups

#### Console Method

1. **Navigate to CloudWatch:**
   - AWS Console → CloudWatch
   - Left menu → Logs → Log groups

2. **Create Log Group:**
   - Click "Create log group"
   - Name: `/aws/cis-file-scanner/dev/application`
   - KMS encryption: Optional (select if needed)
   - Click "Create"

3. **Repeat for other log groups:**
   ```
   /aws/cis-file-scanner/dev/application
   /aws/cis-file-scanner/dev/errors
   /aws/cis-file-scanner/dev/audit
   /aws/cis-file-scanner/dev/performance
   ```

#### CLI Method

```bash
# Set variables
ENVIRONMENT="dev"
PROJECT="cis-file-scanner"

# Create log groups
aws logs create-log-group \
  --log-group-name /aws/${PROJECT}/${ENVIRONMENT}/application \
  --region ap-northeast-1

aws logs create-log-group \
  --log-group-name /aws/${PROJECT}/${ENVIRONMENT}/errors \
  --region ap-northeast-1

aws logs create-log-group \
  --log-group-name /aws/${PROJECT}/${ENVIRONMENT}/audit \
  --region ap-northeast-1

aws logs create-log-group \
  --log-group-name /aws/${PROJECT}/${ENVIRONMENT}/performance \
  --region ap-northeast-1

# Add tags for cost tracking
for LOG_GROUP in \
  "/aws/${PROJECT}/${ENVIRONMENT}/application" \
  "/aws/${PROJECT}/${ENVIRONMENT}/errors" \
  "/aws/${PROJECT}/${ENVIRONMENT}/audit" \
  "/aws/${PROJECT}/${ENVIRONMENT}/performance"
do
  aws logs tag-log-group \
    --log-group-name $LOG_GROUP \
    --tags Project=CISFileSearch,Environment=$ENVIRONMENT,CostCenter=IT
done

# Verify creation
aws logs describe-log-groups \
  --log-group-name-prefix /aws/${PROJECT}/${ENVIRONMENT}/ \
  --query 'logGroups[*].logGroupName'
```

### Log Group Purposes

**1. Application Log Group** (`/application`)
- **Purpose**: General application logs, info messages, scan progress
- **Examples**:
  ```
  2025-01-12T10:30:00Z [INFO] Starting full scan of /mnt/nas
  2025-01-12T10:30:15Z [INFO] Scanned 1000 files, 150 MB uploaded
  2025-01-12T10:35:30Z [INFO] Scan complete: 50,000 files, 5.2 GB
  ```

**2. Error Log Group** (`/errors`)
- **Purpose**: Errors only, for alerting and debugging
- **Examples**:
  ```
  2025-01-12T10:31:45Z [ERROR] Failed to upload file: /nas/large-file.pdf
  2025-01-12T10:31:45Z [ERROR] S3 Error: RequestTimeout
  2025-01-12T10:31:50Z [ERROR] Retry 1/3 failed
  ```

**3. Audit Log Group** (`/audit`)
- **Purpose**: Security and compliance tracking
- **Examples**:
  ```
  2025-01-12T10:30:00Z [AUDIT] Scan initiated by user: admin
  2025-01-12T10:35:30Z [AUDIT] Uploaded 50,000 files to S3
  2025-01-12T10:35:31Z [AUDIT] Sent 50,000 messages to SQS
  ```

**4. Performance Log Group** (`/performance`)
- **Purpose**: Timing metrics, profiling data
- **Examples**:
  ```
  2025-01-12T10:30:00Z [PERF] File scan: 125ms, S3 upload: 3.2s
  2025-01-12T10:30:05Z [PERF] Batch size: 100, throughput: 45 files/sec
  2025-01-12T10:30:10Z [PERF] Memory usage: 512 MB, CPU: 65%
  ```

### Encryption (Optional)

**When to encrypt logs:**
- Logs contain sensitive data (PII, credentials)
- Compliance requirements (HIPAA, PCI DSS)
- Sharing logs across accounts

**How to encrypt:**

```bash
# Create KMS key for CloudWatch
KEY_ID=$(aws kms create-key \
  --description "CloudWatch Logs encryption for CIS File Scanner" \
  --query 'KeyMetadata.KeyId' \
  --output text)

# Create alias
aws kms create-alias \
  --alias-name alias/cis-cloudwatch-logs \
  --target-key-id $KEY_ID

# Get key ARN
KEY_ARN=$(aws kms describe-key --key-id $KEY_ID --query 'KeyMetadata.Arn' --output text)

# Update key policy to allow CloudWatch
aws kms put-key-policy \
  --key-id $KEY_ID \
  --policy-name default \
  --policy "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [
      {
        \"Effect\": \"Allow\",
        \"Principal\": {
          \"Service\": \"logs.ap-northeast-1.amazonaws.com\"
        },
        \"Action\": [
          \"kms:Encrypt\",
          \"kms:Decrypt\",
          \"kms:ReEncrypt*\",
          \"kms:GenerateDataKey*\",
          \"kms:CreateGrant\",
          \"kms:DescribeKey\"
        ],
        \"Resource\": \"*\",
        \"Condition\": {
          \"ArnLike\": {
            \"kms:EncryptionContext:aws:logs:arn\": \"arn:aws:logs:ap-northeast-1:ACCOUNT_ID:*\"
          }
        }
      }
    ]
  }"

# Create encrypted log group
aws logs create-log-group \
  --log-group-name /aws/cis-file-scanner/dev/application \
  --kms-key-id $KEY_ARN
```

**Cost**: +$1/month per key + $0.03 per 10,000 requests

**For this project**: Encryption is optional. Use if handling sensitive data.

---

## Log Retention Policies

### Why Retention Matters

**Without retention policy:**
- Logs stored indefinitely
- Storage costs increase over time
- Old, useless logs consume space

**With retention policy:**
- Automatic deletion after period
- Predictable storage costs
- Compliance with data retention rules

### Retention Policy Recommendations

| Log Group | Retention | Reason |
|-----------|-----------|--------|
| **Application** | 30 days | Debugging recent issues |
| **Errors** | 90 days | Long-term error analysis |
| **Audit** | 365 days | Compliance requirements |
| **Performance** | 7 days | Short-term optimization |

**Factors to consider:**
- **Debugging needs**: How far back do you investigate?
- **Compliance**: Legal requirements for log retention
- **Cost**: Longer retention = higher costs
- **Query performance**: Smaller log sets = faster queries

### Set Retention Policy

#### Console Method

1. CloudWatch → Log groups
2. Select log group
3. Actions → Edit retention setting
4. Select retention period
5. Save

#### CLI Method

```bash
# Set retention for each log group
aws logs put-retention-policy \
  --log-group-name /aws/cis-file-scanner/dev/application \
  --retention-in-days 30

aws logs put-retention-policy \
  --log-group-name /aws/cis-file-scanner/dev/errors \
  --retention-in-days 90

aws logs put-retention-policy \
  --log-group-name /aws/cis-file-scanner/dev/audit \
  --retention-in-days 365

aws logs put-retention-policy \
  --log-group-name /aws/cis-file-scanner/dev/performance \
  --retention-in-days 7
```

**Available retention periods:**
- 1, 3, 5, 7, 14 days
- 1, 2, 3, 4, 5, 6 months
- 1, 2, 5, 10 years
- Never expire (not recommended)

### Verify Retention

```bash
aws logs describe-log-groups \
  --log-group-name-prefix /aws/cis-file-scanner/dev/ \
  --query 'logGroups[*].[logGroupName,retentionInDays]' \
  --output table
```

**Expected output:**
```
---------------------------------------------------------------
|                    DescribeLogGroups                        |
+---------------------------------------------+---------------+
|  /aws/cis-file-scanner/dev/application     |  30           |
|  /aws/cis-file-scanner/dev/errors          |  90           |
|  /aws/cis-file-scanner/dev/audit           |  365          |
|  /aws/cis-file-scanner/dev/performance     |  7            |
+---------------------------------------------+---------------+
```

### Cost Impact of Retention

**Example**: 100 MB logs per day

| Retention | Storage | Monthly Cost |
|-----------|---------|--------------|
| 7 days | 0.7 GB | $0.02 |
| 30 days | 3 GB | $0.10 |
| 90 days | 9 GB | $0.30 |
| 365 days | 36.5 GB | $1.20 |

**Recommendation**: Start with 30 days, adjust based on usage

---

## Custom Metrics

### Why Custom Metrics?

**Built-in metrics** (EC2, S3, SQS) don't track:
- Files scanned per minute
- Upload success rate
- Average file size
- Processing errors

**Custom metrics** fill this gap.

### Metric Naming Convention

```
{Namespace}/{MetricName}

Examples:
CISFileScanner/FilesScanned
CISFileScanner/UploadErrors
CISFileScanner/AverageFileSize
CISFileScanner/ScanDuration
```

### Key Metrics for File Scanner

**1. Throughput Metrics:**
- `FilesScanned`: Total files scanned
- `FilesUploaded`: Successfully uploaded to S3
- `MessagesPublished`: Sent to SQS

**2. Error Metrics:**
- `UploadErrors`: Failed S3 uploads
- `SQSErrors`: Failed SQS publishes
- `ScanErrors`: File access errors

**3. Performance Metrics:**
- `ScanDuration`: Time to complete scan (seconds)
- `UploadDuration`: Average upload time (ms)
- `ThroughputRate`: Files per second

**4. Resource Metrics:**
- `MemoryUsage`: Process memory (MB)
- `DiskUsage`: Disk space used (GB)

### Publish Custom Metrics from Code

**Node.js SDK v3:**

```typescript
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

const cloudwatch = new CloudWatchClient({ region: 'ap-northeast-1' });

async function publishMetrics(
  metricName: string,
  value: number,
  unit: string,
  dimensions: Record<string, string> = {}
) {
  const command = new PutMetricDataCommand({
    Namespace: 'CISFileScanner',
    MetricData: [
      {
        MetricName: metricName,
        Value: value,
        Unit: unit,
        Timestamp: new Date(),
        Dimensions: Object.entries(dimensions).map(([Name, Value]) => ({
          Name,
          Value,
        })),
      },
    ],
  });

  await cloudwatch.send(command);
}

// Example usage in scanner
class FileScanner {
  private scannedCount = 0;
  private errorCount = 0;
  private startTime = Date.now();

  async scanFiles() {
    // Scan logic...

    this.scannedCount++;

    // Publish metric every 100 files
    if (this.scannedCount % 100 === 0) {
      await publishMetrics('FilesScanned', this.scannedCount, 'Count', {
        Environment: 'dev',
        Scanner: 'scanner-01',
      });

      // Calculate and publish throughput
      const duration = (Date.now() - this.startTime) / 1000;
      const throughput = this.scannedCount / duration;

      await publishMetrics('ThroughputRate', throughput, 'Count/Second', {
        Environment: 'dev',
      });
    }
  }

  async uploadFile(file: File) {
    try {
      await s3.upload(file);

      await publishMetrics('FilesUploaded', 1, 'Count', {
        Environment: 'dev',
        FileType: file.extension,
      });
    } catch (error) {
      this.errorCount++;

      await publishMetrics('UploadErrors', 1, 'Count', {
        Environment: 'dev',
        ErrorType: error.code,
      });

      throw error;
    }
  }

  async finishScanning() {
    const duration = (Date.now() - this.startTime) / 1000;

    await publishMetrics('ScanDuration', duration, 'Seconds', {
      Environment: 'dev',
      ScanType: 'full',
    });

    await publishMetrics('SuccessRate',
      (this.scannedCount - this.errorCount) / this.scannedCount * 100,
      'Percent',
      { Environment: 'dev' }
    );
  }
}
```

### Publish Metrics via CLI

```bash
# Publish files scanned metric
aws cloudwatch put-metric-data \
  --namespace CISFileScanner \
  --metric-name FilesScanned \
  --value 1000 \
  --unit Count \
  --dimensions Environment=dev,Scanner=scanner-01

# Publish error count
aws cloudwatch put-metric-data \
  --namespace CISFileScanner \
  --metric-name UploadErrors \
  --value 5 \
  --unit Count \
  --dimensions Environment=dev,ErrorType=Timeout

# Publish duration
aws cloudwatch put-metric-data \
  --namespace CISFileScanner \
  --metric-name ScanDuration \
  --value 3600 \
  --unit Seconds \
  --dimensions Environment=dev,ScanType=full
```

### Batch Publish (Efficient)

Send up to 20 metrics in one API call:

```typescript
async function publishMetricsBatch(metrics: MetricData[]) {
  const command = new PutMetricDataCommand({
    Namespace: 'CISFileScanner',
    MetricData: metrics.map(m => ({
      MetricName: m.name,
      Value: m.value,
      Unit: m.unit,
      Timestamp: new Date(),
      Dimensions: [
        { Name: 'Environment', Value: 'dev' },
        { Name: 'Scanner', Value: 'scanner-01' },
      ],
    })),
  });

  await cloudwatch.send(command);
}

// Usage
await publishMetricsBatch([
  { name: 'FilesScanned', value: 1000, unit: 'Count' },
  { name: 'FilesUploaded', value: 995, unit: 'Count' },
  { name: 'UploadErrors', value: 5, unit: 'Count' },
  { name: 'ThroughputRate', value: 45.5, unit: 'Count/Second' },
]);
```

### Metric Units

**Standard units:**
- `Count`: Simple counter
- `Seconds`, `Milliseconds`, `Microseconds`: Time
- `Bytes`, `Kilobytes`, `Megabytes`, `Gigabytes`: Size
- `Percent`: Percentage (0-100)
- `Count/Second`: Rate
- `Bytes/Second`: Throughput
- `None`: Unitless value

### View Metrics

#### Console

1. CloudWatch → Metrics → All metrics
2. Select "CISFileScanner" namespace
3. Select metric
4. View graph

#### CLI

```bash
# List metrics in namespace
aws cloudwatch list-metrics \
  --namespace CISFileScanner

# Get metric statistics (last 1 hour)
aws cloudwatch get-metric-statistics \
  --namespace CISFileScanner \
  --metric-name FilesScanned \
  --dimensions Name=Environment,Value=dev \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum,Average,Maximum
```

---

## Alarms Configuration

### Alarm Strategy

**What to alert on:**
1. **High error rates**: UploadErrors > 10/minute
2. **Queue backlog**: SQS queue depth > 1000
3. **Slow processing**: ScanDuration > 2 hours (expected 1 hour)
4. **Memory issues**: Memory > 80%
5. **DLQ messages**: Any message in DLQ

**Alert destinations:**
- Email (SNS)
- Slack webhook
- PagerDuty (production only)

### Create SNS Topic for Alerts

```bash
# Create SNS topic
TOPIC_ARN=$(aws sns create-topic \
  --name cis-file-scanner-alerts \
  --query 'TopicArn' \
  --output text)

echo "Topic ARN: $TOPIC_ARN"

# Subscribe email
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol email \
  --notification-endpoint your-email@example.com

# Confirm subscription (check email and click link)

# Subscribe Slack (using Lambda webhook)
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol lambda \
  --notification-endpoint arn:aws:lambda:ap-northeast-1:ACCOUNT_ID:function:slack-webhook
```

### Alarm 1: High Upload Error Rate

**Trigger when**: More than 10 upload errors in 5 minutes

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name cis-file-scanner-high-upload-errors \
  --alarm-description "Alert when upload errors exceed 10 in 5 minutes" \
  --namespace CISFileScanner \
  --metric-name UploadErrors \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --dimensions Name=Environment,Value=dev \
  --alarm-actions $TOPIC_ARN \
  --treat-missing-data notBreaching
```

**Why these settings?**
- `Sum` over 5 minutes catches spikes
- `threshold 10`: Tolerates occasional errors
- `evaluation-periods 1`: Alert immediately
- `treat-missing-data notBreaching`: No false alarms when scanner is off

### Alarm 2: SQS Queue Backlog

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name cis-file-scanner-queue-backlog \
  --alarm-description "Alert when queue depth exceeds 1000" \
  --namespace AWS/SQS \
  --metric-name ApproximateNumberOfMessagesVisible \
  --statistic Average \
  --period 300 \
  --threshold 1000 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=QueueName,Value=cis-filesearch-queue-dev \
  --alarm-actions $TOPIC_ARN
```

**Why 2 evaluation periods?**
- Avoids alert on temporary spikes
- Only alerts if backlog persists 10+ minutes

### Alarm 3: Slow Scan Duration

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name cis-file-scanner-slow-scan \
  --alarm-description "Alert when scan takes over 2 hours" \
  --namespace CISFileScanner \
  --metric-name ScanDuration \
  --statistic Maximum \
  --period 3600 \
  --threshold 7200 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --dimensions Name=Environment,Value=dev \
  --alarm-actions $TOPIC_ARN
```

### Alarm 4: DLQ Has Messages

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name cis-file-scanner-dlq-messages \
  --alarm-description "Alert when messages reach DLQ" \
  --namespace AWS/SQS \
  --metric-name ApproximateNumberOfMessagesVisible \
  --statistic Average \
  --period 60 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --evaluation-periods 1 \
  --dimensions Name=QueueName,Value=cis-filesearch-dlq-dev \
  --alarm-actions $TOPIC_ARN
```

### Alarm 5: Low Throughput

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name cis-file-scanner-low-throughput \
  --alarm-description "Alert when throughput drops below 10 files/sec" \
  --namespace CISFileScanner \
  --metric-name ThroughputRate \
  --statistic Average \
  --period 300 \
  --threshold 10 \
  --comparison-operator LessThanThreshold \
  --evaluation-periods 3 \
  --dimensions Name=Environment,Value=dev \
  --alarm-actions $TOPIC_ARN \
  --treat-missing-data notBreaching
```

### Composite Alarms

Combine multiple alarms to reduce false positives:

```bash
# Create composite alarm: (High errors AND slow throughput)
aws cloudwatch put-composite-alarm \
  --alarm-name cis-file-scanner-performance-degraded \
  --alarm-description "Scanner performance degraded" \
  --alarm-rule "ALARM(cis-file-scanner-high-upload-errors) AND ALARM(cis-file-scanner-low-throughput)" \
  --alarm-actions $TOPIC_ARN
```

### List and Manage Alarms

```bash
# List all alarms
aws cloudwatch describe-alarms \
  --alarm-name-prefix cis-file-scanner

# Check alarm state
aws cloudwatch describe-alarms \
  --alarm-names cis-file-scanner-high-upload-errors \
  --query 'MetricAlarms[0].StateValue'

# Disable alarm temporarily
aws cloudwatch disable-alarm-actions \
  --alarm-names cis-file-scanner-high-upload-errors

# Re-enable
aws cloudwatch enable-alarm-actions \
  --alarm-names cis-file-scanner-high-upload-errors

# Delete alarm
aws cloudwatch delete-alarms \
  --alarm-names cis-file-scanner-high-upload-errors
```

---

## Dashboard Creation

### Why Dashboards?

**Benefits:**
- Real-time monitoring at a glance
- Visual representation of health
- Shareable with team/management
- Historical trend analysis

### Dashboard Layout for File Scanner

```
┌─────────────────────────────────────────────────────┐
│  CIS File Scanner - Operations Dashboard            │
├──────────────────┬──────────────────┬───────────────┤
│  Files Scanned   │  Upload Errors   │  Queue Depth  │
│  (Line graph)    │  (Bar graph)     │  (Number)     │
├──────────────────┴──────────────────┴───────────────┤
│  Throughput Rate (Files/sec over time)              │
│  (Line graph with colors)                           │
├─────────────────────────────────────────────────────┤
│  Error Distribution (Pie chart)                     │
├──────────────────┬──────────────────────────────────┤
│  Recent Logs     │  Active Alarms                   │
│  (Log widget)    │  (Alarm widget)                  │
└──────────────────┴──────────────────────────────────┘
```

### Create Dashboard via CLI

```bash
# Create dashboard JSON
cat > dashboard-config.json <<'EOF'
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["CISFileScanner", "FilesScanned", {"stat": "Sum", "label": "Files Scanned"}]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "ap-northeast-1",
        "title": "Files Scanned (5min intervals)",
        "yAxis": {
          "left": {"min": 0}
        }
      },
      "width": 8,
      "height": 6,
      "x": 0,
      "y": 0
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["CISFileScanner", "UploadErrors", {"stat": "Sum", "color": "#d62728"}]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "ap-northeast-1",
        "title": "Upload Errors",
        "yAxis": {
          "left": {"min": 0}
        }
      },
      "width": 8,
      "height": 6,
      "x": 8,
      "y": 0
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/SQS", "ApproximateNumberOfMessagesVisible", {
            "stat": "Average",
            "dimensions": {"QueueName": "cis-filesearch-queue-dev"}
          }]
        ],
        "period": 60,
        "stat": "Average",
        "region": "ap-northeast-1",
        "title": "Queue Depth",
        "yAxis": {
          "left": {"min": 0}
        }
      },
      "width": 8,
      "height": 6,
      "x": 16,
      "y": 0
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["CISFileScanner", "ThroughputRate", {"stat": "Average", "label": "Files/sec"}]
        ],
        "period": 60,
        "stat": "Average",
        "region": "ap-northeast-1",
        "title": "Throughput Rate (Files per Second)",
        "yAxis": {
          "left": {"min": 0}
        },
        "annotations": {
          "horizontal": [{
            "value": 10,
            "label": "Minimum expected",
            "color": "#ff7f0e"
          }]
        }
      },
      "width": 24,
      "height": 6,
      "x": 0,
      "y": 6
    },
    {
      "type": "log",
      "properties": {
        "query": "SOURCE '/aws/cis-file-scanner/dev/errors'\n| fields @timestamp, @message\n| sort @timestamp desc\n| limit 20",
        "region": "ap-northeast-1",
        "title": "Recent Errors",
        "stacked": false
      },
      "width": 12,
      "height": 6,
      "x": 0,
      "y": 12
    },
    {
      "type": "alarm",
      "properties": {
        "title": "Active Alarms",
        "alarms": [
          "arn:aws:cloudwatch:ap-northeast-1:ACCOUNT_ID:alarm:cis-file-scanner-high-upload-errors",
          "arn:aws:cloudwatch:ap-northeast-1:ACCOUNT_ID:alarm:cis-file-scanner-queue-backlog",
          "arn:aws:cloudwatch:ap-northeast-1:ACCOUNT_ID:alarm:cis-file-scanner-dlq-messages"
        ]
      },
      "width": 12,
      "height": 6,
      "x": 12,
      "y": 12
    }
  ]
}
EOF

# Create dashboard
aws cloudwatch put-dashboard \
  --dashboard-name CISFileScannerOperations \
  --dashboard-body file://dashboard-config.json

echo "Dashboard created: https://console.aws.amazon.com/cloudwatch/home?region=ap-northeast-1#dashboards:name=CISFileScannerOperations"
```

### Create Dashboard via Console

1. CloudWatch → Dashboards → Create dashboard
2. Name: `CISFileScannerOperations`
3. Add widgets:

**Widget 1: Line graph - Files Scanned**
- Widget type: Line
- Metric: `CISFileScanner > FilesScanned`
- Statistic: Sum
- Period: 5 minutes

**Widget 2: Number - Current Queue Depth**
- Widget type: Number
- Metric: `AWS/SQS > ApproximateNumberOfMessagesVisible`
- Dimension: `QueueName=cis-filesearch-queue-dev`
- Statistic: Average

**Widget 3: Bar graph - Errors by Type**
- Widget type: Bar
- Metric: `CISFileScanner > UploadErrors`
- Group by: `ErrorType` dimension

**Widget 4: Log table - Recent Logs**
- Widget type: Logs table
- Log group: `/aws/cis-file-scanner/dev/application`
- Query: `fields @timestamp, @message | sort @timestamp desc | limit 20`

### Share Dashboard

```bash
# Get dashboard ARN
aws cloudwatch list-dashboards \
  --query 'DashboardEntries[?DashboardName==`CISFileScannerOperations`].DashboardArn'

# Share via URL (requires AWS Console access)
# https://console.aws.amazon.com/cloudwatch/home?region=ap-northeast-1#dashboards:name=CISFileScannerOperations

# Export dashboard for backup
aws cloudwatch get-dashboard \
  --dashboard-name CISFileScannerOperations \
  > dashboard-backup.json
```

---

## CloudWatch Insights Queries

### Why Insights?

**CloudWatch Insights** allows SQL-like queries on logs.

**Use cases:**
- Debugging specific errors
- Performance analysis
- Usage statistics
- Audit trail investigation

### Common Queries for File Scanner

**Query 1: Error rate over time**

```sql
fields @timestamp, @message
| filter @message like /ERROR/
| stats count() as error_count by bin(5m) as time_bucket
| sort time_bucket desc
```

**Query 2: Top 10 slowest files to upload**

```sql
fields @timestamp, fileName, uploadDuration
| filter @message like /upload complete/
| sort uploadDuration desc
| limit 10
```

**Query 3: Files scanned by file type**

```sql
fields fileType
| filter @message like /file scanned/
| stats count() as file_count by fileType
| sort file_count desc
```

**Query 4: Average throughput per hour**

```sql
fields @timestamp
| filter @message like /scan complete/
| stats count() as files_scanned by bin(1h) as hour
| sort hour desc
```

**Query 5: Errors by error code**

```sql
fields @timestamp, errorCode, @message
| filter @message like /ERROR/
| parse @message "ERROR: * (*)" as errorMessage, errorCode
| stats count() as error_count by errorCode
| sort error_count desc
```

**Query 6: Files that failed upload (with retry info)**

```sql
fields @timestamp, fileName, retryCount
| filter @message like /upload failed/
| sort @timestamp desc
| limit 100
```

### Run Query via Console

1. CloudWatch → Logs → Insights
2. Select log group: `/aws/cis-file-scanner/dev/application`
3. Paste query
4. Select time range (e.g., Last 1 hour)
5. Run query
6. Save query for reuse

### Run Query via CLI

```bash
# Start query
QUERY_ID=$(aws logs start-query \
  --log-group-name /aws/cis-file-scanner/dev/application \
  --start-time $(date -u -d '1 hour ago' +%s) \
  --end-time $(date -u +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /ERROR/ | stats count() as error_count by bin(5m)' \
  --query 'queryId' \
  --output text)

# Wait for completion
sleep 5

# Get results
aws logs get-query-results --query-id $QUERY_ID
```

### Save Queries

```bash
# Create query definition
aws logs put-query-definition \
  --name "CIS Scanner Error Rate" \
  --query-string 'fields @timestamp, @message | filter @message like /ERROR/ | stats count() as error_count by bin(5m)' \
  --log-group-names /aws/cis-file-scanner/dev/application

# List saved queries
aws logs describe-query-definitions
```

---

## Cost Optimization

### 1. Log Sampling (Reduce Ingestion)

**For high-volume, low-value logs:**

```typescript
// Sample 10% of debug logs
const shouldLog = Math.random() < 0.1;

if (shouldLog || level === 'ERROR') {
  logger.debug(`File processed: ${fileName}`);
}
```

**Or use environment variable:**

```typescript
const LOG_SAMPLE_RATE = parseFloat(process.env.LOG_SAMPLE_RATE || '1.0');

function log(level: string, message: string) {
  if (level === 'ERROR' || Math.random() < LOG_SAMPLE_RATE) {
    console.log(`[${level}] ${message}`);
  }
}
```

**Savings**: 90% reduction in log volume with 10% sampling

### 2. Structured Logging (Better Compression)

```typescript
// ❌ Unstructured (poor compression)
console.log(`Uploaded file ${fileName} size ${fileSize} to ${bucket}`);

// ✅ Structured (better compression)
console.log(JSON.stringify({
  event: 'file_uploaded',
  file: fileName,
  size: fileSize,
  bucket: bucket,
  timestamp: Date.now(),
}));
```

**Why better?**
- Repeated field names compress well
- Easier to query in Insights
- Smaller storage footprint

### 3. Appropriate Retention

```bash
# Performance logs: 7 days (short-lived)
aws logs put-retention-policy \
  --log-group-name /aws/cis-file-scanner/dev/performance \
  --retention-in-days 7

# Don't keep forever (default)
# After 30 days, logs rarely accessed
```

### 4. Export Old Logs to S3

For long-term archival at lower cost:

```bash
# Export logs to S3 (1/10th the cost of CloudWatch storage)
aws logs create-export-task \
  --log-group-name /aws/cis-file-scanner/dev/application \
  --from $(date -u -d '60 days ago' +%s)000 \
  --to $(date -u -d '30 days ago' +%s)000 \
  --destination cis-filesearch-logs-archive \
  --destination-prefix logs/cis-scanner/
```

**Cost comparison** (30 days of logs, 3 GB):
- CloudWatch: 3 GB × $0.033 = $0.10/month
- S3 Glacier: 3 GB × $0.004 = $0.01/month
- **Savings**: 90%

### 5. Batch Metric Publishing

```typescript
// ❌ Individual publishes (10 API calls)
for (let i = 0; i < 10; i++) {
  await publishMetric('FilesScanned', 1, 'Count');
}

// ✅ Batch publish (1 API call)
await publishMetricsBatch(
  Array(10).fill({ name: 'FilesScanned', value: 1, unit: 'Count' })
);
```

**Savings**: 10x fewer API calls

### 6. Use Log Insights Sparingly

**Query costs:**
- First 5 GB scanned: FREE
- After 5 GB: $0.005 per GB scanned

**To minimize:**
- Use narrow time ranges (last 1 hour vs last 7 days)
- Filter early in query (before stats/sort)
- Cache query results
- Use dashboards for frequent queries (pre-aggregated)

### 7. Delete Unused Log Groups

```bash
# List log groups with no recent activity
aws logs describe-log-groups \
  --query 'logGroups[?lastIngestionTime<`'$(date -u -d '30 days ago' +%s)'000`].logGroupName'

# Delete if confirmed unused
aws logs delete-log-group --log-group-name /aws/old-project/logs
```

### Cost Monitoring

**Create budget alert:**

```bash
aws budgets create-budget \
  --account-id $(aws sts get-caller-identity --query Account --output text) \
  --budget '{
    "BudgetName": "CloudWatch-Monthly-Budget",
    "BudgetLimit": {
      "Amount": "10.0",
      "Unit": "USD"
    },
    "TimeUnit": "MONTHLY",
    "BudgetType": "COST",
    "CostFilters": {
      "Service": ["Amazon CloudWatch"]
    }
  }' \
  --notifications-with-subscribers '[{
    "Notification": {
      "NotificationType": "ACTUAL",
      "ComparisonOperator": "GREATER_THAN",
      "Threshold": 80
    },
    "Subscribers": [{
      "SubscriptionType": "EMAIL",
      "Address": "your-email@example.com"
    }]
  }]'
```

---

## Verification and Testing

### 1. Verify Log Group Creation

```bash
aws logs describe-log-groups \
  --log-group-name-prefix /aws/cis-file-scanner/dev/ \
  --query 'logGroups[*].[logGroupName,retentionInDays,storedBytes]' \
  --output table
```

### 2. Test Log Publishing from Code

```typescript
// test-logging.ts
import { CloudWatchLogsClient, PutLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';

const client = new CloudWatchLogsClient({ region: 'ap-northeast-1' });

async function testLogging() {
  const command = new PutLogEventsCommand({
    logGroupName: '/aws/cis-file-scanner/dev/application',
    logStreamName: `test-stream-${Date.now()}`,
    logEvents: [
      {
        timestamp: Date.now(),
        message: JSON.stringify({
          level: 'INFO',
          message: 'Test log from scanner',
          fileCount: 100,
        }),
      },
    ],
  });

  const result = await client.send(command);
  console.log('Log published:', result);
}

testLogging();
```

### 3. Test Custom Metric Publishing

```bash
# Publish test metric
aws cloudwatch put-metric-data \
  --namespace CISFileScanner \
  --metric-name TestMetric \
  --value 123 \
  --unit Count

# Verify metric appears (wait 1-2 minutes)
aws cloudwatch list-metrics \
  --namespace CISFileScanner \
  --metric-name TestMetric
```

### 4. Test Alarm Triggering

```bash
# Publish high error count to trigger alarm
for i in {1..15}; do
  aws cloudwatch put-metric-data \
    --namespace CISFileScanner \
    --metric-name UploadErrors \
    --value 1 \
    --unit Count \
    --dimensions Environment=dev
done

# Wait 5 minutes, check alarm state
aws cloudwatch describe-alarms \
  --alarm-names cis-file-scanner-high-upload-errors \
  --query 'MetricAlarms[0].[StateValue,StateReason]'

# Should show "ALARM" state and receive SNS notification
```

### 5. Test Dashboard

```bash
# Open dashboard in browser
echo "https://console.aws.amazon.com/cloudwatch/home?region=ap-northeast-1#dashboards:name=CISFileScannerOperations"

# Verify widgets load
# Should see metrics, logs, alarms
```

### 6. Test Insights Query

```bash
# Start test query
QUERY_ID=$(aws logs start-query \
  --log-group-name /aws/cis-file-scanner/dev/application \
  --start-time $(date -u -d '1 hour ago' +%s) \
  --end-time $(date -u +%s) \
  --query-string 'fields @timestamp, @message | limit 10' \
  --query 'queryId' \
  --output text)

# Get results
sleep 3
aws logs get-query-results --query-id $QUERY_ID
```

---

## Troubleshooting

### Issue 1: Logs Not Appearing

**Symptoms:**
- Code runs but no logs in CloudWatch

**Diagnosis:**

```bash
# Check if log group exists
aws logs describe-log-groups \
  --log-group-name /aws/cis-file-scanner/dev/application

# Check IAM permissions
aws iam get-role --role-name CISFileScannerRole
aws iam list-attached-role-policies --role-name CISFileScannerRole
```

**Solutions:**

1. **Create log group first:**
```bash
aws logs create-log-group \
  --log-group-name /aws/cis-file-scanner/dev/application
```

2. **Add CloudWatch Logs permissions:**
```json
{
  "Effect": "Allow",
  "Action": [
    "logs:CreateLogGroup",
    "logs:CreateLogStream",
    "logs:PutLogEvents"
  ],
  "Resource": "arn:aws:logs:ap-northeast-1:ACCOUNT_ID:log-group:/aws/cis-file-scanner/*"
}
```

3. **Check log stream creation:**
```typescript
// Explicitly create log stream
import { CreateLogStreamCommand } from '@aws-sdk/client-cloudwatch-logs';

await client.send(new CreateLogStreamCommand({
  logGroupName: '/aws/cis-file-scanner/dev/application',
  logStreamName: `scanner-${Date.now()}`,
}));
```

### Issue 2: Metrics Not Publishing

**Diagnosis:**

```bash
# List metrics in namespace
aws cloudwatch list-metrics --namespace CISFileScanner

# If empty, check IAM permissions
```

**Solutions:**

1. **Add CloudWatch metrics permission:**
```json
{
  "Effect": "Allow",
  "Action": "cloudwatch:PutMetricData",
  "Resource": "*"
}
```

2. **Check metric name/namespace:**
```typescript
// Verify correct casing
await cloudwatch.send(new PutMetricDataCommand({
  Namespace: 'CISFileScanner', // Exact match
  MetricData: [{
    MetricName: 'FilesScanned', // Exact match
    Value: 100,
  }],
}));
```

### Issue 3: Alarm Not Triggering

**Diagnosis:**

```bash
# Check alarm configuration
aws cloudwatch describe-alarms \
  --alarm-names cis-file-scanner-high-upload-errors

# Check metric data exists
aws cloudwatch get-metric-statistics \
  --namespace CISFileScanner \
  --metric-name UploadErrors \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Sum
```

**Common issues:**

1. **Dimension mismatch:**
```bash
# Alarm dimension: Environment=prod
# Metric dimension: Environment=dev
# Solution: Match dimensions exactly
```

2. **Insufficient data:**
```bash
# Set treat-missing-data
aws cloudwatch put-metric-alarm \
  --alarm-name test-alarm \
  --treat-missing-data notBreaching \
  ... (other params)
```

3. **SNS subscription not confirmed:**
```bash
# Check subscription status
aws sns list-subscriptions-by-topic \
  --topic-arn $TOPIC_ARN

# Should show "SubscriptionArn" not "PendingConfirmation"
```

### Issue 4: High CloudWatch Costs

**Diagnosis:**

```bash
# Check log group sizes
aws logs describe-log-groups \
  --query 'logGroups[*].[logGroupName,storedBytes]' \
  --output table

# Check metric count
aws cloudwatch list-metrics --namespace CISFileScanner \
  | jq '.Metrics | length'

# Use Cost Explorer
aws ce get-cost-and-usage \
  --time-period Start=$(date -u -d '1 month ago' +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
  --granularity MONTHLY \
  --filter file://cost-filter.json \
  --metrics BlendedCost

# cost-filter.json:
# {"Dimensions": {"Key": "SERVICE", "Values": ["Amazon CloudWatch"]}}
```

**Solutions:**

1. **Reduce retention:**
```bash
aws logs put-retention-policy \
  --log-group-name /aws/cis-file-scanner/dev/application \
  --retention-in-days 7
```

2. **Sample verbose logs:**
```typescript
const shouldLog = process.env.LOG_LEVEL === 'DEBUG' || Math.random() < 0.1;
```

3. **Export to S3:**
```bash
aws logs create-export-task \
  --log-group-name /aws/cis-file-scanner/dev/application \
  --from $(date -u -d '30 days ago' +%s)000 \
  --to $(date -u +%s)000 \
  --destination cis-logs-archive
```

---

## Summary Checklist

- [ ] Log groups created for all components
- [ ] Retention policies configured
- [ ] CloudWatch Logs IAM permissions added
- [ ] Custom metrics publishing implemented
- [ ] SNS topic for alerts created
- [ ] Alarms configured (errors, queue, DLQ)
- [ ] Dashboard created with key widgets
- [ ] Insights queries saved
- [ ] Log publishing tested
- [ ] Metric publishing tested
- [ ] Alarm triggering tested
- [ ] Dashboard loads correctly
- [ ] Cost monitoring configured

---

## Next Steps

1. **Create VPC Endpoints**: See `aws-vpc-endpoints-guide.md`
2. **Integrate Logging in Scanner**: Update code to publish logs/metrics
3. **Test End-to-End**: Run scan and verify logs/metrics appear
4. **Set Up Monitoring Rotation**: Assign team member to check dashboard daily
5. **Document Runbook**: Create procedures for investigating alarms

---

## Additional Resources

- [CloudWatch Logs User Guide](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/)
- [CloudWatch Metrics User Guide](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/)
- [CloudWatch Insights Query Syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html)
- [CloudWatch Pricing](https://aws.amazon.com/cloudwatch/pricing/)
- [CloudWatch Best Practices](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html)

---

**Document Version**: 1.0
**Last Updated**: 2025-01-12
**Author**: CIS Development Team
