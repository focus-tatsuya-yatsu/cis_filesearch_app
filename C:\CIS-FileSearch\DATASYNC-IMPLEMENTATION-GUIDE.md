# 🚀 DataSync + EC2 アーキテクチャ実装ガイド

## 📋 概要

このガイドは、NASからAWSへのファイル転送（DataSync）とEC2での処理を実装するための完全なステップバイステップガイドです。

```
[NAS 8TB] → [DataSync] → [S3 Landing] → [EventBridge] → [SQS] → [EC2 Auto Scaling] → [S3 Processed] → [OpenSearch]
```

---

## 🎯 実装チェックリスト

### Phase 1: スキャナーPC設定 ✅
- [x] DataSync設定スクリプト作成
- [x] ファイル監視スクリプト作成
- [x] Windows Service設定

### Phase 2: AWS基盤構築 ✅
- [x] S3バケット作成スクリプト
- [x] EventBridge設定
- [x] SQSキュー設定

### Phase 3: EC2処理環境 ✅
- [x] EC2 User Dataスクリプト
- [x] AMI作成ガイド
- [x] Auto Scaling設定

### Phase 4: 統合とテスト
- [ ] エンドツーエンドテスト
- [ ] パフォーマンスチューニング
- [ ] 監視ダッシュボード確認

---

## 🔧 ステップバイステップ実装

### Step 1: スキャナーPC準備（ローカル）

```powershell
# 1. DataSync Agent設定を実行
.\setup-datasync-scanner.ps1

# 2. 設定確認
C:\DataSyncAgent\test-setup.ps1

# 3. 結果確認
✓ NAS接続確認
✓ AWS認証情報確認
✓ 設定ファイル確認
```

### Step 2: S3とEventBridge設定（AWS CloudShell）

```bash
# 1. AWS CloudShellを開く
# 2. スクリプトを実行
chmod +x aws-s3-eventbridge-setup.sh
./aws-s3-eventbridge-setup.sh

# 3. 作成されるリソース
✓ S3 Landing Bucket: cis-filesearch-landing-bucket
✓ S3 Processed Bucket: cis-filesearch-processed-bucket
✓ SQS Queue: cis-file-processing-queue
✓ EventBridge Rule: cis-file-upload-rule
```

### Step 3: DataSync Agent デプロイ

#### Option A: EC2 Agent（推奨）
```bash
# 1. EC2インスタンス起動
aws ec2 run-instances \
    --image-id ami-xxxxx \  # DataSync Agent AMI
    --instance-type m5.xlarge \
    --subnet-id subnet-xxxxx \
    --security-group-ids sg-xxxxx

# 2. Agent activation
# ブラウザで: http://<agent-ip>/
# Activation keyを取得してペースト
```

#### Option B: VMware Agent
```
1. OVAファイルダウンロード
2. VMware環境にデプロイ
3. ネットワーク設定
4. Activation実行
```

### Step 4: EC2 AMI作成（DocuWorks入り）

```powershell
# 1. Windows Server 2022インスタンス起動
# 2. RDP接続
# 3. 以下を実行

# DocuWorks 10インストール（ライセンス使用）
# その後、User Dataスクリプト実行
.\ec2-userdata.ps1

# 4. AMI作成
aws ec2 create-image \
    --instance-id i-xxxxx \
    --name "CIS-FileProcessor-DocuWorks-v1"
```

### Step 5: Auto Scaling設定

```bash
# 1. 設定ファイル編集
vi setup-autoscaling.sh
# AMI_ID, VPC_ID, SUBNET_IDS を設定

# 2. スクリプト実行
chmod +x setup-autoscaling.sh
./setup-autoscaling.sh

# 3. 確認
✓ Launch Template作成
✓ Auto Scaling Group作成
✓ スケーリングポリシー設定
```

### Step 6: DataSyncタスク作成

```bash
# 1. AWS Console → DataSync
# 2. Create task
# 3. 設定:
Source: SMB Location (NAS)
Destination: S3 Landing Bucket
Schedule: Every 15 minutes
Options:
  - Transfer mode: Changed files only
  - Verify: Only files transferred
  - Preserve: Modification time

# 4. タスク実行確認
aws datasync start-task-execution \
    --task-arn arn:aws:datasync:region:account:task/task-xxxxx
```

---

## 🧪 テスト手順

### 1. 単体テスト

```powershell
# スキャナーPC側
C:\DataSyncAgent\test-setup.ps1

# S3アップロードテスト
.\test-s3-upload.ps1 -FileCount 5
```

### 2. 統合テスト

```bash
# SQSメッセージ確認
aws sqs receive-message \
    --queue-url https://sqs.region.amazonaws.com/account/queue-name \
    --max-number-of-messages 10

# EC2処理ログ確認
aws logs tail /aws/ec2/file-processor --follow
```

### 3. 負荷テスト

```powershell
# 大量ファイルアップロード
.\test-s3-upload.ps1 -FileCount 1000

# Auto Scalingの動作確認
# CloudWatch Dashboard: CISAutoScaling
```

---

## 📊 監視とトラブルシューティング

### CloudWatchダッシュボード

1. **CISFileProcessing** - S3とSQSメトリクス
2. **CISAutoScaling** - EC2 Auto Scalingメトリクス

### 主要メトリクス

| メトリクス | 閾値 | アクション |
|-----------|------|-----------|
| SQS Queue Depth | > 1000 | Scale out +3 instances |
| CPU Utilization | > 70% | Scale out +1 instance |
| Processing Errors | > 10/min | Alert notification |
| DataSync Transfer Rate | < 10MB/s | Check network |

### トラブルシューティング

#### DataSyncが動作しない
```bash
# Agent状態確認
aws datasync list-agents

# タスク実行履歴
aws datasync list-task-executions \
    --task-arn arn:aws:datasync:region:account:task/task-xxxxx
```

#### EC2がSQSメッセージを処理しない
```powershell
# Windows Service確認
Get-Service CISFileProcessor

# ログ確認
Get-Content C:\FileProcessor\logs\processor.log -Tail 50
```

#### Auto Scalingが動作しない
```bash
# スケーリングアクティビティ確認
aws autoscaling describe-scaling-activities \
    --auto-scaling-group-name CISFileProcessorASG

# ポリシー確認
aws autoscaling describe-policies \
    --auto-scaling-group-name CISFileProcessorASG
```

---

## 💰 コスト最適化

### 推定月額コスト

| リソース | 規模 | 月額コスト |
|---------|------|-----------|
| DataSync | 100GB/日 | $12.50 |
| S3 Landing | 1TB | $23 |
| S3 Processed | 200GB | $4.60 |
| EC2 (m5.xlarge) | 2-10台 | $400-2000 |
| Data Transfer | 3TB/月 | $270 |
| **合計** | | **$710-2310** |

### コスト削減策

1. **EC2 Spot Instances** - 最大70%削減
2. **S3 Intelligent Tiering** - 自動的に安価なストレージクラスへ移行
3. **Reserved Instances** - 長期利用で最大40%削減
4. **夜間/週末のAuto Scaling調整** - 最小インスタンス数を減らす

---

## 🎯 次のステップ

1. **OpenSearch設定**
   - インデックス設計
   - 検索API実装
   - フロントエンド統合

2. **セキュリティ強化**
   - VPCエンドポイント設定
   - IAMロールの最小権限化
   - データ暗号化設定

3. **パフォーマンスチューニング**
   - DataSync並列度調整
   - EC2インスタンスタイプ最適化
   - SQSバッチサイズ調整

---

## 📞 サポート情報

- AWS DataSync: https://docs.aws.amazon.com/datasync/
- EC2 Auto Scaling: https://docs.aws.amazon.com/autoscaling/
- CloudWatch Logs: /aws/datasync, /aws/ec2/file-processor
- サポートケース: AWS Console → Support Center

---

## ✅ 完了確認

すべての設定が完了したら、以下を確認：

- [ ] DataSync Agentがアクティブ
- [ ] DataSyncタスクがスケジュール実行中
- [ ] S3へのファイルアップロード確認
- [ ] SQSにメッセージが届いている
- [ ] EC2インスタンスが処理を開始
- [ ] 処理済みファイルがS3に保存
- [ ] CloudWatchダッシュボードでメトリクス確認
- [ ] Auto Scalingが正常動作

すべて確認できたら、本番運用開始です！🎉