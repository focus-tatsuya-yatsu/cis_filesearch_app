#!/bin/bash

# =============================================================================
# OpenSearch Data Verification Script
# =============================================================================
# このスクリプトはOpenSearchにデータが正しく格納されているか確認します
#
# 使用方法:
#   chmod +x check_opensearch.sh
#   ./check_opensearch.sh
# =============================================================================

set -e

# Configuration
OPENSEARCH_ENDPOINT="search-file-metadata-hb5myqe7ckgzjr5bvxz7kswxey.ap-northeast-1.es.amazonaws.com"
INDEX_NAME="file-metadata"
REGION="ap-northeast-1"

# ANSI color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         OpenSearch Data Verification                           ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# 1. クラスターヘルス
echo -e "${GREEN}1. Cluster Health${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
curl -s -XGET "https://$OPENSEARCH_ENDPOINT/_cluster/health?pretty" | jq '.'
echo ""

# 2. インデックス統計
echo -e "${GREEN}2. Index Statistics${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
INDEX_STATS=$(curl -s -XGET "https://$OPENSEARCH_ENDPOINT/$INDEX_NAME/_stats?pretty")
DOC_COUNT=$(echo "$INDEX_STATS" | jq -r '._all.primaries.docs.count // 0')
STORE_SIZE=$(echo "$INDEX_STATS" | jq -r '._all.primaries.store.size_in_bytes // 0')
STORE_SIZE_MB=$(awk "BEGIN {printf \"%.2f\", $STORE_SIZE / 1024 / 1024}")

echo -e "  Total Documents: ${YELLOW}$DOC_COUNT${NC}"
echo -e "  Index Size: ${YELLOW}$STORE_SIZE_MB MB${NC}"
echo ""

# 3. 最近のドキュメント
echo -e "${GREEN}3. Recent Documents (Last 5)${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
curl -s -XGET "https://$OPENSEARCH_ENDPOINT/$INDEX_NAME/_search?pretty" \
  -H 'Content-Type: application/json' \
  -d '{
    "size": 5,
    "sort": [{"last_modified": {"order": "desc"}}],
    "_source": ["file_path", "file_name", "file_size", "last_modified"]
  }' | jq '.hits.hits[] | {path: ._source.file_path, name: ._source.file_name, size: ._source.file_size, modified: ._source.last_modified}'
echo ""

# 4. ファイルタイプ別の集計
echo -e "${GREEN}4. File Type Distribution${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
curl -s -XGET "https://$OPENSEARCH_ENDPOINT/$INDEX_NAME/_search?pretty" \
  -H 'Content-Type: application/json' \
  -d '{
    "size": 0,
    "aggs": {
      "file_types": {
        "terms": {
          "field": "file_extension.keyword",
          "size": 10
        }
      }
    }
  }' | jq '.aggregations.file_types.buckets[] | {extension: .key, count: .doc_count}'
echo ""

# 5. 最近1時間のインデックス速度
echo -e "${GREEN}5. Indexing Rate (Last Hour)${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ONE_HOUR_AGO=$(date -u -v-1H '+%Y-%m-%dT%H:%M:%S')
RECENT_DOCS=$(curl -s -XGET "https://$OPENSEARCH_ENDPOINT/$INDEX_NAME/_count?pretty" \
  -H 'Content-Type: application/json' \
  -d "{
    \"query\": {
      \"range\": {
        \"last_modified\": {
          \"gte\": \"$ONE_HOUR_AGO\"
        }
      }
    }
  }" | jq -r '.count // 0')

echo -e "  Documents indexed in last hour: ${YELLOW}$RECENT_DOCS${NC}"
RATE=$(awk "BEGIN {printf \"%.2f\", $RECENT_DOCS / 3600}")
echo -e "  Average rate: ${YELLOW}$RATE${NC} docs/sec"
echo ""

# 6. インデックスヘルス
echo -e "${GREEN}6. Index Health${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
curl -s -XGET "https://$OPENSEARCH_ENDPOINT/_cat/indices/$INDEX_NAME?v&h=health,status,index,docs.count,store.size&pretty"
echo ""

# 7. サンプル検索テスト
echo -e "${GREEN}7. Sample Search Test${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
SEARCH_RESULT=$(curl -s -XGET "https://$OPENSEARCH_ENDPOINT/$INDEX_NAME/_search?pretty" \
  -H 'Content-Type: application/json' \
  -d '{
    "size": 1,
    "query": {
      "match_all": {}
    }
  }')

TOTAL_HITS=$(echo "$SEARCH_RESULT" | jq -r '.hits.total.value // 0')
SEARCH_TIME=$(echo "$SEARCH_RESULT" | jq -r '.took // 0')

echo -e "  Total searchable documents: ${YELLOW}$TOTAL_HITS${NC}"
echo -e "  Search time: ${YELLOW}$SEARCH_TIME ms${NC}"
echo ""

# 8. Summary
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                     Summary                                    ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo -e "  ${GREEN}✓${NC} Total Documents: ${YELLOW}$DOC_COUNT${NC}"
echo -e "  ${GREEN}✓${NC} Index Size: ${YELLOW}$STORE_SIZE_MB MB${NC}"
echo -e "  ${GREEN}✓${NC} Recent Indexing Rate: ${YELLOW}$RATE${NC} docs/sec"
echo -e "  ${GREEN}✓${NC} Search Performance: ${YELLOW}$SEARCH_TIME ms${NC}"
echo ""

# ヘルスチェック
if [ "$DOC_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ OpenSearch is receiving data successfully${NC}"
else
    echo -e "${RED}⚠️  WARNING: No documents found in OpenSearch${NC}"
fi
