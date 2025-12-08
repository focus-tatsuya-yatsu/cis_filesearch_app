#!/bin/bash
# Run script for CIS File Scanner

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
ACTION="${1:-help}"
NAS_PATH="${NAS_MOUNT_PATH:-/mnt/nas}"
DRY_RUN="${DRY_RUN:-false}"

show_help() {
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}CIS File Scanner - Runner Script${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "Usage: $0 [action] [options]"
    echo ""
    echo "Actions:"
    echo "  scan        Run a full scan"
    echo "  diff        Run a differential scan"
    echo "  schedule    Start scheduled scanning"
    echo "  stats       Show statistics"
    echo "  dev         Run with local development settings"
    echo "  help        Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  NAS_MOUNT_PATH   Path to NAS mount (default: /mnt/nas)"
    echo "  DRY_RUN          Dry run mode (default: false)"
    echo ""
    echo "Examples:"
    echo "  $0 scan                    # Run full scan"
    echo "  DRY_RUN=true $0 scan      # Dry run mode"
    echo "  $0 schedule               # Start scheduled scanning"
    echo "  $0 stats                  # Show statistics"
}

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ] && [ "$ACTION" != "help" ]; then
    echo -e "${YELLOW}Warning: .env file not found${NC}"
    if [ -f .env.example ]; then
        echo "Creating .env from .env.example..."
        cp .env.example .env
        echo -e "${YELLOW}Please configure .env file before running${NC}"
        exit 1
    fi
fi

# Execute action
case "$ACTION" in
    scan)
        echo -e "${GREEN}Starting full scan...${NC}"
        if [ "$DRY_RUN" = "true" ]; then
            echo -e "${YELLOW}DRY RUN MODE ENABLED${NC}"
            docker run --rm \
                --env-file .env \
                -e DRY_RUN=true \
                -v ${NAS_PATH}:/mnt/nas:ro \
                -v $(pwd)/data:/app/data \
                -v $(pwd)/logs:/app/logs \
                cis-file-scanner:latest scan --dry-run
        else
            docker run --rm \
                --env-file .env \
                -v ${NAS_PATH}:/mnt/nas:ro \
                -v $(pwd)/data:/app/data \
                -v $(pwd)/logs:/app/logs \
                cis-file-scanner:latest scan
        fi
        ;;

    diff)
        echo -e "${GREEN}Starting differential scan...${NC}"
        docker run --rm \
            --env-file .env \
            -v ${NAS_PATH}:/mnt/nas:ro \
            -v $(pwd)/data:/app/data \
            -v $(pwd)/logs:/app/logs \
            cis-file-scanner:latest diff
        ;;

    schedule)
        echo -e "${GREEN}Starting scheduled scanner...${NC}"
        echo "Running scans every 6 hours. Press Ctrl+C to stop."
        docker run --rm \
            --env-file .env \
            -v ${NAS_PATH}:/mnt/nas:ro \
            -v $(pwd)/data:/app/data \
            -v $(pwd)/logs:/app/logs \
            cis-file-scanner:latest schedule "0 */6 * * *"
        ;;

    stats)
        echo -e "${GREEN}Fetching statistics...${NC}"
        docker run --rm \
            --env-file .env \
            -v $(pwd)/data:/app/data \
            cis-file-scanner:latest stats
        ;;

    dev)
        echo -e "${BLUE}Starting in development mode with LocalStack...${NC}"
        docker-compose --profile development up
        ;;

    help|--help|-h)
        show_help
        ;;

    *)
        echo -e "${RED}Unknown action: $ACTION${NC}"
        echo ""
        show_help
        exit 1
        ;;
esac