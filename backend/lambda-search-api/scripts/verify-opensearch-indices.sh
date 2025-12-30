#!/bin/bash

# OpenSearchインデックス検証スクリプト

FUNCTION_NAME="cis-search-api-prod"
INDICES=("cis-files" "file-index-v2-knn")

echo "======================================"
echo "OpenSearchインデックス検証"
echo "======================================"
echo ""

# OpenSearchドメイン情報を取得
OPENSEARCH_ENDPOINT=$(aws lambda get-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --query 'Environment.Variables.OPENSEARCH_ENDPOINT' \
    --output text)

echo "OpenSearchエンドポイント: $OPENSEARCH_ENDPOINT"
echo ""

# 各インデックスをテスト
for INDEX in "${INDICES[@]}"; do
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📋 インデックス: $INDEX"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # テストイベントを作成（インデックス名を環境変数で上書き）
    cat > /tmp/test-index-event.json << EOF
{
  "queryStringParameters": {
    "query": "test",
    "limit": "3"
  },
  "httpMethod": "GET",
  "headers": {
    "Content-Type": "application/json"
  }
}
EOF

    # Lambda関数の環境変数を一時的に更新
    echo "1️⃣ Lambda環境変数を更新中..."
    aws lambda update-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --environment "Variables={OPENSEARCH_ENDPOINT=$OPENSEARCH_ENDPOINT,OPENSEARCH_INDEX=$INDEX}" \
        --query '{State: State, LastUpdateStatus: LastUpdateStatus}' \
        --output json | jq . > /dev/null

    # 更新完了を待機
    echo "   更新完了を待機中..."
    sleep 5

    while true; do
        status=$(aws lambda get-function-configuration \
            --function-name "$FUNCTION_NAME" \
            --query 'LastUpdateStatus' \
            --output text)

        if [ "$status" = "Successful" ]; then
            break
        fi

        echo "   待機中... (Status: $status)"
        sleep 2
    done

    echo "   ✅ 環境変数更新完了"
    echo ""

    # Lambda関数を実行
    echo "2️⃣ Lambda関数を実行中..."
    aws lambda invoke \
        --function-name "$FUNCTION_NAME" \
        --cli-binary-format raw-in-base64-out \
        --payload file:///tmp/test-index-event.json \
        /tmp/index-response.json \
        --output json | jq '{StatusCode: .StatusCode}' > /dev/null

    # レスポンスを確認
    status_code=$(cat /tmp/index-response.json | jq -r '.statusCode')

    echo ""
    echo "3️⃣ テスト結果"
    echo "-----------------------------------"

    if [ "$status_code" = "200" ]; then
        success=$(cat /tmp/index-response.json | jq -r '.body' | jq -r '.success')

        if [ "$success" = "true" ]; then
            echo "✅ 成功: インデックス '$INDEX' への接続成功"

            # 検索結果サマリーを表示
            total=$(cat /tmp/index-response.json | jq -r '.body' | jq -r '.total')
            results_count=$(cat /tmp/index-response.json | jq -r '.body' | jq '.results | length')

            echo "   - ドキュメント総数: $total"
            echo "   - 取得件数: $results_count"

            # 最初の結果を表示
            if [ "$results_count" -gt 0 ]; then
                echo ""
                echo "   サンプル結果:"
                cat /tmp/index-response.json | jq -r '.body' | jq '.results[0] | {fileName: .fileName, fileType: .fileType}' | sed 's/^/   /'
            fi
        else
            echo "❌ エラー: インデックス '$INDEX' への接続失敗"
            error=$(cat /tmp/index-response.json | jq -r '.body' | jq -r '.error')
            echo "   エラー内容: $error"
        fi
    else
        echo "❌ エラー: ステータスコード $status_code"
        cat /tmp/index-response.json | jq -r '.body' | jq . | sed 's/^/   /'
    fi

    echo ""
done

echo "======================================"
echo "検証完了"
echo "======================================"
