# SQS/DLQ問題への影響分析 - AMI構成の観点から

## 概要

現在発生しているSQS/DLQ問題に対して、AMI構成がどのような影響を与えているか、またどのように対処すべきかを分析します。

## 現在の問題状況

### 観測された症状
- DLQにメッセージが蓄積
- 処理失敗率の増加
- エラーログの増加

### 考えられる根本原因

AMI構成の観点から考えられる原因:

#### 1. 環境変数の未設定・誤設定

**問題**: AMI作成時に環境変数がハードコードされていない、またはUser Dataで正しく注入されていない

**確認方法**:
```bash
# インスタンスにSSH接続後
sudo -u appuser env | grep -E "(SQS|OPENSEARCH|S3)"
```

**対策**:
- User Dataスクリプトで環境変数を `/etc/file-processor/env` に正しく書き込む
- systemdサービスで `EnvironmentFile=/etc/file-processor/env` を読み込む
- 環境変数の値を検証する起動前チェックを追加

#### 2. Python依存関係のバージョン不一致

**問題**: AMI内のPythonパッケージバージョンが古い、または互換性がない

**確認方法**:
```bash
pip3.11 list | grep -E "(boto3|botocore|opensearch)"
# 特にboto3とbotocoreのバージョン確認
```

**対策**:
- `requirements.txt` でバージョン固定
- AMI作成時に `pip freeze > installed-packages.txt` で記録
- CI/CDパイプラインで依存関係のテスト実施

#### 3. SQS Visibility Timeoutの不整合

**問題**: 処理時間がVisibility Timeoutより長い、または設定が不適切

**現在の設定**:
- `config.py`: `sqs_visibility_timeout = 300` (5分)
- `worker.py`: この値でメッセージ受信
- Terraform: 900秒 (15分)

**問題の特定**:
```python
# worker.py の処理時間ログ確認
# "Successfully processed: ... (XX.XXs)" の値が300秒を超えているか
```

**対策**:
```bash
# User Dataで環境変数を追加
export SQS_VISIBILITY_TIMEOUT="900"

# またはconfig.pyのデフォルト値を変更
# sqs_visibility_timeout: int = int(os.environ.get('SQS_VISIBILITY_TIMEOUT', '900'))
```

#### 4. OpenSearch接続エラー

**問題**: OpenSearchエンドポイントへの接続失敗、認証エラー

**確認方法**:
```bash
# インスタンス内から
curl -X GET "${OPENSEARCH_ENDPOINT}/_cluster/health?pretty"

# IAMロール認証テスト
aws es describe-elasticsearch-domain \
  --domain-name cis-filesearch \
  --region ap-northeast-1
```

**対策**:
- IAMロールにOpenSearchアクセス権限を追加
- セキュリティグループで443ポートへのアウトバウンドを許可
- OpenSearchのアクセスポリシーでEC2からのアクセスを許可

#### 5. S3ダウンロードエラー

**問題**: S3からのファイルダウンロード失敗

**確認方法**:
```bash
# CloudWatch Logsで確認
aws logs filter-log-events \
  --log-group-name /aws/ec2/file-processor \
  --filter-pattern "S3 download failed" \
  --start-time $(($(date +%s) * 1000 - 3600000))
```

**対策**:
- IAMロールにS3読み取り権限を確認
- バケットポリシーでアクセス許可
- リージョン間アクセスの場合は追加設定

#### 6. メモリ不足によるクラッシュ

**問題**: 大容量ファイル処理時にメモリ不足で処理失敗

**確認方法**:
```bash
# dmesgでOOM Killerのログ確認
dmesg | grep -i "killed process"

# メモリ使用状況
free -h
top -o %MEM
```

**対策**:
```bash
# 環境変数で制限
export MAX_FILE_SIZE_MB="50"  # 100から削減
export MAX_WORKERS="2"  # 4から削減

# スワップ領域の追加
sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

## AMI構成の改善提案

### 1. ヘルスチェック機構の追加

AMIに以下のヘルスチェックスクリプトを追加:

```bash
#!/bin/bash
# /usr/local/bin/health-check.sh

set -e

# 環境変数チェック
if [ -z "$SQS_QUEUE_URL" ]; then
    echo "ERROR: SQS_QUEUE_URL not set"
    exit 1
fi

# SQS接続チェック
if ! aws sqs get-queue-attributes \
    --queue-url "$SQS_QUEUE_URL" \
    --attribute-names All \
    --region "$AWS_REGION" &>/dev/null; then
    echo "ERROR: Cannot connect to SQS"
    exit 1
fi

# OpenSearch接続チェック
if [ -n "$OPENSEARCH_ENDPOINT" ]; then
    if ! curl -s -o /dev/null -w "%{http_code}" "$OPENSEARCH_ENDPOINT/_cluster/health" | grep -E "200|401"; then
        echo "ERROR: Cannot connect to OpenSearch"
        exit 1
    fi
fi

# S3接続チェック
if ! aws s3 ls "s3://$S3_BUCKET/" --region "$AWS_REGION" &>/dev/null; then
    echo "ERROR: Cannot access S3 bucket"
    exit 1
fi

echo "Health check passed"
exit 0
```

systemdサービスに追加:
```ini
[Service]
ExecStartPre=/usr/local/bin/health-check.sh
```

### 2. 詳細ログ設定

CloudWatch Logsへの構造化ログ出力:

```python
# config.py に追加
import json
import logging

class CloudWatchFormatter(logging.Formatter):
    def format(self, record):
        log_data = {
            'timestamp': self.formatTime(record),
            'level': record.levelname,
            'logger': record.name,
            'message': record.getMessage(),
            'instance_id': os.environ.get('INSTANCE_ID', 'unknown'),
        }

        if record.exc_info:
            log_data['exception'] = self.formatException(record.exc_info)

        return json.dumps(log_data)
```

### 3. 自動リトライ機構の強化

```python
# worker.py の process_sqs_message にリトライロジック追加

from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    reraise=True
)
def download_file_with_retry(self, bucket, key, local_path):
    """S3ダウンロード with リトライ"""
    return self.download_file_from_s3(bucket, key, local_path)
```

### 4. メトリクス収集の追加

```python
# worker.py にカスタムメトリクス追加

import boto3
cloudwatch = boto3.client('cloudwatch')

def publish_metric(metric_name, value, unit='Count'):
    """CloudWatchカスタムメトリクス送信"""
    cloudwatch.put_metric_data(
        Namespace='FileProcessor/Worker',
        MetricData=[{
            'MetricName': metric_name,
            'Value': value,
            'Unit': unit,
            'Dimensions': [
                {'Name': 'InstanceId', 'Value': os.environ.get('INSTANCE_ID', 'unknown')}
            ]
        }]
    )

# 処理成功/失敗時に呼び出し
publish_metric('ProcessingSuccess', 1)
publish_metric('ProcessingFailure', 1)
publish_metric('ProcessingTime', processing_time, 'Seconds')
```

## 問題の根本原因特定フロー

```
┌─────────────────────────────────────┐
│ DLQにメッセージが蓄積               │
└───────────────┬─────────────────────┘
                │
                ▼
    ┌───────────────────────┐
    │ CloudWatch Logsで     │
    │ エラーパターン分析    │
    └───────┬───────────────┘
            │
            ▼
    ┌───────────────────────────────┐
    │ エラータイプ分類              │
    ├───────────────────────────────┤
    │ 1. S3 download failed         │──► IAMロール権限確認
    │ 2. OpenSearch index failed    │──► OpenSearch接続確認
    │ 3. Processing timeout         │──► Visibility Timeout調整
    │ 4. Memory error              │──► インスタンスタイプ変更
    │ 5. Tesseract error           │──► OCR設定確認
    └───────────────────────────────┘
```

### 具体的な調査コマンド

```bash
# 1. DLQメッセージのサンプル取得
aws sqs receive-message \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/xxx/dlq \
  --max-number-of-messages 10 \
  --attribute-names All \
  --message-attribute-names All \
  --output json > dlq-messages.json

# 2. エラーパターン抽出
cat dlq-messages.json | jq -r '.Messages[].Body' | jq -r '.key'

# 3. CloudWatch Logsでエラー検索
aws logs filter-log-events \
  --log-group-name /aws/ec2/file-processor \
  --filter-pattern "ERROR" \
  --start-time $(($(date +%s) * 1000 - 3600000)) \
  | jq -r '.events[].message' \
  | sort | uniq -c | sort -rn

# 4. 特定ファイルのエラー追跡
FILE_KEY="path/to/problematic/file.pdf"
aws logs filter-log-events \
  --log-group-name /aws/ec2/file-processor \
  --filter-pattern "$FILE_KEY" \
  --start-time $(($(date +%s) * 1000 - 86400000))
```

## 即座に実施すべき対策

### Phase 1: 緊急対応 (今すぐ)

1. **現在のインスタンスで診断スクリプト実行**
   ```bash
   bash scripts/debug-worker.sh > debug-report.txt
   ```

2. **環境変数の確認と修正**
   ```bash
   # User Dataで正しい値を設定
   # Launch Templateを更新してインスタンスリフレッシュ
   ```

3. **Visibility Timeoutの延長**
   ```bash
   # Terraformで設定更新
   sqs_visibility_timeout = 900  # 15分に延長
   ```

### Phase 2: 短期対応 (24時間以内)

1. **AMI更新**
   - ヘルスチェックスクリプト追加
   - 環境変数検証強化
   - 依存関係の最新化

2. **モニタリング強化**
   - CloudWatchダッシュボード作成
   - カスタムメトリクス追加
   - アラート設定

### Phase 3: 中長期対応 (1週間以内)

1. **アーキテクチャ改善**
   - リトライロジック実装
   - サーキットブレーカーパターン導入
   - 処理タイムアウト管理

2. **自動復旧機構**
   - DLQリプレイ機能
   - 失敗ファイルの自動再試行
   - 異常検知と自動スケーリング

## まとめ

AMI構成の観点から、SQS/DLQ問題の主な原因は以下の可能性が高い:

1. **環境変数の未設定・誤設定** (最優先で確認)
2. **Visibility Timeoutの不足**
3. **IAMロール権限の不足**
4. **メモリ不足**

本ドキュメントで提供したスクリプトとチェックリストを使用して、体系的に問題を特定し、AMI構成を改善してください。
