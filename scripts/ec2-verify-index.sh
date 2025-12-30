#!/bin/bash

#############################################################################
# OpenSearch Index Verification Script for EC2
#
# Verifies that the OpenSearch index was created successfully and checks
# its configuration, mapping, and stats.
#
# Usage:
#   ./ec2-verify-index.sh [index_name]
#
#############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
INDEX_NAME="${1:-cis-files}"
REGION="ap-northeast-1"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}OpenSearch Index Verification${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}Index Name:${NC} ${INDEX_NAME}"
echo ""

# Function to make signed requests
make_request() {
    local method=$1
    local path=$2

    curl -s -X "$method" \
        "${OPENSEARCH_ENDPOINT}${path}" \
        -H "Content-Type: application/json" \
        --aws-sigv4 "aws:amz:${REGION}:es" \
        --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)"
}

# 1. Check cluster health
echo -e "${YELLOW}[1/6] Cluster Health${NC}"
HEALTH=$(make_request GET "/_cluster/health")
echo "$HEALTH" | jq '{
  status: .status,
  number_of_nodes: .number_of_nodes,
  active_shards: .active_shards,
  unassigned_shards: .unassigned_shards
}'
echo ""

# 2. Check if index exists
echo -e "${YELLOW}[2/6] Index Existence${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}" \
    --aws-sigv4 "aws:amz:${REGION}:es" \
    --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)")

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Index exists${NC}"
else
    echo -e "${RED}✗ Index does not exist (HTTP ${HTTP_CODE})${NC}"
    exit 1
fi
echo ""

# 3. Get index settings
echo -e "${YELLOW}[3/6] Index Settings${NC}"
SETTINGS=$(make_request GET "/${INDEX_NAME}/_settings")
echo "$SETTINGS" | jq ".[\"${INDEX_NAME}\"].settings.index | {
  knn: .knn,
  number_of_shards: .number_of_shards,
  number_of_replicas: .number_of_replicas,
  refresh_interval: .refresh_interval
}"
echo ""

# 4. Get index mapping
echo -e "${YELLOW}[4/6] Index Mapping (k-NN Vector Field)${NC}"
MAPPING=$(make_request GET "/${INDEX_NAME}/_mapping")
echo "$MAPPING" | jq ".[\"${INDEX_NAME}\"].mappings.properties.image_embedding"
echo ""

# 5. Get index stats
echo -e "${YELLOW}[5/6] Index Statistics${NC}"
STATS=$(make_request GET "/${INDEX_NAME}/_stats")
echo "$STATS" | jq ".indices[\"${INDEX_NAME}\"] | {
  total_docs: .total.docs.count,
  deleted_docs: .total.docs.deleted,
  store_size: .total.store.size_in_bytes,
  segments: .total.segments.count
}"
echo ""

# 6. Sample documents
echo -e "${YELLOW}[6/6] Sample Documents (first 3)${NC}"
SAMPLE=$(make_request GET "/${INDEX_NAME}/_search?size=3&pretty")

DOC_COUNT=$(echo "$SAMPLE" | jq '.hits.total.value')
echo -e "${BLUE}Total documents:${NC} ${DOC_COUNT}"
echo ""

if [ "$DOC_COUNT" -gt 0 ]; then
    echo "$SAMPLE" | jq '.hits.hits[] | {
      id: ._id,
      file_name: ._source.file_name,
      file_path: ._source.file_path,
      has_embedding: (._source.image_embedding != null),
      embedding_length: (._source.image_embedding | length)
    }'
else
    echo -e "${YELLOW}No documents indexed yet${NC}"
fi
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Verification Complete${NC}"
echo -e "${GREEN}========================================${NC}"
