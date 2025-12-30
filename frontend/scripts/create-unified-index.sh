#!/bin/bash

# 統合インデックス作成スクリプト
# テキスト検索と画像検索の両方をサポートするインデックスを作成

ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
INDEX_NAME="cis-files-unified"

echo "==================================="
echo "統合インデックス作成開始"
echo "インデックス名: $INDEX_NAME"
echo "==================================="

# 既存の統合インデックスを削除（もし存在する場合）
echo "既存インデックスの確認と削除..."
curl -X DELETE "$ENDPOINT/$INDEX_NAME" 2>/dev/null

# 統合インデックスの作成
echo "統合インデックスを作成中..."
curl -X PUT "$ENDPOINT/$INDEX_NAME" \
  -H "Content-Type: application/json" \
  -d '{
  "settings": {
    "index": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "knn": true,
      "knn.algo_param.ef_search": 100
    },
    "analysis": {
      "analyzer": {
        "japanese_analyzer": {
          "type": "custom",
          "tokenizer": "kuromoji_tokenizer",
          "filter": [
            "kuromoji_baseform",
            "kuromoji_part_of_speech",
            "cjk_width",
            "ja_stop",
            "kuromoji_stemmer",
            "lowercase"
          ]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "file_path": {
        "type": "keyword"
      },
      "file_name": {
        "type": "text",
        "analyzer": "japanese_analyzer",
        "fields": {
          "keyword": {
            "type": "keyword"
          },
          "raw": {
            "type": "text",
            "analyzer": "standard"
          }
        }
      },
      "content": {
        "type": "text",
        "analyzer": "japanese_analyzer"
      },
      "file_type": {
        "type": "keyword"
      },
      "file_size": {
        "type": "long"
      },
      "created_date": {
        "type": "date"
      },
      "modified_date": {
        "type": "date"
      },
      "department": {
        "type": "keyword"
      },
      "tags": {
        "type": "keyword"
      },
      "image_embedding": {
        "type": "knn_vector",
        "dimension": 1024,
        "method": {
          "engine": "nmslib",
          "space_type": "cosinesimil",
          "name": "hnsw",
          "parameters": {
            "ef_construction": 512,
            "m": 16
          }
        }
      },
      "has_image_embedding": {
        "type": "boolean"
      },
      "embedding_created_at": {
        "type": "date"
      },
      "mime_type": {
        "type": "keyword"
      },
      "ocr_text": {
        "type": "text",
        "analyzer": "japanese_analyzer"
      }
    }
  }
}'

echo ""
echo "インデックス作成完了！"
echo ""

# インデックスの確認
echo "インデックス情報を確認中..."
curl -X GET "$ENDPOINT/$INDEX_NAME/_settings?pretty"

echo ""
echo "==================================="
echo "統合インデックスの作成が完了しました"
echo "次のステップ: migrate-data-to-unified.sh を実行してデータを移行"
echo "==================================="