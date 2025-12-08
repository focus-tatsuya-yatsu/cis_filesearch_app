"""
Dead Letter Queue Service
処理失敗メッセージをDLQに送信し、分析機能を提供
"""

import json
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime
from dataclasses import dataclass, asdict

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


@dataclass
class DLQMessage:
    """DLQメッセージの構造"""

    # 元のメッセージ情報
    original_message_id: str
    original_receipt_handle: str
    original_body: str

    # 失敗情報
    failure_reason: str
    error_type: str
    error_message: str
    error_stack_trace: Optional[str] = None

    # メタデータ
    failure_timestamp: str = ""
    retry_count: int = 0
    processing_attempts: List[Dict[str, Any]] = None

    # ファイル情報
    file_key: Optional[str] = None
    file_bucket: Optional[str] = None
    file_size: Optional[int] = None
    file_type: Optional[str] = None

    # 処理情報
    processor_name: Optional[str] = None
    worker_instance_id: Optional[str] = None

    def __post_init__(self):
        if not self.failure_timestamp:
            self.failure_timestamp = datetime.utcnow().isoformat()
        if self.processing_attempts is None:
            self.processing_attempts = []

    def to_dict(self) -> Dict[str, Any]:
        """辞書に変換"""
        return asdict(self)

    def to_json(self) -> str:
        """JSON文字列に変換"""
        return json.dumps(self.to_dict(), indent=2, ensure_ascii=False)


class DeadLetterQueueService:
    """
    デッドレターキューサービス
    処理失敗メッセージの管理と分析機能を提供
    """

    def __init__(self, config):
        """
        初期化

        Args:
            config: アプリケーション設定
        """
        self.config = config
        self.sqs_client = boto3.client('sqs', region_name=config.aws.region)
        self.dlq_url = config.resilience.dlq.dlq_queue_url

        # インスタンスIDを取得（EC2メタデータサービスから）
        self.instance_id = self._get_instance_id()

        logger.info(f"DLQ Service initialized: {self.dlq_url[:50]}...")

    def _get_instance_id(self) -> str:
        """EC2インスタンスIDを取得"""
        try:
            import requests
            response = requests.get(
                'http://169.254.169.254/latest/meta-data/instance-id',
                timeout=1
            )
            return response.text
        except:
            return "unknown"

    def send_to_dlq(
        self,
        original_message: Dict[str, Any],
        failure_reason: str,
        exception: Exception,
        retry_count: int = 0,
        processing_attempts: Optional[List[Dict[str, Any]]] = None
    ) -> bool:
        """
        メッセージをDLQに送信

        Args:
            original_message: 元のSQSメッセージ
            failure_reason: 失敗理由の説明
            exception: 発生した例外
            retry_count: リトライ回数
            processing_attempts: 処理試行の履歴

        Returns:
            送信成功の場合True
        """
        if not self.dlq_url:
            logger.warning("DLQ not configured - message will not be sent to DLQ")
            return False

        try:
            # 元のメッセージからファイル情報を抽出
            message_body = json.loads(original_message.get('Body', '{}'))
            file_info = self._extract_file_info(message_body)

            # DLQメッセージを作成
            dlq_message = DLQMessage(
                original_message_id=original_message.get('MessageId', ''),
                original_receipt_handle=original_message.get('ReceiptHandle', ''),
                original_body=original_message.get('Body', ''),
                failure_reason=failure_reason,
                error_type=type(exception).__name__,
                error_message=str(exception),
                error_stack_trace=self._get_stack_trace(exception),
                retry_count=retry_count,
                processing_attempts=processing_attempts or [],
                file_key=file_info.get('key'),
                file_bucket=file_info.get('bucket'),
                file_size=file_info.get('size'),
                file_type=file_info.get('type'),
                processor_name=file_info.get('processor'),
                worker_instance_id=self.instance_id,
            )

            # DLQに送信
            response = self.sqs_client.send_message(
                QueueUrl=self.dlq_url,
                MessageBody=dlq_message.to_json(),
                MessageAttributes={
                    'FailureReason': {
                        'StringValue': failure_reason,
                        'DataType': 'String'
                    },
                    'ErrorType': {
                        'StringValue': type(exception).__name__,
                        'DataType': 'String'
                    },
                    'RetryCount': {
                        'StringValue': str(retry_count),
                        'DataType': 'Number'
                    },
                    'FileKey': {
                        'StringValue': file_info.get('key', 'unknown'),
                        'DataType': 'String'
                    },
                    'Timestamp': {
                        'StringValue': dlq_message.failure_timestamp,
                        'DataType': 'String'
                    }
                }
            )

            logger.info(
                f"Message sent to DLQ: {response['MessageId']} "
                f"(reason: {failure_reason})"
            )

            # CloudWatch Metricsに記録
            self._publish_dlq_metric(failure_reason, file_info.get('type', 'unknown'))

            return True

        except Exception as e:
            logger.error(f"Failed to send message to DLQ: {e}", exc_info=True)
            return False

    def _extract_file_info(self, message_body: Dict[str, Any]) -> Dict[str, str]:
        """メッセージからファイル情報を抽出"""
        file_info = {}

        try:
            # S3イベント形式
            if 'Records' in message_body:
                record = message_body['Records'][0]
                file_info['key'] = record['s3']['object']['key']
                file_info['bucket'] = record['s3']['bucket']['name']
                file_info['size'] = record['s3']['object'].get('size', 0)
            # カスタム形式
            else:
                file_info['key'] = message_body.get('key', '')
                file_info['bucket'] = message_body.get('bucket', '')
                file_info['size'] = message_body.get('size', 0)

            # ファイルタイプを推測
            if file_info.get('key'):
                from pathlib import Path
                file_info['type'] = Path(file_info['key']).suffix.lower()

        except Exception as e:
            logger.warning(f"Failed to extract file info: {e}")

        return file_info

    def _get_stack_trace(self, exception: Exception) -> str:
        """例外のスタックトレースを取得"""
        import traceback
        return ''.join(traceback.format_exception(
            type(exception),
            exception,
            exception.__traceback__
        ))

    def _publish_dlq_metric(self, failure_reason: str, file_type: str):
        """CloudWatch Metricsに失敗メトリクスを送信"""
        try:
            cloudwatch = boto3.client('cloudwatch', region_name=self.config.aws.region)

            cloudwatch.put_metric_data(
                Namespace='CISFileSearch/Processing',
                MetricData=[
                    {
                        'MetricName': 'DLQMessagesSent',
                        'Value': 1.0,
                        'Unit': 'Count',
                        'Timestamp': datetime.utcnow(),
                        'Dimensions': [
                            {
                                'Name': 'FailureReason',
                                'Value': failure_reason
                            },
                            {
                                'Name': 'FileType',
                                'Value': file_type
                            }
                        ]
                    }
                ]
            )
        except Exception as e:
            logger.warning(f"Failed to publish DLQ metric: {e}")

    def get_dlq_messages(
        self,
        max_messages: int = 10,
        wait_time_seconds: int = 5
    ) -> List[DLQMessage]:
        """
        DLQからメッセージを取得（分析用）

        Args:
            max_messages: 取得する最大メッセージ数
            wait_time_seconds: ロングポーリング時間

        Returns:
            DLQMessageのリスト
        """
        if not self.dlq_url:
            logger.warning("DLQ not configured")
            return []

        try:
            response = self.sqs_client.receive_message(
                QueueUrl=self.dlq_url,
                MaxNumberOfMessages=min(max_messages, 10),
                WaitTimeSeconds=wait_time_seconds,
                MessageAttributeNames=['All']
            )

            messages = []
            for msg in response.get('Messages', []):
                try:
                    body = json.loads(msg['Body'])
                    dlq_message = DLQMessage(**body)
                    messages.append(dlq_message)
                except Exception as e:
                    logger.warning(f"Failed to parse DLQ message: {e}")

            logger.info(f"Retrieved {len(messages)} messages from DLQ")
            return messages

        except Exception as e:
            logger.error(f"Failed to get DLQ messages: {e}")
            return []

    def analyze_dlq_failures(
        self,
        time_range_hours: int = 24
    ) -> Dict[str, Any]:
        """
        DLQの失敗を分析

        Args:
            time_range_hours: 分析対象の時間範囲（時間）

        Returns:
            分析結果の辞書
        """
        messages = self.get_dlq_messages(max_messages=10)

        if not messages:
            return {
                'total_failures': 0,
                'failure_by_reason': {},
                'failure_by_type': {},
                'failure_by_file_type': {},
            }

        # 失敗理由別の集計
        failure_by_reason = {}
        failure_by_type = {}
        failure_by_file_type = {}

        for msg in messages:
            # 失敗理由別
            reason = msg.failure_reason
            failure_by_reason[reason] = failure_by_reason.get(reason, 0) + 1

            # エラータイプ別
            error_type = msg.error_type
            failure_by_type[error_type] = failure_by_type.get(error_type, 0) + 1

            # ファイルタイプ別
            file_type = msg.file_type or 'unknown'
            failure_by_file_type[file_type] = failure_by_file_type.get(file_type, 0) + 1

        return {
            'total_failures': len(messages),
            'failure_by_reason': failure_by_reason,
            'failure_by_type': failure_by_type,
            'failure_by_file_type': failure_by_file_type,
            'sample_messages': [msg.to_dict() for msg in messages[:3]]  # サンプル3件
        }

    def delete_dlq_message(self, receipt_handle: str) -> bool:
        """
        DLQからメッセージを削除

        Args:
            receipt_handle: メッセージのレシートハンドル

        Returns:
            削除成功の場合True
        """
        if not self.dlq_url:
            return False

        try:
            self.sqs_client.delete_message(
                QueueUrl=self.dlq_url,
                ReceiptHandle=receipt_handle
            )
            logger.info("DLQ message deleted")
            return True

        except Exception as e:
            logger.error(f"Failed to delete DLQ message: {e}")
            return False

    def purge_dlq(self) -> bool:
        """
        DLQのすべてのメッセージを削除（注意して使用）

        Returns:
            削除成功の場合True
        """
        if not self.dlq_url:
            return False

        try:
            self.sqs_client.purge_queue(QueueUrl=self.dlq_url)
            logger.warning("DLQ purged - all messages deleted")
            return True

        except Exception as e:
            logger.error(f"Failed to purge DLQ: {e}")
            return False
