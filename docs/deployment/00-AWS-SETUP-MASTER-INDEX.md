# AWS Setup Master Index - CIS File Search Application

**🎯 Purpose**: Your complete navigation guide for setting up AWS infrastructure from scratch

**👤 Audience**: AWS beginners implementing their first enterprise-grade file search system

**⏱️ Total Time**: 12-18 hours spread across 2-3 weeks

---

## 📚 Table of Contents

1. [Getting Started](#getting-started)
2. [Documentation Roadmap](#documentation-roadmap)
3. [Implementation Paths](#implementation-paths)
4. [Quick Reference](#quick-reference)
5. [Support Resources](#support-resources)

---

## 🚀 Getting Started

### Before You Begin

**❓ Are you ready?** Complete this checklist:

- [ ] AWS Account with admin access
- [ ] Credit card added to AWS account (for service charges)
- [ ] Basic command line knowledge (Terminal/PowerShell)
- [ ] 2-3 hours available for first setup session
- [ ] Willingness to learn and experiment

**💰 Expected Monthly Cost**: $86-120 (depending on file volume)

**🎓 What You'll Learn**:
- AWS service configuration via Console and CLI
- Security best practices (encryption, IAM, least privilege)
- Cost optimization strategies
- Production-ready infrastructure setup

### Choose Your Learning Path

#### 🟢 Path A: Guided Step-by-Step (RECOMMENDED for beginners)
**Time**: 12-15 hours | **Difficulty**: Beginner-friendly

1. Read: [Beginner's Quickstart Guide](./01-BEGINNER-QUICKSTART.md) ⭐ START HERE
2. Follow: [Implementation Checklist](./02-IMPLEMENTATION-CHECKLIST.md)
3. Track: [Progress Tracker](./03-PROGRESS-TRACKER.md)

**Best for**: First-time AWS users, those who want detailed explanations

---

#### 🟡 Path B: Experienced User Fast Track
**Time**: 6-8 hours | **Difficulty**: Intermediate

1. Review: [AWS Complete Setup Guide](./AWS-COMPLETE-SETUP-GUIDE.md)
2. Execute: Steps 1-8 in sequence
3. Verify: End-to-end testing

**Best for**: Users with AWS experience, comfortable with CLI

---

#### 🟠 Path C: Service-by-Service Deep Dive
**Time**: 15-18 hours | **Difficulty**: Advanced learning

Study each service in depth before implementation:
- [S3 Configuration Guide](./aws-s3-configuration-guide.md)
- [SQS Configuration Guide](./aws-sqs-configuration-guide.md)
- [OpenSearch Guide](./aws-opensearch-configuration-guide.md)
- (See full list in [Service Guides](#service-specific-guides))

**Best for**: Those wanting deep AWS understanding, architects planning custom implementations

---

## 🗺️ Documentation Roadmap

### 📖 Core Implementation Guides (Follow in Order)

#### Phase 1: Foundation Setup (Week 1)
**Goal**: Get AWS environment ready with security and core services

| # | Document | Time | Prerequisites | Verification |
|---|----------|------|---------------|--------------|
| 1 | [Beginner's Quickstart](./01-BEGINNER-QUICKSTART.md) | 2h | AWS Account | AWS CLI working |
| 2 | [IAM Roles & Policies](../security/iam-roles-policies-guide.md) | 45min | AWS CLI | Roles created |
| 3 | [Secrets Manager Setup](../security/aws-secrets-manager-guide.md) | 30min | IAM roles | Secrets stored |
| 4 | [S3 Bucket Configuration](./aws-s3-configuration-guide.md) | 30min | IAM roles | Test upload works |
| 5 | [SQS Queue Setup](./aws-sqs-configuration-guide.md) | 30min | None | Test message sent |

**📊 Progress Check**: Can you upload a file to S3 and send a message to SQS?

---

#### Phase 2: Processing Infrastructure (Week 2)
**Goal**: Set up file processing pipeline with OpenSearch

| # | Document | Time | Prerequisites | Verification |
|---|----------|------|---------------|--------------|
| 6 | [OpenSearch Domain](./aws-opensearch-configuration-guide.md) | 60min | VPC setup | Domain is green |
| 7 | [EventBridge S3→SQS](./aws-eventbridge-s3-sqs-guide.md) | 20min | S3, SQS | Events flow |
| 8 | [EC2 Auto Scaling](./aws-autoscaling-spot-instances-guide.md) | 60min | All above | Instances launch |

**📊 Progress Check**: Upload a file to S3. Does it trigger an SQS message and launch EC2?

---

#### Phase 3: Optimization & Monitoring (Week 3)
**Goal**: Reduce costs and enable monitoring

| # | Document | Time | Prerequisites | Verification |
|---|----------|------|---------------|--------------|
| 9 | [VPC Endpoints](./aws-vpc-endpoints-guide.md) | 30min | VPC, services | Endpoint active |
| 10 | [CloudWatch Monitoring](./aws-cloudwatch-configuration-guide.md) | 45min | All services | Dashboard visible |
| 11 | [Security Hardening](../security/security-best-practices-guide.md) | 60min | All above | Security checks pass |

**📊 Progress Check**: Are costs within budget? Can you monitor all services?

---

### 🎯 Specialized Guides

#### Scanner PC Setup (Windows/On-Premise)
**For**: Setting up the file scanning computer that connects to NAS

| Document | Purpose | Time |
|----------|---------|------|
| [Scanner PC Quickstart](./scanner-pc-quickstart.md) | Quick setup for scanner computer | 1h |
| [Windows Setup Guide](./windows-scanner-pc-setup-guide.md) | Detailed Windows configuration | 2h |
| [Scanner Security Checklist](./scanner-pc-security-checklist.md) | Security hardening | 45min |

---

#### DataSync Implementation (NAS to S3)
**For**: Synchronizing files from on-premise NAS to AWS S3

| Document | Purpose | Time |
|----------|---------|------|
| [DataSync Documentation Index](./datasync/00-datasync-documentation-index.md) | Master guide for all DataSync docs | 15min |
| [DataSync Complete Setup](./datasync/11-datasync-complete-setup-guide.md) | End-to-end DataSync implementation | 4h |
| [NAS Information Template](./datasync/nas-information-request-template.md) | What to ask client about their NAS | 30min |

**🎓 DataSync Learning Path**:
1. Read overview: [DataSync Architecture](./datasync/00-datasync-overview-architecture.md)
2. Collect info: [NAS Information Template](./datasync/nas-information-request-template.md)
3. Implement: Follow guides 01-11 in datasync folder
4. Optimize: [Performance Optimization](./datasync/datasync-performance-optimization-guide.md)

---

### 🔒 Security & Compliance

**Critical Reading** (Do NOT skip):

| Document | Purpose | Priority |
|----------|---------|----------|
| [IAM Roles & Policies](../security/iam-roles-policies-guide.md) | Secure access control | P0 🔴 |
| [Secrets Manager Guide](../security/aws-secrets-manager-guide.md) | Credential management | P0 🔴 |
| [Security Best Practices](../security/security-best-practices-guide.md) | Overall security hardening | P0 🔴 |
| [Compliance Mapping](../security/compliance-mapping.md) | GDPR, SOC 2, ISO compliance | P1 🟠 |
| [Beginner Security Guide](../security/aws-beginner-security-guide.md) | Security fundamentals | P1 🟠 |

---

### 🛠️ Service-Specific Guides

Deep dives into each AWS service:

**Storage & Queuing**:
- [S3 Configuration](./aws-s3-configuration-guide.md) - Buckets, lifecycle, encryption
- [SQS Configuration](./aws-sqs-configuration-guide.md) - Queues, DLQ, polling

**Compute & Processing**:
- [Auto Scaling with Spot Instances](./aws-autoscaling-spot-instances-guide.md) - Cost-optimized EC2
- [EC2 File Processor Guide](./aws-ec2-file-processor-guide.md) - Worker configuration
- [Launch Template Guide](./datasync/07-ec2-launch-template-guide.md) - EC2 templates

**Search & Indexing**:
- [OpenSearch Configuration](./aws-opensearch-configuration-guide.md) - Search engine setup
- [Python Worker Application](./datasync/09-python-worker-application-guide.md) - File processing code

**Networking**:
- [VPC Endpoints Guide](./aws-vpc-endpoints-guide.md) - Cost-saving endpoints
- [EventBridge S3→SQS](./aws-eventbridge-s3-sqs-guide.md) - Event routing

**Monitoring**:
- [CloudWatch Configuration](./aws-cloudwatch-configuration-guide.md) - Logging and alarms
- [Performance Monitoring](./performance-monitoring-guide.md) - Application metrics

---

## 🎯 Implementation Paths

### 🌟 RECOMMENDED: Beginner Full Stack Path

**Duration**: 2-3 weeks (2-3 hours per session, 3-4 sessions per week)

```
Week 1: Foundation
├── Day 1 (2h): AWS setup + IAM roles
├── Day 2 (1.5h): S3 + SQS configuration
├── Day 3 (2h): Security (Secrets Manager, policies)
└── Weekend: Review and practice

Week 2: Processing
├── Day 1 (2h): OpenSearch setup
├── Day 2 (1.5h): EventBridge + Auto Scaling
├── Day 3 (2h): Testing and troubleshooting
└── Weekend: End-to-end test

Week 3: Polish
├── Day 1 (1.5h): VPC endpoints + cost optimization
├── Day 2 (2h): CloudWatch monitoring + alarms
├── Day 3 (1.5h): Security hardening
└── Weekend: Production readiness check
```

**📋 Detailed Guide**: [Implementation Checklist](./02-IMPLEMENTATION-CHECKLIST.md)

---

### ⚡ Fast Track: Experienced User Path

**Duration**: 2-3 days (6-8 hours total)

```
Day 1 (3-4h):
├── IAM roles (45min)
├── S3 + SQS (1h)
├── OpenSearch (1.5h)
└── EventBridge (20min)

Day 2 (2-3h):
├── Auto Scaling Group (1.5h)
├── VPC Endpoints (30min)
└── CloudWatch (45min)

Day 3 (1h):
└── Testing + Security review
```

**📋 Use**: [AWS Complete Setup Guide](./AWS-COMPLETE-SETUP-GUIDE.md)

---

### 🎓 Learning Path: Deep Understanding

**Duration**: 3-4 weeks (study + implementation)

**Study each service in depth, then implement**:

```
Week 1: Storage Architecture
├── Study: S3 documentation (2h)
├── Study: SQS patterns (1.5h)
├── Implement: S3 + SQS (1h)
└── Lab: Test various scenarios

Week 2: Compute & Search
├── Study: EC2 Auto Scaling (2h)
├── Study: OpenSearch fundamentals (2.5h)
├── Implement: OpenSearch + ASG (2h)
└── Lab: Performance testing

Week 3: Networking & Security
├── Study: VPC endpoints (1.5h)
├── Study: IAM deep dive (2h)
├── Implement: VPC + Security hardening (2h)
└── Lab: Penetration testing

Week 4: Monitoring & Optimization
├── Study: CloudWatch best practices (1.5h)
├── Study: Cost optimization (1h)
├── Implement: Full monitoring (1.5h)
└── Lab: Cost analysis
```

---

## 📑 Quick Reference

### 🔑 Essential Commands Cheat Sheet

**AWS CLI Setup**:
```bash
# Install
brew install awscli  # macOS
# or
pip install awscli  # Python

# Configure
aws configure
# Enter: Access Key, Secret Key, Region (ap-northeast-1), Output (json)

# Verify
aws sts get-caller-identity
```

**Quick Service Checks**:
```bash
# S3: List buckets
aws s3 ls

# SQS: Get queue URL
aws sqs get-queue-url --queue-name cis-filesearch-queue-dev

# OpenSearch: Check domain status
aws opensearch describe-domain --domain-name cis-filesearch-dev

# EC2: List running instances
aws ec2 describe-instances --filters "Name=instance-state-name,Values=running"

# CloudWatch: Recent log events
aws logs tail /aws/cis-file-processor/dev/workers --follow
```

---

### 📊 Service Configuration Summary

| Service | Resource Name | Purpose | Monthly Cost |
|---------|--------------|---------|--------------|
| **S3** | `cis-filesearch-landing-dev` | File storage | $15 |
| **SQS** | `cis-filesearch-queue-dev` | Message queue | $0 |
| **OpenSearch** | `cis-filesearch-dev` | Search engine | $48 |
| **EC2 ASG** | `cis-file-processor-asg-dev` | File processors | $9 (Spot) |
| **EventBridge** | `cis-s3-to-sqs-dev` | Event routing | $0 |
| **CloudWatch** | Multiple log groups | Monitoring | $2 |
| **VPC Endpoints** | S3 Gateway + SQS Interface | Cost savings | $8 |
| **Total** | | | **~$86/month** |

---

### 🎯 Verification Checkpoints

After each phase, verify your setup:

**✅ Phase 1 Complete**:
```bash
# Test S3 upload
echo "test" > test.txt && aws s3 cp test.txt s3://cis-filesearch-landing-dev/

# Test SQS send
aws sqs send-message --queue-url YOUR_QUEUE_URL --message-body '{"test":true}'

# Test IAM role
aws iam get-role --role-name CISFileProcessorRole
```

**✅ Phase 2 Complete**:
```bash
# Upload file, verify EventBridge triggers SQS
aws s3 cp test.txt s3://cis-filesearch-landing-dev/files/
sleep 5
aws sqs receive-message --queue-url YOUR_QUEUE_URL

# Check OpenSearch health
curl -X GET "https://YOUR_OPENSEARCH_ENDPOINT/_cluster/health" --aws-sigv4 "aws:amz:ap-northeast-1:es"

# Verify ASG can scale
aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names cis-file-processor-asg-dev
```

**✅ Phase 3 Complete**:
```bash
# Check VPC endpoints
aws ec2 describe-vpc-endpoints

# View CloudWatch dashboard
aws cloudwatch get-dashboard --dashboard-name CISFileScannerOperations

# Run security audit
aws iam get-role-policy --role-name CISFileProcessorRole --policy-name S3Access
```

---

### 🆘 Common Issues Quick Fix

| Symptom | Likely Cause | Quick Fix | Detailed Guide |
|---------|-------------|-----------|----------------|
| "Access Denied" S3 | IAM policy missing | Check IAM role attached to EC2 | [IAM Guide](../security/iam-roles-policies-guide.md) p.15 |
| No SQS messages | EventBridge not configured | Enable EventBridge on S3 bucket | [EventBridge Guide](./aws-eventbridge-s3-sqs-guide.md) p.8 |
| ASG not scaling | Insufficient Spot capacity | Add more instance types to ASG | [Auto Scaling Guide](./aws-autoscaling-spot-instances-guide.md) p.22 |
| High AWS costs | NAT Gateway data charges | Implement VPC endpoints | [VPC Endpoints Guide](./aws-vpc-endpoints-guide.md) p.5 |
| OpenSearch "red" status | Out of disk space | Increase storage or delete old indices | [OpenSearch Guide](./aws-opensearch-configuration-guide.md) p.34 |

**🔍 Full Troubleshooting**: [Troubleshooting Guide](./troubleshooting-guide.md)

---

### 📞 Decision Trees

**🤔 "Where do I start?"**
```
Do you have AWS experience?
├─ No → Start with [Beginner's Quickstart](./01-BEGINNER-QUICKSTART.md)
└─ Yes → Jump to [AWS Complete Setup Guide](./AWS-COMPLETE-SETUP-GUIDE.md)
```

**🤔 "Which setup path?"**
```
What's your priority?
├─ Learn deeply → Path C: Service-by-Service Deep Dive
├─ Complete quickly → Path B: Experienced User Fast Track
└─ Balanced learning → Path A: Guided Step-by-Step ⭐
```

**🤔 "I'm stuck, what now?"**
```
What's the issue?
├─ Configuration error → Check [Troubleshooting Guide](./troubleshooting-guide.md)
├─ Cost too high → Review [Cost Optimization](#cost-optimization)
├─ Security concern → Read [Security Best Practices](../security/security-best-practices-guide.md)
├─ Service not working → Check specific service guide
└─ Still stuck → Check [Support Resources](#support-resources)
```

---

## 🎓 Support Resources

### 📚 Official AWS Documentation
- [AWS Documentation Home](https://docs.aws.amazon.com/)
- [S3 User Guide](https://docs.aws.amazon.com/s3/)
- [SQS Developer Guide](https://docs.aws.amazon.com/sqs/)
- [OpenSearch Service Guide](https://docs.aws.amazon.com/opensearch-service/)
- [EC2 Auto Scaling Guide](https://docs.aws.amazon.com/autoscaling/)

### 🛠️ Tools & Calculators
- [AWS Pricing Calculator](https://calculator.aws/) - Estimate costs before building
- [IAM Policy Simulator](https://policysim.aws.amazon.com/) - Test permissions
- [AWS CLI Command Reference](https://awscli.amazonaws.com/v2/documentation/api/latest/index.html)

### 💬 Community Support
- [AWS Forums](https://repost.aws/) - Official AWS Q&A
- [Stack Overflow (aws tag)](https://stackoverflow.com/questions/tagged/aws)
- [Reddit r/aws](https://reddit.com/r/aws) - Community discussions

### 🎥 Video Tutorials
- [AWS YouTube Channel](https://youtube.com/user/AmazonWebServices)
- [AWS Skill Builder](https://skillbuilder.aws/) - Free training courses

### 📖 This Project's Documentation
- **All docs location**: `/docs/deployment/` and `/docs/security/`
- **Quick search**: Use your code editor's search (Cmd/Ctrl + Shift + F)
- **Document index**: This file!

---

## 🎯 Success Metrics

### How do you know you're done?

**✅ Technical Completion**:
- [ ] All 8 AWS services configured and running
- [ ] End-to-end test passes (file upload → processing → indexed)
- [ ] Auto Scaling scales up and down correctly
- [ ] No "Access Denied" errors in CloudWatch logs
- [ ] OpenSearch domain shows "green" status
- [ ] Monthly costs within $100 budget

**✅ Security Completion**:
- [ ] All IAM policies follow least privilege
- [ ] Secrets stored in Secrets Manager (not code)
- [ ] IMDSv2 enforced on all EC2 instances
- [ ] S3 buckets have encryption enabled
- [ ] CloudTrail logging active
- [ ] All security checklist items passed

**✅ Operational Completion**:
- [ ] CloudWatch dashboard shows key metrics
- [ ] Alarms configured for critical issues
- [ ] Log retention policies set
- [ ] Backup/disaster recovery plan documented
- [ ] Team trained on monitoring and troubleshooting

**📊 Track Progress**: Use [Progress Tracker](./03-PROGRESS-TRACKER.md)

---

## 🚀 Next Steps After Setup

1. **Deploy Application Code**
   - Python worker application to EC2 instances
   - Frontend application to Amplify/Vercel

2. **Production Optimization**
   - Run load tests
   - Fine-tune Auto Scaling thresholds
   - Optimize OpenSearch index settings

3. **Monitoring & Operations**
   - Set up on-call rotation
   - Create runbooks for common issues
   - Schedule regular security reviews

4. **Continuous Improvement**
   - Review cost reports monthly
   - Update IAM policies as needed
   - Stay current with AWS service updates

---

## 📋 Appendix: All Documents List

### Deployment Guides (27 documents)
```
/docs/deployment/
├── 00-AWS-SETUP-MASTER-INDEX.md ⭐ YOU ARE HERE
├── 01-BEGINNER-QUICKSTART.md
├── 02-IMPLEMENTATION-CHECKLIST.md
├── 03-PROGRESS-TRACKER.md
├── AWS-COMPLETE-SETUP-GUIDE.md
├── aws-s3-configuration-guide.md
├── aws-sqs-configuration-guide.md
├── aws-opensearch-configuration-guide.md
├── aws-eventbridge-s3-sqs-guide.md
├── aws-autoscaling-spot-instances-guide.md
├── aws-vpc-endpoints-guide.md
├── aws-cloudwatch-configuration-guide.md
├── aws-manual-setup-overview.md
├── troubleshooting-guide.md
├── deploy-checklist.md
├── datasync/
│   ├── 00-datasync-documentation-index.md
│   ├── 11-datasync-complete-setup-guide.md
│   ├── 01-iam-roles-setup-guide.md
│   ├── 02-s3-bucket-setup-guide.md
│   ├── 03-cloudwatch-logs-setup-guide.md
│   ├── 04-datasync-agent-installation-guide.md
│   ├── 05-datasync-location-task-configuration-guide.md
│   ├── 06-datasync-monitoring-optimization-guide.md
│   ├── 07-ec2-launch-template-guide.md
│   ├── 08-auto-scaling-group-guide.md
│   ├── 09-python-worker-application-guide.md
│   ├── 10-spot-interruption-handling-guide.md
│   └── [... additional DataSync guides]
└── [... additional deployment guides]
```

### Security Guides (29 documents)
```
/docs/security/
├── iam-roles-policies-guide.md
├── aws-secrets-manager-guide.md
├── security-best-practices-guide.md
├── compliance-mapping.md
├── aws-beginner-security-guide.md
├── aws-cognito-setup-guide.md
├── cognito-security-best-practices.md
├── security-checklist.md
└── [... additional security guides]
```

---

**Document Version**: 1.0
**Last Updated**: 2025-01-18
**Maintained By**: CIS Development Team
**Next Review**: 2025-02-18

---

## 🎉 Ready to Start?

👉 **Begin your journey**: [Beginner's Quickstart Guide](./01-BEGINNER-QUICKSTART.md)

Good luck! You've got this! 💪
