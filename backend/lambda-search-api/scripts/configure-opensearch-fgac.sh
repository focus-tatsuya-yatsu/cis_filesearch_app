#!/bin/bash

# ============================================================================
# OpenSearch Fine-Grained Access Control Configuration
# ============================================================================
# This script configures OpenSearch FGAC to grant Lambda role search permissions
# ============================================================================

set -e

# Configuration
OPENSEARCH_ENDPOINT="vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
LAMBDA_ROLE_ARN="arn:aws:iam::770923989980:role/cis-lambda-search-api-role"
AWS_REGION="ap-northeast-1"

echo "========================================="
echo "OpenSearch FGAC Configuration"
echo "========================================="
echo ""
echo "This script will configure OpenSearch Fine-Grained Access Control"
echo "to grant the Lambda role (cis-lambda-search-api-role) search permissions."
echo ""
echo "IMPORTANT:"
echo "- OpenSearch Fine-Grained Access Control is enabled"
echo "- You need to configure role mapping via OpenSearch Dashboards"
echo "- OR use AWS SDK to configure programmatically"
echo ""

# Check if OpenSearch endpoint is accessible
echo "Checking OpenSearch endpoint..."
OPENSEARCH_DOMAIN_NAME="cis-filesearch-opensearch"

# Get master user info
echo "Retrieving OpenSearch domain info..."
aws opensearch describe-domain \
    --domain-name "${OPENSEARCH_DOMAIN_NAME}" \
    --query 'DomainStatus.AdvancedSecurityOptions' \
    --output json

echo ""
echo "========================================="
echo "Configuration Steps Required"
echo "========================================="
echo ""
echo "Since Fine-Grained Access Control is enabled, you need to:"
echo ""
echo "Option 1: Using OpenSearch Dashboards (Recommended)"
echo "------------------------------------------------------"
echo "1. Access OpenSearch Dashboards (requires VPN/bastion host)"
echo "2. Navigate to: Security → Roles"
echo "3. Edit the 'all_access' or 'readall' role"
echo "4. Add backend role mapping:"
echo "   - Backend role: ${LAMBDA_ROLE_ARN}"
echo ""
echo "Option 2: Using AWS CLI with signed requests"
echo "------------------------------------------------------"
echo "Execute the following commands:"
echo ""

cat <<'EOF'
# Install required packages
pip install requests-aws4auth

# Create Python script to add role mapping
cat > /tmp/add_role_mapping.py <<'PYTHON'
import boto3
import requests
from requests_aws4auth import AWS4Auth

# AWS credentials
region = 'ap-northeast-1'
service = 'es'
credentials = boto3.Session().get_credentials()
awsauth = AWS4Auth(credentials.access_key, credentials.secret_key, region, service, session_token=credentials.token)

# OpenSearch endpoint
host = 'https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com'
path = '/_plugins/_security/api/rolesmapping/all_access'

# Lambda role ARN
lambda_role = 'arn:aws:iam::770923989980:role/cis-lambda-search-api-role'

# Get current role mapping
url = host + path
response = requests.get(url, auth=awsauth, headers={'Content-Type': 'application/json'})
print(f"Current mapping: {response.status_code}")
print(response.text)

# Update role mapping
mapping = {
    "backend_roles": [
        lambda_role
    ],
    "hosts": [],
    "users": []
}

response = requests.put(url, auth=awsauth, json=mapping, headers={'Content-Type': 'application/json'})
print(f"\nUpdate result: {response.status_code}")
print(response.text)

if response.status_code == 200 or response.status_code == 201:
    print("\n✓ Role mapping updated successfully!")
else:
    print("\n✗ Failed to update role mapping")
PYTHON

# Run the script
python3 /tmp/add_role_mapping.py
EOF

echo ""
echo "Option 3: Disable Fine-Grained Access Control (NOT RECOMMENDED)"
echo "--------------------------------------------------------------"
echo "This would require updating the domain configuration and is"
echo "not recommended for production environments."
echo ""
echo "========================================="
echo "Temporary Workaround"
echo "========================================="
echo ""
echo "To quickly test the API, you can create a temporary Python script"
echo "that uses signed requests to add the role mapping."
echo ""

# Create Python script for role mapping
cat > /tmp/configure_opensearch_role.py <<'PYTHON'
#!/usr/bin/env python3
import boto3
import json
import sys

try:
    from requests_aws4auth import AWS4Auth
    import requests
except ImportError:
    print("ERROR: Required packages not installed")
    print("Please run: pip install requests-aws4auth requests")
    sys.exit(1)

# Configuration
region = 'ap-northeast-1'
service = 'es'
host = 'https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com'
lambda_role = 'arn:aws:iam::770923989980:role/cis-lambda-search-api-role'

# Get AWS credentials
session = boto3.Session()
credentials = session.get_credentials()
awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    region,
    service,
    session_token=credentials.token
)

print("=" * 60)
print("OpenSearch Role Mapping Configuration")
print("=" * 60)
print(f"\nEndpoint: {host}")
print(f"Lambda Role: {lambda_role}\n")

# Create role mapping for all_access role
path = '/_plugins/_security/api/rolesmapping/all_access'
url = host + path

print("Fetching current role mapping...")
response = requests.get(url, auth=awsauth)
print(f"Status: {response.status_code}")

if response.status_code == 200:
    current_mapping = response.json()
    print(f"Current mapping: {json.dumps(current_mapping, indent=2)}\n")

    # Add Lambda role to backend_roles
    all_access_config = current_mapping.get('all_access', {})
    backend_roles = all_access_config.get('backend_roles', [])

    if lambda_role not in backend_roles:
        backend_roles.append(lambda_role)
        print(f"Adding Lambda role to backend_roles...")

        # Update mapping
        mapping = {
            "backend_roles": backend_roles,
            "hosts": all_access_config.get('hosts', []),
            "users": all_access_config.get('users', [])
        }

        response = requests.put(url, auth=awsauth, json=mapping)
        print(f"Update status: {response.status_code}")
        print(f"Response: {response.text}\n")

        if response.status_code in [200, 201]:
            print("✓ Successfully added Lambda role to all_access mapping!")
        else:
            print("✗ Failed to update role mapping")
            sys.exit(1)
    else:
        print("✓ Lambda role already in backend_roles")
else:
    print(f"✗ Failed to fetch current mapping: {response.text}")
    sys.exit(1)

# Verify the update
print("\nVerifying role mapping...")
response = requests.get(url, auth=awsauth)
if response.status_code == 200:
    updated_mapping = response.json()
    print(f"Updated mapping: {json.dumps(updated_mapping, indent=2)}")
    print("\n✓ Configuration complete!")
else:
    print(f"✗ Failed to verify: {response.text}")

print("\n" + "=" * 60)
print("Next step: Test the API endpoint")
print("=" * 60)
print("\ncurl -X GET 'https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search?q=test&limit=5'\n")

PYTHON

chmod +x /tmp/configure_opensearch_role.py

echo "Created Python configuration script: /tmp/configure_opensearch_role.py"
echo ""
echo "To configure OpenSearch FGAC, run:"
echo ""
echo "  python3 /tmp/configure_opensearch_role.py"
echo ""
echo "This will add the Lambda role to the 'all_access' role mapping."
echo ""
