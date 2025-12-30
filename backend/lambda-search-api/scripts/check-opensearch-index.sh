#!/bin/bash
# OpenSearchインデックスの現状確認スクリプト

set -e

# カラー定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 環境変数チェック
if [ -z "$OPENSEARCH_ENDPOINT" ]; then
    echo -e "${RED}Error: OPENSEARCH_ENDPOINT environment variable is not set${NC}"
    exit 1
fi

INDEX_NAME="${1:-file-index-v2-knn}"
OPENSEARCH_URL="https://$OPENSEARCH_ENDPOINT"

echo -e "${BLUE}=== OpenSearch Index Status Check ===${NC}"
echo "Endpoint: $OPENSEARCH_URL"
echo "Index: $INDEX_NAME"
echo ""

# AWS認証情報の確認
echo -e "${YELLOW}Checking AWS credentials...${NC}"
aws sts get-caller-identity > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ AWS credentials valid${NC}"
else
    echo -e "${RED}✗ AWS credentials invalid${NC}"
    exit 1
fi

# 1. インデックスの存在確認
echo -e "\n${YELLOW}1. Checking index existence...${NC}"
aws opensearch describe-index \
    --domain-name $(echo $OPENSEARCH_ENDPOINT | cut -d'.' -f1) \
    --index-name $INDEX_NAME 2>/dev/null || echo "Using direct HTTP request..."

# 2. インデックスの統計情報
echo -e "\n${YELLOW}2. Index statistics:${NC}"
curl -s -X GET "$OPENSEARCH_URL/$INDEX_NAME/_stats?pretty" \
    --aws-sigv4 "aws:amz:ap-northeast-1:es" \
    --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
    | jq '{
        total_docs: ._all.primaries.docs.count,
        total_size: ._all.primaries.store.size_in_bytes,
        total_size_mb: (._all.primaries.store.size_in_bytes / 1024 / 1024 | round)
    }'

# 3. 画像ベクトルの統計
echo -e "\n${YELLOW}3. Image vector statistics:${NC}"
curl -s -X GET "$OPENSEARCH_URL/$INDEX_NAME/_search?pretty" \
    --aws-sigv4 "aws:amz:ap-northeast-1:es" \
    --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
        "size": 0,
        "aggs": {
            "total_docs": {
                "value_count": {
                    "field": "_id"
                }
            },
            "docs_with_vector": {
                "filter": {
                    "exists": {
                        "field": "image_vector"
                    }
                }
            },
            "docs_without_vector": {
                "missing": {
                    "field": "image_vector"
                }
            },
            "image_extensions": {
                "terms": {
                    "field": "file_extension.keyword",
                    "size": 20
                }
            }
        }
    }' | jq '{
        total_documents: .aggregations.total_docs.value,
        docs_with_image_vector: .aggregations.docs_with_vector.doc_count,
        docs_without_image_vector: .aggregations.docs_without_vector.doc_count,
        file_extensions: .aggregations.image_extensions.buckets
    }'

# 4. サンプル画像ファイルの確認
echo -e "\n${YELLOW}4. Sample image documents:${NC}"
curl -s -X GET "$OPENSEARCH_URL/$INDEX_NAME/_search?pretty" \
    --aws-sigv4 "aws:amz:ap-northeast-1:es" \
    --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
        "size": 5,
        "query": {
            "bool": {
                "must": [
                    {
                        "terms": {
                            "file_extension.keyword": [".jpg", ".jpeg", ".png", ".gif"]
                        }
                    }
                ]
            }
        },
        "_source": ["file_name", "file_path", "file_extension", "indexed_at", "image_vector"]
    }' | jq '.hits.hits[] | {
        file_name: ._source.file_name,
        file_path: ._source.file_path,
        has_vector: (._source.image_vector != null),
        indexed_at: ._source.indexed_at
    }'

# 5. ベクトルなし画像ファイルの数
echo -e "\n${YELLOW}5. Images without vectors (by extension):${NC}"
curl -s -X GET "$OPENSEARCH_URL/$INDEX_NAME/_search?pretty" \
    --aws-sigv4 "aws:amz:ap-northeast-1:es" \
    --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
        "size": 0,
        "query": {
            "bool": {
                "must": [
                    {
                        "terms": {
                            "file_extension.keyword": [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"]
                        }
                    }
                ],
                "must_not": [
                    {
                        "exists": {
                            "field": "image_vector"
                        }
                    }
                ]
            }
        },
        "aggs": {
            "by_extension": {
                "terms": {
                    "field": "file_extension.keyword",
                    "size": 10
                }
            },
            "by_path": {
                "terms": {
                    "field": "file_path.keyword",
                    "size": 10
                }
            }
        }
    }' | jq '{
        total_images_without_vector: .hits.total.value,
        by_extension: .aggregations.by_extension.buckets,
        sample_paths: .aggregations.by_path.buckets
    }'

echo -e "\n${GREEN}=== Check Complete ===${NC}"
