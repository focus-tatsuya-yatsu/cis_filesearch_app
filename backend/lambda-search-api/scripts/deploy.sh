#!/bin/bash

###############################################################################
# Lambda Search API Deployment Script
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
FUNCTION_NAME="cis-search-api"
REGION="ap-northeast-1"
RUNTIME="nodejs20.x"
HANDLER="index.handler"
MEMORY_SIZE=512
TIMEOUT=30

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Lambda Search API Deployment${NC}"
echo -e "${GREEN}========================================${NC}"

# Step 1: Install dependencies
echo -e "\n${YELLOW}Step 1: Installing dependencies...${NC}"
npm install
if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Dependencies installed${NC}"
else
  echo -e "${RED}✗ Failed to install dependencies${NC}"
  exit 1
fi

# Step 2: Run tests
echo -e "\n${YELLOW}Step 2: Running tests...${NC}"
npm test
if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Tests passed${NC}"
else
  echo -e "${RED}✗ Tests failed${NC}"
  exit 1
fi

# Step 3: Build TypeScript
echo -e "\n${YELLOW}Step 3: Building TypeScript...${NC}"
npm run build
if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Build completed${NC}"
else
  echo -e "${RED}✗ Build failed${NC}"
  exit 1
fi

# Step 4: Package Lambda deployment
echo -e "\n${YELLOW}Step 4: Packaging Lambda deployment...${NC}"
cd dist
zip -r ../lambda-deployment.zip .
cd ..
if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Package created${NC}"
else
  echo -e "${RED}✗ Packaging failed${NC}"
  exit 1
fi

# Step 5: Deploy to AWS Lambda
echo -e "\n${YELLOW}Step 5: Deploying to AWS Lambda...${NC}"

# Check if function exists
FUNCTION_EXISTS=$(aws lambda get-function --function-name $FUNCTION_NAME --region $REGION 2>&1 || true)

if echo "$FUNCTION_EXISTS" | grep -q "ResourceNotFoundException"; then
  echo -e "${YELLOW}Function does not exist. Creating...${NC}"

  # Get IAM Role ARN (assume it's already created via Terraform)
  ROLE_ARN=$(aws iam get-role --role-name lambda-opensearch-role --query 'Role.Arn' --output text)

  aws lambda create-function \
    --function-name $FUNCTION_NAME \
    --runtime $RUNTIME \
    --role $ROLE_ARN \
    --handler $HANDLER \
    --zip-file fileb://lambda-deployment.zip \
    --memory-size $MEMORY_SIZE \
    --timeout $TIMEOUT \
    --region $REGION \
    --architectures arm64

  echo -e "${GREEN}✓ Function created${NC}"
else
  echo -e "${YELLOW}Function exists. Updating...${NC}"

  aws lambda update-function-code \
    --function-name $FUNCTION_NAME \
    --zip-file fileb://lambda-deployment.zip \
    --region $REGION

  echo -e "${GREEN}✓ Function updated${NC}"
fi

# Step 6: Wait for function to be active
echo -e "\n${YELLOW}Step 6: Waiting for function to be active...${NC}"
aws lambda wait function-updated \
  --function-name $FUNCTION_NAME \
  --region $REGION

echo -e "${GREEN}✓ Function is active${NC}"

# Step 7: Test invoke (optional)
echo -e "\n${YELLOW}Step 7: Testing Lambda invocation...${NC}"
TEST_PAYLOAD='{"httpMethod":"GET","queryStringParameters":{"q":"test","page":"1","limit":"10"}}'

aws lambda invoke \
  --function-name $FUNCTION_NAME \
  --region $REGION \
  --payload "$TEST_PAYLOAD" \
  response.json

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓ Test invocation successful${NC}"
  echo -e "\n${YELLOW}Response:${NC}"
  cat response.json | jq .
  rm response.json
else
  echo -e "${RED}✗ Test invocation failed${NC}"
fi

# Cleanup
echo -e "\n${YELLOW}Cleaning up...${NC}"
rm lambda-deployment.zip

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "\nFunction Name: ${YELLOW}$FUNCTION_NAME${NC}"
echo -e "Region: ${YELLOW}$REGION${NC}"
echo -e "\nYou can test the function with:"
echo -e "${YELLOW}aws lambda invoke --function-name $FUNCTION_NAME --region $REGION response.json${NC}"
