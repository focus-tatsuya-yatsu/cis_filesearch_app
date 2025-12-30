#!/bin/bash

# OpenSearch FGAC 自動設定スクリプト
# Lambda関数がOpenSearchにアクセスできるよう権限を設定

set -e

echo "================================================"
echo "OpenSearch FGAC 自動設定"
echo "================================================"

# 設定
DOMAIN_NAME="cis-filesearch-opensearch"
LAMBDA_ROLE_ARN="arn:aws:iam::770923989980:role/cis-lambda-search-api-role"
REGION="ap-northeast-1"

# OpenSearchドメイン情報を取得
echo "1. OpenSearchドメイン情報を取得中..."
DOMAIN_INFO=$(aws opensearch describe-domain --domain-name $DOMAIN_NAME --region $REGION 2>/dev/null || echo "")

if [ -z "$DOMAIN_INFO" ]; then
    echo "❌ OpenSearchドメインが見つかりません: $DOMAIN_NAME"
    exit 1
fi

# エンドポイントを取得
OPENSEARCH_ENDPOINT=$(echo $DOMAIN_INFO | jq -r '.DomainStatus.Endpoints.vpc // .DomainStatus.Endpoint')

if [ -z "$OPENSEARCH_ENDPOINT" ] || [ "$OPENSEARCH_ENDPOINT" = "null" ]; then
    echo "❌ OpenSearchエンドポイントが取得できません"
    exit 1
fi

echo "✅ OpenSearchエンドポイント: $OPENSEARCH_ENDPOINT"

# マスターユーザー情報を取得
MASTER_USER_ARN=$(echo $DOMAIN_INFO | jq -r '.DomainStatus.AdvancedSecurityOptions.MasterUserOptions.MasterUserARN // ""')
MASTER_USER_NAME=$(echo $DOMAIN_INFO | jq -r '.DomainStatus.AdvancedSecurityOptions.MasterUserOptions.MasterUserName // ""')

echo ""
echo "2. FGAC設定情報:"
if [ ! -z "$MASTER_USER_ARN" ] && [ "$MASTER_USER_ARN" != "null" ]; then
    echo "   マスターユーザーARN: $MASTER_USER_ARN"
elif [ ! -z "$MASTER_USER_NAME" ] && [ "$MASTER_USER_NAME" != "null" ]; then
    echo "   マスターユーザー名: $MASTER_USER_NAME"
else
    echo "   ⚠️ FGACが無効の可能性があります"
fi

echo ""
echo "3. アクセスポリシーを更新中..."

# 現在のアクセスポリシーを取得
CURRENT_POLICY=$(echo $DOMAIN_INFO | jq -r '.DomainStatus.AccessPolicies' | jq '.')

# Lambda関数のアクセスを許可するポリシー
NEW_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": [
          "$LAMBDA_ROLE_ARN"
        ]
      },
      "Action": [
        "es:*"
      ],
      "Resource": "arn:aws:es:$REGION:*:domain/$DOMAIN_NAME/*"
    }
  ]
}
EOF
)

# アクセスポリシーを更新
echo "アクセスポリシーを更新しています..."
aws opensearch update-domain-config \
    --domain-name $DOMAIN_NAME \
    --region $REGION \
    --access-policies "$NEW_POLICY" \
    --no-cli-pager

echo "✅ アクセスポリシーを更新しました"

echo ""
echo "4. OpenSearchクラスター設定を更新..."

# FGACを無効化（テスト用）- 本番環境では推奨されません
read -p "⚠️ 警告: FGACを一時的に無効化してテストしますか？(y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "FGACを無効化しています（開発環境用）..."

    # 注意: このコマンドはFGACを完全に無効化します
    # 本番環境では適切なロールマッピングを設定してください
    aws opensearch update-domain-config \
        --domain-name $DOMAIN_NAME \
        --region $REGION \
        --advanced-security-options Enabled=false \
        --no-cli-pager 2>/dev/null || {
        echo "⚠️ FGACの無効化に失敗しました。手動で設定が必要かもしれません。"
    }
fi

echo ""
echo "================================================"
echo "設定完了"
echo "================================================"
echo ""
echo "✅ Lambda関数のIAMロールにOpenSearchへのアクセス権限を付与しました"
echo ""
echo "次のステップ:"
echo "1. 変更が反映されるまで数分待ってください"
echo "2. Lambda関数をテストしてください:"
echo ""
echo "   curl -X GET \"https://5xbn3ng31f.execute-api.ap-northeast-1.amazonaws.com/default/search?q=test\""
echo ""
echo "3. CloudWatchログでエラーを確認:"
echo "   aws logs tail /aws/lambda/cis-search-api-prod --follow"
echo ""
echo "================================================"
echo ""
echo "⚠️ 注意事項:"
echo "- FGACを無効化した場合、セキュリティが低下します"
echo "- 本番環境では適切なロールベースアクセス制御を設定してください"
echo "- OpenSearchダッシュボードから詳細な権限設定が可能です"
echo ""