#!/bin/bash

echo "🔍 OpenSearchインデックスのフィールド構造を確認..."
echo "========================================"

# インデックスのマッピングを確認
echo "📋 file-index-v2-knn インデックスのマッピング:"
curl -s -X GET "https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/file-index-v2-knn/_mapping" \
  -u "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" | jq '."file-index-v2-knn".mappings.properties | keys'

echo ""
echo "📄 実際のドキュメントサンプル (最初の1件):"
curl -s -X POST "https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/file-index-v2-knn/_search" \
  -u "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H "Content-Type: application/json" \
  -d '{
    "size": 1,
    "query": {
      "match_all": {}
    }
  }' | jq '.hits.hits[0]._source | keys'

echo ""
echo "🖼️ 実画像のドキュメント例 (real_で始まるID):"
curl -s -X POST "https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/file-index-v2-knn/_search" \
  -u "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  --aws-sigv4 "aws:amz:ap-northeast-1:es" \
  -H "Content-Type: application/json" \
  -d '{
    "size": 1,
    "query": {
      "prefix": {
        "_id": "real_"
      }
    }
  }' | jq '.hits.hits[0]._source'

echo ""
echo "========================================"
echo "✅ フィールド確認完了"