#!/bin/bash

#############################################################################
# OpenSearch k-NN Index Creation Script for EC2 (VPC Internal Access)
#
# This script creates an OpenSearch k-NN index directly from EC2 instance.
# No SSH tunnel needed - EC2 has direct VPC access to OpenSearch domain.
#
# Usage:
#   ./ec2-create-opensearch-knn-index.sh
#
# Prerequisites:
#   - Run from EC2 instance in same VPC as OpenSearch
#   - AWS credentials configured (IAM role or credentials file)
#   - curl and jq installed
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

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}OpenSearch k-NN Index Creation (EC2)${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}OpenSearch Endpoint:${NC} ${OPENSEARCH_ENDPOINT}"
echo -e "${GREEN}Index Name:${NC} ${INDEX_NAME}"
echo -e "${GREEN}Region:${NC} ${REGION}"
echo ""

# Function to make signed AWS requests
make_signed_request() {
    local method=$1
    local path=$2
    local data=$3

    if [ -n "$data" ]; then
        curl -s -X "$method" \
            "${OPENSEARCH_ENDPOINT}${path}" \
            -H "Content-Type: application/json" \
            --aws-sigv4 "aws:amz:${REGION}:es" \
            --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
            -d "$data"
    else
        curl -s -X "$method" \
            "${OPENSEARCH_ENDPOINT}${path}" \
            -H "Content-Type: application/json" \
            --aws-sigv4 "aws:amz:${REGION}:es" \
            --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)"
    fi
}

# Step 1: Verify connectivity to OpenSearch
echo -e "${YELLOW}[1/5] Verifying OpenSearch connectivity...${NC}"
HEALTH_CHECK=$(curl -s -w "\n%{http_code}" "${OPENSEARCH_ENDPOINT}/_cluster/health" \
    --aws-sigv4 "aws:amz:${REGION}:es" \
    --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" 2>&1)

HTTP_CODE=$(echo "$HEALTH_CHECK" | tail -n1)
RESPONSE=$(echo "$HEALTH_CHECK" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Successfully connected to OpenSearch${NC}"
    CLUSTER_STATUS=$(echo "$RESPONSE" | jq -r '.status')
    echo -e "  Cluster status: ${CLUSTER_STATUS}"
else
    echo -e "${RED}✗ Failed to connect to OpenSearch (HTTP ${HTTP_CODE})${NC}"
    echo -e "${RED}Response: ${RESPONSE}${NC}"
    exit 1
fi
echo ""

# Step 2: Check if index already exists
echo -e "${YELLOW}[2/5] Checking if index '${INDEX_NAME}' exists...${NC}"
INDEX_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" \
    "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}" \
    --aws-sigv4 "aws:amz:${REGION}:es" \
    --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)")

if [ "$INDEX_EXISTS" = "200" ]; then
    echo -e "${YELLOW}⚠ Index '${INDEX_NAME}' already exists${NC}"
    read -p "Do you want to delete and recreate it? (y/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}  Deleting existing index...${NC}"
        DELETE_RESPONSE=$(curl -s -X DELETE \
            "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}" \
            --aws-sigv4 "aws:amz:${REGION}:es" \
            --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)")
        echo -e "${GREEN}  ✓ Index deleted${NC}"
    else
        echo -e "${BLUE}  Skipping index creation${NC}"
        exit 0
    fi
else
    echo -e "${GREEN}✓ Index does not exist, proceeding with creation${NC}"
fi
echo ""

# Step 3: Create index with k-NN mapping
echo -e "${YELLOW}[3/5] Creating index with k-NN mapping...${NC}"

INDEX_MAPPING='{
  "settings": {
    "index": {
      "knn": true,
      "knn.algo_param.ef_search": 512,
      "number_of_shards": 2,
      "number_of_replicas": 1,
      "refresh_interval": "30s"
    },
    "analysis": {
      "analyzer": {
        "path_analyzer": {
          "type": "custom",
          "tokenizer": "path_tokenizer",
          "filter": ["lowercase"]
        }
      },
      "tokenizer": {
        "path_tokenizer": {
          "type": "path_hierarchy",
          "delimiter": "/"
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "file_path": {
        "type": "text",
        "fields": {
          "keyword": { "type": "keyword" },
          "path": {
            "type": "text",
            "analyzer": "path_analyzer"
          }
        }
      },
      "file_name": {
        "type": "text",
        "fields": {
          "keyword": { "type": "keyword" }
        }
      },
      "file_extension": {
        "type": "keyword"
      },
      "file_size": {
        "type": "long"
      },
      "modified_date": {
        "type": "date"
      },
      "created_date": {
        "type": "date"
      },
      "content": {
        "type": "text",
        "analyzer": "standard"
      },
      "image_embedding": {
        "type": "knn_vector",
        "dimension": 512,
        "method": {
          "name": "hnsw",
          "space_type": "l2",
          "engine": "nmslib",
          "parameters": {
            "ef_construction": 512,
            "m": 16
          }
        }
      },
      "metadata": {
        "type": "object",
        "dynamic": true
      },
      "indexed_date": {
        "type": "date"
      }
    }
  }
}'

CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT \
    "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}" \
    -H "Content-Type: application/json" \
    --aws-sigv4 "aws:amz:${REGION}:es" \
    --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)" \
    -d "$INDEX_MAPPING")

HTTP_CODE=$(echo "$CREATE_RESPONSE" | tail -n1)
RESPONSE=$(echo "$CREATE_RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Index created successfully${NC}"
    echo "$RESPONSE" | jq '.'
else
    echo -e "${RED}✗ Failed to create index (HTTP ${HTTP_CODE})${NC}"
    echo -e "${RED}Response: ${RESPONSE}${NC}"
    exit 1
fi
echo ""

# Step 4: Verify index settings
echo -e "${YELLOW}[4/5] Verifying index settings...${NC}"
SETTINGS_RESPONSE=$(curl -s -X GET \
    "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_settings" \
    --aws-sigv4 "aws:amz:${REGION}:es" \
    --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)")

KNN_ENABLED=$(echo "$SETTINGS_RESPONSE" | jq -r ".[\"${INDEX_NAME}\"].settings.index.knn")
echo -e "  k-NN enabled: ${KNN_ENABLED}"

if [ "$KNN_ENABLED" = "true" ]; then
    echo -e "${GREEN}✓ k-NN is properly enabled${NC}"
else
    echo -e "${RED}✗ k-NN is not enabled${NC}"
fi
echo ""

# Step 5: Verify mapping
echo -e "${YELLOW}[5/5] Verifying index mapping...${NC}"
MAPPING_RESPONSE=$(curl -s -X GET \
    "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_mapping" \
    --aws-sigv4 "aws:amz:${REGION}:es" \
    --user "$(aws configure get aws_access_key_id):$(aws configure get aws_secret_access_key)")

IMAGE_EMBEDDING_TYPE=$(echo "$MAPPING_RESPONSE" | jq -r ".[\"${INDEX_NAME}\"].mappings.properties.image_embedding.type")
DIMENSION=$(echo "$MAPPING_RESPONSE" | jq -r ".[\"${INDEX_NAME}\"].mappings.properties.image_embedding.dimension")

echo -e "  image_embedding type: ${IMAGE_EMBEDDING_TYPE}"
echo -e "  vector dimension: ${DIMENSION}"

if [ "$IMAGE_EMBEDDING_TYPE" = "knn_vector" ] && [ "$DIMENSION" = "512" ]; then
    echo -e "${GREEN}✓ Mapping verified successfully${NC}"
else
    echo -e "${RED}✗ Mapping verification failed${NC}"
fi
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Index Creation Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Index Name:${NC} ${INDEX_NAME}"
echo -e "${BLUE}Endpoint:${NC} ${OPENSEARCH_ENDPOINT}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Index sample documents: ./ec2-index-sample-data.sh"
echo -e "  2. Test k-NN search: ./ec2-test-knn-search.sh"
echo -e "  3. Monitor index: ./ec2-monitor-index.sh"
