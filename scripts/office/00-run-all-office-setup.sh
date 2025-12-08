#!/bin/bash
###############################################################################
# 00-run-all-office-setup.sh
# 目的: 自社オフィスで可能な全てのセットアップを一括実行
# 実行タイミング: 自社オフィス
###############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================="
echo "CIS File Search - 自社オフィス一括セットアップ"
echo "=========================================="
echo ""

# Step 1: 環境変数設定
echo "Step 1/5: 環境変数設定"
bash $SCRIPT_DIR/01-setup-env.sh
source /tmp/cis-aws-env.sh
echo ""

# Step 2: S3 EventBridge有効化
echo "Step 2/5: S3 EventBridge有効化"
bash $SCRIPT_DIR/02-enable-s3-eventbridge.sh
echo ""

# Step 3: EventBridge Rule作成
echo "Step 3/5: EventBridge Rule作成"
bash $SCRIPT_DIR/03-create-eventbridge-rule.sh
echo ""

# Step 4: SQS Retention延長
echo "Step 4/5: SQS Message Retention延長"
bash $SCRIPT_DIR/04-extend-sqs-retention.sh
echo ""

# Step 5: CloudWatch Dashboard作成
echo "Step 5/5: CloudWatch Dashboard作成"
bash $SCRIPT_DIR/05-create-cloudwatch-dashboard.sh
echo ""

echo "=========================================="
echo "自社オフィスセットアップ完了"
echo "=========================================="
echo ""
echo "次のステップ:"
echo "1. 検証スクリプトを実行"
echo "   cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/ec2-worker"
echo "   python3 verify_aws_config.py"
echo ""
echo "2. クライアント先での作業準備"
echo "   - NAS接続情報確認"
echo "   - DataSync Location作成スクリプト準備"
echo ""
