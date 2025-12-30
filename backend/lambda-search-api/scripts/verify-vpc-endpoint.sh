#!/bin/bash

# ============================================================================
# Verify VPC Endpoint and Test Lambda Connectivity
# ============================================================================
# This script verifies the VPC endpoint is working correctly and tests
# Lambda function connectivity to OpenSearch.
# ============================================================================

set -e

# Configuration
REGION="ap-northeast-1"
VPC_ID="vpc-02d08f2fa75078e67"
SERVICE_NAME="com.amazonaws.${REGION}.es"
LAMBDA_FUNCTION="cis-search-api-prod"
API_ENDPOINT="https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search"

echo "============================================================================"
echo "VPC Endpoint Verification for OpenSearch Service"
echo "============================================================================"
echo ""

# Step 1: Check VPC Endpoint Status
echo "Step 1: Checking VPC Endpoint Status"
echo "-------------------------------------"
VPC_ENDPOINT_ID=$(aws ec2 describe-vpc-endpoints \
    --region ${REGION} \
    --filters "Name=vpc-id,Values=${VPC_ID}" \
              "Name=service-name,Values=${SERVICE_NAME}" \
    --query 'VpcEndpoints[0].VpcEndpointId' \
    --output text 2>&1)

if [ "$VPC_ENDPOINT_ID" == "None" ] || [ -z "$VPC_ENDPOINT_ID" ]; then
    echo "✗ ERROR: VPC Endpoint not found!"
    echo "  Please run create-vpc-endpoint.sh first"
    exit 1
fi

echo "✓ VPC Endpoint found: ${VPC_ENDPOINT_ID}"

# Get endpoint state
ENDPOINT_STATE=$(aws ec2 describe-vpc-endpoints \
    --region ${REGION} \
    --vpc-endpoint-ids ${VPC_ENDPOINT_ID} \
    --query 'VpcEndpoints[0].State' \
    --output text)

echo "  State: ${ENDPOINT_STATE}"

if [ "$ENDPOINT_STATE" != "available" ]; then
    echo "✗ WARNING: VPC Endpoint is not available yet (State: ${ENDPOINT_STATE})"
    echo "  Please wait for the endpoint to become available"
fi

echo ""

# Step 2: Check DNS Entries
echo "Step 2: Checking DNS Entries"
echo "----------------------------"
aws ec2 describe-vpc-endpoints \
    --region ${REGION} \
    --vpc-endpoint-ids ${VPC_ENDPOINT_ID} \
    --query 'VpcEndpoints[0].DnsEntries' \
    --output table

echo ""

# Step 3: Check Private DNS Enabled
echo "Step 3: Checking Private DNS Configuration"
echo "------------------------------------------"
PRIVATE_DNS=$(aws ec2 describe-vpc-endpoints \
    --region ${REGION} \
    --vpc-endpoint-ids ${VPC_ENDPOINT_ID} \
    --query 'VpcEndpoints[0].PrivateDnsEnabled' \
    --output text)

if [ "$PRIVATE_DNS" == "True" ]; then
    echo "✓ Private DNS is enabled"
else
    echo "✗ WARNING: Private DNS is not enabled"
    echo "  This may cause DNS resolution issues"
fi

echo ""

# Step 4: Check Security Group Configuration
echo "Step 4: Checking Security Group Configuration"
echo "---------------------------------------------"
aws ec2 describe-vpc-endpoints \
    --region ${REGION} \
    --vpc-endpoint-ids ${VPC_ENDPOINT_ID} \
    --query 'VpcEndpoints[0].Groups[*].{GroupId:GroupId,GroupName:GroupName}' \
    --output table

echo ""

# Step 5: Test Lambda Function
echo "Step 5: Testing Lambda Function"
echo "--------------------------------"
echo "Invoking Lambda function with test event..."

TEST_EVENT='{"queryStringParameters":{"q":"test","limit":"5"},"requestContext":{"requestId":"test-verify-vpc-endpoint"}}'

LAMBDA_RESULT=$(aws lambda invoke \
    --region ${REGION} \
    --function-name ${LAMBDA_FUNCTION} \
    --payload "${TEST_EVENT}" \
    --query 'StatusCode' \
    --output text \
    /tmp/lambda-response.json 2>&1)

echo "Lambda invocation status code: ${LAMBDA_RESULT}"

if [ -f /tmp/lambda-response.json ]; then
    echo ""
    echo "Lambda response:"
    cat /tmp/lambda-response.json | jq '.'
    echo ""

    # Check for errors in response
    ERROR_MESSAGE=$(cat /tmp/lambda-response.json | jq -r '.errorMessage // empty')
    if [ -n "$ERROR_MESSAGE" ]; then
        echo "✗ Lambda function returned an error:"
        echo "  ${ERROR_MESSAGE}"

        # Check if it's still a DNS error
        if echo "$ERROR_MESSAGE" | grep -q "ENOTFOUND"; then
            echo ""
            echo "✗ DNS resolution still failing!"
            echo "  The VPC endpoint may need more time to propagate DNS records"
            echo "  Please wait a few minutes and try again"
        fi
    else
        echo "✓ Lambda function executed successfully (no error message)"
    fi

    rm /tmp/lambda-response.json
fi

echo ""

# Step 6: Check Recent Lambda Logs
echo "Step 6: Checking Recent Lambda Logs"
echo "-----------------------------------"
echo "Last 20 log entries:"
aws logs tail /aws/lambda/${LAMBDA_FUNCTION} \
    --region ${REGION} \
    --since 5m \
    --format short | tail -20

echo ""

# Step 7: Test API Gateway Endpoint
echo "Step 7: Testing API Gateway Endpoint"
echo "------------------------------------"
echo "Testing: ${API_ENDPOINT}?q=test&limit=5"
echo ""

API_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}\n" "${API_ENDPOINT}?q=test&limit=5")
HTTP_STATUS=$(echo "$API_RESPONSE" | grep "HTTP_STATUS:" | cut -d':' -f2)
RESPONSE_BODY=$(echo "$API_RESPONSE" | sed '/HTTP_STATUS:/d')

echo "HTTP Status: ${HTTP_STATUS}"
echo ""
echo "Response Body:"
echo "$RESPONSE_BODY" | jq '.' 2>/dev/null || echo "$RESPONSE_BODY"

echo ""
echo "============================================================================"
echo "Verification Summary"
echo "============================================================================"
echo "VPC Endpoint ID:       ${VPC_ENDPOINT_ID}"
echo "Endpoint State:        ${ENDPOINT_STATE}"
echo "Private DNS Enabled:   ${PRIVATE_DNS}"
echo "Lambda HTTP Status:    ${LAMBDA_RESULT}"
echo "API Gateway Status:    ${HTTP_STATUS}"
echo ""

if [ "$ENDPOINT_STATE" == "available" ] && [ "$PRIVATE_DNS" == "True" ] && [ "$HTTP_STATUS" == "200" ]; then
    echo "✓ All checks passed! OpenSearch connection is working."
elif [ "$ENDPOINT_STATE" != "available" ]; then
    echo "⚠ VPC Endpoint is not available yet. Please wait and try again."
elif [ "$PRIVATE_DNS" != "True" ]; then
    echo "✗ Private DNS is not enabled. This needs to be fixed."
else
    echo "⚠ Some checks failed. Please review the output above."
fi

echo "============================================================================"
