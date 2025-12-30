#!/bin/bash

###############################################################################
# API Gateway Integration Check Script
# Purpose: Inspect API Gateway configuration and Lambda integration settings
###############################################################################

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

API_GATEWAY_URL="https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search"
LAMBDA_FUNCTION_NAME="cis-search-api-prod"
REGION="ap-northeast-1"

# Extract API ID from URL
API_ID=$(echo $API_GATEWAY_URL | sed -E 's|https://([^.]+)\.execute-api\..*|\1|')

echo "=========================================="
echo "API Gateway Integration Check"
echo "=========================================="
echo ""
echo "API Gateway ID: $API_ID"
echo "Lambda Function: $LAMBDA_FUNCTION_NAME"
echo "Region: $REGION"
echo ""

###############################################################################
# Check if API is HTTP API (v2) or REST API (v1)
###############################################################################
echo -e "${BLUE}Determining API type...${NC}"
echo ""

# Try HTTP API first
if aws apigatewayv2 get-api --api-id $API_ID --region $REGION 2>/dev/null; then
    API_TYPE="HTTP"
    echo -e "${GREEN}API Type: HTTP API (v2)${NC}"
    echo ""
else
    API_TYPE="REST"
    echo -e "${GREEN}API Type: REST API (v1)${NC}"
    echo ""
fi

###############################################################################
# Get API Configuration
###############################################################################
echo -e "${BLUE}API Configuration:${NC}"
echo ""

if [ "$API_TYPE" == "HTTP" ]; then
    aws apigatewayv2 get-api \
      --api-id $API_ID \
      --region $REGION \
      --query '{
        Name: Name,
        ProtocolType: ProtocolType,
        ApiEndpoint: ApiEndpoint,
        CreatedDate: CreatedDate,
        DisableExecuteApiEndpoint: DisableExecuteApiEndpoint
      }' | jq '.'
else
    aws apigateway get-rest-api \
      --rest-api-id $API_ID \
      --region $REGION \
      --query '{
        Name: name,
        CreatedDate: createdDate,
        EndpointConfiguration: endpointConfiguration
      }' | jq '.'
fi
echo ""

###############################################################################
# Get Routes/Resources
###############################################################################
echo -e "${BLUE}API Routes/Resources:${NC}"
echo ""

if [ "$API_TYPE" == "HTTP" ]; then
    echo "Routes:"
    aws apigatewayv2 get-routes \
      --api-id $API_ID \
      --region $REGION \
      --query 'Items[*].{RouteKey: RouteKey, Target: Target}' | jq '.'
    echo ""

    # Get specific route details
    ROUTE_ID=$(aws apigatewayv2 get-routes \
      --api-id $API_ID \
      --region $REGION \
      --query 'Items[0].RouteId' \
      --output text)

    if [ -n "$ROUTE_ID" ] && [ "$ROUTE_ID" != "None" ]; then
        echo "Default Route Details:"
        aws apigatewayv2 get-route \
          --api-id $API_ID \
          --route-id $ROUTE_ID \
          --region $REGION | jq '.'
        echo ""
    fi
else
    echo "Resources:"
    aws apigateway get-resources \
      --rest-api-id $API_ID \
      --region $REGION \
      --query 'items[*].{Path: path, Id: id}' | jq '.'
    echo ""
fi

###############################################################################
# Get Integration Details
###############################################################################
echo -e "${BLUE}Lambda Integration Details:${NC}"
echo ""

if [ "$API_TYPE" == "HTTP" ]; then
    # Get all integrations
    INTEGRATIONS=$(aws apigatewayv2 get-integrations \
      --api-id $API_ID \
      --region $REGION)

    echo "Integrations:"
    echo "$INTEGRATIONS" | jq '.Items[*].{
      IntegrationId: IntegrationId,
      IntegrationType: IntegrationType,
      IntegrationUri: IntegrationUri,
      PayloadFormatVersion: PayloadFormatVersion,
      TimeoutInMillis: TimeoutInMillis
    }'
    echo ""

    # Get first integration ID
    INTEGRATION_ID=$(echo "$INTEGRATIONS" | jq -r '.Items[0].IntegrationId')

    if [ -n "$INTEGRATION_ID" ] && [ "$INTEGRATION_ID" != "null" ]; then
        echo "Detailed Integration Configuration:"
        aws apigatewayv2 get-integration \
          --api-id $API_ID \
          --integration-id $INTEGRATION_ID \
          --region $REGION | jq '.'
        echo ""

        # Check integration response
        echo "Integration Response:"
        aws apigatewayv2 get-integration-responses \
          --api-id $API_ID \
          --integration-id $INTEGRATION_ID \
          --region $REGION 2>/dev/null | jq '.' || echo "No integration responses configured"
        echo ""
    fi
else
    # REST API - Get resource method
    RESOURCE_ID=$(aws apigateway get-resources \
      --rest-api-id $API_ID \
      --region $REGION \
      --query 'items[?path==`/search`].id' \
      --output text)

    if [ -n "$RESOURCE_ID" ] && [ "$RESOURCE_ID" != "None" ]; then
        echo "GET Method Integration:"
        aws apigateway get-integration \
          --rest-api-id $API_ID \
          --resource-id $RESOURCE_ID \
          --http-method GET \
          --region $REGION 2>/dev/null | jq '.' || echo "No GET integration found"
        echo ""

        echo "POST Method Integration:"
        aws apigateway get-integration \
          --rest-api-id $API_ID \
          --resource-id $RESOURCE_ID \
          --http-method POST \
          --region $REGION 2>/dev/null | jq '.' || echo "No POST integration found"
        echo ""
    fi
fi

###############################################################################
# Check Deployments
###############################################################################
echo -e "${BLUE}API Deployments:${NC}"
echo ""

if [ "$API_TYPE" == "HTTP" ]; then
    aws apigatewayv2 get-deployments \
      --api-id $API_ID \
      --region $REGION \
      --query 'Items[*].{
        DeploymentId: DeploymentId,
        CreatedDate: CreatedDate,
        DeploymentStatus: DeploymentStatus,
        Description: Description
      }' | jq '.'
    echo ""

    # Get stages
    echo "Stages:"
    aws apigatewayv2 get-stages \
      --api-id $API_ID \
      --region $REGION \
      --query 'Items[*].{
        StageName: StageName,
        DeploymentId: DeploymentId,
        CreatedDate: CreatedDate,
        LastUpdatedDate: LastUpdatedDate
      }' | jq '.'
    echo ""
else
    aws apigateway get-deployments \
      --rest-api-id $API_ID \
      --region $REGION \
      --query 'items[*].{
        Id: id,
        CreatedDate: createdDate,
        Description: description
      }' | jq '.'
    echo ""

    # Get stages
    echo "Stages:"
    aws apigateway get-stages \
      --rest-api-id $API_ID \
      --region $REGION \
      --query 'item[*].{
        StageName: stageName,
        DeploymentId: deploymentId,
        CreatedDate: createdDate,
        LastUpdatedDate: lastUpdatedDate
      }' | jq '.'
    echo ""
fi

###############################################################################
# Check Lambda Permission
###############################################################################
echo -e "${BLUE}Lambda Function Permissions:${NC}"
echo ""

echo "Lambda resource-based policy:"
POLICY=$(aws lambda get-policy \
  --function-name $LAMBDA_FUNCTION_NAME \
  --region $REGION \
  --query 'Policy' \
  --output text 2>/dev/null)

if [ $? -eq 0 ]; then
    echo "$POLICY" | jq '.'
    echo ""

    # Check if API Gateway has permission
    HAS_PERMISSION=$(echo "$POLICY" | jq -r '.Statement[] | select(.Principal.Service == "apigateway.amazonaws.com") | .Sid')

    if [ -n "$HAS_PERMISSION" ]; then
        echo -e "${GREEN}✓ API Gateway has permission to invoke Lambda${NC}"
    else
        echo -e "${RED}✗ API Gateway does NOT have permission to invoke Lambda${NC}"
        echo ""
        echo "To fix, run:"
        echo "aws lambda add-permission \\"
        echo "  --function-name $LAMBDA_FUNCTION_NAME \\"
        echo "  --statement-id apigateway-invoke \\"
        echo "  --action lambda:InvokeFunction \\"
        echo "  --principal apigateway.amazonaws.com \\"
        echo "  --source-arn \"arn:aws:execute-api:$REGION:*:$API_ID/*\" \\"
        echo "  --region $REGION"
    fi
else
    echo -e "${RED}✗ Unable to retrieve Lambda policy${NC}"
fi
echo ""

###############################################################################
# Check CloudWatch Logs for API Gateway
###############################################################################
echo -e "${BLUE}API Gateway Logs Configuration:${NC}"
echo ""

if [ "$API_TYPE" == "HTTP" ]; then
    STAGE_NAME="\$default"
    echo "Checking stage: $STAGE_NAME"

    STAGE_INFO=$(aws apigatewayv2 get-stage \
      --api-id $API_ID \
      --stage-name '$default' \
      --region $REGION 2>/dev/null)

    if [ $? -eq 0 ]; then
        echo "$STAGE_INFO" | jq '.AccessLogSettings // "No access logs configured"'
    fi
else
    # For REST API
    STAGES=$(aws apigateway get-stages \
      --rest-api-id $API_ID \
      --region $REGION \
      --query 'item[*].stageName' \
      --output text)

    for STAGE in $STAGES; do
        echo "Stage: $STAGE"
        aws apigateway get-stage \
          --rest-api-id $API_ID \
          --stage-name $STAGE \
          --region $REGION \
          --query '{
            AccessLogSettings: accessLogSettings,
            MethodSettings: methodSettings
          }' | jq '.'
    done
fi
echo ""

###############################################################################
# Test API Gateway directly
###############################################################################
echo -e "${BLUE}Testing API Gateway Endpoint:${NC}"
echo ""

TEST_URL="${API_GATEWAY_URL}?q=test&page=1&limit=5"
echo "Test URL: $TEST_URL"
echo ""

echo "Making request..."
RESPONSE=$(curl -s -w "\n%{http_code}" "$TEST_URL")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo "HTTP Status: $HTTP_CODE"
echo "Response Body:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" == "200" ]; then
    echo -e "${GREEN}✓ API Gateway responding successfully${NC}"
elif [ "$HTTP_CODE" == "500" ]; then
    echo -e "${RED}✗ API Gateway returning 500 error${NC}"
    echo ""
    echo "Possible causes:"
    echo "  1. Lambda function errors"
    echo "  2. Integration timeout"
    echo "  3. Response mapping issues"
    echo "  4. Missing Lambda permissions"
else
    echo -e "${YELLOW}! Unexpected status code: $HTTP_CODE${NC}"
fi
echo ""

###############################################################################
# Summary and Recommendations
###############################################################################
echo "=========================================="
echo "Summary and Recommendations"
echo "=========================================="
echo ""

echo "Configuration Status:"
echo "  API Type: $API_TYPE"
echo "  API Gateway Test: HTTP $HTTP_CODE"
echo ""

echo "Common 500 Error Causes in API Gateway:"
echo "  1. Lambda function returning malformed response"
echo "  2. Lambda execution timeout"
echo "  3. Missing or incorrect permissions"
echo "  4. Integration request/response mapping issues"
echo "  5. CORS configuration problems"
echo ""

echo "Recommended Actions:"
echo "  1. Run: ./test-specific-query.sh to test Lambda directly"
echo "  2. Check Lambda logs in CloudWatch"
echo "  3. Verify Lambda is returning properly formatted response"
echo "  4. Check API Gateway CloudWatch logs (if enabled)"
echo "  5. Verify Lambda timeout is sufficient (check function config)"
echo ""

echo "=========================================="
