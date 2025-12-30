#!/bin/bash

# OpenSearch Verification Script
# This script checks OpenSearch index and document counts

OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
INDEX_NAME="file-metadata"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== OpenSearch Index Verification ===${NC}\n"

# Note: These commands require VPC access or port forwarding
# If running from outside VPC, use SSM port forwarding or bastion host

echo -e "${YELLOW}1. Check if index exists...${NC}"
curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME?pretty" | jq '.' || \
  echo -e "${RED}Cannot connect to OpenSearch. Ensure you have VPC access.${NC}"

echo -e "\n${YELLOW}2. Get document count...${NC}"
curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_count?pretty" | jq '.'

echo -e "\n${YELLOW}3. Get index stats...${NC}"
curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_stats?pretty" | jq '.indices."file-metadata"'

echo -e "\n${YELLOW}4. Sample documents (last 5)...${NC}"
curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_search?pretty" \
  -H 'Content-Type: application/json' \
  -d '{
    "size": 5,
    "sort": [{"indexed_at": {"order": "desc"}}],
    "query": {"match_all": {}}
  }' | jq '.hits.hits[]._source | {file_path, file_name, file_type, size, indexed_at}'

echo -e "\n${YELLOW}5. DocuWorks files count...${NC}"
curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_search?pretty" \
  -H 'Content-Type: application/json' \
  -d '{
    "size": 0,
    "query": {"term": {"file_type": "xdw"}},
    "aggs": {
      "docuworks_count": {"value_count": {"field": "_id"}},
      "with_relationships": {
        "filter": {"exists": {"field": "docuworks_relationships"}},
        "aggs": {
          "count": {"value_count": {"field": "_id"}}
        }
      }
    }
  }' | jq '.aggregations'

echo -e "\n${YELLOW}6. File type distribution...${NC}"
curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_search?pretty" \
  -H 'Content-Type: application/json' \
  -d '{
    "size": 0,
    "aggs": {
      "file_types": {
        "terms": {"field": "file_type.keyword", "size": 20}
      }
    }
  }' | jq '.aggregations.file_types.buckets'

echo -e "\n${YELLOW}7. Recent indexing activity (last hour)...${NC}"
ONE_HOUR_AGO=$(date -u -d '1 hour ago' --iso-8601=seconds)
curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_search?pretty" \
  -H 'Content-Type: application/json' \
  -d "{
    \"size\": 0,
    \"query\": {
      \"range\": {
        \"indexed_at\": {\"gte\": \"$ONE_HOUR_AGO\"}
      }
    },
    \"aggs\": {
      \"files_indexed_last_hour\": {
        \"date_histogram\": {
          \"field\": \"indexed_at\",
          \"fixed_interval\": \"5m\"
        }
      }
    }
  }" | jq '.aggregations.files_indexed_last_hour.buckets | .[] | {time: .key_as_string, count: .doc_count}'

echo -e "\n${GREEN}=== Verification Complete ===${NC}"
