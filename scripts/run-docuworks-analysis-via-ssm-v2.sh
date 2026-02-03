#!/bin/bash
#
# SSM経由でEC2上でDocuworks分析を実行（改良版）
# S3経由でスクリプトを転送して実行
#

set -e

# 設定
EC2_INSTANCE_ID="${EC2_INSTANCE_ID:-i-0e6ac1e4d535a4ab2}"
REGION="${AWS_REGION:-ap-northeast-1}"
S3_BUCKET="cis-filesearch-s3-landing"
S3_KEY="scripts/analyze-docuworks.py"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "============================================================"
echo "SSM経由でDocuworks分析を実行"
echo "EC2 Instance: $EC2_INSTANCE_ID"
echo "Region: $REGION"
echo "============================================================"

# Pythonスクリプトファイル
SCRIPT_FILE="$SCRIPT_DIR/analyze-docuworks-opensearch.py"

if [ ! -f "$SCRIPT_FILE" ]; then
    echo "Error: Script file not found: $SCRIPT_FILE"
    exit 1
fi

# S3にスクリプトをアップロード
echo "Uploading script to S3..."
aws s3 cp "$SCRIPT_FILE" "s3://$S3_BUCKET/$S3_KEY" --region "$REGION"

# SSMコマンドを送信（S3からダウンロードして実行）
echo ""
echo "SSMコマンドを送信中..."

COMMAND_ID=$(aws ssm send-command \
    --instance-ids "$EC2_INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters commands='["pip3 install -q boto3 opensearch-py requests-aws4auth 2>/dev/null || true","aws s3 cp s3://'"$S3_BUCKET"'/'"$S3_KEY"' /tmp/analyze-docuworks.py --region '"$REGION"'","python3 /tmp/analyze-docuworks.py"]' \
    --region "$REGION" \
    --timeout-seconds 300 \
    --output text \
    --query "Command.CommandId")

echo "Command ID: $COMMAND_ID"
echo "結果を待機中（最大120秒）..."

# コマンドの完了を待機
for i in {1..120}; do
    STATUS=$(aws ssm list-commands \
        --command-id "$COMMAND_ID" \
        --region "$REGION" \
        --output text \
        --query "Commands[0].Status")

    if [ "$STATUS" = "Success" ] || [ "$STATUS" = "Failed" ] || [ "$STATUS" = "TimedOut" ]; then
        break
    fi

    if [ $((i % 10)) -eq 0 ]; then
        echo "  ... 待機中 ($i 秒経過)"
    fi

    sleep 1
done

echo ""
echo "コマンドステータス: $STATUS"
echo ""

# 結果を取得
if [ "$STATUS" = "Success" ]; then
    echo "============================================================"
    echo "分析結果:"
    echo "============================================================"
    aws ssm get-command-invocation \
        --command-id "$COMMAND_ID" \
        --instance-id "$EC2_INSTANCE_ID" \
        --region "$REGION" \
        --output text \
        --query "StandardOutputContent"
else
    echo "エラー出力:"
    aws ssm get-command-invocation \
        --command-id "$COMMAND_ID" \
        --instance-id "$EC2_INSTANCE_ID" \
        --region "$REGION" \
        --output text \
        --query "StandardErrorContent"
    echo ""
    echo "標準出力:"
    aws ssm get-command-invocation \
        --command-id "$COMMAND_ID" \
        --instance-id "$EC2_INSTANCE_ID" \
        --region "$REGION" \
        --output text \
        --query "StandardOutputContent"
fi

# S3からスクリプトを削除（オプション）
# aws s3 rm "s3://$S3_BUCKET/$S3_KEY" --region "$REGION"
