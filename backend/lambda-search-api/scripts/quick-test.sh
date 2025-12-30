#!/bin/bash

###############################################################################
# Quick Test Script
# Purpose: Fast diagnostic test for the 500 error issue
###############################################################################

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

LAMBDA_FUNCTION_NAME="cis-search-api-prod"
API_GATEWAY_URL="https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search"
REGION="ap-northeast-1"

echo "=========================================="
echo "Quick 500 Error Diagnostic Test"
echo "=========================================="
echo ""

###############################################################################
# Test 1: Direct Lambda invocation
###############################################################################
echo -e "${BLUE}[1/3] Testing Lambda function directly...${NC}"

cat > /tmp/quick-test-lambda.json <<EOF
{
  "httpMethod": "GET",
  "queryStringParameters": {
    "q": "宇都宮",
    "searchMode": "or",
    "page": "1",
    "limit": "5"
  }
}
EOF

aws lambda invoke \
  --function-name $LAMBDA_FUNCTION_NAME \
  --region $REGION \
  --payload file:///tmp/quick-test-lambda.json \
  --cli-binary-format raw-in-base64-out \
  /tmp/quick-test-response.json > /dev/null 2>&1

LAMBDA_STATUS=$(cat /tmp/quick-test-response.json | jq -r '.statusCode' 2>/dev/null || echo "ERROR")

if [ "$LAMBDA_STATUS" == "200" ]; then
    echo -e "${GREEN}✓ Lambda: PASS (Status: $LAMBDA_STATUS)${NC}"
    LAMBDA_RESULTS=$(cat /tmp/quick-test-response.json | jq -r '.body' | jq -r '.data.results | length' 2>/dev/null || echo "0")
    echo "  Results returned: $LAMBDA_RESULTS"
else
    echo -e "${RED}✗ Lambda: FAIL (Status: $LAMBDA_STATUS)${NC}"
    ERROR_MSG=$(cat /tmp/quick-test-response.json | jq -r '.body' 2>/dev/null | jq -r '.error' 2>/dev/null || echo "Unknown error")
    echo "  Error: $ERROR_MSG"
fi
echo ""

###############################################################################
# Test 2: API Gateway endpoint
###############################################################################
echo -e "${BLUE}[2/3] Testing API Gateway endpoint...${NC}"

API_URL="${API_GATEWAY_URL}?q=%E5%AE%87%E9%83%BD%E5%AE%AE&searchMode=or&page=1&limit=5"
HTTP_STATUS=$(curl -s -o /tmp/api-test-response.json -w "%{http_code}" "$API_URL")

if [ "$HTTP_STATUS" == "200" ]; then
    echo -e "${GREEN}✓ API Gateway: PASS (Status: $HTTP_STATUS)${NC}"
    API_RESULTS=$(cat /tmp/api-test-response.json | jq -r '.data.results | length' 2>/dev/null || echo "0")
    echo "  Results returned: $API_RESULTS"
else
    echo -e "${RED}✗ API Gateway: FAIL (Status: $HTTP_STATUS)${NC}"
    echo "  Response:"
    cat /tmp/api-test-response.json 2>/dev/null | jq '.' || cat /tmp/api-test-response.json
fi
echo ""

###############################################################################
# Test 3: Check recent logs
###############################################################################
echo -e "${BLUE}[3/3] Checking recent Lambda logs...${NC}"

LOG_GROUP="/aws/lambda/$LAMBDA_FUNCTION_NAME"
LATEST_STREAM=$(aws logs describe-log-streams \
  --log-group-name "$LOG_GROUP" \
  --region $REGION \
  --order-by LastEventTime \
  --descending \
  --max-items 1 \
  --query 'logStreams[0].logStreamName' \
  --output text 2>/dev/null)

if [ -n "$LATEST_STREAM" ] && [ "$LATEST_STREAM" != "None" ]; then
    echo "Latest log entries:"
    aws logs get-log-events \
      --log-group-name "$LOG_GROUP" \
      --log-stream-name "$LATEST_STREAM" \
      --region $REGION \
      --limit 10 \
      --query 'events[*].message' \
      --output text 2>/dev/null | tail -5
else
    echo -e "${YELLOW}! Unable to fetch logs${NC}"
fi
echo ""

###############################################################################
# Diagnosis
###############################################################################
echo "=========================================="
echo "Diagnostic Result"
echo "=========================================="
echo ""

if [ "$LAMBDA_STATUS" == "200" ] && [ "$HTTP_STATUS" == "200" ]; then
    echo -e "${GREEN}✓ Both Lambda and API Gateway are working!${NC}"
    echo ""
    echo "The 500 error may be:"
    echo "  - Intermittent/transient issue"
    echo "  - Related to specific query parameters"
    echo "  - CORS or browser-specific issue"
    echo ""
    echo "Try the actual failing request from the browser."

elif [ "$LAMBDA_STATUS" == "200" ] && [ "$HTTP_STATUS" != "200" ]; then
    echo -e "${YELLOW}⚠ Lambda works but API Gateway fails${NC}"
    echo ""
    echo "The issue is in API Gateway configuration:"
    echo "  1. Integration settings"
    echo "  2. Lambda permissions"
    echo "  3. Response mapping"
    echo ""
    echo "Run: ./check-api-gateway-integration.sh for details"

elif [ "$LAMBDA_STATUS" != "200" ]; then
    echo -e "${RED}⚠ Lambda function is failing${NC}"
    echo ""
    echo "The issue is in the Lambda function:"
    echo "  1. Check environment variables"
    echo "  2. Verify OpenSearch connectivity"
    echo "  3. Review CloudWatch logs above"
    echo ""
    echo "Run: ./diagnose-api-gateway-500.sh for full details"

else
    echo -e "${YELLOW}⚠ Unable to determine issue${NC}"
    echo ""
    echo "Run full diagnostic:"
    echo "  ./diagnose-api-gateway-500.sh"
fi

echo ""
echo "=========================================="

# Cleanup
rm -f /tmp/quick-test-*.json /tmp/api-test-response.json
