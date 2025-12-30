#!/bin/bash

#############################################################################
# OpenSearch Sample Data Indexing Script for EC2
#
# Indexes sample documents with k-NN vectors for testing image search.
# Generates random 512-dimensional vectors for demonstration.
#
# Usage:
#   ./ec2-index-sample-data.sh [number_of_samples]
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
NUM_SAMPLES="${1:-10}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}OpenSearch Sample Data Indexing${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}Index Name:${NC} ${INDEX_NAME}"
echo -e "${GREEN}Number of Samples:${NC} ${NUM_SAMPLES}"
echo ""

# Function to generate random 512-dimensional vector
generate_random_vector() {
    python3 -c "import random; print('[' + ','.join([str(random.uniform(-1, 1)) for _ in range(512)]) + ']')"
}

# Function to index a document
index_document() {
    local doc_id=$1
    local file_name=$2
    local file_path=$3
    local file_extension=$4

    echo -e "${YELLOW}Indexing document ${doc_id}/${NUM_SAMPLES}: ${file_name}${NC}"

    # Generate random embedding
    EMBEDDING=$(generate_random_vector)

    # Create document
    DOC=$(cat <<EOF
{
  "file_name": "${file_name}",
  "file_path": "${file_path}",
  "file_extension": "${file_extension}",
  "file_size": $((RANDOM * 1000)),
  "modified_date": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "created_date": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "content": "Sample content for ${file_name}",
  "image_embedding": ${EMBEDDING},
  "metadata": {
    "sample": true,
    "batch_id": "$(date +%s)"
  },
  "indexed_date": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
)

    # Index document
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
        "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_doc/${doc_id}" \
        -H "Content-Type: application/json" \
        --aws-sigv4 "aws:amz:${REGION}:es" \
        --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
        -d "$DOC")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

    if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}  ✓ Indexed successfully${NC}"
        return 0
    else
        echo -e "${RED}  ✗ Failed (HTTP ${HTTP_CODE})${NC}"
        echo "$RESPONSE" | head -n-1
        return 1
    fi
}

# Sample file data
declare -a FILE_TYPES=("jpg" "png" "pdf" "docx" "xlsx" "pptx")
declare -a DIRECTORIES=("/home/user/Documents" "/home/user/Pictures" "/home/user/Projects" "/shared/files")

# Index sample documents
SUCCESSFUL=0
FAILED=0

for i in $(seq 1 $NUM_SAMPLES); do
    # Random file type and directory
    FILE_EXT="${FILE_TYPES[$RANDOM % ${#FILE_TYPES[@]}]}"
    DIR="${DIRECTORIES[$RANDOM % ${#DIRECTORIES[@]}]}"
    FILE_NAME="sample_file_${i}.${FILE_EXT}"
    FILE_PATH="${DIR}/${FILE_NAME}"

    if index_document "$i" "$FILE_NAME" "$FILE_PATH" "$FILE_EXT"; then
        ((SUCCESSFUL++))
    else
        ((FAILED++))
    fi

    # Small delay to avoid overwhelming the cluster
    sleep 0.2
done

echo ""
echo -e "${BLUE}Waiting for index refresh (30s)...${NC}"
sleep 5

# Refresh index to make documents searchable immediately
echo -e "${YELLOW}Refreshing index...${NC}"
curl -s -X POST \
    "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_refresh" \
    --aws-sigv4 "aws:amz:${REGION}:es" \
    --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
    > /dev/null

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Indexing Complete${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Results:${NC}"
echo -e "  Successful: ${GREEN}${SUCCESSFUL}${NC}"
echo -e "  Failed: ${RED}${FAILED}${NC}"
echo ""

# Verify document count
echo -e "${YELLOW}Verifying document count...${NC}"
COUNT_RESPONSE=$(curl -s -X GET \
    "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_count" \
    --aws-sigv4 "aws:amz:${REGION}:es" \
    --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)")

TOTAL_DOCS=$(echo "$COUNT_RESPONSE" | jq '.count')
echo -e "${BLUE}Total documents in index:${NC} ${TOTAL_DOCS}"
echo ""

echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Verify index: ./ec2-verify-index.sh"
echo -e "  2. Test k-NN search: ./ec2-test-knn-search.sh"
