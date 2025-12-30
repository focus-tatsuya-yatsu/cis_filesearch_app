#!/bin/bash
# Worker診断スクリプト

echo "🔍 Worker診断開始..."
echo ""

# 1. 現在のインスタンスID取得
INSTANCE_ID=$(aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names cis-filesearch-ec2-autoscaling \
  --region ap-northeast-1 \
  --query 'AutoScalingGroups[0].Instances[0].InstanceId' \
  --output text)

echo "対象インスタンス: $INSTANCE_ID"
echo ""

# 2. SQSメッセージ数の推移を確認
echo "📊 SQSメッセージ処理状況（1分間隔で5回チェック）"
echo "時刻 | メッセージ数 | 差分"
echo "--------------------------------"

PREV_COUNT=0
for i in {1..5}; do
  CURRENT_COUNT=$(aws sqs get-queue-attributes \
    --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
    --attribute-names ApproximateNumberOfMessages \
    --region ap-northeast-1 \
    --query 'Attributes.ApproximateNumberOfMessages' \
    --output text)

  if [ $PREV_COUNT -ne 0 ]; then
    DIFF=$((PREV_COUNT - CURRENT_COUNT))
    echo "$(date +%H:%M:%S) | $CURRENT_COUNT | -$DIFF"
  else
    echo "$(date +%H:%M:%S) | $CURRENT_COUNT | ---"
  fi

  PREV_COUNT=$CURRENT_COUNT

  if [ $i -lt 5 ]; then
    sleep 60
  fi
done

echo ""
echo "✅ 処理状況確認完了"
echo ""

# 3. EC2コンソール出力から詳細エラーを探す
echo "🔍 Pythonエラー詳細を検索中..."
aws ec2 get-console-output \
  --instance-id $INSTANCE_ID \
  --region ap-northeast-1 \
  --output text > /tmp/console_output.txt

# Pythonのトレースバックを探す
echo "=== Pythonエラー（もしあれば） ==="
grep -A10 "Traceback\|ImportError\|ModuleNotFoundError\|AttributeError\|KeyError" /tmp/console_output.txt || echo "明示的なPythonエラーは見つかりません"

echo ""
echo "=== worker.service起動ログ ==="
grep -A5 -B5 "worker.service\|worker.py" /tmp/console_output.txt | tail -20

echo ""
echo "診断完了！"
echo ""
echo "📝 推奨される次のステップ："
echo "1. メッセージが減少している場合 → workerは動作中（再起動を繰り返しながら）"
echo "2. メッセージが減少していない場合 → 根本的な修正が必要"
echo ""

# 4. 簡単な修正案を提示
echo "🔧 考えられる原因と対策："
echo ""
echo "1. ImportError → 必要なパッケージ不足"
echo "   対策: pip install追加"
echo ""
echo "2. 環境変数エラー → 環境変数が正しく設定されていない"
echo "   対策: systemdサービスファイルの環境変数確認"
echo ""
echo "3. configファイルエラー → config.pyの内容不一致"
echo "   対策: config.pyの内容確認"
echo ""

# 5. 修正版User Dataの提案
cat > /tmp/diagnostic_userdata.sh << 'EOF'
#!/bin/bash
set +e

exec > >(tee /var/log/user-data.log)
exec 2>&1

echo "=== Diagnostic User Data Started at $(date) ==="

# 環境変数
export AWS_REGION="ap-northeast-1"
export S3_BUCKET="cis-filesearch-worker-scripts"
export SQS_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
export DLQ_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq"
export OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"

# Pythonパッケージ（エラー無視）
yum install -y python3 python3-pip
pip3 install --ignore-installed boto3 opensearch-py requests pillow PyPDF2

# S3からダウンロード
mkdir -p /opt/worker
cd /opt/worker
aws s3 cp s3://${S3_BUCKET}/scripts/worker.py /opt/worker/worker.py --region ${AWS_REGION}
aws s3 cp s3://${S3_BUCKET}/scripts/config.py /opt/worker/config.py --region ${AWS_REGION} || true
aws s3 cp s3://${S3_BUCKET}/scripts/file_router.py /opt/worker/file_router.py --region ${AWS_REGION} || true
aws s3 cp s3://${S3_BUCKET}/scripts/opensearch_client.py /opt/worker/opensearch_client.py --region ${AWS_REGION} || true

# デバッグ: worker.pyを直接実行してエラーを確認
echo "=== Testing worker.py directly ==="
cd /opt/worker
python3 worker.py 2>&1 | head -50 || true

# systemdサービス（詳細ログ付き）
cat <<'EOFSERVICE' > /etc/systemd/system/worker.service
[Unit]
Description=File Processing Worker
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/worker
ExecStart=/usr/bin/python3 -u /opt/worker/worker.py
Restart=always
RestartSec=30
StandardOutput=journal+console
StandardError=journal+console
Environment="AWS_REGION=ap-northeast-1"
Environment="SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
Environment="DLQ_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-dlq"
Environment="OPENSEARCH_ENDPOINT=https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
Environment="PYTHONUNBUFFERED=1"

[Install]
WantedBy=multi-user.target
EOFSERVICE

systemctl daemon-reload
systemctl enable worker.service
systemctl start worker.service

# ログを表示
sleep 10
journalctl -u worker.service --no-pager -n 100

echo "=== Diagnostic User Data Completed at $(date) ==="
EOF

echo "診断用User Dataを /tmp/diagnostic_userdata.sh に保存しました"
echo ""