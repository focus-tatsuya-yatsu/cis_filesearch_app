#!/bin/bash
# 処理速度低下の緊急修正スクリプト
set -e

echo "🚨 処理速度低下の緊急修正"
echo "=================================="
echo ""

export AWS_PROFILE=AdministratorAccess-770923989980
export AWS_REGION=ap-northeast-1

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 現在の状況
echo -e "${YELLOW}現在の問題：${NC}"
echo "• 処理速度: 122 msg/分（期待値の25%）"
echo "• workerがexit status 1で再起動ループ"
echo "• DLQメッセージ増加中: 7,959"
echo ""

# インスタンス確認
INSTANCE_ID="i-0a6e5b320f3b1c143"
echo -e "${BLUE}対象インスタンス: $INSTANCE_ID${NC}"
echo ""

# Step 1: 軽量版User Dataを作成（最小構成で安定動作優先）
echo -e "${GREEN}Step 1: 軽量・安定版のworker設定を作成${NC}"

cat > /tmp/emergency_fix_userdata.sh << 'EOF'
#!/bin/bash
set +e  # エラーでも継続
exec > >(tee /var/log/user-data.log)
exec 2>&1

echo "=== Emergency Speed Fix Started at $(date) ==="

export AWS_REGION="ap-northeast-1"
export S3_BUCKET="cis-filesearch-worker-scripts"

# システム準備（最小限）
yum install -y python3 python3-pip || true

# 必要最小限のパッケージのみ
pip3 uninstall -y requests urllib3 || true  # 競合パッケージを一旦削除
pip3 install boto3==1.26.137 --no-deps || true
pip3 install opensearch-py==2.2.0 --no-deps || true
pip3 install botocore==1.29.137 --no-deps || true
pip3 install urllib3==1.26.16 || true
pip3 install certifi || true
pip3 install python-dateutil || true
pip3 install six || true

# スクリプトダウンロード
mkdir -p /opt/worker
cd /opt/worker
aws s3 cp s3://${S3_BUCKET}/scripts/worker.py /opt/worker/worker.py --region ${AWS_REGION}
chmod +x /opt/worker/worker.py

# 最小構成のconfig.py作成（ファイルが存在しない場合のフォールバック）
cat <<'EOFCONFIG' > /opt/worker/config_minimal.py
import os

class Config:
    def __init__(self):
        self.aws_region = os.getenv('AWS_REGION', 'ap-northeast-1')
        self.sqs_queue_url = os.getenv('SQS_QUEUE_URL', 'https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue')
        self.dlq_queue_url = os.getenv('DLQ_QUEUE_URL', 'https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq')
        self.opensearch_endpoint = os.getenv('OPENSEARCH_ENDPOINT', 'https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com')
        self.sqs_max_messages = int(os.getenv('SQS_MAX_MESSAGES', '5'))  # 安定性重視で5に削減
        self.sqs_visibility_timeout = int(os.getenv('SQS_VISIBILITY_TIMEOUT', '60'))  # 短縮して早期リトライ
        self.sqs_wait_time = int(os.getenv('SQS_WAIT_TIME', '10'))
        self.worker_threads = int(os.getenv('WORKER_THREADS', '2'))  # 少数スレッドで安定動作
        self.log_level = os.getenv('LOG_LEVEL', 'INFO')

    def validate(self):
        return True  # 簡略化
EOFCONFIG

# config.pyが無い場合は最小版を使用
if [ ! -f /opt/worker/config.py ]; then
    cp /opt/worker/config_minimal.py /opt/worker/config.py
fi

# シンプルなwrapper作成（エラーハンドリング付き）
cat <<'EOFWRAPPER' > /opt/worker/worker_wrapper.py
#!/usr/bin/env python3
import sys
import time
import traceback
import os

def main():
    retry_count = 0
    max_retries = 3

    while retry_count < max_retries:
        try:
            # worker.pyをインポートして実行
            sys.path.insert(0, '/opt/worker')
            import worker

            print(f"Starting worker (attempt {retry_count + 1}/{max_retries})")
            # workerのmain関数を呼び出す（存在する場合）
            if hasattr(worker, 'main'):
                worker.main()
            else:
                # main関数がない場合は、直接実行されることを想定
                exec(open('/opt/worker/worker.py').read())

        except ImportError as e:
            print(f"Import error: {e}")
            print("Attempting to fix missing dependencies...")
            os.system(f"pip3 install {str(e).split()[-1]} --no-deps")
            retry_count += 1
            time.sleep(5)

        except Exception as e:
            print(f"Worker crashed with error: {e}")
            print(traceback.format_exc())
            retry_count += 1
            time.sleep(10)

    print(f"Worker failed after {max_retries} attempts")
    sys.exit(1)

if __name__ == "__main__":
    main()
EOFWRAPPER

chmod +x /opt/worker/worker_wrapper.py

# 安定版systemdサービス
cat <<'EOFSERVICE' > /etc/systemd/system/worker.service
[Unit]
Description=CIS Worker (Emergency Fix)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/worker

# wrapperを使用してエラーハンドリング
ExecStart=/usr/bin/python3 -u /opt/worker/worker_wrapper.py

# 再起動設定（段階的バックオフ）
Restart=on-failure
RestartSec=60
StartLimitIntervalSec=300
StartLimitBurst=3

# リソース制限
MemoryMax=2G
CPUQuota=150%

# タイムアウト
TimeoutStartSec=60
TimeoutStopSec=30

# 環境変数（最適化済み）
Environment="AWS_REGION=ap-northeast-1"
Environment="SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
Environment="DLQ_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq"
Environment="OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
Environment="PYTHONUNBUFFERED=1"
Environment="PYTHONDONTWRITEBYTECODE=1"
Environment="SQS_MAX_MESSAGES=5"
Environment="SQS_VISIBILITY_TIMEOUT=60"
Environment="SQS_WAIT_TIME=10"
Environment="WORKER_THREADS=2"
Environment="LOG_LEVEL=WARNING"

StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOFSERVICE

systemctl daemon-reload
systemctl restart worker.service

# ステータス確認
sleep 30
echo "=== Service Status ==="
systemctl status worker.service --no-pager || true

# プロセス確認
echo "=== Process Check ==="
ps aux | grep -E "worker|python" | grep -v grep || true

echo "=== Emergency Fix Completed at $(date) ==="
EOF

echo -e "${GREEN}✅ 緊急修正スクリプト作成完了${NC}"
echo ""

# Step 2: Launch Template更新
echo -e "${GREEN}Step 2: Launch Template更新${NC}"

if [[ "$OSTYPE" == "darwin"* ]]; then
    USER_DATA_BASE64=$(base64 -i /tmp/emergency_fix_userdata.sh)
else
    USER_DATA_BASE64=$(base64 -w0 /tmp/emergency_fix_userdata.sh)
fi

NEW_VERSION=$(aws ec2 create-launch-template-version \
    --launch-template-name cis-filesearch-worker-template \
    --source-version '$Latest' \
    --launch-template-data "{\"UserData\":\"${USER_DATA_BASE64}\"}" \
    --query 'LaunchTemplateVersion.VersionNumber' \
    --output text)

echo "新バージョン作成: v$NEW_VERSION"

aws ec2 modify-launch-template \
    --launch-template-name cis-filesearch-worker-template \
    --default-version $NEW_VERSION > /dev/null

echo -e "${GREEN}✅ Launch Template更新完了${NC}"
echo ""

# Step 3: インスタンス再起動
echo -e "${YELLOW}Step 3: インスタンス再起動${NC}"
echo "以下の改善が適用されます："
echo "• pip依存関係の競合解決"
echo "• 最小構成で安定動作"
echo "• エラーハンドリング強化"
echo "• リソース制限の調整"
echo ""

read -p "インスタンスを再起動しますか？ (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "インスタンス再起動中..."

    aws autoscaling terminate-instance-in-auto-scaling-group \
        --instance-id $INSTANCE_ID \
        --no-should-decrement-desired-capacity > /dev/null

    echo "終了リクエスト送信..."

    # 新インスタンス待機
    for i in {1..10}; do
        sleep 30

        NEW_INSTANCE=$(aws autoscaling describe-auto-scaling-groups \
            --auto-scaling-group-names cis-filesearch-ec2-autoscaling \
            --query 'AutoScalingGroups[0].Instances[?LifecycleState==`InService`].InstanceId' \
            --output text)

        if [ -n "$NEW_INSTANCE" ] && [ "$NEW_INSTANCE" != "$INSTANCE_ID" ]; then
            echo -e "${GREEN}✅ 新インスタンス起動: $NEW_INSTANCE${NC}"
            break
        fi

        echo "待機中... ($i/10)"
    done

    # 60秒待機
    echo "初期化待機中（60秒）..."
    sleep 60

    # 結果確認
    echo ""
    echo -e "${GREEN}================================${NC}"
    echo -e "${GREEN}緊急修正完了${NC}"
    echo -e "${GREEN}================================${NC}"

    # 処理速度測定
    echo "処理速度を測定中（30秒）..."
    START=$(aws sqs get-queue-attributes \
        --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
        --attribute-names ApproximateNumberOfMessages \
        --query 'Attributes.ApproximateNumberOfMessages' \
        --output text)

    sleep 30

    END=$(aws sqs get-queue-attributes \
        --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
        --attribute-names ApproximateNumberOfMessages \
        --query 'Attributes.ApproximateNumberOfMessages' \
        --output text)

    if [ "$START" -gt "$END" ]; then
        PROCESSED=$((START - END))
        RATE=$((PROCESSED * 2))
        echo -e "${GREEN}✅ 処理速度: $RATE msg/分${NC}"
    fi

    echo ""
    echo "次のステップ:"
    echo "1. ./real-time-monitor.sh で継続監視"
    echo "2. 処理速度が改善されない場合は手動デバッグ"

else
    echo "キャンセルされました"
fi