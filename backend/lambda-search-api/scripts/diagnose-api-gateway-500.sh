#!/bin/bash

###############################################################################
# API Gateway 500 Error Diagnostic Script
# Purpose: Test Lambda function directly and API Gateway integration
# to identify the root cause of 500 errors
###############################################################################

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
LAMBDA_FUNCTION_NAME="cis-search-api-prod"
API_GATEWAY_URL="https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search"
REGION="ap-northeast-1"
TEST_QUERY="宇都宮"
TEST_QUERY_ENCODED="%E5%AE%87%E9%83%BD%E5%AE%AE"

echo "=========================================="
echo "API Gateway 500 Error Diagnostic Script"
echo "=========================================="
echo ""

###############################################################################
# Test 1: Lambda Function Direct Invocation (Text Search)
###############################################################################
echo -e "${BLUE}Test 1: Lambda Direct Invocation (Text Search)${NC}"
echo "Testing query: $TEST_QUERY"
echo ""

# Create test event
cat > /tmp/lambda-test-event.json <<EOF
{
  "httpMethod": "GET",
  "queryStringParameters": {
    "q": "$TEST_QUERY",
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

echo "Test event:"
cat /tmp/lambda-test-event.json | jq '.'
echo ""

echo "Invoking Lambda function directly..."
aws lambda invoke \
  --function-name $LAMBDA_FUNCTION_NAME \
  --region $REGION \
  --payload file:///tmp/lambda-test-event.json \
  --cli-binary-format raw-in-base64-out \
  /tmp/lambda-response.json

echo ""
echo "Lambda Response:"
cat /tmp/lambda-response.json | jq '.'
echo ""

# Check if response is successful
if cat /tmp/lambda-response.json | jq -e '.statusCode == 200' > /dev/null; then
    echo -e "${GREEN}✓ Lambda function returned 200 OK${NC}"
    LAMBDA_TEXT_SUCCESS=true
else
    echo -e "${RED}✗ Lambda function returned error${NC}"
    LAMBDA_TEXT_SUCCESS=false
fi
echo ""

###############################################################################
# Test 2: Lambda Function Direct Invocation (Image Search Path)
###############################################################################
echo -e "${BLUE}Test 2: Lambda Direct Invocation (Image Search Path)${NC}"
echo "Testing image search with mock vector..."
echo ""

# Create test event for image search
cat > /tmp/lambda-test-image.json <<EOF
{
  "httpMethod": "POST",
  "body": "{\"searchType\":\"image\",\"imageVector\":[0.1,0.2,0.3],\"page\":1,\"limit\":5}",
  "headers": {
    "Content-Type": "application/json"
  }
}
EOF

echo "Test event:"
cat /tmp/lambda-test-image.json | jq '.'
echo ""

echo "Invoking Lambda function for image search..."
aws lambda invoke \
  --function-name $LAMBDA_FUNCTION_NAME \
  --region $REGION \
  --payload file:///tmp/lambda-test-image.json \
  --cli-binary-format raw-in-base64-out \
  /tmp/lambda-image-response.json

echo ""
echo "Lambda Image Search Response:"
cat /tmp/lambda-image-response.json | jq '.'
echo ""

# Check if response is successful
if cat /tmp/lambda-image-response.json | jq -e '.statusCode == 200' > /dev/null; then
    echo -e "${GREEN}✓ Lambda image search returned 200 OK${NC}"
    LAMBDA_IMAGE_SUCCESS=true
else
    echo -e "${RED}✗ Lambda image search returned error${NC}"
    LAMBDA_IMAGE_SUCCESS=false
fi
echo ""

###############################################################################
# Test 3: API Gateway Integration Test (Text Search)
###############################################################################
echo -e "${BLUE}Test 3: API Gateway Integration (Text Search)${NC}"
echo "Testing URL: $API_GATEWAY_URL"
echo ""

API_TEST_URL="${API_GATEWAY_URL}?q=${TEST_QUERY_ENCODED}&searchMode=or&page=1&limit=20&sortBy=relevance&sortOrder=desc"
echo "Full test URL: $API_TEST_URL"
echo ""

echo "Making HTTP request to API Gateway..."
HTTP_STATUS=$(curl -s -o /tmp/api-gateway-response.json -w "%{http_code}" "$API_TEST_URL")

echo "HTTP Status: $HTTP_STATUS"
echo ""
echo "API Gateway Response:"
cat /tmp/api-gateway-response.json | jq '.' 2>/dev/null || cat /tmp/api-gateway-response.json
echo ""

if [ "$HTTP_STATUS" -eq 200 ]; then
    echo -e "${GREEN}✓ API Gateway returned 200 OK${NC}"
    API_GATEWAY_SUCCESS=true
else
    echo -e "${RED}✗ API Gateway returned $HTTP_STATUS${NC}"
    API_GATEWAY_SUCCESS=false
fi
echo ""

###############################################################################
# Test 4: Check Lambda Logs
###############################################################################
echo -e "${BLUE}Test 4: Checking Recent Lambda Logs${NC}"
echo ""

LOG_GROUP="/aws/lambda/$LAMBDA_FUNCTION_NAME"
echo "Log Group: $LOG_GROUP"
echo ""

echo "Fetching latest log streams..."
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
    echo "Recent log events:"
    aws logs get-log-events \
      --log-group-name "$LOG_GROUP" \
      --log-stream-name "$LATEST_STREAM" \
      --region $REGION \
      --limit 20 \
      --query 'events[*].message' \
      --output text
    echo ""
else
    echo -e "${YELLOW}! No log streams found${NC}"
    echo ""
fi

###############################################################################
# Test 5: Lambda Function Configuration Check
###############################################################################
echo -e "${BLUE}Test 5: Lambda Function Configuration${NC}"
echo ""

echo "Fetching Lambda configuration..."
aws lambda get-function-configuration \
  --function-name $LAMBDA_FUNCTION_NAME \
  --region $REGION \
  --query '{
    Runtime: Runtime,
    Handler: Handler,
    Timeout: Timeout,
    MemorySize: MemorySize,
    LastModified: LastModified,
    State: State,
    Environment: Environment.Variables
  }' | jq '.'
echo ""

###############################################################################
# Test 6: API Gateway Configuration Check
###############################################################################
echo -e "${BLUE}Test 6: API Gateway Configuration${NC}"
echo ""

# Extract API ID from URL
API_ID=$(echo $API_GATEWAY_URL | sed -E 's|https://([^.]+)\.execute-api\..*|\1|')
echo "API Gateway ID: $API_ID"
echo ""

echo "Fetching API Gateway configuration..."
aws apigatewayv2 get-api \
  --api-id $API_ID \
  --region $REGION \
  --query '{
    Name: Name,
    ProtocolType: ProtocolType,
    ApiEndpoint: ApiEndpoint,
    CreatedDate: CreatedDate
  }' 2>/dev/null | jq '.' || echo "Unable to fetch API Gateway v2 config, trying v1..."

# Try API Gateway v1 if v2 fails
aws apigateway get-rest-api \
  --rest-api-id $API_ID \
  --region $REGION \
  --query '{
    Name: name,
    CreatedDate: createdDate,
    EndpointConfiguration: endpointConfiguration
  }' 2>/dev/null | jq '.' || echo "Unable to fetch API Gateway configuration"

echo ""

###############################################################################
# Test 7: Lambda-API Gateway Integration Check
###############################################################################
echo -e "${BLUE}Test 7: Lambda-API Gateway Integration${NC}"
echo ""

echo "Checking Lambda resource-based policy..."
aws lambda get-policy \
  --function-name $LAMBDA_FUNCTION_NAME \
  --region $REGION \
  --query 'Policy' \
  --output text 2>/dev/null | jq '.' || echo "Unable to fetch Lambda policy"

echo ""

###############################################################################
# Test 8: OpenSearch Connectivity Test
###############################################################################
echo -e "${BLUE}Test 8: OpenSearch Connectivity${NC}"
echo ""

echo "Getting Lambda environment variables..."
OPENSEARCH_ENDPOINT=$(aws lambda get-function-configuration \
  --function-name $LAMBDA_FUNCTION_NAME \
  --region $REGION \
  --query 'Environment.Variables.OPENSEARCH_ENDPOINT' \
  --output text)

if [ -n "$OPENSEARCH_ENDPOINT" ] && [ "$OPENSEARCH_ENDPOINT" != "None" ]; then
    echo "OpenSearch Endpoint: $OPENSEARCH_ENDPOINT"
    echo ""

    # Create a simple Lambda test to check OpenSearch connectivity
    cat > /tmp/lambda-opensearch-test.json <<EOF
{
  "httpMethod": "GET",
  "queryStringParameters": {
    "q": "test",
    "page": "1",
    "limit": "1"
  }
}
EOF

    echo "Testing OpenSearch connectivity through Lambda..."
    aws lambda invoke \
      --function-name $LAMBDA_FUNCTION_NAME \
      --region $REGION \
      --payload file:///tmp/lambda-opensearch-test.json \
      --cli-binary-format raw-in-base64-out \
      /tmp/opensearch-test-response.json > /dev/null 2>&1

    if cat /tmp/opensearch-test-response.json | jq -e '.statusCode == 200' > /dev/null; then
        echo -e "${GREEN}✓ OpenSearch connectivity confirmed${NC}"
    else
        echo -e "${RED}✗ OpenSearch connectivity issue detected${NC}"
        echo "Response:"
        cat /tmp/opensearch-test-response.json | jq '.'
    fi
else
    echo -e "${YELLOW}! OPENSEARCH_ENDPOINT not configured${NC}"
fi
echo ""

###############################################################################
# Summary
###############################################################################
echo "=========================================="
echo -e "${BLUE}Diagnostic Summary${NC}"
echo "=========================================="
echo ""

echo "Test Results:"
echo "  1. Lambda Direct (Text):    $([ "$LAMBDA_TEXT_SUCCESS" = true ] && echo -e "${GREEN}PASS${NC}" || echo -e "${RED}FAIL${NC}")"
echo "  2. Lambda Direct (Image):   $([ "$LAMBDA_IMAGE_SUCCESS" = true ] && echo -e "${GREEN}PASS${NC}" || echo -e "${RED}FAIL${NC}")"
echo "  3. API Gateway Integration: $([ "$API_GATEWAY_SUCCESS" = true ] && echo -e "${GREEN}PASS${NC}" || echo -e "${RED}FAIL${NC}")"
echo ""

if [ "$LAMBDA_TEXT_SUCCESS" = true ] && [ "$API_GATEWAY_SUCCESS" = false ]; then
    echo -e "${YELLOW}Diagnosis: Issue is in API Gateway configuration or integration${NC}"
    echo ""
    echo "Recommended Actions:"
    echo "  1. Check API Gateway integration request/response mappings"
    echo "  2. Verify Lambda proxy integration is enabled"
    echo "  3. Check API Gateway deployment status"
    echo "  4. Review API Gateway CloudWatch logs"
    echo ""
elif [ "$LAMBDA_TEXT_SUCCESS" = false ]; then
    echo -e "${YELLOW}Diagnosis: Issue is in Lambda function itself${NC}"
    echo ""
    echo "Recommended Actions:"
    echo "  1. Review Lambda CloudWatch logs (shown above)"
    echo "  2. Check OpenSearch connectivity"
    echo "  3. Verify Lambda environment variables"
    echo "  4. Check Lambda IAM role permissions"
    echo ""
else
    echo -e "${GREEN}All tests passed! Issue may be transient or related to specific parameters.${NC}"
    echo ""
fi

echo "=========================================="
echo "Diagnostic Complete"
echo "=========================================="
echo ""

# Cleanup
rm -f /tmp/lambda-test-event.json \
      /tmp/lambda-test-image.json \
      /tmp/lambda-response.json \
      /tmp/lambda-image-response.json \
      /tmp/api-gateway-response.json \
      /tmp/lambda-opensearch-test.json \
      /tmp/opensearch-test-response.json
