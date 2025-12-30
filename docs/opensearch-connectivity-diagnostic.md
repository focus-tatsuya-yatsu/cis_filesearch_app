# OpenSearch VPC Connectivity Diagnostic Guide

## Problem Overview

EC2 Instance: `ip-10-0-3-24` (10.0.3.24)
OpenSearch Endpoint: `vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com`
Error: Connection timeout/refused

## Common Causes for EC2 → OpenSearch VPC Connection Failures

### 1. Security Group Misconfiguration
- OpenSearch security group not allowing inbound traffic from EC2
- EC2 security group not allowing outbound HTTPS (443) traffic

### 2. VPC/Subnet Mismatch
- EC2 and OpenSearch in different VPCs without peering
- OpenSearch in private subnet without route to EC2 subnet
- EC2 in public subnet, OpenSearch in private subnet without NAT

### 3. Network ACLs
- Network ACL rules blocking traffic on port 443
- Stateless rules not allowing return traffic

### 4. IAM Permissions
- EC2 instance role lacking OpenSearch access permissions
- OpenSearch access policy not including EC2 instance role

### 5. DNS Resolution
- VPC DNS resolution disabled
- Private DNS not resolving OpenSearch endpoint

## Diagnostic Steps

### Step 1: Verify EC2 Instance Details
```bash
#!/bin/bash
# Run these commands on the EC2 instance

echo "=== EC2 Instance Information ==="
# Get instance ID
INSTANCE_ID=$(ec2-metadata --instance-id | cut -d ' ' -f 2)
echo "Instance ID: $INSTANCE_ID"

# Get VPC ID
VPC_ID=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].VpcId' --output text)
echo "VPC ID: $VPC_ID"

# Get Subnet ID
SUBNET_ID=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].SubnetId' --output text)
echo "Subnet ID: $SUBNET_ID"

# Get Security Groups
SG_IDS=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].SecurityGroups[*].GroupId' --output text)
echo "Security Groups: $SG_IDS"

# Get IAM Role
IAM_ROLE=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].IamInstanceProfile.Arn' --output text)
echo "IAM Role: $IAM_ROLE"
```

### Step 2: Verify OpenSearch Domain Configuration
```bash
#!/bin/bash
# Get OpenSearch domain details

DOMAIN_NAME="cis-filesearch-opensearch"

echo "=== OpenSearch Domain Information ==="
aws opensearch describe-domain --domain-name $DOMAIN_NAME \
  --query 'DomainStatus.{
    Endpoint: Endpoint,
    VPCOptions: VPCOptions,
    AccessPolicies: AccessPolicies
  }' --output json
```

### Step 3: Test Network Connectivity
```bash
#!/bin/bash
# Network connectivity tests

OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
OPENSEARCH_HOST="vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"

echo "=== DNS Resolution Test ==="
nslookup $OPENSEARCH_HOST
dig $OPENSEARCH_HOST

echo -e "\n=== Ping Test (will likely fail for AWS services) ==="
ping -c 3 $OPENSEARCH_HOST

echo -e "\n=== Port 443 Connectivity Test ==="
timeout 5 bash -c "cat < /dev/null > /dev/tcp/$OPENSEARCH_HOST/443" && echo "Port 443 is open" || echo "Port 443 is closed/filtered"

echo -e "\n=== Telnet Test ==="
timeout 5 telnet $OPENSEARCH_HOST 443

echo -e "\n=== Curl Test (Verbose) ==="
curl -v -m 10 $OPENSEARCH_ENDPOINT/_cluster/health 2>&1

echo -e "\n=== Traceroute ==="
traceroute -m 15 $OPENSEARCH_HOST
```

### Step 4: Check Security Group Rules
```bash
#!/bin/bash
# Check security group configurations

# EC2 Security Groups
echo "=== EC2 Instance Security Groups ==="
for sg in $SG_IDS; do
  echo "Security Group: $sg"
  echo "Outbound Rules:"
  aws ec2 describe-security-groups --group-ids $sg \
    --query 'SecurityGroups[0].IpPermissionsEgress' --output table
done

# OpenSearch Security Group
echo -e "\n=== OpenSearch Security Group ==="
OPENSEARCH_SG=$(aws opensearch describe-domain --domain-name $DOMAIN_NAME \
  --query 'DomainStatus.VPCOptions.SecurityGroupIds[0]' --output text)

echo "OpenSearch Security Group: $OPENSEARCH_SG"
echo "Inbound Rules:"
aws ec2 describe-security-groups --group-ids $OPENSEARCH_SG \
  --query 'SecurityGroups[0].IpPermissions' --output table
```

### Step 5: Verify Route Tables
```bash
#!/bin/bash
# Check routing configuration

echo "=== EC2 Subnet Route Table ==="
ROUTE_TABLE_ID=$(aws ec2 describe-route-tables \
  --filters "Name=association.subnet-id,Values=$SUBNET_ID" \
  --query 'RouteTables[0].RouteTableId' --output text)

aws ec2 describe-route-tables --route-table-ids $ROUTE_TABLE_ID \
  --query 'RouteTables[0].Routes' --output table

# Check OpenSearch subnet routes
echo -e "\n=== OpenSearch Subnet Route Table ==="
OPENSEARCH_SUBNET=$(aws opensearch describe-domain --domain-name $DOMAIN_NAME \
  --query 'DomainStatus.VPCOptions.SubnetIds[0]' --output text)

OPENSEARCH_RT=$(aws ec2 describe-route-tables \
  --filters "Name=association.subnet-id,Values=$OPENSEARCH_SUBNET" \
  --query 'RouteTables[0].RouteTableId' --output text)

aws ec2 describe-route-tables --route-table-ids $OPENSEARCH_RT \
  --query 'RouteTables[0].Routes' --output table
```

## Required Configurations

### 1. Security Group Configuration

#### EC2 Security Group (Outbound)
```json
{
  "IpProtocol": "tcp",
  "FromPort": 443,
  "ToPort": 443,
  "IpRanges": [{"CidrIp": "0.0.0.0/0"}]
}
```

#### OpenSearch Security Group (Inbound)
**Option A: Allow from EC2 Security Group**
```json
{
  "IpProtocol": "tcp",
  "FromPort": 443,
  "ToPort": 443,
  "UserIdGroupPairs": [{
    "GroupId": "sg-xxxxx",  // EC2 instance security group
    "Description": "Allow from EC2 worker instances"
  }]
}
```

**Option B: Allow from EC2 Private IP Range**
```json
{
  "IpProtocol": "tcp",
  "FromPort": 443,
  "ToPort": 443,
  "IpRanges": [{
    "CidrIp": "10.0.0.0/16",  // Your VPC CIDR
    "Description": "Allow from VPC"
  }]
}
```

### 2. VPC Requirements

- **Same VPC**: EC2 and OpenSearch must be in the same VPC, OR
- **VPC Peering**: If in different VPCs, set up VPC peering with proper routes
- **DNS Resolution**: Enable DNS resolution and DNS hostnames in VPC
  ```bash
  aws ec2 modify-vpc-attribute --vpc-id vpc-xxxxx --enable-dns-support
  aws ec2 modify-vpc-attribute --vpc-id vpc-xxxxx --enable-dns-hostnames
  ```

### 3. IAM Permissions

#### EC2 Instance Role Policy
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "es:ESHttpGet",
        "es:ESHttpPut",
        "es:ESHttpPost",
        "es:ESHttpHead",
        "es:ESHttpDelete",
        "es:DescribeElasticsearchDomain"
      ],
      "Resource": "arn:aws:es:ap-northeast-1:*:domain/cis-filesearch-opensearch/*"
    }
  ]
}
```

#### OpenSearch Access Policy
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::ACCOUNT_ID:role/EC2WorkerRole"
      },
      "Action": "es:*",
      "Resource": "arn:aws:es:ap-northeast-1:ACCOUNT_ID:domain/cis-filesearch-opensearch/*"
    },
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "*"
      },
      "Action": "es:*",
      "Resource": "arn:aws:es:ap-northeast-1:ACCOUNT_ID:domain/cis-filesearch-opensearch/*",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": ["10.0.0.0/16"]
        }
      }
    }
  ]
}
```

## Fix Commands

### Fix 1: Add Security Group Rules
```bash
#!/bin/bash
# Add inbound rule to OpenSearch security group

OPENSEARCH_SG="sg-xxxxx"  # Replace with actual OpenSearch SG ID
EC2_SG="sg-yyyyy"         # Replace with actual EC2 SG ID

# Allow EC2 security group to access OpenSearch
aws ec2 authorize-security-group-ingress \
  --group-id $OPENSEARCH_SG \
  --protocol tcp \
  --port 443 \
  --source-group $EC2_SG \
  --region ap-northeast-1

echo "Security group rule added successfully"
```

### Fix 2: Update OpenSearch Access Policy
```bash
#!/bin/bash
# Update OpenSearch domain access policy

DOMAIN_NAME="cis-filesearch-opensearch"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
EC2_ROLE_NAME="your-ec2-role-name"  # Replace with actual role name

# Create access policy
cat > /tmp/opensearch-access-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::${ACCOUNT_ID}:role/${EC2_ROLE_NAME}"
      },
      "Action": "es:*",
      "Resource": "arn:aws:es:ap-northeast-1:${ACCOUNT_ID}:domain/${DOMAIN_NAME}/*"
    }
  ]
}
EOF

# Update domain access policy
aws opensearch update-domain-config \
  --domain-name $DOMAIN_NAME \
  --access-policies file:///tmp/opensearch-access-policy.json \
  --region ap-northeast-1

echo "Access policy updated. Wait 5-10 minutes for changes to take effect."
```

### Fix 3: Attach IAM Policy to EC2 Role
```bash
#!/bin/bash
# Attach OpenSearch access policy to EC2 instance role

EC2_ROLE_NAME="your-ec2-role-name"  # Replace with actual role name
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Create IAM policy
cat > /tmp/opensearch-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "es:ESHttpGet",
        "es:ESHttpPut",
        "es:ESHttpPost",
        "es:ESHttpHead",
        "es:ESHttpDelete",
        "es:DescribeElasticsearchDomain",
        "es:DescribeDomain"
      ],
      "Resource": "arn:aws:es:ap-northeast-1:${ACCOUNT_ID}:domain/cis-filesearch-opensearch/*"
    }
  ]
}
EOF

# Create policy
POLICY_ARN=$(aws iam create-policy \
  --policy-name OpenSearchAccessPolicy \
  --policy-document file:///tmp/opensearch-policy.json \
  --query 'Policy.Arn' --output text)

# Attach to role
aws iam attach-role-policy \
  --role-name $EC2_ROLE_NAME \
  --policy-arn $POLICY_ARN

echo "IAM policy attached successfully"
```

## Alternative Connection Methods

### Method 1: AWS Signature Version 4 (Recommended for VPC)
```python
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth
import boto3

# Get credentials
credentials = boto3.Session().get_credentials()
awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    'ap-northeast-1',
    'es',
    session_token=credentials.token
)

# Connect to OpenSearch
client = OpenSearch(
    hosts=[{'host': 'vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com', 'port': 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection
)

# Test connection
info = client.info()
print(f"Connected to OpenSearch: {info['version']['number']}")
```

### Method 2: VPC Endpoint (If Available)
```bash
# Check if VPC endpoint exists
aws ec2 describe-vpc-endpoints \
  --filters "Name=service-name,Values=com.amazonaws.ap-northeast-1.es" \
  --query 'VpcEndpoints[*].{ID:VpcEndpointId,State:State}' \
  --output table
```

### Method 3: SSH Tunnel (For Testing)
```bash
# From local machine, create SSH tunnel through bastion
ssh -N -L 9200:vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com:443 \
  ec2-user@bastion-host

# Then access via localhost:9200
curl https://localhost:9200/_cluster/health
```

## Complete Diagnostic Script

Run this comprehensive script to diagnose all issues:

```bash
#!/bin/bash
# save as: diagnose-opensearch-connectivity.sh

set -e

echo "=========================================="
echo "OpenSearch Connectivity Diagnostic Tool"
echo "=========================================="

# Configuration
DOMAIN_NAME="cis-filesearch-opensearch"
OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
OPENSEARCH_HOST="vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"

# Get instance metadata
echo -e "\n[1/8] Gathering EC2 Instance Information..."
INSTANCE_ID=$(ec2-metadata --instance-id | cut -d ' ' -f 2)
REGION=$(ec2-metadata --availability-zone | cut -d ' ' -f 2 | sed 's/[a-z]$//')

echo "Instance ID: $INSTANCE_ID"
echo "Region: $REGION"

# Get VPC details
echo -e "\n[2/8] Checking VPC Configuration..."
VPC_INFO=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID --region $REGION)
VPC_ID=$(echo $VPC_INFO | jq -r '.Reservations[0].Instances[0].VpcId')
SUBNET_ID=$(echo $VPC_INFO | jq -r '.Reservations[0].Instances[0].SubnetId')
PRIVATE_IP=$(echo $VPC_INFO | jq -r '.Reservations[0].Instances[0].PrivateIpAddress')
SG_IDS=$(echo $VPC_INFO | jq -r '.Reservations[0].Instances[0].SecurityGroups[].GroupId' | tr '\n' ' ')

echo "VPC ID: $VPC_ID"
echo "Subnet ID: $SUBNET_ID"
echo "Private IP: $PRIVATE_IP"
echo "Security Groups: $SG_IDS"

# Check OpenSearch domain
echo -e "\n[3/8] Checking OpenSearch Domain Configuration..."
OPENSEARCH_INFO=$(aws opensearch describe-domain --domain-name $DOMAIN_NAME --region $REGION)
OPENSEARCH_VPC=$(echo $OPENSEARCH_INFO | jq -r '.DomainStatus.VPCOptions.VPCId')
OPENSEARCH_SUBNETS=$(echo $OPENSEARCH_INFO | jq -r '.DomainStatus.VPCOptions.SubnetIds[]' | tr '\n' ' ')
OPENSEARCH_SG=$(echo $OPENSEARCH_INFO | jq -r '.DomainStatus.VPCOptions.SecurityGroupIds[]' | tr '\n' ' ')

echo "OpenSearch VPC: $OPENSEARCH_VPC"
echo "OpenSearch Subnets: $OPENSEARCH_SUBNETS"
echo "OpenSearch Security Groups: $OPENSEARCH_SG"

# Check VPC match
echo -e "\n[4/8] Verifying VPC Match..."
if [ "$VPC_ID" == "$OPENSEARCH_VPC" ]; then
  echo "✓ EC2 and OpenSearch are in the same VPC"
else
  echo "✗ ERROR: EC2 and OpenSearch are in DIFFERENT VPCs!"
  echo "  EC2 VPC: $VPC_ID"
  echo "  OpenSearch VPC: $OPENSEARCH_VPC"
  echo "  ACTION REQUIRED: Set up VPC peering or move resources to same VPC"
fi

# Check DNS resolution
echo -e "\n[5/8] Testing DNS Resolution..."
if nslookup $OPENSEARCH_HOST > /dev/null 2>&1; then
  echo "✓ DNS resolution successful"
  RESOLVED_IP=$(nslookup $OPENSEARCH_HOST | grep -A1 "Name:" | tail -1 | awk '{print $2}')
  echo "  Resolved to: $RESOLVED_IP"
else
  echo "✗ ERROR: DNS resolution failed"
  echo "  ACTION REQUIRED: Enable DNS resolution in VPC"
fi

# Check network connectivity
echo -e "\n[6/8] Testing Network Connectivity..."
if timeout 5 bash -c "cat < /dev/null > /dev/tcp/$OPENSEARCH_HOST/443" 2>/dev/null; then
  echo "✓ Port 443 is reachable"
else
  echo "✗ ERROR: Cannot connect to port 443"
  echo "  ACTION REQUIRED: Check security groups and NACLs"
fi

# Check security group rules
echo -e "\n[7/8] Analyzing Security Group Rules..."
echo "EC2 Outbound Rules (checking for HTTPS):"
for sg in $SG_IDS; do
  EGRESS=$(aws ec2 describe-security-groups --group-ids $sg --region $REGION \
    | jq -r '.SecurityGroups[0].IpPermissionsEgress[] | select(.IpProtocol=="tcp" or .IpProtocol=="-1") | "\(.IpProtocol) \(.FromPort // "all") \(.ToPort // "all")"')
  if echo "$EGRESS" | grep -q "443\|all"; then
    echo "✓ SG $sg allows outbound HTTPS"
  else
    echo "✗ SG $sg may not allow outbound HTTPS"
  fi
done

echo -e "\nOpenSearch Inbound Rules (checking for EC2 access):"
for osg in $OPENSEARCH_SG; do
  INGRESS=$(aws ec2 describe-security-groups --group-ids $osg --region $REGION \
    | jq -r '.SecurityGroups[0].IpPermissions[]')
  if echo "$INGRESS" | grep -q "443"; then
    echo "✓ OpenSearch SG $osg has inbound rules on port 443"
  else
    echo "✗ OpenSearch SG $osg may not allow inbound on port 443"
  fi
done

# Test actual connection
echo -e "\n[8/8] Testing HTTP Connection..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$OPENSEARCH_ENDPOINT/_cluster/health" 2>/dev/null || echo "000")
echo "HTTP Response Code: $HTTP_CODE"

case $HTTP_CODE in
  200)
    echo "✓ SUCCESS: Connection successful!"
    ;;
  403)
    echo "⚠ WARNING: Connection successful but access denied"
    echo "  ACTION REQUIRED: Check IAM permissions and OpenSearch access policy"
    ;;
  000)
    echo "✗ ERROR: Connection timeout or refused"
    echo "  ACTION REQUIRED: Fix network connectivity (steps above)"
    ;;
  *)
    echo "⚠ WARNING: Unexpected response code"
    ;;
esac

echo -e "\n=========================================="
echo "Diagnostic Complete"
echo "=========================================="
```

## Quick Fix Script

```bash
#!/bin/bash
# save as: fix-opensearch-connectivity.sh

set -e

echo "OpenSearch Connectivity Quick Fix"
echo "=================================="

# Get current instance details
INSTANCE_ID=$(ec2-metadata --instance-id | cut -d ' ' -f 2)
REGION="ap-northeast-1"
DOMAIN_NAME="cis-filesearch-opensearch"

# Get security groups
EC2_SG=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID --region $REGION \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text)

OPENSEARCH_SG=$(aws opensearch describe-domain --domain-name $DOMAIN_NAME --region $REGION \
  --query 'DomainStatus.VPCOptions.SecurityGroupIds[0]' --output text)

echo "EC2 Security Group: $EC2_SG"
echo "OpenSearch Security Group: $OPENSEARCH_SG"

# Add security group rule
echo -e "\nAdding security group rule..."
aws ec2 authorize-security-group-ingress \
  --group-id $OPENSEARCH_SG \
  --protocol tcp \
  --port 443 \
  --source-group $EC2_SG \
  --region $REGION \
  2>/dev/null && echo "✓ Rule added successfully" || echo "✓ Rule already exists"

echo -e "\nWaiting 30 seconds for changes to propagate..."
sleep 30

# Test connection
OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$OPENSEARCH_ENDPOINT/_cluster/health")

if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "403" ]; then
  echo "✓ Connection successful!"
  exit 0
else
  echo "✗ Connection still failing. Run diagnostic script for more details."
  exit 1
fi
```
