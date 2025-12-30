# SQS/DLQ異常増加 - 緊急診断レポート

**作成日時**: 2025-12-12
**ステータス**: 🔴 緊急対応必要
**影響範囲**: 本番環境 (Production)

---

## 1. 問題の概要

### 症状
- **DataSyncを停止してもSQSキューが増え続ける**
- **DLQ (Dead Letter Queue) も増加している**
- **インデックス作成が失敗している**

### 環境情報
- **アーキテクチャ**: NAS → スキャナーPC → S3 → EventBridge → SQS → EC2 Auto Scaling → OpenSearch
- **データ量**: 10TB NAS, 5M files
- **既知の性能不均衡**: file-scanner 100 files/min vs python-worker 5-10 files/min (10倍の差)

---

## 2. 根本原因の分析

### 最も可能性が高い原因 (優先度順)

#### 🔴 **原因1: S3 Event Notification の重複設定**

**可能性**: 90%

**説明**:
S3バケットに複数のEvent Notification設定が存在し、1つのファイルアップロードに対して複数のSQSメッセージが送信されている。

**確認方法**:
```bash
aws s3api get-bucket-notification-configuration \
  --bucket cis-filesearch-storage-production \
  --region ap-northeast-1
```

**期待される結果**:
- `QueueConfigurations` が1つのみ
- `EventBridgeConfiguration` と `QueueConfigurations` の両方が設定されていない

**修正方法**:
```bash
# 現在の設定をバックアップ
aws s3api get-bucket-notification-configuration \
  --bucket cis-filesearch-storage-production \
  --region ap-northeast-1 > s3_notification_backup.json

# 重複設定を削除し、単一の設定に修正
aws s3api put-bucket-notification-configuration \
  --bucket cis-filesearch-storage-production \
  --notification-configuration file://corrected_notification.json
```

**corrected_notification.json の例**:
```json
{
  "QueueConfigurations": [
    {
      "Id": "FileProcessingQueue",
      "QueueArn": "arn:aws:sqs:ap-northeast-1:ACCOUNT_ID:file-processing-queue-production",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            {
              "Name": "prefix",
              "Value": "raw-files/"
            }
          ]
        }
      }
    }
  ]
}
```

---

#### 🟡 **原因2: python-worker のメッセージ削除失敗**

**可能性**: 70%

**説明**:
`worker.py` の `process_sqs_message()` でエラーが発生した場合、`delete_message()` が呼ばれず、メッセージが再度キューに戻る。

**問題箇所** (`worker.py` 行336-349):
```python
try:
    # Process the message
    success = self.process_sqs_message(message)

    if success:
        # Delete message from queue
        self.sqs_client.delete_message(
            QueueUrl=self.config.aws.sqs_queue_url,
            ReceiptHandle=receipt_handle
        )
        self.logger.info("Message processed and deleted from queue")
        self.stats['succeeded'] += 1

    else:
        self.logger.error("Processing failed - message will be retried")
        self.stats['failed'] += 1
```

**問題点**:
1. `success = False` の場合、メッセージが削除されずに再度表示される
2. `process_sqs_message()` 内で例外が発生した場合、`except` ブロックでメッセージが削除されない
3. Visibility Timeout (300秒) 経過後、メッセージが再度キューに表示される

**修正案**:
```python
try:
    # Process the message
    success = self.process_sqs_message(message)

    if success:
        # Delete message from queue
        self.sqs_client.delete_message(
            QueueUrl=self.config.aws.sqs_queue_url,
            ReceiptHandle=receipt_handle
        )
        self.logger.info("Message processed and deleted from queue")
        self.stats['succeeded'] += 1
    else:
        # 失敗したメッセージはDLQに明示的に送信
        self.logger.error("Processing failed - sending to DLQ")
        self._send_to_dlq(message)
        # メッセージを削除 (DLQに送信済み)
        self.sqs_client.delete_message(
            QueueUrl=self.config.aws.sqs_queue_url,
            ReceiptHandle=receipt_handle
        )
        self.stats['failed'] += 1

except Exception as e:
    self.logger.error(f"Error processing message: {e}", exc_info=True)
    # 例外発生時もDLQに送信してメッセージを削除
    self._send_to_dlq(message)
    self.sqs_client.delete_message(
        QueueUrl=self.config.aws.sqs_queue_url,
        ReceiptHandle=receipt_handle
    )
    self.stats['failed'] += 1
```

**新規メソッド `_send_to_dlq()` の追加**:
```python
def _send_to_dlq(self, message: Dict[str, Any]):
    """
    失敗したメッセージをDLQに送信

    Args:
        message: SQSメッセージ
    """
    try:
        dlq_url = self.config.aws.dlq_queue_url
        if not dlq_url:
            self.logger.warning("DLQ URL not configured")
            return

        self.sqs_client.send_message(
            QueueUrl=dlq_url,
            MessageBody=message['Body'],
            MessageAttributes={
                'FailedAt': {
                    'StringValue': datetime.utcnow().isoformat(),
                    'DataType': 'String'
                },
                'OriginalMessageId': {
                    'StringValue': message['MessageId'],
                    'DataType': 'String'
                }
            }
        )
        self.logger.info(f"Message sent to DLQ: {message['MessageId']}")

    except Exception as e:
        self.logger.error(f"Failed to send message to DLQ: {e}")
```

---

#### 🟡 **原因3: Visibility Timeout 設定の不適切**

**可能性**: 60%

**説明**:
現在の Visibility Timeout (300秒 = 5分) が、実際の処理時間より短い可能性がある。

**確認**:
CloudFormation テンプレート (`sqs-with-dlq.yaml` 行30):
```yaml
VisibilityTimeout:
  Type: Number
  Default: 300  # 5分
```

**問題**:
- python-worker の処理速度: 5-10 files/min
- 1ファイルあたり: 6-12秒
- **大きなファイルやOCR処理が必要な場合**: 30秒〜数分

**推奨値**: 900秒 (15分)

**修正**:
```yaml
VisibilityTimeout:
  Type: Number
  Default: 900  # 15分に変更
```

または、AWS CLIで直接変更:
```bash
aws sqs set-queue-attributes \
  --queue-url <QUEUE_URL> \
  --attributes VisibilityTimeout=900 \
  --region ap-northeast-1
```

---

#### 🟢 **原因4: EventBridge 自動リトライ**

**可能性**: 30%

**説明**:
EventBridge Ruleに設定された自動リトライポリシーが、失敗したメッセージを再送信している。

**確認方法**:
```bash
aws events describe-rule \
  --name file-processing-schedule-production \
  --region ap-northeast-1
```

**推奨設定**:
- **RetryPolicy**: 最大2回まで
- **DeadLetterConfig**: DLQへの送信設定

---

#### 🟢 **原因5: IAM権限不足**

**可能性**: 20%

**説明**:
EC2インスタンスのIAMロールに `sqs:DeleteMessage` 権限がない、またはDLQへの `sqs:SendMessage` 権限がない。

**確認**:
CloudFormation テンプレート (`ec2-autoscaling.yaml` 行96-109):
```yaml
- Effect: Allow
  Action:
    - sqs:ReceiveMessage
    - sqs:DeleteMessage
    - sqs:GetQueueAttributes
    - sqs:ChangeMessageVisibility
  Resource:
    - !Ref QueueURL
    - !Ref DLQueueURL
- Effect: Allow
  Action:
    - sqs:SendMessage
  Resource:
    - !Ref DLQueueURL
```

**問題**:
- `!Ref QueueURL` / `!Ref DLQueueURL` が正しいARNに解決されているか確認が必要

**修正案**:
```yaml
Resource:
  - !Sub 'arn:aws:sqs:${AWS::Region}:${AWS::AccountId}:file-processing-queue-production'
  - !Sub 'arn:aws:sqs:${AWS::Region}:${AWS::AccountId}:file-processing-dlq-production'
```

---

## 3. 診断手順

### 3.1 緊急診断スクリプトの実行

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker/scripts
chmod +x emergency_diagnosis.sh
./emergency_diagnosis.sh > diagnosis_report_$(date +%Y%m%d_%H%M%S).txt 2>&1
```

### 3.2 出力の確認項目

1. **SQS メッセージ数**
   - `ApproximateNumberOfMessages` が増加し続けているか
   - `ApproximateNumberOfMessagesNotVisible` (処理中) が多いか

2. **DLQ メッセージ数**
   - DLQに大量のメッセージがあるか
   - メッセージ内容 (エラー原因)

3. **S3 Event Notification**
   - `QueueConfigurations` の数
   - `EventBridgeConfiguration` の有無

4. **CloudWatch Logs**
   - `delete_message` 失敗のエラーログ
   - `OpenSearch indexing failed` のエラーログ

---

## 4. 緊急対応手順

### ステップ1: 即座停止 (キュー増加を止める)

```bash
chmod +x emergency_stop.sh
./emergency_stop.sh
```

**実行内容**:
1. EventBridge Ruleを無効化
2. Auto Scaling GroupをMinSize=0に設定
3. 実行中のEC2インスタンスを停止
4. (オプション) S3 Event Notificationを無効化

### ステップ2: キュークリア

```bash
chmod +x emergency_purge_queues.sh
./emergency_purge_queues.sh
```

**注意**: 削除したメッセージは復元不可

### ステップ3: 根本原因の修正

#### 3.1 S3 Event Notification の修正

```bash
# 重複設定を削除
aws s3api put-bucket-notification-configuration \
  --bucket cis-filesearch-storage-production \
  --notification-configuration file://corrected_notification.json
```

#### 3.2 python-worker の修正

- `worker.py` に `_send_to_dlq()` メソッドを追加
- メッセージ処理失敗時の処理を修正
- 必ず `delete_message()` を呼ぶように変更

#### 3.3 Visibility Timeout の調整

```bash
aws sqs set-queue-attributes \
  --queue-url <QUEUE_URL> \
  --attributes VisibilityTimeout=900 \
  --region ap-northeast-1
```

### ステップ4: 復旧

```bash
chmod +x emergency_recovery.sh
./emergency_recovery.sh
```

### ステップ5: 監視

```bash
# SQS メッセージ数を監視 (30秒ごと)
watch -n 30 'aws sqs get-queue-attributes \
  --queue-url <QUEUE_URL> \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-northeast-1'
```

---

## 5. 恒久対策

### 5.1 アーキテクチャの改善

#### 案1: SQS Long Polling + Batch Delete

```python
# 複数メッセージを一括削除
entries = [
    {'Id': str(i), 'ReceiptHandle': msg['ReceiptHandle']}
    for i, msg in enumerate(messages)
]

self.sqs_client.delete_message_batch(
    QueueUrl=self.config.aws.sqs_queue_url,
    Entries=entries
)
```

#### 案2: DLQ Redrive Policy の厳格化

```yaml
RedrivePolicy:
  deadLetterTargetArn: !GetAtt FileProcessingDLQ.Arn
  maxReceiveCount: 3  # 3回失敗したらDLQ送信
```

#### 案3: CloudWatch Alarms の強化

```yaml
DLQMessageAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: file-processing-dlq-messages
    MetricName: ApproximateNumberOfMessagesVisible
    Threshold: 10  # DLQに10件以上でアラート
    ComparisonOperator: GreaterThanOrEqualToThreshold
    AlarmActions:
      - !Ref SNSTopicARN  # Slack/Email通知
```

### 5.2 コード改善

#### python-worker の改善

1. **リトライロジックの追加**
   ```python
   from tenacity import retry, stop_after_attempt, wait_exponential

   @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
   def index_to_opensearch(self, document):
       # OpenSearchインデックス作成
       pass
   ```

2. **メッセージ処理の冪等性保証**
   ```python
   # DynamoDBで処理済みチェック
   if self.is_already_processed(file_key):
       self.logger.info(f"File already processed: {file_key}")
       return True  # メッセージ削除
   ```

3. **バッチ処理の導入**
   ```python
   # 10件まとめてOpenSearchにインデックス
   bulk_documents = []
   for message in messages:
       doc = self.process_file(message)
       bulk_documents.append(doc)

   self.opensearch.bulk_index(bulk_documents)
   ```

### 5.3 監視の強化

```python
# CloudWatch Metricsにカスタムメトリクスを送信
import boto3

cloudwatch = boto3.client('cloudwatch')

cloudwatch.put_metric_data(
    Namespace='CISFileSearch',
    MetricData=[
        {
            'MetricName': 'FilesProcessedPerMinute',
            'Value': processed_count,
            'Unit': 'Count'
        },
        {
            'MetricName': 'ProcessingErrorRate',
            'Value': error_rate,
            'Unit': 'Percent'
        }
    ]
)
```

---

## 6. AMI使用時の注意事項

### 6.1 AMI作成前の確認事項

1. **環境変数の外部化**
   - `.env` ファイルをAMIに含めない
   - User Dataで動的に生成

2. **ログの削除**
   ```bash
   sudo rm -rf /var/log/*.log
   sudo rm -rf /tmp/*
   ```

3. **機密情報の削除**
   ```bash
   rm -f ~/.bash_history
   rm -f ~/.aws/credentials
   ```

### 6.2 AMI起動時のUser Data

```bash
#!/bin/bash
# 環境変数を動的に設定
cat > /opt/file-processor/.env << EOF
AWS_REGION=${AWS_REGION}
SQS_QUEUE_URL=${SQS_QUEUE_URL}
DLQ_QUEUE_URL=${DLQ_QUEUE_URL}
S3_BUCKET=${S3_BUCKET}
OPENSEARCH_ENDPOINT=${OPENSEARCH_ENDPOINT}
EOF

# サービス再起動
systemctl restart file-processor
```

---

## 7. チェックリスト

### 診断完了確認

- [ ] emergency_diagnosis.sh を実行
- [ ] SQS/DLQ メッセージ数を確認
- [ ] S3 Event Notification 設定を確認
- [ ] EventBridge Rules を確認
- [ ] CloudWatch Logs でエラーを確認
- [ ] IAM権限を確認

### 修正完了確認

- [ ] S3 Event Notification の重複を削除
- [ ] worker.py に `_send_to_dlq()` を追加
- [ ] Visibility Timeout を900秒に変更
- [ ] 修正版コードをデプロイ
- [ ] AMIを再作成 (必要に応じて)

### 復旧確認

- [ ] emergency_recovery.sh を実行
- [ ] EC2インスタンスが起動
- [ ] SQS メッセージが正常に処理されている
- [ ] DLQ にメッセージが増加していない
- [ ] CloudWatch Logs にエラーがない

---

## 8. 連絡先・エスカレーション

**問題が解決しない場合**:
1. AWS Support にチケット作成 (Business/Enterprise Plan)
2. SQS/EventBridge チームにエスカレーション
3. 一時的にfile-scannerを停止し、手動同期に切り替え

**ドキュメント参照**:
- [AWS SQS Best Practices](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-best-practices.html)
- [S3 Event Notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/NotificationHowTo.html)
- [EventBridge Retry Policies](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html)

---

**最終更新**: 2025-12-12
**作成者**: Claude Code
**ステータス**: 🔴 即座対応必要
