#!/bin/bash
# ==========================================
# Installation Script for Python Worker
# Amazon Linux 2023
# ==========================================

set -e

echo "=========================================="
echo "Python Worker Installation"
echo "=========================================="

# Configuration
APP_DIR="/home/ec2-user/python-worker"
SERVICE_NAME="file-processor"
LOG_DIR="/var/log/file-processor"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Check if running as ec2-user
if [ "$USER" != "ec2-user" ]; then
    error "This script must be run as ec2-user"
fi

info "Starting installation..."

# 1. Install system dependencies
info "Installing system dependencies..."
sudo dnf update -y
sudo dnf install -y \
    python3.11 \
    python3.11-pip \
    poppler-utils \
    ImageMagick \
    ImageMagick-devel \
    file-devel \
    git

# 2. Install Tesseract OCR
info "Installing Tesseract OCR..."
if [ ! -f "/tmp/install-tesseract-al2023.sh" ]; then
    warn "Tesseract installation script not found"
    info "Please ensure Tesseract is installed manually"
else
    sudo bash /tmp/install-tesseract-al2023.sh
fi

# 3. Create application directory
info "Creating application directory..."
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# 4. Copy application files
info "Copying application files..."
# Assuming files are already in place
# If deploying from S3 or Git, add commands here

# 5. Install Python dependencies
info "Installing Python dependencies..."
pip3.11 install --user --upgrade pip
pip3.11 install --user -r requirements.txt

# 6. Create log directory
info "Creating log directory..."
sudo mkdir -p "$LOG_DIR"
sudo chown ec2-user:ec2-user "$LOG_DIR"

# 7. Create temp directory
info "Creating temp directory..."
mkdir -p /tmp/file-processor
chmod 755 /tmp/file-processor

# 8. Setup environment file
info "Setting up environment file..."
if [ ! -f "$APP_DIR/.env" ]; then
    if [ -f "$APP_DIR/.env.example" ]; then
        cp "$APP_DIR/.env.example" "$APP_DIR/.env"
        warn "Please edit .env file with your configuration"
    else
        error ".env.example file not found"
    fi
fi

# 9. Validate configuration
info "Validating configuration..."
python3.11 "$APP_DIR/worker.py" --validate-only

# 10. Install systemd service
info "Installing systemd service..."
sudo cp "$APP_DIR/deployment/file-processor.service" "/etc/systemd/system/$SERVICE_NAME.service"
sudo systemctl daemon-reload

# 11. Enable service (but don't start yet)
info "Enabling service..."
sudo systemctl enable "$SERVICE_NAME.service"

# 12. Setup log rotation
info "Setting up log rotation..."
sudo tee /etc/logrotate.d/file-processor > /dev/null <<EOF
/var/log/file-processor.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0644 ec2-user ec2-user
}
EOF

echo ""
echo "=========================================="
echo -e "${GREEN}Installation completed successfully!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Edit configuration file: nano $APP_DIR/.env"
echo "2. Test the worker: python3.11 $APP_DIR/worker.py --validate-only"
echo "3. Create OpenSearch index: python3.11 $APP_DIR/worker.py --create-index"
echo "4. Start the service: sudo systemctl start $SERVICE_NAME"
echo "5. Check status: sudo systemctl status $SERVICE_NAME"
echo "6. View logs: sudo journalctl -u $SERVICE_NAME -f"
echo ""
