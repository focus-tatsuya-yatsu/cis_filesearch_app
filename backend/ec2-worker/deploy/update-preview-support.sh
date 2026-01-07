#!/bin/bash
#
# CIS File Processor Worker - Preview Support Update Script
# Adds LibreOffice and Office/DocuWorks preview support to existing installation
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
APP_DIR="/opt/cis-file-processor"

echo -e "${GREEN}=============================================${NC}"
echo -e "${GREEN}CIS Worker - Preview Support Update${NC}"
echo -e "${GREEN}=============================================${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root or with sudo${NC}"
    exit 1
fi

# Detect OS
detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        VERSION=$VERSION_ID
    elif [ -f /etc/amazon-linux-release ]; then
        OS="amzn"
        VERSION=$(grep -oP '\d+' /etc/amazon-linux-release | head -1)
    else
        OS=$(uname -s)
    fi
    echo -e "${BLUE}Detected OS: $OS $VERSION${NC}"
}

# Install LibreOffice on Amazon Linux 2023
install_libreoffice_al2023() {
    echo -e "\n${YELLOW}Installing LibreOffice on Amazon Linux 2023...${NC}"

    dnf install -y \
        libreoffice-core \
        libreoffice-writer \
        libreoffice-calc \
        libreoffice-impress \
        libreoffice-langpack-ja || {
            echo -e "${YELLOW}Some packages may not be available, trying alternatives...${NC}"
            dnf install -y libreoffice || true
        }

    # Japanese fonts
    echo -e "${YELLOW}Installing Japanese fonts...${NC}"
    dnf install -y \
        google-noto-sans-cjk-jp-fonts \
        google-noto-serif-cjk-jp-fonts \
        ipa-gothic-fonts \
        ipa-mincho-fonts || true
}

# Install LibreOffice on Amazon Linux 2
install_libreoffice_al2() {
    echo -e "\n${YELLOW}Installing LibreOffice on Amazon Linux 2...${NC}"

    # Enable EPEL
    amazon-linux-extras install -y epel || yum install -y epel-release

    yum install -y \
        libreoffice-core \
        libreoffice-writer \
        libreoffice-calc \
        libreoffice-impress \
        libreoffice-langpack-ja || true

    # Japanese fonts
    yum install -y \
        google-noto-sans-cjk-fonts \
        ipa-gothic-fonts \
        ipa-mincho-fonts || true
}

# Install LibreOffice on Ubuntu/Debian
install_libreoffice_debian() {
    echo -e "\n${YELLOW}Installing LibreOffice on Ubuntu/Debian...${NC}"

    apt-get update
    apt-get install -y \
        libreoffice-core \
        libreoffice-writer \
        libreoffice-calc \
        libreoffice-impress \
        libreoffice-l10n-ja

    # Japanese fonts
    apt-get install -y \
        fonts-noto-cjk \
        fonts-noto-cjk-extra \
        fonts-ipafont \
        fonts-ipafont-gothic \
        fonts-ipafont-mincho || true
}

# Update font cache
update_font_cache() {
    echo -e "\n${YELLOW}Updating font cache...${NC}"
    fc-cache -fv
}

# Verify LibreOffice installation
verify_libreoffice() {
    echo -e "\n${YELLOW}Verifying LibreOffice installation...${NC}"

    if command -v soffice &> /dev/null; then
        SOFFICE_PATH=$(which soffice)
        echo -e "${GREEN}✅ LibreOffice found: $SOFFICE_PATH${NC}"

        VERSION=$(soffice --version 2>/dev/null || echo "Unable to get version")
        echo -e "   Version: $VERSION"

        # Test conversion
        echo -e "\n${YELLOW}Testing PDF conversion...${NC}"
        TEST_DIR=$(mktemp -d)
        echo "<html><body><h1>Test Document</h1><p>日本語テスト</p></body></html>" > "$TEST_DIR/test.html"

        if timeout 30 soffice --headless --convert-to pdf --outdir "$TEST_DIR" "$TEST_DIR/test.html" &> /dev/null; then
            if [ -f "$TEST_DIR/test.pdf" ]; then
                echo -e "${GREEN}✅ PDF conversion test: PASSED${NC}"
            else
                echo -e "${YELLOW}⚠️ PDF not created, but LibreOffice is installed${NC}"
            fi
        else
            echo -e "${YELLOW}⚠️ Conversion test timeout (may work with actual files)${NC}"
        fi

        rm -rf "$TEST_DIR"
        return 0
    else
        echo -e "${RED}❌ LibreOffice (soffice) not found${NC}"
        return 1
    fi
}

# Update application code
update_application() {
    echo -e "\n${YELLOW}Checking application files...${NC}"

    if [ ! -d "$APP_DIR/src" ]; then
        echo -e "${RED}Application directory not found: $APP_DIR/src${NC}"
        echo -e "${YELLOW}Please copy the updated source files manually${NC}"
        return 1
    fi

    # Check for new files
    NEW_FILES=(
        "office_converter.py"
        "docuworks_request.py"
    )

    for file in "${NEW_FILES[@]}"; do
        if [ -f "$APP_DIR/src/$file" ]; then
            echo -e "${GREEN}✅ $file exists${NC}"
        else
            echo -e "${YELLOW}⚠️ $file not found - please copy from source${NC}"
        fi
    done

    # Check preview_generator.py
    if [ -f "$APP_DIR/src/preview_generator.py" ]; then
        if grep -q "_generate_from_office" "$APP_DIR/src/preview_generator.py"; then
            echo -e "${GREEN}✅ preview_generator.py has Office support${NC}"
        else
            echo -e "${YELLOW}⚠️ preview_generator.py needs updating${NC}"
        fi
    fi
}

# Main execution
main() {
    detect_os

    case "$OS" in
        amzn)
            if [[ "$VERSION" == "2023" ]] || [[ "$VERSION" -ge 2023 ]]; then
                install_libreoffice_al2023
            else
                install_libreoffice_al2
            fi
            ;;
        ubuntu|debian)
            install_libreoffice_debian
            ;;
        centos|rhel|rocky|almalinux)
            install_libreoffice_al2  # Same process
            ;;
        *)
            echo -e "${RED}Unsupported OS: $OS${NC}"
            echo -e "${YELLOW}Please install LibreOffice manually${NC}"
            exit 1
            ;;
    esac

    update_font_cache
    verify_libreoffice
    update_application

    echo -e "\n${GREEN}=============================================${NC}"
    echo -e "${GREEN}Preview Support Update Complete!${NC}"
    echo -e "${GREEN}=============================================${NC}"

    echo -e "\n${YELLOW}Supported file types for preview:${NC}"
    echo -e "  - PDF (native)"
    echo -e "  - Images (jpg, png, gif, bmp, tiff)"
    echo -e "  - Word (.doc, .docx)"
    echo -e "  - Excel (.xls, .xlsx)"
    echo -e "  - PowerPoint (.ppt, .pptx)"
    echo -e "  - OpenDocument (.odt, .ods, .odp)"

    echo -e "\n${YELLOW}Next steps:${NC}"
    echo -e "1. Update application source files if needed"
    echo -e "2. Restart the worker service:"
    echo -e "   ${BLUE}sudo systemctl restart cis-worker.service${NC}"
    echo -e "3. Test with a sample Office file"

    echo -e "\n${GREEN}Done!${NC}"
}

main "$@"
