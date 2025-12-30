#!/bin/bash

###############################################################################
# OpenSearch k-NN Index Creation Script
# 画像検索対応のインデックスを作成
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
INDEX_NAME="${OPENSEARCH_INDEX:-file-index-v2}"
OPENSEARCH_ENDPOINT="${OPENSEARCH_ENDPOINT:-https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh5x3uqe.ap-northeast-1.es.amazonaws.com}"
AWS_REGION="${AWS_REGION:-ap-northeast-1}"

###############################################################################
# Helper Functions
###############################################################################

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    print_status "Checking prerequisites..."

    # Check if curl is installed
    if ! command -v curl &> /dev/null; then
        print_error "curl is not installed. Please install curl."
        exit 1
    fi

    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        print_warning "jq is not installed. Install with: brew install jq (output formatting will be limited)"
    fi

    # Check if AWS credentials are configured
    if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
        print_warning "AWS credentials not found in environment variables."
        print_warning "Attempting to use AWS CLI credentials..."

        if ! command -v aws &> /dev/null; then
            print_error "AWS CLI is not installed and no credentials found."
            exit 1
        fi
    fi

    print_status "Prerequisites check completed."
}

check_opensearch_connection() {
    print_status "Checking OpenSearch connection..."

    local response
    response=$(curl -s -w "\n%{http_code}" \
        --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
        --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
        "${OPENSEARCH_ENDPOINT}/_cluster/health")

    local http_code=$(echo "$response" | tail -n 1)
    local body=$(echo "$response" | sed '$d')

    if [ "$http_code" -eq 200 ]; then
        print_status "OpenSearch connection successful"
        if command -v jq &> /dev/null; then
            echo "$body" | jq .
        else
            echo "$body"
        fi
        return 0
    else
        print_error "Failed to connect to OpenSearch (HTTP $http_code)"
        echo "$body"
        return 1
    fi
}

check_index_exists() {
    local index=$1

    local response
    response=$(curl -s -o /dev/null -w "%{http_code}" \
        --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
        --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
        "${OPENSEARCH_ENDPOINT}/${index}")

    if [ "$response" -eq 200 ]; then
        return 0  # Index exists
    else
        return 1  # Index does not exist
    fi
}

create_index() {
    local index=$1

    print_status "Creating index: ${index}"

    # Index mapping with k-NN support
    local mapping='{
  "settings": {
    "index": {
      "number_of_shards": 2,
      "number_of_replicas": 1,
      "knn": true,
      "knn.algo_param.ef_search": 512,
      "refresh_interval": "10s"
    },
    "analysis": {
      "analyzer": {
        "japanese_analyzer": {
          "type": "custom",
          "tokenizer": "kuromoji_tokenizer",
          "filter": [
            "kuromoji_baseform",
            "kuromoji_part_of_speech",
            "cjk_width",
            "ja_stop",
            "lowercase"
          ]
        }
      },
      "filter": {
        "ja_stop": {
          "type": "stop",
          "stopwords": "_japanese_"
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "file_name": {
        "type": "text",
        "analyzer": "japanese_analyzer",
        "fields": {
          "keyword": {
            "type": "keyword",
            "ignore_above": 256
          }
        }
      },
      "file_path": {
        "type": "text",
        "analyzer": "japanese_analyzer",
        "fields": {
          "keyword": {
            "type": "keyword",
            "ignore_above": 2048
          }
        }
      },
      "file_type": {
        "type": "keyword"
      },
      "file_size": {
        "type": "long"
      },
      "processed_at": {
        "type": "date"
      },
      "extracted_text": {
        "type": "text",
        "analyzer": "japanese_analyzer"
      },
      "s3_key": {
        "type": "keyword"
      },
      "image_embedding": {
        "type": "knn_vector",
        "dimension": 1024,
        "method": {
          "name": "hnsw",
          "space_type": "cosinesimil",
          "engine": "lucene",
          "parameters": {
            "ef_construction": 512,
            "m": 16
          }
        }
      },
      "has_image_embedding": {
        "type": "boolean"
      }
    }
  }
}'

    local response
    response=$(curl -s -w "\n%{http_code}" \
        -X PUT \
        --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
        --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
        -H 'Content-Type: application/json' \
        -d "$mapping" \
        "${OPENSEARCH_ENDPOINT}/${index}")

    local http_code=$(echo "$response" | tail -n 1)
    local body=$(echo "$response" | sed '$d')

    if [ "$http_code" -eq 200 ]; then
        print_status "Index created successfully: ${index}"
        if command -v jq &> /dev/null; then
            echo "$body" | jq .
        else
            echo "$body"
        fi
        return 0
    else
        print_error "Failed to create index (HTTP $http_code)"
        echo "$body"
        return 1
    fi
}

get_index_mapping() {
    local index=$1

    print_status "Retrieving mapping for index: ${index}"

    local response
    response=$(curl -s -w "\n%{http_code}" \
        --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
        --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
        "${OPENSEARCH_ENDPOINT}/${index}/_mapping")

    local http_code=$(echo "$response" | tail -n 1)
    local body=$(echo "$response" | sed '$d')

    if [ "$http_code" -eq 200 ]; then
        if command -v jq &> /dev/null; then
            echo "$body" | jq .
        else
            echo "$body"
        fi
        return 0
    else
        print_error "Failed to get index mapping (HTTP $http_code)"
        echo "$body"
        return 1
    fi
}

get_index_settings() {
    local index=$1

    print_status "Retrieving settings for index: ${index}"

    local response
    response=$(curl -s -w "\n%{http_code}" \
        --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
        --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
        "${OPENSEARCH_ENDPOINT}/${index}/_settings")

    local http_code=$(echo "$response" | tail -n 1)
    local body=$(echo "$response" | sed '$d')

    if [ "$http_code" -eq 200 ]; then
        if command -v jq &> /dev/null; then
            echo "$body" | jq .
        else
            echo "$body"
        fi
        return 0
    else
        print_error "Failed to get index settings (HTTP $http_code)"
        echo "$body"
        return 1
    fi
}

delete_index() {
    local index=$1

    print_warning "Deleting index: ${index}"

    local response
    response=$(curl -s -w "\n%{http_code}" \
        -X DELETE \
        --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
        --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
        "${OPENSEARCH_ENDPOINT}/${index}")

    local http_code=$(echo "$response" | tail -n 1)
    local body=$(echo "$response" | sed '$d')

    if [ "$http_code" -eq 200 ]; then
        print_status "Index deleted successfully: ${index}"
        if command -v jq &> /dev/null; then
            echo "$body" | jq .
        else
            echo "$body"
        fi
        return 0
    else
        print_error "Failed to delete index (HTTP $http_code)"
        echo "$body"
        return 1
    fi
}

test_knn_query() {
    local index=$1

    print_status "Testing k-NN query on index: ${index}"

    # Generate a random 1024-dimensional vector for testing
    local test_vector="["
    for i in {1..1024}; do
        test_vector="${test_vector}$(awk -v seed=$RANDOM 'BEGIN{srand(seed); print rand()*2-1}')"
        if [ $i -lt 1024 ]; then
            test_vector="${test_vector},"
        fi
    done
    test_vector="${test_vector}]"

    local query="{
  \"query\": {
    \"knn\": {
      \"image_embedding\": {
        \"vector\": ${test_vector},
        \"k\": 10
      }
    }
  },
  \"size\": 10
}"

    local response
    response=$(curl -s -w "\n%{http_code}" \
        -X POST \
        --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
        --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
        -H 'Content-Type: application/json' \
        -d "$query" \
        "${OPENSEARCH_ENDPOINT}/${index}/_search")

    local http_code=$(echo "$response" | tail -n 1)
    local body=$(echo "$response" | sed '$d')

    if [ "$http_code" -eq 200 ]; then
        print_status "k-NN query successful"
        if command -v jq &> /dev/null; then
            echo "$body" | jq '{took: .took, total: .hits.total, hits: .hits.hits | length}'
        else
            echo "$body"
        fi
        return 0
    else
        print_error "k-NN query failed (HTTP $http_code)"
        echo "$body"
        return 1
    fi
}

###############################################################################
# Main Script
###############################################################################

main() {
    echo ""
    echo "=========================================="
    echo "OpenSearch k-NN Index Creation Script"
    echo "=========================================="
    echo ""
    echo "Index Name: ${INDEX_NAME}"
    echo "OpenSearch Endpoint: ${OPENSEARCH_ENDPOINT}"
    echo "AWS Region: ${AWS_REGION}"
    echo ""

    # Check prerequisites
    check_prerequisites
    echo ""

    # Check OpenSearch connection
    if ! check_opensearch_connection; then
        print_error "Cannot connect to OpenSearch. Exiting."
        exit 1
    fi
    echo ""

    # Check if index already exists
    if check_index_exists "$INDEX_NAME"; then
        print_warning "Index '${INDEX_NAME}' already exists."
        read -p "Do you want to delete and recreate it? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            delete_index "$INDEX_NAME"
            echo ""
        else
            print_status "Using existing index."
            echo ""
            get_index_mapping "$INDEX_NAME"
            echo ""
            get_index_settings "$INDEX_NAME"
            exit 0
        fi
    fi

    # Create the index
    if ! create_index "$INDEX_NAME"; then
        print_error "Failed to create index. Exiting."
        exit 1
    fi
    echo ""

    # Verify index creation
    print_status "Verifying index creation..."
    get_index_mapping "$INDEX_NAME"
    echo ""

    get_index_settings "$INDEX_NAME"
    echo ""

    # Test k-NN query
    print_status "Testing k-NN query functionality..."
    test_knn_query "$INDEX_NAME" || print_warning "k-NN query test failed (this is expected if no documents exist yet)"
    echo ""

    print_status "Index creation completed successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Start indexing files with image embeddings"
    echo "2. Use the Lambda Search API to query the index"
    echo "3. Monitor index performance with CloudWatch"
    echo ""
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --index)
            INDEX_NAME="$2"
            shift 2
            ;;
        --endpoint)
            OPENSEARCH_ENDPOINT="$2"
            shift 2
            ;;
        --region)
            AWS_REGION="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --index NAME       Index name (default: file-index-v2)"
            echo "  --endpoint URL     OpenSearch endpoint URL"
            echo "  --region REGION    AWS region (default: ap-northeast-1)"
            echo "  --help             Show this help message"
            echo ""
            echo "Environment Variables:"
            echo "  OPENSEARCH_ENDPOINT  OpenSearch endpoint URL"
            echo "  OPENSEARCH_INDEX     Index name"
            echo "  AWS_REGION           AWS region"
            echo "  AWS_ACCESS_KEY_ID    AWS access key"
            echo "  AWS_SECRET_ACCESS_KEY  AWS secret key"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Run main function
main
