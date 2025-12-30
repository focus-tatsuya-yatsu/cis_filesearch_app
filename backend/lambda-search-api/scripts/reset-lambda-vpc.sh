#!/bin/bash

# ============================================================================
# Reset Lambda VPC Configuration
# ============================================================================
# This script removes and re-adds Lambda VPC configuration to force
# recreation of ENIs, which should pick up the new Route 53 DNS settings.
# ============================================================================

set -e

# Configuration
REGION="ap-northeast-1"
FUNCTION_NAME="cis-search-api-prod"
VPC_ID="vpc-02d08f2fa75078e67"
SUBNET_IDS="subnet-0ea0487400a0b3627 subnet-01edf92f9d1500875 subnet-0ce8ff9ce4bc429bf"
SECURITY_GROUP_ID="sg-0c482a057b356a0c3"

echo "============================================================================"
echo "Resetting Lambda VPC Configuration"
echo "============================================================================"
echo ""
echo "Function: ${FUNCTION_NAME}"
echo "This will temporarily remove VPC configuration and then re-add it."
echo ""

# Step 1: Remove VPC configuration
echo "Step 1: Removing VPC configuration"
echo "-----------------------------------"
aws lambda update-function-configuration \
    --function-name ${FUNCTION_NAME} \
    --region ${REGION} \
    --vpc-config 'SubnetIds=[],SecurityGroupIds=[]' \
    --query '{FunctionName:FunctionName,LastModified:LastModified,State:State}' \
    --output json

echo ""
echo "Waiting for Lambda to update (removing VPC)..."
aws lambda wait function-updated --function-name ${FUNCTION_NAME} --region ${REGION}
echo "✓ VPC configuration removed"
echo ""

# Wait additional time for ENIs to be deleted
echo "Waiting 30 seconds for ENIs to be deleted..."
sleep 30

# Step 2: Re-add VPC configuration
echo "Step 2: Re-adding VPC configuration"
echo "------------------------------------"
aws lambda update-function-configuration \
    --function-name ${FUNCTION_NAME} \
    --region ${REGION} \
    --vpc-config "SubnetIds=${SUBNET_IDS// /,},SecurityGroupIds=${SECURITY_GROUP_ID}" \
    --query '{FunctionName:FunctionName,LastModified:LastModified,State:State}' \
    --output json

echo ""
echo "Waiting for Lambda to update (adding VPC)..."
aws lambda wait function-updated --function-name ${FUNCTION_NAME} --region ${REGION}
echo "✓ VPC configuration re-added"
echo ""

# Wait for new ENIs to be created and ready
echo "Waiting 30 seconds for new ENIs to be created..."
sleep 30

# Step 3: Verify configuration
echo "Step 3: Verifying configuration"
echo "--------------------------------"
aws lambda get-function-configuration \
    --function-name ${FUNCTION_NAME} \
    --region ${REGION} \
    --query 'VpcConfig' \
    --output json | jq '.'

echo ""

# Step 4: Test Lambda function
echo "Step 4: Testing Lambda function"
echo "--------------------------------"
echo "Testing with a simple search query..."

aws lambda invoke \
    --function-name ${FUNCTION_NAME} \
    --region ${REGION} \
    --cli-binary-format raw-in-base64-out \
    --payload '{"queryStringParameters":{"q":"test","limit":"3"},"requestContext":{"requestId":"test-vpc-reset"}}' \
    /tmp/lambda-test-vpc-reset.json

echo ""
echo "Lambda Response:"
cat /tmp/lambda-test-vpc-reset.json | jq '.'

echo ""
echo "============================================================================"
echo "Lambda VPC Reset Complete"
echo "============================================================================"
echo ""
echo "Next Steps:"
echo "1. Check CloudWatch Logs:"
echo "   aws logs tail /aws/lambda/${FUNCTION_NAME} --follow"
echo ""
echo "2. Test API endpoint:"
echo "   curl \"https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search?q=test&limit=5\""
echo ""
echo "3. If DNS errors persist, check:"
echo "   - Route 53 private hosted zone is associated with VPC"
echo "   - A record points to correct OpenSearch IP"
echo "   - VPC DNS settings (enableDnsSupport=true, enableDnsHostnames=true)"
echo "============================================================================"
