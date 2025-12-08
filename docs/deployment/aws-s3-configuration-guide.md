# AWS S3 Configuration Guide for CIS File Scanner

## Table of Contents
1. [Why This Matters - Understanding S3 for File Scanning](#why-this-matters)
2. [S3 Bucket Creation](#s3-bucket-creation)
3. [Bucket Naming Best Practices](#bucket-naming-best-practices)
4. [Server-Side Encryption](#server-side-encryption)
5. [Lifecycle Policies](#lifecycle-policies)
6. [Bucket Policies and IAM](#bucket-policies-and-iam)
7. [CORS Configuration](#cors-configuration)
8. [Versioning Configuration](#versioning-configuration)
9. [Transfer Acceleration](#transfer-acceleration)
10. [Storage Classes](#storage-classes)
11. [Cost Optimization Strategies](#cost-optimization-strategies)
12. [Verification and Testing](#verification-and-testing)
13. [Troubleshooting](#troubleshooting)

---

## Why This Matters - Understanding S3 for File Scanning

### What is S3 and Why We Use It

Amazon S3 (Simple Storage Service) is AWS's object storage service. For the CIS File Scanner, S3 serves as:

1. **Landing Zone**: Temporary storage for files being scanned from NAS
2. **Metadata Cache**: Storage for file metadata and thumbnails
3. **Archive Storage**: Long-term storage for indexed files (optional)

### Key S3 Concepts for File Scanning

- **Buckets**: Top-level containers (like root folders)
- **Objects**: Individual files stored in buckets
- **Keys**: Full path to an object (e.g., `files/2025/document.pdf`)
- **Storage Classes**: Different tiers with varying costs and access patterns
- **Lifecycle Rules**: Automatic transitions between storage classes or deletion
- **Multipart Upload**: Required for files > 100MB (scanner uses this)

### Cost Implications

For the expected workload (100K files/month, 10MB average):
- **Total storage**: ~1TB/month
- **PUT requests**: 100,000/month
- **GET requests**: Variable based on search patterns
- **Data transfer**: OUT to internet is costly, IN is free

**Estimated monthly costs** (Tokyo region):
- Storage (Standard): $23/TB
- PUT requests: $5 per million
- GET requests: $0.40 per million
- **Total for 1TB**: ~$28/month (storage + requests)

---

## S3 Bucket Creation

### Console Method

#### Step 1: Navigate to S3 Console

1. Log in to AWS Management Console
2. Search for "S3" in the services search bar
3. Click "Create bucket"

#### Step 2: Configure Basic Settings

**Bucket Name**:
```
cis-filesearch-landing-dev
```

**Why this name?**
- `cis`: Project identifier
- `filesearch`: Service name
- `landing`: Purpose (staging area)
- `dev`: Environment (dev/staging/prod)

**Region**: `ap-northeast-1` (Tokyo)

**Why Tokyo?**
- Lowest latency to Japan-based NAS
- Data residency compliance
- Cheaper than US regions for Asia traffic

#### Step 3: Object Ownership

- Select: **ACLs disabled (recommended)**

**Why?**
- Simplifies permissions management
- Uses bucket policies instead of per-object ACLs
- Modern AWS best practice
- Prevents accidental public access

#### Step 4: Block Public Access

- Keep ALL options checked (default)

**Why?**
- Files contain sensitive corporate data
- No need for public internet access
- Access only via authenticated API calls
- Prevents data breaches

#### Step 5: Bucket Versioning

- Select: **Enable**

**Why enable versioning?**
- Protects against accidental deletion
- Allows rollback to previous file versions
- Adds minimal cost (only for changed objects)
- Critical for data integrity

**Cost impact**:
- If you modify 1% of files monthly: +1% storage cost
- Small price for data protection

#### Step 6: Default Encryption

- Select: **Server-side encryption with Amazon S3 managed keys (SSE-S3)**

**Why SSE-S3 over SSE-KMS?**
- **SSE-S3**: Free, automatic, sufficient for most use cases
- **SSE-KMS**: $1/month + $0.03 per 10,000 requests, better audit logs
- For this project: SSE-S3 is adequate (saves ~$50/month)

**Encryption explained**:
- Data encrypted at rest on S3 servers
- Transparent to your application
- Meets compliance requirements
- No performance impact

#### Step 7: Review and Create

- Click "Create bucket"

### CLI Method

```bash
# Set variables
BUCKET_NAME="cis-filesearch-landing-dev"
REGION="ap-northeast-1"

# Create bucket
aws s3api create-bucket \
  --bucket $BUCKET_NAME \
  --region $REGION \
  --create-bucket-configuration LocationConstraint=$REGION

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket $BUCKET_NAME \
  --versioning-configuration Status=Enabled

# Enable default encryption (SSE-S3)
aws s3api put-bucket-encryption \
  --bucket $BUCKET_NAME \
  --server-side-encryption-configuration '{
    "Rules": [
      {
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "AES256"
        },
        "BucketKeyEnabled": false
      }
    ]
  }'

# Block public access (redundant but explicit)
aws s3api put-public-access-block \
  --bucket $BUCKET_NAME \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Add tags for cost tracking
aws s3api put-bucket-tagging \
  --bucket $BUCKET_NAME \
  --tagging 'TagSet=[
    {Key=Project,Value=CISFileSearch},
    {Key=Environment,Value=Development},
    {Key=CostCenter,Value=IT},
    {Key=ManagedBy,Value=Manual}
  ]'
```

**Why tags?**
- Cost tracking by project/environment
- Resource organization
- Automated backup/deletion policies
- Billing reports filtering

---

## Bucket Naming Best Practices

### Naming Convention for This Project

```
{project}-{service}-{purpose}-{environment}

Examples:
- cis-filesearch-landing-dev       # File staging area (development)
- cis-filesearch-landing-prod      # File staging area (production)
- cis-filesearch-archive-prod      # Long-term storage
- cis-filesearch-thumbnails-prod   # Generated thumbnails
- cis-filesearch-logs-prod         # Application logs backup
```

### AWS S3 Naming Rules

**Must follow:**
- 3-63 characters
- Lowercase letters, numbers, hyphens only
- Start with letter or number
- No underscores, spaces, or special characters
- Globally unique across ALL AWS accounts

**Why globally unique?**
- S3 bucket names form part of the URL: `https://bucket-name.s3.amazonaws.com`
- Prevents bucket name squatting
- Use specific prefixes to avoid collisions

**Common mistakes to avoid:**
```bash
# ❌ Bad names
my_bucket              # Underscores not allowed
MyBucket               # Capital letters not allowed
bucket-               # Cannot end with hyphen
bu                    # Too short (< 3 chars)
192.168.1.1           # Cannot look like IP address
xn--bucket            # Cannot start with 'xn--'

# ✅ Good names
cis-filesearch-landing-dev
acme-corp-backups-2025
project-x-user-uploads
```

---

## Server-Side Encryption

### SSE-S3 (Recommended for This Project)

**How it works:**
1. You upload plaintext file
2. S3 automatically encrypts with AES-256
3. S3 manages encryption keys
4. Decryption is automatic on download

**Console configuration:**
- Already enabled during bucket creation
- Properties → Default encryption → Edit

**CLI configuration:**
```bash
aws s3api put-bucket-encryption \
  --bucket cis-filesearch-landing-dev \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "AES256"
      },
      "BucketKeyEnabled": false
    }]
  }'
```

**Cost**: FREE

### SSE-KMS (Optional - Better Audit Trail)

**When to use SSE-KMS:**
- Need detailed access logs (who accessed when)
- Compliance requires key rotation logs
- Need to revoke access without deleting files
- Cross-account access scenarios

**Console configuration:**
1. Properties → Default encryption → Edit
2. Select "AWS Key Management Service key (SSE-KMS)"
3. Choose "AWS managed key (aws/s3)" or create custom key

**CLI configuration:**
```bash
# Using AWS-managed KMS key
aws s3api put-bucket-encryption \
  --bucket cis-filesearch-landing-dev \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms",
        "KMSMasterKeyID": "aws/s3"
      },
      "BucketKeyEnabled": true
    }]
  }'
```

**Cost**:
- $1/month per key
- $0.03 per 10,000 requests
- For 100K files/month: ~$1.30/month extra

**BucketKeyEnabled explained:**
- Reduces KMS API calls by using bucket-level keys
- Saves 99% of KMS request costs
- Always enable if using KMS

### Encryption in Transit

**Enforce HTTPS-only access:**

```bash
# Create bucket policy to deny non-HTTPS requests
aws s3api put-bucket-policy \
  --bucket cis-filesearch-landing-dev \
  --policy '{
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::cis-filesearch-landing-dev/*",
        "arn:aws:s3:::cis-filesearch-landing-dev"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }]
  }'
```

**Why enforce HTTPS?**
- Prevents man-in-the-middle attacks
- Encrypts data in transit
- Required for compliance (PCI DSS, HIPAA)
- Negligible performance impact

---

## Lifecycle Policies

### Why Lifecycle Policies Matter

For the file scanner, files follow this lifecycle:
1. **Upload** → Standard storage (immediate access needed)
2. **7 days later** → Files processed, less frequent access
3. **90 days later** → Rarely accessed, move to cheaper storage
4. **1 year later** → Archive or delete

**Without lifecycle policies:**
- Pay full price for rarely-accessed files
- Manual cleanup required
- Storage costs grow unbounded

**With lifecycle policies:**
- Automatic cost optimization
- 70-80% storage cost reduction
- No manual intervention

### Lifecycle Policy for Landing Bucket

**Strategy:**
- Files stay in Standard for 7 days (active processing)
- Move to Intelligent-Tiering after 7 days (automatic optimization)
- Delete after 90 days (processed files aren't needed)

#### Console Configuration

1. Go to bucket → Management → Lifecycle rules
2. Click "Create lifecycle rule"

**Rule 1: Transition to Intelligent-Tiering**
- Rule name: `transition-to-intelligent-tiering`
- Apply to all objects: Yes
- Lifecycle rule actions:
  - ✅ Transition current versions
  - Days after creation: `7`
  - Storage class: `Intelligent-Tiering`

**Rule 2: Delete old files**
- Rule name: `delete-after-90-days`
- Apply to all objects: Yes
- Lifecycle rule actions:
  - ✅ Expire current versions
  - Days after creation: `90`

#### CLI Configuration

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket cis-filesearch-landing-dev \
  --lifecycle-configuration '{
    "Rules": [
      {
        "Id": "TransitionToIntelligentTiering",
        "Status": "Enabled",
        "Filter": {},
        "Transitions": [{
          "Days": 7,
          "StorageClass": "INTELLIGENT_TIERING"
        }]
      },
      {
        "Id": "DeleteAfter90Days",
        "Status": "Enabled",
        "Filter": {},
        "Expiration": {
          "Days": 90
        }
      },
      {
        "Id": "DeleteIncompleteMultipartUploads",
        "Status": "Enabled",
        "Filter": {},
        "AbortIncompleteMultipartUpload": {
          "DaysAfterInitiation": 7
        }
      }
    ]
  }'
```

### Advanced: Path-Specific Lifecycle Rules

For different retention by file type:

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket cis-filesearch-landing-dev \
  --lifecycle-configuration '{
    "Rules": [
      {
        "Id": "ArchiveImagesAfter30Days",
        "Status": "Enabled",
        "Filter": {
          "Prefix": "images/"
        },
        "Transitions": [
          {
            "Days": 30,
            "StorageClass": "GLACIER_IR"
          },
          {
            "Days": 180,
            "StorageClass": "DEEP_ARCHIVE"
          }
        ]
      },
      {
        "Id": "DeleteTempFilesAfter7Days",
        "Status": "Enabled",
        "Filter": {
          "Prefix": "temp/"
        },
        "Expiration": {
          "Days": 7
        }
      },
      {
        "Id": "KeepLogsFor1Year",
        "Status": "Enabled",
        "Filter": {
          "Prefix": "logs/"
        },
        "Transitions": [{
          "Days": 90,
          "StorageClass": "GLACIER_IR"
        }],
        "Expiration": {
          "Days": 365
        }
      }
    ]
  }'
```

**Cost savings example** (1TB data):
- Standard (all year): $276/year
- With lifecycle: $120/year
- **Savings: $156/year (56%)**

---

## Bucket Policies and IAM

### Understanding the Difference

**IAM Policies**: Attached to users/roles (who can do what)
**Bucket Policies**: Attached to buckets (what can be done to this bucket)

**Best practice**: Use both for defense in depth

### IAM Policy for File Scanner EC2 Instance

This policy allows the scanner to upload files and list buckets.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListAllBuckets",
      "Effect": "Allow",
      "Action": [
        "s3:ListAllMyBuckets",
        "s3:GetBucketLocation"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ScannerBucketAccess",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:GetBucketVersioning"
      ],
      "Resource": [
        "arn:aws:s3:::cis-filesearch-landing-dev",
        "arn:aws:s3:::cis-filesearch-landing-prod"
      ]
    },
    {
      "Sid": "ScannerObjectAccess",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:PutObjectAcl",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": [
        "arn:aws:s3:::cis-filesearch-landing-dev/*",
        "arn:aws:s3:::cis-filesearch-landing-prod/*"
      ]
    }
  ]
}
```

**Why these permissions?**
- `ListAllMyBuckets`: Required by AWS SDK initialization
- `ListBucket`: Check if file already exists (dedupe)
- `PutObject`: Upload files
- `GetObject`: Verify uploads
- `DeleteObject`: Cleanup failed uploads
- `AbortMultipartUpload`: Cancel incomplete uploads
- `ListMultipartUploadParts`: Resume interrupted uploads

#### Create IAM Policy via CLI

```bash
# Create policy document
cat > scanner-s3-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ScannerS3Access",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": [
        "arn:aws:s3:::cis-filesearch-landing-dev",
        "arn:aws:s3:::cis-filesearch-landing-dev/*"
      ]
    }
  ]
}
EOF

# Create policy
aws iam create-policy \
  --policy-name CISFileScannerS3Access \
  --policy-document file://scanner-s3-policy.json \
  --description "S3 access for CIS File Scanner"

# Attach to role (assumes role exists)
aws iam attach-role-policy \
  --role-name CISFileScannerRole \
  --policy-arn arn:aws:iam::YOUR_ACCOUNT_ID:policy/CISFileScannerS3Access
```

### Bucket Policy for Cross-Account Access

If your scanner runs in a different AWS account:

```bash
aws s3api put-bucket-policy \
  --bucket cis-filesearch-landing-dev \
  --policy '{
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "AllowScannerAccountAccess",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::SCANNER_ACCOUNT_ID:role/CISFileScannerRole"
      },
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::cis-filesearch-landing-dev",
        "arn:aws:s3:::cis-filesearch-landing-dev/*"
      ]
    }]
  }'
```

### Bucket Policy to Enforce Encryption

```bash
aws s3api put-bucket-policy \
  --bucket cis-filesearch-landing-dev \
  --policy '{
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "DenyUnencryptedObjectUploads",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::cis-filesearch-landing-dev/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption": "AES256"
        }
      }
    }]
  }'
```

**Why enforce encryption policy?**
- Prevents accidental unencrypted uploads
- Meets compliance requirements
- Works even if default encryption is disabled

---

## CORS Configuration

### Do You Need CORS?

**CORS (Cross-Origin Resource Sharing)** allows web browsers to access S3 directly.

**You need CORS if:**
- Frontend uploads directly to S3 (bypassing backend)
- Frontend downloads files directly from S3
- Using S3 as CDN for user-uploaded content

**You DON'T need CORS if:**
- All uploads go through your backend API
- Backend proxies file downloads
- Scanner runs on EC2 (server-side access)

**For this project**: CORS is optional but recommended for future frontend features.

### CORS Configuration for File Uploads

#### Console Method

1. Go to bucket → Permissions → CORS
2. Click Edit
3. Add configuration:

```json
[
  {
    "AllowedHeaders": [
      "Authorization",
      "Content-Type",
      "x-amz-date",
      "x-amz-security-token",
      "x-amz-server-side-encryption"
    ],
    "AllowedMethods": [
      "GET",
      "PUT",
      "POST",
      "DELETE"
    ],
    "AllowedOrigins": [
      "https://your-app.example.com",
      "http://localhost:3000"
    ],
    "ExposeHeaders": [
      "ETag",
      "x-amz-version-id"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

#### CLI Method

```bash
# Create CORS configuration
cat > cors-config.json <<'EOF'
{
  "CORSRules": [{
    "AllowedHeaders": [
      "Authorization",
      "Content-Type",
      "x-amz-date",
      "x-amz-security-token"
    ],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedOrigins": [
      "https://your-app.example.com",
      "http://localhost:3000"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }]
}
EOF

# Apply CORS configuration
aws s3api put-bucket-cors \
  --bucket cis-filesearch-landing-dev \
  --cors-configuration file://cors-config.json
```

**Configuration explained:**
- `AllowedOrigins`: Your frontend domains (never use `*` in production)
- `AllowedMethods`: HTTP methods frontend can use
- `AllowedHeaders`: Headers frontend can send
- `ExposeHeaders`: Headers frontend can read from response
- `MaxAgeSeconds`: Browser caches CORS preflight for 1 hour

### Security Best Practices

```json
{
  "CORSRules": [{
    "AllowedOrigins": [
      "https://filesearch.example.com"
    ],
    "AllowedMethods": ["GET"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }]
}
```

**Why restrict origins?**
- `*` allows ANY website to access your S3
- Attackers can embed your files on malicious sites
- Can lead to bandwidth theft and data exposure

---

## Versioning Configuration

### Why Enable Versioning?

**Versioning protects against:**
- Accidental deletions
- Overwrites by buggy code
- Malicious modifications
- Data corruption

**How it works:**
1. Each upload creates a new version
2. Old versions are preserved
3. Deletes create a "delete marker" (soft delete)
4. You can restore any previous version

### Versioning for Landing Bucket

#### Enable Versioning (Console)

1. Go to bucket → Properties
2. Find "Bucket Versioning"
3. Click Edit → Enable → Save

#### Enable Versioning (CLI)

```bash
aws s3api put-bucket-versioning \
  --bucket cis-filesearch-landing-dev \
  --versioning-configuration Status=Enabled
```

#### Check Versioning Status

```bash
aws s3api get-bucket-versioning \
  --bucket cis-filesearch-landing-dev
```

### Managing Versioned Objects

#### List All Versions

```bash
aws s3api list-object-versions \
  --bucket cis-filesearch-landing-dev \
  --prefix "files/2025/" \
  --max-items 10
```

#### Restore Previous Version

```bash
# Get version ID
aws s3api list-object-versions \
  --bucket cis-filesearch-landing-dev \
  --prefix "files/important-doc.pdf"

# Copy old version to be current
aws s3api copy-object \
  --bucket cis-filesearch-landing-dev \
  --copy-source cis-filesearch-landing-dev/files/important-doc.pdf?versionId=VERSION_ID \
  --key files/important-doc.pdf
```

#### Permanently Delete Version

```bash
aws s3api delete-object \
  --bucket cis-filesearch-landing-dev \
  --key files/old-file.pdf \
  --version-id VERSION_ID
```

### Cost Management for Versioning

**Problem**: Versioning can increase storage costs

**Solution**: Lifecycle policy to delete old versions

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket cis-filesearch-landing-dev \
  --lifecycle-configuration '{
    "Rules": [{
      "Id": "DeleteOldVersions",
      "Status": "Enabled",
      "Filter": {},
      "NoncurrentVersionExpiration": {
        "NoncurrentDays": 30
      }
    }]
  }'
```

**This means:**
- Keep current version indefinitely
- Old versions deleted after 30 days
- Balance between protection and cost

**Cost estimate:**
- If you replace 10% of files monthly: +3% storage cost over 30 days
- Much cheaper than full backups

---

## Transfer Acceleration

### What is Transfer Acceleration?

S3 Transfer Acceleration uses AWS CloudFront edge locations to speed up uploads.

**How it works:**
1. Files upload to nearest edge location
2. Routed over AWS private network to S3
3. Can be 50-500% faster for distant regions

**When to use:**
- Uploading from distant locations (e.g., Japan → US bucket)
- Large files over slow connections
- Geographically distributed scanners

**When NOT to use:**
- Same region uploads (Tokyo → Tokyo bucket)
- Small files (< 1MB)
- Cost-sensitive workloads

**For this project**: Not needed (scanner and bucket both in Tokyo)

### Enable Transfer Acceleration

#### Console Method

1. Go to bucket → Properties
2. Find "Transfer acceleration"
3. Click Edit → Enable → Save
4. Note the accelerated endpoint URL

#### CLI Method

```bash
# Enable acceleration
aws s3api put-bucket-accelerate-configuration \
  --bucket cis-filesearch-landing-dev \
  --accelerate-configuration Status=Enabled

# Check status
aws s3api get-bucket-accelerate-configuration \
  --bucket cis-filesearch-landing-dev
```

### Using Accelerated Endpoint

**Standard endpoint:**
```
https://cis-filesearch-landing-dev.s3.ap-northeast-1.amazonaws.com
```

**Accelerated endpoint:**
```
https://cis-filesearch-landing-dev.s3-accelerate.amazonaws.com
```

**In your Node.js code:**
```typescript
import { S3Client } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: 'ap-northeast-1',
  useAccelerateEndpoint: true, // Enable acceleration
});
```

### Cost Impact

**Pricing** (on top of standard transfer costs):
- $0.04 per GB accelerated upload
- $0.04 per GB accelerated download

**Example** (1TB monthly uploads):
- Standard: Free (data IN is free)
- Accelerated: $40/month

**Speed test before enabling:**
```bash
# Compare standard vs accelerated speed
aws s3 cp test-file.zip s3://cis-filesearch-landing-dev/ --region ap-northeast-1
# Note: Takes X seconds

aws s3 cp test-file.zip s3://cis-filesearch-landing-dev/ --endpoint-url https://s3-accelerate.amazonaws.com
# Note: Takes Y seconds
```

**Only enable if Y < X * 0.5** (at least 50% faster)

---

## Storage Classes

### Understanding Storage Classes

S3 offers multiple storage classes optimized for different access patterns:

| Class | Use Case | Cost (Tokyo, GB/month) | Retrieval Time | Min Storage |
|-------|----------|----------------------|----------------|-------------|
| **Standard** | Frequent access | $0.023 | Instant | None |
| **Intelligent-Tiering** | Unknown/changing patterns | $0.023 + $0.0025 monitoring | Instant | 30 days |
| **Standard-IA** | Infrequent access | $0.0125 + retrieval fee | Instant | 30 days |
| **One Zone-IA** | Recreatable data | $0.01 + retrieval fee | Instant | 30 days |
| **Glacier Instant Retrieval** | Archive, instant access | $0.004 + retrieval fee | Instant | 90 days |
| **Glacier Flexible** | Archive, infrequent access | $0.0036 | 1-5 minutes | 90 days |
| **Glacier Deep Archive** | Long-term archive | $0.002 | 12 hours | 180 days |

### Recommended Strategy for File Scanner

#### Landing Bucket: Standard → Intelligent-Tiering

```
Day 0-7:  Standard (active processing)
Day 7-90: Intelligent-Tiering (auto-optimization)
Day 90+:  Deleted (no longer needed)
```

**Why this works:**
- New files accessed frequently during indexing
- Processed files rarely accessed (metadata is in database)
- Intelligent-Tiering automatically moves between tiers
- No retrieval fees within Intelligent-Tiering

#### Archive Bucket: Glacier Instant Retrieval

For long-term file storage (if needed):

```
Day 0-30:  Standard (recent files)
Day 30+:   Glacier Instant Retrieval (archive)
```

**Why Glacier IR?**
- 80% cheaper than Standard ($0.004 vs $0.023)
- Still instant access (unlike Flexible/Deep Archive)
- Perfect for "just in case" storage

### Setting Storage Class at Upload

**In your scanner code:**

```typescript
import { PutObjectCommand } from '@aws-sdk/client-s3';

const command = new PutObjectCommand({
  Bucket: 'cis-filesearch-landing-dev',
  Key: 'files/2025/document.pdf',
  Body: fileBuffer,
  StorageClass: 'STANDARD', // or INTELLIGENT_TIERING
  ServerSideEncryption: 'AES256',
});

await s3Client.send(command);
```

**CLI upload with storage class:**

```bash
aws s3 cp local-file.pdf s3://cis-filesearch-landing-dev/files/ \
  --storage-class INTELLIGENT_TIERING \
  --sse AES256
```

### Changing Storage Class of Existing Objects

```bash
# Move to Intelligent-Tiering
aws s3 cp s3://cis-filesearch-landing-dev/files/old-file.pdf \
  s3://cis-filesearch-landing-dev/files/old-file.pdf \
  --storage-class INTELLIGENT_TIERING \
  --metadata-directive COPY

# Bulk change with lifecycle policy (better approach)
# See Lifecycle Policies section
```

### Cost Calculation Example

**Scenario**: 100K files, 10MB average, 1TB total

**Option 1: Standard only**
- Storage: $23/month
- Requests: Negligible
- **Total: $23/month**

**Option 2: Lifecycle with Intelligent-Tiering**
- Month 1: 1TB Standard = $23
- Month 2: 1TB new + 1TB old (IT) = $23 + $25.50 = $48.50
- Month 3: 1TB new + 2TB old (deleted after 90d) = ~$40/month average
- **Average: $40/month, but no old data accumulation**

**Option 3: Archive with Glacier**
- Active data (7 days): 240GB Standard = $5.50
- Archive (rest): Glacier IR = $3/TB
- **Total: ~$8/month for 1TB**

**Recommendation**: Start with Option 2, add Option 3 if costs are too high.

---

## Cost Optimization Strategies

### 1. VPC Endpoint for S3 (Most Important)

**Problem**: Data transfer from EC2 to S3 over internet incurs NAT Gateway costs

**Solution**: VPC Endpoint (Gateway type)

**Savings**:
- Eliminates NAT Gateway data processing charges ($0.045/GB)
- For 1TB/month: **Save $45/month**

**Setup** (covered in detail in VPC guide):
```bash
# Create S3 VPC endpoint
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxxxx \
  --service-name com.amazonaws.ap-northeast-1.s3 \
  --route-table-ids rtb-xxxxx
```

### 2. Intelligent-Tiering Auto-Archive

**Enable automatic archiving to Glacier tiers:**

```bash
aws s3api put-bucket-intelligent-tiering-configuration \
  --bucket cis-filesearch-landing-dev \
  --id "AutoArchiveConfig" \
  --intelligent-tiering-configuration '{
    "Id": "AutoArchiveConfig",
    "Status": "Enabled",
    "Tierings": [
      {
        "Days": 90,
        "AccessTier": "ARCHIVE_ACCESS"
      },
      {
        "Days": 180,
        "AccessTier": "DEEP_ARCHIVE_ACCESS"
      }
    ]
  }'
```

**Savings**: Additional 90% cost reduction for cold data

### 3. Incomplete Multipart Upload Cleanup

**Problem**: Failed uploads leave orphaned parts that still cost money

**Solution**: Lifecycle rule to abort incomplete uploads

```bash
aws s3api put-bucket-lifecycle-configuration \
  --bucket cis-filesearch-landing-dev \
  --lifecycle-configuration '{
    "Rules": [{
      "Id": "CleanupIncompleteUploads",
      "Status": "Enabled",
      "Filter": {},
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 7
      }
    }]
  }'
```

**Savings**: 1-5% of storage costs

### 4. S3 Storage Lens for Insights

**Enable S3 Storage Lens to identify waste:**

```bash
# Enable default dashboard (free)
# Go to S3 Console → Storage Lens → Dashboards

# Or via CLI (advanced)
aws s3control put-storage-lens-configuration \
  --account-id YOUR_ACCOUNT_ID \
  --config-id default-account-dashboard \
  --storage-lens-configuration file://storage-lens-config.json
```

**What it shows:**
- Buckets with high costs
- Unused storage classes
- Missing lifecycle rules
- Incomplete multipart uploads

### 5. Compress Files Before Upload

**In scanner code:**

```typescript
import { gzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);

// Compress before upload
const compressed = await gzipAsync(fileBuffer);

await s3Client.send(new PutObjectCommand({
  Bucket: 'cis-filesearch-landing-dev',
  Key: 'files/document.pdf.gz',
  Body: compressed,
  ContentEncoding: 'gzip',
  ContentType: 'application/pdf',
}));
```

**Savings**: 50-70% storage reduction for text files, 10-20% for images

**Trade-off**: Increased CPU usage, slightly slower access

### 6. Delete Debug/Test Data Regularly

```bash
# Delete all test files older than 7 days
aws s3 rm s3://cis-filesearch-landing-dev/test/ \
  --recursive \
  --exclude "*" \
  --include "$(date -d '7 days ago' +%Y-%m-%d)*"
```

### 7. Use Requester Pays (If Applicable)

If you're sharing buckets with partners:

```bash
aws s3api put-bucket-request-payment \
  --bucket cis-filesearch-landing-dev \
  --request-payment-configuration Payer=Requester
```

**Effect**: Download costs shift to the requester

---

## Verification and Testing

### 1. Verify Bucket Created Successfully

```bash
# List buckets
aws s3 ls

# Get bucket details
aws s3api get-bucket-location --bucket cis-filesearch-landing-dev
aws s3api get-bucket-versioning --bucket cis-filesearch-landing-dev
aws s3api get-bucket-encryption --bucket cis-filesearch-landing-dev
```

**Expected output:**
```json
{
    "LocationConstraint": "ap-northeast-1"
}
{
    "Status": "Enabled"
}
{
    "ServerSideEncryptionConfiguration": {
        "Rules": [{
            "ApplyServerSideEncryptionByDefault": {
                "SSEAlgorithm": "AES256"
            }
        }]
    }
}
```

### 2. Test Upload

```bash
# Create test file
echo "CIS File Scanner Test" > test-upload.txt

# Upload
aws s3 cp test-upload.txt s3://cis-filesearch-landing-dev/test/

# Verify
aws s3 ls s3://cis-filesearch-landing-dev/test/

# Download to verify
aws s3 cp s3://cis-filesearch-landing-dev/test/test-upload.txt downloaded.txt
cat downloaded.txt
```

### 3. Test Multipart Upload (Large Files)

```bash
# Create 100MB test file
dd if=/dev/urandom of=largefile.bin bs=1M count=100

# Upload with multipart (automatic for files > 8MB)
aws s3 cp largefile.bin s3://cis-filesearch-landing-dev/test/ \
  --storage-class INTELLIGENT_TIERING

# Verify
aws s3api head-object \
  --bucket cis-filesearch-landing-dev \
  --key test/largefile.bin
```

### 4. Test IAM Permissions

**From scanner EC2 instance:**

```bash
# Test list
aws s3 ls s3://cis-filesearch-landing-dev/

# Test upload
echo "Permission test" > perm-test.txt
aws s3 cp perm-test.txt s3://cis-filesearch-landing-dev/test/

# Test download
aws s3 cp s3://cis-filesearch-landing-dev/test/perm-test.txt /tmp/

# Test delete
aws s3 rm s3://cis-filesearch-landing-dev/test/perm-test.txt
```

**Expected**: All succeed

**If fails**: Check IAM role attached to instance

### 5. Test Lifecycle Rules

```bash
# Upload file with old modification date
aws s3api put-object \
  --bucket cis-filesearch-landing-dev \
  --key test/old-file.txt \
  --body test.txt

# Check storage class after lifecycle runs (wait 24h)
aws s3api head-object \
  --bucket cis-filesearch-landing-dev \
  --key test/old-file.txt \
  | grep StorageClass
```

### 6. Load Test

**Test concurrent uploads:**

```bash
# Upload 100 files in parallel
for i in {1..100}; do
  (
    echo "Test file $i" > "test-$i.txt"
    aws s3 cp "test-$i.txt" s3://cis-filesearch-landing-dev/load-test/ &
  )
done
wait

# Verify count
aws s3 ls s3://cis-filesearch-landing-dev/load-test/ | wc -l

# Cleanup
aws s3 rm s3://cis-filesearch-landing-dev/load-test/ --recursive
```

### 7. Test Encryption

```bash
# Upload file
aws s3 cp test.txt s3://cis-filesearch-landing-dev/test/

# Verify encryption
aws s3api head-object \
  --bucket cis-filesearch-landing-dev \
  --key test/test.txt \
  | grep ServerSideEncryption

# Should show: "ServerSideEncryption": "AES256"
```

---

## Troubleshooting

### Issue 1: Access Denied Errors

**Symptoms:**
```
An error occurred (AccessDenied) when calling the PutObject operation
```

**Diagnosis:**
```bash
# Check bucket policy
aws s3api get-bucket-policy --bucket cis-filesearch-landing-dev

# Check IAM role
aws sts get-caller-identity
aws iam get-role --role-name CISFileScannerRole
aws iam list-attached-role-policies --role-name CISFileScannerRole
```

**Solutions:**
1. Verify IAM policy includes required actions
2. Check bucket policy doesn't explicitly deny
3. Verify role is attached to EC2 instance
4. Check public access block settings

### Issue 2: Slow Upload Speeds

**Symptoms:**
- Uploads taking much longer than expected
- Timeout errors

**Diagnosis:**
```bash
# Test network speed to S3
aws s3 cp /dev/zero s3://cis-filesearch-landing-dev/test/speedtest --region ap-northeast-1 \
  --expected-size 104857600 \
  --no-progress

# Check if using VPC endpoint
aws ec2 describe-vpc-endpoints --filters "Name=service-name,Values=com.amazonaws.ap-northeast-1.s3"
```

**Solutions:**
1. Enable VPC endpoint (see VPC guide)
2. Increase multipart upload concurrency in code
3. Use Transfer Acceleration (if geographically distant)
4. Check EC2 instance network performance

### Issue 3: High Costs

**Diagnosis:**
```bash
# Check bucket size
aws s3 ls s3://cis-filesearch-landing-dev --recursive --summarize | grep "Total Size"

# Check storage classes
aws s3api list-objects-v2 \
  --bucket cis-filesearch-landing-dev \
  --query 'Contents[*].[Key,StorageClass,Size]' \
  --output table

# Check incomplete uploads
aws s3api list-multipart-uploads --bucket cis-filesearch-landing-dev
```

**Solutions:**
1. Enable lifecycle policies
2. Delete test/debug data
3. Move cold data to Glacier
4. Enable Intelligent-Tiering
5. Cleanup incomplete multipart uploads

### Issue 4: Objects Not Transitioning

**Symptoms:**
- Lifecycle rules exist but objects stay in Standard

**Diagnosis:**
```bash
# Check lifecycle configuration
aws s3api get-bucket-lifecycle-configuration --bucket cis-filesearch-landing-dev

# Check object age
aws s3api head-object \
  --bucket cis-filesearch-landing-dev \
  --key files/test.pdf \
  | grep LastModified
```

**Causes:**
1. Lifecycle rules take 24-48 hours to apply
2. Minimum storage duration not met (30 days for IA)
3. Objects too small (< 128KB for Intelligent-Tiering)
4. Rules disabled or misconfigured

**Solutions:**
1. Wait 24-48 hours
2. Check filter matches your objects
3. Verify rule status is "Enabled"

### Issue 5: Versioning Increasing Costs

**Symptoms:**
- Unexpected storage costs
- Much more data than expected

**Diagnosis:**
```bash
# Count versions
aws s3api list-object-versions \
  --bucket cis-filesearch-landing-dev \
  --query 'length(Versions)'

# Check noncurrent version size
aws s3api list-object-versions \
  --bucket cis-filesearch-landing-dev \
  --query 'Versions[?IsLatest==`false`].[Key,Size]' \
  --output table
```

**Solutions:**
1. Add lifecycle rule to delete old versions
2. Suspend versioning if not needed
3. Permanently delete unneeded versions

### Issue 6: CORS Errors

**Symptoms:**
```
Access to fetch at 'https://bucket.s3.amazonaws.com/file' has been blocked by CORS policy
```

**Diagnosis:**
```bash
# Check CORS config
aws s3api get-bucket-cors --bucket cis-filesearch-landing-dev
```

**Solutions:**
1. Add your domain to AllowedOrigins
2. Include required headers in AllowedHeaders
3. Check if bucket policy blocks requests
4. Use HTTPS (not HTTP) in AllowedOrigins

### Issue 7: Encryption Key Errors

**Symptoms:**
```
The object was stored using a form of encryption that is not supported
```

**Diagnosis:**
```bash
# Check encryption type
aws s3api head-object \
  --bucket cis-filesearch-landing-dev \
  --key files/test.pdf
```

**Solutions:**
1. If using SSE-KMS, ensure IAM role has KMS permissions
2. Verify KMS key policy allows decryption
3. Use SSE-S3 for simpler setup

### Common Permission Issues

**Test minimal permissions:**

```bash
# Create test role
aws iam create-role --role-name S3TestRole --assume-role-policy-document '{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "ec2.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}'

# Attach minimal S3 policy
aws iam put-role-policy --role-name S3TestRole --policy-name S3Access --policy-document '{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject"],
    "Resource": "arn:aws:s3:::cis-filesearch-landing-dev/*"
  }]
}'
```

---

## Summary Checklist

Use this checklist to ensure proper S3 configuration:

- [ ] Bucket created with proper naming convention
- [ ] Versioning enabled
- [ ] Default encryption (SSE-S3) enabled
- [ ] Block public access enabled (all 4 settings)
- [ ] Lifecycle policies configured
- [ ] IAM policies created and attached
- [ ] Bucket policies applied (if needed)
- [ ] CORS configured (if needed)
- [ ] Tags added for cost tracking
- [ ] VPC endpoint created (see VPC guide)
- [ ] Upload test successful
- [ ] Multipart upload test successful
- [ ] Permission test successful
- [ ] Monitoring configured (CloudWatch metrics)

---

## Next Steps

1. **Configure SQS**: See `aws-sqs-configuration-guide.md`
2. **Configure CloudWatch**: See `aws-cloudwatch-configuration-guide.md`
3. **Create VPC Endpoints**: See `aws-vpc-endpoints-guide.md`
4. **Update Scanner Code**: Update `.env` with bucket name
5. **Run Test Scan**: Execute `yarn dev scan --dry-run`

---

## Additional Resources

- [S3 User Guide](https://docs.aws.amazon.com/s3/index.html)
- [S3 Pricing Calculator](https://calculator.aws/)
- [S3 Storage Classes Comparison](https://aws.amazon.com/s3/storage-classes/)
- [S3 Security Best Practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)
- [S3 Performance Optimization](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html)

---

**Document Version**: 1.0
**Last Updated**: 2025-01-12
**Author**: CIS Development Team
