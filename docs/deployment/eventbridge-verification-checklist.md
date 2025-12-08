# EventBridge Configuration Verification Checklist

## Overview
This guide provides step-by-step verification procedures for the S3 → EventBridge → SQS pipeline configuration in the CIS File Search Application.

---

## 1. S3 Bucket EventBridge Notification Verification

### Step 1.1: Check EventBridge Integration Status

**AWS Console Path:** S3 → Buckets → `cis-filesearch-s3-landing` → Properties

1. **Navigate to Event Notifications section**
   - Scroll down to "Amazon EventBridge" section
   - ✅ **VERIFY:** "Send notifications to Amazon EventBridge for all events in this bucket" is **ON**

2. **Visual Indicators:**
   ```
   Amazon EventBridge
   ● ON  - Send notifications to Amazon EventBridge for all events in this bucket
   ```

3. **If EventBridge is OFF:**
   - Click "Edit" button
   - Toggle to "On"
   - Click "Save changes"

### Step 1.2: Verify No Conflicting Event Notifications

**AWS Console Path:** S3 → Buckets → `cis-filesearch-s3-landing` → Properties → Event notifications

1. **Check for conflicting configurations:**
   - ✅ Ensure NO duplicate SNS/SQS event notifications for the same event types
   - EventBridge should be the PRIMARY event delivery mechanism

2. **Common Conflict Patterns to AVOID:**
   ```
   ❌ BAD: Both EventBridge AND direct SQS notification for s3:ObjectCreated:*
   ✅ GOOD: EventBridge ONLY for s3:ObjectCreated:*
   ```

---

## 2. EventBridge Rule Configuration Verification

### Step 2.1: Locate the EventBridge Rule

**AWS Console Path:** EventBridge → Rules

1. **Filter and Find Rule:**
   - Event bus: `default` (unless custom bus was created)
   - Search for rule name: `cis-filesearch-s3-to-sqs` or similar naming

2. **Rule Status Check:**
   - ✅ **VERIFY:** State = **ENABLED**
   - If DISABLED, click "Enable" button

### Step 2.2: Verify Event Pattern

**AWS Console Path:** EventBridge → Rules → [Your Rule] → Event pattern

**Expected Event Pattern:**
```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["cis-filesearch-s3-landing"]
    }
  }
}
```

**Critical Checks:**
- ✅ `source` = `aws.s3`
- ✅ `detail-type` = `Object Created` (not `s3:ObjectCreated:*`)
- ✅ `bucket.name` = `cis-filesearch-s3-landing` (exact match)

**Common Mistakes:**
```json
❌ WRONG: "detail-type": ["s3:ObjectCreated:*"]  // CloudTrail syntax, not EventBridge
✅ CORRECT: "detail-type": ["Object Created"]

❌ WRONG: "detail": { "bucket": "cis-filesearch-s3-landing" }  // Missing "name" field
✅ CORRECT: "detail": { "bucket": { "name": ["cis-filesearch-s3-landing"] } }
```

### Step 2.3: Verify Target Configuration

**AWS Console Path:** EventBridge → Rules → [Your Rule] → Targets

1. **Target Type:**
   - ✅ Service: **SQS queue**
   - ✅ Queue: `cis-filesearch-processing-queue` (or your queue name)

2. **Message Configuration:**
   - ✅ Message group ID: Not required (unless using FIFO queue)
   - ✅ Message deduplication ID: Not required (unless using FIFO queue)

3. **Input Transformer (Optional but Recommended):**
   ```json
   // Input path:
   {
     "bucket": "$.detail.bucket.name",
     "key": "$.detail.object.key",
     "size": "$.detail.object.size",
     "etag": "$.detail.object.etag"
   }

   // Template:
   {
     "bucket": "<bucket>",
     "key": "<key>",
     "size": <size>,
     "etag": "<etag>",
     "eventTime": "$.time",
     "source": "s3-eventbridge"
   }
   ```

4. **Dead-letter Queue (DLQ) - Recommended:**
   - ✅ Configure DLQ for failed deliveries
   - Queue: `cis-filesearch-processing-queue-dlq`

---

## 3. SQS Queue Policy Verification

### Step 3.1: Check Queue Policy

**AWS Console Path:** SQS → Queues → `cis-filesearch-processing-queue` → Access policy

**Required Policy Statement:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowEventBridgeToSendMessage",
      "Effect": "Allow",
      "Principal": {
        "Service": "events.amazonaws.com"
      },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:ap-northeast-1:YOUR_ACCOUNT_ID:cis-filesearch-processing-queue",
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "arn:aws:events:ap-northeast-1:YOUR_ACCOUNT_ID:rule/cis-filesearch-s3-to-sqs"
        }
      }
    }
  ]
}
```

**Critical Elements:**
- ✅ `Principal.Service` = `events.amazonaws.com`
- ✅ `Action` = `sqs:SendMessage`
- ✅ `Condition.ArnEquals.aws:SourceArn` = EventBridge rule ARN

**Common Mistakes:**
```json
❌ WRONG: "Principal": { "Service": "s3.amazonaws.com" }  // Wrong service
✅ CORRECT: "Principal": { "Service": "events.amazonaws.com" }

❌ WRONG: No Condition specified  // Too permissive
✅ CORRECT: Condition with SourceArn limits access to specific EventBridge rule
```

### Step 3.2: Verify Queue Configuration

**AWS Console Path:** SQS → Queues → `cis-filesearch-processing-queue` → Configuration

1. **Queue Type:**
   - ✅ Standard Queue (recommended for high throughput)
   - Or FIFO Queue (if ordering is critical)

2. **Visibility Timeout:**
   - ✅ Recommended: **300 seconds (5 minutes)** or longer
   - Must be greater than Lambda function timeout

3. **Message Retention Period:**
   - ✅ Recommended: **4 days (345,600 seconds)**
   - Adjust based on processing requirements

4. **Maximum Message Size:**
   - ✅ Default: **256 KB** (sufficient for S3 event metadata)

5. **Dead-Letter Queue:**
   - ✅ Enabled with DLQ specified
   - Maximum receives: **3-5** (recommended)

---

## 4. IAM Role and Permissions Verification

### Step 4.1: EventBridge Service Role (If Used)

**AWS Console Path:** IAM → Roles

**Note:** EventBridge uses service-linked roles by default, but verify if custom role is used.

**If custom role exists:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:ap-northeast-1:YOUR_ACCOUNT_ID:cis-filesearch-processing-queue"
    }
  ]
}
```

### Step 4.2: Lambda Execution Role (Consumer)

**AWS Console Path:** Lambda → Functions → [Your function] → Configuration → Permissions

**Required Permissions:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:ChangeMessageVisibility"
      ],
      "Resource": "arn:aws:sqs:ap-northeast-1:YOUR_ACCOUNT_ID:cis-filesearch-processing-queue"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:GetObjectVersion"
      ],
      "Resource": "arn:aws:s3:::cis-filesearch-s3-landing/*"
    }
  ]
}
```

---

## 5. Testing the S3 → EventBridge → SQS Pipeline

### Test 5.1: Manual S3 Upload Test

**Procedure:**

1. **Upload a test file to S3:**
   ```bash
   # Using AWS CLI
   echo "Test file content" > test-file.txt
   aws s3 cp test-file.txt s3://cis-filesearch-s3-landing/test/
   ```

2. **Check SQS Queue for Message:**
   - Navigate to: SQS → Queues → `cis-filesearch-processing-queue`
   - Click "Send and receive messages"
   - Click "Poll for messages"
   - ✅ **VERIFY:** Message appears within **5-10 seconds**

3. **Inspect Message Body:**
   ```json
   {
     "version": "0",
     "id": "unique-event-id",
     "detail-type": "Object Created",
     "source": "aws.s3",
     "account": "YOUR_ACCOUNT_ID",
     "time": "2025-01-19T12:34:56Z",
     "region": "ap-northeast-1",
     "resources": [
       "arn:aws:s3:::cis-filesearch-s3-landing"
     ],
     "detail": {
       "version": "0",
       "bucket": {
         "name": "cis-filesearch-s3-landing"
       },
       "object": {
         "key": "test/test-file.txt",
         "size": 18,
         "etag": "abc123def456",
         "sequencer": "ABC123"
       },
       "request-id": "REQUEST123",
       "requester": "ACCOUNT_ID",
       "source-ip-address": "1.2.3.4",
       "reason": "PutObject"
     }
   }
   ```

### Test 5.2: CloudWatch Logs Verification

**AWS Console Path:** CloudWatch → Log groups → `/aws/events/cis-filesearch-s3-to-sqs`

1. **Enable logging for EventBridge rule (if not already enabled):**
   - EventBridge → Rules → [Your rule] → Edit
   - Add target: CloudWatch log group
   - Log group: `/aws/events/cis-filesearch-s3-to-sqs`

2. **Check for delivery logs:**
   - Look for successful delivery events
   - Check for error messages

**Expected Log Entry:**
```json
{
  "eventTime": "2025-01-19T12:34:56Z",
  "eventName": "Object Created",
  "ruleArn": "arn:aws:events:ap-northeast-1:ACCOUNT:rule/cis-filesearch-s3-to-sqs",
  "targetArn": "arn:aws:sqs:ap-northeast-1:ACCOUNT:cis-filesearch-processing-queue",
  "status": "DELIVERED"
}
```

### Test 5.3: End-to-End Integration Test

**Script for automated testing:**

```bash
#!/bin/bash
# File: test-eventbridge-pipeline.sh

set -e

BUCKET="cis-filesearch-s3-landing"
QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/YOUR_ACCOUNT_ID/cis-filesearch-processing-queue"
TEST_FILE="eventbridge-test-$(date +%s).txt"

echo "Starting EventBridge pipeline test..."

# Step 1: Upload test file
echo "1. Uploading test file to S3..."
echo "EventBridge Pipeline Test" > "$TEST_FILE"
aws s3 cp "$TEST_FILE" "s3://$BUCKET/test/$TEST_FILE"
echo "   ✅ File uploaded: s3://$BUCKET/test/$TEST_FILE"

# Step 2: Wait for EventBridge processing
echo "2. Waiting 10 seconds for EventBridge processing..."
sleep 10

# Step 3: Check SQS queue
echo "3. Checking SQS queue for message..."
MESSAGES=$(aws sqs receive-message \
  --queue-url "$QUEUE_URL" \
  --max-number-of-messages 10 \
  --wait-time-seconds 5)

if echo "$MESSAGES" | jq -e '.Messages[] | select(.Body | contains("'$TEST_FILE'"))' > /dev/null; then
  echo "   ✅ SUCCESS: Message found in SQS queue"

  # Clean up: Delete message
  RECEIPT_HANDLE=$(echo "$MESSAGES" | jq -r '.Messages[] | select(.Body | contains("'$TEST_FILE'")) | .ReceiptHandle')
  aws sqs delete-message \
    --queue-url "$QUEUE_URL" \
    --receipt-handle "$RECEIPT_HANDLE"
  echo "   ✅ Test message deleted from queue"
else
  echo "   ❌ FAILURE: Message NOT found in SQS queue"
  exit 1
fi

# Step 4: Clean up test file
echo "4. Cleaning up test file..."
aws s3 rm "s3://$BUCKET/test/$TEST_FILE"
rm -f "$TEST_FILE"
echo "   ✅ Test file cleaned up"

echo ""
echo "🎉 EventBridge pipeline test PASSED!"
```

**Usage:**
```bash
chmod +x test-eventbridge-pipeline.sh
./test-eventbridge-pipeline.sh
```

---

## 6. Common Configuration Mistakes

### Mistake 6.1: EventBridge Not Enabled on S3 Bucket

**Symptom:** No events flowing from S3
**Fix:** Enable EventBridge in S3 bucket properties

### Mistake 6.2: Incorrect Event Pattern

**Symptom:** Rule exists but not triggered
**Common Errors:**
```json
❌ "detail-type": ["s3:ObjectCreated:*"]  // CloudTrail syntax
✅ "detail-type": ["Object Created"]

❌ "source": ["s3"]  // Missing "aws." prefix
✅ "source": ["aws.s3"]
```

### Mistake 6.3: SQS Policy Missing EventBridge Permission

**Symptom:** EventBridge rule shows errors in CloudWatch
**Fix:** Add policy statement allowing `events.amazonaws.com` to send messages

### Mistake 6.4: Wrong Event Bus

**Symptom:** Events not matching rule
**Fix:** Ensure rule is on `default` event bus (S3 events go to default bus)

### Mistake 6.5: Region Mismatch

**Symptom:** Events not flowing across regions
**Fix:** EventBridge rule, S3 bucket, and SQS queue MUST be in the SAME region

### Mistake 6.6: IAM Role Trust Policy Issues

**Symptom:** Access denied errors
**Fix:** Verify EventBridge can assume role (if custom role used)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "events.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

---

## 7. Troubleshooting Steps

### 7.1: No Messages in SQS Queue After Upload

**Diagnostic Steps:**

1. **Verify S3 EventBridge is ON:**
   ```bash
   aws s3api get-bucket-notification-configuration \
     --bucket cis-filesearch-s3-landing
   ```

   **Expected Output:**
   ```json
   {
     "EventBridgeConfiguration": {}
   }
   ```

   **If empty:** EventBridge not enabled

2. **Check EventBridge Rule Status:**
   ```bash
   aws events describe-rule --name cis-filesearch-s3-to-sqs
   ```

   **Verify:**
   - `"State": "ENABLED"`

3. **Test Event Pattern Matching:**
   ```bash
   # Put a test event to EventBridge
   aws events put-events --entries file://test-event.json
   ```

   **test-event.json:**
   ```json
   [
     {
       "Source": "aws.s3",
       "DetailType": "Object Created",
       "Detail": "{\"bucket\":{\"name\":\"cis-filesearch-s3-landing\"},\"object\":{\"key\":\"test/test.txt\"}}",
       "EventBusName": "default"
     }
   ]
   ```

4. **Check CloudWatch Metrics:**
   - EventBridge → Rules → [Your rule] → Monitoring
   - Look for "Invocations" metric
   - If 0, event pattern not matching

### 7.2: Messages in Queue But Not Processed

**Diagnostic Steps:**

1. **Check Lambda Trigger:**
   - Lambda → Functions → [Your function] → Configuration → Triggers
   - ✅ Verify SQS trigger is enabled

2. **Check Lambda CloudWatch Logs:**
   ```bash
   aws logs tail /aws/lambda/YOUR_FUNCTION_NAME --follow
   ```

3. **Check DLQ for Failed Messages:**
   - Navigate to DLQ in SQS console
   - Check for messages indicating processing failures

### 7.3: EventBridge Rule Shows Errors

**AWS Console Path:** EventBridge → Rules → [Your rule] → Monitoring → Errors

**Common Error Patterns:**

1. **"Access Denied" to SQS:**
   - Fix: Update SQS queue policy

2. **"Invalid Parameter":**
   - Fix: Check event pattern JSON syntax

3. **"Target not found":**
   - Fix: Verify SQS queue ARN in rule target

### 7.4: Delayed Message Delivery

**Diagnostic Steps:**

1. **Check EventBridge Metrics:**
   - CloudWatch → Metrics → Events
   - Look for "DeliveryDelay" metric

2. **Check SQS Metrics:**
   - CloudWatch → Metrics → SQS
   - Look for "ApproximateAgeOfOldestMessage"

3. **Verify No Throttling:**
   - Check SQS SendMessage throttling metrics
   - Increase queue throughput if needed

### 7.5: Using CloudWatch Insights for Debugging

```sql
-- Query EventBridge invocations
fields @timestamp, @message
| filter @message like /cis-filesearch-s3-to-sqs/
| sort @timestamp desc
| limit 20

-- Query Lambda errors
fields @timestamp, @message
| filter @message like /ERROR/
| sort @timestamp desc
| limit 20
```

---

## 8. Monitoring and Alerting

### 8.1: CloudWatch Alarms Setup

**Alarm 1: EventBridge Rule Invocation Failures**
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "EventBridge-Rule-Failures" \
  --alarm-description "Alert when EventBridge rule fails to invoke target" \
  --metric-name FailedInvocations \
  --namespace AWS/Events \
  --statistic Sum \
  --period 300 \
  --threshold 1 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=RuleName,Value=cis-filesearch-s3-to-sqs \
  --evaluation-periods 1
```

**Alarm 2: SQS Queue Age**
```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "SQS-OldMessages-Alert" \
  --alarm-description "Alert when messages are not processed in time" \
  --metric-name ApproximateAgeOfOldestMessage \
  --namespace AWS/SQS \
  --statistic Maximum \
  --period 300 \
  --threshold 600 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=QueueName,Value=cis-filesearch-processing-queue \
  --evaluation-periods 2
```

### 8.2: Dashboard for Monitoring

**CloudWatch Dashboard JSON:**
```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/Events", "Invocations", { "stat": "Sum", "label": "Rule Invocations" }],
          [".", "FailedInvocations", { "stat": "Sum", "label": "Failed Invocations" }]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "ap-northeast-1",
        "title": "EventBridge Rule Performance",
        "dimensions": {
          "RuleName": "cis-filesearch-s3-to-sqs"
        }
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/SQS", "NumberOfMessagesSent", { "stat": "Sum" }],
          [".", "NumberOfMessagesReceived", { "stat": "Sum" }],
          [".", "NumberOfMessagesDeleted", { "stat": "Sum" }]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "ap-northeast-1",
        "title": "SQS Queue Metrics",
        "dimensions": {
          "QueueName": "cis-filesearch-processing-queue"
        }
      }
    }
  ]
}
```

---

## 9. Performance Optimization Tips

### 9.1: Batch Processing

If high volume of S3 uploads:
- Configure Lambda to process SQS messages in batches
- Set `BatchSize: 10` in Lambda trigger configuration
- Implement parallel processing in Lambda function

### 9.2: EventBridge Filtering

Optimize event pattern to reduce unnecessary invocations:
```json
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["cis-filesearch-s3-landing"]
    },
    "object": {
      "key": [{
        "prefix": "uploads/"  // Only process files in uploads/ prefix
      }]
    }
  }
}
```

### 9.3: SQS Configuration Tuning

- **Visibility Timeout:** Match to Lambda function timeout + buffer
- **Receive Message Wait Time:** Use long polling (20 seconds)
- **Message Retention:** Balance between cost and retry requirements

---

## 10. Security Best Practices

### 10.1: Least Privilege IAM Policies

**SQS Queue Policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowEventBridgeOnly",
      "Effect": "Allow",
      "Principal": {
        "Service": "events.amazonaws.com"
      },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:ap-northeast-1:ACCOUNT:cis-filesearch-processing-queue",
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "arn:aws:events:ap-northeast-1:ACCOUNT:rule/cis-filesearch-s3-to-sqs"
        }
      }
    }
  ]
}
```

### 10.2: Encryption

- Enable SQS encryption at rest using AWS KMS
- Use S3 bucket encryption (SSE-S3 or SSE-KMS)
- Enable encryption in transit (HTTPS)

### 10.3: Access Logging

- Enable S3 access logging
- Enable EventBridge CloudWatch logging
- Enable SQS CloudWatch metrics

---

## Summary Checklist

### Quick Verification Checklist

- [ ] S3 bucket EventBridge notification is **ON**
- [ ] EventBridge rule exists and is **ENABLED**
- [ ] Event pattern matches S3 Object Created events correctly
- [ ] Rule target points to correct SQS queue
- [ ] SQS queue policy allows EventBridge to send messages
- [ ] SQS queue ARN in policy matches actual queue
- [ ] EventBridge rule ARN in SQS policy matches actual rule
- [ ] All resources (S3, EventBridge, SQS) are in the **SAME region**
- [ ] Test file upload triggers message in SQS queue
- [ ] CloudWatch logs show successful event delivery
- [ ] Lambda function (if used) can process messages from queue
- [ ] Dead-letter queue is configured for failed messages
- [ ] CloudWatch alarms are set up for monitoring

### Expected Flow Diagram

```
┌─────────────────┐
│  S3 Bucket      │
│  cis-filesearch │
│  -s3-landing    │
└────────┬────────┘
         │ File Upload
         ▼
┌─────────────────┐
│  EventBridge    │◄─── EventBridge enabled in S3 properties
│  (Default Bus)  │
└────────┬────────┘
         │ Event matches rule pattern
         ▼
┌─────────────────┐
│  EventBridge    │
│  Rule           │
│  (ENABLED)      │
└────────┬────────┘
         │ Target: SQS Queue
         ▼
┌─────────────────┐
│  SQS Queue      │◄─── Queue policy allows EventBridge
│  cis-filesearch │
│  -processing-   │
│  queue          │
└────────┬────────┘
         │ Message available
         ▼
┌─────────────────┐
│  Lambda         │
│  Function       │
│  (Consumer)     │
└─────────────────┘
```

---

## Support Resources

- **AWS EventBridge Documentation:** https://docs.aws.amazon.com/eventbridge/
- **S3 EventBridge Integration:** https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventBridge.html
- **SQS Access Policy:** https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-basic-examples-of-sqs-policies.html
- **EventBridge Troubleshooting:** https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-troubleshooting.html

---

**Document Version:** 1.0
**Last Updated:** 2025-01-19
**Maintained By:** CIS File Search Team
