# Week 1 完了チェックリスト - DataSync + EC2実装

**作成日**: 2025-01-12（2025-01-14更新）
**期間**: Week 1 Day 1-5（5営業日）
**目標**: NAS情報不要タスクの完了、DataSync基礎学習、EC2インフラ構築着手

---

## 📊 Week 1 進捗サマリー

| カテゴリ | 完了 / 総数 | 進捗率 |
|---------|------------|--------|
| AWS基盤構築 | 0 / 3 | 0% |
| ドキュメント作成 | 7 / 7 | 100% |
| DataSync学習 | 0 / 1 | 0% |
| EC2インフラ設計 | 0 / 3 | 0% |
| プロジェクト管理 | 0 / 2 | 0% |

**全体進捗**: 7 / 16タスク = **43.8%**

---

## ✅ Day 1-2: AWS基盤構築 + ドキュメント整備

### AWS基盤構築（3タスク）

#### 1. IAM Roles作成 ⏳

**ステータス**: 🟡 ガイド更新完了（EC2対応）、Console操作待ち

**完了条件**:
- [ ] `CIS-DataSync-Task-Execution-Role` 作成完了
- [ ] **`CIS-EC2-FileProcessor-Role` 作成完了（Lambda用ではない！）**
- [ ] `CIS-DataSync-Agent-Activation-Role` 作成完了
- [ ] 3つのRole ARNを`.env`に記録

**重要変更**: Lambda Execution Roleを削除し、EC2 Instance Profileを作成

**ガイド**: `/docs/deployment/datasync/01-iam-roles-setup-guide.md`（2025-01-14更新済み）

**検証コマンド**:
```bash
aws iam list-roles --profile AdministratorAccess-770923989980 \
  --query 'Roles[?starts_with(RoleName, `CIS-DataSync`) || starts_with(RoleName, `CIS-EC2`)].{Name:RoleName,ARN:Arn}' \
  --output table
```

**期待される出力**:
- CIS-DataSync-Task-Execution-Role
- **CIS-EC2-FileProcessor-Role**（Lambda用ではない）
- CIS-DataSync-Agent-Activation-Role

---

#### 2. S3 Bucket作成 ⏳

**ステータス**: 🟡 ガイド作成完了、Console操作待ち

**完了条件**:
- [ ] バケット `cis-filesearch-raw-files-prod` 作成完了
- [ ] **バージョニング無効化確認（ファイルは処理後削除するため不要）**
- [ ] 暗号化設定（SSE-S3）確認
- [ ] EventBridge統合有効化（S3 Event NotificationではなくEventBridge経由）
- [ ] バケットポリシー設定完了
- [ ] Intelligent-Tiering設定完了
- [ ] ライフサイクルルール設定完了
- [ ] テストアップロード成功

**ガイド**: `/docs/deployment/datasync/02-s3-bucket-setup-guide.md`

**検証コマンド**:
```bash
# バケット存在確認
aws s3 ls s3://cis-filesearch-raw-files-prod --profile AdministratorAccess-770923989980

# バージョニング確認（Disabled期待）
aws s3api get-bucket-versioning --bucket cis-filesearch-raw-files-prod --profile AdministratorAccess-770923989980

# 暗号化確認
aws s3api get-bucket-encryption --bucket cis-filesearch-raw-files-prod --profile AdministratorAccess-770923989980

# EventBridge統合確認
aws s3api get-bucket-notification-configuration --bucket cis-filesearch-raw-files-prod --profile AdministratorAccess-770923989980
```

---

#### 3. CloudWatch Logs設定 ⏳

**ステータス**: 🟡 ガイド更新完了（EC2対応）、Console操作待ち

**完了条件**:
- [ ] DataSync用ロググループ作成 (`/aws/datasync/cis-filesearch-sync`)
- [ ] **EC2 Application用ロググループ作成** (`/aws/ec2/cis-filesearch-processor/application`)
- [ ] **EC2 System用ロググループ作成** (`/aws/ec2/cis-filesearch-processor/system`)
- [ ] メトリクスフィルター設定完了（4種類）
- [ ] SNSトピック作成完了（オプション）
- [ ] CloudWatch Alarms設定完了（オプション）

**ガイド**: `/docs/deployment/datasync/03-cloudwatch-logs-setup-guide.md`（2025-01-14更新済み）

**検証コマンド**:
```bash
# DataSync用ロググループ確認
aws logs describe-log-groups \
  --log-group-name-prefix /aws/datasync/cis \
  --profile AdministratorAccess-770923989980 \
  --query 'logGroups[].logGroupName' \
  --output table

# EC2用ロググループ確認
aws logs describe-log-groups \
  --log-group-name-prefix /aws/ec2/cis-filesearch-processor \
  --profile AdministratorAccess-770923989980 \
  --query 'logGroups[].logGroupName' \
  --output table
```

---

### ドキュメント作成（7タスク）✅

#### 1. DataSync学習ノート作成 ✅

**ステータス**: 🟢 完了（アーキテクチャ図要修正）

**成果物**: `/docs/learning-notes/datasync-fundamentals.md`

**内容**:
- DataSync基本概念
- Agent、Location、Task、Task Executionの詳細
- **CISプロジェクト用アーキテクチャ図（Lambda→EC2に要修正）**
- セキュリティ考慮事項
- 学習リソースリンク
- 3時間学習プラン

**TODO**: アーキテクチャ図をEC2ベースに更新

---

#### 2. IAM Rolesセットアップガイド作成 ✅

**ステータス**: 🟢 完了（2025-01-14更新済み）

**成果物**: `/docs/deployment/datasync/01-iam-roles-setup-guide.md`

**内容**:
- **3つのIAM Roleの詳細作成手順（EC2 Instance Profile対応）**
- AWS Console操作手順（スクリーンショット説明付き）
- JSON Policyテンプレート
- トラブルシューティング
- セキュリティベストプラクティス

---

#### 3. S3バケットセットアップガイド作成 ✅

**ステータス**: 🟢 完了

**成果物**: `/docs/deployment/datasync/02-s3-bucket-setup-guide.md`

**内容**:
- S3バケット作成手順
- **バージョニング無効化推奨（処理後ファイル削除のため）**
- **EventBridge統合設定**
- バケットポリシーJSON
- Intelligent-Tiering設定
- コスト見積もり
- テストアップロード手順

---

#### 4. CloudWatch Logsセットアップガイド作成 ✅

**ステータス**: 🟢 完了（2025-01-14更新済み）

**成果物**: `/docs/deployment/datasync/03-cloudwatch-logs-setup-guide.md`

**内容**:
- **3つのロググループ作成手順（DataSync + EC2×2）**
- **CloudWatch Agent設定ファイルJSON**
- メトリクスフィルター設定（4種類）
- CloudWatch Alarms設定
- **EC2 Worker専用ログクエリサンプル**
- コスト見積もり

---

#### 5. NAS情報リクエストメールテンプレート作成 ✅

**ステータス**: 🟢 完了

**成果物**: `/docs/deployment/datasync/nas-information-request-template.md`

**内容**:
- クライアント向けメールテンプレート
- フォローアップメール（Day 8, Day 10）
- 受領情報チェックリスト
- セキュリティベストプラクティス
- 電話ヒアリングスクリプト

---

#### 6. EC2 Launch Templateガイド作成 ⏳

**ステータス**: 🔴 未着手（Week 1 Day 3-4で作成予定）

**成果物予定**: `/docs/deployment/datasync/07-ec2-launch-template-guide.md`

**内容予定**:
- Amazon Linux 2023 AMI選定
- Tesseract OCR + 日本語言語パックインストール
- Python 3.11環境セットアップ
- CloudWatch Agent設定
- User Data スクリプト
- Security Group設定（egress-only）
- Spot Instance設定

---

#### 7. Auto Scaling Groupガイド作成 ⏳

**ステータス**: 🔴 未着手（Week 1 Day 3-4で作成予定）

**成果物予定**: `/docs/deployment/datasync/08-auto-scaling-group-guide.md`

**内容予定**:
- ASG作成手順（min: 0, max: 10, desired: 0）
- Target Tracking Policy（SQS Queue Depth基準）
- CloudWatch Alarms統合
- Capacity-Optimized Spot配分戦略

---

### DataSync学習（1タスク）

#### DataSync公式ドキュメント学習（3時間） ⏳

**ステータス**: 🟡 学習ノート完成、実際の学習は未実施

**学習プラン**:
- Hour 1: DataSync基本概念とアーキテクチャ理解
- Hour 2: Agent、Location、Taskの詳細理解
- Hour 3: ハンズオン（テスト環境構築）

**学習リソース**:
- [AWS DataSync User Guide](https://docs.aws.amazon.com/datasync/latest/userguide/what-is-datasync.html)
- [DataSync API Reference](https://docs.aws.amazon.com/datasync/latest/userguide/API_Reference.html)
- [DataSync Best Practices](https://docs.aws.amazon.com/datasync/latest/userguide/best-practices.html)

**完了条件**:
- [ ] DataSync User Guide 読了
- [ ] Agent配置パターン理解
- [ ] Location/Task設定理解
- [ ] テスト環境でLocation作成実験

---

## ✅ Day 3-4: EC2インフラ設計 + NAS情報リクエスト

### EC2インフラ設計（3タスク）

#### 1. EC2 Launch Template設計 ⏳

**ステータス**: 🔴 未着手

**設計内容**:
- **AMI選定**: Amazon Linux 2023（最新安定版）
- **インスタンスタイプ**: c5.xlarge（4vCPU, 8GB RAM - Tesseract OCR最適化）
- **IAM Instance Profile**: CIS-EC2-FileProcessor-Role
- **Security Group**: egress-only（S3, SQS, Bedrock, OpenSearch, CloudWatch Logs）
- **User Data**:
  ```bash
  #!/bin/bash
  # Tesseract OCR + 日本語言語パック
  yum install -y tesseract tesseract-langpack-jpn

  # Python 3.11
  yum install -y python3.11 python3.11-pip

  # CloudWatch Agent
  yum install -y amazon-cloudwatch-agent

  # Workerアプリケーションデプロイ
  aws s3 cp s3://cis-deployment-bucket/worker-app.tar.gz /tmp/
  tar -xzf /tmp/worker-app.tar.gz -C /var/app/

  # CloudWatch Agent起動
  /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -s \
    -c file:/opt/aws/amazon-cloudwatch-agent/etc/cloudwatch-config.json

  # Worker起動
  cd /var/app/cis-file-processor
  python3.11 -m pip install -r requirements.txt
  python3.11 worker.py &
  ```

**完了条件**:
- [ ] Launch Template作成ガイド完成
- [ ] AMI選定完了
- [ ] Security Group設計完了
- [ ] User Dataスクリプト完成
- [ ] CloudWatch Agent設定JSON完成

**推定工数**: 3時間

---

#### 2. Auto Scaling Group設計 ⏳

**ステータス**: 🔴 未着手

**設計内容**:
- **最小キャパシティ**: 0（処理なし時はコスト0）
- **最大キャパシティ**: 10（大量ファイル処理対応）
- **希望キャパシティ**: 0
- **スケーリングポリシー**: Target Tracking - SQS Queue Depth
  - メトリクス: `ApproximateNumberOfMessagesVisible`
  - ターゲット値: 5メッセージ/インスタンス
  - スケールアウト: 5分間平均 > 5メッセージ
  - スケールイン: 15分間平均 < 5メッセージ
- **Spot配分戦略**: Capacity-Optimized（中断率最小化）
- **Spot vs On-Demand比率**: 100% Spot（コスト優先）

**完了条件**:
- [ ] ASG作成ガイド完成
- [ ] Target Tracking Policy設計完了
- [ ] CloudWatch Alarms設計完了

**推定工数**: 2時間

---

#### 3. Python Worker アプリケーション設計 ⏳

**ステータス**: 🔴 未着手

**設計内容**:
```python
# worker.py
import boto3
import pytesseract
from PIL import Image
from opensearchpy import OpenSearch

def main():
    sqs = boto3.client('sqs')
    s3 = boto3.client('s3')
    bedrock = boto3.client('bedrock-runtime', region_name='us-east-1')
    opensearch = OpenSearch([{'host': 'cis-filesearch-index.es.amazonaws.com'}])

    while True:
        # SQS Long Polling（20秒）
        response = sqs.receive_message(
            QueueUrl='https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-processing-queue',
            MaxNumberOfMessages=10,
            WaitTimeSeconds=20
        )

        for message in response.get('Messages', []):
            try:
                # 1. S3からファイルダウンロード
                file_data = s3.get_object(Bucket='cis-filesearch-raw-files-prod', Key=message['Body'])

                # 2. Tesseract OCR（CPU集約型、Lambda 15分制限回避）
                text = pytesseract.image_to_string(Image.open(file_data['Body']))

                # 3. サムネイル生成
                thumbnail = generate_thumbnail(file_data['Body'])
                s3.put_object(Bucket='cis-filesearch-thumbnails-prod', Key=f"thumb_{message['Body']}", Body=thumbnail)

                # 4. Bedrock Titan Embeddings
                vector = bedrock.invoke_model(
                    modelId='amazon.titan-embed-image-v1',
                    body=json.dumps({'inputImage': base64.b64encode(file_data['Body']).decode()})
                )

                # 5. OpenSearch インデックス登録
                opensearch.index(
                    index='cis-filesearch',
                    body={
                        'filename': message['Body'],
                        'text': text,
                        'vector': json.loads(vector['body'])['embedding']
                    }
                )

                # 6. S3ソースファイル削除
                s3.delete_object(Bucket='cis-filesearch-raw-files-prod', Key=message['Body'])

                # 7. SQSメッセージ削除
                sqs.delete_message(
                    QueueUrl='...',
                    ReceiptHandle=message['ReceiptHandle']
                )

            except Exception as e:
                logger.error(f"Error processing {message['Body']}: {e}")
                # DLQへ送信済み（SQS自動再試行）

if __name__ == '__main__':
    main()
```

**完了条件**:
- [ ] Python Worker実装ガイド完成
- [ ] Multiprocessing設計完了
- [ ] エラーハンドリング設計完了
- [ ] Spot中断ハンドリング設計完了

**推定工数**: 4時間

---

### プロジェクト管理（2タスク）

#### 1. NAS情報リクエストメール送信 ⏳

**ステータス**: 🟡 テンプレート完成、送信待ち

**実施内容**:
- [ ] メールテンプレートのカスタマイズ（会社名、担当者名）
- [ ] Day 3（水曜日）にメール送信
- [ ] カレンダーにフォローアップ予定登録
  - Day 8（月曜日）: リマインダーメール送信
  - Day 10（水曜日）: エスカレーションメール（PM CC）

**テンプレート**: `/docs/deployment/datasync/nas-information-request-template.md`

---

#### 2. Week 1進捗レビュー ⏳

**ステータス**: 🟡 チェックリスト更新完了、レビュー待ち

**レビュー項目**:
- [ ] AWS基盤構築完了確認
- [ ] DataSync学習完了確認
- [ ] EC2インフラ設計完了確認
- [ ] ブロッカー確認
- [ ] Week 2計画調整（NAS情報受領状況による）

**実施予定**: Day 5（金曜日）17:00

---

## 📊 Day 5: Week 1レビュー

### 完了条件（Day 5 EOD）

**必須（MUST）**:
- [ ] IAM Roles 3つ作成完了（EC2 Instance Profile含む）
- [ ] S3 Bucket作成完了（EventBridge統合）
- [ ] CloudWatch Logs設定完了（EC2用3ロググループ）
- [ ] NAS情報リクエストメール送信完了
- [ ] DataSync学習3時間完了

**推奨（SHOULD）**:
- [ ] EC2 Launch Template設計ガイド完成
- [ ] Auto Scaling Group設計ガイド完成
- [ ] Python Worker アプリケーション設計完成 50%以上

**オプション（COULD）**:
- [ ] Python Worker実装着手
- [ ] Spot Interruption Handlingガイド作成
- [ ] CloudWatch Alarms設定完了

---

## 🚧 ブロッカー管理

### 現在のブロッカー

#### Blocker 1: NAS接続情報未受領 🔴

**影響**: Week 2後半のDataSync実環境構築不可

**対応策**:
- Day 3: メール送信
- Day 8: リマインダー送信
- Day 10: エスカレーション（PM巻き込み）
- 最悪ケース: ダミーNAS（ローカルSMBサーバー）でテスト実施

**リスク**: 中（Week 2後半まで猶予あり）

---

### 解決済みブロッカー

#### Blocker 2: アーキテクチャ誤解（Lambda vs EC2） ✅

**問題**: 初期ドキュメントがLambda前提で作成されていた

**解決**:
- 2025-01-14にガイド3ファイル完全書き直し完了
- 01-iam-roles-setup-guide.md（EC2 Instance Profile対応）
- 03-cloudwatch-logs-setup-guide.md（EC2 Application/System logs対応）
- week1-completion-checklist.md（EC2タスク反映）

**影響**: なし（AWS Console操作開始前に修正完了）

---

## 📝 Week 2への引き継ぎ事項

### Week 2前半（Day 6-10）

**並行実施可能タスク**:
- [ ] **EC2 Launch Template作成（AWS Console）**
- [ ] **Auto Scaling Group作成（AWS Console）**
- [ ] **Python Worker実装とローカルテスト**
- [ ] SQS Queue作成
- [ ] EventBridge Rule作成（S3 → SQS）
- [ ] OpenSearch Domain作成
- [ ] 統合テスト実施（LocalStack or AWS Staging）

### Week 2後半（Day 11-15、NAS情報受領後）

**NAS依存タスク**:
- [ ] DataSync Agent VM配置（Hyper-V/VMware）
- [ ] DataSync Location作成（Source: NAS、Destination: S3）
- [ ] DataSync Task作成
- [ ] 小規模テスト実行（100ファイル、1GB）
- [ ] 大規模テスト計画策定

---

## 🎯 Week 1成功基準

### 最小成功基準（Minimum Viable Success）

```
✅ AWS基盤構築完了（IAM, S3, CloudWatch Logs）
✅ DataSync基礎知識習得完了
✅ NAS情報リクエスト送信完了
✅ EC2インフラ設計ガイド50%以上完了
```

### 理想成功基準（Ideal Success）

```
✅ AWS基盤構築完了
✅ DataSync学習完了 + テスト環境実験完了
✅ NAS情報受領完了
✅ EC2インフラ設計ガイド100%完了（Launch Template, ASG, Worker App）
✅ Python Worker実装着手（骨組み完成）
```

---

## 🏗️ アーキテクチャ確認

**正しいアーキテクチャ**（drawio file確認済み）:

```
ファイルスキャナーPC → DataSync Agent → S3ランディングバケット
    ↓ (S3 Event → EventBridge)
EventBridge → SQS Queue
    ↓ (SQS Depth監視)
Auto Scaling Group
    ↓
EC2 Spot Instances（複数台、c5.xlarge）
    ├─ Tesseract OCR（CPU集約型、15分超え可能）
    ├─ サムネイル生成
    ├─ Bedrock ベクトル化（us-east-1）
    └─ OpenSearch インデックス登録
```

**重要**:
- ❌ Lambda関数は使用しない（OCR処理が15分超える可能性）
- ✅ EC2 Spot Instancesで70-90%コスト削減
- ✅ Tesseract OCRをネイティブインストール可能
- ✅ Multiprocessing並列処理で高速化

---

## 📞 サポート

質問やブロッカーがある場合:

1. **ドキュメント確認**: `/docs/deployment/datasync/` 以下のガイド
2. **学習ノート確認**: `/docs/learning-notes/datasync-fundamentals.md`
3. **チーム内相談**: プロジェクトSlackチャンネル
4. **エスカレーション**: プロジェクトマネージャーへ報告

---

**次回レビュー**: Week 2 Day 5（金曜日）17:00
**ドキュメント更新**: 毎日EODにこのチェックリストを更新
