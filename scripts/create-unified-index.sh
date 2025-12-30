#!/bin/bash
#
# OpenSearch統合インデックス作成スクリプト
# テキスト検索とk-NN画像検索の両方をサポート
#
# 使用方法:
#   bash create-unified-index.sh
#

set -euo pipefail

# 設定
OPENSEARCH_ENDPOINT="${OPENSEARCH_ENDPOINT:-https://vpc-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com}"
INDEX_NAME="cis-files-unified-v1"
REGION="${AWS_REGION:-ap-northeast-1}"

echo "========================================="
echo "OpenSearch統合インデックス作成"
echo "========================================="
echo "エンドポイント: ${OPENSEARCH_ENDPOINT}"
echo "インデックス名: ${INDEX_NAME}"
echo "リージョン: ${REGION}"
echo ""

# インデックスが既に存在するかチェック
echo "既存インデックスをチェック中..."
if curl -s -XGET "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}" \
    --aws-sigv4 "aws:amz:${REGION}:es" 2>/dev/null | grep -q "${INDEX_NAME}"; then
    echo "⚠️  警告: インデックス '${INDEX_NAME}' は既に存在します"
    echo ""
    read -p "既存インデックスを削除して再作成しますか？ (y/N): " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        echo "✗ 中止しました"
        exit 1
    fi

    echo "既存インデックスを削除中..."
    curl -XDELETE "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}" \
        --aws-sigv4 "aws:amz:${REGION}:es"
    echo "✓ 削除完了"
fi

# インデックスマッピング定義
cat > /tmp/unified-index-mapping.json <<'EOF'
{
  "settings": {
    "index": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "refresh_interval": "5s",
      "knn": true,
      "knn.algo_param.ef_search": 512
    },
    "analysis": {
      "analyzer": {
        "japanese_analyzer": {
          "type": "custom",
          "tokenizer": "kuromoji_tokenizer",
          "filter": ["kuromoji_baseform", "lowercase", "cjk_width"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "file_key": {
        "type": "keyword"
      },
      "file_name": {
        "type": "text",
        "analyzer": "japanese_analyzer",
        "fields": {
          "keyword": {
            "type": "keyword"
          }
        }
      },
      "file_path": {
        "type": "text",
        "analyzer": "japanese_analyzer",
        "fields": {
          "keyword": {
            "type": "keyword"
          }
        }
      },
      "file_type": {
        "type": "keyword"
      },
      "mime_type": {
        "type": "keyword"
      },
      "file_size": {
        "type": "long"
      },
      "extracted_text": {
        "type": "text",
        "analyzer": "japanese_analyzer"
      },
      "image_embedding": {
        "type": "knn_vector",
        "dimension": 1024,
        "method": {
          "name": "hnsw",
          "space_type": "innerproduct",
          "engine": "nmslib",
          "parameters": {
            "ef_construction": 512,
            "m": 16
          }
        }
      },
      "has_image_embedding": {
        "type": "boolean"
      },
      "page_count": {
        "type": "integer"
      },
      "word_count": {
        "type": "integer"
      },
      "char_count": {
        "type": "integer"
      },
      "metadata": {
        "type": "object",
        "enabled": true
      },
      "processor_name": {
        "type": "keyword"
      },
      "processor_version": {
        "type": "keyword"
      },
      "processing_time_seconds": {
        "type": "float"
      },
      "processed_at": {
        "type": "date"
      },
      "indexed_at": {
        "type": "date"
      },
      "embedding_generated_at": {
        "type": "date"
      },
      "ocr_confidence": {
        "type": "float"
      },
      "ocr_language": {
        "type": "keyword"
      },
      "bucket": {
        "type": "keyword"
      },
      "s3_url": {
        "type": "keyword"
      },
      "thumbnail_url": {
        "type": "keyword"
      },
      "success": {
        "type": "boolean"
      },
      "error_message": {
        "type": "text"
      }
    }
  }
}
EOF

echo ""
echo "インデックスを作成中..."
response=$(curl -s -w "\n%{http_code}" -XPUT "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}" \
    -H 'Content-Type: application/json' \
    --aws-sigv4 "aws:amz:${REGION}:es" \
    -d @/tmp/unified-index-mapping.json)

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [[ "$http_code" -eq 200 ]]; then
    echo "✓ インデックス作成成功"
    echo ""
    echo "レスポンス:"
    echo "$body" | jq '.'
elif [[ "$http_code" -eq 201 ]]; then
    echo "✓ インデックス作成成功"
    echo ""
    echo "レスポンス:"
    echo "$body" | jq '.'
else
    echo "✗ インデックス作成失敗 (HTTP ${http_code})"
    echo "$body" | jq '.' || echo "$body"
    exit 1
fi

# インデックス確認
echo ""
echo "インデックス設定を確認中..."
curl -s -XGET "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_settings" \
    --aws-sigv4 "aws:amz:${REGION}:es" | jq ".\"${INDEX_NAME}\".settings.index | {number_of_shards, number_of_replicas, knn}"

echo ""
echo "インデックスマッピングを確認中..."
curl -s -XGET "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_mapping" \
    --aws-sigv4 "aws:amz:${REGION}:es" | jq ".\"${INDEX_NAME}\".mappings.properties | keys"

# クリーンアップ
rm -f /tmp/unified-index-mapping.json

echo ""
echo "========================================="
echo "✓ 統合インデックス作成完了"
echo "========================================="
echo ""
echo "次のステップ:"
echo "  1. データマイグレーション: bash migrate-data-to-unified.sh"
echo "  2. EC2 Worker更新: OPENSEARCH_INDEX=${INDEX_NAME}"
echo "  3. Lambda更新: OPENSEARCH_INDEX=${INDEX_NAME}"
echo ""
