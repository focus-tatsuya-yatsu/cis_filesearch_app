#!/bin/bash

#############################################################################
# OpenSearch k-NN Search Testing Script for EC2
#
# Tests k-NN vector similarity search functionality.
# Generates a random query vector and finds similar documents.
#
# Usage:
#   ./ec2-test-knn-search.sh [k_value]
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
INDEX_NAME="cis-files"
REGION="ap-northeast-1"
K_VALUE="${1:-5}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}OpenSearch k-NN Search Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}Index Name:${NC} ${INDEX_NAME}"
echo -e "${GREEN}k (number of results):${NC} ${K_VALUE}"
echo ""

# Generate random query vector
echo -e "${YELLOW}Generating random query vector (512 dimensions)...${NC}"
QUERY_VECTOR=$(python3 -c "import random; print('[' + ','.join([str(random.uniform(-1, 1)) for _ in range(512)]) + ']')")
echo -e "${GREEN}✓ Query vector generated${NC}"
echo ""

# Create k-NN search query
SEARCH_QUERY=$(cat <<EOF
{
  "size": ${K_VALUE},
  "query": {
    "knn": {
      "image_embedding": {
        "vector": ${QUERY_VECTOR},
        "k": ${K_VALUE}
      }
    }
  },
  "_source": ["file_name", "file_path", "file_extension", "file_size", "modified_date"]
}
EOF
)

# Execute k-NN search
echo -e "${YELLOW}Executing k-NN search...${NC}"
START_TIME=$(date +%s%3N)

SEARCH_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_search" \
    -H "Content-Type: application/json" \
    --aws-sigv4 "aws:amz:${REGION}:es" \
    --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
    -d "$SEARCH_QUERY")

END_TIME=$(date +%s%3N)
ELAPSED=$((END_TIME - START_TIME))

HTTP_CODE=$(echo "$SEARCH_RESPONSE" | tail -n1)
RESPONSE=$(echo "$SEARCH_RESPONSE" | head -n-1)

if [ "$HTTP_CODE" != "200" ]; then
    echo -e "${RED}✗ Search failed (HTTP ${HTTP_CODE})${NC}"
    echo -e "${RED}Response:${NC}"
    echo "$RESPONSE" | jq '.'
    exit 1
fi

echo -e "${GREEN}✓ Search completed in ${ELAPSED}ms${NC}"
echo ""

# Parse and display results
TOTAL_HITS=$(echo "$RESPONSE" | jq '.hits.total.value')
TOOK=$(echo "$RESPONSE" | jq '.took')

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Search Results${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}Total Hits:${NC} ${TOTAL_HITS}"
echo -e "${GREEN}Query Time:${NC} ${TOOK}ms"
echo -e "${GREEN}Total Time:${NC} ${ELAPSED}ms"
echo ""

if [ "$TOTAL_HITS" -gt 0 ]; then
    echo -e "${YELLOW}Top ${K_VALUE} Similar Documents:${NC}"
    echo ""

    echo "$RESPONSE" | jq -r '.hits.hits[] |
        "  [\(.["_score"] | tonumber | . * 100 | round / 100)] \(._source.file_name)\n" +
        "    Path: \(._source.file_path)\n" +
        "    Type: \(._source.file_extension) | Size: \(._source.file_size) bytes\n" +
        "    Modified: \(._source.modified_date)\n"'
else
    echo -e "${YELLOW}No documents found${NC}"
    echo ""
    echo -e "${RED}Possible issues:${NC}"
    echo -e "  - Index is empty (run ./ec2-index-sample-data.sh)"
    echo -e "  - Documents don't have image_embedding field"
    echo -e "  - k-NN is not properly configured"
fi
echo ""

# Additional test: combined text + k-NN search
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Hybrid Search Test (Text + k-NN)${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

HYBRID_QUERY=$(cat <<EOF
{
  "size": ${K_VALUE},
  "query": {
    "bool": {
      "must": [
        {
          "match": {
            "file_extension": "jpg"
          }
        }
      ],
      "should": [
        {
          "knn": {
            "image_embedding": {
              "vector": ${QUERY_VECTOR},
              "k": ${K_VALUE}
            }
          }
        }
      ]
    }
  },
  "_source": ["file_name", "file_path", "file_extension"]
}
EOF
)

echo -e "${YELLOW}Executing hybrid search (file_extension=jpg + k-NN)...${NC}"
HYBRID_RESPONSE=$(curl -s -X POST \
    "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_search" \
    -H "Content-Type: application/json" \
    --aws-sigv4 "aws:amz:${REGION}:es" \
    --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
    -d "$HYBRID_QUERY")

HYBRID_HITS=$(echo "$HYBRID_RESPONSE" | jq '.hits.total.value')
echo -e "${GREEN}Hybrid search results:${NC} ${HYBRID_HITS} documents"
echo ""

if [ "$HYBRID_HITS" -gt 0 ]; then
    echo "$HYBRID_RESPONSE" | jq -r '.hits.hits[] |
        "  [\(.["_score"] | tonumber | . * 100 | round / 100)] \(._source.file_name) (\(._source.file_extension))"'
fi
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}k-NN Search Test Complete${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${YELLOW}Performance Notes:${NC}"
echo -e "  - Query time should be < 100ms for good performance"
echo -e "  - Scores closer to 0 indicate higher similarity (L2 distance)"
echo -e "  - Adjust k value to retrieve more/fewer results"
