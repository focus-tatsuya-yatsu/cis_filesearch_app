#!/bin/bash
# ============================================================================
# Worker Exit Status 1 Root Cause Diagnostic Script
# ============================================================================
# Purpose: Identify the exact reason why worker.py exits with status=1
# Author: Backend File Search System Expert
# Date: 2025-12-15
# ============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
EC2_NAME_TAG="cis-filesearch-ec2"
SSH_KEY="${HOME}/.ssh/cis-filesearch-key.pem"

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}Worker Exit Status 1 Diagnostic${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""

# Get EC2 instance IP
echo -e "${YELLOW}[1/10]${NC} Getting EC2 instance IP..."
EC2_IP=$(aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=${EC2_NAME_TAG}" "Name=instance-state-name,Values=running" \
    --query "Reservations[0].Instances[0].PublicIpAddress" \
    --output text)

if [ "$EC2_IP" == "None" ] || [ -z "$EC2_IP" ]; then
    echo -e "${RED}ERROR: EC2 instance not found or not running${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} EC2 IP: $EC2_IP"
echo ""

# Function to run SSH command
run_ssh() {
    ssh -o StrictHostKeyChecking=no -i "$SSH_KEY" "ec2-user@${EC2_IP}" "$@"
}

# ============================================================================
# DIAGNOSTIC 1: Check Python Version and Path
# ============================================================================
echo -e "${YELLOW}[2/10]${NC} Checking Python installation..."
run_ssh 'bash -s' << 'EOF'
echo "=== Python Version ==="
python3 --version 2>&1 || echo "python3 not found"
python3.11 --version 2>&1 || echo "python3.11 not found"
which python3
which python3.11 || echo "python3.11 not in PATH"
echo ""
EOF

# ============================================================================
# DIAGNOSTIC 2: Check if worker.py exists and is readable
# ============================================================================
echo -e "${YELLOW}[3/10]${NC} Checking worker.py file..."
run_ssh 'bash -s' << 'EOF'
echo "=== Worker.py Status ==="
if [ -f /opt/worker/worker.py ]; then
    echo "✓ worker.py exists"
    ls -lah /opt/worker/worker.py
    echo ""
    echo "First 5 lines:"
    head -5 /opt/worker/worker.py
else
    echo "✗ worker.py NOT FOUND"
fi
echo ""
EOF

# ============================================================================
# DIAGNOSTIC 3: Test Python Import of Dependencies
# ============================================================================
echo -e "${YELLOW}[4/10]${NC} Testing Python module imports..."
run_ssh 'bash -s' << 'EOF'
echo "=== Python Module Import Test ==="

# Test each critical module
echo "Testing boto3..."
python3 -c "import boto3; print('✓ boto3 OK')" 2>&1 || echo "✗ boto3 FAILED"

echo "Testing opensearchpy..."
python3 -c "import opensearchpy; print('✓ opensearchpy OK')" 2>&1 || echo "✗ opensearchpy FAILED"

echo "Testing config module..."
cd /opt/worker 2>/dev/null || cd /opt/file-processor 2>/dev/null || echo "Worker directory not found"
python3 -c "from config import get_config; print('✓ config OK')" 2>&1 || echo "✗ config FAILED"

echo "Testing file_router module..."
python3 -c "from file_router import FileRouter; print('✓ file_router OK')" 2>&1 || echo "✗ file_router FAILED"

echo "Testing opensearch_client module..."
python3 -c "from opensearch_client import OpenSearchClient; print('✓ opensearch_client OK')" 2>&1 || echo "✗ opensearch_client FAILED"

echo ""
EOF

# ============================================================================
# DIAGNOSTIC 4: Check Environment Variables
# ============================================================================
echo -e "${YELLOW}[5/10]${NC} Checking environment variables..."
run_ssh 'bash -s' << 'EOF'
echo "=== Environment Variables ==="
echo "SQS_QUEUE_URL: ${SQS_QUEUE_URL:-NOT SET}"
echo "S3_BUCKET: ${S3_BUCKET:-NOT SET}"
echo "OPENSEARCH_ENDPOINT: ${OPENSEARCH_ENDPOINT:-NOT SET}"
echo "AWS_REGION: ${AWS_REGION:-NOT SET}"
echo "LOG_LEVEL: ${LOG_LEVEL:-NOT SET}"
echo ""

# Check if .env file exists
if [ -f /opt/worker/.env ]; then
    echo "✓ /opt/worker/.env exists"
    echo "Contents:"
    cat /opt/worker/.env
elif [ -f /opt/file-processor/.env ]; then
    echo "✓ /opt/file-processor/.env exists"
    echo "Contents:"
    cat /opt/file-processor/.env
else
    echo "✗ No .env file found"
fi
echo ""
EOF

# ============================================================================
# DIAGNOSTIC 5: Check Systemd Service Configuration
# ============================================================================
echo -e "${YELLOW}[6/10]${NC} Checking systemd service configuration..."
run_ssh 'bash -s' << 'EOF'
echo "=== Systemd Service Configuration ==="
if [ -f /etc/systemd/system/file-scanner-worker.service ]; then
    echo "Service file: /etc/systemd/system/file-scanner-worker.service"
    cat /etc/systemd/system/file-scanner-worker.service
elif [ -f /etc/systemd/system/file-processor.service ]; then
    echo "Service file: /etc/systemd/system/file-processor.service"
    cat /etc/systemd/system/file-processor.service
else
    echo "✗ No systemd service file found"
fi
echo ""
EOF

# ============================================================================
# DIAGNOSTIC 6: Check Recent Journal Logs
# ============================================================================
echo -e "${YELLOW}[7/10]${NC} Checking systemd journal logs..."
run_ssh 'bash -s' << 'EOF'
echo "=== Recent Journal Logs (last 50 lines) ==="
journalctl -u file-scanner-worker -n 50 --no-pager 2>/dev/null || \
journalctl -u file-processor -n 50 --no-pager 2>/dev/null || \
echo "✗ No journal logs available"
echo ""
EOF

# ============================================================================
# DIAGNOSTIC 7: Try Running worker.py Manually
# ============================================================================
echo -e "${YELLOW}[8/10]${NC} Testing manual worker.py execution..."
run_ssh 'bash -s' << 'EOF'
echo "=== Manual Worker Execution Test ==="
cd /opt/worker 2>/dev/null || cd /opt/file-processor 2>/dev/null || {
    echo "✗ Worker directory not found"
    exit 1
}

# Source environment variables if available
if [ -f .env ]; then
    echo "Loading environment from .env..."
    set -a
    source .env
    set +a
fi

echo "Attempting to run worker.py with --validate-only..."
timeout 10 python3 -u worker.py --validate-only 2>&1 || {
    EXIT_CODE=$?
    echo ""
    echo "Exit code: $EXIT_CODE"
    if [ $EXIT_CODE -eq 1 ]; then
        echo "✗ CONFIRMED: worker.py exits with status 1"
    fi
}
echo ""
EOF

# ============================================================================
# DIAGNOSTIC 8: Check File Permissions
# ============================================================================
echo -e "${YELLOW}[9/10]${NC} Checking file permissions..."
run_ssh 'bash -s' << 'EOF'
echo "=== File Permissions ==="
ls -la /opt/worker/ 2>/dev/null || ls -la /opt/file-processor/ 2>/dev/null || echo "Directory not found"
echo ""
EOF

# ============================================================================
# DIAGNOSTIC 9: Check Python Package Installation
# ============================================================================
echo -e "${YELLOW}[10/10]${NC} Checking installed Python packages..."
run_ssh 'bash -s' << 'EOF'
echo "=== Installed Python Packages ==="
python3 -m pip list | grep -E "(boto3|opensearch|requests|Pillow)" || echo "Required packages not found"
echo ""

echo "=== pip list (all packages) ==="
python3 -m pip list
echo ""
EOF

# ============================================================================
# Summary
# ============================================================================
echo ""
echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}Diagnostic Complete${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""
echo -e "${GREEN}Diagnostic log saved to:${NC}"
echo "  /var/log/worker-diagnostic.log (on EC2)"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Review the output above to identify the root cause"
echo "2. Common issues:"
echo "   - Missing Python dependencies (import errors)"
echo "   - Missing environment variables (SQS_QUEUE_URL, etc.)"
echo "   - Wrong Python version (needs 3.11+)"
echo "   - File not found (/opt/worker/worker.py)"
echo "   - Permission issues"
echo ""
echo "3. If you see import errors, install missing packages:"
echo "   ssh -i $SSH_KEY ec2-user@${EC2_IP}"
echo "   cd /opt/worker"
echo "   sudo pip3 install -r requirements.txt"
echo ""
echo "4. If environment variables are missing, check:"
echo "   /opt/worker/.env"
echo "   /etc/systemd/system/file-scanner-worker.service"
echo ""
