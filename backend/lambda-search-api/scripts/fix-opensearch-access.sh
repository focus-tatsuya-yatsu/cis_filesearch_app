#!/bin/bash

# OpenSearch Access Policy Fix Script
# Updates access policy to explicitly allow Lambda execution role

set -e

DOMAIN_NAME="cis-filesearch-opensearch"
LAMBDA_ROLE_ARN="arn:aws:iam::770923989980:role/cis-lambda-search-api-role"
ACCOUNT_ID="770923989980"

echo "======================================"
echo "OpenSearch Access Policy Update"
echo "======================================"
echo ""

# 現在のアクセスポリシーを表示
echo "1️⃣ 現在のアクセスポリシー:"
echo "-----------------------------------"
aws opensearch describe-domain \
  --domain-name "$DOMAIN_NAME" \
  --query 'DomainStatus.AccessPolicies' \
  --output text | jq .

echo ""
echo "2️⃣ 新しいアクセスポリシーを適用中..."
echo "-----------------------------------"

# 新しいアクセスポリシーを適用
cat > /tmp/opensearch-access-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "$LAMBDA_ROLE_ARN"
      },
      "Action": "es:*",
      "Resource": "arn:aws:es:ap-northeast-1:$ACCOUNT_ID:domain/$DOMAIN_NAME/*"
    }
  ]
}
EOF

# アクセスポリシーを更新
aws opensearch update-domain-config \
  --domain-name "$DOMAIN_NAME" \
  --access-policies file:///tmp/opensearch-access-policy.json \
  --output json | jq '{Processing: .DomainConfig.AccessPolicies.Status.State}'

echo ""
echo "✅ アクセスポリシーを更新しました"
echo ""

echo "3️⃣ 更新完了を待機中..."
echo "-----------------------------------"

# 更新完了を待機
while true; do
    processing=$(aws opensearch describe-domain \
        --domain-name "$DOMAIN_NAME" \
        --query 'DomainStatus.Processing' \
        --output text)

    if [ "$processing" = "False" ]; then
        break
    fi

    echo "⏳ 更新中..."
    sleep 10
done

echo ""
echo "✅ 更新が完了しました！"
echo ""

echo "4️⃣ 最終アクセスポリシー:"
echo "-----------------------------------"
aws opensearch describe-domain \
  --domain-name "$DOMAIN_NAME" \
  --query 'DomainStatus.AccessPolicies' \
  --output text | jq .

echo ""
echo "======================================"
echo "次のステップ"
echo "======================================"
echo ""
echo "Lambda関数をテストしてください："
echo "./scripts/test-lambda-connection.sh"
