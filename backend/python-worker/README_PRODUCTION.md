# Python Worker - Production File Processing Pipeline

## Overview

Enterprise-grade file processing worker for AWS EC2 that handles large-scale document processing with support for multiple file formats including Office documents, PDFs, images, and DocuWorks files.

### Key Features

- **Multi-Format Support**: Office (Word, Excel, PowerPoint), PDF, Images, DocuWorks (.xdw)
- **Intelligent Processing**: Automatic file type detection and routing
- **OCR Integration**: Tesseract OCR with Japanese + English support
- **AWS Integration**: S3, SQS, OpenSearch, CloudWatch
- **Production Ready**: Error handling, retry logic, graceful shutdown
- **Scalable**: Designed for 10TB+ datasets with 5M+ files
- **Monitoring**: Comprehensive logging and statistics

## Architecture

```
S3 Landing Bucket
    ↓ (EventBridge Trigger)
SQS Queue
    ↓ (Poll)
EC2 Worker (Python)
    ├── Download from S3
    ├── File Type Detection
    ├── Route to Processor
    │   ├── Image Processor (OCR)
    │   ├── PDF Processor (Text/OCR)
    │   ├── Office Processor (Extract)
    │   └── DocuWorks Processor (SDK/OCR)
    ├── Generate Thumbnail
    └── Index to OpenSearch
```

## Directory Structure

```
python-worker/
├── config.py                      # Configuration management
├── worker.py                      # Main worker entry point
├── file_router.py                 # File type routing
├── opensearch_client.py           # OpenSearch integration
├── requirements.txt               # Python dependencies
├── processors/                    # File type processors
│   ├── __init__.py
│   ├── base_processor.py         # Abstract base class
│   ├── image_processor.py        # Image + OCR
│   ├── pdf_processor.py          # PDF text/OCR
│   ├── office_processor.py       # Office documents
│   └── docuworks_processor.py    # DocuWorks files
├── deployment/                    # Deployment files
│   ├── file-processor.service    # systemd service
│   ├── install.sh                # Installation script
│   └── ec2-user-data.sh          # EC2 launch config
├── .env.example                   # Environment template
├── Dockerfile                     # Container build
├── docker-compose.yml            # Docker compose
└── README_PRODUCTION.md          # This file
```

## Prerequisites

### System Requirements

- **OS**: Amazon Linux 2023
- **Python**: 3.11+
- **CPU**: 4 vCPU (minimum 2)
- **Memory**: 8GB (minimum 4GB)
- **Storage**: 50GB+ for temporary files

### AWS Services

- S3 bucket for file storage
- SQS queue for job management
- OpenSearch domain for indexing
- IAM role with appropriate permissions
- CloudWatch for logging (optional)

### System Dependencies

- Tesseract OCR 5.3.3+
- Poppler Utils (PDF processing)
- ImageMagick (thumbnail generation)
- LibreOffice (optional, for Office conversion)

## Quick Start

### 1. EC2 Instance Setup

```bash
# Launch EC2 instance (t3.xlarge or larger recommended)
# Amazon Linux 2023 AMI
# Attach IAM role with S3, SQS, OpenSearch permissions

# SSH to instance
ssh -i your-key.pem ec2-user@your-instance-ip
```

### 2. Install Dependencies

```bash
# Clone repository or download files
cd /home/ec2-user
# (Upload files or clone from git)

# Run installation script
cd python-worker
bash deployment/install.sh
```

### 3. Configure Environment

```bash
# Copy and edit environment file
cp .env.example .env
nano .env

# Required settings:
# - AWS_REGION
# - S3_BUCKET
# - SQS_QUEUE_URL
# - OPENSEARCH_ENDPOINT
```

### 4. Test Configuration

```bash
# Validate configuration
python3.11 worker.py --validate-only

# Create OpenSearch index
python3.11 worker.py --create-index
```

### 5. Start Service

```bash
# Start worker
sudo systemctl start file-processor

# Check status
sudo systemctl status file-processor

# View logs
sudo journalctl -u file-processor -f
```

## Configuration

### Environment Variables

See `.env.example` for complete list. Key configurations:

#### AWS Configuration
```bash
AWS_REGION=ap-northeast-1
S3_BUCKET=your-bucket-name
SQS_QUEUE_URL=https://sqs.region.amazonaws.com/account/queue
OPENSEARCH_ENDPOINT=https://search-domain.region.es.amazonaws.com
```

#### Processing Configuration
```bash
MAX_FILE_SIZE_MB=100
MAX_WORKERS=4
PROCESSING_TIMEOUT=300
```

#### OCR Configuration
```bash
OCR_LANGUAGE=jpn+eng
PDF_DPI=300
MIN_OCR_CONFIDENCE=50.0
```

### IAM Permissions

The EC2 instance role needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::your-bucket/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:region:account:queue-name"
    },
    {
      "Effect": "Allow",
      "Action": [
        "es:ESHttpPost",
        "es:ESHttpPut",
        "es:ESHttpGet"
      ],
      "Resource": "arn:aws:es:region:account:domain/domain-name/*"
    }
  ]
}
```

## File Processing

### Supported File Types

| Format | Extensions | Processor | Features |
|--------|-----------|-----------|----------|
| Images | .jpg, .png, .bmp, .gif, .tiff | ImageProcessor | OCR, Thumbnail |
| PDF | .pdf | PDFProcessor | Text extraction, OCR fallback |
| Word | .doc, .docx | OfficeProcessor | Text extraction |
| Excel | .xls, .xlsx | OfficeProcessor | Cell data extraction |
| PowerPoint | .ppt, .pptx | OfficeProcessor | Slide text extraction |
| DocuWorks | .xdw, .xbd | DocuWorksProcessor | SDK or OCR fallback |

### Processing Pipeline

1. **SQS Message Reception**: Worker polls SQS for new files
2. **S3 Download**: File downloaded to temporary storage
3. **Type Detection**: File extension and MIME type analysis
4. **Routing**: Appropriate processor selected
5. **Processing**: Text extraction, OCR if needed
6. **Thumbnail Generation**: First page/image thumbnail
7. **OpenSearch Indexing**: Document indexed for search
8. **Cleanup**: Temporary files removed
9. **SQS Deletion**: Message deleted on success

### Performance Optimization

#### File Size Limits
```python
# Adjust in .env
MAX_FILE_SIZE_MB=100       # Overall limit
MAX_IMAGE_SIZE_MB=50       # Images
MAX_PDF_SIZE_MB=100        # PDFs
MAX_OFFICE_SIZE_MB=100     # Office docs
```

#### OCR Optimization
```python
# Trade-off: Speed vs Accuracy
PDF_DPI=300                # Lower = faster (150-400)
IMAGE_PREPROCESSING=true   # Enable/disable preprocessing
MAX_PDF_PAGES=1000        # Limit pages processed
```

#### Concurrency
```python
MAX_WORKERS=4             # Parallel processing threads
SQS_MAX_MESSAGES=1        # Messages per poll (1-10)
```

## Deployment Options

### Option 1: Systemd Service (Recommended)

```bash
# Install and enable
bash deployment/install.sh

# Manage service
sudo systemctl start file-processor
sudo systemctl stop file-processor
sudo systemctl restart file-processor
sudo systemctl status file-processor

# View logs
sudo journalctl -u file-processor -f
sudo journalctl -u file-processor --since "1 hour ago"
```

### Option 2: Docker

```bash
# Build image
docker build -t file-processor-worker .

# Run with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### Option 3: Auto Scaling Group

```bash
# Use deployment/ec2-user-data.sh
# Configure in Launch Template or ASG
# Worker starts automatically on instance launch

# Monitor with CloudWatch
# Scale based on SQS queue depth
```

## Monitoring and Troubleshooting

### Health Checks

```bash
# Service status
sudo systemctl status file-processor

# Recent logs
sudo journalctl -u file-processor --since "10 min ago"

# Process info
ps aux | grep python3.11

# Resource usage
htop
df -h
free -h
```

### Common Issues

#### 1. Tesseract Not Found
```bash
# Check installation
which tesseract
tesseract --version

# Set environment
export TESSDATA_PREFIX=/usr/local/share/tessdata
```

#### 2. SQS Connection Error
```bash
# Check IAM permissions
aws sts get-caller-identity

# Test SQS access
aws sqs get-queue-attributes --queue-url $SQS_QUEUE_URL
```

#### 3. OpenSearch Connection Failed
```bash
# Check endpoint
curl -XGET https://your-endpoint.es.amazonaws.com

# Verify IAM role
aws iam get-role --role-name YourEC2Role
```

#### 4. Out of Memory
```bash
# Check memory usage
free -h

# Reduce concurrent workers
# Edit .env: MAX_WORKERS=2

# Restart service
sudo systemctl restart file-processor
```

### Performance Metrics

Worker logs statistics every run:

```
=== Worker Statistics ===
Runtime: 3600 seconds (1.00 hours)
Total Processed: 150
Succeeded: 145
Failed: 5
Success Rate: 96.7%
Throughput: 150.0 files/hour
========================
```

## Scaling Considerations

### For 10TB / 5M Files

#### Single Instance Capacity
- **Throughput**: ~100-200 files/hour (depends on file size)
- **Processing Time**: 5-10 seconds per file average
- **Daily Capacity**: ~2,400-4,800 files/day

#### Scaling Strategy

1. **Vertical Scaling**
   - Use larger instance types (c6i.4xlarge, c6i.8xlarge)
   - More CPU = more concurrent processing

2. **Horizontal Scaling**
   - Auto Scaling Group with 5-10 workers
   - SQS handles distribution automatically
   - No coordination needed between workers

3. **SQS Configuration**
   - Visibility timeout: 300 seconds (5 minutes)
   - Message retention: 14 days
   - Dead letter queue for failed messages

4. **Cost Optimization**
   - Use Spot Instances (50-70% cost savings)
   - Auto-scale based on SQS queue depth
   - Schedule scaling for batch operations

### Estimated Processing Time

For 5M files:
- Single worker: ~100 days
- 10 workers: ~10 days
- 50 workers: ~2 days

## DocuWorks Processing

### Requirements

DocuWorks processing requires:
- DocuWorks Viewer or SDK (commercial license)
- Windows environment (DocuWorks is Windows-only)
- Fuji Xerox license key

### Implementation Options

#### Option 1: Windows EC2 Instance
```bash
# Launch Windows Server 2022
# Install DocuWorks SDK
# Install Python for Windows
# Configure COM integration
```

#### Option 2: OCR Fallback (Current)
```python
# Automatic fallback to OCR
# No DocuWorks license needed
# Lower accuracy for complex layouts
DOCUWORKS_OCR_FALLBACK=true
```

#### Option 3: Hybrid Approach
```
# Linux workers for most files
# Dedicated Windows worker for .xdw files
# Route .xdw messages to separate SQS queue
```

## Backup and Recovery

### Failed Message Handling

```bash
# SQS Dead Letter Queue
# Messages that fail 3 times go to DLQ

# Check DLQ
aws sqs receive-message --queue-url $DLQ_URL

# Reprocess failed files
# Redrive messages back to main queue
```

### Data Persistence

```bash
# S3 retention
# Keep original files for reprocessing

# OpenSearch snapshots
# Regular index backups to S3
```

## Security Best Practices

1. **IAM Roles**: Use EC2 instance roles, not access keys
2. **VPC**: Run EC2 in private subnet with VPC endpoints
3. **Security Groups**: Restrict inbound to SSH only (if needed)
4. **Encryption**: Enable encryption at rest for S3 and OpenSearch
5. **Secrets**: Use AWS Secrets Manager for sensitive config
6. **Updates**: Regular security patches and updates

## Maintenance

### Regular Tasks

```bash
# Update system packages
sudo dnf update -y

# Restart service after updates
sudo systemctl restart file-processor

# Clean old logs
sudo journalctl --vacuum-time=7d

# Check disk space
df -h
du -sh /tmp/file-processor
```

### Log Rotation

Configured automatically by installation script:
```
/var/log/file-processor.log {
    daily
    rotate 7
    compress
    delaycompress
}
```

## Support and Resources

### Documentation
- `/docs/deployment/` - Deployment guides
- `/docs/deployment/OCR-PROCESSING-FLOW.md` - Processing details
- `/docs/deployment/TESSERACT-INSTALLATION-GUIDE.md` - OCR setup

### Troubleshooting
1. Check service logs: `sudo journalctl -u file-processor`
2. Validate config: `python3.11 worker.py --validate-only`
3. Test components individually
4. Review CloudWatch metrics

### Getting Help
- Check existing documentation
- Review log files for errors
- Test with small file samples first
- Verify AWS service quotas

## License

Part of the CIS File Search Application project.

---

**Production Ready File Processing at Scale** 🚀
