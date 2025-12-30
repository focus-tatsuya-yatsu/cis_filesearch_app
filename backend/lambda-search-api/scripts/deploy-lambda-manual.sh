#!/bin/bash

# ============================================================================
# Lambda Search API - Manual Deployment Script
# ============================================================================
# This script deploys the Lambda function and integrates with API Gateway
# without using Terraform
# ============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
AWS_REGION="ap-northeast-1"
LAMBDA_FUNCTION_NAME="cis-search-api-prod"
LAMBDA_ROLE_NAME="cis-lambda-search-api-role"
API_GATEWAY_ID="5xbn3ng31f"
VPC_ID="vpc-02d08f2fa75078e67"
SECURITY_GROUP_ID="sg-0c482a057b356a0c3"
SUBNET_IDS="subnet-0ea0487400a0b3627,subnet-01edf92f9d1500875,subnet-0ce8ff9ce4bc429bf"
OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
OPENSEARCH_INDEX="file-index"

# Helper functions
print_header() {
    echo -e "${BLUE}============================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}============================================================${NC}"
}

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_info() { echo -e "${BLUE}ℹ $1${NC}"; }

# Get AWS Account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# ============================================================================
# Step 1: Create IAM Role
# ============================================================================

create_iam_role() {
    print_header "Step 1: Creating IAM Role for Lambda"

    # Check if role exists
    if aws iam get-role --role-name "${LAMBDA_ROLE_NAME}" &>/dev/null; then
        print_warning "IAM Role already exists: ${LAMBDA_ROLE_NAME}"
        ROLE_ARN=$(aws iam get-role --role-name "${LAMBDA_ROLE_NAME}" --query 'Role.Arn' --output text)
        print_info "Role ARN: ${ROLE_ARN}"
    else
        print_info "Creating IAM Role: ${LAMBDA_ROLE_NAME}"

        # Create trust policy
        cat > /tmp/lambda-trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

        # Create role
        ROLE_ARN=$(aws iam create-role \
            --role-name "${LAMBDA_ROLE_NAME}" \
            --assume-role-policy-document file:///tmp/lambda-trust-policy.json \
            --query 'Role.Arn' \
            --output text)

        print_success "IAM Role created: ${ROLE_ARN}"
    fi

    # Attach AWS managed policies
    print_info "Attaching AWS managed policies..."

    aws iam attach-role-policy \
        --role-name "${LAMBDA_ROLE_NAME}" \
        --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole" \
        2>/dev/null || print_warning "VPC policy already attached"

    aws iam attach-role-policy \
        --role-name "${LAMBDA_ROLE_NAME}" \
        --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" \
        2>/dev/null || print_warning "Basic execution policy already attached"

    # Create OpenSearch access policy
    OPENSEARCH_POLICY_NAME="cis-lambda-opensearch-access"

    cat > /tmp/opensearch-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "es:ESHttpGet",
        "es:ESHttpPost",
        "es:ESHttpPut",
        "es:ESHttpHead"
      ],
      "Resource": "arn:aws:es:${AWS_REGION}:${AWS_ACCOUNT_ID}:domain/cis-filesearch-opensearch/*"
    }
  ]
}
EOF

    # Check if policy exists
    POLICY_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${OPENSEARCH_POLICY_NAME}"

    if aws iam get-policy --policy-arn "${POLICY_ARN}" &>/dev/null; then
        print_warning "OpenSearch policy already exists"
    else
        print_info "Creating OpenSearch access policy..."
        POLICY_ARN=$(aws iam create-policy \
            --policy-name "${OPENSEARCH_POLICY_NAME}" \
            --policy-document file:///tmp/opensearch-policy.json \
            --query 'Policy.Arn' \
            --output text)
        print_success "Policy created: ${POLICY_ARN}"
    fi

    # Attach OpenSearch policy
    aws iam attach-role-policy \
        --role-name "${LAMBDA_ROLE_NAME}" \
        --policy-arn "${POLICY_ARN}" \
        2>/dev/null || print_warning "OpenSearch policy already attached"

    print_success "IAM Role configuration completed"
    echo ""

    # Wait for role to propagate
    print_info "Waiting for IAM role to propagate (10 seconds)..."
    sleep 10
}

# ============================================================================
# Step 2: Deploy Lambda Function
# ============================================================================

deploy_lambda() {
    print_header "Step 2: Deploying Lambda Function"

    # Check if deployment package exists
    DEPLOYMENT_PACKAGE="/Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api/lambda-deployment.zip"

    if [ ! -f "${DEPLOYMENT_PACKAGE}" ]; then
        print_error "Deployment package not found: ${DEPLOYMENT_PACKAGE}"
        exit 1
    fi

    FILE_SIZE=$(ls -lh "${DEPLOYMENT_PACKAGE}" | awk '{print $5}')
    print_info "Deployment package: ${DEPLOYMENT_PACKAGE} (${FILE_SIZE})"

    # Check if Lambda function exists
    if aws lambda get-function --function-name "${LAMBDA_FUNCTION_NAME}" &>/dev/null; then
        print_warning "Lambda function already exists. Updating..."

        # Update function code
        aws lambda update-function-code \
            --function-name "${LAMBDA_FUNCTION_NAME}" \
            --zip-file "fileb://${DEPLOYMENT_PACKAGE}" \
            --output json > /dev/null

        print_success "Lambda function code updated"

        # Update configuration
        aws lambda update-function-configuration \
            --function-name "${LAMBDA_FUNCTION_NAME}" \
            --environment "Variables={OPENSEARCH_ENDPOINT=${OPENSEARCH_ENDPOINT},OPENSEARCH_INDEX=${OPENSEARCH_INDEX},NODE_ENV=production}" \
            --timeout 30 \
            --memory-size 512 \
            --output json > /dev/null

        print_success "Lambda function configuration updated"
    else
        print_info "Creating new Lambda function..."

        # Create Lambda function
        aws lambda create-function \
            --function-name "${LAMBDA_FUNCTION_NAME}" \
            --runtime nodejs20.x \
            --role "${ROLE_ARN}" \
            --handler index.handler \
            --zip-file "fileb://${DEPLOYMENT_PACKAGE}" \
            --timeout 30 \
            --memory-size 512 \
            --vpc-config "SubnetIds=${SUBNET_IDS},SecurityGroupIds=${SECURITY_GROUP_ID}" \
            --environment "Variables={OPENSEARCH_ENDPOINT=${OPENSEARCH_ENDPOINT},OPENSEARCH_INDEX=${OPENSEARCH_INDEX},NODE_ENV=production}" \
            --output json > /dev/null

        print_success "Lambda function created: ${LAMBDA_FUNCTION_NAME}"
    fi

    echo ""
}

# ============================================================================
# Step 3: Configure API Gateway Integration
# ============================================================================

integrate_api_gateway() {
    print_header "Step 3: Integrating with API Gateway"

    LAMBDA_ARN="arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:${LAMBDA_FUNCTION_NAME}"

    # Grant API Gateway permission to invoke Lambda
    print_info "Granting API Gateway invoke permission..."

    aws lambda add-permission \
        --function-name "${LAMBDA_FUNCTION_NAME}" \
        --statement-id "apigateway-invoke-permission" \
        --action "lambda:InvokeFunction" \
        --principal "apigateway.amazonaws.com" \
        --source-arn "arn:aws:execute-api:${AWS_REGION}:${AWS_ACCOUNT_ID}:${API_GATEWAY_ID}/*/*" \
        2>/dev/null || print_warning "Permission already exists"

    print_success "API Gateway permission granted"

    # Create integration
    print_info "Creating API Gateway integration..."

    INTEGRATION_ID=$(aws apigatewayv2 create-integration \
        --api-id "${API_GATEWAY_ID}" \
        --integration-type AWS_PROXY \
        --integration-uri "${LAMBDA_ARN}" \
        --integration-method POST \
        --payload-format-version "2.0" \
        --query 'IntegrationId' \
        --output text 2>/dev/null || echo "")

    if [ -z "${INTEGRATION_ID}" ]; then
        # Get existing integration
        print_warning "Integration may already exist. Checking..."
        INTEGRATION_ID=$(aws apigatewayv2 get-integrations \
            --api-id "${API_GATEWAY_ID}" \
            --query "Items[?contains(IntegrationUri, '${LAMBDA_FUNCTION_NAME}')].IntegrationId | [0]" \
            --output text)

        if [ "${INTEGRATION_ID}" != "None" ] && [ -n "${INTEGRATION_ID}" ]; then
            print_info "Found existing integration: ${INTEGRATION_ID}"
        else
            print_error "Failed to create or find integration"
            exit 1
        fi
    else
        print_success "Integration created: ${INTEGRATION_ID}"
    fi

    # Create or update route
    print_info "Setting up API Gateway route..."

    ROUTE_ID=$(aws apigatewayv2 get-routes \
        --api-id "${API_GATEWAY_ID}" \
        --query "Items[?RouteKey=='GET /search'].RouteId | [0]" \
        --output text)

    if [ "${ROUTE_ID}" = "None" ] || [ -z "${ROUTE_ID}" ]; then
        # Create new route
        ROUTE_ID=$(aws apigatewayv2 create-route \
            --api-id "${API_GATEWAY_ID}" \
            --route-key "GET /search" \
            --target "integrations/${INTEGRATION_ID}" \
            --query 'RouteId' \
            --output text)
        print_success "Route created: GET /search"
    else
        # Update existing route
        aws apigatewayv2 update-route \
            --api-id "${API_GATEWAY_ID}" \
            --route-id "${ROUTE_ID}" \
            --target "integrations/${INTEGRATION_ID}" \
            --output json > /dev/null
        print_success "Route updated: GET /search"
    fi

    # Deploy API
    print_info "Deploying API Gateway..."

    STAGE_NAME="$default"
    aws apigatewayv2 create-deployment \
        --api-id "${API_GATEWAY_ID}" \
        --stage-name "${STAGE_NAME}" \
        --output json > /dev/null

    print_success "API Gateway deployed"
    echo ""
}

# ============================================================================
# Step 4: Verify Deployment
# ============================================================================

verify_deployment() {
    print_header "Step 4: Verifying Deployment"

    # Get Lambda function details
    print_info "Lambda Function Details:"
    FUNCTION_INFO=$(aws lambda get-function-configuration --function-name "${LAMBDA_FUNCTION_NAME}" --output json)

    RUNTIME=$(echo "${FUNCTION_INFO}" | jq -r '.Runtime')
    MEMORY=$(echo "${FUNCTION_INFO}" | jq -r '.MemorySize')
    TIMEOUT=$(echo "${FUNCTION_INFO}" | jq -r '.Timeout')
    VPC_CONFIG=$(echo "${FUNCTION_INFO}" | jq -r '.VpcConfig.VpcId')

    echo "  Function Name: ${LAMBDA_FUNCTION_NAME}"
    echo "  Runtime: ${RUNTIME}"
    echo "  Memory: ${MEMORY}MB"
    echo "  Timeout: ${TIMEOUT}s"
    echo "  VPC: ${VPC_CONFIG}"

    # Check VPC configuration
    SUBNET_COUNT=$(echo "${FUNCTION_INFO}" | jq '.VpcConfig.SubnetIds | length')
    SG_COUNT=$(echo "${FUNCTION_INFO}" | jq '.VpcConfig.SecurityGroupIds | length')
    echo "  Subnets: ${SUBNET_COUNT}"
    echo "  Security Groups: ${SG_COUNT}"

    print_success "Lambda function verified"
    echo ""

    # Get API Gateway details
    print_info "API Gateway Details:"
    API_INFO=$(aws apigatewayv2 get-api --api-id "${API_GATEWAY_ID}" --output json)

    API_ENDPOINT=$(echo "${API_INFO}" | jq -r '.ApiEndpoint')
    echo "  API ID: ${API_GATEWAY_ID}"
    echo "  Endpoint: ${API_ENDPOINT}/search"

    print_success "API Gateway verified"
    echo ""
}

# ============================================================================
# Step 5: Test API
# ============================================================================

test_api() {
    print_header "Step 5: Testing API Endpoint"

    API_ENDPOINT="https://${API_GATEWAY_ID}.execute-api.${AWS_REGION}.amazonaws.com"
    SEARCH_URL="${API_ENDPOINT}/search?q=test&page=1&limit=10"

    print_info "Testing endpoint: ${SEARCH_URL}"

    # Simple GET request without authentication for testing
    HTTP_CODE=$(curl -s -o /tmp/api-response.json -w "%{http_code}" "${SEARCH_URL}")

    echo "  HTTP Status: ${HTTP_CODE}"

    if [ "${HTTP_CODE}" = "200" ]; then
        print_success "API test successful!"
        echo ""
        echo "Response preview:"
        jq '.' /tmp/api-response.json 2>/dev/null | head -20 || cat /tmp/api-response.json | head -20
    elif [ "${HTTP_CODE}" = "401" ]; then
        print_warning "API returned 401 (authentication required)"
        echo "This is expected if Cognito authentication is configured"
    elif [ "${HTTP_CODE}" = "403" ]; then
        print_warning "API returned 403 (forbidden)"
        echo "Check security group and VPC configuration"
    else
        print_error "API test failed with HTTP ${HTTP_CODE}"
        echo ""
        echo "Response:"
        cat /tmp/api-response.json
    fi

    echo ""
}

# ============================================================================
# Step 6: Display Summary
# ============================================================================

display_summary() {
    print_header "Deployment Summary"

    API_ENDPOINT="https://${API_GATEWAY_ID}.execute-api.${AWS_REGION}.amazonaws.com"

    echo -e "${GREEN}✓ Deployment completed successfully!${NC}"
    echo ""
    echo "Lambda Function:"
    echo "  Name: ${LAMBDA_FUNCTION_NAME}"
    echo "  ARN: arn:aws:lambda:${AWS_REGION}:${AWS_ACCOUNT_ID}:function:${LAMBDA_FUNCTION_NAME}"
    echo "  Region: ${AWS_REGION}"
    echo ""
    echo "API Gateway:"
    echo "  API ID: ${API_GATEWAY_ID}"
    echo "  Endpoint: ${API_ENDPOINT}/search"
    echo ""
    echo "Environment Variables:"
    echo "  OPENSEARCH_ENDPOINT: ${OPENSEARCH_ENDPOINT}"
    echo "  OPENSEARCH_INDEX: ${OPENSEARCH_INDEX}"
    echo "  AWS_REGION: ${AWS_REGION}"
    echo ""
    echo "Next Steps:"
    echo "  1. Update frontend to use: ${API_ENDPOINT}/search"
    echo "  2. Monitor CloudWatch Logs: /aws/lambda/${LAMBDA_FUNCTION_NAME}"
    echo "  3. Test with actual search queries"
    echo ""
    echo "Useful Commands:"
    echo ""
    echo "  # View Lambda logs"
    echo "  aws logs tail /aws/lambda/${LAMBDA_FUNCTION_NAME} --follow"
    echo ""
    echo "  # Test API endpoint"
    echo "  curl -X GET '${API_ENDPOINT}/search?q=document&page=1&limit=10'"
    echo ""
    echo "  # Invoke Lambda directly"
    echo "  aws lambda invoke --function-name ${LAMBDA_FUNCTION_NAME} \\"
    echo "    --payload '{\"queryStringParameters\":{\"q\":\"test\"}}' \\"
    echo "    /tmp/lambda-response.json"
    echo ""
}

# ============================================================================
# Main
# ============================================================================

main() {
    print_header "Lambda Search API - Manual Deployment"
    echo "Account: ${AWS_ACCOUNT_ID}"
    echo "Region: ${AWS_REGION}"
    echo ""

    create_iam_role
    deploy_lambda
    integrate_api_gateway
    verify_deployment
    test_api
    display_summary

    print_success "All done! 🎉"
}

main "$@"
