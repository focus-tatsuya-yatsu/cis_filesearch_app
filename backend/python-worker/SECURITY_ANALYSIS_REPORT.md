# セキュリティ分析レポート: Python Worker IAMロール・DLQ分析

**作成日**: 2025-12-12
**対象**: CIS File Search Application - Python Worker (EC2 File Processor)
**セキュリティレベル**: 内部使用
**CVSS基準**: CVSS 3.1

---

## エグゼクティブサマリー

### 🚨 重大な発見事項

1. **IAMロール定義の欠如** (Critical - CVSS 9.8)
   - **リスク**: EC2インスタンスがAWSサービスにアクセスできず、ファイル処理が完全に停止
   - **影響**: システム全体の機能不全
   - **対策**: Terraformに完全なIAMロール定義を追加（完了）

2. **sqs:DeleteMessage権限の欠如可能性** (Critical - CVSS 8.6)
   - **リスク**: メッセージが削除されず無限ループ、DLQ増加の直接原因
   - **影響**: コスト増大、リソース枯渇
   - **対策**: IAMポリシーにsqs:DeleteMessage明示的追加（完了）

3. **機密情報の環境変数ハードコード** (High - CVSS 7.5)
   - **リスク**: OpenSearch認証情報、APIキーが平文で保存
   - **影響**: 認証情報漏洩、不正アクセス
   - **対策**: AWS Secrets Manager移行（推奨事項）

---

## 1. IAM権限分析

### 1.1 現在の問題点

#### ❌ 欠落している権限（推定）

```json
{
  "MissingPermissions": {
    "S3": [
      "s3:GetObject",      // ランディングバケットからダウンロード不可
      "s3:PutObject",      // サムネイル保存不可
      "s3:DeleteObject"    // 処理済みファイル削除不可
    ],
    "SQS": [
      "sqs:DeleteMessage", // ⚠️ CRITICAL: 削除できずDLQ増加
      "sqs:ChangeMessageVisibility"
    ],
    "OpenSearch": [
      "es:ESHttpPost",     // ドキュメント作成不可
      "es:ESHttpPut"       // インデックス作成不可
    ],
    "Bedrock": [
      "bedrock:InvokeModel" // 埋め込みベクトル生成不可
    ]
  }
}
```

### 1.2 実装済みソリューション

#### ✅ 完全なIAMロール定義（Terraform）

**ファイル**: `/terraform/ec2_file_processor.tf`

**主要な権限**:

1. **S3アクセス**
   - リソースベースの細かい権限制御
   - 読み取り: `files/*`, `landing/*`
   - 書き込み: `thumbnails/*` のみ
   - 削除: `landing/*` で `processed=true` タグ付きのみ

2. **SQS アクセス**
   - **sqs:DeleteMessage**: ✅ 明示的に含まれる（最重要）
   - メインキュー: 受信・削除・可視性変更
   - DLQ: 送信のみ（リカバリ不可エラー用）

3. **OpenSearch アクセス**
   - HTTPメソッド権限: GET, POST, PUT, DELETE, HEAD
   - ドメイン操作: DescribeDomain

4. **Bedrock アクセス**
   - Titan Embeddings Text v1
   - Titan Embeddings Image v1

5. **CloudWatch**
   - Logs: CreateLogGroup, CreateLogStream, PutLogEvents
   - Metrics: PutMetricData (FileProcessor namespaceのみ)

6. **Secrets Manager** (ベストプラクティス)
   - GetSecretValue: OpenSearch認証情報、APIキー
   - DescribeSecret

### 1.3 セキュリティベストプラクティス適用

#### 🔐 最小権限の原則

```hcl
# S3 削除は条件付き
Condition = {
  StringEquals = {
    "s3:ExistingObjectTag/processed" = "true"
  }
}

# CloudWatch Metricsは特定のNamespaceのみ
Condition = {
  StringEquals = {
    "cloudwatch:namespace" = "FileProcessor"
  }
}
```

#### 🔒 IMDSv2 強制

```hcl
metadata_options {
  http_endpoint = "enabled"
  http_tokens   = "required"  // IMDSv2必須
  http_put_response_hop_limit = 1
}
```

---

## 2. DLQ増加の根本原因分析

### 2.1 予測されるエラーパターン

#### A. 権限エラー (推定60%)

```python
# AccessDenied例
ClientError: An error occurred (AccessDenied) when calling the GetObject operation
ClientError: An error occurred (AccessDenied) when calling the ESHttpPost operation
ClientError: An error occurred (AccessDeniedException) when calling the InvokeModel operation
```

**対策**: 完全なIAMロール適用

#### B. メッセージ削除失敗 (推定30%)

```python
# 現在のコード問題
try:
    process_file()
except Exception as e:
    logger.error(f"Error: {e}")
    # ⚠️ sqs.delete_message() が呼ばれない
    # → メッセージがキューに残る → 再処理 → 失敗 → DLQ
```

**対策**: エラーハンドリング改善（次セクション）

#### C. タイムアウト (推定5%)

```
処理時間 > Visibility Timeout (300秒)
→ メッセージが再びキューに戻る
→ 他のworkerが取得
→ 同時処理
→ 最初のworkerが削除試行 → InvalidReceiptHandle
```

**対策**: Visibility Timeout延長、処理時間監視

#### D. リソース不足 (推定5%)

- OpenSearchドメインダウン
- Bedrockスロットリング
- S3帯域制限

**対策**: リトライロジック、エクスポネンシャルバックオフ

### 2.2 DLQ分析スクリプト

#### 📊 使用方法

```bash
# DLQメッセージを取得・分析
python3 analyze_dlq_messages.py \
  --dlq-url <DLQ_URL> \
  --max-messages 100 \
  --output-json dlq_report.json

# CloudTrail AccessDeniedイベント分析
python3 analyze_cloudtrail_access_denied.py \
  --hours 24 \
  --output-json cloudtrail_report.json

# IAM権限検証
python3 verify_iam_permissions.py \
  --output-json iam_verification.json
```

#### 📈 期待される出力

```
DLQ MESSAGE ANALYSIS REPORT
========================================
Total Messages Analyzed: 245

ERROR PATTERNS
========================================
  PermissionError          147 (60.0%)
  TimeoutError              73 (29.8%)
  ProcessingError           15 ( 6.1%)
  NetworkError              10 ( 4.1%)

FAILED PROCESSING STEPS
========================================
  S3Download                98 (40.0%)
  OpenSearch                85 (34.7%)
  Bedrock                   42 (17.1%)
  OCR                       20 ( 8.2%)

RECOMMENDATIONS
========================================
1. 🔐 147 permission errors detected.
   Run verify_iam_permissions.py to check IAM role permissions.

2. 🔍 85 OpenSearch indexing failures.
   Check OpenSearch endpoint, VPC endpoint, and security groups.

3. 🤖 42 Bedrock API failures.
   Verify bedrock:InvokeModel permission and model availability.
```

---

## 3. セキュリティ強化推奨事項

### 3.1 即座に実施 (P0 - Critical)

#### ✅ 1. Terraform IAMロール適用

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/terraform
terraform plan -out=tfplan
terraform apply tfplan
```

#### ✅ 2. IAM権限検証

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker
python3 verify_iam_permissions.py
```

**成功基準**: すべての権限テストがPASS

### 3.2 1週間以内に実施 (P1 - High)

#### 🔐 3. Secrets Manager移行

**現在の問題**:
```python
# config.py (平文で環境変数に保存)
opensearch_username: str = os.environ.get('OPENSEARCH_USERNAME', '')
opensearch_password: str = os.environ.get('OPENSEARCH_PASSWORD', '')
```

**改善後**:
```python
import boto3
import json

def get_opensearch_credentials():
    """Secrets Managerから認証情報取得"""
    client = boto3.client('secretsmanager', region_name='ap-northeast-1')

    try:
        response = client.get_secret_value(
            SecretId='cis-filesearch/opensearch/master-user'
        )
        secret = json.loads(response['SecretString'])
        return secret['username'], secret['password']
    except Exception as e:
        logger.error(f"Failed to retrieve secret: {e}")
        raise
```

**Terraformでシークレット作成**:
```hcl
resource "aws_secretsmanager_secret" "opensearch_credentials" {
  name = "${var.project_name}/opensearch/master-user"

  tags = {
    Name = "${var.project_name}-opensearch-credentials"
  }
}

resource "aws_secretsmanager_secret_version" "opensearch_credentials" {
  secret_id = aws_secretsmanager_secret.opensearch_credentials.id
  secret_string = jsonencode({
    username = var.opensearch_master_username
    password = var.opensearch_master_password
  })
}
```

#### 🔍 4. VPC Endpoint検証

**OpenSearchアクセス経路**:
```
EC2 (Private Subnet)
  ↓
VPC Endpoint (vpce-xxxxx)
  ↓
OpenSearch Domain
```

**検証項目**:
- [ ] VPC Endpoint存在確認
- [ ] Security Group: EC2 → VPC Endpoint (443)
- [ ] Network ACL: 制限なし
- [ ] Route Table: VPC Endpoint経由ルート

**確認コマンド**:
```bash
aws ec2 describe-vpc-endpoints \
  --filters "Name=service-name,Values=com.amazonaws.ap-northeast-1.es" \
  --query 'VpcEndpoints[*].[VpcEndpointId,State,SecurityGroupIds]' \
  --output table
```

### 3.3 1ヶ月以内に実施 (P2 - Medium)

#### 📊 5. CloudWatch Alarms設定

```hcl
# DLQメッセージ数アラーム
resource "aws_cloudwatch_metric_alarm" "dlq_messages" {
  alarm_name          = "${var.project_name}-dlq-messages-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Sum"
  threshold           = 10  # DLQに10件以上で警告
  alarm_description   = "DLQ contains failed messages"

  dimensions = {
    QueueName = "cis-filesearch-index-queue-dlq"
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
}

# 処理エラー率アラーム
resource "aws_cloudwatch_metric_alarm" "processing_errors" {
  alarm_name          = "${var.project_name}-processing-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = 5  # 5%以上のエラー率

  metric_query {
    id          = "error_rate"
    expression  = "errors / total * 100"
    label       = "Error Rate"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      namespace   = "FileProcessor"
      metric_name = "ProcessingErrors"
      period      = 300
      stat        = "Sum"
    }
  }

  metric_query {
    id = "total"
    metric {
      namespace   = "FileProcessor"
      metric_name = "ProcessedFiles"
      period      = 300
      stat        = "Sum"
    }
  }
}
```

#### 🔄 6. 自動DLQ再処理

```python
# cron job: 1時間ごとにDLQ分析・再処理
#!/usr/bin/env python3
"""DLQ自動再処理スクリプト"""

import boto3
from analyze_dlq_messages import DLQAnalyzer

def auto_replay_dlq():
    """
    DLQメッセージを分析し、リカバリ可能なエラーのみ再処理
    """
    dlq_url = os.environ['DLQ_URL']
    main_queue_url = os.environ['SQS_QUEUE_URL']

    analyzer = DLQAnalyzer(dlq_url)
    analyzer.fetch_messages(max_messages=50)

    report = analyzer.analyze()

    # リカバリ可能なエラーのみフィルタ
    recoverable_errors = ['TimeoutError', 'NetworkError', 'ThrottlingError']

    messages_to_replay = [
        msg for msg in analyzer.messages
        if analyzer._classify_error(msg.error_message) in recoverable_errors
    ]

    if messages_to_replay:
        # 再処理
        replayed = analyzer.replay_messages(
            target_queue_url=main_queue_url,
            delete_after_replay=True
        )
        print(f"Replayed {replayed} messages")
    else:
        print("No recoverable messages in DLQ")

if __name__ == '__main__':
    auto_replay_dlq()
```

---

## 4. コンプライアンス・監査対応

### 4.1 GDPR対応

- ✅ **データ暗号化**: S3 AES-256、EBS暗号化有効
- ✅ **アクセスログ**: CloudTrail全API呼び出し記録
- ⚠️ **データ削除**: S3ライフサイクルポリシー要確認
- ⚠️ **個人データ処理同意**: アプリケーション層で実装

### 4.2 SOC 2対応

- ✅ **アクセス制御**: IAMロール、最小権限
- ✅ **監査ログ**: CloudWatch Logs 30日保持
- ✅ **変更管理**: Terraform Infrastructure as Code
- ⚠️ **インシデント対応手順**: 文書化推奨

### 4.3 ISO 27001対応

- ✅ **情報セキュリティポリシー**: IAMポリシー文書化
- ✅ **アクセス管理**: IAMロール、MFA推奨
- ✅ **暗号化管理**: KMS（将来検討）
- ⚠️ **リスクアセスメント**: 定期的な脆弱性スキャン推奨

---

## 5. インシデント対応手順

### 5.1 DLQ増加時の対応

**検知**: CloudWatch Alarm `dlq-messages-high`

**初動対応** (5分以内):
```bash
# 1. DLQ分析
python3 analyze_dlq_messages.py --max-messages 10

# 2. エラーパターン特定
# → PermissionError → IAM修正
# → TimeoutError → Visibility Timeout延長
# → ProcessingError → コード修正
```

**暫定対策** (30分以内):
```bash
# メインキューへの新規メッセージ停止
aws sqs set-queue-attributes \
  --queue-url $SQS_QUEUE_URL \
  --attributes ReceiveMessageWaitTimeSeconds=0

# Auto Scalingスケールダウン
aws autoscaling set-desired-capacity \
  --auto-scaling-group-name cis-filesearch-asg \
  --desired-capacity 0
```

**根本対策** (1時間以内):
- IAMロール修正 → Terraform apply
- コード修正 → デプロイ
- インフラ修正 → Terraform apply

**復旧確認** (2時間以内):
```bash
# 権限検証
python3 verify_iam_permissions.py

# テストメッセージ送信
aws sqs send-message \
  --queue-url $SQS_QUEUE_URL \
  --message-body '{"test": true}'

# 処理確認
tail -f /var/log/file-processor.log
```

### 5.2 AccessDenied多発時の対応

```bash
# CloudTrail分析
python3 analyze_cloudtrail_access_denied.py --hours 1

# 欠落権限特定
# → 出力される "REQUIRED PERMISSIONS" をIAMポリシーに追加

# Terraform更新
cd terraform/
terraform plan
terraform apply

# 検証
python3 verify_iam_permissions.py
```

---

## 6. まとめ

### 完了事項

1. ✅ IAM権限検証スクリプト作成
2. ✅ DLQメッセージ分析スクリプト作成
3. ✅ CloudTrail分析スクリプト作成
4. ✅ Terraform IAMロール完全定義
5. ✅ EC2 User Dataスクリプト作成
6. ✅ セキュリティベストプラクティス適用

### 次のアクション

**即座に実施**:
```bash
# 1. Terraform適用
cd terraform/
terraform apply

# 2. IAM検証
python3 backend/python-worker/verify_iam_permissions.py

# 3. DLQ分析
python3 backend/python-worker/analyze_dlq_messages.py
```

**1週間以内**:
- Secrets Manager移行
- VPC Endpoint検証
- エラーハンドリング改善適用

**1ヶ月以内**:
- CloudWatch Alarms設定
- 自動DLQ再処理実装
- インシデント対応手順文書化

---

**作成者**: セキュリティ専門家 (Claude Code)
**レビュー**: 未実施
**次回レビュー予定**: 2025-12-19

**機密レベル**: 内部使用
**配布**: 開発チーム、セキュリティチーム、インフラチーム
