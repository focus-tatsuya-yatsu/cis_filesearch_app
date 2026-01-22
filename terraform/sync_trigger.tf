# ============================================================================
# Sync Trigger Infrastructure - Terraform Configuration
# SQS Queue + DynamoDB Progress Table + Lambda + API Gateway
# ============================================================================

# ----------------------------------------------------------------------------
# SQS FIFO Queue for Sync Trigger
# File Scanner PC will poll this queue to receive sync commands
# FIFO ensures exactly-once processing and message deduplication
# ----------------------------------------------------------------------------
resource "aws_sqs_queue" "sync_trigger" {
  name                        = "${var.project_name}-sync-trigger-queue.fifo"
  fifo_queue                  = true
  content_based_deduplication = false  # Using MessageDeduplicationId
  deduplication_scope         = "messageGroup"
  fifo_throughput_limit       = "perMessageGroupId"

  delay_seconds              = 0
  max_message_size           = 262144  # 256 KB
  message_retention_seconds  = 86400   # 1 day
  receive_wait_time_seconds  = 20      # Long polling
  visibility_timeout_seconds = 3600    # 1 hour (long-running sync)

  # Server-side encryption
  sqs_managed_sse_enabled = true

  tags = {
    Name        = "${var.project_name}-sync-trigger-queue"
    Environment = var.environment
    Purpose     = "SyncTrigger"
  }
}

# Dead Letter Queue for Sync Trigger (FIFO)
resource "aws_sqs_queue" "sync_trigger_dlq" {
  name                       = "${var.project_name}-sync-trigger-dlq.fifo"
  fifo_queue                 = true
  message_retention_seconds  = 1209600  # 14 days
  visibility_timeout_seconds = 300

  sqs_managed_sse_enabled = true

  tags = {
    Name        = "${var.project_name}-sync-trigger-dlq"
    Environment = var.environment
    Type        = "DLQ"
  }
}

# Redrive policy for main queue
resource "aws_sqs_queue_redrive_policy" "sync_trigger" {
  queue_url = aws_sqs_queue.sync_trigger.id
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.sync_trigger_dlq.arn
    maxReceiveCount     = 3
  })
}

# ----------------------------------------------------------------------------
# DynamoDB Table for Sync Progress
# Stores real-time sync progress for frontend polling
# ----------------------------------------------------------------------------
resource "aws_dynamodb_table" "sync_progress" {
  name         = "${var.project_name}-sync-progress"
  billing_mode = "PAY_PER_REQUEST"  # On-demand pricing
  hash_key     = "syncId"

  attribute {
    name = "syncId"
    type = "S"
  }

  # TTL for automatic cleanup (24 hours after completion)
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  # Point-in-time recovery for production
  point_in_time_recovery {
    enabled = true
  }

  # Server-side encryption with AWS managed key
  server_side_encryption {
    enabled = true
  }

  tags = {
    Name        = "${var.project_name}-sync-progress"
    Environment = var.environment
    Purpose     = "SyncProgressTracking"
  }
}

# ----------------------------------------------------------------------------
# IAM Role for Sync Trigger Lambda
# ----------------------------------------------------------------------------
resource "aws_iam_role" "lambda_sync_trigger" {
  name = "${var.project_name}-lambda-sync-trigger-role"

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
    Name        = "${var.project_name}-lambda-sync-trigger-role"
    Environment = var.environment
  }
}

# IAM Policy for Sync Trigger Lambda
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
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.sync_trigger_lambda.arn}:*"
      }
    ]
  })
}

# CloudWatch Log Group for Lambda
resource "aws_cloudwatch_log_group" "sync_trigger_lambda" {
  name              = "/aws/lambda/${var.project_name}-sync-trigger"
  retention_in_days = 14

  tags = {
    Name        = "${var.project_name}-sync-trigger-logs"
    Environment = var.environment
  }
}

# ----------------------------------------------------------------------------
# Lambda Function for Sync Trigger
# Handles POST /sync and GET /sync/progress/{id}
# ----------------------------------------------------------------------------
resource "aws_lambda_function" "sync_trigger" {
  function_name = "${var.project_name}-sync-trigger"
  role          = aws_iam_role.lambda_sync_trigger.arn
  handler       = "index.handler"
  runtime       = var.lambda_runtime_nodejs
  architectures = [var.lambda_architecture]

  # Placeholder - will be updated with actual code
  filename = "${path.module}/../backend/lambda-sync-trigger/dist/lambda-deployment.zip"

  # Use a dummy hash if file doesn't exist yet
  source_code_hash = fileexists("${path.module}/../backend/lambda-sync-trigger/dist/lambda-deployment.zip") ? filebase64sha256("${path.module}/../backend/lambda-sync-trigger/dist/lambda-deployment.zip") : base64sha256("placeholder")

  memory_size = 512  # Increased for DynamoDB + SQS operations
  timeout     = 30

  # Limit concurrent executions for DoS protection
  reserved_concurrent_executions = 10

  environment {
    variables = {
      SQS_QUEUE_URL      = aws_sqs_queue.sync_trigger.url
      DYNAMODB_TABLE     = aws_dynamodb_table.sync_progress.name
      AWS_REGION_NAME    = var.aws_region
      LOG_LEVEL          = "info"
      NODE_ENV           = var.environment
      FRONTEND_DOMAIN    = "https://${var.frontend_domain}"
    }
  }

  tags = {
    Name        = "${var.project_name}-sync-trigger"
    Environment = var.environment
    Purpose     = "SyncTrigger"
  }

  lifecycle {
    # Don't fail if deployment package doesn't exist yet
    ignore_changes = [source_code_hash, filename]
  }
}

# Lambda Permission for API Gateway
resource "aws_lambda_permission" "api_gateway_sync" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sync_trigger.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

# ----------------------------------------------------------------------------
# API Gateway Resources for Sync
# ----------------------------------------------------------------------------

# /sync Resource
resource "aws_api_gateway_resource" "sync" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "sync"
}

# POST /sync Method (Start Sync - Cognito Auth Required)
resource "aws_api_gateway_method" "sync_post" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.sync.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id

  request_parameters = {
    "method.request.header.Authorization" = true
  }
}

# Lambda Integration for POST /sync
resource "aws_api_gateway_integration" "sync_post" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.sync.id
  http_method             = aws_api_gateway_method.sync_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.sync_trigger.invoke_arn
}

# OPTIONS /sync for CORS
resource "aws_api_gateway_method" "sync_options" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.sync.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sync_options" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.sync.id
  http_method = aws_api_gateway_method.sync_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "sync_options_200" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.sync.id
  http_method = aws_api_gateway_method.sync_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "sync_options" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.sync.id
  http_method = aws_api_gateway_method.sync_options.http_method
  status_code = aws_api_gateway_method_response.sync_options_200.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'https://${var.frontend_domain}'"
  }
}

# /sync/progress Resource
resource "aws_api_gateway_resource" "sync_progress" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.sync.id
  path_part   = "progress"
}

# /sync/progress/{sync_id} Resource
resource "aws_api_gateway_resource" "sync_progress_id" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_resource.sync_progress.id
  path_part   = "{sync_id}"
}

# GET /sync/progress/{sync_id} Method
resource "aws_api_gateway_method" "sync_progress_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.sync_progress_id.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id

  request_parameters = {
    "method.request.header.Authorization" = true
    "method.request.path.sync_id"         = true
  }
}

# Lambda Integration for GET /sync/progress/{sync_id}
resource "aws_api_gateway_integration" "sync_progress_get" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.sync_progress_id.id
  http_method             = aws_api_gateway_method.sync_progress_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.sync_trigger.invoke_arn
}

# OPTIONS /sync/progress/{sync_id} for CORS
resource "aws_api_gateway_method" "sync_progress_options" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.sync_progress_id.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "sync_progress_options" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.sync_progress_id.id
  http_method = aws_api_gateway_method.sync_progress_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "sync_progress_options_200" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.sync_progress_id.id
  http_method = aws_api_gateway_method.sync_progress_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "sync_progress_options" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  resource_id = aws_api_gateway_resource.sync_progress_id.id
  http_method = aws_api_gateway_method.sync_progress_options.http_method
  status_code = aws_api_gateway_method_response.sync_progress_options_200.status_code

  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'https://${var.frontend_domain}'"
  }
}

# ----------------------------------------------------------------------------
# IAM User for File Scanner PC (SQS Polling + DynamoDB Progress Update)
# ----------------------------------------------------------------------------
resource "aws_iam_user" "sync_scanner" {
  name = "${var.project_name}-sync-scanner"

  tags = {
    Name        = "${var.project_name}-sync-scanner"
    Environment = var.environment
    Purpose     = "FileScannerPC"
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
        Resource = "arn:aws:s3:::${var.project_name}-s3-landing/*"
      }
    ]
  })
}

# Access Key for File Scanner PC
resource "aws_iam_access_key" "sync_scanner" {
  user = aws_iam_user.sync_scanner.name
}

# ----------------------------------------------------------------------------
# CloudWatch Alarms
# ----------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "sync_queue_age" {
  alarm_name          = "${var.project_name}-sync-queue-message-age"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 3600  # 1 hour - sync message not being processed
  alarm_description   = "Sync trigger message is not being processed"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.sync_trigger.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = {
    Name        = "${var.project_name}-sync-queue-age-alarm"
    Environment = var.environment
  }
}

# DLQ Alarm - alerts when messages end up in dead letter queue
resource "aws_cloudwatch_metric_alarm" "sync_dlq_messages" {
  alarm_name          = "${var.project_name}-sync-dlq-messages"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Messages in sync trigger DLQ - requires investigation"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.sync_trigger_dlq.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = {
    Name        = "${var.project_name}-sync-dlq-alarm"
    Environment = var.environment
  }
}

# Lambda Error Alarm
resource "aws_cloudwatch_metric_alarm" "sync_lambda_errors" {
  alarm_name          = "${var.project_name}-sync-lambda-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 3
  alarm_description   = "Sync trigger Lambda errors detected"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.sync_trigger.function_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = {
    Name        = "${var.project_name}-sync-lambda-errors-alarm"
    Environment = var.environment
  }
}

# ----------------------------------------------------------------------------
# Outputs
# ----------------------------------------------------------------------------
output "sync_trigger_sqs_url" {
  description = "SQS Queue URL for sync trigger"
  value       = aws_sqs_queue.sync_trigger.url
}

output "sync_trigger_sqs_arn" {
  description = "SQS Queue ARN for sync trigger"
  value       = aws_sqs_queue.sync_trigger.arn
}

output "sync_progress_table_name" {
  description = "DynamoDB table name for sync progress"
  value       = aws_dynamodb_table.sync_progress.name
}

output "sync_progress_table_arn" {
  description = "DynamoDB table ARN for sync progress"
  value       = aws_dynamodb_table.sync_progress.arn
}

output "sync_trigger_lambda_arn" {
  description = "Lambda function ARN for sync trigger"
  value       = aws_lambda_function.sync_trigger.arn
}

output "sync_api_endpoint" {
  description = "API Gateway endpoint for sync"
  value       = "https://api.${var.frontend_domain}/sync"
}

output "sync_scanner_access_key_id" {
  description = "Access Key ID for File Scanner PC (store securely!)"
  value       = aws_iam_access_key.sync_scanner.id
  sensitive   = true
}

output "sync_scanner_secret_access_key" {
  description = "Secret Access Key for File Scanner PC (store securely!)"
  value       = aws_iam_access_key.sync_scanner.secret
  sensitive   = true
}
