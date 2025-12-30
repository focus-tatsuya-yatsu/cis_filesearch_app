#!/bin/bash

# OpenSearch Role Mapping Setup Script
# This script configures Fine-Grained Access Control role mapping
# to allow Lambda execution role to access OpenSearch

set -e

OPENSEARCH_ENDPOINT="vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
LAMBDA_ROLE_ARN="arn:aws:iam::770923989980:role/cis-lambda-search-api-role"
EC2_INSTANCE_ID="i-083047855b68fe1c1"

echo "======================================"
echo "OpenSearch Role Mapping Setup"
echo "======================================"
echo ""
echo "OpenSearch Endpoint: $OPENSEARCH_ENDPOINT"
echo "Lambda Role ARN: $LAMBDA_ROLE_ARN"
echo "EC2 Instance: $EC2_INSTANCE_ID"
echo ""

# SSM経由でEC2に接続して、OpenSearchのロールマッピングを設定
echo "1️⃣ EC2インスタンスに接続してロールマッピングを設定中..."
echo ""

# ロールマッピング設定用のJSONを作成
ROLE_MAPPING_JSON=$(cat <<'EOF'
{
  "backend_roles": ["arn:aws:iam::770923989980:role/cis-lambda-search-api-role"],
  "hosts": [],
  "users": []
}
EOF
)

# SSM経由でコマンド実行
aws ssm send-command \
  --instance-ids "$EC2_INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --comment "Setup OpenSearch role mapping for Lambda" \
  --parameters commands="[
    'echo Setting up OpenSearch role mapping...',
    'curl -XPUT \"https://$OPENSEARCH_ENDPOINT/_plugins/_security/api/rolesmapping/all_access\" \\
      -H \"Content-Type: application/json\" \\
      -d '\''$ROLE_MAPPING_JSON'\'' \\
      -u admin:Admin123! \\
      -k',
    'echo Role mapping completed'
  ]" \
  --output json | jq '{CommandId: .Command.CommandId, Status: .Command.Status}'

echo ""
echo "✅ コマンドを送信しました"
echo ""
echo "2️⃣ コマンド実行結果を確認するには、以下を実行してください："
echo "aws ssm list-command-invocations --command-id <CommandId> --details"
echo ""
echo "======================================"
echo "次のステップ"
echo "======================================"
echo ""
echo "1. 上記のCommandIdをコピー"
echo "2. コマンド実行結果を確認"
echo "3. Lambda関数を再テスト: ./scripts/test-lambda-connection.sh"
