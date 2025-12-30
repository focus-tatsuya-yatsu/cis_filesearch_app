#!/bin/bash

###############################################################################
# EC2インスタンス用 OpenSearch マイグレーションスクリプト
#
# このスクリプトはEC2インスタンス内で実行してください
# VPC内からのみOpenSearchエンドポイントにアクセス可能です
#
# 使用方法:
#   1. このスクリプトをEC2インスタンスにコピー
#   2. chmod +x ec2-opensearch-migration.sh
#   3. ./ec2-opensearch-migration.sh
###############################################################################

set -e

# カラー出力
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# OpenSearch設定
OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh5x3uqe.ap-northeast-1.es.amazonaws.com"
INDEX_NAME="cis-files"  # 正しいインデックス名に修正
NEW_INDEX_NAME="${INDEX_NAME}-migrated"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}EC2内 OpenSearch インデックスマッピング修正${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 1. VPC内からの接続確認
echo -e "${YELLOW}[1/7] VPC内からの接続確認...${NC}"
if curl -s -o /dev/null -w "%{http_code}" "$OPENSEARCH_ENDPOINT" | grep -q "200\|403"; then
  echo -e "${GREEN}✓ OpenSearchエンドポイントに接続できます${NC}"
else
  echo -e "${RED}✗ OpenSearchエンドポイントに接続できません${NC}"
  echo -e "${YELLOW}  EC2インスタンスから実行していることを確認してください${NC}"
  exit 1
fi
echo ""

# 2. 既存インデックスの確認
echo -e "${YELLOW}[2/7] 既存インデックスの確認...${NC}"
echo -e "  インデックス一覧:"
curl -s -X GET "$OPENSEARCH_ENDPOINT/_cat/indices?v" | head -10 || true
echo ""

# 特定のインデックスの存在確認
if curl -s -I "$OPENSEARCH_ENDPOINT/$INDEX_NAME" | grep -q "200 OK"; then
  echo -e "${GREEN}✓ インデックス '$INDEX_NAME' が存在します${NC}"

  # ドキュメント数を確認
  DOC_COUNT=$(curl -s "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_count" | jq -r '.count // 0')
  echo -e "  ドキュメント数: $DOC_COUNT"
else
  echo -e "${RED}✗ インデックス '$INDEX_NAME' が見つかりません${NC}"
  echo -e "${YELLOW}  利用可能なインデックスを上記のリストから選択してください${NC}"
  echo ""
  echo -n "使用するインデックス名を入力してください: "
  read INDEX_NAME
  NEW_INDEX_NAME="${INDEX_NAME}-migrated"
fi
echo ""

# 3. 現在のマッピングを確認
echo -e "${YELLOW}[3/7] 現在のマッピングを確認...${NC}"
CURRENT_MAPPING=$(curl -s -X GET "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_mapping")

if echo "$CURRENT_MAPPING" | jq -e ".\"$INDEX_NAME\".mappings.properties.image_embedding" > /dev/null 2>&1; then
  CURRENT_TYPE=$(echo "$CURRENT_MAPPING" | jq -r ".\"$INDEX_NAME\".mappings.properties.image_embedding.type // 'unknown'")
  echo -e "  image_embedding フィールドの現在のタイプ: $CURRENT_TYPE"

  if [ "$CURRENT_TYPE" = "knn_vector" ]; then
    DIMENSIONS=$(echo "$CURRENT_MAPPING" | jq -r ".\"$INDEX_NAME\".mappings.properties.image_embedding.dimension // 0")
    if [ "$DIMENSIONS" = "1024" ]; then
      echo -e "${GREEN}✓ すでにknn_vectorとして正しく設定されています${NC}"
      echo -e "${GREEN}  マイグレーションは不要です${NC}"
      exit 0
    else
      echo -e "${YELLOW}  次元数が異なります: $DIMENSIONS (期待値: 1024)${NC}"
    fi
  fi
else
  echo -e "${YELLOW}  image_embedding フィールドが存在しません${NC}"
fi
echo ""

# 4. バックアップインデックス作成
echo -e "${YELLOW}[4/7] バックアップインデックス作成...${NC}"
BACKUP_INDEX="${INDEX_NAME}-backup-$(date +%Y%m%d-%H%M%S)"
echo -e "  バックアップ先: $BACKUP_INDEX"

# reindexでバックアップ
echo -e "  データをバックアップ中..."
REINDEX_RESPONSE=$(curl -s -X POST "$OPENSEARCH_ENDPOINT/_reindex?wait_for_completion=true" \
  -H "Content-Type: application/json" \
  -d "{
    \"source\": {
      \"index\": \"$INDEX_NAME\"
    },
    \"dest\": {
      \"index\": \"$BACKUP_INDEX\"
    }
  }")

TOTAL_BACKUP=$(echo "$REINDEX_RESPONSE" | jq -r '.total // 0')
echo -e "${GREEN}✓ ${TOTAL_BACKUP}件のドキュメントをバックアップしました${NC}"
echo ""

# 5. 新しいインデックスを作成（正しいマッピングで）
echo -e "${YELLOW}[5/7] 新しいインデックスを作成...${NC}"
echo -e "  インデックス名: $NEW_INDEX_NAME"

CREATE_RESPONSE=$(curl -s -X PUT "$OPENSEARCH_ENDPOINT/$NEW_INDEX_NAME" \
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
  echo -e "${GREEN}✓ 新しいインデックスを作成しました${NC}"
else
  echo -e "${RED}✗ インデックスの作成に失敗しました${NC}"
  echo "$CREATE_RESPONSE" | jq .
  exit 1
fi
echo ""

# 6. データを新しいインデックスにコピー
echo -e "${YELLOW}[6/7] データを新しいインデックスに移行...${NC}"
echo -e "  image_embeddingフィールドは除外します（新規ベクトル化が必要）"

MIGRATE_RESPONSE=$(curl -s -X POST "$OPENSEARCH_ENDPOINT/_reindex?wait_for_completion=true" \
  -H "Content-Type: application/json" \
  -d "{
    \"source\": {
      \"index\": \"$BACKUP_INDEX\",
      \"_source\": {
        \"excludes\": [\"image_embedding\"]
      }
    },
    \"dest\": {
      \"index\": \"$NEW_INDEX_NAME\"
    }
  }")

TOTAL_MIGRATED=$(echo "$MIGRATE_RESPONSE" | jq -r '.total // 0')
echo -e "${GREEN}✓ ${TOTAL_MIGRATED}件のドキュメントを移行しました${NC}"
echo ""

# 7. インデックスエイリアスの更新
echo -e "${YELLOW}[7/7] インデックスエイリアスの更新...${NC}"
echo -e "  古いインデックス: $INDEX_NAME"
echo -e "  新しいインデックス: $NEW_INDEX_NAME"

# 既存のエイリアスを削除して新しいエイリアスを作成
ALIAS_UPDATE=$(curl -s -X POST "$OPENSEARCH_ENDPOINT/_aliases" \
  -H "Content-Type: application/json" \
  -d "{
    \"actions\": [
      {
        \"remove\": {
          \"index\": \"$INDEX_NAME\",
          \"alias\": \"$INDEX_NAME\"
        }
      },
      {
        \"add\": {
          \"index\": \"$NEW_INDEX_NAME\",
          \"alias\": \"$INDEX_NAME\"
        }
      }
    ]
  }" 2>/dev/null || echo "{}")

# エイリアスがなければ、新規作成
if echo "$ALIAS_UPDATE" | jq -e '.error' > /dev/null 2>&1; then
  echo -e "${YELLOW}  エイリアスが存在しないため、新規作成します${NC}"
  curl -s -X POST "$OPENSEARCH_ENDPOINT/_aliases" \
    -H "Content-Type: application/json" \
    -d "{
      \"actions\": [
        {
          \"add\": {
            \"index\": \"$NEW_INDEX_NAME\",
            \"alias\": \"$INDEX_NAME\"
          }
        }
      ]
    }" > /dev/null
fi

echo -e "${GREEN}✓ エイリアスを更新しました${NC}"
echo ""

# 完了
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ OpenSearchマイグレーションが完了しました${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}次のステップ:${NC}"
echo -e "1. アプリケーションの設定を確認:"
echo -e "   - INDEX_NAME: $INDEX_NAME (エイリアス経由でアクセス)"
echo -e "   - 実際のインデックス: $NEW_INDEX_NAME"
echo ""
echo -e "2. 画像ファイルを再度アップロードしてベクトル生成:"
echo -e "   - 既存の画像を再処理する必要があります"
echo -e "   - 新しい画像は自動的に1024次元のベクトルで保存されます"
echo ""
echo -e "3. 古いインデックスの削除（オプション）:"
echo -e "   curl -X DELETE \"$OPENSEARCH_ENDPOINT/$INDEX_NAME-original\""
echo -e "   curl -X DELETE \"$OPENSEARCH_ENDPOINT/$BACKUP_INDEX\""
echo ""
echo -e "${GREEN}バックアップインデックス: $BACKUP_INDEX${NC}"
echo -e "${GREEN}新しいインデックス: $NEW_INDEX_NAME${NC}"
echo ""