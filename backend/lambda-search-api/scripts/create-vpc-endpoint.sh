#!/bin/bash

# ============================================================================
# Create VPC Endpoint for OpenSearch Service
# ============================================================================
# This script creates an Interface VPC Endpoint for AWS OpenSearch Service
# to enable Lambda functions in VPC to resolve OpenSearch domain DNS names.
# ============================================================================

set -e

# Configuration
REGION="ap-northeast-1"
VPC_ID="vpc-02d08f2fa75078e67"
SUBNET_IDS="subnet-0ea0487400a0b3627 subnet-01edf92f9d1500875 subnet-0ce8ff9ce4bc429bf"
SECURITY_GROUP_ID="sg-0c482a057b356a0c3"
SERVICE_NAME="com.amazonaws.${REGION}.es"

echo "============================================================================"
echo "Creating VPC Endpoint for OpenSearch Service"
echo "============================================================================"
echo ""
echo "Configuration:"
echo "  Region:            ${REGION}"
echo "  VPC ID:            ${VPC_ID}"
echo "  Security Group:    ${SECURITY_GROUP_ID}"
echo "  Subnets:           ${SUBNET_IDS}"
echo "  Service Name:      ${SERVICE_NAME}"
echo ""

# Check if VPC endpoint already exists
echo "Checking for existing VPC endpoints..."
EXISTING_ENDPOINT=$(aws ec2 describe-vpc-endpoints \
    --region ${REGION} \
    --filters "Name=vpc-id,Values=${VPC_ID}" \
              "Name=service-name,Values=${SERVICE_NAME}" \
    --query 'VpcEndpoints[0].VpcEndpointId' \
    --output text 2>&1)

if [ "$EXISTING_ENDPOINT" != "None" ] && [ -n "$EXISTING_ENDPOINT" ]; then
    echo "✓ VPC Endpoint already exists: ${EXISTING_ENDPOINT}"
    echo ""
    echo "Endpoint details:"
    aws ec2 describe-vpc-endpoints \
        --region ${REGION} \
        --vpc-endpoint-ids ${EXISTING_ENDPOINT} \
        --query 'VpcEndpoints[0].{State:State,DnsEntries:DnsEntries,SubnetIds:SubnetIds,SecurityGroupIds:Groups[*].GroupId}' \
        --output json
    exit 0
fi

echo "No existing VPC endpoint found. Creating new endpoint..."
echo ""

# Create VPC Endpoint
VPC_ENDPOINT_ID=$(aws ec2 create-vpc-endpoint \
    --region ${REGION} \
    --vpc-id ${VPC_ID} \
    --vpc-endpoint-type Interface \
    --service-name ${SERVICE_NAME} \
    --subnet-ids ${SUBNET_IDS} \
    --security-group-ids ${SECURITY_GROUP_ID} \
    --private-dns-enabled \
    --tag-specifications "ResourceType=vpc-endpoint,Tags=[{Key=Name,Value=cis-opensearch-vpc-endpoint},{Key=Project,Value=CIS-FileSearch},{Key=ManagedBy,Value=CLI}]" \
    --query 'VpcEndpoint.VpcEndpointId' \
    --output text)

echo "✓ VPC Endpoint created successfully: ${VPC_ENDPOINT_ID}"
echo ""

# Wait for endpoint to become available
echo "Waiting for VPC endpoint to become available..."
aws ec2 wait vpc-endpoint-available \
    --region ${REGION} \
    --vpc-endpoint-ids ${VPC_ENDPOINT_ID}

echo "✓ VPC Endpoint is now available"
echo ""

# Display endpoint details
echo "VPC Endpoint Details:"
aws ec2 describe-vpc-endpoints \
    --region ${REGION} \
    --vpc-endpoint-ids ${VPC_ENDPOINT_ID} \
    --query 'VpcEndpoints[0].{VpcEndpointId:VpcEndpointId,State:State,ServiceName:ServiceName,VpcId:VpcId,SubnetIds:SubnetIds,SecurityGroupIds:Groups[*].GroupId,DnsEntries:DnsEntries,PrivateDnsEnabled:PrivateDnsEnabled}' \
    --output json

echo ""
echo "============================================================================"
echo "Next Steps:"
echo "============================================================================"
echo "1. Verify DNS resolution from Lambda:"
echo "   - Check CloudWatch Logs for Lambda function"
echo "   - Test search API endpoint"
echo ""
echo "2. Test API endpoint:"
echo "   curl -X GET \"https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search?q=test&limit=10\""
echo ""
echo "3. Monitor VPC Endpoint:"
echo "   aws ec2 describe-vpc-endpoints --vpc-endpoint-ids ${VPC_ENDPOINT_ID}"
echo ""
echo "============================================================================"
