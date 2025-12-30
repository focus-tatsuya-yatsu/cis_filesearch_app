#!/bin/bash

###############################################################################
# Specific Query Test Script
# Purpose: Test the exact failing query with detailed diagnostics
###############################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

LAMBDA_FUNCTION_NAME="cis-search-api-prod"
REGION="ap-northeast-1"

echo "=========================================="
echo "Testing Specific Query: 宇都宮"
echo "=========================================="
echo ""

###############################################################################
# Test the exact failing query
###############################################################################
echo -e "${BLUE}Creating test event with exact parameters from frontend${NC}"
echo ""

cat > /tmp/test-exact-query.json <<EOF
{
  "httpMethod": "GET",
  "queryStringParameters": {
    "q": "宇都宮",
    "searchMode": "or",
    "page": "1",
    "limit": "20",
    "sortBy": "relevance",
    "sortOrder": "desc"
  },
  "headers": {
    "Content-Type": "application/json",
    "Accept": "application/json"
  },
  "requestContext": {
    "http": {
      "method": "GET"
    }
  }
}
EOF

echo "Test payload:"
cat /tmp/test-exact-query.json | jq '.'
echo ""

echo -e "${BLUE}Invoking Lambda with exact query...${NC}"
echo ""

aws lambda invoke \
  --function-name $LAMBDA_FUNCTION_NAME \
  --region $REGION \
  --payload file:///tmp/test-exact-query.json \
  --cli-binary-format raw-in-base64-out \
  --log-type Tail \
  /tmp/test-exact-response.json \
  > /tmp/test-invoke-output.json

echo "Invocation Metadata:"
cat /tmp/test-invoke-output.json | jq '.'
echo ""

echo "Lambda Logs (Base64 decoded):"
cat /tmp/test-invoke-output.json | jq -r '.LogResult' | base64 -d
echo ""

echo "Lambda Response:"
cat /tmp/test-exact-response.json | jq '.'
echo ""

# Check status code
STATUS_CODE=$(cat /tmp/test-exact-response.json | jq -r '.statusCode')
echo "Status Code: $STATUS_CODE"
echo ""

if [ "$STATUS_CODE" == "200" ]; then
    echo -e "${GREEN}✓ Query executed successfully${NC}"
    echo ""

    # Show results summary
    TOTAL=$(cat /tmp/test-exact-response.json | jq -r '.body' | jq -r '.data.total')
    RESULTS_COUNT=$(cat /tmp/test-exact-response.json | jq -r '.body' | jq -r '.data.results | length')
    INDEX=$(cat /tmp/test-exact-response.json | jq -r '.body' | jq -r '.data.index')

    echo "Results Summary:"
    echo "  Index: $INDEX"
    echo "  Total matches: $TOTAL"
    echo "  Results returned: $RESULTS_COUNT"
    echo ""

    # Show first result
    echo "First Result:"
    cat /tmp/test-exact-response.json | jq -r '.body' | jq '.data.results[0]'
    echo ""
else
    echo -e "${RED}✗ Query failed with status $STATUS_CODE${NC}"
    echo ""

    # Show error details
    ERROR=$(cat /tmp/test-exact-response.json | jq -r '.body' | jq -r '.error')
    echo "Error: $ERROR"
    echo ""

    # Show full error body
    echo "Full Error Response:"
    cat /tmp/test-exact-response.json | jq -r '.body' | jq '.'
    echo ""
fi

###############################################################################
# Test with searchType parameter explicitly set
###############################################################################
echo -e "${BLUE}Testing with explicit searchType=text parameter${NC}"
echo ""

cat > /tmp/test-with-searchtype.json <<EOF
{
  "httpMethod": "GET",
  "queryStringParameters": {
    "q": "宇都宮",
    "searchType": "text",
    "searchMode": "or",
    "page": "1",
    "limit": "20",
    "sortBy": "relevance",
    "sortOrder": "desc"
  },
  "headers": {
    "Content-Type": "application/json"
  }
}
EOF

aws lambda invoke \
  --function-name $LAMBDA_FUNCTION_NAME \
  --region $REGION \
  --payload file:///tmp/test-with-searchtype.json \
  --cli-binary-format raw-in-base64-out \
  --log-type Tail \
  /tmp/test-searchtype-response.json \
  > /tmp/test-searchtype-invoke.json

echo "Response with searchType:"
cat /tmp/test-searchtype-response.json | jq '.'
echo ""

###############################################################################
# Test POST method
###############################################################################
echo -e "${BLUE}Testing POST method${NC}"
echo ""

cat > /tmp/test-post-method.json <<EOF
{
  "httpMethod": "POST",
  "body": "{\"q\":\"宇都宮\",\"searchMode\":\"or\",\"page\":1,\"limit\":20,\"sortBy\":\"relevance\",\"sortOrder\":\"desc\"}",
  "headers": {
    "Content-Type": "application/json"
  }
}
EOF

aws lambda invoke \
  --function-name $LAMBDA_FUNCTION_NAME \
  --region $REGION \
  --payload file:///tmp/test-post-method.json \
  --cli-binary-format raw-in-base64-out \
  /tmp/test-post-response.json

echo "POST Response:"
cat /tmp/test-post-response.json | jq '.'
echo ""

###############################################################################
# Check recent CloudWatch logs for this specific query
###############################################################################
echo -e "${BLUE}Checking CloudWatch logs for recent executions${NC}"
echo ""

LOG_GROUP="/aws/lambda/$LAMBDA_FUNCTION_NAME"

# Get the most recent log stream
LATEST_STREAM=$(aws logs describe-log-streams \
  --log-group-name "$LOG_GROUP" \
  --region $REGION \
  --order-by LastEventTime \
  --descending \
  --max-items 1 \
  --query 'logStreams[0].logStreamName' \
  --output text)

if [ -n "$LATEST_STREAM" ] && [ "$LATEST_STREAM" != "None" ]; then
    echo "Latest log stream: $LATEST_STREAM"
    echo ""

    echo "Recent log events (last 30):"
    aws logs get-log-events \
      --log-group-name "$LOG_GROUP" \
      --log-stream-name "$LATEST_STREAM" \
      --region $REGION \
      --limit 30 \
      --start-from-head \
      --query 'events[*].message' \
      --output text
    echo ""
fi

###############################################################################
# Test different query variations
###############################################################################
echo -e "${BLUE}Testing query variations${NC}"
echo ""

# Test 1: Simple ASCII query
echo "Test: Simple ASCII query"
cat > /tmp/test-ascii.json <<EOF
{
  "httpMethod": "GET",
  "queryStringParameters": {
    "q": "test",
    "page": "1",
    "limit": "5"
  }
}
EOF

aws lambda invoke \
  --function-name $LAMBDA_FUNCTION_NAME \
  --region $REGION \
  --payload file:///tmp/test-ascii.json \
  --cli-binary-format raw-in-base64-out \
  /tmp/test-ascii-response.json

ASCII_STATUS=$(cat /tmp/test-ascii-response.json | jq -r '.statusCode')
echo "ASCII query status: $ASCII_STATUS"
echo ""

# Test 2: Empty query (match_all)
echo "Test: Empty query (match_all)"
cat > /tmp/test-empty.json <<EOF
{
  "httpMethod": "GET",
  "queryStringParameters": {
    "q": "",
    "page": "1",
    "limit": "5"
  }
}
EOF

aws lambda invoke \
  --function-name $LAMBDA_FUNCTION_NAME \
  --region $REGION \
  --payload file:///tmp/test-empty.json \
  --cli-binary-format raw-in-base64-out \
  /tmp/test-empty-response.json

EMPTY_STATUS=$(cat /tmp/test-empty-response.json | jq -r '.statusCode')
echo "Empty query status: $EMPTY_STATUS"
echo ""

# Test 3: Different Japanese query
echo "Test: Different Japanese query (東京)"
cat > /tmp/test-tokyo.json <<EOF
{
  "httpMethod": "GET",
  "queryStringParameters": {
    "q": "東京",
    "page": "1",
    "limit": "5"
  }
}
EOF

aws lambda invoke \
  --function-name $LAMBDA_FUNCTION_NAME \
  --region $REGION \
  --payload file:///tmp/test-tokyo.json \
  --cli-binary-format raw-in-base64-out \
  /tmp/test-tokyo-response.json

TOKYO_STATUS=$(cat /tmp/test-tokyo-response.json | jq -r '.statusCode')
echo "Tokyo query status: $TOKYO_STATUS"
echo ""

###############################################################################
# Summary
###############################################################################
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo ""

echo "Query Test Results:"
echo "  Original query (宇都宮):     $STATUS_CODE"
echo "  With searchType parameter:   $(cat /tmp/test-searchtype-response.json | jq -r '.statusCode')"
echo "  POST method:                 $(cat /tmp/test-post-response.json | jq -r '.statusCode')"
echo "  ASCII query (test):          $ASCII_STATUS"
echo "  Empty query:                 $EMPTY_STATUS"
echo "  Japanese query (東京):       $TOKYO_STATUS"
echo ""

if [ "$STATUS_CODE" == "200" ]; then
    echo -e "${GREEN}✓ Primary query executed successfully${NC}"
    echo ""
    echo "If API Gateway is returning 500, the issue is in:"
    echo "  1. API Gateway integration configuration"
    echo "  2. API Gateway request/response mapping"
    echo "  3. Parameter passing from API Gateway to Lambda"
else
    echo -e "${RED}✗ Query failed in Lambda${NC}"
    echo ""
    echo "Issue is in Lambda function itself:"
    echo "  1. Check logs above for error details"
    echo "  2. Verify OpenSearch connectivity"
    echo "  3. Check environment variables"
fi

echo ""
echo "=========================================="

# Cleanup
rm -f /tmp/test-*.json
