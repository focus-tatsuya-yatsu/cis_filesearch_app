# 🚀 EMERGENCY DEPLOYMENT - EXECUTABLE CHECKLIST

**Deployment Date**: 2025-12-12
**Start Time**: _______ JST
**Deployer**: Tatsuya

---

## ⏱️ TIMELINE OVERVIEW

| Phase | Duration | Critical? |
|-------|----------|-----------|
| Pre-Deployment | 5 min | YES |
| Canary Deployment | 10 min | YES |
| Full Deployment | 15 min | NO (can pause) |
| Verification | 10 min | YES |
| **TOTAL** | **40 min** | - |

---

## 📋 STEP-BY-STEP EXECUTION

### ✅ PHASE 1: PRE-DEPLOYMENT (5 minutes)

#### Step 1.1: AWS Authentication
```bash
# Login to AWS SSO
aws sso login --profile your-profile

# Verify access
aws sts get-caller-identity
```
- [ ] **CHECKPOINT**: AWS identity returned successfully

#### Step 1.2: Capture Baseline Metrics
```bash
# Set variables
export AWS_REGION=ap-northeast-1
export SQS_QUEUE_NAME=file-processing-queue-production

# Get queue URL
export QUEUE_URL=$(aws sqs get-queue-url \
  --queue-name $SQS_QUEUE_NAME \
  --region $AWS_REGION \
  --output text)

echo "Queue URL: $QUEUE_URL"

# Check current SQS depth
aws sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages \
  --region $AWS_REGION \
  --query 'Attributes.ApproximateNumberOfMessages'
```
- [ ] **RECORD**: SQS Messages = _______________
- [ ] **RECORD**: DLQ Messages = _______________
- [ ] **CHECKPOINT**: Metrics captured

#### Step 1.3: Verify S3 Event Notifications
```bash
# Check for duplicate notifications
aws s3api get-bucket-notification-configuration \
  --bucket cis-filesearch-storage-production \
  --region $AWS_REGION | jq '.QueueConfigurations | length'
```
- [ ] **EXPECTED**: 1 (single configuration)
- [ ] **IF >1**: STOP and fix duplicates (see deployment plan)
- [ ] **CHECKPOINT**: No duplicate notifications

#### Step 1.4: List EC2 Instances
```bash
# List running worker instances
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=cis-file-processor" "Name=instance-state-name,Values=running" \
  --region $AWS_REGION \
  --query 'Reservations[*].Instances[*].[InstanceId,PrivateIpAddress]' \
  --output table
```
- [ ] **RECORD**: Number of instances = _______________
- [ ] **CHECKPOINT**: All instances identified

---

### ✅ PHASE 2: CANARY DEPLOYMENT (10 minutes)

#### Step 2.1: Select Canary Instance
```bash
# Get first instance
export CANARY_INSTANCE=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=cis-file-processor" "Name=instance-state-name,Values=running" \
  --region $AWS_REGION \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)

# Get canary IP
export CANARY_IP=$(aws ec2 describe-instances \
  --instance-ids $CANARY_INSTANCE \
  --region $AWS_REGION \
  --query 'Reservations[0].Instances[0].PrivateIpAddress' \
  --output text)

echo "Canary Instance: $CANARY_INSTANCE"
echo "Canary IP: $CANARY_IP"
```
- [ ] **RECORD**: Canary Instance = _______________
- [ ] **CHECKPOINT**: Canary selected

#### Step 2.2: Deploy to Canary
```bash
# SSH to canary (replace with your SSH method)
ssh ec2-user@$CANARY_IP

# On EC2 instance:
cd /opt/file-processor  # Adjust path to your worker directory

# Download and run deployment script
# OR manually copy worker_fixed.py

# Run deployment
sudo bash apply_emergency_fix.sh
```
- [ ] **CHECKPOINT**: Deployment script completed
- [ ] **RECORD**: Backup file name = _______________

#### Step 2.3: Restart Canary Service
```bash
# On EC2 instance:
sudo systemctl restart file-processor

# Check status
sudo systemctl status file-processor
```
- [ ] **CHECKPOINT**: Service started successfully

#### Step 2.4: Monitor Canary (5 minutes)
```bash
# On EC2 instance:
sudo journalctl -u file-processor -f
```

**Look for**:
- ✅ "Worker initialized successfully"
- ✅ "Message <id> processed successfully"
- ✅ "Message <id> deleted from queue"
- ❌ NO errors or crashes

- [ ] **CHECKPOINT**: Canary healthy (5 min monitoring)
- [ ] **GO/NO-GO**: Continue to full deployment? YES / NO

**IF NO-GO**: Execute rollback (see section below)

---

### ✅ PHASE 3: FULL DEPLOYMENT (15 minutes)

#### Step 3.1: Deploy to Remaining Instances

**Option A: Manual Deployment** (2-5 instances)
```bash
# For each remaining instance, repeat:

# 1. SSH to instance
ssh ec2-user@<INSTANCE_IP>

# 2. Navigate to worker directory
cd /opt/file-processor

# 3. Run deployment
sudo bash apply_emergency_fix.sh

# 4. Restart service
sudo systemctl restart file-processor

# 5. Verify
sudo systemctl status file-processor
sudo journalctl -u file-processor --since '1 minute ago'

# 6. Wait 2 minutes before next instance
sleep 120
```

- [ ] **Instance 2**: Deployed & verified
- [ ] **Instance 3**: Deployed & verified
- [ ] **Instance 4**: Deployed & verified
- [ ] **Instance 5**: Deployed & verified
- [ ] **CHECKPOINT**: All instances deployed

**Option B: Auto Scaling Group** (if managed by ASG)
```bash
# Create AMI from canary
export NEW_AMI=$(aws ec2 create-image \
  --instance-id $CANARY_INSTANCE \
  --name "cis-file-processor-fixed-$(date +%Y%m%d-%H%M%S)" \
  --description "Emergency SQS fix" \
  --region $AWS_REGION \
  --output text)

echo "New AMI: $NEW_AMI"

# Wait for AMI
aws ec2 wait image-available --image-ids $NEW_AMI --region $AWS_REGION

# Update launch template
aws ec2 create-launch-template-version \
  --launch-template-name cis-file-processor-template \
  --source-version 1 \
  --launch-template-data "{\"ImageId\":\"$NEW_AMI\"}" \
  --region $AWS_REGION

# Set as default
aws ec2 modify-launch-template \
  --launch-template-name cis-file-processor-template \
  --default-version '$Latest' \
  --region $AWS_REGION

# Terminate old instances one by one (ASG will launch new ones)
```

- [ ] **CHECKPOINT**: ASG updated with new AMI

#### Step 3.2: Update SQS Visibility Timeout
```bash
# Update timeout to 15 minutes
aws sqs set-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attributes VisibilityTimeout=900 \
  --region $AWS_REGION

# Verify
aws sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names VisibilityTimeout \
  --region $AWS_REGION \
  --query 'Attributes.VisibilityTimeout'
```
- [ ] **EXPECTED**: 900
- [ ] **CHECKPOINT**: Visibility timeout updated

---

### ✅ PHASE 4: VERIFICATION (10 minutes)

#### Step 4.1: Check All Workers
```bash
# Verify all instances running
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=cis-file-processor" "Name=instance-state-name,Values=running" \
  --region $AWS_REGION \
  --query 'Reservations[*].Instances[*].[InstanceId,State.Name]' \
  --output table
```
- [ ] **CHECKPOINT**: All workers running

#### Step 4.2: Monitor SQS Queue (10 minutes)
```bash
# Watch queue depth (should decrease)
watch -n 60 'aws sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages \
  --region $AWS_REGION \
  --query "Attributes.ApproximateNumberOfMessages"'
```
- [ ] **RECORD**: T+0min: _______ messages
- [ ] **RECORD**: T+5min: _______ messages
- [ ] **RECORD**: T+10min: _______ messages
- [ ] **CHECKPOINT**: Queue depth decreasing

#### Step 4.3: Check DLQ
```bash
# Get DLQ URL
export DLQ_QUEUE_NAME=$(echo $SQS_QUEUE_NAME | sed 's/queue/dlq/')
export DLQ_URL=$(aws sqs get-queue-url \
  --queue-name $DLQ_QUEUE_NAME \
  --region $AWS_REGION \
  --output text)

# Check DLQ depth
aws sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names ApproximateNumberOfMessages \
  --region $AWS_REGION \
  --query 'Attributes.ApproximateNumberOfMessages'
```
- [ ] **RECORD**: DLQ Messages = _______________
- [ ] **CHECKPOINT**: DLQ not growing exponentially

#### Step 4.4: Check CloudWatch Metrics
```bash
# Check for deletion failures
aws cloudwatch get-metric-statistics \
  --namespace CISFileSearch/Worker \
  --metric-name MessageDeleteFailed \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum \
  --region $AWS_REGION
```
- [ ] **EXPECTED**: 0 (no deletion failures)
- [ ] **CHECKPOINT**: No custom error metrics

---

## ✅ SUCCESS CRITERIA

### Immediate Success (10 minutes after deployment)
- [ ] All workers running
- [ ] SQS messages decreasing
- [ ] No messages reappearing
- [ ] DLQ stable (not exponentially growing)
- [ ] No worker errors in logs

### 1-Hour Success
- [ ] SQS queue depth reduced by >50%
- [ ] Processing throughput >50 files/hour
- [ ] No infinite loop behavior

### 24-Hour Success (Emergency Resolved)
- [ ] SQS queue depth <10 messages
- [ ] DLQ reviewed and cleared
- [ ] Client file uploads working
- [ ] Indexing lag <5 minutes

---

## 🔄 ROLLBACK PROCEDURE

### When to Rollback
- ❌ Worker crashes after deployment
- ❌ Messages not being deleted
- ❌ SQS queue depth increasing
- ❌ Errors in logs

### How to Rollback
```bash
# On each EC2 instance:
ssh ec2-user@<INSTANCE_IP>

# Restore backup
cd /opt/file-processor
sudo cp worker.py.backup.* worker.py

# Restart service
sudo systemctl restart file-processor

# Verify
sudo systemctl status file-processor
```

- [ ] **ROLLBACK EXECUTED**: YES / NO
- [ ] **REASON**: ___________________________

---

## 📞 COMMUNICATION

### Before Deployment
```
To: Client PM, Tech Lead
Subject: [緊急] ファイル検索システム修正適用開始

本日 __:__ より緊急修正を適用します。
想定時間: 40分
影響: なし (ダウンタイムなし)
```

### After Successful Deployment
```
To: Client PM, Tech Lead
Subject: [完了] ファイル検索システム修正適用完了

修正適用が完了しました。
全Workerインスタンス: 正常稼働中
今後24時間監視を継続します。
```

- [ ] **Pre-deployment notification sent**
- [ ] **Post-deployment notification sent**

---

## 📝 DEPLOYMENT LOG

### Deployment Details
- **Date**: 2025-12-12
- **Start Time**: _______ JST
- **End Time**: _______ JST
- **Duration**: _______ minutes
- **Deployer**: Tatsuya
- **Instances Deployed**: _______
- **Rollback Required**: YES / NO

### Metrics Comparison

| Metric | Before | After 10min | After 1hr | After 24hr |
|--------|--------|-------------|-----------|------------|
| SQS Messages | _____ | _____ | _____ | _____ |
| DLQ Messages | _____ | _____ | _____ | _____ |
| Worker Instances | _____ | _____ | _____ | _____ |
| Processing Rate | _____ | _____ | _____ | _____ |

### Issues Encountered
1. _____________________________________
2. _____________________________________
3. _____________________________________

### Lessons Learned
1. _____________________________________
2. _____________________________________
3. _____________________________________

---

## ✅ FINAL SIGN-OFF

### Deployment Completion
- [ ] All phases completed successfully
- [ ] Success criteria met
- [ ] Monitoring in place
- [ ] Stakeholders notified

**Signed**: ___________________
**Date**: _____________________
**Time**: _____________________

---

## 📚 NEXT STEPS

### Immediate (24 hours)
- [ ] Monitor continuously
- [ ] Review DLQ messages
- [ ] Create incident report

### Short-term (1 week)
- [ ] DLQ cleanup
- [ ] Performance tuning
- [ ] Cost analysis
- [ ] Post-mortem meeting

### Long-term (1 month)
- [ ] Lambda API migration planning
- [ ] Phase 2 features implementation
- [ ] Automated testing
- [ ] Monitoring dashboard

---

**Document Version**: 1.0
**Created**: 2025-12-12 17:20 JST
**Last Updated**: 2025-12-12 17:20 JST
