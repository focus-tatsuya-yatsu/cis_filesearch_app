# ============================================================================
# CloudFront Distribution Configuration
# Pattern 3: CDN for S3 Static Frontend with Custom Domain
# ============================================================================

# ----------------------------------------------------------------------------
# CloudFront Origin Access Control (OAC)
# ----------------------------------------------------------------------------
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.project_name}-frontend-oac"
  description                       = "Origin Access Control for S3 frontend bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ----------------------------------------------------------------------------
# CloudFront Distribution
# ----------------------------------------------------------------------------
resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "CIS FileSearch Frontend Distribution"
  default_root_object = "index.html"
  price_class         = "PriceClass_200" # Asia, Europe, North America
  aliases             = [var.frontend_domain]

  # Origin: S3 Frontend Bucket
  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "S3-${var.project_name}-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  # Default Cache Behavior (Static Assets)
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${var.project_name}-frontend"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    min_ttl     = 0
    default_ttl = 86400    # 24 hours
    max_ttl     = 31536000 # 1 year

    forwarded_values {
      query_string = false
      headers      = []

      cookies {
        forward = "none"
      }
    }
  }

  # Cache Behavior: HTML/JSON Files (Short TTL)
  ordered_cache_behavior {
    path_pattern           = "*.html"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${var.project_name}-frontend"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    min_ttl     = 0
    default_ttl = 300  # 5 minutes
    max_ttl     = 3600 # 1 hour

    forwarded_values {
      query_string = false
      headers      = []

      cookies {
        forward = "none"
      }
    }
  }

  # Cache Behavior: Next.js Static Assets (Long TTL)
  ordered_cache_behavior {
    path_pattern           = "_next/static/*"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${var.project_name}-frontend"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    min_ttl     = 31536000 # 1 year
    default_ttl = 31536000 # 1 year
    max_ttl     = 31536000 # 1 year

    forwarded_values {
      query_string = false
      headers      = []

      cookies {
        forward = "none"
      }
    }
  }

  # Cache Behavior: JSON Files (Short TTL)
  ordered_cache_behavior {
    path_pattern           = "*.json"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-${var.project_name}-frontend"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    min_ttl     = 0
    default_ttl = 300  # 5 minutes
    max_ttl     = 3600 # 1 hour

    forwarded_values {
      query_string = false
      headers      = []

      cookies {
        forward = "none"
      }
    }
  }

  # Custom Error Response: SPA Routing Support
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  # SSL/TLS Certificate Configuration
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.frontend.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.3_2021"
  }

  # Geo Restriction: None (Global Access)
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Access Logging Configuration
  logging_config {
    include_cookies = false
    bucket          = aws_s3_bucket.cloudfront_logs.bucket_domain_name
    prefix          = "cloudfront/"
  }

  # WAF Web ACL (Optional)
  # web_acl_id = var.enable_waf ? aws_wafv2_web_acl.cloudfront[0].arn : null

  tags = {
    Name        = "CIS FileSearch CloudFront"
    Environment = var.environment
  }
}

# ----------------------------------------------------------------------------
# ACM Certificate (us-east-1 region required for CloudFront)
# ----------------------------------------------------------------------------
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "CIS-FileSearch"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

resource "aws_acm_certificate" "frontend" {
  provider          = aws.us_east_1
  domain_name       = var.frontend_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name        = "CIS FileSearch Frontend Certificate"
    Environment = var.environment
  }
}

# DNS Validation Record
resource "aws_route53_record" "frontend_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.frontend.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.main.zone_id
}

# Certificate Validation
resource "aws_acm_certificate_validation" "frontend" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.frontend.arn
  validation_record_fqdns = [for record in aws_route53_record.frontend_cert_validation : record.fqdn]
}

# ----------------------------------------------------------------------------
# Route53 DNS Record (A Record Alias)
# ----------------------------------------------------------------------------
data "aws_route53_zone" "main" {
  name         = var.route53_zone_name
  private_zone = false
}

resource "aws_route53_record" "frontend" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.frontend_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}

# ----------------------------------------------------------------------------
# CloudWatch Alarms
# ----------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "cloudfront_error_rate" {
  alarm_name          = "${var.project_name}-cloudfront-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "5xxErrorRate"
  namespace           = "AWS/CloudFront"
  period              = 300
  statistic           = "Average"
  threshold           = 5
  alarm_description   = "CloudFront 5xx error rate > 5%"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    DistributionId = aws_cloudfront_distribution.frontend.id
  }

  tags = {
    Name        = "CIS FileSearch CloudFront Error Rate"
    Environment = var.environment
  }
}

resource "aws_cloudwatch_metric_alarm" "cloudfront_cache_hit_rate" {
  alarm_name          = "${var.project_name}-cloudfront-cache-hit-rate"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CacheHitRate"
  namespace           = "AWS/CloudFront"
  period              = 300
  statistic           = "Average"
  threshold           = 70
  alarm_description   = "CloudFront cache hit rate < 70%"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    DistributionId = aws_cloudfront_distribution.frontend.id
  }

  tags = {
    Name        = "CIS FileSearch CloudFront Cache Hit Rate"
    Environment = var.environment
  }
}

# ----------------------------------------------------------------------------
# SNS Topic for Alerts
# ----------------------------------------------------------------------------
resource "aws_sns_topic" "alerts" {
  name = "${var.project_name}-alerts-${var.environment}"

  tags = {
    Name        = "CIS FileSearch Alerts"
    Environment = var.environment
  }
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.admin_email
}

# ----------------------------------------------------------------------------
# Outputs
# ----------------------------------------------------------------------------
output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID"
  value       = aws_cloudfront_distribution.frontend.id
}

output "cloudfront_distribution_arn" {
  description = "CloudFront distribution ARN"
  value       = aws_cloudfront_distribution.frontend.arn
}

output "cloudfront_domain_name" {
  description = "CloudFront domain name"
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "frontend_url" {
  description = "Frontend URL"
  value       = "https://${var.frontend_domain}"
}

output "acm_certificate_arn" {
  description = "ACM certificate ARN"
  value       = aws_acm_certificate.frontend.arn
}
