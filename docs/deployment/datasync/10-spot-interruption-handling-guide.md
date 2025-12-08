# ⚡ CIS File Search - Spot Instance中断対応ガイド

## 🎯 概要

このガイドでは、EC2 Spot Instanceの中断通知に対応し、処理中のデータを安全に退避する仕組みを実装します。AWS提供の2分間の猶予期間を最大限活用して、データロスを防ぎます。

## 📊 Spot Instance中断の仕組み

### 中断通知のタイムライン

```
T-2分: AWS が中断通知を送信
       ├─ EC2 Metadata Service に通知
       ├─ EventBridge にイベント発行
       └─ CloudWatch Events 発火

T-0分: インスタンス強制終了
```

### 中断の主な理由

1. **価格変動** - Spot価格がBid価格を超過（現在は自動入札のため稀）
2. **容量不足** - AWSがOn-Demand/Reserved用に容量を必要
3. **制約違反** - Instance typeの制約グループ違反

## 🛡️ 3層防御アーキテクチャ

### レイヤー1: Capacity Rebalancing（予防的対応）

```yaml
Auto Scaling Group設定:
  Capacity Rebalancing: Enabled
  効果:
    - 中断リスクの高いインスタンスを事前に交換
    - 中断通知前に新インスタンスを起動
    - シームレスな移行
```

### レイヤー2: Instance Metadata監視（リアクティブ対応）

```bash
#!/bin/bash
# 中断通知を5秒ごとにチェック
while true; do
  TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null)

  if curl -H "X-aws-ec2-metadata-token: $TOKEN" \
    -f http://169.254.169.254/latest/meta-data/spot/instance-action \
    2>/dev/null; then
    # 中断処理開始
    /usr/local/bin/handle-spot-interruption.sh
    break
  fi
  sleep 5
done
```

### レイヤー3: EventBridge統合（バックアップ）

```python
# Lambda関数でEventBridge経由の通知を処理
def lambda_handler(event, context):
    if event['detail-type'] == 'EC2 Spot Instance Interruption Warning':
        instance_id = event['detail']['instance-id']
        # Systems Manager Run Commandで中断処理を実行
        ssm_client.send_command(
            InstanceIds=[instance_id],
            DocumentName='AWS-RunShellScript',
            Parameters={'commands': ['/usr/local/bin/handle-spot-interruption.sh']}
        )
```

## 🔧 実装コード

### 1. 中断ハンドラースクリプト (`handle-spot-interruption.sh`)

```bash
#!/bin/bash
# ========================================
# Spot Instance Interruption Handler
# 2分以内に全処理を完了する必要がある
# ========================================

set -e

LOG_FILE="/var/log/spot-interruption.log"
INSTANCE_ID=$(ec2-metadata --instance-id | cut -d " " -f 2)
REGION=$(ec2-metadata --availability-zone | cut -d " " -f 2 | sed 's/[a-z]$//')
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# ログ記録
log() {
    echo "[$(date -u +"%Y-%m-%d %H:%M:%S")] $1" | tee -a $LOG_FILE
}

log "=== SPOT INTERRUPTION DETECTED ==="
log "Instance ID: $INSTANCE_ID"
log "Time remaining: ~120 seconds"

# ========================================
# Step 1: アプリケーションへの通知 (5秒)
# ========================================
log "Step 1: Notifying application..."

# SIGTERMシグナルを送信してグレースフルシャットダウンを開始
systemctl stop cis-file-processor --no-block

# アプリケーションにシャットダウン通知
echo "SPOT_INTERRUPTION" > /var/app/cis-file-processor/shutdown.signal

# CloudWatchメトリクス送信
aws cloudwatch put-metric-data \
    --namespace "CIS/FileProcessor" \
    --metric-name "SpotInterruption" \
    --value 1 \
    --dimensions InstanceId=$INSTANCE_ID \
    --region $REGION &

# ========================================
# Step 2: 処理中データの退避 (30秒)
# ========================================
log "Step 2: Saving in-progress data..."

# 処理中のファイルをS3に退避
TEMP_BUCKET="cis-filesearch-temp"
INTERRUPTED_PREFIX="interrupted/$INSTANCE_ID/$TIMESTAMP"

# 処理中ファイルを特定
PROCESSING_DIR="/tmp/processing"
if [ -d "$PROCESSING_DIR" ]; then
    FILE_COUNT=$(find $PROCESSING_DIR -type f | wc -l)
    log "Found $FILE_COUNT files in processing"

    if [ $FILE_COUNT -gt 0 ]; then
        # S3に高速アップロード（並列処理）
        aws s3 sync $PROCESSING_DIR \
            s3://$TEMP_BUCKET/$INTERRUPTED_PREFIX/ \
            --storage-class STANDARD_IA \
            --metadata "interruption-time=$TIMESTAMP,instance-id=$INSTANCE_ID" \
            --only-show-errors &

        S3_PID=$!

        # 最大30秒待機
        timeout 30 bash -c "while kill -0 $S3_PID 2>/dev/null; do sleep 1; done"

        if kill -0 $S3_PID 2>/dev/null; then
            log "WARNING: S3 upload timeout, killing process"
            kill -9 $S3_PID
        else
            log "Successfully uploaded processing files to S3"
        fi
    fi
fi

# ========================================
# Step 3: 処理状態の保存 (10秒)
# ========================================
log "Step 3: Saving processing state..."

# アプリケーション状態をDynamoDBに保存
STATE_FILE="/var/app/cis-file-processor/state.json"
if [ -f "$STATE_FILE" ]; then
    # Pythonスクリプトで状態保存
    python3 <<EOF
import json
import boto3
from datetime import datetime

dynamodb = boto3.resource('dynamodb', region_name='$REGION')
table = dynamodb.Table('CIS-ProcessingState')

with open('$STATE_FILE', 'r') as f:
    state = json.load(f)

# 中断情報を追加
state['interruption'] = {
    'timestamp': '$TIMESTAMP',
    'instance_id': '$INSTANCE_ID'
}

# DynamoDBに保存
table.put_item(Item=state)
print("State saved to DynamoDB")
EOF
fi

# ========================================
# Step 4: SQSメッセージの可視性延長 (10秒)
# ========================================
log "Step 4: Extending SQS message visibility..."

# 処理中のメッセージIDを取得
RECEIPT_HANDLES_FILE="/var/app/cis-file-processor/active_receipts.json"
if [ -f "$RECEIPT_HANDLES_FILE" ]; then
    python3 <<EOF
import json
import boto3

sqs = boto3.client('sqs', region_name='$REGION')
queue_url = 'https://sqs.$REGION.amazonaws.com/123456789012/CIS-FileProcessing-Queue'

with open('$RECEIPT_HANDLES_FILE', 'r') as f:
    receipts = json.load(f)

for receipt_handle in receipts:
    try:
        # 可視性を5分延長（別インスタンスが処理できるように）
        sqs.change_message_visibility(
            QueueUrl=queue_url,
            ReceiptHandle=receipt_handle,
            VisibilityTimeout=300
        )
    except Exception as e:
        print(f"Failed to extend visibility: {e}")
EOF
    log "Extended visibility for active messages"
fi

# ========================================
# Step 5: ログのフラッシュ (5秒)
# ========================================
log "Step 5: Flushing logs..."

# CloudWatch Agentのログをフラッシュ
systemctl reload amazon-cloudwatch-agent || true

# アプリケーションログを強制アップロード
if [ -f "/var/app/cis-file-processor/logs/application.log" ]; then
    # 最後の100行をS3に保存
    tail -n 100 /var/app/cis-file-processor/logs/application.log | \
        aws s3 cp - s3://$TEMP_BUCKET/$INTERRUPTED_PREFIX/final_logs.txt
fi

# ========================================
# Step 6: Auto Scaling通知 (5秒)
# ========================================
log "Step 6: Notifying Auto Scaling Group..."

# ライフサイクルアクションを完了
ASG_NAME="CIS-FileProcessor-ASG"
LIFECYCLE_HOOK="CIS-GracefulTermination"

aws autoscaling complete-lifecycle-action \
    --lifecycle-action-result CONTINUE \
    --lifecycle-hook-name $LIFECYCLE_HOOK \
    --auto-scaling-group-name $ASG_NAME \
    --instance-id $INSTANCE_ID \
    --region $REGION || true

# ========================================
# Step 7: 最終クリーンアップ (10秒)
# ========================================
log "Step 7: Final cleanup..."

# 一時ファイルの削除
rm -rf /tmp/processing/*
rm -f /var/app/cis-file-processor/active_receipts.json
rm -f /var/app/cis-file-processor/state.json

# 最終メトリクス送信
aws cloudwatch put-metric-data \
    --namespace "CIS/FileProcessor" \
    --metric-name "SpotInterruptionHandled" \
    --value 1 \
    --dimensions InstanceId=$INSTANCE_ID \
    --region $REGION

log "=== INTERRUPTION HANDLING COMPLETE ==="
log "Total time: $(($(date +%s) - $(date -d "$TIMESTAMP" +%s))) seconds"
log "Instance will terminate in ~$((120 - $(date +%s) + $(date -d "$TIMESTAMP" +%s))) seconds"

# 正常終了
exit 0
```

### 2. Python Appでの中断対応 (`interruption_handler.py`)

```python
"""Spot Instance中断ハンドラー（Pythonアプリ側）"""

import os
import signal
import json
import time
import threading
from typing import Dict, Any, Optional
import boto3
import structlog

logger = structlog.get_logger()

class SpotInterruptionHandler:
    """Spot Instance中断を処理するクラス"""

    def __init__(self, app_state: Dict[str, Any]):
        self.app_state = app_state
        self.s3_client = boto3.client('s3')
        self.dynamodb = boto3.resource('dynamodb')
        self.instance_id = self._get_instance_id()
        self.shutdown_event = threading.Event()

        # SIGTERMハンドラー登録
        signal.signal(signal.SIGTERM, self._sigterm_handler)

        # 中断チェックスレッド開始
        self.monitor_thread = threading.Thread(
            target=self._monitor_interruption,
            daemon=True
        )
        self.monitor_thread.start()

    def _get_instance_id(self) -> str:
        """インスタンスIDを取得"""
        try:
            import requests
            token = requests.put(
                "http://169.254.169.254/latest/api/token",
                headers={"X-aws-ec2-metadata-token-ttl-seconds": "21600"}
            ).text

            return requests.get(
                "http://169.254.169.254/latest/meta-data/instance-id",
                headers={"X-aws-ec2-metadata-token": token}
            ).text
        except Exception:
            return "unknown"

    def _sigterm_handler(self, signum, frame):
        """SIGTERMシグナルハンドラー"""
        logger.warning("Received SIGTERM, initiating graceful shutdown")
        self.shutdown_event.set()
        self.handle_interruption()

    def _monitor_interruption(self):
        """中断通知を監視"""
        import requests

        while not self.shutdown_event.is_set():
            try:
                # トークン取得
                token = requests.put(
                    "http://169.254.169.254/latest/api/token",
                    headers={"X-aws-ec2-metadata-token-ttl-seconds": "21600"},
                    timeout=1
                ).text

                # 中断通知チェック
                response = requests.get(
                    "http://169.254.169.254/latest/meta-data/spot/instance-action",
                    headers={"X-aws-ec2-metadata-token": token},
                    timeout=1
                )

                if response.status_code == 200:
                    interruption_data = response.json()
                    logger.critical("SPOT INTERRUPTION DETECTED",
                                  action=interruption_data.get('action'),
                                  time=interruption_data.get('time'))
                    self.handle_interruption()
                    break

            except requests.exceptions.RequestException:
                # 404は正常（中断なし）
                pass
            except Exception as e:
                logger.error("Error monitoring interruption", error=str(e))

            time.sleep(5)

    def handle_interruption(self):
        """中断処理のメイン関数"""
        start_time = time.time()
        logger.info("Starting interruption handling")

        try:
            # 1. 新規タスク受付を停止
            self._stop_accepting_tasks()

            # 2. 処理中タスクを安全に停止
            self._stop_current_tasks()

            # 3. 状態を保存
            self._save_state()

            # 4. データを退避
            self._evacuate_data()

            # 5. ログをフラッシュ
            self._flush_logs()

            elapsed = time.time() - start_time
            logger.info(f"Interruption handling completed in {elapsed:.2f} seconds")

        except Exception as e:
            logger.error("Error during interruption handling", error=str(e))

    def _stop_accepting_tasks(self):
        """新規タスクの受付を停止"""
        self.app_state['accepting_tasks'] = False
        logger.info("Stopped accepting new tasks")

    def _stop_current_tasks(self):
        """処理中タスクを停止"""
        active_tasks = self.app_state.get('active_tasks', [])

        for task in active_tasks:
            try:
                # タスクにキャンセルシグナルを送信
                task['cancelled'] = True

                # 処理中ファイルの情報を保存
                if 'file_path' in task:
                    self._save_partial_result(task)

            except Exception as e:
                logger.error(f"Error stopping task {task.get('id')}", error=str(e))

        logger.info(f"Stopped {len(active_tasks)} active tasks")

    def _save_partial_result(self, task: Dict[str, Any]):
        """部分的な処理結果を保存"""
        try:
            partial_result = {
                'task_id': task.get('id'),
                'file_path': task.get('file_path'),
                'progress': task.get('progress', 0),
                'partial_text': task.get('extracted_text', ''),
                'instance_id': self.instance_id,
                'timestamp': time.time()
            }

            # S3に保存
            self.s3_client.put_object(
                Bucket='cis-filesearch-temp',
                Key=f"partial/{self.instance_id}/{task['id']}.json",
                Body=json.dumps(partial_result),
                StorageClass='STANDARD_IA'
            )

        except Exception as e:
            logger.error(f"Error saving partial result for task {task.get('id')}",
                       error=str(e))

    def _save_state(self):
        """アプリケーション状態を保存"""
        try:
            state = {
                'instance_id': self.instance_id,
                'timestamp': time.time(),
                'active_tasks': self.app_state.get('active_tasks', []),
                'processed_count': self.app_state.get('processed_count', 0),
                'error_count': self.app_state.get('error_count', 0),
                'queue_receipts': self.app_state.get('queue_receipts', [])
            }

            # DynamoDBに保存
            table = self.dynamodb.Table('CIS-ProcessingState')
            table.put_item(Item=state)

            # ローカルにも保存（バックアップ）
            with open('/var/app/cis-file-processor/state.json', 'w') as f:
                json.dump(state, f)

            logger.info("Application state saved")

        except Exception as e:
            logger.error("Error saving state", error=str(e))

    def _evacuate_data(self):
        """処理中データを退避"""
        try:
            processing_dir = '/tmp/processing'
            if os.path.exists(processing_dir):
                files = os.listdir(processing_dir)

                for file in files:
                    file_path = os.path.join(processing_dir, file)
                    s3_key = f"interrupted/{self.instance_id}/{file}"

                    # S3にアップロード
                    self.s3_client.upload_file(
                        file_path,
                        'cis-filesearch-temp',
                        s3_key,
                        ExtraArgs={'StorageClass': 'STANDARD_IA'}
                    )

                logger.info(f"Evacuated {len(files)} files to S3")

        except Exception as e:
            logger.error("Error evacuating data", error=str(e))

    def _flush_logs(self):
        """ログをフラッシュ"""
        try:
            # structlogのフラッシュ
            import logging
            for handler in logging.getLogger().handlers:
                handler.flush()

            logger.info("Logs flushed")

        except Exception as e:
            logger.error("Error flushing logs", error=str(e))
```

### 3. EventBridge Rule設定

```json
{
  "Name": "CIS-SpotInterruptionHandler",
  "EventPattern": {
    "source": ["aws.ec2"],
    "detail-type": ["EC2 Spot Instance Interruption Warning"],
    "detail": {
      "instance-action": ["terminate", "stop", "hibernate"]
    }
  },
  "State": "ENABLED",
  "Targets": [
    {
      "Arn": "arn:aws:lambda:ap-northeast-1:123456789012:function:CIS-SpotInterruptionHandler",
      "Id": "1"
    },
    {
      "Arn": "arn:aws:sns:ap-northeast-1:123456789012:CIS-Alerts",
      "Id": "2"
    }
  ]
}
```

## 📊 モニタリングとアラート

### CloudWatch Dashboard設定

```json
{
  "name": "CIS-SpotInterruptions",
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "title": "Spot Interruptions",
        "metrics": [
          ["CIS/FileProcessor", "SpotInterruption", {"stat": "Sum"}],
          [".", "SpotInterruptionHandled", {"stat": "Sum"}],
          ["AWS/EC2", "SpotInstanceInterruptions", {"stat": "Sum"}]
        ],
        "period": 300,
        "region": "ap-northeast-1"
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "Data Evacuation Success Rate",
        "metrics": [
          ["CIS/FileProcessor", "DataEvacuationSuccess", {"stat": "Sum"}],
          [".", "DataEvacuationFailure", {"stat": "Sum"}]
        ],
        "period": 300,
        "region": "ap-northeast-1"
      }
    }
  ]
}
```

### アラート設定

```yaml
SpotInterruptionAlarm:
  MetricName: SpotInterruption
  Namespace: CIS/FileProcessor
  Statistic: Sum
  Period: 60
  EvaluationPeriods: 1
  Threshold: 1
  ComparisonOperator: GreaterThanOrEqualToThreshold
  AlarmActions:
    - !Ref SNSTopic
  AlarmDescription: "Spot Instance interruption detected"
```

## 🔍 テストとシミュレーション

### 中断シミュレーションスクリプト

```bash
#!/bin/bash
# Spot中断をシミュレート

# 模擬中断通知を作成
cat > /tmp/mock-interruption.json <<EOF
{
  "action": "terminate",
  "time": "$(date -u -d '+2 minutes' +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

# メタデータサービスのモックを起動
python3 -m http.server 8080 &
SERVER_PID=$!

# 中断ハンドラーをテスト
/usr/local/bin/handle-spot-interruption.sh

# クリーンアップ
kill $SERVER_PID
rm /tmp/mock-interruption.json
```

### 負荷テスト下での中断テスト

```python
"""負荷をかけながら中断をテスト"""

import concurrent.futures
import time
import subprocess

def process_file(file_id):
    """ダミーのファイル処理"""
    time.sleep(10)  # 処理をシミュレート
    return f"File {file_id} processed"

# 100ファイルを並列処理
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
    futures = [executor.submit(process_file, i) for i in range(100)]

    # 処理中に中断をトリガー
    time.sleep(5)
    subprocess.run(['kill', '-TERM', str(os.getpid())])

    # 結果を確認
    for future in futures:
        try:
            result = future.result(timeout=1)
            print(result)
        except concurrent.futures.TimeoutError:
            print("Processing interrupted")
```

## ✅ ベストプラクティス

### DO's ✅

1. **2分ルールの厳守** - 全処理を120秒以内に完了
2. **並列処理** - S3アップロードとDB保存を並列実行
3. **優先順位付け** - 重要データから順に退避
4. **冪等性** - 中断処理が複数回実行されても安全
5. **ログ記録** - 全ステップの実行時間を記録

### DON'Ts ❌

1. **大容量ファイルの同期アップロード** - 非同期またはマルチパート使用
2. **無限ループ** - タイムアウトを必ず設定
3. **エラーでの停止** - エラーをキャッチして続行
4. **ネットワーク待機** - タイムアウトを短く設定

## 📈 コスト影響分析

### 中断率による月間コスト影響

| 中断率/日 | 再処理コスト | データ転送コスト | 合計追加コスト |
|----------|------------|---------------|--------------|
| 1% | $0.50 | $0.10 | $0.60 |
| 5% | $2.50 | $0.50 | $3.00 |
| 10% | $5.00 | $1.00 | $6.00 |

### ROI計算

```
Spot割引: 70% ($86.40/月の節約)
中断対応コスト: ~$3.00/月
実質節約額: $83.40/月 (96.5%のコスト効率)
```

## 🔧 トラブルシューティング

### 中断処理が実行されない

```bash
# メタデータサービスの確認
curl -I http://169.254.169.254/latest/meta-data/

# IMDSv2トークンの確認
TOKEN=$(curl -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
echo $TOKEN

# 中断通知エンドポイントの確認
curl -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/spot/instance-action
```

### データ退避が間に合わない

```python
# 優先度付きの退避
import heapq

class PriorityEvacuation:
    def __init__(self):
        self.queue = []

    def add_file(self, priority, file_path, size):
        # 小さくて重要なファイルを優先
        score = priority / (size + 1)
        heapq.heappush(self.queue, (-score, file_path))

    def evacuate(self, time_limit=100):
        evacuated = []
        start_time = time.time()

        while self.queue and (time.time() - start_time) < time_limit:
            _, file_path = heapq.heappop(self.queue)
            # S3アップロード
            evacuated.append(file_path)

        return evacuated
```

## 📚 参考リンク

- [EC2 Spot Interruptions](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-interruptions.html)
- [Capacity Rebalancing](https://docs.aws.amazon.com/autoscaling/ec2/userguide/capacity-rebalance.html)
- [Instance Metadata Service v2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html)
- [EventBridge Spot Events](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-instance-interruptions.html#spot-instance-interruption-notices)

## 🚀 次のステップ

Spot Instance中断対応の実装後は、本番環境でのテストとモニタリングを開始します。週次レポートで中断率と対応成功率を追跡し、継続的に改善していきます。

これでPhase 2のEC2インフラストラクチャガイド作成が完了しました！