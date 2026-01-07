"""
DocuWorks Conversion Request Handler
Windows EC2上のDocuWorks変換サービスへ変換リクエストを送信
"""

import json
import logging
import uuid
from typing import Optional, Dict, Any
from dataclasses import dataclass
import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


@dataclass
class DocuWorksRequestConfig:
    """DocuWorks変換リクエスト設定"""
    # SQS設定
    conversion_queue_url: str = ''      # 変換リクエストキューURL
    callback_queue_url: str = ''        # コールバックキューURL（オプション）

    # S3設定
    source_bucket: str = ''             # 変換元ファイルのバケット
    target_bucket: str = ''             # 変換後PDFの保存先バケット
    converted_pdf_prefix: str = 'converted-pdf/'

    # AWS設定
    aws_region: str = 'ap-northeast-1'


class DocuWorksRequestSender:
    """
    DocuWorks変換リクエスト送信クラス

    Linux EC2ワーカーからWindows EC2の変換サービスへ
    SQSを通じて変換リクエストを送信
    """

    def __init__(self, config: Optional[DocuWorksRequestConfig] = None):
        """初期化"""
        self.config = config or DocuWorksRequestConfig()

        if not self.config.conversion_queue_url:
            logger.warning("DocuWorks conversion queue URL not configured")
            self.sqs_client = None
        else:
            self.sqs_client = boto3.client(
                'sqs',
                region_name=self.config.aws_region
            )
            logger.info(f"DocuWorksRequestSender initialized with queue: {self.config.conversion_queue_url}")

    def is_available(self) -> bool:
        """変換リクエスト送信が利用可能かチェック"""
        return self.sqs_client is not None and bool(self.config.conversion_queue_url)

    def send_conversion_request(
        self,
        s3_key: str,
        file_name: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Optional[str]:
        """
        DocuWorks変換リクエストを送信

        Args:
            s3_key: S3オブジェクトキー（DocuWorksファイル）
            file_name: ファイル名
            metadata: 追加メタデータ（オプション）

        Returns:
            リクエストID、失敗時はNone
        """
        if not self.is_available():
            logger.warning("DocuWorks conversion request not available (queue not configured)")
            return None

        request_id = str(uuid.uuid4())

        message_body = {
            'request_id': request_id,
            's3_key': s3_key,
            'file_name': file_name,
            'source_bucket': self.config.source_bucket,
            'target_bucket': self.config.target_bucket,
            'target_prefix': self.config.converted_pdf_prefix,
            'metadata': metadata or {}
        }

        # コールバックキューがある場合は追加
        if self.config.callback_queue_url:
            message_body['callback_queue'] = self.config.callback_queue_url

        try:
            response = self.sqs_client.send_message(
                QueueUrl=self.config.conversion_queue_url,
                MessageBody=json.dumps(message_body),
                MessageAttributes={
                    'RequestType': {
                        'DataType': 'String',
                        'StringValue': 'DocuWorksConversion'
                    },
                    'FileName': {
                        'DataType': 'String',
                        'StringValue': file_name
                    }
                }
            )

            message_id = response.get('MessageId')
            logger.info(f"Sent DocuWorks conversion request: {request_id} (MessageId: {message_id})")

            return request_id

        except ClientError as e:
            logger.error(f"Failed to send DocuWorks conversion request: {e}")
            return None

    def check_conversion_status(self, s3_key: str) -> Dict[str, Any]:
        """
        変換状態を確認（S3に変換済みPDFが存在するかチェック）

        Args:
            s3_key: 元のDocuWorksファイルのS3キー

        Returns:
            状態情報
        """
        from pathlib import Path

        # 変換後のPDFキーを構築
        pdf_key = f"{self.config.converted_pdf_prefix}{Path(s3_key).stem}.pdf"

        try:
            s3_client = boto3.client('s3', region_name=self.config.aws_region)

            # PDFの存在を確認
            response = s3_client.head_object(
                Bucket=self.config.target_bucket,
                Key=pdf_key
            )

            return {
                'status': 'completed',
                'pdf_key': pdf_key,
                'pdf_size': response.get('ContentLength', 0),
                'last_modified': response.get('LastModified')
            }

        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                return {
                    'status': 'pending',
                    'pdf_key': pdf_key,
                    'message': 'PDF not yet available'
                }
            else:
                logger.error(f"Error checking conversion status: {e}")
                return {
                    'status': 'error',
                    'message': str(e)
                }


# 環境変数から設定を読み込むヘルパー
def create_docuworks_request_sender_from_env() -> DocuWorksRequestSender:
    """環境変数からDocuWorksRequestSenderを作成"""
    import os

    config = DocuWorksRequestConfig(
        conversion_queue_url=os.environ.get('DOCUWORKS_CONVERSION_QUEUE_URL', ''),
        callback_queue_url=os.environ.get('DOCUWORKS_CALLBACK_QUEUE_URL', ''),
        source_bucket=os.environ.get('S3_LANDING_BUCKET', ''),
        target_bucket=os.environ.get('S3_THUMBNAIL_BUCKET', ''),
        converted_pdf_prefix=os.environ.get('DOCUWORKS_CONVERTED_PREFIX', 'converted-pdf/'),
        aws_region=os.environ.get('AWS_REGION', 'ap-northeast-1')
    )

    return DocuWorksRequestSender(config)
