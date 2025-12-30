# SQS/DLQ異常増加 - 緊急対応マニュアル

**最終更新**: 2025-12-12
**対象環境**: Production (本番環境)
**緊急度**: 🔴 高 - 即座対応必要

---

## 📋 目次

1. [状況概要](#1-状況概要)
2. [即座実行: 診断](#2-即座実行-診断)
3. [緊急停止](#3-緊急停止)
4. [根本原因の修正](#4-根本原因の修正)
5. [復旧](#5-復旧)
6. [検証](#6-検証)
7. [恒久対策](#7-恒久対策)

---

## 1. 状況概要

### 症状
- DataSyncを停止してもSQSキューが増え続ける
- DLQ (Dead Letter Queue) も増加している
- インデックス作成が失敗している

### 影響範囲
- 本番環境のファイル検索システム
- 新規ファイルのインデックス作成が停止
- システムリソース (EC2, SQS) の無駄なコスト発生

### 作成ファイル一覧

```
backend/python-worker/
├── scripts/
│   ├── emergency_diagnosis.sh      # 診断スクリプト
│   ├── emergency_stop.sh            # 緊急停止スクリプト
│   ├── emergency_purge_queues.sh    # キュークリアスクリプト
│   └── emergency_recovery.sh        # 復旧スクリプト
├── worker_fixed.py                  # 修正版worker
├── EMERGENCY_DIAGNOSIS_REPORT.md    # 詳細診断レポート
├── CONFIG_ADDITIONS.md              # config.py修正手順
└── EMERGENCY_RESPONSE_README.md     # このファイル
```

---

## 2. 即座実行: 診断

### ステップ1: スクリプトに実行権限を付与

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker/scripts
chmod +x emergency_diagnosis.sh
chmod +x emergency_stop.sh
chmod +x emergency_purge_queues.sh
chmod +x emergency_recovery.sh
```

### ステップ2: 診断スクリプトの実行

```bash
./emergency_diagnosis.sh > diagnosis_report_$(date +%Y%m%d_%H%M%S).txt 2>&1
```

### ステップ3: 診断レポートの確認

```bash
# 最新のレポートを表示
cat diagnosis_report_*.txt
```

**確認ポイント**:
1. SQS メッセージ数が増加しているか
2. DLQ メッセージ数
3. S3 Event Notification の設定数 (複数あれば要注意)
4. EventBridge Rules の状態
5. CloudWatch Logs のエラーパターン

---

## 3. 緊急停止

### ⚠️ 実行前の確認

**この操作は以下を実行します**:
- EventBridge Rules を無効化
- Auto Scaling Group をスケールダウン (MinSize=0)
- 実行中のEC2インスタンスを停止
- (オプション) S3 Event Notification を無効化

### 実行コマンド

```bash
./emergency_stop.sh
```

**入力プロンプト**:
1. `続行するには 'YES' と入力してください:` → `YES` と入力
2. `S3 Event Notificationを無効化しますか?` → `YES` または `NO`

### 停止後の確認

```bash
# SQS メッセージ数を確認 (数分待ってから)
aws sqs get-queue-attributes \
  --queue-url <QUEUE_URL> \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-northeast-1

# EC2インスタンス状態を確認
aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=file-processor-production" \
  --region ap-northeast-1 \
  --query 'Reservations[].Instances[].[InstanceId,State.Name]'
```

**期待される結果**:
- SQS メッセージ数が増加しなくなる
- EC2インスタンスが `terminated` 状態

---

## 4. 根本原因の修正

### 4.1 S3 Event Notification の確認と修正

#### 現在の設定を確認

```bash
aws s3api get-bucket-notification-configuration \
  --bucket cis-filesearch-storage-production \
  --region ap-northeast-1 > s3_current_notification.json

cat s3_current_notification.json
```

#### 問題の確認

```json
{
  "QueueConfigurations": [
    // ← この配列に2つ以上の要素があれば問題
  ],
  "EventBridgeConfiguration": {
    "Enabled": true  // ← これがtrueの場合、QueueConfigurationsと重複
  }
}
```

#### 修正版を作成

`s3_corrected_notification.json` を作成:

```json
{
  "QueueConfigurations": [
    {
      "Id": "FileProcessingQueue",
      "QueueArn": "arn:aws:sqs:ap-northeast-1:YOUR_ACCOUNT_ID:file-processing-queue-production",
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

**重要**: `YOUR_ACCOUNT_ID` をAWSアカウントIDに置き換えてください。

#### 適用

```bash
aws s3api put-bucket-notification-configuration \
  --bucket cis-filesearch-storage-production \
  --notification-configuration file://s3_corrected_notification.json \
  --region ap-northeast-1
```

### 4.2 worker.py の修正

#### 方法1: 修正版ファイルに置き換え (推奨)

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker

# バックアップ
cp worker.py worker_original.py

# 修正版に置き換え
cp worker_fixed.py worker.py
```

#### 方法2: 手動で修正

`EMERGENCY_DIAGNOSIS_REPORT.md` の「原因2: python-worker のメッセージ削除失敗」セクションを参照してください。

### 4.3 config.py の修正

`CONFIG_ADDITIONS.md` を参照して、以下を追加:

```python
# config.py の AWSConfig クラスに追加
dlq_queue_url: str = os.environ.get('DLQ_QUEUE_URL', '')
```

また、Visibility Timeout のデフォルト値を変更:

```python
sqs_visibility_timeout: int = int(os.environ.get('SQS_VISIBILITY_TIMEOUT', '900'))  # 300 → 900
```

### 4.4 SQS Visibility Timeout の変更

```bash
# メインキューのURL取得
QUEUE_URL=$(aws sqs get-queue-url \
  --queue-name file-processing-queue-production \
  --region ap-northeast-1 \
  --output text)

# Visibility Timeout を 900秒 (15分) に変更
aws sqs set-queue-attributes \
  --queue-url "${QUEUE_URL}" \
  --attributes VisibilityTimeout=900 \
  --region ap-northeast-1

# 確認
aws sqs get-queue-attributes \
  --queue-url "${QUEUE_URL}" \
  --attribute-names VisibilityTimeout \
  --region ap-northeast-1
```

### 4.5 AMI の再作成 (必要に応じて)

修正したコードでAMIを再作成:

```bash
# EC2インスタンスを起動
# 修正版コードをデプロイ
# AMI作成

aws ec2 create-image \
  --instance-id <INSTANCE_ID> \
  --name "file-processor-ami-fixed-$(date +%Y%m%d)" \
  --description "Fixed version with enhanced SQS error handling" \
  --region ap-northeast-1
```

### 4.6 キュークリア (オプション)

修正後、既存のメッセージをクリアする場合:

```bash
./emergency_purge_queues.sh
```

**⚠️ 警告**: このコマンドはSQS/DLQの全メッセージを削除します。削除したメッセージは復元できません。

---

## 5. 復旧

### ステップ1: 復旧スクリプトの実行

```bash
./emergency_recovery.sh
```

**入力プロンプト**:
- `続行するには 'YES' と入力してください:` → `YES` と入力

### ステップ2: インスタンス起動の確認

```bash
# 60秒待機後、Auto Scaling Group の状態を確認
sleep 60

aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names file-processor-asg-production \
  --region ap-northeast-1 \
  --query 'AutoScalingGroups[0].[DesiredCapacity,Instances[].InstanceId]'
```

### ステップ3: CloudWatch Logs の確認

```bash
# 最新のログストリームを確認
aws logs tail /aws/ec2/file-processor --follow --region ap-northeast-1
```

**確認ポイント**:
- `Worker initialized successfully` が表示されるか
- `Message processed and deleted from queue` が表示されるか
- エラーログが出ていないか

---

## 6. 検証

### 6.1 SQS メッセージ数の監視

```bash
# 30秒ごとにメッセージ数を確認
watch -n 30 'aws sqs get-queue-attributes \
  --queue-url <QUEUE_URL> \
  --attribute-names ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible \
  --region ap-northeast-1 \
  --output json | jq -r ".Attributes | \"可視: \" + .ApproximateNumberOfMessages + \", 処理中: \" + .ApproximateNumberOfMessagesNotVisible"'
```

### 6.2 DLQ メッセージ数の監視

```bash
watch -n 60 'aws sqs get-queue-attributes \
  --queue-url <DLQ_URL> \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-northeast-1 \
  --output json | jq -r ".Attributes.ApproximateNumberOfMessages"'
```

### 6.3 成功基準

以下を2-3時間監視して問題なければ成功:

- [ ] SQS メッセージ数が増加せず、減少している
- [ ] DLQ メッセージ数が増加していない
- [ ] CloudWatch Logs にエラーがない
- [ ] OpenSearch にドキュメントがインデックスされている

### 6.4 OpenSearch インデックス確認

```bash
# OpenSearch にインデックスされたドキュメント数を確認
curl -X GET "https://<OPENSEARCH_ENDPOINT>/file-index/_count" \
  -u admin:password \
  -H 'Content-Type: application/json'
```

---

## 7. 恒久対策

### 7.1 CloudWatch Alarms の追加

#### DLQ メッセージアラート

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name file-processing-dlq-messages \
  --alarm-description "Alert when DLQ has messages" \
  --metric-name ApproximateNumberOfMessagesVisible \
  --namespace AWS/SQS \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=QueueName,Value=file-processing-dlq-production \
  --evaluation-periods 1 \
  --region ap-northeast-1
```

#### メッセージ削除失敗アラート

CloudWatch Logsのフィルターパターンでアラート:

```bash
aws logs put-metric-filter \
  --log-group-name /aws/ec2/file-processor \
  --filter-name MessageDeleteFailed \
  --filter-pattern "Failed to delete message" \
  --metric-transformations \
    metricName=MessageDeleteFailures,metricNamespace=CISFileSearch,metricValue=1
```

### 7.2 定期的な診断スクリプトの実行

cron で毎日診断を実行:

```bash
# crontab -e
0 9 * * * /path/to/emergency_diagnosis.sh > /var/log/sqs_diagnosis_$(date +\%Y\%m\%d).txt 2>&1
```

### 7.3 ドキュメント化

- S3 Event Notification の設定手順をドキュメント化
- 変更時のチェックリスト作成
- 運用マニュアルに緊急対応手順を追加

---

## 📞 サポート・エスカレーション

### 問題が解決しない場合

1. **AWS Support にチケット作成** (Business/Enterprise Plan)
   - サービス: Amazon SQS
   - カテゴリ: Technical Support
   - 重要度: Urgent

2. **このレポートを添付**:
   - `EMERGENCY_DIAGNOSIS_REPORT.md`
   - 診断スクリプトの出力
   - CloudWatch Logs のスナップショット

3. **一時的な回避策**:
   - file-scanner を停止
   - 手動でファイルを処理
   - バッチ処理に切り替え

---

## 🔗 関連ドキュメント

- [EMERGENCY_DIAGNOSIS_REPORT.md](./EMERGENCY_DIAGNOSIS_REPORT.md) - 詳細診断レポート
- [CONFIG_ADDITIONS.md](./CONFIG_ADDITIONS.md) - config.py 修正手順
- [AWS SQS Best Practices](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-best-practices.html)
- [S3 Event Notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/NotificationHowTo.html)

---

## ✅ チェックリスト

### 診断フェーズ
- [ ] emergency_diagnosis.sh を実行
- [ ] SQS/DLQ メッセージ数を確認
- [ ] S3 Event Notification 設定を確認
- [ ] CloudWatch Logs を確認

### 停止フェーズ
- [ ] emergency_stop.sh を実行
- [ ] バックアップファイルが作成されたことを確認
- [ ] EC2インスタンスが停止したことを確認
- [ ] SQS メッセージ増加が停止したことを確認

### 修正フェーズ
- [ ] S3 Event Notification を修正
- [ ] worker.py を修正版に置き換え
- [ ] config.py を更新
- [ ] Visibility Timeout を 900秒に変更
- [ ] (必要に応じて) AMI を再作成
- [ ] (オプション) キューをクリア

### 復旧フェーズ
- [ ] emergency_recovery.sh を実行
- [ ] EC2インスタンスが起動したことを確認
- [ ] CloudWatch Logs でエラーがないことを確認

### 検証フェーズ
- [ ] SQS メッセージ数を2-3時間監視
- [ ] DLQ メッセージが増加していないことを確認
- [ ] OpenSearch にインデックスされていることを確認
- [ ] 正常動作を確認

### 恒久対策フェーズ
- [ ] CloudWatch Alarms を追加
- [ ] 定期診断を設定
- [ ] ドキュメントを更新
- [ ] チーム内で情報共有

---

**最終更新**: 2025-12-12
**作成者**: Claude Code
**バージョン**: 1.0
