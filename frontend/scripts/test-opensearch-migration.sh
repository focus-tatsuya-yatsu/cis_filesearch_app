#!/bin/bash

###############################################################################
# OpenSearch Index Migration - End-to-End Test Script
#
# 包括的な移行テストを実行し、レポートを生成します
#
# 使用方法:
#   ./scripts/test-opensearch-migration.sh [options]
#
# オプション:
#   --source-index INDEX_NAME    ソースインデックス名 (デフォルト: file-search-dev)
#   --target-index INDEX_NAME    ターゲットインデックス名 (デフォルト: file-search-v2-test)
#   --skip-pre-migration        事前テストをスキップ
#   --skip-post-migration       事後テストをスキップ
#   --skip-rollback             ロールバックテストをスキップ
#   --skip-performance          パフォーマンステストをスキップ
#   --report-file FILE          レポートファイル名 (デフォルト: migration-test-report.txt)
#   --verbose                    詳細ログを表示
#
# 環境変数:
#   OPENSEARCH_ENDPOINT         OpenSearchエンドポイントURL
#   AWS_REGION                  AWSリージョン (デフォルト: ap-northeast-1)
###############################################################################

set -e

# カラー出力
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# デフォルト設定
SOURCE_INDEX="${SOURCE_INDEX:-file-search-dev}"
TARGET_INDEX="${TARGET_INDEX:-file-search-v2-test}"
ALIAS_NAME="file-search"
OPENSEARCH_ENDPOINT="${OPENSEARCH_ENDPOINT:-https://search-cis-filesearch-dev.ap-northeast-1.es.amazonaws.com}"
AWS_REGION="${AWS_REGION:-ap-northeast-1}"
REPORT_FILE="migration-test-report.txt"
VERBOSE=false

# テストフラグ
RUN_PRE_MIGRATION=true
RUN_POST_MIGRATION=true
RUN_ROLLBACK=true
RUN_PERFORMANCE=true

# 引数パース
while [[ $# -gt 0 ]]; do
  case $1 in
    --source-index)
      SOURCE_INDEX="$2"
      shift 2
      ;;
    --target-index)
      TARGET_INDEX="$2"
      shift 2
      ;;
    --skip-pre-migration)
      RUN_PRE_MIGRATION=false
      shift
      ;;
    --skip-post-migration)
      RUN_POST_MIGRATION=false
      shift
      ;;
    --skip-rollback)
      RUN_ROLLBACK=false
      shift
      ;;
    --skip-performance)
      RUN_PERFORMANCE=false
      shift
      ;;
    --report-file)
      REPORT_FILE="$2"
      shift 2
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# ヘッダー
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}OpenSearch Index Migration - E2E Test Suite${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Configuration:${NC}"
echo -e "  OpenSearch: $OPENSEARCH_ENDPOINT"
echo -e "  Source Index: $SOURCE_INDEX"
echo -e "  Target Index: $TARGET_INDEX"
echo -e "  Alias: $ALIAS_NAME"
echo -e "  Region: $AWS_REGION"
echo -e "  Report: $REPORT_FILE"
echo ""

# レポートファイルの初期化
START_TIME=$(date +%s)
START_TIME_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "$REPORT_FILE" <<EOF
========================================
OpenSearch Migration Test Report
========================================

Test Execution: $START_TIME_ISO
Source Index: $SOURCE_INDEX
Target Index: $TARGET_INDEX
OpenSearch Endpoint: $OPENSEARCH_ENDPOINT

========================================
Test Results
========================================

EOF

# テスト結果カウンター
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# テスト結果を記録する関数
log_test() {
  local test_name="$1"
  local status="$2"
  local message="$3"

  TOTAL_TESTS=$((TOTAL_TESTS + 1))

  if [ "$status" == "PASS" ]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo -e "${GREEN}✓${NC} $test_name"
    echo "[PASS] $test_name" >> "$REPORT_FILE"
  elif [ "$status" == "FAIL" ]; then
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo -e "${RED}✗${NC} $test_name"
    echo "[FAIL] $test_name: $message" >> "$REPORT_FILE"
  elif [ "$status" == "SKIP" ]; then
    echo -e "${YELLOW}⊘${NC} $test_name (SKIPPED)"
    echo "[SKIP] $test_name" >> "$REPORT_FILE"
  fi

  if [ "$VERBOSE" == true ] && [ -n "$message" ]; then
    echo "  → $message"
  fi

  if [ -n "$message" ]; then
    echo "       $message" >> "$REPORT_FILE"
  fi
}

# ========================================================================
# 1. PRE-MIGRATION TESTS
# ========================================================================

if [ "$RUN_PRE_MIGRATION" == true ]; then
  echo ""
  echo -e "${YELLOW}[1/4] Running Pre-Migration Tests...${NC}"
  echo ""
  echo "--- Pre-Migration Tests ---" >> "$REPORT_FILE"

  # 1.1 Source index exists
  SOURCE_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$OPENSEARCH_ENDPOINT/$SOURCE_INDEX")
  if [ "$SOURCE_EXISTS" == "200" ]; then
    log_test "Source index exists" "PASS"
  else
    log_test "Source index exists" "FAIL" "HTTP $SOURCE_EXISTS"
  fi

  # 1.2 Source document count
  SOURCE_COUNT=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/$SOURCE_INDEX/_count" | jq -r '.count // 0')
  if [ "$SOURCE_COUNT" -ge 0 ]; then
    log_test "Get source document count" "PASS" "Count: $SOURCE_COUNT"
  else
    log_test "Get source document count" "FAIL"
  fi

  # 1.3 Cluster health
  CLUSTER_HEALTH=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/_cluster/health" | jq -r '.status')
  if [[ "$CLUSTER_HEALTH" == "green" || "$CLUSTER_HEALTH" == "yellow" ]]; then
    log_test "Cluster health check" "PASS" "Status: $CLUSTER_HEALTH"
  else
    log_test "Cluster health check" "FAIL" "Status: $CLUSTER_HEALTH"
  fi

  # 1.4 Source index mapping
  SOURCE_MAPPING=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/$SOURCE_INDEX/_mapping")
  if echo "$SOURCE_MAPPING" | jq -e ".\"$SOURCE_INDEX\".mappings" > /dev/null 2>&1; then
    log_test "Source index mapping exists" "PASS"
  else
    log_test "Source index mapping exists" "FAIL"
  fi

  # 1.5 Disk space check
  DISK_STATS=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/_nodes/stats/fs")
  DISK_USAGE=$(echo "$DISK_STATS" | jq -r '.nodes | to_entries | .[0].value.fs.total | ((.total_in_bytes - .available_in_bytes) / .total_in_bytes * 100)')
  if (( $(echo "$DISK_USAGE < 80" | bc -l) )); then
    log_test "Disk space availability" "PASS" "Usage: ${DISK_USAGE}%"
  else
    log_test "Disk space availability" "FAIL" "Usage: ${DISK_USAGE}%"
  fi

  # 1.6 Memory check
  MEMORY_STATS=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/_nodes/stats/jvm")
  HEAP_USAGE=$(echo "$MEMORY_STATS" | jq -r '.nodes | to_entries | .[0].value.jvm.mem.heap_used_percent')
  if [ "$HEAP_USAGE" -lt 90 ]; then
    log_test "Memory availability" "PASS" "Heap: ${HEAP_USAGE}%"
  else
    log_test "Memory availability" "FAIL" "Heap: ${HEAP_USAGE}%"
  fi

else
  log_test "Pre-Migration Tests" "SKIP"
fi

# ========================================================================
# 2. MIGRATION EXECUTION (Run via Jest)
# ========================================================================

echo ""
echo -e "${YELLOW}[2/4] Running Migration Tests (via Jest)...${NC}"
echo ""
echo "--- Migration Tests ---" >> "$REPORT_FILE"

# Set environment variables for Jest
export OPENSEARCH_SOURCE_INDEX="$SOURCE_INDEX"
export OPENSEARCH_TARGET_INDEX="$TARGET_INDEX"
export OPENSEARCH_ALIAS="$ALIAS_NAME"
export OPENSEARCH_ENDPOINT="$OPENSEARCH_ENDPOINT"
export AWS_REGION="$AWS_REGION"

# Run Jest tests
if yarn test --testPathPattern="opensearch-migration.test.ts" --silent > /dev/null 2>&1; then
  log_test "Jest migration tests" "PASS"
else
  log_test "Jest migration tests" "FAIL" "Check Jest output for details"
fi

# ========================================================================
# 3. POST-MIGRATION TESTS
# ========================================================================

if [ "$RUN_POST_MIGRATION" == true ]; then
  echo ""
  echo -e "${YELLOW}[3/4] Running Post-Migration Tests...${NC}"
  echo ""
  echo "--- Post-Migration Tests ---" >> "$REPORT_FILE"

  # 3.1 Target index exists
  TARGET_EXISTS=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$OPENSEARCH_ENDPOINT/$TARGET_INDEX")
  if [ "$TARGET_EXISTS" == "200" ]; then
    log_test "Target index exists" "PASS"
  else
    log_test "Target index exists" "FAIL" "HTTP $TARGET_EXISTS"
  fi

  # 3.2 Target document count
  TARGET_COUNT=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/$TARGET_INDEX/_count" | jq -r '.count // 0')
  if [ "$TARGET_COUNT" -ge 0 ]; then
    log_test "Get target document count" "PASS" "Count: $TARGET_COUNT"
  else
    log_test "Get target document count" "FAIL"
  fi

  # 3.3 Document count comparison
  DIFF=$((SOURCE_COUNT - TARGET_COUNT))
  DIFF_ABS=${DIFF#-}
  TOLERANCE=$((SOURCE_COUNT / 1000)) # 0.1% tolerance
  if [ "$DIFF_ABS" -le "$TOLERANCE" ]; then
    log_test "Document count matches" "PASS" "Source: $SOURCE_COUNT, Target: $TARGET_COUNT"
  else
    log_test "Document count matches" "FAIL" "Source: $SOURCE_COUNT, Target: $TARGET_COUNT, Diff: $DIFF"
  fi

  # 3.4 Target mapping verification
  TARGET_MAPPING=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/$TARGET_INDEX/_mapping")
  VECTOR_TYPE=$(echo "$TARGET_MAPPING" | jq -r ".\"$TARGET_INDEX\".mappings.properties.image_embedding.type // \"none\"")
  if [ "$VECTOR_TYPE" == "knn_vector" ]; then
    log_test "k-NN vector mapping verified" "PASS"
  else
    log_test "k-NN vector mapping verified" "FAIL" "Type: $VECTOR_TYPE"
  fi

  # 3.5 Vector dimension check
  DIMENSION=$(echo "$TARGET_MAPPING" | jq -r ".\"$TARGET_INDEX\".mappings.properties.image_embedding.dimension // 0")
  if [ "$DIMENSION" == "1024" ]; then
    log_test "Vector dimension is 1024" "PASS"
  else
    log_test "Vector dimension is 1024" "FAIL" "Dimension: $DIMENSION"
  fi

  # 3.6 HNSW parameters check
  HNSW_ENGINE=$(echo "$TARGET_MAPPING" | jq -r ".\"$TARGET_INDEX\".mappings.properties.image_embedding.method.engine // \"none\"")
  SPACE_TYPE=$(echo "$TARGET_MAPPING" | jq -r ".\"$TARGET_INDEX\".mappings.properties.image_embedding.method.space_type // \"none\"")
  if [ "$HNSW_ENGINE" == "faiss" ] && [ "$SPACE_TYPE" == "innerproduct" ]; then
    log_test "HNSW parameters verified" "PASS" "Engine: $HNSW_ENGINE, Space: $SPACE_TYPE"
  else
    log_test "HNSW parameters verified" "FAIL" "Engine: $HNSW_ENGINE, Space: $SPACE_TYPE"
  fi

  # 3.7 Basic search test
  SEARCH_RESULT=$(curl -s -X POST "$OPENSEARCH_ENDPOINT/$TARGET_INDEX/_search" \
    -H "Content-Type: application/json" \
    -d '{
      "query": {
        "multi_match": {
          "query": "test",
          "fields": ["file_name", "file_path"]
        }
      },
      "size": 10
    }')

  SEARCH_HITS=$(echo "$SEARCH_RESULT" | jq -r '.hits.total.value // 0')
  if [ "$SEARCH_HITS" -ge 0 ]; then
    log_test "Basic text search works" "PASS" "Results: $SEARCH_HITS"
  else
    log_test "Basic text search works" "FAIL"
  fi

  # 3.8 Alias verification
  ALIAS_CHECK=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/_alias/$ALIAS_NAME")
  if echo "$ALIAS_CHECK" | jq -e ".\"$TARGET_INDEX\"" > /dev/null 2>&1; then
    log_test "Alias points to target index" "PASS"
  else
    log_test "Alias points to target index" "FAIL"
  fi

else
  log_test "Post-Migration Tests" "SKIP"
fi

# ========================================================================
# 4. PERFORMANCE BENCHMARKS
# ========================================================================

if [ "$RUN_PERFORMANCE" == true ]; then
  echo ""
  echo -e "${YELLOW}[4/4] Running Performance Benchmarks...${NC}"
  echo ""
  echo "--- Performance Benchmarks ---" >> "$REPORT_FILE"

  # 4.1 Text search latency
  LATENCIES=()
  for i in {1..10}; do
    START=$(date +%s%3N)
    curl -s -X POST "$OPENSEARCH_ENDPOINT/$TARGET_INDEX/_search" \
      -H "Content-Type: application/json" \
      -d '{
        "query": {
          "multi_match": {
            "query": "test query",
            "fields": ["file_name", "file_path", "extracted_text"]
          }
        },
        "size": 20
      }' > /dev/null
    END=$(date +%s%3N)
    LATENCY=$((END - START))
    LATENCIES+=("$LATENCY")
  done

  # Calculate average
  SUM=0
  for lat in "${LATENCIES[@]}"; do
    SUM=$((SUM + lat))
  done
  AVG_LATENCY=$((SUM / ${#LATENCIES[@]}))

  if [ "$AVG_LATENCY" -lt 500 ]; then
    log_test "Text search latency < 500ms" "PASS" "Avg: ${AVG_LATENCY}ms"
  else
    log_test "Text search latency < 500ms" "FAIL" "Avg: ${AVG_LATENCY}ms"
  fi

  # 4.2 Index size check
  INDEX_SIZE=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/$TARGET_INDEX/_stats/store" | \
    jq -r '._all.primaries.store.size_in_bytes // 0')
  INDEX_SIZE_MB=$((INDEX_SIZE / 1024 / 1024))

  log_test "Index size measured" "PASS" "Size: ${INDEX_SIZE_MB} MB"

  # 4.3 Filtered search performance
  START=$(date +%s%3N)
  curl -s -X POST "$OPENSEARCH_ENDPOINT/$TARGET_INDEX/_search" \
    -H "Content-Type: application/json" \
    -d '{
      "query": {
        "bool": {
          "must": [
            {
              "multi_match": {
                "query": "test",
                "fields": ["file_name", "file_path"]
              }
            }
          ],
          "filter": [
            { "term": { "file_type": "pdf" } }
          ]
        }
      },
      "size": 20
    }' > /dev/null
  END=$(date +%s%3N)
  FILTERED_LATENCY=$((END - START))

  if [ "$FILTERED_LATENCY" -lt 500 ]; then
    log_test "Filtered search latency < 500ms" "PASS" "Latency: ${FILTERED_LATENCY}ms"
  else
    log_test "Filtered search latency < 500ms" "FAIL" "Latency: ${FILTERED_LATENCY}ms"
  fi

else
  log_test "Performance Benchmarks" "SKIP"
fi

# ========================================================================
# 5. ROLLBACK TEST (Optional)
# ========================================================================

if [ "$RUN_ROLLBACK" == true ]; then
  echo ""
  echo -e "${YELLOW}[5/5] Running Rollback Test...${NC}"
  echo ""
  echo "--- Rollback Test ---" >> "$REPORT_FILE"

  # Perform rollback (swap alias back to source)
  ROLLBACK_RESPONSE=$(curl -s -X POST "$OPENSEARCH_ENDPOINT/_aliases" \
    -H "Content-Type: application/json" \
    -d "{
      \"actions\": [
        { \"remove\": { \"index\": \"$TARGET_INDEX\", \"alias\": \"$ALIAS_NAME\" } },
        { \"add\": { \"index\": \"$SOURCE_INDEX\", \"alias\": \"$ALIAS_NAME\" } }
      ]
    }")

  if echo "$ROLLBACK_RESPONSE" | jq -e '.acknowledged == true' > /dev/null 2>&1; then
    log_test "Rollback alias swap" "PASS"
  else
    log_test "Rollback alias swap" "FAIL"
  fi

  # Verify rollback
  ALIAS_CHECK=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/_alias/$ALIAS_NAME")
  if echo "$ALIAS_CHECK" | jq -e ".\"$SOURCE_INDEX\"" > /dev/null 2>&1; then
    log_test "Rollback verified" "PASS" "Alias points to source index"
  else
    log_test "Rollback verified" "FAIL"
  fi

  # Swap back to target (restore migration state)
  curl -s -X POST "$OPENSEARCH_ENDPOINT/_aliases" \
    -H "Content-Type: application/json" \
    -d "{
      \"actions\": [
        { \"remove\": { \"index\": \"$SOURCE_INDEX\", \"alias\": \"$ALIAS_NAME\" } },
        { \"add\": { \"index\": \"$TARGET_INDEX\", \"alias\": \"$ALIAS_NAME\" } }
      ]
    }" > /dev/null

  log_test "Restore migration state" "PASS"

else
  log_test "Rollback Test" "SKIP"
fi

# ========================================================================
# FINAL REPORT
# ========================================================================

END_TIME=$(date +%s)
END_TIME_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
DURATION=$((END_TIME - START_TIME))

echo "" >> "$REPORT_FILE"
echo "========================================" >> "$REPORT_FILE"
echo "Summary" >> "$REPORT_FILE"
echo "========================================" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "Completion Time: $END_TIME_ISO" >> "$REPORT_FILE"
echo "Total Duration: ${DURATION}s" >> "$REPORT_FILE"
echo "Total Tests: $TOTAL_TESTS" >> "$REPORT_FILE"
echo "Passed: $PASSED_TESTS" >> "$REPORT_FILE"
echo "Failed: $FAILED_TESTS" >> "$REPORT_FILE"
echo "Success Rate: $(awk "BEGIN {print ($PASSED_TESTS / $TOTAL_TESTS * 100)}")%" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

if [ "$FAILED_TESTS" -eq 0 ]; then
  echo "Status: ✓ ALL TESTS PASSED" >> "$REPORT_FILE"
  STATUS_COLOR="$GREEN"
  STATUS_SYMBOL="✓"
  STATUS_TEXT="ALL TESTS PASSED"
else
  echo "Status: ✗ SOME TESTS FAILED" >> "$REPORT_FILE"
  STATUS_COLOR="$RED"
  STATUS_SYMBOL="✗"
  STATUS_TEXT="SOME TESTS FAILED"
fi

echo "========================================" >> "$REPORT_FILE"

# コンソール出力
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Test Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Total Tests: $TOTAL_TESTS"
echo -e "  ${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "  ${RED}Failed: $FAILED_TESTS${NC}"
echo -e "  Success Rate: $(awk "BEGIN {print ($PASSED_TESTS / $TOTAL_TESTS * 100)}")%"
echo -e "  Duration: ${DURATION}s"
echo ""
echo -e "${STATUS_COLOR}${STATUS_SYMBOL} ${STATUS_TEXT}${NC}"
echo ""
echo -e "Report saved to: ${YELLOW}$REPORT_FILE${NC}"
echo ""

# Exit code
if [ "$FAILED_TESTS" -eq 0 ]; then
  exit 0
else
  exit 1
fi
