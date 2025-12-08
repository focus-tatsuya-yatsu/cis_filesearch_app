#!/bin/bash
###############################################################################
# 02-create-datasync-nas-location.sh
# 目的: DataSync NAS Location作成
# 実行タイミング: クライアント先（NAS接続後）
###############################################################################

set -e

# 環境変数読み込み
source /tmp/cis-aws-env.sh

echo "=========================================="
echo "DataSync NAS Location作成"
echo "=========================================="
echo ""

# NAS接続情報入力
read -p "NAS Server (IP or hostname): " NAS_SERVER
read -p "Share Path (e.g., shared-docs): " SHARE_PATH
read -p "Subdirectory (default: /): " SUBDIRECTORY
SUBDIRECTORY=${SUBDIRECTORY:-/}
read -p "Username: " NAS_USERNAME
read -sp "Password: " NAS_PASSWORD
echo ""
read -p "Domain (optional, press Enter to skip): " NAS_DOMAIN

echo ""
echo "📋 入力確認:"
echo "   Server: $NAS_SERVER"
echo "   Share: $SHARE_PATH"
echo "   Subdirectory: $SUBDIRECTORY"
echo "   Username: $NAS_USERNAME"
echo "   Domain: ${NAS_DOMAIN:-'(なし)'}"
echo ""

read -p "この情報で作成しますか? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "中止しました"
    exit 0
fi

# DataSync NAS Location作成
echo ""
echo "🔧 DataSync NAS Locationを作成中..."

LOCATION_NAME="cis-filesearch-nas-location"
SERVER_HOSTNAME="smb://$NAS_SERVER/$SHARE_PATH"

# AWS Secrets Managerにパスワード保存
echo "   パスワードをSecrets Managerに保存中..."
SECRET_NAME="cis-filesearch/nas-password"

aws secretsmanager create-secret \
  --name $SECRET_NAME \
  --description "NAS password for DataSync" \
  --secret-string "$NAS_PASSWORD" \
  --region $AWS_REGION 2>/dev/null || \
aws secretsmanager update-secret \
  --secret-id $SECRET_NAME \
  --secret-string "$NAS_PASSWORD" \
  --region $AWS_REGION

SECRET_ARN=$(aws secretsmanager describe-secret \
  --secret-id $SECRET_NAME \
  --query 'ARN' \
  --output text \
  --region $AWS_REGION)

echo "   ✅ パスワード保存完了: $SECRET_ARN"

# DataSync NAS Location作成
echo ""
echo "   DataSync NAS Locationを作成中..."

# ドメイン指定の有無で分岐
if [ -n "$NAS_DOMAIN" ]; then
    LOCATION_ARN=$(aws datasync create-location-smb \
      --server-hostname $SERVER_HOSTNAME \
      --subdirectory "$SUBDIRECTORY" \
      --user "$NAS_USERNAME" \
      --domain "$NAS_DOMAIN" \
      --password "$NAS_PASSWORD" \
      --agent-arns $DATASYNC_AGENT_ARN \
      --mount-options Version=SMB3 \
      --tags Key=Name,Value=$LOCATION_NAME Key=Project,Value=$PROJECT_NAME \
      --query 'LocationArn' \
      --output text \
      --region $AWS_REGION)
else
    LOCATION_ARN=$(aws datasync create-location-smb \
      --server-hostname $SERVER_HOSTNAME \
      --subdirectory "$SUBDIRECTORY" \
      --user "$NAS_USERNAME" \
      --password "$NAS_PASSWORD" \
      --agent-arns $DATASYNC_AGENT_ARN \
      --mount-options Version=SMB3 \
      --tags Key=Name,Value=$LOCATION_NAME Key=Project,Value=$PROJECT_NAME \
      --query 'LocationArn' \
      --output text \
      --region $AWS_REGION)
fi

echo ""
echo "✅ DataSync NAS Location作成完了"
echo "   Location ARN: $LOCATION_ARN"

# 環境変数ファイルに追加
cat >> /tmp/cis-aws-env.sh <<EOF

# DataSync NAS Location
export DATASYNC_NAS_LOCATION_ARN="$LOCATION_ARN"
export NAS_SERVER="$NAS_SERVER"
export NAS_SHARE_PATH="$SHARE_PATH"
EOF

echo ""
echo "=========================================="
echo "DataSync NAS Location作成完了"
echo "=========================================="
