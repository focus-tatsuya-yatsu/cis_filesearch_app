#!/bin/bash

###############################################################################
# OpenSearch インデックスマッピング修正スクリプト
#
# 画像ベクトル検索用のフィールドマッピングを設定します
#
# 使用方法:
#   ./scripts/fix-opensearch-mapping.sh
###############################################################################

set -e

# カラー出力
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# OpenSearch設定
OPENSEARCH_ENDPOINT="${OPENSEARCH_ENDPOINT:-https://search-cis-filesearch-dev.ap-northeast-1.es.amazonaws.com}"
INDEX_NAME="file-search-dev"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}OpenSearch インデックスマッピング修正${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 1. 現在のマッピングを確認
echo -e "${YELLOW}[1/4] 現在のマッピングを確認...${NC}"
CURRENT_MAPPING=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_mapping" || echo "{}")

if echo "$CURRENT_MAPPING" | jq -e ".\"$INDEX_NAME\".mappings.properties.image_embedding" > /dev/null 2>&1; then
    CURRENT_TYPE=$(echo "$CURRENT_MAPPING" | jq -r ".\"$INDEX_NAME\".mappings.properties.image_embedding.type // 'unknown'")
    echo -e "${YELLOW}  image_embedding フィールドの現在のタイプ: $CURRENT_TYPE${NC}"

    if [ "$CURRENT_TYPE" = "knn_vector" ]; then
        echo -e "${GREEN}✓ すでにknn_vectorとして設定されています${NC}"

        # 次元数を確認
        DIMENSIONS=$(echo "$CURRENT_MAPPING" | jq -r ".\"$INDEX_NAME\".mappings.properties.image_embedding.dimension // 0")
        if [ "$DIMENSIONS" = "1024" ]; then
            echo -e "${GREEN}✓ 次元数も正しく設定されています (1024次元)${NC}"
            echo -e "${GREEN}  修正は不要です${NC}"
            exit 0
        else
            echo -e "${RED}✗ 次元数が異なります: $DIMENSIONS (期待値: 1024)${NC}"
        fi
    fi
else
    echo -e "${YELLOW}  image_embedding フィールドが存在しません${NC}"
fi

# 2. バックアップインデックス名を生成
BACKUP_INDEX="${INDEX_NAME}-backup-$(date +%Y%m%d-%H%M%S)"
echo ""
echo -e "${YELLOW}[2/4] インデックスをバックアップ...${NC}"
echo -e "  バックアップ先: $BACKUP_INDEX"

# 既存インデックスをバックアップ（reindex）
REINDEX_RESPONSE=$(curl -s -X POST "$OPENSEARCH_ENDPOINT/_reindex" \
  -H "Content-Type: application/json" \
  -d "{
    \"source\": {
      \"index\": \"$INDEX_NAME\"
    },
    \"dest\": {
      \"index\": \"$BACKUP_INDEX\"
    }
  }" || echo "{\"error\": \"Reindex failed\"}")

if echo "$REINDEX_RESPONSE" | jq -e '.failures' > /dev/null 2>&1; then
    echo -e "${RED}✗ バックアップに失敗しました${NC}"
    echo "$REINDEX_RESPONSE" | jq .
    exit 1
fi

echo -e "${GREEN}✓ バックアップ完了${NC}"

# 3. 新しいインデックスマッピングを作成
echo ""
echo -e "${YELLOW}[3/4] 新しいマッピングでインデックスを再作成...${NC}"

# まず既存インデックスを削除
echo -e "  既存インデックスを削除..."
DELETE_RESPONSE=$(curl -s -X DELETE "$OPENSEARCH_ENDPOINT/$INDEX_NAME")

# 新しいマッピングでインデックスを作成
echo -e "  新しいインデックスを作成..."
CREATE_RESPONSE=$(curl -s -X PUT "$OPENSEARCH_ENDPOINT/$INDEX_NAME" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "index": {
        "knn": true,
        "knn.algo_param.ef_search": 100,
        "number_of_shards": 1,
        "number_of_replicas": 1,
        "refresh_interval": "30s"
      },
      "analysis": {
        "analyzer": {
          "custom_analyzer": {
            "type": "custom",
            "tokenizer": "standard",
            "filter": ["lowercase", "asciifolding"]
          }
        }
      }
    },
    "mappings": {
      "properties": {
        "file_name": {
          "type": "text",
          "analyzer": "custom_analyzer",
          "fields": {
            "keyword": {
              "type": "keyword",
              "ignore_above": 256
            }
          }
        },
        "file_path": {
          "type": "text",
          "analyzer": "custom_analyzer",
          "fields": {
            "keyword": {
              "type": "keyword",
              "ignore_above": 512
            }
          }
        },
        "file_type": {
          "type": "keyword"
        },
        "file_size": {
          "type": "long"
        },
        "modified_date": {
          "type": "date"
        },
        "extracted_text": {
          "type": "text",
          "analyzer": "custom_analyzer"
        },
        "image_embedding": {
          "type": "knn_vector",
          "dimension": 1024,
          "method": {
            "name": "hnsw",
            "space_type": "innerproduct",
            "engine": "faiss",
            "parameters": {
              "ef_construction": 128,
              "m": 24
            }
          }
        },
        "metadata": {
          "type": "object",
          "enabled": false
        },
        "s3_location": {
          "type": "keyword"
        },
        "indexed_at": {
          "type": "date"
        }
      }
    }
  }' || echo "{\"error\": \"Create failed\"}")

if echo "$CREATE_RESPONSE" | jq -e '.acknowledged == true' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ インデックスを正しいマッピングで再作成しました${NC}"
else
    echo -e "${RED}✗ インデックスの作成に失敗しました${NC}"
    echo "$CREATE_RESPONSE" | jq .

    # 失敗したら、バックアップから復元を試みる
    echo -e "${YELLOW}  バックアップから復元を試みます...${NC}"
    curl -s -X POST "$OPENSEARCH_ENDPOINT/_reindex" \
      -H "Content-Type: application/json" \
      -d "{
        \"source\": {
          \"index\": \"$BACKUP_INDEX\"
        },
        \"dest\": {
          \"index\": \"$INDEX_NAME\"
        }
      }"
    exit 1
fi

# 4. データを復元（image_embeddingフィールドは除外）
echo ""
echo -e "${YELLOW}[4/4] データを復元...${NC}"

RESTORE_RESPONSE=$(curl -s -X POST "$OPENSEARCH_ENDPOINT/_reindex" \
  -H "Content-Type: application/json" \
  -d "{
    \"source\": {
      \"index\": \"$BACKUP_INDEX\",
      \"_source\": {
        \"excludes\": [\"image_embedding\"]
      }
    },
    \"dest\": {
      \"index\": \"$INDEX_NAME\"
    }
  }" || echo "{\"error\": \"Restore failed\"}")

if echo "$RESTORE_RESPONSE" | jq -e '.failures' > /dev/null 2>&1; then
    echo -e "${RED}✗ データの復元に失敗しました${NC}"
    echo "$RESTORE_RESPONSE" | jq .
    exit 1
fi

TOTAL_RESTORED=$(echo "$RESTORE_RESPONSE" | jq -r '.total // 0')
echo -e "${GREEN}✓ ${TOTAL_RESTORED}件のドキュメントを復元しました${NC}"

# 完了
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ OpenSearchインデックスマッピングの修正が完了しました${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}注意事項:${NC}"
echo -e "  - バックアップインデックス: $BACKUP_INDEX"
echo -e "  - 既存の画像ベクトルデータは削除されました"
echo -e "  - 画像ファイルを再度アップロードして、ベクトルを生成してください"
echo ""
echo -e "${YELLOW}バックアップインデックスの削除（オプション）:${NC}"
echo -e "  curl -X DELETE \"$OPENSEARCH_ENDPOINT/$BACKUP_INDEX\""
echo ""