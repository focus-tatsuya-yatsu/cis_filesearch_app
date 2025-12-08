# AWS Verification Script Update Summary

## 更新日時
2025-01-18

## 更新内容

AWS環境の検証スクリプト (`verify_aws_config.py`) を、実際に作成されたAWSリソース名に合わせて更新しました。

### 変更されたリソース名

#### 1. OpenSearch Domain
- **旧**: `cis-filesearch`
- **新**: `cis-filesearch-opensearch`

#### 2. S3 Buckets
- **旧**:
  - `cis-landing-bucket`
  - `cis-thumbnail-bucket`
- **新**:
  - `cis-filesearch-s3-landing`
  - `cis-filesearch-s3-thumbnail`

#### 3. SQS Queues
- **メインキュー**:
  - **旧**: `cis-file-processing-queue`
  - **新**: `cis-filesearch-index-queue`
- **DLQ** (新規追加):
  - `cis-filesearch-dlq`

#### 4. IAM Role
- **優先順位1**: `cis-filesearch-worker-role` (実際の名前)
- **優先順位2**: `CIS-EC2-FileProcessor-Role` (旧名)
- **優先順位3**: `cis-ec2-role`
- **優先順位4**: `CISFileProcessorRole`

### 追加機能

1. **DLQの詳細確認**
   - DLQの存在確認
   - DLQ内のメッセージ数表示
   - メインキューとDLQの関連付け確認

2. **エラーメッセージの改善**
   - 実際のリソース名を推奨値として表示
   - より具体的なエラーメッセージ

### スクリプト実行方法

```bash
# AWS認証情報を設定
export AWS_REGION=ap-northeast-1
export AWS_PROFILE=your-profile-name  # または ~/.aws/credentials を設定

# スクリプトを実行
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/ec2-worker
python3 verify_aws_config.py
```

### 期待される出力

```
============================================================
AWS Configuration Verification for CIS File Search
Region: ap-northeast-1
Time: 2025-01-18 XX:XX:XX
============================================================

🔍 Checking OpenSearch Domain...
   ✅ Instance Type: t3.small.search
   ✅ Instance Count: 1
   ✅ Volume Size: 100 GB
   ✅ Volume Type: gp3
   ✅ k-NN Plugin: Enabled
   Endpoint: https://cis-filesearch-opensearch-xxxxx.ap-northeast-1.es.amazonaws.com

🪣 Checking S3 Buckets...
   ✅ cis-filesearch-s3-landing: Exists
   ✅ S3 EventBridge: cis-filesearch-s3-landing: Enabled
   ✅ S3 Versioning: cis-filesearch-s3-landing: Enabled
   ✅ S3 Encryption: cis-filesearch-s3-landing: Enabled
   ✅ cis-filesearch-s3-thumbnail: Exists
   ✅ S3 Versioning: cis-filesearch-s3-thumbnail: Enabled
   ✅ S3 Encryption: cis-filesearch-s3-thumbnail: Enabled

📨 Checking SQS Queues...
   ✅ cis-filesearch-index-queue: Exists
   ✅ SQS Settings: Visibility Timeout: 300s
   ✅ SQS Settings: Message Retention: 14 days
   ✅ SQS DLQ: Dead Letter Queue: Configured
   ✅ SQS DLQ: cis-filesearch-dlq: Exists
   ✅ DLQ Messages: Messages in DLQ: 0

🌉 Checking EventBridge Rules...
   ✅ EventBridge Rule: [rule-name]: ENABLED
   ✅ EventBridge Target: → SQS: cis-filesearch-index-queue

⚡ Checking Auto Scaling Groups...
   ✅ Auto Scaling: cis-file-processor-asg
   ✅ ASG Config: Min: 0, Max: 10, Desired: 0
   ✅ ASG Status: Running Instances: 0

🔐 Checking IAM Roles...
   ✅ IAM Role: cis-filesearch-worker-role: Found
   ✅ IAM Policy: → [attached-policy-names]

🤖 Checking Bedrock Access...
   ✅ Bedrock Model: amazon.titan-embed-image-v1: Available
   ✅ Bedrock Access: API Access: OK

============================================================
VERIFICATION SUMMARY
============================================================
Total Checks: XX
Passed: XX ✅
Failed: 0 ❌

🎉 All checks passed! Your AWS environment is ready.
============================================================

✅ AWS configuration verification completed successfully!
You can now proceed with running the Python Worker application.
```

### トラブルシューティング

#### ケース1: OpenSearchが見つからない
```
❌ OpenSearch: cis-filesearch-opensearch: NOT FOUND
```
**対処**: AWS Consoleで正しいドメイン名を確認し、スクリプトの `EXPECTED_CONFIG` を更新

#### ケース2: S3バケットが見つからない
```
❌ S3 Bucket: cis-filesearch-s3-landing: NOT FOUND
```
**対処**: バケット名を確認し、存在しない場合は作成

#### ケース3: IAMロールが見つからない
```
❌ IAM Role: No EC2 processor role found
   Suggested role name: cis-filesearch-worker-role
```
**対処**: IAMロールを作成し、必要なポリシーをアタッチ

#### ケース4: Bedrock アクセスエラー
```
❌ Bedrock Access: Limited or No Access
   Note: Bedrock access may need to be requested through AWS Console
```
**対処**: AWS Consoleから Bedrock モデルアクセスをリクエスト

### 次のステップ

1. **検証スクリプトの実行**
   ```bash
   python3 verify_aws_config.py
   ```

2. **エラーの修正**
   - 失敗した項目があれば、AWS Consoleで設定を確認・修正

3. **ワーカーアプリケーションの起動**
   ```bash
   python3 file_processor.py
   ```

### 関連ドキュメント

- `/docs/deployment/aws-manual-setup-overview.md` - AWS手動セットアップ概要
- `/docs/deployment/aws-s3-configuration-guide.md` - S3設定ガイド
- `/docs/deployment/aws-sqs-configuration-guide.md` - SQS設定ガイド
- `/docs/deployment/aws-cloudwatch-configuration-guide.md` - CloudWatch設定ガイド
- `/docs/security/iam-roles-policies-guide.md` - IAMロール・ポリシーガイド

## 更新履歴

- 2025-01-18: 実際のAWSリソース名に合わせて初期更新
  - OpenSearch, S3, SQS, IAM Role名を更新
  - DLQ確認機能を追加
