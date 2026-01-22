#!/bin/bash
# Script to fix wrong category in OpenSearch via Lambda
# This script builds, deploys, and invokes the category fix Lambda

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LAMBDA_DIR="$PROJECT_ROOT/backend/lambda-category-fix"
FUNCTION_NAME="cis-filesearch-category-fix"
REGION="${AWS_REGION:-ap-northeast-1}"

echo "=========================================="
echo "Category Fix Lambda Deployment Script"
echo "=========================================="

# Step 1: Build Lambda package
build_lambda() {
    echo ""
    echo "[Step 1] Building Lambda package..."
    cd "$LAMBDA_DIR"

    # Install dependencies
    npm install

    # Create zip file
    rm -f function.zip
    zip -r function.zip . -x "*.git*"

    echo "Lambda package built: $LAMBDA_DIR/function.zip"
}

# Step 2: Create/Update Lambda function
deploy_lambda() {
    echo ""
    echo "[Step 2] Deploying Lambda function..."

    # Check if function exists
    if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" 2>/dev/null; then
        echo "Updating existing Lambda function..."
        aws lambda update-function-code \
            --function-name "$FUNCTION_NAME" \
            --zip-file "fileb://$LAMBDA_DIR/function.zip" \
            --region "$REGION"
    else
        echo "Lambda function doesn't exist. Please run 'terraform apply' first to create it."
        echo "Or create it manually with the AWS Console."
        exit 1
    fi

    echo "Lambda function deployed successfully."
}

# Step 3: Count documents with wrong category
count_wrong_category() {
    echo ""
    echo "[Step 3] Counting documents with wrong category..."

    aws lambda invoke \
        --function-name "$FUNCTION_NAME" \
        --region "$REGION" \
        --payload '{"action": "count"}' \
        --cli-binary-format raw-in-base64-out \
        /tmp/lambda-response.json

    echo "Response:"
    cat /tmp/lambda-response.json | jq '.'
}

# Step 4: Get detailed breakdown
get_details() {
    echo ""
    echo "[Step 4] Getting detailed breakdown..."

    aws lambda invoke \
        --function-name "$FUNCTION_NAME" \
        --region "$REGION" \
        --payload '{"action": "details"}' \
        --cli-binary-format raw-in-base64-out \
        /tmp/lambda-response.json

    echo "Response:"
    cat /tmp/lambda-response.json | jq '.'
}

# Step 5: Dry run (preview what would be fixed)
dry_run() {
    echo ""
    echo "[Step 5] Dry run (preview)..."

    aws lambda invoke \
        --function-name "$FUNCTION_NAME" \
        --region "$REGION" \
        --payload '{"action": "fix", "dryRun": true}' \
        --cli-binary-format raw-in-base64-out \
        /tmp/lambda-response.json

    echo "Response:"
    cat /tmp/lambda-response.json | jq '.'
}

# Step 6: Apply fix
apply_fix() {
    echo ""
    echo "[Step 6] Applying fix..."
    echo "WARNING: This will modify documents in OpenSearch!"
    read -p "Are you sure you want to continue? (yes/no): " confirm

    if [ "$confirm" != "yes" ]; then
        echo "Aborted."
        exit 0
    fi

    aws lambda invoke \
        --function-name "$FUNCTION_NAME" \
        --region "$REGION" \
        --payload '{"action": "fix", "dryRun": false}' \
        --cli-binary-format raw-in-base64-out \
        /tmp/lambda-response.json

    echo "Response:"
    cat /tmp/lambda-response.json | jq '.'
}

# Main menu
show_help() {
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  build     - Build Lambda package (npm install + zip)"
    echo "  deploy    - Deploy Lambda to AWS (requires terraform apply first)"
    echo "  count     - Count documents with wrong category"
    echo "  details   - Get detailed breakdown by server"
    echo "  dry-run   - Preview what would be fixed (no changes)"
    echo "  fix       - Apply the category fix"
    echo "  all       - Run build + deploy + count + details + dry-run"
    echo ""
    echo "Recommended workflow:"
    echo "  1. $0 build"
    echo "  2. terraform apply (in terraform/ directory)"
    echo "  3. $0 count"
    echo "  4. $0 details"
    echo "  5. $0 dry-run"
    echo "  6. $0 fix"
    echo ""
}

case "$1" in
    build)
        build_lambda
        ;;
    deploy)
        deploy_lambda
        ;;
    count)
        count_wrong_category
        ;;
    details)
        get_details
        ;;
    dry-run)
        dry_run
        ;;
    fix)
        apply_fix
        ;;
    all)
        build_lambda
        deploy_lambda
        count_wrong_category
        get_details
        dry_run
        ;;
    *)
        show_help
        ;;
esac

echo ""
echo "Done!"
