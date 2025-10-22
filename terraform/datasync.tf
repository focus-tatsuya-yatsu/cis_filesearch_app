# DataSync Configuration for NAS to S3 Synchronization

# DataSync SMB Location (NAS)
resource "aws_datasync_location_smb" "nas" {
  server_hostname = var.nas_smb_server
  subdirectory    = var.nas_smb_subdirectory
  user            = var.nas_smb_username
  password        = var.nas_smb_password
  domain          = var.nas_smb_domain

  agent_arns = [aws_datasync_agent.nas.arn]

  mount_options {
    version = "SMB3"
  }

  tags = {
    Name = "${var.project_name}-nas-smb-location"
  }
}

# DataSync S3 Location
resource "aws_datasync_location_s3" "metadata" {
  s3_bucket_arn = aws_s3_bucket.metadata.arn
  subdirectory  = "/files"

  s3_config {
    bucket_access_role_arn = aws_iam_role.datasync_s3_access.arn
  }

  tags = {
    Name = "${var.project_name}-s3-location"
  }
}

# DataSync Task
resource "aws_datasync_task" "nas_to_s3" {
  name                     = "${var.project_name}-monthly-batch-sync"
  source_location_arn      = aws_datasync_location_smb.nas.arn
  destination_location_arn = aws_datasync_location_s3.metadata.arn

  options {
    verify_mode                  = "POINT_IN_TIME_CONSISTENT"
    transfer_mode                = "CHANGED" # Incremental sync only
    preserve_deleted_files       = "REMOVE"
    preserve_devices             = "NONE"
    posix_permissions            = "NONE"
    bytes_per_second             = var.datasync_bandwidth_limit * 1000000 / 8 # Convert Mbps to bytes/sec
    task_queueing                = "ENABLED"
    log_level                    = "TRANSFER"
    overwrite_mode               = "ALWAYS"
    atime                        = "BEST_EFFORT"
    mtime                        = "PRESERVE"
    uid                          = "NONE"
    gid                          = "NONE"
    security_descriptor_copy_flags = "NONE"
  }

  cloudwatch_log_group_arn = aws_cloudwatch_log_group.datasync.arn

  schedule {
    schedule_expression = "cron(0 2 1 * ? *)" # Monthly on 1st at 2:00 AM
  }

  tags = {
    Name = "${var.project_name}-datasync-task"
  }
}

# DataSync Agent (placeholder - needs to be activated manually)
resource "aws_datasync_agent" "nas" {
  name       = "${var.project_name}-datasync-agent"
  ip_address = "0.0.0.0" # Placeholder - replace with actual agent IP after activation

  tags = {
    Name = "${var.project_name}-datasync-agent"
  }

  lifecycle {
    ignore_changes = [ip_address]
  }
}

# IAM Role for DataSync S3 Access
resource "aws_iam_role" "datasync_s3_access" {
  name = "${var.project_name}-datasync-s3-access"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "datasync.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-datasync-s3-role"
  }
}

# IAM Policy for DataSync S3 Access
resource "aws_iam_role_policy" "datasync_s3_access" {
  name = "${var.project_name}-datasync-s3-policy"
  role = aws_iam_role.datasync_s3_access.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetBucketLocation",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads"
        ]
        Resource = aws_s3_bucket.metadata.arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:AbortMultipartUpload",
          "s3:DeleteObject",
          "s3:GetObject",
          "s3:ListMultipartUploadParts",
          "s3:PutObject",
          "s3:GetObjectTagging",
          "s3:PutObjectTagging"
        ]
        Resource = "${aws_s3_bucket.metadata.arn}/*"
      }
    ]
  })
}

# CloudWatch Log Group for DataSync
resource "aws_cloudwatch_log_group" "datasync" {
  name              = "/aws/datasync/${var.project_name}"
  retention_in_days = 7

  tags = {
    Name = "${var.project_name}-datasync-logs"
  }
}

# CloudWatch Alarm for DataSync Task Failure
resource "aws_cloudwatch_metric_alarm" "datasync_task_failed" {
  alarm_name          = "${var.project_name}-datasync-task-failed"
  alarm_description   = "DataSync task failed alarm"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "TaskExecutionStatus"
  namespace           = "AWS/DataSync"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    TaskId = aws_datasync_task.nas_to_s3.id
  }

  alarm_actions = [aws_sns_topic.batch_notifications.arn]

  tags = {
    Name = "${var.project_name}-datasync-alarm"
  }
}
