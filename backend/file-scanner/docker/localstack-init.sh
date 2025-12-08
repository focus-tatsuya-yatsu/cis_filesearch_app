#!/bin/bash
# LocalStack initialization script for development environment

echo "Initializing LocalStack for CIS File Scanner..."

# Wait for LocalStack to be ready
sleep 5

# Create S3 bucket
echo "Creating S3 bucket..."
awslocal s3 mb s3://cis-filesearch-landing-dev

# Set bucket policy
awslocal s3api put-bucket-policy \
  --bucket cis-filesearch-landing-dev \
  --policy '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": "*",
        "Action": "s3:*",
        "Resource": [
          "arn:aws:s3:::cis-filesearch-landing-dev",
          "arn:aws:s3:::cis-filesearch-landing-dev/*"
        ]
      }
    ]
  }'

# Create SQS queue
echo "Creating SQS queue..."
awslocal sqs create-queue \
  --queue-name cis-filesearch-queue \
  --attributes '{
    "MessageRetentionPeriod": "1209600",
    "VisibilityTimeout": "300",
    "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:ap-northeast-1:000000000000:cis-filesearch-dlq\",\"maxReceiveCount\":3}"
  }'

# Create Dead Letter Queue
echo "Creating DLQ..."
awslocal sqs create-queue \
  --queue-name cis-filesearch-dlq \
  --attributes '{
    "MessageRetentionPeriod": "1209600"
  }'

echo "LocalStack initialization completed!"
echo ""
echo "S3 Endpoint: http://localhost:4566"
echo "SQS Endpoint: http://localhost:4566"
echo "Bucket: s3://cis-filesearch-landing-dev"
echo "Queue URL: http://localhost:4566/000000000000/cis-filesearch-queue"