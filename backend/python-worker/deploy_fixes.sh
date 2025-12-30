#!/bin/bash
# Emergency Deployment Script for SQS Queue Fixes
# This script deploys critical fixes to the EC2 worker instance

set -e  # Exit on error

# Configuration
EC2_IP="${EC2_IP:-13.231.196.150}"
SSH_KEY="${SSH_KEY:-~/cis_key_pair.pem}"
REMOTE_USER="ec2-user"
REMOTE_DIR="/home/ec2-user/file-processor"
SERVICE_NAME="phased-worker.service"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored messages
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    if [ ! -f "$SSH_KEY" ]; then
        log_error "SSH key not found: $SSH_KEY"
        log_info "Please set EC2 SSH key path: export SSH_KEY=/path/to/key.pem"
        exit 1
    fi

    if ! command -v ssh &> /dev/null; then
        log_error "ssh command not found"
        exit 1
    fi

    log_success "Prerequisites check passed"
}

# Test SSH connection
test_ssh() {
    log_info "Testing SSH connection to $EC2_IP..."

    if ssh -i "$SSH_KEY" -o ConnectTimeout=10 -o StrictHostKeyChecking=no \
        "$REMOTE_USER@$EC2_IP" "echo 'SSH connection successful'" &> /dev/null; then
        log_success "SSH connection successful"
        return 0
    else
        log_error "SSH connection failed"
        log_info "Please check:"
        log_info "  1. EC2 instance is running"
        log_info "  2. Security group allows SSH from your IP"
        log_info "  3. SSH key is correct"
        exit 1
    fi
}

# Backup existing files
backup_files() {
    log_info "Creating backup of existing files..."

    ssh -i "$SSH_KEY" "$REMOTE_USER@$EC2_IP" << 'EOF'
        BACKUP_DIR="/home/ec2-user/backups/$(date +%Y%m%d_%H%M%S)"
        mkdir -p "$BACKUP_DIR"

        if [ -f /home/ec2-user/file-processor/worker.py ]; then
            cp /home/ec2-user/file-processor/worker.py "$BACKUP_DIR/"
            echo "Backed up worker.py to $BACKUP_DIR"
        fi

        if [ -f /home/ec2-user/file-processor/config.py ]; then
            cp /home/ec2-user/file-processor/config.py "$BACKUP_DIR/"
            echo "Backed up config.py to $BACKUP_DIR"
        fi

        echo "$BACKUP_DIR"
EOF

    log_success "Backup created"
}

# Deploy files
deploy_files() {
    log_info "Deploying updated files..."

    # Deploy worker.py
    if [ -f "worker.py" ]; then
        scp -i "$SSH_KEY" worker.py "$REMOTE_USER@$EC2_IP:$REMOTE_DIR/"
        log_success "Deployed worker.py"
    else
        log_error "worker.py not found in current directory"
        exit 1
    fi

    # Deploy config.py
    if [ -f "config.py" ]; then
        scp -i "$SSH_KEY" config.py "$REMOTE_USER@$EC2_IP:$REMOTE_DIR/"
        log_success "Deployed config.py"
    else
        log_warning "config.py not found - skipping"
    fi

    # Deploy DLQ recovery script
    if [ -f "recover_dlq.py" ]; then
        scp -i "$SSH_KEY" recover_dlq.py "$REMOTE_USER@$EC2_IP:$REMOTE_DIR/"
        ssh -i "$SSH_KEY" "$REMOTE_USER@$EC2_IP" "chmod +x $REMOTE_DIR/recover_dlq.py"
        log_success "Deployed recover_dlq.py"
    else
        log_warning "recover_dlq.py not found - skipping"
    fi

    # Deploy emergency fixes documentation
    if [ -f "emergency_fixes.md" ]; then
        scp -i "$SSH_KEY" emergency_fixes.md "$REMOTE_USER@$EC2_IP:$REMOTE_DIR/"
        log_success "Deployed emergency_fixes.md"
    fi
}

# Update systemd service configuration
update_service_config() {
    log_info "Updating systemd service configuration..."

    ssh -i "$SSH_KEY" "$REMOTE_USER@$EC2_IP" << 'EOF'
        # Check if service file exists
        if [ ! -f /etc/systemd/system/phased-worker.service ]; then
            echo "Service file not found - creating default"
            sudo tee /etc/systemd/system/phased-worker.service > /dev/null << 'SERVICE'
[Unit]
Description=CIS File Search Worker
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/home/ec2-user/file-processor
Environment="SQS_VISIBILITY_TIMEOUT=600"
Environment="DLQ_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/381492033915/cis-filesearch-dlq"
ExecStart=/usr/bin/python3 /home/ec2-user/file-processor/worker.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SERVICE
        fi

        # Reload systemd
        sudo systemctl daemon-reload
        echo "Systemd configuration updated"
EOF

    log_success "Service configuration updated"
}

# Stop worker service
stop_worker() {
    log_info "Stopping worker service..."

    ssh -i "$SSH_KEY" "$REMOTE_USER@$EC2_IP" "sudo systemctl stop $SERVICE_NAME || true"

    log_success "Worker service stopped"
}

# Start worker service
start_worker() {
    log_info "Starting worker service..."

    ssh -i "$SSH_KEY" "$REMOTE_USER@$EC2_IP" "sudo systemctl start $SERVICE_NAME"

    sleep 3

    # Check status
    if ssh -i "$SSH_KEY" "$REMOTE_USER@$EC2_IP" "sudo systemctl is-active --quiet $SERVICE_NAME"; then
        log_success "Worker service started successfully"
    else
        log_error "Worker service failed to start"
        log_info "Checking logs..."
        ssh -i "$SSH_KEY" "$REMOTE_USER@$EC2_IP" "sudo journalctl -u $SERVICE_NAME -n 50 --no-pager"
        exit 1
    fi
}

# Verify deployment
verify_deployment() {
    log_info "Verifying deployment..."

    ssh -i "$SSH_KEY" "$REMOTE_USER@$EC2_IP" << 'EOF'
        echo "=== Service Status ==="
        sudo systemctl status phased-worker.service | head -20

        echo ""
        echo "=== Recent Logs ==="
        sudo journalctl -u phased-worker.service -n 20 --no-pager | grep -E "(started|initialized|OpenSearch|SQS)" || true

        echo ""
        echo "=== File Versions ==="
        if grep -q "_store_for_retry" /home/ec2-user/file-processor/worker.py; then
            echo "✓ worker.py contains new retry logic"
        else
            echo "✗ worker.py missing retry logic"
        fi

        if grep -q "600" /home/ec2-user/file-processor/config.py; then
            echo "✓ config.py has updated visibility timeout"
        else
            echo "✗ config.py missing visibility timeout update"
        fi
EOF

    log_success "Deployment verification complete"
}

# Monitor worker
monitor_worker() {
    log_info "Monitoring worker (press Ctrl+C to exit)..."
    log_info "Watching for: message processing, OpenSearch indexing, errors"

    ssh -i "$SSH_KEY" "$REMOTE_USER@$EC2_IP" \
        "sudo journalctl -u $SERVICE_NAME -f | grep -E '(Message|OpenSearch|deleted|failed|ERROR|CRITICAL)'"
}

# Main deployment flow
main() {
    log_info "========================================"
    log_info "Emergency SQS Queue Fixes Deployment"
    log_info "========================================"

    # Show configuration
    log_info "Configuration:"
    log_info "  EC2 IP: $EC2_IP"
    log_info "  SSH Key: $SSH_KEY"
    log_info "  Remote Dir: $REMOTE_DIR"
    log_info ""

    # Confirmation
    read -p "Continue with deployment? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_warning "Deployment cancelled"
        exit 0
    fi

    # Execute deployment steps
    check_prerequisites
    test_ssh
    backup_files
    stop_worker
    deploy_files
    update_service_config
    start_worker
    verify_deployment

    log_success "========================================"
    log_success "Deployment Complete!"
    log_success "========================================"
    log_info ""
    log_info "Next steps:"
    log_info "  1. Monitor worker logs: ./deploy_fixes.sh --monitor"
    log_info "  2. Run DLQ recovery: ssh -i $SSH_KEY $REMOTE_USER@$EC2_IP 'cd $REMOTE_DIR && python3 recover_dlq.py --batch-size 10 --max-batches 1'"
    log_info "  3. Check queue status via AWS Console"
    log_info ""
}

# Handle command line arguments
case "${1:-deploy}" in
    deploy)
        main
        ;;
    monitor)
        monitor_worker
        ;;
    stop)
        stop_worker
        ;;
    start)
        start_worker
        ;;
    verify)
        verify_deployment
        ;;
    *)
        echo "Usage: $0 {deploy|monitor|stop|start|verify}"
        echo ""
        echo "Commands:"
        echo "  deploy  - Deploy fixes and restart worker (default)"
        echo "  monitor - Monitor worker logs"
        echo "  stop    - Stop worker service"
        echo "  start   - Start worker service"
        echo "  verify  - Verify deployment"
        exit 1
        ;;
esac
