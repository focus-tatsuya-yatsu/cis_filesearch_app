# terraform/launch_template.tf
# Launch Template for Python Worker Auto Scaling

resource "aws_launch_template" "python_worker" {
  name_prefix   = "python-worker-"
  description   = "Launch template for Python Worker Auto Scaling"
  image_id      = var.ami_id
  instance_type = var.instance_type

  iam_instance_profile {
    name = aws_iam_instance_profile.worker_profile.name
  }

  vpc_security_group_ids = [aws_security_group.worker_sg.id]

  key_name = var.key_pair_name

  monitoring {
    enabled = true
  }

  ebs_optimized = true

  block_device_mappings {
    device_name = "/dev/xvda"

    ebs {
      volume_size           = 30
      volume_type           = "gp3"
      iops                  = 3000
      throughput            = 125
      delete_on_termination = true
      encrypted             = true
      kms_key_id            = var.ebs_kms_key_arn
    }
  }

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "enabled"
  }

  tag_specifications {
    resource_type = "instance"

    tags = merge(
      var.common_tags,
      {
        Name        = "python-worker"
        Environment = var.environment
        Application = "file-processor"
        ManagedBy   = "AutoScaling"
      }
    )
  }

  tag_specifications {
    resource_type = "volume"

    tags = merge(
      var.common_tags,
      {
        Name = "python-worker-volume"
      }
    )
  }

  user_data = base64encode(templatefile("${path.module}/../scripts/user-data.sh.tpl", {
    aws_region            = var.aws_region
    s3_bucket             = var.s3_bucket
    sqs_queue_url         = aws_sqs_queue.file_processing.url
    opensearch_endpoint   = var.opensearch_endpoint
    opensearch_index      = var.opensearch_index
    log_level             = var.log_level
    cloudwatch_log_group  = aws_cloudwatch_log_group.worker.name
  }))

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(
    var.common_tags,
    {
      Name = "python-worker-launch-template"
    }
  )
}

# IAM Instance Profile
resource "aws_iam_instance_profile" "worker_profile" {
  name = "${var.project_name}-worker-profile"
  role = aws_iam_role.worker_role.name

  tags = var.common_tags
}

# IAM Role
resource "aws_iam_role" "worker_role" {
  name               = "${var.project_name}-worker-role"
  assume_role_policy = data.aws_iam_policy_document.assume_role_policy.json

  tags = var.common_tags
}

data "aws_iam_policy_document" "assume_role_policy" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

# IAM Policy
resource "aws_iam_role_policy" "worker_policy" {
  name   = "${var.project_name}-worker-policy"
  role   = aws_iam_role.worker_role.id
  policy = data.aws_iam_policy_document.worker_policy.json
}

data "aws_iam_policy_document" "worker_policy" {
  # S3 Access
  statement {
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:ListBucket"
    ]
    resources = [
      "arn:aws:s3:::${var.s3_bucket}",
      "arn:aws:s3:::${var.s3_bucket}/*"
    ]
  }

  # SQS Access
  statement {
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ChangeMessageVisibility"
    ]
    resources = [aws_sqs_queue.file_processing.arn]
  }

  # OpenSearch Access
  statement {
    effect = "Allow"
    actions = [
      "es:ESHttpPost",
      "es:ESHttpPut",
      "es:ESHttpGet"
    ]
    resources = ["${var.opensearch_domain_arn}/*"]
  }

  # CloudWatch Logs
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams"
    ]
    resources = [
      "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/ec2/file-processor*"
    ]
  }

  # CloudWatch Metrics
  statement {
    effect = "Allow"
    actions = [
      "cloudwatch:PutMetricData"
    ]
    resources = ["*"]
  }

  # EC2 Metadata (IMDSv2)
  statement {
    effect = "Allow"
    actions = [
      "ec2:DescribeTags"
    ]
    resources = ["*"]
  }
}

# Security Group
resource "aws_security_group" "worker_sg" {
  name_prefix = "${var.project_name}-worker-sg-"
  description = "Security group for Python Worker instances"
  vpc_id      = var.vpc_id

  # Outbound: Allow all (for AWS API access)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound traffic for AWS API access"
  }

  # Inbound: SSH (optional, for debugging)
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.allow_ssh_from
    description = "SSH access for debugging"
  }

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(
    var.common_tags,
    {
      Name = "${var.project_name}-worker-sg"
    }
  )
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "worker" {
  name              = "/aws/ec2/file-processor"
  retention_in_days = var.log_retention_days

  tags = var.common_tags
}

# Data source
data "aws_caller_identity" "current" {}
