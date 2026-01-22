# Sync Trigger Standalone Deployment
# SQS Queue + DynamoDB Progress Table + Lambda + API Gateway

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "cis-filesearch-terraform-state"
    key            = "sync-trigger/terraform.tfstate"
    region         = "ap-northeast-1"
    encrypt        = true
    dynamodb_table = "cis-filesearch-terraform-lock"
  }
}

provider "aws" {
  region = "ap-northeast-1"

  default_tags {
    tags = {
      Project     = "CIS-FileSearch"
      Environment = "prod"
      ManagedBy   = "Terraform"
      Component   = "SyncTrigger"
    }
  }
}

locals {
  project_name = "cis-filesearch"
  environment  = "prod"

  # Cognito 設定
  cognito_user_pool_id  = "ap-northeast-1_Zuf31l4an"
  cognito_app_client_id = "2s3km9tqr8bffn6bqc0ih0cma1"

  # CORS 許可オリジン
  allowed_origins = [
    "https://filesearch.focus88.co.jp",
    "https://cis-filesearch.com",
    "http://localhost:3000"
  ]
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ============================================================================
# SQS FIFO Queue for Sync Trigger
# ============================================================================
resource "aws_sqs_queue" "sync_trigger" {
  name                        = "${local.project_name}-sync-trigger-queue.fifo"
  fifo_queue                  = true
  content_based_deduplication = false
  deduplication_scope         = "messageGroup"
  fifo_throughput_limit       = "perMessageGroupId"

  delay_seconds              = 0
  max_message_size           = 262144
  message_retention_seconds  = 86400
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = 3600

  sqs_managed_sse_enabled = true

  tags = {
    Name    = "${local.project_name}-sync-trigger-queue"
    Purpose = "SyncTrigger"
  }
}

resource "aws_sqs_queue" "sync_trigger_dlq" {
  name                       = "${local.project_name}-sync-trigger-dlq.fifo"
  fifo_queue                 = true
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 300
  sqs_managed_sse_enabled    = true

  tags = {
    Name = "${local.project_name}-sync-trigger-dlq"
    Type = "DLQ"
  }
}

resource "aws_sqs_queue_redrive_policy" "sync_trigger" {
  queue_url = aws_sqs_queue.sync_trigger.id
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.sync_trigger_dlq.arn
    maxReceiveCount     = 3
  })
}

# ============================================================================
# DynamoDB Table for Sync Progress
# ============================================================================
resource "aws_dynamodb_table" "sync_progress" {
  name         = "${local.project_name}-sync-progress"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "syncId"

  attribute {
    name = "syncId"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name    = "${local.project_name}-sync-progress"
    Purpose = "SyncProgressTracking"
  }
}

# ============================================================================
# IAM Role for Lambda
# ============================================================================
resource "aws_iam_role" "lambda_sync_trigger" {
  name = "${local.project_name}-lambda-sync-trigger-role"

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
}

resource "aws_iam_role_policy" "lambda_sync_trigger" {
  name = "sync-trigger-policy"
  role = aws_iam_role.lambda_sync_trigger.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SQSSendMessage"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:GetQueueAttributes"
        ]
        Resource = aws_sqs_queue.sync_trigger.arn
      },
      {
        Sid    = "DynamoDBAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:GetItem",
          "dynamodb:Query"
        ]
        Resource = aws_dynamodb_table.sync_progress.arn
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# ============================================================================
# Lambda Function
# ============================================================================
resource "aws_lambda_function" "sync_trigger" {
  function_name = "${local.project_name}-sync-trigger"
  role          = aws_iam_role.lambda_sync_trigger.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  architectures = ["arm64"]

  filename         = "${path.module}/../../backend/lambda-sync-trigger/dist/lambda-deployment.zip"
  source_code_hash = filebase64sha256("${path.module}/../../backend/lambda-sync-trigger/dist/lambda-deployment.zip")

  memory_size = 512
  timeout     = 30
  # reserved_concurrent_executions は省略（アカウントの同時実行制限のため）

  environment {
    variables = {
      SQS_QUEUE_URL   = aws_sqs_queue.sync_trigger.url
      DYNAMODB_TABLE  = aws_dynamodb_table.sync_progress.name
      AWS_REGION_NAME = "ap-northeast-1"
      LOG_LEVEL       = "info"
      NODE_ENV        = "prod"
    }
  }

  tags = {
    Name    = "${local.project_name}-sync-trigger"
    Purpose = "SyncTrigger"
  }
}

# ============================================================================
# API Gateway (HTTP API - simpler than REST API)
# ============================================================================
resource "aws_apigatewayv2_api" "sync" {
  name          = "${local.project_name}-sync-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = local.allowed_origins
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
    max_age       = 300
  }

  tags = {
    Name = "${local.project_name}-sync-api"
  }
}

# JWT Authorizer (Cognito User Pool)
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.sync.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${local.project_name}-cognito-authorizer"

  jwt_configuration {
    audience = [local.cognito_app_client_id]
    issuer   = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${local.cognito_user_pool_id}"
  }
}

resource "aws_apigatewayv2_stage" "sync" {
  api_id      = aws_apigatewayv2_api.sync.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      responseLength = "$context.responseLength"
    })
  }
}

resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/${local.project_name}-sync-api"
  retention_in_days = 14
}

resource "aws_apigatewayv2_integration" "sync_lambda" {
  api_id                 = aws_apigatewayv2_api.sync.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sync_trigger.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sync_post" {
  api_id             = aws_apigatewayv2_api.sync.id
  route_key          = "POST /sync"
  target             = "integrations/${aws_apigatewayv2_integration.sync_lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "sync_progress_get" {
  api_id             = aws_apigatewayv2_api.sync.id
  route_key          = "GET /sync/progress/{sync_id}"
  target             = "integrations/${aws_apigatewayv2_integration.sync_lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sync_trigger.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.sync.execution_arn}/*/*"
}

# ============================================================================
# IAM User for File Scanner PC
# ============================================================================
resource "aws_iam_user" "sync_scanner" {
  name = "${local.project_name}-sync-scanner"

  tags = {
    Name    = "${local.project_name}-sync-scanner"
    Purpose = "FileScannerPC"
  }
}

resource "aws_iam_user_policy" "sync_scanner" {
  name = "sync-scanner-policy"
  user = aws_iam_user.sync_scanner.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SQSReceive"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl"
        ]
        Resource = aws_sqs_queue.sync_trigger.arn
      },
      {
        Sid    = "DynamoDBProgressUpdate"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:GetItem"
        ]
        Resource = aws_dynamodb_table.sync_progress.arn
      },
      {
        Sid    = "S3Upload"
        Effect = "Allow"
        Action = [
          "s3:PutObject"
        ]
        Resource = "arn:aws:s3:::${local.project_name}-s3-landing/*"
      }
    ]
  })
}

resource "aws_iam_access_key" "sync_scanner" {
  user = aws_iam_user.sync_scanner.name
}

# ============================================================================
# Outputs
# ============================================================================
output "sqs_queue_url" {
  description = "SQS Queue URL for sync trigger"
  value       = aws_sqs_queue.sync_trigger.url
}

output "dynamodb_table_name" {
  description = "DynamoDB table name for sync progress"
  value       = aws_dynamodb_table.sync_progress.name
}

output "lambda_function_name" {
  description = "Lambda function name"
  value       = aws_lambda_function.sync_trigger.function_name
}

output "api_endpoint" {
  description = "API Gateway endpoint"
  value       = aws_apigatewayv2_api.sync.api_endpoint
}

output "sync_scanner_access_key_id" {
  description = "Access Key ID for File Scanner PC"
  value       = aws_iam_access_key.sync_scanner.id
  sensitive   = true
}

output "sync_scanner_secret_access_key" {
  description = "Secret Access Key for File Scanner PC"
  value       = aws_iam_access_key.sync_scanner.secret
  sensitive   = true
}
