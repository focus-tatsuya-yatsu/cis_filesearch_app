# ============================================================================
# OpenSearch Domain Configuration for CIS File Search
# ============================================================================

# ----------------------------------------------------------------------------
# OpenSearch Domain
# ----------------------------------------------------------------------------
resource "aws_opensearch_domain" "main" {
  domain_name    = "${var.project_name}-opensearch-${var.environment}"
  engine_version = "OpenSearch_2.11"

  cluster_config {
    instance_type            = var.opensearch_instance_type
    instance_count           = var.opensearch_instance_count
    zone_awareness_enabled   = var.opensearch_instance_count > 1
    dedicated_master_enabled = false

    dynamic "zone_awareness_config" {
      for_each = var.opensearch_instance_count > 1 ? [1] : []
      content {
        availability_zone_count = min(var.opensearch_instance_count, 2)
      }
    }
  }

  # VPC Configuration
  vpc_options {
    subnet_ids = var.opensearch_instance_count > 1 ? [
      aws_subnet.private[0].id,
      aws_subnet.private[1].id
    ] : [aws_subnet.private[0].id]

    security_group_ids = [aws_security_group.opensearch.id]
  }

  # EBS Configuration
  ebs_options {
    ebs_enabled = true
    volume_size = var.opensearch_volume_size
    volume_type = "gp3"
    iops        = 3000
    throughput  = 125
  }

  # Encryption at rest
  encrypt_at_rest {
    enabled = true
  }

  # Node-to-node encryption
  node_to_node_encryption {
    enabled = true
  }

  # Encryption in transit
  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-2019-07"
  }

  # Advanced security options (Fine-Grained Access Control)
  advanced_security_options {
    enabled                        = true
    internal_user_database_enabled = true
    master_user_options {
      master_user_name     = var.opensearch_master_user
      master_user_password = var.opensearch_master_password
    }
  }

  # Advanced options
  advanced_options = {
    "rest.action.multi.allow_explicit_index" = "true"
    "override_main_response_version"         = "false"
  }

  # Access policy - Allow access from Lambda and EC2 worker
  access_policies = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          AWS = "*"
        }
        Action   = "es:*"
        Resource = "arn:aws:es:${var.aws_region}:${data.aws_caller_identity.current.account_id}:domain/${var.project_name}-opensearch-${var.environment}/*"
        Condition = {
          IpAddress = {
            "aws:SourceIp" = [
              aws_vpc.main.cidr_block
            ]
          }
        }
      }
    ]
  })

  # Automated snapshot configuration
  snapshot_options {
    automated_snapshot_start_hour = 3 # 3 AM JST (UTC+9) = 18:00 UTC
  }

  # CloudWatch logging
  log_publishing_options {
    cloudwatch_log_group_arn = aws_cloudwatch_log_group.opensearch_application_logs.arn
    log_type                 = "ES_APPLICATION_LOGS"
    enabled                  = true
  }

  log_publishing_options {
    cloudwatch_log_group_arn = aws_cloudwatch_log_group.opensearch_index_slow_logs.arn
    log_type                 = "INDEX_SLOW_LOGS"
    enabled                  = true
  }

  log_publishing_options {
    cloudwatch_log_group_arn = aws_cloudwatch_log_group.opensearch_search_slow_logs.arn
    log_type                 = "SEARCH_SLOW_LOGS"
    enabled                  = true
  }

  tags = {
    Name        = "CIS OpenSearch Domain"
    Environment = var.environment
    ManagedBy   = "Terraform"
  }

  depends_on = [
    aws_iam_service_linked_role.opensearch
  ]
}

# ----------------------------------------------------------------------------
# IAM Service Linked Role for OpenSearch
# ----------------------------------------------------------------------------
resource "aws_iam_service_linked_role" "opensearch" {
  count            = var.create_opensearch_service_role ? 1 : 0
  aws_service_name = "es.amazonaws.com"
  description      = "Service linked role for OpenSearch"

  lifecycle {
    ignore_changes = [aws_service_name]
  }
}

# ----------------------------------------------------------------------------
# CloudWatch Log Groups for OpenSearch
# ----------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "opensearch_application_logs" {
  name              = "/aws/opensearch/${var.project_name}-${var.environment}/application-logs"
  retention_in_days = 7

  tags = {
    Name        = "OpenSearch Application Logs"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_log_group" "opensearch_index_slow_logs" {
  name              = "/aws/opensearch/${var.project_name}-${var.environment}/index-slow-logs"
  retention_in_days = 7

  tags = {
    Name        = "OpenSearch Index Slow Logs"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_log_group" "opensearch_search_slow_logs" {
  name              = "/aws/opensearch/${var.project_name}-${var.environment}/search-slow-logs"
  retention_in_days = 7

  tags = {
    Name        = "OpenSearch Search Slow Logs"
    Environment = var.environment
  }
}

# ----------------------------------------------------------------------------
# CloudWatch Log Resource Policy for OpenSearch
# ----------------------------------------------------------------------------
resource "aws_cloudwatch_log_resource_policy" "opensearch" {
  policy_name = "${var.project_name}-opensearch-logs-${var.environment}"

  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "es.amazonaws.com"
        }
        Action = [
          "logs:PutLogEvents",
          "logs:CreateLogStream"
        ]
        Resource = [
          "${aws_cloudwatch_log_group.opensearch_application_logs.arn}:*",
          "${aws_cloudwatch_log_group.opensearch_index_slow_logs.arn}:*",
          "${aws_cloudwatch_log_group.opensearch_search_slow_logs.arn}:*"
        ]
      }
    ]
  })
}

# ----------------------------------------------------------------------------
# Data Source for Current AWS Account
# NOTE: aws_caller_identity is defined in main.tf - removed duplicate here
# ----------------------------------------------------------------------------
# data "aws_caller_identity" "current" {}  # REMOVED: Duplicate - defined in main.tf

# ----------------------------------------------------------------------------
# Outputs
# ----------------------------------------------------------------------------
output "opensearch_domain_id" {
  description = "OpenSearch domain ID"
  value       = aws_opensearch_domain.main.domain_id
}

output "opensearch_arn" {
  description = "OpenSearch domain ARN"
  value       = aws_opensearch_domain.main.arn
}

output "opensearch_vpc_endpoint" {
  description = "OpenSearch VPC endpoint (for internal access)"
  value       = aws_opensearch_domain.main.endpoint
  sensitive   = true
}

output "opensearch_kibana_endpoint" {
  description = "OpenSearch Dashboards endpoint"
  value       = "https://${aws_opensearch_domain.main.endpoint}/_dashboards"
  sensitive   = true
}
