#!/bin/bash

echo "======================================"
echo "📦 Lambda管理関数のデプロイ"
echo "======================================"

FUNCTION_NAME="cis-opensearch-admin-prod"
ROLE_ARN="arn:aws:iam::770923989980:role/cis-lambda-role"  # 既存のLambdaロールを使用

# 1. デプロイパッケージを作成
echo "📦 パッケージ作成中..."
cd scripts
zip -r lambda-admin.zip lambda-admin-function.py
cd ..

# 2. Lambda関数を作成または更新
echo "🚀 Lambda関数をデプロイ中..."

# 関数が存在するか確認
aws lambda get-function --function-name $FUNCTION_NAME &>/dev/null

if [ $? -eq 0 ]; then
    echo "既存の関数を更新します..."
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://scripts/lambda-admin.zip
else
    echo "新規関数を作成します..."

    # VPC設定を取得（既存のLambda関数から）
    VPC_CONFIG=$(aws lambda get-function-configuration \
        --function-name cis-search-api-prod \
        --query 'VpcConfig' \
        --output json)

    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime python3.9 \
        --role $ROLE_ARN \
        --handler lambda-admin-function.lambda_handler \
        --zip-file fileb://scripts/lambda-admin.zip \
        --timeout 60 \
        --memory-size 512 \
        --vpc-config "$VPC_CONFIG" \
        --environment Variables='{
            "OPENSEARCH_ENDPOINT":"vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com",
            "INDEX_NAME":"file-index-v2-knn",
            "S3_BUCKET":"cis-filesearch-s3-landing"
        }'
fi

echo ""
echo "✅ デプロイ完了！"
echo ""
echo "使用方法:"
echo "  1. インデックス状態確認:"
echo "     aws lambda invoke --function-name $FUNCTION_NAME --payload '{\"action\":\"check_status\"}' response.json"
echo ""
echo "  2. サンプルデータ削除:"
echo "     aws lambda invoke --function-name $FUNCTION_NAME --payload '{\"action\":\"delete_samples\"}' response.json"
echo ""
echo "  3. 画像をインデックス:"
echo "     aws lambda invoke --function-name $FUNCTION_NAME --payload '{\"action\":\"index_image\",\"s3_key\":\"documents/path/to/image.jpg\"}' response.json"