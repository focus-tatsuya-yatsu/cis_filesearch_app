# ============================================================================
# OpenSearch Migration Infrastructure
# Terraform configuration for migration execution environment
# ============================================================================

terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "cis-filesearch-terraform-state"
    key            = "opensearch-migration/terraform.tfstate"
    region         = "ap-northeast-1"
    encrypt        = true
    dynamodb_table = "terraform-state-lock"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "CISFileSearch"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Purpose     = "OpenSearch Migration"
    }
  }
}

# ============================================================================
# Variables
# ============================================================================

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-northeast-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "vpc_id" {
  description = "VPC ID where OpenSearch is deployed"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for migration resources"
  type        = list(string)
}

variable "opensearch_domain_name" {
  description = "OpenSearch domain name"
  type        = string
  default     = "cis-filesearch-opensearch"
}

variable "opensearch_security_group_id" {
  description = "Security group ID for OpenSearch domain"
  type        = string
}

# ============================================================================
# Data Sources
# ============================================================================

data "aws_opensearch_domain" "main" {
  domain_name = var.opensearch_domain_name
}

data "aws_caller_identity" "current" {}

data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ============================================================================
# IAM Roles and Policies
# ============================================================================

# EC2 Bastion Role
resource "aws_iam_role" "migration_bastion" {
  name               = "opensearch-migration-bastion-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "migration_bastion_opensearch" {
  name = "opensearch-access"
  role = aws_iam_role.migration_bastion.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "es:ESHttpGet",
          "es:ESHttpPut",
          "es:ESHttpPost",
          "es:ESHttpDelete",
          "es:ESHttpHead",
          "es:DescribeElasticsearchDomain",
          "es:ListDomainNames"
        ]
        Resource = "${data.aws_opensearch_domain.main.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath"
        ]
        Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/cis-filesearch/*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::cis-filesearch-opensearch-backups",
          "arn:aws:s3:::cis-filesearch-opensearch-backups/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/cis-filesearch/migration:*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "migration_bastion_ssm" {
  role       = aws_iam_role.migration_bastion.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "migration_bastion" {
  name = "opensearch-migration-bastion-profile"
  role = aws_iam_role.migration_bastion.name
}

# Lambda Migration Function Role
resource "aws_iam_role" "migration_lambda" {
  name               = "opensearch-migration-lambda-role"
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

resource "aws_iam_role_policy" "migration_lambda_opensearch" {
  name = "opensearch-access"
  role = aws_iam_role.migration_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "es:ESHttpGet",
          "es:ESHttpPut",
          "es:ESHttpPost",
          "es:ESHttpDelete",
          "es:ESHttpHead"
        ]
        Resource = "${data.aws_opensearch_domain.main.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters"
        ]
        Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/cis-filesearch/*"
      },
      {
        Effect = "Allow"
        Action = [
          "sns:Publish"
        ]
        Resource = aws_sns_topic.migration_alerts.arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "migration_lambda_vpc" {
  role       = aws_iam_role.migration_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# ============================================================================
# Security Groups
# ============================================================================

resource "aws_security_group" "migration_bastion" {
  name        = "opensearch-migration-bastion-sg"
  description = "Security group for OpenSearch migration bastion"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound traffic"
  }

  tags = {
    Name = "opensearch-migration-bastion-sg"
  }
}

resource "aws_security_group" "migration_lambda" {
  name        = "opensearch-migration-lambda-sg"
  description = "Security group for OpenSearch migration Lambda"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound traffic"
  }

  tags = {
    Name = "opensearch-migration-lambda-sg"
  }
}

# OpenSearch ingress rules
resource "aws_security_group_rule" "opensearch_from_bastion" {
  type                     = "ingress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.migration_bastion.id
  security_group_id        = var.opensearch_security_group_id
  description              = "Allow HTTPS from migration bastion"
}

resource "aws_security_group_rule" "opensearch_from_lambda" {
  type                     = "ingress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.migration_lambda.id
  security_group_id        = var.opensearch_security_group_id
  description              = "Allow HTTPS from migration Lambda"
}

# ============================================================================
# EC2 Bastion Instance
# ============================================================================

resource "aws_instance" "migration_bastion" {
  ami                    = data.aws_ami.amazon_linux_2023.id
  instance_type          = "t3.medium"
  subnet_id              = var.private_subnet_ids[0]
  vpc_security_group_ids = [aws_security_group.migration_bastion.id]
  iam_instance_profile   = aws_iam_instance_profile.migration_bastion.name

  user_data = base64encode(templatefile("${path.module}/user-data/bastion-setup.sh", {
    opensearch_endpoint = data.aws_opensearch_domain.main.endpoint
    aws_region          = var.aws_region
  }))

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"  # IMDSv2
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 30
    encrypted             = true
    delete_on_termination = true
  }

  tags = {
    Name    = "opensearch-migration-bastion"
    Purpose = "OpenSearch Migration Execution"
  }
}

# ============================================================================
# Lambda Function for Migration
# ============================================================================

resource "aws_lambda_function" "migration" {
  filename         = "${path.module}/../lambda-deployment.zip"
  function_name    = "opensearch-migration"
  role             = aws_iam_role.migration_lambda.arn
  handler          = "src/migration-handler.handler"
  runtime          = "nodejs20.x"
  timeout          = 900  # 15 minutes
  memory_size      = 2048
  source_code_hash = filebase64sha256("${path.module}/../lambda-deployment.zip")

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.migration_lambda.id]
  }

  environment {
    variables = {
      OPENSEARCH_ENDPOINT = data.aws_opensearch_domain.main.endpoint
      AWS_REGION          = var.aws_region
      NODE_ENV            = var.environment
      SNS_TOPIC_ARN       = aws_sns_topic.migration_alerts.arn
    }
  }

  dead_letter_config {
    target_arn = aws_sqs_queue.migration_dlq.arn
  }

  tracing_config {
    mode = "Active"
  }

  tags = {
    Name    = "opensearch-migration"
    Purpose = "Blue-Green Index Migration"
  }
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "migration_lambda" {
  name              = "/aws/lambda/opensearch-migration"
  retention_in_days = 30

  tags = {
    Name = "opensearch-migration-logs"
  }
}

# ============================================================================
# SNS Topic for Alerts
# ============================================================================

resource "aws_sns_topic" "migration_alerts" {
  name              = "opensearch-migration-alerts"
  display_name      = "OpenSearch Migration Alerts"
  kms_master_key_id = "alias/aws/sns"

  tags = {
    Name = "opensearch-migration-alerts"
  }
}

resource "aws_sns_topic_subscription" "migration_alerts_email" {
  topic_arn = aws_sns_topic.migration_alerts.arn
  protocol  = "email"
  endpoint  = "devops@example.com"  # 変更してください
}

# ============================================================================
# Dead Letter Queue
# ============================================================================

resource "aws_sqs_queue" "migration_dlq" {
  name                      = "opensearch-migration-dlq"
  message_retention_seconds = 1209600  # 14 days
  kms_master_key_id         = "alias/aws/sqs"

  tags = {
    Name = "opensearch-migration-dlq"
  }
}

# ============================================================================
# S3 Bucket for Backups
# ============================================================================

resource "aws_s3_bucket" "opensearch_backups" {
  bucket = "cis-filesearch-opensearch-backups"

  tags = {
    Name    = "opensearch-backups"
    Purpose = "OpenSearch Snapshots"
  }
}

resource "aws_s3_bucket_versioning" "opensearch_backups" {
  bucket = aws_s3_bucket.opensearch_backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "opensearch_backups" {
  bucket = aws_s3_bucket.opensearch_backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "opensearch_backups" {
  bucket = aws_s3_bucket.opensearch_backups.id

  rule {
    id     = "cleanup-old-snapshots"
    status = "Enabled"

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    expiration {
      days = 365
    }
  }
}

# ============================================================================
# SSM Parameters
# ============================================================================

resource "aws_ssm_parameter" "opensearch_endpoint" {
  name        = "/cis-filesearch/opensearch/endpoint"
  description = "OpenSearch VPC endpoint"
  type        = "String"
  value       = data.aws_opensearch_domain.main.endpoint

  tags = {
    Name = "opensearch-endpoint"
  }
}

resource "aws_ssm_parameter" "opensearch_index_name" {
  name        = "/cis-filesearch/opensearch/index-name"
  description = "OpenSearch current index name"
  type        = "String"
  value       = "file-index"

  tags = {
    Name = "opensearch-index-name"
  }
}

resource "aws_ssm_parameter" "opensearch_alias_name" {
  name        = "/cis-filesearch/opensearch/alias-name"
  description = "OpenSearch alias name"
  type        = "String"
  value       = "file-index"

  tags = {
    Name = "opensearch-alias-name"
  }
}

# ============================================================================
# CloudWatch Alarms
# ============================================================================

resource "aws_cloudwatch_metric_alarm" "migration_lambda_errors" {
  alarm_name          = "opensearch-migration-lambda-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Alert when migration Lambda has errors"
  alarm_actions       = [aws_sns_topic.migration_alerts.arn]

  dimensions = {
    FunctionName = aws_lambda_function.migration.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "migration_lambda_duration" {
  alarm_name          = "opensearch-migration-lambda-duration"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Maximum"
  threshold           = 840000  # 14 minutes (warning before 15min timeout)
  alarm_description   = "Alert when migration Lambda is close to timeout"
  alarm_actions       = [aws_sns_topic.migration_alerts.arn]

  dimensions = {
    FunctionName = aws_lambda_function.migration.function_name
  }
}

# ============================================================================
# Outputs
# ============================================================================

output "bastion_instance_id" {
  description = "Migration bastion EC2 instance ID"
  value       = aws_instance.migration_bastion.id
}

output "bastion_private_ip" {
  description = "Migration bastion private IP"
  value       = aws_instance.migration_bastion.private_ip
}

output "lambda_function_name" {
  description = "Migration Lambda function name"
  value       = aws_lambda_function.migration.function_name
}

output "lambda_function_arn" {
  description = "Migration Lambda function ARN"
  value       = aws_lambda_function.migration.arn
}

output "sns_topic_arn" {
  description = "Migration alerts SNS topic ARN"
  value       = aws_sns_topic.migration_alerts.arn
}

output "opensearch_endpoint" {
  description = "OpenSearch VPC endpoint"
  value       = data.aws_opensearch_domain.main.endpoint
  sensitive   = true
}

output "ssm_connect_command" {
  description = "Command to connect to bastion via SSM"
  value       = "aws ssm start-session --target ${aws_instance.migration_bastion.id}"
}
