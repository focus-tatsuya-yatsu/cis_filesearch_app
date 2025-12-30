# 🚨 EMERGENCY DEPLOYMENT - QUICK REFERENCE CARD

**Print this page and keep it handy during deployment**

---

## ⚡ CRITICAL INFORMATION

| Item | Value |
|------|-------|
| **Deployment Strategy** | Canary → Rolling Update |
| **Estimated Duration** | 30-45 minutes |
| **Downtime** | ZERO (hot deployment) |
| **Rollback Time** | 5 minutes |
| **Risk Level** | MEDIUM (mitigated) |

---

## 🔑 KEY COMMANDS

### 1. AWS Login
```bash
aws sso login --profile your-profile
aws sts get-caller-identity  # Verify
```

### 2. Get Queue URL
```bash
export QUEUE_URL=$(aws sqs get-queue-url \
  --queue-name file-processing-queue-production \
  --region ap-northeast-1 --output text)
echo $QUEUE_URL
```

### 3. Check SQS Depth
```bash
aws sqs get-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-northeast-1 \
  --query 'Attributes.ApproximateNumberOfMessages'
```

### 4. List EC2 Instances
```bash
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=cis-file-processor" \
    "Name=instance-state-name,Values=running" \
  --region ap-northeast-1 \
  --query 'Reservations[*].Instances[*].[InstanceId,PrivateIpAddress]' \
  --output table
```

### 5. Deploy to EC2 (on instance)
```bash
cd /opt/file-processor
sudo bash apply_emergency_fix.sh
sudo systemctl restart file-processor
sudo journalctl -u file-processor -f  # Monitor
```

### 6. Update SQS Timeout
```bash
aws sqs set-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attributes VisibilityTimeout=900 \
  --region ap-northeast-1
```

### 7. Rollback (on instance)
```bash
cd /opt/file-processor
sudo cp worker.py.backup.* worker.py
sudo systemctl restart file-processor
```

---

## ✅ GO/NO-GO CHECKLIST

### Pre-Deployment
- [ ] AWS SSO authenticated
- [ ] SQS metrics captured
- [ ] EC2 instances identified
- [ ] S3 notifications verified (count = 1)
- [ ] Stakeholders notified

### Canary Decision Point (10 min mark)
- [ ] Canary worker started successfully
- [ ] Messages being processed
- [ ] Messages being deleted
- [ ] No errors in logs

**GO** = Deploy to all instances
**NO-GO** = Rollback canary

### Full Deployment Completion
- [ ] All workers deployed
- [ ] SQS timeout updated
- [ ] All services running
- [ ] Queue depth decreasing

---

## 🚨 EMERGENCY CONTACTS

| Role | Contact |
|------|---------|
| **Project Manager** | You (Tatsuya) |
| **Technical Lead** | ______________ |
| **AWS Admin** | ______________ |
| **Client PM** | ______________ |
| **Escalation** | CTO ______________ |

---

## 📊 SUCCESS METRICS

| Time | SQS Messages | DLQ Messages | Status |
|------|--------------|--------------|--------|
| **T+0** (Before) | _______ | _______ | Baseline |
| **T+10min** | _______ | _______ | Should decrease |
| **T+30min** | _______ | _______ | Should decrease |
| **T+1hr** | _______ | _______ | 50% reduction |
| **T+24hr** | <10 | Reviewed | RESOLVED |

---

## 🔴 ROLLBACK TRIGGERS

**Immediate Rollback if**:
- ❌ Worker crashes on startup
- ❌ Messages not being deleted
- ❌ SQS queue growing (not decreasing)
- ❌ Critical errors in logs
- ❌ Client reports new issues

**Rollback Command**:
```bash
ssh ec2-user@<IP> "cd /opt/file-processor && \
  sudo cp worker.py.backup.* worker.py && \
  sudo systemctl restart file-processor"
```

---

## 📁 KEY FILES

| File | Path |
|------|------|
| **Fixed Worker** | `/backend/python-worker/worker_fixed.py` |
| **Deploy Script** | `/backend/python-worker/scripts/apply_emergency_fix.sh` |
| **Full Plan** | `/backend/python-worker/docs/EMERGENCY_DEPLOYMENT_PLAN.md` |
| **Checklist** | `/backend/python-worker/docs/DEPLOYMENT_CHECKLIST.md` |
| **Root Cause** | `/backend/python-worker/docs/SQS_EMERGENCY_ROOT_CAUSE_ANALYSIS.md` |

---

## 🎯 DEPLOYMENT PHASES

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   PHASE 1   │   │   PHASE 2   │   │   PHASE 3   │   │   PHASE 4   │
│ Pre-Deploy  │ → │   Canary    │ → │ Full Deploy │ → │ Verification│
│  (5 min)    │   │  (10 min)   │   │  (15 min)   │   │  (10 min)   │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
      ↓                  ↓                  ↓                  ↓
  Get Metrics      Deploy 1 EC2      Deploy All EC2     Monitor 10min
  Verify AWS       Monitor 5min      Update SQS         Check Metrics
  Check S3         GO/NO-GO          Verify All         SUCCESS/FAIL
```

---

## 💡 TROUBLESHOOTING

### Issue: AWS SSO Token Expired
```bash
aws sso login --profile your-profile
```

### Issue: Worker Won't Start
```bash
# Check logs
sudo journalctl -u file-processor --since '5 minutes ago'

# Check Python syntax
python3 -m py_compile worker.py
```

### Issue: SQS Messages Not Decreasing
```bash
# Check worker is running
sudo systemctl status file-processor

# Check S3 Event Notifications
aws s3api get-bucket-notification-configuration \
  --bucket cis-filesearch-storage-production \
  --region ap-northeast-1 | jq '.QueueConfigurations | length'
# Expected: 1 (if >1, remove duplicates)
```

### Issue: DLQ Growing Rapidly
```bash
# Check DLQ messages
aws sqs receive-message \
  --queue-url "$DLQ_URL" \
  --max-number-of-messages 1 \
  --region ap-northeast-1

# Review error patterns in worker logs
```

---

## 📞 NOTIFICATION TEMPLATES

### Before Deployment
```
件名: [緊急] ファイル検索システム修正適用開始

__:__ より緊急修正を適用します。
想定時間: 40分、影響なし
```

### After Success
```
件名: [完了] 修正適用完了

修正適用完了、全Worker正常稼働中
24時間監視を継続します
```

### If Issues
```
件名: [緊急] 修正適用中の問題発生

問題: <詳細>
対応: <内容>
30分後に再報告
```

---

## 🎲 DECISION TREE

```
Deploy to Canary
       ↓
   Monitor 5min
       ↓
    ┌─────────┐
    │Healthy? │
    └─────────┘
      ↙     ↘
    YES      NO
     ↓        ↓
  Deploy  Rollback
   All     Canary
     ↓        ↓
  Monitor  Investigate
     ↓
┌─────────┐
│Success? │
└─────────┘
  ↙     ↘
YES      NO
 ↓        ↓
Done   Rollback
        All
```

---

## 📝 NOTES SPACE

**Pre-Deployment Notes**:
_____________________________________________
_____________________________________________
_____________________________________________

**Issues During Deployment**:
_____________________________________________
_____________________________________________
_____________________________________________

**Lessons Learned**:
_____________________________________________
_____________________________________________
_____________________________________________

---

**Version**: 1.0
**Date**: 2025-12-12
**Owner**: Tatsuya
