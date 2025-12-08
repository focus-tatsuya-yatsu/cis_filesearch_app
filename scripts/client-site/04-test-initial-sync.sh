#!/bin/bash
###############################################################################
# 04-test-initial-sync.sh
# 目的: DataSync Task手動実行とモニタリング
# 実行タイミング: クライアント先（Task作成後）
###############################################################################

set -e

# 環境変数読み込み
source /tmp/cis-aws-env.sh

echo "=========================================="
echo "DataSync初回同期テスト"
echo "=========================================="
echo ""

# Task実行
echo "🚀 DataSync Taskを実行中..."
TASK_EXECUTION_ARN=$(aws datasync start-task-execution \
  --task-arn $DATASYNC_TASK_ARN \
  --query 'TaskExecutionArn' \
  --output text \
  --region $AWS_REGION)

echo "   Task Execution ARN: $TASK_EXECUTION_ARN"
echo ""

# 進捗モニタリング
echo "📊 同期進捗をモニタリング中..."
echo "   (Ctrl+Cで中断可能 - タスクは継続実行されます)"
echo ""

PREV_STATUS=""
while true; do
    # タスク実行状態取得
    EXECUTION=$(aws datasync describe-task-execution \
      --task-execution-arn $TASK_EXECUTION_ARN \
      --region $AWS_REGION)

    STATUS=$(echo $EXECUTION | jq -r '.Status')

    # ステータスが変わった場合のみ表示
    if [ "$STATUS" != "$PREV_STATUS" ]; then
        echo "[$(date +'%H:%M:%S')] Status: $STATUS"
        PREV_STATUS=$STATUS
    fi

    # 詳細統計表示
    if [ "$STATUS" == "TRANSFERRING" ]; then
        BYTES_WRITTEN=$(echo $EXECUTION | jq -r '.BytesWritten // 0')
        FILES_TRANSFERRED=$(echo $EXECUTION | jq -r '.FilesTransferred // 0')

        BYTES_MB=$((BYTES_WRITTEN / 1024 / 1024))
        echo "   転送済み: ${BYTES_MB} MB, ファイル数: $FILES_TRANSFERRED"
    fi

    # 完了判定
    if [ "$STATUS" == "SUCCESS" ]; then
        echo ""
        echo "✅ 同期完了"

        # 最終統計表示
        echo ""
        echo "📊 同期統計:"
        echo $EXECUTION | jq '{
          Status: .Status,
          BytesTransferred: .BytesTransferred,
          BytesWritten: .BytesWritten,
          FilesTransferred: .FilesTransferred,
          StartTime: .StartTime,
          EstimatedBytesToTransfer: .EstimatedBytesToTransfer
        }'

        break
    elif [ "$STATUS" == "ERROR" ]; then
        echo ""
        echo "❌ 同期エラー"
        echo ""
        echo "エラー詳細:"
        echo $EXECUTION | jq '{
          Status: .Status,
          ErrorCode: .ErrorCode,
          ErrorDetail: .ErrorDetail
        }'

        exit 1
    fi

    sleep 10
done

# S3バケット確認
echo ""
echo "📋 S3バケット確認..."
FILE_COUNT=$(aws s3 ls s3://$S3_LANDING_BUCKET/files/ --recursive | wc -l)
echo "   転送されたファイル数: $FILE_COUNT"

# サンプルファイル表示
echo ""
echo "📄 最初の10ファイル:"
aws s3 ls s3://$S3_LANDING_BUCKET/files/ --recursive | head -n 10

echo ""
echo "=========================================="
echo "DataSync初回同期テスト完了"
echo "=========================================="
echo ""
echo "次のステップ:"
echo "1. S3バケットのファイルを確認"
echo "   aws s3 ls s3://$S3_LANDING_BUCKET/files/ --recursive"
echo ""
echo "2. EventBridge → SQS → EC2処理フローを確認"
echo ""
