# AWS EventBridge S3 to SQS Configuration Guide

## Table of Contents
1. [Why This Matters - Understanding Event-Driven Architecture](#why-this-matters)
2. [S3 Event Notifications Setup](#s3-event-notifications-setup)
3. [EventBridge Rule Creation](#eventbridge-rule-creation)
4. [Testing Event Flow](#testing-event-flow)
5. [Filtering and Pattern Matching](#filtering-and-pattern-matching)
6. [Monitoring and Troubleshooting](#monitoring-and-troubleshooting)

---

## Why This Matters - Understanding Event-Driven Architecture

### The Problem We're Solving

**Without EventBridge:**
```
Scanner uploads file to S3
Scanner manually sends message to SQS
(If scanner crashes after upload but before SQS send, file is lost)
```

**With EventBridge:**
```
Scanner uploads file to S3
S3 automatically emits event to EventBridge
EventBridge routes event to SQS
(Guaranteed processing, no manual coordination needed)
```

### Architecture Flow

```
Windows Scanner PC
        ↓ (DataSync)
    S3 Landing Bucket
        ↓ (automatic event)
    EventBridge
        ↓ (rule matches)
    SQS Queue
        ↓ (workers poll)
    EC2 Auto Scaling Group
        ↓ (process)
    OpenSearch + Bedrock
```

### Benefits of EventBridge

1. **Decoupling**: Scanner doesn't need to know about SQS
2. **Reliability**: AWS guarantees event delivery
3. **Flexibility**: Easy to add more targets (SNS, Lambda, etc.)
4. **Filtering**: Process only specific file types
5. **Observability**: Built-in CloudWatch metrics

### Cost Implications

**EventBridge pricing** (Tokyo region):
- First 1M events/month: **FREE**
- After that: $1.00 per million events

**For 100K files/month:**
- Events generated: 100,000
- Cost: **$0** (under free tier)

**Even at 1M files/month:** Only $1.00

**EventBridge is extremely cost-effective!**

---

## S3 Event Notifications Setup

### Step 1: Enable EventBridge for S3 Bucket

Before creating rules, enable EventBridge notifications on the S3 bucket.

#### Console Method

1. **Go to S3 Console**
2. **Select bucket**: `cis-filesearch-landing-dev`
3. **Properties tab** → Scroll to "Event notifications"
4. **Amazon EventBridge** section
5. **Click "Edit"**
6. **Enable**: Turn on "Send notifications to Amazon EventBridge"
7. **Save changes**

**What this does:**
- Enables S3 to send events to EventBridge
- All object creation/deletion events now go to EventBridge
- No additional cost

#### CLI Method

```bash
BUCKET_NAME="cis-filesearch-landing-dev"
REGION="ap-northeast-1"

# Enable EventBridge notifications
aws s3api put-bucket-notification-configuration \
  --bucket $BUCKET_NAME \
  --region $REGION \
  --notification-configuration '{
    "EventBridgeConfiguration": {}
  }'

# Verify enabled
aws s3api get-bucket-notification-configuration \
  --bucket $BUCKET_NAME \
  --region $REGION
```

**Expected output:**
```json
{
    "EventBridgeConfiguration": {}
}
```

### Step 2: Verify S3 Events in EventBridge

Upload a test file and check if events appear:

```bash
# Upload test file
echo "EventBridge test" > test-event.txt
aws s3 cp test-event.txt s3://$BUCKET_NAME/test/

# Check CloudWatch Logs for EventBridge events
aws logs tail /aws/events/aws.s3 --follow --since 1m
```

---

## EventBridge Rule Creation

### Understanding Event Patterns

When a file is uploaded to S3, EventBridge receives this event:

```json
{
  "version": "0",
  "id": "c6c5a3f4-...",
  "detail-type": "Object Created",
  "source": "aws.s3",
  "account": "123456789012",
  "time": "2025-01-18T10:30:00Z",
  "region": "ap-northeast-1",
  "resources": [
    "arn:aws:s3:::cis-filesearch-landing-dev"
  ],
  "detail": {
    "version": "0",
    "bucket": {
      "name": "cis-filesearch-landing-dev"
    },
    "object": {
      "key": "files/2025/01/document.pdf",
      "size": 1048576,
      "etag": "686897696a7c876b7e",
      "sequencer": "0061E5C3D1234567890"
    },
    "request-id": "1234567890ABCDEF",
    "requester": "123456789012",
    "source-ip-address": "10.0.1.100",
    "reason": "PutObject"
  }
}
```

### Create EventBridge Rule

#### Console Method

**Step 1: Navigate to EventBridge**

1. AWS Console → Search "EventBridge"
2. Click "Rules" in left menu
3. Click "Create rule"

**Step 2: Define Rule Detail**

**Name**: `cis-s3-to-sqs-dev`

**Description**: Route S3 file upload events to SQS for processing

**Event bus**: default

**Enable**: Yes (checked)

**Rule type**: Rule with an event pattern

**Step 3: Build Event Pattern**

**Event source**: AWS events or EventBridge partner events

**Sample event**: AWS events

**Sample event type**: S3 Object Created

**Creation method**: Custom pattern (JSON editor)

**Event pattern:**

```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["cis-filesearch-landing-dev"]
    },
    "object": {
      "key": [{
        "prefix": "files/"
      }]
    }
  }
}
```

**What this pattern does:**
- Matches only `Object Created` events (not deletes)
- Only from `cis-filesearch-landing-dev` bucket
- Only files under `files/` prefix (ignores `test/`, `temp/`)

**Advanced pattern with file type filtering:**

```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["cis-filesearch-landing-dev"]
    },
    "object": {
      "key": [{
        "suffix": ".pdf"
      }, {
        "suffix": ".docx"
      }, {
        "suffix": ".xlsx"
      }, {
        "suffix": ".jpg"
      }, {
        "suffix": ".png"
      }]
    }
  }
}
```

**This filters for specific file types only**

**Step 4: Select Target**

**Target types**: AWS service

**Select a target**: SQS queue

**Queue**: `cis-filesearch-queue-dev`

**Message transformation**: Input transformer

**Why input transformer?**
- SQS receives only necessary data
- Smaller message size
- Easier to process

**Input Path:**

```json
{
  "bucket": "$.detail.bucket.name",
  "key": "$.detail.object.key",
  "size": "$.detail.object.size",
  "etag": "$.detail.object.etag",
  "time": "$.time"
}
```

**Template:**

```json
{
  "eventType": "S3_OBJECT_CREATED",
  "s3Bucket": "<bucket>",
  "s3Key": "<key>",
  "fileSize": <size>,
  "etag": "<etag>",
  "eventTime": "<time>",
  "processingRequired": true
}
```

**SQS will receive:**
```json
{
  "eventType": "S3_OBJECT_CREATED",
  "s3Bucket": "cis-filesearch-landing-dev",
  "s3Key": "files/2025/01/document.pdf",
  "fileSize": 1048576,
  "etag": "686897696a7c876b7e",
  "eventTime": "2025-01-18T10:30:00Z",
  "processingRequired": true
}
```

**Step 5: Configure Rule Settings**

**Dead-letter queue**: None (SQS already has DLQ)

**Retry policy**: Default (185 attempts over 24 hours)

**Why 185 retries?**
- Exponential backoff
- Handles transient SQS issues
- EventBridge will eventually give up

**Step 6: Tags**

```
Project: CISFileSearch
Environment: Development
Component: EventRouter
ManagedBy: Manual
```

**Step 7: Review and Create**

Click "Create rule"

#### CLI Method

```bash
QUEUE_URL=$(aws sqs get-queue-url --queue-name cis-filesearch-queue-dev --query 'QueueUrl' --output text)
QUEUE_ARN=$(aws sqs get-queue-attributes --queue-url $QUEUE_URL --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

# Create event pattern file
cat > s3-event-pattern.json <<'EOF'
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["cis-filesearch-landing-dev"]
    },
    "object": {
      "key": [{
        "prefix": "files/"
      }]
    }
  }
}
EOF

# Create input transformer
cat > input-transformer.json <<'EOF'
{
  "InputPathsMap": {
    "bucket": "$.detail.bucket.name",
    "key": "$.detail.object.key",
    "size": "$.detail.object.size",
    "etag": "$.detail.object.etag",
    "time": "$.time"
  },
  "InputTemplate": "{\"eventType\":\"S3_OBJECT_CREATED\",\"s3Bucket\":\"<bucket>\",\"s3Key\":\"<key>\",\"fileSize\":<size>,\"etag\":\"<etag>\",\"eventTime\":\"<time>\",\"processingRequired\":true}"
}
EOF

# Create EventBridge rule
aws events put-rule \
  --name cis-s3-to-sqs-dev \
  --description "Route S3 file uploads to SQS for processing" \
  --event-pattern file://s3-event-pattern.json \
  --state ENABLED \
  --region $REGION

# Add SQS as target
aws events put-targets \
  --rule cis-s3-to-sqs-dev \
  --targets "Id"="1","Arn"="$QUEUE_ARN","InputTransformer"="$(cat input-transformer.json)" \
  --region $REGION
```

### Grant EventBridge Permission to Send to SQS

EventBridge needs permission to send messages to your SQS queue.

#### Update SQS Queue Policy

```bash
# Get current policy
CURRENT_POLICY=$(aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names Policy \
  --query 'Attributes.Policy' \
  --output text)

# Create new policy allowing EventBridge
cat > sqs-eventbridge-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowEventBridgeToSendMessages",
      "Effect": "Allow",
      "Principal": {
        "Service": "events.amazonaws.com"
      },
      "Action": "sqs:SendMessage",
      "Resource": "$QUEUE_ARN",
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "arn:aws:events:$REGION:$(aws sts get-caller-identity --query Account --output text):rule/cis-s3-to-sqs-dev"
        }
      }
    }
  ]
}
EOF

# Apply policy
aws sqs set-queue-attributes \
  --queue-url $QUEUE_URL \
  --attributes "Policy=$(cat sqs-eventbridge-policy.json | jq -c .)"
```

**Verify policy:**

```bash
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names Policy
```

---

## Testing Event Flow

### End-to-End Test

#### Test 1: Upload File and Verify Event

```bash
# Upload test file
echo "EventBridge test content" > eventbridge-test.txt
aws s3 cp eventbridge-test.txt s3://cis-filesearch-landing-dev/files/test/

# Wait 5 seconds for event propagation
sleep 5

# Check SQS for message
aws sqs receive-message \
  --queue-url $QUEUE_URL \
  --max-number-of-messages 1 \
  --wait-time-seconds 10 \
  --region $REGION
```

**Expected output:**

```json
{
  "Messages": [
    {
      "MessageId": "abc123...",
      "ReceiptHandle": "def456...",
      "Body": "{\"eventType\":\"S3_OBJECT_CREATED\",\"s3Bucket\":\"cis-filesearch-landing-dev\",\"s3Key\":\"files/test/eventbridge-test.txt\",\"fileSize\":27,\"etag\":\"...\",\"eventTime\":\"2025-01-18T...\",\"processingRequired\":true}"
    }
  ]
}
```

**Success!** Event flowed S3 → EventBridge → SQS

#### Test 2: Verify Filtering Works

```bash
# Upload to non-matching prefix (should NOT trigger)
aws s3 cp eventbridge-test.txt s3://cis-filesearch-landing-dev/temp/test.txt

# Check SQS (should be empty)
aws sqs receive-message \
  --queue-url $QUEUE_URL \
  --max-number-of-messages 1 \
  --wait-time-seconds 5
```

**Expected:** No messages (filtered out by event pattern)

#### Test 3: Bulk Upload Test

```bash
# Upload 100 files
for i in {1..100}; do
  echo "Test file $i" > "test-$i.txt"
  aws s3 cp "test-$i.txt" s3://cis-filesearch-landing-dev/files/bulk-test/ &
done
wait

# Wait for events
sleep 10

# Check SQS queue depth
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names ApproximateNumberOfMessages \
  --region $REGION

# Should show ~100 messages
```

---

## Filtering and Pattern Matching

### Filter by File Extension

**Match only PDFs and images:**

```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["cis-filesearch-landing-dev"]
    },
    "object": {
      "key": [{
        "suffix": ".pdf"
      }, {
        "suffix": ".jpg"
      }, {
        "suffix": ".jpeg"
      }, {
        "suffix": ".png"
      }]
    }
  }
}
```

### Filter by Path Prefix

**Match only files in specific year:**

```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["cis-filesearch-landing-dev"]
    },
    "object": {
      "key": [{
        "prefix": "files/2025/"
      }]
    }
  }
}
```

### Filter by File Size

**Match only files larger than 1MB:**

```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["cis-filesearch-landing-dev"]
    },
    "object": {
      "size": [{
        "numeric": [">", 1048576]
      }]
    }
  }
}
```

### Complex Pattern Example

**PDF files > 1MB in 2025 folder:**

```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["cis-filesearch-landing-dev"]
    },
    "object": {
      "key": [{
        "prefix": "files/2025/",
        "suffix": ".pdf"
      }],
      "size": [{
        "numeric": [">", 1048576]
      }]
    }
  }
}
```

### Update Event Pattern

```bash
# Update existing rule with new pattern
cat > new-pattern.json <<'EOF'
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["cis-filesearch-landing-dev"]
    },
    "object": {
      "key": [{
        "suffix": ".pdf"
      }, {
        "suffix": ".jpg"
      }]
    }
  }
}
EOF

aws events put-rule \
  --name cis-s3-to-sqs-dev \
  --event-pattern file://new-pattern.json \
  --region $REGION
```

---

## Monitoring and Troubleshooting

### CloudWatch Metrics

**Key EventBridge metrics:**

1. **Invocations**: Number of times rule triggered
2. **MatchedEvents**: Events that matched pattern
3. **FailedInvocations**: Failed deliveries to SQS
4. **TriggeredRules**: Total rule executions

#### View Metrics (Console)

1. CloudWatch → Metrics → All metrics
2. EventBridge → By Rule Name
3. Select metric: `Invocations`, `FailedInvocations`

#### View Metrics (CLI)

```bash
# Get invocation count (last hour)
aws cloudwatch get-metric-statistics \
  --namespace AWS/Events \
  --metric-name Invocations \
  --dimensions Name=RuleName,Value=cis-s3-to-sqs-dev \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum \
  --region $REGION
```

### CloudWatch Alarms

#### Alarm 1: Failed Invocations

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name cis-eventbridge-failed-invocations \
  --alarm-description "Alert when EventBridge fails to deliver to SQS" \
  --metric-name FailedInvocations \
  --namespace AWS/Events \
  --statistic Sum \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --dimensions Name=RuleName,Value=cis-s3-to-sqs-dev \
  --region $REGION
```

#### Alarm 2: No Events (Pipeline Stopped)

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name cis-eventbridge-no-events \
  --alarm-description "Alert when no events for 1 hour during business hours" \
  --metric-name Invocations \
  --namespace AWS/Events \
  --statistic Sum \
  --period 3600 \
  --threshold 1 \
  --comparison-operator LessThanThreshold \
  --evaluation-periods 1 \
  --dimensions Name=RuleName,Value=cis-s3-to-sqs-dev \
  --treat-missing-data notBreaching \
  --region $REGION
```

### Troubleshooting Guide

#### Issue 1: Events Not Reaching SQS

**Symptoms:**
- File uploaded to S3
- No message in SQS
- No errors visible

**Diagnosis:**

```bash
# Check if EventBridge is enabled on bucket
aws s3api get-bucket-notification-configuration \
  --bucket cis-filesearch-landing-dev

# Check rule status
aws events describe-rule \
  --name cis-s3-to-sqs-dev \
  --region $REGION

# Check targets
aws events list-targets-by-rule \
  --rule cis-s3-to-sqs-dev \
  --region $REGION

# Check EventBridge metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Events \
  --metric-name Invocations \
  --dimensions Name=RuleName,Value=cis-s3-to-sqs-dev \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Sum
```

**Solutions:**

1. **EventBridge not enabled on bucket**: Run `put-bucket-notification-configuration`
2. **Rule disabled**: Enable rule in EventBridge console
3. **Event pattern doesn't match**: Test pattern with sample event
4. **SQS permission missing**: Update SQS policy to allow EventBridge
5. **Wrong bucket in pattern**: Verify bucket name in event pattern

#### Issue 2: Duplicate Messages in SQS

**Symptoms:**
- One S3 upload creates multiple SQS messages

**Causes:**
1. Multiple EventBridge rules matching same event
2. S3 eventual consistency creating duplicate events

**Diagnosis:**

```bash
# List all rules
aws events list-rules --region $REGION | grep cis

# Check targets for each rule
aws events list-targets-by-rule --rule RULE_NAME
```

**Solutions:**
1. Delete duplicate rules
2. Implement idempotency in workers (check file hash before processing)

#### Issue 3: Events for Wrong Files

**Symptoms:**
- Test files triggering production processing

**Solution:**

Update event pattern to filter correctly:

```json
{
  "detail": {
    "object": {
      "key": [{
        "prefix": "files/",
        "anything-but": {
          "prefix": "files/test/"
        }
      }]
    }
  }
}
```

#### Issue 4: High EventBridge Costs

**Symptoms:**
- Unexpected EventBridge charges

**Diagnosis:**

```bash
# Count total events
aws cloudwatch get-metric-statistics \
  --namespace AWS/Events \
  --metric-name Invocations \
  --dimensions Name=RuleName,Value=cis-s3-to-sqs-dev \
  --start-time $(date -u -d '30 days ago' +%Y-%m-%d) \
  --end-time $(date -u +%Y-%m-%d) \
  --period 86400 \
  --statistics Sum
```

**Solutions:**
1. Add stricter filtering (file type, path)
2. Delete test files generating events
3. Disable rule during bulk operations, re-enable after

---

## Advanced Configurations

### Multiple Targets

Route S3 events to multiple destinations:

```bash
# Add SNS target for alerts
SNS_ARN="arn:aws:sns:ap-northeast-1:ACCOUNT:cis-alerts"

aws events put-targets \
  --rule cis-s3-to-sqs-dev \
  --targets \
    "Id"="1","Arn"="$QUEUE_ARN","InputTransformer"="..." \
    "Id"="2","Arn"="$SNS_ARN","InputTransformer"="..."
```

### Content-Based Filtering

Filter by object metadata:

```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["cis-filesearch-landing-dev"]
    },
    "object": {
      "key": [{
        "prefix": "files/"
      }]
    },
    "request-id": [{
      "exists": true
    }]
  }
}
```

### Archive Events

Store all events for audit:

```bash
# Create event archive
aws events create-archive \
  --archive-name cis-s3-events-archive \
  --event-source-arn arn:aws:events:$REGION:ACCOUNT:event-bus/default \
  --description "Archive all S3 file upload events" \
  --retention-days 90 \
  --region $REGION
```

---

## Summary Checklist

- [ ] EventBridge enabled on S3 bucket
- [ ] EventBridge rule created
- [ ] Event pattern matches expected files
- [ ] Input transformer configured
- [ ] SQS target added to rule
- [ ] SQS policy allows EventBridge
- [ ] Test file upload successful
- [ ] Message appears in SQS
- [ ] Filtering works as expected
- [ ] CloudWatch metrics show invocations
- [ ] Alarms configured for failures
- [ ] No duplicate events

---

## Next Steps

1. **Configure Auto Scaling Group**: See `aws-autoscaling-spot-instances-guide.md`
2. **Create IAM Roles**: See `aws-iam-roles-policies-guide.md`
3. **Test Full Pipeline**: Upload → EventBridge → SQS → EC2 → OpenSearch
4. **Monitor Performance**: Create dashboard in CloudWatch

---

## Additional Resources

- [EventBridge Documentation](https://docs.aws.amazon.com/eventbridge/)
- [S3 Event Notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventBridge.html)
- [Event Pattern Examples](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns.html)
- [Input Transformation](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-transform-target-input.html)

---

**Document Version**: 1.0
**Last Updated**: 2025-01-18
**Author**: CIS Development Team
