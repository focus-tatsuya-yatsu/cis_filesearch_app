# Quick Reference Cards - CIS File Search Application

**🎯 Purpose**: Printable cheat sheets for common tasks

**💡 Tip**: Print these cards and keep them handy during implementation!

---

## 📇 Card 1: AWS CLI Essentials

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  AWS CLI QUICK REFERENCE                                │
│                                                         │
│  Configure:                                             │
│  $ aws configure                                        │
│    → Enter: Access Key, Secret, Region, json            │
│                                                         │
│  Verify Identity:                                       │
│  $ aws sts get-caller-identity                          │
│                                                         │
│  Common Patterns:                                       │
│  $ aws [service] [action] [--options]                   │
│                                                         │
│  Example:                                               │
│  $ aws s3 cp file.txt s3://my-bucket/                   │
│       ^^  ^^ ^^^^^^^ ^^^^^^^^^^^^^^^                    │
│       │   │  │       └─ Resource                        │
│       │   │  └───────── Object                          │
│       │   └──────────── Action                          │
│       └──────────────── Service                         │
│                                                         │
│  Help:                                                  │
│  $ aws [service] help                                   │
│  $ aws [service] [action] help                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Print and keep next to your computer** ✂️

---

## 📇 Card 2: S3 Commands

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  S3 COMMAND CHEAT SHEET                                 │
│                                                         │
│  List buckets:                                          │
│  $ aws s3 ls                                            │
│                                                         │
│  List bucket contents:                                  │
│  $ aws s3 ls s3://bucket-name/                          │
│  $ aws s3 ls s3://bucket-name/folder/ --recursive       │
│                                                         │
│  Upload file:                                           │
│  $ aws s3 cp local.txt s3://bucket/                     │
│  $ aws s3 cp local.txt s3://bucket/path/remote.txt      │
│                                                         │
│  Upload folder:                                         │
│  $ aws s3 sync ./folder s3://bucket/folder/             │
│                                                         │
│  Download file:                                         │
│  $ aws s3 cp s3://bucket/file.txt ./                    │
│                                                         │
│  Delete file:                                           │
│  $ aws s3 rm s3://bucket/file.txt                       │
│                                                         │
│  Delete bucket (must be empty):                         │
│  $ aws s3 rb s3://bucket-name                           │
│                                                         │
│  Force delete (with contents):                          │
│  $ aws s3 rb s3://bucket-name --force                   │
│                                                         │
│  Get bucket location:                                   │
│  $ aws s3api get-bucket-location --bucket bucket-name   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 📇 Card 3: SQS Commands

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  SQS COMMAND CHEAT SHEET                                │
│                                                         │
│  List queues:                                           │
│  $ aws sqs list-queues                                  │
│                                                         │
│  Get queue URL:                                         │
│  $ aws sqs get-queue-url --queue-name my-queue          │
│                                                         │
│  Send message:                                          │
│  $ aws sqs send-message \                               │
│      --queue-url https://sqs...my-queue \               │
│      --message-body '{"key":"value"}'                   │
│                                                         │
│  Receive messages:                                      │
│  $ aws sqs receive-message \                            │
│      --queue-url https://sqs...my-queue \               │
│      --max-number-of-messages 10 \                      │
│      --wait-time-seconds 20                             │
│                                                         │
│  Delete message:                                        │
│  $ aws sqs delete-message \                             │
│      --queue-url https://sqs...my-queue \               │
│      --receipt-handle "RECEIPT_HANDLE_HERE"             │
│                                                         │
│  Get queue attributes:                                  │
│  $ aws sqs get-queue-attributes \                       │
│      --queue-url https://sqs...my-queue \               │
│      --attribute-names All                              │
│                                                         │
│  Purge queue (delete all messages):                     │
│  $ aws sqs purge-queue \                                │
│      --queue-url https://sqs...my-queue                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 📇 Card 4: IAM Commands

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  IAM COMMAND CHEAT SHEET                                │
│                                                         │
│  List roles:                                            │
│  $ aws iam list-roles                                   │
│                                                         │
│  Get role details:                                      │
│  $ aws iam get-role --role-name MyRole                  │
│                                                         │
│  List attached policies:                                │
│  $ aws iam list-attached-role-policies \                │
│      --role-name MyRole                                 │
│                                                         │
│  List all policies:                                     │
│  $ aws iam list-policies --scope Local                  │
│                                                         │
│  Get policy version:                                    │
│  $ aws iam get-policy-version \                         │
│      --policy-arn arn:aws:iam::123:policy/MyPolicy \    │
│      --version-id v1                                    │
│                                                         │
│  Create role:                                           │
│  $ aws iam create-role \                                │
│      --role-name MyRole \                               │
│      --assume-role-policy-document file://trust.json    │
│                                                         │
│  Attach policy to role:                                 │
│  $ aws iam attach-role-policy \                         │
│      --role-name MyRole \                               │
│      --policy-arn arn:aws:iam::123:policy/MyPolicy      │
│                                                         │
│  List users:                                            │
│  $ aws iam list-users                                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 📇 Card 5: OpenSearch Commands

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  OPENSEARCH COMMAND CHEAT SHEET                         │
│                                                         │
│  List domains:                                          │
│  $ aws opensearch list-domain-names                     │
│                                                         │
│  Describe domain:                                       │
│  $ aws opensearch describe-domain \                     │
│      --domain-name my-domain                            │
│                                                         │
│  Get domain endpoint:                                   │
│  $ aws opensearch describe-domain \                     │
│      --domain-name my-domain \                          │
│      --query 'DomainStatus.Endpoint'                    │
│                                                         │
│  Cluster health (curl):                                 │
│  $ curl -X GET "https://ENDPOINT/_cluster/health" \     │
│      --aws-sigv4 "aws:amz:REGION:es"                    │
│                                                         │
│  List indices:                                          │
│  $ curl -X GET "https://ENDPOINT/_cat/indices?v" \      │
│      --aws-sigv4 "aws:amz:REGION:es"                    │
│                                                         │
│  Create index:                                          │
│  $ curl -X PUT "https://ENDPOINT/my-index" \            │
│      --aws-sigv4 "aws:amz:REGION:es"                    │
│                                                         │
│  Index document:                                        │
│  $ curl -X POST "https://ENDPOINT/index/_doc" \         │
│      --aws-sigv4 "aws:amz:REGION:es" \                  │
│      -H 'Content-Type: application/json' \              │
│      -d '{"field":"value"}'                             │
│                                                         │
│  Search:                                                │
│  $ curl -X GET "https://ENDPOINT/index/_search?q=test" \│
│      --aws-sigv4 "aws:amz:REGION:es"                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 📇 Card 6: EC2 & Auto Scaling Commands

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  EC2 & AUTO SCALING CHEAT SHEET                         │
│                                                         │
│  List running instances:                                │
│  $ aws ec2 describe-instances \                         │
│      --filters "Name=instance-state-name,Values=running"│
│                                                         │
│  List Auto Scaling Groups:                              │
│  $ aws autoscaling describe-auto-scaling-groups         │
│                                                         │
│  Get specific ASG:                                      │
│  $ aws autoscaling describe-auto-scaling-groups \       │
│      --auto-scaling-group-names my-asg                  │
│                                                         │
│  Set desired capacity:                                  │
│  $ aws autoscaling set-desired-capacity \               │
│      --auto-scaling-group-name my-asg \                 │
│      --desired-capacity 3                               │
│                                                         │
│  Update min/max:                                        │
│  $ aws autoscaling update-auto-scaling-group \          │
│      --auto-scaling-group-name my-asg \                 │
│      --min-size 0 --max-size 10                         │
│                                                         │
│  Suspend scaling:                                       │
│  $ aws autoscaling suspend-processes \                  │
│      --auto-scaling-group-name my-asg                   │
│                                                         │
│  Resume scaling:                                        │
│  $ aws autoscaling resume-processes \                   │
│      --auto-scaling-group-name my-asg                   │
│                                                         │
│  View scaling activities:                               │
│  $ aws autoscaling describe-scaling-activities \        │
│      --auto-scaling-group-name my-asg \                 │
│      --max-records 10                                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 📇 Card 7: CloudWatch Commands

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  CLOUDWATCH COMMAND CHEAT SHEET                         │
│                                                         │
│  List log groups:                                       │
│  $ aws logs describe-log-groups                         │
│                                                         │
│  Create log group:                                      │
│  $ aws logs create-log-group \                          │
│      --log-group-name /aws/my-app/logs                  │
│                                                         │
│  Tail logs (live):                                      │
│  $ aws logs tail /aws/my-app/logs --follow              │
│                                                         │
│  Filter logs:                                           │
│  $ aws logs filter-log-events \                         │
│      --log-group-name /aws/my-app/logs \                │
│      --filter-pattern "ERROR" \                         │
│      --start-time $(date -u -d '1 hour ago' +%s)000     │
│                                                         │
│  Get metric statistics:                                 │
│  $ aws cloudwatch get-metric-statistics \               │
│      --namespace AWS/SQS \                              │
│      --metric-name ApproximateNumberOfMessagesVisible \ │
│      --dimensions Name=QueueName,Value=my-queue \       │
│      --start-time 2025-01-01T00:00:00Z \                │
│      --end-time 2025-01-01T23:59:59Z \                  │
│      --period 300 --statistics Average                  │
│                                                         │
│  List alarms:                                           │
│  $ aws cloudwatch describe-alarms                       │
│                                                         │
│  Put custom metric:                                     │
│  $ aws cloudwatch put-metric-data \                     │
│      --namespace MyApp \                                │
│      --metric-name ProcessedFiles \                     │
│      --value 1 --unit Count                             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 📇 Card 8: Common Filters & Queries

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  JQ QUERIES FOR AWS CLI                                 │
│                                                         │
│  Get specific field:                                    │
│  $ aws ... --query 'Field' --output text                │
│                                                         │
│  Get nested field:                                      │
│  $ aws ... --query 'Parent.Child' --output text         │
│                                                         │
│  Filter array:                                          │
│  $ aws ... --query 'Items[?Name==`value`]'              │
│                                                         │
│  Get first item:                                        │
│  $ aws ... --query 'Items[0]'                           │
│                                                         │
│  Get multiple fields:                                   │
│  $ aws ... --query '{Name:Name,Id:Id}'                  │
│                                                         │
│  Example - Get queue URL:                               │
│  $ aws sqs get-queue-url \                              │
│      --queue-name my-queue \                            │
│      --query 'QueueUrl' \                               │
│      --output text                                      │
│                                                         │
│  Example - Get all running instance IDs:                │
│  $ aws ec2 describe-instances \                         │
│      --filters "Name=instance-state-name,Values=running"│
│      --query 'Reservations[].Instances[].InstanceId' \  │
│      --output text                                      │
│                                                         │
│  Pipe to jq for complex parsing:                        │
│  $ aws ... --output json | jq '.Items[] | select(...)'  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 📇 Card 9: Resource Naming Convention

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  NAMING CONVENTION REFERENCE                            │
│                                                         │
│  Pattern: [project]-[resource]-[environment]            │
│                                                         │
│  S3 Buckets:                                            │
│  ├─ cis-filesearch-landing-dev                          │
│  ├─ cis-filesearch-processed-dev                        │
│  └─ cis-filesearch-errors-dev                           │
│                                                         │
│  SQS Queues:                                            │
│  ├─ cis-filesearch-queue-dev                            │
│  └─ cis-filesearch-dlq-dev                              │
│                                                         │
│  IAM Roles:                                             │
│  ├─ CISFileProcessorRole-dev                            │
│  ├─ CISFileProcessorRole-staging                        │
│  └─ CISFileProcessorRole-prod                           │
│                                                         │
│  IAM Policies:                                          │
│  ├─ CISFileProcessorS3Access-dev                        │
│  ├─ CISFileProcessorSQSAccess-dev                       │
│  └─ CISFileProcessorCloudWatchLogs-dev                  │
│                                                         │
│  OpenSearch:                                            │
│  └─ cis-filesearch-dev                                  │
│                                                         │
│  Auto Scaling Group:                                    │
│  └─ cis-file-processor-asg-dev                          │
│                                                         │
│  Launch Template:                                       │
│  └─ cis-file-processor-worker-v1                        │
│                                                         │
│  EventBridge Rules:                                     │
│  └─ cis-s3-to-sqs-dev                                   │
│                                                         │
│  Security Groups:                                       │
│  ├─ cis-opensearch-sg-dev                               │
│  └─ cis-workers-sg-dev                                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 📇 Card 10: ARN Patterns

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  AWS ARN (Amazon Resource Name) PATTERNS                │
│                                                         │
│  Format:                                                │
│  arn:aws:service:region:account-id:resource-type/name   │
│                                                         │
│  S3 Bucket:                                             │
│  arn:aws:s3:::bucket-name                               │
│  arn:aws:s3:::bucket-name/*                             │
│       ^^  ^   ^^^^^^^^^^^                               │
│       │   │   └─ Bucket name (globally unique)          │
│       │   └───── S3 has no region/account (global)      │
│       └───────── Service                                │
│                                                         │
│  SQS Queue:                                             │
│  arn:aws:sqs:ap-northeast-1:123456789012:my-queue       │
│       ^^  ^^^ ^^^^^^^^^^^^^^ ^^^^^^^^^^^^ ^^^^^^^^      │
│       │   │   │              │            └─ Queue name │
│       │   │   │              └────────────── Account ID │
│       │   │   └───────────────────────────── Region     │
│       │   └───────────────────────────────── Service    │
│       └───────────────────────────────────── Partition  │
│                                                         │
│  IAM Role:                                              │
│  arn:aws:iam::123456789012:role/MyRole                  │
│                ^^ (IAM is global, no region)            │
│                                                         │
│  OpenSearch Domain:                                     │
│  arn:aws:es:ap-northeast-1:123456789012:domain/my-domain│
│                                                         │
│  CloudWatch Log Group:                                  │
│  arn:aws:logs:ap-northeast-1:123456789012:log-group:/aws│
│  /my-app/logs:*                                         │
│                                                         │
│  Wildcard Patterns:                                     │
│  arn:aws:s3:::my-bucket/*    ← All objects in bucket    │
│  arn:aws:iam::*:role/MyRole  ← Role in any account      │
│  arn:aws:logs:*:*:log-group:* ← All log groups          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 📇 Card 11: Cost Estimation

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  MONTHLY COST CALCULATOR (DEV ENVIRONMENT)              │
│                                                         │
│  Storage:                                               │
│  ├─ S3 (1TB, Intelligent-Tiering)     $15.00           │
│  ├─ EBS (3×20GB GP3 for workers)       $4.41           │
│  └─ OpenSearch (100GB GP3)             $8.00           │
│                                           ───────       │
│                                   Subtotal: $27.41      │
│                                                         │
│  Compute:                                               │
│  ├─ OpenSearch (t3.small, 730h)       $48.00           │
│  ├─ EC2 Spot (t3.medium, 556h)         $8.78           │
│  └─ EC2 On-Demand (backup, 24h)        $0.72           │
│                                           ───────       │
│                                   Subtotal: $57.50      │
│                                                         │
│  Networking:                                            │
│  ├─ VPC Endpoint (S3 Gateway)          $0.00 (FREE)    │
│  ├─ VPC Endpoint (SQS Interface)       $7.55           │
│  └─ Data Transfer (minimal)            $1.00           │
│                                           ───────       │
│                                   Subtotal: $8.55       │
│                                                         │
│  Services:                                              │
│  ├─ SQS                                $0.00 (Free tier)│
│  ├─ EventBridge                        $0.00 (Free tier)│
│  ├─ CloudWatch Logs                    $2.00           │
│  └─ CloudWatch Metrics/Alarms          $0.00 (Free tier)│
│                                           ───────       │
│                                   Subtotal: $2.00       │
│                                                         │
│  ═══════════════════════════════════════════════════   │
│  TOTAL (100K files/month):            $95.46/month      │
│  ═══════════════════════════════════════════════════   │
│                                                         │
│  Cost Per File:          $0.00095 (< 1/10 of 1¢)       │
│                                                         │
│  Scaling Factors:                                       │
│  ├─ 10K files/mo:  ~$65/mo (less EC2 time)             │
│  ├─ 100K files/mo: ~$95/mo (baseline)                  │
│  └─ 1M files/mo:   ~$220/mo (larger instances)         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 📇 Card 12: Emergency Commands

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  EMERGENCY TROUBLESHOOTING COMMANDS                     │
│                                                         │
│  "My costs are too high!"                               │
│  ├─ Check current month costs:                          │
│  │  $ aws ce get-cost-and-usage \                       │
│  │      --time-period Start=2025-01-01,End=2025-01-31 \ │
│  │      --granularity MONTHLY \                         │
│  │      --metrics BlendedCost \                         │
│  │      --group-by Type=DIMENSION,Key=SERVICE           │
│  │                                                      │
│  ├─ Stop all EC2 instances:                             │
│  │  $ aws autoscaling set-desired-capacity \            │
│  │      --auto-scaling-group-name cis-file-processor-asg│
│  │      --desired-capacity 0                            │
│  │                                                      │
│  └─ Delete OpenSearch domain (DANGEROUS!):              │
│     $ aws opensearch delete-domain \                    │
│         --domain-name cis-filesearch-dev                │
│                                                         │
│  "Nothing is working!"                                  │
│  ├─ Check IAM role exists:                              │
│  │  $ aws iam get-role --role-name CISFileProcessorRole │
│  │                                                      │
│  ├─ Check S3 bucket exists:                             │
│  │  $ aws s3 ls s3://YOUR-BUCKET-NAME                   │
│  │                                                      │
│  ├─ Check SQS queue has messages:                       │
│  │  $ aws sqs get-queue-attributes \                    │
│  │      --queue-url YOUR-QUEUE-URL \                    │
│  │      --attribute-names ApproximateNumberOfMessages   │
│  │                                                      │
│  └─ Check OpenSearch cluster health:                    │
│     $ aws opensearch describe-domain \                  │
│         --domain-name cis-filesearch-dev \              │
│         --query 'DomainStatus.{Status:Processing}'      │
│                                                         │
│  "Auto Scaling isn't launching instances!"              │
│  └─ Check recent scaling activities:                    │
│     $ aws autoscaling describe-scaling-activities \     │
│         --auto-scaling-group-name cis-file-processor-asg│
│         --max-records 5                                 │
│                                                         │
│  "I'm locked out!"                                      │
│  └─ Use root account to reset IAM user:                 │
│     (Login to console with root email/password)         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 🖨️ Print Instructions

### How to Print

1. **PDF Export**:
   - Open this file in VS Code or any markdown viewer
   - Use markdown-to-PDF extension
   - Or copy to Google Docs and print

2. **Text File**:
   - Print directly from terminal: `lpr 05-QUICK-REFERENCE-CARDS.md`
   - Or open in text editor and print

3. **Index Cards**:
   - Print each "card" on separate 3x5 or 4x6 index card
   - Laminate for durability
   - Keep in binder or card box

### Recommended Printing

- **Card 1-7**: Print and keep at desk (most common commands)
- **Card 8**: Print for developers (filtering/querying)
- **Card 9-10**: Print for reference (naming/ARN patterns)
- **Card 11**: Print for management (cost tracking)
- **Card 12**: Print in RED for emergencies

---

**Document Version**: 1.0
**Last Updated**: 2025-01-18

**Pro Tip**: Laminate these cards and keep them next to your keyboard! 🎴
