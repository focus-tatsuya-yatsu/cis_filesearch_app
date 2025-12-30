# terraform/sqs.tf
# SQS Queue configuration for Python Worker

# Main Processing Queue
resource "aws_sqs_queue" "file_processing" {
  name                       = "${var.project_name}-file-processing-queue"
  delay_seconds              = 0
  max_message_size           = 262144 # 256 KB
  message_retention_seconds  = 1209600 # 14 days
  receive_wait_time_seconds  = 20 # Long polling
  visibility_timeout_seconds = 900 # 15 minutes

  # Dead Letter Queue configuration
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.file_processing_dlq.arn
    maxReceiveCount     = 3
  })

  # Server-side encryption
  sqs_managed_sse_enabled = true

  tags = merge(
    var.common_tags,
    {
      Name        = "${var.project_name}-file-processing-queue"
      Environment = var.environment
    }
  )
}

# Dead Letter Queue
resource "aws_sqs_queue" "file_processing_dlq" {
  name                       = "${var.project_name}-file-processing-dlq"
  message_retention_seconds  = 1209600 # 14 days
  visibility_timeout_seconds = 300

  # Server-side encryption
  sqs_managed_sse_enabled = true

  tags = merge(
    var.common_tags,
    {
      Name        = "${var.project_name}-file-processing-dlq"
      Environment = var.environment
      Type        = "DLQ"
    }
  )
}

# Queue Policy - Allow S3 to send messages
resource "aws_sqs_queue_policy" "file_processing" {
  queue_url = aws_sqs_queue.file_processing.id
  policy    = data.aws_iam_policy_document.sqs_policy.json
}

data "aws_iam_policy_document" "sqs_policy" {
  statement {
    sid    = "AllowS3ToSendMessage"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }

    actions = [
      "sqs:SendMessage"
    ]

    resources = [
      aws_sqs_queue.file_processing.arn
    ]

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = ["arn:aws:s3:::${var.s3_bucket}"]
    }
  }
}

# CloudWatch Alarms for Queue Metrics
resource "aws_cloudwatch_metric_alarm" "queue_age_high" {
  alarm_name          = "${var.project_name}-queue-message-age-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 1800 # 30 minutes
  alarm_description   = "Alert when messages are aging in queue"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.file_processing.name
  }

  alarm_actions = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []

  tags = var.common_tags
}
