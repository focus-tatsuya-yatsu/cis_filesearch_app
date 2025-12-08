# Troubleshooting Decision Tree - CIS File Search Application

**🎯 Purpose**: Quick diagnosis and resolution of common issues

**🔍 How to Use**: Start at the top, answer questions, follow the path to your solution

---

## 🌳 Main Decision Tree

```
START: Something isn't working
│
├─ WHAT'S THE PROBLEM?
│
├─── [1] Can't access AWS
│     └─→ Go to: Access Issues Tree
│
├─── [2] Service won't create/start
│     └─→ Go to: Service Creation Tree
│
├─── [3] Files not processing
│     └─→ Go to: Processing Pipeline Tree
│
├─── [4] Search not working
│     └─→ Go to: OpenSearch Tree
│
├─── [5] Costs too high
│     └─→ Go to: Cost Issues Tree
│
├─── [6] Performance slow
│     └─→ Go to: Performance Tree
│
└─── [7] Security/Permission errors
      └─→ Go to: IAM/Security Tree
```

---

## 🔐 Access Issues Tree

```
START: Can't access AWS
│
├─ WHERE ARE YOU TRYING TO ACCESS?
│
├─── [A] AWS Console (web)
│     │
│     ├─ Can you reach https://console.aws.amazon.com?
│     │
│     ├─── No → Check internet connection
│     │         Try different browser
│     │         Try incognito mode
│     │
│     └─── Yes → Do you have email/password?
│           │
│           ├─── No → Use "Forgot password"
│           │         Check email for reset link
│           │
│           └─── Yes → MFA code working?
│                 │
│                 ├─── No → Phone not receiving code?
│                 │         ├─ Contact AWS Support
│                 │         └─ Use backup MFA device
│                 │
│                 └─── Yes → Login should work!
│                           Still broken? → AWS outage?
│                           Check: https://status.aws.amazon.com
│
└─── [B] AWS CLI (terminal)
      │
      ├─ Run: aws sts get-caller-identity
      │
      ├─── Error: "Unable to locate credentials"
      │     │
      │     SOLUTION:
      │     1. Run: aws configure
      │     2. Enter access key from IAM console
      │     3. Enter secret key (from when you created key)
      │     4. Enter region: ap-northeast-1
      │     5. Enter output: json
      │
      ├─── Error: "The security token included in the request is invalid"
      │     │
      │     CAUSE: Access keys are wrong or deleted
      │     SOLUTION:
      │     1. Login to AWS Console
      │     2. IAM → Users → Your user → Security credentials
      │     3. Make old key inactive
      │     4. Create new access key
      │     5. Run: aws configure (with new keys)
      │
      ├─── Error: "An error occurred (ExpiredToken)"
      │     │
      │     CAUSE: Temporary credentials expired (if using MFA)
      │     SOLUTION:
      │     1. Refresh credentials
      │     2. Or use permanent access keys instead
      │
      └─── Success: Shows account info
            └─→ CLI is working! ✅
```

**Quick Fix**:
```bash
# Reset CLI configuration
aws configure

# Verify it works
aws sts get-caller-identity
```

---

## 🏗️ Service Creation Tree

```
START: Service won't create
│
├─ WHICH SERVICE?
│
├─── [A] S3 Bucket
│     │
│     ├─ Error: "BucketAlreadyExists"
│     │   CAUSE: Bucket names must be globally unique
│     │   SOLUTION: Add unique suffix to name
│     │   ├─ cis-filesearch-landing-dev-john123
│     │   └─ cis-filesearch-landing-dev-20250118
│     │
│     ├─ Error: "InvalidBucketName"
│     │   CAUSE: Invalid characters in name
│     │   RULES:
│     │   ├─ Only: lowercase, numbers, hyphens
│     │   ├─ No: UPPERCASE, spaces, underscores
│     │   ├─ Start/end: letter or number (not hyphen)
│     │   └─ Length: 3-63 characters
│     │
│     └─ Error: "AccessDenied"
│         CAUSE: IAM user lacks s3:CreateBucket permission
│         SOLUTION:
│         1. Login as root or admin
│         2. IAM → Users → Your user → Add permissions
│         3. Attach policy: AmazonS3FullAccess (temporary)
│         4. Try again
│
├─── [B] SQS Queue
│     │
│     ├─ Error: "QueueAlreadyExists"
│     │   SOLUTION: Queue with this name exists
│     │   ├─ Use different name, OR
│     │   └─ Delete existing queue first
│     │
│     ├─ Error: "InvalidParameterValue"
│     │   CAUSE: Invalid queue attribute
│     │   CHECK:
│     │   ├─ VisibilityTimeout: 0-43200 seconds
│     │   ├─ MessageRetentionPeriod: 60-1209600 seconds
│     │   └─ ReceiveMessageWaitTimeSeconds: 0-20 seconds
│     │
│     └─ Queue created but DLQ not attached?
│         SOLUTION:
│         1. Get DLQ ARN:
│            aws sqs get-queue-attributes --queue-url DLQ_URL \
│              --attribute-names QueueArn
│         2. Update main queue with redrive policy
│
├─── [C] OpenSearch Domain
│     │
│     ├─ Status stuck on "Processing" for > 1 hour
│     │   CAUSE: Normal! Domain creation takes 20-45 minutes
│     │   CHECK:
│     │   ├─ Wait 45 minutes before worrying
│     │   ├─ Check CloudTrail for errors
│     │   └─ If > 1 hour, contact AWS Support
│     │
│     ├─ Error: "LimitExceededException"
│     │   CAUSE: AWS account limits
│     │   SOLUTION:
│     │   1. Check: https://console.aws.amazon.com/servicequotas
│     │   2. Request limit increase for OpenSearch
│     │   3. Usually approved in 1-2 business days
│     │
│     ├─ Error: "InvalidParameterException: No subnets found"
│     │   CAUSE: VPC has no subnets
│     │   SOLUTION:
│     │   1. Use default VPC (should have subnets)
│     │   2. Or create subnet in your VPC first
│     │
│     └─ Domain created but status "RED"
│         │
│         DIAGNOSIS:
│         $ aws opensearch describe-domain \
│             --domain-name cis-filesearch-dev
│
│         COMMON CAUSES:
│         ├─ Out of disk space → Increase EBS volume size
│         ├─ Too many shards → Reduce shard count
│         ├─ Memory pressure → Upgrade to larger instance type
│         └─ Index corruption → Delete and recreate index
│
├─── [D] Auto Scaling Group
│     │
│     ├─ ASG created but no instances launching
│     │   │
│     │   DIAGNOSIS:
│     │   $ aws autoscaling describe-scaling-activities \
│     │       --auto-scaling-group-name cis-file-processor-asg-dev \
│     │       --max-records 5
│     │
│     │   COMMON ERRORS:
│     │   │
│     │   ├─ "InsufficientInstanceCapacity"
│     │   │   CAUSE: No Spot instances available
│     │   │   SOLUTION:
│     │   │   1. Add more instance types to launch template
│     │   │   2. Increase On-Demand allocation (30% → 50%)
│     │   │   3. Try different availability zone
│     │   │
│     │   ├─ "InvalidParameterValue: Invalid IAM Instance Profile"
│     │   │   CAUSE: Instance profile not attached to role
│     │   │   SOLUTION:
│     │   │   $ aws iam add-role-to-instance-profile \
│     │   │       --instance-profile-name Profile-dev \
│     │   │       --role-name CISFileProcessorRole-dev
│     │   │
│     │   └─ "Launching EC2 instance failed"
│     │       CAUSE: Various (check scaling activity message)
│     │       SOLUTIONS:
│     │       ├─ AMI not available in region → Use correct AMI
│     │       ├─ Security group doesn't exist → Create SG first
│     │       └─ Subnet doesn't exist → Fix VPC configuration
│     │
│     └─ Instances launch but terminate immediately
│         CAUSE: User data script failing
│         SOLUTION:
│         1. Launch instance manually without ASG
│         2. SSH into instance
│         3. Check logs: /var/log/cloud-init-output.log
│         4. Fix script errors
│         5. Update launch template
│
└─── [E] EventBridge Rule
      │
      ├─ Rule created but events not reaching SQS
      │   │
      │   DIAGNOSIS STEPS:
      │   │
      │   1. Verify EventBridge enabled on S3:
      │      $ aws s3api get-bucket-notification-configuration \
      │          --bucket YOUR-BUCKET
      │      Should show: "EventBridgeConfiguration": {}
      │
      │   2. Check rule exists and is enabled:
      │      $ aws events describe-rule --name cis-s3-to-sqs-dev
      │      Should show: "State": "ENABLED"
      │
      │   3. Verify SQS resource policy allows EventBridge:
      │      $ aws sqs get-queue-attributes \
      │          --queue-url YOUR-QUEUE-URL \
      │          --attribute-names Policy
      │      Should include: "Service": "events.amazonaws.com"
      │
      │   SOLUTIONS:
      │   ├─ EventBridge not enabled on bucket?
      │   │   $ aws s3api put-bucket-notification-configuration \
      │   │       --bucket YOUR-BUCKET \
      │   │       --notification-configuration \
      │   │         '{"EventBridgeConfiguration": {}}'
      │   │
      │   ├─ Rule disabled?
      │   │   $ aws events enable-rule --name cis-s3-to-sqs-dev
      │   │
      │   └─ SQS policy missing?
      │       Update policy to allow events.amazonaws.com
      │
      └─ Events reaching SQS but in wrong format
          CAUSE: Input transformer misconfigured
          SOLUTION: Check EventBridge rule input transformer
```

---

## 🔄 Processing Pipeline Tree

```
START: Files not processing
│
├─ UPLOAD TEST FILE:
│   $ echo "Test" > test.txt
│   $ aws s3 cp test.txt s3://YOUR-BUCKET/test/
│
├─ WHERE IS IT FAILING?
│
├─── [1] File uploaded to S3?
│     │
│     ├─── No → Check S3 access
│     │         $ aws s3 ls s3://YOUR-BUCKET/
│     │         Error: "AccessDenied" → Fix IAM policy
│     │
│     └─── Yes → File shows in S3 ✅
│               Continue to [2]
│
├─── [2] SQS message received?
│     │
│     $ aws sqs receive-message \
│         --queue-url YOUR-QUEUE-URL \
│         --wait-time-seconds 10
│     │
│     ├─── No messages
│     │     │
│     │     CAUSES:
│     │     ├─ EventBridge not configured → See Service Creation Tree [E]
│     │     ├─ S3 event notification not enabled
│     │     └─ Event pattern doesn't match uploaded file
│     │
│     └─── Message received ✅
│               Continue to [3]
│
├─── [3] Auto Scaling Group launching instances?
│     │
│     $ aws autoscaling describe-auto-scaling-groups \
│         --auto-scaling-group-names cis-file-processor-asg-dev \
│         --query 'AutoScalingGroups[0].Instances'
│     │
│     ├─── No instances
│     │     │
│     │     CAUSES:
│     │     ├─ Desired capacity = 0 → Check scaling policy
│     │     ├─ Queue depth too low to trigger scaling
│     │     │   Target: 30 messages per instance
│     │     │   If < 30 messages, won't scale up
│     │     │   SOLUTION: Upload 50+ test files
│     │     │
│     │     ├─ Scaling suspended
│     │     │   $ aws autoscaling resume-processes \
│     │     │       --auto-scaling-group-name cis-file-processor-asg-dev
│     │     │
│     │     └─ Launch failures → See Service Creation Tree [D]
│     │
│     └─── Instances running ✅
│               Continue to [4]
│
├─── [4] Instances processing messages?
│     │
│     CHECK LOGS:
│     $ aws logs tail /aws/cis-file-processor/dev/workers --follow
│     │
│     ├─── No logs appearing
│     │     │
│     │     CAUSES:
│     │     ├─ Application not running on instance
│     │     │   SSH to instance, check:
│     │     │   $ ps aux | grep python
│     │     │   $ systemctl status file-processor
│     │     │
│     │     ├─ CloudWatch Logs agent not installed
│     │     │   Install agent in user data script
│     │     │
│     │     └─ IAM role lacks logs:PutLogEvents permission
│     │         Add CloudWatch Logs policy to role
│     │
│     ├─── Logs show errors
│     │     │
│     │     COMMON ERRORS:
│     │     │
│     │     ├─ "AccessDenied" downloading from S3
│     │     │   FIX: Add s3:GetObject to IAM role policy
│     │     │
│     │     ├─ "ConnectionRefusedError" to OpenSearch
│     │     │   CAUSES:
│     │     │   ├─ Security group doesn't allow 443 from workers
│     │     │   ├─ OpenSearch domain not in same VPC
│     │     │   └─ OpenSearch endpoint wrong
│     │     │
│     │     ├─ "ModuleNotFoundError: No module named 'X'"
│     │     │   FIX: Add package to requirements.txt
│     │     │        Update user data to install dependencies
│     │     │
│     │     └─ "botocore.exceptions.NoCredentialsError"
│     │         FIX: Ensure IAM instance profile attached
│     │              $ aws ec2 describe-instances --instance-ids i-xxx \
│     │                  --query 'Reservations[0].Instances[0].IamInstanceProfile'
│     │
│     └─── Logs show success ✅
│               Continue to [5]
│
└─── [5] File indexed in OpenSearch?
      │
      $ curl -X GET "https://OPENSEARCH-ENDPOINT/files/_search?q=test" \
          --aws-sigv4 "aws:amz:ap-northeast-1:es"
      │
      ├─── Error: "index_not_found_exception"
      │     CAUSE: Index not created
      │     FIX: Worker should create index on first run
      │          Check index creation code
      │
      ├─── No results (but index exists)
      │     CAUSES:
      │     ├─ Document not indexed → Check worker indexing code
      │     ├─ Search query wrong → Try: /_search (no query)
      │     └─ Index name mismatch → Verify index name
      │
      └─── Document found ✅
            SUCCESS! Pipeline working end-to-end! 🎉
```

---

## 🔍 OpenSearch Tree

```
START: OpenSearch not working
│
├─ CHECK CLUSTER STATUS:
│   $ aws opensearch describe-domain \
│       --domain-name cis-filesearch-dev \
│       --query 'DomainStatus.{Status:Processing,Endpoint:Endpoint}'
│
├─ WHAT'S THE STATUS?
│
├─── [A] Processing: true (still creating)
│     └─→ WAIT: Takes 20-45 minutes
│           Check back in 15 minutes
│
├─── [B] Endpoint: null (no endpoint yet)
│     └─→ Domain not fully created
│           Check CloudTrail for creation errors
│
├─── [C] Can't connect to endpoint
│     │
│     TEST CONNECTION:
│     $ curl -X GET "https://ENDPOINT/_cluster/health" \
│         --aws-sigv4 "aws:amz:ap-northeast-1:es"
│     │
│     ├─── Error: "Connection refused"
│     │     CAUSES:
│     │     ├─ Wrong endpoint → Check endpoint URL
│     │     ├─ Not in VPC → Can't access VPC endpoint from internet
│     │     │   SOLUTION: Test from EC2 instance in same VPC
│     │     └─ Security group blocking → Add ingress rule for 443
│     │
│     ├─── Error: "Forbidden" or "AccessDenied"
│     │     CAUSE: Access policy too restrictive
│     │     FIX:
│     │     1. Update domain access policy
│     │     2. Add your IP or IAM role to allowed principals
│     │
│     ├─── Error: "SignatureDoesNotMatch"
│     │     CAUSE: AWS credentials wrong or missing
│     │     FIX: Use --aws-sigv4 flag with correct region
│     │
│     └─── Connection timeout
│           CAUSES:
│           ├─ Domain is down (check cluster health)
│           ├─ Network issue (try from different location)
│           └─ Too many requests (throttling)
│
├─── [D] Cluster status "RED"
│     │
│     GET DETAILS:
│     $ curl "https://ENDPOINT/_cluster/health?pretty" \
│         --aws-sigv4 "aws:amz:ap-northeast-1:es"
│
│     $ curl "https://ENDPOINT/_cat/indices?v" \
│         --aws-sigv4 "aws:amz:ap-northeast-1:es"
│     │
│     COMMON CAUSES:
│     │
│     ├─ Disk space > 85% used
│     │   SOLUTION:
│     │   ├─ Delete old indices
│     │   ├─ Increase EBS volume size
│     │   └─ Enable index lifecycle management
│     │
│     ├─ Shard allocation failed
│     │   SOLUTION:
│     │   $ curl -X POST "https://ENDPOINT/_cluster/reroute?retry_failed"│
│     │
│     └─ Corrupted index
│           SOLUTION:
│           1. Identify bad index (status: red)
│           2. Try to close and reopen:
│              $ curl -X POST "https://ENDPOINT/INDEX_NAME/_close"
│              $ curl -X POST "https://ENDPOINT/INDEX_NAME/_open"
│           3. If still red, delete and recreate index
│
├─── [E] Cluster status "YELLOW"
│     │
│     CAUSE: Usually unassigned replica shards
│     IMPACT: Safe to use, but not optimal
│     │
│     FIX (if single-node cluster):
│     $ curl -X PUT "https://ENDPOINT/_all/_settings" \
│         -H 'Content-Type: application/json' \
│         -d '{"index": {"number_of_replicas": 0}}'
│     │
│     This is NORMAL for single-node dev clusters!
│
└─── [F] Search not returning expected results
      │
      DIAGNOSIS STEPS:
      │
      1. Check index exists:
         $ curl "https://ENDPOINT/_cat/indices?v"

      2. Count documents:
         $ curl "https://ENDPOINT/files/_count"

      3. Sample documents:
         $ curl "https://ENDPOINT/files/_search?size=10"

      4. Test query:
         $ curl "https://ENDPOINT/files/_search" \
             -H 'Content-Type: application/json' \
             -d '{"query": {"match_all": {}}}'
      │
      COMMON ISSUES:
      │
      ├─ No documents in index
      │   → Workers not indexing properly
      │      Check worker logs
      │
      ├─ Documents exist but search returns nothing
      │   → Query syntax wrong
      │      Try simple match_all first
      │
      └─ Results not relevant
          → Mapping might be wrong
             Check index mapping:
             $ curl "https://ENDPOINT/files/_mapping"
```

---

## 💰 Cost Issues Tree

```
START: AWS bill too high
│
├─ CHECK CURRENT COSTS:
│   $ aws ce get-cost-and-usage \
│       --time-period Start=2025-01-01,End=2025-01-31 \
│       --granularity MONTHLY \
│       --metrics BlendedCost \
│       --group-by Type=DIMENSION,Key=SERVICE \
│       --output table
│
├─ WHICH SERVICE IS EXPENSIVE?
│
├─── [A] EC2 ($100+/month)
│     │
│     DIAGNOSIS:
│     $ aws ec2 describe-instances \
│         --filters "Name=instance-state-name,Values=running" \
│         --query 'Reservations[].Instances[].[InstanceId,InstanceType,State.Name]'
│     │
│     CAUSES:
│     │
│     ├─ Too many instances running
│     │   FIX:
│     │   ├─ Check ASG desired capacity is 0 when idle
│     │   ├─ Reduce max instances in ASG (10 → 3)
│     │   └─ Manually terminate unused instances
│     │
│     ├─ Using On-Demand instead of Spot
│     │   FIX:
│     │   └─ Update ASG to 70% Spot, 30% On-Demand
│     │      (See Auto Scaling Guide)
│     │
│     └─ Instance type too large
│           CURRENT: t3.large ($0.0832/hour)
│           RECOMMENDED: t3.medium ($0.0416/hour)
│           SAVINGS: 50%
│
├─── [B] OpenSearch ($150+/month)
│     │
│     DIAGNOSIS:
│     $ aws opensearch describe-domain \
│         --domain-name cis-filesearch-dev \
│         --query 'DomainStatus.{Type:ClusterConfig.InstanceType,Count:ClusterConfig.InstanceCount,Storage:EBSOptions.VolumeSize}'
│     │
│     CAUSES:
│     │
│     ├─ Instance type too large
│     │   CURRENT: r6g.large.search ($0.158/hour = $115/month)
│     │   RECOMMENDED: t3.small.search ($0.036/hour = $26/month)
│     │   SAVINGS: $89/month
│     │
│     ├─ Too many instances
│     │   CURRENT: 3 instances
│     │   RECOMMENDED: 1 instance (for dev)
│     │   SAVINGS: 67%
│     │
│     └─ Oversized EBS volumes
│           CURRENT: 500GB per instance
│           RECOMMENDED: 100GB (resize as needed)
│           SAVINGS: 80%
│
├─── [C] NAT Gateway ($45+/month)
│     │
│     DIAGNOSIS:
│     $ aws ec2 describe-nat-gateways \
│         --filter "Name=state,Values=available"
│     │
│     CAUSE: EC2 instances using NAT for S3/SQS access
│     │
│     FIX: Implement VPC Endpoints!
│     └─→ See Session 7: VPC Endpoints Guide
│          Creates private connection to S3/SQS
│          SAVINGS: $38/month
│
├─── [D] S3 Storage ($50+/month)
│     │
│     DIAGNOSIS:
│     $ aws s3 ls
│     $ aws s3 ls s3://YOUR-BUCKET --recursive --summarize
│     │
│     CAUSES:
│     │
│     ├─ Too much data in Standard storage
│     │   FIX: Implement lifecycle policy
│     │   └─ Move to Intelligent-Tiering after 7 days
│     │      SAVINGS: 35%
│     │
│     ├─ Old test data not deleted
│     │   FIX: Delete test files/folders
│     │   $ aws s3 rm s3://YOUR-BUCKET/test/ --recursive
│     │
│     └─ Versioning enabled with many versions
│           FIX:
│           ├─ Add lifecycle rule to delete old versions
│           └─ Expire non-current versions after 30 days
│
└─── [E] Data Transfer ($20+/month)
      │
      DIAGNOSIS:
      Check CloudWatch metrics for:
      ├─ S3 BytesDownloaded
      ├─ EC2 NetworkOut
      └─ NAT Gateway BytesOut
      │
      CAUSES:
      │
      ├─ Downloading same files repeatedly
      │   FIX: Cache processed files locally on workers
      │
      ├─ Sending data across regions
      │   FIX: Ensure all resources in same region
      │        (ap-northeast-1)
      │
      └─ No VPC endpoints (using NAT)
            FIX: Implement VPC endpoints
                 S3 Gateway Endpoint = FREE
                 Eliminates NAT charges
```

---

## ⚡ Performance Tree

```
START: System is slow
│
├─ WHAT'S SLOW?
│
├─── [A] File upload to S3
│     │
│     CAUSES:
│     ├─ Slow internet connection → Use faster connection
│     ├─ Large file size → Compress before upload
│     └─ Wrong region → Upload to nearest region
│
├─── [B] Auto Scaling taking too long
│     │
│     DIAGNOSIS:
│     $ aws autoscaling describe-scaling-activities \
│         --auto-scaling-group-name cis-file-processor-asg-dev
│     │
│     TYPICAL TIMES:
│     ├─ Spot instance: 30-90 seconds
│     └─ On-Demand instance: 20-60 seconds
│     │
│     IF > 5 MINUTES:
│     ├─ Check for launch failures
│     ├─ User data script too slow → Optimize script
│     └─ AMI wrong region → Use region-specific AMI
│
├─── [C] File processing slow
│     │
│     DIAGNOSIS:
│     1. Check worker logs for processing time
│     2. Check instance CPU/memory usage
│     │
│     CAUSES:
│     │
│     ├─ Instance type underpowered
│     │   CURRENT: t3.medium (2 vCPU, 4GB RAM)
│     │   UPGRADE: t3.large (2 vCPU, 8GB RAM)
│     │   OR: c6i.large (2 vCPU, optimized for compute)
│     │
│     ├─ Processing code inefficient
│     │   FIX:
│     │   ├─ Profile code to find bottlenecks
│     │   ├─ Use async/parallel processing
│     │   └─ Optimize image processing
│     │
│     └─ Too many files per worker
│           SOLUTION: Lower target in scaling policy
│           FROM: 50 messages per instance
│           TO: 20 messages per instance
│           RESULT: More workers launched sooner
│
└─── [D] Search queries slow (> 1 second)
      │
      DIAGNOSIS:
      $ curl "https://ENDPOINT/_cat/indices?v&s=docs.count:desc"
      $ curl "https://ENDPOINT/_nodes/stats/jvm,indices"
      │
      CAUSES:
      │
      ├─ Too many documents in index
      │   IF > 10 million: Consider sharding strategy
      │   IF > 100 million: Upgrade to larger instance
      │
      ├─ Queries not optimized
      │   FIX:
      │   ├─ Use filter instead of query for exact matches
      │   ├─ Add pagination (size + from parameters)
      │   └─ Cache frequent queries
      │
      ├─ Index not optimized
      │   FIX:
      │   $ curl -X POST "https://ENDPOINT/files/_forcemerge"
      │
      └─ Instance type underpowered
            CURRENT: t3.small.search (1GB JVM heap)
            FOR > 1M documents: r6g.large.search (8GB JVM heap)
```

---

## 🔐 IAM/Security Tree

```
START: Permission denied error
│
├─ WHERE IS ERROR OCCURRING?
│
├─── [A] AWS CLI command
│     │
│     ERROR: "An error occurred (AccessDenied)"
│     │
│     DIAGNOSIS:
│     1. Check who you are:
│        $ aws sts get-caller-identity
│
│     2. What are you trying to do?
│        Example: aws s3 ls s3://bucket/
│                 Action: s3:ListBucket
│
│     3. Does your user/role have permission?
│        $ aws iam get-user-policy --user-name YOUR-USER --policy-name POLICY
│        $ aws iam list-attached-user-policies --user-name YOUR-USER
│     │
│     SOLUTION:
│     ├─ Attach policy with required permission
│     └─ Or ask admin to grant access
│
├─── [B] EC2 instance can't access S3
│     │
│     ERROR: "botocore.exceptions.ClientError: An error occurred (403)"
│     │
│     DIAGNOSIS:
│     1. Check instance has IAM role:
│        $ aws ec2 describe-instances --instance-ids i-xxx \
│            --query 'Reservations[0].Instances[0].IamInstanceProfile'
│
│     2. If no role → Attach instance profile
│     3. If has role → Check role policies
│     │
│     SOLUTION:
│     $ aws iam attach-role-policy \
│         --role-name CISFileProcessorRole-dev \
│         --policy-arn arn:aws:iam::ACCOUNT:policy/S3AccessPolicy
│
├─── [C] OpenSearch access denied
│     │
│     ERROR: "AuthorizationException: User: ... is not authorized"
│     │
│     DIAGNOSIS:
│     1. Check domain access policy:
│        $ aws opensearch describe-domain \
│            --domain-name cis-filesearch-dev \
│            --query 'DomainStatus.AccessPolicies'
│
│     2. Verify your IAM role is in allowed principals
│     │
│     SOLUTION:
│     Update access policy to include your IAM role ARN
│
└─── [D] "You are not authorized to perform this operation"
      │
      GENERAL TROUBLESHOOTING:
      │
      1. Identify the action:
         - Error message usually says: "to perform iam:CreateRole"
         - Action needed: iam:CreateRole

      2. Check if you have permission:
         Use IAM Policy Simulator (Console):
         - IAM → Roles/Users → Your identity
         - Tab: Permissions → Simulate policies
         - Test action: iam:CreateRole

      3. If denied:
         - You need that permission attached
         - Ask admin, or attach policy yourself if you can

      4. If allowed but still failing:
         - Check resource-level restrictions
         - Check condition keys (region, IP, MFA, etc.)
         - Check service control policies (SCPs)
```

---

## 🆘 Emergency Procedures

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  CRITICAL ISSUE FLOWCHART                               │
│                                                         │
│  Is it a PRODUCTION OUTAGE?                             │
│  ├─ Yes → CRITICAL PATH                                 │
│  │   1. Page on-call engineer                           │
│  │   2. Check CloudWatch alarms                         │
│  │   3. Check https://status.aws.amazon.com             │
│  │   4. Check recent deployments (rollback?)            │
│  │   5. Enable verbose logging                          │
│  │   6. Document timeline for post-mortem               │
│  │                                                      │
│  └─ No → NORMAL TROUBLESHOOTING                         │
│      1. Use decision trees above                        │
│      2. Check CloudWatch logs                           │
│      3. Try manual test                                 │
│      4. Ask for help if stuck > 2 hours                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

**Document Version**: 1.0
**Last Updated**: 2025-01-18

**Remember**: Most issues are IAM permissions or misconfiguration. Start there! 🔍
