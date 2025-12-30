#!/bin/bash
################################################################################
# OpenSearch Connectivity Quick Fix Script
# Purpose: Automatically fix common connectivity issues between EC2 and OpenSearch
# Usage: ./fix-opensearch-connectivity.sh
################################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOMAIN_NAME="cis-filesearch-opensearch"
OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION="ap-northeast-1"

echo "=========================================="
echo "OpenSearch Connectivity Quick Fix"
echo "=========================================="

# Get instance metadata
echo -e "\n${BLUE}[1/5] Gathering instance information...${NC}"
if command -v ec2-metadata &> /dev/null; then
  INSTANCE_ID=$(ec2-metadata --instance-id 2>/dev/null | cut -d ' ' -f 2)
else
  TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null)
  INSTANCE_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null)
fi

echo "Instance ID: $INSTANCE_ID"

# Get EC2 details
VPC_INFO=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID --region $REGION)
VPC_ID=$(echo $VPC_INFO | jq -r '.Reservations[0].Instances[0].VpcId')
EC2_SG=$(echo $VPC_INFO | jq -r '.Reservations[0].Instances[0].SecurityGroups[0].GroupId')
IAM_PROFILE_ARN=$(echo $VPC_INFO | jq -r '.Reservations[0].Instances[0].IamInstanceProfile.Arn // "None"')

# Extract role name from instance profile ARN
if [ "$IAM_PROFILE_ARN" != "None" ]; then
  IAM_ROLE_NAME=$(echo $IAM_PROFILE_ARN | sed 's/.*instance-profile\///' | sed 's/-.*//')
  # Get actual role ARN
  IAM_ROLE_ARN=$(aws iam get-instance-profile --instance-profile-name $(echo $IAM_PROFILE_ARN | awk -F'/' '{print $NF}') \
    --query 'InstanceProfile.Roles[0].Arn' --output text 2>/dev/null || echo "None")
else
  IAM_ROLE_NAME="None"
  IAM_ROLE_ARN="None"
fi

echo "VPC ID: $VPC_ID"
echo "EC2 Security Group: $EC2_SG"
echo "IAM Role: $IAM_ROLE_NAME"
echo "IAM Role ARN: $IAM_ROLE_ARN"

# Get OpenSearch details
OPENSEARCH_INFO=$(aws opensearch describe-domain --domain-name $DOMAIN_NAME --region $REGION)
OPENSEARCH_VPC=$(echo $OPENSEARCH_INFO | jq -r '.DomainStatus.VPCOptions.VPCId')
OPENSEARCH_SG=$(echo $OPENSEARCH_INFO | jq -r '.DomainStatus.VPCOptions.SecurityGroupIds[0]')
OPENSEARCH_ARN=$(echo $OPENSEARCH_INFO | jq -r '.DomainStatus.ARN')

echo "OpenSearch VPC: $OPENSEARCH_VPC"
echo "OpenSearch Security Group: $OPENSEARCH_SG"
echo "OpenSearch ARN: $OPENSEARCH_ARN"

# Verify VPC match
if [ "$VPC_ID" != "$OPENSEARCH_VPC" ]; then
  echo -e "${RED}✗ ERROR: EC2 and OpenSearch are in different VPCs${NC}"
  echo "  EC2 VPC: $VPC_ID"
  echo "  OpenSearch VPC: $OPENSEARCH_VPC"
  echo "Cannot automatically fix - manual VPC peering or resource migration required"
  exit 1
fi

echo -e "${GREEN}✓ VPC match verified${NC}"

# Fix 1: Security Group Rules
echo -e "\n${BLUE}[2/5] Fixing Security Group Rules...${NC}"

# Check if rule already exists
EXISTING_RULE=$(aws ec2 describe-security-groups --group-ids $OPENSEARCH_SG --region $REGION \
  --query "SecurityGroups[0].IpPermissions[?IpProtocol=='tcp' && FromPort==\`443\`].UserIdGroupPairs[?GroupId=='$EC2_SG'].GroupId" \
  --output text)

if [ -n "$EXISTING_RULE" ] && [ "$EXISTING_RULE" != "None" ]; then
  echo -e "${GREEN}✓ Security group rule already exists${NC}"
else
  echo "Adding security group ingress rule..."
  if aws ec2 authorize-security-group-ingress \
    --group-id $OPENSEARCH_SG \
    --protocol tcp \
    --port 443 \
    --source-group $EC2_SG \
    --region $REGION 2>&1; then
    echo -e "${GREEN}✓ Security group rule added successfully${NC}"
  else
    echo -e "${YELLOW}⚠ Rule may already exist or insufficient permissions${NC}"
  fi
fi

# Fix 2: VPC DNS Settings
echo -e "\n${BLUE}[3/5] Verifying VPC DNS Settings...${NC}"

VPC_DNS_SUPPORT=$(aws ec2 describe-vpc-attribute --vpc-id $VPC_ID --attribute enableDnsSupport \
  --query 'EnableDnsSupport.Value' --output text --region $REGION)
VPC_DNS_HOSTNAMES=$(aws ec2 describe-vpc-attribute --vpc-id $VPC_ID --attribute enableDnsHostnames \
  --query 'EnableDnsHostnames.Value' --output text --region $REGION)

if [ "$VPC_DNS_SUPPORT" == "true" ] && [ "$VPC_DNS_HOSTNAMES" == "true" ]; then
  echo -e "${GREEN}✓ VPC DNS settings are correct${NC}"
else
  echo "Enabling VPC DNS settings..."
  if [ "$VPC_DNS_SUPPORT" != "true" ]; then
    aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-support --region $REGION
    echo -e "${GREEN}✓ DNS Support enabled${NC}"
  fi
  if [ "$VPC_DNS_HOSTNAMES" != "true" ]; then
    aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-hostnames --region $REGION
    echo -e "${GREEN}✓ DNS Hostnames enabled${NC}"
  fi
fi

# Fix 3: IAM Permissions
echo -e "\n${BLUE}[4/5] Fixing IAM Permissions...${NC}"

if [ "$IAM_ROLE_NAME" == "None" ] || [ "$IAM_ROLE_ARN" == "None" ]; then
  echo -e "${YELLOW}⚠ No IAM role attached to EC2 instance${NC}"
  echo "Cannot configure IAM permissions - please attach an IAM role to the instance"
else
  # Create inline policy for OpenSearch access
  POLICY_NAME="OpenSearchAccessPolicy"

  # Check if policy already exists
  EXISTING_POLICY=$(aws iam list-role-policies --role-name $IAM_ROLE_NAME \
    --query "PolicyNames[?@=='$POLICY_NAME']" --output text 2>/dev/null || echo "")

  if [ -n "$EXISTING_POLICY" ]; then
    echo -e "${GREEN}✓ IAM policy already exists on role${NC}"
  else
    echo "Creating IAM policy for OpenSearch access..."

    # Create policy document
    cat > /tmp/opensearch-iam-policy.json <<EOF
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
        "es:ESHttpPatch",
        "es:DescribeDomain",
        "es:DescribeDomains"
      ],
      "Resource": "${OPENSEARCH_ARN}/*"
    }
  ]
}
EOF

    if aws iam put-role-policy \
      --role-name $IAM_ROLE_NAME \
      --policy-name $POLICY_NAME \
      --policy-document file:///tmp/opensearch-iam-policy.json 2>&1; then
      echo -e "${GREEN}✓ IAM policy attached to role${NC}"
    else
      echo -e "${YELLOW}⚠ Failed to attach IAM policy - may lack permissions${NC}"
    fi

    rm -f /tmp/opensearch-iam-policy.json
  fi

  # Update OpenSearch access policy
  echo "Updating OpenSearch domain access policy..."

  # Get current access policy
  CURRENT_POLICY=$(echo $OPENSEARCH_INFO | jq -r '.DomainStatus.AccessPolicies')

  # Create new access policy allowing the IAM role
  cat > /tmp/opensearch-access-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "${IAM_ROLE_ARN}"
      },
      "Action": "es:*",
      "Resource": "${OPENSEARCH_ARN}/*"
    },
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "*"
      },
      "Action": "es:*",
      "Resource": "${OPENSEARCH_ARN}/*",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": ["10.0.0.0/8"]
        }
      }
    }
  ]
}
EOF

  if aws opensearch update-domain-config \
    --domain-name $DOMAIN_NAME \
    --access-policies file:///tmp/opensearch-access-policy.json \
    --region $REGION 2>&1; then
    echo -e "${GREEN}✓ OpenSearch access policy updated${NC}"
    echo -e "${YELLOW}⚠ Note: Access policy changes can take 5-10 minutes to propagate${NC}"
  else
    echo -e "${YELLOW}⚠ Failed to update OpenSearch access policy${NC}"
    echo "This may require OpenSearch admin permissions"
  fi

  rm -f /tmp/opensearch-access-policy.json
fi

# Fix 4: Test Connection
echo -e "\n${BLUE}[5/5] Testing Connection...${NC}"

echo "Waiting 10 seconds for changes to propagate..."
sleep 10

# Test connection
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$OPENSEARCH_ENDPOINT/_cluster/health" 2>/dev/null || echo "000")

echo "HTTP Response Code: $HTTP_CODE"

case $HTTP_CODE in
  200)
    echo -e "${GREEN}✓ SUCCESS: Connection successful!${NC}"
    echo "OpenSearch is now accessible from this EC2 instance"
    exit 0
    ;;
  403)
    echo -e "${YELLOW}⚠ Network connectivity OK but access denied${NC}"
    echo "The security groups are configured correctly"
    echo "However, IAM permissions may need more time to propagate (5-10 minutes)"
    echo ""
    echo "If the issue persists, verify:"
    echo "  1. IAM role has correct permissions"
    echo "  2. OpenSearch access policy includes your IAM role"
    echo "  3. Wait up to 10 minutes for policy changes to take effect"
    exit 2
    ;;
  000)
    echo -e "${RED}✗ Connection still failing${NC}"
    echo ""
    echo "Possible remaining issues:"
    echo "  1. Network ACL rules blocking traffic"
    echo "  2. Route table misconfiguration"
    echo "  3. OpenSearch domain still initializing"
    echo ""
    echo "Run the diagnostic script for detailed analysis:"
    echo "  ./diagnose-opensearch.sh"
    exit 1
    ;;
  *)
    echo -e "${YELLOW}⚠ Unexpected response code${NC}"
    echo "Run diagnostic script for more details"
    exit 1
    ;;
esac
