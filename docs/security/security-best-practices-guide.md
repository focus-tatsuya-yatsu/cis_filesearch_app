# AWS Security Best Practices Guide

## Table of Contents

1. [Introduction](#introduction)
2. [MFA for AWS Console Access](#mfa-for-aws-console-access)
3. [CloudTrail Setup for Audit Logging](#cloudtrail-setup-for-audit-logging)
4. [AWS Config for Compliance Monitoring](#aws-config-for-compliance-monitoring)
5. [Security Hub Integration](#security-hub-integration)
6. [Amazon GuardDuty for Threat Detection](#amazon-guardduty-for-threat-detection)
7. [S3 Block Public Access Settings](#s3-block-public-access-settings)
8. [Encryption at Rest and In Transit](#encryption-at-rest-and-in-transit)
9. [VPC Security Architecture](#vpc-security-architecture)
10. [Security Monitoring & Alerting](#security-monitoring--alerting)
11. [Cost vs Security Tradeoffs](#cost-vs-security-tradeoffs)

---

## Introduction

This guide provides comprehensive security best practices for the CIS File Scanner Backend infrastructure on AWS. These practices implement **Defense in Depth** - multiple layers of security controls to protect against various attack vectors.

**Security Priority**: P0 (Critical)

**Threat Model**: This guide protects against:
- Unauthorized AWS Console access
- Data breaches and exfiltration
- Malware and cryptomining attacks
- Privilege escalation
- Compliance violations
- Insider threats

---

## MFA for AWS Console Access

### Threat Model

**Attack Vector**: Credential Compromise (CVSS 9.8 - Critical)
- **Scenario**: Attacker obtains AWS Console password via phishing, password reuse, or data breach
- **Impact**: Full account access, data breach, resource deletion, cryptomining ($10,000+ bills)
- **Real-world Example**: Capital One breach (2019) - compromised credentials led to 100 million records stolen

**Security Control**: Multi-Factor Authentication (MFA)
- Even with stolen password, attacker needs physical MFA device
- Reduces account compromise risk by 99.9% (per Microsoft security research)

---

### Step 1: Enable MFA for Root Account (Critical - P0)

**Security Rationale**: Root account has unrestricted access. Compromise = full account takeover.

#### Console Steps

1. Sign in to AWS Console with root account
2. Click **account name** (top right) → **Security credentials**
3. Under **Multi-factor authentication (MFA)**, click **Activate MFA**
4. Select **MFA device type**:
   - **Virtual MFA device** (Google Authenticator, Authy) - Recommended for most users
   - **Hardware MFA device** (YubiKey) - Best security (requires physical possession)
   - **SMS MFA** - ❌ NOT RECOMMENDED (vulnerable to SIM swapping attacks)
5. For Virtual MFA:
   - Open Google Authenticator app on phone
   - Scan QR code shown in Console
   - Enter two consecutive MFA codes
   - Click **Assign MFA**
6. **Critical**: Store recovery codes in secure location (password manager)

#### CLI Steps

```bash
# Enable virtual MFA for root account
aws iam enable-mfa-device \
  --user-name root \
  --serial-number arn:aws:iam::123456789012:mfa/root-account-mfa-device \
  --authentication-code-1 123456 \
  --authentication-code-2 789012

# Verify MFA enabled
aws iam list-mfa-devices --user-name root

# Expected output:
# {
#   "MFADevices": [
#     {
#       "UserName": "root",
#       "SerialNumber": "arn:aws:iam::123456789012:mfa/root-account-mfa-device",
#       "EnableDate": "2025-01-12T10:00:00Z"
#     }
#   ]
# }
```

---

### Step 2: Enable MFA for IAM Users

**Security Policy**: **ALL** IAM users must have MFA enabled. No exceptions.

```bash
# List all IAM users without MFA
aws iam list-users --query 'Users[*].[UserName]' --output text | while read user; do
  mfa_devices=$(aws iam list-mfa-devices --user-name $user --query 'MFADevices' --output text)
  if [ -z "$mfa_devices" ]; then
    echo "⚠️ WARNING: User $user has NO MFA enabled"
  fi
done

# Enable virtual MFA for IAM user
aws iam enable-mfa-device \
  --user-name developer1 \
  --serial-number arn:aws:iam::123456789012:mfa/developer1 \
  --authentication-code-1 123456 \
  --authentication-code-2 789012
```

---

### Step 3: Enforce MFA with IAM Policy

**Security Control**: Users without MFA cannot access ANY AWS resources.

#### Create MFA Enforcement Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowViewAccountInfo",
      "Effect": "Allow",
      "Action": [
        "iam:GetAccountPasswordPolicy",
        "iam:ListVirtualMFADevices"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AllowManageOwnVirtualMFADevice",
      "Effect": "Allow",
      "Action": [
        "iam:CreateVirtualMFADevice",
        "iam:DeleteVirtualMFADevice"
      ],
      "Resource": "arn:aws:iam::*:mfa/${aws:username}"
    },
    {
      "Sid": "AllowManageOwnUserMFA",
      "Effect": "Allow",
      "Action": [
        "iam:DeactivateMFADevice",
        "iam:EnableMFADevice",
        "iam:ListMFADevices",
        "iam:ResyncMFADevice"
      ],
      "Resource": "arn:aws:iam::*:user/${aws:username}"
    },
    {
      "Sid": "DenyAllExceptListedIfNoMFA",
      "Effect": "Deny",
      "NotAction": [
        "iam:CreateVirtualMFADevice",
        "iam:EnableMFADevice",
        "iam:ListMFADevices",
        "iam:ListUsers",
        "iam:ListVirtualMFADevices",
        "iam:ResyncMFADevice",
        "sts:GetSessionToken"
      ],
      "Resource": "*",
      "Condition": {
        "BoolIfExists": {
          "aws:MultiFactorAuthPresent": "false"
        }
      }
    }
  ]
}
```

**How It Works**:
- Users can ONLY manage their own MFA device until MFA is enabled
- After MFA is enabled, full access is granted
- Without MFA, users are locked out (except for MFA setup actions)

#### Attach Policy to All Users

```bash
# Create policy
cat > /tmp/mfa-enforcement-policy.json << 'EOF'
[Insert JSON above]
EOF

aws iam create-policy \
  --policy-name EnforceMFAPolicy \
  --policy-document file:///tmp/mfa-enforcement-policy.json \
  --description "Enforce MFA for all IAM users"

# Attach to all users
POLICY_ARN=$(aws iam list-policies \
  --query 'Policies[?PolicyName==`EnforceMFAPolicy`].Arn' \
  --output text)

aws iam list-users --query 'Users[*].UserName' --output text | while read user; do
  aws iam attach-user-policy \
    --user-name $user \
    --policy-arn $POLICY_ARN
  echo "✅ Attached MFA enforcement policy to $user"
done
```

---

### Step 4: Test MFA Enforcement

```bash
# Try accessing AWS without MFA (should fail)
aws s3 ls

# Expected error:
# An error occurred (AccessDenied) when calling the ListBuckets operation:
# User is not authorized to perform this operation without MFA.

# Get session token with MFA
aws sts get-session-token \
  --serial-number arn:aws:iam::123456789012:mfa/your-username \
  --token-code 123456 \
  --duration-seconds 129600

# Expected output:
# {
#   "Credentials": {
#     "AccessKeyId": "ASIAIOSFODNN7EXAMPLE",
#     "SecretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
#     "SessionToken": "FwoGZXIvYXdzEBYaDKr...",
#     "Expiration": "2025-01-13T10:00:00Z"
#   }
# }

# Use temporary credentials
export AWS_ACCESS_KEY_ID=ASIAIOSFODNN7EXAMPLE
export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
export AWS_SESSION_TOKEN=FwoGZXIvYXdzEBYaDKr...

# Now commands work
aws s3 ls
```

---

## CloudTrail Setup for Audit Logging

### Threat Model

**Attack Vector**: Lack of Audit Trail (CVSS 6.5 - Medium)
- **Scenario**: Attacker gains access, performs malicious actions (data exfiltration, resource deletion)
- **Impact**: No forensic evidence, can't identify what was stolen/modified
- **Compliance Violation**: SOC 2, ISO 27001, PCI-DSS require audit logging

**Security Control**: CloudTrail
- Logs every API call (who, what, when, where)
- Immutable audit trail (S3 with versioning + MFA delete)
- Enables forensic investigation and compliance audits

---

### Step 1: Create S3 Bucket for CloudTrail Logs

```bash
# Create bucket with versioning and encryption
aws s3api create-bucket \
  --bucket cis-cloudtrail-logs-123456789012 \
  --region ap-northeast-1 \
  --create-bucket-configuration LocationConstraint=ap-northeast-1

# Enable versioning (prevents log deletion)
aws s3api put-bucket-versioning \
  --bucket cis-cloudtrail-logs-123456789012 \
  --versioning-configuration Status=Enabled,MFADelete=Enabled \
  --mfa "arn:aws:iam::123456789012:mfa/root-account-mfa-device 123456"

# Enable default encryption
aws s3api put-bucket-encryption \
  --bucket cis-cloudtrail-logs-123456789012 \
  --server-side-encryption-configuration '{
    "Rules": [
      {
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "AES256"
        }
      }
    ]
  }'

# Block public access (critical!)
aws s3api put-public-access-block \
  --bucket cis-cloudtrail-logs-123456789012 \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Enable object lock for immutability (compliance requirement)
aws s3api put-object-lock-configuration \
  --bucket cis-cloudtrail-logs-123456789012 \
  --object-lock-configuration '{
    "ObjectLockEnabled": "Enabled",
    "Rule": {
      "DefaultRetention": {
        "Mode": "COMPLIANCE",
        "Days": 90
      }
    }
  }'
```

**Security Notes**:
- **Versioning**: Prevents log tampering (deleted logs remain in version history)
- **MFA Delete**: Requires MFA to delete log files (prevents attacker from covering tracks)
- **Object Lock**: Makes logs immutable for 90 days (WORM - Write Once Read Many)

---

### Step 2: Apply Bucket Policy for CloudTrail

```bash
# Create bucket policy
cat > /tmp/cloudtrail-bucket-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AWSCloudTrailAclCheck",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudtrail.amazonaws.com"
      },
      "Action": "s3:GetBucketAcl",
      "Resource": "arn:aws:s3:::cis-cloudtrail-logs-123456789012"
    },
    {
      "Sid": "AWSCloudTrailWrite",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudtrail.amazonaws.com"
      },
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::cis-cloudtrail-logs-123456789012/AWSLogs/123456789012/*",
      "Condition": {
        "StringEquals": {
          "s3:x-amz-acl": "bucket-owner-full-control"
        }
      }
    },
    {
      "Sid": "DenyUnencryptedObjectUploads",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::cis-cloudtrail-logs-123456789012/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption": "AES256"
        }
      }
    },
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::cis-cloudtrail-logs-123456789012",
        "arn:aws:s3:::cis-cloudtrail-logs-123456789012/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
EOF

aws s3api put-bucket-policy \
  --bucket cis-cloudtrail-logs-123456789012 \
  --policy file:///tmp/cloudtrail-bucket-policy.json
```

---

### Step 3: Create Multi-Region CloudTrail

```bash
# Create trail
aws cloudtrail create-trail \
  --name cis-file-scanner-audit-trail \
  --s3-bucket-name cis-cloudtrail-logs-123456789012 \
  --is-multi-region-trail \
  --include-global-service-events \
  --enable-log-file-validation

# Start logging
aws cloudtrail start-logging \
  --name cis-file-scanner-audit-trail

# Enable CloudWatch Logs integration (for real-time monitoring)
aws cloudtrail update-trail \
  --name cis-file-scanner-audit-trail \
  --cloud-watch-logs-log-group-arn arn:aws:logs:ap-northeast-1:123456789012:log-group:/aws/cloudtrail/cis-file-scanner:* \
  --cloud-watch-logs-role-arn arn:aws:iam::123456789012:role/CloudTrailCloudWatchLogsRole

# Verify trail is logging
aws cloudtrail get-trail-status \
  --name cis-file-scanner-audit-trail

# Expected output:
# {
#   "IsLogging": true,
#   "LatestDeliveryTime": 1736678400.0,
#   "StartLoggingTime": 1736677500.0
# }
```

**What Gets Logged**:
- **Management Events**: API calls (CreateBucket, PutObject, AssumeRole, etc.)
- **Data Events**: S3 object-level operations (GetObject, PutObject) - optional, can be expensive
- **Insights Events**: Anomalous API activity (e.g., sudden spike in EC2 launches)

---

### Step 4: Configure Data Events (Optional)

**Cost Warning**: Data events are expensive ($0.10 per 100,000 events). Only enable for critical buckets.

```bash
# Enable S3 data events for file scanner bucket only
aws cloudtrail put-event-selectors \
  --trail-name cis-file-scanner-audit-trail \
  --event-selectors '[
    {
      "ReadWriteType": "All",
      "IncludeManagementEvents": true,
      "DataResources": [
        {
          "Type": "AWS::S3::Object",
          "Values": [
            "arn:aws:s3:::cis-file-scanner-prod-metadata/*"
          ]
        }
      ]
    }
  ]'
```

**Recommendation**: Skip data events for dev/staging. Enable only for production if budget allows.

---

### Step 5: Set Up CloudTrail Alerts

**Security Monitoring**: Alert on suspicious API calls.

```bash
# Create metric filter for root account usage (should NEVER happen)
aws logs put-metric-filter \
  --log-group-name /aws/cloudtrail/cis-file-scanner \
  --filter-name RootAccountUsage \
  --filter-pattern '{ $.userIdentity.type = "Root" && $.userIdentity.invokedBy NOT EXISTS && $.eventType != "AwsServiceEvent" }' \
  --metric-transformations \
    metricName=RootAccountUsage,metricNamespace=CISFileScannerSecurity,metricValue=1

# Create alarm
aws cloudwatch put-metric-alarm \
  --alarm-name CIS-RootAccountUsage \
  --alarm-description "Alert when root account is used (should NEVER happen)" \
  --metric-name RootAccountUsage \
  --namespace CISFileScannerSecurity \
  --statistic Sum \
  --period 60 \
  --evaluation-periods 1 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --actions-enabled \
  --alarm-actions arn:aws:sns:ap-northeast-1:123456789012:SecurityAlerts-Critical

# Additional alerts
# 1. Unauthorized API calls
aws logs put-metric-filter \
  --log-group-name /aws/cloudtrail/cis-file-scanner \
  --filter-name UnauthorizedAPICalls \
  --filter-pattern '{ ($.errorCode = "*UnauthorizedOperation") || ($.errorCode = "AccessDenied*") }' \
  --metric-transformations \
    metricName=UnauthorizedAPICalls,metricNamespace=CISFileScannerSecurity,metricValue=1

# 2. IAM policy changes
aws logs put-metric-filter \
  --log-group-name /aws/cloudtrail/cis-file-scanner \
  --filter-name IAMPolicyChanges \
  --filter-pattern '{($.eventName=DeleteGroupPolicy) || ($.eventName=DeleteRolePolicy) || ($.eventName=DeleteUserPolicy) || ($.eventName=PutGroupPolicy) || ($.eventName=PutRolePolicy) || ($.eventName=PutUserPolicy) || ($.eventName=CreatePolicy) || ($.eventName=DeletePolicy) || ($.eventName=CreatePolicyVersion) || ($.eventName=DeletePolicyVersion) || ($.eventName=AttachRolePolicy) || ($.eventName=DetachRolePolicy) || ($.eventName=AttachUserPolicy) || ($.eventName=DetachUserPolicy) || ($.eventName=AttachGroupPolicy) || ($.eventName=DetachGroupPolicy)}' \
  --metric-transformations \
    metricName=IAMPolicyChanges,metricNamespace=CISFileScannerSecurity,metricValue=1

# 3. S3 bucket policy changes
aws logs put-metric-filter \
  --log-group-name /aws/cloudtrail/cis-file-scanner \
  --filter-name S3BucketPolicyChanges \
  --filter-pattern '{($.eventSource = s3.amazonaws.com) && (($.eventName = PutBucketAcl) || ($.eventName = PutBucketPolicy) || ($.eventName = PutBucketCors) || ($.eventName = PutBucketLifecycle) || ($.eventName = PutBucketReplication) || ($.eventName = DeleteBucketPolicy) || ($.eventName = DeleteBucketCors) || ($.eventName = DeleteBucketLifecycle) || ($.eventName = DeleteBucketReplication))}' \
  --metric-transformations \
    metricName=S3BucketPolicyChanges,metricNamespace=CISFileScannerSecurity,metricValue=1

# 4. Security group changes
aws logs put-metric-filter \
  --log-group-name /aws/cloudtrail/cis-file-scanner \
  --filter-name SecurityGroupChanges \
  --filter-pattern '{($.eventName = AuthorizeSecurityGroupIngress) || ($.eventName = AuthorizeSecurityGroupEgress) || ($.eventName = RevokeSecurityGroupIngress) || ($.eventName = RevokeSecurityGroupEgress) || ($.eventName = CreateSecurityGroup) || ($.eventName = DeleteSecurityGroup)}' \
  --metric-transformations \
    metricName=SecurityGroupChanges,metricNamespace=CISFileScannerSecurity,metricValue=1
```

---

## AWS Config for Compliance Monitoring

### Threat Model

**Attack Vector**: Configuration Drift (CVSS 7.2 - High)
- **Scenario**: Developer accidentally disables S3 encryption, opens security group to 0.0.0.0/0
- **Impact**: Data exposure, compliance violations, potential breach
- **Real-world Example**: Misconfigured S3 buckets are the #1 cause of cloud data breaches

**Security Control**: AWS Config
- Continuously monitors resource configurations
- Alerts on non-compliant resources (e.g., unencrypted S3 buckets)
- Provides compliance dashboard for SOC 2, PCI-DSS, HIPAA

---

### Step 1: Enable AWS Config

```bash
# Create S3 bucket for Config snapshots
aws s3api create-bucket \
  --bucket cis-config-snapshots-123456789012 \
  --region ap-northeast-1 \
  --create-bucket-configuration LocationConstraint=ap-northeast-1

# Enable versioning and encryption
aws s3api put-bucket-versioning \
  --bucket cis-config-snapshots-123456789012 \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket cis-config-snapshots-123456789012 \
  --server-side-encryption-configuration '{
    "Rules": [
      {
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "AES256"
        }
      }
    ]
  }'

# Create IAM role for Config
cat > /tmp/config-trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "config.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

aws iam create-role \
  --role-name AWSConfigRole \
  --assume-role-policy-document file:///tmp/config-trust-policy.json

# Attach managed policy
aws iam attach-role-policy \
  --role-name AWSConfigRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/ConfigRole

# Enable AWS Config
aws configservice put-configuration-recorder \
  --configuration-recorder name=default,roleARN=arn:aws:iam::123456789012:role/AWSConfigRole \
  --recording-group allSupported=true,includeGlobalResourceTypes=true

aws configservice put-delivery-channel \
  --delivery-channel name=default,s3BucketName=cis-config-snapshots-123456789012

aws configservice start-configuration-recorder \
  --configuration-recorder-name default
```

---

### Step 2: Enable Managed Config Rules

**Security Rules** (CIS AWS Foundations Benchmark):

```bash
# Rule 1: S3 buckets must have encryption enabled
aws configservice put-config-rule \
  --config-rule '{
    "ConfigRuleName": "s3-bucket-server-side-encryption-enabled",
    "Source": {
      "Owner": "AWS",
      "SourceIdentifier": "S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED"
    }
  }'

# Rule 2: S3 buckets must block public access
aws configservice put-config-rule \
  --config-rule '{
    "ConfigRuleName": "s3-bucket-public-read-prohibited",
    "Source": {
      "Owner": "AWS",
      "SourceIdentifier": "S3_BUCKET_PUBLIC_READ_PROHIBITED"
    }
  }'

# Rule 3: IAM users must have MFA enabled
aws configservice put-config-rule \
  --config-rule '{
    "ConfigRuleName": "iam-user-mfa-enabled",
    "Source": {
      "Owner": "AWS",
      "SourceIdentifier": "IAM_USER_MFA_ENABLED"
    }
  }'

# Rule 4: Root account must have MFA
aws configservice put-config-rule \
  --config-rule '{
    "ConfigRuleName": "root-account-mfa-enabled",
    "Source": {
      "Owner": "AWS",
      "SourceIdentifier": "ROOT_ACCOUNT_MFA_ENABLED"
    }
  }'

# Rule 5: CloudTrail must be enabled
aws configservice put-config-rule \
  --config-rule '{
    "ConfigRuleName": "cloudtrail-enabled",
    "Source": {
      "Owner": "AWS",
      "SourceIdentifier": "CLOUD_TRAIL_ENABLED"
    }
  }'

# Rule 6: RDS instances must have encryption enabled
aws configservice put-config-rule \
  --config-rule '{
    "ConfigRuleName": "rds-storage-encrypted",
    "Source": {
      "Owner": "AWS",
      "SourceIdentifier": "RDS_STORAGE_ENCRYPTED"
    }
  }'

# Rule 7: EC2 instances must use IMDSv2
aws configservice put-config-rule \
  --config-rule '{
    "ConfigRuleName": "ec2-imdsv2-check",
    "Source": {
      "Owner": "AWS",
      "SourceIdentifier": "EC2_IMDSV2_CHECK"
    }
  }'

# Rule 8: Security groups must not allow 0.0.0.0/0 on port 22 (SSH)
aws configservice put-config-rule \
  --config-rule '{
    "ConfigRuleName": "restricted-ssh",
    "Source": {
      "Owner": "AWS",
      "SourceIdentifier": "INCOMING_SSH_DISABLED"
    }
  }'

# Rule 9: Security groups must not allow 0.0.0.0/0 on port 3389 (RDP)
aws configservice put-config-rule \
  --config-rule '{
    "ConfigRuleName": "restricted-rdp",
    "Source": {
      "Owner": "AWS",
      "SourceIdentifier": "RESTRICTED_INCOMING_TRAFFIC"
    }
  }'
```

**Total Rules Enabled**: 9 (CIS AWS Foundations Benchmark v1.4.0)

---

### Step 3: Monitor Compliance

```bash
# Get compliance summary
aws configservice describe-compliance-by-config-rule

# Example output:
# {
#   "ComplianceByConfigRules": [
#     {
#       "ConfigRuleName": "s3-bucket-server-side-encryption-enabled",
#       "Compliance": {
#         "ComplianceType": "COMPLIANT"
#       }
#     },
#     {
#       "ConfigRuleName": "iam-user-mfa-enabled",
#       "Compliance": {
#         "ComplianceType": "NON_COMPLIANT"
#       }
#     }
#   ]
# }

# Get non-compliant resources
aws configservice describe-compliance-by-resource \
  --compliance-types NON_COMPLIANT \
  --query 'ComplianceByResources[*].[ResourceType,ResourceId]' \
  --output table

# Example output:
# |  ResourceType  |     ResourceId     |
# |----------------|--------------------|
# | AWS::IAM::User | developer1         |
# | AWS::S3::Bucket| legacy-bucket-2020|
```

---

## Security Hub Integration

### Threat Model

**Attack Vector**: Fragmented Security Tools (CVSS 5.0 - Medium)
- **Scenario**: Security alerts scattered across CloudTrail, Config, GuardDuty
- **Impact**: Missed critical alerts, slow incident response
- **Compliance Gap**: SOC 2 requires centralized security monitoring

**Security Control**: AWS Security Hub
- Aggregates findings from 30+ AWS services and 3rd-party tools
- Prioritizes findings by severity (Critical, High, Medium, Low)
- Maps findings to compliance frameworks (CIS, PCI-DSS, NIST)

---

### Step 1: Enable Security Hub

```bash
# Enable Security Hub
aws securityhub enable-security-hub \
  --enable-default-standards

# Enable specific compliance standards
aws securityhub batch-enable-standards \
  --standards-subscription-requests '[
    {
      "StandardsArn": "arn:aws:securityhub:ap-northeast-1::standards/cis-aws-foundations-benchmark/v/1.4.0"
    },
    {
      "StandardsArn": "arn:aws:securityhub:ap-northeast-1::standards/aws-foundational-security-best-practices/v/1.0.0"
    }
  ]'

# Enable integrations
aws securityhub enable-import-findings-for-product \
  --product-arn arn:aws:securityhub:ap-northeast-1::product/aws/guardduty

aws securityhub enable-import-findings-for-product \
  --product-arn arn:aws:securityhub:ap-northeast-1::product/aws/inspector

aws securityhub enable-import-findings-for-product \
  --product-arn arn:aws:securityhub:ap-northeast-1::product/aws/macie
```

---

### Step 2: Configure Security Hub Insights

**Security Insights** = Pre-configured queries for common security issues.

```bash
# Get critical and high severity findings
aws securityhub get-findings \
  --filters '{
    "SeverityLabel": [
      {
        "Value": "CRITICAL",
        "Comparison": "EQUALS"
      },
      {
        "Value": "HIGH",
        "Comparison": "EQUALS"
      }
    ],
    "RecordState": [
      {
        "Value": "ACTIVE",
        "Comparison": "EQUALS"
      }
    ]
  }' \
  --query 'Findings[*].[Title,Severity.Label,Resources[0].Type]' \
  --output table

# Example output:
# |          Title          | Severity |  Resource Type   |
# |-------------------------|----------|------------------|
# | S3 bucket not encrypted | HIGH     | AWS::S3::Bucket  |
# | IAM user without MFA    | MEDIUM   | AWS::IAM::User   |
```

---

### Step 3: Set Up Security Hub Alerts

```bash
# Create EventBridge rule for critical findings
aws events put-rule \
  --name SecurityHubCriticalFindings \
  --event-pattern '{
    "source": ["aws.securityhub"],
    "detail-type": ["Security Hub Findings - Imported"],
    "detail": {
      "findings": {
        "Severity": {
          "Label": ["CRITICAL"]
        }
      }
    }
  }'

# Add SNS target
aws events put-targets \
  --rule SecurityHubCriticalFindings \
  --targets Id=1,Arn=arn:aws:sns:ap-northeast-1:123456789012:SecurityAlerts-Critical
```

---

## Amazon GuardDuty for Threat Detection

### Threat Model

**Attack Vector**: Advanced Persistent Threats (CVSS 8.5 - High)
- **Scenario**: Attacker uses stolen credentials for cryptomining, data exfiltration
- **Traditional Defenses**: CloudTrail logs exist but no one reviews them daily
- **Impact**: Undetected threats run for weeks, $10,000+ EC2 bills, data loss

**Security Control**: Amazon GuardDuty
- Machine learning-based threat detection
- Analyzes billions of events (CloudTrail, VPC Flow Logs, DNS logs)
- Detects: Cryptomining, credential compromise, data exfiltration, port scanning

---

### Step 1: Enable GuardDuty

```bash
# Enable GuardDuty
aws guardduty create-detector --enable

# Get detector ID
DETECTOR_ID=$(aws guardduty list-detectors --query 'DetectorIds[0]' --output text)

echo "GuardDuty Detector ID: $DETECTOR_ID"

# Enable S3 protection (detects data exfiltration)
aws guardduty update-detector \
  --detector-id $DETECTOR_ID \
  --data-sources '{
    "S3Logs": {
      "Enable": true
    }
  }'
```

**Cost**: $4.86/month (for 1M CloudTrail events + 1M VPC Flow Logs + 50 GB S3 logs)

---

### Step 2: Configure GuardDuty Findings

```bash
# Get current findings
aws guardduty list-findings \
  --detector-id $DETECTOR_ID \
  --finding-criteria '{
    "Criterion": {
      "severity": {
        "Gte": 7
      }
    }
  }'

# Get finding details
aws guardduty get-findings \
  --detector-id $DETECTOR_ID \
  --finding-ids <finding-id> \
  --query 'Findings[0].[Title,Severity,Type,Service.Action.ActionType]'

# Example finding:
# [
#   "EC2 instance is communicating with a known malicious IP",
#   8.0,
#   "Backdoor:EC2/C&CActivity.B!DNS",
#   "NETWORK_CONNECTION"
# ]
```

**Common GuardDuty Finding Types**:
| Finding Type | Severity | Description |
|--------------|----------|-------------|
| `UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration` | High | IAM credentials used outside EC2 instance |
| `CryptoCurrency:EC2/BitcoinTool.B!DNS` | High | EC2 instance querying Bitcoin mining pool |
| `Trojan:EC2/BlackholeTraffic` | High | EC2 sending traffic to known malware C&C |
| `Recon:IAMUser/MaliciousIPCaller` | Medium | API calls from known malicious IP |
| `Policy:IAMUser/RootCredentialUsage` | Low | Root account usage detected |

---

### Step 3: Automate Incident Response

**Lambda Function for Automated Response** (e.g., isolate compromised EC2 instance):

```javascript
// guardduty-response.js
const AWS = require('aws-sdk');
const ec2 = new AWS.EC2();
const sns = new AWS.SNS();

exports.handler = async (event) => {
  const finding = event.detail.findings[0];
  const severity = finding.severity;
  const instanceId = finding.resource?.instanceDetails?.instanceId;

  console.log(`GuardDuty Finding: ${finding.title} (Severity: ${severity})`);

  // If critical finding on EC2 instance, isolate it
  if (severity >= 7.0 && instanceId) {
    console.log(`Isolating compromised instance: ${instanceId}`);

    // Apply isolation security group (denies all traffic)
    await ec2.modifyInstanceAttribute({
      InstanceId: instanceId,
      Groups: ['sg-isolation-quarantine']
    }).promise();

    // Send alert
    await sns.publish({
      TopicArn: 'arn:aws:sns:ap-northeast-1:123456789012:SecurityAlerts-Critical',
      Subject: `🚨 GuardDuty CRITICAL: Instance ${instanceId} Isolated`,
      Message: `GuardDuty detected high-severity threat on ${instanceId}.\n\n` +
               `Finding: ${finding.title}\n` +
               `Severity: ${severity}\n` +
               `Type: ${finding.type}\n\n` +
               `Automated Response: Instance isolated via security group.\n` +
               `Action Required: Investigate and terminate if confirmed malicious.`
    }).promise();

    console.log(`Instance ${instanceId} isolated successfully`);
  }

  return { statusCode: 200 };
};
```

**Deploy Lambda**:

```bash
# Package Lambda
zip guardduty-response.zip guardduty-response.js

# Create Lambda
aws lambda create-function \
  --function-name GuardDutyAutomatedResponse \
  --runtime nodejs18.x \
  --role arn:aws:iam::123456789012:role/GuardDutyResponseLambdaRole \
  --handler guardduty-response.handler \
  --zip-file fileb://guardduty-response.zip

# Create EventBridge rule
aws events put-rule \
  --name GuardDutyCriticalFindings \
  --event-pattern '{
    "source": ["aws.guardduty"],
    "detail-type": ["GuardDuty Finding"],
    "detail": {
      "severity": [{"numeric": [">=", 7]}]
    }
  }'

# Add Lambda target
aws events put-targets \
  --rule GuardDutyCriticalFindings \
  --targets Id=1,Arn=arn:aws:lambda:ap-northeast-1:123456789012:function:GuardDutyAutomatedResponse
```

---

## S3 Block Public Access Settings

### Threat Model

**Attack Vector**: Public S3 Bucket Exposure (CVSS 9.1 - Critical)
- **Scenario**: Developer accidentally sets bucket ACL to "public-read"
- **Real-world Examples**:
  - Capital One (2019): 100M records exposed
  - GoDaddy (2019): 24M customer records leaked
  - Dow Jones (2017): 2.2M customer records exposed
- **Impact**: Massive data breach, GDPR fines (4% of global revenue), reputational damage

**Security Control**: S3 Block Public Access
- Account-level setting (applies to ALL buckets)
- Even if bucket ACL is set to public, this overrides it
- **Defense in Depth**: Prevents accidental exposure even if IAM policies allow it

---

### Step 1: Enable Block Public Access (Account-Level)

```bash
# Enable for entire AWS account
aws s3control put-public-access-block \
  --account-id 123456789012 \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Verify settings
aws s3control get-public-access-block \
  --account-id 123456789012

# Expected output:
# {
#   "PublicAccessBlockConfiguration": {
#     "BlockPublicAcls": true,
#     "IgnorePublicAcls": true,
#     "BlockPublicPolicy": true,
#     "RestrictPublicBuckets": true
#   }
# }
```

**What Each Setting Does**:
- **BlockPublicAcls**: Blocks `PUT` operations with public ACLs
- **IgnorePublicAcls**: Ignores existing public ACLs (treats them as private)
- **BlockPublicPolicy**: Blocks bucket policies that grant public access
- **RestrictPublicBuckets**: Only authorized users can access buckets (even with public policy)

---

### Step 2: Enable Block Public Access (Per Bucket)

Even with account-level settings, enable per-bucket as well (defense in depth):

```bash
# List all buckets
aws s3api list-buckets --query 'Buckets[*].Name' --output text | while read bucket; do
  echo "Enabling Block Public Access on: $bucket"

  aws s3api put-public-access-block \
    --bucket $bucket \
    --public-access-block-configuration \
      BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
done
```

---

### Step 3: Audit Existing Public Buckets

```bash
# List buckets with public access
aws s3api list-buckets --query 'Buckets[*].Name' --output text | while read bucket; do
  # Check bucket ACL
  acl=$(aws s3api get-bucket-acl --bucket $bucket --query 'Grants[?Grantee.URI==`http://acs.amazonaws.com/groups/global/AllUsers`]' --output text)

  if [ -n "$acl" ]; then
    echo "⚠️ WARNING: Bucket $bucket has public ACL!"
  fi

  # Check bucket policy
  policy=$(aws s3api get-bucket-policy --bucket $bucket 2>/dev/null | jq -r '.Policy' | grep -i "Principal.*\*")

  if [ -n "$policy" ]; then
    echo "⚠️ WARNING: Bucket $bucket has public policy!"
  fi
done
```

---

## Encryption at Rest and In Transit

### Threat Model

**Attack Vectors**:
1. **Data at Rest Compromise** (CVSS 7.5 - High)
   - Scenario: Attacker gains access to EBS snapshot, S3 bucket
   - Impact: Plaintext data exposed (database dumps, file metadata)
2. **Man-in-the-Middle (MITM)** (CVSS 7.4 - High)
   - Scenario: Attacker intercepts HTTP traffic between EC2 and RDS
   - Impact: Credentials, data stolen in transit

**Security Control**: Encryption Everywhere
- **At Rest**: AES-256 encryption for S3, RDS, EBS
- **In Transit**: TLS 1.2+ for all connections

**Compliance**: GDPR Article 32, PCI-DSS 3.4, ISO 27001 A.10.1

---

### Encryption at Rest

#### S3 Bucket Encryption

```bash
# Enable default encryption on all buckets
aws s3api list-buckets --query 'Buckets[*].Name' --output text | while read bucket; do
  echo "Enabling encryption on: $bucket"

  aws s3api put-bucket-encryption \
    --bucket $bucket \
    --server-side-encryption-configuration '{
      "Rules": [
        {
          "ApplyServerSideEncryptionByDefault": {
            "SSEAlgorithm": "AES256"
          },
          "BucketKeyEnabled": true
        }
      ]
    }'
done

# Verify encryption
aws s3api get-bucket-encryption --bucket cis-file-scanner-prod-metadata
```

**Cost Optimization**: `BucketKeyEnabled=true` reduces KMS API costs by 99%.

---

#### RDS Encryption

```bash
# Enable encryption on new RDS instance
aws rds create-db-instance \
  --db-instance-identifier cis-file-scanner-prod \
  --db-instance-class db.t3.medium \
  --engine postgres \
  --master-username postgres \
  --master-user-password $(openssl rand -base64 32) \
  --allocated-storage 100 \
  --storage-encrypted \
  --kms-key-id arn:aws:kms:ap-northeast-1:123456789012:key/a1b2c3d4-5678-90ab-cdef-EXAMPLE11111

# ⚠️ Existing unencrypted RDS instances CANNOT be encrypted in-place
# Must create encrypted snapshot and restore:
aws rds create-db-snapshot \
  --db-instance-identifier cis-file-scanner-prod \
  --db-snapshot-identifier cis-prod-snapshot-20250112

aws rds copy-db-snapshot \
  --source-db-snapshot-identifier cis-prod-snapshot-20250112 \
  --target-db-snapshot-identifier cis-prod-snapshot-encrypted \
  --kms-key-id arn:aws:kms:ap-northeast-1:123456789012:key/a1b2c3d4-5678-90ab-cdef-EXAMPLE11111 \
  --copy-tags

aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier cis-file-scanner-prod-encrypted \
  --db-snapshot-identifier cis-prod-snapshot-encrypted
```

---

#### EBS Volume Encryption

```bash
# Enable EBS encryption by default (account-level)
aws ec2 enable-ebs-encryption-by-default --region ap-northeast-1

# Verify
aws ec2 get-ebs-encryption-by-default --region ap-northeast-1

# Expected output:
# {
#   "EbsEncryptionByDefault": true
# }

# Encrypt existing unencrypted volume
# 1. Create snapshot
aws ec2 create-snapshot \
  --volume-id vol-0123456789abcdef0 \
  --description "Backup before encryption"

# 2. Copy snapshot with encryption
aws ec2 copy-snapshot \
  --source-region ap-northeast-1 \
  --source-snapshot-id snap-0123456789abcdef0 \
  --encrypted \
  --kms-key-id arn:aws:kms:ap-northeast-1:123456789012:key/a1b2c3d4-5678-90ab-cdef-EXAMPLE11111

# 3. Create encrypted volume from snapshot
aws ec2 create-volume \
  --snapshot-id snap-encrypted-0123456789abcdef0 \
  --availability-zone ap-northeast-1a \
  --encrypted

# 4. Swap volumes (requires downtime)
aws ec2 stop-instances --instance-ids i-0123456789abcdef0
aws ec2 detach-volume --volume-id vol-0123456789abcdef0
aws ec2 attach-volume --volume-id vol-encrypted-0123456789abcdef0 --instance-id i-0123456789abcdef0 --device /dev/sda1
aws ec2 start-instances --instance-ids i-0123456789abcdef0
```

---

### Encryption in Transit

#### Enforce HTTPS for S3

Already enforced via bucket policy (see IAM guide):

```json
{
  "Sid": "DenyInsecureTransport",
  "Effect": "Deny",
  "Action": "s3:*",
  "Condition": {
    "Bool": {
      "aws:SecureTransport": "false"
    }
  }
}
```

---

#### Enforce TLS 1.2+ for RDS

```bash
# Create parameter group
aws rds create-db-parameter-group \
  --db-parameter-group-name cis-postgres-secure \
  --db-parameter-group-family postgres14 \
  --description "Secure PostgreSQL parameters"

# Enforce SSL
aws rds modify-db-parameter-group \
  --db-parameter-group-name cis-postgres-secure \
  --parameters "ParameterName=rds.force_ssl,ParameterValue=1,ApplyMethod=immediate"

# Apply to RDS instance
aws rds modify-db-instance \
  --db-instance-identifier cis-file-scanner-prod \
  --db-parameter-group-name cis-postgres-secure \
  --apply-immediately
```

**Application Code** (enforce TLS):

```javascript
const { Pool } = require('pg');

const pool = new Pool({
  host: 'cis-file-scanner-prod.c9akl.ap-northeast-1.rds.amazonaws.com',
  ssl: {
    rejectUnauthorized: true, // Verify server certificate
    ca: fs.readFileSync('/path/to/rds-ca-2019-root.pem') // AWS RDS CA certificate
  }
});
```

---

## VPC Security Architecture

### Threat Model

**Attack Vector**: Public Internet Exposure (CVSS 8.8 - High)
- **Scenario**: EC2 instances in public subnet with public IP
- **Impact**: Direct SSH/RDP attacks, vulnerability scanning, DDoS

**Security Control**: Private Subnet Architecture
- EC2 instances in private subnets (no public IP)
- Internet access via NAT Gateway (outbound only)
- Bastion host or Systems Manager Session Manager for admin access

---

### Recommended VPC Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ VPC: 10.0.0.0/16                                            │
│                                                             │
│  ┌──────────────────────┐  ┌──────────────────────┐       │
│  │ Public Subnet        │  │ Public Subnet        │       │
│  │ 10.0.1.0/24          │  │ 10.0.2.0/24          │       │
│  │ AZ: ap-northeast-1a  │  │ AZ: ap-northeast-1c  │       │
│  │                      │  │                      │       │
│  │ ┌─────────────────┐ │  │ ┌─────────────────┐ │       │
│  │ │ NAT Gateway     │ │  │ │ NAT Gateway     │ │       │
│  │ └─────────────────┘ │  │ └─────────────────┘ │       │
│  └──────────────────────┘  └──────────────────────┘       │
│                                                             │
│  ┌──────────────────────┐  ┌──────────────────────┐       │
│  │ Private Subnet       │  │ Private Subnet       │       │
│  │ 10.0.10.0/24         │  │ 10.0.11.0/24         │       │
│  │ AZ: ap-northeast-1a  │  │ AZ: ap-northeast-1c  │       │
│  │                      │  │                      │       │
│  │ ┌─────────────────┐ │  │ ┌─────────────────┐ │       │
│  │ │ EC2 Instances   │ │  │ │ EC2 Instances   │ │       │
│  │ │ (File Scanner)  │ │  │ │ (File Scanner)  │ │       │
│  │ └─────────────────┘ │  │ └─────────────────┘ │       │
│  └──────────────────────┘  └──────────────────────┘       │
│                                                             │
│  ┌──────────────────────┐  ┌──────────────────────┐       │
│  │ Private Subnet (DB)  │  │ Private Subnet (DB)  │       │
│  │ 10.0.20.0/24         │  │ 10.0.21.0/24         │       │
│  │ AZ: ap-northeast-1a  │  │ AZ: ap-northeast-1c  │       │
│  │                      │  │                      │       │
│  │ ┌─────────────────┐ │  │ ┌─────────────────┐ │       │
│  │ │ RDS (PostgreSQL)│ │  │ │ RDS (Replica)   │ │       │
│  │ └─────────────────┘ │  │ └─────────────────┘ │       │
│  └──────────────────────┘  └──────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

---

### Security Group Configuration

```bash
# Application EC2 Security Group
aws ec2 create-security-group \
  --group-name cis-file-scanner-app-sg \
  --description "Security group for CIS File Scanner EC2 instances" \
  --vpc-id vpc-0123456789abcdef0

# Allow inbound from ALB only (no direct internet access)
aws ec2 authorize-security-group-ingress \
  --group-id sg-app-0123456789abcdef0 \
  --protocol tcp \
  --port 3000 \
  --source-group sg-alb-0123456789abcdef0

# Allow outbound HTTPS to Secrets Manager, S3, SQS
aws ec2 authorize-security-group-egress \
  --group-id sg-app-0123456789abcdef0 \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0

# Allow outbound PostgreSQL to RDS only
aws ec2 authorize-security-group-egress \
  --group-id sg-app-0123456789abcdef0 \
  --protocol tcp \
  --port 5432 \
  --source-group sg-db-0123456789abcdef0

# RDS Security Group
aws ec2 create-security-group \
  --group-name cis-file-scanner-db-sg \
  --description "Security group for RDS database" \
  --vpc-id vpc-0123456789abcdef0

# Allow inbound PostgreSQL from app instances only
aws ec2 authorize-security-group-ingress \
  --group-id sg-db-0123456789abcdef0 \
  --protocol tcp \
  --port 5432 \
  --source-group sg-app-0123456789abcdef0
```

**Security Principle**: Least Privilege Network Access
- No 0.0.0.0/0 inbound rules (except on ALB)
- Egress restricted to specific ports/destinations
- Database isolated in separate subnet

---

## Security Monitoring & Alerting

### Critical Alerts (P0)

Create SNS topic for critical alerts:

```bash
# Create SNS topic
aws sns create-topic --name SecurityAlerts-Critical

# Subscribe security team
aws sns subscribe \
  --topic-arn arn:aws:sns:ap-northeast-1:123456789012:SecurityAlerts-Critical \
  --protocol email \
  --notification-endpoint security@company.com

# Subscribe Slack webhook
aws sns subscribe \
  --topic-arn arn:aws:sns:ap-northeast-1:123456789012:SecurityAlerts-Critical \
  --protocol https \
  --notification-endpoint https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

**Alert on**:
- Root account usage
- GuardDuty critical findings
- IAM policy changes
- S3 bucket policy changes
- Security group changes allowing 0.0.0.0/0

---

## Cost vs Security Tradeoffs

### Monthly Cost Breakdown

| Security Service | Cost/Month | Value | Recommended |
|-----------------|-----------|-------|-------------|
| **MFA** | $0 | Critical | ✅ Yes |
| **CloudTrail** | $2 | Critical (audit, compliance) | ✅ Yes |
| **AWS Config** | $6 | High (compliance monitoring) | ✅ Yes (prod) |
| **Security Hub** | $1 | High (centralized dashboard) | ✅ Yes (prod) |
| **GuardDuty** | $5 | High (threat detection) | ✅ Yes |
| **S3 Block Public Access** | $0 | Critical | ✅ Yes |
| **Encryption (KMS CMK)** | $1 | Medium | ⚠️ Optional (use AWS managed keys for dev) |
| **VPC Flow Logs** | $5 | Medium (forensics) | ⚠️ Optional |

**Total**: ~$20/month for production-grade security

**Cost Optimization**:
- **Dev/Staging**: Skip AWS Config, Security Hub ($7/month savings)
- **Production**: Enable all services (worth $20/month for security + compliance)

---

## Verification Checklist

Before deploying to production:

### Identity & Access
- [ ] MFA enabled on root account
- [ ] MFA enabled on all IAM users
- [ ] MFA enforcement policy attached
- [ ] Root account usage alerts configured

### Audit & Logging
- [ ] CloudTrail enabled (multi-region)
- [ ] CloudTrail logs stored in S3 with versioning + MFA delete
- [ ] CloudWatch Logs integration enabled
- [ ] CloudTrail alerts configured (root usage, IAM changes, etc.)

### Compliance Monitoring
- [ ] AWS Config enabled
- [ ] CIS AWS Foundations Benchmark enabled
- [ ] AWS Foundational Security Best Practices enabled
- [ ] Config rules for encryption, MFA, CloudTrail enabled

### Threat Detection
- [ ] GuardDuty enabled
- [ ] S3 protection enabled in GuardDuty
- [ ] GuardDuty alerts configured for critical findings
- [ ] Automated response Lambda deployed (optional)

### Data Protection
- [ ] S3 Block Public Access enabled (account-level)
- [ ] S3 default encryption enabled on all buckets
- [ ] RDS encryption at rest enabled
- [ ] EBS encryption by default enabled
- [ ] TLS 1.2+ enforced for all connections

### Network Security
- [ ] EC2 instances in private subnets
- [ ] NAT Gateway for outbound internet access
- [ ] Security groups follow least privilege (no 0.0.0.0/0 except ALB)
- [ ] VPC Flow Logs enabled (optional)

### Monitoring & Alerting
- [ ] Security Hub enabled (optional)
- [ ] SNS topic for critical alerts created
- [ ] Security team subscribed to alerts
- [ ] Alert fatigue minimized (only critical/high alerts)

---

## Next Steps

1. **Complete this security best practices setup** ✅
2. **Proceed to**: [Compliance Mapping](./compliance-mapping.md)

---

## References

- [CIS AWS Foundations Benchmark v1.4.0](https://www.cisecurity.org/benchmark/amazon_web_services)
- [AWS Security Best Practices](https://docs.aws.amazon.com/securityhub/latest/userguide/securityhub-standards-fsbp.html)
- [OWASP Cloud-Native Application Security Top 10](https://owasp.org/www-project-cloud-native-application-security-top-10/)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)

---

**Document Version**: 1.0
**Last Updated**: 2025-01-12
**Author**: Security & Compliance Expert
**Classification**: Internal Use - Security Sensitive
