#!/bin/bash

# Lambda関数のOpenSearch接続テストスクリプト

FUNCTION_NAME="cis-search-api-prod"
TEST_EVENT_FILE="/tmp/lambda-test-event.json"

echo "======================================"
echo "Lambda関数接続テスト"
echo "関数名: $FUNCTION_NAME"
echo "======================================"
echo ""

# テストイベントを作成
cat > "$TEST_EVENT_FILE" << 'EOF'
{
  "queryStringParameters": {
    "query": "test",
    "limit": "5"
  },
  "httpMethod": "GET",
  "headers": {
    "Content-Type": "application/json"
  }
}
EOF

echo "1️⃣ Lambda関数の設定を確認"
echo "-----------------------------------"
aws lambda get-function-configuration \
    --function-name "$FUNCTION_NAME" \
    --query '{FunctionName: FunctionName, State: State, LastUpdateStatus: LastUpdateStatus, Environment: Environment.Variables}' \
    --output json | jq .

echo ""
echo "2️⃣ Lambda関数を実行"
echo "-----------------------------------"

# Lambda関数を実行
aws lambda invoke \
    --function-name "$FUNCTION_NAME" \
    --cli-binary-format raw-in-base64-out \
    --payload file://"$TEST_EVENT_FILE" \
    /tmp/lambda-response.json \
    --output json | jq .

echo ""
echo "3️⃣ レスポンス内容"
echo "-----------------------------------"
cat /tmp/lambda-response.json | jq .

echo ""
echo "4️⃣ ステータスコード確認"
echo "-----------------------------------"
status_code=$(cat /tmp/lambda-response.json | jq -r '.statusCode')

if [ "$status_code" = "200" ]; then
    echo "✅ 成功: ステータスコード $status_code"

    # 成功の場合、検索結果を表示
    echo ""
    echo "5️⃣ 検索結果サマリー"
    echo "-----------------------------------"
    cat /tmp/lambda-response.json | jq -r '.body' | jq '{success: .success, total: .total, results_count: (.results | length)}'

    exit 0
else
    echo "❌ エラー: ステータスコード $status_code"

    # エラーの場合、エラー詳細を表示
    echo ""
    echo "5️⃣ エラー詳細"
    echo "-----------------------------------"
    cat /tmp/lambda-response.json | jq -r '.body' | jq .

    exit 1
fi
