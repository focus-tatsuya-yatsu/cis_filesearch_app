#!/bin/bash

# ============================================================================
# Create Route 53 Private Hosted Zone for OpenSearch
# ============================================================================
# This script creates a Route 53 private hosted zone and adds an A record
# for the OpenSearch VPC endpoint to enable DNS resolution.
# ============================================================================

set -e

# Configuration
REGION="ap-northeast-1"
VPC_ID="vpc-02d08f2fa75078e67"
OPENSEARCH_ENDPOINT="vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
OPENSEARCH_IP="10.0.10.145"
DOMAIN_ZONE="ap-northeast-1.es.amazonaws.com"
RECORD_NAME="vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"

echo "============================================================================"
echo "Creating Route 53 Private Hosted Zone for OpenSearch"
echo "============================================================================"
echo ""
echo "Configuration:"
echo "  VPC ID:              ${VPC_ID}"
echo "  Region:              ${REGION}"
echo "  Zone Name:           ${DOMAIN_ZONE}"
echo "  Record Name:         ${RECORD_NAME}"
echo "  OpenSearch IP:       ${OPENSEARCH_IP}"
echo ""

# Step 1: Check if hosted zone already exists
echo "Step 1: Checking for existing private hosted zone"
echo "-------------------------------------------------"
EXISTING_ZONE=$(aws route53 list-hosted-zones-by-vpc \
    --vpc-id ${VPC_ID} \
    --vpc-region ${REGION} \
    --region ${REGION} \
    --query "HostedZoneSummaries[?Name=='${DOMAIN_ZONE}.'].HostedZoneId | [0]" \
    --output text 2>&1)

if [ "$EXISTING_ZONE" != "None" ] && [ -n "$EXISTING_ZONE" ]; then
    echo "✓ Private hosted zone already exists: ${EXISTING_ZONE}"
    HOSTED_ZONE_ID=$(echo "${EXISTING_ZONE}" | sed 's|/hostedzone/||')
else
    echo "No existing zone found. Creating new private hosted zone..."
    echo ""

    # Step 2: Create private hosted zone
    echo "Step 2: Creating private hosted zone"
    echo "-------------------------------------"

    CALLER_REF="opensearch-vpc-$(date +%s)"

    CREATE_ZONE_RESPONSE=$(aws route53 create-hosted-zone \
        --name ${DOMAIN_ZONE} \
        --vpc VPCRegion=${REGION},VPCId=${VPC_ID} \
        --caller-reference ${CALLER_REF} \
        --hosted-zone-config Comment="Private hosted zone for OpenSearch VPC endpoint in ${VPC_ID}" \
        --region ${REGION} \
        --output json 2>&1)

    HOSTED_ZONE_ID=$(echo "$CREATE_ZONE_RESPONSE" | jq -r '.HostedZone.Id' | sed 's|/hostedzone/||')

    if [ -z "$HOSTED_ZONE_ID" ] || [ "$HOSTED_ZONE_ID" == "null" ]; then
        echo "✗ ERROR: Failed to create hosted zone"
        echo "$CREATE_ZONE_RESPONSE"
        exit 1
    fi

    echo "✓ Private hosted zone created: ${HOSTED_ZONE_ID}"
fi

echo ""

# Step 3: Create A record for OpenSearch endpoint
echo "Step 3: Creating A record for OpenSearch endpoint"
echo "--------------------------------------------------"

# Check if record already exists
EXISTING_RECORD=$(aws route53 list-resource-record-sets \
    --hosted-zone-id ${HOSTED_ZONE_ID} \
    --query "ResourceRecordSets[?Name=='${RECORD_NAME}.'].Name | [0]" \
    --output text 2>&1)

if [ "$EXISTING_RECORD" != "None" ] && [ -n "$EXISTING_RECORD" ]; then
    echo "⚠ Record already exists. Updating..."
    CHANGE_ACTION="UPSERT"
else
    echo "Creating new A record..."
    CHANGE_ACTION="CREATE"
fi

# Create change batch
cat > /tmp/route53-change-batch.json << EOF
{
  "Changes": [
    {
      "Action": "${CHANGE_ACTION}",
      "ResourceRecordSet": {
        "Name": "${RECORD_NAME}",
        "Type": "A",
        "TTL": 300,
        "ResourceRecords": [
          {
            "Value": "${OPENSEARCH_IP}"
          }
        ]
      }
    }
  ]
}
EOF

echo "Change batch created:"
cat /tmp/route53-change-batch.json | jq '.'
echo ""

# Apply change
CHANGE_INFO=$(aws route53 change-resource-record-sets \
    --hosted-zone-id ${HOSTED_ZONE_ID} \
    --change-batch file:///tmp/route53-change-batch.json \
    --output json 2>&1)

CHANGE_ID=$(echo "$CHANGE_INFO" | jq -r '.ChangeInfo.Id' | sed 's|/change/||')

if [ -z "$CHANGE_ID" ] || [ "$CHANGE_ID" == "null" ]; then
    echo "✗ ERROR: Failed to create A record"
    echo "$CHANGE_INFO"
    exit 1
fi

echo "✓ A record created/updated successfully"
echo "Change ID: ${CHANGE_ID}"
echo ""

# Step 4: Wait for change to propagate
echo "Step 4: Waiting for DNS change to propagate"
echo "--------------------------------------------"
echo "This may take up to 60 seconds..."

aws route53 wait resource-record-sets-changed --id ${CHANGE_ID}

echo "✓ DNS change propagated successfully"
echo ""

# Step 5: Verify the record
echo "Step 5: Verifying DNS record"
echo "-----------------------------"
aws route53 list-resource-record-sets \
    --hosted-zone-id ${HOSTED_ZONE_ID} \
    --query "ResourceRecordSets[?Name=='${RECORD_NAME}.']" \
    --output json | jq '.'

echo ""

# Clean up
rm -f /tmp/route53-change-batch.json

echo "============================================================================"
echo "DNS Configuration Complete!"
echo "============================================================================"
echo ""
echo "Hosted Zone ID:  ${HOSTED_ZONE_ID}"
echo "Record Name:     ${RECORD_NAME}"
echo "Record Type:     A"
echo "Record Value:    ${OPENSEARCH_IP}"
echo "TTL:             300 seconds"
echo ""
echo "============================================================================"
echo "Next Steps:"
echo "============================================================================"
echo ""
echo "1. Wait 1-2 minutes for DNS propagation within the VPC"
echo ""
echo "2. Test Lambda function:"
echo "   aws lambda invoke \\"
echo "     --function-name cis-search-api-prod \\"
echo "     --payload '{\"queryStringParameters\":{\"q\":\"test\",\"limit\":\"5\"}}' \\"
echo "     /tmp/lambda-response.json"
echo ""
echo "3. Check CloudWatch Logs:"
echo "   aws logs tail /aws/lambda/cis-search-api-prod --follow"
echo ""
echo "4. Test API endpoint:"
echo "   curl \"https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search?q=test&limit=5\""
echo ""
echo "5. If DNS resolution still fails, check:"
echo "   - VPC DNS settings (enableDnsSupport and enableDnsHostnames must be true)"
echo "   - Lambda function is in the correct VPC and subnets"
echo "   - Security group allows outbound HTTPS (port 443)"
echo ""
echo "============================================================================"
