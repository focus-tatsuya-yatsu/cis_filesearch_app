# 🚀 CIS File Search - AWS DataSync完全セットアップガイド

## 📌 このガイドについて

新アーキテクチャ（NAS → DataSync → S3 → EventBridge → SQS → EC2 Spot Instances）でのDataSyncセットアップを、**ステップバイステップ**で解説します。

**想定読者**: AWS DataSyncを初めて使用するエンジニア
**所要時間**: 約3-4時間（NAS情報が準備できている場合）
**前提条件**: AWSコンソールへのアクセス権限、基本的なネットワーク知識

---

## 🏗️ 全体アーキテクチャ

```
[オンプレミス環境]                [AWS Cloud (ap-northeast-1)]
     │                                    │
     ├─ NAS (SMB/NFS)                    ├─ S3 Landing Bucket
     │    ↓                              │    ↓
     ├─ DataSync Agent VM ──────────────→├─ EventBridge
     │   (VMware/Hyper-V)      HTTPS     │    ↓
     │                         Port 443   ├─ SQS Queue
     │                                    │    ↓
     │                                    ├─ EC2 Auto Scaling
     │                                    │   (Spot Instances)
     │                                    │    ↓
     │                                    └─ OpenSearch
```

---

## 📋 セットアップ前の準備

### 必要な情報チェックリスト

#### 1. NAS情報（クライアントから取得）
- [ ] NASのIPアドレスまたはホスト名
- [ ] プロトコル（SMB or NFS）
- [ ] 共有名/エクスポートパス
- [ ] 認証情報（ユーザー名、パスワード、ドメイン）
- [ ] 転送対象ディレクトリのパス

#### 2. ネットワーク情報
- [ ] DataSync Agent用のIPアドレス（静的IP推奨）
- [ ] サブネットマスク
- [ ] デフォルトゲートウェイ
- [ ] DNSサーバーアドレス
- [ ] ファイアウォールでPort 443（HTTPS）が開放されているか

#### 3. 仮想化環境
- [ ] VMware vSphere/ESXi or Hyper-V or KVM
- [ ] CPU: 最低4コア（推奨8コア）
- [ ] メモリ: 最低16GB（推奨32GB）
- [ ] ディスク: 80GB

---

## 🎯 Phase 1: AWS基盤の準備（Week 1）

### Step 1: IAMロール作成

1. **AWSコンソール** → **IAM** → **ロール** → **ロールの作成**

2. **DataSync用のサービスロール**を作成：
```json
ロール名: CIS-DataSync-ServiceRole
信頼関係:
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Service": "datasync.amazonaws.com"
    },
    "Action": "sts:AssumeRole"
  }]
}
```

3. **アタッチするポリシー**:
```json
ポリシー名: CIS-DataSync-S3Access
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3BucketAccess",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": "arn:aws:s3:::cis-filesearch-landing"
    },
    {
      "Sid": "S3ObjectAccess",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl",
        "s3:GetObject",
        "s3:GetObjectAcl",
        "s3:GetObjectVersion"
      ],
      "Resource": "arn:aws:s3:::cis-filesearch-landing/*"
    }
  ]
}
```

### Step 2: S3バケット作成

1. **S3コンソール** → **バケットを作成**

2. **設定内容**:
```yaml
バケット名: cis-filesearch-landing
リージョン: ap-northeast-1 (東京)
バケットバージョニング: 無効（NASが真実の源）
暗号化: 有効（SSE-S3）
パブリックアクセス: すべてブロック
```

3. **EventBridge通知を有効化**:
```
プロパティ → Event notifications → Amazon EventBridge → On
```

### Step 3: EventBridge → SQS設定

1. **EventBridgeルール作成**:
```json
ルール名: CIS-S3-to-SQS
イベントパターン:
{
  "source": ["aws.s3"],
  "detail-type": ["Object Created"],
  "detail": {
    "bucket": {
      "name": ["cis-filesearch-landing"]
    }
  }
}
ターゲット: SQSキュー（CIS-FileProcessing-Queue）
```

2. **SQSキュー作成**:
```yaml
キュー名: CIS-FileProcessing-Queue
タイプ: Standard
可視性タイムアウト: 300秒（5分）
メッセージ保持期間: 14日
デッドレターキュー: 設定（最大受信数: 3）
```

---

## 🖥️ Phase 2: DataSync Agent設定（Week 2）

### Step 4: DataSync Agent VMデプロイ

#### VMware ESXiの場合:

1. **OVAファイルダウンロード**:
```bash
# AWSコンソールから取得したURLを使用
wget https://datasync-[region].amazonaws.com/datasync-[version].ova
```

2. **vSphereでOVAデプロイ**:
```
vSphere Client → ファイル → OVFテンプレートのデプロイ
- 名前: CIS-DataSync-Agent-01
- データストア: 高速ストレージ推奨
- ネットワーク: 管理ネットワーク
```

3. **VM設定変更**:
```yaml
CPU: 8 vCPU
メモリ: 32 GB
ネットワークアダプタ: VMXNET3
ディスク: Thin Provisioning
```

### Step 5: Agent初期設定

1. **VMコンソール接続**して初期設定:
```bash
# ログイン（初回）
Username: admin
Password: password

# ネットワーク設定
1. Get network configuration
2. Set network configuration
   - 静的IPアドレス: 192.168.1.50
   - サブネットマスク: 255.255.255.0
   - ゲートウェイ: 192.168.1.1
   - DNS: 8.8.8.8, 8.8.4.4

# パスワード変更
3. Set gateway password
   新しいパスワード: [セキュアなパスワード]

# NTPサーバー設定（重要）
4. Test network connectivity
   ntp.nict.jp （日本標準時）
```

2. **接続テスト**:
```bash
# AWSエンドポイントへの接続確認
Test connectivity to AWS
→ "SUCCESS" が表示されることを確認
```

### Step 6: Agent Activation

1. **AWSコンソール** → **DataSync** → **Agents** → **Create agent**

2. **Activation設定**:
```yaml
Service endpoint: Public service endpoints in ap-northeast-1
Activation key取得方法:
  1. ブラウザで http://[Agent-IP]/ にアクセス
  2. AWSリージョン選択: ap-northeast-1
  3. Activation keyが自動生成される
```

3. **Agent名設定**:
```
Name: CIS-DataSync-Agent-Production
Tags:
  - Environment: Production
  - Purpose: NAS-to-S3-Sync
```

---

## 📂 Phase 3: Location & Task設定（Week 3）

### Step 7: Source Location作成（NAS）

#### SMBの場合:
```yaml
AWSコンソール → DataSync → Locations → Create location

Location type: Server Message Block (SMB)
Agents: CIS-DataSync-Agent-Production
SMB Server: 192.168.1.100
Share name: SharedDocuments
Subdirectory: /ProductionData （オプション）

User settings:
  Domain: COMPANY
  User: datasync_user
  Password: [AWS Secrets Manager推奨]

Mount options:
  SMB version: SMB3 (推奨)
```

#### NFSの場合:
```yaml
Location type: Network File System (NFS)
Agents: CIS-DataSync-Agent-Production
NFS Server: 192.168.1.100
Mount path: /exports/shared

Mount options:
  NFS version: NFS4 (推奨)
```

### Step 8: Destination Location作成（S3）

```yaml
Location type: Amazon S3
S3 bucket: cis-filesearch-landing
S3 storage class: Standard
Folder: / （ルート）
IAM role: CIS-DataSync-ServiceRole
```

### Step 9: Task作成と設定

1. **基本設定**:
```yaml
Task name: CIS-NAS-to-S3-Sync
Source location: [Step 7で作成したLocation]
Destination location: [Step 8で作成したLocation]
```

2. **データ転送設定**:
```yaml
Configure settings → Data transfer configuration:

Verify data:
  ☑ Verify only the data transferred（推奨）

Transfer mode:
  ☑ Transfer only data that has changed（増分転送）

Preserve deleted files:
  ☐ Keep deleted files（チェックを外す）

Overwrite files:
  ☑ Always（常に上書き）

Bandwidth limit:
  No limit（初回）/ 100 MB/s（業務時間中）
```

3. **フィルタリング設定**（コスト削減）:
```yaml
Filtering rules → Exclude patterns:
/**/*.mp4
/**/*.avi
/**/*.mov
/**/*.iso
/**/*.bak
/**/~$*
/**/.DS_Store
/**/Thumbs.db
/Backup/*
/.Trash/*
```

4. **スケジュール設定**:
```yaml
Schedule → Create new schedule:

Schedule name: Monthly-Sync
Frequency: Monthly
Day: 1日
Time: 02:00 JST
```

---

## 🚀 Phase 4: 初回同期実行（Week 4）

### Step 10: 小規模テスト実行

1. **テスト用フィルター設定**（一時的）:
```yaml
Include patterns:
/TestFolder/*  # 100MB程度のテストフォルダのみ
```

2. **手動実行**:
```
Task → CIS-NAS-to-S3-Sync → Start → Start with defaults
```

3. **監視**:
```
Execution status → View details
- Files transferred
- Data transferred
- Average throughput
- Errors
```

### Step 11: フル同期実行

1. **事前確認**:
```bash
# EC2 Auto Scaling準備確認
aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names CIS-FileProcessor-ASG

# SQSキュー確認
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/[ACCOUNT]/CIS-FileProcessing-Queue \
  --attribute-names All
```

2. **フィルター解除**してフル実行:
```yaml
Include patterns: （削除）
Exclude patterns: （Step 9の設定を維持）

開始時刻: 金曜日 18:00（週末実行）
```

3. **実行監視**:
```yaml
CloudWatch Metrics:
- BytesTransferred
- FilesTransferred
- FilesVerified
- FilesPrepared

アラート設定:
- 転送速度 < 100 Mbps が15分継続
- エラー率 > 1%
```

---

## 📊 Phase 5: 監視と最適化（Week 5）

### Step 12: CloudWatch Dashboard作成

```json
{
  "name": "CIS-DataSync-Monitoring",
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "title": "Transfer Performance",
        "metrics": [
          ["AWS/DataSync", "BytesTransferred", {"stat": "Sum"}],
          [".", "FilesTransferred", {"stat": "Sum"}],
          [".", "BytesPrepared", {"stat": "Average"}],
          [".", "BytesVerified", {"stat": "Average"}]
        ]
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "Task Execution",
        "metrics": [
          ["AWS/DataSync", "TaskExecutionTime"],
          [".", "FilesSkipped"],
          [".", "FilesFailed"]
        ]
      }
    }
  ]
}
```

### Step 13: パフォーマンス最適化

#### ネットワーク最適化:
```bash
# Agent VMでMTU最適化（Jumbo Frame）
sudo ip link set dev eth0 mtu 9000

# TCP最適化
sudo sysctl -w net.ipv4.tcp_window_scaling=1
sudo sysctl -w net.core.rmem_max=134217728
sudo sysctl -w net.core.wmem_max=134217728
```

#### 並列転送最適化:
```yaml
Agent VMリソース:
  vCPU: 4 → 8
  Memory: 16GB → 32GB

DataSync並列度:
  デフォルト: 10ファイル
  最適化後: 16-20ファイル
```

---

## 🔒 セキュリティ対策（必須）

### Step 14: 認証情報の保護

1. **AWS Secrets Manager使用**:
```bash
# NAS認証情報をSecrets Managerに保存
aws secretsmanager create-secret \
  --name cis-filesearch/nas-credentials \
  --secret-string '{
    "username":"datasync_user",
    "password":"SecurePassword123!",
    "domain":"COMPANY"
  }'
```

2. **S3バケットポリシーでTLS強制**:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyInsecureTransport",
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:*",
    "Resource": [
      "arn:aws:s3:::cis-filesearch-landing/*"
    ],
    "Condition": {
      "Bool": {
        "aws:SecureTransport": "false"
      }
    }
  }]
}
```

3. **IAM最小権限の原則**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl"
      ],
      "Resource": "arn:aws:s3:::cis-filesearch-landing/*"
    },
    {
      "Effect": "Deny",
      "Action": [
        "s3:DeleteBucket",
        "s3:DeleteObject"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## 💰 コスト見積もり

### 初期費用:
```yaml
DataSync Agent: $0（ソフトウェア無料）
初回転送（10TB）: $125
S3ストレージ（10TB）: $256/月
```

### 月次運用費:
```yaml
DataSync転送（500GB）: $6.25
S3ストレージ増分: $12.80
EC2処理コスト: $36（Spot Instance）
合計: 約$55/月
```

### コスト削減のヒント:
1. **不要ファイル除外**: 動画、バックアップ除外で25%削減
2. **S3ライフサイクル**: 90日後にIA移行で40%削減
3. **転送スケジュール**: オフピーク時実行で帯域幅コスト削減

---

## 🔍 トラブルシューティング

### よくある問題と対処法

#### 1. Agent Activationが失敗
```bash
原因: ファイアウォールでPort 443がブロック
対処:
  - ファイアウォール設定確認
  - curl https://datasync-ap-northeast-1.amazonaws.com でテスト
```

#### 2. NAS接続エラー
```bash
原因: 認証情報の誤りまたは権限不足
対処:
  - Agentサーバーから手動でNASマウントテスト
  - mount -t cifs //192.168.1.100/share /mnt/test -o user=xxx
```

#### 3. 転送速度が遅い（<100 Mbps）
```bash
原因: ネットワーク設定またはリソース不足
対処:
  - MTU値確認（9000推奨）
  - Agent VMのCPU/メモリ増強
  - 並列転送数の調整
```

#### 4. S3イベントがSQSに届かない
```bash
原因: EventBridge設定ミス
対処:
  - S3バケットでEventBridge通知が有効か確認
  - EventBridgeルールのイベントパターン確認
  - SQSキューのアクセス権限確認
```

---

## ✅ 最終チェックリスト

### DataSync設定完了確認:
- [ ] Agent VMが正常稼働している
- [ ] AgentがAWSに登録されている
- [ ] Source Location（NAS）が作成されている
- [ ] Destination Location（S3）が作成されている
- [ ] Taskが作成され、テスト実行が成功している
- [ ] スケジュールが設定されている

### セキュリティ確認:
- [ ] NAS認証情報がSecrets Managerで保護されている
- [ ] S3バケットでTLSが強制されている
- [ ] IAMロールが最小権限になっている
- [ ] CloudTrailで監査ログが有効

### 監視確認:
- [ ] CloudWatch Dashboardが作成されている
- [ ] 異常検知アラートが設定されている
- [ ] SNS通知が設定されている

### パフォーマンス確認:
- [ ] 転送速度が400 Mbps以上
- [ ] エラー率が0.1%以下
- [ ] 初回同期が48時間以内に完了

---

## 📚 関連ドキュメント

- [01-iam-roles-setup-guide.md](./01-iam-roles-setup-guide.md) - IAM詳細設定
- [02-s3-bucket-setup-guide.md](./02-s3-bucket-setup-guide.md) - S3詳細設定
- [03-cloudwatch-logs-setup-guide.md](./03-cloudwatch-logs-setup-guide.md) - ログ設定
- [04-datasync-agent-installation-guide.md](./04-datasync-agent-installation-guide.md) - Agent詳細
- [05-datasync-location-task-configuration-guide.md](./05-datasync-location-task-configuration-guide.md) - Location/Task詳細
- [06-datasync-monitoring-optimization-guide.md](./06-datasync-monitoring-optimization-guide.md) - 監視と最適化

---

## 🎯 次のステップ

1. **Week 1**: AWS基盤構築（IAM、S3、EventBridge、SQS）
2. **Week 2**: DataSync Agent設定
3. **Week 3**: Location & Task設定、小規模テスト
4. **Week 4**: 初回フル同期（週末実行）
5. **Week 5**: 監視設定と最適化
6. **Week 6**: 月次自動実行開始

## 📧 サポート

問題が発生した場合は、以下の情報を準備してサポートに連絡してください：

- Task実行ARN
- エラーメッセージの全文
- CloudWatch Logsのスクリーンショット
- ネットワーク構成図

---

**最終更新日**: 2025年1月17日
**バージョン**: 1.0
**作成者**: CIS File Search DevOpsチーム