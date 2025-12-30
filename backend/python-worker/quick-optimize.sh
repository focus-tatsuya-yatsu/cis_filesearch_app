#!/bin/bash

################################################################################
# Quick Optimization Script
# One-command performance optimization for file processing worker
#
# This script:
# 1. Stops existing worker
# 2. Updates environment variables for optimal performance
# 3. Switches to worker_optimized.py
# 4. Monitors the results
#
# Usage:
#   chmod +x quick-optimize.sh
#   ./quick-optimize.sh
#
# Expected Result: 5-8x faster processing (60 → 300-500 msg/min)
################################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
cat << "EOF"
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   File Processing Worker - Quick Performance Optimization    ║
║                                                               ║
║   Expected Result: 5-8x faster processing                    ║
║   Implementation Time: 5 minutes                              ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
EOF
echo -e "${NC}\n"

# Check if running as ec2-user (not root)
if [ "$EUID" -eq 0 ]; then
    echo -e "${RED}ERROR: Do not run this script as root${NC}"
    echo "Run as ec2-user: ./quick-optimize.sh"
    exit 1
fi

WORKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$WORKER_DIR"

################################################################################
# Step 1: Stop Existing Worker
################################################################################

echo -e "${BLUE}Step 1: Stopping existing worker processes...${NC}"

if pgrep -f "worker.py\|worker_optimized.py" > /dev/null; then
    echo "Found running worker process, stopping..."
    pkill -f "worker.py\|worker_optimized.py" || true
    sleep 2
    echo -e "${GREEN}✓ Worker stopped${NC}"
else
    echo -e "${GREEN}✓ No running worker found${NC}"
fi

################################################################################
# Step 2: Create Optimized Environment
################################################################################

echo -e "\n${BLUE}Step 2: Setting up optimized configuration...${NC}"

# Backup existing .env if it exists
if [ -f ".env" ]; then
    echo "Backing up existing .env to .env.backup.$(date +%Y%m%d_%H%M%S)"
    cp .env ".env.backup.$(date +%Y%m%d_%H%M%S)"
fi

# Create optimized .env
cat > .env << 'EOF'
# Optimized Configuration - Auto-generated
# Edit the values below as needed

# AWS Configuration
AWS_REGION=ap-northeast-1
S3_BUCKET=cis-filesearch-storage

# SQS Configuration - OPTIMIZED
SQS_MAX_MESSAGES=10
SQS_WAIT_TIME=20
SQS_VISIBILITY_TIMEOUT=900

# Processing Configuration
MAX_WORKERS=1
PROCESSING_TIMEOUT=600
OCR_TIMEOUT=300

# OCR Configuration - OPTIMIZED
PDF_DPI=200
MAX_PDF_PAGES=100
OCR_LANGUAGE=jpn+eng
IMAGE_PREPROCESSING=true

# Memory Management - OPTIMIZED
TEMP_DIR=/tmp/file-processor
CLEANUP_TEMP_FILES=true

# Logging
LOG_LEVEL=INFO
USE_CLOUDWATCH=true
CLOUDWATCH_LOG_GROUP=/aws/ec2/file-processor
CLOUDWATCH_LOG_STREAM=worker

# Thumbnail Configuration
THUMBNAIL_WIDTH=200
THUMBNAIL_HEIGHT=200
THUMBNAIL_QUALITY=85
EOF

# Prompt for required values
echo -e "\n${YELLOW}Please provide the following required values:${NC}\n"

read -p "SQS Queue URL: " SQS_QUEUE_URL
read -p "OpenSearch Endpoint: " OPENSEARCH_ENDPOINT

# Append to .env
cat >> .env << EOF

# Service Endpoints (User-provided)
SQS_QUEUE_URL=${SQS_QUEUE_URL}
OPENSEARCH_ENDPOINT=${OPENSEARCH_ENDPOINT}
OPENSEARCH_INDEX=file-index
OPENSEARCH_USE_SSL=true
OPENSEARCH_VERIFY_CERTS=true
EOF

echo -e "${GREEN}✓ Configuration file created${NC}"

################################################################################
# Step 3: Validate Configuration
################################################################################

echo -e "\n${BLUE}Step 3: Validating configuration...${NC}"

# Source the environment
source .env

if [ -z "$SQS_QUEUE_URL" ]; then
    echo -e "${RED}✗ SQS_QUEUE_URL is empty${NC}"
    exit 1
fi

if [ -z "$OPENSEARCH_ENDPOINT" ]; then
    echo -e "${RED}✗ OPENSEARCH_ENDPOINT is empty${NC}"
    exit 1
fi

# Test Python script
if ! python3 worker_optimized.py --validate-only; then
    echo -e "${RED}✗ Configuration validation failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Configuration validated${NC}"

################################################################################
# Step 4: Start Optimized Worker
################################################################################

echo -e "\n${BLUE}Step 4: Starting optimized worker...${NC}"

# Start in background with nohup
nohup python3 worker_optimized.py > worker.log 2>&1 &
WORKER_PID=$!

echo "Worker PID: $WORKER_PID"
echo $WORKER_PID > worker.pid

# Wait for startup
sleep 5

# Check if process is still running
if kill -0 $WORKER_PID 2>/dev/null; then
    echo -e "${GREEN}✓ Worker started successfully${NC}"
else
    echo -e "${RED}✗ Worker failed to start${NC}"
    echo "Check worker.log for errors:"
    tail -20 worker.log
    exit 1
fi

################################################################################
# Step 5: Monitor Performance
################################################################################

echo -e "\n${BLUE}Step 5: Monitoring performance...${NC}\n"

echo -e "${GREEN}Optimization complete!${NC}\n"

cat << EOF
╔═══════════════════════════════════════════════════════════════╗
║                    Deployment Summary                         ║
╠═══════════════════════════════════════════════════════════════╣
║ Worker Process:    worker_optimized.py                        ║
║ Process ID:        ${WORKER_PID}                                         ║
║ Configuration:     .env                                       ║
║ Log File:          worker.log                                 ║
║                                                               ║
║ Expected Performance:                                         ║
║   Processing Speed:  300-500 messages/min (5-8x improvement)  ║
║   Memory Usage:      2-3 GB                                   ║
║   CPU Usage:         60-80%                                   ║
╚═══════════════════════════════════════════════════════════════╝

Useful Commands:
  View logs:           tail -f worker.log
  Stop worker:         kill ${WORKER_PID}
  Check status:        ps -p ${WORKER_PID}
  Monitor resources:   top -p ${WORKER_PID}

EOF

# Show first performance metrics
echo -e "${YELLOW}Waiting for first batch processing...${NC}"
echo -e "Showing live logs (Ctrl+C to exit monitoring):\n"

# Tail logs
tail -f worker.log &
TAIL_PID=$!

# Wait for user interrupt
trap "kill $TAIL_PID 2>/dev/null; exit 0" INT TERM

wait $TAIL_PID
