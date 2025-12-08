# AWS VPC Endpoints Configuration Guide for CIS File Scanner

## Table of Contents
1. [Why This Matters - Understanding VPC Endpoints](#why-this-matters)
2. [Gateway Endpoints (S3, DynamoDB)](#gateway-endpoints)
3. [Interface Endpoints (SQS, CloudWatch)](#interface-endpoints)
4. [Security Group Configuration](#security-group-configuration)
5. [DNS and Routing](#dns-and-routing)
6. [Cost Optimization Analysis](#cost-optimization-analysis)
7. [Verification and Testing](#verification-and-testing)
8. [Troubleshooting](#troubleshooting)

---

## Why This Matters - Understanding VPC Endpoints

### What are VPC Endpoints?

VPC Endpoints allow private connections between your VPC and AWS services **without using the public internet**.

**Without VPC Endpoints:**
```
┌─────────────┐
│   EC2/ECS   │
│  (Scanner)  │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────────┐     ┌─────────┐
│ NAT Gateway │────▶│   Internet   │────▶│   S3    │
│  ($0.045/GB)│     │   Gateway    │     │   SQS   │
└─────────────┘     └──────────────┘     └─────────┘

Cost: Data transfer via NAT Gateway + IGW
```

**With VPC Endpoints:**
```
┌─────────────┐
│   EC2/ECS   │
│  (Scanner)  │
└──────┬──────┘
       │
       │ Private connection
       ▼
┌─────────────┐
│     VPC     │
│  Endpoint   │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│     S3      │
│     SQS     │
└─────────────┘

Cost: FREE for Gateway endpoints, minimal for Interface endpoints
```

### Types of VPC Endpoints

**1. Gateway Endpoints (FREE)**
- Services: S3, DynamoDB
- No hourly charge
- No data processing charge
- Added to route table
- Recommended for high-volume traffic

**2. Interface Endpoints (Paid)**
- Services: SQS, CloudWatch, SNS, etc.
- $0.01/hour per endpoint (~$7.50/month)
- $0.01/GB data processed
- Uses ENI (Elastic Network Interface)
- Required for PrivateLink services

### Why VPC Endpoints for File Scanner?

**Data transfer costs without endpoints:**

**Scenario**: Scanner uploading 1TB/month to S3, publishing to SQS

| Service | Traffic | NAT Gateway Cost | Internet Gateway | Total |
|---------|---------|------------------|------------------|-------|
| S3 Uploads | 1TB | $45.00 | $0 (IN is free) | $45.00 |
| S3 Downloads | 100GB | $4.50 | $9.00 | $13.50 |
| SQS Messages | 5GB | $0.23 | $0 | $0.23 |
| CloudWatch Logs | 3GB | $0.14 | $0 | $0.14 |
| **Total** | | | | **$58.87/month** |

**With VPC Endpoints:**

| Service | Endpoint Type | Cost | Data Transfer | Total |
|---------|---------------|------|---------------|-------|
| S3 | Gateway | $0 | $0 | **$0** |
| SQS | Interface | $7.50/month | $0.05 | $7.55 |
| CloudWatch | Interface | $7.50/month | $0.03 | $7.53 |
| **Total** | | | | **$15.08/month** |

**Monthly Savings: $43.79 (74% reduction)**

For our 1TB/month workload, VPC Endpoints pay for themselves immediately.

---

## Gateway Endpoints

### S3 Gateway Endpoint

Gateway endpoints are **FREE** and should **always** be created for S3 traffic.

#### Prerequisites

```bash
# Get your VPC ID
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=tag:Name,Values=cis-filesearch-vpc" \
  --query 'Vpcs[0].VpcId' \
  --output text)

echo "VPC ID: $VPC_ID"

# Get your route table IDs
aws ec2 describe-route-tables \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'RouteTables[*].[RouteTableId,Tags[?Key==`Name`].Value|[0]]' \
  --output table

# Note the private subnet route tables
PRIVATE_ROUTE_TABLE_IDS=$(aws ec2 describe-route-tables \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=*private*" \
  --query 'RouteTables[*].RouteTableId' \
  --output text)

echo "Private Route Tables: $PRIVATE_ROUTE_TABLE_IDS"
```

#### Create S3 Gateway Endpoint (Console)

1. **Navigate to VPC Console**
   - AWS Console → VPC
   - Left menu → Endpoints

2. **Create Endpoint**
   - Click "Create endpoint"

3. **Configure Endpoint**
   - **Name**: `cis-filesearch-s3-endpoint`
   - **Service category**: AWS services
   - **Service name**:
     - Filter by "s3"
     - Select: `com.amazonaws.ap-northeast-1.s3` (Type: Gateway)

4. **VPC Selection**
   - **VPC**: Select your VPC (cis-filesearch-vpc)

5. **Route Tables**
   - Select all **private subnet** route tables
   - Do NOT select public subnet route tables (they use IGW)

6. **Policy**
   - Select: **Full access** (for simplicity)
   - Or use custom policy (see below)

7. **Tags**
   ```
   Project: CISFileSearch
   Environment: Production
   Purpose: S3Access
   ```

8. **Create endpoint**

#### Create S3 Gateway Endpoint (CLI)

```bash
# Create S3 gateway endpoint
S3_ENDPOINT_ID=$(aws ec2 create-vpc-endpoint \
  --vpc-id $VPC_ID \
  --service-name com.amazonaws.ap-northeast-1.s3 \
  --route-table-ids $PRIVATE_ROUTE_TABLE_IDS \
  --tag-specifications 'ResourceType=vpc-endpoint,Tags=[
    {Key=Name,Value=cis-filesearch-s3-endpoint},
    {Key=Project,Value=CISFileSearch},
    {Key=Environment,Value=Production}
  ]' \
  --query 'VpcEndpoint.VpcEndpointId' \
  --output text)

echo "S3 Endpoint created: $S3_ENDPOINT_ID"

# Verify creation
aws ec2 describe-vpc-endpoints \
  --vpc-endpoint-ids $S3_ENDPOINT_ID \
  --query 'VpcEndpoints[0].[VpcEndpointId,ServiceName,State]' \
  --output table
```

#### Custom S3 Endpoint Policy

**Why use a custom policy?**
- Restrict access to specific buckets
- Limit operations (read-only, write-only)
- Enforce encryption

**Policy: Allow access to CIS buckets only**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCISBucketsOnly",
      "Effect": "Allow",
      "Principal": "*",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": [
        "arn:aws:s3:::cis-filesearch-landing-dev",
        "arn:aws:s3:::cis-filesearch-landing-dev/*",
        "arn:aws:s3:::cis-filesearch-landing-prod",
        "arn:aws:s3:::cis-filesearch-landing-prod/*"
      ]
    },
    {
      "Sid": "DenyUnencryptedUploads",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::cis-filesearch-landing-*/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption": "AES256"
        }
      }
    }
  ]
}
```

**Apply custom policy:**

```bash
# Save policy to file
cat > s3-endpoint-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": "*",
    "Action": [
      "s3:GetObject",
      "s3:PutObject",
      "s3:ListBucket"
    ],
    "Resource": [
      "arn:aws:s3:::cis-filesearch-landing-*",
      "arn:aws:s3:::cis-filesearch-landing-*/*"
    ]
  }]
}
EOF

# Update endpoint policy
aws ec2 modify-vpc-endpoint \
  --vpc-endpoint-id $S3_ENDPOINT_ID \
  --policy-document file://s3-endpoint-policy.json
```

#### Verify S3 Endpoint Routing

```bash
# Check route table entries
aws ec2 describe-route-tables \
  --route-table-ids $PRIVATE_ROUTE_TABLE_IDS \
  --query 'RouteTables[*].Routes[?GatewayId!=`null`]' \
  --output table

# Should show route like:
# Destination: pl-xxxxx (S3 prefix list)
# Target: vpce-xxxxx (your endpoint)
```

**What happens:**
- When EC2 instance tries to reach S3
- Route table directs traffic to VPC endpoint
- Traffic stays within AWS network
- No NAT Gateway charges

---

## Interface Endpoints

### SQS Interface Endpoint

Interface endpoints use **Elastic Network Interfaces (ENIs)** in your subnets.

**Cost**: $0.01/hour = ~$7.50/month + $0.01/GB data processed

**Worth it?**
- For high-volume SQS traffic: YES
- For occasional SQS traffic: Consider keeping NAT Gateway

For our scanner (publishing 100K messages/month), SQS endpoint saves money.

#### Create SQS Interface Endpoint (Console)

1. **Navigate to VPC → Endpoints**

2. **Create Endpoint**
   - Name: `cis-filesearch-sqs-endpoint`
   - Service category: AWS services
   - Service name: `com.amazonaws.ap-northeast-1.sqs` (Type: Interface)

3. **VPC and Subnets**
   - VPC: Select your VPC
   - Subnets: Select **private subnets** (at least 2 for HA)
   - Availability Zones: Select 2+ for redundancy

4. **Security Groups**
   - Create new or select existing
   - Must allow HTTPS (port 443) from scanner instances

5. **Policy**
   - Full access (default)
   - Or custom policy (see below)

6. **Enable DNS name**
   - ✅ Enable DNS name (IMPORTANT)
   - Allows using standard SQS endpoint URL
   - Without this: Must use endpoint-specific DNS

7. **Tags**
   ```
   Name: cis-filesearch-sqs-endpoint
   Project: CISFileSearch
   Environment: Production
   ```

8. **Create endpoint**

#### Create SQS Interface Endpoint (CLI)

```bash
# Get private subnet IDs
PRIVATE_SUBNET_IDS=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=*private*" \
  --query 'Subnets[*].SubnetId' \
  --output text)

echo "Private Subnets: $PRIVATE_SUBNET_IDS"

# Create security group for endpoints
SG_ID=$(aws ec2 create-security-group \
  --group-name cis-filesearch-vpc-endpoints-sg \
  --description "Security group for VPC endpoints" \
  --vpc-id $VPC_ID \
  --query 'GroupId' \
  --output text)

# Allow HTTPS from VPC CIDR
VPC_CIDR=$(aws ec2 describe-vpcs \
  --vpc-ids $VPC_ID \
  --query 'Vpcs[0].CidrBlock' \
  --output text)

aws ec2 authorize-security-group-ingress \
  --group-id $SG_ID \
  --protocol tcp \
  --port 443 \
  --cidr $VPC_CIDR

# Create SQS interface endpoint
SQS_ENDPOINT_ID=$(aws ec2 create-vpc-endpoint \
  --vpc-id $VPC_ID \
  --vpc-endpoint-type Interface \
  --service-name com.amazonaws.ap-northeast-1.sqs \
  --subnet-ids $PRIVATE_SUBNET_IDS \
  --security-group-ids $SG_ID \
  --private-dns-enabled \
  --tag-specifications 'ResourceType=vpc-endpoint,Tags=[
    {Key=Name,Value=cis-filesearch-sqs-endpoint},
    {Key=Project,Value=CISFileSearch}
  ]' \
  --query 'VpcEndpoint.VpcEndpointId' \
  --output text)

echo "SQS Endpoint created: $SQS_ENDPOINT_ID"

# Verify creation
aws ec2 describe-vpc-endpoints \
  --vpc-endpoint-ids $SQS_ENDPOINT_ID
```

### CloudWatch Interface Endpoint

**Cost**: $0.01/hour = ~$7.50/month

**Worth it?**
- For high-volume logging: YES
- If logs are < 10GB/month: Consider NAT Gateway

For our scanner (3GB logs/month), CloudWatch endpoint is borderline. If you're already creating SQS endpoint, add CloudWatch too.

#### Create CloudWatch Logs Endpoint (CLI)

```bash
# CloudWatch Logs endpoint
LOGS_ENDPOINT_ID=$(aws ec2 create-vpc-endpoint \
  --vpc-id $VPC_ID \
  --vpc-endpoint-type Interface \
  --service-name com.amazonaws.ap-northeast-1.logs \
  --subnet-ids $PRIVATE_SUBNET_IDS \
  --security-group-ids $SG_ID \
  --private-dns-enabled \
  --tag-specifications 'ResourceType=vpc-endpoint,Tags=[
    {Key=Name,Value=cis-filesearch-logs-endpoint}
  ]' \
  --query 'VpcEndpoint.VpcEndpointId' \
  --output text)

echo "CloudWatch Logs Endpoint: $LOGS_ENDPOINT_ID"
```

#### Create CloudWatch Metrics Endpoint (CLI)

```bash
# CloudWatch Metrics endpoint (for custom metrics)
METRICS_ENDPOINT_ID=$(aws ec2 create-vpc-endpoint \
  --vpc-id $VPC_ID \
  --vpc-endpoint-type Interface \
  --service-name com.amazonaws.ap-northeast-1.monitoring \
  --subnet-ids $PRIVATE_SUBNET_IDS \
  --security-group-ids $SG_ID \
  --private-dns-enabled \
  --tag-specifications 'ResourceType=vpc-endpoint,Tags=[
    {Key=Name,Value=cis-filesearch-monitoring-endpoint}
  ]' \
  --query 'VpcEndpoint.VpcEndpointId' \
  --output text)

echo "CloudWatch Metrics Endpoint: $METRICS_ENDPOINT_ID"
```

### Custom Interface Endpoint Policy

**Example: Restrict SQS to specific queues**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": [
        "sqs:SendMessage",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueUrl"
      ],
      "Resource": [
        "arn:aws:sqs:ap-northeast-1:ACCOUNT_ID:cis-filesearch-queue-*",
        "arn:aws:sqs:ap-northeast-1:ACCOUNT_ID:cis-filesearch-dlq-*"
      ]
    }
  ]
}
```

**Apply policy:**

```bash
cat > sqs-endpoint-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": "*",
    "Action": "sqs:*",
    "Resource": "arn:aws:sqs:ap-northeast-1:ACCOUNT_ID:cis-filesearch-*"
  }]
}
EOF

aws ec2 modify-vpc-endpoint \
  --vpc-endpoint-id $SQS_ENDPOINT_ID \
  --policy-document file://sqs-endpoint-policy.json
```

---

## Security Group Configuration

### Why Security Groups Matter for Interface Endpoints

**Interface endpoints use ENIs** which require security group rules.

**Required rule:**
- **Inbound**: HTTPS (port 443) from your EC2/ECS instances

### Security Group for VPC Endpoints

#### Create Security Group (CLI)

```bash
# Create security group
ENDPOINT_SG_ID=$(aws ec2 create-security-group \
  --group-name cis-vpc-endpoints-sg \
  --description "Security group for VPC interface endpoints" \
  --vpc-id $VPC_ID \
  --tag-specifications 'ResourceType=security-group,Tags=[
    {Key=Name,Value=cis-vpc-endpoints-sg}
  ]' \
  --query 'GroupId' \
  --output text)

echo "Endpoint Security Group: $ENDPOINT_SG_ID"

# Get VPC CIDR
VPC_CIDR=$(aws ec2 describe-vpcs \
  --vpc-ids $VPC_ID \
  --query 'Vpcs[0].CidrBlock' \
  --output text)

# Allow HTTPS from VPC
aws ec2 authorize-security-group-ingress \
  --group-id $ENDPOINT_SG_ID \
  --protocol tcp \
  --port 443 \
  --cidr $VPC_CIDR \
  --group-rule-description "Allow HTTPS from VPC for interface endpoints"

# Verify rules
aws ec2 describe-security-groups \
  --group-ids $ENDPOINT_SG_ID \
  --query 'SecurityGroups[0].IpPermissions'
```

#### More Restrictive Rule (Optional)

Allow HTTPS only from specific security groups (scanner instances):

```bash
# Get scanner security group ID
SCANNER_SG_ID=$(aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=cis-file-scanner-sg" \
  --query 'SecurityGroups[0].GroupId' \
  --output text)

# Allow HTTPS only from scanner security group
aws ec2 authorize-security-group-ingress \
  --group-id $ENDPOINT_SG_ID \
  --protocol tcp \
  --port 443 \
  --source-group $SCANNER_SG_ID \
  --group-rule-description "Allow HTTPS from scanner instances"
```

**Benefits:**
- Tighter security
- Only scanner instances can use endpoints
- Prevents unauthorized usage

### Update Existing Endpoints with Security Group

```bash
# Update SQS endpoint security groups
aws ec2 modify-vpc-endpoint \
  --vpc-endpoint-id $SQS_ENDPOINT_ID \
  --add-security-group-ids $ENDPOINT_SG_ID

# Update CloudWatch Logs endpoint
aws ec2 modify-vpc-endpoint \
  --vpc-endpoint-id $LOGS_ENDPOINT_ID \
  --add-security-group-ids $ENDPOINT_SG_ID
```

---

## DNS and Routing

### How Private DNS Works

**With Private DNS enabled:**
```
Scanner code: https://sqs.ap-northeast-1.amazonaws.com
              ↓
VPC DNS:      Resolves to VPC endpoint private IP (e.g., 10.0.1.100)
              ↓
Traffic:      Stays within VPC, uses interface endpoint
```

**Without Private DNS:**
```
Scanner code: https://vpce-xxxxx-yyyyy.sqs.ap-northeast-1.vpce.amazonaws.com
              ↓
              Must use endpoint-specific URL (cumbersome)
```

### Enable Private DNS (Required for Seamless Integration)

**When creating endpoint:**
- CLI: `--private-dns-enabled`
- Console: Check "Enable DNS name"

**If already created:**

```bash
# Enable private DNS
aws ec2 modify-vpc-endpoint \
  --vpc-endpoint-id $SQS_ENDPOINT_ID \
  --private-dns-enabled

# Verify
aws ec2 describe-vpc-endpoints \
  --vpc-endpoint-ids $SQS_ENDPOINT_ID \
  --query 'VpcEndpoints[0].PrivateDnsEnabled'
```

### VPC DNS Settings (Must Be Enabled)

**Requirements:**
- `enableDnsHostnames`: true
- `enableDnsSupport`: true

**Check DNS settings:**

```bash
aws ec2 describe-vpc-attribute \
  --vpc-id $VPC_ID \
  --attribute enableDnsSupport

aws ec2 describe-vpc-attribute \
  --vpc-id $VPC_ID \
  --attribute enableDnsHostnames
```

**Enable if needed:**

```bash
aws ec2 modify-vpc-attribute \
  --vpc-id $VPC_ID \
  --enable-dns-support

aws ec2 modify-vpc-attribute \
  --vpc-id $VPC_ID \
  --enable-dns-hostnames
```

### DNS Resolution Testing

**From EC2 instance in VPC:**

```bash
# Test S3 endpoint DNS
dig s3.ap-northeast-1.amazonaws.com

# Should return private IPs (10.x.x.x) if endpoint configured correctly

# Test SQS endpoint DNS
dig sqs.ap-northeast-1.amazonaws.com

# Should return private IPs from your VPC subnets

# Test connectivity
curl -I https://sqs.ap-northeast-1.amazonaws.com
# Should connect via VPC endpoint (check access logs)
```

### Route53 Private Hosted Zone (Interface Endpoints)

Interface endpoints automatically create Route53 private hosted zones.

**View private hosted zones:**

```bash
aws route53 list-hosted-zones \
  --query 'HostedZones[?Config.PrivateZone==`true`]'

# Should show zones like:
# - sqs.ap-northeast-1.amazonaws.com
# - logs.ap-northeast-1.amazonaws.com
```

**View DNS records:**

```bash
# Get hosted zone ID for SQS
HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name \
  --dns-name sqs.ap-northeast-1.amazonaws.com \
  --query 'HostedZones[0].Id' \
  --output text)

# List records
aws route53 list-resource-record-sets \
  --hosted-zone-id $HOSTED_ZONE_ID
```

---

## Cost Optimization Analysis

### Cost Comparison Matrix

**Scenario: CIS File Scanner**
- Data transfer: 1TB S3 uploads/month
- SQS messages: 5GB metadata/month
- CloudWatch logs: 3GB/month

| Configuration | Monthly Cost | Breakdown |
|---------------|--------------|-----------|
| **No VPC Endpoints** | $58.87 | NAT: $45, IGW: $13.50, Other: $0.37 |
| **S3 Gateway Only** | $13.87 | NAT: $4.50, IGW: $9, Other: $0.37 |
| **S3 + SQS Endpoints** | $13.92 | SQS endpoint: $7.55, NAT: $4.50, Other: $1.87 |
| **All Endpoints** | $21.16 | S3 free, SQS: $7.55, Logs: $7.53, Metrics: $7.50 |

**Recommendation**: S3 Gateway + SQS Interface

**Rationale:**
- S3 Gateway: FREE, saves $45/month ✅
- SQS Interface: $7.55, saves $0.23 NAT cost (marginal, but useful for isolation) ✅
- CloudWatch: $15, saves $0.17 NAT cost (not worth it) ❌

**Net savings: $37.55/month** vs no endpoints

### When to Skip Interface Endpoints

**Skip if:**
- Low traffic volume (< 100GB/month)
- Cost-sensitive development environment
- Temporary workload

**Use NAT Gateway instead:**
- One NAT Gateway: $32.85/month (fixed) + $0.045/GB
- Break-even at ~165GB data transfer

**For dev environment:**
```bash
# Use S3 Gateway endpoint (free)
# Skip SQS/CloudWatch endpoints
# Use NAT Gateway for occasional traffic
```

### Cost Monitoring

**Set up billing alert:**

```bash
# Create budget for VPC endpoints
aws budgets create-budget \
  --account-id $(aws sts get-caller-identity --query Account --output text) \
  --budget '{
    "BudgetName": "VPC-Endpoints-Monthly",
    "BudgetLimit": {"Amount": "25", "Unit": "USD"},
    "TimeUnit": "MONTHLY",
    "BudgetType": "COST",
    "CostFilters": {
      "Service": ["Amazon EC2"]
    }
  }'
```

**View endpoint costs in Cost Explorer:**

```bash
aws ce get-cost-and-usage \
  --time-period Start=$(date -u -d '1 month ago' +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=DIMENSION,Key=USAGE_TYPE \
  --filter '{"Dimensions": {"Key": "SERVICE", "Values": ["Amazon EC2"]}}'
```

**Look for usage types:**
- `VpcEndpoint-Hours`: Interface endpoint hours
- `VpcEndpoint-Bytes`: Data processed through interface endpoints

---

## Verification and Testing

### 1. Verify Endpoint Creation

```bash
# List all VPC endpoints
aws ec2 describe-vpc-endpoints \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'VpcEndpoints[*].[VpcEndpointId,ServiceName,State,VpcEndpointType]' \
  --output table
```

**Expected output:**
```
--------------------------------------------------------------------
|                      DescribeVpcEndpoints                        |
+-----------------------+----------------------+------------+-------+
|  vpce-xxxxx          |  s3                  | available  | Gateway|
|  vpce-yyyyy          |  sqs                 | available  | Interface|
|  vpce-zzzzz          |  logs                | available  | Interface|
+-----------------------+----------------------+------------+-------+
```

### 2. Verify Route Table Configuration (Gateway Endpoints)

```bash
# Check S3 routes
aws ec2 describe-route-tables \
  --route-table-ids $PRIVATE_ROUTE_TABLE_IDS \
  --query 'RouteTables[*].Routes[?GatewayId!=`null`].[DestinationCidrBlock,GatewayId]' \
  --output table

# Should show S3 prefix list routed to vpce-xxxxx
```

### 3. Test S3 Access via Endpoint

**From EC2 instance:**

```bash
# Test S3 upload
aws s3 cp test.txt s3://cis-filesearch-landing-dev/test/

# Check VPC Flow Logs to confirm traffic goes via endpoint
# srcaddr and dstaddr should be private IPs
```

**Check VPC Flow Logs:**

```bash
# Create VPC Flow Log (if not exists)
aws ec2 create-flow-logs \
  --resource-type VPC \
  --resource-ids $VPC_ID \
  --traffic-type ALL \
  --log-destination-type cloud-watch-logs \
  --log-group-name /aws/vpc/flowlogs \
  --deliver-logs-permission-arn arn:aws:iam::ACCOUNT_ID:role/flowlogsRole

# Query logs for S3 traffic
aws logs filter-log-events \
  --log-group-name /aws/vpc/flowlogs \
  --filter-pattern "[version, account, eni, source, destination, srcport, destport=\"443\"]" \
  --start-time $(date -u -d '10 minutes ago' +%s)000 \
  --limit 10
```

### 4. Test SQS Access via Endpoint

```bash
# From EC2 instance in VPC
aws sqs send-message \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/ACCOUNT_ID/cis-filesearch-queue-dev \
  --message-body "VPC endpoint test"

# Verify message sent
aws sqs receive-message \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/ACCOUNT_ID/cis-filesearch-queue-dev

# Check DNS resolution
nslookup sqs.ap-northeast-1.amazonaws.com
# Should return private IPs (10.x.x.x)
```

### 5. Test CloudWatch Logs via Endpoint

```bash
# From EC2 instance
aws logs put-log-events \
  --log-group-name /aws/cis-file-scanner/dev/application \
  --log-stream-name test-stream \
  --log-events timestamp=$(date +%s)000,message="VPC endpoint test"

# Verify logs
aws logs filter-log-events \
  --log-group-name /aws/cis-file-scanner/dev/application \
  --filter-pattern "VPC endpoint test"
```

### 6. Network Path Verification

**Use VPC Reachability Analyzer:**

```bash
# Create network path analysis
aws ec2 create-network-insights-path \
  --source $INSTANCE_ID \
  --destination $SQS_ENDPOINT_ID \
  --destination-port 443 \
  --protocol tcp \
  --query 'NetworkInsightsPath.NetworkInsightsPathId' \
  --output text

# Start analysis
ANALYSIS_ID=$(aws ec2 start-network-insights-analysis \
  --network-insights-path-id $PATH_ID \
  --query 'NetworkInsightsAnalysis.NetworkInsightsAnalysisId' \
  --output text)

# Wait for completion
aws ec2 describe-network-insights-analyses \
  --network-insights-analysis-ids $ANALYSIS_ID \
  --query 'NetworkInsightsAnalyses[0].Status'

# View results
aws ec2 describe-network-insights-analyses \
  --network-insights-analysis-ids $ANALYSIS_ID
```

### 7. Endpoint Health Check Script

```bash
#!/bin/bash
# endpoint-health-check.sh

ENDPOINTS=$(aws ec2 describe-vpc-endpoints \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'VpcEndpoints[*].[VpcEndpointId,ServiceName,State]' \
  --output text)

echo "VPC Endpoint Health Check"
echo "========================="

while IFS=$'\t' read -r ENDPOINT_ID SERVICE STATE; do
  echo "Endpoint: $ENDPOINT_ID"
  echo "Service: $SERVICE"
  echo "State: $STATE"

  if [ "$STATE" != "available" ]; then
    echo "⚠️  WARNING: Endpoint not available!"
  else
    echo "✓ OK"
  fi

  echo "---"
done <<< "$ENDPOINTS"
```

---

## Troubleshooting

### Issue 1: S3 Access Still Using NAT Gateway

**Symptoms:**
- High NAT Gateway charges despite S3 endpoint
- VPC Flow Logs show traffic to internet IPs

**Diagnosis:**

```bash
# Check if endpoint is in correct route tables
aws ec2 describe-route-tables \
  --route-table-ids $PRIVATE_ROUTE_TABLE_IDS \
  --query 'RouteTables[*].Routes[?GatewayId!=`null`]'

# Should show S3 prefix list route
```

**Solutions:**

1. **Check route table association:**
```bash
# Verify private subnets use correct route table
aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'Subnets[*].[SubnetId,Tags[?Key==`Name`].Value|[0],Associations[0].RouteTableId]' \
  --output table
```

2. **Add endpoint to route table:**
```bash
aws ec2 modify-vpc-endpoint \
  --vpc-endpoint-id $S3_ENDPOINT_ID \
  --add-route-table-ids $MISSING_ROUTE_TABLE_ID
```

3. **Check endpoint policy:**
```bash
aws ec2 describe-vpc-endpoints \
  --vpc-endpoint-ids $S3_ENDPOINT_ID \
  --query 'VpcEndpoints[0].PolicyDocument'

# Should not deny access to your buckets
```

### Issue 2: SQS Endpoint Not Resolving

**Symptoms:**
```
Could not connect to endpoint URL: https://sqs.ap-northeast-1.amazonaws.com
```

**Diagnosis:**

```bash
# Check private DNS enabled
aws ec2 describe-vpc-endpoints \
  --vpc-endpoint-ids $SQS_ENDPOINT_ID \
  --query 'VpcEndpoints[0].PrivateDnsEnabled'

# Should return: true

# Check VPC DNS settings
aws ec2 describe-vpc-attribute --vpc-id $VPC_ID --attribute enableDnsSupport
aws ec2 describe-vpc-attribute --vpc-id $VPC_ID --attribute enableDnsHostnames

# Both should be true
```

**Solutions:**

1. **Enable private DNS:**
```bash
aws ec2 modify-vpc-endpoint \
  --vpc-endpoint-id $SQS_ENDPOINT_ID \
  --private-dns-enabled
```

2. **Enable VPC DNS:**
```bash
aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-support
aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-hostnames
```

3. **Check security groups:**
```bash
# Verify SG allows 443 from instance
aws ec2 describe-security-groups \
  --group-ids $ENDPOINT_SG_ID \
  --query 'SecurityGroups[0].IpPermissions[?ToPort==`443`]'
```

### Issue 3: Connection Timeout to Interface Endpoint

**Symptoms:**
- Timeout when accessing SQS/CloudWatch via endpoint
- Works via NAT Gateway

**Diagnosis:**

```bash
# Check endpoint network interfaces
aws ec2 describe-network-interfaces \
  --filters "Name=vpc-endpoint-id,Values=$SQS_ENDPOINT_ID" \
  --query 'NetworkInterfaces[*].[NetworkInterfaceId,Status,PrivateIpAddress,SubnetId]' \
  --output table

# All should be "in-use" and have private IPs
```

**Solutions:**

1. **Check security group rules:**
```bash
# Get endpoint security groups
SG_IDS=$(aws ec2 describe-vpc-endpoints \
  --vpc-endpoint-ids $SQS_ENDPOINT_ID \
  --query 'VpcEndpoints[0].Groups[*].GroupId' \
  --output text)

# Check inbound rules
for SG in $SG_IDS; do
  aws ec2 describe-security-groups \
    --group-ids $SG \
    --query 'SecurityGroups[0].IpPermissions'
done

# Should allow 443 from VPC CIDR or instance SG
```

2. **Add missing security group rule:**
```bash
aws ec2 authorize-security-group-ingress \
  --group-id $ENDPOINT_SG_ID \
  --protocol tcp \
  --port 443 \
  --cidr $VPC_CIDR
```

3. **Check subnet routing:**
```bash
# Verify subnets have local route
aws ec2 describe-route-tables \
  --filters "Name=association.subnet-id,Values=$SUBNET_ID" \
  --query 'RouteTables[0].Routes[?GatewayId==`local`]'
```

### Issue 4: Endpoint Shows "Failed" State

**Diagnosis:**

```bash
aws ec2 describe-vpc-endpoints \
  --vpc-endpoint-ids $ENDPOINT_ID \
  --query 'VpcEndpoints[0].[State,StateReason]'
```

**Common reasons:**
- Service unavailable in region
- Subnet has no available IPs
- Security group rules conflict

**Solutions:**

1. **Delete and recreate:**
```bash
aws ec2 delete-vpc-endpoints --vpc-endpoint-ids $ENDPOINT_ID

# Wait 2 minutes

# Recreate with corrected configuration
```

2. **Check subnet capacity:**
```bash
aws ec2 describe-subnets \
  --subnet-ids $SUBNET_ID \
  --query 'Subnets[0].AvailableIpAddressCount'

# Should be > 0
```

### Issue 5: High Endpoint Costs

**Diagnosis:**

```bash
# Check endpoint usage
aws ec2 describe-vpc-endpoints \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query 'length(VpcEndpoints[?VpcEndpointType==`Interface`])'

# Count interface endpoints (each costs $7.50/month)
```

**Solutions:**

1. **Remove unused endpoints:**
```bash
# List endpoints not used in 30 days (check CloudWatch metrics)
aws cloudwatch get-metric-statistics \
  --namespace AWS/PrivateLink \
  --metric-name PacketsPerSecond \
  --dimensions Name=VpcEndpointId,Value=$ENDPOINT_ID \
  --start-time $(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 86400 \
  --statistics Sum

# If consistently zero, consider deleting
aws ec2 delete-vpc-endpoints --vpc-endpoint-ids $ENDPOINT_ID
```

2. **Consolidate environments:**
```bash
# Use one set of endpoints for dev/staging/prod
# Route via different VPCs if needed
```

---

## Summary Checklist

- [ ] VPC ID and route table IDs identified
- [ ] S3 Gateway endpoint created (FREE)
- [ ] S3 endpoint added to private route tables
- [ ] SQS Interface endpoint created (if high volume)
- [ ] CloudWatch Logs endpoint created (optional)
- [ ] CloudWatch Metrics endpoint created (optional)
- [ ] Security group created for interface endpoints
- [ ] Security group allows HTTPS (443) from VPC
- [ ] Private DNS enabled for interface endpoints
- [ ] VPC DNS support enabled
- [ ] VPC DNS hostnames enabled
- [ ] S3 access tested from EC2
- [ ] SQS access tested from EC2
- [ ] DNS resolution verified (private IPs)
- [ ] VPC Flow Logs configured
- [ ] Cost monitoring alerts set up
- [ ] Endpoint health check script deployed

---

## Cost Summary

**Recommended Configuration:**

| Endpoint | Type | Monthly Cost | Annual Cost | Savings |
|----------|------|--------------|-------------|---------|
| S3 | Gateway | $0 | $0 | $540 |
| SQS | Interface | $7.55 | $90.60 | $2.76 |
| **Total** | | **$7.55** | **$90.60** | **$542.76/year** |

**vs No Endpoints: $58.87/month = $706.44/year**

**Net Annual Savings: $615.84 (87% reduction)**

---

## Next Steps

1. **Update Scanner Configuration**: No code changes needed (uses standard AWS endpoints)
2. **Monitor Traffic**: Check VPC Flow Logs for endpoint usage
3. **Verify Cost Savings**: Compare NAT Gateway bills before/after
4. **Test Failover**: Verify endpoint redundancy across AZs
5. **Document for Team**: Share this guide with operations team

---

## Additional Resources

- [VPC Endpoints Documentation](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints.html)
- [Gateway vs Interface Endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/vpce-gateway.html)
- [VPC Endpoint Pricing](https://aws.amazon.com/privatelink/pricing/)
- [VPC Endpoint Security](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-access.html)
- [Reachability Analyzer](https://docs.aws.amazon.com/vpc/latest/reachability/)

---

**Document Version**: 1.0
**Last Updated**: 2025-01-12
**Author**: CIS Development Team
