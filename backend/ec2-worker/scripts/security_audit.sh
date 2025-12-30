#!/bin/bash
#
# Security Audit Script for EC2 Worker
# Performs comprehensive security checks
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}CIS File Processor - Security Audit${NC}"
echo -e "${GREEN}========================================${NC}"

# ============================================================================
# 1. Python Dependencies Vulnerability Scan
# ============================================================================

echo -e "\n${YELLOW}[1/8] Scanning Python dependencies for vulnerabilities...${NC}"

if command -v pip-audit &> /dev/null; then
    pip-audit --format json --output dependencies_vulnerabilities.json
    echo -e "${GREEN}✓ Vulnerability scan complete${NC}"
    echo -e "  Results saved to: dependencies_vulnerabilities.json"
else
    echo -e "${RED}✗ pip-audit not installed${NC}"
    echo -e "  Install with: pip install pip-audit"
fi

# ============================================================================
# 2. Check for Hardcoded Secrets
# ============================================================================

echo -e "\n${YELLOW}[2/8] Checking for hardcoded secrets...${NC}"

SECRET_PATTERNS=(
    "AKIA[0-9A-Z]{16}"  # AWS Access Key
    "password\s*=\s*['\"][^'\"]{8,}['\"]"
    "api[_-]?key\s*=\s*['\"][^'\"]{20,}['\"]"
    "secret\s*=\s*['\"][^'\"]{20,}['\"]"
)

SECRETS_FOUND=0

for pattern in "${SECRET_PATTERNS[@]}"; do
    if grep -r -E "$pattern" ../src/ 2>/dev/null; then
        SECRETS_FOUND=$((SECRETS_FOUND + 1))
    fi
done

if [ $SECRETS_FOUND -eq 0 ]; then
    echo -e "${GREEN}✓ No hardcoded secrets found${NC}"
else
    echo -e "${RED}✗ Found $SECRETS_FOUND potential secrets${NC}"
fi

# ============================================================================
# 3. File Permissions Check
# ============================================================================

echo -e "\n${YELLOW}[3/8] Checking file permissions...${NC}"

# Check for world-writable files
WORLD_WRITABLE=$(find ../src -type f -perm -002 2>/dev/null || echo "")

if [ -z "$WORLD_WRITABLE" ]; then
    echo -e "${GREEN}✓ No world-writable files found${NC}"
else
    echo -e "${RED}✗ World-writable files found:${NC}"
    echo "$WORLD_WRITABLE"
fi

# ============================================================================
# 4. Check systemd Service Security
# ============================================================================

echo -e "\n${YELLOW}[4/8] Checking systemd service security...${NC}"

if [ -f "../deploy/cis-worker.service" ]; then
    # Check if running as root
    if grep -q "^User=root" ../deploy/cis-worker.service; then
        echo -e "${RED}✗ Service configured to run as root${NC}"
    else
        echo -e "${GREEN}✓ Service runs as non-root user${NC}"
    fi

    # Check security hardening options
    SECURITY_OPTIONS=(
        "NoNewPrivileges=true"
        "PrivateTmp=true"
        "ProtectSystem=strict"
        "ProtectHome=true"
    )

    for option in "${SECURITY_OPTIONS[@]}"; do
        if grep -q "$option" ../deploy/cis-worker.service; then
            echo -e "${GREEN}✓ $option enabled${NC}"
        else
            echo -e "${YELLOW}⚠ $option not configured${NC}"
        fi
    done
else
    echo -e "${YELLOW}⚠ Service file not found${NC}"
fi

# ============================================================================
# 5. Check IAM Role (if running on EC2)
# ============================================================================

echo -e "\n${YELLOW}[5/8] Checking IAM role configuration...${NC}"

# Check if running on EC2
if curl -s -m 2 http://169.254.169.254/latest/meta-data/instance-id &>/dev/null; then
    echo -e "${GREEN}✓ Running on EC2 instance${NC}"

    # Get IAM role
    IAM_ROLE=$(curl -s http://169.254.169.254/latest/meta-data/iam/security-credentials/)

    if [ -n "$IAM_ROLE" ]; then
        echo -e "${GREEN}✓ IAM role attached: $IAM_ROLE${NC}"
    else
        echo -e "${RED}✗ No IAM role attached${NC}"
    fi

    # Check if IMDSv2 is enforced
    IMDS_VERSION=$(curl -s -w "%{http_code}" http://169.254.169.254/latest/meta-data/instance-id -o /dev/null)

    if [ "$IMDS_VERSION" == "401" ]; then
        echo -e "${GREEN}✓ IMDSv2 is enforced${NC}"
    else
        echo -e "${YELLOW}⚠ IMDSv2 not enforced (potential SSRF risk)${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Not running on EC2 (skipping IAM check)${NC}"
fi

# ============================================================================
# 6. Check Environment Variables
# ============================================================================

echo -e "\n${YELLOW}[6/8] Checking environment configuration...${NC}"

if [ -f "../.env" ]; then
    # Check for AWS credentials in .env
    if grep -q "AWS_ACCESS_KEY_ID" ../.env; then
        echo -e "${RED}✗ AWS credentials found in .env file${NC}"
        echo -e "  Use IAM role instead of hardcoded credentials"
    else
        echo -e "${GREEN}✓ No AWS credentials in .env${NC}"
    fi

    # Check for passwords in .env
    if grep -q "PASSWORD" ../.env; then
        echo -e "${YELLOW}⚠ Password found in .env file${NC}"
        echo -e "  Consider using AWS Secrets Manager"
    fi
else
    echo -e "${YELLOW}⚠ .env file not found${NC}"
fi

# ============================================================================
# 7. Check Network Configuration
# ============================================================================

echo -e "\n${YELLOW}[7/8] Checking network configuration...${NC}"

# Check if running in private subnet
if ip route | grep -q "default via"; then
    GATEWAY=$(ip route | grep "default via" | awk '{print $3}')
    echo -e "${GREEN}✓ Default gateway: $GATEWAY${NC}"

    # Check if NAT gateway (private subnet) or Internet Gateway (public subnet)
    if ip addr | grep -q "172."; then
        echo -e "${GREEN}✓ Running in private subnet${NC}"
    else
        echo -e "${YELLOW}⚠ Running in public subnet (consider moving to private)${NC}"
    fi
fi

# Check open ports
if command -v ss &> /dev/null; then
    LISTENING_PORTS=$(ss -tuln | grep LISTEN | awk '{print $5}' | cut -d':' -f2 | sort -u)
    echo -e "${GREEN}Listening ports:${NC}"
    echo "$LISTENING_PORTS"
fi

# ============================================================================
# 8. Check Log Files
# ============================================================================

echo -e "\n${YELLOW}[8/8] Checking log files for sensitive data...${NC}"

if [ -d "/var/log/cis-worker" ]; then
    # Check for AWS keys in logs
    if grep -r "AKIA" /var/log/cis-worker/ 2>/dev/null; then
        echo -e "${RED}✗ AWS keys found in log files${NC}"
    else
        echo -e "${GREEN}✓ No AWS keys in logs${NC}"
    fi

    # Check for passwords in logs
    if grep -r -i "password" /var/log/cis-worker/ | grep -v "password.*\*\*\*" 2>/dev/null; then
        echo -e "${RED}✗ Passwords found in log files${NC}"
    else
        echo -e "${GREEN}✓ No passwords in logs${NC}"
    fi

    # Check log file permissions
    LOG_PERMS=$(find /var/log/cis-worker/ -type f -perm -044 2>/dev/null || echo "")

    if [ -z "$LOG_PERMS" ]; then
        echo -e "${GREEN}✓ Log files have restrictive permissions${NC}"
    else
        echo -e "${YELLOW}⚠ Some log files are world-readable${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Log directory not found${NC}"
fi

# ============================================================================
# Summary
# ============================================================================

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Security Audit Complete${NC}"
echo -e "${GREEN}========================================${NC}"

echo -e "\n${YELLOW}Recommendations:${NC}"
echo "1. Install pip-audit for dependency scanning: pip install pip-audit"
echo "2. Review and fix any vulnerabilities found"
echo "3. Ensure systemd service runs as non-root user"
echo "4. Use IAM role instead of hardcoded AWS credentials"
echo "5. Enable IMDSv2 on EC2 instances"
echo "6. Store sensitive data in AWS Secrets Manager"
echo "7. Deploy in private subnets with VPC endpoints"
echo "8. Implement log sanitization for sensitive data"

echo -e "\n${GREEN}Next steps:${NC}"
echo "• Review the generated report: dependencies_vulnerabilities.json"
echo "• Run: python ../src/verify_aws_config.py"
echo "• Check DLQ messages: python analyze_dlq.py <DLQ_URL>"
