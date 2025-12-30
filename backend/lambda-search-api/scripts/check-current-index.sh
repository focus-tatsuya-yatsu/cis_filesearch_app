#!/bin/bash

# 現在のインデックス状態を確認するスクリプト

OPENSEARCH_ENDPOINT="vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
INDEX_NAME="file-index-v2-knn"

echo "======================================"
echo "📊 OpenSearchインデックスの現状確認"
echo "======================================"

echo ""
echo "1️⃣ インデックスの統計情報:"
aws opensearch describe-domain --domain-name cis-filesearch-opensearch --region ap-northeast-1 \
  --query 'DomainStatus.Processing' --output text || echo "ドメイン情報取得失敗"

echo ""
echo "2️⃣ ドキュメント数を確認:"
curl -s -X GET "https://${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_count" \
  -H "Content-Type: application/json" | jq '.'

echo ""
echo "3️⃣ サンプルドキュメント（最初の3件）:"
curl -s -X GET "https://${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "size": 3,
    "_source": ["fileName", "filePath", "fileType", "fileSize"]
  }' | jq '.hits.hits[]._source'

echo ""
echo "4️⃣ sample_で始まるファイルの数:"
curl -s -X POST "https://${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_count" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "wildcard": {
        "fileName": "sample_*"
      }
    }
  }' | jq '.count'

echo ""
echo "======================================"
echo "✅ 確認完了"
echo "======================================"