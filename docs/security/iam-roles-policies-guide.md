# AWS IAM Roles and Policies Security Guide

## Table of Contents

1. [Introduction](#introduction)
2. [Threat Model & Security Rationale](#threat-model--security-rationale)
3. [EC2 Instance Role Configuration](#ec2-instance-role-configuration)
4. [Least Privilege Policies](#least-privilege-policies)
5. [Trust Relationships](#trust-relationships)
6. [Managed vs Inline Policies](#managed-vs-inline-policies)
7. [Policy Testing with IAM Policy Simulator](#policy-testing-with-iam-policy-simulator)
8. [Multi-Environment Role Strategy](#multi-environment-role-strategy)
9. [Common Security Mistakes](#common-security-mistakes)
10. [Incident Response](#incident-response)
11. [Cost vs Security Tradeoffs](#cost-vs-security-tradeoffs)

---

## Introduction

This guide provides comprehensive, security-focused instructions for configuring AWS IAM roles and policies for the CIS File Scanner Backend. The file scanner application handles potentially sensitive file metadata, database credentials, and audit logs, requiring robust security controls.

**Security Priority**: P0 (Critical)

**Compliance Requirements**:
- GDPR Article 32 (Security of Processing)
- SOC 2 CC6.1 (Logical and Physical Access Controls)
- ISO 27001 A.9.4 (System and Application Access Control)

---

## Threat Model & Security Rationale

### Attack Vectors

**1. Credential Compromise (CVSS 9.8 - Critical)**
- **Scenario**: EC2 instance is compromised via application vulnerability (e.g., SSRF, RCE)
- **Impact**: Attacker gains access to IAM role credentials via Instance Metadata Service (IMDS)
- **Blast Radius**: Limited by role permissions (this is why least privilege is critical)

**2. Privilege Escalation (CVSS 8.1 - High)**
- **Scenario**: Overly permissive IAM policies allow lateral movement to other AWS resources
- **Example**: `s3:*` on `*` allows access to ALL S3 buckets, not just the scanner bucket
- **Impact**: Data breach across multiple systems

**3. Data Exfiltration (CVSS 7.5 - High)**
- **Scenario**: Excessive S3 permissions allow reading sensitive data from other buckets
- **Example**: `s3:GetObject` on `arn:aws:s3:::*/*` instead of specific bucket
- **Impact**: Unauthorized access to customer data, PII, financial records

**4. Service Disruption (CVSS 6.5 - Medium)**
- **Scenario**: Permissions allow deletion of critical resources (e.g., `s3:DeleteBucket`)
- **Impact**: Data loss, service downtime, ransom scenarios

### Security Controls

This guide implements **Defense in Depth** through:

1. **Least Privilege Access**: Minimal permissions required for operation
2. **Resource-Level Permissions**: Restrict access to specific ARNs
3. **Condition Keys**: Enforce encryption, IP restrictions, time-based access
4. **Trust Relationships**: Limit who can assume roles
5. **Session Duration Limits**: Minimize credential lifetime
6. **IMDSv2 Enforcement**: Prevent SSRF-based credential theft

---

## EC2 Instance Role Configuration

### Step 1: Create the IAM Role (Console)

**Security Rationale**: EC2 instances should NEVER use long-term access keys. Instance roles provide temporary credentials that auto-rotate.

1. Navigate to **IAM Console** → **Roles** → **Create role**
2. Select **Trusted entity type**: AWS service
3. Select **Use case**: EC2
4. Click **Next**
5. (Skip policies for now - we'll attach custom policies later)
6. Click **Next**
7. **Role name**: `CISFileScannerEC2Role-dev` (use environment suffix)
8. **Description**: `EC2 instance role for CIS File Scanner backend (Development Environment)`
9. **Step 2 - Enable IMDSv2**:
   - Add tag: `Key=RequireIMDSv2`, `Value=true`
   - This will be enforced via EC2 launch configuration
10. Click **Create role**

### Step 1: Create the IAM Role (CLI)

```bash
# Create trust policy document
cat > /tmp/ec2-trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "cis-file-scanner-dev-20250112"
        }
      }
    }
  ]
}
EOF

# Create the role
aws iam create-role \
  --role-name CISFileScannerEC2Role-dev \
  --assume-role-policy-document file:///tmp/ec2-trust-policy.json \
  --description "EC2 instance role for CIS File Scanner backend (Development)" \
  --max-session-duration 3600 \
  --tags Key=Environment,Value=dev \
         Key=Application,Value=CISFileScanner \
         Key=ManagedBy,Value=Manual \
         Key=SecurityLevel,Value=High
```

**Security Note**: The `sts:ExternalId` condition adds an additional security layer. Change this value for each environment (dev, staging, prod).

### Step 2: Create Instance Profile

An instance profile is a container for an IAM role that allows EC2 to pass the role to an instance.

```bash
# Create instance profile
aws iam create-instance-profile \
  --instance-profile-name CISFileScannerEC2Profile-dev

# Attach role to instance profile
aws iam add-role-to-instance-profile \
  --instance-profile-name CISFileScannerEC2Profile-dev \
  --role-name CISFileScannerEC2Role-dev
```

---

## Least Privilege Policies

### Policy 1: S3 Access Policy

**Security Rationale**:
- Restrict access to ONLY the file scanner bucket
- Allow only necessary operations (no DeleteBucket, no PutBucketPolicy)
- Enforce encryption in transit (aws:SecureTransport condition)
- Prevent public access (s3:x-amz-acl condition)

**Threat Mitigation**:
- Prevents lateral movement to other S3 buckets
- Prevents accidental/malicious public exposure
- Ensures data is encrypted in transit (prevents MITM attacks)

#### Policy JSON

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListSpecificBucketOnly",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:GetBucketVersioning"
      ],
      "Resource": [
        "arn:aws:s3:::cis-file-scanner-dev-metadata"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "true"
        }
      }
    },
    {
      "Sid": "ReadWriteSpecificBucketObjects",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:GetObjectVersion",
        "s3:PutObject",
        "s3:PutObjectAcl"
      ],
      "Resource": [
        "arn:aws:s3:::cis-file-scanner-dev-metadata/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "true"
        },
        "StringNotEquals": {
          "s3:x-amz-acl": [
            "public-read",
            "public-read-write",
            "authenticated-read"
          ]
        }
      }
    },
    {
      "Sid": "DenyUnencryptedObjectUploads",
      "Effect": "Deny",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::cis-file-scanner-dev-metadata/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption": [
            "AES256",
            "aws:kms"
          ]
        }
      }
    },
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::cis-file-scanner-dev-metadata",
        "arn:aws:s3:::cis-file-scanner-dev-metadata/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
```

#### Create Policy (CLI)

```bash
# Save policy JSON to file
cat > /tmp/s3-access-policy.json << 'EOF'
[Insert JSON above]
EOF

# Create the policy
aws iam create-policy \
  --policy-name CISFileScannerS3Access-dev \
  --policy-document file:///tmp/s3-access-policy.json \
  --description "S3 access policy for CIS File Scanner (dev environment)" \
  --tags Key=Environment,Value=dev \
         Key=Application,Value=CISFileScanner
```

#### Attach Policy to Role

```bash
# Get policy ARN (will be needed)
POLICY_ARN=$(aws iam list-policies \
  --query 'Policies[?PolicyName==`CISFileScannerS3Access-dev`].Arn' \
  --output text)

# Attach to role
aws iam attach-role-policy \
  --role-name CISFileScannerEC2Role-dev \
  --policy-arn $POLICY_ARN
```

---

### Policy 2: SQS Access Policy

**Security Rationale**:
- Restrict to specific queue ARN
- Allow only message sending (no ReceiveMessage, DeleteMessage - that's for consumers)
- Enforce encryption in transit

**Threat Mitigation**:
- Prevents queue poisoning attacks on other SQS queues
- Prevents message interception by enforcing TLS

#### Policy JSON

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendMessagesToSpecificQueue",
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:GetQueueUrl",
        "sqs:GetQueueAttributes"
      ],
      "Resource": [
        "arn:aws:sqs:ap-northeast-1:123456789012:cis-file-scanner-dev-queue"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "true"
        }
      }
    },
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Action": "sqs:*",
      "Resource": "*",
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
```

#### Create and Attach Policy (CLI)

```bash
# Create policy
aws iam create-policy \
  --policy-name CISFileScannerSQSAccess-dev \
  --policy-document file:///tmp/sqs-access-policy.json \
  --description "SQS access policy for CIS File Scanner (dev)"

# Attach to role
POLICY_ARN=$(aws iam list-policies \
  --query 'Policies[?PolicyName==`CISFileScannerSQSAccess-dev`].Arn' \
  --output text)

aws iam attach-role-policy \
  --role-name CISFileScannerEC2Role-dev \
  --policy-arn $POLICY_ARN
```

---

### Policy 3: CloudWatch Logs Access Policy

**Security Rationale**:
- Restrict to specific log group
- Allow only log stream creation and log event writing
- No log deletion or modification of existing logs (ensures audit trail integrity)

**Threat Mitigation**:
- Prevents log tampering (critical for forensic investigations)
- Prevents attackers from hiding their tracks
- Ensures compliance with audit logging requirements (SOC 2, ISO 27001)

#### Policy JSON

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CreateLogStreamsAndPutLogEvents",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": [
        "arn:aws:logs:ap-northeast-1:123456789012:log-group:/aws/cis-file-scanner/dev:*"
      ]
    },
    {
      "Sid": "DescribeLogGroups",
      "Effect": "Allow",
      "Action": [
        "logs:DescribeLogGroups"
      ],
      "Resource": [
        "arn:aws:logs:ap-northeast-1:123456789012:log-group:*"
      ]
    }
  ]
}
```

**Note**: No `logs:DeleteLogStream` or `logs:DeleteLogGroup` permissions. Logs should be immutable.

#### Create and Attach Policy (CLI)

```bash
aws iam create-policy \
  --policy-name CISFileScannerCloudWatchLogs-dev \
  --policy-document file:///tmp/cloudwatch-logs-policy.json \
  --description "CloudWatch Logs policy for CIS File Scanner (dev)"

POLICY_ARN=$(aws iam list-policies \
  --query 'Policies[?PolicyName==`CISFileScannerCloudWatchLogs-dev`].Arn' \
  --output text)

aws iam attach-role-policy \
  --role-name CISFileScannerEC2Role-dev \
  --policy-arn $POLICY_ARN
```

---

### Policy 4: Secrets Manager Access Policy

**Security Rationale**:
- Read-only access to specific secrets
- No write, update, or delete permissions
- No access to secret rotation configuration (that's an admin operation)
- Audit all secret retrievals via CloudTrail

**Threat Mitigation**:
- Prevents attackers from modifying secrets (e.g., changing DB password to lock you out)
- Prevents secret deletion
- Limits blast radius to specific secrets

#### Policy JSON

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadSpecificSecretsOnly",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": [
        "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:cis-file-scanner/dev/database-*",
        "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:cis-file-scanner/dev/nas-credentials-*"
      ],
      "Condition": {
        "StringEquals": {
          "secretsmanager:VersionStage": "AWSCURRENT"
        }
      }
    },
    {
      "Sid": "DenySecretModification",
      "Effect": "Deny",
      "Action": [
        "secretsmanager:UpdateSecret",
        "secretsmanager:DeleteSecret",
        "secretsmanager:PutSecretValue",
        "secretsmanager:RotateSecret",
        "secretsmanager:CancelRotateSecret"
      ],
      "Resource": "*"
    }
  ]
}
```

**Security Note**: The wildcard suffix `-*` in the ARN allows for multiple versions of the secret (Secrets Manager appends random characters). The `VersionStage` condition ensures only the current version is retrieved.

#### Create and Attach Policy (CLI)

```bash
aws iam create-policy \
  --policy-name CISFileScannerSecretsManagerAccess-dev \
  --policy-document file:///tmp/secrets-manager-policy.json \
  --description "Secrets Manager read-only access for CIS File Scanner (dev)"

POLICY_ARN=$(aws iam list-policies \
  --query 'Policies[?PolicyName==`CISFileScannerSecretsManagerAccess-dev`].Arn' \
  --output text)

aws iam attach-role-policy \
  --role-name CISFileScannerEC2Role-dev \
  --policy-arn $POLICY_ARN
```

---

## Trust Relationships

### What Are Trust Relationships?

A trust relationship defines **WHO** can assume an IAM role. This is separate from the permissions the role grants.

**Security Analogy**:
- **Trust Policy** = Who can enter the building (authentication)
- **Permission Policies** = What they can do once inside (authorization)

### Secure Trust Policy Pattern

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "cis-file-scanner-dev-20250112",
          "aws:SourceAccount": "123456789012"
        },
        "ArnLike": {
          "aws:SourceArn": "arn:aws:ec2:ap-northeast-1:123456789012:instance/*"
        }
      }
    }
  ]
}
```

**Security Controls Explained**:

1. **Principal.Service**: Only EC2 service can assume (not IAM users)
2. **sts:ExternalId**: Prevents "confused deputy" attacks
3. **aws:SourceAccount**: Prevents cross-account assumption
4. **aws:SourceArn**: Restricts to specific EC2 instances in specific region

### Update Trust Relationship (CLI)

```bash
# Update trust policy
aws iam update-assume-role-policy \
  --role-name CISFileScannerEC2Role-dev \
  --policy-document file:///tmp/ec2-trust-policy.json

# Verify trust relationship
aws iam get-role --role-name CISFileScannerEC2Role-dev \
  --query 'Role.AssumeRolePolicyDocument'
```

---

## Managed vs Inline Policies

### Comparison Table

| Aspect | AWS Managed Policies | Customer Managed Policies | Inline Policies |
|--------|---------------------|--------------------------|-----------------|
| **Reusability** | ✅ Across all accounts | ✅ Across roles in account | ❌ Single role only |
| **Version Control** | ✅ AWS managed | ✅ You control versions | ❌ No versioning |
| **Updates** | ⚠️ AWS updates automatically | ✅ You control | ✅ You control |
| **Audit Trail** | ⚠️ Limited | ✅ Full CloudTrail | ✅ Full CloudTrail |
| **Granularity** | ❌ Often too broad | ✅ Precise permissions | ✅ Precise permissions |
| **Deletion Protection** | ✅ Can't be deleted | ⚠️ Can be deleted | ⚠️ Deleted with role |

### Security Recommendation

**For CIS File Scanner**: Use **Customer Managed Policies**

**Rationale**:
1. **Least Privilege**: AWS managed policies are often overly permissive
   - Example: `AmazonS3FullAccess` grants `s3:*` on all buckets (too broad)
2. **Version Control**: Track changes via Git + Terraform
3. **Audit**: Full CloudTrail logging of policy changes
4. **Compliance**: Required for SOC 2 and ISO 27001

**When to Use Inline Policies**:
- Never for production (no reusability)
- Only for one-off testing scenarios

**When to Use AWS Managed Policies**:
- Read-only access for developers (e.g., `ReadOnlyAccess`)
- AWS service-linked roles (automatically managed by AWS)

### Example: Why AWS Managed Policies Are Risky

```json
// AWS Managed Policy: AmazonS3FullAccess
{
  "Effect": "Allow",
  "Action": "s3:*",
  "Resource": "*"
}
// ⚠️ Allows access to ALL S3 buckets in the account!

// Customer Managed Policy (Least Privilege)
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject"],
  "Resource": "arn:aws:s3:::cis-file-scanner-dev-metadata/*"
}
// ✅ Allows access ONLY to specific bucket
```

---

## Policy Testing with IAM Policy Simulator

### What Is It?

The IAM Policy Simulator allows you to test permissions **before deploying to production**. This is critical for security validation.

**Use Cases**:
- Verify least privilege policies work as intended
- Test that deny conditions are enforced
- Identify overly permissive policies

### Step-by-Step Testing (Console)

1. Navigate to **IAM Console** → **Roles** → Select `CISFileScannerEC2Role-dev`
2. Click **Simulate policies** (in the **Permissions** tab)
3. Select **Service**: S3
4. Select **Action**: `PutObject`
5. Enter **Resource ARN**: `arn:aws:s3:::cis-file-scanner-dev-metadata/test.json`
6. Under **Simulation settings**, add condition:
   - Key: `aws:SecureTransport`
   - Value: `false`
7. Click **Run simulation**

**Expected Result**: ❌ **Denied** (because `DenyInsecureTransport` condition blocks HTTP)

8. Change condition to `aws:SecureTransport = true`
9. Click **Run simulation**

**Expected Result**: ✅ **Allowed**

### Policy Testing (CLI)

```bash
# Test S3 PutObject with HTTPS (should be allowed)
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::123456789012:role/CISFileScannerEC2Role-dev \
  --action-names s3:PutObject \
  --resource-arns arn:aws:s3:::cis-file-scanner-dev-metadata/test.json \
  --context-entries "ContextKeyName=aws:SecureTransport,ContextKeyValues=true,ContextKeyType=boolean"

# Expected output:
# EvaluationResults:
# - EvalDecision: allowed

# Test S3 PutObject with HTTP (should be denied)
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::123456789012:role/CISFileScannerEC2Role-dev \
  --action-names s3:PutObject \
  --resource-arns arn:aws:s3:::cis-file-scanner-dev-metadata/test.json \
  --context-entries "ContextKeyName=aws:SecureTransport,ContextKeyValues=false,ContextKeyType=boolean"

# Expected output:
# EvaluationResults:
# - EvalDecision: explicitDeny
```

### Test Cases for CIS File Scanner

| Test Case | Action | Resource | Conditions | Expected Result |
|-----------|--------|----------|------------|-----------------|
| S3 Read (HTTPS) | `s3:GetObject` | `arn:aws:s3:::cis-file-scanner-dev-metadata/*` | `SecureTransport=true` | ✅ Allowed |
| S3 Read (HTTP) | `s3:GetObject` | Same | `SecureTransport=false` | ❌ Denied |
| S3 Write (Encrypted) | `s3:PutObject` | Same | `x-amz-server-side-encryption=AES256` | ✅ Allowed |
| S3 Write (Unencrypted) | `s3:PutObject` | Same | No encryption header | ❌ Denied |
| S3 Delete Bucket | `s3:DeleteBucket` | `arn:aws:s3:::cis-file-scanner-dev-metadata` | None | ❌ Denied |
| SQS Send Message | `sqs:SendMessage` | `arn:aws:sqs:ap-northeast-1:123456789012:cis-file-scanner-dev-queue` | None | ✅ Allowed |
| Secrets Manager Read | `secretsmanager:GetSecretValue` | `arn:aws:secretsmanager:...:secret:cis-file-scanner/dev/database-*` | None | ✅ Allowed |
| Secrets Manager Update | `secretsmanager:UpdateSecret` | Same | None | ❌ Denied |

---

## Multi-Environment Role Strategy

### Environment Isolation Strategy

**Security Principle**: Each environment (dev, staging, prod) must have separate IAM roles with zero cross-environment access.

**Why?**:
- **Prevent Production Data Leakage**: Dev environment should never access prod S3 buckets
- **Blast Radius Containment**: Compromise of dev environment doesn't affect prod
- **Compliance**: Required for SOC 2 Type II (segregation of environments)

### Naming Convention

```
Role Name: CISFileScannerEC2Role-{environment}
Policy Name: CISFileScanner{Service}Access-{environment}

Examples:
- CISFileScannerEC2Role-dev
- CISFileScannerS3Access-dev
- CISFileScannerEC2Role-staging
- CISFileScannerS3Access-staging
- CISFileScannerEC2Role-prod
- CISFileScannerS3Access-prod
```

### Resource ARN Patterns

| Environment | S3 Bucket | SQS Queue | Secrets Manager |
|-------------|-----------|-----------|-----------------|
| **dev** | `cis-file-scanner-dev-metadata` | `cis-file-scanner-dev-queue` | `cis-file-scanner/dev/database` |
| **staging** | `cis-file-scanner-staging-metadata` | `cis-file-scanner-staging-queue` | `cis-file-scanner/staging/database` |
| **prod** | `cis-file-scanner-prod-metadata` | `cis-file-scanner-prod-queue` | `cis-file-scanner/prod/database` |

### Session Duration by Environment

**Security Trade-off**: Shorter sessions = better security but more token refreshes

| Environment | Max Session Duration | Rationale |
|-------------|---------------------|-----------|
| **dev** | 3600 seconds (1 hour) | Developers need longer sessions for debugging |
| **staging** | 3600 seconds (1 hour) | Balance between security and usability |
| **prod** | 3600 seconds (1 hour) | AWS default, good balance for EC2 instances |

**Note**: For production, consider **1 hour** as standard. EC2 instances will auto-refresh credentials before expiration.

### Cross-Environment Access Prevention

Add explicit deny conditions to prevent cross-environment access:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyAccessToOtherEnvironments",
      "Effect": "Deny",
      "Action": [
        "s3:*",
        "sqs:*",
        "secretsmanager:*"
      ],
      "Resource": [
        "arn:aws:s3:::cis-file-scanner-staging-*",
        "arn:aws:s3:::cis-file-scanner-prod-*",
        "arn:aws:sqs:*:*:cis-file-scanner-staging-*",
        "arn:aws:sqs:*:*:cis-file-scanner-prod-*",
        "arn:aws:secretsmanager:*:*:secret:cis-file-scanner/staging/*",
        "arn:aws:secretsmanager:*:*:secret:cis-file-scanner/prod/*"
      ]
    }
  ]
}
```

**Attach to dev role**:

```bash
aws iam put-role-policy \
  --role-name CISFileScannerEC2Role-dev \
  --policy-name DenyOtherEnvironments \
  --policy-document file:///tmp/deny-other-environments.json
```

---

## Common Security Mistakes

### ❌ Mistake 1: Using Wildcard (*) Permissions

**Bad Policy**:
```json
{
  "Effect": "Allow",
  "Action": "s3:*",
  "Resource": "*"
}
```

**Why It's Dangerous**:
- Grants access to ALL S3 buckets (including other applications' buckets)
- Allows destructive operations (DeleteBucket, PutBucketPolicy)
- Violates least privilege principle

**CVSS Score**: 8.5 (High) - Excessive Privilege

**Fix**: Use specific actions and resources:
```json
{
  "Effect": "Allow",
  "Action": ["s3:GetObject", "s3:PutObject"],
  "Resource": "arn:aws:s3:::cis-file-scanner-dev-metadata/*"
}
```

---

### ❌ Mistake 2: Overly Permissive Trust Relationships

**Bad Trust Policy**:
```json
{
  "Effect": "Allow",
  "Principal": {
    "AWS": "*"
  },
  "Action": "sts:AssumeRole"
}
```

**Why It's Dangerous**:
- ANY AWS account (even external attackers) can assume the role
- No authentication required

**CVSS Score**: 9.8 (Critical) - Broken Access Control

**Fix**: Restrict to specific service or account:
```json
{
  "Effect": "Allow",
  "Principal": {
    "Service": "ec2.amazonaws.com"
  },
  "Action": "sts:AssumeRole",
  "Condition": {
    "StringEquals": {
      "aws:SourceAccount": "123456789012"
    }
  }
}
```

---

### ❌ Mistake 3: No Condition Keys for Encryption

**Bad Policy**:
```json
{
  "Effect": "Allow",
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::my-bucket/*"
}
```

**Why It's Dangerous**:
- Allows unencrypted uploads (GDPR Article 32 violation)
- Sensitive file metadata could be stored in plaintext

**CVSS Score**: 7.5 (High) - Cryptographic Failure

**Fix**: Enforce encryption:
```json
{
  "Effect": "Deny",
  "Action": "s3:PutObject",
  "Resource": "arn:aws:s3:::my-bucket/*",
  "Condition": {
    "StringNotEquals": {
      "s3:x-amz-server-side-encryption": ["AES256", "aws:kms"]
    }
  }
}
```

---

### ❌ Mistake 4: Hardcoded Credentials in Code

**Bad Code**:
```javascript
const AWS = require('aws-sdk');

AWS.config.update({
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
});
```

**Why It's Dangerous**:
- Credentials in code can be committed to Git (even if deleted, history persists)
- Credentials are static (no rotation)
- Violates OWASP A02:2021 (Cryptographic Failures)

**CVSS Score**: 9.1 (Critical) - Hard-coded Credentials

**Fix**: Use IAM roles (for EC2) or environment variables:
```javascript
// For EC2: Credentials auto-loaded from instance metadata
const AWS = require('aws-sdk');
// No credentials needed!

// For local development: Use environment variables
const AWS = require('aws-sdk');
AWS.config.update({
  region: process.env.AWS_REGION
});
```

---

### ❌ Mistake 5: Not Enforcing IMDSv2

**Bad EC2 Launch**:
```bash
aws ec2 run-instances \
  --image-id ami-12345678 \
  --instance-type t3.small \
  --iam-instance-profile Name=CISFileScannerEC2Profile-dev
  # ⚠️ IMDSv1 is enabled by default!
```

**Why It's Dangerous**:
- IMDSv1 is vulnerable to SSRF attacks
- Attacker can steal IAM credentials via SSRF: `curl http://169.254.169.254/latest/meta-data/iam/security-credentials/`

**CVSS Score**: 8.8 (High) - SSRF to Credential Theft

**Fix**: Enforce IMDSv2:
```bash
aws ec2 run-instances \
  --image-id ami-12345678 \
  --instance-type t3.small \
  --iam-instance-profile Name=CISFileScannerEC2Profile-dev \
  --metadata-options "HttpTokens=required,HttpPutResponseHopLimit=1"
```

**What This Does**:
- `HttpTokens=required`: Forces applications to use IMDSv2 (session-based)
- `HttpPutResponseHopLimit=1`: Prevents SSRF via forwarded requests

---

### ❌ Mistake 6: No CloudTrail Logging for IAM Changes

**Bad Setup**: CloudTrail not enabled or not logging IAM events

**Why It's Dangerous**:
- No audit trail of who modified policies
- Cannot detect unauthorized role assumptions
- Violates SOC 2, ISO 27001, PCI-DSS requirements

**CVSS Score**: 6.5 (Medium) - Security Logging and Monitoring Failures

**Fix**: Enable CloudTrail with management events:
```bash
aws cloudtrail create-trail \
  --name cis-file-scanner-audit-trail \
  --s3-bucket-name cis-audit-logs-123456789012

aws cloudtrail start-logging \
  --name cis-file-scanner-audit-trail
```

**What to Monitor**:
- `AssumeRole` calls (who accessed the role)
- `AttachRolePolicy`, `PutRolePolicy` (policy modifications)
- `CreateAccessKey`, `DeleteAccessKey` (access key management)

---

## Incident Response

### Scenario 1: EC2 Instance Compromised

**Indicators**:
- Unusual API calls in CloudTrail (e.g., `DescribeInstances` in other regions)
- Spike in S3 GetObject requests
- Unauthorized SQS messages

**Immediate Actions** (execute within 15 minutes):

1. **Revoke Session Credentials**:
```bash
# Get instance ID of compromised instance
INSTANCE_ID="i-0123456789abcdef0"

# Terminate the instance (forces credential revocation)
aws ec2 terminate-instances --instance-ids $INSTANCE_ID

# Alternative: Stop the instance (preserves data for forensics)
aws ec2 stop-instances --instance-ids $INSTANCE_ID
```

2. **Detach IAM Role** (if keeping instance running for forensics):
```bash
aws ec2 disassociate-iam-instance-profile \
  --association-id $(aws ec2 describe-iam-instance-profile-associations \
    --filters "Name=instance-id,Values=$INSTANCE_ID" \
    --query 'IamInstanceProfileAssociations[0].AssociationId' \
    --output text)
```

3. **Attach Deny-All Policy** (prevent further damage):
```bash
cat > /tmp/deny-all-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Action": "*",
      "Resource": "*"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name CISFileScannerEC2Role-dev \
  --policy-name EmergencyDenyAll \
  --policy-document file:///tmp/deny-all-policy.json
```

4. **Check CloudTrail for Blast Radius**:
```bash
# Get all API calls from the compromised role in last 24 hours
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=CISFileScannerEC2Role-dev \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%S) \
  --max-items 1000 > /tmp/cloudtrail-events.json

# Analyze events for malicious activity
grep -E "(DeleteBucket|PutBucketPolicy|DeleteSecret|UpdateSecret)" /tmp/cloudtrail-events.json
```

5. **Rotate Secrets** (assume attacker read database credentials):
```bash
# Trigger secret rotation
aws secretsmanager rotate-secret \
  --secret-id cis-file-scanner/dev/database

# Update application to use new credentials
# (This should be automated via Secrets Manager rotation Lambda)
```

**Forensics** (within 1-2 hours):
- Capture EBS snapshot before terminating instance
- Analyze application logs for entry point (SSRF, RCE, etc.)
- Check S3 access logs for data exfiltration

---

### Scenario 2: IAM Policy Modified by Attacker

**Indicators**:
- CloudTrail alert for `AttachRolePolicy` or `PutRolePolicy` by unauthorized user
- Permissions escalation (role can now access more resources)

**Immediate Actions**:

1. **Revert Policy to Known Good Version**:
```bash
# List policy versions
aws iam list-policy-versions \
  --policy-arn arn:aws:iam::123456789012:policy/CISFileScannerS3Access-dev

# Set previous version as default
aws iam set-default-policy-version \
  --policy-arn arn:aws:iam::123456789012:policy/CISFileScannerS3Access-dev \
  --version-id v2
```

2. **Delete Malicious Policy Version**:
```bash
aws iam delete-policy-version \
  --policy-arn arn:aws:iam::123456789012:policy/CISFileScannerS3Access-dev \
  --version-id v3
```

3. **Revoke IAM User's Permissions** (if insider threat):
```bash
# Attach deny-all policy to user
aws iam attach-user-policy \
  --user-name suspicious-user \
  --policy-arn arn:aws:iam::aws:policy/AWSDenyAll

# Rotate access keys
aws iam list-access-keys --user-name suspicious-user
aws iam delete-access-key --user-name suspicious-user --access-key-id AKIAIOSFODNN7EXAMPLE
```

---

### Scenario 3: Secrets Manager Secret Exposed

**Indicators**:
- Database credentials found in public GitHub repository
- Unauthorized database access from unknown IP

**Immediate Actions**:

1. **Rotate Secret Immediately**:
```bash
# Force immediate rotation (not waiting for schedule)
aws secretsmanager rotate-secret \
  --secret-id cis-file-scanner/dev/database \
  --rotation-lambda-arn arn:aws:lambda:ap-northeast-1:123456789012:function:SecretsManagerRotation \
  --rotate-immediately
```

2. **Revoke Old Database Credentials**:
```sql
-- Connect to database with admin credentials
-- Revoke permissions from compromised user
REVOKE ALL PRIVILEGES ON DATABASE cis_file_scanner FROM app_user;
DROP USER app_user;

-- Create new user (will be done by Secrets Manager rotation Lambda)
```

3. **Check Database Audit Logs**:
```bash
# Enable RDS query logging (if not already enabled)
aws rds modify-db-instance \
  --db-instance-identifier cis-file-scanner-dev \
  --cloudwatch-logs-export-configuration '{"EnableLogTypes":["audit","error","general","slowquery"]}' \
  --apply-immediately

# Download recent logs
aws rds download-db-log-file-portion \
  --db-instance-identifier cis-file-scanner-dev \
  --log-file-name audit/audit.log \
  --output text > /tmp/db-audit.log

# Search for suspicious queries
grep -E "(DROP|DELETE|TRUNCATE)" /tmp/db-audit.log
```

4. **Scan GitHub for Leaked Secrets**:
```bash
# Use git-secrets or TruffleHog to scan repositories
pip install truffleHog
trufflehog --regex --entropy=True https://github.com/your-org/your-repo
```

---

## Cost vs Security Tradeoffs

### 1. CloudTrail Logging

**Security**: P0 (Critical) - Required for audit, compliance, forensics

| Option | Cost/Month | Security Level | Compliance |
|--------|-----------|----------------|------------|
| **No CloudTrail** | $0 | ❌ Unacceptable | ❌ Fails SOC 2, ISO 27001, PCI-DSS |
| **CloudTrail (management events only)** | ~$2 | ✅ Good | ✅ Meets minimum requirements |
| **CloudTrail (all events + S3 data events)** | ~$15-50 | ✅ Excellent | ✅ Exceeds requirements |

**Recommendation**: **Management events only** for cost efficiency. S3 data events generate massive volume.

**Cost Breakdown**:
- First trail: Free for management events
- S3 data events: $0.10 per 100,000 events (can get expensive quickly)

---

### 2. Secrets Manager vs Parameter Store

**Security**: Both are acceptable, but Secrets Manager has better rotation

| Feature | Secrets Manager | Parameter Store (SecureString) |
|---------|----------------|------------------------------|
| **Cost** | $0.40/secret/month + $0.05/10k API calls | Free (up to 10k params) |
| **Automatic Rotation** | ✅ Built-in Lambda integration | ❌ Manual rotation required |
| **Versioning** | ✅ Automatic | ✅ Manual |
| **Encryption** | ✅ KMS (required) | ✅ KMS (optional) |
| **Compliance** | ✅ Easier to demonstrate rotation | ⚠️ Need to show manual rotation process |

**Cost Comparison** (for 5 secrets):
- Secrets Manager: $2/month + API calls
- Parameter Store: Free

**Recommendation**:
- **Production**: Secrets Manager (automatic rotation is worth $2/month)
- **Development**: Parameter Store (acceptable for dev environment)

---

### 3. IMDSv2 Enforcement

**Security**: P0 (Critical) - Prevents SSRF-based credential theft

| Option | Cost | Security Impact |
|--------|------|-----------------|
| **IMDSv1 (default)** | $0 | ❌ Vulnerable to SSRF attacks |
| **IMDSv2 (enforced)** | $0 | ✅ Protects against SSRF |

**Recommendation**: **Always enforce IMDSv2**. Zero cost, massive security benefit.

---

### 4. KMS Customer Managed Keys vs AWS Managed Keys

**Security**: Both are encrypted, CMK provides more control

| Option | Cost | Use Case |
|--------|------|----------|
| **AWS Managed Keys** | Free | Good for most use cases |
| **Customer Managed Keys (CMK)** | $1/month + $0.03/10k requests | Required for cross-account access, custom rotation |

**Recommendation**:
- **Development**: AWS managed keys (free)
- **Production**: Consider CMK if you need:
  - Custom key rotation schedule
  - Cross-account access
  - Key usage audit trails

---

### 5. Session Duration

**Security**: Shorter sessions = more secure but more token refreshes

| Session Duration | Security | Performance Impact |
|-----------------|----------|-------------------|
| **1 hour** | ✅ Good balance | Minimal (EC2 auto-refreshes) |
| **4 hours** | ⚠️ Acceptable | Slightly less token refreshes |
| **12 hours (max)** | ❌ Too long | Not recommended |

**Recommendation**: **1 hour** (AWS default). Good balance for EC2 instances.

**Cost Impact**: None (token refreshes are free API calls)

---

## Verification Checklist

Before deploying to production, verify:

### IAM Role Configuration
- [ ] Role name follows convention: `CISFileScannerEC2Role-{env}`
- [ ] Instance profile created and role attached
- [ ] Max session duration set to 3600 seconds (1 hour)
- [ ] Trust relationship restricts to EC2 service
- [ ] `sts:ExternalId` condition added to trust policy
- [ ] `aws:SourceAccount` condition added to trust policy

### Least Privilege Policies
- [ ] S3 policy restricts to specific bucket ARN
- [ ] S3 policy denies unencrypted uploads
- [ ] S3 policy denies insecure transport (HTTP)
- [ ] SQS policy restricts to specific queue ARN
- [ ] CloudWatch Logs policy restricts to specific log group
- [ ] Secrets Manager policy is read-only
- [ ] No wildcard (*) permissions on sensitive resources
- [ ] Cross-environment access explicitly denied

### Security Controls
- [ ] IMDSv2 enforced on EC2 instances
- [ ] CloudTrail enabled for management events
- [ ] Secrets stored in Secrets Manager (not .env files)
- [ ] No hardcoded credentials in code
- [ ] All S3 buckets have Block Public Access enabled
- [ ] All secrets use KMS encryption

### Testing
- [ ] IAM Policy Simulator tests passed
- [ ] Application successfully retrieves secrets
- [ ] Application successfully writes to S3
- [ ] Application successfully sends SQS messages
- [ ] Application successfully writes CloudWatch logs
- [ ] Unauthorized actions are denied (verified via simulation)

### Compliance
- [ ] CloudTrail logs retained for 90 days (SOC 2 requirement)
- [ ] IAM policy changes require approval (documented process)
- [ ] Access reviews scheduled quarterly
- [ ] Secrets rotation enabled (every 90 days)

---

## Next Steps

1. **Complete this IAM configuration** ✅
2. **Proceed to**: [AWS Secrets Manager Guide](./aws-secrets-manager-guide.md)
3. **Then**: [Security Best Practices Guide](./security-best-practices-guide.md)
4. **Finally**: [Compliance Mapping](./compliance-mapping.md)

---

## References

- [AWS IAM Best Practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [OWASP A01:2021 - Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/)
- [CIS AWS Foundations Benchmark](https://www.cisecurity.org/benchmark/amazon_web_services)
- [SOC 2 Trust Services Criteria](https://www.aicpa.org/interestareas/frc/assuranceadvisoryservices/socforserviceorganizations.html)
- [GDPR Article 32 - Security of Processing](https://gdpr-info.eu/art-32-gdpr/)

---

**Document Version**: 1.0
**Last Updated**: 2025-01-12
**Author**: Security & Compliance Expert
**Classification**: Internal Use - Security Sensitive
