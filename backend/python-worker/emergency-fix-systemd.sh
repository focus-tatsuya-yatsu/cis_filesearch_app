#!/bin/bash
# systemdサービスファイル構文エラーの緊急修正
set -e

echo "🚨 systemdサービスファイルの緊急修正を開始"
echo "============================================"

# AWSプロファイル設定
export AWS_PROFILE=AdministratorAccess-770923989980
export AWS_REGION=ap-northeast-1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 新しいインスタンスID
INSTANCE_ID="i-0e19cc464c446afe6"

echo -e "${YELLOW}対象インスタンス: $INSTANCE_ID${NC}"
echo ""

# 修正版systemdサービスファイル作成
echo "修正版systemdサービスファイルを作成中..."

cat > /tmp/fixed_worker.service << 'EOF'
[Unit]
Description=CIS File Search Worker (Fixed)
After=network.target
Documentation=https://docs.cis-filesearch.internal/worker

# 再起動制限：10分間に最大3回
StartLimitIntervalSec=600
StartLimitBurst=3

[Service]
Type=simple
# セキュリティ向上のため後で専用ユーザーに変更予定
User=root
WorkingDirectory=/opt/worker

# 起動コマンド（バッファリング無効化）
ExecStart=/usr/bin/python3 -u /opt/worker/worker.py

# 再起動設定（失敗時のみ、間隔30秒）
Restart=on-failure
RestartSec=30
SuccessExitStatus=0

# タイムアウト設定
TimeoutStartSec=60
TimeoutStopSec=30

# リソース制限（メモリリーク対策）
MemoryMax=3G
MemorySwapMax=0
TasksMax=100

# CPUクォータ（他のプロセスへの影響防止）
CPUQuota=200%

# ログ設定
StandardOutput=journal
StandardError=journal
SyslogIdentifier=cis-worker

# 環境変数
Environment="AWS_REGION=ap-northeast-1"
Environment="SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
Environment="DLQ_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq"
Environment="OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
Environment="PYTHONUNBUFFERED=1"
Environment="LOG_LEVEL=INFO"

# パフォーマンス最適化設定
Environment="SQS_MAX_MESSAGES=10"
Environment="SQS_WAIT_TIME=20"
Environment="SQS_VISIBILITY_TIMEOUT=900"
Environment="WORKER_BATCH_SIZE=10"

# メモリ管理
Environment="PYTHONOPTIMIZE=1"
Environment="PYTHONDONTWRITEBYTECODE=1"

[Install]
WantedBy=multi-user.target
EOF

echo -e "${GREEN}✅ 修正版サービスファイル作成完了${NC}"
echo ""

# SSMを使用してEC2インスタンスに修正を適用
echo "SSMを使用して修正を適用中..."

# SSMが利用可能か確認
SSM_STATUS=$(aws ssm describe-instance-information \
    --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
    --query 'InstanceInformationList[0].PingStatus' \
    --output text 2>/dev/null || echo "NotFound")

if [ "$SSM_STATUS" = "Online" ]; then
    echo "SSMを使用して修正を適用..."

    # サービスファイルをBase64エンコード
    SERVICE_CONTENT=$(base64 < /tmp/fixed_worker.service)

    # SSMコマンド送信
    COMMAND_ID=$(aws ssm send-command \
        --instance-ids "$INSTANCE_ID" \
        --document-name "AWS-RunShellScript" \
        --parameters "commands=[
            'echo \"$SERVICE_CONTENT\" | base64 -d > /tmp/worker.service',
            'sudo cp /tmp/worker.service /etc/systemd/system/worker.service',
            'sudo systemctl daemon-reload',
            'sudo systemctl restart worker.service',
            'sleep 5',
            'sudo systemctl status worker.service --no-pager'
        ]" \
        --query 'Command.CommandId' \
        --output text)

    echo "コマンドID: $COMMAND_ID"
    echo "実行中... (30秒待機)"
    sleep 30

    # 結果取得
    aws ssm get-command-invocation \
        --command-id "$COMMAND_ID" \
        --instance-id "$INSTANCE_ID" \
        --query 'StandardOutputContent' \
        --output text

    echo -e "${GREEN}✅ SSMによる修正完了${NC}"

else
    echo -e "${YELLOW}⚠️  SSMが利用できません。代替方法を提供します${NC}"
    echo ""
    echo "以下の手順で手動修正してください："
    echo ""
    echo "1. EC2インスタンスにSSH接続:"
    echo "   ssh ec2-user@<EC2_IP>"
    echo ""
    echo "2. 以下のコマンドを実行:"
    echo "   sudo nano /etc/systemd/system/worker.service"
    echo ""
    echo "3. 12行目を変更:"
    echo "   変更前: User=root  # TODO: セキュリティ向上のため後で専用ユーザーに変更"
    echo "   変更後: User=root"
    echo ""
    echo "4. サービス再起動:"
    echo "   sudo systemctl daemon-reload"
    echo "   sudo systemctl restart worker.service"
    echo "   sudo systemctl status worker.service"
fi

echo ""
echo "================================"
echo "📊 現在のSQS状況確認"
echo "================================"

# SQS統計
QUEUE_COUNT=$(aws sqs get-queue-attributes \
    --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
    --attribute-names ApproximateNumberOfMessages \
    --query 'Attributes.ApproximateNumberOfMessages' \
    --output text)

echo "現在のメッセージ数: $(printf "%'d" $QUEUE_COUNT)"

# 代替修正方法：User Dataを再度更新
echo ""
echo "================================"
echo "代替修正方法: Launch Template再更新"
echo "================================"

# 修正版User Dataスクリプト作成（コメントを別行に移動）
cat > /tmp/emergency_userdata.sh << 'EOFUD'
#!/bin/bash
set +e
exec > >(tee /var/log/user-data.log)
exec 2>&1

echo "=== Emergency Fix User Data Started at $(date) ==="

# 既存のサービスを停止
systemctl stop worker.service || true

# 修正版サービスファイルを作成
cat <<'EOFSERVICE' > /etc/systemd/system/worker.service
[Unit]
Description=CIS File Search Worker (Emergency Fix)
After=network.target

StartLimitIntervalSec=600
StartLimitBurst=3

[Service]
Type=simple
# TODO: セキュリティ向上のため専用ユーザーに変更予定
User=root
WorkingDirectory=/opt/worker
ExecStart=/usr/bin/python3 -u /opt/worker/worker.py
Restart=on-failure
RestartSec=30
SuccessExitStatus=0
TimeoutStartSec=60
TimeoutStopSec=30
MemoryMax=3G
MemorySwapMax=0
TasksMax=100
CPUQuota=200%
StandardOutput=journal
StandardError=journal
SyslogIdentifier=cis-worker

Environment="AWS_REGION=ap-northeast-1"
Environment="SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
Environment="DLQ_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq"
Environment="OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
Environment="PYTHONUNBUFFERED=1"
Environment="LOG_LEVEL=INFO"
Environment="SQS_MAX_MESSAGES=10"
Environment="SQS_WAIT_TIME=20"
Environment="SQS_VISIBILITY_TIMEOUT=900"
Environment="WORKER_BATCH_SIZE=10"
Environment="PYTHONOPTIMIZE=1"
Environment="PYTHONDONTWRITEBYTECODE=1"

[Install]
WantedBy=multi-user.target
EOFSERVICE

# サービス再起動
systemctl daemon-reload
systemctl restart worker.service
sleep 5
systemctl status worker.service --no-pager

echo "=== Emergency Fix Completed at $(date) ==="
EOFUD

echo -e "${GREEN}✅ 緊急修正スクリプト作成完了${NC}"
echo ""
echo "次のアクション:"
echo "1. SSMが失敗した場合は、新しいインスタンスを再起動"
echo "2. ./real-time-monitor.sh でメッセージ処理を確認"
echo "3. 処理が始まらない場合は、このスクリプトを再実行"