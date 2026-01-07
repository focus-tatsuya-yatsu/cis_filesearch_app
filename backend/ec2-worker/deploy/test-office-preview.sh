#!/bin/bash
#
# Office Preview Test Script
# Test LibreOffice conversion and preview generation
#

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

APP_DIR="/opt/cis-file-processor"
TEST_DIR=$(mktemp -d)

echo -e "${GREEN}============================================="
echo -e "Office Preview Test Script"
echo -e "=============================================${NC}"

# Cleanup function
cleanup() {
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

# Test 1: Check LibreOffice installation
echo -e "\n${YELLOW}Test 1: LibreOffice Installation${NC}"
if command -v soffice &> /dev/null; then
    echo -e "${GREEN}✅ LibreOffice found: $(which soffice)${NC}"
    soffice --version 2>/dev/null || echo "  (version check skipped)"
else
    echo -e "${RED}❌ LibreOffice not found${NC}"
    echo "Run: sudo bash update-preview-support.sh"
    exit 1
fi

# Test 2: Create test documents
echo -e "\n${YELLOW}Test 2: Creating Test Documents${NC}"

# Create HTML test file (simulates Word)
cat > "$TEST_DIR/test_word.html" << 'EOF'
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Test Document</title></head>
<body>
<h1>テスト文書</h1>
<p>これはテスト用のWord文書です。</p>
<p>日本語テキストが正しく表示されることを確認します。</p>
<table border="1">
<tr><th>項目</th><th>値</th></tr>
<tr><td>名前</td><td>サンプル</td></tr>
<tr><td>日付</td><td>2025-01-06</td></tr>
</table>
</body>
</html>
EOF

echo -e "${GREEN}✅ Test document created${NC}"

# Test 3: Convert to PDF
echo -e "\n${YELLOW}Test 3: PDF Conversion Test${NC}"

if timeout 60 soffice --headless --convert-to pdf --outdir "$TEST_DIR" "$TEST_DIR/test_word.html" &> /dev/null; then
    if [ -f "$TEST_DIR/test_word.pdf" ]; then
        PDF_SIZE=$(stat -f%z "$TEST_DIR/test_word.pdf" 2>/dev/null || stat -c%s "$TEST_DIR/test_word.pdf")
        echo -e "${GREEN}✅ PDF conversion successful${NC}"
        echo "   Output: $TEST_DIR/test_word.pdf"
        echo "   Size: $PDF_SIZE bytes"
    else
        echo -e "${RED}❌ PDF file not created${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ PDF conversion failed or timed out${NC}"
    exit 1
fi

# Test 4: Check pdf2image / Poppler
echo -e "\n${YELLOW}Test 4: PDF to Image Conversion${NC}"

if python3 -c "from pdf2image import convert_from_path" 2>/dev/null; then
    echo -e "${GREEN}✅ pdf2image module available${NC}"

    # Test actual conversion
    python3 << PYEOF
from pdf2image import convert_from_path
import os

pdf_path = "$TEST_DIR/test_word.pdf"
output_dir = "$TEST_DIR"

try:
    images = convert_from_path(pdf_path, dpi=150, first_page=1, last_page=1)
    if images:
        output_path = os.path.join(output_dir, "preview_page_1.jpg")
        images[0].save(output_path, "JPEG", quality=85)
        print(f"✅ Preview image created: {output_path}")
        print(f"   Size: {os.path.getsize(output_path)} bytes")
        print(f"   Dimensions: {images[0].size[0]}x{images[0].size[1]}")
    else:
        print("❌ No images generated")
        exit(1)
except Exception as e:
    print(f"❌ Error: {e}")
    exit(1)
PYEOF
else
    echo -e "${YELLOW}⚠️ pdf2image not installed${NC}"
    echo "   Install with: pip3 install pdf2image"
fi

# Test 5: Check office_converter.py
echo -e "\n${YELLOW}Test 5: Application Integration${NC}"

if [ -f "$APP_DIR/src/office_converter.py" ]; then
    echo -e "${GREEN}✅ office_converter.py exists${NC}"
else
    echo -e "${YELLOW}⚠️ office_converter.py not found at $APP_DIR/src/${NC}"
    echo "   Please deploy the updated source files"
fi

if [ -f "$APP_DIR/src/preview_generator.py" ]; then
    if grep -q "_generate_from_office" "$APP_DIR/src/preview_generator.py"; then
        echo -e "${GREEN}✅ preview_generator.py has Office support${NC}"
    else
        echo -e "${YELLOW}⚠️ preview_generator.py needs updating${NC}"
    fi
else
    echo -e "${YELLOW}⚠️ preview_generator.py not found${NC}"
fi

# Summary
echo -e "\n${GREEN}============================================="
echo -e "Test Summary"
echo -e "=============================================${NC}"
echo -e "LibreOffice:     ✅ Installed"
echo -e "PDF Conversion:  ✅ Working"
if python3 -c "from pdf2image import convert_from_path" 2>/dev/null; then
    echo -e "Image Preview:   ✅ Working"
else
    echo -e "Image Preview:   ⚠️  pdf2image not installed"
fi

echo -e "\n${GREEN}All core tests passed!${NC}"
echo -e "\nTo test with real Office files:"
echo -e "  1. Upload a .docx/.xlsx/.pptx to S3 landing bucket"
echo -e "  2. Check worker logs: journalctl -u cis-worker -f"
echo -e "  3. Verify preview images in S3 thumbnail bucket under previews/"
