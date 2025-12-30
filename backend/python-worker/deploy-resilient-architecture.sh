#!/bin/bash
################################################################################
# Resilient SQS Worker Architecture - Deployment Script
#
# This script deploys the enterprise-grade architecture improvements:
# 1. Circuit Breaker Pattern (systemd)
# 2. Pre-flight Health Checks
# 3. DLQ Auto-Reprocessing
# 4. Spot Interruption Handling
# 5. Auto Recovery System
#
# Usage:
#   ./deploy-resilient-architecture.sh [--dry-run] [--skip-restart]
#
# Author: Backend Architecture Expert
# Date: 2025-12-15
################################################################################

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
WORKER_DIR="/home/ec2-user/python-worker"
SYSTEMD_DIR="/etc/systemd/system"
DRY_RUN=false
SKIP_RESTART=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --skip-restart)
            SKIP_RESTART=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

################################################################################
# Helper Functions
################################################################################

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

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

backup_file() {
    local file=$1
    if [[ -f $file ]]; then
        local backup="${file}.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$file" "$backup"
        log_info "Backed up: $file → $backup"
    fi
}

################################################################################
# Deployment Steps
################################################################################

step_1_validate_environment() {
    log_info "=" && log_info "Step 1: Validating Environment" && log_info "="

    # Check if worker directory exists
    if [[ ! -d "$WORKER_DIR" ]]; then
        log_error "Worker directory not found: $WORKER_DIR"
        exit 1
    fi

    # Check if Python 3.11 is installed
    if ! command -v python3.11 &> /dev/null; then
        log_error "Python 3.11 not found. Please install it first."
        exit 1
    fi

    # Check if required Python packages are installed
    log_info "Checking Python dependencies..."
    python3.11 -c "import boto3, psutil, requests" 2>/dev/null || {
        log_warning "Missing Python packages. Installing..."
        if [[ $DRY_RUN == false ]]; then
            pip3.11 install boto3 psutil requests
        fi
    }

    # Check if environment file exists
    if [[ ! -f "$WORKER_DIR/.env" ]]; then
        log_error "Environment file not found: $WORKER_DIR/.env"
        log_error "Please create .env file with required variables"
        exit 1
    fi

    log_success "Environment validation passed"
}

step_2_deploy_health_check() {
    log_info "=" && log_info "Step 2: Deploying Health Check Module" && log_info "="

    if [[ $DRY_RUN == true ]]; then
        log_info "[DRY RUN] Would deploy health_check.py"
        return
    fi

    # Health check should already be copied by user
    if [[ ! -f "$WORKER_DIR/health_check.py" ]]; then
        log_error "health_check.py not found in $WORKER_DIR"
        exit 1
    fi

    # Make executable
    chmod +x "$WORKER_DIR/health_check.py"

    # Test health check
    log_info "Testing health check..."
    if python3.11 "$WORKER_DIR/health_check.py"; then
        log_success "Health check test passed"
    else
        log_error "Health check test failed"
        exit 1
    fi
}

step_3_deploy_resilient_service() {
    log_info "=" && log_info "Step 3: Deploying Resilient Systemd Service" && log_info "="

    local service_file="$SYSTEMD_DIR/file-processor.service"

    if [[ $DRY_RUN == true ]]; then
        log_info "[DRY RUN] Would deploy resilient service configuration"
        return
    fi

    # Backup existing service
    backup_file "$service_file"

    # Copy new service file
    if [[ -f "$WORKER_DIR/deployment/file-processor-resilient.service" ]]; then
        cp "$WORKER_DIR/deployment/file-processor-resilient.service" "$service_file"
        log_success "Deployed resilient service configuration"
    else
        log_error "file-processor-resilient.service not found"
        exit 1
    fi

    # Reload systemd
    systemctl daemon-reload
    log_success "Systemd configuration reloaded"
}

step_4_deploy_dlq_reprocessor() {
    log_info "=" && log_info "Step 4: Deploying DLQ Reprocessor" && log_info "="

    if [[ $DRY_RUN == true ]]; then
        log_info "[DRY RUN] Would deploy DLQ reprocessor"
        return
    fi

    if [[ ! -f "$WORKER_DIR/dlq_reprocessor.py" ]]; then
        log_error "dlq_reprocessor.py not found"
        exit 1
    fi

    # Make executable
    chmod +x "$WORKER_DIR/dlq_reprocessor.py"

    # Setup cron job for automatic reprocessing (every 15 minutes)
    local cron_entry="*/15 * * * * /usr/bin/python3.11 $WORKER_DIR/dlq_reprocessor.py --auto >> /var/log/dlq-reprocessor.log 2>&1"

    # Check if cron entry already exists
    if ! crontab -l 2>/dev/null | grep -q "dlq_reprocessor.py"; then
        (crontab -l 2>/dev/null; echo "$cron_entry") | crontab -
        log_success "DLQ reprocessor cron job installed (runs every 15 minutes)"
    else
        log_info "DLQ reprocessor cron job already exists"
    fi
}

step_5_deploy_spot_interruption_handler() {
    log_info "=" && log_info "Step 5: Deploying Spot Interruption Handler" && log_info "="

    if [[ $DRY_RUN == true ]]; then
        log_info "[DRY RUN] Would deploy spot interruption handler"
        return
    fi

    # Check if running on EC2 spot instance
    if ! curl -s -m 2 http://169.254.169.254/latest/meta-data/instance-life-cycle | grep -q "spot"; then
        log_warning "Not running on spot instance - skipping spot handler"
        return
    fi

    if [[ ! -f "$WORKER_DIR/spot_interruption_handler.py" ]]; then
        log_error "spot_interruption_handler.py not found"
        exit 1
    fi

    # Make executable
    chmod +x "$WORKER_DIR/spot_interruption_handler.py"

    # Install systemd service
    if [[ -f "$WORKER_DIR/deployment/spot-interruption-handler.service" ]]; then
        cp "$WORKER_DIR/deployment/spot-interruption-handler.service" "$SYSTEMD_DIR/"
        systemctl daemon-reload
        systemctl enable spot-interruption-handler.service
        systemctl start spot-interruption-handler.service
        log_success "Spot interruption handler deployed and started"
    else
        log_error "spot-interruption-handler.service not found"
        exit 1
    fi
}

step_6_deploy_auto_recovery() {
    log_info "=" && log_info "Step 6: Deploying Auto Recovery System" && log_info "="

    if [[ $DRY_RUN == true ]]; then
        log_info "[DRY RUN] Would deploy auto recovery system"
        return
    fi

    if [[ ! -f "$WORKER_DIR/auto_recovery.py" ]]; then
        log_error "auto_recovery.py not found"
        exit 1
    fi

    # Make executable
    chmod +x "$WORKER_DIR/auto_recovery.py"

    # Install systemd service
    if [[ -f "$WORKER_DIR/deployment/auto-recovery.service" ]]; then
        cp "$WORKER_DIR/deployment/auto-recovery.service" "$SYSTEMD_DIR/"
        systemctl daemon-reload
        systemctl enable auto-recovery.service
        systemctl start auto-recovery.service
        log_success "Auto recovery system deployed and started"
    else
        log_error "auto-recovery.service not found"
        exit 1
    fi
}

step_7_restart_worker() {
    log_info "=" && log_info "Step 7: Restarting Worker Service" && log_info "="

    if [[ $DRY_RUN == true ]]; then
        log_info "[DRY RUN] Would restart worker service"
        return
    fi

    if [[ $SKIP_RESTART == true ]]; then
        log_warning "Skipping worker restart (--skip-restart flag)"
        return
    fi

    # Restart worker service
    log_info "Stopping worker service..."
    systemctl stop file-processor.service || true

    log_info "Starting worker service with new configuration..."
    systemctl start file-processor.service

    # Wait for service to stabilize
    sleep 5

    # Check service status
    if systemctl is-active --quiet file-processor.service; then
        log_success "Worker service started successfully"
    else
        log_error "Worker service failed to start"
        log_error "Check logs: journalctl -u file-processor.service -n 50"
        exit 1
    fi
}

step_8_verify_deployment() {
    log_info "=" && log_info "Step 8: Verifying Deployment" && log_info "="

    if [[ $DRY_RUN == true ]]; then
        log_info "[DRY RUN] Would verify deployment"
        return
    fi

    # Check all services
    local services=(
        "file-processor.service"
        "auto-recovery.service"
    )

    # Add spot handler if on spot instance
    if curl -s -m 2 http://169.254.169.254/latest/meta-data/instance-life-cycle | grep -q "spot"; then
        services+=("spot-interruption-handler.service")
    fi

    log_info "Checking service statuses..."
    local all_ok=true

    for service in "${services[@]}"; do
        if systemctl is-active --quiet "$service"; then
            log_success "✅ $service is running"
        else
            log_error "❌ $service is NOT running"
            all_ok=false
        fi
    done

    if [[ $all_ok == true ]]; then
        log_success "All services are running correctly"
    else
        log_error "Some services failed to start"
        exit 1
    fi

    # Test health check
    log_info "Running final health check..."
    if python3.11 "$WORKER_DIR/health_check.py"; then
        log_success "✅ Health check passed"
    else
        log_error "❌ Health check failed"
        exit 1
    fi
}

step_9_display_monitoring_info() {
    log_info "=" && log_info "Step 9: Deployment Complete - Monitoring Information" && log_info "="

    cat << EOF

${GREEN}╔════════════════════════════════════════════════════════════════╗
║                   DEPLOYMENT SUCCESSFUL                        ║
╚════════════════════════════════════════════════════════════════╝${NC}

${BLUE}Deployed Components:${NC}
  ✅ Resilient systemd service (circuit breaker pattern)
  ✅ Pre-flight health checks
  ✅ DLQ auto-reprocessing (every 15 minutes)
  ✅ Auto recovery system (monitors every 60s)
$(if curl -s -m 2 http://169.254.169.254/latest/meta-data/instance-life-cycle | grep -q "spot"; then echo "  ✅ Spot interruption handler"; fi)

${BLUE}Monitoring Commands:${NC}
  # Watch worker logs
  sudo journalctl -u file-processor.service -f

  # Check worker status
  sudo systemctl status file-processor.service

  # Check auto-recovery logs
  sudo journalctl -u auto-recovery.service -f

  # Check DLQ reprocessor logs
  sudo tail -f /var/log/dlq-reprocessor.log

  # Manual health check
  sudo python3.11 $WORKER_DIR/health_check.py

  # Analyze DLQ failures
  sudo python3.11 $WORKER_DIR/dlq_reprocessor.py --analyze-only

${BLUE}Expected Improvements:${NC}
  • No more restart loops (circuit breaker prevents infinite restarts)
  • DLQ messages automatically reprocessed every 15 minutes
  • Worker auto-restarts if stuck (no progress for 10 minutes)
  • Graceful shutdown on spot interruption (2-minute warning)
  • Processing speed should reach 500+ msg/min (from current 122 msg/min)

${BLUE}Next Steps:${NC}
  1. Monitor worker for 1 hour to ensure stability
  2. Check SQS queue depth (should decrease steadily)
  3. Check DLQ (should stop growing)
  4. Review CloudWatch metrics in AWS console

${YELLOW}⚠️  Important Notes:${NC}
  • Health checks run BEFORE service starts (fail-fast pattern)
  • Service will NOT restart more than 5 times in 5 minutes
  • After 5 failures, service enters "failed" state (requires manual restart)
  • Auto-recovery system will restart worker if stuck for 10+ minutes

${GREEN}Support:${NC}
  If issues persist, check:
  • journalctl -u file-processor.service --since "10 minutes ago"
  • CloudWatch Logs: /aws/ec2/file-processor
  • SQS metrics in CloudWatch console

EOF
}

################################################################################
# Main Execution
################################################################################

main() {
    log_info "╔════════════════════════════════════════════════════════════════╗"
    log_info "║    Resilient SQS Worker Architecture - Deployment Script      ║"
    log_info "╚════════════════════════════════════════════════════════════════╝"

    if [[ $DRY_RUN == true ]]; then
        log_warning "DRY RUN MODE - No changes will be made"
    fi

    # Check root privileges
    check_root

    # Execute deployment steps
    step_1_validate_environment
    step_2_deploy_health_check
    step_3_deploy_resilient_service
    step_4_deploy_dlq_reprocessor
    step_5_deploy_spot_interruption_handler
    step_6_deploy_auto_recovery
    step_7_restart_worker
    step_8_verify_deployment
    step_9_display_monitoring_info

    log_success "Deployment completed successfully! 🎉"
}

# Run main function
main

exit 0
