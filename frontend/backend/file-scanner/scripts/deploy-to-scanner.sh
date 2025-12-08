#!/bin/bash
# Deployment script for transferring Docker image to Scanner PC

set -e

# Configuration
SCANNER_HOST="${1:-scanner-pc.local}"
SCANNER_USER="${2:-scanner}"
IMAGE_NAME="cis-file-scanner:latest"
IMAGE_FILE="cis-file-scanner.tar"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}CIS File Scanner - Deploy to Scanner PC${NC}"
echo -e "${GREEN}========================================${NC}"

# Check arguments
if [ "$#" -lt 2 ]; then
    echo "Usage: $0 <scanner-host> <scanner-user>"
    echo "Example: $0 192.168.1.100 scanner"
    exit 1
fi

echo "Target: ${SCANNER_USER}@${SCANNER_HOST}"
echo ""

# Step 1: Build the Docker image
echo -e "${GREEN}Step 1: Building Docker image...${NC}"
./scripts/docker-build.sh

# Step 2: Save the Docker image
echo -e "${GREEN}Step 2: Saving Docker image to tar file...${NC}"
docker save ${IMAGE_NAME} -o ${IMAGE_FILE}
echo "Image saved to: ${IMAGE_FILE} ($(du -h ${IMAGE_FILE} | cut -f1))"

# Step 3: Transfer the image to scanner PC
echo -e "${GREEN}Step 3: Transferring image to scanner PC...${NC}"
echo "This may take a while depending on file size and network speed..."

scp ${IMAGE_FILE} ${SCANNER_USER}@${SCANNER_HOST}:/tmp/

# Step 4: Load the image on scanner PC
echo -e "${GREEN}Step 4: Loading image on scanner PC...${NC}"

ssh ${SCANNER_USER}@${SCANNER_HOST} << 'ENDSSH'
set -e

echo "Loading Docker image..."
docker load -i /tmp/cis-file-scanner.tar

echo "Cleaning up temporary file..."
rm /tmp/cis-file-scanner.tar

echo "Verifying image..."
docker images | grep cis-file-scanner

echo ""
echo "Docker image loaded successfully!"
ENDSSH

# Step 5: Transfer configuration files
echo -e "${GREEN}Step 5: Transferring configuration files...${NC}"

# Create deployment package
tar -czf deploy-config.tar.gz \
    .env.example \
    docker-compose.yml \
    scripts/run-scanner.sh \
    2>/dev/null || true

scp deploy-config.tar.gz ${SCANNER_USER}@${SCANNER_HOST}:/home/${SCANNER_USER}/

ssh ${SCANNER_USER}@${SCANNER_HOST} << ENDSSH
set -e

cd /home/${SCANNER_USER}
tar -xzf deploy-config.tar.gz
rm deploy-config.tar.gz

# Create .env if not exists
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Please configure .env file on the scanner PC"
fi

echo "Configuration files deployed"
ENDSSH

# Clean up local files
rm -f ${IMAGE_FILE} deploy-config.tar.gz

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps on scanner PC:"
echo "1. SSH to scanner PC: ssh ${SCANNER_USER}@${SCANNER_HOST}"
echo "2. Configure environment: vi .env"
echo "3. Run full scan: docker run --rm --env-file .env -v /mnt/nas:/mnt/nas:ro cis-file-scanner:latest scan"
echo "4. Or start scheduled scan: docker-compose up -d scheduled-scanner"
echo ""