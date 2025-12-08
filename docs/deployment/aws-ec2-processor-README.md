# AWS EC2 File Processor Documentation

Complete guide for deploying EC2-based file processing infrastructure for the CIS File Search Application.

## Overview

This documentation covers the deployment of a production-ready, cost-optimized file processing system using:

- **EC2 Spot Instances** with Auto Scaling (70-90% cost savings)
- **Tesseract OCR** with Japanese language support
- **Amazon Bedrock** Titan Embeddings for vector search
- **OpenSearch** for full-text and semantic search
- **Python 3.11** worker application with multiprocessing

## Architecture

```
DataSync → S3 → EventBridge → SQS → Auto Scaling EC2 (1-10) → OpenSearch
                                                            └→ S3 Thumbnails
```

**Key Components:**
- **DataSync**: NAS to S3 synchronization
- **EventBridge**: Event routing from S3 to SQS
- **SQS**: Message queue buffer (decoupling)
- **Auto Scaling EC2**: Spot Instances with SQS-based scaling
- **Tesseract OCR**: Japanese + English text extraction
- **Bedrock**: Titan Embeddings (vector generation)
- **OpenSearch**: Full-text + vector search indexing

## Documentation Structure

### 1. Main Configuration Guide
**File**: `aws-ec2-file-processor-guide.md`

**Contents:**
- Overview and Architecture
- Launch Template Configuration
  - IAM Role setup
  - Amazon Linux 2023 AMI selection
  - User Data script (Tesseract + Python 3.11)
  - CloudWatch Agent configuration
- Auto Scaling Group Design
  - SQS-based Target Tracking
  - Spot Instance configuration
  - Scaling parameters
- Python Worker Application
  - Complete implementation
  - File processing pipeline
  - OCR, thumbnails, embeddings, indexing

**Time to complete**: 2-3 hours

### 2. Advanced Topics Guide
**File**: `aws-ec2-file-processor-advanced.md`

**Contents:**
- Integration with File Processing Pipeline
  - EventBridge configuration
  - S3 event routing
  - File download optimization
  - Tesseract configuration for Japanese
  - Bedrock Titan integration
  - OpenSearch bulk indexing
- Performance Optimization
  - Multiprocessing strategies
  - Memory management
  - Connection pooling
  - Caching
- Monitoring and Troubleshooting
  - CloudWatch dashboards
  - Alarms setup
  - Common issues and solutions

**Time to complete**: 1-2 hours

### 3. Cost, Security & Checklist
**File**: `aws-ec2-cost-security-checklist.md`

**Contents:**
- Cost Optimization
  - Spot Instance savings (80%)
  - VPC endpoints ($4,500/month savings)
  - Right-sizing analysis
  - Monthly cost breakdown
- Security Best Practices
  - IAM least privilege
  - Secrets management
  - Network security
  - Encryption at rest/transit
- Production Deployment Checklist
  - Pre-deployment tasks
  - Configuration verification
  - Testing requirements
  - Post-deployment monitoring

**Time to complete**: 30-60 minutes

## Quick Start

### Prerequisites

- AWS account with admin access
- AWS CLI configured
- Tokyo region (ap-northeast-1)
- Basic understanding of EC2, S3, SQS

### Deployment Steps

1. **Read Main Guide** (`aws-ec2-file-processor-guide.md`)
   - Create IAM role and instance profile
   - Create Launch Template with User Data script
   - Create Auto Scaling Group with SQS-based scaling

2. **Configure Integration** (from Advanced Guide)
   - Set up EventBridge rule
   - Configure S3 notifications
   - Create OpenSearch index

3. **Deploy Worker Application**
   - Upload worker.py to S3
   - Configure environment variables
   - Test with single instance

4. **Verify & Monitor**
   - Upload test file to S3
   - Watch CloudWatch dashboard
   - Verify OpenSearch indexing
   - Test Auto Scaling

5. **Review Checklist** (`aws-ec2-cost-security-checklist.md`)
   - Complete all checklist items
   - Configure alarms
   - Set up cost monitoring

## Key Features

### Auto Scaling Based on Queue Depth

```
Queue Messages: 45
Target: 10 messages per instance
Result: ASG scales to 5 instances (45 / 10 = 4.5, rounded up)
```

### Spot Instance Cost Savings

| Configuration | Monthly Cost | Savings |
|---------------|--------------|---------|
| On-Demand EC2 | $366 | - |
| Spot Instances + VPC Endpoints | $123 | 66% |

### Processing Capacity

**Per c5.xlarge instance (4 vCPU, 8GB RAM):**
- Concurrent files: 4 (multiprocessing)
- Processing time: 30-180 seconds per page
- Throughput: 40-80 files/hour

**With Auto Scaling (1-10 instances):**
- Max throughput: 400-800 files/hour
- Scales automatically based on queue depth

## Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| OS | Amazon Linux 2023 | Latest |
| Python | Python | 3.11 |
| OCR | Tesseract | 5.x with jpn+eng |
| Image Processing | Pillow | 10.2.0 |
| PDF Processing | pdf2image, PyPDF2 | Latest |
| AWS SDK | boto3 | 1.34+ |
| Embeddings | Amazon Bedrock | Titan Embed v2 |
| Search | OpenSearch | 2.x |
| Monitoring | CloudWatch Agent | Latest |

## Cost Breakdown (Monthly, Optimized)

| Service | Cost |
|---------|------|
| EC2 Spot Instances (c5.xlarge × 3 avg × 12hr/day) | $37 |
| EBS Volumes (gp3, 30GB × 3) | $9 |
| S3 Storage (1TB) | $23 |
| OpenSearch (t3.small.search) | $25 |
| Bedrock Embeddings (100K files) | $15 |
| CloudWatch + VPC Endpoints + Other | $14 |
| **TOTAL** | **~$123** |

## Security Features

- **Least Privilege IAM**: Minimal permissions per service
- **Encryption at Rest**: S3, EBS, SQS, OpenSearch
- **Network Isolation**: Private subnets, VPC endpoints
- **IMDSv2**: Required for instance metadata
- **Secrets Manager**: For sensitive credentials
- **VPC Flow Logs**: Network traffic monitoring

## Monitoring

### CloudWatch Metrics

- FilesProcessed (Success vs Failed)
- ProcessingTime (p50, p95, p99)
- SQS Queue Depth
- Auto Scaling Group Size
- EC2 CPU and Memory Utilization

### CloudWatch Alarms

- High error rate (>10%)
- Slow processing (p95 >5 minutes)
- Queue backlog (>100 messages)
- No instances running
- High memory usage (>85%)

### CloudWatch Logs

- Application logs (30-day retention)
- Error logs (90-day retention)
- User Data logs (7-day retention)
- VPC Flow Logs

## Common Issues

### Tesseract OOM

**Symptom**: Process killed with exit code 137

**Solution**: Process PDFs in smaller batches, implement memory limits

### Spot Interruptions

**Symptom**: Instances terminated mid-processing

**Solution**: Implement graceful shutdown handler, increase visibility timeout

### DLQ Filling Up

**Symptom**: Messages in Dead Letter Queue

**Solution**: Diagnose failures, fix root cause, reprocess messages

## Performance Optimization

- **Multiprocessing**: 4 parallel OCR processes per instance
- **Connection Pooling**: Reuse AWS SDK connections
- **Caching**: Disk cache for OCR results
- **Batch Processing**: Process PDF pages in batches
- **Memory Management**: Explicit garbage collection

## Testing

### Unit Tests
- OCR functionality
- Thumbnail generation
- Embedding creation
- OpenSearch indexing

### Integration Tests
- End-to-end file processing
- S3 → SQS → EC2 flow
- Error handling
- DLQ behavior

### Performance Tests
- Single instance throughput
- Auto Scaling behavior
- Memory profiling

## Production Readiness

Before going to production, ensure:

- [ ] All checklist items completed
- [ ] Tests passing
- [ ] Monitoring configured
- [ ] Alarms set up
- [ ] Runbook documented
- [ ] Team trained
- [ ] Cost limits configured
- [ ] Security reviewed

## Support

For questions or issues:

1. **Troubleshooting**: Refer to "Common Issues" sections in guides
2. **AWS Documentation**: [EC2](https://docs.aws.amazon.com/ec2/), [Auto Scaling](https://docs.aws.amazon.com/autoscaling/), [Bedrock](https://docs.aws.amazon.com/bedrock/)
3. **CloudWatch Logs**: Check `/aws/cis-file-processor/prod/` log groups
4. **Team**: Consult runbook and incident response procedures

## Additional Resources

- **AWS Well-Architected Framework**: https://aws.amazon.com/architecture/well-architected/
- **Tesseract Documentation**: https://tesseract-ocr.github.io/
- **Bedrock Titan Embeddings**: https://docs.aws.amazon.com/bedrock/latest/userguide/titan-embedding-models.html
- **OpenSearch Documentation**: https://opensearch.org/docs/latest/

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-17 | Initial release |

## Authors

CIS Development Team

---

**Next Steps**:
1. Start with `aws-ec2-file-processor-guide.md`
2. Deploy in development environment
3. Test thoroughly
4. Follow production checklist
5. Monitor and optimize

**Estimated Setup Time**: 4-6 hours for complete deployment

**Monthly Cost**: ~$123 (optimized)

**Processing Capacity**: 400-800 files/hour (with 10 instances)
