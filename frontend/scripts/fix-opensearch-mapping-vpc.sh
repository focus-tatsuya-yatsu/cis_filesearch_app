#!/bin/bash

###############################################################################
# OpenSearch インデックスマッピング修正スクリプト (VPC Version)
#
# 画像ベクトル検索用のフィールドマッピングを設定します
# ⚠️ このスクリプトはVPC内のEC2インスタンスから実行してください
#
# 使用方法:
#   1. EC2インスタンスにSSH接続
#   2. 環境変数を設定（または.envファイルを配置）
#   3. ./fix-opensearch-mapping-vpc.sh
###############################################################################

set -e

# カラー出力
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# OpenSearch設定（環境変数から取得、デフォルト値あり）
OPENSEARCH_ENDPOINT="${OPENSEARCH_ENDPOINT:-https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com}"
INDEX_NAME="${OPENSEARCH_INDEX:-file-index}"  # 環境変数から取得

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}OpenSearch インデックスマッピング修正${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}Endpoint: ${OPENSEARCH_ENDPOINT}${NC}"
echo -e "${YELLOW}Index Name: ${INDEX_NAME}${NC}"
echo ""

# 接続確認
echo -e "${YELLOW}[0/5] OpenSearch接続確認...${NC}"
HEALTH_CHECK=$(curl -s -w "%{http_code}" -X GET "$OPENSEARCH_ENDPOINT/_cluster/health" -o /tmp/health.json)

if [ "$HEALTH_CHECK" != "200" ]; then
    echo -e "${RED}✗ OpenSearchに接続できません (HTTP: $HEALTH_CHECK)${NC}"
    echo -e "${RED}  このスクリプトはVPC内のEC2インスタンスから実行する必要があります${NC}"
    exit 1
fi

echo -e "${GREEN}✓ OpenSearch接続成功${NC}"
cat /tmp/health.json | jq .

# 1. 現在のマッピングを確認
echo ""
echo -e "${YELLOW}[1/5] 現在のマッピングを確認...${NC}"
CURRENT_MAPPING=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_mapping" 2>&1)

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

# ドキュメント数を確認
DOC_COUNT=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_count" | jq -r '.count // 0')
echo -e "${BLUE}  現在のドキュメント数: ${DOC_COUNT}${NC}"

# 確認プロンプト
echo ""
echo -e "${YELLOW}⚠️  WARNING: この操作により以下が実行されます:${NC}"
echo -e "  1. インデックス '${INDEX_NAME}' のバックアップ作成"
echo -e "  2. 既存インデックスの削除"
echo -e "  3. 新しいマッピングでインデックス再作成"
echo -e "  4. データの復元（image_embeddingフィールドは除外）"
echo ""
read -p "続行しますか？ (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo -e "${YELLOW}操作をキャンセルしました${NC}"
    exit 0
fi

# 2. バックアップインデックス名を生成
BACKUP_INDEX="${INDEX_NAME}-backup-$(date +%Y%m%d-%H%M%S)"
echo ""
echo -e "${YELLOW}[2/5] インデックスをバックアップ...${NC}"
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
  }")

if echo "$REINDEX_RESPONSE" | jq -e '.failures | length > 0' > /dev/null 2>&1; then
    echo -e "${RED}✗ バックアップに失敗しました${NC}"
    echo "$REINDEX_RESPONSE" | jq .
    exit 1
fi

BACKED_UP_DOCS=$(echo "$REINDEX_RESPONSE" | jq -r '.total // 0')
echo -e "${GREEN}✓ バックアップ完了 (${BACKED_UP_DOCS} documents)${NC}"

# 3. 新しいインデックスマッピングを作成
echo ""
echo -e "${YELLOW}[3/5] 新しいマッピングでインデックスを再作成...${NC}"

# まず既存インデックスを削除
echo -e "  既存インデックスを削除..."
DELETE_RESPONSE=$(curl -s -w "%{http_code}" -X DELETE "$OPENSEARCH_ENDPOINT/$INDEX_NAME" -o /tmp/delete.json)

if [ "$DELETE_RESPONSE" = "200" ]; then
    echo -e "${GREEN}  ✓ インデックス削除成功${NC}"
else
    echo -e "${YELLOW}  ⚠ インデックス削除レスポンス: $DELETE_RESPONSE${NC}"
    cat /tmp/delete.json | jq .
fi

# 少し待機
sleep 2

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
  }')

if echo "$CREATE_RESPONSE" | jq -e '.acknowledged == true' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ インデックスを正しいマッピングで再作成しました${NC}"
else
    echo -e "${RED}✗ インデックスの作成に失敗しました${NC}"
    echo "$CREATE_RESPONSE" | jq .

    # 失敗したら、バックアップから復元を試みる
    echo -e "${YELLOW}  バックアップから復元を試みます...${NC}"
    ROLLBACK=$(curl -s -X POST "$OPENSEARCH_ENDPOINT/_reindex" \
      -H "Content-Type: application/json" \
      -d "{
        \"source\": {
          \"index\": \"$BACKUP_INDEX\"
        },
        \"dest\": {
          \"index\": \"$INDEX_NAME\"
        }
      }")

    if echo "$ROLLBACK" | jq -e '.total > 0' > /dev/null 2>&1; then
        echo -e "${GREEN}  ✓ ロールバック成功${NC}"
    else
        echo -e "${RED}  ✗ ロールバック失敗 - 手動復元が必要です${NC}"
        echo -e "${RED}  バックアップインデックス: $BACKUP_INDEX${NC}"
    fi
    exit 1
fi

# 少し待機
sleep 2

# 4. データを復元（image_embeddingフィールドは除外）
echo ""
echo -e "${YELLOW}[4/5] データを復元...${NC}"

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
  }")

if echo "$RESTORE_RESPONSE" | jq -e '.failures | length > 0' > /dev/null 2>&1; then
    echo -e "${RED}✗ データの復元に失敗しました${NC}"
    echo "$RESTORE_RESPONSE" | jq .
    exit 1
fi

TOTAL_RESTORED=$(echo "$RESTORE_RESPONSE" | jq -r '.total // 0')
echo -e "${GREEN}✓ ${TOTAL_RESTORED}件のドキュメントを復元しました${NC}"

# 5. 検証
echo ""
echo -e "${YELLOW}[5/5] 検証...${NC}"

# マッピング確認
VERIFY_MAPPING=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_mapping")
VECTOR_TYPE=$(echo "$VERIFY_MAPPING" | jq -r ".\"$INDEX_NAME\".mappings.properties.image_embedding.type // 'not found'")
DIMENSIONS=$(echo "$VERIFY_MAPPING" | jq -r ".\"$INDEX_NAME\".mappings.properties.image_embedding.dimension // 0")

if [ "$VECTOR_TYPE" = "knn_vector" ] && [ "$DIMENSIONS" = "1024" ]; then
    echo -e "${GREEN}✓ マッピング検証成功${NC}"
    echo -e "  Type: ${VECTOR_TYPE}"
    echo -e "  Dimensions: ${DIMENSIONS}"
else
    echo -e "${RED}✗ マッピング検証失敗${NC}"
    echo -e "  Type: ${VECTOR_TYPE} (expected: knn_vector)"
    echo -e "  Dimensions: ${DIMENSIONS} (expected: 1024)"
fi

# ドキュメント数確認
VERIFY_COUNT=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_count" | jq -r '.count // 0')
echo -e "${BLUE}  復元後のドキュメント数: ${VERIFY_COUNT}/${DOC_COUNT}${NC}"

# 完了
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ OpenSearchインデックスマッピングの修正が完了しました${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}次のステップ:${NC}"
echo -e "  1. 画像ファイルを再度アップロードして、ベクトルを生成"
echo -e "  2. 画像検索機能のテスト"
echo ""
echo -e "${YELLOW}バックアップ情報:${NC}"
echo -e "  インデックス名: ${BACKUP_INDEX}"
echo -e "  ドキュメント数: ${BACKED_UP_DOCS}"
echo ""
echo -e "${YELLOW}バックアップ削除（確認後、任意）:${NC}"
echo -e "  curl -X DELETE \"${OPENSEARCH_ENDPOINT}/${BACKUP_INDEX}\""
echo ""
