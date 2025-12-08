#!/bin/bash
################################################################################
# Tesseract OCR Installation Script for Amazon Linux 2023
# Purpose: Install Tesseract with Japanese language support
# Usage: sudo bash install-tesseract-al2023.sh
################################################################################

set -e  # Exit on error
set -u  # Exit on undefined variable

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    log_error "Please run as root or with sudo"
    exit 1
fi

log_info "Starting Tesseract OCR installation for Amazon Linux 2023..."

# Approach 1: Try direct DNF installation
try_dnf_install() {
    log_info "Attempting package manager installation..."

    dnf update -y

    # Try direct installation
    if dnf install -y tesseract tesseract-langpack-jpn 2>/dev/null; then
        log_info "Successfully installed Tesseract via DNF"
        return 0
    fi

    # Try with CodeReady Builder
    log_info "Trying with CodeReady Builder repository..."
    dnf config-manager --set-enabled crb 2>/dev/null || true

    if dnf install -y tesseract tesseract-langpack-jpn 2>/dev/null; then
        log_info "Successfully installed Tesseract via DNF with CRB"
        return 0
    fi

    log_warn "Package manager installation failed"
    return 1
}

# Approach 2: Build from source
build_from_source() {
    log_info "Building Tesseract from source..."

    # Install build dependencies
    log_info "Installing build dependencies..."
    dnf install -y gcc gcc-c++ make automake autoconf libtool \
        pkgconfig libpng-devel libjpeg-turbo-devel libtiff-devel \
        zlib-devel wget git

    # Install Leptonica
    log_info "Installing Leptonica..."
    cd /tmp
    rm -rf leptonica-1.84.1*
    wget -q http://www.leptonica.org/source/leptonica-1.84.1.tar.gz
    tar -xzf leptonica-1.84.1.tar.gz
    cd leptonica-1.84.1
    ./configure --prefix=/usr/local
    make -j$(nproc) > /dev/null
    make install
    ldconfig

    # Build Tesseract
    log_info "Building Tesseract 5.3.3..."
    cd /tmp
    rm -rf tesseract
    git clone --depth 1 --branch 5.3.3 https://github.com/tesseract-ocr/tesseract.git
    cd tesseract
    ./autogen.sh
    ./configure --prefix=/usr/local
    make -j$(nproc) > /dev/null
    make install
    ldconfig

    # Download language data
    log_info "Downloading language data (Japanese and English)..."
    mkdir -p /usr/local/share/tessdata
    cd /usr/local/share/tessdata

    # Download Japanese traineddata
    wget -q -O jpn.traineddata \
        https://github.com/tesseract-ocr/tessdata_best/raw/main/jpn.traineddata

    # Download English traineddata
    wget -q -O eng.traineddata \
        https://github.com/tesseract-ocr/tessdata_best/raw/main/eng.traineddata

    # Set environment variable
    echo 'export TESSDATA_PREFIX=/usr/local/share/tessdata' > /etc/profile.d/tesseract.sh
    chmod +x /etc/profile.d/tesseract.sh
    source /etc/profile.d/tesseract.sh

    log_info "Source build completed successfully"
}

# Verify installation
verify_installation() {
    log_info "Verifying Tesseract installation..."

    # Source environment if needed
    if [ -f /etc/profile.d/tesseract.sh ]; then
        source /etc/profile.d/tesseract.sh
    fi

    # Check if tesseract is available
    if ! command -v tesseract &> /dev/null; then
        log_error "Tesseract binary not found in PATH"
        return 1
    fi

    # Check version
    local version=$(tesseract --version 2>&1 | head -n1)
    log_info "Installed version: $version"

    # Check available languages
    local langs=$(tesseract --list-langs 2>&1 | tail -n +2 | tr '\n' ', ')
    log_info "Available languages: $langs"

    # Check for Japanese
    if tesseract --list-langs 2>&1 | grep -q "jpn"; then
        log_info "✓ Japanese language support: OK"
    else
        log_error "✗ Japanese language support: NOT FOUND"
        return 1
    fi

    log_info "✓ Tesseract verification passed"
    return 0
}

# Create Python test script
create_python_test() {
    log_info "Creating Python test script..."

    cat > /tmp/test_tesseract.py << 'PYEOF'
#!/usr/bin/env python3
"""
Tesseract OCR Test Script
Tests pytesseract integration with Tesseract OCR
"""
import sys

try:
    import pytesseract
    from PIL import Image
except ImportError:
    print("Installing required Python packages...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install",
                          "pytesseract", "Pillow"])
    import pytesseract
    from PIL import Image

def test_tesseract():
    """Test Tesseract OCR functionality"""
    print("Testing Tesseract OCR...")

    try:
        # Check version
        version = pytesseract.get_tesseract_version()
        print(f"✓ Tesseract version: {version}")

        # Check languages
        langs = pytesseract.get_languages()
        print(f"✓ Available languages: {', '.join(langs)}")

        # Check for Japanese
        if 'jpn' in langs:
            print("✓ Japanese language support: OK")
        else:
            print("✗ Japanese language support: NOT FOUND")
            return False

        print("\n✓ All tests passed! Tesseract is ready for production use.")
        return True

    except Exception as e:
        print(f"✗ Error during testing: {e}")
        return False

if __name__ == '__main__':
    success = test_tesseract()
    sys.exit(0 if success else 1)
PYEOF

    chmod +x /tmp/test_tesseract.py
    log_info "Python test script created at /tmp/test_tesseract.py"
}

# Main installation flow
main() {
    log_info "=== Tesseract OCR Installation Script ==="
    log_info "OS: Amazon Linux 2023"
    log_info "Target: Tesseract with Japanese language support"
    echo ""

    # Try package manager first
    if try_dnf_install; then
        log_info "Installation via package manager succeeded"
    else
        log_warn "Package manager installation failed, building from source..."
        build_from_source
    fi

    # Verify installation
    if verify_installation; then
        log_info "Installation verified successfully"
    else
        log_error "Installation verification failed"
        exit 1
    fi

    # Create Python test
    create_python_test

    # Summary
    echo ""
    log_info "=== Installation Summary ==="
    tesseract --version 2>&1 | head -n1
    log_info "Language data: $(tesseract --list-langs 2>&1 | tail -n +2 | tr '\n' ', ')"
    log_info "Tesseract binary: $(which tesseract)"

    if [ -f /etc/profile.d/tesseract.sh ]; then
        log_info "Environment file: /etc/profile.d/tesseract.sh"
        log_warn "Please run: source /etc/profile.d/tesseract.sh"
    fi

    echo ""
    log_info "=== Next Steps ==="
    log_info "1. Run: source /etc/profile.d/tesseract.sh (if exists)"
    log_info "2. Install Python packages: pip3.11 install pytesseract Pillow pdf2image"
    log_info "3. Test Python integration: python3.11 /tmp/test_tesseract.py"
    echo ""
    log_info "✓ Tesseract OCR installation completed successfully!"
}

# Run main function
main "$@"
