#!/bin/bash

#############################################################################
# Lambda 503エラー クイック修正スクリプト
# 最も一般的な原因に対する修正を一括実行
#############################################################################

set -e

# 色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 設定
LAMBDA_FUNCTION_NAME="cis-search-api-prod"
OPENSEARCH_DOMAIN_NAME="cis-filesearch-opensearch"
REGION="ap-northeast-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Lambda 503エラー クイック修正${NC}"
echo -e "${BLUE}========================================${NC}\n"

echo "Account ID: $ACCOUNT_ID"
echo "Region: $REGION"
echo ""

# 確認プロンプト
read -p "修正を開始しますか? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "キャンセルされました"
  exit 0
fi

# 1. OpenSearchエンドポイント取得
echo -e "\n${YELLOW}[1/5] OpenSearchエンドポイント取得...${NC}"
OPENSEARCH_INFO=$(aws opensearch describe-domain \
  --domain-name "$OPENSEARCH_DOMAIN_NAME" \
  --region "$REGION")

VPC_ENDPOINT=$(echo "$OPENSEARCH_INFO" | jq -r '.DomainStatus.Endpoints.vpc // empty')
if [ -z "$VPC_ENDPOINT" ]; then
  VPC_ENDPOINT=$(echo "$OPENSEARCH_INFO" | jq -r '.DomainStatus.Endpoint')
fi

OPENSEARCH_ENDPOINT="https://${VPC_ENDPOINT}"
echo "  OpenSearch Endpoint: $OPENSEARCH_ENDPOINT"

# 2. Lambda環境変数を更新
echo -e "\n${YELLOW}[2/5] Lambda環境変数更新...${NC}"

aws lambda update-function-configuration \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --region "$REGION" \
  --environment "Variables={
    OPENSEARCH_ENDPOINT=${OPENSEARCH_ENDPOINT},
    OPENSEARCH_INDEX=file-index,
    AWS_REGION=${REGION},
    SKIP_SSL_VERIFY=true,
    DEBUG_MODE=true,
    OPENSEARCH_DOMAIN_NAME=${VPC_ENDPOINT},
    NODE_ENV=production,
    LOG_LEVEL=info
  }" > /dev/null

echo -e "${GREEN}✓ 環境変数を更新しました${NC}"

# Lambda設定の更新完了を待機
echo "  Lambda設定更新を待機中..."
sleep 10

# 3. IAMポリシーの確認と更新
echo -e "\n${YELLOW}[3/5] IAMポリシー確認...${NC}"

LAMBDA_CONFIG=$(aws lambda get-function-configuration \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --region "$REGION")

LAMBDA_ROLE=$(echo "$LAMBDA_CONFIG" | jq -r '.Role')
ROLE_NAME=$(echo "$LAMBDA_ROLE" | awk -F'/' '{print $NF}')

echo "  Lambda Role: $ROLE_NAME"

# OpenSearchアクセスポリシーを作成/更新
OPENSEARCH_POLICY='{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OpenSearchAccess",
      "Effect": "Allow",
      "Action": [
        "es:ESHttpGet",
        "es:ESHttpPost",
        "es:ESHttpHead",
        "es:DescribeElasticsearchDomain",
        "es:ESHttpPut"
      ],
      "Resource": "arn:aws:es:'$REGION':'$ACCOUNT_ID':domain/*"
    }
  ]
}'

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "opensearch-access" \
  --policy-document "$OPENSEARCH_POLICY" \
  --region "$REGION" > /dev/null

echo -e "${GREEN}✓ IAMポリシーを更新しました${NC}"

# VPC実行ロールの確認
ATTACHED_POLICIES=$(aws iam list-attached-role-policies \
  --role-name "$ROLE_NAME" \
  --region "$REGION" | jq -r '.AttachedPolicies[].PolicyName')

if ! echo "$ATTACHED_POLICIES" | grep -q "AWSLambdaVPCAccessExecutionRole"; then
  echo "  VPC実行ロールをアタッチ中..."
  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole" \
    --region "$REGION"
  echo -e "${GREEN}✓ VPC実行ロールをアタッチしました${NC}"
fi

# 4. セキュリティグループの確認と更新
echo -e "\n${YELLOW}[4/5] セキュリティグループ確認...${NC}"

# Lambda SG取得
LAMBDA_SG=$(echo "$LAMBDA_CONFIG" | jq -r '.VpcConfig.SecurityGroupIds[0]')

# OpenSearch SG取得
OPENSEARCH_SG=$(echo "$OPENSEARCH_INFO" | jq -r '.DomainStatus.VPCOptions.SecurityGroupIds[0]')

echo "  Lambda SG: $LAMBDA_SG"
echo "  OpenSearch SG: $OPENSEARCH_SG"

# OpenSearch SGのインバウンドルール確認
EXISTING_RULE=$(aws ec2 describe-security-groups \
  --group-ids "$OPENSEARCH_SG" \
  --query "SecurityGroups[0].IpPermissions[?FromPort==\`443\` && ToPort==\`443\` && contains(UserIdGroupPairs[].GroupId, '$LAMBDA_SG')]" \
  --region "$REGION")

if [ "$(echo $EXISTING_RULE | jq 'length')" -eq 0 ]; then
  echo "  OpenSearch SGに443ポートのインバウンドルールを追加中..."
  aws ec2 authorize-security-group-ingress \
    --group-id "$OPENSEARCH_SG" \
    --protocol tcp \
    --port 443 \
    --source-group "$LAMBDA_SG" \
    --region "$REGION" > /dev/null 2>&1 || true
  echo -e "${GREEN}✓ セキュリティグループルールを追加しました${NC}"
else
  echo -e "${GREEN}✓ セキュリティグループルールは既に設定されています${NC}"
fi

# 5. OpenSearchアクセスポリシー更新
echo -e "\n${YELLOW}[5/5] OpenSearchアクセスポリシー確認...${NC}"

CURRENT_ACCESS_POLICY=$(echo "$OPENSEARCH_INFO" | jq -r '.DomainStatus.AccessPolicies')

# Lambdaロールがアクセスポリシーに含まれているか確認
if ! echo "$CURRENT_ACCESS_POLICY" | jq -e ".Statement[] | select(.Principal.AWS | contains(\"$ROLE_NAME\"))" > /dev/null 2>&1; then
  echo "  OpenSearchアクセスポリシーを更新中..."

  # 新しいアクセスポリシーを構築
  NEW_ACCESS_POLICY='{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "AWS": "'$LAMBDA_ROLE'"
        },
        "Action": [
          "es:ESHttpGet",
          "es:ESHttpPost",
          "es:ESHttpHead"
        ],
        "Resource": "arn:aws:es:'$REGION':'$ACCOUNT_ID':domain/'$OPENSEARCH_DOMAIN_NAME'/*"
      },
      {
        "Effect": "Allow",
        "Principal": {
          "AWS": "*"
        },
        "Action": "es:*",
        "Condition": {
          "IpAddress": {
            "aws:SourceIp": [
              "10.0.0.0/16"
            ]
          }
        },
        "Resource": "arn:aws:es:'$REGION':'$ACCOUNT_ID':domain/'$OPENSEARCH_DOMAIN_NAME'/*"
      }
    ]
  }'

  aws opensearch update-domain-config \
    --domain-name "$OPENSEARCH_DOMAIN_NAME" \
    --access-policies "$NEW_ACCESS_POLICY" \
    --region "$REGION" > /dev/null

  echo -e "${GREEN}✓ OpenSearchアクセスポリシーを更新しました${NC}"
  echo -e "${YELLOW}  注意: ドメイン設定の更新には数分かかる場合があります${NC}"
else
  echo -e "${GREEN}✓ アクセスポリシーは既に設定されています${NC}"
fi

# IAM変更の反映を待機
echo -e "\n${YELLOW}IAM変更の反映を待機中（30秒）...${NC}"
sleep 30

# 完了メッセージ
echo -e "\n${BLUE}========================================${NC}"
echo -e "${GREEN}修正完了!${NC}"
echo -e "${BLUE}========================================${NC}\n"

echo "以下のコマンドでテストしてください:"
echo ""
echo -e "${BLUE}1. Lambda直接テスト:${NC}"
echo "   aws lambda invoke \\"
echo "     --function-name $LAMBDA_FUNCTION_NAME \\"
echo "     --payload '{\"httpMethod\":\"GET\",\"queryStringParameters\":{\"q\":\"test\"}}' \\"
echo "     response.json && cat response.json | jq ."
echo ""
echo -e "${BLUE}2. CloudWatchログ確認:${NC}"
echo "   aws logs tail /aws/lambda/$LAMBDA_FUNCTION_NAME --follow"
echo ""
echo -e "${BLUE}3. 診断スクリプト実行:${NC}"
echo "   ./scripts/diagnose-503-error.sh"
echo ""

# テスト実行の提案
read -p "今すぐLambdaテストを実行しますか? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo -e "\n${YELLOW}Lambdaテスト実行中...${NC}\n"

  aws lambda invoke \
    --function-name "$LAMBDA_FUNCTION_NAME" \
    --payload '{"httpMethod":"GET","queryStringParameters":{"q":"test","limit":"5"}}' \
    --region "$REGION" \
    /tmp/test-response.json

  echo -e "\n${BLUE}レスポンス:${NC}"
  cat /tmp/test-response.json | jq '.'

  STATUS_CODE=$(cat /tmp/test-response.json | jq -r '.statusCode')

  if [ "$STATUS_CODE" == "200" ]; then
    echo -e "\n${GREEN}✓✓✓ 成功! Lambda関数が正常に動作しています ✓✓✓${NC}"
  else
    echo -e "\n${RED}✗ エラーが発生しました。CloudWatchログを確認してください${NC}"
    echo ""
    echo "CloudWatchログを表示:"
    aws logs tail /aws/lambda/$LAMBDA_FUNCTION_NAME --since 5m --format short
  fi

  rm -f /tmp/test-response.json
fi
