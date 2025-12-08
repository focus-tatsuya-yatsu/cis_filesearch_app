# AWS SQS Configuration Guide for CIS File Scanner

## Table of Contents
1. [Why This Matters - Understanding SQS](#why-this-matters)
2. [Standard vs FIFO Queues](#standard-vs-fifo-queues)
3. [Queue Creation](#queue-creation)
4. [Dead Letter Queue Setup](#dead-letter-queue-setup)
5. [Message Retention and Visibility](#message-retention-and-visibility)
6. [Long Polling Configuration](#long-polling-configuration)
7. [Access Policies](#access-policies)
8. [Message Attributes and Structure](#message-attributes-and-structure)
9. [Queue Monitoring](#queue-monitoring)
10. [Cost Optimization](#cost-optimization)
11. [Verification and Testing](#verification-and-testing)
12. [Troubleshooting](#troubleshooting)

---

## Why This Matters - Understanding SQS

### What is SQS and Why We Use It

Amazon SQS (Simple Queue Service) is a fully managed message queue service. For the CIS File Scanner, SQS acts as:

1. **Decoupling Layer**: Separates file scanning from processing
2. **Buffering**: Handles traffic spikes without overwhelming downstream systems
3. **Reliability**: Ensures no scanned files are lost during processing
4. **Scalability**: Allows independent scaling of scanner and processors

### Message Flow in Our System

```
┌─────────────┐
│ File Scanner│
│   (EC2/PC)  │
└──────┬──────┘
       │ 1. Scan file
       │ 2. Upload to S3
       │ 3. Send metadata message
       ▼
┌─────────────┐     ┌─────────────┐
│     SQS     │────▶│  Lambda/EC2 │
│   Queue     │     │  Processor  │
└─────────────┘     └──────┬──────┘
       │                    │
       │ If fails 3x        │ On success
       ▼                    ▼
┌─────────────┐     ┌─────────────┐
│  Dead Letter│     │  Database   │
│    Queue    │     │  (RDS/Dynamo│
└─────────────┘     └─────────────┘
```

### Key SQS Concepts

- **Message**: JSON payload with file metadata
- **Visibility Timeout**: Time a message is invisible after being received
- **Retention Period**: How long messages stay in queue
- **Dead Letter Queue (DLQ)**: Separate queue for failed messages
- **Long Polling**: Efficient way to receive messages (reduces costs)
- **Message Attributes**: Additional metadata (priority, timestamp, etc.)

### Cost Implications

**Pricing** (Tokyo region):
- First 1 million requests/month: FREE
- After that: $0.40 per million requests (Standard), $0.50 (FIFO)
- Data transfer: Free within same region

**Expected costs for our workload** (100K files/month):
- Send: 100,000 messages
- Receive: ~120,000 (with retries)
- Delete: 100,000
- **Total: 320,000 requests = FREE** (under 1M)

Even at 1 million files/month (3.2M requests), cost is only $0.88/month.

---

## Standard vs FIFO Queues

### Decision Matrix

| Feature | Standard | FIFO | Our Choice |
|---------|----------|------|------------|
| **Ordering** | Best-effort | Strict order | Standard ✓ |
| **Throughput** | Unlimited | 300 msg/sec (3000 with batching) | Standard ✓ |
| **Duplicates** | Possible | Guaranteed no duplicates | Standard ✓ |
| **Cost** | $0.40/million | $0.50/million | Standard ✓ |
| **Use case** | High throughput | Order-critical | Standard ✓ |

### Why Standard Queue for File Scanner?

**Reasons to choose Standard:**

1. **Order doesn't matter**: Files can be processed in any order
2. **High throughput needed**: May scan millions of files
3. **Duplicate handling in code**: Scanner uses S3 deduplication anyway
4. **Cost effective**: 20% cheaper
5. **Simpler setup**: No message group IDs required

**When you'd choose FIFO:**
- Processing bank transactions
- Event sourcing systems
- Chat message delivery
- Job dependencies (job B must run after job A)

**For file scanning**: Standard is the right choice.

### Duplicate Handling Strategy

Even with Standard queue duplicates, our system is idempotent:

```typescript
// In processor Lambda/EC2
async function processFile(message: FileMessage) {
  const { s3Key, fileHash } = message;

  // Check if already processed (using hash)
  const exists = await db.query(
    'SELECT 1 FROM files WHERE file_hash = ?',
    [fileHash]
  );

  if (exists) {
    console.log('File already processed, skipping');
    return; // Safe to skip duplicate
  }

  // Process file...
  await extractMetadata(s3Key);
  await saveToDatabase(message);
}
```

---

## Queue Creation

### Console Method

#### Step 1: Navigate to SQS Console

1. AWS Console → Search "SQS"
2. Click "Create queue"

#### Step 2: Configure Queue Type

**Type**: Standard

**Why Standard?** (See previous section)

#### Step 3: Basic Configuration

**Name**: `cis-filesearch-queue-dev`

**Naming convention:**
```
{project}-{service}-{purpose}-{environment}

Examples:
- cis-filesearch-queue-dev          # Main processing queue (dev)
- cis-filesearch-queue-prod         # Main processing queue (prod)
- cis-filesearch-dlq-dev            # Dead letter queue (dev)
- cis-filesearch-priority-queue-dev # High-priority files
```

#### Step 4: Configuration Settings

**Visibility timeout**: `300 seconds` (5 minutes)

**Why 5 minutes?**
- Average file processing: 30-120 seconds
- Includes: Download from S3, metadata extraction, DB write
- Buffer for occasional large files or slow DB
- If too short: Same message processed multiple times
- If too long: Delays retry on failures

**How to calculate:**
```
Visibility timeout = (Average processing time × 3) + Buffer
                   = (60 seconds × 3) + 120 seconds
                   = 300 seconds
```

**Message retention period**: `4 days` (345,600 seconds)

**Why 4 days?**
- Default is 4 days (good starting point)
- Covers weekend downtime
- Long enough for operational issues
- Not too long to accumulate junk
- Can be 14 days max if needed

**Delivery delay**: `0 seconds`

**Why 0?**
- We want immediate processing
- Use only if you need intentional delay (batch processing)

**Maximum message size**: `256 KB` (default)

**Why 256 KB is enough?**
- Our messages contain only metadata, not file content
- Example message size: ~2-5 KB
- 256 KB allows room for large file paths and attributes

**Receive message wait time**: `20 seconds`

**Why 20 seconds?** (Long polling explained later)
- Enables long polling (more efficient)
- Reduces empty responses
- Lowers API call costs
- 20 seconds is AWS recommended maximum

#### Step 5: Encryption

**Encryption**: Enabled (SSE-SQS)

**Why encrypt?**
- Free encryption (no cost)
- Protects sensitive file metadata
- Meets compliance requirements
- No performance impact

**SSE-SQS vs SSE-KMS:**
- **SSE-SQS**: Free, AWS-managed keys, sufficient for most cases
- **SSE-KMS**: $1/month + API costs, custom key management

**For this project**: SSE-SQS is adequate (saves ~$30/month)

#### Step 6: Access Policy

Select: **Basic** (will configure advanced later)

Allow:
- Only the queue owner (your AWS account)

We'll add scanner and processor permissions later via IAM.

#### Step 7: Dead Letter Queue

We'll configure this in the next section after creating the DLQ.

#### Step 8: Tags

Add tags:
```
Project: CISFileSearch
Environment: Development
CostCenter: IT
ManagedBy: Manual
```

#### Step 9: Create Queue

Click "Create queue"

### CLI Method

```bash
# Set variables
QUEUE_NAME="cis-filesearch-queue-dev"
DLQ_NAME="cis-filesearch-dlq-dev"
REGION="ap-northeast-1"

# Create main queue
aws sqs create-queue \
  --queue-name $QUEUE_NAME \
  --region $REGION \
  --attributes '{
    "VisibilityTimeout": "300",
    "MessageRetentionPeriod": "345600",
    "ReceiveMessageWaitTimeSeconds": "20",
    "SqsManagedSseEnabled": "true"
  }' \
  --tags "Project=CISFileSearch,Environment=Development,CostCenter=IT"

# Get queue URL
QUEUE_URL=$(aws sqs get-queue-url --queue-name $QUEUE_NAME --region $REGION --query 'QueueUrl' --output text)

echo "Queue created: $QUEUE_URL"
```

**Save the Queue URL** - You'll need it for:
- Scanner configuration (.env file)
- IAM policies
- Dead Letter Queue configuration

---

## Dead Letter Queue Setup

### Why Dead Letter Queues Matter

**Without DLQ:**
```
Failed message → Retry → Fail → Retry → Fail → Retry → Eventually deleted
(Lost forever, no visibility into what failed)
```

**With DLQ:**
```
Failed message → Retry 3x → If still fails → Move to DLQ
(Preserved for investigation, alerts triggered, can reprocess)
```

**DLQ benefits:**
1. **Debugging**: See exactly what messages are failing
2. **Alerting**: CloudWatch alarms when DLQ has messages
3. **Recovery**: Can reprocess messages after fixing issue
4. **Metrics**: Track failure rates

### Create Dead Letter Queue

#### Console Method

1. SQS Console → Create queue
2. Type: **Standard** (must match main queue type)
3. Name: `cis-filesearch-dlq-dev`
4. Configuration:
   - Visibility timeout: `300 seconds` (same as main)
   - Retention: `14 days` (maximum, for debugging)
   - Receive wait time: `20 seconds`
   - Encryption: Enabled (SSE-SQS)
5. Create queue

#### CLI Method

```bash
# Create DLQ
aws sqs create-queue \
  --queue-name $DLQ_NAME \
  --region $REGION \
  --attributes '{
    "VisibilityTimeout": "300",
    "MessageRetentionPeriod": "1209600",
    "ReceiveMessageWaitTimeSeconds": "20",
    "SqsManagedSseEnabled": "true"
  }' \
  --tags "Project=CISFileSearch,Environment=Development,Type=DeadLetterQueue"

# Get DLQ ARN
DLQ_ARN=$(aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name $DLQ_NAME --query 'QueueUrl' --output text) \
  --attribute-names QueueArn \
  --query 'Attributes.QueueArn' \
  --output text)

echo "DLQ ARN: $DLQ_ARN"
```

### Configure DLQ Redrive Policy

This tells the main queue to send failed messages to DLQ.

#### Console Method

1. Go to main queue (`cis-filesearch-queue-dev`)
2. Edit → Dead-letter queue
3. Enable: **Yes**
4. Choose DLQ: `cis-filesearch-dlq-dev`
5. Maximum receives: `3`

**Why 3 retries?**
- 1st attempt: Original processing
- 2nd attempt: Retry (may be transient error)
- 3rd attempt: Final retry
- 4th attempt: Move to DLQ (persistent issue)

**Adjustment scenarios:**
- Flaky network: Increase to 5
- Expensive processing: Decrease to 2
- Fast failure detection: Decrease to 1

6. Save changes

#### CLI Method

```bash
# Configure redrive policy on main queue
aws sqs set-queue-attributes \
  --queue-url $QUEUE_URL \
  --attributes "{
    \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"
  }"
```

**Verify configuration:**

```bash
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names RedrivePolicy \
  --query 'Attributes.RedrivePolicy'
```

### Monitoring DLQ

**Create CloudWatch alarm for DLQ messages:**

```bash
# Create alarm when DLQ has messages
aws cloudwatch put-metric-alarm \
  --alarm-name "cis-filesearch-dlq-has-messages" \
  --alarm-description "Alert when messages reach DLQ" \
  --metric-name ApproximateNumberOfMessagesVisible \
  --namespace AWS/SQS \
  --statistic Average \
  --period 300 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --evaluation-periods 1 \
  --dimensions Name=QueueName,Value=$DLQ_NAME \
  --alarm-actions arn:aws:sns:ap-northeast-1:ACCOUNT_ID:cis-alerts
```

---

## Message Retention and Visibility

### Message Retention Period

**What it is**: How long messages stay in queue if not deleted

**Default**: 4 days (345,600 seconds)
**Range**: 60 seconds to 14 days (1,209,600 seconds)

**For our queues:**
- **Main queue**: 4 days (standard)
- **DLQ**: 14 days (maximum debugging time)

**Why 4 days for main queue?**
- Covers weekends and holidays
- Most issues resolved within 48 hours
- Not too long to accumulate failed messages
- Balances operational flexibility with hygiene

**When to increase:**
- Scheduled maintenance windows
- Holiday periods
- Known processor downtime

**When to decrease:**
- High message volume (cost optimization)
- Fast-moving data (stale after hours)

#### Change Retention (Console)

1. Queue → Edit
2. Configuration → Message retention period
3. Enter seconds or use dropdown
4. Save

#### Change Retention (CLI)

```bash
# Set to 7 days (604,800 seconds)
aws sqs set-queue-attributes \
  --queue-url $QUEUE_URL \
  --attributes MessageRetentionPeriod=604800
```

### Visibility Timeout Deep Dive

**How it works:**

```
Time  →  0s         30s        60s        300s       330s
Message  [Visible] [Processing...] [Still processing] [Visible again]
         ↑         ↑                                  ↑
         Receive   Invisible                          Timeout,
         Message   to others                          available again
```

**During visibility timeout:**
- Message is invisible to other consumers
- If processed successfully: Delete message (it's gone)
- If processing fails: Message becomes visible again
- If timeout expires: Message reappears in queue

**Tuning visibility timeout:**

```typescript
// In your processor code
const PROCESSING_TIME_ESTIMATE = 120; // seconds
const SAFETY_BUFFER = 60; // seconds
const VISIBILITY_TIMEOUT = PROCESSING_TIME_ESTIMATE + SAFETY_BUFFER;

// If processing takes longer, extend timeout
async function processWithExtension(message: Message) {
  const startTime = Date.now();

  setInterval(async () => {
    const elapsed = (Date.now() - startTime) / 1000;

    if (elapsed > VISIBILITY_TIMEOUT * 0.8) {
      // Extend timeout before it expires
      await sqs.changeMessageVisibility({
        QueueUrl: QUEUE_URL,
        ReceiptHandle: message.ReceiptHandle,
        VisibilityTimeout: 300, // Extend by 5 more minutes
      });
    }
  }, 60000); // Check every minute

  await processFile(message);
}
```

**Common mistakes:**

❌ **Too short** (30 seconds for 2-minute processing):
- Message reappears while still processing
- Same file processed twice
- Wasted resources

❌ **Too long** (30 minutes for 1-minute processing):
- Failed messages wait 30 minutes before retry
- Slow failure detection
- Poor user experience

✅ **Just right** (5 minutes for 1-2 minute processing):
- Buffer for occasional slow processing
- Quick retry on failures
- No duplicate processing

#### Change Visibility Timeout (CLI)

```bash
# Set to 10 minutes (600 seconds)
aws sqs set-queue-attributes \
  --queue-url $QUEUE_URL \
  --attributes VisibilityTimeout=600
```

---

## Long Polling Configuration

### Short Polling vs Long Polling

**Short Polling (default, inefficient):**
```
App: "Any messages?"
SQS: "No" (returns immediately)
App: "Any messages?" (1 second later)
SQS: "No"
App: "Any messages?" (1 second later)
SQS: "No"
... (100s of empty requests per minute)
```

**Long Polling (efficient):**
```
App: "Any messages? I'll wait up to 20 seconds"
SQS: ... (waits for messages or 20 seconds)
SQS: "Here are 5 messages" (or "None" after 20s)
```

**Benefits of long polling:**
1. **Cost**: 95% fewer API calls
2. **Latency**: Messages delivered as soon as available
3. **Efficiency**: Less CPU spinning
4. **Simplicity**: Fewer empty responses to handle

**Cost comparison** (processing 100K messages/month):

| Strategy | API Calls | Cost |
|----------|-----------|------|
| Short polling (1/sec) | 2.6 million | $0.64 |
| Long polling (20s) | 130,000 | FREE |
| **Savings** | **95% fewer calls** | **$0.64/month** |

While the absolute savings are small, long polling is AWS best practice.

### Enable Long Polling

**Already configured** if you followed queue creation steps.

**To verify:**

```bash
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names ReceiveMessageWaitTimeSeconds
```

**Expected output:**
```json
{
  "Attributes": {
    "ReceiveMessageWaitTimeSeconds": "20"
  }
}
```

**If not set:**

```bash
aws sqs set-queue-attributes \
  --queue-url $QUEUE_URL \
  --attributes ReceiveMessageWaitTimeSeconds=20
```

### Using Long Polling in Code

**Node.js SDK v3:**

```typescript
import { SQSClient, ReceiveMessageCommand } from '@aws-sdk/client-sqs';

const sqsClient = new SQSClient({ region: 'ap-northeast-1' });

async function pollMessages() {
  while (true) {
    try {
      const result = await sqsClient.send(new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 10, // Receive up to 10 at once
        WaitTimeSeconds: 20, // Long polling (can override queue default)
        MessageAttributeNames: ['All'],
      }));

      if (result.Messages && result.Messages.length > 0) {
        console.log(`Received ${result.Messages.length} messages`);

        for (const message of result.Messages) {
          await processMessage(message);

          // Delete after successful processing
          await sqsClient.send(new DeleteMessageCommand({
            QueueUrl: QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle,
          }));
        }
      } else {
        console.log('No messages available');
      }
    } catch (error) {
      console.error('Polling error:', error);
      await sleep(5000); // Back off on errors
    }
  }
}
```

**Best practices:**
- `MaxNumberOfMessages`: 10 (batch processing)
- `WaitTimeSeconds`: 20 (maximum efficiency)
- Delete messages only after successful processing
- Handle errors gracefully

---

## Access Policies

### IAM Policy for Scanner (Producer)

The file scanner needs permission to send messages.

**Policy:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SQSSendMessage",
      "Effect": "Allow",
      "Action": [
        "sqs:GetQueueUrl",
        "sqs:GetQueueAttributes",
        "sqs:SendMessage",
        "sqs:SendMessageBatch"
      ],
      "Resource": [
        "arn:aws:sqs:ap-northeast-1:ACCOUNT_ID:cis-filesearch-queue-dev",
        "arn:aws:sqs:ap-northeast-1:ACCOUNT_ID:cis-filesearch-queue-prod"
      ]
    }
  ]
}
```

**Permissions explained:**
- `GetQueueUrl`: Resolve queue name to URL
- `GetQueueAttributes`: Check queue status (optional but useful)
- `SendMessage`: Send individual messages
- `SendMessageBatch`: Send up to 10 messages at once (efficient)

#### Create and Attach Policy (CLI)

```bash
# Get your AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Create policy
cat > scanner-sqs-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "SQSSendMessage",
    "Effect": "Allow",
    "Action": [
      "sqs:GetQueueUrl",
      "sqs:SendMessage",
      "sqs:SendMessageBatch"
    ],
    "Resource": "arn:aws:sqs:ap-northeast-1:${ACCOUNT_ID}:cis-filesearch-queue-*"
  }]
}
EOF

# Create IAM policy
aws iam create-policy \
  --policy-name CISFileScannerSQSAccess \
  --policy-document file://scanner-sqs-policy.json

# Attach to scanner role
aws iam attach-role-policy \
  --role-name CISFileScannerRole \
  --policy-arn arn:aws:iam::${ACCOUNT_ID}:policy/CISFileScannerSQSAccess
```

### IAM Policy for Processor (Consumer)

Lambda or EC2 that processes messages needs these permissions.

**Policy:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SQSReceiveMessages",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:ChangeMessageVisibility"
      ],
      "Resource": [
        "arn:aws:sqs:ap-northeast-1:ACCOUNT_ID:cis-filesearch-queue-dev"
      ]
    },
    {
      "Sid": "SQSDLQAccess",
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:SendMessage"
      ],
      "Resource": [
        "arn:aws:sqs:ap-northeast-1:ACCOUNT_ID:cis-filesearch-dlq-dev"
      ]
    }
  ]
}
```

**Permissions explained:**
- `ReceiveMessage`: Poll for messages
- `DeleteMessage`: Remove processed messages
- `GetQueueAttributes`: Check queue depth, etc.
- `ChangeMessageVisibility`: Extend processing time if needed
- DLQ `SendMessage`: Manual reprocessing from DLQ

#### Create Policy (CLI)

```bash
cat > processor-sqs-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:ChangeMessageVisibility",
      "sqs:GetQueueAttributes"
    ],
    "Resource": "arn:aws:sqs:ap-northeast-1:${ACCOUNT_ID}:cis-filesearch-queue-*"
  }]
}
EOF

aws iam create-policy \
  --policy-name CISFileProcessorSQSAccess \
  --policy-document file://processor-sqs-policy.json
```

### Queue Policy (Resource-Based)

Allows specific AWS services to access the queue.

**Example: Allow Lambda to poll queue**

```bash
aws sqs set-queue-attributes \
  --queue-url $QUEUE_URL \
  --attributes '{
    "Policy": "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"lambda.amazonaws.com\"},\"Action\":\"sqs:SendMessage\",\"Resource\":\"'$QUEUE_ARN'\"}]}"
  }'
```

**When to use queue policies:**
- Cross-account access
- Service-to-service (SNS → SQS)
- Event-driven architectures

**For this project**: IAM policies are sufficient.

---

## Message Attributes and Structure

### Standard Message Structure

**Message we send from scanner:**

```json
{
  "fileId": "uuid-v4-here",
  "s3Bucket": "cis-filesearch-landing-dev",
  "s3Key": "files/2025/01/document.pdf",
  "fileName": "document.pdf",
  "filePath": "/nas/projects/2025/document.pdf",
  "fileSize": 1048576,
  "fileHash": "sha256-hash-here",
  "mimeType": "application/pdf",
  "lastModified": "2025-01-12T10:30:00Z",
  "metadata": {
    "department": "Engineering",
    "project": "CIS",
    "year": 2025
  },
  "scanTimestamp": "2025-01-12T10:35:00Z",
  "scannerVersion": "1.0.0"
}
```

### Message Attributes

**Message attributes** are separate from body, useful for filtering and routing.

**Example attributes:**

```typescript
import { SendMessageCommand } from '@aws-sdk/client-sqs';

const command = new SendMessageCommand({
  QueueUrl: QUEUE_URL,
  MessageBody: JSON.stringify(fileMetadata),
  MessageAttributes: {
    fileType: {
      DataType: 'String',
      StringValue: 'pdf',
    },
    fileSize: {
      DataType: 'Number',
      StringValue: '1048576',
    },
    priority: {
      DataType: 'String',
      StringValue: 'high', // For urgent files
    },
    department: {
      DataType: 'String',
      StringValue: 'Engineering',
    },
    scanDate: {
      DataType: 'String',
      StringValue: '2025-01-12',
    },
  },
});

await sqsClient.send(command);
```

**Benefits of attributes:**
- Filterable without parsing message body
- Visible in CloudWatch logs
- Can route based on attributes (with SNS)
- Useful for debugging

**Limitations:**
- Max 10 attributes per message
- Attribute names: 256 characters
- Attribute values: 256 KB

### Batch Sending (Efficient)

Send up to 10 messages in one API call.

```typescript
import { SendMessageBatchCommand } from '@aws-sdk/client-sqs';

async function sendBatch(files: FileMetadata[]) {
  const entries = files.map((file, index) => ({
    Id: `msg-${index}`, // Unique within batch
    MessageBody: JSON.stringify(file),
    MessageAttributes: {
      fileType: {
        DataType: 'String',
        StringValue: file.mimeType.split('/')[0],
      },
    },
  }));

  // Split into chunks of 10
  for (let i = 0; i < entries.length; i += 10) {
    const batch = entries.slice(i, i + 10);

    const result = await sqsClient.send(new SendMessageBatchCommand({
      QueueUrl: QUEUE_URL,
      Entries: batch,
    }));

    if (result.Failed && result.Failed.length > 0) {
      console.error('Failed to send:', result.Failed);
      // Retry failed messages
    }
  }
}
```

**Batch benefits:**
- 10x fewer API calls
- Lower latency
- Higher throughput
- Same cost (charged per message, not per API call)

**In scanner code:**

```typescript
// Accumulate messages in buffer
const messageBuffer: FileMetadata[] = [];

async function scanAndQueue(file: File) {
  // Upload to S3
  await uploadToS3(file);

  // Add to buffer
  messageBuffer.push(file.metadata);

  // Send when buffer full
  if (messageBuffer.length >= 10) {
    await sendBatch(messageBuffer);
    messageBuffer.length = 0; // Clear buffer
  }
}

// Flush remaining messages at end
async function finishScanning() {
  if (messageBuffer.length > 0) {
    await sendBatch(messageBuffer);
  }
}
```

---

## Queue Monitoring

### Key Metrics to Monitor

**Built-in CloudWatch metrics:**

1. **ApproximateNumberOfMessagesVisible**
   - Messages in queue waiting to be processed
   - **Alert if**: > 1000 (backlog building up)

2. **ApproximateNumberOfMessagesNotVisible**
   - Messages currently being processed
   - **Alert if**: High for long time (processing stuck)

3. **ApproximateAgeOfOldestMessage**
   - Age of oldest message in seconds
   - **Alert if**: > 3600 (messages waiting over 1 hour)

4. **NumberOfMessagesSent**
   - Messages sent per period
   - **Use for**: Tracking scan activity

5. **NumberOfMessagesReceived**
   - Messages received by consumers
   - **Use for**: Monitoring processor health

6. **NumberOfMessagesDeleted**
   - Successfully processed messages
   - **Use for**: Success rate calculation

7. **NumberOfEmptyReceives**
   - Polling requests that returned no messages
   - **Alert if**: High (long polling not working)

### View Metrics (Console)

1. SQS Console → Select queue
2. Monitoring tab
3. View graphs for all metrics
4. TimeRange: 1 hour, 3 hours, 1 day, 1 week

### View Metrics (CLI)

```bash
# Get current queue depth
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names ApproximateNumberOfMessages \
  --query 'Attributes.ApproximateNumberOfMessages'

# Get detailed stats
aws cloudwatch get-metric-statistics \
  --namespace AWS/SQS \
  --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions Name=QueueName,Value=cis-filesearch-queue-dev \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average,Maximum
```

### CloudWatch Alarms

#### Alarm 1: Queue Backlog

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "cis-filesearch-queue-backlog" \
  --alarm-description "Alert when queue depth exceeds 1000" \
  --metric-name ApproximateNumberOfMessagesVisible \
  --namespace AWS/SQS \
  --statistic Average \
  --period 300 \
  --threshold 1000 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2 \
  --dimensions Name=QueueName,Value=cis-filesearch-queue-dev
```

**Why this alarm?**
- Queue depth > 1000 means processors can't keep up
- May need to scale processors
- Or scanner is running too fast

#### Alarm 2: Old Messages

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "cis-filesearch-queue-old-messages" \
  --alarm-description "Alert when messages wait over 30 minutes" \
  --metric-name ApproximateAgeOfOldestMessage \
  --namespace AWS/SQS \
  --statistic Maximum \
  --period 300 \
  --threshold 1800 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --dimensions Name=QueueName,Value=cis-filesearch-queue-dev
```

#### Alarm 3: DLQ Has Messages

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "cis-filesearch-dlq-has-messages" \
  --alarm-description "Alert when messages reach DLQ" \
  --metric-name ApproximateNumberOfMessagesVisible \
  --namespace AWS/SQS \
  --statistic Average \
  --period 300 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --evaluation-periods 1 \
  --dimensions Name=QueueName,Value=cis-filesearch-dlq-dev
```

### Custom Monitoring Script

```bash
#!/bin/bash
# monitor-queue.sh

QUEUE_NAME="cis-filesearch-queue-dev"
QUEUE_URL=$(aws sqs get-queue-url --queue-name $QUEUE_NAME --query 'QueueUrl' --output text)

while true; do
  ATTRS=$(aws sqs get-queue-attributes \
    --queue-url $QUEUE_URL \
    --attribute-names All \
    --query 'Attributes' \
    --output json)

  VISIBLE=$(echo $ATTRS | jq -r '.ApproximateNumberOfMessages')
  IN_FLIGHT=$(echo $ATTRS | jq -r '.ApproximateNumberOfMessagesNotVisible')
  DELAYED=$(echo $ATTRS | jq -r '.ApproximateNumberOfMessagesDelayed')

  echo "$(date) - Visible: $VISIBLE, InFlight: $IN_FLIGHT, Delayed: $DELAYED"

  sleep 60
done
```

**Run continuously:**
```bash
chmod +x monitor-queue.sh
./monitor-queue.sh | tee -a queue-monitoring.log
```

---

## Cost Optimization

### 1. Use Long Polling (Primary Optimization)

**Already configured** if you followed setup.

**Savings**: 95% reduction in API calls

### 2. Batch Operations

**Sending:**
```typescript
// ❌ Bad: 10 API calls
for (const file of files) {
  await sqs.sendMessage({ ...file });
}

// ✅ Good: 1 API call
await sqs.sendMessageBatch({
  Entries: files.slice(0, 10).map((file, i) => ({
    Id: `${i}`,
    MessageBody: JSON.stringify(file),
  })),
});
```

**Receiving:**
```typescript
// ❌ Bad: Receive 1 at a time
const result = await sqs.receiveMessage({
  QueueUrl: QUEUE_URL,
  MaxNumberOfMessages: 1,
});

// ✅ Good: Receive 10 at a time
const result = await sqs.receiveMessage({
  QueueUrl: QUEUE_URL,
  MaxNumberOfMessages: 10,
});
```

**Savings**: 10x fewer API calls

### 3. Appropriate Message Retention

Don't set retention longer than needed.

**Default**: 4 days (good for most cases)
**If high volume**: 1 day (messages processed quickly anyway)
**If debugging**: 7 days (temporarily)

**Cost impact**: Negligible (storage is cheap), but good practice

### 4. Purge Queue During Development

```bash
# Delete all messages (for testing only!)
aws sqs purge-queue --queue-url $QUEUE_URL
```

**When to use:**
- Testing with dummy data
- Clearing failed test runs
- Resetting development environment

**Never use in production!**

### 5. Use VPC Endpoints for SQS

Similar to S3, VPC endpoints eliminate data transfer costs.

**Setup** (covered in VPC guide):
```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxxxx \
  --service-name com.amazonaws.ap-northeast-1.sqs \
  --route-table-ids rtb-xxxxx
```

**Savings**:
- $0.01/GB data transfer (small for SQS metadata)
- Primarily for S3, but good practice

### 6. Monitor and Optimize Visibility Timeout

```typescript
// Calculate average processing time
const processingTimes: number[] = [];

async function processWithTiming(message: Message) {
  const start = Date.now();

  await processFile(message);

  const duration = (Date.now() - start) / 1000;
  processingTimes.push(duration);

  // Log every 100 messages
  if (processingTimes.length % 100 === 0) {
    const avg = processingTimes.reduce((a, b) => a + b) / processingTimes.length;
    const p95 = processingTimes.sort()[Math.floor(processingTimes.length * 0.95)];

    console.log(`Avg processing time: ${avg}s, P95: ${p95}s`);
    console.log(`Recommended visibility timeout: ${Math.ceil(p95 * 1.5)}s`);
  }
}
```

### Cost Estimate Summary

**Scenario**: 100K files/month

| Operation | Requests | Cost |
|-----------|----------|------|
| Send (batch of 10) | 10,000 | FREE |
| Receive (batch of 10) | 10,000 | FREE |
| Delete | 100,000 | FREE |
| Empty receives (long polling) | 5,000 | FREE |
| **Total** | **125,000** | **$0** |

**Even at 1M files/month**: ~$0.50/month

**SQS is extremely cost-effective for this workload.**

---

## Verification and Testing

### 1. Verify Queue Creation

```bash
# List queues
aws sqs list-queues --queue-name-prefix cis-filesearch

# Expected output:
# {
#   "QueueUrls": [
#     "https://sqs.ap-northeast-1.amazonaws.com/123456789012/cis-filesearch-queue-dev",
#     "https://sqs.ap-northeast-1.amazonaws.com/123456789012/cis-filesearch-dlq-dev"
#   ]
# }
```

### 2. Test Send Message

```bash
# Send test message
aws sqs send-message \
  --queue-url $QUEUE_URL \
  --message-body '{
    "fileId": "test-123",
    "s3Bucket": "cis-filesearch-landing-dev",
    "s3Key": "test/file.pdf",
    "fileName": "test.pdf",
    "fileSize": 1024
  }' \
  --message-attributes '{
    "fileType": {
      "DataType": "String",
      "StringValue": "pdf"
    }
  }'

# Should return MessageId and MD5 hash
```

### 3. Test Receive Message

```bash
# Receive message
aws sqs receive-message \
  --queue-url $QUEUE_URL \
  --max-number-of-messages 1 \
  --message-attribute-names All \
  --wait-time-seconds 5

# Should return the message you just sent
```

### 4. Test Delete Message

```bash
# Delete message (use ReceiptHandle from previous command)
aws sqs delete-message \
  --queue-url $QUEUE_URL \
  --receipt-handle "AQEBz..."

# Verify deleted
aws sqs receive-message --queue-url $QUEUE_URL --wait-time-seconds 5
# Should return no messages
```

### 5. Test Batch Operations

```bash
# Send batch
aws sqs send-message-batch \
  --queue-url $QUEUE_URL \
  --entries '[
    {
      "Id": "1",
      "MessageBody": "{\"fileId\": \"test-1\"}"
    },
    {
      "Id": "2",
      "MessageBody": "{\"fileId\": \"test-2\"}"
    }
  ]'

# Receive batch
aws sqs receive-message \
  --queue-url $QUEUE_URL \
  --max-number-of-messages 10 \
  --wait-time-seconds 5
```

### 6. Test DLQ Flow

```bash
# Receive message but don't delete (simulates processing failure)
RECEIPT=$(aws sqs receive-message \
  --queue-url $QUEUE_URL \
  --max-number-of-messages 1 \
  --query 'Messages[0].ReceiptHandle' \
  --output text)

# Wait for visibility timeout to expire, receive again (repeat 3 times)
# After 3rd receive, message should move to DLQ

# Check DLQ
DLQ_URL=$(aws sqs get-queue-url --queue-name cis-filesearch-dlq-dev --query 'QueueUrl' --output text)
aws sqs receive-message --queue-url $DLQ_URL --wait-time-seconds 5
# Should see the message
```

### 7. Test IAM Permissions

**From scanner EC2:**

```bash
# Test send
aws sqs send-message \
  --queue-url $QUEUE_URL \
  --message-body '{"test": true}'

# Should succeed
```

**From processor EC2:**

```bash
# Test receive
aws sqs receive-message --queue-url $QUEUE_URL

# Test delete
aws sqs delete-message \
  --queue-url $QUEUE_URL \
  --receipt-handle "..."

# Both should succeed
```

### 8. Load Test

```bash
#!/bin/bash
# load-test-sqs.sh

QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/ACCOUNT/cis-filesearch-queue-dev"

echo "Sending 1000 messages..."
for i in {1..1000}; do
  aws sqs send-message \
    --queue-url $QUEUE_URL \
    --message-body "{\"fileId\": \"load-test-$i\", \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
    > /dev/null &

  # Batch in groups of 50
  if [ $((i % 50)) -eq 0 ]; then
    wait
    echo "Sent $i messages"
  fi
done

wait
echo "Load test complete"

# Check queue depth
DEPTH=$(aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names ApproximateNumberOfMessages \
  --query 'Attributes.ApproximateNumberOfMessages' \
  --output text)

echo "Queue depth: $DEPTH"
```

### 9. End-to-End Integration Test

```typescript
// integration-test.ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';

async function integrationTest() {
  const s3 = new S3Client({ region: 'ap-northeast-1' });
  const sqs = new SQSClient({ region: 'ap-northeast-1' });

  // 1. Upload file to S3
  const testFile = Buffer.from('Integration test file content');
  const s3Key = `test/integration-${Date.now()}.txt`;

  await s3.send(new PutObjectCommand({
    Bucket: 'cis-filesearch-landing-dev',
    Key: s3Key,
    Body: testFile,
  }));

  console.log('✓ File uploaded to S3');

  // 2. Send message to SQS
  const message = {
    fileId: 'integration-test-' + Date.now(),
    s3Bucket: 'cis-filesearch-landing-dev',
    s3Key,
    fileName: 'integration-test.txt',
    fileSize: testFile.length,
  };

  await sqs.send(new SendMessageCommand({
    QueueUrl: process.env.SQS_QUEUE_URL!,
    MessageBody: JSON.stringify(message),
  }));

  console.log('✓ Message sent to SQS');

  // 3. Receive message
  const receiveResult = await sqs.send(new ReceiveMessageCommand({
    QueueUrl: process.env.SQS_QUEUE_URL!,
    MaxNumberOfMessages: 1,
    WaitTimeSeconds: 10,
  }));

  if (receiveResult.Messages && receiveResult.Messages.length > 0) {
    console.log('✓ Message received from SQS');
    const receivedMessage = JSON.parse(receiveResult.Messages[0].Body!);

    if (receivedMessage.s3Key === s3Key) {
      console.log('✓ Message content matches');
    } else {
      console.error('✗ Message content mismatch');
    }
  } else {
    console.error('✗ No message received');
  }

  console.log('Integration test complete');
}

integrationTest().catch(console.error);
```

---

## Troubleshooting

### Issue 1: Messages Not Appearing in Queue

**Symptoms:**
- Send succeeds but receive returns empty

**Diagnosis:**
```bash
# Check queue depth
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names ApproximateNumberOfMessages

# Check if messages are in-flight
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names ApproximateNumberOfMessagesNotVisible
```

**Possible causes:**
1. **Messages deleted by another consumer**
   - Multiple processes polling same queue
   - Solution: Check all running consumers

2. **Visibility timeout still active**
   - Messages received recently
   - Solution: Wait for timeout or check in-flight count

3. **Messages in DLQ**
   - Failed processing moved messages
   - Solution: Check DLQ queue

4. **Sending to wrong queue**
   - Dev vs prod queue mixup
   - Solution: Verify queue URL in code

### Issue 2: Duplicate Messages

**Symptoms:**
- Same file processed multiple times
- Duplicate database entries

**Diagnosis:**
```bash
# Check if using Standard queue
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names FifoQueue
# Should return "false" or attribute missing
```

**Solutions:**

1. **Implement idempotency in processor:**
```typescript
async function processMessage(message: Message) {
  const data = JSON.parse(message.Body!);

  // Check if already processed
  const exists = await db.query(
    'SELECT 1 FROM files WHERE file_hash = ?',
    [data.fileHash]
  );

  if (exists.rows.length > 0) {
    console.log('Already processed, skipping');
    return; // Still delete message
  }

  // Process...
}
```

2. **Use message deduplication:**
```typescript
// Include unique ID in message
await sqs.send(new SendMessageCommand({
  QueueUrl: QUEUE_URL,
  MessageBody: JSON.stringify(data),
  MessageDeduplicationId: data.fileHash, // Requires FIFO queue
}));
```

3. **Check visibility timeout:**
- If too short, messages reappear before processing completes
- Increase to 2-3x average processing time

### Issue 3: Messages Going to DLQ

**Symptoms:**
- DLQ has messages
- Processing failures

**Diagnosis:**
```bash
# Check DLQ contents
aws sqs receive-message \
  --queue-url $DLQ_URL \
  --max-number-of-messages 10 \
  --message-attribute-names All

# Check failure pattern
aws sqs get-queue-attributes \
  --queue-url $DLQ_URL \
  --attribute-names ApproximateNumberOfMessages,ApproximateAgeOfOldestMessage
```

**Common causes:**

1. **S3 file not found:**
   - File deleted before processing
   - Wrong bucket/key in message
   - Solution: Verify S3 upload before sending message

2. **Processing timeout:**
   - Large files take > visibility timeout
   - Solution: Extend visibility timeout or break into chunks

3. **Database connection errors:**
   - RDS unavailable
   - Solution: Add retry logic, check DB health

4. **Permission errors:**
   - Processor can't access S3
   - Solution: Check IAM policies

**Reprocess DLQ messages:**

```bash
# Move messages back to main queue
while true; do
  MESSAGES=$(aws sqs receive-message \
    --queue-url $DLQ_URL \
    --max-number-of-messages 10)

  if [ $(echo $MESSAGES | jq '.Messages | length') -eq 0 ]; then
    break
  fi

  echo $MESSAGES | jq -r '.Messages[] | .Body' | while read BODY; do
    aws sqs send-message \
      --queue-url $QUEUE_URL \
      --message-body "$BODY"
  done

  echo $MESSAGES | jq -r '.Messages[] | .ReceiptHandle' | while read RECEIPT; do
    aws sqs delete-message \
      --queue-url $DLQ_URL \
      --receipt-handle "$RECEIPT"
  done
done
```

### Issue 4: High Latency / Slow Processing

**Symptoms:**
- Messages waiting in queue
- ApproximateAgeOfOldestMessage increasing

**Diagnosis:**
```bash
# Check queue metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/SQS \
  --metric-name ApproximateAgeOfOldestMessage \
  --dimensions Name=QueueName,Value=cis-filesearch-queue-dev \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Maximum
```

**Solutions:**

1. **Scale processors horizontally:**
   - Add more EC2 instances
   - Increase Lambda concurrency
   - Deploy multiple consumers

2. **Optimize processing code:**
   - Profile slow operations
   - Add caching
   - Parallelize I/O

3. **Increase batch size:**
```typescript
// Process 10 messages at once
const result = await sqs.receive({
  MaxNumberOfMessages: 10,
});

await Promise.all(
  result.Messages.map(msg => processMessage(msg))
);
```

4. **Separate priority queues:**
```bash
# Create high-priority queue
aws sqs create-queue --queue-name cis-filesearch-priority-queue-dev

# Route urgent files to priority queue
if (file.isUrgent) {
  await sendToQueue(PRIORITY_QUEUE_URL, message);
} else {
  await sendToQueue(STANDARD_QUEUE_URL, message);
}
```

### Issue 5: Permission Denied

**Symptoms:**
```
AccessDeniedException: User is not authorized to perform: sqs:SendMessage
```

**Diagnosis:**
```bash
# Check caller identity
aws sts get-caller-identity

# Check attached policies
aws iam list-attached-role-policies --role-name CISFileScannerRole

# Check policy content
aws iam get-policy-version \
  --policy-arn arn:aws:iam::ACCOUNT:policy/CISFileScannerSQSAccess \
  --version-id v1
```

**Solutions:**

1. **Verify IAM role attached:**
```bash
# For EC2
aws ec2 describe-instances \
  --instance-ids i-xxxxx \
  --query 'Reservations[0].Instances[0].IamInstanceProfile'
```

2. **Check policy ARN in Resource:**
```json
{
  "Resource": "arn:aws:sqs:ap-northeast-1:ACCOUNT_ID:cis-filesearch-queue-dev"
}
```
Make sure ACCOUNT_ID and queue name are correct.

3. **Test with temporary credentials:**
```bash
aws sqs send-message \
  --queue-url $QUEUE_URL \
  --message-body "test" \
  --profile your-profile
```

### Issue 6: Empty Receives Despite Messages

**Symptoms:**
- Queue has messages (depth > 0)
- Receive returns empty

**Causes:**

1. **Messages in-flight:**
```bash
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names ApproximateNumberOfMessagesNotVisible
```
If high, messages are being processed by other consumers.

2. **Visibility timeout too long:**
- Message received once, now invisible for extended period
- Wait for timeout or use different consumer

3. **Delay queue:**
```bash
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names DelaySeconds
```
If set, new messages are delayed.

4. **Message filtering (SNS → SQS):**
- Subscription filter policy rejecting messages
- Check subscription configuration

---

## Summary Checklist

- [ ] Main queue created (cis-filesearch-queue-dev)
- [ ] DLQ created (cis-filesearch-dlq-dev)
- [ ] Redrive policy configured (3 max receives)
- [ ] Visibility timeout set (300 seconds)
- [ ] Message retention configured (4 days main, 14 days DLQ)
- [ ] Long polling enabled (20 seconds)
- [ ] Encryption enabled (SSE-SQS)
- [ ] IAM policies created (scanner send, processor receive)
- [ ] IAM policies attached to roles
- [ ] CloudWatch alarms configured (backlog, age, DLQ)
- [ ] VPC endpoint created (optional but recommended)
- [ ] Test send successful
- [ ] Test receive successful
- [ ] Test batch operations successful
- [ ] Test DLQ flow successful
- [ ] Integration test passed

---

## Next Steps

1. **Configure CloudWatch Logging**: See `aws-cloudwatch-configuration-guide.md`
2. **Create VPC Endpoints**: See `aws-vpc-endpoints-guide.md`
3. **Update Scanner Code**: Add queue URL to `.env`
4. **Update Processor Code**: Implement message polling
5. **Run Integration Test**: Test full workflow
6. **Set Up Monitoring**: Create dashboard in CloudWatch

---

## Additional Resources

- [SQS Developer Guide](https://docs.aws.amazon.com/sqs/index.html)
- [SQS Best Practices](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-best-practices.html)
- [SQS Pricing](https://aws.amazon.com/sqs/pricing/)
- [Message Attributes](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-message-metadata.html)
- [Dead Letter Queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)

---

**Document Version**: 1.0
**Last Updated**: 2025-01-12
**Author**: CIS Development Team
