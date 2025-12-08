# AWS Complete Setup Guide - CIS File Search Application

## 📋 Overview

This master guide walks you through setting up the complete AWS infrastructure for the CIS File Search Application from scratch. Follow these steps in order for a successful deployment.

**Estimated total time**: 4-6 hours (spread over multiple sessions)

---

## 🎯 Architecture Diagram

```
Windows Scanner PC (DataSync Agent)
        ↓
    S3 Landing Bucket
        ↓ (auto event)
    EventBridge Rule
        ↓
    SQS Queue (with DLQ)
        ↓ (polling)
    EC2 Auto Scaling Group (Spot Instances)
        ↓
    ┌───────────┴───────────────┐
    ↓                           ↓
OpenSearch Domain         Bedrock Titan
(k-NN enabled)           (Image Embeddings)
```

---

## ✅ Prerequisites Checklist

Before starting, ensure you have:

- [ ] AWS Account with admin access
- [ ] AWS CLI installed and configured
- [ ] `jq` installed (for JSON parsing)
- [ ] Basic understanding of AWS services
- [ ] VPC already created (or use default VPC)
- [ ] SSH key pair for EC2 access (optional)

### Install Required Tools

**AWS CLI:**
```bash
# macOS
brew install awscli

# Linux
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
```

**Configure AWS CLI:**
```bash
aws configure
# Enter: Access Key ID, Secret Access Key, Region (ap-northeast-1), Output (json)
```

**Verify:**
```bash
aws sts get-caller-identity
# Should show your account ID and user/role
```

---

## 📖 Setup Order

Follow guides in this exact order:

| Step | Guide | Time | Prerequisites |
|------|-------|------|---------------|
| 1 | [IAM Roles & Policies](#step-1-iam-roles) | 45min | AWS CLI configured |
| 2 | [S3 Buckets](#step-2-s3-buckets) | 30min | IAM roles created |
| 3 | [SQS Queues](#step-3-sqs-queues) | 30min | None |
| 4 | [OpenSearch Domain](#step-4-opensearch) | 60min | VPC created |
| 5 | [EventBridge Rule](#step-5-eventbridge) | 20min | S3 + SQS created |
| 6 | [Auto Scaling Group](#step-6-auto-scaling) | 60min | IAM + All above |
| 7 | [VPC Endpoints](#step-7-vpc-endpoints) | 30min | VPC + Services created |
| 8 | [CloudWatch](#step-8-cloudwatch) | 30min | All services running |

**Total**: ~5 hours

---

## Step 1: IAM Roles and Policies

**Guide**: `aws-iam-roles-policies-guide.md`

**Time**: 45 minutes

### Quick Setup

```bash
# Navigate to docs directory
cd /Users/tatsuya/focus_project/cis_filesearch_app/docs/deployment

# Set variables
export AWS_REGION="ap-northeast-1"
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Create roles (follow guide step-by-step)
```

### What You'll Create

1. **DataSyncTaskRole**: For scanner PC to upload files
2. **CISFileProcessorRole**: For EC2 workers to process files
3. **Instance Profile**: Links role to EC2 instances

### Verification

```bash
# Verify roles exist
aws iam get-role --role-name DataSyncTaskRole
aws iam get-role --role-name CISFileProcessorRole

# Verify policies attached
aws iam list-attached-role-policies --role-name CISFileProcessorRole

# Expected: 5-6 policies attached
```

**✅ Checkpoint**: Roles created and policies attached

---

## Step 2: S3 Buckets

**Guide**: `aws-s3-configuration-guide.md`

**Time**: 30 minutes

### Quick Setup

```bash
export BUCKET_NAME="cis-filesearch-landing-dev"

# Follow S3 guide to create bucket with:
# - Versioning enabled
# - SSE-S3 encryption
# - Lifecycle policies
# - Block public access
```

### What You'll Create

1. **Landing bucket**: `cis-filesearch-landing-dev`
2. **Lifecycle policy**: Standard → Intelligent-Tiering after 7 days
3. **IAM policies**: DataSync write, Workers read

### Verification

```bash
# Verify bucket exists
aws s3 ls s3://$BUCKET_NAME

# Test upload
echo "Test file" > test.txt
aws s3 cp test.txt s3://$BUCKET_NAME/test/

# Verify encryption
aws s3api head-object \
  --bucket $BUCKET_NAME \
  --key test/test.txt \
  | grep ServerSideEncryption
```

**✅ Checkpoint**: Bucket created, encrypted, policies configured

---

## Step 3: SQS Queues

**Guide**: `aws-sqs-configuration-guide.md`

**Time**: 30 minutes

### Quick Setup

```bash
export QUEUE_NAME="cis-filesearch-queue-dev"
export DLQ_NAME="cis-filesearch-dlq-dev"

# Follow SQS guide to create:
# 1. Main queue
# 2. Dead letter queue
# 3. Redrive policy
```

### What You'll Create

1. **Main queue**: Standard queue with long polling
2. **Dead letter queue**: For failed messages
3. **Redrive policy**: 3 retries before DLQ
4. **IAM policies**: Workers receive/delete

### Verification

```bash
# Get queue URL
export QUEUE_URL=$(aws sqs get-queue-url --queue-name $QUEUE_NAME --query 'QueueUrl' --output text)

# Test send
aws sqs send-message \
  --queue-url $QUEUE_URL \
  --message-body '{"test": true}'

# Test receive
aws sqs receive-message \
  --queue-url $QUEUE_URL \
  --max-number-of-messages 1

# Check DLQ configured
aws sqs get-queue-attributes \
  --queue-url $QUEUE_URL \
  --attribute-names RedrivePolicy
```

**✅ Checkpoint**: Queues created, DLQ configured, messages flow

---

## Step 4: OpenSearch Domain

**Guide**: `aws-opensearch-configuration-guide.md`

**Time**: 60 minutes (includes 20min domain creation wait)

### Quick Setup

```bash
export DOMAIN_NAME="cis-filesearch-dev"
export VPC_ID="vpc-xxxxx"  # Your VPC ID
export SUBNET_ID="subnet-xxxxx"  # Private subnet
export SECURITY_GROUP_ID="sg-xxxxx"  # OpenSearch SG

# Follow OpenSearch guide to create:
# 1. t3.small.search domain
# 2. 100GB GP3 storage
# 3. k-NN plugin enabled
# 4. VPC access
```

### What You'll Create

1. **OpenSearch domain**: Single node, development mode
2. **Index mapping**: Files index with k-NN vector field
3. **Security group**: Allow 443 from EC2 workers
4. **Access policy**: Allow CISFileProcessorRole

### Verification

```bash
# Get endpoint
export OPENSEARCH_ENDPOINT=$(aws opensearch describe-domain \
  --domain-name $DOMAIN_NAME \
  --query 'DomainStatus.Endpoint' \
  --output text)

# Check cluster health
curl -X GET "https://$OPENSEARCH_ENDPOINT/_cluster/health" \
  --aws-sigv4 "aws:amz:$AWS_REGION:es"

# Should return: "status": "green"

# Verify k-NN plugin
curl -X GET "https://$OPENSEARCH_ENDPOINT/_cat/plugins" \
  --aws-sigv4 "aws:amz:$AWS_REGION:es"

# Should show: knn plugin
```

**✅ Checkpoint**: OpenSearch domain active, k-NN enabled, accessible

---

## Step 5: EventBridge Rule

**Guide**: `aws-eventbridge-s3-sqs-guide.md`

**Time**: 20 minutes

### Quick Setup

```bash
export RULE_NAME="cis-s3-to-sqs-dev"

# Follow EventBridge guide to:
# 1. Enable EventBridge on S3 bucket
# 2. Create rule matching S3 events
# 3. Add SQS as target
# 4. Update SQS resource policy
```

### What You'll Create

1. **EventBridge rule**: Matches S3 Object Created events
2. **Event pattern**: Filter by bucket and prefix
3. **Input transformer**: Format message for workers
4. **SQS policy**: Allow EventBridge to send

### Verification

```bash
# Enable EventBridge on bucket
aws s3api put-bucket-notification-configuration \
  --bucket $BUCKET_NAME \
  --notification-configuration '{"EventBridgeConfiguration": {}}'

# Upload test file
echo "EventBridge test" > eb-test.txt
aws s3 cp eb-test.txt s3://$BUCKET_NAME/files/test/

# Wait 5 seconds
sleep 5

# Check SQS for message
aws sqs receive-message \
  --queue-url $QUEUE_URL \
  --max-number-of-messages 1

# Should show message with s3Bucket and s3Key
```

**✅ Checkpoint**: S3 events flow to SQS automatically

---

## Step 6: Auto Scaling Group with Spot Instances

**Guide**: `aws-autoscaling-spot-instances-guide.md`

**Time**: 60 minutes

### Quick Setup

```bash
export LAUNCH_TEMPLATE="cis-file-processor-worker-v1"
export ASG_NAME="cis-file-processor-asg-dev"

# Follow Auto Scaling guide to:
# 1. Create security group for workers
# 2. Create launch template (t3.medium)
# 3. Create Auto Scaling group (0-3 instances)
# 4. Configure Spot instance mix (70/30)
# 5. Set up scaling policy (SQS depth)
```

### What You'll Create

1. **Launch template**: AL2023, t3.medium, user data script
2. **Auto Scaling group**: 0 min, 3 max, 0 desired
3. **Spot configuration**: 70% Spot, 30% On-Demand
4. **Scaling policy**: Target 30 messages per instance
5. **Security group**: Allow HTTPS out, SSH from bastion

### Verification

```bash
# Check ASG created
aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names $ASG_NAME

# Upload 100 test files to trigger scaling
for i in {1..100}; do
  echo "Test $i" > "test-$i.txt"
  aws s3 cp "test-$i.txt" s3://$BUCKET_NAME/files/load-test/ &
done
wait

# Wait 5 minutes for scaling

# Check instances launched
aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names $ASG_NAME \
  --query 'AutoScalingGroups[0].Instances'

# Should show 3 instances launching/running
```

**✅ Checkpoint**: ASG scales up when queue has messages

---

## Step 7: VPC Endpoints (Cost Optimization)

**Guide**: `aws-vpc-endpoints-guide.md`

**Time**: 30 minutes

### Quick Setup

```bash
export VPC_ID="vpc-xxxxx"
export ROUTE_TABLE_ID="rtb-xxxxx"

# Create S3 Gateway Endpoint (FREE)
aws ec2 create-vpc-endpoint \
  --vpc-id $VPC_ID \
  --service-name com.amazonaws.$AWS_REGION.s3 \
  --route-table-ids $ROUTE_TABLE_ID

# Create SQS Interface Endpoint (optional)
aws ec2 create-vpc-endpoint \
  --vpc-id $VPC_ID \
  --vpc-endpoint-type Interface \
  --service-name com.amazonaws.$AWS_REGION.sqs \
  --subnet-ids $SUBNET_ID \
  --security-group-ids $WORKER_SG_ID
```

### What You'll Create

1. **S3 Gateway Endpoint**: Free, saves NAT Gateway costs
2. **SQS Interface Endpoint**: $7/month, better performance
3. **Route table updates**: Route S3 traffic via endpoint

### Cost Savings

**Without VPC endpoints:**
- NAT Gateway data processing: $45/month (1TB)

**With VPC endpoints:**
- S3 Gateway: $0
- SQS Interface: $7/month
- **Savings: $38/month**

**✅ Checkpoint**: VPC endpoints created, costs reduced

---

## Step 8: CloudWatch Monitoring

**Guide**: `aws-cloudwatch-configuration-guide.md`

**Time**: 30 minutes

### Quick Setup

```bash
# Create log groups
aws logs create-log-group --log-group-name /aws/cis-file-processor/dev/workers
aws logs create-log-group --log-group-name /aws/cis-file-processor/dev/application

# Set retention
aws logs put-retention-policy \
  --log-group-name /aws/cis-file-processor/dev/workers \
  --retention-in-days 30

# Create alarms
# (Follow CloudWatch guide for detailed alarm setup)
```

### What You'll Create

1. **Log groups**: Worker logs, application logs
2. **Metrics**: Custom metrics from workers
3. **Alarms**: Queue depth, failed invocations, DLQ messages
4. **Dashboard**: Operational overview

### Verification

```bash
# Verify log groups
aws logs describe-log-groups \
  --log-group-name-prefix /aws/cis-file-processor

# Check metrics
aws cloudwatch list-metrics \
  --namespace CISFileProcessor
```

**✅ Checkpoint**: Logging and monitoring configured

---

## 🧪 End-to-End Testing

### Test 1: Upload and Process Single File

```bash
# 1. Create test PDF
echo "Test PDF content" > test-document.pdf

# 2. Upload to S3
aws s3 cp test-document.pdf s3://$BUCKET_NAME/files/2025/01/

# 3. Verify EventBridge event
sleep 3

# 4. Check SQS message
aws sqs receive-message --queue-url $QUEUE_URL

# 5. Wait for ASG to scale up (3-5 minutes)
watch -n 10 'aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names $ASG_NAME \
  --query "AutoScalingGroups[0].Instances"'

# 6. Check CloudWatch logs
aws logs tail /aws/cis-file-processor/dev/workers --follow

# 7. Verify in OpenSearch
curl -X GET "https://$OPENSEARCH_ENDPOINT/files/_search?q=test-document.pdf" \
  --aws-sigv4 "aws:amz:$AWS_REGION:es"

# Should find document
```

### Test 2: Load Test with 1000 Files

```bash
# Generate 1000 test files
for i in {1..1000}; do
  echo "Load test file $i" > "load-test-$i.txt"
  aws s3 cp "load-test-$i.txt" s3://$BUCKET_NAME/files/load-test/ &

  # Batch uploads in groups of 50
  if [ $((i % 50)) -eq 0 ]; then
    wait
    echo "Uploaded $i files"
  fi
done
wait

# Monitor processing
watch -n 30 'echo "Queue depth:" && \
  aws sqs get-queue-attributes \
    --queue-url $QUEUE_URL \
    --attribute-names ApproximateNumberOfMessages && \
  echo "Instances:" && \
  aws autoscaling describe-auto-scaling-groups \
    --auto-scaling-group-names $ASG_NAME \
    --query "AutoScalingGroups[0].{Desired:DesiredCapacity,Running:length(Instances)}"'

# Should see:
# - Queue grows to ~1000
# - ASG scales to 3 instances
# - Queue drains over 20-30 minutes
# - ASG scales back to 0
```

---

## 📊 Cost Summary

**Monthly costs** (100K files/month):

| Service | Configuration | Cost/Month |
|---------|--------------|------------|
| **S3** | 1TB, Intelligent-Tiering | $15.00 |
| **SQS** | Standard, free tier | $0.00 |
| **OpenSearch** | t3.small.search, 100GB | $48.00 |
| **EC2 Spot** | 556h, t3.medium | $8.78 |
| **EBS** | 3×20GB GP3 | $4.41 |
| **EventBridge** | 100K events, free tier | $0.00 |
| **VPC Endpoints** | S3 Gateway + SQS Interface | $7.55 |
| **CloudWatch** | Logs + Metrics | $2.00 |
| **Data Transfer** | Minimal (VPC endpoints) | $1.00 |
| **Total** | | **$86.74/month** |

**Compare to traditional architecture** (24/7 On-Demand):
- **Traditional**: ~$250/month
- **This architecture**: $86.74/month
- **Savings**: 65%

---

## 🔧 Troubleshooting Common Issues

### Issue: OpenSearch domain stuck "Processing"

**Solution:**
- Wait 30-45 minutes (normal)
- Check VPC subnet has available IPs
- Verify security group allows 443

### Issue: Auto Scaling not launching instances

**Diagnosis:**
```bash
aws autoscaling describe-scaling-activities \
  --auto-scaling-group-name $ASG_NAME \
  --max-records 5
```

**Common causes:**
- Insufficient Spot capacity → Add more instance types
- IAM role missing → Verify CISFileProcessorRole attached
- User data script errors → Check CloudWatch logs

### Issue: EventBridge events not reaching SQS

**Diagnosis:**
```bash
# Check EventBridge enabled on bucket
aws s3api get-bucket-notification-configuration --bucket $BUCKET_NAME

# Check rule exists
aws events describe-rule --name $RULE_NAME

# Check SQS policy
aws sqs get-queue-attributes --queue-url $QUEUE_URL --attribute-names Policy
```

**Solution:**
- Enable EventBridge on bucket
- Update SQS resource policy
- Verify event pattern matches

---

## 📚 Documentation Reference

All detailed guides are in `/docs/deployment/`:

1. `aws-iam-roles-policies-guide.md` - Complete IAM setup
2. `aws-s3-configuration-guide.md` - S3 buckets and lifecycle
3. `aws-sqs-configuration-guide.md` - SQS queues and DLQ
4. `aws-opensearch-configuration-guide.md` - OpenSearch with k-NN
5. `aws-eventbridge-s3-sqs-guide.md` - Event routing
6. `aws-autoscaling-spot-instances-guide.md` - Auto Scaling Group
7. `aws-vpc-endpoints-guide.md` - VPC endpoints for cost savings
8. `aws-cloudwatch-configuration-guide.md` - Monitoring and alarms

---

## ✅ Final Checklist

Use this to verify complete setup:

### Infrastructure
- [ ] VPC with private subnets created
- [ ] IAM roles and policies configured
- [ ] S3 bucket with encryption and lifecycle
- [ ] SQS queue with DLQ configured
- [ ] OpenSearch domain active (green status)
- [ ] EventBridge rule routing S3 to SQS
- [ ] Auto Scaling Group with Spot instances
- [ ] VPC endpoints for S3 and SQS
- [ ] CloudWatch logging and alarms

### Testing
- [ ] Single file upload → processing works
- [ ] Load test with 100 files successful
- [ ] Auto Scaling scales up and down correctly
- [ ] Dead letter queue handling works
- [ ] OpenSearch indexing successful
- [ ] CloudWatch logs show worker activity
- [ ] Cost within expected range

### Security
- [ ] All resources use encryption at rest
- [ ] IAM policies follow least privilege
- [ ] Security groups restrict access properly
- [ ] VPC access for OpenSearch (not public)
- [ ] CloudTrail logging enabled
- [ ] No public S3 buckets

### Monitoring
- [ ] CloudWatch dashboard created
- [ ] Alarms configured for critical metrics
- [ ] Log retention policies set
- [ ] SNS notifications configured
- [ ] Cost alerts enabled

---

## 🎓 Learning Resources

- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [OpenSearch Documentation](https://opensearch.org/docs/latest/)
- [Auto Scaling Best Practices](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-best-practices.html)
- [Spot Instance Best Practices](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-best-practices.html)

---

## 📞 Support

If you encounter issues:

1. **Check troubleshooting sections** in individual guides
2. **Review CloudWatch logs** for error messages
3. **Use AWS Support** (if you have a support plan)
4. **Consult AWS Forums** and Stack Overflow
5. **Update documentation** with solutions you discover

---

**Congratulations!** 🎉

You've successfully set up a production-ready, cost-optimized AWS infrastructure for the CIS File Search Application!

**Next steps:**
1. Deploy worker application code
2. Set up monitoring dashboard
3. Run production file scan
4. Optimize based on metrics

---

**Document Version**: 1.0
**Last Updated**: 2025-01-18
**Author**: CIS Development Team
