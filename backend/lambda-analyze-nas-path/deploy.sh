#!/bin/bash
# nas_path分析Lambda関数のデプロイスクリプト

set -e

FUNCTION_NAME="cis-filesearch-analyze-nas-path"
REGION="ap-northeast-1"
RUNTIME="nodejs18.x"
HANDLER="index.handler"
TIMEOUT=120
MEMORY=512

echo "=== nas_path分析Lambda関数のデプロイ ==="

# ビルド
echo "1. TypeScriptをコンパイル..."
npm run build

# パッケージング
echo "2. Lambda zipパッケージを作成..."
rm -f lambda.zip
cd dist
zip -r ../lambda.zip .
cd ..
zip -r lambda.zip node_modules

# 関数が存在するか確認
echo "3. Lambda関数の確認..."
FUNCTION_EXISTS=$(aws lambda get-function --function-name $FUNCTION_NAME --region $REGION 2>/dev/null || echo "NOT_FOUND")

if [[ "$FUNCTION_EXISTS" == "NOT_FOUND" ]]; then
    echo "   Lambda関数が存在しません。新規作成します..."

    # IAMロールのARNを取得
    ROLE_ARN=$(aws iam get-role --role-name cis-filesearch-lambda-role --query 'Role.Arn' --output text 2>/dev/null)

    if [ -z "$ROLE_ARN" ]; then
        echo "   ERROR: IAMロール 'cis-filesearch-lambda-role' が見つかりません"
        exit 1
    fi

    # VPC設定を取得
    VPC_CONFIG=$(aws lambda get-function --function-name cis-filesearch-api --region $REGION --query 'Configuration.VpcConfig' 2>/dev/null)

    if [ -n "$VPC_CONFIG" ] && [ "$VPC_CONFIG" != "null" ]; then
        SUBNET_IDS=$(echo $VPC_CONFIG | jq -r '.SubnetIds | join(",")')
        SECURITY_GROUP_IDS=$(echo $VPC_CONFIG | jq -r '.SecurityGroupIds | join(",")')

        echo "   VPC設定: SubnetIds=$SUBNET_IDS, SecurityGroupIds=$SECURITY_GROUP_IDS"

        aws lambda create-function \
            --function-name $FUNCTION_NAME \
            --runtime $RUNTIME \
            --handler $HANDLER \
            --role "$ROLE_ARN" \
            --zip-file fileb://lambda.zip \
            --timeout $TIMEOUT \
            --memory-size $MEMORY \
            --region $REGION \
            --vpc-config "SubnetIds=$SUBNET_IDS,SecurityGroupIds=$SECURITY_GROUP_IDS" \
            --environment "Variables={OPENSEARCH_ENDPOINT=vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com,OPENSEARCH_INDEX=cis-files}"
    else
        aws lambda create-function \
            --function-name $FUNCTION_NAME \
            --runtime $RUNTIME \
            --handler $HANDLER \
            --role "$ROLE_ARN" \
            --zip-file fileb://lambda.zip \
            --timeout $TIMEOUT \
            --memory-size $MEMORY \
            --region $REGION \
            --environment "Variables={OPENSEARCH_ENDPOINT=vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com,OPENSEARCH_INDEX=cis-files}"
    fi
else
    echo "   Lambda関数を更新します..."
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://lambda.zip \
        --region $REGION
fi

echo ""
echo "=== デプロイ完了 ==="
echo ""
echo "実行方法:"
echo "  aws lambda invoke --function-name $FUNCTION_NAME --region $REGION response.json && cat response.json"
