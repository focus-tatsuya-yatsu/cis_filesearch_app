# ============================================================================
# Lambda Search API - Terraform Configuration
# Integrates with existing API Gateway (api_gateway_cognito.tf)
# ============================================================================

# ----------------------------------------------------------------------------
# Lambda IAM Role
# ----------------------------------------------------------------------------
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

# ----------------------------------------------------------------------------
# Lambda IAM Policy - OpenSearch Access
# ----------------------------------------------------------------------------
resource "aws_iam_role_policy" "lambda_opensearch_access" {
  name = "opensearch-access"
  role = aws_iam_role.lambda_search_api.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "OpenSearchReadOnlyAccess"
        Effect = "Allow"
        Action = [
          "es:ESHttpGet",
          "es:ESHttpPost",
          "es:ESHttpHead"
        ]
        Resource = "${aws_opensearch_domain.main.arn}/*"
      }
    ]
  })
}

# ----------------------------------------------------------------------------
# Lambda IAM Policy - CloudWatch Logs (VPC Access)
# ----------------------------------------------------------------------------
resource "aws_iam_role_policy_attachment" "lambda_vpc_execution" {
  role       = aws_iam_role.lambda_search_api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# ----------------------------------------------------------------------------
# Lambda Security Group
# ----------------------------------------------------------------------------
resource "aws_security_group" "lambda_search_api" {
  name        = "cis-lambda-search-api-sg-${var.environment}"
  description = "Security group for Lambda Search API"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS to OpenSearch and AWS services"
  }

  egress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTP for package downloads (VPC endpoints preferred)"
  }

  tags = {
    Name        = "CIS Lambda Search API SG"
    Environment = var.environment
  }
}

# ----------------------------------------------------------------------------
# OpenSearch Security Group Rule - Allow Lambda Access
# ----------------------------------------------------------------------------
resource "aws_security_group_rule" "opensearch_from_lambda_search" {
  type                     = "ingress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  security_group_id        = aws_security_group.opensearch.id
  source_security_group_id = aws_security_group.lambda_search_api.id
  description              = "Allow HTTPS from Lambda Search API"
}

# ----------------------------------------------------------------------------
# Lambda Function
# ----------------------------------------------------------------------------
resource "aws_lambda_function" "search_api_prod" {
  function_name = "cis-search-api-${var.environment}"
  role          = aws_iam_role.lambda_search_api.arn
  handler       = "index.handler"
  runtime       = var.lambda_runtime_nodejs
  architectures = [var.lambda_architecture]

  filename         = "${path.module}/../backend/lambda-search-api/dist/lambda-deployment.zip"
  source_code_hash = filebase64sha256("${path.module}/../backend/lambda-search-api/dist/lambda-deployment.zip")

  memory_size = 512
  timeout     = 30

  vpc_config {
    subnet_ids = aws_subnet.private[*].id
    security_group_ids = [
      aws_security_group.lambda_search_api.id
    ]
  }

  environment {
    variables = {
      OPENSEARCH_ENDPOINT = aws_opensearch_domain.main.endpoint
      OPENSEARCH_INDEX    = "file-index"
      AWS_REGION          = var.aws_region
      LOG_LEVEL           = "info"
      NODE_ENV            = var.environment
      FRONTEND_DOMAIN     = "https://${var.frontend_domain}"
    }
  }

  reserved_concurrent_executions = 10

  tags = {
    Name        = "CIS Search API"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
}

# ----------------------------------------------------------------------------
# CloudWatch Log Group
# ----------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "search_api" {
  name              = "/aws/lambda/${aws_lambda_function.search_api_prod.function_name}"
  retention_in_days = 30

  tags = {
    Name        = "CIS Search API Logs"
    Environment = var.environment
  }
}

# ----------------------------------------------------------------------------
# Lambda Permission for API Gateway
# ----------------------------------------------------------------------------
resource "aws_lambda_permission" "api_gateway_search" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.search_api_prod.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

# ----------------------------------------------------------------------------
# CloudWatch Alarms
# ----------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "search_api_errors" {
  alarm_name          = "${var.project_name}-search-api-high-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "Search API error rate is too high (>10 errors in 2 minutes)"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.search_api_prod.function_name
  }

  tags = {
    Name        = "CIS Search API Error Alarm"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_metric_alarm" "search_api_throttles" {
  alarm_name          = "${var.project_name}-search-api-throttles"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Search API is being throttled (>5 throttles in 1 minute)"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.search_api_prod.function_name
  }

  tags = {
    Name        = "CIS Search API Throttle Alarm"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_metric_alarm" "search_api_duration" {
  alarm_name          = "${var.project_name}-search-api-high-latency"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Average"
  threshold           = 5000 # 5 seconds
  alarm_description   = "Search API latency is too high (>5 seconds average)"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.search_api_prod.function_name
  }

  tags = {
    Name        = "CIS Search API Latency Alarm"
    Environment = var.environment
  }
}

# ----------------------------------------------------------------------------
# Outputs
# ----------------------------------------------------------------------------
output "lambda_search_api_arn" {
  description = "ARN of the Lambda Search API function"
  value       = aws_lambda_function.search_api_prod.arn
}

output "lambda_search_api_name" {
  description = "Name of the Lambda Search API function"
  value       = aws_lambda_function.search_api_prod.function_name
}

output "lambda_search_api_invoke_url" {
  description = "API Gateway URL for search endpoint"
  value       = "${aws_api_gateway_stage.prod.invoke_url}/search"
}

output "lambda_search_api_security_group_id" {
  description = "Security group ID of Lambda Search API"
  value       = aws_security_group.lambda_search_api.id
}
