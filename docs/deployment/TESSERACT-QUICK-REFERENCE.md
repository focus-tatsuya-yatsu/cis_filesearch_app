# Tesseract OCR Quick Reference

## 🚀 Quick Install Commands

```bash
# On EC2 instance (Amazon Linux 2023)
sudo bash /tmp/install-tesseract-al2023.sh
source /etc/profile.d/tesseract.sh  # If installed from source
pip3.11 install -r backend/python-worker/requirements-ocr.txt
```

## ✅ Verification Commands

```bash
# Check Tesseract
tesseract --version
tesseract --list-langs

# Check Python integration
python3.11 backend/python-worker/ocr_config.py
```

## 📋 Common Commands

### Tesseract CLI

```bash
# Basic OCR (English)
tesseract input.jpg output

# Japanese OCR
tesseract input.jpg output -l jpn

# Japanese + English
tesseract input.jpg output -l jpn+eng

# Output to stdout
tesseract input.jpg stdout -l jpn

# With custom config
tesseract input.jpg output -l jpn --oem 3 --psm 6
```

### Python Usage

```python
from backend.python_worker.ocr_config import OCRProcessor

# Initialize
ocr = OCRProcessor()

# Extract from image
text = ocr.extract_text_from_image('file.jpg', lang='jpn')

# Extract from PDF
text = ocr.extract_text_from_pdf('file.pdf', lang='jpn+eng')

# With confidence
result = ocr.extract_text_with_confidence('file.jpg', lang='jpn')
print(f"Confidence: {result['confidence']}%")
```

## 🔧 Troubleshooting Quick Fixes

| Problem | Solution |
|---------|----------|
| Command not found | `export PATH=$PATH:/usr/local/bin` |
| Language data not found | `export TESSDATA_PREFIX=/usr/local/share/tessdata` |
| Low memory during build | Add swap: `sudo dd if=/dev/zero of=/swapfile bs=1G count=4` |
| PDF fails | Install poppler: `sudo dnf install -y poppler-utils` |
| SELinux blocking | `sudo setenforce 0` (temporary) |

## 📊 Page Segmentation Modes (PSM)

| Mode | Description | Use Case |
|------|-------------|----------|
| 0 | OSD only | Orientation detection |
| 3 | Auto (default) | General documents |
| 6 | Single block | Paragraphs |
| 7 | Single line | Single line of text |
| 8 | Single word | Individual words |
| 10 | Single char | Character recognition |

## 🎯 OCR Engine Modes (OEM)

| Mode | Description | Recommended |
|------|-------------|-------------|
| 0 | Legacy | Old documents |
| 1 | LSTM only | Modern (fast) |
| 2 | Legacy + LSTM | High accuracy |
| 3 | Default | ✅ Best choice |

## 📁 File Paths

### Package Manager Install
- Binary: `/usr/bin/tesseract`
- Data: `/usr/share/tessdata/`

### Source Install
- Binary: `/usr/local/bin/tesseract`
- Data: `/usr/local/share/tessdata/`

## 🔍 Diagnostic Commands

```bash
# Find Tesseract
which tesseract

# Check language data location
tesseract --list-langs

# Check library dependencies
ldd $(which tesseract)

# Test Japanese OCR
echo "テスト" | convert -pointsize 48 label:@- test.png
tesseract test.png stdout -l jpn
```

## ⚡ Performance Tips

```python
# Lower DPI for speed (default: 300)
text = ocr.extract_text_from_pdf('file.pdf', dpi=150)

# Process specific pages
text = ocr.extract_text_from_pdf('file.pdf', first_page=1, last_page=5)

# Parallel processing
from concurrent.futures import ThreadPoolExecutor
with ThreadPoolExecutor(max_workers=4) as executor:
    results = executor.map(process_file, file_list)
```

## 🛡️ Production Checklist

- [ ] Tesseract 5.3.3+ installed
- [ ] Japanese language data available
- [ ] Environment variables set
- [ ] Python dependencies installed
- [ ] OCR config module tested
- [ ] Error handling implemented
- [ ] Resource limits configured
- [ ] CloudWatch logging enabled

## 📞 Quick Help

```bash
# Get OCR info
python3.11 -c "from backend.python_worker.ocr_config import OCRProcessor; print(OCRProcessor().get_info())"

# Test installation
python3.11 /tmp/test_tesseract.py
```

## 🔗 Useful Links

- Full Guide: `/docs/deployment/TESSERACT-INSTALLATION-GUIDE.md`
- OCR Config: `/backend/python-worker/ocr_config.py`
- Install Script: `/scripts/install-tesseract-al2023.sh`
