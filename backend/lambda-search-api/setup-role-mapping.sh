#!/bin/bash

# OpenSearchのIAMロールマッピング設定スクリプト
# EC2インスタンス上で実行する必要があります

echo "========================================="
echo "OpenSearch IAMロールマッピング設定"
echo "========================================="

# カラー出力
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 設定
OPENSEARCH_ENDPOINT="vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
LAMBDA_ROLE_ARN="arn:aws:iam::770923989980:role/cis-lambda-search-api-role"
REGION="ap-northeast-1"

echo -e "${YELLOW}📋 設定内容:${NC}"
echo "  OpenSearchエンドポイント: $OPENSEARCH_ENDPOINT"
echo "  Lambda実行ロール: $LAMBDA_ROLE_ARN"
echo "  リージョン: $REGION"
echo ""

# 1. EC2インスタンスの確認
echo -e "${GREEN}1. EC2インスタンスを確認中...${NC}"
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Environment,Values=production" "Name=instance-state-name,Values=running" \
  --query "Reservations[0].Instances[0].InstanceId" \
  --output text)

if [ "$INSTANCE_ID" = "None" ] || [ -z "$INSTANCE_ID" ]; then
  echo -e "${RED}❌ 実行中のEC2インスタンスが見つかりません${NC}"
  echo "以下のコマンドでEC2インスタンスを確認してください："
  echo "aws ec2 describe-instances --filters \"Name=instance-state-name,Values=running\" --query \"Reservations[*].Instances[*].[InstanceId,Tags[?Key=='Name'].Value|[0],State.Name]\" --output table"
  exit 1
fi

echo -e "${GREEN}✅ EC2インスタンス発見: $INSTANCE_ID${NC}"

# 2. SSMセッション開始とロールマッピング設定
echo ""
echo -e "${YELLOW}2. EC2インスタンスにSSM接続してロールマッピングを設定します${NC}"
echo ""
echo "以下のコマンドをEC2インスタンス内で実行してください："
echo ""
echo -e "${GREEN}# SSMセッションを開始${NC}"
echo "aws ssm start-session --target $INSTANCE_ID"
echo ""
echo -e "${GREEN}# EC2インスタンス内で以下を実行:${NC}"
cat << 'SCRIPT'

# OpenSearchにアクセス可能か確認
curl -s -o /dev/null -w "%{http_code}" \
  https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_cluster/health

# 200が返れば接続成功

# Lambda実行ロールのマッピングを設定（管理者権限が必要）
curl -X PUT \
  "https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_opendistro/_security/api/rolesmapping/all_access" \
  -H "Content-Type: application/json" \
  -u admin:YourAdminPassword \
  -d '{
    "backend_roles": ["arn:aws:iam::770923989980:role/cis-lambda-search-api-role"],
    "hosts": [],
    "users": []
  }'

# マッピングの確認
curl -X GET \
  "https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_opendistro/_security/api/rolesmapping/all_access" \
  -u admin:YourAdminPassword | jq '.'

SCRIPT

echo ""
echo -e "${YELLOW}3. 設定完了後のテスト${NC}"
echo ""
echo "ロールマッピング設定後、以下でLambda関数をテストしてください："
echo ""
echo "# Lambda関数の直接テスト"
echo 'echo '"'"'{"queryStringParameters": {"q": "test", "searchType": "text"}}'"'"' > test.json'
echo "aws lambda invoke --function-name cis-search-api-prod --payload fileb://test.json result.json"
echo "cat result.json | jq '.'"
echo ""

echo -e "${YELLOW}4. ブラウザでのテスト${NC}"
echo "http://localhost:3000 にアクセスして検索機能をテストしてください"
echo ""
echo -e "${GREEN}=========================================${NC}"
echo -e "${GREEN}セットアップ手順の表示完了${NC}"
echo -e "${GREEN}=========================================${NC}"