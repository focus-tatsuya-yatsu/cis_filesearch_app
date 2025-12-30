# config.py への追加事項

## 必要な環境変数の追加

`config.py` の `AWSConfig` クラスに以下を追加してください:

```python
@dataclass
class AWSConfig:
    """AWS service configuration"""

    # Region
    region: str = os.environ.get('AWS_REGION', 'ap-northeast-1')

    # S3 Configuration
    s3_bucket: str = os.environ.get('S3_BUCKET', 'cis-filesearch-storage')
    s3_processed_prefix: str = os.environ.get('S3_PROCESSED_PREFIX', 'processed/')
    s3_failed_prefix: str = os.environ.get('S3_FAILED_PREFIX', 'failed/')

    # SQS Configuration
    sqs_queue_url: str = os.environ.get('SQS_QUEUE_URL', '')
    sqs_wait_time_seconds: int = int(os.environ.get('SQS_WAIT_TIME', '20'))
    sqs_visibility_timeout: int = int(os.environ.get('SQS_VISIBILITY_TIMEOUT', '900'))  # 300 → 900秒に変更
    sqs_max_messages: int = int(os.environ.get('SQS_MAX_MESSAGES', '1'))

    # DLQ Configuration (NEW)
    dlq_queue_url: str = os.environ.get('DLQ_QUEUE_URL', '')  # 追加

    # OpenSearch Configuration
    opensearch_endpoint: str = os.environ.get('OPENSEARCH_ENDPOINT', '')
    opensearch_index: str = os.environ.get('OPENSEARCH_INDEX', 'file-index')
    opensearch_username: str = os.environ.get('OPENSEARCH_USERNAME', '')
    opensearch_password: str = os.environ.get('OPENSEARCH_PASSWORD', '')
    opensearch_use_ssl: bool = os.environ.get('OPENSEARCH_USE_SSL', 'true').lower() == 'true'
    opensearch_verify_certs: bool = os.environ.get('OPENSEARCH_VERIFY_CERTS', 'true').lower() == 'true'

    # CloudWatch Logs
    cloudwatch_log_group: str = os.environ.get('CLOUDWATCH_LOG_GROUP', '/aws/ec2/file-processor')
    cloudwatch_log_stream: str = os.environ.get('CLOUDWATCH_LOG_STREAM', 'worker')

    def validate(self) -> bool:
        """Validate AWS configuration"""
        if not self.sqs_queue_url:
            logger.error("SQS_QUEUE_URL is required")
            return False

        if not self.s3_bucket:
            logger.error("S3_BUCKET is required")
            return False

        if not self.opensearch_endpoint:
            logger.warning("OPENSEARCH_ENDPOINT not configured - indexing will be disabled")

        # DLQ URLの警告 (必須ではない)
        if not self.dlq_queue_url:
            logger.warning("DLQ_QUEUE_URL not configured - will attempt to derive from main queue URL")

        return True
```

## 環境変数設定例

### EC2 User Data での設定

```bash
#!/bin/bash
cat > /opt/file-processor/.env << EOF
AWS_REGION=ap-northeast-1
S3_BUCKET=cis-filesearch-storage-production
SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/123456789012/file-processing-queue-production
DLQ_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/123456789012/file-processing-dlq-production
OPENSEARCH_ENDPOINT=https://search-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index
SQS_VISIBILITY_TIMEOUT=900
LOG_LEVEL=INFO
MAX_WORKERS=4
MAX_RETRIES=3
EOF
```

### ローカルテスト用 .env ファイル

```bash
# .env
AWS_REGION=ap-northeast-1
S3_BUCKET=cis-filesearch-storage-development
SQS_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/123456789012/file-processing-queue-development
DLQ_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/123456789012/file-processing-dlq-development
OPENSEARCH_ENDPOINT=https://localhost:9200
OPENSEARCH_INDEX=file-index-dev
OPENSEARCH_USERNAME=admin
OPENSEARCH_PASSWORD=admin
SQS_VISIBILITY_TIMEOUT=900
LOG_LEVEL=DEBUG
```

## CloudFormation テンプレートの更新

### sqs-with-dlq.yaml の変更

VisibilityTimeout のデフォルト値を変更:

```yaml
Parameters:
  VisibilityTimeout:
    Type: Number
    Default: 900  # 300 → 900 に変更
    MinValue: 30
    MaxValue: 43200
    Description: Visibility timeout in seconds (must be >= max processing time)
```

### ec2-autoscaling.yaml の変更

User Data に DLQ_QUEUE_URL を追加:

```yaml
UserData:
  Fn::Base64: !Sub |
    #!/bin/bash
    # ... (省略)

    # Create environment file
    cat > .env << EOF
    AWS_REGION=${AWS::Region}
    SQS_QUEUE_URL=${QueueURL}
    DLQ_QUEUE_URL=${DLQueueURL}  # 追加
    S3_BUCKET=${S3Bucket}
    OPENSEARCH_ENDPOINT=${OpenSearchEndpoint}
    OPENSEARCH_INDEX=file-index
    SQS_VISIBILITY_TIMEOUT=900  # 追加
    LOG_LEVEL=INFO
    MAX_WORKERS=4
    MAX_RETRIES=3
    EOF
```

## 検証方法

### 1. 設定値の確認

```python
from config import get_config

config = get_config()
print(f"SQS Queue URL: {config.aws.sqs_queue_url}")
print(f"DLQ Queue URL: {config.aws.dlq_queue_url}")
print(f"Visibility Timeout: {config.aws.sqs_visibility_timeout}")
```

### 2. Visibility Timeout の確認

```bash
aws sqs get-queue-attributes \
  --queue-url <QUEUE_URL> \
  --attribute-names VisibilityTimeout \
  --region ap-northeast-1
```

期待される出力:
```json
{
  "Attributes": {
    "VisibilityTimeout": "900"
  }
}
```

### 3. DLQ設定の確認

```bash
aws sqs get-queue-attributes \
  --queue-url <QUEUE_URL> \
  --attribute-names RedrivePolicy \
  --region ap-northeast-1
```

期待される出力:
```json
{
  "Attributes": {
    "RedrivePolicy": "{\"deadLetterTargetArn\":\"arn:aws:sqs:ap-northeast-1:123456789012:file-processing-dlq-production\",\"maxReceiveCount\":3}"
  }
}
```

## トラブルシューティング

### DLQ URL が自動取得できない場合

worker_fixed.py の `_get_dlq_url()` メソッドで自動取得を試みますが、失敗する場合は環境変数で明示的に設定してください:

```bash
export DLQ_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/123456789012/file-processing-dlq-production
```

### Visibility Timeout が短すぎる場合の症状

- 同じメッセージが繰り返し処理される
- CloudWatch Logsに同じfile_keyが複数回出現
- `ApproximateNumberOfMessagesNotVisible` (処理中メッセージ数) が異常に多い

### 修正方法

```bash
# 即座変更 (CloudFormation再デプロイ不要)
aws sqs set-queue-attributes \
  --queue-url <QUEUE_URL> \
  --attributes VisibilityTimeout=900 \
  --region ap-northeast-1
```

## 最終更新

**日時**: 2025-12-12
**バージョン**: 1.0
**ステータス**: 実装待ち
