# EC2 File Processor (Python Worker) Infrastructure
# IAM roles, Security Groups, Auto Scaling Group, and related resources

# ============================================================================
# IAM Role and Instance Profile for EC2 File Processor
# ============================================================================

# IAM Role for EC2 instances
resource "aws_iam_role" "ec2_file_processor" {
  name = "${var.project_name}-ec2-file-processor-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-ec2-file-processor-role"
  }
}

# IAM Instance Profile
resource "aws_iam_instance_profile" "ec2_file_processor" {
  name = "${var.project_name}-ec2-file-processor-profile"
  role = aws_iam_role.ec2_file_processor.name

  tags = {
    Name = "${var.project_name}-ec2-file-processor-profile"
  }
}

# ============================================================================
# IAM Policies - Principle of Least Privilege
# ============================================================================

# S3 Permissions - File Access
resource "aws_iam_role_policy" "ec2_s3_access" {
  name = "${var.project_name}-ec2-s3-policy"
  role = aws_iam_role.ec2_file_processor.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3ListBucket"
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:GetBucketLocation"
        ]
        Resource = [
          aws_s3_bucket.metadata.arn
        ]
      },
      {
        Sid    = "S3ReadFiles"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:GetObjectMetadata"
        ]
        Resource = [
          "${aws_s3_bucket.metadata.arn}/files/*",
          "${aws_s3_bucket.metadata.arn}/landing/*"
        ]
      },
      {
        Sid    = "S3WriteThumbnails"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:PutObjectMetadata"
        ]
        Resource = [
          "${aws_s3_bucket.metadata.arn}/thumbnails/*"
        ]
      },
      {
        Sid    = "S3DeleteProcessedFiles"
        Effect = "Allow"
        Action = [
          "s3:DeleteObject"
        ]
        Resource = [
          "${aws_s3_bucket.metadata.arn}/landing/*"
        ]
        Condition = {
          StringEquals = {
            "s3:ExistingObjectTag/processed" = "true"
          }
        }
      }
    ]
  })
}

# SQS Permissions - Message Processing
resource "aws_iam_role_policy" "ec2_sqs_access" {
  name = "${var.project_name}-ec2-sqs-policy"
  role = aws_iam_role.ec2_file_processor.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SQSReceiveMessages"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl"
        ]
        Resource = [
          "arn:aws:sqs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:cis-filesearch-index-queue"
        ]
      },
      {
        Sid    = "SQSSendToDLQ"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage"
        ]
        Resource = [
          "arn:aws:sqs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:cis-filesearch-index-queue-dlq"
        ]
      }
    ]
  })
}

# OpenSearch Permissions - Document Indexing
resource "aws_iam_role_policy" "ec2_opensearch_access" {
  name = "${var.project_name}-ec2-opensearch-policy"
  role = aws_iam_role.ec2_file_processor.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "OpenSearchHTTPAccess"
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
      },
      {
        Sid    = "OpenSearchDescribe"
        Effect = "Allow"
        Action = [
          "es:DescribeDomain",
          "es:DescribeDomainConfig"
        ]
        Resource = [
          "arn:aws:es:${var.aws_region}:${data.aws_caller_identity.current.account_id}:domain/${var.opensearch_domain_name}"
        ]
      }
    ]
  })
}

# Bedrock Permissions - AI/ML Model Invocation
resource "aws_iam_role_policy" "ec2_bedrock_access" {
  name = "${var.project_name}-ec2-bedrock-policy"
  role = aws_iam_role.ec2_file_processor.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "BedrockInvokeModel"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel"
        ]
        Resource = [
          "arn:aws:bedrock:${var.aws_region}::foundation-model/amazon.titan-embed-text-v1",
          "arn:aws:bedrock:${var.aws_region}::foundation-model/amazon.titan-embed-image-v1"
        ]
      }
    ]
  })
}

# CloudWatch Logs Permissions - Logging
resource "aws_iam_role_policy" "ec2_cloudwatch_logs" {
  name = "${var.project_name}-ec2-cloudwatch-logs-policy"
  role = aws_iam_role.ec2_file_processor.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "CloudWatchLogsWrite"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = [
          "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/ec2/file-processor*"
        ]
      }
    ]
  })
}

# CloudWatch Metrics Permissions - Custom Metrics
resource "aws_iam_role_policy" "ec2_cloudwatch_metrics" {
  name = "${var.project_name}-ec2-cloudwatch-metrics-policy"
  role = aws_iam_role.ec2_file_processor.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "CloudWatchPutMetrics"
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = "FileProcessor"
          }
        }
      }
    ]
  })
}

# Secrets Manager Permissions - Secure Credential Access
resource "aws_iam_role_policy" "ec2_secrets_manager" {
  name = "${var.project_name}-ec2-secrets-manager-policy"
  role = aws_iam_role.ec2_file_processor.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SecretsManagerRead"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [
          "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:${var.project_name}/opensearch/*",
          "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:${var.project_name}/api-keys/*"
        ]
      }
    ]
  })
}

# SSM Permissions - Parameter Store Access
resource "aws_iam_role_policy" "ec2_ssm_access" {
  name = "${var.project_name}-ec2-ssm-policy"
  role = aws_iam_role.ec2_file_processor.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SSMParameterRead"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath"
        ]
        Resource = [
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/*"
        ]
      }
    ]
  })
}

# EC2 Instance Metadata Service v2 (IMDSv2) - Security Best Practice
resource "aws_iam_role_policy" "ec2_imdsv2_enforcement" {
  name = "${var.project_name}-ec2-imdsv2-policy"
  role = aws_iam_role.ec2_file_processor.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EnforceIMDSv2"
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances",
          "ec2:ModifyInstanceMetadataOptions"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "ec2:MetadataHttpTokens" = "required"
          }
        }
      }
    ]
  })
}

# ============================================================================
# Security Group for EC2 File Processor
# ============================================================================

resource "aws_security_group" "ec2_file_processor" {
  name        = "${var.project_name}-ec2-file-processor-sg"
  description = "Security group for EC2 file processor instances"
  vpc_id      = aws_vpc.main.id

  # Egress rules - Allow outbound traffic to AWS services
  egress {
    description = "HTTPS to AWS services (S3, SQS, OpenSearch, Bedrock)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "HTTP for package updates (yum/apt)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # NO INGRESS RULES - Workers do not accept inbound connections
  # All communication is outbound-only (polling SQS, calling AWS APIs)

  tags = {
    Name = "${var.project_name}-ec2-file-processor-sg"
  }
}

# ============================================================================
# CloudWatch Log Group for File Processor
# ============================================================================

resource "aws_cloudwatch_log_group" "file_processor" {
  name              = "/aws/ec2/file-processor"
  retention_in_days = 30

  tags = {
    Name = "${var.project_name}-file-processor-logs"
  }
}

# ============================================================================
# Launch Template for Auto Scaling Group
# ============================================================================

resource "aws_launch_template" "file_processor" {
  name_prefix   = "${var.project_name}-file-processor-"
  image_id      = var.ec2_ami_id # Amazon Linux 2023 or Ubuntu with Python 3.11+
  instance_type = var.ec2_instance_type

  iam_instance_profile {
    arn = aws_iam_instance_profile.ec2_file_processor.arn
  }

  vpc_security_group_ids = [aws_security_group.ec2_file_processor.id]

  # Enforce IMDSv2 for enhanced security
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required" # Require IMDSv2
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "enabled"
  }

  # EBS volume encryption
  block_device_mappings {
    device_name = "/dev/xvda"

    ebs {
      volume_size           = 20
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  # User data script - Install dependencies and start worker
  user_data = base64encode(templatefile("${path.module}/user_data/file_processor_init.sh", {
    aws_region           = var.aws_region
    s3_bucket            = aws_s3_bucket.metadata.id
    sqs_queue_url        = "https://sqs.${var.aws_region}.amazonaws.com/${data.aws_caller_identity.current.account_id}/cis-filesearch-index-queue"
    opensearch_endpoint  = var.opensearch_endpoint
    opensearch_index     = "file-index"
    log_group            = aws_cloudwatch_log_group.file_processor.name
    project_name         = var.project_name
  }))

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "${var.project_name}-file-processor"
      Role = "FileProcessor"
    }
  }

  tag_specifications {
    resource_type = "volume"
    tags = {
      Name = "${var.project_name}-file-processor-volume"
    }
  }

  tags = {
    Name = "${var.project_name}-file-processor-launch-template"
  }
}

# ============================================================================
# Auto Scaling Group
# ============================================================================

resource "aws_autoscaling_group" "file_processor" {
  name_prefix         = "${var.project_name}-file-processor-asg-"
  vpc_zone_identifier = aws_subnet.private[*].id

  desired_capacity = var.asg_desired_capacity
  min_size         = var.asg_min_size
  max_size         = var.asg_max_size

  health_check_type         = "EC2"
  health_check_grace_period = 300

  launch_template {
    id      = aws_launch_template.file_processor.id
    version = "$Latest"
  }

  # Scaling based on SQS queue depth
  enabled_metrics = [
    "GroupDesiredCapacity",
    "GroupInServiceInstances",
    "GroupMinSize",
    "GroupMaxSize"
  ]

  tag {
    key                 = "Name"
    value               = "${var.project_name}-file-processor"
    propagate_at_launch = true
  }

  tag {
    key                 = "Role"
    value               = "FileProcessor"
    propagate_at_launch = true
  }
}

# ============================================================================
# Auto Scaling Policies - Scale based on SQS Queue Depth
# ============================================================================

# CloudWatch Metric - SQS Queue Depth
resource "aws_cloudwatch_metric_alarm" "sqs_queue_high" {
  alarm_name          = "${var.project_name}-sqs-queue-depth-high"
  alarm_description   = "Scale up when SQS queue has many messages"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Average"
  threshold           = 100 # Scale up when > 100 messages

  dimensions = {
    QueueName = "cis-filesearch-index-queue"
  }

  alarm_actions = [aws_autoscaling_policy.scale_up.arn]
}

resource "aws_cloudwatch_metric_alarm" "sqs_queue_low" {
  alarm_name          = "${var.project_name}-sqs-queue-depth-low"
  alarm_description   = "Scale down when SQS queue is nearly empty"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 5
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Average"
  threshold           = 10 # Scale down when < 10 messages

  dimensions = {
    QueueName = "cis-filesearch-index-queue"
  }

  alarm_actions = [aws_autoscaling_policy.scale_down.arn]
}

# Scaling Policy - Scale Up
resource "aws_autoscaling_policy" "scale_up" {
  name                   = "${var.project_name}-file-processor-scale-up"
  autoscaling_group_name = aws_autoscaling_group.file_processor.name
  adjustment_type        = "ChangeInCapacity"
  scaling_adjustment     = 2 # Add 2 instances
  cooldown               = 300
}

# Scaling Policy - Scale Down
resource "aws_autoscaling_policy" "scale_down" {
  name                   = "${var.project_name}-file-processor-scale-down"
  autoscaling_group_name = aws_autoscaling_group.file_processor.name
  adjustment_type        = "ChangeInCapacity"
  scaling_adjustment     = -1 # Remove 1 instance
  cooldown               = 600 # Longer cooldown for scale-down
}

# ============================================================================
# Data Source
# ============================================================================

data "aws_caller_identity" "current" {}

# ============================================================================
# Variables (to be added to variables.tf)
# ============================================================================

# These should be added to your terraform/variables.tf file:
#
# variable "ec2_ami_id" {
#   description = "AMI ID for EC2 file processor (Amazon Linux 2023 or Ubuntu)"
#   type        = string
# }
#
# variable "ec2_instance_type" {
#   description = "EC2 instance type for file processor"
#   type        = string
#   default     = "t3.medium"
# }
#
# variable "asg_desired_capacity" {
#   description = "Desired number of EC2 instances"
#   type        = number
#   default     = 2
# }
#
# variable "asg_min_size" {
#   description = "Minimum number of EC2 instances"
#   type        = number
#   default     = 1
# }
#
# variable "asg_max_size" {
#   description = "Maximum number of EC2 instances"
#   type        = number
#   default     = 10
# }
#
# variable "opensearch_domain_name" {
#   description = "OpenSearch domain name"
#   type        = string
#   default     = "cis-filesearch"
# }
#
# variable "opensearch_endpoint" {
#   description = "OpenSearch endpoint URL"
#   type        = string
# }
