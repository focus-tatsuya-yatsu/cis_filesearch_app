# terraform/autoscaling.tf
# Auto Scaling Group and Policies for Python Worker

resource "aws_autoscaling_group" "python_worker" {
  name                = "${var.project_name}-worker-asg"
  vpc_zone_identifier = var.private_subnet_ids

  min_size         = var.asg_min_size
  max_size         = var.asg_max_size
  desired_capacity = var.asg_desired_capacity

  health_check_type         = "EC2"
  health_check_grace_period = 300
  default_cooldown          = 300

  launch_template {
    id      = aws_launch_template.python_worker.id
    version = "$Latest"
  }

  enabled_metrics = [
    "GroupMinSize",
    "GroupMaxSize",
    "GroupDesiredCapacity",
    "GroupInServiceInstances",
    "GroupTotalInstances",
    "GroupPendingInstances",
    "GroupTerminatingInstances"
  ]

  instance_refresh {
    strategy = "Rolling"
    preferences {
      min_healthy_percentage = 90
      instance_warmup        = 300
      checkpoint_percentages = [50, 100]
      checkpoint_delay       = 300
    }
  }

  tag {
    key                 = "Name"
    value               = "${var.project_name}-worker"
    propagate_at_launch = true
  }

  tag {
    key                 = "Environment"
    value               = var.environment
    propagate_at_launch = true
  }

  tag {
    key                 = "Application"
    value               = "file-processor"
    propagate_at_launch = true
  }

  tag {
    key                 = "ManagedBy"
    value               = "Terraform"
    propagate_at_launch = true
  }

  lifecycle {
    create_before_destroy = true
    ignore_changes        = [desired_capacity]
  }
}

# Target Tracking Scaling Policy - SQSメッセージ数ベース
resource "aws_autoscaling_policy" "sqs_target_tracking" {
  name                   = "${var.project_name}-sqs-target-tracking"
  autoscaling_group_name = aws_autoscaling_group.python_worker.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    customized_metric_specification {
      metric_dimension {
        name  = "QueueName"
        value = aws_sqs_queue.file_processing.name
      }

      metric_name = "ApproximateNumberOfMessagesVisible"
      namespace   = "AWS/SQS"
      statistic   = "Average"
    }

    target_value       = var.sqs_target_messages_per_instance
    scale_in_cooldown  = 300 # 5分
    scale_out_cooldown = 60  # 1分
  }
}

# Step Scaling Policy - 高負荷時の緊急スケールアウト
resource "aws_autoscaling_policy" "scale_out_emergency" {
  name                   = "${var.project_name}-emergency-scale-out"
  autoscaling_group_name = aws_autoscaling_group.python_worker.name
  policy_type            = "StepScaling"
  adjustment_type        = "PercentChangeInCapacity"
  metric_aggregation_type = "Average"

  step_adjustment {
    scaling_adjustment          = 50 # 50%増加
    metric_interval_lower_bound = 0
    metric_interval_upper_bound = 500
  }

  step_adjustment {
    scaling_adjustment          = 100 # 100%増加 (倍増)
    metric_interval_lower_bound = 500
  }
}

# CloudWatch Alarm - 緊急スケールアウト用
resource "aws_cloudwatch_metric_alarm" "sqs_high_messages" {
  alarm_name          = "${var.project_name}-sqs-high-message-count"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Average"
  threshold           = var.sqs_high_message_threshold
  alarm_description   = "Trigger emergency scale-out when SQS messages exceed ${var.sqs_high_message_threshold}"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.file_processing.name
  }

  alarm_actions = [aws_autoscaling_policy.scale_out_emergency.arn]

  tags = var.common_tags
}

# CloudWatch Alarm - DLQメッセージ監視
resource "aws_cloudwatch_metric_alarm" "dlq_messages" {
  alarm_name          = "${var.project_name}-dlq-messages-alert"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Average"
  threshold           = 10
  alarm_description   = "Alert when DLQ accumulates messages"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.file_processing_dlq.name
  }

  alarm_actions = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []

  tags = var.common_tags
}

# Scheduled Scaling - 予測可能なトラフィックパターン (オプション)
resource "aws_autoscaling_schedule" "scale_up_morning" {
  count = var.enable_scheduled_scaling ? 1 : 0

  scheduled_action_name  = "${var.project_name}-scale-up-morning"
  autoscaling_group_name = aws_autoscaling_group.python_worker.name
  min_size               = var.asg_scheduled_min_size
  max_size               = var.asg_max_size
  desired_capacity       = var.asg_scheduled_desired_capacity
  recurrence             = "0 8 * * MON-FRI" # 平日8:00 (UTC)
}

resource "aws_autoscaling_schedule" "scale_down_evening" {
  count = var.enable_scheduled_scaling ? 1 : 0

  scheduled_action_name  = "${var.project_name}-scale-down-evening"
  autoscaling_group_name = aws_autoscaling_group.python_worker.name
  min_size               = var.asg_min_size
  max_size               = var.asg_max_size
  desired_capacity       = var.asg_desired_capacity
  recurrence             = "0 20 * * *" # 毎日20:00 (UTC)
}

# SNS Topic for Auto Scaling notifications (オプション)
resource "aws_sns_topic" "autoscaling_notifications" {
  count = var.enable_autoscaling_notifications ? 1 : 0

  name = "${var.project_name}-asg-notifications"

  tags = var.common_tags
}

resource "aws_autoscaling_notification" "notifications" {
  count = var.enable_autoscaling_notifications ? 1 : 0

  group_names = [aws_autoscaling_group.python_worker.name]

  notifications = [
    "autoscaling:EC2_INSTANCE_LAUNCH",
    "autoscaling:EC2_INSTANCE_TERMINATE",
    "autoscaling:EC2_INSTANCE_LAUNCH_ERROR",
    "autoscaling:EC2_INSTANCE_TERMINATE_ERROR",
  ]

  topic_arn = aws_sns_topic.autoscaling_notifications[0].arn
}
