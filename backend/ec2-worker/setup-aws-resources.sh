#!/bin/bash

# AWS Resources Setup Script for CIS File Search Application
# Account: 770923989980
# Region: ap-northeast-1

set -e  # Exit on error

ACCOUNT_ID="770923989980"
REGION="ap-northeast-1"

echo "============================================"
echo "AWS Resource Setup for CIS File Search"
echo "Account: $ACCOUNT_ID"
echo "Region: $REGION"
echo "============================================"
echo ""

# 1. Create S3 Buckets
echo "📦 Creating S3 Buckets..."

# Landing bucket
echo "Creating cis-landing-bucket-$ACCOUNT_ID..."
aws s3api create-bucket \
    --bucket "cis-landing-bucket-$ACCOUNT_ID" \
    --region $REGION \
    --create-bucket-configuration LocationConstraint=$REGION \
    2>/dev/null || echo "Bucket already exists or error occurred"

# Enable versioning
aws s3api put-bucket-versioning \
    --bucket "cis-landing-bucket-$ACCOUNT_ID" \
    --versioning-configuration Status=Enabled

# Enable encryption
aws s3api put-bucket-encryption \
    --bucket "cis-landing-bucket-$ACCOUNT_ID" \
    --server-side-encryption-configuration '{
        "Rules": [{
            "ApplyServerSideEncryptionByDefault": {
                "SSEAlgorithm": "AES256"
            }
        }]
    }'

# Enable EventBridge
aws s3api put-bucket-notification-configuration \
    --bucket "cis-landing-bucket-$ACCOUNT_ID" \
    --notification-configuration '{
        "EventBridgeConfiguration": {}
    }'

echo "✅ Landing bucket created"

# Thumbnail bucket
echo "Creating cis-thumbnail-bucket-$ACCOUNT_ID..."
aws s3api create-bucket \
    --bucket "cis-thumbnail-bucket-$ACCOUNT_ID" \
    --region $REGION \
    --create-bucket-configuration LocationConstraint=$REGION \
    2>/dev/null || echo "Bucket already exists or error occurred"

# Enable versioning
aws s3api put-bucket-versioning \
    --bucket "cis-thumbnail-bucket-$ACCOUNT_ID" \
    --versioning-configuration Status=Enabled

# Enable encryption
aws s3api put-bucket-encryption \
    --bucket "cis-thumbnail-bucket-$ACCOUNT_ID" \
    --server-side-encryption-configuration '{
        "Rules": [{
            "ApplyServerSideEncryptionByDefault": {
                "SSEAlgorithm": "AES256"
            }
        }]
    }'

echo "✅ Thumbnail bucket created"
echo ""

# 2. Create SQS Queue
echo "📨 Creating SQS Queues..."

# Create DLQ first
echo "Creating Dead Letter Queue..."
DLQ_URL=$(aws sqs create-queue \
    --queue-name cis-file-processing-dlq \
    --attributes '{
        "MessageRetentionPeriod": "1209600",
        "VisibilityTimeout": "300"
    }' \
    --query 'QueueUrl' \
    --output text)

DLQ_ARN=$(aws sqs get-queue-attributes \
    --queue-url "$DLQ_URL" \
    --attribute-names QueueArn \
    --query 'Attributes.QueueArn' \
    --output text)

echo "✅ DLQ created: $DLQ_URL"

# Create main queue
echo "Creating main processing queue..."
QUEUE_URL=$(aws sqs create-queue \
    --queue-name cis-file-processing-queue \
    --attributes '{
        "MessageRetentionPeriod": "1209600",
        "VisibilityTimeout": "300",
        "RedrivePolicy": "{\"deadLetterTargetArn\":\"'$DLQ_ARN'\",\"maxReceiveCount\":3}"
    }' \
    --query 'QueueUrl' \
    --output text)

QUEUE_ARN=$(aws sqs get-queue-attributes \
    --queue-url "$QUEUE_URL" \
    --attribute-names QueueArn \
    --query 'Attributes.QueueArn' \
    --output text)

echo "✅ Main queue created: $QUEUE_URL"
echo ""

# 3. Create IAM Role
echo "🔐 Creating IAM Role..."

# Create trust policy
cat > trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create role
aws iam create-role \
    --role-name CIS-EC2-FileProcessor-Role \
    --assume-role-policy-document file://trust-policy.json \
    2>/dev/null || echo "Role already exists"

# Attach policies
echo "Attaching policies..."
aws iam attach-role-policy \
    --role-name CIS-EC2-FileProcessor-Role \
    --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess

aws iam attach-role-policy \
    --role-name CIS-EC2-FileProcessor-Role \
    --policy-arn arn:aws:iam::aws:policy/AmazonSQSFullAccess

aws iam attach-role-policy \
    --role-name CIS-EC2-FileProcessor-Role \
    --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess

aws iam attach-role-policy \
    --role-name CIS-EC2-FileProcessor-Role \
    --policy-arn arn:aws:iam::aws:policy/AmazonBedrockFullAccess

# Create instance profile
aws iam create-instance-profile \
    --instance-profile-name CIS-EC2-FileProcessor-Profile \
    2>/dev/null || echo "Instance profile already exists"

aws iam add-role-to-instance-profile \
    --instance-profile-name CIS-EC2-FileProcessor-Profile \
    --role-name CIS-EC2-FileProcessor-Role \
    2>/dev/null || echo "Role already added to profile"

echo "✅ IAM Role created"
echo ""

# 4. Create EventBridge Rule
echo "🌉 Creating EventBridge Rule..."

# Create rule
aws events put-rule \
    --name cis-s3-to-sqs-rule \
    --event-pattern '{
        "source": ["aws.s3"],
        "detail-type": ["Object Created"],
        "detail": {
            "bucket": {
                "name": ["cis-landing-bucket-'$ACCOUNT_ID'"]
            }
        }
    }' \
    --state ENABLED

# Add SQS target
aws events put-targets \
    --rule cis-s3-to-sqs-rule \
    --targets "Id=1,Arn=$QUEUE_ARN"

# Update SQS policy to allow EventBridge
aws sqs set-queue-attributes \
    --queue-url "$QUEUE_URL" \
    --attributes '{
        "Policy": "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"events.amazonaws.com\"},\"Action\":\"sqs:SendMessage\",\"Resource\":\"'$QUEUE_ARN'\",\"Condition\":{\"ArnEquals\":{\"aws:SourceArn\":\"arn:aws:events:'$REGION':'$ACCOUNT_ID':rule/cis-s3-to-sqs-rule\"}}}]}"
    }'

echo "✅ EventBridge rule created"
echo ""

# 5. Create OpenSearch Policy
echo "📝 Creating OpenSearch access policy..."

cat > opensearch-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "es:*"
      ],
      "Resource": "arn:aws:es:$REGION:$ACCOUNT_ID:domain/cis-filesearch/*"
    }
  ]
}
EOF

aws iam put-role-policy \
    --role-name CIS-EC2-FileProcessor-Role \
    --policy-name OpenSearchAccess \
    --policy-document file://opensearch-policy.json

echo "✅ OpenSearch policy added"
echo ""

# Clean up temp files
rm -f trust-policy.json opensearch-policy.json

# Summary
echo "============================================"
echo "✅ Resource Creation Summary"
echo "============================================"
echo ""
echo "S3 Buckets:"
echo "  - cis-landing-bucket-$ACCOUNT_ID"
echo "  - cis-thumbnail-bucket-$ACCOUNT_ID"
echo ""
echo "SQS Queues:"
echo "  - Main: $QUEUE_URL"
echo "  - DLQ: $DLQ_URL"
echo ""
echo "IAM:"
echo "  - Role: CIS-EC2-FileProcessor-Role"
echo "  - Instance Profile: CIS-EC2-FileProcessor-Profile"
echo ""
echo "EventBridge:"
echo "  - Rule: cis-s3-to-sqs-rule"
echo ""
echo "⚠️ Note: OpenSearch domain creation takes 15-20 minutes."
echo "   Please create it manually via AWS Console:"
echo "   - Domain: cis-filesearch"
echo "   - Type: t3.small.search"
echo "   - Storage: 100GB gp3"
echo ""
echo "============================================"
echo "Next step: Run 'python verify_aws_config.py' to verify"
echo "============================================"