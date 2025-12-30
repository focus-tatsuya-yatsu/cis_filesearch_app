#!/bin/bash

###############################################################################
# OpenSearch インデックスマッピング修正スクリプト（ゼロダウンタイム版）
#
# Blue-Green Deployment戦略で画像ベクトル検索用のフィールドマッピングを設定
#
# 使用方法:
#   ./scripts/fix-opensearch-mapping-zero-downtime.sh
#
# 手順:
#   1. 新しいマッピングで一時インデックスを作成
#   2. データを一時インデックスにコピー
#   3. エイリアスを切り替え（ゼロダウンタイム）
#   4. 古いインデックスを削除（オプション）
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
ALIAS_NAME="file-search" # アプリケーションはエイリアスを使用する想定
NEW_INDEX="${INDEX_NAME}-v2-$(date +%Y%m%d-%H%M%S)"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}OpenSearch インデックスマッピング修正（ゼロダウンタイム）${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}設定:${NC}"
echo -e "  OpenSearch: $OPENSEARCH_ENDPOINT"
echo -e "  現在のインデックス: $INDEX_NAME"
echo -e "  新しいインデックス: $NEW_INDEX"
echo -e "  エイリアス: $ALIAS_NAME"
echo ""

# 1. 現在のインデックス状態を確認
echo -e "${YELLOW}[1/6] 現在のインデックス状態を確認...${NC}"
CURRENT_MAPPING=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_mapping" || echo "{}")

if echo "$CURRENT_MAPPING" | jq -e ".\"$INDEX_NAME\"" > /dev/null 2>&1; then
    DOC_COUNT=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_count" | jq -r '.count // 0')
    echo -e "${GREEN}✓ 現在のインデックス: $INDEX_NAME (ドキュメント数: $DOC_COUNT)${NC}"

    # 既存のimage_embeddingフィールドをチェック
    if echo "$CURRENT_MAPPING" | jq -e ".\"$INDEX_NAME\".mappings.properties.image_embedding" > /dev/null 2>&1; then
        CURRENT_TYPE=$(echo "$CURRENT_MAPPING" | jq -r ".\"$INDEX_NAME\".mappings.properties.image_embedding.type // 'unknown'")
        DIMENSIONS=$(echo "$CURRENT_MAPPING" | jq -r ".\"$INDEX_NAME\".mappings.properties.image_embedding.dimension // 0")
        echo -e "${YELLOW}  image_embedding: タイプ=$CURRENT_TYPE, 次元数=$DIMENSIONS${NC}"

        if [ "$CURRENT_TYPE" = "knn_vector" ] && [ "$DIMENSIONS" = "1024" ]; then
            echo -e "${GREEN}✓ マッピングは既に正しく設定されています${NC}"
            echo -e "${YELLOW}  続行しますか？ (y/N): ${NC}"
            read -r CONFIRM
            if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
                echo -e "${BLUE}キャンセルしました${NC}"
                exit 0
            fi
        fi
    fi
else
    echo -e "${YELLOW}  インデックスが存在しません: $INDEX_NAME${NC}"
    DOC_COUNT=0
fi

# 2. 新しいインデックスを作成（最適化されたマッピング）
echo ""
echo -e "${YELLOW}[2/6] 新しいインデックスを作成...${NC}"
echo -e "  インデックス名: $NEW_INDEX"

# 最適化されたマッピング設定
# - engine: faiss（大規模データセット向け、nmslibより高速）
# - space_type: innerproduct（正規化済みベクトルに最適）
# - ef_construction: 128（バランス型）
# - m: 24（バランス型）
CREATE_RESPONSE=$(curl -s -X PUT "$OPENSEARCH_ENDPOINT/$NEW_INDEX" \
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
        "processed_at": {
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
  }' || echo '{"error": "Create failed"}')

if echo "$CREATE_RESPONSE" | jq -e '.acknowledged == true' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ 新しいインデックスを作成しました${NC}"
    echo -e "${GREEN}  - エンジン: FAISS (高性能)${NC}"
    echo -e "${GREEN}  - 距離関数: Inner Product (正規化済みベクトル最適化)${NC}"
    echo -e "${GREEN}  - HNSW: ef_construction=128, m=24 (バランス型)${NC}"
else
    echo -e "${RED}✗ インデックスの作成に失敗しました${NC}"
    echo "$CREATE_RESPONSE" | jq .
    exit 1
fi

# 3. データを新しいインデックスにコピー（image_embeddingフィールドは除外）
echo ""
echo -e "${YELLOW}[3/6] データを新しいインデックスにコピー...${NC}"

if [ "$DOC_COUNT" -gt 0 ]; then
    echo -e "  コピー元: $INDEX_NAME ($DOC_COUNT ドキュメント)"
    echo -e "  コピー先: $NEW_INDEX"
    echo -e "  ${YELLOW}注意: image_embeddingフィールドは除外されます${NC}"

    REINDEX_RESPONSE=$(curl -s -X POST "$OPENSEARCH_ENDPOINT/_reindex?wait_for_completion=false" \
      -H "Content-Type: application/json" \
      -d "{
        \"source\": {
          \"index\": \"$INDEX_NAME\",
          \"_source\": {
            \"excludes\": [\"image_embedding\"]
          }
        },
        \"dest\": {
          \"index\": \"$NEW_INDEX\"
        }
      }" || echo '{"error": "Reindex failed"}')

    # タスクIDを取得
    TASK_ID=$(echo "$REINDEX_RESPONSE" | jq -r '.task // empty')

    if [ -n "$TASK_ID" ]; then
        echo -e "${GREEN}✓ Reindexタスクを開始しました (Task ID: $TASK_ID)${NC}"
        echo -e "  進行状況を監視中..."

        # タスクの完了を待つ
        while true; do
            TASK_STATUS=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/_tasks/$TASK_ID")
            COMPLETED=$(echo "$TASK_STATUS" | jq -r '.completed // false')

            if [ "$COMPLETED" = "true" ]; then
                TOTAL=$(echo "$TASK_STATUS" | jq -r '.task.status.total // 0')
                CREATED=$(echo "$TASK_STATUS" | jq -r '.task.status.created // 0')
                echo -e "${GREEN}✓ Reindex完了: $CREATED/$TOTAL ドキュメント${NC}"
                break
            fi

            CURRENT=$(echo "$TASK_STATUS" | jq -r '.task.status.created // 0')
            TOTAL=$(echo "$TASK_STATUS" | jq -r '.task.status.total // 0')
            echo -e "  進行中: $CURRENT/$TOTAL ドキュメント"
            sleep 2
        done
    else
        echo -e "${YELLOW}  同期モードでReindexを実行します...${NC}"
        REINDEX_RESPONSE=$(curl -s -X POST "$OPENSEARCH_ENDPOINT/_reindex" \
          -H "Content-Type: application/json" \
          -d "{
            \"source\": {
              \"index\": \"$INDEX_NAME\",
              \"_source\": {
                \"excludes\": [\"image_embedding\"]
              }
            },
            \"dest\": {
              \"index\": \"$NEW_INDEX\"
            }
          }")

        TOTAL_REINDEXED=$(echo "$REINDEX_RESPONSE" | jq -r '.total // 0')
        echo -e "${GREEN}✓ $TOTAL_REINDEXED ドキュメントをコピーしました${NC}"
    fi
else
    echo -e "${YELLOW}  コピーするドキュメントがありません${NC}"
fi

# 4. 新しいインデックスをリフレッシュ
echo ""
echo -e "${YELLOW}[4/6] インデックスをリフレッシュ...${NC}"
curl -s -X POST "$OPENSEARCH_ENDPOINT/$NEW_INDEX/_refresh" > /dev/null
echo -e "${GREEN}✓ リフレッシュ完了${NC}"

# 5. エイリアスを切り替え（アトミック操作）
echo ""
echo -e "${YELLOW}[5/6] エイリアスを切り替え（ゼロダウンタイム）...${NC}"

# 既存のエイリアスを確認
ALIAS_EXISTS=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/_alias/$ALIAS_NAME" | jq -r 'keys | length')

if [ "$ALIAS_EXISTS" -gt 0 ]; then
    echo -e "  既存のエイリアス '$ALIAS_NAME' を切り替えます"

    # アトミックにエイリアスを切り替え
    ALIAS_RESPONSE=$(curl -s -X POST "$OPENSEARCH_ENDPOINT/_aliases" \
      -H "Content-Type: application/json" \
      -d "{
        \"actions\": [
          { \"remove\": { \"index\": \"$INDEX_NAME\", \"alias\": \"$ALIAS_NAME\" } },
          { \"add\": { \"index\": \"$NEW_INDEX\", \"alias\": \"$ALIAS_NAME\" } }
        ]
      }")
else
    echo -e "  新しいエイリアス '$ALIAS_NAME' を作成します"

    # 新しいエイリアスを作成
    ALIAS_RESPONSE=$(curl -s -X POST "$OPENSEARCH_ENDPOINT/_aliases" \
      -H "Content-Type: application/json" \
      -d "{
        \"actions\": [
          { \"add\": { \"index\": \"$NEW_INDEX\", \"alias\": \"$ALIAS_NAME\" } }
        ]
      }")
fi

if echo "$ALIAS_RESPONSE" | jq -e '.acknowledged == true' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ エイリアスの切り替えが完了しました${NC}"
    echo -e "${GREEN}  アプリケーションは中断なく新しいインデックスを使用しています${NC}"
else
    echo -e "${RED}✗ エイリアスの切り替えに失敗しました${NC}"
    echo "$ALIAS_RESPONSE" | jq .
    exit 1
fi

# 6. 古いインデックスの削除（オプション）
echo ""
echo -e "${YELLOW}[6/6] 古いインデックスの処理...${NC}"
echo -e "${YELLOW}  古いインデックス '$INDEX_NAME' を削除しますか？${NC}"
echo -e "${YELLOW}  (削除前にバックアップが推奨されます)${NC}"
echo -e "  選択肢:"
echo -e "    y) 今すぐ削除"
echo -e "    n) 保持（手動で削除）"
echo -e "    r) インデックス名を変更してバックアップ"
read -r -p "  選択 (y/N/r): " DELETE_CHOICE

case "$DELETE_CHOICE" in
    [Yy]*)
        echo -e "  ${YELLOW}古いインデックスを削除中...${NC}"
        DELETE_RESPONSE=$(curl -s -X DELETE "$OPENSEARCH_ENDPOINT/$INDEX_NAME")
        if echo "$DELETE_RESPONSE" | jq -e '.acknowledged == true' > /dev/null 2>&1; then
            echo -e "${GREEN}✓ 古いインデックスを削除しました${NC}"
        else
            echo -e "${RED}✗ 削除に失敗しました${NC}"
            echo "$DELETE_RESPONSE" | jq .
        fi
        ;;
    [Rr]*)
        BACKUP_NAME="${INDEX_NAME}-backup-$(date +%Y%m%d-%H%M%S)"
        echo -e "  ${YELLOW}バックアップ名: $BACKUP_NAME${NC}"
        REINDEX_BACKUP=$(curl -s -X POST "$OPENSEARCH_ENDPOINT/_reindex" \
          -H "Content-Type: application/json" \
          -d "{
            \"source\": { \"index\": \"$INDEX_NAME\" },
            \"dest\": { \"index\": \"$BACKUP_NAME\" }
          }")

        if echo "$REINDEX_BACKUP" | jq -e '.failures | length == 0' > /dev/null 2>&1; then
            echo -e "${GREEN}✓ バックアップを作成しました: $BACKUP_NAME${NC}"
            curl -s -X DELETE "$OPENSEARCH_ENDPOINT/$INDEX_NAME" > /dev/null
            echo -e "${GREEN}✓ 古いインデックスを削除しました${NC}"
        fi
        ;;
    *)
        echo -e "${YELLOW}  古いインデックスを保持します${NC}"
        echo -e "${YELLOW}  手動削除コマンド:${NC}"
        echo -e "    curl -X DELETE \"$OPENSEARCH_ENDPOINT/$INDEX_NAME\""
        ;;
esac

# 完了
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ OpenSearchインデックスマッピングの修正が完了しました${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}サマリー:${NC}"
echo -e "  新しいインデックス: $NEW_INDEX"
echo -e "  エイリアス: $ALIAS_NAME"
echo -e "  エンジン: FAISS"
echo -e "  距離関数: Inner Product"
echo -e "  HNSW設定: ef_construction=128, m=24"
echo -e "  ドキュメント数: $(curl -s -X GET "$OPENSEARCH_ENDPOINT/$NEW_INDEX/_count" | jq -r '.count // 0')"
echo ""
echo -e "${YELLOW}次のステップ:${NC}"
echo -e "  1. アプリケーションが '$ALIAS_NAME' エイリアスを使用していることを確認"
echo -e "  2. 画像ファイルを再アップロードして、ベクトルを生成"
echo -e "  3. 画像検索機能をテスト"
echo ""
echo -e "${YELLOW}マッピング確認:${NC}"
echo -e "  curl -X GET \"$OPENSEARCH_ENDPOINT/$NEW_INDEX/_mapping\" | jq ."
echo ""
