#!/bin/bash

###############################################################################
# OpenSearch State Recovery Check Script
#
# VPC内のEC2インスタンスから実行して、現在のOpenSearch状態を確認します
###############################################################################

set -e

# カラー出力
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# OpenSearch設定（環境変数から取得）
OPENSEARCH_ENDPOINT="${OPENSEARCH_ENDPOINT:-https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com}"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}OpenSearch State Recovery Check${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Endpoint: ${OPENSEARCH_ENDPOINT}${NC}"
echo ""

# 1. クラスターヘルスチェック
echo -e "${YELLOW}[1/4] Cluster Health Check${NC}"
HEALTH=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/_cluster/health" 2>&1)

if echo "$HEALTH" | jq . > /dev/null 2>&1; then
    echo -e "${GREEN}✓ OpenSearch is accessible${NC}"
    echo "$HEALTH" | jq '{status, number_of_nodes, number_of_data_nodes}'
else
    echo -e "${RED}✗ Cannot access OpenSearch${NC}"
    echo "$HEALTH"
    exit 1
fi

# 2. 全インデックスのリスト
echo ""
echo -e "${YELLOW}[2/4] List All Indices${NC}"
INDICES=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/_cat/indices?v&format=json" 2>&1)

if echo "$INDICES" | jq . > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Found indices:${NC}"
    echo "$INDICES" | jq -r '.[] | "\(.index) - \(.docs.count // 0) docs - \(.health)"' | while read line; do
        if [[ $line == *"file"* ]] || [[ $line == *"cis"* ]]; then
            echo -e "${BLUE}  → $line${NC}"
        else
            echo -e "  $line"
        fi
    done
else
    echo -e "${RED}✗ Failed to list indices${NC}"
    echo "$INDICES"
fi

# 3. 特定のインデックス存在確認
echo ""
echo -e "${YELLOW}[3/4] Check Specific Indices${NC}"

for INDEX_NAME in "file-index" "file-search-dev" "cis-files" "file-search-dev-backup-20251218-101015"; do
    echo -e "${BLUE}Checking: ${INDEX_NAME}${NC}"

    INDEX_INFO=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME" 2>&1)

    if echo "$INDEX_INFO" | jq . > /dev/null 2>&1; then
        if echo "$INDEX_INFO" | jq -e ".[\"$INDEX_NAME\"]" > /dev/null 2>&1; then
            # インデックスが存在
            DOC_COUNT=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_count" | jq -r '.count // 0')
            echo -e "${GREEN}  ✓ EXISTS - Document count: ${DOC_COUNT}${NC}"

            # マッピング確認
            MAPPING=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_mapping")
            if echo "$MAPPING" | jq -e ".[\"$INDEX_NAME\"].mappings.properties.image_embedding" > /dev/null 2>&1; then
                VECTOR_TYPE=$(echo "$MAPPING" | jq -r ".[\"$INDEX_NAME\"].mappings.properties.image_embedding.type // 'not set'")
                DIMENSIONS=$(echo "$MAPPING" | jq -r ".[\"$INDEX_NAME\"].mappings.properties.image_embedding.dimension // 'N/A'")
                echo -e "${BLUE}    image_embedding: type=${VECTOR_TYPE}, dimension=${DIMENSIONS}${NC}"
            else
                echo -e "${YELLOW}    ⚠ image_embedding field not found${NC}"
            fi
        else
            echo -e "${YELLOW}  ✗ NOT FOUND${NC}"
        fi
    else
        echo -e "${YELLOW}  ✗ NOT FOUND or ERROR${NC}"
    fi
    echo ""
done

# 4. 推奨アクション
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Recommended Actions:${NC}"
echo ""
echo -e "1. ${GREEN}バックアップが存在する場合:${NC}"
echo -e "   → 元のインデックスが削除されていても、バックアップから復元可能です"
echo ""
echo -e "2. ${GREEN}正しいインデックス名を確認:${NC}"
echo -e "   → 環境変数 OPENSEARCH_INDEX の値に合わせてください"
echo -e "   → 現在の設定: OPENSEARCH_INDEX=file-index"
echo ""
echo -e "3. ${GREEN}migration スクリプトを修正して再実行:${NC}"
echo -e "   → INDEX_NAME を正しい値に設定"
echo -e "   → VPC内のEC2インスタンスから実行"
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
