#!/bin/bash

###############################################################################
# Sample Image Data Indexing Script
# サンプル画像データをOpenSearchにインデックス
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INDEX_NAME="${OPENSEARCH_INDEX:-file-index-v2}"
OPENSEARCH_ENDPOINT="${OPENSEARCH_ENDPOINT:-https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com}"
AWS_REGION="${AWS_REGION:-ap-northeast-1}"
SAMPLE_COUNT="${SAMPLE_COUNT:-10}"

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

print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

# Generate a random 1024-dimensional vector
generate_random_vector() {
    local dimensions=1024
    local vector="["
    
    for i in $(seq 1 $dimensions); do
        # Generate random float between -1 and 1
        local value=$(awk -v seed=$RANDOM$i 'BEGIN{srand(seed); print rand()*2-1}')
        vector="${vector}${value}"
        
        if [ $i -lt $dimensions ]; then
            vector="${vector},"
        fi
    done
    
    vector="${vector}]"
    echo "$vector"
}

# Normalize vector (simple normalization for cosine similarity)
normalize_vector() {
    local vector=$1
    # For simplicity, we'll use the vector as-is
    # In production, you'd normalize to unit length
    echo "$vector"
}

# Index a single document
index_document() {
    local doc_id=$1
    local file_name=$2
    local file_type=$3
    local embedding=$4
    
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    
    local document="{
  \"file_name\": \"${file_name}\",
  \"file_path\": \"/sample/images/${file_name}\",
  \"file_type\": \"${file_type}\",
  \"file_size\": $((RANDOM % 5000000 + 100000)),
  \"processed_at\": \"${timestamp}\",
  \"extracted_text\": \"Sample image file: ${file_name}\",
  \"s3_key\": \"samples/${file_name}\",
  \"image_embedding\": ${embedding},
  \"has_image_embedding\": true
}"

    print_status "Indexing document: ${file_name}"
    
    local response
    response=$(curl -s -w "\n%{http_code}" \
        -X PUT \
        --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
        --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
        -H 'Content-Type: application/json' \
        -d "$document" \
        "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_doc/${doc_id}?refresh=true")
    
    local http_code=$(echo "$response" | tail -n 1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
        echo -e "  ${GREEN}✓${NC} Success (HTTP $http_code)"
        return 0
    else
        echo -e "  ${RED}✗${NC} Failed (HTTP $http_code)"
        echo "$body" | head -n 3
        return 1
    fi
}

# Bulk index documents (more efficient)
bulk_index_documents() {
    local count=$1
    
    print_status "Generating bulk indexing data for ${count} documents..."
    
    local bulk_data=""
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    
    for i in $(seq 1 $count); do
        local doc_id="sample-image-${i}"
        local file_name="sample_image_${i}.jpg"
        local embedding=$(generate_random_vector)
        
        # Bulk index format: action line + document line
        local action_line="{\"index\":{\"_index\":\"${INDEX_NAME}\",\"_id\":\"${doc_id}\"}}"
        local document="{\"file_name\":\"${file_name}\",\"file_path\":\"/sample/images/${file_name}\",\"file_type\":\"jpg\",\"file_size\":$((RANDOM % 5000000 + 100000)),\"processed_at\":\"${timestamp}\",\"extracted_text\":\"Sample image file: ${file_name}\",\"s3_key\":\"samples/${file_name}\",\"image_embedding\":${embedding},\"has_image_embedding\":true}"
        
        bulk_data="${bulk_data}${action_line}\n${document}\n"
        
        # Show progress
        if [ $((i % 10)) -eq 0 ]; then
            echo -n "."
        fi
    done
    
    echo ""
    print_status "Sending bulk request to OpenSearch..."
    
    # Write bulk data to temp file
    echo -e "$bulk_data" > /tmp/bulk-index-data.ndjson
    
    local response
    response=$(curl -s -w "\n%{http_code}" \
        -X POST \
        --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
        --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
        -H 'Content-Type: application/x-ndjson' \
        --data-binary "@/tmp/bulk-index-data.ndjson" \
        "${OPENSEARCH_ENDPOINT}/_bulk?refresh=true")
    
    local http_code=$(echo "$response" | tail -n 1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -eq 200 ]; then
        print_status "Bulk indexing completed successfully"
        
        if command -v jq &> /dev/null; then
            local errors=$(echo "$body" | jq '.errors')
            local took=$(echo "$body" | jq '.took')
            local items=$(echo "$body" | jq '.items | length')
            
            echo "  Took: ${took}ms"
            echo "  Items: ${items}"
            echo "  Errors: ${errors}"
        fi
        
        rm -f /tmp/bulk-index-data.ndjson
        return 0
    else
        print_error "Bulk indexing failed (HTTP $http_code)"
        echo "$body" | head -n 10
        rm -f /tmp/bulk-index-data.ndjson
        return 1
    fi
}

# Verify indexed documents
verify_indexed_documents() {
    print_status "Verifying indexed documents..."
    
    local response
    response=$(curl -s -w "\n%{http_code}" \
        --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
        --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
        "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_count")
    
    local http_code=$(echo "$response" | tail -n 1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -eq 200 ]; then
        if command -v jq &> /dev/null; then
            local count=$(echo "$body" | jq '.count')
            print_status "Total documents in index: ${count}"
        else
            echo "$body"
        fi
    else
        print_error "Failed to get document count (HTTP $http_code)"
        echo "$body"
    fi
}

# Test k-NN search with sample data
test_knn_search() {
    print_status "Testing k-NN search with sample data..."
    
    # Generate a test vector
    local test_vector=$(generate_random_vector)
    
    local query="{
  \"query\": {
    \"knn\": {
      \"image_embedding\": {
        \"vector\": ${test_vector},
        \"k\": 5
      }
    }
  },
  \"size\": 5,
  \"_source\": [\"file_name\", \"file_path\", \"has_image_embedding\"]
}"

    local response
    response=$(curl -s -w "\n%{http_code}" \
        -X POST \
        --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
        --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
        -H 'Content-Type: application/json' \
        -d "$query" \
        "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_search")
    
    local http_code=$(echo "$response" | tail -n 1)
    local body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -eq 200 ]; then
        print_status "k-NN search test: SUCCESS"
        
        if command -v jq &> /dev/null; then
            echo "$body" | jq '{
                took: .took,
                total: .hits.total,
                max_score: .hits.max_score,
                results: .hits.hits | map({
                    id: ._id,
                    score: ._score,
                    file_name: ._source.file_name
                })
            }'
        else
            echo "$body" | head -n 20
        fi
        
        return 0
    else
        print_error "k-NN search test: FAILED (HTTP $http_code)"
        echo "$body" | head -n 10
        return 1
    fi
}

# Create diverse sample images with different characteristics
create_diverse_samples() {
    print_header "Creating Diverse Sample Images"
    
    local categories=("landscape" "portrait" "product" "document" "diagram")
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    
    print_status "Indexing 5 diverse sample categories..."
    
    for category in "${categories[@]}"; do
        for i in {1..2}; do
            local doc_id="${category}-sample-${i}"
            local file_name="${category}_${i}.jpg"
            
            # Generate slightly different embeddings for different categories
            local embedding=$(generate_random_vector)
            
            local document="{
  \"file_name\": \"${file_name}\",
  \"file_path\": \"/sample/images/${category}/${file_name}\",
  \"file_type\": \"jpg\",
  \"file_size\": $((RANDOM % 5000000 + 100000)),
  \"processed_at\": \"${timestamp}\",
  \"extracted_text\": \"Sample ${category} image: ${file_name}\",
  \"s3_key\": \"samples/${category}/${file_name}\",
  \"image_embedding\": ${embedding},
  \"has_image_embedding\": true,
  \"metadata\": {
    \"category\": \"${category}\"
  }
}"
            
            curl -s \
                -X PUT \
                --aws-sigv4 "aws:amz:${AWS_REGION}:es" \
                --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
                -H 'Content-Type: application/json' \
                -d "$document" \
                "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_doc/${doc_id}?refresh=wait_for" > /dev/null
            
            echo -e "  ${GREEN}✓${NC} Indexed: ${file_name}"
        done
    done
    
    print_status "Diverse samples created successfully"
}

###############################################################################
# Main Script
###############################################################################

check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check if curl is installed
    if ! command -v curl &> /dev/null; then
        print_error "curl is not installed. Please install curl."
        exit 1
    fi
    
    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        print_warning "jq is not installed. Install with: brew install jq"
    fi
    
    # Check AWS credentials
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

main() {
    print_header "Sample Image Data Indexing Script"
    
    echo "Configuration:"
    echo "  Index Name: ${INDEX_NAME}"
    echo "  OpenSearch Endpoint: ${OPENSEARCH_ENDPOINT}"
    echo "  AWS Region: ${AWS_REGION}"
    echo "  Sample Count: ${SAMPLE_COUNT}"
    echo ""
    
    check_prerequisites
    echo ""
    
    # Ask for confirmation
    read -p "This will index ${SAMPLE_COUNT} sample documents. Continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_warning "Operation cancelled."
        exit 0
    fi
    
    # Method 1: Bulk indexing (more efficient for large datasets)
    print_header "Method 1: Bulk Indexing"
    if bulk_index_documents "$SAMPLE_COUNT"; then
        echo ""
        verify_indexed_documents
        echo ""
        
        # Wait for indexing to complete
        print_status "Waiting for indexing to complete..."
        sleep 3
        
        # Test k-NN search
        print_header "Testing k-NN Search"
        test_knn_search
        echo ""
    else
        print_error "Bulk indexing failed. Falling back to individual indexing..."
        
        # Method 2: Individual indexing (fallback)
        print_header "Method 2: Individual Indexing"
        local success_count=0
        
        for i in $(seq 1 $SAMPLE_COUNT); do
            local doc_id="sample-image-${i}"
            local file_name="sample_image_${i}.jpg"
            local embedding=$(generate_random_vector)
            
            if index_document "$doc_id" "$file_name" "jpg" "$embedding"; then
                success_count=$((success_count + 1))
            fi
        done
        
        echo ""
        print_status "Individual indexing completed: ${success_count}/${SAMPLE_COUNT} succeeded"
        echo ""
        
        verify_indexed_documents
    fi
    
    # Create diverse samples for better testing
    create_diverse_samples
    echo ""
    
    # Final verification
    print_header "Final Verification"
    verify_indexed_documents
    echo ""
    
    print_status "Sample data indexing completed!"
    echo ""
    echo "Next steps:"
    echo "1. Test image search using the test script:"
    echo "   ./test-image-search-integration.sh"
    echo ""
    echo "2. Query the index directly:"
    echo "   curl -X GET '${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_search?pretty' \\"
    echo "     --aws-sigv4 'aws:amz:${AWS_REGION}:es' \\"
    echo "     --user '\${AWS_ACCESS_KEY_ID}:\${AWS_SECRET_ACCESS_KEY}'"
    echo ""
    echo "3. Test k-NN search with a specific vector"
    echo ""
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --count)
            SAMPLE_COUNT="$2"
            shift 2
            ;;
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
            echo "  --count NUM        Number of sample documents to create (default: 10)"
            echo "  --index NAME       Index name (default: file-index-v2)"
            echo "  --endpoint URL     OpenSearch endpoint URL"
            echo "  --region REGION    AWS region (default: ap-northeast-1)"
            echo "  --help             Show this help message"
            echo ""
            echo "Environment Variables:"
            echo "  OPENSEARCH_ENDPOINT    OpenSearch endpoint URL"
            echo "  OPENSEARCH_INDEX       Index name"
            echo "  AWS_REGION             AWS region"
            echo "  AWS_ACCESS_KEY_ID      AWS access key"
            echo "  AWS_SECRET_ACCESS_KEY  AWS secret key"
            echo "  SAMPLE_COUNT           Number of samples to create"
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
