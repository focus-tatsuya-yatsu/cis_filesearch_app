# Lambda function to fix wrong category in OpenSearch
# This is a one-time utility Lambda that can be removed after the fix is applied

# ============================================================================
# IAM Role for Category Fix Lambda
# ============================================================================

resource "aws_iam_role" "lambda_category_fix" {
  name = "${var.project_name}-lambda-category-fix-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name    = "${var.project_name}-lambda-category-fix-role"
    Purpose = "One-time category fix"
  }
}

# Attach VPC execution policy for Lambda
resource "aws_iam_role_policy_attachment" "lambda_category_fix_vpc" {
  role       = aws_iam_role.lambda_category_fix.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# OpenSearch access policy
resource "aws_iam_role_policy" "lambda_category_fix_opensearch" {
  name = "${var.project_name}-lambda-category-fix-opensearch"
  role = aws_iam_role.lambda_category_fix.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "es:ESHttpGet",
          "es:ESHttpPost",
          "es:ESHttpPut",
          "es:ESHttpDelete",
          "es:ESHttpHead"
        ]
        Resource = [
          "arn:aws:es:${var.aws_region}:${data.aws_caller_identity.current.account_id}:domain/${var.opensearch_domain_name}/*"
        ]
      }
    ]
  })
}

# ============================================================================
# Lambda Function
# ============================================================================

# Note: You need to build and upload the Lambda package first:
# cd backend/lambda-category-fix && npm install && zip -r function.zip .

resource "aws_lambda_function" "category_fix" {
  function_name = "${var.project_name}-category-fix"
  role          = aws_iam_role.lambda_category_fix.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  timeout       = 300  # 5 minutes for bulk updates
  memory_size   = 512

  # Placeholder - update with actual zip file path or S3 location
  filename         = "${path.module}/../backend/lambda-category-fix/function.zip"
  source_code_hash = filebase64sha256("${path.module}/../backend/lambda-category-fix/function.zip")

  environment {
    variables = {
      OPENSEARCH_ENDPOINT = var.opensearch_endpoint
      OPENSEARCH_INDEX    = "cis-files-v2"
      AWS_NODEJS_CONNECTION_REUSE_ENABLED = "1"
    }
  }

  vpc_config {
    subnet_ids = aws_subnet.private[*].id
    security_group_ids = [
      aws_security_group.lambda_search_api.id  # Reuse existing security group
    ]
  }

  tags = {
    Name    = "${var.project_name}-category-fix"
    Purpose = "One-time category fix utility"
  }
}

# ============================================================================
# Outputs
# ============================================================================

output "category_fix_lambda_name" {
  description = "Name of the category fix Lambda function"
  value       = aws_lambda_function.category_fix.function_name
}

output "category_fix_lambda_arn" {
  description = "ARN of the category fix Lambda function"
  value       = aws_lambda_function.category_fix.arn
}
