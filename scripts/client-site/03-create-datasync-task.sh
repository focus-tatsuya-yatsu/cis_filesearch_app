#!/bin/bash
###############################################################################
# 03-create-datasync-task.sh
# 目的: DataSync Task作成（NAS → S3）
# 実行タイミング: クライアント先（NAS Location作成後）
###############################################################################

set -e

# 環境変数読み込み
source /tmp/cis-aws-env.sh

echo "=========================================="
echo "DataSync Task作成"
echo "=========================================="
echo ""

# S3 Location ARN取得
echo "📋 S3 Locationを確認中..."
S3_LOCATION_ARN=$(aws datasync list-locations \
  --filters "Name=LocationType,Values=S3,Operator=Equals" \
  --query "Locations[?contains(LocationUri, '$S3_LANDING_BUCKET')].LocationArn | [0]" \
  --output text \
  --region $AWS_REGION)

if [ "$S3_LOCATION_ARN" == "None" ] || [ -z "$S3_LOCATION_ARN" ]; then
    echo "❌ S3 Locationが見つかりません"
    echo ""
    echo "S3 Locationを作成中..."

    # IAM Role ARN取得
    IAM_ROLE_ARN=$(aws iam get-role \
      --role-name "cis-filesearch-datasync-s3-access" \
      --query 'Role.Arn' \
      --output text)

    # S3 Location作成
    S3_LOCATION_ARN=$(aws datasync create-location-s3 \
      --s3-bucket-arn "arn:aws:s3:::$S3_LANDING_BUCKET" \
      --subdirectory "/files" \
      --s3-config "BucketAccessRoleArn=$IAM_ROLE_ARN" \
      --tags Key=Name,Value="cis-filesearch-s3-location" Key=Project,Value=$PROJECT_NAME \
      --query 'LocationArn' \
      --output text \
      --region $AWS_REGION)

    echo "   ✅ S3 Location作成完了: $S3_LOCATION_ARN"
else
    echo "   ✅ S3 Location確認: $S3_LOCATION_ARN"
fi

echo ""
echo "📋 設定確認:"
echo "   Source (NAS): $DATASYNC_NAS_LOCATION_ARN"
echo "   Destination (S3): $S3_LOCATION_ARN"
echo ""

# CloudWatch Log Group確認
LOG_GROUP_NAME="/aws/datasync/$PROJECT_NAME"
echo "📋 CloudWatch Log Groupを確認中..."

aws logs describe-log-groups \
  --log-group-name-prefix $LOG_GROUP_NAME \
  --region $AWS_REGION > /dev/null 2>&1 || \
aws logs create-log-group \
  --log-group-name $LOG_GROUP_NAME \
  --region $AWS_REGION

LOG_GROUP_ARN=$(aws logs describe-log-groups \
  --log-group-name-prefix $LOG_GROUP_NAME \
  --query "logGroups[0].arn" \
  --output text \
  --region $AWS_REGION)

echo "   ✅ CloudWatch Log Group: $LOG_GROUP_ARN"

# DataSync Task作成
echo ""
echo "🔧 DataSync Taskを作成中..."

TASK_NAME="cis-filesearch-monthly-batch-sync"

TASK_ARN=$(aws datasync create-task \
  --source-location-arn $DATASYNC_NAS_LOCATION_ARN \
  --destination-location-arn $S3_LOCATION_ARN \
  --name $TASK_NAME \
  --cloud-watch-log-group-arn $LOG_GROUP_ARN \
  --options '{
    "VerifyMode": "POINT_IN_TIME_CONSISTENT",
    "TransferMode": "CHANGED",
    "PreserveDeletedFiles": "REMOVE",
    "PreserveDevices": "NONE",
    "PosixPermissions": "NONE",
    "BytesPerSecond": 12500000,
    "TaskQueueing": "ENABLED",
    "LogLevel": "TRANSFER",
    "OverwriteMode": "ALWAYS",
    "Atime": "BEST_EFFORT",
    "Mtime": "PRESERVE",
    "Uid": "NONE",
    "Gid": "NONE",
    "SecurityDescriptorCopyFlags": "NONE"
  }' \
  --schedule '{
    "ScheduleExpression": "cron(0 2 1 * ? *)"
  }' \
  --tags Key=Name,Value=$TASK_NAME Key=Project,Value=$PROJECT_NAME \
  --query 'TaskArn' \
  --output text \
  --region $AWS_REGION)

echo ""
echo "✅ DataSync Task作成完了"
echo "   Task ARN: $TASK_ARN"
echo "   スケジュール: 毎月1日 02:00 AM"
echo "   転送モード: CHANGED（差分のみ）"
echo "   帯域制限: 100 Mbps"

# 環境変数ファイルに追加
cat >> /tmp/cis-aws-env.sh <<EOF

# DataSync Task
export DATASYNC_TASK_ARN="$TASK_ARN"
export DATASYNC_S3_LOCATION_ARN="$S3_LOCATION_ARN"
EOF

echo ""
echo "=========================================="
echo "DataSync Task作成完了"
echo "=========================================="
