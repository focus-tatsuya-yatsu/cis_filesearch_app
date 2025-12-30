# terraform/variables.tf
# Variable definitions for Python Worker infrastructure

# Project Configuration
variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "cis-filesearch"
}

variable "environment" {
  description = "Environment name (dev, staging, production)"
  type        = string
  default     = "production"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-northeast-1"
}

# Network Configuration
variable "vpc_id" {
  description = "VPC ID where resources will be created"
  type        = string
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs for Auto Scaling Group"
  type        = list(string)
}

variable "allow_ssh_from" {
  description = "CIDR blocks allowed to SSH to worker instances"
  type        = list(string)
  default     = []
}

# AMI and Instance Configuration
variable "ami_id" {
  description = "AMI ID for Python Worker (must be pre-built with application code)"
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type for workers"
  type        = string
  default     = "c5.xlarge"
}

variable "key_pair_name" {
  description = "EC2 key pair name for SSH access"
  type        = string
  default     = ""
}

variable "ebs_kms_key_arn" {
  description = "KMS key ARN for EBS encryption"
  type        = string
  default     = ""
}

# Auto Scaling Configuration
variable "asg_min_size" {
  description = "Minimum number of worker instances"
  type        = number
  default     = 1
}

variable "asg_max_size" {
  description = "Maximum number of worker instances"
  type        = number
  default     = 10
}

variable "asg_desired_capacity" {
  description = "Desired number of worker instances"
  type        = number
  default     = 2
}

variable "sqs_target_messages_per_instance" {
  description = "Target number of SQS messages per instance for auto scaling"
  type        = number
  default     = 100
}

variable "sqs_high_message_threshold" {
  description = "SQS message count threshold for emergency scale-out"
  type        = number
  default     = 500
}

# Scheduled Scaling (Optional)
variable "enable_scheduled_scaling" {
  description = "Enable scheduled scaling for predictable traffic patterns"
  type        = bool
  default     = false
}

variable "asg_scheduled_min_size" {
  description = "Minimum instances during scheduled scale-up"
  type        = number
  default     = 3
}

variable "asg_scheduled_desired_capacity" {
  description = "Desired instances during scheduled scale-up"
  type        = number
  default     = 5
}

# Application Configuration
variable "s3_bucket" {
  description = "S3 bucket name for file storage"
  type        = string
}

variable "opensearch_endpoint" {
  description = "OpenSearch domain endpoint URL"
  type        = string
}

variable "opensearch_domain_arn" {
  description = "OpenSearch domain ARN for IAM permissions"
  type        = string
}

variable "opensearch_index" {
  description = "OpenSearch index name"
  type        = string
  default     = "file-index"
}

variable "log_level" {
  description = "Application log level (DEBUG, INFO, WARNING, ERROR)"
  type        = string
  default     = "INFO"
}

# Monitoring Configuration
variable "log_retention_days" {
  description = "CloudWatch Logs retention in days"
  type        = number
  default     = 30
}

variable "enable_autoscaling_notifications" {
  description = "Enable Auto Scaling event notifications via SNS"
  type        = bool
  default     = true
}

variable "alarm_sns_topic_arn" {
  description = "SNS topic ARN for CloudWatch alarms"
  type        = string
  default     = ""
}

# Tags
variable "common_tags" {
  description = "Common tags to apply to all resources"
  type        = map(string)
  default = {
    Project   = "CIS File Search"
    ManagedBy = "Terraform"
  }
}
