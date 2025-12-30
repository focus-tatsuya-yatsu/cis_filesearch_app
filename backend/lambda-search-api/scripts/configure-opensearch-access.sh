#!/bin/bash

# ============================================================================
# Configure OpenSearch Fine-Grained Access Control (FGAC)
# ============================================================================
# This script adds the Lambda IAM role to OpenSearch's internal user database
# or maps it to the appropriate backend role with necessary permissions.
# ============================================================================

set -e

# Configuration
REGION="ap-northeast-1"
DOMAIN_NAME="cis-filesearch-opensearch"
LAMBDA_ROLE_ARN="arn:aws:iam::770923989980:role/cis-lambda-search-api-role"
OPENSEARCH_ENDPOINT="vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"

echo "============================================================================"
echo "Configuring OpenSearch Fine-Grained Access Control"
echo "============================================================================"
echo ""
echo "Configuration:"
echo "  Region:            ${REGION}"
echo "  Domain:            ${DOMAIN_NAME}"
echo "  Lambda Role:       ${LAMBDA_ROLE_ARN}"
echo "  Endpoint:          ${OPENSEARCH_ENDPOINT}"
echo ""

echo "Current OpenSearch Configuration:"
echo "-----------------------------------"

# Get OpenSearch domain details
aws opensearch describe-domain \
    --domain-name ${DOMAIN_NAME} \
    --region ${REGION} \
    --query 'DomainStatus.{EngineVersion:EngineVersion,AdvancedSecurityEnabled:AdvancedSecurityOptions.Enabled,AnonymousAuth:AdvancedSecurityOptions.AnonymousAuthEnabled,InternalUserDB:AdvancedSecurityOptions.InternalUserDatabaseEnabled}' \
    --output table

echo ""
echo "Access Policy:"
echo "-------------"
aws opensearch describe-domain \
    --domain-name ${DOMAIN_NAME} \
    --region ${REGION} \
    --query 'DomainStatus.AccessPolicies' \
    --output text | jq '.'

echo ""
echo "============================================================================"
echo "IMPORTANT: Manual Steps Required"
echo "============================================================================"
echo ""
echo "OpenSearch Service uses Fine-Grained Access Control (FGAC) which requires"
echo "manual configuration through the OpenSearch Dashboards UI."
echo ""
echo "To grant access to the Lambda function, follow these steps:"
echo ""
echo "1. Access OpenSearch Dashboards:"
echo "   https://${OPENSEARCH_ENDPOINT}/_dashboards"
echo ""
echo "2. Log in with master user credentials"
echo ""
echo "3. Navigate to: Security > Roles"
echo ""
echo "4. Create or edit a role with these permissions:"
echo "   - Cluster permissions: cluster_composite_ops_ro"
echo "   - Index permissions:"
echo "     * Index pattern: file-index"
echo "     * Actions: indices:data/read/*, indices:data/write/*"
echo ""
echo "5. Navigate to: Security > Role Mappings"
echo ""
echo "6. Map the role to the Lambda IAM role:"
echo "   - Backend role: ${LAMBDA_ROLE_ARN}"
echo ""
echo "============================================================================"
echo "Alternative: Update OpenSearch Configuration"
echo "============================================================================"
echo ""
echo "You can also update the domain configuration to disable FGAC"
echo "(not recommended for production):"
echo ""
echo "aws opensearch update-domain-config \\"
echo "  --domain-name ${DOMAIN_NAME} \\"
echo "  --region ${REGION} \\"
echo "  --advanced-security-options '{\"Enabled\":true,\"AnonymousAuthEnabled\":true}'"
echo ""
echo "============================================================================"
echo "Recommended: Use AWS CLI with SigV4 Authentication"
echo "============================================================================"
echo ""
echo "Ensure your Lambda function is using AWS Signature Version 4 for authentication."
echo "The OpenSearch JavaScript client should be configured with AWS SDK credentials."
echo ""
echo "Example client configuration:"
echo ""
cat << 'EOF'
import { Client } from '@opensearch-project/opensearch';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import aws4 from 'aws4';

const client = new Client({
  node: process.env.OPENSEARCH_ENDPOINT,
  ...AwsSigv4Signer({
    region: 'ap-northeast-1',
    service: 'es',
    getCredentials: () => defaultProvider()(),
  }),
});
EOF
echo ""
echo "============================================================================"

# Check if we can access OpenSearch metrics via CloudWatch
echo ""
echo "Checking OpenSearch Metrics (Last 1 hour):"
echo "-------------------------------------------"

# Get cluster health metric
CLUSTER_RED=$(aws cloudwatch get-metric-statistics \
    --namespace "AWS/ES" \
    --metric-name "ClusterStatus.red" \
    --dimensions Name=DomainName,Value=${DOMAIN_NAME} Name=ClientId,Value=770923989980 \
    --start-time $(date -u -v-1H "+%Y-%m-%dT%H:%M:%S") \
    --end-time $(date -u "+%Y-%m-%dT%H:%M:%S") \
    --period 3600 \
    --statistics Maximum \
    --region ${REGION} \
    --query 'Datapoints[0].Maximum' \
    --output text 2>&1)

CLUSTER_YELLOW=$(aws cloudwatch get-metric-statistics \
    --namespace "AWS/ES" \
    --metric-name "ClusterStatus.yellow" \
    --dimensions Name=DomainName,Value=${DOMAIN_NAME} Name=ClientId,Value=770923989980 \
    --start-time $(date -u -v-1H "+%Y-%m-%dT%H:%M:%S") \
    --end-time $(date -u "+%Y-%m-%dT%H:%M:%S") \
    --period 3600 \
    --statistics Maximum \
    --region ${REGION} \
    --query 'Datapoints[0].Maximum' \
    --output text 2>&1)

CLUSTER_GREEN=$(aws cloudwatch get-metric-statistics \
    --namespace "AWS/ES" \
    --metric-name "ClusterStatus.green" \
    --dimensions Name=DomainName,Value=${DOMAIN_NAME} Name=ClientId,Value=770923989980 \
    --start-time $(date -u -v-1H "+%Y-%m-%dT%H:%M:%S") \
    --end-time $(date -u "+%Y-%m-%dT%H:%M:%S") \
    --period 3600 \
    --statistics Maximum \
    --region ${REGION} \
    --query 'Datapoints[0].Maximum' \
    --output text 2>&1)

echo "Cluster Status:"
if [ "$CLUSTER_GREEN" == "1.0" ] || [ "$CLUSTER_GREEN" == "1" ]; then
    echo "  ✓ Green (Healthy)"
elif [ "$CLUSTER_YELLOW" == "1.0" ] || [ "$CLUSTER_YELLOW" == "1" ]; then
    echo "  ⚠ Yellow (Degraded)"
elif [ "$CLUSTER_RED" == "1.0" ] || [ "$CLUSTER_RED" == "1" ]; then
    echo "  ✗ Red (Critical)"
else
    echo "  ? Unknown (No metrics available)"
fi

echo ""
echo "============================================================================"
echo "Next Steps:"
echo "============================================================================"
echo "1. Access OpenSearch Dashboards and configure role mappings"
echo "2. Verify Lambda function has proper IAM permissions for es:* actions"
echo "3. Test Lambda function again after configuration"
echo "4. Run verify-vpc-endpoint.sh to validate connectivity"
echo "============================================================================"
