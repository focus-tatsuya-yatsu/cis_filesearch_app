# AWS IAM Roles and Policies Comprehensive Guide

## Table of Contents
1. [Why This Matters - Understanding IAM](#why-this-matters)
2. [IAM Roles Overview](#iam-roles-overview)
3. [Scanner PC Role (DataSync)](#scanner-pc-role)
4. [EC2 Worker Role](#ec2-worker-role)
5. [EventBridge Service Role](#eventbridge-service-role)
6. [OpenSearch Access Policies](#opensearch-access-policies)
7. [Policy Testing and Validation](#policy-testing-and-validation)
8. [Security Best Practices](#security-best-practices)
9. [Troubleshooting](#troubleshooting)

---

## Why This Matters - Understanding IAM

### The Principle of Least Privilege

**Bad practice (too permissive):**
```json
{
  "Effect": "Allow",
  "Action": "*",
  "Resource": "*"
}
```
**Risk**: Full AWS account access, potential data breach

**Good practice (least privilege):**
```json
{
  "Effect": "Allow",
  "Action": [
    "s3:GetObject",
    "s3:PutObject"
  ],
  "Resource": "arn:aws:s3:::specific-bucket/*"
}
```
**Benefit**: Limited blast radius, compliance-ready

### IAM Roles vs IAM Users

| Aspect | IAM Role | IAM User |
|--------|----------|----------|
| **Credentials** | Temporary (expire) | Permanent (until rotated) |
| **Use case** | EC2, Lambda, services | Humans, CI/CD |
| **Security** | Better (no long-term keys) | Riskier (keys can leak) |
| **Our choice** | ✅ Roles for all services | ❌ No IAM users |

### Architecture IAM Map

```
Scanner PC (DataSync Agent)
  ↓ assumes: DataSyncTaskRole
  → S3 Landing Bucket (write only)

EventBridge (AWS Service)
  ↓ uses: built-in service role
  → SQS Queue (send messages)

EC2 Workers (Auto Scaling Group)
  ↓ assumes: CISFileProcessorRole
  → S3 (read files)
  → SQS (receive/delete messages)
  → OpenSearch (index documents)
  → Bedrock (generate embeddings)
  → CloudWatch (send logs/metrics)

OpenSearch Domain
  ↓ resource policy
  → Allow CISFileProcessorRole access
```

---

## IAM Roles Overview

### Roles We Need to Create

1. **DataSyncTaskRole**: Scanner PC uploads to S3
2. **CISFileProcessorRole**: EC2 workers process files
3. **EventBridgeToSQSRole**: (Optional) EventBridge → SQS
4. **OpenSearchServiceRole**: OpenSearch domain operations

### Trust Relationships Explained

A **trust relationship** defines WHO can assume the role.

**Example**:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Service": "ec2.amazonaws.com"
    },
    "Action": "sts:AssumeRole"
  }]
}
```

**Translation**: "EC2 instances can assume this role"

---

## Scanner PC Role (DataSync)

### Role: DataSyncTaskRole

**Purpose**: Allow DataSync agent to upload files from Windows Scanner PC to S3.

**Trust relationship**: DataSync service

#### Step 1: Create Trust Policy

```bash
cat > datasync-trust-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Service": "datasync.amazonaws.com"
    },
    "Action": "sts:AssumeRole"
  }]
}
EOF
```

#### Step 2: Create Role

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION="ap-northeast-1"

aws iam create-role \
  --role-name DataSyncTaskRole \
  --assume-role-policy-document file://datasync-trust-policy.json \
  --description "Role for DataSync to upload files to S3" \
  --tags "Key=Project,Value=CISFileSearch" \
         "Key=Component,Value=DataSync"
```

#### Step 3: Create S3 Write Policy

```bash
BUCKET_NAME="cis-filesearch-landing-dev"

cat > datasync-s3-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3BucketAccess",
      "Effect": "Allow",
      "Action": [
        "s3:GetBucketLocation",
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads"
      ],
      "Resource": "arn:aws:s3:::${BUCKET_NAME}"
    },
    {
      "Sid": "S3ObjectAccess",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": "arn:aws:s3:::${BUCKET_NAME}/*"
    }
  ]
}
EOF

# Create policy
aws iam create-policy \
  --policy-name DataSyncS3AccessPolicy \
  --policy-document file://datasync-s3-policy.json \
  --description "S3 access for DataSync tasks"

# Attach to role
aws iam attach-role-policy \
  --role-name DataSyncTaskRole \
  --policy-arn arn:aws:iam::${ACCOUNT_ID}:policy/DataSyncS3AccessPolicy
```

**Permissions explained:**

**Bucket-level actions:**
- `GetBucketLocation`: Required for multi-region buckets
- `ListBucket`: Check if files already exist (deduplication)
- `ListBucketMultipartUploads`: Resume failed uploads

**Object-level actions:**
- `PutObject`: Upload new files
- `GetObject`: Verify uploaded files
- `DeleteObject`: Cleanup on sync errors
- `AbortMultipartUpload`: Cancel incomplete uploads
- `ListMultipartUploadParts`: Resume partial uploads

#### Step 4: (Optional) CloudWatch Logs Policy

```bash
cat > datasync-logs-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "CloudWatchLogsAccess",
    "Effect": "Allow",
    "Action": [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams"
    ],
    "Resource": "arn:aws:logs:*:*:log-group:/aws/datasync/*"
  }]
}
EOF

aws iam create-policy \
  --policy-name DataSyncLogsPolicy \
  --policy-document file://datasync-logs-policy.json

aws iam attach-role-policy \
  --role-name DataSyncTaskRole \
  --policy-arn arn:aws:iam::${ACCOUNT_ID}:policy/DataSyncLogsPolicy
```

---

## EC2 Worker Role

### Role: CISFileProcessorRole

**Purpose**: Allow EC2 workers to read S3, poll SQS, index to OpenSearch, call Bedrock.

**Trust relationship**: EC2 service

#### Step 1: Create Trust Policy

```bash
cat > ec2-trust-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Service": "ec2.amazonaws.com"
    },
    "Action": "sts:AssumeRole"
  }]
}
EOF
```

#### Step 2: Create Role

```bash
aws iam create-role \
  --role-name CISFileProcessorRole \
  --assume-role-policy-document file://ec2-trust-policy.json \
  --description "Role for EC2 file processing workers" \
  --tags "Key=Project,Value=CISFileSearch" \
         "Key=Component,Value=Worker"
```

#### Step 3: Create S3 Read Policy

```bash
cat > worker-s3-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3BucketList",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::${BUCKET_NAME}"
    },
    {
      "Sid": "S3ObjectRead",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:GetObjectVersion"
      ],
      "Resource": "arn:aws:s3:::${BUCKET_NAME}/*"
    }
  ]
}
EOF

aws iam create-policy \
  --policy-name CISWorkerS3ReadPolicy \
  --policy-document file://worker-s3-policy.json

aws iam attach-role-policy \
  --role-name CISFileProcessorRole \
  --policy-arn arn:aws:iam::${ACCOUNT_ID}:policy/CISWorkerS3ReadPolicy
```

**Why read-only?**
- Workers don't need to upload files
- Principle of least privilege
- Prevents accidental deletions

#### Step 4: Create SQS Policy

```bash
QUEUE_NAME="cis-filesearch-queue-dev"

cat > worker-sqs-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "SQSQueueAccess",
    "Effect": "Allow",
    "Action": [
      "sqs:GetQueueUrl",
      "sqs:GetQueueAttributes",
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:ChangeMessageVisibility"
    ],
    "Resource": "arn:aws:sqs:${REGION}:${ACCOUNT_ID}:${QUEUE_NAME}"
  }]
}
EOF

aws iam create-policy \
  --policy-name CISWorkerSQSPolicy \
  --policy-document file://worker-sqs-policy.json

aws iam attach-role-policy \
  --role-name CISFileProcessorRole \
  --policy-arn arn:aws:iam::${ACCOUNT_ID}:policy/CISWorkerSQSPolicy
```

**Permissions explained:**

- `ReceiveMessage`: Poll for new work
- `DeleteMessage`: Remove completed tasks
- `ChangeMessageVisibility`: Extend processing time if needed
- `GetQueueUrl`: Resolve queue name to URL
- `GetQueueAttributes`: Check queue depth (for metrics)

#### Step 5: Create OpenSearch Policy

```bash
OPENSEARCH_DOMAIN="cis-filesearch-dev"

cat > worker-opensearch-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OpenSearchDomainAccess",
      "Effect": "Allow",
      "Action": [
        "es:DescribeDomain",
        "es:DescribeDomains",
        "es:DescribeDomainConfig",
        "es:ListDomainNames",
        "es:ListTags"
      ],
      "Resource": "*"
    },
    {
      "Sid": "OpenSearchDataAccess",
      "Effect": "Allow",
      "Action": [
        "es:ESHttpGet",
        "es:ESHttpHead",
        "es:ESHttpPost",
        "es:ESHttpPut",
        "es:ESHttpDelete"
      ],
      "Resource": "arn:aws:es:${REGION}:${ACCOUNT_ID}:domain/${OPENSEARCH_DOMAIN}/*"
    }
  ]
}
EOF

aws iam create-policy \
  --policy-name CISWorkerOpenSearchPolicy \
  --policy-document file://worker-opensearch-policy.json

aws iam attach-role-policy \
  --role-name CISFileProcessorRole \
  --policy-arn arn:aws:iam::${ACCOUNT_ID}:policy/CISWorkerOpenSearchPolicy
```

**HTTP methods explained:**

- `ESHttpGet`: Search queries, retrieve documents
- `ESHttpPost`: Index documents, bulk operations
- `ESHttpPut`: Create indices, update mappings
- `ESHttpDelete`: Delete documents (if needed)
- `ESHttpHead`: Check if index/document exists

#### Step 6: Create Bedrock Policy

```bash
cat > worker-bedrock-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "BedrockInvoke",
    "Effect": "Allow",
    "Action": [
      "bedrock:InvokeModel"
    ],
    "Resource": [
      "arn:aws:bedrock:*::foundation-model/amazon.titan-embed-image-v1",
      "arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v1"
    ]
  }]
}
EOF

aws iam create-policy \
  --policy-name CISWorkerBedrockPolicy \
  --policy-document file://worker-bedrock-policy.json

aws iam attach-role-policy \
  --role-name CISFileProcessorRole \
  --policy-arn arn:aws:iam::${ACCOUNT_ID}:policy/CISWorkerBedrockPolicy
```

**Why only InvokeModel?**
- Workers don't need to manage models
- Bedrock Foundation Models are shared resources
- InvokeModel is the only action needed for embeddings

**Model ARN format:**
```
arn:aws:bedrock:REGION::foundation-model/MODEL_ID
```

**Note**: `::` (double colon) means no account ID needed for foundation models

#### Step 7: Create CloudWatch Policy

```bash
cat > worker-cloudwatch-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudWatchLogsAccess",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/aws/cis-file-processor/*"
    },
    {
      "Sid": "CloudWatchMetrics",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricData"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "cloudwatch:namespace": "CISFileProcessor"
        }
      }
    }
  ]
}
EOF

aws iam create-policy \
  --policy-name CISWorkerCloudWatchPolicy \
  --policy-document file://worker-cloudwatch-policy.json

aws iam attach-role-policy \
  --role-name CISFileProcessorRole \
  --policy-arn arn:aws:iam::${ACCOUNT_ID}:policy/CISWorkerCloudWatchPolicy
```

**Namespace restriction:**
```
"cloudwatch:namespace": "CISFileProcessor"
```

**Why restrict namespace?**
- Prevents workers from polluting other namespaces
- Better cost tracking
- Organized metrics

#### Step 8: Create Instance Profile

**Instance profiles** link IAM roles to EC2 instances.

```bash
# Create instance profile
aws iam create-instance-profile \
  --instance-profile-name CISFileProcessorProfile

# Add role to instance profile
aws iam add-role-to-instance-profile \
  --instance-profile-name CISFileProcessorProfile \
  --role-name CISFileProcessorRole
```

**Use in Launch Template:**
```json
{
  "IamInstanceProfile": {
    "Name": "CISFileProcessorProfile"
  }
}
```

---

## EventBridge Service Role

### Built-in Service Role

EventBridge has a built-in service role for SQS delivery.

**No IAM role creation needed!**

### SQS Resource Policy

Instead, add resource policy to SQS queue:

```bash
QUEUE_URL=$(aws sqs get-queue-url --queue-name $QUEUE_NAME --query 'QueueUrl' --output text)
QUEUE_ARN=$(aws sqs get-queue-attributes --queue-url $QUEUE_URL --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

cat > sqs-resource-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowEventBridgeToSendMessages",
    "Effect": "Allow",
    "Principal": {
      "Service": "events.amazonaws.com"
    },
    "Action": "sqs:SendMessage",
    "Resource": "${QUEUE_ARN}",
    "Condition": {
      "ArnEquals": {
        "aws:SourceArn": "arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/cis-s3-to-sqs-dev"
      }
    }
  }]
}
EOF

aws sqs set-queue-attributes \
  --queue-url $QUEUE_URL \
  --attributes "Policy=$(cat sqs-resource-policy.json | jq -c .)"
```

**Condition explained:**
```json
"Condition": {
  "ArnEquals": {
    "aws:SourceArn": "arn:aws:events:...:rule/cis-s3-to-sqs-dev"
  }
}
```

**Purpose**: Only THIS EventBridge rule can send messages, prevents other rules from injecting messages

---

## OpenSearch Access Policies

### Domain-Level Access Policy

OpenSearch uses resource-based policies (like S3).

```bash
OPENSEARCH_DOMAIN="cis-filesearch-dev"

cat > opensearch-access-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "AWS": "arn:aws:iam::${ACCOUNT_ID}:role/CISFileProcessorRole"
    },
    "Action": "es:*",
    "Resource": "arn:aws:es:${REGION}:${ACCOUNT_ID}:domain/${OPENSEARCH_DOMAIN}/*"
  }]
}
EOF

aws opensearch update-domain-config \
  --domain-name $OPENSEARCH_DOMAIN \
  --region $REGION \
  --access-policies "$(cat opensearch-access-policy.json | jq -c .)"
```

**Best practice**: Combine with IAM role policy (defense in depth)

---

## Policy Testing and Validation

### IAM Policy Simulator

Test policies before attaching:

```bash
# Test if role can read S3
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::${ACCOUNT_ID}:role/CISFileProcessorRole \
  --action-names s3:GetObject \
  --resource-arns arn:aws:s3:::${BUCKET_NAME}/files/test.pdf
```

**Expected output:**
```json
{
  "EvaluationResults": [{
    "EvalActionName": "s3:GetObject",
    "EvalResourceName": "arn:aws:s3:::cis-filesearch-landing-dev/files/test.pdf",
    "EvalDecision": "allowed"
  }]
}
```

### Test from EC2 Instance

Launch test EC2 with the role:

```bash
# SSH into instance
ssh ec2-user@<instance-ip>

# Test S3 access
aws s3 ls s3://cis-filesearch-landing-dev/

# Test SQS access
aws sqs receive-message \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/ACCOUNT/cis-filesearch-queue-dev

# Test OpenSearch access
curl -X GET "https://OPENSEARCH_ENDPOINT/_cluster/health" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es"
```

**All should succeed**

### Verify Role Assumptions

```bash
# Check which roles can be assumed by EC2
aws iam list-roles \
  --query 'Roles[?contains(AssumeRolePolicyDocument.Statement[0].Principal.Service, `ec2.amazonaws.com`)].RoleName'

# Get role details
aws iam get-role --role-name CISFileProcessorRole

# List attached policies
aws iam list-attached-role-policies --role-name CISFileProcessorRole
```

---

## Security Best Practices

### 1. Use Conditions in Policies

**Restrict by source IP:**
```json
{
  "Condition": {
    "IpAddress": {
      "aws:SourceIp": "10.0.0.0/8"
    }
  }
}
```

**Restrict by VPC:**
```json
{
  "Condition": {
    "StringEquals": {
      "aws:SourceVpc": "vpc-xxxxx"
    }
  }
}
```

**Restrict by time:**
```json
{
  "Condition": {
    "DateGreaterThan": {
      "aws:CurrentTime": "2025-01-01T00:00:00Z"
    },
    "DateLessThan": {
      "aws:CurrentTime": "2025-12-31T23:59:59Z"
    }
  }
}
```

### 2. Use AWS Managed Policies (When Appropriate)

**Attach CloudWatch agent policy:**
```bash
aws iam attach-role-policy \
  --role-name CISFileProcessorRole \
  --policy-arn arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy
```

**Attach SSM managed instance policy (for Session Manager):**
```bash
aws iam attach-role-policy \
  --role-name CISFileProcessorRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
```

**Benefits:**
- AWS maintains and updates
- Best practices built-in
- Covers common use cases

### 3. Enable CloudTrail Logging

```bash
# Create CloudTrail for IAM events
aws cloudtrail create-trail \
  --name cis-iam-audit-trail \
  --s3-bucket-name cis-audit-logs \
  --include-global-service-events \
  --is-multi-region-trail

# Start logging
aws cloudtrail start-logging --name cis-iam-audit-trail
```

**Logs all IAM actions:**
- Role assumptions
- Policy changes
- Permission grants
- Access denials

### 4. Rotate Credentials Regularly

**For IAM users (if any):**
```bash
# List access keys
aws iam list-access-keys --user-name scanner-user

# Deactivate old keys
aws iam update-access-key \
  --user-name scanner-user \
  --access-key-id AKIAIOSFODNN7EXAMPLE \
  --status Inactive
```

**For roles**: Automatic rotation (temporary credentials)

### 5. Use Service Control Policies (SCPs)

If using AWS Organizations:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Deny",
    "Action": [
      "iam:DeleteRole",
      "iam:DeleteRolePolicy"
    ],
    "Resource": "arn:aws:iam::*:role/CISFileProcessorRole"
  }]
}
```

**Prevents accidental deletion of critical roles**

### 6. Monitor for Unused Roles

```bash
# Get last used time for role
aws iam get-role --role-name CISFileProcessorRole \
  --query 'Role.RoleLastUsed'
```

**Expected output:**
```json
{
  "LastUsedDate": "2025-01-18T10:30:00Z",
  "Region": "ap-northeast-1"
}
```

**If never used**: Investigate or delete

---

## Troubleshooting

### Issue 1: Access Denied Errors

**Symptoms:**
```
An error occurred (AccessDenied) when calling the GetObject operation
```

**Diagnosis:**

```bash
# Check role permissions
aws iam get-role-policy \
  --role-name CISFileProcessorRole \
  --policy-name PolicyName

# Check attached policies
aws iam list-attached-role-policies --role-name CISFileProcessorRole

# Simulate action
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::ACCOUNT:role/CISFileProcessorRole \
  --action-names s3:GetObject \
  --resource-arns arn:aws:s3:::bucket/key
```

**Common causes:**
1. Missing policy attachment
2. Typo in resource ARN
3. Bucket policy denies access
4. S3 Block Public Access enabled

**Solutions:**
1. Attach missing policies
2. Fix resource ARNs
3. Update bucket policy to allow role
4. Use VPC endpoint for S3 access

### Issue 2: Role Cannot Be Assumed

**Symptoms:**
```
User: arn:aws:sts::ACCOUNT:assumed-role/CISFileProcessorRole/i-xxxxx is not authorized to perform: sts:AssumeRole
```

**Diagnosis:**

```bash
# Check trust relationship
aws iam get-role --role-name CISFileProcessorRole \
  --query 'Role.AssumeRolePolicyDocument'
```

**Expected for EC2:**
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Service": "ec2.amazonaws.com"
    },
    "Action": "sts:AssumeRole"
  }]
}
```

**Solutions:**
1. Update trust relationship
2. Verify instance profile attached to EC2
3. Check instance metadata service (IMDSv2)

### Issue 3: OpenSearch Access Denied

**Symptoms:**
```
403 Forbidden: User is not authorized
```

**Diagnosis:**

```bash
# Check OpenSearch domain policy
aws opensearch describe-domain \
  --domain-name cis-filesearch-dev \
  --query 'DomainStatus.AccessPolicies'

# Check IAM policy
aws iam get-policy-version \
  --policy-arn arn:aws:iam::ACCOUNT:policy/CISWorkerOpenSearchPolicy \
  --version-id v1
```

**Solutions:**
1. Update OpenSearch access policy to allow role
2. Verify IAM policy has `es:ESHttp*` actions
3. Check security group allows 443
4. Use AWS SigV4 signing for requests

### Issue 4: Bedrock Access Denied

**Symptoms:**
```
AccessDeniedException: User is not authorized to perform: bedrock:InvokeModel
```

**Diagnosis:**

```bash
# Check Bedrock policy
aws iam get-policy-version \
  --policy-arn arn:aws:iam::ACCOUNT:policy/CISWorkerBedrockPolicy \
  --version-id v1

# Test model access
aws bedrock list-foundation-models --region us-east-1
```

**Solutions:**
1. Verify Bedrock available in region (us-east-1 or us-west-2)
2. Check model ID correct (`amazon.titan-embed-image-v1`)
3. Ensure cross-region access allowed
4. Model access granted in Bedrock console

---

## Summary Checklist

- [ ] DataSyncTaskRole created with S3 write access
- [ ] CISFileProcessorRole created with full permissions
- [ ] Instance profile created and linked to role
- [ ] S3 policies allow read (workers) and write (DataSync)
- [ ] SQS policies allow receive/delete (workers)
- [ ] OpenSearch policies allow index operations
- [ ] Bedrock policies allow InvokeModel
- [ ] CloudWatch policies allow logs and metrics
- [ ] EventBridge can send to SQS (resource policy)
- [ ] Policies tested with IAM simulator
- [ ] Roles tested from EC2 instance
- [ ] CloudTrail logging enabled for audit

---

## Quick Reference

### Role ARNs

```bash
# DataSync role
arn:aws:iam::ACCOUNT_ID:role/DataSyncTaskRole

# EC2 worker role
arn:aws:iam::ACCOUNT_ID:role/CISFileProcessorRole

# Instance profile
arn:aws:iam::ACCOUNT_ID:instance-profile/CISFileProcessorProfile
```

### Policy ARNs

```bash
# S3 access
arn:aws:iam::ACCOUNT_ID:policy/DataSyncS3AccessPolicy
arn:aws:iam::ACCOUNT_ID:policy/CISWorkerS3ReadPolicy

# SQS access
arn:aws:iam::ACCOUNT_ID:policy/CISWorkerSQSPolicy

# OpenSearch access
arn:aws:iam::ACCOUNT_ID:policy/CISWorkerOpenSearchPolicy

# Bedrock access
arn:aws:iam::ACCOUNT_ID:policy/CISWorkerBedrockPolicy

# CloudWatch access
arn:aws:iam::ACCOUNT_ID:policy/CISWorkerCloudWatchPolicy
```

---

## Next Steps

1. **Update Launch Template**: Attach CISFileProcessorProfile
2. **Update Auto Scaling Group**: Verify role attached
3. **Test Full Pipeline**: End-to-end with actual files
4. **Monitor IAM Activity**: Check CloudTrail logs
5. **Review Permissions**: Quarterly audit of policies

---

## Additional Resources

- [IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [IAM Policy Reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies.html)
- [Service Authorization Reference](https://docs.aws.amazon.com/service-authorization/latest/reference/)
- [IAM Policy Simulator](https://policysim.aws.amazon.com/)

---

**Document Version**: 1.0
**Last Updated**: 2025-01-18
**Author**: CIS Development Team
