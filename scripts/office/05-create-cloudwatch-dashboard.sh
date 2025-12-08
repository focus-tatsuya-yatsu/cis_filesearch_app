#!/bin/bash
###############################################################################
# 05-create-cloudwatch-dashboard.sh
# 目的: DataSync/EventBridge/SQS監視用CloudWatch Dashboard作成
# 実行タイミング: 自社オフィス
###############################################################################

set -e

# 環境変数読み込み
source /tmp/cis-aws-env.sh

echo "=========================================="
echo "CloudWatch Dashboard作成"
echo "=========================================="

DASHBOARD_NAME="CIS-FileSearch-Monitoring"

# Dashboard定義作成
cat > /tmp/dashboard-body.json <<EOF
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/Events", "Invocations", {"stat": "Sum", "label": "EventBridge Invocations"}],
          [".", "FailedInvocations", {"stat": "Sum", "label": "Failed Invocations"}]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "$AWS_REGION",
        "title": "EventBridge Rule: $EVENTBRIDGE_RULE_NAME",
        "yAxis": {
          "left": {
            "min": 0
          }
        }
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/SQS", "NumberOfMessagesSent", {"stat": "Sum"}],
          [".", "NumberOfMessagesReceived", {"stat": "Sum"}],
          [".", "NumberOfMessagesDeleted", {"stat": "Sum"}]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "$AWS_REGION",
        "title": "SQS Queue: $SQS_QUEUE_NAME",
        "yAxis": {
          "left": {
            "min": 0
          }
        }
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/SQS", "ApproximateNumberOfMessagesVisible", {"stat": "Average"}]
        ],
        "period": 60,
        "stat": "Average",
        "region": "$AWS_REGION",
        "title": "SQS Queue Depth",
        "yAxis": {
          "left": {
            "min": 0
          }
        }
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/DataSync", "BytesTransferred", {"stat": "Sum"}],
          [".", "FilesPrepared", {"stat": "Sum"}],
          [".", "FilesTransferred", {"stat": "Sum"}]
        ],
        "period": 3600,
        "stat": "Sum",
        "region": "$AWS_REGION",
        "title": "DataSync Transfer Metrics",
        "yAxis": {
          "left": {
            "min": 0
          }
        }
      }
    },
    {
      "type": "log",
      "properties": {
        "query": "SOURCE '/aws/datasync/cis-filesearch'\n| fields @timestamp, @message\n| filter @message like /ERROR/\n| sort @timestamp desc\n| limit 20",
        "region": "$AWS_REGION",
        "title": "DataSync Error Logs"
      }
    }
  ]
}
EOF

echo "📝 Dashboard定義を作成しました"

# Dashboard作成
echo ""
echo "🔧 CloudWatch Dashboardを作成中..."
aws cloudwatch put-dashboard \
  --dashboard-name $DASHBOARD_NAME \
  --dashboard-body file:///tmp/dashboard-body.json \
  --region $AWS_REGION

echo ""
echo "✅ CloudWatch Dashboard作成完了"
echo ""
echo "📊 ダッシュボードURL:"
echo "   https://console.aws.amazon.com/cloudwatch/home?region=$AWS_REGION#dashboards:name=$DASHBOARD_NAME"

echo ""
echo "=========================================="
echo "CloudWatch Dashboard作成完了"
echo "=========================================="
