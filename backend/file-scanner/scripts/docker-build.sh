#!/bin/bash
# Docker build script for CIS File Scanner

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}CIS File Scanner - Docker Build${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}Warning: .env file not found${NC}"
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo -e "${YELLOW}Please configure .env file before running the scanner${NC}"
fi

# Build the Docker image
echo -e "${GREEN}Building Docker image...${NC}"
docker build -t cis-file-scanner:latest .

# Check if build was successful
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Docker image built successfully${NC}"
    echo ""
    echo "Image name: cis-file-scanner:latest"
    echo ""
    echo "To run the scanner:"
    echo "  docker run --rm --env-file .env -v /path/to/nas:/mnt/nas:ro cis-file-scanner:latest scan"
    echo ""
    echo "To save the image for deployment:"
    echo "  docker save cis-file-scanner:latest -o cis-file-scanner.tar"
    echo ""
else
    echo -e "${RED}❌ Docker build failed${NC}"
    exit 1
fi