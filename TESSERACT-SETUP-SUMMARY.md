# Tesseract OCR Setup Summary for Amazon Linux 2023

## Executive Summary

This document provides you with everything needed to install and configure Tesseract OCR with Japanese language support on Amazon Linux 2023 EC2 instances for your Python Worker.

---

## 📋 What You Need to Do on Your EC2 Instance

### Step 1: Upload Installation Script

From your **local machine**:

```bash
# Upload the installation script to EC2
scp /Users/tatsuya/focus_project/cis_filesearch_app/scripts/install-tesseract-al2023.sh ec2-user@<YOUR-EC2-IP>:/tmp/
```

### Step 2: SSH to EC2 and Run Installation

```bash
# SSH to your EC2 instance
ssh ec2-user@<YOUR-EC2-IP>

# Run the installation script
sudo bash /tmp/install-tesseract-al2023.sh

# If installed from source, load environment variables
source /etc/profile.d/tesseract.sh

# Install poppler for PDF processing
sudo dnf install -y poppler-utils
```

### Step 3: Install Python Dependencies

```bash
# Install Python packages
pip3.11 install pytesseract Pillow pdf2image
```

### Step 4: Verify Installation

```bash
# Test Tesseract
tesseract --version
tesseract --list-langs

# Test Python integration
python3.11 /tmp/test_tesseract.py
```

---

## 🎯 Alternative: Manual Installation Commands

If the automated script doesn't work, try these manual approaches:

### Option A: Package Manager (Try First)

```bash
sudo dnf update -y
sudo dnf install -y tesseract tesseract-langpack-jpn
tesseract --version
```

### Option B: Source Build (Most Reliable)

```bash
# Install dependencies
sudo dnf install -y gcc gcc-c++ make automake autoconf libtool \
    pkgconfig libpng-devel libjpeg-turbo-devel libtiff-devel \
    zlib-devel wget git

# Build Leptonica
cd /tmp
wget http://www.leptonica.org/source/leptonica-1.84.1.tar.gz
tar -xzf leptonica-1.84.1.tar.gz
cd leptonica-1.84.1
./configure --prefix=/usr/local
make -j$(nproc)
sudo make install
sudo ldconfig

# Build Tesseract
cd /tmp
git clone --depth 1 --branch 5.3.3 https://github.com/tesseract-ocr/tesseract.git
cd tesseract
./autogen.sh
./configure --prefix=/usr/local
make -j$(nproc)
sudo make install
sudo ldconfig

# Download language data
sudo mkdir -p /usr/local/share/tessdata
cd /usr/local/share/tessdata
sudo wget -O jpn.traineddata https://github.com/tesseract-ocr/tessdata_best/raw/main/jpn.traineddata
sudo wget -O eng.traineddata https://github.com/tesseract-ocr/tessdata_best/raw/main/eng.traineddata

# Set environment
echo 'export TESSDATA_PREFIX=/usr/local/share/tessdata' | sudo tee /etc/profile.d/tesseract.sh
sudo chmod +x /etc/profile.d/tesseract.sh
source /etc/profile.d/tesseract.sh
```

---

## 📁 Files Created for You

All files are ready in your project. Here's what each does:

### 1. Installation Script
**Location**: `/Users/tatsuya/focus_project/cis_filesearch_app/scripts/install-tesseract-al2023.sh`

**Purpose**: Automated installation script for Amazon Linux 2023
- Tries package manager first
- Falls back to source build if needed
- Downloads Japanese language data
- Creates test scripts
- Verifies installation

**Usage**: Upload to EC2 and run with sudo

### 2. OCR Configuration Module
**Location**: `/Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker/ocr_config.py`

**Purpose**: Production-ready Python module for OCR operations
- Auto-detects Tesseract paths
- Supports image and PDF processing
- Japanese + English language support
- Confidence scoring
- Error handling

**Features**:
- `extract_text_from_image()` - Extract text from images
- `extract_text_from_pdf()` - Extract text from PDFs with page ranges
- `extract_text_with_confidence()` - Get confidence scores
- Auto-configuration of Tesseract paths

### 3. Requirements File
**Location**: `/Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker/requirements-ocr.txt`

**Purpose**: Python dependencies for OCR
- pytesseract==0.3.10
- Pillow==10.4.0
- pdf2image==1.17.0

### 4. File Processor Example
**Location**: `/Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker/file_processor_example.py`

**Purpose**: Complete example of S3 + SQS + OCR + OpenSearch integration
- Polls SQS for messages
- Downloads files from S3
- Extracts text using OCR
- Indexes to OpenSearch
- Production-ready error handling

**Usage**:
```bash
python3.11 file_processor_example.py --queue-url <SQS_URL>
```

### 5. Comprehensive Test Script
**Location**: `/Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker/test_ocr_setup.py`

**Purpose**: Tests all aspects of OCR setup
- Package imports
- Tesseract binary
- Language support
- Environment variables
- OCR config module
- Basic OCR functionality
- Japanese OCR
- PDF support
- Custom image testing

**Usage**:
```bash
python3.11 backend/python-worker/test_ocr_setup.py --verbose
python3.11 backend/python-worker/test_ocr_setup.py --test-file /path/to/image.jpg
```

### 6. Documentation

#### Full Installation Guide
**Location**: `/Users/tatsuya/focus_project/cis_filesearch_app/docs/deployment/TESSERACT-INSTALLATION-GUIDE.md`

**Contains**:
- Detailed installation instructions
- Multiple installation methods
- Verification procedures
- Python integration examples
- Troubleshooting guide
- Performance optimization
- Security considerations
- Production checklist

#### Quick Reference
**Location**: `/Users/tatsuya/focus_project/cis_filesearch_app/docs/deployment/TESSERACT-QUICK-REFERENCE.md`

**Contains**:
- Quick install commands
- Common CLI commands
- Python usage examples
- Troubleshooting quick fixes
- Performance tips
- File paths reference

---

## 🚀 Quick Start Guide

### For Impatient Developers (3 Commands)

```bash
# 1. On your local machine - upload script
scp scripts/install-tesseract-al2023.sh ec2-user@<EC2-IP>:/tmp/

# 2. On EC2 - install
sudo bash /tmp/install-tesseract-al2023.sh && source /etc/profile.d/tesseract.sh

# 3. On EC2 - verify
python3.11 /tmp/test_tesseract.py
```

---

## 💡 Python Usage Examples

### Basic Image OCR

```python
from backend.python_worker.ocr_config import OCRProcessor

ocr = OCRProcessor()

# Japanese only
text = ocr.extract_text_from_image('document.jpg', lang='jpn')

# Japanese + English
text = ocr.extract_text_from_image('document.jpg', lang='jpn+eng')

print(f"Extracted: {text}")
```

### PDF Processing

```python
from backend.python_worker.ocr_config import OCRProcessor

ocr = OCRProcessor()

# Full PDF
text = ocr.extract_text_from_pdf('document.pdf', lang='jpn+eng')

# Specific pages
text = ocr.extract_text_from_pdf(
    'document.pdf',
    lang='jpn+eng',
    first_page=1,
    last_page=10
)

# Lower DPI for speed
text = ocr.extract_text_from_pdf('document.pdf', dpi=150)
```

### With Confidence Scores

```python
from backend.python_worker.ocr_config import OCRProcessor

ocr = OCRProcessor()

result = ocr.extract_text_with_confidence('document.jpg', lang='jpn')

print(f"Text: {result['text']}")
print(f"Confidence: {result['confidence']}%")
print(f"Words: {result['word_count']}")
print(f"Low confidence: {result['low_confidence_words']}")
```

### S3 Integration

```python
import boto3
from backend.python_worker.ocr_config import OCRProcessor

s3 = boto3.client('s3')
ocr = OCRProcessor()

# Download from S3
s3.download_file('my-bucket', 'path/to/file.pdf', '/tmp/file.pdf')

# Process
text = ocr.extract_text_from_pdf('/tmp/file.pdf', lang='jpn+eng')

# Upload result
s3.put_object(
    Bucket='my-bucket',
    Key='results/file.txt',
    Body=text.encode('utf-8')
)
```

---

## 🔍 Verification Checklist

Run these commands on your EC2 instance to verify everything is working:

```bash
# 1. Check Tesseract binary
which tesseract
# Expected: /usr/bin/tesseract or /usr/local/bin/tesseract

# 2. Check version
tesseract --version
# Expected: tesseract 5.3.3 or higher

# 3. Check languages
tesseract --list-langs
# Expected output includes: eng, jpn

# 4. Check environment
echo $TESSDATA_PREFIX
# Expected: /usr/local/share/tessdata (if installed from source)

# 5. Test Python integration
python3.11 -c "import pytesseract; print(pytesseract.get_tesseract_version())"
# Expected: 5.3.3 or similar

# 6. Run comprehensive tests
python3.11 backend/python-worker/test_ocr_setup.py --verbose
# Expected: All tests passed!
```

---

## 🐛 Common Issues and Solutions

### Issue: "tesseract: command not found"

```bash
# Solution 1: Check installation
sudo find / -name tesseract 2>/dev/null

# Solution 2: Add to PATH
export PATH=$PATH:/usr/local/bin
echo 'export PATH=$PATH:/usr/local/bin' >> ~/.bashrc
```

### Issue: "Error opening data file"

```bash
# Solution: Set TESSDATA_PREFIX
export TESSDATA_PREFIX=/usr/local/share/tessdata
echo 'export TESSDATA_PREFIX=/usr/local/share/tessdata' >> ~/.bashrc
source ~/.bashrc
```

### Issue: "jpn.traineddata not found"

```bash
# Solution: Download language data
sudo wget -O /usr/local/share/tessdata/jpn.traineddata \
    https://github.com/tesseract-ocr/tessdata_best/raw/main/jpn.traineddata
```

### Issue: PDF processing fails

```bash
# Solution: Install poppler
sudo dnf install -y poppler-utils

# Verify
pdftoppm -v
```

### Issue: Low memory during build

```bash
# Solution: Add swap
sudo dd if=/dev/zero of=/swapfile bs=1G count=4
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## 🎯 Next Steps

After successful installation:

1. **Upload Python Worker Code**:
   ```bash
   # Upload OCR config module
   scp backend/python-worker/ocr_config.py ec2-user@<EC2-IP>:/home/ec2-user/

   # Upload file processor
   scp backend/python-worker/file_processor_example.py ec2-user@<EC2-IP>:/home/ec2-user/
   ```

2. **Configure Environment Variables**:
   ```bash
   # On EC2
   cat >> ~/.bashrc << 'EOF'
   export AWS_REGION=ap-northeast-1
   export S3_BUCKET=cis-filesearch-storage
   export SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/xxx/file-processing
   export OPENSEARCH_ENDPOINT=https://xxx.ap-northeast-1.es.amazonaws.com
   EOF
   source ~/.bashrc
   ```

3. **Test File Processing**:
   ```bash
   # Create test image
   python3.11 backend/python-worker/test_ocr_setup.py --verbose

   # Test file processor (with your actual queue URL)
   python3.11 file_processor_example.py --queue-url $SQS_QUEUE_URL
   ```

4. **Create Systemd Service** (for production):
   ```bash
   sudo tee /etc/systemd/system/file-processor.service << 'EOF'
   [Unit]
   Description=File Processor Worker
   After=network.target

   [Service]
   Type=simple
   User=ec2-user
   WorkingDirectory=/home/ec2-user
   Environment="TESSDATA_PREFIX=/usr/local/share/tessdata"
   ExecStart=/usr/bin/python3.11 /home/ec2-user/file_processor_example.py
   Restart=always
   RestartSec=10

   [Install]
   WantedBy=multi-user.target
   EOF

   # Enable and start
   sudo systemctl daemon-reload
   sudo systemctl enable file-processor
   sudo systemctl start file-processor

   # Check status
   sudo systemctl status file-processor
   ```

---

## 📊 Performance Expectations

### OCR Processing Times (300 DPI)

- **Image (JPG/PNG)**: 1-2 seconds per page
- **PDF**: 3-5 seconds per page (includes conversion)
- **Scanned documents**: 2-3 seconds per page

### Resource Usage

- **Memory**: 200-500 MB per worker process
- **CPU**: High during processing, idle when waiting
- **Disk**: Minimal (temporary files only)

### Recommended EC2 Instance Types

- **Development**: t3.medium (2 vCPU, 4 GB RAM)
- **Production**: c5.xlarge (4 vCPU, 8 GB RAM)
- **High Volume**: c5.2xlarge+ with Auto Scaling

---

## 📚 Additional Resources

- **Full Installation Guide**: `/docs/deployment/TESSERACT-INSTALLATION-GUIDE.md`
- **Quick Reference**: `/docs/deployment/TESSERACT-QUICK-REFERENCE.md`
- **OCR Config Module**: `/backend/python-worker/ocr_config.py`
- **Test Script**: `/backend/python-worker/test_ocr_setup.py`

---

## ✅ Success Criteria

You'll know everything is working when:

1. ✓ `tesseract --version` shows version 5.3.3+
2. ✓ `tesseract --list-langs` includes `jpn` and `eng`
3. ✓ `python3.11 /tmp/test_tesseract.py` passes all tests
4. ✓ `python3.11 backend/python-worker/test_ocr_setup.py` passes all tests
5. ✓ You can extract text from a test image/PDF

---

## 🆘 Need Help?

If you encounter issues:

1. Check the **Troubleshooting** section in `TESSERACT-INSTALLATION-GUIDE.md`
2. Run the comprehensive test: `python3.11 backend/python-worker/test_ocr_setup.py --verbose`
3. Check logs: `sudo journalctl -u file-processor -f` (if using systemd)
4. Verify environment: `env | grep TESS`

---

**Remember**: All files are already created and ready to use. Just upload, install, and verify!

Good luck with your deployment! 🚀
