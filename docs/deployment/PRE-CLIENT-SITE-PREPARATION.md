# クライアント先訪問前準備ガイド

**作成日**: 2025-01-19
**目的**: 自社オフィスで完了できる準備作業とクライアント先でのみ可能な作業を明確化

---

## 📋 概要

### 現在の状況

| 項目 | 状態 | 場所 |
|------|------|------|
| DataSync Agent | ✅ アクティベーション済み | Hyper-V VM (172.30.116.56) |
| Agent ID | ✅ agent-05e538aed6b309353 | AWS |
| S3 Bucket | ✅ cis-filesearch-s3-landing | AWS |
| NAS接続 | ❌ 未接続 | クライアント先のみ |
| DataSync Location | ❌ 未作成 | NAS接続後に作成可能 |
| DataSync Task | ❌ 未作成 | Location作成後に作成可能 |

### 作業分類

```
┌─────────────────────────────────────────────────────────────┐
│                    自社オフィスで可能                         │
│  - AWS設定（S3, EventBridge, SQS, CloudWatch）               │
│  - スクリプト準備                                             │
│  - 検証ツール作成                                             │
│  - ドキュメント整備                                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  クライアント先でのみ可能                      │
│  - NAS接続設定                                               │
│  - DataSync NAS Location作成                                 │
│  - DataSync Task作成・実行                                   │
│  - 初回同期テスト                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🏢 Part 1: 自社オフィスで今すぐ実行可能

### 準備チェックリスト

- [ ] AWS CLI認証設定済み
- [ ] AWS SSO/IAM権限確認済み
- [ ] 必要な環境変数設定済み
- [ ] スクリプト実行権限付与済み

---

## 1.1 環境変数設定スクリプト

**ファイル**: `/Users/tatsuya/focus_project/cis_filesearch_app/scripts/office/01-setup-env.sh`

```bash
#!/bin/bash
###############################################################################
# 01-setup-env.sh
# 目的: AWS環境変数を設定
# 実行タイミング: 自社オフィス - 最初に実行
###############################################################################

set -e

echo "=========================================="
echo "環境変数設定"
echo "=========================================="

# AWS基本設定
export AWS_REGION="ap-northeast-1"
export AWS_DEFAULT_REGION="ap-northeast-1"

# AWSアカウントID取得
echo "📋 AWSアカウントIDを取得中..."
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "   Account ID: $AWS_ACCOUNT_ID"

# プロジェクト設定
export PROJECT_NAME="cis-filesearch"
export ENVIRONMENT="production"

# S3設定
export S3_LANDING_BUCKET="cis-filesearch-s3-landing"
export S3_THUMBNAIL_BUCKET="cis-filesearch-s3-thumbnail"

# SQS設定
export SQS_QUEUE_NAME="cis-filesearch-index-queue"
export SQS_QUEUE_URL=$(aws sqs get-queue-url --queue-name $SQS_QUEUE_NAME --query 'QueueUrl' --output text)
export SQS_QUEUE_ARN=$(aws sqs get-queue-attributes --queue-url $SQS_QUEUE_URL --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

# EventBridge設定
export EVENTBRIDGE_RULE_NAME="cis-s3-to-sqs-file-upload"

# DataSync設定
export DATASYNC_AGENT_ID="agent-05e538aed6b309353"
export DATASYNC_AGENT_ARN="arn:aws:datasync:ap-northeast-1:$AWS_ACCOUNT_ID:agent/$DATASYNC_AGENT_ID"

# 環境変数をファイルに保存
cat > /tmp/cis-aws-env.sh <<EOF
export AWS_REGION="$AWS_REGION"
export AWS_DEFAULT_REGION="$AWS_DEFAULT_REGION"
export AWS_ACCOUNT_ID="$AWS_ACCOUNT_ID"
export PROJECT_NAME="$PROJECT_NAME"
export ENVIRONMENT="$ENVIRONMENT"
export S3_LANDING_BUCKET="$S3_LANDING_BUCKET"
export S3_THUMBNAIL_BUCKET="$S3_THUMBNAIL_BUCKET"
export SQS_QUEUE_NAME="$SQS_QUEUE_NAME"
export SQS_QUEUE_URL="$SQS_QUEUE_URL"
export SQS_QUEUE_ARN="$SQS_QUEUE_ARN"
export EVENTBRIDGE_RULE_NAME="$EVENTBRIDGE_RULE_NAME"
export DATASYNC_AGENT_ID="$DATASYNC_AGENT_ID"
export DATASYNC_AGENT_ARN="$DATASYNC_AGENT_ARN"
EOF

echo ""
echo "✅ 環境変数設定完了"
echo "   設定ファイル: /tmp/cis-aws-env.sh"
echo ""
echo "次回セッションで使用する場合:"
echo "   source /tmp/cis-aws-env.sh"
echo ""
echo "=========================================="
```

---

## 1.2 S3 EventBridge有効化スクリプト

**ファイル**: `/Users/tatsuya/focus_project/cis_filesearch_app/scripts/office/02-enable-s3-eventbridge.sh`

```bash
#!/bin/bash
###############################################################################
# 02-enable-s3-eventbridge.sh
# 目的: S3バケットでEventBridge通知を有効化
# 実行タイミング: 自社オフィス
###############################################################################

set -e

# 環境変数読み込み
source /tmp/cis-aws-env.sh

echo "=========================================="
echo "S3 EventBridge有効化"
echo "Bucket: $S3_LANDING_BUCKET"
echo "=========================================="

# 現在の設定確認
echo "📋 現在の通知設定を確認中..."
CURRENT_CONFIG=$(aws s3api get-bucket-notification-configuration \
  --bucket $S3_LANDING_BUCKET \
  --region $AWS_REGION 2>/dev/null || echo "{}")

echo "現在の設定:"
echo "$CURRENT_CONFIG" | jq .

# EventBridge有効化
echo ""
echo "🔧 EventBridge通知を有効化中..."
aws s3api put-bucket-notification-configuration \
  --bucket $S3_LANDING_BUCKET \
  --region $AWS_REGION \
  --notification-configuration '{
    "EventBridgeConfiguration": {}
  }'

# 確認
echo ""
echo "✅ EventBridge有効化完了"
echo ""
echo "📋 設定確認:"
aws s3api get-bucket-notification-configuration \
  --bucket $S3_LANDING_BUCKET \
  --region $AWS_REGION | jq .

echo ""
echo "=========================================="
echo "S3 EventBridge有効化完了"
echo "=========================================="
```

---

## 1.3 EventBridge Rule作成スクリプト

**ファイル**: `/Users/tatsuya/focus_project/cis_filesearch_app/scripts/office/03-create-eventbridge-rule.sh`

```bash
#!/bin/bash
###############################################################################
# 03-create-eventbridge-rule.sh
# 目的: S3→SQS EventBridgeルールを作成
# 実行タイミング: 自社オフィス
###############################################################################

set -e

# 環境変数読み込み
source /tmp/cis-aws-env.sh

echo "=========================================="
echo "EventBridge Rule作成"
echo "Rule: $EVENTBRIDGE_RULE_NAME"
echo "=========================================="

# 作業ディレクトリ作成
WORK_DIR="/tmp/cis-eventbridge-setup"
mkdir -p $WORK_DIR
cd $WORK_DIR

# イベントパターン作成
echo "📝 イベントパターンを作成中..."
cat > s3-event-pattern.json <<EOF
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["$S3_LANDING_BUCKET"]
    },
    "object": {
      "key": [{
        "prefix": "files/"
      }]
    }
  }
}
EOF

echo "イベントパターン:"
cat s3-event-pattern.json | jq .

# Input Transformer作成
echo ""
echo "📝 Input Transformerを作成中..."
cat > input-transformer.json <<'EOF'
{
  "InputPathsMap": {
    "bucket": "$.detail.bucket.name",
    "key": "$.detail.object.key",
    "size": "$.detail.object.size",
    "etag": "$.detail.object.etag",
    "time": "$.time"
  },
  "InputTemplate": "{\"eventType\":\"S3_OBJECT_CREATED\",\"s3Bucket\":\"<bucket>\",\"s3Key\":\"<key>\",\"fileSize\":<size>,\"etag\":\"<etag>\",\"eventTime\":\"<time>\",\"processingRequired\":true}"
}
EOF

echo "Input Transformer:"
cat input-transformer.json | jq .

# EventBridgeルール作成
echo ""
echo "🔧 EventBridgeルールを作成中..."
aws events put-rule \
  --name $EVENTBRIDGE_RULE_NAME \
  --description "Route S3 file upload events to SQS for processing" \
  --event-pattern file://s3-event-pattern.json \
  --state ENABLED \
  --region $AWS_REGION

# ターゲット追加（SQS）
echo ""
echo "🔧 SQSターゲットを追加中..."
aws events put-targets \
  --rule $EVENTBRIDGE_RULE_NAME \
  --targets "[{
    \"Id\": \"1\",
    \"Arn\": \"$SQS_QUEUE_ARN\",
    \"InputTransformer\": $(cat input-transformer.json | jq -c .)
  }]" \
  --region $AWS_REGION

# SQS Policy更新
echo ""
echo "🔧 SQS Policyを更新中..."

# 既存のポリシー取得
EXISTING_POLICY=$(aws sqs get-queue-attributes \
  --queue-url $SQS_QUEUE_URL \
  --attribute-names Policy \
  --query 'Attributes.Policy' \
  --output text)

# 新しいStatementを追加
cat > sqs-policy-statement.json <<EOF
{
  "Sid": "AllowEventBridgeToSendMessages",
  "Effect": "Allow",
  "Principal": {
    "Service": "events.amazonaws.com"
  },
  "Action": "sqs:SendMessage",
  "Resource": "$SQS_QUEUE_ARN",
  "Condition": {
    "ArnEquals": {
      "aws:SourceArn": "arn:aws:events:$AWS_REGION:$AWS_ACCOUNT_ID:rule/$EVENTBRIDGE_RULE_NAME"
    }
  }
}
EOF

# 既存ポリシーに新しいStatementをマージ
if [ "$EXISTING_POLICY" != "None" ] && [ -n "$EXISTING_POLICY" ]; then
  echo "$EXISTING_POLICY" | jq --argjson newStatement "$(cat sqs-policy-statement.json)" \
    '.Statement += [$newStatement]' > merged-policy.json
else
  # ポリシーが存在しない場合は新規作成
  cat > merged-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    $(cat sqs-policy-statement.json)
  ]
}
EOF
fi

# ポリシー適用
aws sqs set-queue-attributes \
  --queue-url $SQS_QUEUE_URL \
  --attributes "Policy=$(cat merged-policy.json | jq -c .)"

echo ""
echo "✅ EventBridge Rule作成完了"
echo ""
echo "📋 設定確認:"
echo ""
echo "Rule:"
aws events describe-rule --name $EVENTBRIDGE_RULE_NAME --region $AWS_REGION | jq .
echo ""
echo "Targets:"
aws events list-targets-by-rule --rule $EVENTBRIDGE_RULE_NAME --region $AWS_REGION | jq .

echo ""
echo "=========================================="
echo "EventBridge Rule作成完了"
echo "=========================================="
```

---

## 1.4 SQS Message Retention延長スクリプト

**ファイル**: `/Users/tatsuya/focus_project/cis_filesearch_app/scripts/office/04-extend-sqs-retention.sh`

```bash
#!/bin/bash
###############################################################################
# 04-extend-sqs-retention.sh
# 目的: SQSメッセージ保持期間を7日間に延長
# 実行タイミング: 自社オフィス
###############################################################################

set -e

# 環境変数読み込み
source /tmp/cis-aws-env.sh

echo "=========================================="
echo "SQS Message Retention延長"
echo "Queue: $SQS_QUEUE_NAME"
echo "=========================================="

# 現在の設定確認
echo "📋 現在のMessage Retention Periodを確認中..."
CURRENT_RETENTION=$(aws sqs get-queue-attributes \
  --queue-url $SQS_QUEUE_URL \
  --attribute-names MessageRetentionPeriod \
  --query 'Attributes.MessageRetentionPeriod' \
  --output text)

CURRENT_DAYS=$((CURRENT_RETENTION / 86400))
echo "   現在: $CURRENT_RETENTION秒 ($CURRENT_DAYS日)"

# 7日間に延長
NEW_RETENTION=604800  # 7日間
NEW_DAYS=$((NEW_RETENTION / 86400))

echo ""
echo "🔧 Message Retention Periodを更新中..."
echo "   新しい値: $NEW_RETENTION秒 ($NEW_DAYS日)"

aws sqs set-queue-attributes \
  --queue-url $SQS_QUEUE_URL \
  --attributes MessageRetentionPeriod=$NEW_RETENTION

# 確認
echo ""
echo "✅ Message Retention延長完了"
echo ""
echo "📋 設定確認:"
UPDATED_RETENTION=$(aws sqs get-queue-attributes \
  --queue-url $SQS_QUEUE_URL \
  --attribute-names MessageRetentionPeriod \
  --query 'Attributes.MessageRetentionPeriod' \
  --output text)

UPDATED_DAYS=$((UPDATED_RETENTION / 86400))
echo "   更新後: $UPDATED_RETENTION秒 ($UPDATED_DAYS日)"

echo ""
echo "=========================================="
echo "SQS Message Retention延長完了"
echo "=========================================="
```

---

## 1.5 CloudWatch Dashboard作成スクリプト

**ファイル**: `/Users/tatsuya/focus_project/cis_filesearch_app/scripts/office/05-create-cloudwatch-dashboard.sh`

```bash
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
```

---

## 1.6 統合セットアップスクリプト

**ファイル**: `/Users/tatsuya/focus_project/cis_filesearch_app/scripts/office/00-run-all-office-setup.sh`

```bash
#!/bin/bash
###############################################################################
# 00-run-all-office-setup.sh
# 目的: 自社オフィスで可能な全てのセットアップを一括実行
# 実行タイミング: 自社オフィス
###############################################################################

set -e

SCRIPT_DIR="/Users/tatsuya/focus_project/cis_filesearch_app/scripts/office"

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
```

---

## 1.7 検証スクリプト実行

```bash
# 自社オフィスでの設定確認
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/ec2-worker
python3 verify_aws_config.py
```

**期待される結果**:
```
✅ S3 EventBridge: Enabled
✅ EventBridge Rule: ENABLED
✅ SQS Message Retention: 7 days
✅ CloudWatch Dashboard: Created
```

---

## 🏗️ Part 2: クライアント先でのみ可能

### 前提条件

クライアント先で以下の情報を取得：

- [ ] NASのIPアドレスまたはホスト名
- [ ] NAS共有フォルダパス
- [ ] NAS認証情報（ユーザー名/パスワード）
- [ ] ドメイン名（Active Directory環境の場合）
- [ ] DataSync AgentからNASへのネットワーク疎通確認

---

## 2.1 NAS接続確認スクリプト

**ファイル**: `/Users/tatsuya/focus_project/cis_filesearch_app/scripts/client-site/01-test-nas-connection.ps1`

```powershell
###############################################################################
# 01-test-nas-connection.ps1
# 目的: DataSync Agent VMからNASへの接続テスト
# 実行タイミング: クライアント先
# 実行場所: Hyper-V VMまたはスキャナPC
###############################################################################

param(
    [Parameter(Mandatory=$true)]
    [string]$NasServer,

    [Parameter(Mandatory=$true)]
    [string]$SharePath,

    [Parameter(Mandatory=$true)]
    [string]$Username,

    [Parameter(Mandatory=$true)]
    [Security.SecureString]$Password,

    [Parameter(Mandatory=$false)]
    [string]$Domain = ""
)

Write-Host "=========================================="
Write-Host "NAS接続テスト"
Write-Host "=========================================="
Write-Host ""

# 接続情報表示
Write-Host "NAS Server: $NasServer"
Write-Host "Share Path: $SharePath"
Write-Host "Username: $Username"
Write-Host "Domain: $(if ($Domain) { $Domain } else { '(なし)' })"
Write-Host ""

# Ping テスト
Write-Host "Step 1: Ping テスト"
$pingResult = Test-Connection -ComputerName $NasServer -Count 4 -ErrorAction SilentlyContinue

if ($pingResult) {
    Write-Host "   ✅ Ping成功"
    Write-Host "   平均応答時間: $($pingResult.ResponseTime | Measure-Object -Average | Select-Object -ExpandProperty Average)ms"
} else {
    Write-Host "   ❌ Ping失敗 - NASサーバーに到達できません"
    exit 1
}

Write-Host ""

# SMB接続テスト
Write-Host "Step 2: SMB接続テスト"

$uncPath = "\\$NasServer\$SharePath"
Write-Host "   UNCパス: $uncPath"

try {
    # 既存の接続を削除
    net use $uncPath /delete 2>$null

    # パスワードを平文に変換（一時的）
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
    $PlainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)

    # ドメイン付きユーザー名
    $fullUsername = if ($Domain) { "$Domain\$Username" } else { $Username }

    # 接続試行
    $netUseCmd = "net use $uncPath /user:$fullUsername $PlainPassword"
    Invoke-Expression $netUseCmd | Out-Null

    Write-Host "   ✅ SMB接続成功"

    # ファイル一覧取得テスト
    Write-Host ""
    Write-Host "Step 3: ファイル一覧取得テスト"
    $files = Get-ChildItem -Path $uncPath -ErrorAction Stop | Select-Object -First 5

    Write-Host "   ✅ ファイル一覧取得成功"
    Write-Host "   最初の5ファイル:"
    $files | ForEach-Object {
        Write-Host "      - $($_.Name) ($($_.Length) bytes)"
    }

    # 読み取りテスト
    Write-Host ""
    Write-Host "Step 4: ファイル読み取りテスト"
    $testFile = $files | Where-Object { -not $_.PSIsContainer } | Select-Object -First 1

    if ($testFile) {
        $content = Get-Content -Path $testFile.FullName -TotalCount 10 -ErrorAction Stop
        Write-Host "   ✅ ファイル読み取り成功"
        Write-Host "   テストファイル: $($testFile.Name)"
    } else {
        Write-Host "   ⚠️  読み取りテスト用のファイルが見つかりません"
    }

    # 接続解除
    net use $uncPath /delete 2>$null

    Write-Host ""
    Write-Host "=========================================="
    Write-Host "✅ NAS接続テスト完了 - すべて成功"
    Write-Host "=========================================="
    Write-Host ""
    Write-Host "次のステップ:"
    Write-Host "  DataSync NAS Location作成スクリプトを実行してください"
    Write-Host ""

} catch {
    Write-Host "   ❌ エラー: $_"

    # 接続解除（エラー時）
    net use $uncPath /delete 2>$null

    Write-Host ""
    Write-Host "=========================================="
    Write-Host "❌ NAS接続テスト失敗"
    Write-Host "=========================================="
    Write-Host ""
    Write-Host "トラブルシューティング:"
    Write-Host "  1. NASサーバー名/IPアドレスが正しいか確認"
    Write-Host "  2. 共有フォルダパスが正しいか確認"
    Write-Host "  3. ユーザー名/パスワードが正しいか確認"
    Write-Host "  4. ファイアウォール設定を確認（SMB: TCP 445）"
    Write-Host "  5. ドメイン名が必要な場合は指定"
    Write-Host ""

    exit 1
}
```

---

## 2.2 DataSync NAS Location作成スクリプト

**ファイル**: `/Users/tatsuya/focus_project/cis_filesearch_app/scripts/client-site/02-create-datasync-nas-location.sh`

```bash
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
```

---

## 2.3 DataSync Task作成スクリプト

**ファイル**: `/Users/tatsuya/focus_project/cis_filesearch_app/scripts/client-site/03-create-datasync-task.sh`

```bash
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
```

---

## 2.4 初回同期テストスクリプト

**ファイル**: `/Users/tatsuya/focus_project/cis_filesearch_app/scripts/client-site/04-test-initial-sync.sh`

```bash
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
echo "   bash /path/to/05-verify-end-to-end-flow.sh"
echo ""
```

---

## 2.5 統合クライアント先セットアップスクリプト

**ファイル**: `/Users/tatsuya/focus_project/cis_filesearch_app/scripts/client-site/00-run-all-client-setup.sh`

```bash
#!/bin/bash
###############################################################################
# 00-run-all-client-setup.sh
# 目的: クライアント先で必要な全てのセットアップを一括実行
# 実行タイミング: クライアント先
###############################################################################

set -e

SCRIPT_DIR="/Users/tatsuya/focus_project/cis_filesearch_app/scripts/client-site"

echo "=========================================="
echo "CIS File Search - クライアント先一括セットアップ"
echo "=========================================="
echo ""

# 環境変数読み込み
if [ ! -f /tmp/cis-aws-env.sh ]; then
    echo "❌ 環境変数ファイルが見つかりません"
    echo "   自社オフィスのセットアップを先に実行してください"
    exit 1
fi

source /tmp/cis-aws-env.sh

# NAS接続確認（PowerShellスクリプト実行をスキップ - 手動実行前提）
echo "Step 1: NAS接続確認"
echo "   ⚠️  NAS接続テストを手動で実行してください:"
echo "   pwsh $SCRIPT_DIR/01-test-nas-connection.ps1"
echo ""
read -p "NAS接続テストが完了しましたか? (yes/no): " NAS_TEST_DONE
if [ "$NAS_TEST_DONE" != "yes" ]; then
    echo "NAS接続テストを完了してから再実行してください"
    exit 0
fi

# Step 2: DataSync NAS Location作成
echo ""
echo "Step 2: DataSync NAS Location作成"
bash $SCRIPT_DIR/02-create-datasync-nas-location.sh
source /tmp/cis-aws-env.sh
echo ""

# Step 3: DataSync Task作成
echo "Step 3: DataSync Task作成"
bash $SCRIPT_DIR/03-create-datasync-task.sh
source /tmp/cis-aws-env.sh
echo ""

# Step 4: 初回同期テスト
echo "Step 4: 初回同期テスト"
read -p "初回同期テストを実行しますか? (yes/no): " RUN_SYNC
if [ "$RUN_SYNC" == "yes" ]; then
    bash $SCRIPT_DIR/04-test-initial-sync.sh
else
    echo "   スキップしました（後で手動実行可能）"
fi

echo ""
echo "=========================================="
echo "クライアント先セットアップ完了"
echo "=========================================="
echo ""
echo "設定概要:"
echo "  - DataSync Agent: $DATASYNC_AGENT_ARN"
echo "  - NAS Location: $DATASYNC_NAS_LOCATION_ARN"
echo "  - S3 Location: $DATASYNC_S3_LOCATION_ARN"
echo "  - DataSync Task: $DATASYNC_TASK_ARN"
echo ""
echo "次のステップ:"
echo "1. 定期同期スケジュール確認（毎月1日 02:00 AM）"
echo "2. CloudWatch Dashboardでモニタリング"
echo "3. エンドツーエンドテスト実行"
echo ""
```

---

## 📋 実行チェックリスト

### 自社オフィス（今すぐ実行可能）

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app

# ディレクトリ作成
mkdir -p scripts/office
mkdir -p scripts/client-site

# スクリプトに実行権限付与
chmod +x scripts/office/*.sh
chmod +x scripts/client-site/*.sh

# 一括セットアップ実行
bash scripts/office/00-run-all-office-setup.sh

# 検証
cd backend/ec2-worker
python3 verify_aws_config.py
```

**期待される結果**:
- ✅ S3 EventBridge有効化
- ✅ EventBridge Rule作成
- ✅ SQS Message Retention 7日間
- ✅ CloudWatch Dashboard作成

### クライアント先（NAS接続必須）

```bash
# NAS接続テスト（PowerShell - Windows Scanner PC）
pwsh scripts/client-site/01-test-nas-connection.ps1 `
  -NasServer "192.168.1.100" `
  -SharePath "shared-docs" `
  -Username "nas_user" `
  -Password (ConvertTo-SecureString "password" -AsPlainText -Force)

# DataSync一括セットアップ（Bash）
bash scripts/client-site/00-run-all-client-setup.sh
```

---

## 🔍 トラブルシューティング

### 自社オフィス

**問題**: AWS CLI認証エラー

```bash
# AWS SSOログイン
aws sso login --profile default

# または環境変数設定
export AWS_PROFILE=your-profile
```

**問題**: EventBridge Rule作成失敗

```bash
# IAM権限確認
aws iam get-user
aws iam list-attached-user-policies --user-name YOUR_USERNAME

# 必要な権限
# - events:PutRule
# - events:PutTargets
# - sqs:SetQueueAttributes
```

### クライアント先

**問題**: NAS接続失敗

```
トラブルシューティング:
1. Pingテスト: ping NAS_IP
2. SMBポート確認: Test-NetConnection -ComputerName NAS_IP -Port 445
3. ファイアウォール確認
4. ユーザー名/パスワード再確認
5. ドメイン指定が必要な場合は -Domain パラメータ追加
```

**問題**: DataSync Location作成失敗

```bash
# Agent状態確認
aws datasync describe-agent \
  --agent-arn $DATASYNC_AGENT_ARN \
  --region ap-northeast-1

# 期待される状態: ONLINE

# Agent再起動（必要な場合）
# Hyper-V VMにSSHして:
sudo systemctl restart amazon-datasync-agent
```

---

## 📊 進捗確認

### 自社オフィスでの完了確認

```bash
# チェックリスト
aws s3api get-bucket-notification-configuration --bucket cis-filesearch-s3-landing
aws events describe-rule --name cis-s3-to-sqs-file-upload
aws sqs get-queue-attributes --queue-url $SQS_QUEUE_URL --attribute-names MessageRetentionPeriod
aws cloudwatch get-dashboard --dashboard-name CIS-FileSearch-Monitoring
```

### クライアント先での完了確認

```bash
# チェックリスト
aws datasync describe-location-smb --location-arn $DATASYNC_NAS_LOCATION_ARN
aws datasync describe-location-s3 --location-arn $DATASYNC_S3_LOCATION_ARN
aws datasync describe-task --task-arn $DATASYNC_TASK_ARN
aws s3 ls s3://cis-filesearch-s3-landing/files/ --recursive | wc -l
```

---

## 📚 関連ドキュメント

- AWS DataSync設定: `/docs/deployment/datasync/`
- EventBridge設定: `/docs/deployment/aws-eventbridge-s3-sqs-guide.md`
- CloudWatch監視: `/docs/deployment/aws-cloudwatch-configuration-guide.md`
- セキュリティ: `/docs/security/aws-beginner-security-guide.md`

---

**Document Version**: 1.0
**Last Updated**: 2025-01-19
**Author**: CIS Development Team
