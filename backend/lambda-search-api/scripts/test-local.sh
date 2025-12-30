#!/bin/bash

###############################################################################
# Local Lambda Testing Script
# ローカル環境でLambda関数をテストするスクリプト
###############################################################################

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Local Lambda Testing${NC}"
echo -e "${GREEN}========================================${NC}"

# Set environment variables
export OPENSEARCH_ENDPOINT="https://search-test.ap-northeast-1.es.amazonaws.com"
export OPENSEARCH_INDEX="file-index"
export AWS_REGION="ap-northeast-1"
export LOG_LEVEL="debug"
export NODE_ENV="development"

echo -e "\n${YELLOW}Environment Variables:${NC}"
echo -e "OPENSEARCH_ENDPOINT: $OPENSEARCH_ENDPOINT"
echo -e "OPENSEARCH_INDEX: $OPENSEARCH_INDEX"
echo -e "AWS_REGION: $AWS_REGION"

# Build
echo -e "\n${YELLOW}Building TypeScript...${NC}"
npm run build

# Create test event
echo -e "\n${YELLOW}Creating test event...${NC}"
cat > test-event.json <<EOF
{
  "httpMethod": "GET",
  "path": "/search",
  "queryStringParameters": {
    "q": "報告書",
    "searchMode": "or",
    "page": "1",
    "limit": "20",
    "sortBy": "relevance",
    "sortOrder": "desc"
  },
  "headers": {
    "Content-Type": "application/json"
  },
  "requestContext": {
    "requestId": "test-request-id",
    "identity": {
      "sourceIp": "127.0.0.1"
    }
  }
}
EOF

# Invoke Lambda locally using Node.js
echo -e "\n${YELLOW}Invoking Lambda locally...${NC}"
node -e "
const handler = require('./dist/index').handler;
const event = require('./test-event.json');
const context = {
  requestId: 'test-request-id',
  functionName: 'cis-search-api',
  memoryLimitInMB: 512,
  invokedFunctionArn: 'arn:aws:lambda:ap-northeast-1:123456789012:function:cis-search-api'
};

handler(event, context)
  .then(response => {
    console.log('Status Code:', response.statusCode);
    console.log('Response:', JSON.stringify(JSON.parse(response.body), null, 2));
  })
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
"

# Cleanup
rm test-event.json

echo -e "\n${GREEN}Local testing completed!${NC}"
