# Variables for CIS File Search Application

variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "ap-northeast-1"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "prod"
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "cis-filesearch"
}

# VPN Configuration
variable "customer_gateway_ip" {
  description = "On-premise VPN router IP address"
  type        = string
  sensitive   = true
}

variable "customer_gateway_bgp_asn" {
  description = "BGP ASN for customer gateway"
  type        = number
  default     = 65000
}

# NAS Configuration
variable "nas_smb_server" {
  description = "NAS SMB server address"
  type        = string
  sensitive   = true
}

variable "nas_smb_domain" {
  description = "NAS SMB domain"
  type        = string
  default     = "WORKGROUP"
}

variable "nas_smb_username" {
  description = "NAS SMB username"
  type        = string
  sensitive   = true
}

variable "nas_smb_password" {
  description = "NAS SMB password"
  type        = string
  sensitive   = true
}

variable "nas_smb_subdirectory" {
  description = "NAS SMB subdirectory path"
  type        = string
  default     = "/files"
}

# DataSync Configuration
variable "datasync_bandwidth_limit" {
  description = "DataSync bandwidth limit in Mbps"
  type        = number
  default     = 100
}

# OpenSearch Configuration
variable "opensearch_instance_type" {
  description = "OpenSearch instance type"
  type        = string
  default     = "t3.small.search"
}

variable "opensearch_instance_count" {
  description = "Number of OpenSearch instances"
  type        = number
  default     = 1
}

variable "opensearch_volume_size" {
  description = "OpenSearch EBS volume size in GB"
  type        = number
  default     = 50
}

variable "opensearch_ebs_volume_size" {
  description = "OpenSearch EBS volume size in GB (deprecated, use opensearch_volume_size)"
  type        = number
  default     = 50
}

variable "opensearch_master_user" {
  description = "OpenSearch master username for fine-grained access control"
  type        = string
  default     = "admin"
  sensitive   = true
}

variable "opensearch_master_password" {
  description = "OpenSearch master password for fine-grained access control"
  type        = string
  sensitive   = true
}

variable "create_opensearch_service_role" {
  description = "Whether to create OpenSearch service linked role (set to false if it already exists)"
  type        = bool
  default     = false
}

# Lambda Configuration
variable "lambda_runtime_nodejs" {
  description = "Node.js runtime for Lambda functions"
  type        = string
  default     = "nodejs20.x"
}

variable "lambda_runtime_python" {
  description = "Python runtime for Lambda functions"
  type        = string
  default     = "python3.11"
}

variable "lambda_architecture" {
  description = "Lambda function architecture (arm64 for Graviton2)"
  type        = string
  default     = "arm64"
}

# EventBridge Schedule
variable "batch_schedule" {
  description = "EventBridge cron schedule for monthly batch"
  type        = string
  default     = "cron(0 2 1 * ? *)" # 毎月1日 深夜2時
}

# Notification
variable "admin_email" {
  description = "Admin email for notifications"
  type        = string
}

# Frontend Configuration
variable "frontend_domain" {
  description = "Frontend custom domain (e.g., filesearch.company.com)"
  type        = string
}

variable "route53_zone_name" {
  description = "Route53 hosted zone name (e.g., company.com)"
  type        = string
}

# Cognito Configuration
variable "cognito_mfa_enabled" {
  description = "Enable MFA for Cognito User Pool"
  type        = bool
  default     = false
}

variable "cognito_use_ses" {
  description = "Use SES for Cognito email sending"
  type        = bool
  default     = false
}

variable "cognito_admin_only_user_creation" {
  description = "Only allow admin to create users"
  type        = bool
  default     = true
}

# WAF Configuration
variable "enable_waf" {
  description = "Enable WAF for CloudFront"
  type        = bool
  default     = false
}

# Tags
variable "tags" {
  description = "Additional tags for resources"
  type        = map(string)
  default     = {}
}
