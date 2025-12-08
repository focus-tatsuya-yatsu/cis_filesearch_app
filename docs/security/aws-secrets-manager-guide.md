# AWS Secrets Manager Security Guide

## Table of Contents

1. [Introduction](#introduction)
2. [Threat Model & Security Rationale](#threat-model--security-rationale)
3. [Secret Creation](#secret-creation)
4. [Secret Rotation](#secret-rotation)
5. [Application Integration](#application-integration)
6. [Encryption Strategy](#encryption-strategy)
7. [Access Logging & Audit](#access-logging--audit)
8. [Version Management](#version-management)
9. [Migration from .env to Secrets Manager](#migration-from-env-to-secrets-manager)
10. [Cost Optimization](#cost-optimization)
11. [Common Security Mistakes](#common-security-mistakes)
12. [Incident Response](#incident-response)

---

## Introduction

This guide provides comprehensive instructions for securely storing and managing sensitive credentials using AWS Secrets Manager. The CIS File Scanner Backend handles database credentials, NAS credentials, and API keys that must be protected according to industry best practices.

**Security Priority**: P0 (Critical)

**Compliance Requirements**:
- GDPR Article 32 (Security of Processing - Encryption)
- SOC 2 CC6.1 (Logical and Physical Access Controls)
- ISO 27001 A.10.1 (Cryptographic Controls)
- PCI-DSS 3.2.1 Requirement 8 (Identify and Authenticate Access)

---

## Threat Model & Security Rationale

### Attack Vectors

**1. Plaintext Credentials in .env Files (CVSS 9.8 - Critical)**
- **Scenario**: Developer commits `.env` file to Git repository
- **Impact**: Credentials exposed in Git history (persists even after file deletion)
- **Real-world Example**: GitHub has 100,000+ exposed secrets per day
- **Business Impact**: Full database access, data breach, compliance violations

**2. Hardcoded Credentials in Source Code (CVSS 9.1 - Critical)**
- **Scenario**: Database password embedded directly in application code
- **Example**:
  ```javascript
  const db = new Database({
    host: 'db.example.com',
    password: 'P@ssw0rd123!' // ❌ Never do this!
  });
  ```
- **Impact**: Credentials visible to all developers, no rotation possible

**3. Secrets Exposed via Application Logs (CVSS 7.5 - High)**
- **Scenario**: Application logs full database connection string with password
- **Example**: `console.log('Connecting to:', connectionString)` exposes credentials
- **Impact**: Logs are often shipped to third-party services (Splunk, Datadog), expanding attack surface

**4. No Credential Rotation (CVSS 6.5 - Medium)**
- **Scenario**: Same database password used for 3+ years
- **Impact**: Compromised credentials remain valid indefinitely
- **Compliance Violation**: SOC 2 requires periodic credential rotation

**5. Excessive Access to Secrets (CVSS 7.2 - High)**
- **Scenario**: All developers have access to production database credentials
- **Impact**: Insider threats, accidental data deletion, compliance violations

### Security Controls

Secrets Manager mitigates these threats through:

1. **Encryption at Rest**: AES-256 encryption with AWS KMS
2. **Encryption in Transit**: TLS 1.2+ for all API calls
3. **Automatic Rotation**: Lambda-based credential rotation every 30-90 days
4. **Fine-grained Access Control**: IAM policies limit who can read secrets
5. **Audit Logging**: CloudTrail tracks all secret access
6. **Version Management**: Roll back to previous credentials if needed

---

## Secret Creation

### What to Store in Secrets Manager

**✅ Store These**:
- Database credentials (username, password, connection string)
- NAS access credentials (SMB/NFS passwords, SSH keys)
- API keys for external services
- Encryption keys for application-level encryption
- OAuth client secrets
- JWT signing keys

**❌ Do NOT Store These** (use Parameter Store instead):
- Configuration values (e.g., `APP_ENV=production`)
- Non-sensitive settings (e.g., `LOG_LEVEL=info`)
- Public API endpoints
- Feature flags

**Cost Rationale**: Secrets Manager costs $0.40/secret/month. Don't waste money on non-sensitive data.

---

### Step 1: Create Database Credentials Secret (Console)

1. Navigate to **AWS Secrets Manager Console**
2. Click **Store a new secret**
3. Select **Secret type**: `Credentials for RDS database`
4. Enter credentials:
   - **User name**: `cis_app_user`
   - **Password**: Click **Generate** (use 32+ character random password)
   - **Encryption key**: Select `aws/secretsmanager` (AWS managed key for dev)
5. Select **Database**: Choose your RDS instance from dropdown
   - This automatically populates host, port, database name
6. Click **Next**
7. **Secret name**: `cis-file-scanner/dev/database`
   - Use hierarchical naming: `{app}/{environment}/{secret-type}`
8. **Description**: `Database credentials for CIS File Scanner backend (dev environment)`
9. **Tags**:
   - `Environment=dev`
   - `Application=CISFileScanner`
   - `RotationEnabled=true`
   - `ComplianceScope=GDPR,SOC2`
10. Click **Next**
11. **Rotation**:
    - ✅ Enable automatic rotation
    - **Rotation schedule**: Every 30 days
    - **Rotation function**: Select existing Lambda or create new (see Rotation section)
12. Click **Next**
13. Review and click **Store**

---

### Step 1: Create Database Credentials Secret (CLI)

```bash
# Generate strong random password
DB_PASSWORD=$(openssl rand -base64 32)

# Create secret with metadata
aws secretsmanager create-secret \
  --name cis-file-scanner/dev/database \
  --description "Database credentials for CIS File Scanner backend (dev)" \
  --secret-string "{
    \"username\": \"cis_app_user\",
    \"password\": \"$DB_PASSWORD\",
    \"engine\": \"postgres\",
    \"host\": \"cis-file-scanner-dev.c9akl.ap-northeast-1.rds.amazonaws.com\",
    \"port\": 5432,
    \"dbname\": \"cis_file_scanner_dev\",
    \"dbInstanceIdentifier\": \"cis-file-scanner-dev\"
  }" \
  --tags Key=Environment,Value=dev \
         Key=Application,Value=CISFileScanner \
         Key=RotationEnabled,Value=true \
         Key=ComplianceScope,Value=GDPR,SOC2 \
  --kms-key-id alias/aws/secretsmanager

# Output:
# {
#   "ARN": "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:cis-file-scanner/dev/database-AbCdEf",
#   "Name": "cis-file-scanner/dev/database",
#   "VersionId": "a1b2c3d4-5678-90ab-cdef-EXAMPLE11111"
# }
```

**Security Notes**:
1. **Password Strength**: 32+ characters, generated cryptographically
2. **Secret Structure**: JSON format for structured data (easier for rotation Lambda)
3. **KMS Key**: Using AWS managed key (`aws/secretsmanager`) for dev. Consider CMK for prod.

---

### Step 2: Create NAS Credentials Secret

NAS credentials are stored separately from database credentials for isolation.

```bash
# Create NAS credentials secret
aws secretsmanager create-secret \
  --name cis-file-scanner/dev/nas-credentials \
  --description "NAS SMB credentials for file scanner (dev)" \
  --secret-string "{
    \"username\": \"nas_scanner_user\",
    \"password\": \"$(openssl rand -base64 32)\",
    \"domain\": \"CORP\",
    \"server\": \"nas.corp.internal\",
    \"share\": \"client_files\"
  }" \
  --tags Key=Environment,Value=dev \
         Key=Application,Value=CISFileScanner \
         Key=RotationEnabled,Value=false \
  --kms-key-id alias/aws/secretsmanager

# Note: NAS credentials often can't be auto-rotated (requires manual NAS admin changes)
```

---

### Step 3: Create API Key Secret

For external service API keys (e.g., OCR service, document processing).

```bash
# Create API key secret
aws secretsmanager create-secret \
  --name cis-file-scanner/dev/ocr-api-key \
  --description "OCR service API key (dev)" \
  --secret-string "{
    \"api_key\": \"sk_test_1234567890abcdef\",
    \"api_endpoint\": \"https://api.ocr-service.com/v1\"
  }" \
  --tags Key=Environment,Value=dev \
         Key=Application,Value=CISFileScanner \
  --kms-key-id alias/aws/secretsmanager
```

---

## Secret Rotation

### Why Rotate Credentials?

**Compliance Requirements**:
- **SOC 2 CC6.1**: Credentials must be periodically changed
- **PCI-DSS 8.2.4**: Change user passwords every 90 days
- **ISO 27001 A.9.3**: Periodic review and update of access credentials

**Security Benefits**:
- Limits window of opportunity for compromised credentials
- Detects inactive/orphaned accounts
- Forces review of who has access

**Recommended Rotation Frequency**:
- **Production Database**: Every 30 days
- **Staging Database**: Every 60 days
- **Development Database**: Every 90 days
- **API Keys**: Every 90 days (if supported by vendor)
- **NAS Credentials**: Every 180 days (requires manual coordination)

---

### Automatic Rotation Architecture

```
┌─────────────────┐
│ Secrets Manager │
│  (Rotation      │
│   Scheduled)    │
└────────┬────────┘
         │ Triggers every 30 days
         ▼
┌─────────────────┐
│ Lambda Function │
│ (Rotation Logic)│
└────────┬────────┘
         │
         ├─────► 1. Create new password in RDS
         │
         ├─────► 2. Update secret with new password
         │
         ├─────► 3. Test new credentials
         │
         └─────► 4. Mark old password for deletion (deprecated version)
```

**Key Concept**: Secrets Manager maintains **two versions** during rotation:
- `AWSCURRENT`: Currently active credentials (used by app)
- `AWSPENDING`: New credentials being tested (not yet active)

This allows **zero-downtime rotation** - applications continue using old credentials while new ones are being created and tested.

---

### Step 1: Create Rotation Lambda Function

**Option A: Use AWS Provided Rotation Function (Recommended)**

AWS provides pre-built rotation functions for RDS databases.

```bash
# Create execution role for Lambda
cat > /tmp/lambda-trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

aws iam create-role \
  --role-name SecretsManagerRDSRotationLambda \
  --assume-role-policy-document file:///tmp/lambda-trust-policy.json

# Attach policies
aws iam attach-role-policy \
  --role-name SecretsManagerRDSRotationLambda \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws iam attach-role-policy \
  --role-name SecretsManagerRDSRotationLambda \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole

# Create custom policy for Secrets Manager access
cat > /tmp/lambda-secrets-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:DescribeSecret",
        "secretsmanager:GetSecretValue",
        "secretsmanager:PutSecretValue",
        "secretsmanager:UpdateSecretVersionStage"
      ],
      "Resource": "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:cis-file-scanner/dev/database-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetRandomPassword"
      ],
      "Resource": "*"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name SecretsManagerRDSRotationLambda \
  --policy-name SecretsManagerAccess \
  --policy-document file:///tmp/lambda-secrets-policy.json

# Deploy AWS-provided rotation function
aws serverlessrepo create-cloud-formation-change-set \
  --application-id arn:aws:serverlessrepo:us-east-1:297356227824:applications/SecretsManagerRDSPostgreSQLRotationSingleUser \
  --stack-name CISFileScannerRotationFunction \
  --parameter-overrides Name=endpoint,Value=https://secretsmanager.ap-northeast-1.amazonaws.com \
                        Name=functionName,Value=CISFileScannerDBRotation
```

**Option B: Custom Rotation Function (Advanced)**

For custom rotation logic (e.g., NAS credentials, API keys).

**Lambda Code** (`rotation-function.js`):

```javascript
const AWS = require('aws-sdk');
const secretsmanager = new AWS.SecretsManager();

exports.handler = async (event) => {
  const token = event.Token;
  const arn = event.SecretId;
  const step = event.Step;

  console.log(`Rotation step: ${step} for secret: ${arn}`);

  try {
    switch (step) {
      case 'createSecret':
        await createSecret(arn, token);
        break;
      case 'setSecret':
        await setSecret(arn, token);
        break;
      case 'testSecret':
        await testSecret(arn, token);
        break;
      case 'finishSecret':
        await finishSecret(arn, token);
        break;
      default:
        throw new Error(`Invalid step: ${step}`);
    }

    return { statusCode: 200, body: 'Rotation successful' };
  } catch (error) {
    console.error('Rotation failed:', error);
    throw error;
  }
};

// Step 1: Create new password in AWSPENDING version
async function createSecret(arn, token) {
  // Check if secret version already exists
  let metadata;
  try {
    metadata = await secretsmanager.describeSecret({ SecretId: arn }).promise();
  } catch (error) {
    throw new Error(`Failed to describe secret: ${error.message}`);
  }

  // If AWSPENDING version already exists with this token, skip
  if (metadata.VersionIdsToStages[token]?.includes('AWSPENDING')) {
    console.log('AWSPENDING version already exists, skipping createSecret');
    return;
  }

  // Generate new password
  const newPassword = await secretsmanager.getRandomPassword({
    PasswordLength: 32,
    ExcludeCharacters: '"@/\\\'',
    RequireEachIncludedType: true
  }).promise();

  // Get current secret value
  const currentSecret = await secretsmanager.getSecretValue({
    SecretId: arn,
    VersionStage: 'AWSCURRENT'
  }).promise();

  const secretData = JSON.parse(currentSecret.SecretString);
  secretData.password = newPassword.RandomPassword;

  // Store new password as AWSPENDING
  await secretsmanager.putSecretValue({
    SecretId: arn,
    ClientRequestToken: token,
    SecretString: JSON.stringify(secretData),
    VersionStages: ['AWSPENDING']
  }).promise();

  console.log('New password created and stored as AWSPENDING');
}

// Step 2: Update database with new password
async function setSecret(arn, token) {
  const pendingSecret = await secretsmanager.getSecretValue({
    SecretId: arn,
    VersionId: token,
    VersionStage: 'AWSPENDING'
  }).promise();

  const secretData = JSON.parse(pendingSecret.SecretString);

  // Connect to database with CURRENT credentials and update password
  const { Client } = require('pg');

  // Get CURRENT credentials for admin access
  const currentSecret = await secretsmanager.getSecretValue({
    SecretId: arn,
    VersionStage: 'AWSCURRENT'
  }).promise();

  const currentData = JSON.parse(currentSecret.SecretString);

  // Connect as admin user (assuming master credentials exist separately)
  const adminClient = new Client({
    host: secretData.host,
    port: secretData.port,
    database: secretData.dbname,
    user: 'postgres', // Master user
    password: process.env.MASTER_PASSWORD // Stored in separate secret
  });

  await adminClient.connect();

  // Update password for application user
  await adminClient.query(
    `ALTER USER ${secretData.username} WITH PASSWORD $1`,
    [secretData.password]
  );

  await adminClient.end();

  console.log('Password updated in database');
}

// Step 3: Test new credentials
async function testSecret(arn, token) {
  const pendingSecret = await secretsmanager.getSecretValue({
    SecretId: arn,
    VersionId: token,
    VersionStage: 'AWSPENDING'
  }).promise();

  const secretData = JSON.parse(pendingSecret.SecretString);

  // Test connection with new credentials
  const { Client } = require('pg');
  const testClient = new Client({
    host: secretData.host,
    port: secretData.port,
    database: secretData.dbname,
    user: secretData.username,
    password: secretData.password
  });

  await testClient.connect();
  const result = await testClient.query('SELECT 1');
  await testClient.end();

  if (result.rows.length !== 1) {
    throw new Error('Test query failed');
  }

  console.log('New credentials tested successfully');
}

// Step 4: Finalize rotation (move AWSPENDING to AWSCURRENT)
async function finishSecret(arn, token) {
  const metadata = await secretsmanager.describeSecret({ SecretId: arn }).promise();

  // Get the current version
  const currentVersion = Object.keys(metadata.VersionIdsToStages).find(
    key => metadata.VersionIdsToStages[key].includes('AWSCURRENT')
  );

  // Move AWSCURRENT to AWSPREVIOUS
  await secretsmanager.updateSecretVersionStage({
    SecretId: arn,
    VersionStage: 'AWSCURRENT',
    MoveToVersionId: token,
    RemoveFromVersionId: currentVersion
  }).promise();

  console.log('Rotation completed, new version is now AWSCURRENT');
}
```

**Deploy Custom Lambda**:

```bash
# Package Lambda
zip rotation-function.zip rotation-function.js
cd node_modules && zip -r ../rotation-function.zip . && cd ..

# Create Lambda function
aws lambda create-function \
  --function-name CISFileScannerDBRotation \
  --runtime nodejs18.x \
  --role arn:aws:iam::123456789012:role/SecretsManagerRDSRotationLambda \
  --handler rotation-function.handler \
  --zip-file fileb://rotation-function.zip \
  --timeout 30 \
  --vpc-config SubnetIds=subnet-12345,subnet-67890,SecurityGroupIds=sg-12345 \
  --environment Variables={MASTER_PASSWORD_SECRET=cis-file-scanner/dev/master-password}
```

---

### Step 2: Enable Rotation on Secret

```bash
# Enable automatic rotation
aws secretsmanager rotate-secret \
  --secret-id cis-file-scanner/dev/database \
  --rotation-lambda-arn arn:aws:lambda:ap-northeast-1:123456789012:function:CISFileScannerDBRotation \
  --rotation-rules AutomaticallyAfterDays=30

# Verify rotation configuration
aws secretsmanager describe-secret \
  --secret-id cis-file-scanner/dev/database \
  --query 'RotationEnabled'

# Expected output: true
```

---

### Step 3: Test Rotation Manually

Before waiting 30 days, test rotation immediately:

```bash
# Trigger immediate rotation
aws secretsmanager rotate-secret \
  --secret-id cis-file-scanner/dev/database

# Monitor rotation progress
aws secretsmanager describe-secret \
  --secret-id cis-file-scanner/dev/database \
  --query 'VersionIdsToStages'

# Expected output:
# {
#   "a1b2c3d4-5678-90ab-cdef-EXAMPLE11111": ["AWSCURRENT"],
#   "e5f6g7h8-1234-56ij-klmn-EXAMPLE22222": ["AWSPENDING"]
# }

# Wait 1-2 minutes for rotation to complete
sleep 120

# Verify rotation succeeded
aws secretsmanager describe-secret \
  --secret-id cis-file-scanner/dev/database \
  --query 'VersionIdsToStages'

# Expected output (AWSPENDING moved to AWSCURRENT):
# {
#   "e5f6g7h8-1234-56ij-klmn-EXAMPLE22222": ["AWSCURRENT"],
#   "a1b2c3d4-5678-90ab-cdef-EXAMPLE11111": ["AWSPREVIOUS"]
# }
```

**Check Lambda Logs**:

```bash
aws logs tail /aws/lambda/CISFileScannerDBRotation --follow
```

**Common Rotation Errors**:
- **`setSecret` fails**: Master password secret not accessible (check Lambda IAM role)
- **`testSecret` fails**: VPC configuration issue (Lambda can't reach RDS)
- **Timeout**: Lambda timeout too short (increase to 60 seconds)

---

## Application Integration

### Node.js Integration (Express Backend)

**Security Requirements**:
1. Never cache secrets for more than 5 minutes (they might rotate)
2. Handle rotation gracefully (catch connection errors, retry with new credentials)
3. Never log secrets (even in error messages)

#### Implementation

**`src/config/secrets.js`**:

```javascript
const AWS = require('aws-sdk');
const secretsmanager = new AWS.SecretsManager({
  region: process.env.AWS_REGION || 'ap-northeast-1'
});

// Cache secrets for 5 minutes to reduce API calls
const secretCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Retrieves a secret from AWS Secrets Manager
 * @param {string} secretId - Secret ARN or name
 * @returns {Promise<Object>} - Parsed secret data
 */
async function getSecret(secretId) {
  // Check cache
  const cached = secretCache.get(secretId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[Secrets] Using cached secret: ${secretId}`);
    return cached.data;
  }

  try {
    console.log(`[Secrets] Fetching secret from AWS: ${secretId}`);

    const response = await secretsmanager.getSecretValue({
      SecretId: secretId,
      VersionStage: 'AWSCURRENT' // Always use current version
    }).promise();

    let secretData;
    if (response.SecretString) {
      secretData = JSON.parse(response.SecretString);
    } else {
      // Binary secrets (e.g., SSH keys)
      secretData = Buffer.from(response.SecretBinary, 'base64');
    }

    // Cache the secret
    secretCache.set(secretId, {
      data: secretData,
      timestamp: Date.now()
    });

    console.log(`[Secrets] Secret retrieved successfully: ${secretId}`);
    return secretData;

  } catch (error) {
    console.error(`[Secrets] Failed to retrieve secret: ${secretId}`, {
      error: error.code,
      // ⚠️ NEVER log error.message (might contain secret data)
    });
    throw new Error(`Failed to retrieve secret: ${error.code}`);
  }
}

/**
 * Clear secret cache (call this when rotation is detected)
 */
function clearCache() {
  secretCache.clear();
  console.log('[Secrets] Cache cleared');
}

module.exports = {
  getSecret,
  clearCache
};
```

**`src/config/database.js`**:

```javascript
const { Pool } = require('pg');
const { getSecret, clearCache } = require('./secrets');

let pool;
let currentSecretVersion;

/**
 * Initialize database connection pool with Secrets Manager credentials
 */
async function initializeDatabase() {
  const secretId = `cis-file-scanner/${process.env.NODE_ENV}/database`;

  try {
    const dbSecret = await getSecret(secretId);

    // Track secret version for rotation detection
    currentSecretVersion = dbSecret.version || Date.now();

    pool = new Pool({
      host: dbSecret.host,
      port: dbSecret.port,
      database: dbSecret.dbname,
      user: dbSecret.username,
      password: dbSecret.password,
      max: 20, // Maximum connections
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      // ⚠️ Never log connection string (contains password)
      // log: console.log // DO NOT ENABLE
    });

    // Test connection
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();

    console.log('[Database] Connection pool initialized successfully');

  } catch (error) {
    console.error('[Database] Failed to initialize connection pool:', error.code);
    throw error;
  }
}

/**
 * Get database connection pool
 * Handles credential rotation gracefully
 */
async function getPool() {
  if (!pool) {
    await initializeDatabase();
  }

  return pool;
}

/**
 * Handle database errors (including credential rotation)
 */
async function handleDatabaseError(error) {
  const rotationErrors = [
    '28P01', // Invalid password (password was rotated)
    '28000', // Invalid authorization specification
    'ECONNREFUSED' // Connection refused (credentials changed)
  ];

  if (rotationErrors.includes(error.code)) {
    console.warn('[Database] Detected credential rotation, reinitializing pool');

    // Close existing pool
    if (pool) {
      await pool.end();
      pool = null;
    }

    // Clear secret cache to force refresh
    clearCache();

    // Reinitialize with new credentials
    await initializeDatabase();

    return true; // Retry the operation
  }

  return false; // Don't retry
}

/**
 * Execute query with automatic retry on rotation
 */
async function query(sql, params, retryCount = 0) {
  try {
    const client = await (await getPool()).connect();
    const result = await client.query(sql, params);
    client.release();
    return result;

  } catch (error) {
    // Handle credential rotation
    const shouldRetry = await handleDatabaseError(error);

    if (shouldRetry && retryCount < 3) {
      console.log(`[Database] Retrying query (attempt ${retryCount + 1}/3)`);
      return query(sql, params, retryCount + 1);
    }

    throw error;
  }
}

module.exports = {
  initializeDatabase,
  query,
  getPool
};
```

**`src/server.js`**:

```javascript
const express = require('express');
const { initializeDatabase } = require('./config/database');

const app = express();

async function startServer() {
  try {
    // Initialize database with Secrets Manager credentials
    await initializeDatabase();

    app.listen(3000, () => {
      console.log('[Server] Started on port 3000');
    });

  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

startServer();
```

---

### Environment Variables (Non-Secret Configuration)

**`.env.local`** (Not committed to Git):

```bash
# Node environment
NODE_ENV=development

# AWS configuration
AWS_REGION=ap-northeast-1

# Secrets Manager secret IDs (not sensitive - just pointers)
DB_SECRET_ID=cis-file-scanner/dev/database
NAS_SECRET_ID=cis-file-scanner/dev/nas-credentials
OCR_API_SECRET_ID=cis-file-scanner/dev/ocr-api-key

# Non-sensitive application config
PORT=3000
LOG_LEVEL=debug
```

**Security Note**: Secret IDs are not sensitive (they're just pointers). The actual credentials are retrieved securely at runtime.

---

## Encryption Strategy

### KMS Key Options

| Option | Cost | Security Level | Use Case |
|--------|------|----------------|----------|
| **AWS Managed Key** (`aws/secretsmanager`) | Free | ✅ Good | Development, staging environments |
| **Customer Managed Key (CMK)** | $1/month + API calls | ✅ Excellent | Production, compliance-critical applications |

---

### When to Use Customer Managed Keys (CMK)

**Use CMK if you need**:
1. **Custom Key Rotation Schedule**: Rotate every 90 days instead of AWS's yearly rotation
2. **Cross-Account Access**: Share secrets across AWS accounts (rare but possible)
3. **Audit Trail**: CloudTrail logs every encryption/decryption operation
4. **Key Deletion Control**: Enforce mandatory 7-30 day waiting period before deletion
5. **Compliance Requirements**: Some regulations mandate customer-controlled encryption keys

**Example**: Production database credentials for a HIPAA-compliant application.

---

### Creating a Customer Managed Key

```bash
# Create CMK for Secrets Manager
aws kms create-key \
  --description "CMK for CIS File Scanner production secrets" \
  --key-policy file:///tmp/kms-key-policy.json \
  --tags TagKey=Environment,TagValue=prod \
         TagKey=Application,TagValue=CISFileScanner

# Get key ID from output
KEY_ID="a1b2c3d4-5678-90ab-cdef-EXAMPLE11111"

# Create alias for easier reference
aws kms create-alias \
  --alias-name alias/cis-file-scanner-prod-secrets \
  --target-key-id $KEY_ID

# Enable automatic key rotation (every 365 days)
aws kms enable-key-rotation --key-id $KEY_ID
```

**Key Policy** (`kms-key-policy.json`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Enable IAM User Permissions",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:root"
      },
      "Action": "kms:*",
      "Resource": "*"
    },
    {
      "Sid": "Allow Secrets Manager to use the key",
      "Effect": "Allow",
      "Principal": {
        "Service": "secretsmanager.amazonaws.com"
      },
      "Action": [
        "kms:Decrypt",
        "kms:GenerateDataKey"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "kms:ViaService": "secretsmanager.ap-northeast-1.amazonaws.com"
        }
      }
    },
    {
      "Sid": "Allow EC2 role to decrypt secrets",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:role/CISFileScannerEC2Role-prod"
      },
      "Action": [
        "kms:Decrypt",
        "kms:DescribeKey"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "kms:ViaService": "secretsmanager.ap-northeast-1.amazonaws.com"
        }
      }
    }
  ]
}
```

**Cost Analysis**:
- CMK: $1/month
- API Calls: $0.03 per 10,000 requests
- Expected calls: ~50,000/month (1 per Lambda invocation + EC2 retrievals)
- **Total**: ~$1.15/month

**Recommendation**: Use CMK for production, AWS managed key for dev/staging.

---

## Access Logging & Audit

### CloudTrail Logging

**Security Rationale**: Every secret access must be logged for audit compliance.

**Events to Monitor**:
- `GetSecretValue`: Someone retrieved secret (normal during app startup)
- `PutSecretValue`: Secret was modified (should only be rotation Lambda)
- `DeleteSecret`: Secret was deleted (should NEVER happen in prod without approval)
- `UpdateSecretVersionStage`: Rotation occurred

---

### Step 1: Enable CloudTrail (if not already enabled)

```bash
# Create S3 bucket for CloudTrail logs
aws s3api create-bucket \
  --bucket cis-audit-logs-123456789012 \
  --region ap-northeast-1 \
  --create-bucket-configuration LocationConstraint=ap-northeast-1

# Enable bucket versioning (compliance requirement)
aws s3api put-bucket-versioning \
  --bucket cis-audit-logs-123456789012 \
  --versioning-configuration Status=Enabled

# Block public access (critical!)
aws s3api put-public-access-block \
  --bucket cis-audit-logs-123456789012 \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Create CloudTrail
aws cloudtrail create-trail \
  --name cis-file-scanner-audit-trail \
  --s3-bucket-name cis-audit-logs-123456789012 \
  --is-multi-region-trail \
  --include-global-service-events

# Start logging
aws cloudtrail start-logging \
  --name cis-file-scanner-audit-trail
```

---

### Step 2: Create CloudWatch Alarm for Unauthorized Secret Access

```bash
# Create metric filter
aws logs put-metric-filter \
  --log-group-name /aws/cloudtrail/cis-file-scanner \
  --filter-name UnauthorizedSecretAccess \
  --filter-pattern '{ ($.eventName = GetSecretValue) && ($.errorCode = AccessDenied) }' \
  --metric-transformations \
    metricName=UnauthorizedSecretAccess,metricNamespace=CISFileScannerSecurity,metricValue=1

# Create alarm
aws cloudwatch put-metric-alarm \
  --alarm-name CIS-UnauthorizedSecretAccess \
  --alarm-description "Alert when someone tries to access secrets without permission" \
  --metric-name UnauthorizedSecretAccess \
  --namespace CISFileScannerSecurity \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --actions-enabled \
  --alarm-actions arn:aws:sns:ap-northeast-1:123456789012:SecurityAlerts
```

---

### Step 3: Query CloudTrail for Secret Access

```bash
# Get all GetSecretValue events in last 7 days
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=GetSecretValue \
  --start-time $(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S) \
  --max-items 100 \
  --query 'Events[*].[Username,EventTime,Resources[0].ResourceName]' \
  --output table

# Example output:
# |  Username  |     EventTime       |           ResourceName              |
# |------------|---------------------|-------------------------------------|
# | ec2-role   | 2025-01-12T10:00:00 | cis-file-scanner/prod/database      |
# | ec2-role   | 2025-01-12T11:30:00 | cis-file-scanner/prod/database      |
# | developer1 | 2025-01-11T09:00:00 | cis-file-scanner/dev/database       |
```

**What to Look For**:
- Unexpected users accessing secrets (insider threats)
- Access from unusual IP addresses or regions
- High frequency of access (possible credential harvesting)
- Access outside business hours (suspicious)

---

## Version Management

### Secret Versioning Explained

Secrets Manager automatically creates versions when secrets are updated.

**Version Stages**:
- `AWSCURRENT`: Currently active version (used by applications)
- `AWSPENDING`: New version being tested during rotation
- `AWSPREVIOUS`: Previous version (kept for rollback)

**Why Versions Matter**:
- **Zero-downtime rotation**: Apps continue using old credentials while new ones are tested
- **Rollback capability**: If rotation breaks something, roll back to previous version
- **Audit trail**: Track when credentials changed

---

### List Secret Versions

```bash
# Get all versions
aws secretsmanager describe-secret \
  --secret-id cis-file-scanner/dev/database \
  --query 'VersionIdsToStages'

# Example output:
# {
#   "e5f6g7h8-1234-56ij-klmn-EXAMPLE22222": ["AWSCURRENT"],
#   "a1b2c3d4-5678-90ab-cdef-EXAMPLE11111": ["AWSPREVIOUS"],
#   "f9a8b7c6-5432-10zy-xwvu-EXAMPLE33333": []
# }
```

---

### Rollback to Previous Version

If rotation breaks the application:

```bash
# Get the AWSPREVIOUS version ID
PREVIOUS_VERSION=$(aws secretsmanager describe-secret \
  --secret-id cis-file-scanner/dev/database \
  --query 'VersionIdsToStages | keys(@) | [?contains(@, `AWSPREVIOUS`)] | [0]' \
  --output text)

# Move AWSPREVIOUS to AWSCURRENT (rollback)
CURRENT_VERSION=$(aws secretsmanager describe-secret \
  --secret-id cis-file-scanner/dev/database \
  --query 'VersionIdsToStages | keys(@) | [?contains(@, `AWSCURRENT`)] | [0]' \
  --output text)

aws secretsmanager update-secret-version-stage \
  --secret-id cis-file-scanner/dev/database \
  --version-stage AWSCURRENT \
  --move-to-version-id $PREVIOUS_VERSION \
  --remove-from-version-id $CURRENT_VERSION

echo "Rolled back to previous version: $PREVIOUS_VERSION"
```

**Application Impact**: Applications will start using old credentials within 5 minutes (cache TTL).

---

## Migration from .env to Secrets Manager

### Step-by-Step Migration Plan

**Timeline**: 1-2 hours for dev environment, 4 hours for prod (requires change window)

**Pre-Requisites**:
- CloudTrail enabled
- IAM roles configured (see IAM Roles Guide)
- Testing environment available

---

### Phase 1: Preparation (30 minutes)

1. **Audit Current .env Files**:

```bash
# List all .env files in project
find /Users/tatsuya/focus_project/cis_filesearch_app -name ".env*" -type f

# Expected files:
# backend/.env.local
# frontend/.env.local
```

2. **Identify Secrets to Migrate**:

Create inventory:

| Secret Type | Current Location | Destination | Priority |
|-------------|------------------|-------------|----------|
| Database password | `backend/.env.local` | `cis-file-scanner/dev/database` | P0 |
| NAS credentials | `backend/.env.local` | `cis-file-scanner/dev/nas-credentials` | P0 |
| OCR API key | `backend/.env.local` | `cis-file-scanner/dev/ocr-api-key` | P1 |
| JWT secret | `backend/.env.local` | `cis-file-scanner/dev/jwt-secret` | P0 |

3. **Create Backup**:

```bash
# Backup current .env file
cp backend/.env.local backend/.env.local.backup.$(date +%Y%m%d)

# Store backup securely (encrypted)
gpg --encrypt --recipient security@company.com backend/.env.local.backup.20250112
```

---

### Phase 2: Create Secrets in AWS (30 minutes)

```bash
# Read current .env file
source backend/.env.local

# Create database secret
aws secretsmanager create-secret \
  --name cis-file-scanner/dev/database \
  --secret-string "{
    \"username\": \"$DB_USER\",
    \"password\": \"$DB_PASSWORD\",
    \"host\": \"$DB_HOST\",
    \"port\": $DB_PORT,
    \"dbname\": \"$DB_NAME\"
  }"

# Create NAS credentials secret
aws secretsmanager create-secret \
  --name cis-file-scanner/dev/nas-credentials \
  --secret-string "{
    \"username\": \"$NAS_USER\",
    \"password\": \"$NAS_PASSWORD\",
    \"server\": \"$NAS_SERVER\",
    \"share\": \"$NAS_SHARE\"
  }"

# Create JWT secret
aws secretsmanager create-secret \
  --name cis-file-scanner/dev/jwt-secret \
  --secret-string "{
    \"secret\": \"$JWT_SECRET\"
  }"

# Verify secrets created
aws secretsmanager list-secrets \
  --filters Key=name,Values=cis-file-scanner/dev/ \
  --query 'SecretList[*].Name'
```

---

### Phase 3: Update Application Code (1 hour)

1. **Update `package.json`**:

```bash
cd backend
yarn add aws-sdk
```

2. **Create Secrets Integration** (already shown in Application Integration section)

3. **Update Database Configuration**:

Replace:
```javascript
// ❌ OLD: Hardcoded from .env
const pool = new Pool({
  host: process.env.DB_HOST,
  password: process.env.DB_PASSWORD
});
```

With:
```javascript
// ✅ NEW: Secrets Manager
const { getSecret } = require('./config/secrets');

async function initDatabase() {
  const secret = await getSecret('cis-file-scanner/dev/database');
  const pool = new Pool({
    host: secret.host,
    password: secret.password
  });
}
```

---

### Phase 4: Testing (30 minutes)

1. **Test in Development Environment**:

```bash
# Set AWS credentials (for local development only)
export AWS_REGION=ap-northeast-1
export AWS_PROFILE=cis-dev

# Start application
cd backend
yarn start

# Verify secrets loaded
curl http://localhost:3000/health

# Expected output: {"status": "healthy", "database": "connected"}
```

2. **Verify Database Connection**:

```bash
# Check application logs
tail -f backend/logs/app.log | grep "\[Secrets\]"

# Expected:
# [Secrets] Fetching secret from AWS: cis-file-scanner/dev/database
# [Secrets] Secret retrieved successfully
# [Database] Connection pool initialized successfully
```

3. **Test Rotation Handling**:

```bash
# Trigger rotation
aws secretsmanager rotate-secret \
  --secret-id cis-file-scanner/dev/database

# Wait 2 minutes for rotation to complete
sleep 120

# Application should automatically reconnect (check logs)
tail -f backend/logs/app.log | grep "\[Database\]"

# Expected:
# [Database] Detected credential rotation, reinitializing pool
# [Database] Connection pool initialized successfully
```

---

### Phase 5: Cleanup (15 minutes)

1. **Remove Secrets from .env**:

Create new `.env.local`:

```bash
# Node environment
NODE_ENV=development

# AWS configuration
AWS_REGION=ap-northeast-1

# Secret IDs (not sensitive)
DB_SECRET_ID=cis-file-scanner/dev/database
NAS_SECRET_ID=cis-file-scanner/dev/nas-credentials

# Non-sensitive config
PORT=3000
LOG_LEVEL=debug
```

2. **Delete Backup Files Securely**:

```bash
# Shred original .env backup (prevent recovery)
shred -u backend/.env.local.backup.20250112

# Keep encrypted backup for 90 days
mv backend/.env.local.backup.20250112.gpg ~/secure-backups/
```

3. **Update .gitignore**:

```bash
# Add to .gitignore
cat >> .gitignore << 'EOF'

# Secrets and credentials
.env*
!.env.example
*.backup.*
EOF
```

4. **Create .env.example** (for documentation):

```bash
cat > backend/.env.example << 'EOF'
# Environment
NODE_ENV=development

# AWS Configuration
AWS_REGION=ap-northeast-1

# Secrets Manager Secret IDs
DB_SECRET_ID=cis-file-scanner/{environment}/database
NAS_SECRET_ID=cis-file-scanner/{environment}/nas-credentials

# Application Configuration
PORT=3000
LOG_LEVEL=info
EOF
```

---

### Rollback Procedure

If migration fails:

```bash
# 1. Restore .env file
cp backend/.env.local.backup.20250112 backend/.env.local

# 2. Revert code changes
git checkout -- backend/src/config/database.js backend/src/config/secrets.js

# 3. Restart application
yarn restart

# 4. Delete secrets from AWS (cleanup)
aws secretsmanager delete-secret \
  --secret-id cis-file-scanner/dev/database \
  --force-delete-without-recovery
```

---

## Cost Optimization

### Secrets Manager Pricing

**Base Costs**:
- $0.40 per secret per month
- $0.05 per 10,000 API calls

**Example Calculation** (CIS File Scanner - Dev Environment):

| Secret | Count | Cost/Month |
|--------|-------|------------|
| Database credentials | 1 | $0.40 |
| NAS credentials | 1 | $0.40 |
| OCR API key | 1 | $0.40 |
| JWT secret | 1 | $0.40 |
| **Total Secrets** | **4** | **$1.60** |

**API Calls**:
- EC2 instances: 100 retrievals/day = 3,000/month
- Lambda functions: 10,000 invocations/month = 10,000 calls
- **Total**: 13,000 API calls = $0.05/month

**Grand Total**: **$1.65/month per environment**

**Annual Cost**:
- Dev: $1.65 × 12 = $19.80/year
- Staging: $19.80/year
- Production: $19.80/year
- **Total**: **~$60/year**

---

### Cost Optimization Strategies

**1. Use Parameter Store for Non-Sensitive Config**

| Config Type | Storage | Cost |
|-------------|---------|------|
| Sensitive (passwords, API keys) | Secrets Manager | $0.40/secret |
| Non-sensitive (app settings) | Parameter Store | Free |

**Example**:

```bash
# ✅ Store non-sensitive config in Parameter Store (free)
aws ssm put-parameter \
  --name /cis-file-scanner/dev/log-level \
  --value info \
  --type String

# ❌ Don't waste money on Secrets Manager for this
# aws secretsmanager create-secret --name log-level --secret-string info
```

---

**2. Cache Secrets in Application**

**Cost Impact**:
- No cache: 100,000 API calls/month = $0.50
- 5-minute cache: 3,000 API calls/month = $0.01
- **Savings**: $0.49/month × 12 = $5.88/year

**Implementation** (already shown in Application Integration section):

```javascript
const secretCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Reduces API calls by 97%
```

---

**3. Consolidate Related Secrets**

**Instead of**:
```bash
# 4 separate secrets = $1.60/month
aws secretsmanager create-secret --name db-username --secret-string "user"
aws secretsmanager create-secret --name db-password --secret-string "pass"
aws secretsmanager create-secret --name db-host --secret-string "host"
aws secretsmanager create-secret --name db-port --secret-string "5432"
```

**Do this**:
```bash
# 1 combined secret = $0.40/month
aws secretsmanager create-secret \
  --name cis-file-scanner/dev/database \
  --secret-string "{
    \"username\": \"user\",
    \"password\": \"pass\",
    \"host\": \"host\",
    \"port\": 5432
  }"
```

**Savings**: $1.20/month = $14.40/year

---

**4. Secrets Manager vs Parameter Store Comparison**

| Feature | Secrets Manager | Parameter Store (SecureString) |
|---------|----------------|------------------------------|
| **Cost** | $0.40/secret | Free (up to 10,000) |
| **Rotation** | ✅ Automatic (Lambda) | ❌ Manual |
| **Versioning** | ✅ Automatic | ✅ Manual |
| **Encryption** | ✅ KMS (required) | ✅ KMS (optional) |
| **Max Size** | 65 KB | 8 KB |

**Recommendation**:
- **Production**: Secrets Manager (automatic rotation is worth the cost)
- **Development**: Acceptable to use Parameter Store if budget is extremely tight

**Cost Comparison** (5 secrets):
- Secrets Manager: $2/month = $24/year
- Parameter Store: $0/year
- **Difference**: $24/year (acceptable for security benefits)

---

## Common Security Mistakes

### ❌ Mistake 1: Logging Secrets

**Bad Code**:
```javascript
const secret = await getSecret('database');
console.log('Database config:', secret); // ⚠️ Logs password!

// Logs output:
// Database config: { username: 'admin', password: 'SuperSecret123!' }
```

**CVSS Score**: 7.5 (High) - Information Disclosure via Logs

**Fix**:
```javascript
const secret = await getSecret('database');
console.log('Database config loaded'); // ✅ No sensitive data
```

---

### ❌ Mistake 2: No Secret Caching (Excessive API Calls)

**Bad Code**:
```javascript
// Called 1000 times per second
async function handleRequest(req, res) {
  const secret = await getSecret('api-key'); // ⚠️ 1000 API calls/sec
  // ...
}
```

**Cost Impact**: 2.6 billion API calls/month = $13,000/month (!)

**Fix**: Cache for 5 minutes (shown in Application Integration)

---

### ❌ Mistake 3: Using AWSPENDING Instead of AWSCURRENT

**Bad Code**:
```javascript
const secret = await secretsmanager.getSecretValue({
  SecretId: 'database',
  // ⚠️ No VersionStage specified (might get AWSPENDING during rotation)
}).promise();
```

**Impact**: During rotation, application gets new credentials that aren't yet active in database.

**Fix**:
```javascript
const secret = await secretsmanager.getSecretValue({
  SecretId: 'database',
  VersionStage: 'AWSCURRENT' // ✅ Always use current version
}).promise();
```

---

### ❌ Mistake 4: No Rotation Testing Before Production

**Bad Practice**: Enable rotation in production without testing.

**Risk**: Rotation breaks application, causes outage.

**Fix**: Test rotation in dev/staging first:

```bash
# 1. Enable rotation in dev
aws secretsmanager rotate-secret \
  --secret-id cis-file-scanner/dev/database

# 2. Verify application handles rotation gracefully
# 3. ONLY then enable in production
```

---

## Incident Response

### Scenario 1: Secret Exposed in Git History

**Indicators**:
- GitHub Secret Scanning alert
- TruffleHog detects credentials in commit
- Credentials found via public GitHub search

**Immediate Actions** (within 15 minutes):

1. **Rotate Secret Immediately**:
```bash
# Trigger rotation (new credentials generated within 2 minutes)
aws secretsmanager rotate-secret \
  --secret-id cis-file-scanner/prod/database

# Verify rotation completed
aws secretsmanager describe-secret \
  --secret-id cis-file-scanner/prod/database \
  --query 'LastRotatedDate'
```

2. **Revoke Old Credentials in Database**:
```sql
-- Connect to database with master user
-- Revoke permissions from compromised user
REVOKE ALL PRIVILEGES ON DATABASE cis_file_scanner FROM compromised_user;
DROP USER compromised_user;
```

3. **Check for Unauthorized Access**:
```bash
# Query database audit logs
aws rds download-db-log-file-portion \
  --db-instance-identifier cis-file-scanner-prod \
  --log-file-name audit/audit.log \
  --starting-token 0 > /tmp/db-audit.log

# Search for suspicious activity from compromised credentials
grep "compromised_user" /tmp/db-audit.log | grep -E "(DROP|DELETE|TRUNCATE|COPY)"
```

4. **Remove Secret from Git History**:
```bash
# Use BFG Repo-Cleaner
brew install bfg
git clone --mirror https://github.com/your-org/your-repo.git
bfg --replace-text passwords.txt your-repo.git
cd your-repo.git
git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push --force
```

5. **Notify Team**:
```bash
# Send Slack alert
curl -X POST https://hooks.slack.com/services/YOUR/WEBHOOK/URL \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "🚨 SECURITY INCIDENT: Database credentials exposed in Git. Rotation completed. Investigating unauthorized access."
  }'
```

---

### Scenario 2: Rotation Lambda Fails

**Indicators**:
- Lambda timeout errors in CloudWatch
- `RotationEnabled=true` but `LastRotatedDate` is 60+ days ago
- Application connection errors

**Root Cause Analysis**:

```bash
# Check Lambda logs
aws logs tail /aws/lambda/CISFileScannerDBRotation --follow

# Common errors:
# 1. "Task timed out after 30 seconds" → Increase timeout
# 2. "Network error" → Lambda not in VPC / security group misconfigured
# 3. "Access denied to master credentials" → IAM policy issue
```

**Fix Steps**:

```bash
# 1. Increase Lambda timeout
aws lambda update-function-configuration \
  --function-name CISFileScannerDBRotation \
  --timeout 60

# 2. Fix VPC configuration (if network error)
aws lambda update-function-configuration \
  --function-name CISFileScannerDBRotation \
  --vpc-config SubnetIds=subnet-12345,subnet-67890,SecurityGroupIds=sg-12345

# 3. Grant Lambda access to master credentials
# (See Secrets Manager IAM policy in IAM guide)

# 4. Manually trigger rotation to test fix
aws secretsmanager rotate-secret \
  --secret-id cis-file-scanner/dev/database

# 5. Monitor Lambda execution
aws logs tail /aws/lambda/CISFileScannerDBRotation --follow
```

---

### Scenario 3: Secret Deleted Accidentally

**Indicators**:
- Application fails to start: "SecretNotFoundException"
- CloudTrail shows `DeleteSecret` event

**Recovery**:

```bash
# Secrets are soft-deleted (7-30 day recovery window)
# 1. List deleted secrets
aws secretsmanager list-secrets --include-planned-deletion

# 2. Restore secret
aws secretsmanager restore-secret \
  --secret-id cis-file-scanner/prod/database

# 3. Verify restoration
aws secretsmanager describe-secret \
  --secret-id cis-file-scanner/prod/database \
  --query 'DeletedDate'

# Expected output: null (not deleted)
```

**Prevention**:
- Enable deletion protection for production secrets:
```bash
aws secretsmanager update-secret \
  --secret-id cis-file-scanner/prod/database \
  --description "CRITICAL: Production database credentials - DO NOT DELETE" \
  --tags Key=DeletionProtection,Value=enabled
```

---

## Verification Checklist

Before deploying to production:

### Secret Creation
- [ ] All secrets created with descriptive names (`app/environment/type`)
- [ ] Secrets use strong passwords (32+ characters, cryptographically generated)
- [ ] Secrets tagged with Environment, Application, RotationEnabled
- [ ] CMK configured for production secrets (optional but recommended)

### Rotation
- [ ] Rotation Lambda function deployed and tested
- [ ] Rotation enabled on all database secrets (30-90 day schedule)
- [ ] Rotation tested in dev/staging before production
- [ ] Rotation Lambda has VPC access to database
- [ ] Rotation Lambda has IAM permissions to read/update secrets

### Application Integration
- [ ] Application retrieves secrets via AWS SDK (no hardcoded credentials)
- [ ] Secrets cached for 5 minutes (reduces API calls)
- [ ] Application handles credential rotation gracefully (auto-reconnect)
- [ ] Secrets never logged (even in error messages)
- [ ] Always use `VersionStage=AWSCURRENT`

### Security Controls
- [ ] CloudTrail enabled for audit logging
- [ ] CloudWatch alarms configured for unauthorized access
- [ ] IAM policies restrict secret access to specific roles
- [ ] Secrets encrypted with KMS (AWS managed or CMK)
- [ ] `.env` files removed from Git history

### Compliance
- [ ] Secret access logged for 90+ days (SOC 2 requirement)
- [ ] Rotation schedule documented (every 30-90 days)
- [ ] Secrets stored in eu-central-1 or compliant region (GDPR if applicable)
- [ ] Deletion protection enabled for production secrets

---

## Next Steps

1. **Complete this Secrets Manager configuration** ✅
2. **Proceed to**: [Security Best Practices Guide](./security-best-practices-guide.md)
3. **Then**: [Compliance Mapping](./compliance-mapping.md)

---

## References

- [AWS Secrets Manager Documentation](https://docs.aws.amazon.com/secretsmanager/)
- [Secrets Manager Rotation Lambda Templates](https://github.com/aws-samples/aws-secrets-manager-rotation-lambdas)
- [OWASP A02:2021 - Cryptographic Failures](https://owasp.org/Top10/A02_2021-Cryptographic_Failures/)
- [CWE-798: Use of Hard-coded Credentials](https://cwe.mitre.org/data/definitions/798.html)
- [SOC 2 Trust Services Criteria - CC6.1](https://www.aicpa.org/interestareas/frc/assuranceadvisoryservices/socforserviceorganizations.html)

---

**Document Version**: 1.0
**Last Updated**: 2025-01-12
**Author**: Security & Compliance Expert
**Classification**: Internal Use - Security Sensitive
