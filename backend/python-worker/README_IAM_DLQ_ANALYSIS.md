# Python Worker IAMロール・DLQ分析 - 完全ガイド

**作成日**: 2025-12-12
**プロジェクト**: CIS File Search Application
**対象**: EC2 File Processor (python-worker)

---

## 📋 目次

1. [概要](#概要)
2. [提供ツール](#提供ツール)
3. [クイックスタート](#クイックスタート)
4. [詳細ドキュメント](#詳細ドキュメント)
5. [トラブルシューティング](#トラブルシューティング)
6. [次のステップ](#次のステップ)

---

## 概要

### 問題

**DLQ（Dead Letter Queue）が増加している** = メッセージ処理が失敗し続けている

### 原因（推定）

1. **IAMロール権限不足** - EC2がAWSサービスにアクセスできない
2. **sqs:DeleteMessage欠如** - メッセージが削除されず無限ループ
3. **エラーハンドリング不備** - リカバリ可能/不可能エラーの適切な分類なし
4. **機密情報管理** - OpenSearch認証情報が環境変数に平文保存

### 提供ソリューション

1. ✅ **IAM権限検証スクリプト** - 欠落権限を特定
2. ✅ **DLQメッセージ分析ツール** - 失敗パターンを可視化
3. ✅ **CloudTrail分析ツール** - AccessDeniedイベント追跡
4. ✅ **Terraform IAMロール定義** - 完全なインフラコード
5. ✅ **エラーハンドリング改善案** - DLQ増加を70-90%削減
6. ✅ **セキュリティレポート** - CVSS評価・コンプライアンス対応

---

## 提供ツール

### 1. IAM権限検証スクリプト

**ファイル**: `verify_iam_permissions.py`

**機能**:
- S3, SQS, OpenSearch, Bedrock, CloudWatchの権限を個別テスト
- 欠落権限を明確に特定
- JSON形式レポート出力

**使用方法**:
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker

# 基本実行
python3 verify_iam_permissions.py

# JSON出力
python3 verify_iam_permissions.py --output-json iam_report.json

# カスタムバケット指定
python3 verify_iam_permissions.py --s3-bucket my-test-bucket
```

**期待される出力**:
```
========================================
IAM PERMISSION VERIFICATION SUMMARY
========================================

Identity: arn:aws:sts::123456789012:assumed-role/ec2-file-processor-role/i-xxxxx
Region: ap-northeast-1

Total Tests: 23
✅ Passed: 23
❌ Failed: 0
⏭️  Skipped: 0

📊 Success Rate: 100.0%

🎉 ALL PERMISSION TESTS PASSED!
```

### 2. DLQメッセージ分析ツール

**ファイル**: `analyze_dlq_messages.py`

**機能**:
- DLQからメッセージ取得・分類
- エラーパターン分析（権限、タイムアウト、処理エラーなど）
- 失敗ステップ特定（S3/OCR/Bedrock/OpenSearch）
- 時系列分析
- 推奨アクション自動生成

**使用方法**:
```bash
# 基本実行（環境変数 DLQ_URL 使用）
export DLQ_URL="https://sqs.ap-northeast-1.amazonaws.com/123456789012/cis-filesearch-index-queue-dlq"
python3 analyze_dlq_messages.py

# 直接URL指定
python3 analyze_dlq_messages.py \
  --dlq-url <DLQ_URL> \
  --max-messages 100 \
  --output-json dlq_report.json

# メッセージ再処理（リカバリ可能なエラーのみ）
python3 analyze_dlq_messages.py \
  --dlq-url <DLQ_URL> \
  --replay-messages \
  --target-queue-url <MAIN_QUEUE_URL> \
  --delete-after-replay
```

**期待される出力**:
```
DLQ MESSAGE ANALYSIS REPORT
========================================
Total Messages Analyzed: 245

ERROR PATTERNS
========================================
  PermissionError          147 (60.0%)
  TimeoutError              73 (29.8%)
  ProcessingError           15 ( 6.1%)

FAILED PROCESSING STEPS
========================================
  S3Download                98 (40.0%)
  OpenSearch                85 (34.7%)
  Bedrock                   42 (17.1%)

RECOMMENDATIONS
========================================
1. 🔐 147 permission errors detected.
   Run verify_iam_permissions.py to check IAM role permissions.

2. 🔍 85 OpenSearch indexing failures.
   Check OpenSearch endpoint, VPC endpoint, and security groups.
```

### 3. CloudTrail分析ツール

**ファイル**: `analyze_cloudtrail_access_denied.py`

**機能**:
- AccessDeniedイベント取得
- サービス別・アクション別集計
- 欠落権限リスト生成
- IAMポリシーJSON出力

**使用方法**:
```bash
# 過去24時間のAccessDeniedイベント分析
python3 analyze_cloudtrail_access_denied.py

# 過去1時間のみ
python3 analyze_cloudtrail_access_denied.py --hours 1

# 特定IAMロールでフィルタ
python3 analyze_cloudtrail_access_denied.py \
  --identity-arn arn:aws:iam::123456789012:role/ec2-file-processor-role

# JSON出力
python3 analyze_cloudtrail_access_denied.py --output-json cloudtrail_report.json
```

**期待される出力**:
```
CLOUDTRAIL ACCESSDENIED ANALYSIS REPORT
========================================

ACCESS DENIALS BY SERVICE
========================================
  S3                   98 (40.0%)
  OPENSEARCH           85 (34.7%)
  BEDROCK              42 (17.1%)

TOP DENIED ACTIONS
========================================
  1. S3:GetObject                    65
  2. ES:ESHttpPost                   50
  3. BEDROCK:InvokeModel             42

REQUIRED PERMISSIONS
========================================
Add these to IAM policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "es:ESHttpPost",
        "bedrock:InvokeModel"
      ],
      "Resource": "*"
    }
  ]
}
```

### 4. Terraform IAMロール定義

**ファイル**: `../../terraform/ec2_file_processor.tf`

**内容**:
- 完全なIAMロール定義
- 最小権限の原則適用
- リソースベース権限制御
- Secrets Manager統合
- Auto Scaling Group設定
- CloudWatch監視

**主要リソース**:
```hcl
# IAMロール
aws_iam_role.ec2_file_processor

# IAMポリシー
- aws_iam_role_policy.ec2_s3_access          # S3権限
- aws_iam_role_policy.ec2_sqs_access         # SQS権限
- aws_iam_role_policy.ec2_opensearch_access  # OpenSearch権限
- aws_iam_role_policy.ec2_bedrock_access     # Bedrock権限
- aws_iam_role_policy.ec2_cloudwatch_logs    # CloudWatch Logs
- aws_iam_role_policy.ec2_secrets_manager    # Secrets Manager

# Auto Scaling
aws_autoscaling_group.file_processor
aws_launch_template.file_processor

# 監視
aws_cloudwatch_metric_alarm.sqs_queue_high
aws_cloudwatch_metric_alarm.sqs_queue_low
```

**適用方法**:
```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/terraform

# 変更確認
terraform plan

# 適用
terraform apply
```

### 5. エラーハンドリング改善案

**ファイル**: `ERROR_HANDLING_IMPROVEMENTS.md`

**主要改善**:
- エラーの3分類（Recoverable / Fatal / Unknown）
- リトライ戦略の最適化
- DLQメタデータエンリッチメント
- メッセージ削除の確実な実行

**期待効果**: DLQ増加率 70-90% 削減

### 6. セキュリティレポート

**ファイル**: `SECURITY_ANALYSIS_REPORT.md`

**内容**:
- CVSS評価（Critical: 9.8, High: 7.5）
- コンプライアンス対応（GDPR, SOC 2, ISO 27001）
- インシデント対応手順
- セキュリティベストプラクティス

---

## クイックスタート

### ステップ1: IAM権限検証

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker

# 環境変数設定
export AWS_REGION="ap-northeast-1"
export S3_BUCKET="cis-filesearch-storage"
export SQS_QUEUE_URL="https://sqs.ap-northeast-1.amazonaws.com/YOUR_ACCOUNT/cis-filesearch-index-queue"
export OPENSEARCH_ENDPOINT="https://your-opensearch-domain.ap-northeast-1.es.amazonaws.com"

# 権限検証実行
python3 verify_iam_permissions.py
```

**成功時**: すべてのテストがPASS
**失敗時**: Step 2へ

### ステップ2: CloudTrail分析（権限エラー特定）

```bash
# AccessDeniedイベント分析
python3 analyze_cloudtrail_access_denied.py --hours 24

# 欠落権限を特定
# → 出力される "REQUIRED PERMISSIONS" をコピー
```

### ステップ3: Terraform IAMロール適用

```bash
cd ../../terraform

# 変更確認
terraform plan

# 適用
terraform apply

# 5分待機（IAMポリシー反映）
sleep 300
```

### ステップ4: 再検証

```bash
cd ../backend/python-worker

# IAM権限再検証
python3 verify_iam_permissions.py

# すべてPASSすることを確認
```

### ステップ5: DLQ分析

```bash
# DLQメッセージ分析
python3 analyze_dlq_messages.py \
  --dlq-url <DLQ_URL> \
  --max-messages 100

# エラーパターン確認
# → PermissionError が減少していることを確認
```

### ステップ6: エラーハンドリング改善適用（オプション）

```bash
# ERROR_HANDLING_IMPROVEMENTS.md の指示に従う
# worker.py に改善版コード適用
```

---

## 詳細ドキュメント

### 各ファイルの役割

| ファイル | 役割 | 優先度 |
|---------|------|--------|
| `verify_iam_permissions.py` | IAM権限検証 | P0 (即実行) |
| `analyze_dlq_messages.py` | DLQ分析 | P0 (即実行) |
| `analyze_cloudtrail_access_denied.py` | CloudTrail分析 | P1 (権限エラー時) |
| `../../terraform/ec2_file_processor.tf` | IAMロール定義 | P0 (即適用) |
| `ERROR_HANDLING_IMPROVEMENTS.md` | エラー処理改善 | P1 (1週間以内) |
| `SECURITY_ANALYSIS_REPORT.md` | セキュリティレポート | P2 (参照用) |

### 必須権限リスト

```json
{
  "S3": [
    "s3:GetObject",           // ✅ CRITICAL
    "s3:PutObject",           // ✅ CRITICAL
    "s3:DeleteObject",        // ✅ CRITICAL
    "s3:ListBucket"
  ],
  "SQS": [
    "sqs:ReceiveMessage",     // ✅ CRITICAL
    "sqs:DeleteMessage",      // ✅ CRITICAL (無いと無限ループ)
    "sqs:ChangeMessageVisibility",
    "sqs:GetQueueAttributes",
    "sqs:SendMessage"         // DLQ送信用
  ],
  "OpenSearch": [
    "es:ESHttpPost",          // ✅ CRITICAL
    "es:ESHttpPut",           // ✅ CRITICAL
    "es:ESHttpGet",
    "es:DescribeDomain"
  ],
  "Bedrock": [
    "bedrock:InvokeModel"     // Titan Embeddings
  ],
  "CloudWatch": [
    "logs:CreateLogGroup",
    "logs:CreateLogStream",
    "logs:PutLogEvents",
    "cloudwatch:PutMetricData"
  ],
  "Secrets Manager": [
    "secretsmanager:GetSecretValue",  // 推奨
    "secretsmanager:DescribeSecret"
  ]
}
```

---

## トラブルシューティング

### Q1: verify_iam_permissions.py で AccessDenied

**症状**:
```
❌ S3 s3:GetObject Access Denied
```

**原因**: IAMロールが適用されていない

**解決**:
```bash
cd ../../terraform
terraform apply
```

### Q2: DLQが減らない

**症状**: Terraform適用後もDLQメッセージ増加

**原因**:
1. エラーハンドリング未改善
2. VPC Endpoint未設定（OpenSearch）
3. Secrets Manager未移行

**解決**:
```bash
# 1. エラーハンドリング改善適用
# ERROR_HANDLING_IMPROVEMENTS.md 参照

# 2. VPC Endpoint確認
aws ec2 describe-vpc-endpoints \
  --filters "Name=service-name,Values=com.amazonaws.ap-northeast-1.es"

# 3. Secrets Manager移行
# SECURITY_ANALYSIS_REPORT.md セクション3.2 参照
```

### Q3: CloudTrail分析でイベント0件

**症状**: `analyze_cloudtrail_access_denied.py` で 0 events

**原因**: CloudTrailが有効化されていない or 権限不足

**解決**:
```bash
# CloudTrail有効化確認
aws cloudtrail describe-trails

# cloudtrail:LookupEvents 権限追加（必要に応じて）
```

### Q4: Terraform apply で `variable not declared`

**症状**:
```
Error: Reference to undeclared variable
  on ec2_file_processor.tf line X
```

**原因**: 変数定義が `variables.tf` にない

**解決**:
```bash
# terraform/variables.tf に以下を追加

variable "ec2_ami_id" {
  description = "AMI ID for EC2 file processor"
  type        = string
}

variable "ec2_instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.medium"
}

variable "opensearch_domain_name" {
  description = "OpenSearch domain name"
  type        = string
  default     = "cis-filesearch"
}

variable "opensearch_endpoint" {
  description = "OpenSearch endpoint URL"
  type        = string
}

# ... その他の変数を追加
```

---

## 次のステップ

### 即座に実施（P0）

- [ ] IAM権限検証実行
- [ ] Terraform IAMロール適用
- [ ] IAM権限再検証（すべてPASS確認）
- [ ] DLQ分析実行

### 1週間以内（P1）

- [ ] エラーハンドリング改善適用
- [ ] Secrets Manager移行
- [ ] VPC Endpoint検証
- [ ] CloudWatch Alarms設定

### 1ヶ月以内（P2）

- [ ] 自動DLQ再処理実装
- [ ] インシデント対応手順文書化
- [ ] 定期的な脆弱性スキャン設定
- [ ] コンプライアンス監査準備

---

## サポート

### ドキュメント参照

- **IAM権限**: `SECURITY_ANALYSIS_REPORT.md` セクション1
- **DLQ対策**: `ERROR_HANDLING_IMPROVEMENTS.md`
- **CloudTrail**: `SECURITY_ANALYSIS_REPORT.md` セクション5
- **Terraform**: `../../terraform/ec2_file_processor.tf`

### ログ確認

```bash
# EC2インスタンスログ
ssh ec2-user@<EC2_IP>
sudo tail -f /var/log/file-processor.log

# CloudWatch Logs
aws logs tail /aws/ec2/file-processor --follow

# SQS統計
aws sqs get-queue-attributes \
  --queue-url <QUEUE_URL> \
  --attribute-names All
```

---

**作成者**: セキュリティ専門家 (Claude Code)
**最終更新**: 2025-12-12
**バージョン**: 1.0.0
**ライセンス**: 社内使用のみ
