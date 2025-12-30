# 🚨 緊急デプロイ手順: SQS無限ループ修正

## 問題概要
- **状況**: 本番環境で58,524メッセージのSQS無限ループ発生
- **原因**: worker.py lines 336-349のメッセージ削除ロジック欠陥
- **影響**: メッセージが処理後もキューに残り続ける
- **修正**: worker_fixed.py で修正済み（必ず削除する実装）

## デプロイ方式: User Data + S3（推奨）

### 前提条件
- AWS CLI設定済み
- IAMロールに以下の権限が必要:
  - s3:PutObject (worker用S3バケット)
  - ec2:CreateLaunchTemplateVersion
  - ec2:ModifyLaunchTemplate
  - autoscaling:UpdateAutoScalingGroup
  - ec2:TerminateInstances

### 実装時間: 15-20分

---

## ステップ1: AWS認証情報更新（期限切れの場合）

```bash
# AWSトークンが期限切れの場合、再ログイン
aws sts get-caller-identity
# エラーなら、aws configure または SSO再認証
```

---

## ステップ2: S3に修正版Workerをアップロード (2分)

```bash
# S3バケット名を確認（既存のworker設定から）
export S3_BUCKET="cis-filesearch-worker-scripts"  # 環境に応じて変更
export REGION="ap-northeast-1"

# worker_fixed.py を S3にアップロード
aws s3 cp /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker/worker_fixed.py \
  s3://${S3_BUCKET}/scripts/worker.py \
  --region ${REGION}

# アップロード確認
aws s3 ls s3://${S3_BUCKET}/scripts/
```

**重要**: S3キーは `scripts/worker.py` として、既存のworker.pyと同じパスに配置

---

## ステップ3: 現在のLaunch Template情報取得 (1分)

```bash
# 現在のUserDataを確認
aws ec2 describe-launch-template-versions \
  --launch-template-name cis-filesearch-worker-template \
  --versions '$Latest' \
  --query 'LaunchTemplateVersions[0].LaunchTemplateData.UserData' \
  --output text | base64 -d > current_userdata.txt

# 内容確認
cat current_userdata.txt
```

---

## ステップ4: 新しいUser Dataスクリプト作成 (3分)

以下の内容で `new_userdata.sh` を作成:

```bash
#!/bin/bash
set -e
set -x

# ログ設定
exec > >(tee /var/log/user-data.log)
exec 2>&1

echo "=== User Data Script Started at $(date) ==="

# 環境変数（必要に応じて調整）
export REGION="ap-northeast-1"
export S3_BUCKET="cis-filesearch-worker-scripts"
export SQS_QUEUE_URL="<実際のキューURL>"  # 後で設定
export DLQ_QUEUE_URL="<実際のDLQ URL>"  # 後で設定
export OPENSEARCH_ENDPOINT="<実際のエンドポイント>"  # 後で設定

# 必要なパッケージインストール
yum update -y
yum install -y python3 python3-pip

# Pythonパッケージインストール
pip3 install boto3 opensearch-py requests

# 作業ディレクトリ作成
mkdir -p /opt/worker
cd /opt/worker

# S3から最新のworker.pyをダウンロード
aws s3 cp s3://${S3_BUCKET}/scripts/worker.py /opt/worker/worker.py --region ${REGION}

# 他の必要なファイルもダウンロード（config.py, file_router.py等）
aws s3 cp s3://${S3_BUCKET}/scripts/config.py /opt/worker/config.py --region ${REGION}
aws s3 cp s3://${S3_BUCKET}/scripts/file_router.py /opt/worker/file_router.py --region ${REGION}
aws s3 cp s3://${S3_BUCKET}/scripts/opensearch_client.py /opt/worker/opensearch_client.py --region ${REGION}

# 実行権限付与
chmod +x /opt/worker/worker.py

# Systemdサービス作成
cat <<'EOF' > /etc/systemd/system/worker.service
[Unit]
Description=File Processing Worker
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/worker
ExecStart=/usr/bin/python3 /opt/worker/worker.py
Restart=always
RestartSec=10
Environment="AWS_REGION=ap-northeast-1"
Environment="SQS_QUEUE_URL=<実際のキューURL>"
Environment="DLQ_QUEUE_URL=<実際のDLQ URL>"
Environment="OPENSEARCH_ENDPOINT=<実際のエンドポイント>"

[Install]
WantedBy=multi-user.target
EOF

# サービス起動
systemctl daemon-reload
systemctl enable worker.service
systemctl start worker.service

echo "=== User Data Script Completed at $(date) ==="
```

**注意**: 上記の環境変数（SQS_QUEUE_URL等）は実際の値に置き換える必要があります。

---

## ステップ5: 環境変数の取得（既存設定から） (2分)

```bash
# 既存インスタンスの環境変数を確認（可能であれば）
# または、AWS Systems Manager Parameter Storeから取得

# SQSキューURL取得
aws sqs list-queues --queue-name-prefix file-processing-queue

# DLQ URL取得
aws sqs list-queues --queue-name-prefix file-processing-dlq

# OpenSearchエンドポイント取得
aws opensearch describe-domain --domain-name cis-filesearch \
  --query 'DomainStatus.Endpoint' --output text
```

取得した値を `new_userdata.sh` に反映してください。

---

## ステップ6: 必要な依存ファイルをS3にアップロード (3分)

worker.pyは他のPythonモジュールに依存しているため、それらもS3にアップロード:

```bash
# 依存ファイルの確認
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker

# 全ての.pyファイルをS3にアップロード
for file in config.py file_router.py opensearch_client.py; do
  aws s3 cp $file s3://${S3_BUCKET}/scripts/$file --region ${REGION}
done

# アップロード確認
aws s3 ls s3://${S3_BUCKET}/scripts/
```

---

## ステップ7: 新しいLaunch Templateバージョン作成 (2分)

```bash
# UserDataをBase64エンコード
export USER_DATA_BASE64=$(base64 -i new_userdata.sh)

# 新しいバージョン作成
aws ec2 create-launch-template-version \
  --launch-template-name cis-filesearch-worker-template \
  --source-version '$Latest' \
  --launch-template-data "{\"UserData\":\"${USER_DATA_BASE64}\"}" \
  --region ${REGION}

# 作成されたバージョン番号を確認
aws ec2 describe-launch-template-versions \
  --launch-template-name cis-filesearch-worker-template \
  --query 'LaunchTemplateVersions[0].VersionNumber' \
  --output text
```

---

## ステップ8: Launch Templateのデフォルトバージョン更新 (1分)

```bash
# 新しいバージョンをデフォルトに設定
export NEW_VERSION=$(aws ec2 describe-launch-template-versions \
  --launch-template-name cis-filesearch-worker-template \
  --query 'LaunchTemplateVersions[0].VersionNumber' \
  --output text)

aws ec2 modify-launch-template \
  --launch-template-name cis-filesearch-worker-template \
  --default-version ${NEW_VERSION} \
  --region ${REGION}
```

---

## ステップ9: 既存インスタンスの終了 (1分)

```bash
# 既存インスタンスを終了（Auto Scalingが新しいインスタンスを起動）
aws autoscaling terminate-instance-in-auto-scaling-group \
  --instance-id i-01343f804e6b0a7e6 \
  --should-decrement-desired-capacity false \
  --region ${REGION}

echo "インスタンス終了リクエスト送信完了"
echo "Auto Scalingが新しいインスタンスを起動します（約2-3分）"
```

---

## ステップ10: 新インスタンスの起動確認 (3分)

```bash
# 新しいインスタンスの起動を監視
watch -n 10 'aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names cis-filesearch-ec2-autoscaling \
  --query "AutoScalingGroups[0].Instances[*].[InstanceId,LifecycleState,HealthStatus]" \
  --output table'

# Ctrl+Cで終了

# インスタンスIDを取得
export NEW_INSTANCE_ID=$(aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names cis-filesearch-ec2-autoscaling \
  --query 'AutoScalingGroups[0].Instances[0].InstanceId' \
  --output text)

echo "新しいインスタンス: ${NEW_INSTANCE_ID}"
```

---

## ステップ11: Workerの動作確認 (2分)

```bash
# CloudWatch Logsでworkerログを確認
aws logs tail /aws/ec2/worker --follow --region ${REGION}

# または、User Dataログを確認
aws ec2 get-console-output --instance-id ${NEW_INSTANCE_ID} \
  --query 'Output' --output text | grep -A 20 "User Data Script"
```

---

## ステップ12: SQSメッセージ数の監視 (継続的)

```bash
# メッセージ数の推移を監視
while true; do
  QUEUE_URL=$(aws sqs list-queues --queue-name-prefix file-processing-queue --query 'QueueUrls[0]' --output text)

  aws sqs get-queue-attributes \
    --queue-url ${QUEUE_URL} \
    --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
    --query 'Attributes' \
    --output table

  sleep 30
done
```

**期待される動作**:
- メッセージ数が徐々に減少していく
- 処理済みメッセージが確実に削除される
- DLQにエラーメッセージが適切に送信される

---

## ロールバック手順（問題発生時）

```bash
# 以前のLaunch Templateバージョンに戻す
aws ec2 modify-launch-template \
  --launch-template-name cis-filesearch-worker-template \
  --default-version <前のバージョン番号> \
  --region ${REGION}

# 現在のインスタンスを終了（前のバージョンで起動）
aws autoscaling terminate-instance-in-auto-scaling-group \
  --instance-id ${NEW_INSTANCE_ID} \
  --should-decrement-desired-capacity false \
  --region ${REGION}
```

---

## リスク評価

### 高リスク
- ❌ なし

### 中リスク
- ⚠️ **UserData内の環境変数設定ミス**: 事前に値を確認することで軽減
- ⚠️ **依存ファイルの不足**: 全ての.pyファイルをS3にアップロードすることで軽減

### 低リスク
- ℹ️ **一時的なダウンタイム**: Auto Scalingにより2-3分で新インスタンス起動
- ℹ️ **S3アクセス権限不足**: 事前にIAMロール確認で軽減

---

## 緊急時の連絡先

- **AWS Support**: [サポートケース作成]
- **CloudWatch Alarms**: SQSメッセージ数急増アラート設定推奨

---

## 補足: 代替案との比較

| 方式 | 実装時間 | リスク | 再現性 | SSH/SSM必要 |
|------|---------|--------|--------|------------|
| **A: UserData+S3** | 15-20分 | 低 | 高 | 不要 |
| B: AMI再作成 | 60分+ | 中 | 中 | 必要 |
| C: 手動AMI作成 | 90分+ | 高 | 低 | 必要 |

**結論**: Option A（UserData+S3）が最適解

---

## チェックリスト

- [ ] AWS認証情報が有効
- [ ] S3バケット名確認
- [ ] SQS Queue URL取得
- [ ] DLQ URL取得
- [ ] OpenSearchエンドポイント取得
- [ ] worker_fixed.py → S3アップロード
- [ ] 依存ファイル（config.py等）→ S3アップロード
- [ ] new_userdata.sh作成（環境変数設定済み）
- [ ] Launch Template新バージョン作成
- [ ] デフォルトバージョン更新
- [ ] 既存インスタンス終了
- [ ] 新インスタンス起動確認
- [ ] Workerログ確認
- [ ] SQSメッセージ数減少確認

---

**作成日**: 2025-12-13
**緊急度**: 🔴 最高
**想定実施時間**: 15-20分
