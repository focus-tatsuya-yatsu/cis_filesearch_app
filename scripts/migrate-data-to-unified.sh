#!/bin/bash
#
# 既存データを統合インデックスへマイグレーション
# cis-files → cis-files-unified-v1
#
# 使用方法:
#   bash migrate-data-to-unified.sh
#

set -euo pipefail

# 設定
OPENSEARCH_ENDPOINT="${OPENSEARCH_ENDPOINT:-https://vpc-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com}"
SOURCE_INDEX="cis-files"
TARGET_INDEX="cis-files-unified-v1"
REGION="${AWS_REGION:-ap-northeast-1}"

echo "========================================="
echo "OpenSearchデータマイグレーション"
echo "========================================="
echo "エンドポイント: ${OPENSEARCH_ENDPOINT}"
echo "ソース: ${SOURCE_INDEX}"
echo "ターゲット: ${TARGET_INDEX}"
echo "リージョン: ${REGION}"
echo ""

# ソースインデックスの存在確認
echo "ソースインデックスをチェック中..."
if ! curl -s -XGET "${OPENSEARCH_ENDPOINT}/${SOURCE_INDEX}/_count" \
    --aws-sigv4 "aws:amz:${REGION}:es" 2>/dev/null | grep -q "count"; then
    echo "✗ エラー: ソースインデックス '${SOURCE_INDEX}' が見つかりません"
    exit 1
fi

source_count=$(curl -s -XGET "${OPENSEARCH_ENDPOINT}/${SOURCE_INDEX}/_count" \
    --aws-sigv4 "aws:amz:${REGION}:es" | jq -r '.count')
echo "✓ ソースドキュメント数: ${source_count}"

# ターゲットインデックスの存在確認
echo "ターゲットインデックスをチェック中..."
if ! curl -s -XGET "${OPENSEARCH_ENDPOINT}/${TARGET_INDEX}" \
    --aws-sigv4 "aws:amz:${REGION}:es" 2>/dev/null | grep -q "${TARGET_INDEX}"; then
    echo "✗ エラー: ターゲットインデックス '${TARGET_INDEX}' が見つかりません"
    echo "先に create-unified-index.sh を実行してください"
    exit 1
fi
echo "✓ ターゲットインデックス確認完了"

# マイグレーション確認
echo ""
read -p "${source_count}件のドキュメントをマイグレーションしますか？ (y/N): " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "✗ 中止しました"
    exit 0
fi

echo ""
echo "========================================="
echo "Reindexジョブを開始します"
echo "========================================="

# Reindex実行（非同期）
echo "Reindexリクエストを送信中..."
response=$(curl -s -w "\n%{http_code}" -XPOST "${OPENSEARCH_ENDPOINT}/_reindex?wait_for_completion=false" \
    -H 'Content-Type: application/json' \
    --aws-sigv4 "aws:amz:${REGION}:es" \
    -d '{
        "source": {
            "index": "'"${SOURCE_INDEX}"'",
            "size": 500
        },
        "dest": {
            "index": "'"${TARGET_INDEX}"'"
        },
        "script": {
            "source": "if (ctx._source.image_embedding == null) { ctx._source.image_embedding = null; ctx._source.has_image_embedding = false; } else { ctx._source.has_image_embedding = true; }",
            "lang": "painless"
        }
    }')

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]]; then
    task_id=$(echo "$body" | jq -r '.task')
    echo "✓ Reindexジョブ開始成功"
    echo "タスクID: ${task_id}"
    echo ""

    # 進捗監視
    echo "進捗を監視中... (Ctrl+Cで中断可能、バックグラウンドで継続実行されます)"
    echo ""

    while true; do
        sleep 10

        # タスク状態確認
        task_status=$(curl -s -XGET "${OPENSEARCH_ENDPOINT}/_tasks/${task_id}" \
            --aws-sigv4 "aws:amz:${REGION}:es")

        completed=$(echo "$task_status" | jq -r '.completed')

        if [[ "$completed" == "true" ]]; then
            echo ""
            echo "✓ Reindex完了"
            echo ""
            echo "結果:"
            echo "$task_status" | jq '.response | {created, updated, total, took}'
            break
        fi

        # 進捗表示
        status=$(echo "$task_status" | jq -r '.task.status')
        created=$(echo "$status" | jq -r '.created // 0')
        updated=$(echo "$status" | jq -r '.updated // 0')
        total=$(echo "$status" | jq -r '.total // 0')

        if [[ "$total" -gt 0 ]]; then
            percent=$((($created + $updated) * 100 / $total))
            echo -ne "\r進捗: ${created}/${total} (${percent}%)   "
        else
            echo -ne "\r処理中...   "
        fi
    done

else
    echo "✗ Reindexジョブ開始失敗 (HTTP ${http_code})"
    echo "$body" | jq '.' || echo "$body"
    exit 1
fi

# マイグレーション後の確認
echo ""
echo "マイグレーション結果を確認中..."
target_count=$(curl -s -XGET "${OPENSEARCH_ENDPOINT}/${TARGET_INDEX}/_count" \
    --aws-sigv4 "aws:amz:${REGION}:es" | jq -r '.count')

echo ""
echo "========================================="
echo "マイグレーション完了"
echo "========================================="
echo "ソースドキュメント数: ${source_count}"
echo "ターゲットドキュメント数: ${target_count}"
echo ""

if [[ "$source_count" -eq "$target_count" ]]; then
    echo "✓ すべてのドキュメントが正常にマイグレーションされました"
else
    echo "⚠️  警告: ドキュメント数が一致しません"
    echo "差分: $((source_count - target_count)) ドキュメント"
fi

echo ""
echo "次のステップ:"
echo "  1. ドキュメント内容を確認: curl -XGET '${OPENSEARCH_ENDPOINT}/${TARGET_INDEX}/_search?size=1' --aws-sigv4 'aws:amz:${REGION}:es' | jq"
echo "  2. EC2 Worker更新: export OPENSEARCH_INDEX=${TARGET_INDEX}"
echo "  3. Lambda更新: aws lambda update-function-configuration --function-name cis-search-api --environment 'Variables={OPENSEARCH_INDEX=${TARGET_INDEX}}'"
echo ""
