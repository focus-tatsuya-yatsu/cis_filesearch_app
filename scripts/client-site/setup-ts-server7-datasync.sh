#!/bin/bash
###############################################################################
# setup-ts-server7-datasync.sh
# 目的: ts-server7 DataSync設定の事前確認と設定支援
# 実行タイミング: DataSync設定前
###############################################################################

set -e

# カラー定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ts-server7 設定
NAS_SERVER="192.168.1.218"
NAS_NAME="ts-server7"
CATEGORY="structure"
S3_PREFIX="documents/structure/ts-server7"
AWS_REGION="ap-northeast-1"
PROJECT_NAME="cis-filesearch"

echo "=========================================="
echo -e "${BLUE}ts-server7 DataSync セットアップ支援${NC}"
echo "=========================================="
echo ""
echo -e "サーバー: ${GREEN}$NAS_NAME${NC}"
echo -e "IPアドレス: ${GREEN}$NAS_SERVER${NC}"
echo -e "カテゴリ: ${GREEN}$CATEGORY${NC}"
echo -e "S3プレフィックス: ${GREEN}$S3_PREFIX${NC}"
echo ""

# Phase 1: 事前確認
echo "=========================================="
echo -e "${BLUE}Phase 1: 事前確認${NC}"
echo "=========================================="
echo ""

# DataSync Agent確認
echo -e "${YELLOW}1. DataSync Agent 状態確認...${NC}"
AGENT_STATUS=$(aws datasync list-agents \
  --region $AWS_REGION \
  --query 'Agents[?contains(Name, `CIS`) || contains(Name, `Production`)].{Name:Name,Status:Status}' \
  --output table 2>/dev/null || echo "ERROR")

if [ "$AGENT_STATUS" == "ERROR" ]; then
    echo -e "${RED}❌ DataSync Agentの確認に失敗しました${NC}"
    echo "   AWS認証情報を確認してください"
else
    echo "$AGENT_STATUS"
    if echo "$AGENT_STATUS" | grep -q "ONLINE"; then
        echo -e "${GREEN}✅ DataSync Agent: ONLINE${NC}"
    else
        echo -e "${RED}❌ DataSync Agent: OFFLINE または見つかりません${NC}"
        echo "   Agentの状態を確認してください"
    fi
fi
echo ""

# 既存Locations確認
echo -e "${YELLOW}2. 既存 DataSync Locations 確認...${NC}"
aws datasync list-locations \
  --region $AWS_REGION \
  --query 'Locations[].{LocationUri:LocationUri,LocationArn:LocationArn}' \
  --output table 2>/dev/null || echo "Locations取得エラー"
echo ""

# S3バケット確認
echo -e "${YELLOW}3. S3バケット確認...${NC}"
S3_BUCKET=$(aws s3api list-buckets \
  --query 'Buckets[?contains(Name, `filesearch`) && contains(Name, `landing`)].Name' \
  --output text 2>/dev/null || echo "")

if [ -n "$S3_BUCKET" ]; then
    echo -e "${GREEN}✅ S3バケット: $S3_BUCKET${NC}"

    # 既存のts-server7プレフィックス確認
    echo ""
    echo -e "${YELLOW}   ts-server7フォルダ確認...${NC}"
    EXISTING_FILES=$(aws s3 ls "s3://$S3_BUCKET/$S3_PREFIX/" 2>/dev/null | head -5 || echo "")
    if [ -n "$EXISTING_FILES" ]; then
        echo -e "${YELLOW}   ⚠️  既存ファイルあり:${NC}"
        echo "$EXISTING_FILES"
    else
        echo -e "${GREEN}   ✅ ts-server7フォルダは空（新規作成）${NC}"
    fi
else
    echo -e "${RED}❌ S3バケットが見つかりません${NC}"
fi
echo ""

# 既存Tasks確認
echo -e "${YELLOW}4. 既存 DataSync Tasks 確認...${NC}"
aws datasync list-tasks \
  --region $AWS_REGION \
  --query 'Tasks[].{Name:Name,Status:Status,TaskArn:TaskArn}' \
  --output table 2>/dev/null || echo "Tasks取得エラー"
echo ""

# CloudWatch Log Group確認
echo -e "${YELLOW}5. CloudWatch Log Group 確認...${NC}"
LOG_GROUP="/aws/datasync/$PROJECT_NAME"
LOG_EXISTS=$(aws logs describe-log-groups \
  --log-group-name-prefix "$LOG_GROUP" \
  --region $AWS_REGION \
  --query 'logGroups[0].logGroupName' \
  --output text 2>/dev/null || echo "None")

if [ "$LOG_EXISTS" != "None" ] && [ -n "$LOG_EXISTS" ]; then
    echo -e "${GREEN}✅ CloudWatch Log Group: $LOG_EXISTS${NC}"
else
    echo -e "${YELLOW}⚠️  CloudWatch Log Group未作成: $LOG_GROUP${NC}"
    echo "   Task作成時に自動作成されます"
fi
echo ""

# Phase 2: 設定情報入力
echo "=========================================="
echo -e "${BLUE}Phase 2: ts-server7 設定情報${NC}"
echo "=========================================="
echo ""

echo -e "${YELLOW}以下の情報を確認・入力してください:${NC}"
echo ""

read -p "共有名 (例: FileShare, Documents): " SHARE_NAME
if [ -z "$SHARE_NAME" ]; then
    SHARE_NAME="FileShare"
    echo -e "${YELLOW}デフォルト値を使用: $SHARE_NAME${NC}"
fi

read -p "ユーザー名 (既存サーバーと同一推奨): " NAS_USERNAME
read -sp "パスワード (入力は表示されません): " NAS_PASSWORD
echo ""

read -p "ドメイン (デフォルト: WORKGROUP): " NAS_DOMAIN
NAS_DOMAIN=${NAS_DOMAIN:-WORKGROUP}

echo ""
echo "=========================================="
echo -e "${BLUE}設定確認${NC}"
echo "=========================================="
echo ""
echo -e "NASサーバー: ${GREEN}$NAS_SERVER${NC}"
echo -e "共有名: ${GREEN}$SHARE_NAME${NC}"
echo -e "ユーザー名: ${GREEN}$NAS_USERNAME${NC}"
echo -e "ドメイン: ${GREEN}$NAS_DOMAIN${NC}"
echo -e "S3プレフィックス: ${GREEN}s3://$S3_BUCKET/$S3_PREFIX/${NC}"
echo ""

read -p "この設定で続行しますか? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "中止しました"
    exit 0
fi

# Phase 3: Location作成
echo ""
echo "=========================================="
echo -e "${BLUE}Phase 3: SMB Location 作成${NC}"
echo "=========================================="
echo ""

# DataSync Agent ARN取得
AGENT_ARN=$(aws datasync list-agents \
  --region $AWS_REGION \
  --query 'Agents[?Status==`ONLINE`].AgentArn | [0]' \
  --output text 2>/dev/null)

if [ -z "$AGENT_ARN" ] || [ "$AGENT_ARN" == "None" ]; then
    echo -e "${RED}❌ ONLINEのDataSync Agentが見つかりません${NC}"
    echo "   AWSコンソールで手動設定してください"
    exit 1
fi

echo -e "${GREEN}✅ Agent ARN: $AGENT_ARN${NC}"
echo ""

echo -e "${YELLOW}SMB Location作成中...${NC}"

LOCATION_ARN=$(aws datasync create-location-smb \
  --server-hostname "$NAS_SERVER" \
  --subdirectory "/" \
  --user "$NAS_USERNAME" \
  --domain "$NAS_DOMAIN" \
  --password "$NAS_PASSWORD" \
  --agent-arns "$AGENT_ARN" \
  --mount-options Version=SMB3 \
  --tags Key=Name,Value="${PROJECT_NAME}-nas-location-${NAS_NAME}" \
         Key=Project,Value=$PROJECT_NAME \
         Key=Server,Value=$NAS_NAME \
         Key=Category,Value=$CATEGORY \
  --query 'LocationArn' \
  --output text \
  --region $AWS_REGION 2>&1)

if [[ "$LOCATION_ARN" == arn:aws:datasync:* ]]; then
    echo -e "${GREEN}✅ SMB Location作成成功${NC}"
    echo "   Location ARN: $LOCATION_ARN"
else
    echo -e "${RED}❌ SMB Location作成失敗${NC}"
    echo "   エラー: $LOCATION_ARN"
    echo ""
    echo "AWSコンソールで手動作成してください:"
    echo "  https://ap-northeast-1.console.aws.amazon.com/datasync/home?region=ap-northeast-1#/locations/create"
    exit 1
fi

# Phase 4: 設定ファイル出力
echo ""
echo "=========================================="
echo -e "${BLUE}Phase 4: 設定ファイル出力${NC}"
echo "=========================================="
echo ""

CONFIG_FILE="/tmp/ts-server7-datasync-config.sh"
cat > "$CONFIG_FILE" <<EOF
# ts-server7 DataSync Configuration
# Generated: $(date)

export TS_SERVER7_NAS_SERVER="$NAS_SERVER"
export TS_SERVER7_NAS_NAME="$NAS_NAME"
export TS_SERVER7_SHARE_NAME="$SHARE_NAME"
export TS_SERVER7_CATEGORY="$CATEGORY"
export TS_SERVER7_S3_PREFIX="$S3_PREFIX"
export TS_SERVER7_S3_BUCKET="$S3_BUCKET"
export TS_SERVER7_LOCATION_ARN="$LOCATION_ARN"
export TS_SERVER7_AGENT_ARN="$AGENT_ARN"
EOF

echo -e "${GREEN}✅ 設定ファイル作成: $CONFIG_FILE${NC}"
echo ""

# Phase 5: 次のステップ
echo "=========================================="
echo -e "${BLUE}次のステップ${NC}"
echo "=========================================="
echo ""
echo -e "${YELLOW}1. AWSコンソールでDataSync Taskを作成:${NC}"
echo "   https://ap-northeast-1.console.aws.amazon.com/datasync/home?region=ap-northeast-1#/tasks/create"
echo ""
echo "   設定内容:"
echo "   - Source: $LOCATION_ARN"
echo "   - Destination: 既存のS3 Location"
echo "   - Destination Folder: $S3_PREFIX"
echo "   - Task Name: CIS-NAS-to-S3-Sync-$NAS_NAME"
echo ""
echo -e "${YELLOW}2. テスト実行:${NC}"
echo "   Task → Start → Start with defaults"
echo "   (最初は小規模テストを推奨)"
echo ""
echo -e "${YELLOW}3. フルコピー実行:${NC}"
echo "   金曜 18:00 開始推奨"
echo "   推定時間: 36-40時間 (3.60TB, 100Mbps帯域制限時)"
echo ""
echo -e "${YELLOW}4. 月次スケジュール設定:${NC}"
echo "   cron(0 2 1 * ? *) = 毎月1日 02:00 UTC"
echo ""
echo "=========================================="
echo -e "${GREEN}セットアップ支援完了${NC}"
echo "=========================================="
