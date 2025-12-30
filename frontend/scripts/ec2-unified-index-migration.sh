#!/bin/bash

# EC2上で実行する統合インデックス移行スクリプト
# AWS Systems Manager Session Managerを使用して実行

echo "==================================="
echo "統合インデックス移行プロセス開始"
echo "==================================="

ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
SOURCE_INDEX="cis-files"
TARGET_INDEX="cis-files-unified"

# ステップ1: 統合インデックスの作成
echo ""
echo "ステップ1: 統合インデックスの作成"
echo "==================================="

# 既存の統合インデックスを削除（もし存在する場合）
echo "既存インデックスの確認と削除..."
curl -X DELETE "$ENDPOINT/$TARGET_INDEX" 2>/dev/null

# 統合インデックスの作成
echo "統合インデックスを作成中..."
curl -X PUT "$ENDPOINT/$TARGET_INDEX" \
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
echo "統合インデックス作成完了！"

# ステップ2: データ移行
echo ""
echo "ステップ2: データ移行"
echo "==================================="

# 移行前のドキュメント数を確認
echo "移行前のドキュメント数を確認中..."
SOURCE_COUNT=$(curl -s "$ENDPOINT/$SOURCE_INDEX/_count" | python3 -c "import sys, json; print(json.load(sys.stdin).get('count', 0))")
echo "移行元のドキュメント数: $SOURCE_COUNT"

# Reindex APIを使用してデータを移行
echo ""
echo "データ移行を開始します..."
curl -X POST "$ENDPOINT/_reindex" \
  -H "Content-Type: application/json" \
  -d "{
    \"source\": {
      \"index\": \"$SOURCE_INDEX\"
    },
    \"dest\": {
      \"index\": \"$TARGET_INDEX\"
    }
  }"

# 移行後のドキュメント数を確認
echo ""
echo "移行後のドキュメント数を確認中..."
sleep 5
TARGET_COUNT=$(curl -s "$ENDPOINT/$TARGET_INDEX/_count" | python3 -c "import sys, json; print(json.load(sys.stdin).get('count', 0))")
echo "移行先のドキュメント数: $TARGET_COUNT"

# ステップ3: エイリアスの更新
echo ""
echo "ステップ3: エイリアスの更新"
echo "==================================="

# 現在のエイリアスを削除して新しいインデックスに付け替え
echo "エイリアスを更新中..."
curl -X POST "$ENDPOINT/_aliases" \
  -H "Content-Type: application/json" \
  -d "{
    \"actions\": [
      {
        \"remove\": {
          \"index\": \"$SOURCE_INDEX\",
          \"alias\": \"search-index\"
        }
      },
      {
        \"add\": {
          \"index\": \"$TARGET_INDEX\",
          \"alias\": \"search-index\"
        }
      }
    ]
  }"

echo ""
echo "==================================="
echo "移行プロセス完了！"
echo "移行されたドキュメント: $TARGET_COUNT 件"
echo ""
echo "次のステップ:"
echo "1. Lambda環境変数を cis-files-unified に更新"
echo "2. EC2 Worker設定を cis-files-unified に更新"
echo "==================================="