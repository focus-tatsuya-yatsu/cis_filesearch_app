# 🚨 EMERGENCY DEPLOYMENT PLAN - SQS/DLQ Infinite Loop Fix

**Created**: 2025-12-12 17:20 JST
**Severity**: HIGH - Production Impact
**Estimated Duration**: 30-45 minutes
**Deployment Strategy**: Canary → Rolling Update

---

## 📊 PRE-DEPLOYMENT STATUS

### ✅ Ready Components
- [x] Root cause identified (message deletion bug in worker.py)
- [x] Fix implemented (worker_fixed.py with guaranteed deletion)
- [x] Deployment script prepared (apply_emergency_fix.sh)
- [x] Documentation created

### ⚠️ Blockers
- [ ] **AWS SSO Authentication** - Token expired, requires re-login

### 📈 Current Production State
- **SQS Messages**: Unknown (requires AWS access)
- **DLQ Messages**: Unknown (requires AWS access)
- **EC2 Workers**: Unknown state
- **Impact**: File uploads failing, indexing broken

---

## 🎯 DEPLOYMENT SEQUENCE

### Phase 1: Pre-Deployment (5 minutes)

#### 1.1 AWS Authentication
```bash
# Re-authenticate with AWS SSO
aws sso login --profile your-profile

# Verify access
aws sts get-caller-identity
```

**Success Criteria**: AWS CLI returns valid identity

#### 1.2 Environment Assessment
```bash
# Check SQS queue depth
aws sqs get-queue-attributes \
  --queue-url <QUEUE_URL> \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-northeast-1 \
  --query 'Attributes.ApproximateNumberOfMessages'

# Check DLQ depth
aws sqs get-queue-attributes \
  --queue-url <DLQ_URL> \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-northeast-1 \
  --query 'Attributes.ApproximateNumberOfMessages'

# List running EC2 instances
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=cis-file-processor" \
  --region ap-northeast-1 \
  --query 'Reservations[*].Instances[*].[InstanceId,State.Name,PrivateIpAddress]' \
  --output table
```

**Success Criteria**: All metrics captured for baseline

#### 1.3 S3 Event Notification Check
```bash
# Verify no duplicate S3 Event Notifications
aws s3api get-bucket-notification-configuration \
  --bucket cis-filesearch-storage-production \
  --region ap-northeast-1 | jq '.QueueConfigurations | length'
```

**Expected**: 1 configuration (if >1, CRITICAL ISSUE - see remediation below)

**Remediation for Duplicate Notifications**:
```bash
# Backup current config
aws s3api get-bucket-notification-configuration \
  --bucket cis-filesearch-storage-production \
  --region ap-northeast-1 > s3-notification-backup.json

# Remove all notifications
aws s3api put-bucket-notification-configuration \
  --bucket cis-filesearch-storage-production \
  --notification-configuration '{"QueueConfigurations":[]}' \
  --region ap-northeast-1

# Re-apply single correct configuration
# (Create s3-notification-corrected.json with single config)
aws s3api put-bucket-notification-configuration \
  --bucket cis-filesearch-storage-production \
  --notification-configuration file://s3-notification-corrected.json \
  --region ap-northeast-1
```

---

### Phase 2: Canary Deployment (10 minutes)

**Strategy**: Deploy to 1 EC2 instance first, monitor for issues

#### 2.1 Select Canary Instance
```bash
# Get first instance ID
CANARY_INSTANCE=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=cis-file-processor" "Name=instance-state-name,Values=running" \
  --region ap-northeast-1 \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text)

echo "Canary Instance: $CANARY_INSTANCE"
```

#### 2.2 Deploy Fix to Canary
```bash
# SSH into canary instance
ssh ec2-user@<CANARY_IP>

# Navigate to worker directory
cd /opt/file-processor  # Adjust path as needed

# Run deployment script
sudo bash /path/to/apply_emergency_fix.sh
```

**Manual Steps on EC2**:
1. Backup current worker.py
2. Copy worker_fixed.py → worker.py
3. Restart service: `sudo systemctl restart file-processor`

#### 2.3 Monitor Canary (5 minutes)
```bash
# Watch logs for errors
sudo journalctl -u file-processor -f

# Check for successful message processing
# Expected: "Message <id> deleted from queue" logs
```

**Success Criteria**:
- ✅ Worker starts without errors
- ✅ Messages are processed
- ✅ Messages are deleted from queue
- ✅ Failed messages sent to DLQ
- ✅ No infinite loop behavior

**Rollback Trigger**:
- ❌ Worker crashes on startup
- ❌ Messages not being deleted
- ❌ Errors in processing

---

### Phase 3: Full Deployment (15 minutes)

#### 3.1 Update Remaining Instances

**Option A: Manual Rolling Update** (if 2-5 instances)
```bash
# For each remaining instance:
for INSTANCE_ID in <INSTANCE_IDS>; do
  echo "Deploying to $INSTANCE_ID"

  # SSH and deploy
  ssh ec2-user@<INSTANCE_IP> "cd /opt/file-processor && sudo bash /path/to/apply_emergency_fix.sh"

  # Restart service
  ssh ec2-user@<INSTANCE_IP> "sudo systemctl restart file-processor"

  # Wait 2 minutes and verify
  sleep 120

  # Check logs
  ssh ec2-user@<INSTANCE_IP> "sudo journalctl -u file-processor --since '2 minutes ago' | grep -i error"
done
```

**Option B: Auto Scaling Group Update** (if managed by ASG)
```bash
# Create new AMI from canary instance
NEW_AMI=$(aws ec2 create-image \
  --instance-id $CANARY_INSTANCE \
  --name "cis-file-processor-fixed-$(date +%Y%m%d-%H%M%S)" \
  --description "Emergency fix for SQS infinite loop" \
  --region ap-northeast-1 \
  --output text)

echo "New AMI: $NEW_AMI"

# Wait for AMI to be available
aws ec2 wait image-available --image-ids $NEW_AMI --region ap-northeast-1

# Update Launch Template
aws ec2 create-launch-template-version \
  --launch-template-name cis-file-processor-template \
  --source-version 1 \
  --launch-template-data "{\"ImageId\":\"$NEW_AMI\"}" \
  --region ap-northeast-1

# Set as default version
aws ec2 modify-launch-template \
  --launch-template-name cis-file-processor-template \
  --default-version '$Latest' \
  --region ap-northeast-1

# Perform rolling update (terminate instances one by one)
# ASG will launch new instances with fixed AMI
```

#### 3.2 Update SQS Visibility Timeout
```bash
# Get queue URL
QUEUE_URL=$(aws sqs get-queue-url \
  --queue-name file-processing-queue-production \
  --region ap-northeast-1 \
  --output text)

# Update visibility timeout to 900 seconds (15 minutes)
aws sqs set-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attributes VisibilityTimeout=900 \
  --region ap-northeast-1

# Verify
aws sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names VisibilityTimeout \
  --region ap-northeast-1 \
  --query 'Attributes.VisibilityTimeout'
```

**Expected**: 900

---

### Phase 4: Verification & Monitoring (10 minutes)

#### 4.1 Immediate Verification (First 10 minutes)
```bash
# Check all workers are running
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=cis-file-processor" "Name=instance-state-name,Values=running" \
  --region ap-northeast-1 \
  --query 'Reservations[*].Instances[*].[InstanceId,State.Name]' \
  --output table

# Monitor SQS queue depth (should be decreasing)
watch -n 60 'aws sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-northeast-1 \
  --query "Attributes.ApproximateNumberOfMessages"'

# Check DLQ (failed messages should go here, not loop)
aws sqs get-queue-attributes \
  --queue-url <DLQ_URL> \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-northeast-1 \
  --query 'Attributes.ApproximateNumberOfMessages'
```

**Success Criteria**:
- ✅ SQS message count decreasing over time
- ✅ DLQ receiving failed messages (if any)
- ✅ No messages stuck in infinite loop
- ✅ All workers processing successfully

#### 4.2 CloudWatch Metrics Check
```bash
# Check for MessageDeleteFailed custom metric
aws cloudwatch get-metric-statistics \
  --namespace CISFileSearch/Worker \
  --metric-name MessageDeleteFailed \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum \
  --region ap-northeast-1
```

**Expected**: 0 (no deletion failures)

---

## 📊 SUCCESS METRICS

### 1-Hour Metrics
- [ ] SQS queue depth reduced by >50%
- [ ] No messages reappearing in queue
- [ ] DLQ stable (not increasing exponentially)
- [ ] All workers healthy
- [ ] No "MessageDeleteFailed" metrics

### 6-Hour Metrics
- [ ] SQS queue depth <100 messages
- [ ] Processing throughput >100 files/hour
- [ ] Success rate >95%
- [ ] No worker crashes

### 24-Hour Metrics (Emergency Resolved)
- [ ] SQS queue depth <10 messages (steady state)
- [ ] DLQ reviewed and cleared (after manual review)
- [ ] No infinite loop incidents
- [ ] Client file uploads working
- [ ] Indexing lag <5 minutes

---

## 🔄 ROLLBACK PLAN

### Scenario 1: Fix Doesn't Work (Messages still looping)

**Trigger**: SQS messages not decreasing after 30 minutes

**Action**:
```bash
# 1. Restore backup
ssh ec2-user@<INSTANCE> "cd /opt/file-processor && sudo cp worker.py.backup.* worker.py"

# 2. Restart service
ssh ec2-user@<INSTANCE> "sudo systemctl restart file-processor"

# 3. Investigate further
# - Check CloudWatch logs
# - Review SQS message attributes
# - Verify DLQ configuration
```

### Scenario 2: Worker Crashes on Startup

**Trigger**: Worker fails to start after deployment

**Action**:
```bash
# 1. Check logs
sudo journalctl -u file-processor --since '5 minutes ago'

# 2. Rollback immediately
sudo cp worker.py.backup.* worker.py
sudo systemctl restart file-processor

# 3. Review error
# - Python syntax error?
# - Missing dependency?
# - Configuration issue?
```

### Scenario 3: Partial Deployment Failure

**Trigger**: Some instances work, others don't

**Action**:
1. **Freeze deployment** - Don't deploy to remaining instances
2. **Investigate discrepancy** - Compare working vs. failing instances
3. **Rollback failed instances** - Restore to previous state
4. **Root cause analysis** - Why did some fail?

---

## 🚨 RISK ASSESSMENT

### HIGH RISKS

#### Risk 1: Deployment Script Fails
- **Probability**: LOW
- **Impact**: MEDIUM
- **Mitigation**: Manual deployment fallback (copy files manually)
- **Detection**: Script error output

#### Risk 2: Workers Can't Delete Messages
- **Probability**: LOW
- **Impact**: HIGH (infinite loop continues)
- **Mitigation**: Immediate rollback + manual queue purge
- **Detection**: CloudWatch metric "MessageDeleteFailed"

#### Risk 3: DLQ Fills Up
- **Probability**: MEDIUM
- **Impact**: MEDIUM (legitimate failures)
- **Mitigation**: Review DLQ messages, fix root causes
- **Detection**: DLQ depth monitoring

### MEDIUM RISKS

#### Risk 4: S3 Event Notifications Still Duplicated
- **Probability**: MEDIUM (if not fixed in Phase 1)
- **Impact**: HIGH (messages still multiply)
- **Mitigation**: Remove duplicate notifications (see Phase 1.3)
- **Detection**: S3 notification count check

#### Risk 5: Increased Processing Time
- **Probability**: LOW
- **Impact**: LOW
- **Mitigation**: Monitor CloudWatch, adjust worker count
- **Detection**: Throughput metrics

---

## 📞 COMMUNICATION PLAN

### Stakeholder Notifications

#### Before Deployment (5 minutes before)
**To**: Client Project Manager, Technical Lead
**Message**:
```
件名: [緊急] ファイル検索システム修正適用のお知らせ

お世話になっております。

本日17:30より、ファイル検索システムのSQS処理に関する
緊急修正を適用いたします。

【作業内容】
- SQS無限ループバグの修正
- 想定作業時間: 30-45分
- サービス影響: なし (ダウンタイムなし)

【期待される効果】
- ファイルアップロードの処理遅延解消
- インデックス処理の正常化

作業完了後、改めてご報告いたします。

よろしくお願いいたします。
```

#### After Phase 2 (Canary Success)
**To**: Technical Lead
**Message**:
```
件名: [進捗] Canary deployment成功

Canary instance (1台) への修正適用が完了しました。
10分間の監視結果: 正常動作確認

これより残りのインスタンスへの展開を開始します。
```

#### After Phase 3 (Full Deployment)
**To**: Client Project Manager, Technical Lead
**Message**:
```
件名: [完了] ファイル検索システム修正適用完了

修正適用が完了しました。

【結果】
- 全Workerインスタンス: 正常稼働中
- SQSメッセージ処理: 正常化
- ファイルアップロード: 処理再開

【監視継続】
今後24時間、システム動作を監視いたします。
問題が発生した場合は即座に対応いたします。

ご協力ありがとうございました。
```

#### If Issues Occur
**To**: Client Project Manager, Technical Lead
**Escalation**: CTO (if critical)
**Message**:
```
件名: [緊急] 修正適用中の問題発生

修正適用中に問題が発生しました。

【状況】
- 問題内容: <詳細>
- 影響範囲: <範囲>
- 現在の対応: <対応内容>

【次のアクション】
- <アクション1>
- <アクション2>

引き続き状況を監視し、30分後に再度ご報告いたします。
```

---

## ✅ POST-DEPLOYMENT TASKS

### Immediate (Within 1 hour)
- [ ] Verify all workers processing successfully
- [ ] Confirm SQS queue depth decreasing
- [ ] Review DLQ messages (if any)
- [ ] Update deployment log
- [ ] Create incident report

### Short-term (24-48 hours)
- [ ] Monitor for 24 hours continuously
- [ ] Review CloudWatch logs for anomalies
- [ ] Analyze DLQ messages and fix root causes
- [ ] Update documentation with learnings
- [ ] Create CloudWatch alarms for future detection

### Medium-term (1 week)
- [ ] **S3 Event Notification Audit** - Ensure no duplicates
- [ ] **DLQ Cleanup** - Review and reprocess/delete DLQ messages
- [ ] **Performance Tuning** - Optimize worker configuration
- [ ] **Cost Analysis** - Check AWS costs (SQS, EC2, S3)
- [ ] **Post-mortem Meeting** - Discuss root cause and prevention

### Long-term (1 month)
- [ ] **Lambda API Migration** - Replace EC2 workers with Lambda
  - Eliminates infinite loop risk (Lambda auto-handles failures)
  - Reduces costs (pay-per-execution)
  - Improves scalability
- [ ] **Implement Phase 2 Features**:
  - [ ] Image similarity search
  - [ ] Hierarchical filters
  - [ ] Advanced search operators
- [ ] **Automated Testing** - Add integration tests for SQS processing
- [ ] **Monitoring Dashboard** - Create real-time monitoring dashboard

---

## 📝 DECISION LOG

### Key Decisions Made

#### Decision 1: Canary Deployment Strategy
- **Rationale**: Minimize risk by testing on 1 instance first
- **Alternative**: Deploy to all instances at once (faster but riskier)
- **Approved by**: [Your Name]
- **Date**: 2025-12-12

#### Decision 2: SQS Visibility Timeout 900s
- **Rationale**: Large files take 10-15 minutes to process
- **Alternative**: Keep at 300s (risk of premature timeout)
- **Approved by**: [Your Name]
- **Date**: 2025-12-12

#### Decision 3: Explicit DLQ Handling
- **Rationale**: Prevent infinite loops by explicitly sending failed messages to DLQ
- **Alternative**: Rely on SQS auto-DLQ (unreliable due to deletion bug)
- **Approved by**: [Your Name]
- **Date**: 2025-12-12

---

## 🎯 DEPLOYMENT CHECKLIST

### Pre-Deployment
- [ ] AWS SSO authentication successful
- [ ] Deployment script tested locally
- [ ] Backup plan confirmed
- [ ] Stakeholders notified
- [ ] Current metrics captured

### Phase 1: Pre-Deployment
- [ ] SQS queue depth checked
- [ ] DLQ depth checked
- [ ] EC2 instances listed
- [ ] S3 Event Notification verified (no duplicates)

### Phase 2: Canary
- [ ] Canary instance selected
- [ ] Fix deployed to canary
- [ ] Service restarted
- [ ] Logs monitored (5 minutes)
- [ ] No errors detected

### Phase 3: Full Deployment
- [ ] Fix deployed to all instances
- [ ] SQS Visibility Timeout updated
- [ ] All services restarted
- [ ] All workers verified running

### Phase 4: Verification
- [ ] SQS queue depth decreasing
- [ ] DLQ stable
- [ ] No infinite loop behavior
- [ ] CloudWatch metrics normal
- [ ] Stakeholders notified of completion

### Post-Deployment
- [ ] 1-hour success metrics met
- [ ] 6-hour success metrics met
- [ ] 24-hour success metrics met
- [ ] Emergency declared resolved
- [ ] Post-mortem scheduled

---

## 📌 QUICK REFERENCE

### Critical Commands

```bash
# AWS SSO Login
aws sso login --profile your-profile

# Check SQS Queue
aws sqs get-queue-attributes \
  --queue-url <QUEUE_URL> \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-northeast-1

# Deploy Fix
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker
chmod +x scripts/apply_emergency_fix.sh
./scripts/apply_emergency_fix.sh

# Monitor Logs (on EC2)
sudo journalctl -u file-processor -f

# Rollback (on EC2)
sudo cp worker.py.backup.* worker.py
sudo systemctl restart file-processor
```

### Key Files

- **Fix**: `/backend/python-worker/worker_fixed.py`
- **Deployment Script**: `/backend/python-worker/scripts/apply_emergency_fix.sh`
- **Root Cause Analysis**: `/backend/python-worker/docs/SQS_EMERGENCY_ROOT_CAUSE_ANALYSIS.md`
- **This Plan**: `/backend/python-worker/docs/EMERGENCY_DEPLOYMENT_PLAN.md`

### Key Metrics

- **SQS Queue URL**: Get from AWS Console or CLI
- **DLQ URL**: Get from AWS Console or CLI
- **Target Visibility Timeout**: 900 seconds
- **Success Rate Target**: >95%
- **Throughput Target**: >100 files/hour

---

## 🔚 DEPLOYMENT SIGN-OFF

### Pre-Deployment Approval
- [ ] Deployment plan reviewed
- [ ] Risks assessed and accepted
- [ ] Rollback plan confirmed
- [ ] Stakeholders notified

**Approved by**: ___________________
**Date**: 2025-12-12
**Time**: _______

### Post-Deployment Confirmation
- [ ] Deployment successful
- [ ] All verification checks passed
- [ ] No rollback required
- [ ] Monitoring in place

**Confirmed by**: ___________________
**Date**: _______
**Time**: _______

---

**Document Version**: 1.0
**Last Updated**: 2025-12-12 17:20 JST
**Owner**: Tatsuya (Product Manager)
**Next Review**: After 24-hour monitoring period
