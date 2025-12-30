#!/bin/bash
#
# OpenSearchインデックス診断スクリプト（VPC内から実行）
#
# 使用方法:
#   1. EC2インスタンスまたはLambda関数から実行
#   2. AWS認証情報が自動的に使用される（IAMロール）
#
# 実行:
#   bash diagnose-opensearch-from-vpc.sh

set -e

# 色付きログ
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}OpenSearch インデックス診断${NC}"
echo -e "${GREEN}========================================${NC}\n"

# 環境変数確認
if [ -z "$OPENSEARCH_ENDPOINT" ]; then
    echo -e "${RED}ERROR: OPENSEARCH_ENDPOINT環境変数が設定されていません${NC}"
    exit 1
fi

OPENSEARCH_INDEX="${OPENSEARCH_INDEX:-file-index}"
AWS_REGION="${AWS_REGION:-ap-northeast-1}"

echo "設定情報:"
echo "  Endpoint: $OPENSEARCH_ENDPOINT"
echo "  Index: $OPENSEARCH_INDEX"
echo "  Region: $AWS_REGION"
echo ""

# AWS SigV4認証用のcurl関数
aws_curl() {
    local method=$1
    local url=$2
    local data=$3

    if [ -n "$data" ]; then
        aws --region $AWS_REGION \
            opensearch-serverless request \
            --method $method \
            --url "$OPENSEARCH_ENDPOINT$url" \
            --data "$data"
    else
        aws --region $AWS_REGION \
            opensearch-serverless request \
            --method $method \
            --url "$OPENSEARCH_ENDPOINT$url"
    fi
}

# 1. 接続テスト
echo -e "${YELLOW}[1] 接続テスト${NC}"
echo "---"
if response=$(curl -s -w "\n%{http_code}" "$OPENSEARCH_ENDPOINT" \
    --aws-sigv4 "aws:amz:$AWS_REGION:es" \
    --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" 2>&1); then
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    if [ "$http_code" = "200" ]; then
        echo -e "${GREEN}✅ 接続成功${NC}"
        echo "OpenSearchバージョン: $(echo "$body" | jq -r '.version.number')"
    else
        echo -e "${RED}❌ 接続失敗: HTTP $http_code${NC}"
        echo "$body"
    fi
else
    echo -e "${RED}❌ 接続エラー${NC}"
fi
echo ""

# 2. クラスター情報
echo -e "${YELLOW}[2] クラスター情報${NC}"
echo "---"
if response=$(curl -s "$OPENSEARCH_ENDPOINT/_cluster/health" \
    --aws-sigv4 "aws:amz:$AWS_REGION:es" \
    --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"); then
    echo "  ステータス: $(echo "$response" | jq -r '.status')"
    echo "  ノード数: $(echo "$response" | jq -r '.number_of_nodes')"
    echo "  データノード数: $(echo "$response" | jq -r '.number_of_data_nodes')"
    echo "  アクティブシャード: $(echo "$response" | jq -r '.active_shards')"

    status=$(echo "$response" | jq -r '.status')
    if [ "$status" = "green" ]; then
        echo -e "  ${GREEN}✅ クラスター正常${NC}"
    elif [ "$status" = "yellow" ]; then
        echo -e "  ${YELLOW}⚠️ クラスター警告状態${NC}"
    else
        echo -e "  ${RED}❌ クラスター異常${NC}"
    fi
else
    echo -e "${RED}❌ クラスター情報取得失敗${NC}"
fi
echo ""

# 3. インデックスの存在確認
echo -e "${YELLOW}[3] インデックスの存在確認${NC}"
echo "---"
if response=$(curl -s -w "\n%{http_code}" "$OPENSEARCH_ENDPOINT/$OPENSEARCH_INDEX" \
    --aws-sigv4 "aws:amz:$AWS_REGION:es" \
    --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"); then
    http_code=$(echo "$response" | tail -n1)

    if [ "$http_code" = "200" ]; then
        echo -e "${GREEN}✅ インデックス '$OPENSEARCH_INDEX' が存在します${NC}"
    else
        echo -e "${RED}❌ インデックス '$OPENSEARCH_INDEX' が存在しません (HTTP $http_code)${NC}"
    fi
else
    echo -e "${RED}❌ インデックス確認エラー${NC}"
fi
echo ""

# 4. インデックス設定
echo -e "${YELLOW}[4] インデックス設定${NC}"
echo "---"
if response=$(curl -s "$OPENSEARCH_ENDPOINT/$OPENSEARCH_INDEX/_settings" \
    --aws-sigv4 "aws:amz:$AWS_REGION:es" \
    --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"); then
    echo "  シャード数: $(echo "$response" | jq -r ".[\"$OPENSEARCH_INDEX\"].settings.index.number_of_shards")"
    echo "  レプリカ数: $(echo "$response" | jq -r ".[\"$OPENSEARCH_INDEX\"].settings.index.number_of_replicas")"

    knn_enabled=$(echo "$response" | jq -r ".[\"$OPENSEARCH_INDEX\"].settings.index.knn")
    if [ "$knn_enabled" = "true" ]; then
        echo -e "  ${GREEN}✅ k-NN設定: 有効${NC}"
    elif [ "$knn_enabled" = "null" ] || [ "$knn_enabled" = "false" ]; then
        echo -e "  ${RED}❌ k-NN設定: 無効または未設定${NC}"
    fi
else
    echo -e "${RED}❌ 設定取得エラー${NC}"
fi
echo ""

# 5. インデックスマッピング
echo -e "${YELLOW}[5] インデックスマッピング${NC}"
echo "---"
if response=$(curl -s "$OPENSEARCH_ENDPOINT/$OPENSEARCH_INDEX/_mapping" \
    --aws-sigv4 "aws:amz:$AWS_REGION:es" \
    --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"); then
    echo "  フィールド一覧:"

    # 重要なフィールドをチェック
    critical_fields=("file_name" "file_path" "file_type" "file_size" "processed_at" "extracted_text" "image_embedding" "s3_key")

    for field in "${critical_fields[@]}"; do
        field_type=$(echo "$response" | jq -r ".[\"$OPENSEARCH_INDEX\"].mappings.properties.$field.type")

        if [ "$field_type" != "null" ]; then
            echo -e "    ${GREEN}✅ $field${NC}: $field_type"

            # image_embeddingの詳細確認
            if [ "$field" = "image_embedding" ]; then
                dimension=$(echo "$response" | jq -r ".[\"$OPENSEARCH_INDEX\"].mappings.properties.$field.dimension")
                space_type=$(echo "$response" | jq -r ".[\"$OPENSEARCH_INDEX\"].mappings.properties.$field.method.space_type")

                echo "       - dimensions: $dimension"
                echo "       - space_type: $space_type"

                if [ "$field_type" = "knn_vector" ] && [ "$dimension" = "1024" ]; then
                    echo -e "       ${GREEN}✅ 設定正常${NC}"
                else
                    echo -e "       ${RED}❌ 設定異常 (期待: knn_vector, 1024次元)${NC}"
                fi
            fi
        else
            echo -e "    ${RED}❌ $field${NC}: 存在しません"
        fi
    done
else
    echo -e "${RED}❌ マッピング取得エラー${NC}"
fi
echo ""

# 6. ドキュメント統計
echo -e "${YELLOW}[6] ドキュメント統計${NC}"
echo "---"
if response=$(curl -s "$OPENSEARCH_ENDPOINT/$OPENSEARCH_INDEX/_count" \
    --aws-sigv4 "aws:amz:$AWS_REGION:es" \
    --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"); then
    total_count=$(echo "$response" | jq -r '.count')
    echo "  総ドキュメント数: $total_count"

    if [ "$total_count" -eq 0 ]; then
        echo -e "  ${YELLOW}⚠️  インデックスが空です${NC}"
    else
        # image_embeddingを持つドキュメント数
        if embedding_response=$(curl -s "$OPENSEARCH_ENDPOINT/$OPENSEARCH_INDEX/_count" \
            -H "Content-Type: application/json" \
            -d '{"query": {"exists": {"field": "image_embedding"}}}' \
            --aws-sigv4 "aws:amz:$AWS_REGION:es" \
            --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"); then
            embedding_count=$(echo "$embedding_response" | jq -r '.count')
            echo "  画像ベクトルを持つドキュメント: $embedding_count"

            if [ "$embedding_count" -eq 0 ]; then
                echo -e "  ${RED}❌ 画像ベクトルを持つドキュメントが0件です！${NC}"
            else
                percentage=$(awk "BEGIN {printf \"%.2f\", ($embedding_count/$total_count)*100}")
                echo "  画像ベクトル保有率: $percentage%"

                if (( $(echo "$percentage < 50" | bc -l) )); then
                    echo -e "  ${YELLOW}⚠️  保有率が低いです${NC}"
                else
                    echo -e "  ${GREEN}✅ 保有率正常${NC}"
                fi
            fi
        fi
    fi
else
    echo -e "${RED}❌ ドキュメント数取得エラー${NC}"
fi
echo ""

# 7. サンプルドキュメント
echo -e "${YELLOW}[7] サンプルドキュメント${NC}"
echo "---"
if response=$(curl -s "$OPENSEARCH_ENDPOINT/$OPENSEARCH_INDEX/_search" \
    -H "Content-Type: application/json" \
    -d '{"size": 3, "query": {"match_all": {}}}' \
    --aws-sigv4 "aws:amz:$AWS_REGION:es" \
    --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY"); then
    hits=$(echo "$response" | jq -r '.hits.hits')
    hit_count=$(echo "$hits" | jq 'length')

    echo "  取得件数: $hit_count"

    for i in $(seq 0 $((hit_count - 1))); do
        echo ""
        echo "  サンプル $((i + 1)):"
        echo "    ID: $(echo "$hits" | jq -r ".[$i]._id")"
        echo "    ファイル名: $(echo "$hits" | jq -r ".[$i]._source.file_name")"
        echo "    ファイルタイプ: $(echo "$hits" | jq -r ".[$i]._source.file_type")"
        echo "    処理日時: $(echo "$hits" | jq -r ".[$i]._source.processed_at")"

        has_embedding=$(echo "$hits" | jq -r ".[$i]._source.image_embedding != null")
        if [ "$has_embedding" = "true" ]; then
            embedding_length=$(echo "$hits" | jq ".[$i]._source.image_embedding | length")
            echo -e "    image_embedding: ${GREEN}存在 ($embedding_length次元)${NC}"
        else
            echo -e "    image_embedding: ${RED}存在しない${NC}"
        fi

        echo "    s3_key: $(echo "$hits" | jq -r ".[$i]._source.s3_key")"
    done
else
    echo -e "${RED}❌ サンプル取得エラー${NC}"
fi
echo ""

# 8. k-NN検索テスト
echo -e "${YELLOW}[8] k-NN検索テスト${NC}"
echo "---"

# ランダムな1024次元ベクトル生成（Pythonを使用）
test_vector=$(python3 -c "import random; import json; print(json.dumps([random.random() for _ in range(1024)]))")

if response=$(curl -s "$OPENSEARCH_ENDPOINT/$OPENSEARCH_INDEX/_search" \
    -H "Content-Type: application/json" \
    -d "{\"size\": 5, \"query\": {\"knn\": {\"image_embedding\": {\"vector\": $test_vector, \"k\": 5}}}}" \
    --aws-sigv4 "aws:amz:$AWS_REGION:es" \
    --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" 2>&1); then

    # エラーチェック
    error=$(echo "$response" | jq -r '.error.type // empty')
    if [ -n "$error" ]; then
        echo -e "${RED}❌ k-NN検索エラー: $error${NC}"
        echo "$response" | jq '.error'
    else
        result_count=$(echo "$response" | jq -r '.hits.hits | length')
        echo "  k-NN検索結果: $result_count件"

        if [ "$result_count" -gt 0 ]; then
            echo -e "  ${GREEN}✅ k-NN検索が正常に動作しています${NC}"

            for i in $(seq 0 $((result_count - 1))); do
                file_name=$(echo "$response" | jq -r ".hits.hits[$i]._source.file_name")
                score=$(echo "$response" | jq -r ".hits.hits[$i]._score")
                echo "    $((i + 1)). $file_name (score: $score)"
            done
        else
            echo -e "  ${YELLOW}⚠️  k-NN検索で結果が返りません${NC}"
        fi
    fi
else
    echo -e "${RED}❌ k-NN検索テスト失敗${NC}"
fi
echo ""

# 診断結果サマリー
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}診断結果サマリー${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "診断完了: $(date)"
echo ""
echo "次のステップ:"
echo "  1. エラーがある場合は、OPENSEARCH_IMAGE_SEARCH_DIAGNOSTIC_REPORT.mdを参照"
echo "  2. インデックスマッピング修正が必要な場合は、Phase 2の手順を実行"
echo "  3. ドキュメントにimage_embeddingがない場合は、Phase 3-4の手順を実行"
echo ""
