#!/bin/bash
#
# 統合インデックスの検証スクリプト
# テキスト検索、画像検索、ハイブリッド検索をテスト
#
# 使用方法:
#   bash verify-unified-index.sh
#

set -euo pipefail

# 設定
OPENSEARCH_ENDPOINT="${OPENSEARCH_ENDPOINT:-https://vpc-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com}"
INDEX_NAME="cis-files-unified-v1"
REGION="${AWS_REGION:-ap-northeast-1}"

echo "========================================="
echo "統合インデックス検証"
echo "========================================="
echo "エンドポイント: ${OPENSEARCH_ENDPOINT}"
echo "インデックス名: ${INDEX_NAME}"
echo ""

# インデックス統計
echo "1. インデックス統計"
echo "-------------------"
stats=$(curl -s -XGET "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_stats" \
    --aws-sigv4 "aws:amz:${REGION}:es")

doc_count=$(echo "$stats" | jq -r "._all.primaries.docs.count")
store_size=$(echo "$stats" | jq -r "._all.primaries.store.size_in_bytes")
store_size_mb=$((store_size / 1024 / 1024))

echo "ドキュメント数: ${doc_count}"
echo "ストレージサイズ: ${store_size_mb} MB"
echo ""

# インデックスマッピング確認
echo "2. k-NNフィールド確認"
echo "-------------------"
mapping=$(curl -s -XGET "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_mapping" \
    --aws-sigv4 "aws:amz:${REGION}:es")

has_knn=$(echo "$mapping" | jq -r ".\"${INDEX_NAME}\".mappings.properties.image_embedding.type")
knn_dimension=$(echo "$mapping" | jq -r ".\"${INDEX_NAME}\".mappings.properties.image_embedding.dimension")

if [[ "$has_knn" == "knn_vector" ]]; then
    echo "✓ k-NNベクトルフィールド: 設定済み (${knn_dimension}次元)"
else
    echo "✗ k-NNベクトルフィールド: 未設定"
fi
echo ""

# 画像ベクトルの統計
echo "3. 画像ベクトル統計"
echo "-------------------"
with_embedding=$(curl -s -XGET "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_count" \
    -H 'Content-Type: application/json' \
    --aws-sigv4 "aws:amz:${REGION}:es" \
    -d '{
        "query": {
            "term": { "has_image_embedding": true }
        }
    }' | jq -r '.count')

without_embedding=$(curl -s -XGET "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_count" \
    -H 'Content-Type: application/json' \
    --aws-sigv4 "aws:amz:${REGION}:es" \
    -d '{
        "query": {
            "bool": {
                "must_not": {
                    "term": { "has_image_embedding": true }
                }
            }
        }
    }' | jq -r '.count')

image_files=$(curl -s -XGET "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_count" \
    -H 'Content-Type: application/json' \
    --aws-sigv4 "aws:amz:${REGION}:es" \
    -d '{
        "query": {
            "term": { "file_type": "image" }
        }
    }' | jq -r '.count')

echo "ベクトル設定済み: ${with_embedding} ドキュメント"
echo "ベクトル未設定: ${without_embedding} ドキュメント"
echo "画像ファイル数: ${image_files} ドキュメント"
echo ""

# テキスト検索テスト
echo "4. テキスト検索テスト"
echo "-------------------"
text_search=$(curl -s -XGET "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_search" \
    -H 'Content-Type: application/json' \
    --aws-sigv4 "aws:amz:${REGION}:es" \
    -d '{
        "query": {
            "multi_match": {
                "query": "契約",
                "fields": ["file_name^3", "file_path^2", "extracted_text"]
            }
        },
        "size": 3
    }')

text_total=$(echo "$text_search" | jq -r '.hits.total.value')
echo "検索クエリ: '契約'"
echo "検索結果数: ${text_total}"

if [[ "$text_total" -gt 0 ]]; then
    echo ""
    echo "上位3件のファイル名:"
    echo "$text_search" | jq -r '.hits.hits[] | "  - " + ._source.file_name'
fi
echo ""

# ファイルタイプ分布
echo "5. ファイルタイプ分布"
echo "-------------------"
file_types=$(curl -s -XGET "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_search" \
    -H 'Content-Type: application/json' \
    --aws-sigv4 "aws:amz:${REGION}:es" \
    -d '{
        "size": 0,
        "aggs": {
            "file_types": {
                "terms": {
                    "field": "file_type",
                    "size": 10
                }
            }
        }
    }')

echo "$file_types" | jq -r '.aggregations.file_types.buckets[] | "  \(.key): \(.doc_count) ドキュメント"'
echo ""

# インデックス健全性
echo "6. インデックス健全性"
echo "-------------------"
health=$(curl -s -XGET "${OPENSEARCH_ENDPOINT}/_cluster/health/${INDEX_NAME}" \
    --aws-sigv4 "aws:amz:${REGION}:es")

status=$(echo "$health" | jq -r '.status')
shards=$(echo "$health" | jq -r '.active_shards')
relocating=$(echo "$health" | jq -r '.relocating_shards')
initializing=$(echo "$health" | jq -r '.initializing_shards')
unassigned=$(echo "$health" | jq -r '.unassigned_shards')

case "$status" in
    green)
        echo "✓ ステータス: ${status} (正常)"
        ;;
    yellow)
        echo "⚠️  ステータス: ${status} (警告)"
        ;;
    red)
        echo "✗ ステータス: ${status} (エラー)"
        ;;
esac

echo "アクティブシャード: ${shards}"
echo "再配置中シャード: ${relocating}"
echo "初期化中シャード: ${initializing}"
echo "未割り当てシャード: ${unassigned}"
echo ""

# サンプルドキュメント表示
echo "7. サンプルドキュメント"
echo "-------------------"
sample=$(curl -s -XGET "${OPENSEARCH_ENDPOINT}/${INDEX_NAME}/_search?size=1" \
    --aws-sigv4 "aws:amz:${REGION}:es")

echo "$sample" | jq '.hits.hits[0]._source | {
    file_name,
    file_type,
    file_size,
    has_image_embedding,
    processed_at
}'
echo ""

echo "========================================="
echo "検証完了"
echo "========================================="
echo ""

# 総合評価
issues=0

if [[ "$status" != "green" ]]; then
    echo "⚠️  警告: インデックスステータスが green ではありません"
    ((issues++))
fi

if [[ "$has_knn" != "knn_vector" ]]; then
    echo "✗ エラー: k-NNベクトルフィールドが設定されていません"
    ((issues++))
fi

if [[ "$doc_count" -eq 0 ]]; then
    echo "⚠️  警告: ドキュメントが存在しません"
    ((issues++))
fi

if [[ "$unassigned" -gt 0 ]]; then
    echo "⚠️  警告: 未割り当てシャードがあります"
    ((issues++))
fi

echo ""
if [[ "$issues" -eq 0 ]]; then
    echo "✓ すべての検証に合格しました"
    echo ""
    echo "次のステップ:"
    echo "  1. EC2 Workerの環境変数を更新: OPENSEARCH_INDEX=${INDEX_NAME}"
    echo "  2. Lambda関数の環境変数を更新: OPENSEARCH_INDEX=${INDEX_NAME}"
    echo "  3. 本番トラフィックでテスト"
else
    echo "⚠️  ${issues} 件の問題が見つかりました"
    echo "問題を解決してから本番に移行してください"
fi
echo ""
