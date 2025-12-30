# Python Worker - OCR File Processor

## Overview

This directory contains the Python Worker component for the CIS File Search Application. The worker performs OCR (Optical Character Recognition) on files uploaded to S3, extracting text content for indexing to OpenSearch.

## Features

- ✅ **Tesseract OCR Integration**: Extract text from images and PDFs
- ✅ **Japanese Language Support**: Full Japanese + English OCR capability
- ✅ **S3 Integration**: Download files from S3 buckets
- ✅ **SQS Integration**: Event-driven processing via message queue
- ✅ **OpenSearch Integration**: Index extracted text for fast searching
- ✅ **Error Handling**: Retry logic and dead letter queue support
- ✅ **Production Ready**: Logging, monitoring, and error recovery

## Prerequisites

### System Requirements

- **OS**: Amazon Linux 2023
- **Python**: 3.11+
- **Tesseract**: 5.3.3+
- **Memory**: 4 GB minimum (8 GB recommended)
- **CPU**: 2 vCPU minimum (4 vCPU recommended)

### Required System Packages

```bash
# Tesseract OCR (see installation guide)
sudo bash /tmp/install-tesseract-al2023.sh

# Poppler for PDF processing
sudo dnf install -y poppler-utils
```

### Required Python Packages

```bash
pip3.11 install -r requirements-ocr.txt
```

## Files in This Directory

| File | Purpose |
|------|---------|
| `ocr_config.py` | OCR processor module with Tesseract integration |
| `file_processor_example.py` | Complete S3→SQS→OCR→OpenSearch pipeline |
| `test_ocr_setup.py` | Comprehensive OCR setup testing script |
| `requirements-ocr.txt` | Python dependencies for OCR |
| `README.md` | This file |

## Quick Start

### 1. Install Tesseract

```bash
# Upload and run installation script
sudo bash /tmp/install-tesseract-al2023.sh

# Load environment variables (if installed from source)
source /etc/profile.d/tesseract.sh
```

### 2. Install Python Dependencies

```bash
pip3.11 install -r requirements-ocr.txt
```

### 3. Test OCR Setup

```bash
# Run comprehensive tests
python3.11 test_ocr_setup.py --verbose

# Test with your own image
python3.11 test_ocr_setup.py --test-file /path/to/image.jpg
```

### 4. Configure Environment

```bash
# Set AWS credentials and region
export AWS_REGION=ap-northeast-1
export S3_BUCKET=cis-filesearch-storage
export SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/xxx/file-processing
export OPENSEARCH_ENDPOINT=https://xxx.ap-northeast-1.es.amazonaws.com
```

### 5. Run File Processor

```bash
# Start processing files
python3.11 file_processor_example.py --queue-url $SQS_QUEUE_URL
```

## Usage Examples

### Basic OCR

```python
from ocr_config import OCRProcessor

# Initialize processor
ocr = OCRProcessor()

# Extract text from image (Japanese)
text = ocr.extract_text_from_image('document.jpg', lang='jpn')
print(text)

# Extract text from image (Japanese + English)
text = ocr.extract_text_from_image('document.jpg', lang='jpn+eng')
print(text)
```

### PDF Processing

```python
from ocr_config import OCRProcessor

ocr = OCRProcessor()

# Extract from entire PDF
text = ocr.extract_text_from_pdf('document.pdf', lang='jpn+eng')

# Extract specific pages
text = ocr.extract_text_from_pdf(
    'document.pdf',
    lang='jpn+eng',
    first_page=1,
    last_page=10
)

# Faster processing with lower DPI
text = ocr.extract_text_from_pdf('document.pdf', dpi=150)
```

### With Confidence Scores

```python
from ocr_config import OCRProcessor

ocr = OCRProcessor()

# Get text with confidence scores
result = ocr.extract_text_with_confidence('document.jpg', lang='jpn')

print(f"Text: {result['text']}")
print(f"Confidence: {result['confidence']}%")
print(f"Words: {result['word_count']}")
print(f"Low confidence words: {result['low_confidence_words']}")
```

### S3 + OCR Integration

```python
import boto3
from ocr_config import OCRProcessor

# Initialize
s3 = boto3.client('s3')
ocr = OCRProcessor()

# Download from S3
bucket = 'my-bucket'
key = 'files/document.pdf'
local_path = '/tmp/document.pdf'

s3.download_file(bucket, key, local_path)

# Process with OCR
text = ocr.extract_text_from_pdf(local_path, lang='jpn+eng')

# Upload result
s3.put_object(
    Bucket=bucket,
    Key=f'results/{key}.txt',
    Body=text.encode('utf-8')
)

# Clean up
import os
os.remove(local_path)
```

## Configuration Options

### OCR Configuration

```python
from ocr_config import TesseractConfig, OCRProcessor

# Default configuration (auto-detected paths)
ocr = OCRProcessor()

# Custom Tesseract path
ocr = OCRProcessor(
    tesseract_cmd='/usr/local/bin/tesseract',
    tessdata_prefix='/usr/local/share/tessdata'
)

# Get processor info
info = ocr.get_info()
print(info)
```

### Processing Configuration

```python
from file_processor_example import FileProcessorConfig

# Environment variables (preferred)
export AWS_REGION=ap-northeast-1
export S3_BUCKET=my-bucket
export SQS_QUEUE_URL=https://sqs...
export OPENSEARCH_ENDPOINT=https://...

# Or modify in code
FileProcessorConfig.AWS_REGION = 'ap-northeast-1'
FileProcessorConfig.S3_BUCKET = 'my-bucket'
FileProcessorConfig.MAX_FILE_SIZE_MB = 100
FileProcessorConfig.PDF_DPI = 300
```

## Testing

### Run All Tests

```bash
python3.11 test_ocr_setup.py --verbose
```

### Test Specific Components

```bash
# Test imports
python3.11 -c "import pytesseract; print('OK')"

# Test Tesseract binary
tesseract --version
tesseract --list-langs

# Test OCR config module
python3.11 -c "from ocr_config import OCRProcessor; OCRProcessor()"

# Test with sample file
python3.11 test_ocr_setup.py --test-file /path/to/test.jpg
```

## Performance Optimization

### Processing Speed

```python
# Faster processing with lower DPI (trade-off: accuracy)
text = ocr.extract_text_from_pdf('file.pdf', dpi=150)  # Default: 300

# Process specific pages only
text = ocr.extract_text_from_pdf('file.pdf', first_page=1, last_page=5)

# Use optimized PSM mode
from ocr_config import TesseractConfig
config = f'--oem 3 --psm {TesseractConfig.PSM_SINGLE_BLOCK} -l jpn'
text = ocr.extract_text_from_image('image.jpg', config=config)
```

### Parallel Processing

```python
from concurrent.futures import ThreadPoolExecutor
from ocr_config import OCRProcessor

def process_file(file_path):
    ocr = OCRProcessor()
    return ocr.extract_text_from_image(file_path, lang='jpn')

# Process multiple files in parallel
files = ['file1.jpg', 'file2.jpg', 'file3.jpg']

with ThreadPoolExecutor(max_workers=4) as executor:
    results = list(executor.map(process_file, files))
```

## Production Deployment

### 1. Create Systemd Service

```bash
sudo tee /etc/systemd/system/file-processor.service << 'EOF'
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
Environment="SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/.../queue"
Environment="OPENSEARCH_ENDPOINT=https://xxx.ap-northeast-1.es.amazonaws.com"
ExecStart=/usr/bin/python3.11 /home/ec2-user/file_processor_example.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

### 2. Enable and Start Service

```bash
sudo systemctl daemon-reload
sudo systemctl enable file-processor
sudo systemctl start file-processor
```

### 3. Monitor Service

```bash
# Check status
sudo systemctl status file-processor

# View logs
sudo journalctl -u file-processor -f

# Restart if needed
sudo systemctl restart file-processor
```

## Troubleshooting

### Common Issues

#### Tesseract not found

```bash
# Check installation
which tesseract

# Add to PATH
export PATH=$PATH:/usr/local/bin

# Set permanently
echo 'export PATH=$PATH:/usr/local/bin' >> ~/.bashrc
```

#### Language data not found

```bash
# Check environment
echo $TESSDATA_PREFIX

# Set TESSDATA_PREFIX
export TESSDATA_PREFIX=/usr/local/share/tessdata

# Set permanently
echo 'export TESSDATA_PREFIX=/usr/local/share/tessdata' >> ~/.bashrc
```

#### PDF processing fails

```bash
# Install poppler-utils
sudo dnf install -y poppler-utils

# Verify installation
pdftoppm -v
```

#### Low OCR accuracy

```python
# Try higher DPI
text = ocr.extract_text_from_pdf('file.pdf', dpi=400)

# Use confidence checking
result = ocr.extract_text_with_confidence('file.jpg', lang='jpn')
if result['confidence'] < 70:
    print("Warning: Low confidence OCR result")
```

### Debug Mode

```python
import logging
logging.basicConfig(level=logging.DEBUG)

from ocr_config import OCRProcessor
ocr = OCRProcessor()
```

## Monitoring and Logging

### CloudWatch Logs

```python
import logging
import watchtower

# Configure CloudWatch logging
logger = logging.getLogger(__name__)
logger.addHandler(watchtower.CloudWatchLogHandler(
    log_group='/aws/ec2/file-processor',
    stream_name='ocr-worker'
))
```

### Metrics to Track

- Processing time per file
- OCR confidence scores
- Error rates
- Queue depth
- CPU/Memory usage

## Directory Structure

```
backend/python-worker/
├── ocr_config.py              # OCR processor module
├── file_processor_example.py  # Main worker script
├── test_ocr_setup.py          # Testing script
├── requirements-ocr.txt       # Python dependencies
└── README.md                  # This file
```

## Related Documentation

- **Installation Guide**: `/docs/deployment/TESSERACT-INSTALLATION-GUIDE.md`
- **Quick Reference**: `/docs/deployment/TESSERACT-QUICK-REFERENCE.md`
- **Setup Summary**: `/TESSERACT-SETUP-SUMMARY.md`
- **Processing Flow**: `/docs/deployment/OCR-PROCESSING-FLOW.md`

## Worker Deployment Verification

新しいworkerインスタンスが実際にファイル処理を行っているか検証するためのツール群が用意されています。

### Quick Verification

```bash
# 最も簡単な方法：クイック検証
python3 quick-verify.py

# 詳細な分析
python3 analyze-logs.py --minutes 60 --file-types --opensearch

# インタラクティブな調査
./ssm-connect.sh
```

### Verification Tools

| Tool | Purpose |
|------|---------|
| `quick-verify.py` | クイック検証スクリプト（推奨） |
| `analyze-logs.py` | 詳細CloudWatchログ解析 |
| `verify-deployment.sh` | 包括的検証スクリプト |
| `check-opensearch.sh` | OpenSearch検証 |
| `ssm-connect.sh` | インタラクティブSSMツール |
| `VERIFICATION_GUIDE.md` | 詳細な検証ガイド |

### Success Criteria

デプロイが成功している場合:

1. ✅ CloudWatchログに "Indexed to OpenSearch" メッセージが存在
2. ✅ OpenSearchインデックスのドキュメント数が増加
3. ✅ ファイルタイプが正しく検出
4. ✅ DocuWorksファイルの関連追跡が動作
5. ✅ エラー率が5%未満
6. ✅ 処理率が受信メッセージの80%以上

詳細は `VERIFICATION_GUIDE.md` を参照してください。

## Support

For issues or questions:

1. Check the **Troubleshooting** section above
2. Review the full installation guide
3. Run the test script: `python3.11 test_ocr_setup.py --verbose`
4. Check system logs: `sudo journalctl -u file-processor -f`
5. For deployment verification: `python3 quick-verify.py`

## License

Part of the CIS File Search Application project.

---

**Ready to process files with OCR!** 🚀
