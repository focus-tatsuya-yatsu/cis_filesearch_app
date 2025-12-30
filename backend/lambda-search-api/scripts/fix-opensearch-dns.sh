#!/bin/bash

# ============================================================================
# Fix OpenSearch DNS Resolution Issue
# ============================================================================
# This script provides comprehensive troubleshooting and fixes for the
# DNS resolution issue between Lambda and OpenSearch VPC endpoint.
# ============================================================================

set -e

# Configuration
REGION="ap-northeast-1"
DOMAIN_NAME="cis-filesearch-opensearch"
LAMBDA_FUNCTION="cis-search-api-prod"
VPC_ID="vpc-02d08f2fa75078e67"

echo "============================================================================"
echo "OpenSearch DNS Resolution Troubleshooting & Fix"
echo "============================================================================"
echo ""

# Step 1: Get OpenSearch Endpoint
echo "Step 1: Getting OpenSearch Endpoint Information"
echo "-----------------------------------------------"
OPENSEARCH_ENDPOINT=$(aws opensearch describe-domain \
    --domain-name ${DOMAIN_NAME} \
    --region ${REGION} \
    --query 'DomainStatus.Endpoints.vpc' \
    --output text)

echo "OpenSearch VPC Endpoint: ${OPENSEARCH_ENDPOINT}"
echo ""

# Step 2: Get OpenSearch Private IP Address
echo "Step 2: Getting OpenSearch Private IP Address"
echo "---------------------------------------------"
OPENSEARCH_IP=$(aws ec2 describe-network-interfaces \
    --filters "Name=vpc-id,Values=${VPC_ID}" "Name=description,Values=ES ${DOMAIN_NAME}" \
    --region ${REGION} \
    --query 'NetworkInterfaces[?Status==`in-use`].PrivateIpAddress | [0]' \
    --output text)

echo "OpenSearch Private IP: ${OPENSEARCH_IP}"
echo ""

if [ -z "$OPENSEARCH_IP" ] || [ "$OPENSEARCH_IP" == "None" ]; then
    echo "✗ ERROR: Could not find OpenSearch network interface"
    exit 1
fi

# Step 3: Test DNS Resolution from Lambda
echo "Step 3: Testing DNS Resolution"
echo "--------------------------------"
echo "Creating test Lambda function to check DNS resolution..."

# Create a test event to check DNS
cat > /tmp/test-dns-event.json << EOF
{
  "test": "dns-resolution",
  "hostname": "${OPENSEARCH_ENDPOINT}"
}
EOF

# Create a simple Node.js script to test DNS
cat > /tmp/test-dns.js << 'EOFJS'
const dns = require('dns');
const util = require('util');
const lookup = util.promisify(dns.lookup);
const resolve = util.promisify(dns.resolve);

exports.handler = async (event) => {
  const hostname = event.hostname;
  const results = {
    hostname: hostname,
    tests: {}
  };

  try {
    const addr = await lookup(hostname);
    results.tests.lookup = { success: true, address: addr };
  } catch (error) {
    results.tests.lookup = { success: false, error: error.message };
  }

  try {
    const addresses = await resolve(hostname);
    results.tests.resolve = { success: true, addresses: addresses };
  } catch (error) {
    results.tests.resolve = { success: false, error: error.message };
  }

  return results;
};
EOFJS

echo "DNS test script created at /tmp/test-dns.js"
echo ""

# Step 4: Check VPC DNS Settings
echo "Step 4: Checking VPC DNS Settings"
echo "----------------------------------"
DNS_SUPPORT=$(aws ec2 describe-vpc-attribute \
    --vpc-id ${VPC_ID} \
    --attribute enableDnsSupport \
    --region ${REGION} \
    --query 'EnableDnsSupport.Value' \
    --output text)

DNS_HOSTNAMES=$(aws ec2 describe-vpc-attribute \
    --vpc-id ${VPC_ID} \
    --attribute enableDnsHostnames \
    --region ${REGION} \
    --query 'EnableDnsHostnames.Value' \
    --output text)

echo "DNS Support:    ${DNS_SUPPORT}"
echo "DNS Hostnames:  ${DNS_HOSTNAMES}"

if [ "$DNS_SUPPORT" != "true" ] || [ "$DNS_HOSTNAMES" != "true" ]; then
    echo ""
    echo "⚠ WARNING: VPC DNS settings are not optimal"
    echo ""
    echo "To fix, run:"
    echo "  aws ec2 modify-vpc-attribute --vpc-id ${VPC_ID} --enable-dns-support"
    echo "  aws ec2 modify-vpc-attribute --vpc-id ${VPC_ID} --enable-dns-hostnames"
fi

echo ""

# Step 5: Check Route 53 Private Hosted Zones
echo "Step 5: Checking Route 53 Private Hosted Zones"
echo "-----------------------------------------------"
HOSTED_ZONES=$(aws route53 list-hosted-zones-by-vpc \
    --vpc-id ${VPC_ID} \
    --vpc-region ${REGION} \
    --region ${REGION} \
    --output json 2>&1)

echo "$HOSTED_ZONES" | jq '.HostedZoneSummaries[] | {Name, Id}'

if echo "$HOSTED_ZONES" | jq -e '.HostedZoneSummaries | length == 0' > /dev/null; then
    echo ""
    echo "⚠ WARNING: No private hosted zones found for this VPC"
    echo "This might explain the DNS resolution issue."
fi

echo ""

# Step 6: Proposed Solution - Update Lambda Environment Variables
echo "Step 6: Proposed Solution - Direct IP Access"
echo "---------------------------------------------"
echo ""
echo "Since DNS resolution is problematic, we can configure Lambda to use"
echo "the direct IP address of the OpenSearch endpoint."
echo ""
echo "However, this approach has a limitation: HTTPS certificate validation"
echo "will fail because the certificate is issued for the hostname, not the IP."
echo ""
echo "Better solution: Ensure OpenSearch DNS resolution works correctly."
echo ""

# Step 7: Check if OpenSearch is accessible
echo "Step 7: Testing OpenSearch Accessibility"
echo "-----------------------------------------"
echo ""
echo "Attempting to connect to OpenSearch from Lambda..."
echo ""

# Create a test event with credentials
TEST_EVENT=$(cat << EOF
{
  "queryStringParameters": {
    "q": "test",
    "limit": "1"
  },
  "requestContext": {
    "requestId": "test-dns-fix-script"
  }
}
EOF
)

# Invoke Lambda
LAMBDA_RESPONSE=$(aws lambda invoke \
    --function-name ${LAMBDA_FUNCTION} \
    --payload "$TEST_EVENT" \
    --region ${REGION} \
    --query 'StatusCode' \
    --output text \
    /tmp/lambda-test-response.json 2>&1)

echo "Lambda Status Code: ${LAMBDA_RESPONSE}"

if [ -f /tmp/lambda-test-response.json ]; then
    echo ""
    echo "Lambda Response:"
    cat /tmp/lambda-test-response.json | jq '.'

    ERROR_MSG=$(cat /tmp/lambda-test-response.json | jq -r '.errorMessage // empty')

    if echo "$ERROR_MSG" | grep -q "ENOTFOUND"; then
        echo ""
        echo "✗ DNS resolution is still failing"
        echo ""
        echo "============================================================================"
        echo "RECOMMENDED FIX: Enable Private DNS for OpenSearch"
        echo "============================================================================"
        echo ""
        echo "The issue is that OpenSearch VPC endpoint DNS is not resolving."
        echo "This is likely because the private DNS is not properly configured."
        echo ""
        echo "Solution: Create Route 53 Private Hosted Zone Entry"
        echo ""
        echo "1. Find the OpenSearch ENI private IP:"
        echo "   ${OPENSEARCH_IP}"
        echo ""
        echo "2. Create Route 53 private hosted zone for ap-northeast-1.es.amazonaws.com"
        echo ""
        echo "3. Add A record:"
        echo "   Name: vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe"
        echo "   Type: A"
        echo "   Value: ${OPENSEARCH_IP}"
        echo ""
        echo "OR use AWS CLI:"
        echo ""
        echo "aws route53 create-hosted-zone \\"
        echo "  --name ap-northeast-1.es.amazonaws.com \\"
        echo "  --vpc VPCRegion=${REGION},VPCId=${VPC_ID} \\"
        echo "  --caller-reference opensearch-vpc-\$(date +%s) \\"
        echo "  --hosted-zone-config Comment='Private hosted zone for OpenSearch VPC endpoint'"
        echo ""
        echo "============================================================================"
    elif echo "$ERROR_MSG" | grep -q "security_exception"; then
        echo ""
        echo "✓ DNS resolution is working!"
        echo "✗ But OpenSearch FGAC permissions are missing"
        echo ""
        echo "Run: ./configure-opensearch-access.sh"
    else
        echo ""
        echo "✓ DNS resolution appears to be working"
        echo "Check the error message above for other issues"
    fi

    rm /tmp/lambda-test-response.json
fi

echo ""
echo "============================================================================"
echo "Summary"
echo "============================================================================"
echo "OpenSearch Endpoint:  ${OPENSEARCH_ENDPOINT}"
echo "Private IP Address:   ${OPENSEARCH_IP}"
echo "VPC DNS Support:      ${DNS_SUPPORT}"
echo "VPC DNS Hostnames:    ${DNS_HOSTNAMES}"
echo ""
echo "Next steps:"
echo "1. If DNS resolution fails, create Route 53 private hosted zone (see above)"
echo "2. If security_exception, configure OpenSearch FGAC role mappings"
echo "3. Verify Lambda IAM role has es:* permissions"
echo "4. Test again with: ./verify-vpc-endpoint.sh"
echo "============================================================================"
