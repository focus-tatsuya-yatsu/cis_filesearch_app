#!/bin/bash

# Setup OpenSearch k-NN Plugin and Index Mapping
# This script configures the OpenSearch domain for vector search

set -e

# Configuration
OPENSEARCH_ENDPOINT="${OPENSEARCH_ENDPOINT:-https://search-cis-filesearch-opensearch-xxxx.ap-northeast-1.es.amazonaws.com}"
INDEX_NAME="${INDEX_NAME:-cis-files}"
AWS_REGION="${AWS_REGION:-ap-northeast-1}"

echo "======================================"
echo "OpenSearch k-NN Setup"
echo "======================================"
echo "Endpoint: $OPENSEARCH_ENDPOINT"
echo "Index: $INDEX_NAME"
echo "Region: $AWS_REGION"
echo "======================================"

# Helper function to make signed requests to OpenSearch
opensearch_request() {
    local method=$1
    local path=$2
    local data=$3

    if [ -z "$data" ]; then
        awscurl --service es --region "$AWS_REGION" \
            -X "$method" \
            "$OPENSEARCH_ENDPOINT/$path"
    else
        awscurl --service es --region "$AWS_REGION" \
            -X "$method" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "$OPENSEARCH_ENDPOINT/$path"
    fi
}

# Step 1: Check if k-NN plugin is installed
echo ""
echo "[1/5] Checking k-NN plugin status..."
plugin_status=$(opensearch_request GET "_cat/plugins?v" | grep -i "opensearch-knn" || true)

if [ -z "$plugin_status" ]; then
    echo "ERROR: k-NN plugin is not installed on the OpenSearch domain"
    echo "Please enable k-NN plugin in the OpenSearch domain settings"
    exit 1
else
    echo "k-NN plugin is installed:"
    echo "$plugin_status"
fi

# Step 2: Check if index exists
echo ""
echo "[2/5] Checking if index exists..."
if opensearch_request HEAD "$INDEX_NAME" > /dev/null 2>&1; then
    echo "Index '$INDEX_NAME' already exists"
    read -p "Do you want to update the mapping? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Skipping index creation"
        exit 0
    fi
    UPDATE_MODE=true
else
    echo "Index '$INDEX_NAME' does not exist. Will create."
    UPDATE_MODE=false
fi

# Step 3: Create index with k-NN settings (if not exists)
if [ "$UPDATE_MODE" = false ]; then
    echo ""
    echo "[3/5] Creating index with k-NN enabled..."

    INDEX_SETTINGS='{
      "settings": {
        "index": {
          "knn": true,
          "knn.algo_param.ef_search": 512,
          "number_of_shards": 2,
          "number_of_replicas": 1,
          "refresh_interval": "5s"
        },
        "analysis": {
          "analyzer": {
            "default": {
              "type": "standard",
              "stopwords": "_none_"
            }
          }
        }
      },
      "mappings": {
        "properties": {
          "file_name": {
            "type": "text",
            "fields": {
              "keyword": {
                "type": "keyword",
                "ignore_above": 256
              }
            }
          },
          "file_path": {
            "type": "text",
            "fields": {
              "keyword": {
                "type": "keyword",
                "ignore_above": 1024
              }
            }
          },
          "file_type": {
            "type": "keyword"
          },
          "file_size": {
            "type": "long"
          },
          "mime_type": {
            "type": "keyword"
          },
          "extracted_text": {
            "type": "text"
          },
          "processed_at": {
            "type": "date"
          },
          "created_at": {
            "type": "date"
          },
          "updated_at": {
            "type": "date"
          },
          "image_embedding": {
            "type": "knn_vector",
            "dimension": 512,
            "method": {
              "name": "hnsw",
              "space_type": "cosinesimil",
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
          "thumbnail_url": {
            "type": "keyword"
          },
          "s3_bucket": {
            "type": "keyword"
          },
          "s3_key": {
            "type": "keyword"
          }
        }
      }
    }'

    opensearch_request PUT "$INDEX_NAME" "$INDEX_SETTINGS"
    echo "Index created successfully with k-NN mapping"

else
    # Update existing index mapping
    echo ""
    echo "[3/5] Updating index mapping..."

    UPDATE_MAPPING='{
      "properties": {
        "image_embedding": {
          "type": "knn_vector",
          "dimension": 512,
          "method": {
            "name": "hnsw",
            "space_type": "cosinesimil",
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
        "thumbnail_url": {
          "type": "keyword"
        }
      }
    }'

    opensearch_request PUT "$INDEX_NAME/_mapping" "$UPDATE_MAPPING"
    echo "Index mapping updated successfully"
fi

# Step 4: Verify index settings
echo ""
echo "[4/5] Verifying index configuration..."
opensearch_request GET "$INDEX_NAME/_settings" | jq '.[] | .settings.index | {knn, knn_algo_param_ef_search: .["knn.algo_param.ef_search"]}'

# Step 5: Verify mapping
echo ""
echo "[5/5] Verifying index mapping..."
opensearch_request GET "$INDEX_NAME/_mapping" | jq '.[] | .mappings.properties | {image_embedding, has_image_embedding, thumbnail_url}'

echo ""
echo "======================================"
echo "Setup completed successfully!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Deploy the image embedding Lambda function"
echo "2. Update the search Lambda to support vector queries"
echo "3. Re-index existing images to generate embeddings"
echo ""
echo "Test k-NN search:"
echo "curl -X POST \"$OPENSEARCH_ENDPOINT/$INDEX_NAME/_search\" -H 'Content-Type: application/json' -d '"
echo '{
  "size": 5,
  "query": {
    "script_score": {
      "query": {"match_all": {}},
      "script": {
        "source": "knn_score",
        "lang": "knn",
        "params": {
          "field": "image_embedding",
          "query_value": [0.1, 0.2, ...],
          "space_type": "cosinesimil"
        }
      }
    }
  }
}'
echo "'"
