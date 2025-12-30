# terraform/outputs.tf
# Output values for Python Worker infrastructure

output "launch_template_id" {
  description = "ID of the Launch Template"
  value       = aws_launch_template.python_worker.id
}

output "launch_template_latest_version" {
  description = "Latest version of the Launch Template"
  value       = aws_launch_template.python_worker.latest_version
}

output "autoscaling_group_name" {
  description = "Name of the Auto Scaling Group"
  value       = aws_autoscaling_group.python_worker.name
}

output "autoscaling_group_arn" {
  description = "ARN of the Auto Scaling Group"
  value       = aws_autoscaling_group.python_worker.arn
}

output "worker_iam_role_arn" {
  description = "ARN of the Worker IAM role"
  value       = aws_iam_role.worker_role.arn
}

output "worker_iam_role_name" {
  description = "Name of the Worker IAM role"
  value       = aws_iam_role.worker_role.name
}

output "worker_security_group_id" {
  description = "ID of the Worker security group"
  value       = aws_security_group.worker_sg.id
}

output "cloudwatch_log_group_name" {
  description = "Name of the CloudWatch Log Group"
  value       = aws_cloudwatch_log_group.worker.name
}

output "sqs_queue_url" {
  description = "URL of the SQS queue"
  value       = aws_sqs_queue.file_processing.url
}

output "sqs_queue_arn" {
  description = "ARN of the SQS queue"
  value       = aws_sqs_queue.file_processing.arn
}

output "sqs_dlq_url" {
  description = "URL of the SQS Dead Letter Queue"
  value       = aws_sqs_queue.file_processing_dlq.url
}

output "sqs_dlq_arn" {
  description = "ARN of the SQS Dead Letter Queue"
  value       = aws_sqs_queue.file_processing_dlq.arn
}

output "scaling_policy_arn" {
  description = "ARN of the Target Tracking Scaling Policy"
  value       = aws_autoscaling_policy.sqs_target_tracking.arn
}

# Deployment information
output "deployment_info" {
  description = "Information for deploying new AMI versions"
  value = {
    launch_template_name = aws_launch_template.python_worker.name
    asg_name             = aws_autoscaling_group.python_worker.name
    current_ami_id       = var.ami_id
    deployment_command   = "bash scripts/deploy-new-ami.sh <NEW_AMI_ID>"
  }
}

# Debugging information
output "debug_info" {
  description = "Information for debugging worker instances"
  value = {
    log_group       = aws_cloudwatch_log_group.worker.name
    security_group  = aws_security_group.worker_sg.id
    iam_role        = aws_iam_role.worker_role.name
    debug_command   = "bash scripts/debug-worker.sh"
    view_logs       = "aws logs tail ${aws_cloudwatch_log_group.worker.name} --follow"
  }
}
