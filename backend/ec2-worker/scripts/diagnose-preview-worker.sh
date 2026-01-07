#!/bin/bash
#
# Diagnostic Script for CIS Preview Worker on ASG Instances
# Run this script on a problematic instance to identify issues
#
# Usage:
#   ssh ec2-user@<instance-ip> 'sudo /opt/cis-file-processor/scripts/diagnose-preview-worker.sh'
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

APP_DIR="/opt/cis-file-processor"
LOG_DIR="/var/log/cis-worker"

echo "=============================================="
echo "CIS Preview Worker - Diagnostic Report"
echo "Generated at: $(date)"
echo "=============================================="

# 1. Instance Information
echo -e "\n${YELLOW}[1] Instance Information${NC}"
echo "Instance ID: $(curl -s http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null || echo 'N/A')"
echo "Instance Type: $(curl -s http://169.254.169.254/latest/meta-data/instance-type 2>/dev/null || echo 'N/A')"
echo "AMI ID: $(curl -s http://169.254.169.254/latest/meta-data/ami-id 2>/dev/null || echo 'N/A')"
echo "IAM Role: $(curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/ 2>/dev/null || echo 'None attached!')"

# 2. Check Directory Structure
echo -e "\n${YELLOW}[2] Directory Structure${NC}"
echo "Application Directory:"
if [ -d "$APP_DIR" ]; then
    echo -e "  ${GREEN}[OK]${NC} $APP_DIR exists"
    ls -la "$APP_DIR/" 2>/dev/null | head -20
else
    echo -e "  ${RED}[ERROR]${NC} $APP_DIR does NOT exist!"
fi

echo -e "\nLog Directory:"
if [ -d "$LOG_DIR" ]; then
    echo -e "  ${GREEN}[OK]${NC} $LOG_DIR exists"
    ls -la "$LOG_DIR/" 2>/dev/null
else
    echo -e "  ${RED}[ERROR]${NC} $LOG_DIR does NOT exist!"
fi

# 3. Check Environment Files
echo -e "\n${YELLOW}[3] Environment Files${NC}"

check_env_file() {
    local file=$1
    if [ -f "$file" ]; then
        echo -e "  ${GREEN}[OK]${NC} $file exists"
        echo "  Content (sensitive values masked):"
        grep -v "^#" "$file" | grep -v "^$" | sed 's/\(PASSWORD\|SECRET\|KEY\)=.*/\1=****MASKED****/g' | sed 's/^/    /'
    else
        echo -e "  ${RED}[MISSING]${NC} $file does NOT exist!"
    fi
}

check_env_file "/etc/cis-worker.env"
echo ""
check_env_file "$APP_DIR/.env"

# 4. Check Python Virtual Environment
echo -e "\n${YELLOW}[4] Python Virtual Environment${NC}"
if [ -f "$APP_DIR/venv/bin/python" ]; then
    echo -e "  ${GREEN}[OK]${NC} Virtual environment exists"
    echo "  Python version: $($APP_DIR/venv/bin/python --version 2>&1)"
    echo "  Installed packages:"
    $APP_DIR/venv/bin/pip list 2>/dev/null | grep -E "(boto3|opensearch|requests)" | sed 's/^/    /'
else
    echo -e "  ${RED}[ERROR]${NC} Virtual environment NOT found at $APP_DIR/venv"
fi

# 5. Check preview_worker.py
echo -e "\n${YELLOW}[5] Preview Worker Script${NC}"
if [ -f "$APP_DIR/src/preview_worker.py" ]; then
    echo -e "  ${GREEN}[OK]${NC} preview_worker.py exists"
    echo "  Size: $(ls -lh $APP_DIR/src/preview_worker.py | awk '{print $5}')"
    echo "  Last modified: $(stat -c %y $APP_DIR/src/preview_worker.py 2>/dev/null || stat -f %Sm $APP_DIR/src/preview_worker.py 2>/dev/null)"
else
    echo -e "  ${RED}[ERROR]${NC} preview_worker.py NOT found!"
fi

# 6. Check Systemd Service
echo -e "\n${YELLOW}[6] Systemd Service Status${NC}"
echo "Service file location:"
if [ -f "/etc/systemd/system/cis-preview-worker.service" ]; then
    echo -e "  ${GREEN}[OK]${NC} /etc/systemd/system/cis-preview-worker.service"
else
    echo -e "  ${RED}[MISSING]${NC} cis-preview-worker.service not installed"
fi

echo -e "\nService status:"
systemctl status cis-preview-worker.service --no-pager 2>&1 | head -20 || echo "  Service not found"

echo -e "\nRecent journal entries:"
journalctl -u cis-preview-worker.service -n 30 --no-pager 2>&1 | tail -30 || echo "  No journal entries"

# 7. Check Environment Variables in Service
echo -e "\n${YELLOW}[7] Environment Variables (from systemd)${NC}"
if systemctl show cis-preview-worker.service -p Environment 2>/dev/null; then
    systemctl show cis-preview-worker.service -p Environment | sed 's/^/  /'
    systemctl show cis-preview-worker.service -p EnvironmentFile | sed 's/^/  /'
else
    echo "  Cannot query systemd environment"
fi

# 8. Test AWS Connectivity
echo -e "\n${YELLOW}[8] AWS Connectivity Tests${NC}"

# Source environment
if [ -f /etc/cis-worker.env ]; then
    set -a
    source /etc/cis-worker.env
    set +a
fi

# Test STS (IAM credentials)
echo "Testing IAM credentials..."
if aws sts get-caller-identity 2>/dev/null; then
    echo -e "  ${GREEN}[OK]${NC} IAM credentials working"
else
    echo -e "  ${RED}[ERROR]${NC} Cannot get caller identity!"
    echo "  Check if IAM role is attached to the instance"
fi

# Test SQS
echo -e "\nTesting SQS access..."
if [ -n "$PREVIEW_QUEUE_URL" ]; then
    if aws sqs get-queue-attributes --queue-url "$PREVIEW_QUEUE_URL" --attribute-names ApproximateNumberOfMessages 2>/dev/null; then
        echo -e "  ${GREEN}[OK]${NC} SQS queue accessible"
    else
        echo -e "  ${RED}[ERROR]${NC} Cannot access SQS queue"
    fi
else
    echo -e "  ${RED}[ERROR]${NC} PREVIEW_QUEUE_URL not set!"
fi

# Test S3
echo -e "\nTesting S3 access..."
if [ -n "$S3_LANDING_BUCKET" ]; then
    if aws s3 ls "s3://$S3_LANDING_BUCKET/" --max-items 1 2>/dev/null; then
        echo -e "  ${GREEN}[OK]${NC} S3 bucket accessible"
    else
        echo -e "  ${RED}[ERROR]${NC} Cannot access S3 bucket"
    fi
else
    echo -e "  ${RED}[ERROR]${NC} S3_LANDING_BUCKET not set!"
fi

# 9. Check Log Files
echo -e "\n${YELLOW}[9] Recent Log Entries${NC}"
echo "--- preview-worker.log (last 20 lines) ---"
if [ -f "$LOG_DIR/preview-worker.log" ]; then
    tail -20 "$LOG_DIR/preview-worker.log" 2>/dev/null | sed 's/^/  /'
else
    echo "  Log file not found"
fi

echo -e "\n--- preview-worker-error.log (last 20 lines) ---"
if [ -f "$LOG_DIR/preview-worker-error.log" ]; then
    tail -20 "$LOG_DIR/preview-worker-error.log" 2>/dev/null | sed 's/^/  /'
else
    echo "  Error log file not found"
fi

echo -e "\n--- user-data.log (last 30 lines) ---"
if [ -f "/var/log/user-data.log" ]; then
    tail -30 "/var/log/user-data.log" 2>/dev/null | sed 's/^/  /'
else
    echo "  User data log not found"
fi

# 10. Test Python Import
echo -e "\n${YELLOW}[10] Python Import Test${NC}"
if [ -f "$APP_DIR/venv/bin/python" ]; then
    cd "$APP_DIR"
    $APP_DIR/venv/bin/python -c "
import sys
sys.path.insert(0, 'src')
print('Testing imports...')
try:
    from config import config
    print(f'  config: OK')
    print(f'    OPENSEARCH_ENDPOINT: {config.opensearch.endpoint}')
    print(f'    S3_LANDING_BUCKET: {config.s3.landing_bucket}')
except Exception as e:
    print(f'  config: FAILED - {e}')

try:
    import boto3
    print('  boto3: OK')
except Exception as e:
    print(f'  boto3: FAILED - {e}')

try:
    from opensearchpy import OpenSearch
    print('  opensearchpy: OK')
except Exception as e:
    print(f'  opensearchpy: FAILED - {e}')
" 2>&1 | sed 's/^/  /'
fi

# 11. Check Network Connectivity
echo -e "\n${YELLOW}[11] Network Connectivity${NC}"
echo "DNS resolution:"
nslookup sqs.ap-northeast-1.amazonaws.com 2>&1 | head -5 | sed 's/^/  /'

echo -e "\nOpenSearch endpoint (if set):"
if [ -n "$OPENSEARCH_ENDPOINT" ]; then
    # Extract hostname
    OPENSEARCH_HOST=$(echo "$OPENSEARCH_ENDPOINT" | sed 's|https://||' | sed 's|/.*||')
    echo "  Checking: $OPENSEARCH_HOST"
    if nc -z -w5 "$OPENSEARCH_HOST" 443 2>/dev/null; then
        echo -e "  ${GREEN}[OK]${NC} Port 443 reachable"
    else
        echo -e "  ${RED}[ERROR]${NC} Cannot reach port 443"
    fi
fi

# Summary
echo -e "\n${YELLOW}=============================================="
echo "Diagnostic Report Complete"
echo "==============================================${NC}"
echo ""
echo "Common issues to check:"
echo "1. Missing or incorrect /etc/cis-worker.env file"
echo "2. IAM role not attached or missing permissions"
echo "3. Security group blocking OpenSearch access"
echo "4. Virtual environment not created or dependencies missing"
echo "5. User data script failed during instance launch"
