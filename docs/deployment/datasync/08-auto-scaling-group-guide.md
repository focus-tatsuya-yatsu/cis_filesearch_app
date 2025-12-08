# 🚀 CIS File Search - Auto Scaling Group設定ガイド

## 🎯 概要

このガイドでは、SQSキューの深さに基づいて自動的にスケールするEC2 Auto Scaling Groupを設定します。Spot Instancesを活用してコストを70%削減しながら、高可用性を実現します。

## 📝 前提条件

- [ ] Launch Template (`CIS-FileProcessor-LaunchTemplate`) 作成済み
- [ ] SQSキュー (`CIS-FileProcessing-Queue`) 作成済み
- [ ] VPCとSubnet設定済み
- [ ] CloudWatch Alarms用のSNSトピック準備（オプション）

## 🔧 Auto Scaling Group作成手順

### ステップ1: Auto Scaling Groups画面へのアクセス

1. **EC2コンソール**を開く
2. 左メニューから「**Auto Scaling Groups**」を選択
3. 「**Create Auto Scaling group**」をクリック

### ステップ2: 基本設定

#### 2.1 名前とLaunch Template選択
```
Auto Scaling group name: CIS-FileProcessor-ASG
Launch template: CIS-FileProcessor-LaunchTemplate
Version: Latest ($Latest)
```

### ステップ3: インスタンス起動オプション

#### 3.1 購入オプションとインスタンスタイプ
```yaml
Purchase options:
  ✅ Combine purchase options and instance types

Instance type requirements:
  ✅ Override launch template

Spot/On-Demand配分:
  On-Demand base capacity: 1 (最低1台はOn-Demandで確保)
  On-Demand percentage above base: 20% (追加分の20%をOn-Demand)
  Spot allocation strategy: price-capacity-optimized
```

#### 3.2 インスタンスタイプの選択
```yaml
Instance types (優先順位順):
  1. c5.xlarge (Primary)
  2. c5a.xlarge (AMD variant)
  3. m5.xlarge (General purpose)
  4. c5.2xlarge (Scale up option)
  5. m5a.xlarge (AMD general)

Weight設定:
  - c5.xlarge: 1
  - c5a.xlarge: 1
  - m5.xlarge: 1
  - c5.2xlarge: 2
  - m5a.xlarge: 1
```

### ステップ4: ネットワーク設定

#### 4.1 VPCとSubnet選択
```yaml
VPC: [プロジェクト用VPC]
Availability Zones and subnets:
  - ap-northeast-1a: [Private Subnet 1a]
  - ap-northeast-1c: [Private Subnet 1c]
  - ap-northeast-1d: [Private Subnet 1d] (optional)
```

> ⚠️ **注意**: 最低2つのAZを選択することで高可用性を確保

### ステップ5: 高度な設定

#### 5.1 ロードバランサー設定
```yaml
Load balancing: No load balancer (SQS駆動のため不要)
```

#### 5.2 ヘルスチェック
```yaml
Health checks:
  Health check type: EC2
  Health check grace period: 300 seconds

追加設定:
  ✅ Replace unhealthy instances
```

#### 5.3 追加設定
```yaml
Monitoring:
  ✅ Enable group metrics collection within CloudWatch

Default instance warmup: 120 seconds
Capacity rebalancing: ✅ Enable
```

### ステップ6: グループサイズとスケーリングポリシー

#### 6.1 グループサイズ
```yaml
Desired capacity: 1
Minimum capacity: 0
Maximum capacity: 10
```

#### 6.2 自動スケーリング設定
```yaml
Scaling policies: Target tracking scaling policy

Policy type: Target tracking
Scaling policy name: CIS-SQS-Queue-Depth-Scaling
Metric type: ✅ Predefined metrics
```

### ステップ7: SQSベースのカスタムスケーリング設定

Auto Scaling Group作成後、**CloudWatchコンソール**で以下のカスタムメトリクスとアラームを設定：

#### 7.1 カスタムメトリクスの数式
```
メトリクス名: BacklogPerInstance
計算式: ApproximateNumberOfMessagesVisible / RunningInstances

計算方法:
1. m1 = SQS ApproximateNumberOfMessagesVisible
2. m2 = Auto Scaling GroupInServiceInstances
3. 数式: m1 / MAX(m2, 1)
```

#### 7.2 スケールアウトアラーム
```yaml
Alarm name: CIS-FileProcessor-ScaleOut
Metric: BacklogPerInstance
Statistic: Average
Period: 1 minute
Evaluation periods: 2
Threshold: 10
Comparison: GreaterThanThreshold

Action:
  - Auto Scaling Action: Add 2 instances
```

#### 7.3 スケールインアラーム
```yaml
Alarm name: CIS-FileProcessor-ScaleIn
Metric: BacklogPerInstance
Statistic: Average
Period: 5 minutes
Evaluation periods: 3
Threshold: 2
Comparison: LessThanThreshold

Action:
  - Auto Scaling Action: Remove 1 instance
```

### ステップ8: ライフサイクルフック設定

#### 8.1 Termination Lifecycle Hook
```bash
# CLIでライフサイクルフックを追加
aws autoscaling put-lifecycle-hook \
  --lifecycle-hook-name CIS-GracefulTermination \
  --auto-scaling-group-name CIS-FileProcessor-ASG \
  --lifecycle-transition autoscaling:EC2_INSTANCE_TERMINATING \
  --default-result CONTINUE \
  --heartbeat-timeout 120 \
  --notification-metadata '{"action": "drain_sqs_messages"}'
```

### ステップ9: 通知設定（オプション）

#### 9.1 SNS通知設定
```yaml
Notification type:
  ✅ Launch
  ✅ Terminate
  ✅ Fail to launch
  ✅ Fail to terminate

SNS Topic: CIS-ASG-Notifications
Recipients: devops-team@example.com
```

### ステップ10: タグ設定

```yaml
Tags:
  - Key: Name
    Value: CIS-FileProcessor
    ✅ Tag new instances

  - Key: Environment
    Value: Production
    ✅ Tag new instances

  - Key: Project
    Value: CIS-FileSearch
    ✅ Tag new instances

  - Key: ManagedBy
    Value: AutoScaling
    ✅ Tag new instances

  - Key: CostCenter
    Value: Engineering
    ✅ Tag new instances
```

## 📊 スケーリング戦略の詳細

### 処理能力の見積もり

| メトリクス | 値 | 説明 |
|-----------|-----|------|
| 1インスタンスの処理能力 | 10 files/min | PDFとOCR処理を含む |
| 目標バックログ | 10 messages/instance | レスポンシブなスケーリング |
| 最大処理遅延 | 5分 | ビジネス要件 |

### スケーリングシナリオ

#### シナリオ1: 朝の大量アップロード
```
08:00 - NASから1000ファイル同期
08:01 - SQSに1000メッセージ
08:02 - BacklogPerInstance = 1000/1 = 1000
08:03 - スケールアウト開始 → 10インスタンスまで拡張
08:15 - 処理完了
08:20 - スケールイン開始
08:30 - 1インスタンスに戻る
```

#### シナリオ2: 定常的な処理
```
日中 - 10分ごとに5-10ファイル
インスタンス数: 1 (最小構成)
処理遅延: < 1分
```

## 🔒 セキュリティ考慮事項

### IMDSv2強制
```bash
# Auto Scaling Group作成後に設定
aws autoscaling update-auto-scaling-group \
  --auto-scaling-group-name CIS-FileProcessor-ASG \
  --launch-template '{
    "LaunchTemplateName": "CIS-FileProcessor-LaunchTemplate",
    "Version": "$Latest"
  }' \
  --metadata-options '{
    "HttpTokens": "required",
    "HttpPutResponseHopLimit": 1
  }'
```

### Security Group自動更新
```yaml
定期的なセキュリティグループレビュー:
  - 不要なポートが開いていないか確認
  - アウトバウンドルールの最小化
  - VPCエンドポイント経由の通信確認
```

## 💰 コスト最適化設定

### Spot Instance中断への対応
```yaml
Capacity Rebalancing設定:
  - 自動的に新しいSpotインスタンスを起動
  - 中断前にタスクを移行
  - データロスを防止
```

### 予約購入の検討
```yaml
月間稼働時間予測:
  - ベースライン: 720時間 × 1インスタンス
  - ピーク時: 100時間 × 5インスタンス

推奨:
  - 1台分のReserved Instance購入
  - 残りはSpot Instanceで対応
```

## 📈 モニタリングダッシュボード

### CloudWatchダッシュボード作成
```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/AutoScaling", "GroupInServiceInstances", {"stat": "Average"}],
          ["AWS/SQS", "ApproximateNumberOfMessagesVisible"],
          [".", "ApproximateAgeOfOldestMessage"],
          ["CIS/FileProcessor", "ProcessedFiles", {"stat": "Sum"}],
          [".", "ProcessingErrors", {"stat": "Sum"}]
        ],
        "period": 300,
        "stat": "Average",
        "region": "ap-northeast-1",
        "title": "File Processing Metrics"
      }
    }
  ]
}
```

## 🔍 トラブルシューティング

### インスタンスが起動しない
```bash
# Auto Scaling Activityログ確認
aws autoscaling describe-scaling-activities \
  --auto-scaling-group-name CIS-FileProcessor-ASG \
  --max-items 10

# 一般的な原因:
# - Spot容量不足 → インスタンスタイプを追加
# - IAMロール権限不足 → Instance Profile確認
# - Subnet容量不足 → 別のAZ/Subnetを追加
```

### スケーリングが発生しない
```bash
# CloudWatch Alarmの状態確認
aws cloudwatch describe-alarms \
  --alarm-names CIS-FileProcessor-ScaleOut CIS-FileProcessor-ScaleIn

# メトリクス値の確認
aws cloudwatch get-metric-statistics \
  --namespace AWS/SQS \
  --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions Name=QueueName,Value=CIS-FileProcessing-Queue \
  --start-time 2024-01-20T00:00:00Z \
  --end-time 2024-01-20T23:59:59Z \
  --period 300 \
  --statistics Average
```

### Spot Instance中断対応
```bash
# 中断通知の確認
curl -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/spot/instance-action

# 中断履歴の確認
aws ec2 describe-spot-instance-requests \
  --filters "Name=state,Values=terminated,cancelled"
```

## ✅ 完了チェックリスト

- [ ] Auto Scaling Group作成
- [ ] Mixed Instance Types設定
- [ ] Spot/On-Demand比率設定（80/20）
- [ ] SQSベースのスケーリングポリシー設定
- [ ] CloudWatch Alarms作成
- [ ] ライフサイクルフック設定
- [ ] タグ設定
- [ ] 初期テスト（1インスタンス起動確認）
- [ ] スケーリングテスト（SQSメッセージ投入）
- [ ] モニタリングダッシュボード作成

## 📚 参考リンク

- [Auto Scaling User Guide](https://docs.aws.amazon.com/autoscaling/ec2/userguide/)
- [Scaling Based on SQS](https://docs.aws.amazon.com/autoscaling/ec2/userguide/as-using-sqs-queue.html)
- [Spot Instance Best Practices](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-best-practices.html)
- [Lifecycle Hooks](https://docs.aws.amazon.com/autoscaling/ec2/userguide/lifecycle-hooks.html)

## 🚀 次のステップ

Auto Scaling Group設定後は、[09-python-worker-application-guide.md](./09-python-worker-application-guide.md)でPythonアプリケーションの実装詳細を確認します。