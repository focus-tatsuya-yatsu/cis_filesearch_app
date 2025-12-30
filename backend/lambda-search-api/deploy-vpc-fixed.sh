#!/bin/bash

# ============================================================================
# Lambda Search API - VPC Fixed Deployment Script
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUNCTION_NAME="cis-search-api-prod"
REGION="ap-northeast-1"

echo "=================================================="
echo "Lambda Search API - VPC Fixed Deployment"
echo "=================================================="
echo ""

# Step 1: Check prerequisites
echo "[1/6] Checking prerequisites..."
if ! command -v aws &> /dev/null; then
    echo "❌ Error: AWS CLI is not installed"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm is not installed"
    exit 1
fi

echo "✅ Prerequisites OK"
echo ""

# Step 2: Update index.js with VPC-fixed version
echo "[2/6] Updating Lambda code with VPC-fixed version..."
cd "$SCRIPT_DIR"

if [ -f "index-vpc-fixed.js" ]; then
    cp index-vpc-fixed.js index.js
    echo "✅ Updated index.js with VPC-optimized code"
else
    echo "❌ Error: index-vpc-fixed.js not found"
    exit 1
fi
echo ""

# Step 3: Install dependencies
echo "[3/6] Installing dependencies..."
npm install
echo "✅ Dependencies installed"
echo ""

# Step 4: Create deployment package
echo "[4/6] Creating deployment package..."
ZIP_FILE="lambda-vpc-fixed.zip"

# Clean old zip
rm -f "$ZIP_FILE"

# Create zip with dependencies
zip -r "$ZIP_FILE" index.js node_modules package.json package-lock.json -x "*.git*" "*.DS_Store"

echo "✅ Deployment package created: $ZIP_FILE"
echo "   Size: $(du -h $ZIP_FILE | cut -f1)"
echo ""

# Step 5: Check Lambda function existence
echo "[5/6] Checking Lambda function..."
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" &> /dev/null; then
    echo "✅ Lambda function exists: $FUNCTION_NAME"

    # Update function code
    echo "   Updating function code..."
    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file "fileb://$ZIP_FILE" \
        --region "$REGION" \
        --no-cli-pager

    echo "✅ Function code updated"
else
    echo "❌ Error: Lambda function '$FUNCTION_NAME' not found"
    echo "   Please create the function first using Terraform"
    exit 1
fi
echo ""

# Step 6: Verify deployment
echo "[6/6] Verifying deployment..."

# Wait for update to complete
echo "   Waiting for update to complete..."
sleep 5

# Get function configuration
CONFIG=$(aws lambda get-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" \
    --no-cli-pager)

LAST_UPDATE_STATUS=$(echo "$CONFIG" | grep -o '"LastUpdateStatus": "[^"]*"' | cut -d'"' -f4)
CODE_SHA256=$(echo "$CONFIG" | grep -o '"CodeSha256": "[^"]*"' | cut -d'"' -f4)
OPENSEARCH_ENDPOINT=$(echo "$CONFIG" | grep -o '"OPENSEARCH_ENDPOINT": "[^"]*"' | cut -d'"' -f4)

echo "✅ Deployment verified"
echo ""
echo "   Status: $LAST_UPDATE_STATUS"
echo "   Code SHA256: ${CODE_SHA256:0:16}..."
echo "   OpenSearch Endpoint: $OPENSEARCH_ENDPOINT"
echo ""

# Step 7: Test invocation (optional)
echo "=================================================="
echo "Testing Lambda function (optional)"
echo "=================================================="
echo ""

read -p "Do you want to test the function now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Testing Lambda function..."

    # Create test payload
    TEST_PAYLOAD='{"httpMethod":"GET","queryStringParameters":{"q":"test","limit":"5"}}'

    # Invoke function
    aws lambda invoke \
        --function-name "$FUNCTION_NAME" \
        --payload "$TEST_PAYLOAD" \
        --region "$REGION" \
        --no-cli-pager \
        response.json

    echo ""
    echo "Response:"
    cat response.json | python3 -m json.tool 2>/dev/null || cat response.json
    echo ""
fi

echo "=================================================="
echo "Deployment Complete!"
echo "=================================================="
echo ""
echo "Next Steps:"
echo "1. Test the API via API Gateway"
echo "2. Check CloudWatch Logs for any errors"
echo "3. Monitor OpenSearch connection"
echo ""
echo "Useful commands:"
echo ""
echo "  # View Lambda logs"
echo "  aws logs tail /aws/lambda/$FUNCTION_NAME --follow"
echo ""
echo "  # View OpenSearch logs"
echo "  aws logs tail /aws/opensearch/cis-filesearch-prod/application-logs --follow"
echo ""
echo "  # Test via API Gateway"
echo "  curl -X GET \"https://YOUR_API_GATEWAY_URL/search?q=test\""
echo ""
