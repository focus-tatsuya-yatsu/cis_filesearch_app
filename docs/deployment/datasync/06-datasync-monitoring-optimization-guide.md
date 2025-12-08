# AWS DataSync 監視・最適化・トラブルシューティングガイド

**作成日**: 2025-01-17
**対象**: Week 3以降（運用フェーズ）
**所要時間**: 継続的な運用タスク
**前提条件**: DataSync Task設定済み、初回同期完了

---

## 📋 目次

1. [監視戦略](#監視戦略)
2. [CloudWatch Metrics](#cloudwatch-metrics)
3. [CloudWatch Alarms設定](#cloudwatch-alarms設定)
4. [SNS通知設定](#sns通知設定)
5. [パフォーマンス最適化](#パフォーマンス最適化)
6. [コスト最適化](#コスト最適化)
7. [トラブルシューティング](#トラブルシューティング)
8. [運用手順書](#運用手順書)

---

## 監視戦略

### 監視対象の3つのレイヤー

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1: DataSync Agent Health                                  │
│   - Agent Status (ONLINE/OFFLINE)                               │
│   - Agent CPU/Memory使用率                                        │
│   - ネットワーク接続状態                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 2: DataSync Task Execution                                │
│   - Task Success/Failure                                        │
│   - 転送ファイル数・データ量                                         │
│   - 実行時間                                                      │
│   - エラー発生数                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Layer 3: S3 & EC2 Processing Pipeline                           │
│   - S3 EventBridge通知数                                         │
│   - SQSキュー滞留数（処理待ち）                                    │
│   - EC2 Auto Scaling Group状態（Desired/Running/Spot中断）        │
│   - EC2 Worker処理成功/失敗数                                      │
│   - OpenSearchインデックス登録数                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 監視頻度

| 監視対象 | 頻度 | アラート閾値 |
|---------|------|------------|
| Agent Status | 5分間隔 | OFFLINE状態が15分以上 |
| Task Execution | Task実行時のみ | 失敗時、または6時間超過 |
| SQS Queue Depth | 5分間隔 | 1000メッセージ以上滞留 |
| EC2 Worker Status | 5分間隔 | エラー率10%超過 |
| Spot中断通知 | リアルタイム | 即座にアラート |
| S3バケット容量 | 1日1回 | 予想の120%超過 |
| 月次転送データ量 | 月次 | 予想の150%超過 |

---

## CloudWatch Metrics

### DataSync Agent Metrics

```bash
# AWS CLIでAgent Metricsを取得
aws cloudwatch get-metric-statistics \
  --namespace AWS/DataSync \
  --metric-name AgentStatus \
  --dimensions Name=AgentId,Value=agent-0abc12345def67890 \
  --start-time 2025-01-17T00:00:00Z \
  --end-time 2025-01-17T23:59:59Z \
  --period 300 \
  --statistics Average \
  --region ap-northeast-1 \
  --profile AdministratorAccess-770923989980
```

**主要Metrics**:

| Metric名 | 説明 | 正常値 | 異常値 |
|---------|------|--------|--------|
| `AgentStatus` | Agent接続状態 | 1 (ONLINE) | 0 (OFFLINE) |
| `AgentCpuUtilization` | CPU使用率 | <80% | >90% |
| `AgentMemoryUtilization` | メモリ使用率 | <80% | >90% |
| `AgentNetworkBytesRead` | ネットワーク受信量 | - | - |
| `AgentNetworkBytesWritten` | ネットワーク送信量 | - | - |

### DataSync Task Metrics

```bash
# Task Execution Metricsを取得
aws cloudwatch get-metric-statistics \
  --namespace AWS/DataSync \
  --metric-name FilesTransferred \
  --dimensions Name=TaskId,Value=task-0abc123def456 \
  --start-time 2025-01-01T02:00:00Z \
  --end-time 2025-01-01T08:00:00Z \
  --period 3600 \
  --statistics Sum \
  --region ap-northeast-1 \
  --profile AdministratorAccess-770923989980
```

**主要Metrics**:

| Metric名 | 説明 | 単位 | CIS想定値（月次） |
|---------|------|------|----------------|
| `FilesTransferred` | 転送ファイル数 | Count | 50,000-100,000 |
| `BytesTransferred` | 転送データ量 | Bytes | 500GB-1TB |
| `FilesPrepared` | スキャンファイル数 | Count | 500万 |
| `FilesVerified` | 検証済みファイル数 | Count | 50,000-100,000 |
| `TaskExecutionDuration` | 実行時間 | Seconds | 10,800-21,600 (3-6時間) |

### SQS Queue Metrics

```bash
# SQS Queue Depth確認
aws cloudwatch get-metric-statistics \
  --namespace AWS/SQS \
  --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions Name=QueueName,Value=cis-filesearch-processing-queue \
  --start-time 2025-01-17T00:00:00Z \
  --end-time 2025-01-17T23:59:59Z \
  --period 300 \
  --statistics Average,Maximum \
  --region ap-northeast-1 \
  --profile AdministratorAccess-770923989980
```

**主要Metrics**:

| Metric名 | 説明 | 正常値 | 異常値 |
|---------|------|--------|--------|
| `ApproximateNumberOfMessagesVisible` | 処理待ちメッセージ数 | 0-100 | >1000 |
| `ApproximateAgeOfOldestMessage` | 最古メッセージの経過時間 | <300秒 | >3600秒 |
| `NumberOfMessagesSent` | 送信メッセージ数 | - | - |
| `NumberOfMessagesDeleted` | 削除（処理完了）メッセージ数 | - | - |

### EC2 Auto Scaling Metrics

```bash
# EC2 Auto Scaling Group確認
aws cloudwatch get-metric-statistics \
  --namespace AWS/AutoScaling \
  --metric-name GroupDesiredCapacity \
  --dimensions Name=AutoScalingGroupName,Value=cis-filesearch-processor-asg \
  --start-time 2025-01-17T00:00:00Z \
  --end-time 2025-01-17T23:59:59Z \
  --period 300 \
  --statistics Average \
  --region ap-northeast-1 \
  --profile AdministratorAccess-770923989980
```

**主要Metrics**:

| Metric名 | 説明 | 正常値 | 異常値 |
|---------|------|--------|--------|
| `GroupDesiredCapacity` | 目標インスタンス数 | 0-10（SQS深度に応じて） | >20 |
| `GroupInServiceInstances` | 稼働中インスタンス数 | Desired以下 | Desired未満が15分継続 |
| `GroupPendingInstances` | 起動中インスタンス数 | 0-2 | >5 |

### CloudWatch Logs Insights クエリ

#### Task実行サマリー

```sql
fields @timestamp, message
| filter @message like /Task execution/
| filter @message like /completed successfully/
| parse @message /Files transferred: (?<files_transferred>\d+)/
| parse @message /Data: (?<data_gb>\d+\.\d+) GB/
| parse @message /Duration: (?<duration>\d+)m (?<duration_sec>\d+)s/
| sort @timestamp desc
| limit 20
```

#### エラー抽出

```sql
fields @timestamp, @message
| filter @message like /ERROR/
| sort @timestamp desc
| limit 50
```

#### 転送速度分析

```sql
fields @timestamp, message
| filter @message like /Transferring:/
| parse @message /Transferring: (?<filename>.*) \((?<size>.*)\)/
| stats count() as file_count, sum(size) as total_size by bin(5m)
```

---

## CloudWatch Alarms設定

### Alarm 1: Agent OFFLINE検知

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "CIS-DataSync-Agent-OFFLINE" \
  --alarm-description "DataSync Agent went OFFLINE for more than 15 minutes" \
  --namespace AWS/DataSync \
  --metric-name AgentStatus \
  --dimensions Name=AgentId,Value=agent-0abc12345def67890 \
  --statistic Average \
  --period 300 \
  --evaluation-periods 3 \
  --threshold 0.5 \
  --comparison-operator LessThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:ap-northeast-1:770923989980:CIS-DataSync-Alerts \
  --region ap-northeast-1 \
  --profile AdministratorAccess-770923989980
```

**説明**:
- Agent Statusが0.5未満（OFFLINE）が5分間×3回（15分間）継続
- SNSトピック経由でメール/Slack通知

### Alarm 2: Task実行失敗

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "CIS-DataSync-Task-Failed" \
  --alarm-description "DataSync Task execution failed" \
  --namespace AWS/DataSync \
  --metric-name TaskExecutionStatus \
  --dimensions Name=TaskId,Value=task-0abc123def456 \
  --statistic Average \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 0.5 \
  --comparison-operator LessThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:ap-northeast-1:770923989980:CIS-DataSync-Alerts \
  --region ap-northeast-1 \
  --profile AdministratorAccess-770923989980
```

### Alarm 3: Task実行時間超過（6時間以上）

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "CIS-DataSync-Task-Duration-Exceeded" \
  --alarm-description "DataSync Task execution exceeded 6 hours" \
  --namespace AWS/DataSync \
  --metric-name TaskExecutionDuration \
  --dimensions Name=TaskId,Value=task-0abc123def456 \
  --statistic Maximum \
  --period 3600 \
  --evaluation-periods 1 \
  --threshold 21600 \
  --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:ap-northeast-1:770923989980:CIS-DataSync-Alerts \
  --region ap-northeast-1 \
  --profile AdministratorAccess-770923989980
```

### Alarm 4: SQS Queue滞留アラート

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "CIS-SQS-Queue-Backlog" \
  --alarm-description "SQS queue has more than 1000 messages waiting" \
  --namespace AWS/SQS \
  --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions Name=QueueName,Value=cis-filesearch-processing-queue \
  --statistic Average \
  --period 300 \
  --evaluation-periods 3 \
  --threshold 1000 \
  --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:ap-northeast-1:770923989980:CIS-DataSync-Alerts \
  --region ap-northeast-1 \
  --profile AdministratorAccess-770923989980
```

**説明**:
- SQSキューに1000メッセージ以上が5分間×3回（15分間）滞留
- EC2 Workersの処理速度不足またはインスタンス起動失敗を示唆

### Alarm 5: EC2 Worker エラー率上昇

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "CIS-EC2-Worker-Error-Rate" \
  --alarm-description "EC2 Worker error rate exceeded 10%" \
  --namespace CIS/FileSearch/EC2 \
  --metric-name EC2WorkerErrorCount \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:ap-northeast-1:770923989980:CIS-DataSync-Alerts \
  --region ap-northeast-1 \
  --profile AdministratorAccess-770923989980
```

### Alarm 6: Spot Instance中断警告

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "CIS-Spot-Interruption-Warning" \
  --alarm-description "Spot instance interruption warning detected" \
  --namespace CIS/FileSearch/EC2 \
  --metric-name SpotInterruptionWarningCount \
  --statistic Sum \
  --period 60 \
  --evaluation-periods 1 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:ap-northeast-1:770923989980:CIS-DataSync-Alerts \
  --region ap-northeast-1 \
  --profile AdministratorAccess-770923989980
```

**説明**:
- Spot Instance 2分前警告を即座に検知
- 処理中のメッセージをSQSに戻す猶予時間を確保

### Alarm 7: S3バケット容量急増

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "CIS-S3-Bucket-Size-Spike" \
  --alarm-description "S3 bucket size increased by more than 50% in a day" \
  --namespace AWS/S3 \
  --metric-name BucketSizeBytes \
  --dimensions Name=BucketName,Value=cis-filesearch-raw-files-prod Name=StorageType,Value=StandardStorage \
  --statistic Average \
  --period 86400 \
  --evaluation-periods 1 \
  --threshold 15000000000000 \
  --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions arn:aws:sns:ap-northeast-1:770923989980:CIS-DataSync-Alerts \
  --region ap-northeast-1 \
  --profile AdministratorAccess-770923989980
```

**閾値設定**:
- 想定: 10TB (10,000,000,000,000 Bytes)
- 閾値: 15TB (15,000,000,000,000 Bytes) = 150%

---

## SNS通知設定

### SNSトピック作成

```bash
# SNSトピック作成
aws sns create-topic \
  --name CIS-DataSync-Alerts \
  --region ap-northeast-1 \
  --profile AdministratorAccess-770923989980

# 出力されたARNをメモ:
# arn:aws:sns:ap-northeast-1:770923989980:CIS-DataSync-Alerts
```

### メール通知設定

```bash
# メールアドレスをサブスクライブ
aws sns subscribe \
  --topic-arn arn:aws:sns:ap-northeast-1:770923989980:CIS-DataSync-Alerts \
  --protocol email \
  --notification-endpoint devops@company.com \
  --region ap-northeast-1 \
  --profile AdministratorAccess-770923989980

# 確認メールが届くので、リンクをクリックして承認
```

### Slack通知設定（オプション）

```bash
# AWS Chatbot経由でSlack通知
# 前提: Slack Workspaceとの連携設定済み

aws chatbot create-slack-channel-configuration \
  --configuration-name CIS-DataSync-Slack-Notifications \
  --slack-team-id T01234567 \
  --slack-channel-id C01234567 \
  --iam-role-arn arn:aws:iam::770923989980:role/CIS-Chatbot-Role \
  --sns-topic-arns arn:aws:sns:ap-northeast-1:770923989980:CIS-DataSync-Alerts \
  --region ap-northeast-1 \
  --profile AdministratorAccess-770923989980
```

### 通知メッセージのカスタマイズ

```json
{
  "AlarmName": "CIS-DataSync-Agent-OFFLINE",
  "AlarmDescription": "DataSync Agent went OFFLINE for more than 15 minutes",
  "NewStateValue": "ALARM",
  "NewStateReason": "Threshold Crossed: 3 datapoints were less than the threshold (0.5)",
  "StateChangeTime": "2025-01-17T10:30:00.000+0000",
  "Region": "Asia Pacific - Tokyo",
  "AlarmArn": "arn:aws:cloudwatch:ap-northeast-1:770923989980:alarm:CIS-DataSync-Agent-OFFLINE",
  "OldStateValue": "OK",
  "Trigger": {
    "MetricName": "AgentStatus",
    "Namespace": "AWS/DataSync",
    "StatisticType": "Statistic",
    "Statistic": "AVERAGE",
    "Unit": null,
    "Dimensions": [
      {
        "name": "AgentId",
        "value": "agent-0abc12345def67890"
      }
    ],
    "Period": 300,
    "EvaluationPeriods": 3,
    "ComparisonOperator": "LessThanThreshold",
    "Threshold": 0.5
  }
}
```

---

## パフォーマンス最適化

### Agent VMのリソース最適化

#### CPU最適化

```
問題: CPU使用率が常に90%以上
原因: ファイルスキャンとチェックサム計算の負荷

対処法:
  1. vCPU数を増やす
     Before: 4コア → After: 8コア or 16コア

  2. CPU Reservationを設定（VMware）
     → 他VMとのリソース競合を回避

  3. Transfer Modeを見直す
     → "Transfer all data" から "Transfer only data that has changed"
```

#### メモリ最適化

```
問題: メモリ使用率が常に85%以上
原因: 大量ファイル（500万件）のメタデータキャッシュ

対処法:
  1. メモリを増やす
     Before: 16GB → After: 32GB or 64GB

  2. Memory Reservationを設定（VMware）
     → スワップ発生を防止

  3. ファイル数を分割
     → 1回のTaskで転送するファイル数を制限
     → 複数Taskに分割（例: /Documents と /Images を別Task）
```

#### ネットワーク最適化

```
問題: ネットワーク帯域幅が100Mbps以下
原因: ネットワークアダプタの性能不足

対処法:
  1. 高性能ネットワークアダプタを使用
     VMware: VMXNET3
     Hyper-V: Synthetic Network Adapter

  2. MTU（Maximum Transmission Unit）を最適化
     デフォルト: 1500 Bytes
     推奨: 9000 Bytes (Jumbo Frame)

     Agent VM設定:
       sudo ip link set eth0 mtu 9000

  3. 10Gbps物理NICを使用
     → 1Gbps NICでは帯域幅が不足
```

### DataSync Task Options最適化

#### 並列転送数の調整

```
デフォルト: 8並列（Agent VMのスペックに依存）

高速化:
  - Agent VMのvCPU/メモリを増強
  → 自動的に並列転送数が増加（最大32並列）

小ファイル転送の最適化:
  - Task Options → Enable compression
  → 小ファイルをまとめて圧縮転送（オーバーヘッド削減）
```

#### バッファリング設定

```
Task Options → Advanced settings

Buffer size: 1048576 (1MB) デフォルト
  → 大容量ファイルが多い場合は増やす: 4194304 (4MB)

Queue depth: 4 デフォルト
  → ディスクI/O高速な場合は増やす: 8 or 16
```

---

## コスト最適化

### DataSync料金体系

```
料金モデル: データ転送量に基づく従量課金

料金:
  - オンプレミス → AWS: $0.0125/GB
  - AWS → AWS: $0.0125/GB（S3 → S3等）

CISプロジェクト想定コスト:
  初回: 10TB × $0.0125/GB = 10,240GB × $0.0125 = $128
  月次: 500GB × $0.0125/GB = 512GB × $0.0125 = $6.40/月
  年間: $128 + ($6.40 × 11) = $198.40
```

### DataSync + EC2 Spot統合コスト

```
月次総コスト内訳（CISプロジェクト想定）:
  1. DataSync転送: $6.40/月（500GB増分）
  2. S3ストレージ: $128/月（10TB, Intelligent-Tiering平均）
  3. EC2 Spot Instances: $12-20/月（処理時間依存）
     - t3.medium Spot × 4台 × 3時間/月 × $0.0104/時間 = $0.12/月
     - 処理時間が長い場合（10時間）: $0.42/月
  4. SQS: $0.50/月（50,000メッセージ × $0.0000004/リクエスト × 25回操作）
  5. EventBridge: 無料（月間100万イベントまで無料）
  6. CloudWatch Logs: $2/月

合計: 約$147-155/月

従来Lambda構想との比較:
  - Lambda（15分タイムアウト超過で不適）: N/A
  - EC2 On-Demand（24時間稼働）: $245/月
  - EC2 Spot（必要時のみ）: $12-20/月 ← 現在の構成
  → Spot採用でOn-Demand比90%削減
```

### コスト削減戦略

#### 1. 増分転送の徹底

```
Transfer Mode: Transfer only data that has changed

効果:
  - 初回: 10TB転送 ($128)
  - 月次: 500GB転送 ($6.40) ← 増分のみ
  - 全転送の場合: 10TB × 12ヶ月 = $1,536
  → 年間$1,337削減（87%削減）
```

#### 2. 不要ファイルの除外

```
Excludeパターンで除外:
  - 動画ファイル (.mp4, .avi, .mov)
  - バックアップフォルダ (/Backup/*)
  - 一時ファイル (/**/~$*)
  - ゴミ箱 (/.Trash/*)

効果:
  除外ファイル: 約2TB（20%）
  転送コスト削減: 2TB × $0.0125/GB = $25.60/回
  年間削減: $25.60 × 12 = $307.20
```

#### 3. S3 Intelligent-Tieringの活用

```
S3ストレージコスト:
  Standard: $0.025/GB/月
  Intelligent-Tiering:
    - Frequent Access: $0.025/GB/月（最初30日）
    - Infrequent Access: $0.0125/GB/月（30-90日）
    - Archive Access: $0.005/GB/月（90日以上）

効果（10TBを1年間保存）:
  Standard: 10,240GB × $0.025 × 12 = $3,072/年
  Intelligent-Tiering: 約$1,500/年（平均50%アクセス頻度低下）
  → 年間$1,572削減
```

#### 4. S3ライフサイクルポリシー

```
古いバージョンの自動削除:
  - 90日経過したバージョンを削除
  → バージョニングコスト削減

設定済み（02-s3-bucket-setup-guide.md参照）:
  ✅ 90日後に古いバージョン削除
  ✅ 7日後に不完全マルチパートアップロード削除
```

#### 5. EC2 Spot Instances最適化

```
Spot Instance戦略:
  1. 複数のインスタンスタイプを指定（フォールバック）
     - Primary: t3.medium
     - Secondary: t3a.medium, t2.medium
     → 中断リスク分散

  2. Auto Scaling Target Tracking Policy
     - Metric: SQS ApproximateNumberOfMessagesVisible
     - Target: 100メッセージ/インスタンス
     → 過剰スケーリング防止

  3. Spot Capacity Rebalancing
     - 中断2分前警告でSQSメッセージを自動的に再キュー
     → データロス防止

  4. Spot中断履歴の確認
     - Spot Instance Advisor: https://aws.amazon.com/ec2/spot/instance-advisor/
     → 中断率<5%のインスタンスタイプを選択

コスト削減効果:
  - On-Demand: t3.medium × 4台 × 24時間/日 × 30日 × $0.0416/時間 = $120/月
  - Spot: t3.medium × 4台 × 3時間/月 × $0.0104/時間 = $0.12/月
  → 99.9%削減（必要時のみ起動）
```

#### 6. SQS & EventBridgeコスト最適化

```
SQS料金:
  - リクエスト: 最初100万リクエスト/月は無料
  - CIS想定: 50,000メッセージ × 25操作（送信/受信/削除/可視性変更） = 125万リクエスト
  - 超過分: 25万リクエスト × $0.0000004 = $0.10/月

EventBridge料金:
  - カスタムイベント: 最初100万イベント/月は無料
  - CIS想定: 50,000 S3イベント/月
  - コスト: $0（無料枠内）

最適化:
  - SQS Batch操作で API呼び出し削減
  - Long Polling（20秒）で空ポーリング削減
```

#### 7. スケジュール最適化

```
深夜帯実行のメリット:
  - 業務時間帯のネットワーク圧迫を回避
  - VPN/Direct Connect料金を削減（昼間のトラフィック減少）
  - Spot Instance中断率が低い時間帯

推奨スケジュール:
  - DataSync実行: 毎月1日 深夜2:00
  - EC2 Worker処理: DataSync完了後自動起動（SQS駆動）
  - 業務時間帯（9:00-18:00）は手動実行を禁止
```

### コスト監視

#### AWS Cost Explorerで追跡

```
Cost Explorer → Filter by Service:
  - AWS DataSync
  - Amazon S3
  - Amazon EC2 (Agent VM on-premises費用は除外)

タグでフィルタリング:
  Project: CIS-FileSearch
  Component: DataSync

月次コストレビュー:
  - 想定: $50-80/月
  - 閾値: $120/月（150%超過時にアラート）
```

#### AWS Budgets設定

```bash
# 月次予算アラート設定
aws budgets create-budget \
  --account-id 770923989980 \
  --budget '{
    "BudgetName": "CIS-DataSync-Monthly-Budget",
    "BudgetLimit": {
      "Amount": "80",
      "Unit": "USD"
    },
    "TimeUnit": "MONTHLY",
    "BudgetType": "COST",
    "CostFilters": {
      "TagKeyValue": ["user:Project$CIS-FileSearch"]
    }
  }' \
  --notifications-with-subscribers '[
    {
      "Notification": {
        "NotificationType": "ACTUAL",
        "ComparisonOperator": "GREATER_THAN",
        "Threshold": 80
      },
      "Subscribers": [
        {
          "SubscriptionType": "EMAIL",
          "Address": "finance@company.com"
        }
      ]
    }
  ]' \
  --region ap-northeast-1 \
  --profile AdministratorAccess-770923989980
```

---

## トラブルシューティング

### シナリオ1: 転送速度が極端に遅い（<10Mbps）

**症状**:
```
10TB転送に1週間以上かかる見込み
期待値: 48時間以内
```

**原因診断フロー**:

```
1. Agent VMのリソース使用率確認
   → vCenter/Hyper-V Manager/virshでCPU/メモリ確認
   → 90%超えの場合: リソース不足

2. ネットワーク帯域幅確認
   → Agent VMからインターネット速度テスト
   → speedtest-cli --secure
   → 100Mbps以下の場合: ネットワークボトルネック

3. NASのI/O性能確認
   → NASの管理画面でディスクI/O確認
   → CPU使用率が高い場合: NAS側がボトルネック

4. AWS側の帯域幅制限確認
   → Task設定で100Mbps制限していないか確認
```

**対処法**:

```
1. Agent VMリソース増強
   vCPU: 4 → 8 or 16
   Memory: 16GB → 32GB or 64GB

2. ネットワーク最適化
   MTU: 1500 → 9000 (Jumbo Frame)
   NIC: 1Gbps → 10Gbps

3. 転送を複数Taskに分割
   Task 1: /Documents (2TB)
   Task 2: /Images (3TB)
   Task 3: /CAD (5TB)
   → 並列実行で高速化

4. 帯域幅制限を解除
   Task Options → Bandwidth Limit: Unlimited
```

### シナリオ2: Task実行が途中で失敗する

**症状**:
```
CloudWatch Logs:
  [ERROR] Task execution failed: Connection timeout
```

**原因診断フロー**:

```
1. Agent Status確認
   aws datasync describe-agent --agent-arn <ARN>
   → Status: OFFLINE の場合: Agent VM停止

2. NAS接続確認
   Agent VMからSMB/NFS接続テスト
   → 接続エラーの場合: NAS側の問題

3. AWS接続確認
   curl -v https://datasync.ap-northeast-1.amazonaws.com
   → 接続エラーの場合: ファイアウォール設定

4. CloudWatch Logsで詳細確認
   /aws/datasync → エラーメッセージ確認
```

**対処法**:

```
1. Agent VM再起動
   VMware/Hyper-V/KVMコンソールから再起動

2. NAS側の接続数制限確認
   → 最大SMB接続数を増やす
   → NASのファームウェア更新

3. Task Retry設定
   → DataSyncは自動リトライするが、手動再実行も可能

4. VPN/Direct Connect安定性確認
   → インターネット経由に変更（一時的）
```

### シナリオ3: S3 → EventBridge → SQS パイプラインが動作しない

**症状**:
```
DataSync転送完了後、EC2 Workersが起動しない
SQSキューにメッセージが届いていない
```

**原因診断フロー**:

```
1. S3 EventBridge通知設定確認
   S3 Console → Bucket → Properties → Amazon EventBridge
   → 「オフ」の場合: 未設定

2. EventBridge Rule確認
   EventBridge Console → Rules → CIS-S3-ObjectCreated-to-SQS
   → State: Disabled の場合: 有効化
   → 存在しない場合: Rule未作成

3. SQS Queue確認
   SQS Console → cis-filesearch-processing-queue → Messages available
   → 0件の場合: イベント発火していない

4. EventBridge Rule → SQS権限確認
   EventBridge Rule → Targets → SQS Queue
   → Execution role確認

5. S3 → EventBridge接続テスト
   aws s3 cp test.txt s3://cis-filesearch-raw-files-prod/test/
   → EventBridge Console → Event buses → default → Events を確認
```

**対処法**:

```
1. S3 EventBridge通知を有効化
   S3 Console → Properties → Amazon EventBridge → オン

2. EventBridge Ruleを作成/有効化
   aws events put-rule \
     --name CIS-S3-ObjectCreated-to-SQS \
     --event-pattern '{
       "source": ["aws.s3"],
       "detail-type": ["Object Created"],
       "detail": {
         "bucket": {
           "name": ["cis-filesearch-raw-files-prod"]
         }
       }
     }' \
     --state ENABLED

3. EventBridge Rule ターゲット設定
   aws events put-targets \
     --rule CIS-S3-ObjectCreated-to-SQS \
     --targets '[
       {
         "Id": "1",
         "Arn": "arn:aws:sqs:ap-northeast-1:770923989980:cis-filesearch-processing-queue"
       }
     ]'

4. テストイベント発火
   aws s3 cp test.txt s3://cis-filesearch-raw-files-prod/test/
   → SQSにメッセージが届くか確認
   aws sqs receive-message \
     --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-processing-queue

5. CloudTrailでイベント追跡
   CloudTrail → Event history → Filter: EventName = PutObject
```

### シナリオ4: EC2 Workersが起動しない

**症状**:
```
SQSキューにメッセージが蓄積されているが、EC2インスタンスが起動しない
Auto Scaling Group Desired Capacity = 0 のまま
```

**原因診断フロー**:

```
1. Auto Scaling Group設定確認
   EC2 Console → Auto Scaling Groups → cis-filesearch-processor-asg
   → Desired capacity, Min, Max を確認

2. Scaling Policy確認
   Auto Scaling Group → Automatic scaling
   → Target Tracking Policy が設定されているか

3. CloudWatch Alarm状態確認
   CloudWatch → Alarms
   → SQS Queue Depth アラームがトリガーされているか

4. Launch Template確認
   EC2 Console → Launch Templates
   → AMI, IAM Role, Security Group, User Data

5. Service Quotas確認
   Service Quotas Console → EC2
   → Spot Instance requests, vCPU limits
```

**対処法**:

```
1. Auto Scaling Group手動スケールアウト（テスト）
   aws autoscaling set-desired-capacity \
     --auto-scaling-group-name cis-filesearch-processor-asg \
     --desired-capacity 2

2. Target Tracking Policy再設定
   aws autoscaling put-scaling-policy \
     --auto-scaling-group-name cis-filesearch-processor-asg \
     --policy-name cis-sqs-target-tracking \
     --policy-type TargetTrackingScaling \
     --target-tracking-configuration '{
       "CustomizedMetricSpecification": {
         "MetricName": "ApproximateNumberOfMessagesVisible",
         "Namespace": "AWS/SQS",
         "Dimensions": [
           {
             "Name": "QueueName",
             "Value": "cis-filesearch-processing-queue"
           }
         ],
         "Statistic": "Average"
       },
       "TargetValue": 100.0
     }'

3. Spot Instance制約確認
   → Spot Instance価格が高騰していないか確認
   → 複数のインスタンスタイプを指定

4. IAM Instance Profile確認
   Launch Template → IAM instance profile
   → CIS-EC2-FileProcessor-Role が正しく設定されているか

5. CloudWatch Logsでエラー確認
   /aws/ec2/cis-filesearch-processor/system
   → インスタンス起動エラーログを確認
```

---

## 運用手順書

### 月次定期実行の確認手順

```
実行日: 毎月1日 深夜2:00（自動実行）
確認日: 毎月1日 午前中（翌営業日）

Step 1: Task実行結果確認
  1. AWS Console → DataSync → Tasks → CIS-NAS01-to-S3-Monthly-Sync
  2. 最新のTask execution → Status: Success を確認
  3. Files transferred, Data transferred を記録

Step 2: CloudWatch Logs確認
  1. CloudWatch → Log groups → /aws/datasync
  2. 最新のLog stream → エラーログがないか確認

Step 3: S3バケット確認
  1. S3 Console → cis-filesearch-landing
  2. 最新ファイルのタイムスタンプ確認
  3. バケットサイズ確認（想定内か）

Step 4: EC2 Workers処理確認
  1. SQS Console → cis-filesearch-processing-queue
  2. Messages available: 0 を確認（全処理完了）
  3. Messages in flight: 0 を確認（処理中なし）
  4. Auto Scaling Group → Desired capacity: 0 を確認（自動スケールイン完了）
  5. CloudWatch Logs → /aws/ec2/cis-filesearch-processor/application
     → エラーログがないか確認
  6. OpenSearch Dashboard → Index count増加確認

Step 5: レポート作成
  - 転送ファイル数: XX,XXX
  - 転送データ量: XXX GB
  - 実行時間: X時間XX分
  - エラー: なし / あり（内容記載）
```

### 緊急時の手動実行手順

```
状況: 月次自動実行が失敗した、または臨時で追加転送が必要

Step 1: 失敗原因の確認
  1. CloudWatch Logs → エラーメッセージ確認
  2. Agent Status → ONLINE確認
  3. NAS接続確認

Step 2: 手動実行
  1. AWS Console → DataSync → Tasks → CIS-NAS01-to-S3-Monthly-Sync
  2. 「Start with overrides」ボタンをクリック
  3. Overrides:
     - Bandwidth limit: Unlimited（深夜の場合）
     - Verify data: Verify only the data transferred
  4. 「Start」ボタンをクリック

Step 3: 実行監視
  1. Task execution status: Transferring を確認
  2. CloudWatch Logs → リアルタイムログ確認
  3. 想定実行時間: 3-6時間

Step 4: 完了確認
  → 「月次定期実行の確認手順」と同じ
```

---

## 完了確認チェックリスト

```
監視設定:
  ✅ CloudWatch Alarms設定完了（Agent, Task, S3）
  ✅ SNS通知設定完了（メール/Slack）
  ✅ CloudWatch Logs Insights クエリ作成

パフォーマンス最適化:
  ✅ Agent VMリソース最適化（vCPU, Memory）
  ✅ ネットワーク最適化（MTU, NIC）
  ✅ Task Options最適化（並列転送、バッファリング）

コスト最適化:
  ✅ 増分転送設定
  ✅ 不要ファイル除外
  ✅ S3 Intelligent-Tiering設定
  ✅ AWS Budgets設定

運用手順書:
  ✅ 月次確認手順を作成
  ✅ 緊急時手動実行手順を作成
  ✅ トラブルシューティングガイド作成
```

---

## 参考資料

- [DataSync Monitoring with CloudWatch](https://docs.aws.amazon.com/datasync/latest/userguide/monitoring-datasync.html)
- [DataSync Performance Optimization](https://docs.aws.amazon.com/datasync/latest/userguide/performance.html)
- [DataSync Pricing](https://aws.amazon.com/datasync/pricing/)
- [Troubleshooting DataSync](https://docs.aws.amazon.com/datasync/latest/userguide/troubleshooting-datasync.html)

---

**作成者**: CIS DevOps Team
**最終更新**: 2025-01-17
