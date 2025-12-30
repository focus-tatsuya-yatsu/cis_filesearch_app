#!/bin/bash
################################################################################
# OpenSearch Connection Test Script
# Purpose: Quick test of OpenSearch connectivity
# Usage: ./test-opensearch-connection.sh
################################################################################

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
OPENSEARCH_HOST="vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"

echo "OpenSearch Connection Test"
echo "==========================="

# Test 1: DNS Resolution
echo -e "\n[1/4] DNS Resolution..."
if nslookup $OPENSEARCH_HOST > /dev/null 2>&1; then
  RESOLVED_IP=$(nslookup $OPENSEARCH_HOST | grep -A1 "Name:" | tail -1 | awk '{print $2}')
  echo -e "${GREEN}✓ DNS OK${NC} - Resolved to: $RESOLVED_IP"
else
  echo -e "${RED}✗ DNS Failed${NC}"
  exit 1
fi

# Test 2: TCP Connection
echo -e "\n[2/4] TCP Connection (Port 443)..."
if timeout 5 bash -c "exec 3<>/dev/tcp/$OPENSEARCH_HOST/443" 2>/dev/null; then
  echo -e "${GREEN}✓ TCP Connection OK${NC}"
else
  echo -e "${RED}✗ TCP Connection Failed${NC}"
  echo "Cannot establish TCP connection to port 443"
  echo "Check security groups and network ACLs"
  exit 1
fi

# Test 3: HTTPS Request
echo -e "\n[3/4] HTTPS Request..."
RESPONSE=$(curl -s -w "\n%{http_code}" -m 10 "$OPENSEARCH_ENDPOINT/_cluster/health" 2>&1)
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "HTTP Code: $HTTP_CODE"

case $HTTP_CODE in
  200)
    echo -e "${GREEN}✓ HTTPS Request Successful${NC}"
    ;;
  403)
    echo -e "${YELLOW}⚠ HTTPS OK but Access Denied${NC}"
    echo "Network is fine, but IAM permissions need fixing"
    ;;
  000)
    echo -e "${RED}✗ HTTPS Request Failed${NC}"
    echo "Error: $BODY"
    exit 1
    ;;
  *)
    echo -e "${YELLOW}⚠ Unexpected Response${NC}"
    echo "Response: $BODY"
    ;;
esac

# Test 4: Full API Test
echo -e "\n[4/4] OpenSearch API Test..."
if [ "$HTTP_CODE" == "200" ]; then
  # Test cluster info
  CLUSTER_INFO=$(curl -s -m 10 "$OPENSEARCH_ENDPOINT/" 2>/dev/null)
  CLUSTER_NAME=$(echo "$CLUSTER_INFO" | jq -r '.cluster_name // "unknown"' 2>/dev/null)
  VERSION=$(echo "$CLUSTER_INFO" | jq -r '.version.number // "unknown"' 2>/dev/null)

  echo -e "${GREEN}✓ Cluster Name:${NC} $CLUSTER_NAME"
  echo -e "${GREEN}✓ Version:${NC} $VERSION"

  # Test index listing
  INDICES=$(curl -s -m 10 "$OPENSEARCH_ENDPOINT/_cat/indices?format=json" 2>/dev/null)
  INDEX_COUNT=$(echo "$INDICES" | jq 'length' 2>/dev/null || echo "0")
  echo -e "${GREEN}✓ Number of Indices:${NC} $INDEX_COUNT"

  # Test specific index
  FILE_INDEX=$(curl -s -m 10 "$OPENSEARCH_ENDPOINT/files" 2>/dev/null)
  if echo "$FILE_INDEX" | jq -e '.files' > /dev/null 2>&1; then
    DOC_COUNT=$(echo "$FILE_INDEX" | jq -r '.files.primaries.docs.count // "0"')
    echo -e "${GREEN}✓ 'files' index exists with $DOC_COUNT documents${NC}"
  else
    echo -e "${YELLOW}⚠ 'files' index does not exist yet${NC}"
  fi

  echo -e "\n${GREEN}=========================================${NC}"
  echo -e "${GREEN}✓ ALL TESTS PASSED${NC}"
  echo -e "${GREEN}OpenSearch is fully accessible!${NC}"
  echo -e "${GREEN}=========================================${NC}"
  exit 0
elif [ "$HTTP_CODE" == "403" ]; then
  echo -e "${YELLOW}Network connectivity is OK${NC}"
  echo -e "${YELLOW}IAM permissions need to be configured${NC}"
  echo ""
  echo "Run the fix script:"
  echo "  ./fix-opensearch-connectivity.sh"
  exit 2
else
  echo -e "${RED}Connection test failed${NC}"
  echo ""
  echo "Run the diagnostic script:"
  echo "  ./diagnose-opensearch.sh"
  exit 1
fi
