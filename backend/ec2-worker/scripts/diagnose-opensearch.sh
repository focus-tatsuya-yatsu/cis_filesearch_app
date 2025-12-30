#!/bin/bash
################################################################################
# OpenSearch Connectivity Diagnostic Script
# Purpose: Diagnose and identify connectivity issues between EC2 and OpenSearch
# Usage: ./diagnose-opensearch.sh
################################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DOMAIN_NAME="cis-filesearch-opensearch"
OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
OPENSEARCH_HOST="vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION="ap-northeast-1"

echo "=========================================="
echo "OpenSearch Connectivity Diagnostic Tool"
echo "=========================================="

# Check required tools
echo -e "\n${YELLOW}[0/9] Checking required tools...${NC}"
REQUIRED_TOOLS=("aws" "curl" "jq" "nslookup")
MISSING_TOOLS=()

for tool in "${REQUIRED_TOOLS[@]}"; do
  if ! command -v $tool &> /dev/null; then
    MISSING_TOOLS+=($tool)
  fi
done

if [ ${#MISSING_TOOLS[@]} -gt 0 ]; then
  echo -e "${RED}✗ Missing required tools: ${MISSING_TOOLS[*]}${NC}"
  echo "Installing missing tools..."
  sudo yum install -y bind-utils jq curl aws-cli
fi

# Get instance metadata
echo -e "\n${YELLOW}[1/9] Gathering EC2 Instance Information...${NC}"
if command -v ec2-metadata &> /dev/null; then
  INSTANCE_ID=$(ec2-metadata --instance-id 2>/dev/null | cut -d ' ' -f 2)
else
  # Fallback to IMDSv2
  TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null)
  INSTANCE_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null)
fi

echo "Instance ID: $INSTANCE_ID"
echo "Region: $REGION"

# Get VPC details
echo -e "\n${YELLOW}[2/9] Checking VPC Configuration...${NC}"
VPC_INFO=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID --region $REGION 2>/dev/null)

if [ -z "$VPC_INFO" ] || [ "$VPC_INFO" == "null" ]; then
  echo -e "${RED}✗ ERROR: Cannot retrieve instance information${NC}"
  echo "Check if AWS CLI is properly configured and instance has IAM role with EC2 permissions"
  exit 1
fi

VPC_ID=$(echo $VPC_INFO | jq -r '.Reservations[0].Instances[0].VpcId')
SUBNET_ID=$(echo $VPC_INFO | jq -r '.Reservations[0].Instances[0].SubnetId')
PRIVATE_IP=$(echo $VPC_INFO | jq -r '.Reservations[0].Instances[0].PrivateIpAddress')
SG_IDS=$(echo $VPC_INFO | jq -r '.Reservations[0].Instances[0].SecurityGroups[].GroupId' | tr '\n' ' ')
IAM_PROFILE=$(echo $VPC_INFO | jq -r '.Reservations[0].Instances[0].IamInstanceProfile.Arn // "None"')

echo "VPC ID: $VPC_ID"
echo "Subnet ID: $SUBNET_ID"
echo "Private IP: $PRIVATE_IP"
echo "Security Groups: $SG_IDS"
echo "IAM Profile: $IAM_PROFILE"

# Check OpenSearch domain
echo -e "\n${YELLOW}[3/9] Checking OpenSearch Domain Configuration...${NC}"
OPENSEARCH_INFO=$(aws opensearch describe-domain --domain-name $DOMAIN_NAME --region $REGION 2>/dev/null)

if [ -z "$OPENSEARCH_INFO" ] || [ "$OPENSEARCH_INFO" == "null" ]; then
  echo -e "${RED}✗ ERROR: Cannot retrieve OpenSearch domain information${NC}"
  echo "Possible causes:"
  echo "  1. Domain name is incorrect"
  echo "  2. Domain is in different region"
  echo "  3. IAM role lacks es:DescribeDomain permission"
  exit 1
fi

OPENSEARCH_VPC=$(echo $OPENSEARCH_INFO | jq -r '.DomainStatus.VPCOptions.VPCId // "None"')
OPENSEARCH_SUBNETS=$(echo $OPENSEARCH_INFO | jq -r '.DomainStatus.VPCOptions.SubnetIds[]' 2>/dev/null | tr '\n' ' ')
OPENSEARCH_SG=$(echo $OPENSEARCH_INFO | jq -r '.DomainStatus.VPCOptions.SecurityGroupIds[]' 2>/dev/null | tr '\n' ' ')
OPENSEARCH_ENDPOINT_ACTUAL=$(echo $OPENSEARCH_INFO | jq -r '.DomainStatus.Endpoint // .DomainStatus.Endpoints.vpc // "None"')

echo "OpenSearch VPC: $OPENSEARCH_VPC"
echo "OpenSearch Subnets: $OPENSEARCH_SUBNETS"
echo "OpenSearch Security Groups: $OPENSEARCH_SG"
echo "OpenSearch Endpoint: $OPENSEARCH_ENDPOINT_ACTUAL"

# Check VPC match
echo -e "\n${YELLOW}[4/9] Verifying VPC Match...${NC}"
if [ "$VPC_ID" == "$OPENSEARCH_VPC" ]; then
  echo -e "${GREEN}✓ EC2 and OpenSearch are in the same VPC${NC}"
else
  echo -e "${RED}✗ ERROR: EC2 and OpenSearch are in DIFFERENT VPCs!${NC}"
  echo "  EC2 VPC: $VPC_ID"
  echo "  OpenSearch VPC: $OPENSEARCH_VPC"
  echo -e "${YELLOW}  ACTION REQUIRED: Resources must be in same VPC or VPC peering needed${NC}"
  exit 1
fi

# Check DNS resolution
echo -e "\n${YELLOW}[5/9] Testing DNS Resolution...${NC}"
DNS_RESULT=$(nslookup $OPENSEARCH_HOST 2>&1)
if echo "$DNS_RESULT" | grep -q "can't find\|NXDOMAIN"; then
  echo -e "${RED}✗ ERROR: DNS resolution failed${NC}"
  echo "$DNS_RESULT"
  echo -e "${YELLOW}  ACTION REQUIRED: Enable DNS resolution in VPC${NC}"
  echo "  Run: aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-support"
  echo "  Run: aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-hostnames"
else
  echo -e "${GREEN}✓ DNS resolution successful${NC}"
  RESOLVED_IPS=$(echo "$DNS_RESULT" | grep -A10 "Name:" | grep "Address:" | awk '{print $2}' | grep -v "#" | tr '\n' ' ')
  echo "  Resolved IPs: $RESOLVED_IPS"
fi

# Check network connectivity
echo -e "\n${YELLOW}[6/9] Testing Network Connectivity (Port 443)...${NC}"
if timeout 5 bash -c "exec 3<>/dev/tcp/$OPENSEARCH_HOST/443" 2>/dev/null; then
  echo -e "${GREEN}✓ Port 443 is reachable${NC}"
else
  echo -e "${RED}✗ ERROR: Cannot connect to port 443${NC}"
  echo -e "${YELLOW}  ACTION REQUIRED: Check security groups and NACLs${NC}"

  # Additional troubleshooting
  echo -e "\n  Attempting traceroute..."
  traceroute -m 5 -w 2 $OPENSEARCH_HOST 2>&1 | head -10
fi

# Check EC2 security group outbound rules
echo -e "\n${YELLOW}[7/9] Analyzing EC2 Security Group Outbound Rules...${NC}"
for sg in $SG_IDS; do
  echo "  Checking SG: $sg"
  EGRESS=$(aws ec2 describe-security-groups --group-ids $sg --region $REGION \
    --query 'SecurityGroups[0].IpPermissionsEgress' 2>/dev/null)

  # Check for HTTPS outbound
  HTTPS_ALLOWED=$(echo "$EGRESS" | jq -r '.[] | select(.IpProtocol=="tcp" and (.FromPort==443 or .FromPort==null)) | "allowed"')
  ALL_ALLOWED=$(echo "$EGRESS" | jq -r '.[] | select(.IpProtocol=="-1") | "allowed"')

  if [ "$HTTPS_ALLOWED" == "allowed" ] || [ "$ALL_ALLOWED" == "allowed" ]; then
    echo -e "    ${GREEN}✓ Outbound HTTPS (443) is allowed${NC}"
  else
    echo -e "    ${RED}✗ Outbound HTTPS (443) may not be allowed${NC}"
    echo "    Egress rules:"
    echo "$EGRESS" | jq -r '.[] | "      \(.IpProtocol) \(.FromPort // "all")-\(.ToPort // "all") \(.IpRanges[0].CidrIp // .Ipv6Ranges[0].CidrIpv6 // "sg-ref")"'
  fi
done

# Check OpenSearch security group inbound rules
echo -e "\n${YELLOW}[8/9] Analyzing OpenSearch Security Group Inbound Rules...${NC}"
for osg in $OPENSEARCH_SG; do
  echo "  Checking OpenSearch SG: $osg"
  INGRESS=$(aws ec2 describe-security-groups --group-ids $osg --region $REGION \
    --query 'SecurityGroups[0].IpPermissions' 2>/dev/null)

  # Check if EC2 security groups are allowed
  ALLOWED_FROM_EC2=false
  for ec2_sg in $SG_IDS; do
    SG_ALLOWED=$(echo "$INGRESS" | jq -r --arg sg "$ec2_sg" '.[] | select(.IpProtocol=="tcp" and (.FromPort==443 or .FromPort==null)) | .UserIdGroupPairs[] | select(.GroupId==$sg) | "allowed"')
    if [ "$SG_ALLOWED" == "allowed" ]; then
      echo -e "    ${GREEN}✓ Inbound from EC2 SG $ec2_sg is allowed on port 443${NC}"
      ALLOWED_FROM_EC2=true
    fi
  done

  # Check if VPC CIDR is allowed
  VPC_CIDR=$(aws ec2 describe-vpcs --vpc-ids $VPC_ID --region $REGION --query 'Vpcs[0].CidrBlock' --output text)
  CIDR_ALLOWED=$(echo "$INGRESS" | jq -r --arg cidr "$VPC_CIDR" '.[] | select(.IpProtocol=="tcp" and (.FromPort==443 or .FromPort==null)) | .IpRanges[] | select(.CidrIp==$cidr) | "allowed"')
  if [ "$CIDR_ALLOWED" == "allowed" ]; then
    echo -e "    ${GREEN}✓ Inbound from VPC CIDR $VPC_CIDR is allowed on port 443${NC}"
    ALLOWED_FROM_EC2=true
  fi

  if [ "$ALLOWED_FROM_EC2" == "false" ]; then
    echo -e "    ${RED}✗ No inbound rule found allowing EC2 instance access${NC}"
    echo -e "    ${YELLOW}ACTION REQUIRED: Add security group rule${NC}"
    echo "    Run this command to fix:"
    echo "    aws ec2 authorize-security-group-ingress \\"
    echo "      --group-id $osg \\"
    echo "      --protocol tcp \\"
    echo "      --port 443 \\"
    echo "      --source-group $(echo $SG_IDS | awk '{print $1}') \\"
    echo "      --region $REGION"
  fi

  echo "    Current Ingress rules:"
  echo "$INGRESS" | jq -r '.[] | "      \(.IpProtocol) \(.FromPort // "all")-\(.ToPort // "all") \(.IpRanges[0].CidrIp // .UserIdGroupPairs[0].GroupId // "unknown")"'
done

# Test actual HTTP connection
echo -e "\n${YELLOW}[9/9] Testing HTTP Connection to OpenSearch...${NC}"
HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" -m 10 "$OPENSEARCH_ENDPOINT/_cluster/health" 2>&1)
HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -1)
HTTP_BODY=$(echo "$HTTP_RESPONSE" | head -n -1)

echo "HTTP Response Code: $HTTP_CODE"

case $HTTP_CODE in
  200)
    echo -e "${GREEN}✓ SUCCESS: Connection successful!${NC}"
    echo "Cluster Health:"
    echo "$HTTP_BODY" | jq '.' 2>/dev/null || echo "$HTTP_BODY"
    ;;
  403)
    echo -e "${YELLOW}⚠ WARNING: Connection successful but access denied (403 Forbidden)${NC}"
    echo -e "${YELLOW}ACTION REQUIRED: Fix IAM permissions${NC}"
    echo "Response:"
    echo "$HTTP_BODY"
    echo -e "\nThis means network connectivity is OK, but:"
    echo "  1. EC2 instance role may lack OpenSearch permissions"
    echo "  2. OpenSearch access policy may not allow this instance"
    echo -e "\nTo fix, update OpenSearch access policy with:"
    echo "  Principal: $(echo $IAM_PROFILE | sed 's/instance-profile/role/')"
    ;;
  000)
    echo -e "${RED}✗ ERROR: Connection timeout or refused${NC}"
    echo -e "${YELLOW}ACTION REQUIRED: Fix network connectivity${NC}"
    echo "Error details:"
    echo "$HTTP_BODY"
    echo -e "\nMost likely causes:"
    echo "  1. Security group rules not allowing traffic (see above)"
    echo "  2. Network ACL blocking traffic"
    echo "  3. Route table misconfiguration"
    ;;
  *)
    echo -e "${YELLOW}⚠ WARNING: Unexpected response code${NC}"
    echo "Response:"
    echo "$HTTP_BODY"
    ;;
esac

# Summary
echo -e "\n=========================================="
echo "Diagnostic Summary"
echo "=========================================="

if [ "$HTTP_CODE" == "200" ]; then
  echo -e "${GREEN}✓ All checks passed - OpenSearch is accessible${NC}"
  exit 0
elif [ "$HTTP_CODE" == "403" ]; then
  echo -e "${YELLOW}⚠ Network connectivity OK - IAM permissions need fixing${NC}"
  echo "See IAM configuration section above for details"
  exit 2
else
  echo -e "${RED}✗ Connection failed - Network configuration issues detected${NC}"
  echo "Review the diagnostic output above for specific issues"
  exit 1
fi
