#!/bin/bash

# ============================================================================
# Lambda Search API - Deploy with Existing API Gateway
# ============================================================================
# This script deploys the Lambda Search API and integrates it with the
# existing API Gateway (cis-filesearch-api)
# ============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../../" && pwd)"
LAMBDA_DIR="${PROJECT_ROOT}/backend/lambda-search-api"
TERRAFORM_DIR="${PROJECT_ROOT}/terraform"

# ============================================================================
# Helper Functions
# ============================================================================

print_header() {
    echo -e "${BLUE}============================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}============================================================${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# ============================================================================
# Step 1: Prerequisites Check
# ============================================================================

check_prerequisites() {
    print_header "Step 1: Checking Prerequisites"

    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        exit 1
    fi
    print_success "Node.js $(node --version) found"

    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        exit 1
    fi
    print_success "npm $(npm --version) found"

    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed"
        exit 1
    fi
    print_success "AWS CLI $(aws --version 2>&1 | cut -d' ' -f1) found"

    # Check Terraform
    if ! command -v terraform &> /dev/null; then
        print_error "Terraform is not installed"
        exit 1
    fi
    print_success "Terraform $(terraform version -json | jq -r '.terraform_version') found"

    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials are not configured"
        exit 1
    fi
    AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    print_success "AWS Account: ${AWS_ACCOUNT}"

    echo ""
}

# ============================================================================
# Step 2: Build Lambda Function
# ============================================================================

build_lambda() {
    print_header "Step 2: Building Lambda Function"

    cd "${LAMBDA_DIR}"

    # Install dependencies
    print_info "Installing dependencies..."
    npm install --production
    print_success "Dependencies installed"

    # Build TypeScript
    print_info "Building TypeScript..."
    npm run build
    print_success "TypeScript build completed"

    # Create deployment package
    print_info "Creating deployment package..."
    npm run package

    if [ -f "dist/lambda-deployment.zip" ]; then
        FILE_SIZE=$(ls -lh dist/lambda-deployment.zip | awk '{print $5}')
        print_success "Deployment package created (${FILE_SIZE})"
    else
        print_error "Failed to create deployment package"
        exit 1
    fi

    echo ""
}

# ============================================================================
# Step 3: Apply Terraform Configuration
# ============================================================================

deploy_terraform() {
    print_header "Step 3: Deploying Infrastructure with Terraform"

    cd "${TERRAFORM_DIR}"

    # Initialize Terraform
    print_info "Initializing Terraform..."
    terraform init
    print_success "Terraform initialized"

    # Validate configuration
    print_info "Validating Terraform configuration..."
    if terraform validate; then
        print_success "Terraform configuration is valid"
    else
        print_error "Terraform configuration is invalid"
        exit 1
    fi

    # Plan deployment
    print_info "Planning deployment..."
    terraform plan -out=tfplan

    # Ask for confirmation
    echo ""
    print_warning "Review the plan above before proceeding"
    read -p "Do you want to apply this plan? (yes/no): " CONFIRM

    if [ "$CONFIRM" != "yes" ]; then
        print_error "Deployment cancelled"
        exit 1
    fi

    # Apply changes
    print_info "Applying Terraform changes..."
    terraform apply tfplan
    rm -f tfplan
    print_success "Infrastructure deployed"

    echo ""
}

# ============================================================================
# Step 4: Verify Deployment
# ============================================================================

verify_deployment() {
    print_header "Step 4: Verifying Deployment"

    # Get Lambda function name from Terraform output
    LAMBDA_FUNCTION_NAME=$(cd "${TERRAFORM_DIR}" && terraform output -raw lambda_search_api_name 2>/dev/null || echo "cis-search-api-prod")

    # Check Lambda function
    print_info "Checking Lambda function: ${LAMBDA_FUNCTION_NAME}"
    if aws lambda get-function --function-name "${LAMBDA_FUNCTION_NAME}" &> /dev/null; then
        print_success "Lambda function exists"

        # Get function details
        RUNTIME=$(aws lambda get-function-configuration --function-name "${LAMBDA_FUNCTION_NAME}" --query 'Runtime' --output text)
        MEMORY=$(aws lambda get-function-configuration --function-name "${LAMBDA_FUNCTION_NAME}" --query 'MemorySize' --output text)
        TIMEOUT=$(aws lambda get-function-configuration --function-name "${LAMBDA_FUNCTION_NAME}" --query 'Timeout' --output text)

        print_info "  Runtime: ${RUNTIME}"
        print_info "  Memory: ${MEMORY}MB"
        print_info "  Timeout: ${TIMEOUT}s"
    else
        print_error "Lambda function not found"
        exit 1
    fi

    # Check VPC configuration
    print_info "Checking VPC configuration..."
    VPC_CONFIG=$(aws lambda get-function-configuration --function-name "${LAMBDA_FUNCTION_NAME}" --query 'VpcConfig' --output json)
    if echo "${VPC_CONFIG}" | jq -e '.SubnetIds | length > 0' &> /dev/null; then
        print_success "Lambda is configured in VPC"
        SUBNET_COUNT=$(echo "${VPC_CONFIG}" | jq '.SubnetIds | length')
        SG_COUNT=$(echo "${VPC_CONFIG}" | jq '.SecurityGroupIds | length')
        print_info "  Subnets: ${SUBNET_COUNT}"
        print_info "  Security Groups: ${SG_COUNT}"
    else
        print_warning "Lambda is not in a VPC (might fail to connect to OpenSearch)"
    fi

    # Check API Gateway integration
    print_info "Checking API Gateway integration..."
    API_GATEWAY_ID=$(cd "${TERRAFORM_DIR}" && terraform output -raw api_gateway_rest_api_id 2>/dev/null || echo "")

    if [ -n "${API_GATEWAY_ID}" ]; then
        print_success "API Gateway found: ${API_GATEWAY_ID}"

        # Get API Gateway URL
        API_URL=$(cd "${TERRAFORM_DIR}" && terraform output -raw api_gateway_custom_domain_url 2>/dev/null || echo "")
        if [ -n "${API_URL}" ]; then
            print_success "API URL: ${API_URL}/search"
        fi
    else
        print_warning "API Gateway ID not found in Terraform outputs"
    fi

    # Check CloudWatch Logs
    print_info "Checking CloudWatch Logs..."
    LOG_GROUP="/aws/lambda/${LAMBDA_FUNCTION_NAME}"
    if aws logs describe-log-groups --log-group-name-prefix "${LOG_GROUP}" --query 'logGroups[0].logGroupName' --output text | grep -q "${LOG_GROUP}"; then
        print_success "CloudWatch Logs configured"
        RETENTION=$(aws logs describe-log-groups --log-group-name-prefix "${LOG_GROUP}" --query 'logGroups[0].retentionInDays' --output text)
        print_info "  Retention: ${RETENTION} days"
    else
        print_warning "CloudWatch Logs group not found"
    fi

    echo ""
}

# ============================================================================
# Step 5: Test API Endpoint
# ============================================================================

test_api() {
    print_header "Step 5: Testing API Endpoint"

    # Get API URL from Terraform
    API_URL=$(cd "${TERRAFORM_DIR}" && terraform output -raw api_gateway_custom_domain_url 2>/dev/null || terraform output -raw api_gateway_invoke_url 2>/dev/null)

    if [ -z "${API_URL}" ]; then
        print_warning "API URL not found in Terraform outputs, skipping API test"
        return
    fi

    SEARCH_ENDPOINT="${API_URL}/search"

    print_info "Testing endpoint: ${SEARCH_ENDPOINT}"
    print_warning "This test requires a valid Cognito token"

    read -p "Do you have a Cognito JWT token to test with? (yes/no): " HAS_TOKEN

    if [ "$HAS_TOKEN" != "yes" ]; then
        print_info "Skipping API test (no token provided)"
        print_info "You can test manually using:"
        echo ""
        echo "  curl -X GET '${SEARCH_ENDPOINT}?q=test&page=1&limit=20' \\"
        echo "    -H 'Authorization: Bearer YOUR_COGNITO_TOKEN' \\"
        echo "    -H 'Content-Type: application/json'"
        echo ""
        return
    fi

    read -p "Enter your Cognito JWT token: " COGNITO_TOKEN

    # Test basic search
    print_info "Testing basic search..."
    HTTP_CODE=$(curl -X GET "${SEARCH_ENDPOINT}?q=test&page=1&limit=20" \
        -H "Authorization: Bearer ${COGNITO_TOKEN}" \
        -H "Content-Type: application/json" \
        -s -o /dev/null -w "%{http_code}")

    if [ "${HTTP_CODE}" = "200" ]; then
        print_success "API test passed (HTTP ${HTTP_CODE})"
    elif [ "${HTTP_CODE}" = "401" ]; then
        print_warning "API returned 401 Unauthorized (check your token)"
    else
        print_error "API test failed (HTTP ${HTTP_CODE})"
    fi

    echo ""
}

# ============================================================================
# Step 6: Display Summary
# ============================================================================

display_summary() {
    print_header "Deployment Summary"

    echo -e "${GREEN}Deployment completed successfully!${NC}"
    echo ""

    # Get outputs from Terraform
    cd "${TERRAFORM_DIR}"

    echo "Lambda Function:"
    LAMBDA_ARN=$(terraform output -raw lambda_search_api_arn 2>/dev/null || echo "N/A")
    LAMBDA_NAME=$(terraform output -raw lambda_search_api_name 2>/dev/null || echo "N/A")
    echo "  Name: ${LAMBDA_NAME}"
    echo "  ARN: ${LAMBDA_ARN}"
    echo ""

    echo "API Gateway:"
    API_URL=$(terraform output -raw api_gateway_custom_domain_url 2>/dev/null || terraform output -raw api_gateway_invoke_url 2>/dev/null || echo "N/A")
    echo "  Search Endpoint: ${API_URL}/search"
    echo ""

    echo "Next Steps:"
    echo "  1. Test the API using the provided endpoint"
    echo "  2. Monitor CloudWatch Logs: /aws/lambda/${LAMBDA_NAME}"
    echo "  3. Check CloudWatch Alarms for any issues"
    echo "  4. Update frontend to use new endpoint: ${API_URL}/search"
    echo ""

    echo "Useful Commands:"
    echo "  # View Lambda logs"
    echo "  aws logs tail /aws/lambda/${LAMBDA_NAME} --follow"
    echo ""
    echo "  # Test API with curl"
    echo "  curl -X GET '${API_URL}/search?q=test&page=1&limit=20' \\"
    echo "    -H 'Authorization: Bearer YOUR_TOKEN' \\"
    echo "    -H 'Content-Type: application/json'"
    echo ""
}

# ============================================================================
# Main Execution
# ============================================================================

main() {
    print_header "Lambda Search API - Deploy with Existing API Gateway"
    echo "This script will:"
    echo "  1. Check prerequisites"
    echo "  2. Build Lambda function"
    echo "  3. Deploy infrastructure with Terraform"
    echo "  4. Verify deployment"
    echo "  5. Test API endpoint"
    echo ""

    read -p "Continue? (yes/no): " CONTINUE
    if [ "$CONTINUE" != "yes" ]; then
        print_error "Deployment cancelled"
        exit 1
    fi
    echo ""

    check_prerequisites
    build_lambda
    deploy_terraform
    verify_deployment
    test_api
    display_summary

    print_success "All done! 🎉"
}

# Run main function
main "$@"
