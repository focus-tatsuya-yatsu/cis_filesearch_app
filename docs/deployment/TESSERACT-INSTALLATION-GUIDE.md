# Tesseract OCR Installation Guide for Amazon Linux 2023

## Overview

This guide provides step-by-step instructions for installing Tesseract OCR with Japanese language support on Amazon Linux 2023 EC2 instances for the Python Worker component.

## Prerequisites

- Amazon Linux 2023 EC2 instance
- Python 3.11 installed
- SSH access with sudo privileges
- Internet connectivity

## Quick Install (Recommended)

### Method 1: Using Installation Script

1. **Upload the installation script to your EC2 instance:**

```bash
# From your local machine
scp scripts/install-tesseract-al2023.sh ec2-user@<EC2-IP>:/tmp/

# SSH into EC2
ssh ec2-user@<EC2-IP>
```

2. **Run the installation script:**

```bash
sudo bash /tmp/install-tesseract-al2023.sh
```

3. **Source the environment (if installed from source):**

```bash
source /etc/profile.d/tesseract.sh
```

4. **Install Python dependencies:**

```bash
# Install poppler-utils for PDF processing
sudo dnf install -y poppler-utils

# Install Python packages
pip3.11 install -r backend/python-worker/requirements-ocr.txt
```

5. **Verify installation:**

```bash
python3.11 /tmp/test_tesseract.py
```

---

## Manual Installation Methods

### Method A: Package Manager (Fastest)

```bash
# Update system
sudo dnf update -y

# Try direct installation
sudo dnf install -y tesseract tesseract-langpack-jpn

# Verify
tesseract --version
tesseract --list-langs
```

**If this works, skip to [Verification](#verification) section.**

### Method B: Source Build (Most Reliable)

If package manager installation fails, build from source:

#### Step 1: Install Build Dependencies

```bash
sudo dnf install -y gcc gcc-c++ make automake autoconf libtool \
    pkgconfig libpng-devel libjpeg-turbo-devel libtiff-devel \
    zlib-devel wget git
```

#### Step 2: Build and Install Leptonica

```bash
cd /tmp
wget http://www.leptonica.org/source/leptonica-1.84.1.tar.gz
tar -xzf leptonica-1.84.1.tar.gz
cd leptonica-1.84.1
./configure --prefix=/usr/local
make -j$(nproc)
sudo make install
sudo ldconfig
```

#### Step 3: Build and Install Tesseract

```bash
cd /tmp
git clone --depth 1 --branch 5.3.3 https://github.com/tesseract-ocr/tesseract.git
cd tesseract
./autogen.sh
./configure --prefix=/usr/local
make -j$(nproc)
sudo make install
sudo ldconfig
```

#### Step 4: Download Language Data

```bash
sudo mkdir -p /usr/local/share/tessdata
cd /usr/local/share/tessdata

# Japanese
sudo wget -O jpn.traineddata \
    https://github.com/tesseract-ocr/tessdata_best/raw/main/jpn.traineddata

# English
sudo wget -O eng.traineddata \
    https://github.com/tesseract-ocr/tessdata_best/raw/main/eng.traineddata
```

#### Step 5: Set Environment Variables

```bash
echo 'export TESSDATA_PREFIX=/usr/local/share/tessdata' | sudo tee /etc/profile.d/tesseract.sh
sudo chmod +x /etc/profile.d/tesseract.sh
source /etc/profile.d/tesseract.sh
```

---

## Verification

### 1. Check Tesseract Installation

```bash
# Check binary location
which tesseract

# Check version
tesseract --version

# Expected output:
# tesseract 5.3.3
#  leptonica-1.84.1
#  ...

# Check available languages
tesseract --list-langs

# Expected output should include:
# List of available languages in "/usr/local/share/tessdata/" (2):
# eng
# jpn
```

### 2. Test OCR Functionality

```bash
# Create a test image with Japanese text
echo "テスト" | convert -pointsize 48 label:@- /tmp/test_jp.png 2>/dev/null

# Run OCR (should output "テスト")
tesseract /tmp/test_jp.png stdout -l jpn
```

### 3. Verify Python Integration

```bash
# Install Python packages
pip3.11 install pytesseract Pillow pdf2image

# Run Python verification
python3.11 -c "
import pytesseract
print('Version:', pytesseract.get_tesseract_version())
print('Languages:', pytesseract.get_languages())
"
```

### 4. Use OCR Config Module

```bash
# Navigate to project directory
cd /path/to/cis_filesearch_app

# Run OCR config verification
python3.11 backend/python-worker/ocr_config.py
```

Expected output:
```
✓ Tesseract OCR Installation Verified
  Version: 5.3.3
  Binary: /usr/local/bin/tesseract
  TESSDATA: /usr/local/share/tessdata
  Languages: eng, jpn
```

---

## Python Integration

### Basic Usage

```python
from backend.python_worker.ocr_config import OCRProcessor

# Initialize processor
ocr = OCRProcessor()

# Extract text from image (Japanese)
text = ocr.extract_text_from_image('path/to/image.jpg', lang='jpn')

# Extract text from image (Japanese + English)
text = ocr.extract_text_from_image('path/to/image.jpg', lang='jpn+eng')

# Extract text from PDF
text = ocr.extract_text_from_pdf('path/to/document.pdf', lang='jpn')

# Extract with confidence scores
result = ocr.extract_text_with_confidence('path/to/image.jpg', lang='jpn')
print(f"Text: {result['text']}")
print(f"Confidence: {result['confidence']}%")
```

### Integration with File Processor

```python
import boto3
from ocr_config import OCRProcessor

def process_file_from_s3(bucket: str, key: str) -> dict:
    """Process file from S3 and extract text"""

    # Download file from S3
    s3 = boto3.client('s3')
    local_path = f'/tmp/{key.split("/")[-1]}'
    s3.download_file(bucket, key, local_path)

    # Initialize OCR
    ocr = OCRProcessor()

    # Extract text based on file type
    if local_path.endswith('.pdf'):
        text = ocr.extract_text_from_pdf(local_path, lang='jpn+eng')
    else:
        text = ocr.extract_text_from_image(local_path, lang='jpn+eng')

    return {
        'file': key,
        'text': text,
        'char_count': len(text)
    }
```

---

## Troubleshooting

### Issue 1: "tesseract: command not found"

**Solution:**
```bash
# Check if installed
sudo find / -name tesseract 2>/dev/null

# Add to PATH if found
export PATH=$PATH:/usr/local/bin
echo 'export PATH=$PATH:/usr/local/bin' >> ~/.bashrc
```

### Issue 2: "Error opening data file /usr/share/tessdata/jpn.traineddata"

**Solution:**
```bash
# Set TESSDATA_PREFIX
export TESSDATA_PREFIX=/usr/local/share/tessdata

# Make permanent
echo 'export TESSDATA_PREFIX=/usr/local/share/tessdata' >> ~/.bashrc
source ~/.bashrc
```

### Issue 3: Low Memory During Build

**Solution:**
```bash
# Add swap space
sudo dd if=/dev/zero of=/swapfile bs=1G count=4
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Issue 4: Python Cannot Find Tesseract

**Solution:**
```python
# Explicitly set path in Python
import pytesseract
pytesseract.pytesseract.tesseract_cmd = '/usr/local/bin/tesseract'
```

### Issue 5: PDF Processing Fails

**Solution:**
```bash
# Install poppler-utils
sudo dnf install -y poppler-utils

# Verify poppler installation
pdftoppm -v
```

### Issue 6: SELinux Blocking Tesseract

**Solution:**
```bash
# Check SELinux status
sestatus

# If enforcing, set to permissive (temporary)
sudo setenforce 0

# Or create custom policy (permanent)
sudo ausearch -c 'tesseract' --raw | audit2allow -M tesseract-policy
sudo semodule -i tesseract-policy.pp
```

---

## Performance Optimization

### 1. EC2 Instance Type Recommendations

- **Development**: t3.medium (2 vCPU, 4 GB RAM)
- **Production**: c5.xlarge (4 vCPU, 8 GB RAM) or higher
- **High Volume**: c5.2xlarge (8 vCPU, 16 GB RAM) with Auto Scaling

### 2. OCR Performance Tuning

```python
# Use lower DPI for faster processing (trade-off: accuracy)
text = ocr.extract_text_from_pdf('file.pdf', dpi=150)  # Default: 300

# Process specific pages only
text = ocr.extract_text_from_pdf('file.pdf', first_page=1, last_page=5)

# Use simpler page segmentation mode for better performance
from ocr_config import TesseractConfig
custom_config = f'--oem 3 --psm {TesseractConfig.PSM_SINGLE_BLOCK} -l jpn'
text = ocr.extract_text_from_image('image.jpg', config=custom_config)
```

### 3. Parallel Processing

```python
from concurrent.futures import ThreadPoolExecutor
from ocr_config import OCRProcessor

def process_multiple_files(file_paths: list, max_workers: int = 4):
    """Process multiple files in parallel"""
    ocr = OCRProcessor()

    def process_file(path):
        return ocr.extract_text_from_image(path, lang='jpn')

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        results = list(executor.map(process_file, file_paths))

    return results
```

---

## Known Limitations

1. **OCR Accuracy**: Depends on image quality, font, and language complexity
   - Scanned documents: 80-95% accuracy (good quality)
   - Photos: 60-80% accuracy (variable quality)
   - Handwritten text: 30-60% accuracy (limited support)

2. **Processing Speed**:
   - Image: ~1-2 seconds per page (300 DPI)
   - PDF: ~3-5 seconds per page (with conversion)

3. **Memory Usage**:
   - ~200-500 MB per worker process
   - Scales with image size and DPI

4. **Supported Languages**:
   - Currently: Japanese (jpn), English (eng)
   - Additional languages require downloading traineddata files

---

## Security Considerations

### 1. File Validation

```python
def validate_file(file_path: str) -> bool:
    """Validate file before OCR processing"""
    from pathlib import Path

    path = Path(file_path)

    # Check file exists
    if not path.exists():
        return False

    # Check file size (max 50MB)
    if path.stat().st_size > 50 * 1024 * 1024:
        return False

    # Check file extension
    allowed_extensions = {'.jpg', '.jpeg', '.png', '.pdf', '.tiff'}
    if path.suffix.lower() not in allowed_extensions:
        return False

    return True
```

### 2. Resource Limits

```python
import resource

# Set memory limit (1GB)
resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))

# Set CPU time limit (60 seconds)
resource.setrlimit(resource.RLIMIT_CPU, (60, 60))
```

### 3. Sandboxing

Consider running OCR processing in isolated containers or with restricted permissions.

---

## Maintenance

### Updating Tesseract

```bash
# For package manager installation
sudo dnf update tesseract

# For source installation
cd /tmp
git clone --depth 1 --branch <NEW_VERSION> https://github.com/tesseract-ocr/tesseract.git
cd tesseract
./autogen.sh
./configure --prefix=/usr/local
make -j$(nproc)
sudo make install
sudo ldconfig
```

### Adding New Languages

```bash
# Download additional language data
cd /usr/local/share/tessdata
sudo wget -O <LANG>.traineddata \
    https://github.com/tesseract-ocr/tessdata_best/raw/main/<LANG>.traineddata

# Verify
tesseract --list-langs
```

Available languages: https://github.com/tesseract-ocr/tessdata_best

---

## Production Deployment Checklist

- [ ] Tesseract installed and verified
- [ ] Japanese and English language data available
- [ ] Python dependencies installed
- [ ] OCR config module tested
- [ ] Environment variables set in `/etc/profile.d/tesseract.sh`
- [ ] Poppler-utils installed for PDF processing
- [ ] Memory and CPU limits configured
- [ ] File validation implemented
- [ ] Error handling and logging in place
- [ ] CloudWatch metrics configured
- [ ] Auto Scaling group configured (if applicable)
- [ ] Backup EC2 AMI created with Tesseract installed

---

## Support and Resources

- **Tesseract Documentation**: https://tesseract-ocr.github.io/
- **Tesseract GitHub**: https://github.com/tesseract-ocr/tesseract
- **pytesseract Documentation**: https://pypi.org/project/pytesseract/
- **Amazon Linux 2023 User Guide**: https://docs.aws.amazon.com/linux/al2023/

---

## Changelog

- **2025-01-21**: Initial guide created
  - Installation script for Amazon Linux 2023
  - OCR config module with Japanese support
  - Performance optimization guidelines
  - Security best practices
