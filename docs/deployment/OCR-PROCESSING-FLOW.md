# OCR Processing Flow Architecture

## Overview

This document describes the complete file processing pipeline with Tesseract OCR integration for the CIS File Search Application.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         File Processing Pipeline                         │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────┐        ┌──────────┐        ┌──────────┐        ┌──────────┐
│  Scanner │        │    S3    │        │   SQS    │        │   EC2    │
│    PC    │───────▶│  Bucket  │───────▶│  Queue   │───────▶│  Worker  │
│          │        │          │        │          │        │          │
└──────────┘        └──────────┘        └──────────┘        └──────────┘
                         │                                        │
                         │                                        ▼
                         │                                 ┌──────────┐
                         │                                 │Tesseract │
                         │                                 │   OCR    │
                         │                                 └──────────┘
                         │                                        │
                         │                                        ▼
                         │                                 ┌──────────┐
                         └────────────────────────────────▶│OpenSearch│
                                                           │  Index   │
                                                           └──────────┘
```

---

## Detailed Processing Flow

### Step 1: File Upload Trigger

```
Scanner PC                    S3 Bucket
    │                             │
    │   PUT /files/doc.pdf        │
    ├────────────────────────────▶│
    │                             │
    │   200 OK                    │
    │◀────────────────────────────┤
    │                             │
    │                          ┌──┴──┐
    │                          │Event│
    │                          │Notif│
    │                          └──┬──┘
    │                             │
    ▼                             ▼
```

### Step 2: Event Processing

```
S3 Event                 EventBridge              SQS Queue
    │                         │                       │
    │   S3:ObjectCreated      │                       │
    ├────────────────────────▶│                       │
    │                         │                       │
    │                         │   Send Message        │
    │                         ├──────────────────────▶│
    │                         │                       │
    │                         │                    ┌──┴──┐
    │                         │                    │Msg  │
    │                         │                    │Queue│
    │                         │                    └─────┘
    ▼                         ▼                       ▼
```

### Step 3: Worker Processing

```
EC2 Worker                  SQS Queue              S3 Bucket
    │                         │                       │
    │   Poll for messages     │                       │
    ├────────────────────────▶│                       │
    │                         │                       │
    │   Message (file info)   │                       │
    │◀────────────────────────┤                       │
    │                         │                       │
    │   Download file         │                       │
    ├───────────────────────────────────────────────▶│
    │                         │                       │
    │   File bytes            │                       │
    │◀───────────────────────────────────────────────┤
    │                         │                       │
    ▼                         ▼                       ▼
```

### Step 4: OCR Processing

```
Worker Process           Tesseract OCR         Temporary Storage
    │                         │                       │
    │   Save to /tmp          │                       │
    ├───────────────────────────────────────────────▶│
    │                         │                       │
    │   Extract text          │                       │
    ├────────────────────────▶│                       │
    │                         │                       │
    │                         │   Read file           │
    │                         ├──────────────────────▶│
    │                         │                       │
    │                         │   File bytes          │
    │                         │◀──────────────────────┤
    │                         │                       │
    │                         │   Process (OCR)       │
    │                         │   - Load image        │
    │                         │   - Analyze           │
    │                         │   - Extract text      │
    │                         │                       │
    │   Extracted text        │                       │
    │◀────────────────────────┤                       │
    │                         │                       │
    │   Clean up /tmp         │                       │
    ├───────────────────────────────────────────────▶│
    │                         │                       │
    ▼                         ▼                       ▼
```

### Step 5: Indexing to OpenSearch

```
Worker Process          OpenSearch            SQS Queue
    │                       │                     │
    │   Index document      │                     │
    ├──────────────────────▶│                     │
    │                       │                     │
    │   PUT /file-index/_doc│                     │
    │   {                   │                     │
    │     file_path: ...,   │                     │
    │     text: ...,        │                     │
    │     metadata: ...     │                     │
    │   }                   │                     │
    │                       │                     │
    │   200 OK              │                     │
    │◀──────────────────────┤                     │
    │                       │                     │
    │   Delete message      │                     │
    ├─────────────────────────────────────────────▶│
    │                       │                     │
    │   200 OK              │                     │
    │◀─────────────────────────────────────────────┤
    │                       │                     │
    ▼                       ▼                     ▼
```

---

## Component Details

### 1. Python Worker (EC2)

**Location**: `/backend/python-worker/file_processor_example.py`

**Responsibilities**:
- Poll SQS queue for new file events
- Download files from S3
- Perform OCR text extraction
- Index extracted data to OpenSearch
- Handle errors and retries

**Dependencies**:
- Python 3.11
- pytesseract
- Pillow (PIL)
- pdf2image
- boto3
- opensearch-py

### 2. Tesseract OCR Engine

**Location**: `/usr/local/bin/tesseract` (source install) or `/usr/bin/tesseract` (package)

**Responsibilities**:
- Read image/PDF files
- Analyze character patterns
- Extract text in multiple languages (Japanese + English)
- Return plain text output

**Configuration**:
- Language data: `/usr/local/share/tessdata/`
- Supported languages: jpn, eng
- OCR Engine Mode: 3 (Default)
- Page Segmentation Mode: 6 (Single block)

### 3. OCR Config Module

**Location**: `/backend/python-worker/ocr_config.py`

**Responsibilities**:
- Auto-detect Tesseract paths
- Provide high-level OCR API
- Handle different file types (image, PDF)
- Calculate confidence scores
- Error handling and logging

**Key Classes**:
- `OCRProcessor`: Main processing class
- `TesseractConfig`: Configuration constants

---

## Data Flow Details

### Message Format (SQS)

```json
{
  "Records": [
    {
      "eventVersion": "2.1",
      "eventSource": "aws:s3",
      "awsRegion": "ap-northeast-1",
      "eventTime": "2025-01-21T12:00:00.000Z",
      "eventName": "ObjectCreated:Put",
      "s3": {
        "bucket": {
          "name": "cis-filesearch-storage",
          "arn": "arn:aws:s3:::cis-filesearch-storage"
        },
        "object": {
          "key": "uploads/2025/01/document.pdf",
          "size": 1048576,
          "eTag": "abc123...",
          "sequencer": "xyz789..."
        }
      }
    }
  ]
}
```

### Processing Result (OpenSearch)

```json
{
  "file_key": "uploads/2025/01/document.pdf",
  "bucket": "cis-filesearch-storage",
  "file_name": "document.pdf",
  "file_path": "uploads/2025/01/document.pdf",
  "file_type": ".pdf",
  "extracted_text": "これはテストドキュメントです。\nThis is a test document.",
  "char_count": 45,
  "word_count": 8,
  "processed_at": "2025-01-21T12:00:05.123Z",
  "processor_version": "1.0.0",
  "ocr_language": "jpn+eng",
  "ocr_confidence": 87.5
}
```

---

## Error Handling

### Retry Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                     Error Handling Flow                      │
└─────────────────────────────────────────────────────────────┘

    ┌──────────────┐
    │ Process File │
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐       ┌─────────────┐
    │   Success?   │──Yes─▶│Delete from  │
    └──────┬───────┘       │   SQS       │
           │               └─────────────┘
          No
           │
           ▼
    ┌──────────────┐       ┌─────────────┐
    │Retry Count < │──Yes─▶│Return to    │
    │     3?       │       │   Queue     │
    └──────┬───────┘       └─────────────┘
           │
          No
           │
           ▼
    ┌──────────────┐
    │Send to Dead  │
    │Letter Queue  │
    └──────────────┘
```

### Error Types and Handling

| Error Type | Handling Strategy | Retry |
|------------|------------------|-------|
| Download failure | Retry with exponential backoff | 3 times |
| OCR timeout | Process with lower DPI, or skip | 2 times |
| Invalid file format | Log and skip | No |
| OpenSearch unavailable | Retry with backoff | 5 times |
| Out of memory | Reduce batch size, add swap | No |
| Missing language data | Alert, manual fix required | No |

---

## Performance Optimization

### Parallel Processing

```
┌────────────────────────────────────────────────────────────────┐
│              Multi-Worker Architecture                          │
└────────────────────────────────────────────────────────────────┘

         SQS Queue
             │
     ┌───────┼───────┐
     │       │       │
     ▼       ▼       ▼
  Worker  Worker  Worker
    1       2       3
     │       │       │
     └───────┼───────┘
             │
             ▼
        OpenSearch
```

**Configuration**:
- Multiple EC2 instances in Auto Scaling Group
- Each polls SQS independently
- SQS ensures message is processed only once
- Scale based on queue depth

### Resource Allocation

```python
# Recommended EC2 instance configurations

Development:
  - Instance: t3.medium
  - vCPU: 2
  - RAM: 4 GB
  - Workers: 1-2
  - Cost: ~$30/month

Production (Low Volume):
  - Instance: c5.xlarge
  - vCPU: 4
  - RAM: 8 GB
  - Workers: 4
  - Cost: ~$125/month

Production (High Volume):
  - Instance: c5.2xlarge
  - vCPU: 8
  - RAM: 16 GB
  - Workers: 8
  - Cost: ~$250/month
  - Auto Scaling: 1-5 instances
```

---

## Monitoring and Logging

### CloudWatch Metrics

```
┌─────────────────────────────────────────────────────────────┐
│                    Monitoring Points                         │
└─────────────────────────────────────────────────────────────┘

┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  SQS Metrics     │     │  Worker Metrics  │     │OpenSearch Metrics│
├──────────────────┤     ├──────────────────┤     ├──────────────────┤
│• Messages sent   │     │• CPU utilization │     │• Index rate      │
│• Messages visible│     │• Memory usage    │     │• Search latency  │
│• Messages deleted│     │• Processing time │     │• Document count  │
│• Age of oldest   │     │• Error rate      │     │• Storage used    │
└──────────────────┘     └──────────────────┘     └──────────────────┘
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │   CloudWatch     │
                         │   Dashboard      │
                         └──────────────────┘
```

### Key Metrics to Monitor

| Metric | Threshold | Alert Action |
|--------|-----------|--------------|
| Queue depth | > 1000 | Scale up workers |
| Processing time | > 60s/file | Investigate performance |
| Error rate | > 5% | Check logs, DLQ |
| CPU usage | > 80% | Scale up instance |
| Memory usage | > 85% | Add swap or scale up |
| OCR confidence | < 70% | Review image quality |

### Log Structure

```json
{
  "timestamp": "2025-01-21T12:00:00.123Z",
  "level": "INFO",
  "component": "file-processor",
  "event": "file_processed",
  "details": {
    "file_key": "uploads/2025/01/document.pdf",
    "file_size_mb": 1.2,
    "processing_time_ms": 4523,
    "ocr_time_ms": 3821,
    "text_length": 1245,
    "confidence": 87.5,
    "status": "success"
  }
}
```

---

## Security Considerations

### Data Flow Security

```
┌─────────────────────────────────────────────────────────────┐
│                    Security Layers                           │
└─────────────────────────────────────────────────────────────┘

Scanner PC          VPN/PrivateLink        AWS VPC
    │                     │                    │
    │   Encrypted         │                    │
    │   Connection        │                    │
    ├────────────────────▶│                    │
    │                     │                    │
    │                     │   S3 VPC Endpoint  │
    │                     ├───────────────────▶│
    │                     │                    │
    │                     │   Private Subnet   │
    │                     │   ┌──────────────┐ │
    │                     │   │EC2 Worker    │ │
    │                     │   │(No public IP)│ │
    │                     │   └──────────────┘ │
    │                     │                    │
    ▼                     ▼                    ▼
```

### IAM Permissions (Least Privilege)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::cis-filesearch-storage/uploads/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:ap-northeast-1:*:file-processing-queue"
    },
    {
      "Effect": "Allow",
      "Action": [
        "es:ESHttpPost",
        "es:ESHttpPut"
      ],
      "Resource": "arn:aws:es:ap-northeast-1:*:domain/filesearch/*"
    }
  ]
}
```

---

## Production Deployment

### Pre-Deployment Checklist

- [ ] Tesseract installed and tested
- [ ] Japanese language data available
- [ ] Python dependencies installed
- [ ] AWS credentials configured
- [ ] IAM roles assigned
- [ ] VPC and subnets configured
- [ ] Security groups configured
- [ ] S3 bucket created
- [ ] SQS queue created
- [ ] EventBridge rule configured
- [ ] OpenSearch cluster ready
- [ ] CloudWatch logging enabled
- [ ] Monitoring dashboard created
- [ ] Auto Scaling group configured
- [ ] Dead Letter Queue configured

### Systemd Service Configuration

```ini
[Unit]
Description=File Processor Worker with OCR
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/home/ec2-user
Environment="TESSDATA_PREFIX=/usr/local/share/tessdata"
Environment="AWS_REGION=ap-northeast-1"
Environment="S3_BUCKET=cis-filesearch-storage"
Environment="SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/.../file-processing"
ExecStart=/usr/bin/python3.11 /home/ec2-user/file_processor_example.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

---

## Troubleshooting Guide

### Common Issues

#### Issue: Files not being processed

**Check**:
```bash
# 1. Check SQS queue
aws sqs get-queue-attributes --queue-url $SQS_QUEUE_URL --attribute-names All

# 2. Check worker logs
sudo journalctl -u file-processor -f

# 3. Check worker is running
systemctl status file-processor
```

#### Issue: OCR quality is poor

**Solutions**:
- Increase PDF DPI (300 → 400)
- Improve source image quality
- Use appropriate page segmentation mode
- Ensure correct language is set

#### Issue: High memory usage

**Solutions**:
```bash
# Add swap space
sudo dd if=/dev/zero of=/swapfile bs=1G count=4
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Or scale up EC2 instance
# t3.medium → c5.xlarge
```

---

## Summary

This OCR processing pipeline provides:

✅ **Scalable**: Auto Scaling based on queue depth
✅ **Reliable**: Retry logic and Dead Letter Queue
✅ **Efficient**: Parallel processing with multiple workers
✅ **Monitored**: Comprehensive CloudWatch metrics
✅ **Secure**: VPC, IAM, and encryption
✅ **Production-Ready**: Error handling and logging

The system can process **hundreds of files per hour** with proper scaling configuration.

---

## Related Documentation

- **Installation Guide**: `/docs/deployment/TESSERACT-INSTALLATION-GUIDE.md`
- **Quick Reference**: `/docs/deployment/TESSERACT-QUICK-REFERENCE.md`
- **Setup Summary**: `/TESSERACT-SETUP-SUMMARY.md`
- **OCR Config**: `/backend/python-worker/ocr_config.py`
