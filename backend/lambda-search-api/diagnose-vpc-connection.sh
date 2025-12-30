#!/bin/bash

# ============================================================================
# Lambda Search API - VPC Connection Diagnostic Script
# ============================================================================

FUNCTION_NAME="cis-search-api-prod"
REGION="ap-northeast-1"
VPC_ID="vpc-02d08f2fa75078e67"

echo "=================================================="
echo "Lambda VPC Connection Diagnostics"
echo "=================================================="
echo ""

# Function to check and display status
check_status() {
    if [ $? -eq 0 ]; then
        echo "✅ $1"
    else
        echo "❌ $1"
        return 1
    fi
}

# 1. Lambda Function Configuration
echo "[1] Lambda Function Configuration"
echo "=================================================="

echo "Retrieving Lambda configuration..."
LAMBDA_CONFIG=$(aws lambda get-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --region "$REGION" \
    --no-cli-pager 2>&1)

if [ $? -eq 0 ]; then
    echo "✅ Lambda function exists"
    echo ""

    # Extract VPC config
    SUBNET_IDS=$(echo "$LAMBDA_CONFIG" | grep -o '"SubnetIds": \[[^]]*\]' | grep -o 'subnet-[a-z0-9]*' | tr '\n' ',' | sed 's/,$//')
    SG_IDS=$(echo "$LAMBDA_CONFIG" | grep -o '"SecurityGroupIds": \[[^]]*\]' | grep -o 'sg-[a-z0-9]*' | tr '\n' ',' | sed 's/,$//')
    OPENSEARCH_ENDPOINT=$(echo "$LAMBDA_CONFIG" | grep -o '"OPENSEARCH_ENDPOINT": "[^"]*"' | cut -d'"' -f4)

    echo "VPC Configuration:"
    echo "  VPC ID: $VPC_ID"
    echo "  Subnets: $SUBNET_IDS"
    echo "  Security Groups: $SG_IDS"
    echo "  OpenSearch Endpoint: $OPENSEARCH_ENDPOINT"
    echo ""
else
    echo "❌ Failed to get Lambda configuration"
    echo "$LAMBDA_CONFIG"
    exit 1
fi

# 2. VPC DNS Settings
echo "[2] VPC DNS Settings"
echo "=================================================="

DNS_SUPPORT=$(aws ec2 describe-vpc-attribute \
    --vpc-id "$VPC_ID" \
    --attribute enableDnsSupport \
    --region "$REGION" \
    --query 'EnableDnsSupport.Value' \
    --output text 2>&1)
check_status "DNS Support: $DNS_SUPPORT" || true

DNS_HOSTNAMES=$(aws ec2 describe-vpc-attribute \
    --vpc-id "$VPC_ID" \
    --attribute enableDnsHostnames \
    --region "$REGION" \
    --query 'EnableDnsHostnames.Value' \
    --output text 2>&1)
check_status "DNS Hostnames: $DNS_HOSTNAMES" || true
echo ""

# 3. Security Groups
echo "[3] Security Groups Analysis"
echo "=================================================="

IFS=',' read -ra SG_ARRAY <<< "$SG_IDS"
for SG in "${SG_ARRAY[@]}"; do
    echo "Security Group: $SG"

    SG_INFO=$(aws ec2 describe-security-groups \
        --group-ids "$SG" \
        --region "$REGION" \
        --no-cli-pager 2>&1)

    if [ $? -eq 0 ]; then
        SG_NAME=$(echo "$SG_INFO" | grep -o '"GroupName": "[^"]*"' | head -1 | cut -d'"' -f4)
        echo "  Name: $SG_NAME"

        # Check egress rules
        EGRESS_COUNT=$(echo "$SG_INFO" | grep -c "IpPermissionsEgress")
        echo "  Egress Rules: $EGRESS_COUNT"

        # Check if port 443 is allowed
        HAS_443=$(echo "$SG_INFO" | grep -c '"FromPort": 443')
        if [ $HAS_443 -gt 0 ]; then
            echo "  ✅ Port 443 (HTTPS) allowed"
        else
            echo "  ⚠️  Port 443 (HTTPS) not explicitly allowed"
        fi
    fi
    echo ""
done

# 4. OpenSearch Domain
echo "[4] OpenSearch Domain Status"
echo "=================================================="

if [ ! -z "$OPENSEARCH_ENDPOINT" ]; then
    # Extract domain name from endpoint
    DOMAIN_NAME=$(echo "$OPENSEARCH_ENDPOINT" | sed 's/\..*$//')

    echo "Checking OpenSearch domain: $DOMAIN_NAME"

    OS_DOMAIN=$(aws opensearch describe-domain \
        --domain-name "$DOMAIN_NAME" \
        --region "$REGION" \
        --no-cli-pager 2>&1)

    if [ $? -eq 0 ]; then
        echo "✅ OpenSearch domain found"

        OS_VPC=$(echo "$OS_DOMAIN" | grep -o '"VPCId": "[^"]*"' | cut -d'"' -f4)
        OS_SUBNET=$(echo "$OS_DOMAIN" | grep -o '"SubnetIds": \[[^]]*\]' | grep -o 'subnet-[a-z0-9]*' | head -1)
        OS_SG=$(echo "$OS_DOMAIN" | grep -o '"SecurityGroupIds": \[[^]]*\]' | grep -o 'sg-[a-z0-9]*' | head -1)
        OS_PROCESSING=$(echo "$OS_DOMAIN" | grep -o '"Processing": [^,]*' | cut -d':' -f2 | tr -d ' ')

        echo "  VPC ID: $OS_VPC"
        echo "  Subnet: $OS_SUBNET"
        echo "  Security Group: $OS_SG"
        echo "  Processing: $OS_PROCESSING"

        # Check if VPCs match
        if [ "$OS_VPC" == "$VPC_ID" ]; then
            echo "  ✅ OpenSearch is in the same VPC as Lambda"
        else
            echo "  ❌ VPC mismatch! Lambda VPC: $VPC_ID, OpenSearch VPC: $OS_VPC"
        fi
    else
        echo "❌ OpenSearch domain not found or error occurred"
        echo "$OS_DOMAIN"
    fi
else
    echo "⚠️  OPENSEARCH_ENDPOINT environment variable not set"
fi
echo ""

# 5. VPC Endpoints
echo "[5] VPC Endpoints"
echo "=================================================="

VPC_ENDPOINTS=$(aws ec2 describe-vpc-endpoints \
    --filters "Name=vpc-id,Values=$VPC_ID" \
    --region "$REGION" \
    --query 'VpcEndpoints[*].[ServiceName,State]' \
    --output text 2>&1)

if [ $? -eq 0 ]; then
    if [ -z "$VPC_ENDPOINTS" ]; then
        echo "⚠️  No VPC endpoints found"
        echo "   Consider creating endpoints for:"
        echo "   - com.amazonaws.$REGION.s3 (Gateway)"
        echo "   - com.amazonaws.$REGION.dynamodb (Gateway)"
        echo "   - com.amazonaws.$REGION.logs (Interface)"
        echo "   - com.amazonaws.$REGION.sts (Interface)"
    else
        echo "VPC Endpoints:"
        echo "$VPC_ENDPOINTS" | while read -r line; do
            SERVICE=$(echo "$line" | awk '{print $1}')
            STATE=$(echo "$line" | awk '{print $2}')
            if [ "$STATE" == "available" ]; then
                echo "  ✅ $SERVICE ($STATE)"
            else
                echo "  ⚠️  $SERVICE ($STATE)"
            fi
        done
    fi
else
    echo "❌ Failed to retrieve VPC endpoints"
fi
echo ""

# 6. NAT Gateway
echo "[6] NAT Gateway"
echo "=================================================="

NAT_GW=$(aws ec2 describe-nat-gateways \
    --filter "Name=vpc-id,Values=$VPC_ID" "Name=state,Values=available" \
    --region "$REGION" \
    --query 'NatGateways[*].[NatGatewayId,State,SubnetId]' \
    --output text 2>&1)

if [ $? -eq 0 ] && [ ! -z "$NAT_GW" ]; then
    echo "NAT Gateways:"
    echo "$NAT_GW" | while read -r line; do
        NAT_ID=$(echo "$line" | awk '{print $1}')
        NAT_STATE=$(echo "$line" | awk '{print $2}')
        NAT_SUBNET=$(echo "$line" | awk '{print $3}')
        echo "  ✅ $NAT_ID ($NAT_STATE) in $NAT_SUBNET"
    done
else
    echo "⚠️  No NAT Gateway found"
    echo "   NAT Gateway is required for Lambda to access AWS services"
    echo "   unless VPC endpoints are configured for all services"
fi
echo ""

# 7. Route Tables
echo "[7] Route Tables"
echo "=================================================="

IFS=',' read -ra SUBNET_ARRAY <<< "$SUBNET_IDS"
for SUBNET in "${SUBNET_ARRAY[@]}"; do
    echo "Subnet: $SUBNET"

    RT_ID=$(aws ec2 describe-route-tables \
        --filters "Name=association.subnet-id,Values=$SUBNET" \
        --region "$REGION" \
        --query 'RouteTables[0].RouteTableId' \
        --output text 2>&1)

    if [ $? -eq 0 ] && [ "$RT_ID" != "None" ]; then
        echo "  Route Table: $RT_ID"

        # Check for default route
        DEFAULT_ROUTE=$(aws ec2 describe-route-tables \
            --route-table-ids "$RT_ID" \
            --region "$REGION" \
            --query 'RouteTables[0].Routes[?DestinationCidrBlock==`0.0.0.0/0`].[GatewayId,NatGatewayId]' \
            --output text 2>&1)

        if [ ! -z "$DEFAULT_ROUTE" ]; then
            echo "  ✅ Default route configured: $DEFAULT_ROUTE"
        else
            echo "  ⚠️  No default route found"
        fi
    fi
    echo ""
done

# 8. Lambda IAM Role Permissions
echo "[8] Lambda IAM Role Permissions"
echo "=================================================="

ROLE_NAME=$(echo "$LAMBDA_CONFIG" | grep -o '"Role": "[^"]*"' | cut -d'/' -f2 | cut -d'"' -f1)
echo "Role: $ROLE_NAME"

# Check attached policies
POLICIES=$(aws iam list-attached-role-policies \
    --role-name "$ROLE_NAME" \
    --region "$REGION" \
    --query 'AttachedPolicies[*].PolicyName' \
    --output text 2>&1)

if [ $? -eq 0 ]; then
    echo "Attached Policies:"
    for POLICY in $POLICIES; do
        echo "  - $POLICY"
    done
else
    echo "⚠️  Could not retrieve attached policies"
fi

# Check inline policies
INLINE_POLICIES=$(aws iam list-role-policies \
    --role-name "$ROLE_NAME" \
    --region "$REGION" \
    --query 'PolicyNames' \
    --output text 2>&1)

if [ $? -eq 0 ] && [ ! -z "$INLINE_POLICIES" ]; then
    echo "Inline Policies:"
    for POLICY in $INLINE_POLICIES; do
        echo "  - $POLICY"
    done
fi
echo ""

# 9. Recent Lambda Errors
echo "[9] Recent Lambda Errors"
echo "=================================================="

echo "Checking CloudWatch Logs for recent errors..."
RECENT_ERRORS=$(aws logs filter-log-events \
    --log-group-name "/aws/lambda/$FUNCTION_NAME" \
    --filter-pattern "ERROR" \
    --max-items 5 \
    --region "$REGION" \
    --query 'events[*].message' \
    --output text 2>&1)

if [ $? -eq 0 ]; then
    if [ -z "$RECENT_ERRORS" ]; then
        echo "✅ No recent errors found"
    else
        echo "⚠️  Recent errors:"
        echo "$RECENT_ERRORS"
    fi
else
    echo "⚠️  Could not retrieve logs (log group may not exist yet)"
fi
echo ""

# Summary
echo "=================================================="
echo "Diagnostic Summary"
echo "=================================================="
echo ""
echo "Key Checks:"
echo "  - Lambda function exists: ✅"
echo "  - VPC DNS settings: $DNS_SUPPORT / $DNS_HOSTNAMES"
echo "  - OpenSearch in same VPC: Check section [4]"
echo "  - VPC Endpoints: Check section [5]"
echo "  - NAT Gateway: Check section [6]"
echo ""
echo "Recommendations:"
echo ""

if [ "$DNS_SUPPORT" != "True" ] || [ "$DNS_HOSTNAMES" != "True" ]; then
    echo "❌ Enable VPC DNS support and hostnames"
    echo "   aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-support"
    echo "   aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-hostnames"
    echo ""
fi

if [ -z "$NAT_GW" ]; then
    echo "⚠️  Create NAT Gateway or VPC Endpoints for AWS service access"
    echo ""
fi

echo "Full deployment guide available in:"
echo "  backend/lambda-search-api/VPC_DEPLOYMENT_GUIDE.md"
echo ""
