#!/bin/bash

# Deploy Image Embedding Lambda Function using Container Image
# This script builds the Docker image and deploys to AWS Lambda

set -e

# Configuration
AWS_REGION="${AWS_REGION:-ap-northeast-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-$(aws sts get-caller-identity --query Account --output text)}"
ECR_REPOSITORY="${ECR_REPOSITORY:-cis-image-embedding-lambda}"
FUNCTION_NAME="${FUNCTION_NAME:-cis-image-embedding}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

echo "======================================"
echo "Image Embedding Lambda Deployment"
echo "======================================"
echo "AWS Region: $AWS_REGION"
echo "AWS Account: $AWS_ACCOUNT_ID"
echo "ECR Repository: $ECR_REPOSITORY"
echo "Function Name: $FUNCTION_NAME"
echo "======================================"

# Step 1: Create ECR repository if it doesn't exist
echo ""
echo "[1/6] Creating ECR repository..."
aws ecr describe-repositories --repository-names "$ECR_REPOSITORY" --region "$AWS_REGION" > /dev/null 2>&1 || \
    aws ecr create-repository --repository-name "$ECR_REPOSITORY" --region "$AWS_REGION"

echo "ECR Repository: $ECR_REPOSITORY created/verified"

# Step 2: Login to ECR
echo ""
echo "[2/6] Logging in to ECR..."
aws ecr get-login-password --region "$AWS_REGION" | \
    docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

# Step 3: Build Docker image
echo ""
echo "[3/6] Building Docker image..."
docker build --platform linux/amd64 -t "$ECR_REPOSITORY:$IMAGE_TAG" .

# Step 4: Tag image for ECR
echo ""
echo "[4/6] Tagging image..."
docker tag "$ECR_REPOSITORY:$IMAGE_TAG" \
    "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY:$IMAGE_TAG"

# Step 5: Push to ECR
echo ""
echo "[5/6] Pushing image to ECR..."
docker push "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY:$IMAGE_TAG"

# Step 6: Update or create Lambda function
echo ""
echo "[6/6] Updating Lambda function..."

# Check if function exists
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$AWS_REGION" > /dev/null 2>&1; then
    echo "Function exists. Updating..."
    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --image-uri "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY:$IMAGE_TAG" \
        --region "$AWS_REGION"

    echo "Waiting for update to complete..."
    aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$AWS_REGION"

else
    echo "Function does not exist. Creating..."
    echo "Please create the function first using Terraform or AWS Console"
    echo ""
    echo "Required configuration:"
    echo "  - Image URI: $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPOSITORY:$IMAGE_TAG"
    echo "  - Memory: 3008 MB"
    echo "  - Timeout: 60 seconds"
    echo "  - IAM Role: lambda-image-embedding-role"
    echo "  - VPC: Same as OpenSearch domain"
    echo "  - Environment Variables:"
    echo "      EMBEDDING_CACHE_TABLE=cis-image-embedding-cache"
    echo "      MODEL_NAME=openai/clip-vit-base-patch32"
    echo "      VECTOR_DIMENSION=512"
    exit 1
fi

echo ""
echo "======================================"
echo "Deployment completed successfully!"
echo "======================================"
echo "Function ARN:"
aws lambda get-function --function-name "$FUNCTION_NAME" --region "$AWS_REGION" --query 'Configuration.FunctionArn' --output text
echo ""
echo "Test the function:"
echo "aws lambda invoke --function-name $FUNCTION_NAME --payload '{"imageUrl":"s3://bucket/test.jpg"}' response.json"
