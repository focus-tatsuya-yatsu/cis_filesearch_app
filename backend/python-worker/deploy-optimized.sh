#!/bin/bash

################################################################################
# File Processing Worker - Optimized Deployment Script
#
# This script deploys the optimized worker configuration and sets up systemd
# service for continuous operation without restarts.
#
# Usage:
#   chmod +x deploy-optimized.sh
#   sudo ./deploy-optimized.sh
#
# Expected Performance Improvement:
#   - 5-8x faster processing (60 → 300-500 msg/min)
#   - Zero restart overhead
#   - Better resource utilization
################################################################################

set -e  # Exit on error
set -u  # Exit on undefined variable

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
WORKER_DIR="/home/ec2-user/python-worker"
SERVICE_NAME="file-worker"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
ENV_FILE="${WORKER_DIR}/.env"

################################################################################
# Helper Functions
################################################################################

print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

check_files() {
    print_header "Checking Required Files"

    local missing_files=0

    if [ ! -f "${WORKER_DIR}/worker_optimized.py" ]; then
        print_error "worker_optimized.py not found in ${WORKER_DIR}"
        missing_files=$((missing_files + 1))
    else
        print_success "worker_optimized.py found"
    fi

    if [ ! -f "${WORKER_DIR}/.env.optimized" ]; then
        print_warning ".env.optimized not found - will create from template"
    else
        print_success ".env.optimized found"
    fi

    if [ $missing_files -gt 0 ]; then
        print_error "Missing required files. Please check the installation."
        exit 1
    fi
}

stop_existing_worker() {
    print_header "Stopping Existing Worker Processes"

    # Stop systemd service if it exists
    if systemctl is-active --quiet ${SERVICE_NAME}; then
        print_warning "Stopping existing systemd service..."
        systemctl stop ${SERVICE_NAME}
        print_success "Systemd service stopped"
    fi

    # Kill any running worker processes
    if pgrep -f "worker.py\|worker_optimized.py" > /dev/null; then
        print_warning "Killing existing worker processes..."
        pkill -f "worker.py\|worker_optimized.py" || true
        sleep 2
        print_success "Existing processes stopped"
    else
        print_success "No existing worker processes found"
    fi
}

setup_environment() {
    print_header "Setting Up Environment Variables"

    if [ ! -f "${ENV_FILE}" ]; then
        if [ -f "${WORKER_DIR}/.env.optimized" ]; then
            print_warning "Creating .env from .env.optimized template..."
            cp "${WORKER_DIR}/.env.optimized" "${ENV_FILE}"
            print_success "Environment file created"
            print_warning "IMPORTANT: Please edit ${ENV_FILE} and update:"
            echo "  - SQS_QUEUE_URL"
            echo "  - OPENSEARCH_ENDPOINT"
            echo "  - AWS credentials (if needed)"
            read -p "Press Enter after updating the .env file..."
        else
            print_error ".env.optimized template not found"
            exit 1
        fi
    else
        print_success "Using existing .env file"
    fi

    # Validate critical environment variables
    source "${ENV_FILE}"

    if [ -z "${SQS_QUEUE_URL:-}" ]; then
        print_error "SQS_QUEUE_URL not set in .env file"
        exit 1
    fi

    if [[ "${SQS_QUEUE_URL}" == *"YOUR_ACCOUNT_ID"* ]]; then
        print_error "Please update SQS_QUEUE_URL in .env file with actual queue URL"
        exit 1
    fi

    print_success "Environment variables validated"
}

create_systemd_service() {
    print_header "Creating Systemd Service"

    cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=File Processing Worker - Optimized
Documentation=file://${WORKER_DIR}/PERFORMANCE_OPTIMIZATION_REPORT.md
After=network.target

[Service]
Type=simple
User=ec2-user
Group=ec2-user
WorkingDirectory=${WORKER_DIR}

# Load environment variables
EnvironmentFile=${ENV_FILE}

# Main process
ExecStart=/usr/bin/python3 ${WORKER_DIR}/worker_optimized.py

# Restart policy
Restart=on-failure
RestartSec=10
StartLimitInterval=300
StartLimitBurst=5

# Resource limits (for t3.medium: 2 vCPU, 4GB RAM)
MemoryMax=3.5G
MemoryHigh=3G
CPUQuota=180%

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# Security
NoNewPrivileges=true
PrivateTmp=true

# Process management
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF

    print_success "Systemd service file created at ${SERVICE_FILE}"
}

start_service() {
    print_header "Starting Optimized Worker Service"

    # Reload systemd daemon
    systemctl daemon-reload
    print_success "Systemd daemon reloaded"

    # Enable service to start on boot
    systemctl enable ${SERVICE_NAME}
    print_success "Service enabled for auto-start"

    # Start the service
    systemctl start ${SERVICE_NAME}
    sleep 3

    # Check service status
    if systemctl is-active --quiet ${SERVICE_NAME}; then
        print_success "Service started successfully"
    else
        print_error "Service failed to start"
        echo -e "\nService status:"
        systemctl status ${SERVICE_NAME} --no-pager
        exit 1
    fi
}

show_status() {
    print_header "Service Status"

    systemctl status ${SERVICE_NAME} --no-pager

    print_header "Recent Logs"
    journalctl -u ${SERVICE_NAME} -n 20 --no-pager

    print_header "Deployment Summary"
    echo -e "Service Name:     ${GREEN}${SERVICE_NAME}${NC}"
    echo -e "Service File:     ${SERVICE_FILE}"
    echo -e "Working Dir:      ${WORKER_DIR}"
    echo -e "Environment File: ${ENV_FILE}"
    echo -e "Python Script:    ${WORKER_DIR}/worker_optimized.py"

    print_header "Useful Commands"
    echo "View live logs:        sudo journalctl -u ${SERVICE_NAME} -f"
    echo "Check status:          sudo systemctl status ${SERVICE_NAME}"
    echo "Restart service:       sudo systemctl restart ${SERVICE_NAME}"
    echo "Stop service:          sudo systemctl stop ${SERVICE_NAME}"
    echo "Disable auto-start:    sudo systemctl disable ${SERVICE_NAME}"

    print_header "Performance Monitoring"
    echo "Watch CloudWatch Metrics in AWS Console:"
    echo "  - Namespace: CISFileSearch/Worker"
    echo "  - Metrics: ProcessedMessages, SuccessRate, MemoryUtilization"
    echo ""
    echo "Expected Performance:"
    echo "  - Processing Speed: 300-500 messages/min (5-8x improvement)"
    echo "  - Memory Usage: 2-3 GB"
    echo "  - CPU Usage: 60-80%"
}

################################################################################
# Main Deployment Flow
################################################################################

main() {
    print_header "File Processing Worker - Optimized Deployment"

    # Pre-flight checks
    check_root
    check_files

    # Deployment steps
    stop_existing_worker
    setup_environment
    create_systemd_service
    start_service

    # Post-deployment
    show_status

    print_header "Deployment Complete!"
    print_success "Worker is now running as a systemd service"
    print_warning "Monitor the logs for the first few minutes to ensure proper operation"

    echo ""
    read -p "Would you like to follow the logs now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        journalctl -u ${SERVICE_NAME} -f
    fi
}

################################################################################
# Script Entry Point
################################################################################

# Run main function
main "$@"
