# AWS EC2 File Processor - Cost Optimization, Security & Deployment Checklist

This document continues from `aws-ec2-file-processor-advanced.md`.

## Table of Contents
1. [Cost Optimization](#cost-optimization)
2. [Security Best Practices](#security-best-practices)
3. [Production Deployment Checklist](#production-deployment-checklist)

---

## Cost Optimization

### Spot Instance Cost Savings

**Current cost comparison (Tokyo region):**

| Instance Type | On-Demand | Spot (avg) | Monthly Cost (24/7) | Savings |
|---------------|-----------|------------|---------------------|---------|
| c5.xlarge | $0.17/hr | $0.034/hr | $24.48 vs $122.40 | 80% |
| c5.2xlarge | $0.34/hr | $0.068/hr | $48.96 vs $244.80 | 80% |

**For our workload (Auto Scaling 1-10 instances):**
- Average utilization: 3 instances × 12 hours/day
- Daily cost: $0.034 × 3 × 12 = $1.22
- Monthly cost: ~$37
- **vs On-Demand**: $0.17 × 3 × 12 × 30 = $183
- **Savings**: $146/month (80%)

### VPC Endpoints for Cost Reduction

**Data transfer costs without VPC endpoints:**
- S3 download: 1GB file × 100K files = 100TB/month
- Via NAT Gateway: $0.045/GB = $4,500/month
- Via Internet Gateway: $0.09/GB = $9,000/month

**With S3 Gateway endpoint: $0** (free data transfer within region)

```bash
# Create S3 Gateway endpoint (FREE)
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxxxx \
  --service-name com.amazonaws.ap-northeast-1.s3 \
  --route-table-ids rtb-xxxxx,rtb-yyyyy

# Monthly savings: ~$4,500
```

### Monthly Cost Breakdown (Optimized)

| Service | Configuration | Monthly Cost |
|---------|---------------|--------------|
| **EC2 Spot Instances** | c5.xlarge × 3 avg × 12hr/day | $37 |
| **EBS Volumes** | gp3 30GB × 3 instances | $9 |
| **S3 Storage** | 1TB | $23 |
| **S3 Requests** | 100K PUT, 100K GET | $0.50 |
| **OpenSearch** | t3.small.search (dev) | $25 |
| **SQS** | 300K requests | $0 (free tier) |
| **CloudWatch Logs** | 4.5GB/month | $1 |
| **CloudWatch Metrics** | Custom metrics | $0 (free tier) |
| **VPC Endpoint (S3)** | Gateway | $0 (free) |
| **VPC Endpoint (SQS)** | Interface | $8 |
| **Bedrock Embeddings** | 100K files × 30KB avg | $15 |
| **NAT Gateway** | Minimal usage | $5 |
| **TOTAL** | | **~$123/month** |

**Comparison to alternatives:**
- Lambda-based: ~$280/month
- On-Demand EC2: ~$366/month
- **Savings with Spot + VPC endpoints**: 66% reduction

---

## Security Best Practices

### IAM Least Privilege

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3ReadOnlyLandingBucket",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:GetObjectVersion"
      ],
      "Resource": "arn:aws:s3:::cis-filesearch-landing-prod/*",
      "Condition": {
        "StringLike": {
          "s3:prefix": ["files/*"]
        }
      }
    },
    {
      "Sid": "S3WriteOnlyThumbnailBucket",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::cis-filesearch-thumbnails-prod/thumbnails/*"
    }
  ]
}
```

### Secrets Management

```python
import boto3
import json

def get_secret(secret_name: str) -> dict:
    """Retrieve secret from AWS Secrets Manager"""
    client = boto3.client('secretsmanager', region_name='ap-northeast-1')
    response = client.get_secret_value(SecretId=secret_name)
    return json.loads(response['SecretString'])

# Usage
opensearch_creds = get_secret('cis-filesearch-opensearch-creds')
```

### Network Security

```bash
# Security group for EC2 workers
# Allow SSH only from bastion, HTTPS outbound for AWS services

aws ec2 create-security-group \
  --group-name cis-file-processor-sg \
  --description "Security group for file processors" \
  --vpc-id vpc-xxxxx

# Minimal ingress (SSH from bastion only)
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxxxx \
  --protocol tcp \
  --port 22 \
  --source-group sg-bastion

# Outbound HTTPS for AWS services
aws ec2 authorize-security-group-egress \
  --group-id sg-xxxxx \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0
```

### Encryption Everywhere

**Ensure all data is encrypted:**

- **S3**: SSE-S3 or SSE-KMS enabled
- **EBS**: Encryption at rest enabled in launch template
- **SQS**: SSE-SQS enabled
- **OpenSearch**: Encryption at rest enabled
- **CloudWatch Logs**: KMS encryption (optional)

### IMDSv2 Enforcement

```bash
# Configured in launch template:
"MetadataOptions": {
  "HttpTokens": "required",
  "HttpPutResponseHopLimit": 1
}
```

### VPC Flow Logs

```bash
# Enable VPC Flow Logs for security monitoring
aws ec2 create-flow-logs \
  --resource-type VPC \
  --resource-ids vpc-xxxxx \
  --traffic-type ALL \
  --log-destination-type cloud-watch-logs \
  --log-group-name /aws/vpc/flowlogs/cis-file-processor
```

---

## Production Deployment Checklist

### Pre-Deployment

**AWS Account Setup**
- [ ] AWS account with appropriate permissions
- [ ] AWS CLI configured (region: ap-northeast-1)
- [ ] Account budget alerts configured

**IAM Configuration**
- [ ] EC2 instance role created (CISFileProcessorRole)
- [ ] Instance profile created and linked
- [ ] Policies attached and tested
- [ ] Least privilege verified

**Network Infrastructure**
- [ ] VPC configured with private subnets
- [ ] Security groups created with minimal access
- [ ] S3 VPC Gateway endpoint created
- [ ] SQS VPC Interface endpoint created (optional)
- [ ] NAT Gateway configured
- [ ] VPC Flow Logs enabled

**S3 Buckets**
- [ ] Landing bucket created
- [ ] Thumbnail bucket created
- [ ] Encryption enabled (SSE-S3 or SSE-KMS)
- [ ] Versioning enabled
- [ ] Lifecycle policies configured
- [ ] Bucket policies reviewed

**SQS Queues**
- [ ] Main queue created
- [ ] DLQ created
- [ ] Visibility timeout set (300s)
- [ ] Message retention configured (4 days)
- [ ] Long polling enabled (20s)
- [ ] Redrive policy configured (3 retries)

**EventBridge**
- [ ] Rule created to route S3 events to SQS
- [ ] Input transformation configured
- [ ] SQS queue policy allows EventBridge

### Launch Template

**AMI Selection**
- [ ] Latest Amazon Linux 2023 AMI identified
- [ ] AMI tested in non-production

**User Data Script**
- [ ] Python 3.11 installation
- [ ] Tesseract OCR with Japanese language pack
- [ ] CloudWatch Agent installation
- [ ] Application download configured
- [ ] systemd service creation
- [ ] Script tested on single instance

**Instance Configuration**
- [ ] Instance type selected (c5.xlarge)
- [ ] Key pair created
- [ ] Security group configured
- [ ] IAM instance profile attached
- [ ] EBS volume configured (gp3, 30GB, encrypted)
- [ ] Spot Instance options configured
- [ ] IMDSv2 enforced
- [ ] Detailed monitoring enabled

**Tags**
- [ ] Name tag
- [ ] Project tag
- [ ] Environment tag
- [ ] CostCenter tag
- [ ] ManagedBy tag

### Auto Scaling Group

**Group Configuration**
- [ ] Launch template selected
- [ ] Min/Max/Desired capacity set (1/10/2)
- [ ] Multiple AZs selected
- [ ] Health check grace period (300s)
- [ ] CloudWatch group metrics enabled

**Scaling Policy**
- [ ] Target Tracking policy created
- [ ] SQS queue depth metric configured
- [ ] Target value set (10 messages per instance)
- [ ] Warm-up time configured (300s)

**Notifications**
- [ ] SNS topic created for ASG events
- [ ] Email notifications configured

### Application Deployment

**Python Worker Application**
- [ ] worker.py uploaded to S3
- [ ] config.py uploaded to S3
- [ ] requirements.txt verified

**Configuration**
- [ ] SQS_QUEUE_URL set
- [ ] OPENSEARCH_ENDPOINT set
- [ ] S3_LANDING_BUCKET set
- [ ] S3_THUMBNAIL_BUCKET set
- [ ] BEDROCK_REGION set

**OpenSearch**
- [ ] Domain created
- [ ] Index mapping created
- [ ] Access policies configured
- [ ] Encryption at rest enabled

### Monitoring

**CloudWatch Dashboards**
- [ ] Operations dashboard created
- [ ] Key metrics added
- [ ] Log insights queries saved

**CloudWatch Alarms**
- [ ] High error rate alarm
- [ ] Slow processing alarm
- [ ] Queue backlog alarm
- [ ] No instances running alarm
- [ ] High memory usage alarm

**CloudWatch Logs**
- [ ] Log groups created
- [ ] Retention policies set
- [ ] CloudWatch Agent configured

### Testing

**Unit Tests**
- [ ] OCR functionality tested
- [ ] Thumbnail generation tested
- [ ] Embedding creation tested
- [ ] OpenSearch indexing tested

**Integration Tests**
- [ ] End-to-end flow verified
- [ ] Error handling tested
- [ ] DLQ behavior verified

**Performance Tests**
- [ ] Single instance throughput measured
- [ ] Auto Scaling tested
- [ ] Memory usage profiled

**Security Tests**
- [ ] IAM permissions verified
- [ ] Network access tested
- [ ] Encryption verified

### Production Readiness

**Documentation**
- [ ] Architecture diagram created
- [ ] Runbook documented
- [ ] Incident response procedures
- [ ] Disaster recovery plan

**Backup and Recovery**
- [ ] S3 versioning enabled
- [ ] OpenSearch snapshots configured
- [ ] Recovery procedures tested

**Cost Management**
- [ ] Budget alerts configured
- [ ] Cost allocation tags applied
- [ ] Monthly cost reviewed

**Compliance**
- [ ] Data privacy requirements met
- [ ] Audit logging enabled
- [ ] Retention policies comply

### Deployment

**Launch Auto Scaling Group**
- [ ] Review all configurations
- [ ] Launch with desired capacity
- [ ] Verify instances launch successfully
- [ ] Check User Data logs
- [ ] Verify application running

**Trigger Test Processing**
- [ ] Upload test file to S3
- [ ] Verify SQS message created
- [ ] Verify EC2 processes message
- [ ] Check OpenSearch index
- [ ] Verify thumbnail created

**Monitor Initial Load**
- [ ] Watch CloudWatch dashboard
- [ ] Check for errors
- [ ] Verify Auto Scaling
- [ ] Monitor costs

### Post-Deployment

**Performance Tuning**
- [ ] Review actual processing times
- [ ] Adjust visibility timeout if needed
- [ ] Fine-tune scaling thresholds

**Cost Optimization**
- [ ] Review first week's costs
- [ ] Identify optimization opportunities
- [ ] Adjust instance types if needed

**Monitoring Adjustments**
- [ ] Tune alarm thresholds
- [ ] Add custom metrics if needed

**Documentation Updates**
- [ ] Update runbook
- [ ] Document configuration changes
- [ ] Update cost estimates

---

## Summary

This guide provided:

1. **Cost Optimization**: Spot Instances (80% savings), VPC endpoints ($4,500/month savings), optimized configuration
2. **Security Best Practices**: Least privilege IAM, secrets management, network isolation, encryption everywhere
3. **Production Checklist**: Comprehensive deployment readiness checklist

**Estimated Total Monthly Cost**: ~$123 (optimized with Spot + VPC endpoints)

**Comparison to alternatives:**
- Lambda-based: ~$280/month (56% more expensive)
- On-Demand EC2: ~$366/month (198% more expensive)

**Key Success Factors:**
- Use Spot Instances for 80% cost savings
- Deploy S3 VPC Gateway endpoint (saves $4,500/month)
- Right-size instances (c5.xlarge is optimal)
- Implement aggressive scale-in for minimal idle time
- Monitor and optimize continuously

---

**Document Version**: 1.0
**Last Updated**: 2025-01-17
**Author**: CIS Development Team
