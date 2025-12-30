#!/bin/bash
#
# OpenSearch Image Search Integration Test
# OpenSearch の画像検索機能テスト（VPC内からの実行用）
#
# このスクリプトは以下をテストします：
# 1. OpenSearch エンドポイントへの接続
# 2. image_embedding フィールドの存在確認
# 3. KNN ベクトル検索の動作確認
#
# 実行方法:
# Local: ./scripts/test-opensearch-image-search.sh
# EC2 (VPC): VPC_MODE=true ./scripts/test-opensearch-image-search.sh

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
VPC_MODE=${VPC_MODE:-false}
OPENSEARCH_ENDPOINT=${OPENSEARCH_ENDPOINT:-"vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"}
INDEX_NAME=${INDEX_NAME:-"files"}

echo -e "${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  OpenSearch Image Search Integration Test             ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Mode: ${VPC_MODE}${NC}"
echo -e "${YELLOW}OpenSearch Endpoint: ${OPENSEARCH_ENDPOINT}${NC}"
echo -e "${YELLOW}Index Name: ${INDEX_NAME}${NC}"
echo ""

# Test counter
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Function to run test
run_test() {
    local test_name=$1
    local test_command=$2

    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    echo -e "${BLUE}[Test ${TOTAL_TESTS}] ${test_name}${NC}"

    if eval "$test_command"; then
        echo -e "${GREEN}  ✓ PASSED${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        return 0
    else
        echo -e "${RED}  ✗ FAILED${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
}

echo -e "${CYAN}📊 Test 1: OpenSearch Cluster Health${NC}"
echo "======================================"
echo ""

# Test 1-1: Check cluster health
run_test "Cluster health check" \
    "curl -s -XGET \"https://${OPENSEARCH_ENDPOINT}/_cluster/health\" | jq -e '.status != \"red\"'"

echo ""

# Test 1-2: Check cluster stats
run_test "Cluster stats check" \
    "curl -s -XGET \"https://${OPENSEARCH_ENDPOINT}/_cluster/stats\" | jq -e '.indices.count > 0'"

echo ""
echo -e "${CYAN}📁 Test 2: Index Mapping Verification${NC}"
echo "======================================"
echo ""

# Test 2-1: Check index exists
run_test "Index '${INDEX_NAME}' exists" \
    "curl -s -XGET \"https://${OPENSEARCH_ENDPOINT}/${INDEX_NAME}\" | jq -e '.${INDEX_NAME}'"

echo ""

# Test 2-2: Check image_embedding field exists
run_test "image_embedding field exists in mapping" \
    "curl -s -XGET \"https://${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_mapping\" | jq -e '.${INDEX_NAME}.mappings.properties.image_embedding'"

echo ""

# Test 2-3: Verify image_embedding is knn_vector type
run_test "image_embedding is knn_vector type" \
    "curl -s -XGET \"https://${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_mapping\" | jq -e '.${INDEX_NAME}.mappings.properties.image_embedding.type == \"knn_vector\"'"

echo ""

# Test 2-4: Verify dimension is 1024
run_test "image_embedding dimension is 1024" \
    "curl -s -XGET \"https://${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_mapping\" | jq -e '.${INDEX_NAME}.mappings.properties.image_embedding.dimension == 1024'"

echo ""
echo -e "${CYAN}🔍 Test 3: KNN Vector Search${NC}"
echo "=============================="
echo ""

# Generate random 1024-dimensional vector for testing
RANDOM_VECTOR=$(python3 -c "import random; print([random.random() for _ in range(1024)])")

# Test 3-1: KNN search query (k=5)
run_test "KNN search with k=5" \
    "curl -s -XPOST \"https://${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_search\" \
    -H 'Content-Type: application/json' \
    -d '{
        \"size\": 5,
        \"query\": {
            \"knn\": {
                \"image_embedding\": {
                    \"vector\": ${RANDOM_VECTOR},
                    \"k\": 5
                }
            }
        }
    }' | jq -e '.hits'"

echo ""

# Test 3-2: KNN search with filter (should not error even if no results)
run_test "KNN search with filter" \
    "curl -s -XPOST \"https://${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_search\" \
    -H 'Content-Type: application/json' \
    -d '{
        \"size\": 10,
        \"query\": {
            \"bool\": {
                \"must\": [
                    {
                        \"knn\": {
                            \"image_embedding\": {
                                \"vector\": ${RANDOM_VECTOR},
                                \"k\": 10
                            }
                        }
                    }
                ],
                \"filter\": [
                    {
                        \"term\": {
                            \"file_type\": \"image/jpeg\"
                        }
                    }
                ]
            }
        }
    }' | jq -e '.hits'"

echo ""
echo -e "${CYAN}📈 Test 4: Index Statistics${NC}"
echo "============================"
echo ""

# Test 4-1: Check document count
run_test "Get document count" \
    "curl -s -XGET \"https://${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_count\" | jq -e '.count >= 0'"

echo ""

# Test 4-2: Check index size
run_test "Get index size" \
    "curl -s -XGET \"https://${OPENSEARCH_ENDPOINT}/_cat/indices/${INDEX_NAME}?v&h=store.size\" | grep -v '^$'"

echo ""
echo -e "${CYAN}🔧 Test 5: Settings Verification${NC}"
echo "================================="
echo ""

# Test 5-1: Check KNN plugin is enabled
run_test "KNN plugin is enabled" \
    "curl -s -XGET \"https://${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_settings\" | jq -e '.${INDEX_NAME}.settings.index.knn == \"true\"'"

echo ""

# Test 5-2: Check index settings
run_test "Index settings exist" \
    "curl -s -XGET \"https://${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_settings\" | jq -e '.${INDEX_NAME}.settings'"

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  Test Summary                                          ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Total tests: ${TOTAL_TESTS}${NC}"
echo -e "${GREEN}Passed: ${PASSED_TESTS}${NC}"
echo -e "${RED}Failed: ${FAILED_TESTS}${NC}"
echo ""

PASS_RATE=$(awk "BEGIN {printf \"%.2f\", ($PASSED_TESTS/$TOTAL_TESTS)*100}")
echo -e "${YELLOW}Pass rate: ${PASS_RATE}%${NC}"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi
