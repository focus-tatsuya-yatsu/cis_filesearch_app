# S3 Configuration for File Metadata Storage

# S3 Bucket for File Metadata
resource "aws_s3_bucket" "metadata" {
  bucket = "${var.project_name}-metadata-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name        = "${var.project_name}-metadata"
    Description = "File metadata, extracted text, and image features"
  }
}

# S3 Bucket Versioning
resource "aws_s3_bucket_versioning" "metadata" {
  bucket = aws_s3_bucket.metadata.id

  versioning_configuration {
    status = "Enabled"
  }
}

# S3 Bucket Encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "metadata" {
  bucket = aws_s3_bucket.metadata.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# S3 Bucket Public Access Block
resource "aws_s3_bucket_public_access_block" "metadata" {
  bucket = aws_s3_bucket.metadata.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# S3 Intelligent-Tiering Configuration
resource "aws_s3_bucket_intelligent_tiering_configuration" "metadata" {
  bucket = aws_s3_bucket.metadata.id
  name   = "EntireBucket"

  tiering {
    access_tier = "DEEP_ARCHIVE_ACCESS"
    days        = 180
  }

  tiering {
    access_tier = "ARCHIVE_ACCESS"
    days        = 90
  }
}

# S3 Lifecycle Policy
resource "aws_s3_bucket_lifecycle_configuration" "metadata" {
  bucket = aws_s3_bucket.metadata.id

  rule {
    id     = "delete-old-logs"
    status = "Enabled"

    filter {
      prefix = "logs/"
    }

    expiration {
      days = 90
    }
  }

  rule {
    id     = "intelligent-tiering"
    status = "Enabled"

    transition {
      days          = 30
      storage_class = "INTELLIGENT_TIERING"
    }
  }
}

# S3 Bucket Policy for DataSync
resource "aws_s3_bucket_policy" "metadata" {
  bucket = aws_s3_bucket.metadata.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowDataSyncAccess"
        Effect = "Allow"
        Principal = {
          Service = "datasync.amazonaws.com"
        }
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:GetObjectVersion",
          "s3:ListBucket",
          "s3:GetBucketLocation"
        ]
        Resource = [
          aws_s3_bucket.metadata.arn,
          "${aws_s3_bucket.metadata.arn}/*"
        ]
      },
      {
        Sid    = "AllowLambdaAccess"
        Effect = "Allow"
        Principal = {
          AWS = aws_iam_role.lambda_execution.arn
        }
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.metadata.arn,
          "${aws_s3_bucket.metadata.arn}/*"
        ]
      }
    ]
  })
}

# S3 Bucket Notification (for triggering Lambda on new files)
resource "aws_s3_bucket_notification" "metadata" {
  bucket = aws_s3_bucket.metadata.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.file_scanner.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "files/"
  }

  depends_on = [aws_lambda_permission.allow_s3_invoke_file_scanner]
}
