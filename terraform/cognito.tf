# ============================================================================
# AWS Cognito User Pool Configuration
# Pattern 3: User Authentication and Authorization
# ============================================================================

# ----------------------------------------------------------------------------
# IAM Role for Cognito SMS (MFA)
# ----------------------------------------------------------------------------
resource "aws_iam_role" "cognito_sms" {
  name = "${var.project_name}-cognito-sms-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "cognito-idp.amazonaws.com"
        }
        Action = "sts:AssumeRole"
        Condition = {
          StringEquals = {
            "sts:ExternalId" = "${var.project_name}-cognito-external"
          }
        }
      }
    ]
  })

  tags = {
    Name        = "CIS FileSearch Cognito SMS Role"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy" "cognito_sms" {
  name = "${var.project_name}-cognito-sms-policy"
  role = aws_iam_role.cognito_sms.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sns:Publish"
        ]
        Resource = "*"
      }
    ]
  })
}

# ----------------------------------------------------------------------------
# Cognito User Pool
# ----------------------------------------------------------------------------
resource "aws_cognito_user_pool" "main" {
  name = "${var.project_name}-user-pool"

  # Username/Email Configuration
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Password Policy
  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  # MFA Configuration
  mfa_configuration = var.cognito_mfa_enabled ? "OPTIONAL" : "OFF"

  dynamic "software_token_mfa_configuration" {
    for_each = var.cognito_mfa_enabled ? [1] : []
    content {
      enabled = true
    }
  }

  dynamic "sms_configuration" {
    for_each = var.cognito_mfa_enabled ? [1] : []
    content {
      external_id    = "${var.project_name}-cognito-external"
      sns_caller_arn = aws_iam_role.cognito_sms.arn
      sns_region     = var.aws_region
    }
  }

  # Account Recovery
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # User Attribute Schema
  schema {
    name                = "email"
    attribute_data_type = "String"
    mutable             = true
    required            = true

    string_attribute_constraints {
      min_length = 5
      max_length = 255
    }
  }

  schema {
    name                = "name"
    attribute_data_type = "String"
    mutable             = true
    required            = true

    string_attribute_constraints {
      min_length = 1
      max_length = 100
    }
  }

  # Custom Attributes
  schema {
    name                = "department"
    attribute_data_type = "String"
    mutable             = true
    required            = false

    string_attribute_constraints {
      min_length = 1
      max_length = 100
    }
  }

  schema {
    name                = "position"
    attribute_data_type = "String"
    mutable             = true
    required            = false

    string_attribute_constraints {
      min_length = 1
      max_length = 100
    }
  }

  # Email Configuration (SES)
  email_configuration {
    email_sending_account = var.cognito_use_ses ? "DEVELOPER" : "COGNITO_DEFAULT"
    source_arn            = var.cognito_use_ses ? aws_ses_email_identity.noreply[0].arn : null
    from_email_address    = var.cognito_use_ses ? "noreply@${var.route53_zone_name}" : null
  }

  # Lambda Triggers (Optional)
  # lambda_config {
  #   pre_sign_up         = aws_lambda_function.cognito_pre_signup.arn
  #   post_confirmation   = aws_lambda_function.cognito_post_confirmation.arn
  #   pre_authentication  = aws_lambda_function.cognito_pre_auth.arn
  #   post_authentication = aws_lambda_function.cognito_post_auth.arn
  # }

  # User Pool Deletion Protection
  deletion_protection = var.environment == "prod" ? "ACTIVE" : "INACTIVE"

  # Username Case Sensitivity
  username_configuration {
    case_sensitive = false
  }

  # User Verification Message Template
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "CIS FileSearch - メール確認コード"
    email_message        = "CIS FileSearchへようこそ。確認コード: {####}"
  }

  # Admin Create User Configuration
  admin_create_user_config {
    allow_admin_create_user_only = var.cognito_admin_only_user_creation

    invite_message_template {
      email_subject = "CIS FileSearch - 仮パスワード"
      email_message = "ユーザー名: {username}\n仮パスワード: {####}\n\nログイン後、パスワードを変更してください。"
      sms_message   = "ユーザー名: {username}, 仮パスワード: {####}"
    }
  }

  # Device Tracking
  device_configuration {
    challenge_required_on_new_device      = false
    device_only_remembered_on_user_prompt = true
  }

  tags = {
    Name        = "CIS FileSearch User Pool"
    Environment = var.environment
  }
}

# ----------------------------------------------------------------------------
# SES Email Identity (Optional)
# ----------------------------------------------------------------------------
resource "aws_ses_email_identity" "noreply" {
  count = var.cognito_use_ses ? 1 : 0
  email = "noreply@${var.route53_zone_name}"
}

# ----------------------------------------------------------------------------
# Cognito User Pool Domain
# ----------------------------------------------------------------------------
resource "aws_cognito_user_pool_domain" "main" {
  domain       = "${var.project_name}-auth-${var.environment}"
  user_pool_id = aws_cognito_user_pool.main.id
}

# ----------------------------------------------------------------------------
# Cognito User Pool Client (Web App)
# ----------------------------------------------------------------------------
resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.project_name}-web-client"
  user_pool_id = aws_cognito_user_pool.main.id

  # OAuth Configuration
  generate_secret                      = false # SPA does not need client secret
  refresh_token_validity               = 30    # 30 days
  access_token_validity                = 60    # 60 minutes
  id_token_validity                    = 60    # 60 minutes
  enable_token_revocation              = true
  prevent_user_existence_errors        = "ENABLED"

  token_validity_units {
    refresh_token = "days"
    access_token  = "minutes"
    id_token      = "minutes"
  }

  # OAuth 2.0 Flows
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"] # Authorization Code Grant with PKCE
  allowed_oauth_scopes = [
    "openid",
    "email",
    "profile",
    "aws.cognito.signin.user.admin"
  ]

  # Callback URLs
  callback_urls = concat(
    ["https://${var.frontend_domain}/callback"],
    var.environment != "prod" ? ["http://localhost:3000/callback"] : []
  )

  # Logout URLs
  logout_urls = concat(
    ["https://${var.frontend_domain}/login"],
    var.environment != "prod" ? ["http://localhost:3000/login"] : []
  )

  # Supported Identity Providers
  supported_identity_providers = ["COGNITO"]

  # Explicit Auth Flows
  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_USER_PASSWORD_AUTH"
  ]

  # Attribute Read/Write Permissions
  read_attributes = [
    "email",
    "email_verified",
    "name",
    "custom:department",
    "custom:position"
  ]

  write_attributes = [
    "name",
    "custom:department",
    "custom:position"
  ]
}

# ----------------------------------------------------------------------------
# Cognito Identity Pool (for AWS Resource Access - Optional)
# ----------------------------------------------------------------------------
resource "aws_cognito_identity_pool" "main" {
  identity_pool_name               = "${replace(var.project_name, "-", "_")}_identity_pool"
  allow_unauthenticated_identities = false

  cognito_identity_providers {
    client_id               = aws_cognito_user_pool_client.web.id
    provider_name           = aws_cognito_user_pool.main.endpoint
    server_side_token_check = true
  }

  tags = {
    Name        = "CIS FileSearch Identity Pool"
    Environment = var.environment
  }
}

# ----------------------------------------------------------------------------
# IAM Role for Authenticated Users
# ----------------------------------------------------------------------------
resource "aws_iam_role" "cognito_authenticated" {
  name = "${var.project_name}-cognito-authenticated-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = "cognito-identity.amazonaws.com"
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "cognito-identity.amazonaws.com:aud" = aws_cognito_identity_pool.main.id
          }
          "ForAnyValue:StringLike" = {
            "cognito-identity.amazonaws.com:amr" = "authenticated"
          }
        }
      }
    ]
  })

  tags = {
    Name        = "CIS FileSearch Cognito Authenticated Role"
    Environment = var.environment
  }
}

resource "aws_iam_role_policy" "cognito_authenticated" {
  name = "${var.project_name}-cognito-authenticated-policy"
  role = aws_iam_role.cognito_authenticated.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "cognito-identity:GetCredentialsForIdentity"
        ]
        Resource = "*"
      }
    ]
  })
}

# ----------------------------------------------------------------------------
# Identity Pool Role Attachment
# ----------------------------------------------------------------------------
resource "aws_cognito_identity_pool_roles_attachment" "main" {
  identity_pool_id = aws_cognito_identity_pool.main.id

  roles = {
    authenticated = aws_iam_role.cognito_authenticated.arn
  }
}

# ----------------------------------------------------------------------------
# CloudWatch Alarms
# ----------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "cognito_auth_failures" {
  alarm_name          = "${var.project_name}-cognito-auth-failures"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "UserAuthenticationFailures"
  namespace           = "AWS/Cognito"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "Cognito authentication failures > 10 in 5 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    UserPool = aws_cognito_user_pool.main.id
  }

  tags = {
    Name        = "CIS FileSearch Cognito Auth Failures"
    Environment = var.environment
  }
}

# ----------------------------------------------------------------------------
# Outputs
# ----------------------------------------------------------------------------
output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.main.id
}

output "cognito_user_pool_arn" {
  description = "Cognito User Pool ARN"
  value       = aws_cognito_user_pool.main.arn
}

output "cognito_user_pool_endpoint" {
  description = "Cognito User Pool endpoint"
  value       = aws_cognito_user_pool.main.endpoint
}

output "cognito_user_pool_client_id" {
  description = "Cognito User Pool Client ID"
  value       = aws_cognito_user_pool_client.web.id
  sensitive   = true
}

output "cognito_user_pool_domain" {
  description = "Cognito User Pool domain"
  value       = aws_cognito_user_pool_domain.main.domain
}

output "cognito_hosted_ui_url" {
  description = "Cognito Hosted UI URL"
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com"
}

output "cognito_identity_pool_id" {
  description = "Cognito Identity Pool ID"
  value       = aws_cognito_identity_pool.main.id
}
