# AWS Manual Setup Overview - CIS File Scanner

## Purpose

This directory contains comprehensive guides for manually configuring AWS services for the CIS File Scanner via Console and CLI. These guides are designed for learning and understanding AWS services deeply, rather than automated infrastructure-as-code deployment.

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI installed and configured
- Basic understanding of networking and cloud concepts
- Access to Tokyo region (ap-northeast-1)

## Setup Order

Follow these guides in order for optimal learning and configuration:

### 1. S3 Configuration (Start Here)
**File**: `aws-s3-configuration-guide.md`

**What you'll learn:**
- Bucket creation and naming conventions
- Storage classes and lifecycle policies
- Encryption (SSE-S3 vs SSE-KMS)
- Versioning and retention
- IAM policies for S3 access
- Cost optimization strategies

**Time to complete**: 45-60 minutes

**Prerequisites**: AWS CLI configured

### 2. SQS Configuration
**File**: `aws-sqs-configuration-guide.md`

**What you'll learn:**
- Standard vs FIFO queues (and why Standard for this project)
- Dead Letter Queue setup
- Visibility timeout tuning
- Long polling configuration
- Message attributes and batching
- Queue monitoring and alarms

**Time to complete**: 30-45 minutes

**Prerequisites**: S3 configuration complete

### 3. CloudWatch Configuration
**File**: `aws-cloudwatch-configuration-guide.md`

**What you'll learn:**
- Log groups and retention policies
- Custom metrics publishing
- Alarm configuration and SNS integration
- Dashboard creation
- CloudWatch Insights queries
- Cost optimization for logging

**Time to complete**: 45-60 minutes

**Prerequisites**: S3 and SQS configured

### 4. VPC Endpoints (Cost Optimization)
**File**: `aws-vpc-endpoints-guide.md`

**What you'll learn:**
- Gateway vs Interface endpoints
- When to use each type
- Security group configuration
- Private DNS setup
- Cost-benefit analysis
- Network troubleshooting

**Time to complete**: 30-45 minutes

**Prerequisites**: All previous configurations complete, VPC exists

## Quick Reference

### Configuration Checklist

```bash
# 1. S3 Setup
□ Create bucket: cis-filesearch-landing-dev
□ Enable versioning
□ Set lifecycle policies (7 days → Intelligent-Tiering)
□ Configure IAM policies for scanner
□ Test upload/download

# 2. SQS Setup
□ Create main queue: cis-filesearch-queue-dev
□ Create DLQ: cis-filesearch-dlq-dev
□ Configure redrive policy (3 retries)
□ Enable long polling (20 seconds)
□ Set visibility timeout (300 seconds)
□ Test send/receive messages

# 3. CloudWatch Setup
□ Create log groups (/aws/cis-file-scanner/dev/*)
□ Set retention policies (30/90/365/7 days)
□ Configure custom metrics
□ Create SNS topic for alerts
□ Set up alarms (5-8 alarms)
□ Build operations dashboard
□ Test logging from code

# 4. VPC Endpoints Setup
□ Create S3 Gateway endpoint (FREE)
□ Create SQS Interface endpoint (optional)
□ Configure security groups (allow 443)
□ Enable private DNS
□ Test connectivity
□ Verify cost savings
```

### Service URLs (After Configuration)

```bash
# S3 Bucket
s3://cis-filesearch-landing-dev

# SQS Queue
https://sqs.ap-northeast-1.amazonaws.com/YOUR_ACCOUNT_ID/cis-filesearch-queue-dev

# CloudWatch Log Group
/aws/cis-file-scanner/dev/application

# CloudWatch Dashboard
https://console.aws.amazon.com/cloudwatch/home?region=ap-northeast-1#dashboards:name=CISFileScannerOperations
```

## Expected Costs

### Without Cost Optimization
| Service | Monthly Cost |
|---------|--------------|
| S3 Storage (1TB) | $23.00 |
| S3 Requests | $0.50 |
| SQS | $0.00 (free tier) |
| CloudWatch Logs (4.5GB) | $0.00 (free tier) |
| CloudWatch Metrics | $0.00 (free tier) |
| CloudWatch Alarms | $0.00 (free tier) |
| NAT Gateway (data transfer) | $45.00 |
| **Total** | **$68.50/month** |

### With Cost Optimization (VPC Endpoints + Lifecycle)
| Service | Monthly Cost |
|---------|--------------|
| S3 Storage (optimized) | $15.00 |
| S3 Requests | $0.50 |
| SQS | $0.00 |
| CloudWatch | $0.00 |
| VPC Endpoint (SQS) | $7.55 |
| NAT Gateway (reduced) | $4.50 |
| **Total** | **$27.55/month** |

**Monthly Savings: $40.95 (60% reduction)**

## Testing Procedures

### End-to-End Test Flow

1. **Upload Test File to S3**
```bash
echo "Test file content" > test.txt
aws s3 cp test.txt s3://cis-filesearch-landing-dev/test/
```

2. **Send Message to SQS**
```bash
aws sqs send-message \
  --queue-url YOUR_QUEUE_URL \
  --message-body '{"s3Bucket":"cis-filesearch-landing-dev","s3Key":"test/test.txt"}'
```

3. **Verify CloudWatch Logs**
```bash
aws logs filter-log-events \
  --log-group-name /aws/cis-file-scanner/dev/application \
  --filter-pattern "test.txt" \
  --start-time $(date -u -d '5 minutes ago' +%s)000
```

4. **Check Metrics**
```bash
aws cloudwatch get-metric-statistics \
  --namespace CISFileScanner \
  --metric-name FilesScanned \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

## Common Issues and Quick Fixes

### Issue: Access Denied Errors

**Symptom**: `AccessDenied` when accessing S3/SQS

**Quick Fix**:
```bash
# Check IAM role is attached to EC2
aws ec2 describe-instances --instance-ids YOUR_INSTANCE_ID \
  --query 'Reservations[0].Instances[0].IamInstanceProfile'

# Verify IAM policy permissions
aws iam get-role --role-name CISFileScannerRole
```

### Issue: Logs Not Appearing

**Symptom**: Code runs but no logs in CloudWatch

**Quick Fix**:
```bash
# Verify log group exists
aws logs describe-log-groups \
  --log-group-name /aws/cis-file-scanner/dev/application

# Check IAM permissions include logs:PutLogEvents
```

### Issue: High Costs

**Symptom**: Unexpected AWS bill

**Quick Fix**:
```bash
# Check NAT Gateway data processing charges
aws ce get-cost-and-usage \
  --time-period Start=2025-01-01,End=2025-01-31 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=DIMENSION,Key=SERVICE

# Implement VPC endpoints immediately (see guide 4)
```

## Learning Objectives

After completing all guides, you should understand:

### Technical Understanding
- ✅ How S3 storage classes impact costs
- ✅ Why Standard SQS is better than FIFO for file scanning
- ✅ How visibility timeout affects message processing
- ✅ When to use Gateway vs Interface VPC endpoints
- ✅ How CloudWatch Insights queries work
- ✅ IAM policy structure and least-privilege principles

### Operational Skills
- ✅ Setting up comprehensive monitoring dashboards
- ✅ Configuring cost-effective log retention
- ✅ Troubleshooting AWS connectivity issues
- ✅ Analyzing and optimizing AWS costs
- ✅ Designing secure IAM policies

### Best Practices
- ✅ Always enable encryption at rest (SSE-S3 minimum)
- ✅ Use lifecycle policies to control storage costs
- ✅ Enable long polling for SQS (reduces API calls)
- ✅ Set appropriate log retention (not forever)
- ✅ Create VPC endpoints for high-volume services
- ✅ Use tags for cost tracking
- ✅ Configure alarms proactively

## Production Readiness Checklist

Before deploying to production:

### Security
- [ ] All buckets have encryption enabled
- [ ] Bucket policies deny unencrypted uploads
- [ ] IAM policies follow least-privilege principle
- [ ] Security groups restrict access to known IPs/SGs
- [ ] VPC endpoints use restrictive policies
- [ ] CloudWatch logs retention meets compliance requirements

### Reliability
- [ ] Dead Letter Queue configured with alerts
- [ ] CloudWatch alarms for critical metrics
- [ ] SNS notifications to operations team
- [ ] S3 versioning enabled for data protection
- [ ] Multi-AZ configuration for interface endpoints
- [ ] Backup/restore procedures documented

### Cost Optimization
- [ ] S3 lifecycle policies configured
- [ ] Log retention policies set appropriately
- [ ] VPC Gateway endpoint for S3 (saves $45/month)
- [ ] VPC Interface endpoints for high-traffic services
- [ ] Budget alerts configured
- [ ] Cost allocation tags applied

### Monitoring
- [ ] CloudWatch dashboard with key metrics
- [ ] Log groups for all components
- [ ] Custom metrics publishing from scanner
- [ ] Saved Insights queries for troubleshooting
- [ ] Monthly cost review scheduled

## Additional Resources

### AWS Documentation
- [S3 User Guide](https://docs.aws.amazon.com/s3/)
- [SQS Developer Guide](https://docs.aws.amazon.com/sqs/)
- [CloudWatch Documentation](https://docs.aws.amazon.com/cloudwatch/)
- [VPC Endpoints Guide](https://docs.aws.amazon.com/vpc/latest/privatelink/)

### Cost Calculators
- [AWS Pricing Calculator](https://calculator.aws/)
- [S3 Pricing](https://aws.amazon.com/s3/pricing/)
- [SQS Pricing](https://aws.amazon.com/sqs/pricing/)

### Best Practices
- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [Security Best Practices](https://docs.aws.amazon.com/security/)
- [Cost Optimization Pillar](https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/)

## Support and Troubleshooting

If you encounter issues:

1. **Check guide-specific troubleshooting sections** (each guide has comprehensive troubleshooting)
2. **Review CloudWatch Logs** for error messages
3. **Use AWS Support** (if you have a support plan)
4. **Consult AWS Forums** and Stack Overflow
5. **Update this documentation** with solutions you discover

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2025-01-12 | Initial creation of all guides | CIS Development Team |

---

## Next Steps After Setup

1. **Integrate with Scanner Code**
   - Update `.env` with S3 bucket name, SQS queue URL
   - Add CloudWatch logging to scanner application
   - Implement custom metrics publishing

2. **Run Test Scan**
   ```bash
   cd frontend/backend/file-scanner
   yarn dev scan --dry-run
   ```

3. **Monitor First Production Scan**
   - Watch CloudWatch dashboard
   - Check for alarms
   - Verify files uploaded to S3
   - Confirm messages in SQS

4. **Optimize Based on Metrics**
   - Review actual throughput
   - Adjust visibility timeout if needed
   - Fine-tune alarm thresholds
   - Optimize log sampling rate

5. **Document Your Learnings**
   - Add notes to this file
   - Share insights with team
   - Update guides with project-specific details

---

**Start your journey with**: `aws-s3-configuration-guide.md`

**Questions?** Review the troubleshooting sections in each guide or consult AWS documentation.

**Happy Learning!** 🚀
