#!/bin/bash

# Sample Image Data Indexing Script
# テスト用のサンプル画像データをOpenSearchにインデックス

set -e

# 色付きログ出力
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_debug() {
    echo -e "${BLUE}[DEBUG]${NC} $1"
}

# デフォルト値
COUNT=${1:-10}
INDEX_NAME="${2:-file-index-v2-knn}"

# 環境変数の読み込み
if [ -f .env.local ]; then
    export $(grep -E '^OPENSEARCH_|^AWS_' .env.local | xargs)
fi

OPENSEARCH_ENDPOINT="${OPENSEARCH_ENDPOINT:-https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com}"

log_info "サンプル画像データのインデックス登録を開始します"
log_info "エンドポイント: $OPENSEARCH_ENDPOINT"
log_info "インデックス: $INDEX_NAME"
log_info "登録数: $COUNT"

# ランダムな1024次元ベクトルを生成する関数
generate_random_vector() {
    python3 -c "
import random
import json
vector = [random.uniform(-1, 1) for _ in range(1024)]
print(json.dumps(vector))
"
}

# ファイルタイプのリスト
FILE_TYPES=("jpg" "png" "pdf" "docx" "xlsx")

# サンプルファイル名のプレフィックス
FILE_PREFIXES=("report" "presentation" "screenshot" "diagram" "photo" "document" "image" "scan" "figure" "chart")

# サンプルディレクトリパス
DIRECTORIES=("/shared/projects/2024" "/shared/marketing/assets" "/shared/engineering/docs" "/shared/hr/policies" "/shared/finance/reports")

# 一括インデックス用のNDJSONデータを生成
log_info "サンプルデータを生成しています..."
BULK_DATA=""

for i in $(seq 1 $COUNT); do
    # ランダムなファイル情報を生成
    FILE_TYPE=${FILE_TYPES[$RANDOM % ${#FILE_TYPES[@]}]}
    FILE_PREFIX=${FILE_PREFIXES[$RANDOM % ${#FILE_PREFIXES[@]}]}
    DIRECTORY=${DIRECTORIES[$RANDOM % ${#DIRECTORIES[@]}]}
    FILE_NAME="${FILE_PREFIX}_$(printf "%04d" $i).${FILE_TYPE}"
    FILE_PATH="${DIRECTORY}/${FILE_NAME}"
    FILE_SIZE=$((RANDOM * 1000 + 1024))

    # 現在の日時から過去1年以内のランダムな日時を生成
    DAYS_AGO=$((RANDOM % 365))
    if [ "$(uname)" = "Darwin" ]; then
        MODIFIED_DATE=$(date -v-${DAYS_AGO}d -u +"%Y-%m-%dT%H:%M:%SZ")
    else
        MODIFIED_DATE=$(date -u -d "${DAYS_AGO} days ago" +"%Y-%m-%dT%H:%M:%SZ")
    fi

    # ランダムな埋め込みベクトルを生成
    VECTOR=$(generate_random_vector)

    # Bulk API用のアクション行とドキュメント行を作成
    ACTION_LINE='{"index":{"_index":"'$INDEX_NAME'","_id":"sample-image-'$i'"}}'
    DOC_LINE=$(cat <<EOF
{
  "file_name": "$FILE_NAME",
  "file_path": "$FILE_PATH",
  "file_type": "$FILE_TYPE",
  "file_size": $FILE_SIZE,
  "modified_date": "$MODIFIED_DATE",
  "extracted_text": "Sample text content for $FILE_NAME. This is a test document for image similarity search.",
  "image_embedding": $VECTOR,
  "metadata": {
    "source": "sample_generator",
    "indexed_by": "index-sample-images.sh",
    "test_data": true
  },
  "s3_location": "s3://cis-filesearch-storage/samples/$FILE_NAME",
  "indexed_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
)

    BULK_DATA="${BULK_DATA}${ACTION_LINE}\n${DOC_LINE}\n"

    if [ $((i % 10)) -eq 0 ]; then
        log_debug "生成済み: $i/$COUNT"
    fi
done

# 一括インデックス登録
log_info "OpenSearchにデータを送信しています..."
RESPONSE=$(echo -e "$BULK_DATA" | curl -X POST "$OPENSEARCH_ENDPOINT/_bulk" \
    -H 'Content-Type: application/x-ndjson' \
    --data-binary @- 2>/dev/null)

# 結果の確認
if echo "$RESPONSE" | grep -q '"errors":false'; then
    log_info "✅ $COUNT 件のサンプルデータが正常にインデックスされました"
else
    log_error "一部のドキュメントのインデックスに失敗しました:"
    echo "$RESPONSE" | python3 -m json.tool | head -50
fi

# インデックスの更新
log_info "インデックスを更新しています..."
curl -X POST "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_refresh" 2>/dev/null

# インデックス内のドキュメント数を確認
log_info "インデックス内のドキュメント数を確認しています..."
DOC_COUNT=$(curl -s "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_count" 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin).get('count', 0))")
log_info "現在のドキュメント数: $DOC_COUNT"

# テスト検索の実行
log_info "テスト検索を実行しています..."
TEST_VECTOR=$(generate_random_vector)
SEARCH_QUERY=$(cat <<EOF
{
  "size": 3,
  "query": {
    "knn": {
      "image_embedding": {
        "vector": $TEST_VECTOR,
        "k": 3
      }
    }
  },
  "_source": ["file_name", "file_path", "file_type"]
}
EOF
)

log_debug "k-NN検索クエリを送信..."
SEARCH_RESPONSE=$(echo "$SEARCH_QUERY" | curl -X POST "$OPENSEARCH_ENDPOINT/$INDEX_NAME/_search" \
    -H 'Content-Type: application/json' \
    --data-binary @- 2>/dev/null)

if echo "$SEARCH_RESPONSE" | grep -q '"hits":{'; then
    log_info "✅ k-NN検索が正常に動作しています"
    echo "$SEARCH_RESPONSE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
hits = data.get('hits', {}).get('hits', [])
print('\n検索結果 (上位3件):')
for i, hit in enumerate(hits[:3], 1):
    source = hit.get('_source', {})
    score = hit.get('_score', 0)
    print(f'{i}. {source.get(\"file_name\", \"Unknown\")} (Score: {score:.4f})')
    print(f'   Path: {source.get(\"file_path\", \"Unknown\")}')
"
else
    log_warning "k-NN検索の実行に問題がある可能性があります:"
    echo "$SEARCH_RESPONSE" | python3 -m json.tool | head -20
fi

log_info "✅ サンプルデータのインデックス登録が完了しました"
log_info "次のステップ: ブラウザで http://localhost:3000/test-image-search.html を開いて画像検索をテストしてください"