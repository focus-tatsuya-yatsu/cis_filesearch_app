#!/bin/bash

###############################################################################
# Image Search Integration Test Script
# 画像検索APIの統合テスト
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
FRONTEND_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"
API_GATEWAY_URL="${NEXT_PUBLIC_API_GATEWAY_URL:-https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search}"
TEST_IMAGE_PATH="${1:-test-image.jpg}"

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
        print_warning "Output formatting will be limited"
    fi

    # Check if test image exists
    if [ ! -f "$TEST_IMAGE_PATH" ]; then
        print_warning "Test image not found: $TEST_IMAGE_PATH"
        print_status "Creating a test image..."
        create_test_image
    fi

    print_status "Prerequisites check completed."
}

create_test_image() {
    # Create a simple test image using ImageMagick or base64
    if command -v convert &> /dev/null; then
        convert -size 100x100 xc:blue "$TEST_IMAGE_PATH"
        print_status "Created test image: $TEST_IMAGE_PATH"
    else
        print_error "ImageMagick not installed. Please provide a test image."
        print_error "Usage: $0 path/to/test-image.jpg"
        exit 1
    fi
}

test_image_embedding_api() {
    print_header "Test 1: Image Embedding API"

    print_status "Testing: POST ${FRONTEND_URL}/api/image-embedding"
    print_status "Image: $TEST_IMAGE_PATH"

    local response
    response=$(curl -s -w "\n%{http_code}" \
        -X POST \
        -F "image=@${TEST_IMAGE_PATH}" \
        "${FRONTEND_URL}/api/image-embedding")

    local http_code=$(echo "$response" | tail -n 1)
    local body=$(echo "$response" | sed '$d')

    echo "HTTP Status: $http_code"

    if [ "$http_code" -eq 200 ]; then
        print_status "Image embedding API: SUCCESS"

        if command -v jq &> /dev/null; then
            echo "$body" | jq '{
                success: .success,
                dimensions: .data.dimensions,
                fileName: .data.fileName,
                fileSize: .data.fileSize,
                cached: .data.cached,
                embeddingPreview: .data.embedding[0:5]
            }'

            # Extract embedding for next test
            EMBEDDING=$(echo "$body" | jq -c '.data.embedding')
            echo "$EMBEDDING" > /tmp/test-embedding.json
            print_status "Embedding saved to: /tmp/test-embedding.json"
        else
            echo "$body"
            print_warning "jq not installed. Cannot extract embedding for search test."
        fi

        return 0
    else
        print_error "Image embedding API: FAILED"
        echo "$body"
        return 1
    fi
}

test_lambda_search_api() {
    print_header "Test 2: Lambda Search API (Direct)"

    if [ ! -f /tmp/test-embedding.json ]; then
        print_error "Embedding file not found. Run Test 1 first."
        return 1
    fi

    local embedding=$(cat /tmp/test-embedding.json)

    print_status "Testing: POST ${API_GATEWAY_URL}"
    print_status "Using embedding from Test 1"

    local request_body="{
  \"imageEmbedding\": ${embedding},
  \"searchMode\": \"or\",
  \"size\": 10,
  \"page\": 1,
  \"sortBy\": \"relevance\",
  \"sortOrder\": \"desc\"
}"

    local response
    response=$(curl -s -w "\n%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d "$request_body" \
        "${API_GATEWAY_URL}")

    local http_code=$(echo "$response" | tail -n 1)
    local body=$(echo "$response" | sed '$d')

    echo "HTTP Status: $http_code"

    if [ "$http_code" -eq 200 ]; then
        print_status "Lambda Search API: SUCCESS"

        if command -v jq &> /dev/null; then
            echo "$body" | jq '{
                success: .success,
                resultCount: (.data.results | length),
                total: .data.pagination.total,
                took: .data.took,
                topResults: .data.results[0:3] | map({
                    fileName: .fileName,
                    relevanceScore: .relevanceScore
                })
            }'
        else
            echo "$body"
        fi

        return 0
    else
        print_error "Lambda Search API: FAILED"
        echo "$body"
        return 1
    fi
}

test_frontend_search_api() {
    print_header "Test 3: Frontend Search API"

    if [ ! -f /tmp/test-embedding.json ]; then
        print_error "Embedding file not found. Run Test 1 first."
        return 1
    fi

    local embedding=$(cat /tmp/test-embedding.json)

    print_status "Testing: POST ${FRONTEND_URL}/api/search"
    print_status "Using embedding from Test 1"

    local request_body="{
  \"imageEmbedding\": ${embedding},
  \"searchMode\": \"or\",
  \"size\": 10,
  \"page\": 1
}"

    local response
    response=$(curl -s -w "\n%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d "$request_body" \
        "${FRONTEND_URL}/api/search")

    local http_code=$(echo "$response" | tail -n 1)
    local body=$(echo "$response" | sed '$d')

    echo "HTTP Status: $http_code"

    if [ "$http_code" -eq 200 ]; then
        print_status "Frontend Search API: SUCCESS"

        if command -v jq &> /dev/null; then
            echo "$body" | jq '{
                success: .success,
                resultCount: (.data.results | length),
                total: .data.pagination.total,
                took: .data.took,
                searchType: .data.query.searchType
            }'
        else
            echo "$body"
        fi

        return 0
    else
        print_error "Frontend Search API: FAILED"
        echo "$body"
        return 1
    fi
}

test_opensearch_direct() {
    print_header "Test 4: OpenSearch Direct Query (Optional)"

    if [ -z "$OPENSEARCH_ENDPOINT" ]; then
        print_warning "OPENSEARCH_ENDPOINT not set. Skipping direct OpenSearch test."
        return 0
    fi

    if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
        print_warning "AWS credentials not set. Skipping direct OpenSearch test."
        return 0
    fi

    if [ ! -f /tmp/test-embedding.json ]; then
        print_error "Embedding file not found. Run Test 1 first."
        return 1
    fi

    local embedding=$(cat /tmp/test-embedding.json)

    print_status "Testing: POST ${OPENSEARCH_ENDPOINT}/file-index-v2/_search"

    local query="{
  \"query\": {
    \"knn\": {
      \"image_embedding\": {
        \"vector\": ${embedding},
        \"k\": 10
      }
    }
  },
  \"size\": 10
}"

    local response
    response=$(curl -s -w "\n%{http_code}" \
        -X POST \
        --aws-sigv4 "aws:amz:${AWS_REGION:-ap-northeast-1}:es" \
        --user "${AWS_ACCESS_KEY_ID}:${AWS_SECRET_ACCESS_KEY}" \
        -H "Content-Type: application/json" \
        -d "$query" \
        "${OPENSEARCH_ENDPOINT}/file-index-v2/_search")

    local http_code=$(echo "$response" | tail -n 1)
    local body=$(echo "$response" | sed '$d')

    echo "HTTP Status: $http_code"

    if [ "$http_code" -eq 200 ]; then
        print_status "OpenSearch Direct Query: SUCCESS"

        if command -v jq &> /dev/null; then
            echo "$body" | jq '{
                took: .took,
                total: .hits.total,
                maxScore: .hits.max_score,
                hitCount: (.hits.hits | length)
            }'
        else
            echo "$body"
        fi

        return 0
    else
        print_error "OpenSearch Direct Query: FAILED"
        echo "$body"
        return 1
    fi
}

test_performance() {
    print_header "Test 5: Performance Test"

    print_status "Running 5 consecutive image embedding requests..."

    local total_time=0
    local success_count=0

    for i in {1..5}; do
        echo -n "Request $i: "

        local start_time=$(date +%s%3N)

        local response
        response=$(curl -s -w "\n%{http_code}" \
            -X POST \
            -F "image=@${TEST_IMAGE_PATH}" \
            "${FRONTEND_URL}/api/image-embedding")

        local end_time=$(date +%s%3N)
        local duration=$((end_time - start_time))

        local http_code=$(echo "$response" | tail -n 1)

        if [ "$http_code" -eq 200 ]; then
            echo -e "${GREEN}SUCCESS${NC} (${duration}ms)"
            success_count=$((success_count + 1))
            total_time=$((total_time + duration))
        else
            echo -e "${RED}FAILED${NC} (HTTP $http_code)"
        fi

        # Small delay between requests
        sleep 0.5
    done

    echo ""
    print_status "Performance Test Results:"
    echo "  Success Rate: ${success_count}/5"

    if [ $success_count -gt 0 ]; then
        local avg_time=$((total_time / success_count))
        echo "  Average Time: ${avg_time}ms"

        if [ $avg_time -lt 3000 ]; then
            print_status "Performance: EXCELLENT (< 3s)"
        elif [ $avg_time -lt 5000 ]; then
            print_warning "Performance: ACCEPTABLE (3-5s)"
        else
            print_warning "Performance: NEEDS IMPROVEMENT (> 5s)"
        fi
    fi
}

test_cache_hit() {
    print_header "Test 6: Cache Hit Test"

    print_status "First request (cache miss)..."

    local response1
    response1=$(curl -s \
        -X POST \
        -F "image=@${TEST_IMAGE_PATH}" \
        "${FRONTEND_URL}/api/image-embedding")

    if command -v jq &> /dev/null; then
        local cached1=$(echo "$response1" | jq -r '.data.cached')
        echo "  Cached: $cached1"
    fi

    print_status "Second request (should be cache hit)..."
    sleep 0.5

    local response2
    response2=$(curl -s \
        -X POST \
        -F "image=@${TEST_IMAGE_PATH}" \
        "${FRONTEND_URL}/api/image-embedding")

    if command -v jq &> /dev/null; then
        local cached2=$(echo "$response2" | jq -r '.data.cached')
        echo "  Cached: $cached2"

        if [ "$cached2" = "true" ]; then
            print_status "Cache Hit Test: SUCCESS"
        else
            print_warning "Cache Hit Test: Cache not working as expected"
        fi
    else
        print_warning "jq not installed. Cannot verify cache hit."
    fi
}

###############################################################################
# Main Script
###############################################################################

main() {
    print_header "Image Search Integration Test Suite"

    echo "Configuration:"
    echo "  Frontend URL: ${FRONTEND_URL}"
    echo "  API Gateway URL: ${API_GATEWAY_URL}"
    echo "  Test Image: ${TEST_IMAGE_PATH}"
    echo ""

    check_prerequisites

    local failed_tests=0

    # Run all tests
    test_image_embedding_api || failed_tests=$((failed_tests + 1))
    test_lambda_search_api || failed_tests=$((failed_tests + 1))
    test_frontend_search_api || failed_tests=$((failed_tests + 1))
    test_opensearch_direct || true  # Optional test
    test_performance || true  # Performance test is informational
    test_cache_hit || true  # Cache test is informational

    # Summary
    print_header "Test Summary"

    if [ $failed_tests -eq 0 ]; then
        print_status "All critical tests passed!"
        echo ""
        echo "Next steps:"
        echo "1. Upload actual images to test real-world scenarios"
        echo "2. Monitor Lambda and OpenSearch metrics in CloudWatch"
        echo "3. Test with various image types and sizes"
        echo "4. Verify search accuracy with known image pairs"
        exit 0
    else
        print_error "$failed_tests test(s) failed"
        echo ""
        echo "Troubleshooting:"
        echo "1. Check if Next.js frontend is running (${FRONTEND_URL})"
        echo "2. Verify API Gateway URL is correct"
        echo "3. Check AWS credentials for Bedrock access"
        echo "4. Review CloudWatch Logs for detailed errors"
        echo "5. Ensure OpenSearch index exists (file-index-v2)"
        exit 1
    fi
}

# Parse command line arguments
case "${1:-}" in
    --help|-h)
        echo "Usage: $0 [TEST_IMAGE_PATH]"
        echo ""
        echo "Options:"
        echo "  TEST_IMAGE_PATH    Path to test image (default: test-image.jpg)"
        echo ""
        echo "Environment Variables:"
        echo "  NEXT_PUBLIC_APP_URL           Frontend URL"
        echo "  NEXT_PUBLIC_API_GATEWAY_URL   Lambda Search API URL"
        echo "  OPENSEARCH_ENDPOINT           OpenSearch endpoint (for direct test)"
        echo "  AWS_ACCESS_KEY_ID             AWS access key"
        echo "  AWS_SECRET_ACCESS_KEY         AWS secret key"
        echo "  AWS_REGION                    AWS region"
        exit 0
        ;;
esac

# Run main function
main
