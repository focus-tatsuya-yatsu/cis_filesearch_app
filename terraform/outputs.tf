# Outputs for CIS File Search Application

output "vpn_connection_id" {
  description = "VPN Connection ID"
  value       = aws_vpn_connection.main.id
}

output "customer_gateway_id" {
  description = "Customer Gateway ID"
  value       = aws_customer_gateway.onprem.id
}

output "vpn_gateway_id" {
  description = "VPN Gateway ID"
  value       = aws_vpn_gateway.main.id
}

output "datasync_task_arn" {
  description = "DataSync Task ARN"
  value       = aws_datasync_task.nas_to_s3.arn
}

output "s3_bucket_name" {
  description = "S3 bucket name for file metadata"
  value       = aws_s3_bucket.metadata.id
}

output "opensearch_endpoint" {
  description = "OpenSearch domain endpoint"
  value       = aws_opensearch_domain.main.endpoint
}

output "opensearch_dashboard_endpoint" {
  description = "OpenSearch Dashboards endpoint"
  value       = "https://${aws_opensearch_domain.main.endpoint}/_dashboards"
}

output "step_functions_state_machine_arn" {
  description = "Step Functions State Machine ARN"
  value       = aws_sfn_state_machine.monthly_batch.arn
}

output "lambda_vpn_manager_arn" {
  description = "VPNManager Lambda function ARN"
  value       = aws_lambda_function.vpn_manager.arn
}

output "lambda_file_scanner_arn" {
  description = "FileScanner Lambda function ARN"
  value       = aws_lambda_function.file_scanner.arn
}

output "lambda_text_extractor_arn" {
  description = "TextExtractor Lambda function ARN"
  value       = aws_lambda_function.text_extractor.arn
}

output "lambda_image_feature_extractor_arn" {
  description = "ImageFeatureExtractor Lambda function ARN"
  value       = aws_lambda_function.image_feature_extractor.arn
}

output "lambda_bulk_indexer_arn" {
  description = "BulkIndexer Lambda function ARN"
  value       = aws_lambda_function.bulk_indexer.arn
}

output "dynamodb_file_metadata_table_name" {
  description = "DynamoDB file metadata table name"
  value       = aws_dynamodb_table.file_metadata.name
}

output "dynamodb_sync_jobs_table_name" {
  description = "DynamoDB sync jobs table name"
  value       = aws_dynamodb_table.sync_jobs.name
}

output "sns_topic_arn" {
  description = "SNS topic ARN for notifications"
  value       = aws_sns_topic.batch_notifications.arn
}

output "eventbridge_rule_name" {
  description = "EventBridge rule name for monthly trigger"
  value       = aws_cloudwatch_event_rule.monthly_batch.name
}

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = aws_subnet.private[*].id
}
