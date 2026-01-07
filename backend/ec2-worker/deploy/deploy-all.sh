#!/bin/bash
#
# CIS File Processor - Complete Preview Feature Deployment
# Downloads from S3, installs LibreOffice, and deploys source files
#

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
S3_BUCKET="cis-filesearch-worker-scripts"
S3_PREFIX="deploy-preview"
APP_DIR="/opt/cis-file-processor"

echo -e "${GREEN}============================================="
echo -e "CIS Preview Feature - Complete Deployment"
echo -e "=============================================${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root or with sudo${NC}"
    exit 1
fi

# Step 1: Download source files from S3
echo -e "\n${YELLOW}Step 1: Downloading source files from S3...${NC}"

mkdir -p /tmp/cis-deploy
aws s3 sync s3://${S3_BUCKET}/${S3_PREFIX}/src/ /tmp/cis-deploy/src/
aws s3 sync s3://${S3_BUCKET}/${S3_PREFIX}/scripts/ /tmp/cis-deploy/scripts/

echo -e "${GREEN}✅ Files downloaded${NC}"

# Step 2: Backup existing files
echo -e "\n${YELLOW}Step 2: Backing up existing files...${NC}"

BACKUP_DIR="${APP_DIR}/backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

for file in preview_generator.py main.py; do
    if [ -f "${APP_DIR}/src/${file}" ]; then
        cp "${APP_DIR}/src/${file}" "${BACKUP_DIR}/"
        echo "  Backed up: ${file}"
    fi
done

echo -e "${GREEN}✅ Backup created at ${BACKUP_DIR}${NC}"

# Step 3: Deploy source files
echo -e "\n${YELLOW}Step 3: Deploying source files...${NC}"

cp /tmp/cis-deploy/src/*.py "${APP_DIR}/src/"
chown -R ec2-user:ec2-user "${APP_DIR}/src/"

echo -e "${GREEN}✅ Source files deployed${NC}"

# Step 4: Install LibreOffice
echo -e "\n${YELLOW}Step 4: Installing LibreOffice...${NC}"

# Detect OS and install
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    VERSION=$VERSION_ID
fi

case "$OS" in
    amzn)
        if [[ "$VERSION" == "2023" ]] || [[ "$VERSION" -ge 2023 ]]; then
            dnf install -y \
                libreoffice-core \
                libreoffice-writer \
                libreoffice-calc \
                libreoffice-impress \
                libreoffice-langpack-ja || dnf install -y libreoffice || true

            # Japanese fonts
            dnf install -y \
                google-noto-sans-cjk-jp-fonts \
                google-noto-serif-cjk-jp-fonts \
                ipa-gothic-fonts \
                ipa-mincho-fonts || true
        else
            amazon-linux-extras install -y epel || yum install -y epel-release
            yum install -y \
                libreoffice-core \
                libreoffice-writer \
                libreoffice-calc \
                libreoffice-impress \
                libreoffice-langpack-ja || true

            yum install -y \
                google-noto-sans-cjk-fonts \
                ipa-gothic-fonts \
                ipa-mincho-fonts || true
        fi
        ;;
    ubuntu|debian)
        apt-get update
        apt-get install -y \
            libreoffice-core \
            libreoffice-writer \
            libreoffice-calc \
            libreoffice-impress \
            libreoffice-l10n-ja \
            fonts-noto-cjk \
            fonts-ipafont || true
        ;;
    *)
        echo -e "${RED}Unsupported OS: $OS${NC}"
        echo -e "${YELLOW}Please install LibreOffice manually${NC}"
        ;;
esac

# Update font cache
fc-cache -fv 2>/dev/null || true

echo -e "${GREEN}✅ LibreOffice installation complete${NC}"

# Step 5: Verify installation
echo -e "\n${YELLOW}Step 5: Verifying installation...${NC}"

if command -v soffice &> /dev/null; then
    echo -e "${GREEN}✅ LibreOffice found: $(which soffice)${NC}"
    soffice --version 2>/dev/null || true
else
    echo -e "${RED}❌ LibreOffice not found${NC}"
fi

# Check deployed files
echo -e "\nDeployed files:"
ls -la "${APP_DIR}/src/"*.py | head -10

# Step 6: Restart worker service
echo -e "\n${YELLOW}Step 6: Restarting worker service...${NC}"

if systemctl is-active --quiet cis-worker.service; then
    systemctl restart cis-worker.service
    echo -e "${GREEN}✅ Worker service restarted${NC}"
else
    echo -e "${YELLOW}⚠️ Worker service not running (may need manual start)${NC}"
fi

# Cleanup
rm -rf /tmp/cis-deploy

echo -e "\n${GREEN}============================================="
echo -e "Deployment Complete!"
echo -e "=============================================${NC}"

echo -e "\n${YELLOW}Next steps:${NC}"
echo -e "1. Check worker logs: journalctl -u cis-worker -f"
echo -e "2. Upload an Office file to S3 landing bucket"
echo -e "3. Verify preview images in S3 thumbnail bucket"

echo -e "\n${GREEN}Done!${NC}"
