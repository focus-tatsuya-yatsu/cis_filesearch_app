#!/bin/bash

#############################################################################
# Lambda 503エラー診断スクリプト
# OpenSearchへの接続問題を診断し、必要な修正を提案します
#############################################################################

set -e

# 色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 設定
LAMBDA_FUNCTION_NAME="cis-search-api-prod"
OPENSEARCH_DOMAIN_NAME="cis-filesearch-opensearch"
REGION="ap-northeast-1"
LOG_GROUP="/aws/lambda/${LAMBDA_FUNCTION_NAME}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Lambda 503エラー診断開始${NC}"
echo -e "${BLUE}========================================${NC}\n"

# 1. Lambda設定確認
echo -e "${YELLOW}[1/7] Lambda設定確認...${NC}"
LAMBDA_CONFIG=$(aws lambda get-function-configuration \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --region "$REGION" 2>&1)

if [ $? -ne 0 ]; then
  echo -e "${RED}✗ Lambda関数が見つかりません: $LAMBDA_FUNCTION_NAME${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Lambda関数が存在します${NC}"

# Lambda環境変数確認
echo -e "\n${BLUE}環境変数:${NC}"
OPENSEARCH_ENDPOINT=$(echo "$LAMBDA_CONFIG" | jq -r '.Environment.Variables.OPENSEARCH_ENDPOINT // empty')
OPENSEARCH_INDEX=$(echo "$LAMBDA_CONFIG" | jq -r '.Environment.Variables.OPENSEARCH_INDEX // empty')
SKIP_SSL_VERIFY=$(echo "$LAMBDA_CONFIG" | jq -r '.Environment.Variables.SKIP_SSL_VERIFY // empty')
DEBUG_MODE=$(echo "$LAMBDA_CONFIG" | jq -r '.Environment.Variables.DEBUG_MODE // empty')

echo "  OPENSEARCH_ENDPOINT: ${OPENSEARCH_ENDPOINT:-未設定}"
echo "  OPENSEARCH_INDEX: ${OPENSEARCH_INDEX:-未設定}"
echo "  SKIP_SSL_VERIFY: ${SKIP_SSL_VERIFY:-未設定}"
echo "  DEBUG_MODE: ${DEBUG_MODE:-未設定}"

if [ -z "$OPENSEARCH_ENDPOINT" ]; then
  echo -e "${RED}✗ OPENSEARCH_ENDPOINTが設定されていません${NC}"
  NEEDS_ENV_UPDATE=true
else
  echo -e "${GREEN}✓ OPENSEARCH_ENDPOINTが設定されています${NC}"
fi

if [ "$SKIP_SSL_VERIFY" != "true" ]; then
  echo -e "${YELLOW}! SKIP_SSL_VERIFYがtrueに設定されていません（VPCエンドポイントの場合に必要）${NC}"
  NEEDS_ENV_UPDATE=true
fi

# VPC設定確認
echo -e "\n${BLUE}VPC設定:${NC}"
VPC_SUBNET_IDS=$(echo "$LAMBDA_CONFIG" | jq -r '.VpcConfig.SubnetIds[]' 2>/dev/null)
VPC_SG_IDS=$(echo "$LAMBDA_CONFIG" | jq -r '.VpcConfig.SecurityGroupIds[]' 2>/dev/null)

if [ -n "$VPC_SUBNET_IDS" ]; then
  echo -e "${GREEN}✓ VPC内に配置されています${NC}"
  echo "  Subnets: $(echo $VPC_SUBNET_IDS | tr '\n' ',')"
  echo "  Security Groups: $(echo $VPC_SG_IDS | tr '\n' ',')"
else
  echo -e "${RED}✗ VPC設定がありません${NC}"
fi

# 2. IAMロール確認
echo -e "\n${YELLOW}[2/7] IAMロール確認...${NC}"
LAMBDA_ROLE=$(echo "$LAMBDA_CONFIG" | jq -r '.Role')
ROLE_NAME=$(echo "$LAMBDA_ROLE" | awk -F'/' '{print $NF}')

echo "  Lambda Role: $ROLE_NAME"

# IAMポリシー確認
INLINE_POLICIES=$(aws iam list-role-policies --role-name "$ROLE_NAME" --region "$REGION" 2>&1)

if echo "$INLINE_POLICIES" | grep -q "opensearch-access"; then
  echo -e "${GREEN}✓ OpenSearchアクセスポリシーが存在します${NC}"
else
  echo -e "${YELLOW}! OpenSearchアクセスポリシーが見つかりません${NC}"
  NEEDS_IAM_UPDATE=true
fi

# アタッチされたポリシー確認
ATTACHED_POLICIES=$(aws iam list-attached-role-policies --role-name "$ROLE_NAME" --region "$REGION" 2>&1)

if echo "$ATTACHED_POLICIES" | grep -q "AWSLambdaVPCAccessExecutionRole"; then
  echo -e "${GREEN}✓ VPCアクセス権限が付与されています${NC}"
else
  echo -e "${RED}✗ VPCアクセス権限がありません${NC}"
  NEEDS_IAM_UPDATE=true
fi

# 3. OpenSearchドメイン確認
echo -e "\n${YELLOW}[3/7] OpenSearchドメイン確認...${NC}"
OPENSEARCH_INFO=$(aws opensearch describe-domain \
  --domain-name "$OPENSEARCH_DOMAIN_NAME" \
  --region "$REGION" 2>&1)

if [ $? -ne 0 ]; then
  echo -e "${RED}✗ OpenSearchドメインが見つかりません: $OPENSEARCH_DOMAIN_NAME${NC}"
  exit 1
fi

DOMAIN_STATUS=$(echo "$OPENSEARCH_INFO" | jq -r '.DomainStatus.Processing')
DOMAIN_ENDPOINT=$(echo "$OPENSEARCH_INFO" | jq -r '.DomainStatus.Endpoint')
VPC_ENDPOINT=$(echo "$OPENSEARCH_INFO" | jq -r '.DomainStatus.Endpoints.vpc // empty')

echo "  ドメイン処理中: $DOMAIN_STATUS"
echo "  エンドポイント: ${VPC_ENDPOINT:-$DOMAIN_ENDPOINT}"

if [ "$DOMAIN_STATUS" == "true" ]; then
  echo -e "${YELLOW}! ドメインが処理中です（更新/メンテナンス）${NC}"
fi

# クラスターステータス確認
CLUSTER_STATUS=$(echo "$OPENSEARCH_INFO" | jq -r '.DomainStatus.ClusterConfig')
echo -e "\n${BLUE}クラスター設定:${NC}"
echo "$CLUSTER_STATUS" | jq '{InstanceType, InstanceCount, DedicatedMasterEnabled}'

# 4. セキュリティグループ確認
echo -e "\n${YELLOW}[4/7] セキュリティグループ確認...${NC}"

# OpenSearchのセキュリティグループ取得
OPENSEARCH_SG=$(echo "$OPENSEARCH_INFO" | jq -r '.DomainStatus.VPCOptions.SecurityGroupIds[0]')
echo "  OpenSearch SG: $OPENSEARCH_SG"

# Lambdaのセキュリティグループ取得
LAMBDA_SG=$(echo "$VPC_SG_IDS" | head -n1)
echo "  Lambda SG: $LAMBDA_SG"

if [ -n "$LAMBDA_SG" ] && [ -n "$OPENSEARCH_SG" ]; then
  # OpenSearch SGのインバウンドルール確認
  OPENSEARCH_INGRESS=$(aws ec2 describe-security-groups \
    --group-ids "$OPENSEARCH_SG" \
    --query 'SecurityGroups[0].IpPermissions' \
    --region "$REGION" 2>&1)

  if echo "$OPENSEARCH_INGRESS" | jq -e ".[] | select(.FromPort==443 and (.UserIdGroupPairs[]?.GroupId==\"$LAMBDA_SG\"))" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ OpenSearch SGがLambda SGからの443ポート接続を許可しています${NC}"
  else
    echo -e "${RED}✗ OpenSearch SGがLambda SGからの接続を許可していません${NC}"
    NEEDS_SG_UPDATE=true
  fi
fi

# 5. 最新のCloudWatchログ確認
echo -e "\n${YELLOW}[5/7] CloudWatchログ確認（最新5分間）...${NC}"

START_TIME=$(($(date +%s) - 300))000  # 5分前
RECENT_ERRORS=$(aws logs filter-log-events \
  --log-group-name "$LOG_GROUP" \
  --start-time "$START_TIME" \
  --filter-pattern "ERROR" \
  --region "$REGION" \
  --max-items 5 2>&1)

if echo "$RECENT_ERRORS" | jq -e '.events | length > 0' > /dev/null 2>&1; then
  echo -e "${RED}✗ 最近のエラーログが見つかりました:${NC}\n"
  echo "$RECENT_ERRORS" | jq -r '.events[] | .message' | head -20
else
  echo -e "${GREEN}✓ 最近のエラーログはありません${NC}"
fi

# 6. Lambda接続テスト
echo -e "\n${YELLOW}[6/7] Lambda接続テスト実行...${NC}"

TEST_PAYLOAD='{"httpMethod":"GET","queryStringParameters":{"q":"test","limit":"1"}}'

TEST_RESPONSE=$(aws lambda invoke \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --payload "$TEST_PAYLOAD" \
  --region "$REGION" \
  /tmp/lambda-test-response.json 2>&1)

if [ $? -eq 0 ]; then
  RESPONSE_BODY=$(cat /tmp/lambda-test-response.json)
  STATUS_CODE=$(echo "$RESPONSE_BODY" | jq -r '.statusCode // empty')

  if [ "$STATUS_CODE" == "200" ]; then
    echo -e "${GREEN}✓ Lambda関数が正常に実行されました${NC}"
    echo "$RESPONSE_BODY" | jq '.body | fromjson | {total: .pagination.total, took: .took}'
  else
    echo -e "${RED}✗ Lambda実行エラー (Status: $STATUS_CODE)${NC}"
    echo "$RESPONSE_BODY" | jq '.'
  fi
else
  echo -e "${RED}✗ Lambda呼び出しに失敗しました${NC}"
  echo "$TEST_RESPONSE"
fi

rm -f /tmp/lambda-test-response.json

# 7. OpenSearchアクセスポリシー確認
echo -e "\n${YELLOW}[7/7] OpenSearchアクセスポリシー確認...${NC}"

ACCESS_POLICIES=$(echo "$OPENSEARCH_INFO" | jq -r '.DomainStatus.AccessPolicies')

if echo "$ACCESS_POLICIES" | jq -e ".Statement[] | select(.Principal.AWS | contains(\"$ROLE_NAME\"))" > /dev/null 2>&1; then
  echo -e "${GREEN}✓ LambdaロールがOpenSearchアクセスポリシーに含まれています${NC}"
else
  echo -e "${YELLOW}! LambdaロールがOpenSearchアクセスポリシーに明示的に含まれていません${NC}"
  echo "  (FGACが無効の場合は問題ありません)"
  NEEDS_ACCESS_POLICY=true
fi

# 診断結果サマリー
echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}診断結果サマリー${NC}"
echo -e "${BLUE}========================================${NC}\n"

ISSUES_FOUND=false

if [ "$NEEDS_ENV_UPDATE" == "true" ]; then
  echo -e "${YELLOW}[要対応] Lambda環境変数の更新が必要です${NC}"
  echo "  実行: ./scripts/fix-lambda-env.sh"
  ISSUES_FOUND=true
fi

if [ "$NEEDS_IAM_UPDATE" == "true" ]; then
  echo -e "${YELLOW}[要対応] IAMロールの権限更新が必要です${NC}"
  echo "  実行: ./scripts/fix-iam-permissions.sh"
  ISSUES_FOUND=true
fi

if [ "$NEEDS_SG_UPDATE" == "true" ]; then
  echo -e "${YELLOW}[要対応] セキュリティグループの更新が必要です${NC}"
  echo "  実行: ./scripts/fix-security-groups.sh"
  ISSUES_FOUND=true
fi

if [ "$NEEDS_ACCESS_POLICY" == "true" ]; then
  echo -e "${YELLOW}[確認推奨] OpenSearchアクセスポリシーの確認が推奨されます${NC}"
  echo "  手動: OpenSearchコンソールでアクセスポリシーを確認"
  ISSUES_FOUND=true
fi

if [ "$ISSUES_FOUND" != "true" ]; then
  echo -e "${GREEN}✓ 主要な設定に問題は見つかりませんでした${NC}"
  echo ""
  echo "それでも503エラーが発生する場合は、以下を確認してください:"
  echo "  1. OpenSearchクラスターが正常稼働中か（Processing: false）"
  echo "  2. VPCのルートテーブル設定"
  echo "  3. NACLの設定"
  echo "  4. OpenSearch FGACの設定"
else
  echo ""
  echo "修正スクリプトを実行後、以下のコマンドでテスト:"
  echo "  ./scripts/test-lambda-connection.sh"
fi

echo -e "\n${BLUE}診断完了${NC}"
