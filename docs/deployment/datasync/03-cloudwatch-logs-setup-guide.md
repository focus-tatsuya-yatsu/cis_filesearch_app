# CloudWatch Logs セットアップガイド（DataSync + EC2実装用）

**作成日**: 2025-01-12（2025-01-14更新）
**対象**: Week 1 Day 1-2
**所要時間**: 20分
**前提条件**: AWSアカウント、AdministratorAccess権限

---

## 📋 作成するCloudWatch Logsリソース

| リソースタイプ | 名前 | 用途 | 保持期間 |
|--------------|------|------|---------|
| Log Group | `/aws/datasync/cis-filesearch-sync` | DataSync Task実行ログ | 30日 |
| Log Group | `/aws/ec2/cis-filesearch-processor/application` | **EC2 Worker アプリケーションログ** | **30日** |
| Log Group | `/aws/ec2/cis-filesearch-processor/system` | **EC2 システムログ** | **7日** |

---

## 📊 CloudWatch Logs概要

### CloudWatch Logsとは
AWS CloudWatch Logsは、AWSサービスやアプリケーションからのログデータを一元管理できるフルマネージド型ログ管理サービスです。

### CISプロジェクトでの用途
1. **DataSync実行ログ**: ファイル転送の進捗、エラー、パフォーマンスメトリクス
2. **EC2 Workerアプリケーションログ**: Python Worker処理ログ、OCR結果、ベクトル化処理、OpenSearchインデックス登録
3. **EC2 システムログ**: インスタンス起動/停止、Spot中断警告、OS レベルエラー
4. **統合監視**: CloudWatch Dashboardでの可視化
5. **アラート**: CloudWatch Alarmsでの異常検知

---

## 🔧 Log Group 1: DataSync用

### Step 1: CloudWatch Consoleにアクセス

```
1. AWSマネジメントコンソールにログイン
2. サービス検索で「CloudWatch」と入力
3. CloudWatch Dashboard → 左メニュー「ロググループ」→「ロググループを作成」
```

### Step 2: ロググループの作成

#### ロググループ名

```
ロググループ名: /aws/datasync/cis-filesearch-sync
```

**命名規則**:
- `/aws/datasync/` プレフィックス: DataSyncサービスの標準パス
- `cis-filesearch-sync` サフィックス: プロジェクト識別子

#### 保持設定

```
保持期間: 30日
```

**理由**:
- DataSyncは月次実行のため、30日で十分な履歴が保持される
- コスト最適化（長期保存は不要）
- トラブルシューティングに十分な期間

#### KMS暗号化

```
KMS暗号化: ❌ 無効（デフォルト）
```

**理由**:
- ログに機密情報は含まれない（ファイルパス、サイズ、転送速度のみ）
- KMS暗号化は追加コスト（$0.03/GB）
- コスト最適化優先

#### ロググループクラス

```
ロググループクラス: Standard（デフォルト）
```

**Standard vs Infrequent Access比較**:

| 項目 | Standard | Infrequent Access |
|------|----------|-------------------|
| データ取り込み | $0.50/GB | $0.50/GB（同じ） |
| ストレージ | $0.03/GB/月 | $0.01/GB/月 |
| データスキャン | 無料 | $0.005/GBスキャン |
| 用途 | 頻繁に分析 | まれに分析 |

**今回の選択**: Standard（月次実行でログ量は少ない、分析頻度は高い）

### Step 3: タグ

```
タグを追加:
  - Key: Project,      Value: CIS-FileSearch
  - Key: Component,    Value: DataSync-Logs
  - Key: Environment,  Value: Production
```

### Step 4: ロググループを作成

```
「ロググループを作成」ボタンをクリック
```

**期待される出力**:
```
✅ ロググループ /aws/datasync/cis-filesearch-sync が作成されました。
ARN: arn:aws:logs:ap-northeast-1:770923989980:log-group:/aws/datasync/cis-filesearch-sync
```

---

## 🔧 Log Group 2: EC2 Worker アプリケーションログ

### アーキテクチャ背景

```
SQS Queue → Auto Scaling Group → EC2 Spot Instances
                                       ↓
                            Python Worker Application
                                       ↓
                            CloudWatch Logs Agent
                                       ↓
                /aws/ec2/cis-filesearch-processor/application
```

EC2インスタンス上で動作するPython Workerアプリケーションのログを収集します：
- **ファイル処理開始/完了ログ**
- **Tesseract OCR実行ログ**
- **Bedrock API呼び出しログ**
- **OpenSearch インデックス登録ログ**
- **エラーログ・例外トレース**

### Step 1: ロググループ作成

```
ロググループ名: /aws/ec2/cis-filesearch-processor/application
保持期間: 30日
KMS暗号化: 無効
ロググループクラス: Standard
タグ:
  - Project: CIS-FileSearch
  - Component: EC2-Worker-Application
  - Environment: Production
```

### Step 2: 作成完了

```
「ロググループを作成」ボタンをクリック
```

**期待される出力**:
```
✅ ロググループ /aws/ec2/cis-filesearch-processor/application が作成されました。
ARN: arn:aws:logs:ap-northeast-1:770923989980:log-group:/aws/ec2/cis-filesearch-processor/application
```

---

## 🔧 Log Group 3: EC2 システムログ

### 目的

EC2インスタンスのシステムレベルログを収集：
- **インスタンス起動/停止ログ**
- **Spot Instance 2分前警告**
- **CloudWatch Agent自体のログ**
- **OS レベルエラー（メモリ不足、ディスク満杯など）**

### Step 1: ロググループ作成

```
ロググループ名: /aws/ec2/cis-filesearch-processor/system
保持期間: 7日（システムログは短期保持で十分）
KMS暗号化: 無効
ロググループクラス: Standard
タグ:
  - Project: CIS-FileSearch
  - Component: EC2-System-Logs
  - Environment: Production
```

### Step 2: 作成完了

```
「ロググループを作成」ボタンをクリック
```

---

## 📦 CloudWatch Agent設定ファイル

EC2インスタンスにCloudWatch Agentをインストールし、アプリケーションログを自動転送します。

### CloudWatch Agent設定JSON

この設定ファイルは**EC2 Launch Template作成時**（後続ガイド）に使用します。

**`/opt/aws/amazon-cloudwatch-agent/etc/cloudwatch-config.json`**:

```json
{
  "agent": {
    "metrics_collection_interval": 60,
    "run_as_user": "root"
  },
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/app/cis-file-processor/logs/application.log",
            "log_group_name": "/aws/ec2/cis-filesearch-processor/application",
            "log_stream_name": "{instance_id}/application",
            "timestamp_format": "%Y-%m-%d %H:%M:%S",
            "timezone": "Asia/Tokyo"
          },
          {
            "file_path": "/var/log/messages",
            "log_group_name": "/aws/ec2/cis-filesearch-processor/system",
            "log_stream_name": "{instance_id}/system",
            "timestamp_format": "%b %d %H:%M:%S"
          },
          {
            "file_path": "/var/log/amazon/amazon-cloudwatch-agent/amazon-cloudwatch-agent.log",
            "log_group_name": "/aws/ec2/cis-filesearch-processor/system",
            "log_stream_name": "{instance_id}/cloudwatch-agent"
          }
        ]
      }
    }
  },
  "metrics": {
    "namespace": "CIS/FileSearch/EC2",
    "metrics_collected": {
      "cpu": {
        "measurement": [
          {
            "name": "cpu_usage_idle",
            "rename": "CPU_IDLE",
            "unit": "Percent"
          },
          "cpu_usage_iowait"
        ],
        "metrics_collection_interval": 60,
        "totalcpu": false
      },
      "disk": {
        "measurement": [
          {
            "name": "used_percent",
            "rename": "DISK_USED",
            "unit": "Percent"
          }
        ],
        "metrics_collection_interval": 60,
        "resources": [
          "*"
        ]
      },
      "mem": {
        "measurement": [
          {
            "name": "mem_used_percent",
            "rename": "MEMORY_USED",
            "unit": "Percent"
          }
        ],
        "metrics_collection_interval": 60
      }
    }
  }
}
```

### 設定の説明

**ログ収集**:
1. `/var/app/cis-file-processor/logs/application.log`: Python Workerアプリケーションログ
2. `/var/log/messages`: Linux システムログ
3. `/var/log/amazon/amazon-cloudwatch-agent/amazon-cloudwatch-agent.log`: Agent自体のログ

**メトリクス収集**:
- CPU使用率（アイドル、I/O待機）
- ディスク使用率
- メモリ使用率

**ログストリーム名**: `{instance_id}` プレースホルダーで各EC2インスタンスを識別

---

## 📈 メトリクスフィルター設定（エラー検知）

CloudWatch Logsからカスタムメトリクスを抽出し、アラート設定に活用します。

### Step 1: DataSyncエラーメトリクス

```
1. ロググループ /aws/datasync/cis-filesearch-sync を開く
2. 「メトリクスフィルター」タブ → 「メトリクスフィルターを作成」
```

#### フィルターパターン

```
フィルターパターン: [time, request_id, level=ERROR*, ...]
```

**説明**: ログ内の`ERROR`レベルメッセージを検出

#### メトリクスの詳細

```
メトリクス名前空間: CIS/FileSearch/DataSync
メトリクス名: DataSyncErrorCount
メトリクス値: 1
デフォルト値: 0（エラーなし）
単位: Count
```

#### メトリクスフィルター名

```
名前: DataSync-Error-Filter
```

**作成完了後**: このメトリクスを使ってCloudWatch Alarmを作成可能

---

### Step 2: EC2 Worker アプリケーションエラーメトリクス

EC2 Pythonアプリケーションのエラーログを検知します。

```
ロググループ: /aws/ec2/cis-filesearch-processor/application
フィルターパターン: [timestamp, level=ERROR*, ...]
メトリクス名前空間: CIS/FileSearch/EC2
メトリクス名: EC2WorkerErrorCount
メトリクス値: 1
デフォルト値: 0
単位: Count
名前: EC2-Worker-Error-Filter
```

### Step 3: Tesseract OCR失敗メトリクス

OCR処理失敗を検知します。

```
ロググループ: /aws/ec2/cis-filesearch-processor/application
フィルターパターン: [timestamp, ..., message="*Tesseract OCR failed*"]
メトリクス名前空間: CIS/FileSearch/EC2
メトリクス名: TesseractOCRFailureCount
メトリクス値: 1
単位: Count
名前: Tesseract-OCR-Failure-Filter
```

### Step 4: Spot Instance中断警告メトリクス

Spot Instance 2分前警告を検知します。

```
ロググループ: /aws/ec2/cis-filesearch-processor/system
フィルターパターン: [timestamp, ..., message="*spot instance interruption*"]
メトリクス名前空間: CIS/FileSearch/EC2
メトリクス名: SpotInterruptionWarningCount
メトリクス値: 1
単位: Count
名前: Spot-Interruption-Warning-Filter
```

---

## 🚨 CloudWatch Alarms設定（オプション）

エラー発生時にメール通知を受け取る設定を行います。

### Step 1: SNSトピック作成

```
1. SNS Console: https://console.aws.amazon.com/sns/
2. 「トピック」→「トピックの作成」
3. タイプ: Standard
4. 名前: CIS-FileSearch-Error-Notifications
5. 「トピックを作成」
```

### Step 2: Eメールサブスクリプション

```
1. 作成したトピックを開く
2. 「サブスクリプションの作成」
3. プロトコル: Eメール
4. エンドポイント: admin@example.com（実際のメールアドレス）
5. 「サブスクリプションの作成」
6. ✉️ 確認メールが届くので、「Confirm subscription」リンクをクリック
```

### Step 3: EC2 Workerエラーアラーム

```
1. CloudWatch Console → アラーム → 「アラームの作成」
2. メトリクスの選択:
   - 名前空間: CIS/FileSearch/EC2
   - メトリクス名: EC2WorkerErrorCount
3. 条件:
   - しきい値タイプ: 静的
   - EC2WorkerErrorCount が次の時: より大きい
   - しきい値: 10（5分間で10エラー以上）
4. 期間: 5分
5. データポイント: 1/1（1データポイントでアラート）
6. アクション:
   - アラーム状態トリガー: アラーム状態
   - SNSトピック: CIS-FileSearch-Error-Notifications
7. アラーム名: CIS-EC2-Worker-Error-Alarm
8. 「アラームの作成」
```

### Step 4: Spot Instance中断アラーム

Spot中断警告を即座に通知します。

```
メトリクス: SpotInterruptionWarningCount
しきい値: 0（1件でもアラート）
期間: 1分
アラーム名: CIS-Spot-Interruption-Warning-Alarm
```

---

## ✅ 作成完了チェックリスト

### AWS CLIで確認

```bash
# DataSync用ロググループ確認
aws logs describe-log-groups \
  --log-group-name-prefix /aws/datasync/cis \
  --profile AdministratorAccess-770923989980 \
  --query 'logGroups[].logGroupName' \
  --output table

# 期待される出力:
# -----------------------------------------------
# |            DescribeLogGroups                |
# +---------------------------------------------+
# |  /aws/datasync/cis-filesearch-sync          |
# +---------------------------------------------+

# EC2用ロググループ確認
aws logs describe-log-groups \
  --log-group-name-prefix /aws/ec2/cis-filesearch-processor \
  --profile AdministratorAccess-770923989980 \
  --query 'logGroups[].logGroupName' \
  --output table

# 期待される出力:
# ---------------------------------------------------------------
# |                    DescribeLogGroups                        |
# +-------------------------------------------------------------+
# |  /aws/ec2/cis-filesearch-processor/application              |
# |  /aws/ec2/cis-filesearch-processor/system                   |
# +-------------------------------------------------------------+
```

### 手動確認（AWS Console）

```
CloudWatch Console → ロググループ で以下を確認:

✅ /aws/datasync/cis-filesearch-sync
   - 保持期間: 30日
   - KMS暗号化: なし
   - メトリクスフィルター: DataSync-Error-Filter

✅ /aws/ec2/cis-filesearch-processor/application
   - 保持期間: 30日
   - メトリクスフィルター: EC2-Worker-Error-Filter, Tesseract-OCR-Failure-Filter

✅ /aws/ec2/cis-filesearch-processor/system
   - 保持期間: 7日
   - メトリクスフィルター: Spot-Interruption-Warning-Filter
```

---

## 📝 ログ情報を記録

`.env`ファイルに以下を追加:

```bash
# /frontend/backend/file-scanner/.env

# CloudWatch Logs
DATASYNC_LOG_GROUP=/aws/datasync/cis-filesearch-sync
EC2_APPLICATION_LOG_GROUP=/aws/ec2/cis-filesearch-processor/application
EC2_SYSTEM_LOG_GROUP=/aws/ec2/cis-filesearch-processor/system

# CloudWatch Logs設定
LOG_RETENTION_DAYS=30
ENABLE_CLOUDWATCH=true
CLOUDWATCH_NAMESPACE=CIS/FileSearch
```

---

## 🔍 ログクエリの例

### DataSync実行ログ検索

#### 成功した転送ログ

```
fields @timestamp, @message
| filter @message like /SUCCESS/
| sort @timestamp desc
| limit 20
```

#### エラーログ検索

```
fields @timestamp, @message
| filter @message like /ERROR/
| sort @timestamp desc
| limit 50
```

#### 転送速度メトリクス

```
fields @timestamp, @message
| filter @message like /BytesTransferred/
| parse @message /BytesTransferred: (?<bytes>\d+)/
| stats sum(bytes) / 1024 / 1024 / 1024 as TotalGB by bin(5m)
```

---

### EC2 Worker アプリケーションログ検索

#### ファイル処理成功ログ

```
fields @timestamp, @message
| filter @message like /File processed successfully/
| parse @message /File: (?<filename>[^\s]+)/
| stats count() by filename
| sort count() desc
```

#### Tesseract OCR実行時間

```
fields @timestamp, @message
| filter @message like /Tesseract OCR completed/
| parse @message /Duration: (?<duration>\d+)ms/
| stats avg(duration) as avg_duration_ms, max(duration) as max_duration_ms, count()
```

#### Bedrock API呼び出しログ

```
fields @timestamp, @message
| filter @message like /Bedrock API call/
| parse @message /Model: (?<model>[^\s]+), Tokens: (?<tokens>\d+)/
| stats sum(tokens) as total_tokens by model
```

#### OpenSearch インデックス登録統計

```
fields @timestamp, @message
| filter @message like /OpenSearch indexed/
| parse @message /Document ID: (?<doc_id>[^\s]+), Size: (?<size>\d+)/
| stats count() as indexed_count, sum(size) / 1024 as total_size_kb
```

#### エラー発生率

```
fields @timestamp, @message
| stats count(@message) as total_logs,
        sum(case when @message like /ERROR/ then 1 else 0 end) as error_count
| eval error_rate = error_count / total_logs * 100
```

---

### EC2 Spot Instance監視クエリ

#### Spot中断警告検知

```
fields @timestamp, @message
| filter @message like /spot instance interruption/
| sort @timestamp desc
| limit 10
```

#### インスタンス起動ログ

```
fields @timestamp, @message
| filter @message like /Instance started/
| parse @message /Instance ID: (?<instance_id>i-[a-z0-9]+)/
| stats count() by instance_id
```

---

## 📊 CloudWatch Insights活用

### Insights クエリの保存

よく使うクエリを保存しておくことで、効率的な分析が可能です。

```
1. CloudWatch Console → Logs Insights
2. ロググループを選択: /aws/ec2/cis-filesearch-processor/application
3. クエリエディタに上記のクエリを入力
4. 「クエリの実行」
5. 「クエリを保存」→ 名前: "EC2 Worker Processing Stats"
```

---

## 💰 コスト見積もり

### CloudWatch Logsコスト（月額）

**データ取り込み**:
- DataSync実行: 月1回、ログ約50MB
- EC2 Worker実行: 月100回処理、ログ約500MB
- EC2 システムログ: 約50MB
- 合計: 600MB/月 × $0.50/GB = **$0.30/月**

**ストレージ（30日保持）**:
- 平均600MB × $0.03/GB/月 = **$0.018/月**

**CloudWatch Insights クエリ**:
- スキャンデータ: 600MB × 20回/月 × $0.005/GB = **$0.006/月**

**CloudWatch Agent メトリクス**:
- カスタムメトリクス: 6メトリクス × $0.30 = **$1.80/月**

**月額合計**: 約**$2.13**

---

## 🐛 トラブルシューティング

### Issue 1: EC2からCloudWatch Logsにログが送信されない

**原因**: IAM Instance Profile権限不足
**対処法**:
```
前セクション「01-iam-roles-setup-guide.md」で作成した
CIS-EC2-FileProcessor-Role に CloudWatch Logs書き込み権限が
含まれているか確認

必要な権限:
- logs:CreateLogGroup
- logs:CreateLogStream
- logs:PutLogEvents
```

### Issue 2: CloudWatch Agentがインストールされていない

**原因**: EC2 Launch Templateに Agent インストールスクリプトがない
**対処法**:
```bash
# 手動インストール（テスト用）
sudo yum install -y amazon-cloudwatch-agent

# 設定ファイル配置
sudo vi /opt/aws/amazon-cloudwatch-agent/etc/cloudwatch-config.json
# （上記のJSON設定を貼り付け）

# Agent起動
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config \
  -m ec2 \
  -s \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/cloudwatch-config.json
```

### Issue 3: ログストリームが作成されない

**原因**: アプリケーションがログファイルに書き込んでいない
**対処法**:
```bash
# EC2にSSHでログイン
ssh ec2-user@<instance-ip>

# アプリケーションログファイル確認
ls -la /var/app/cis-file-processor/logs/application.log

# Pythonアプリケーションが正しくログ出力しているか確認
tail -f /var/app/cis-file-processor/logs/application.log
```

### Issue 4: "Resource not found" エラー

**原因**: ロググループ名のタイポ
**対処法**:
```bash
# 既存ロググループ確認
aws logs describe-log-groups --profile AdministratorAccess-770923989980

# CloudWatch Agent設定ファイルのログループ名を確認
```

---

## 📚 参考資料

- [CloudWatch Logs User Guide](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/)
- [CloudWatch Logs Insights Query Syntax](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html)
- [CloudWatch Agent Configuration Reference](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Agent-Configuration-File-Details.html)
- [EC2 CloudWatch Agent Installation](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/install-CloudWatch-Agent-on-EC2-Instance.html)
- [DataSync CloudWatch Logs](https://docs.aws.amazon.com/datasync/latest/userguide/monitor-datasync.html#cloudwatch-logs)

---

## ✅ 完了確認

- [ ] DataSync用ロググループ作成完了
- [ ] EC2 Applicationロググループ作成完了
- [ ] EC2 Systemロググループ作成完了
- [ ] メトリクスフィルター設定完了（4種類）
- [ ] SNSトピック作成完了（オプション）
- [ ] CloudWatch Alarms設定完了（オプション）
- [ ] ログ情報を `.env` に記録完了
- [ ] AWS CLIでロググループ確認完了

**次のステップ**: EC2 Launch Template作成（CloudWatch Agent設定含む）
