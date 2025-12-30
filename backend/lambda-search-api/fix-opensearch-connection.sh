#!/bin/bash
#
# OpenSearch接続問題 緊急修正スクリプト
# Lambda環境変数の誤ったエンドポイントURLを修正
#
# 実行方法:
#   chmod +x fix-opensearch-connection.sh
#   ./fix-opensearch-connection.sh
#

set -e

REGION="ap-northeast-1"
FUNCTION_NAME="cis-search-api-prod"
OPENSEARCH_DOMAIN="cis-filesearch-opensearch"

echo "=========================================="
echo "OpenSearch接続問題 緊急修正スクリプト"
echo "=========================================="
echo ""

# Step 1: 正しいOpenSearchエンドポイントを取得
echo "[1/5] 正しいOpenSearchエンドポイントを取得中..."
CORRECT_ENDPOINT=$(aws opensearch describe-domain \
  --domain-name "${OPENSEARCH_DOMAIN}" \
  --region "${REGION}" \
  --query 'DomainStatus.Endpoints.vpc' \
  --output text)

if [ -z "$CORRECT_ENDPOINT" ]; then
  echo "❌ エラー: OpenSearchエンドポイントを取得できませんでした"
  exit 1
fi

echo "✅ 正しいエンドポイント: ${CORRECT_ENDPOINT}"
echo ""

# Step 2: 現在のLambda設定を確認
echo "[2/5] 現在のLambda環境変数を確認中..."
CURRENT_ENDPOINT=$(aws lambda get-function-configuration \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}" \
  --query 'Environment.Variables.OPENSEARCH_ENDPOINT' \
  --output text)

echo "現在の設定: ${CURRENT_ENDPOINT}"
echo "正しい設定: https://${CORRECT_ENDPOINT}"
echo ""

# Step 3: エンドポイント比較
if [ "https://${CORRECT_ENDPOINT}" == "${CURRENT_ENDPOINT}" ]; then
  echo "✅ エンドポイントは既に正しく設定されています"
  echo "   他の問題を確認してください"
  exit 0
fi

echo "❌ エンドポイントが誤っています！"
echo ""
echo "誤り: ${CURRENT_ENDPOINT}"
echo "正解: https://${CORRECT_ENDPOINT}"
echo ""

# 確認プロンプト
read -p "Lambda環境変数を修正しますか？ (y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "修正をキャンセルしました"
  exit 0
fi

# Step 4: Lambda環境変数を更新
echo "[3/5] Lambda環境変数を更新中..."
aws lambda update-function-configuration \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}" \
  --environment "Variables={
    OPENSEARCH_ENDPOINT=https://${CORRECT_ENDPOINT},
    OPENSEARCH_INDEX=file-index,
    NODE_ENV=production,
    DEBUG=false
  }" \
  --output json > /tmp/lambda-update-result.json

echo "✅ Lambda環境変数を更新しました"
echo ""

# Step 5: 変更内容の確認
echo "[4/5] 変更内容を確認中..."
UPDATED_ENDPOINT=$(aws lambda get-function-configuration \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}" \
  --query 'Environment.Variables.OPENSEARCH_ENDPOINT' \
  --output text)

echo "更新後のエンドポイント: ${UPDATED_ENDPOINT}"
echo ""

# Step 6: Lambda関数のテスト実行
echo "[5/5] Lambda関数の接続テストを実行中..."
echo "テストペイロード: {\"httpMethod\":\"GET\",\"path\":\"/search\",\"queryStringParameters\":{\"q\":\"test\"}}"

aws lambda invoke \
  --function-name "${FUNCTION_NAME}" \
  --region "${REGION}" \
  --payload '{"httpMethod":"GET","path":"/search","queryStringParameters":{"q":"test"}}' \
  /tmp/lambda-test-response.json

echo ""
echo "Lambda関数のレスポンス:"
cat /tmp/lambda-test-response.json | jq '.'
echo ""

# Step 7: CloudWatch Logsの最新ログを確認
echo "CloudWatch Logsの最新ログを確認中..."
aws logs tail "/aws/lambda/${FUNCTION_NAME}" \
  --region "${REGION}" \
  --since 5m \
  --format short

echo ""
echo "=========================================="
echo "修正完了！"
echo "=========================================="
echo ""
echo "次のステップ:"
echo "1. 上記のログに 'OpenSearch client initialized successfully' が表示されていることを確認"
echo "2. エラーがある場合は、VPC_OPENSEARCH_DNS_ANALYSIS.md を参照してください"
echo "3. セキュリティグループとサブネット設定も確認してください"
echo ""
echo "詳細な分析レポート: VPC_OPENSEARCH_DNS_ANALYSIS.md"
