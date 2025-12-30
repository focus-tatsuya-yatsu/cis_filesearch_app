# Lambda Search API - Terraform Configuration

# Variables
variable "aws_region" {
  description = "AWS Region"
  type        = string
  default     = "ap-northeast-1"
}

variable "environment" {
  description = "Environment name (dev/staging/prod)"
  type        = string
  default     = "dev"
}

variable "opensearch_domain_endpoint" {
  description = "OpenSearch domain endpoint"
  type        = string
}

variable "opensearch_index_name" {
  description = "OpenSearch index name"
  type        = string
  default     = "file-index"
}

variable "cognito_user_pool_id" {
  description = "Cognito User Pool ID (optional, set to empty string to disable auth)"
  type        = string
  default     = ""
}

variable "cognito_user_pool_arn" {
  description = "Cognito User Pool ARN (optional, set to empty string to disable auth)"
  type        = string
  default     = ""
}

variable "enable_authentication" {
  description = "Enable Cognito authentication for API"
  type        = bool
  default     = false
}

variable "vpc_id" {
  description = "VPC ID for Lambda"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for Lambda"
  type        = list(string)
}

variable "opensearch_security_group_id" {
  description = "Security group ID for OpenSearch access"
  type        = string
}

# Lambda IAM Role
resource "aws_iam_role" "lambda_search_api" {
  name = "cis-lambda-search-api-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name        = "CIS Lambda Search API Role"
    Environment = var.environment
  }
}

# Lambda IAM Policy - OpenSearch Access
resource "aws_iam_role_policy" "lambda_opensearch_access" {
  name = "opensearch-access"
  role = aws_iam_role.lambda_search_api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "OpenSearchAccess"
        Effect = "Allow"
        Action = [
          "es:ESHttpGet",
          "es:ESHttpPost",
          "es:ESHttpHead"
        ]
        Resource = "arn:aws:es:${var.aws_region}:${data.aws_caller_identity.current.account_id}:domain/*"
      }
    ]
  })
}

# Lambda IAM Policy - CloudWatch Logs and VPC Access
resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda_search_api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# Lambda IAM Policy - Additional permissions for VPC and EC2
resource "aws_iam_role_policy" "lambda_vpc_access" {
  name = "vpc-access"
  role = aws_iam_role.lambda_search_api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "VPCNetworkInterfaceAccess"
        Effect = "Allow"
        Action = [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface",
          "ec2:AssignPrivateIpAddresses",
          "ec2:UnassignPrivateIpAddresses"
        ]
        Resource = "*"
      }
    ]
  })
}

# Lambda Security Group
resource "aws_security_group" "lambda_search_api" {
  name        = "cis-lambda-search-api-sg-${var.environment}"
  description = "Security group for Lambda Search API"
  vpc_id      = var.vpc_id

  # Egress to OpenSearch (port 443 only for HTTPS)
  egress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [var.opensearch_security_group_id]
    description     = "HTTPS to OpenSearch VPC endpoint"
  }

  # Egress to internet via NAT Gateway (for AWS API calls)
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS to AWS services via NAT Gateway"
  }

  tags = {
    Name        = "CIS Lambda Search API SG"
    Environment = var.environment
  }
}

# Update OpenSearch Security Group to allow inbound from Lambda
resource "aws_security_group_rule" "opensearch_allow_lambda" {
  type                     = "ingress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.lambda_search_api.id
  security_group_id        = var.opensearch_security_group_id
  description              = "Allow HTTPS from Lambda Search API"
}

# Lambda Function
resource "aws_lambda_function" "search_api" {
  function_name = "cis-search-api-${var.environment}"
  role          = aws_iam_role.lambda_search_api.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]

  filename         = "../dist/lambda-deployment.zip"
  source_code_hash = filebase64sha256("../dist/lambda-deployment.zip")

  memory_size = 512
  timeout     = 30

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [
      aws_security_group.lambda_search_api.id,
      var.opensearch_security_group_id
    ]
  }

  environment {
    variables = {
      OPENSEARCH_ENDPOINT = var.opensearch_domain_endpoint
      OPENSEARCH_INDEX    = var.opensearch_index_name
      AWS_REGION          = var.aws_region
      LOG_LEVEL           = "info"
      NODE_ENV            = var.environment
    }
  }

  reserved_concurrent_executions = 10

  tags = {
    Name        = "CIS Search API"
    Environment = var.environment
  }
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "search_api" {
  name              = "/aws/lambda/${aws_lambda_function.search_api.function_name}"
  retention_in_days = 14

  tags = {
    Name        = "CIS Search API Logs"
    Environment = var.environment
  }
}

# API Gateway REST API
resource "aws_api_gateway_rest_api" "search_api" {
  name        = "cis-search-api-${var.environment}"
  description = "CIS File Search API"

  endpoint_configuration {
    types = ["REGIONAL"]
  }

  tags = {
    Name        = "CIS Search API"
    Environment = var.environment
  }
}

# Cognito Authorizer (conditional)
resource "aws_api_gateway_authorizer" "cognito" {
  count = var.enable_authentication ? 1 : 0

  name          = "CognitoAuthorizer"
  rest_api_id   = aws_api_gateway_rest_api.search_api.id
  type          = "COGNITO_USER_POOLS"
  provider_arns = [var.cognito_user_pool_arn]

  identity_source = "method.request.header.Authorization"
}

# API Gateway Resource - /search
resource "aws_api_gateway_resource" "search" {
  rest_api_id = aws_api_gateway_rest_api.search_api.id
  parent_id   = aws_api_gateway_rest_api.search_api.root_resource_id
  path_part   = "search"
}

# API Gateway Method - GET /search
resource "aws_api_gateway_method" "search_get" {
  rest_api_id   = aws_api_gateway_rest_api.search_api.id
  resource_id   = aws_api_gateway_resource.search.id
  http_method   = "GET"
  authorization = var.enable_authentication ? "COGNITO_USER_POOLS" : "NONE"
  authorizer_id = var.enable_authentication ? aws_api_gateway_authorizer.cognito[0].id : null

  request_parameters = {
    "method.request.querystring.q"          = false
    "method.request.querystring.searchMode" = false
    "method.request.querystring.fileType"   = false
    "method.request.querystring.dateFrom"   = false
    "method.request.querystring.dateTo"     = false
    "method.request.querystring.page"       = false
    "method.request.querystring.limit"      = false
    "method.request.querystring.sortBy"     = false
    "method.request.querystring.sortOrder"  = false
  }
}

# API Gateway Integration - Lambda Proxy
resource "aws_api_gateway_integration" "search_lambda" {
  rest_api_id = aws_api_gateway_rest_api.search_api.id
  resource_id = aws_api_gateway_resource.search.id
  http_method = aws_api_gateway_method.search_get.http_method

  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.search_api.invoke_arn
}

# API Gateway Method - OPTIONS /search (CORS)
resource "aws_api_gateway_method" "search_options" {
  rest_api_id   = aws_api_gateway_rest_api.search_api.id
  resource_id   = aws_api_gateway_resource.search.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

# API Gateway Integration - OPTIONS Mock
resource "aws_api_gateway_integration" "search_options" {
  rest_api_id = aws_api_gateway_rest_api.search_api.id
  resource_id = aws_api_gateway_resource.search.id
  http_method = aws_api_gateway_method.search_options.http_method

  type = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

# API Gateway Method Response - OPTIONS
resource "aws_api_gateway_method_response" "search_options" {
  rest_api_id = aws_api_gateway_rest_api.search_api.id
  resource_id = aws_api_gateway_resource.search.id
  http_method = aws_api_gateway_method.search_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

# API Gateway Integration Response - OPTIONS
resource "aws_api_gateway_integration_response" "search_options" {
  rest_api_id = aws_api_gateway_rest_api.search_api.id
  resource_id = aws_api_gateway_resource.search.id
  http_method = aws_api_gateway_method.search_options.http_method
  status_code = aws_api_gateway_method_response.search_options.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
  }
}

# Lambda Permission for API Gateway
resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.search_api.function_name
  principal     = "apigateway.amazonaws.com"

  source_arn = "${aws_api_gateway_rest_api.search_api.execution_arn}/*/*/*"
}

# API Gateway Deployment
resource "aws_api_gateway_deployment" "search_api" {
  depends_on = [
    aws_api_gateway_integration.search_lambda,
    aws_api_gateway_integration.search_options
  ]

  rest_api_id = aws_api_gateway_rest_api.search_api.id
  stage_name  = var.environment

  lifecycle {
    create_before_destroy = true
  }
}

# CloudWatch Alarms
resource "aws_cloudwatch_metric_alarm" "search_api_errors" {
  alarm_name          = "cis-search-api-high-error-rate-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = "60"
  statistic           = "Sum"
  threshold           = "10"
  alarm_description   = "Search API error rate is too high"

  dimensions = {
    FunctionName = aws_lambda_function.search_api.function_name
  }

  tags = {
    Name        = "CIS Search API Error Alarm"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_metric_alarm" "search_api_throttles" {
  alarm_name          = "cis-search-api-throttles-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = "60"
  statistic           = "Sum"
  threshold           = "5"
  alarm_description   = "Search API is being throttled"

  dimensions = {
    FunctionName = aws_lambda_function.search_api.function_name
  }

  tags = {
    Name        = "CIS Search API Throttle Alarm"
    Environment = var.environment
  }
}

# Data source
data "aws_caller_identity" "current" {}

# Outputs
output "lambda_function_arn" {
  description = "ARN of the Lambda function"
  value       = aws_lambda_function.search_api.arn
}

output "lambda_function_name" {
  description = "Name of the Lambda function"
  value       = aws_lambda_function.search_api.function_name
}

output "api_gateway_url" {
  description = "API Gateway URL"
  value       = "${aws_api_gateway_deployment.search_api.invoke_url}/search"
}

output "api_gateway_id" {
  description = "API Gateway REST API ID"
  value       = aws_api_gateway_rest_api.search_api.id
}
