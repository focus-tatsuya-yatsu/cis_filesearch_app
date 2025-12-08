"""
SQS Message Handler for File Processing
"""

import logging
import json
import time
import signal
from typing import Optional, List, Dict, Any
from concurrent.futures import ThreadPoolExecutor, as_completed
import boto3
from botocore.exceptions import ClientError
from config import config

logger = logging.getLogger(__name__)


class SQSHandler:
    """SQSメッセージハンドラー"""

    def __init__(self, message_processor):
        """
        初期化

        Args:
            message_processor: メッセージを処理する関数
        """
        self.sqs = boto3.client('sqs', **config.get_boto3_config())
        self.queue_url = config.sqs.queue_url
        self.visibility_timeout = config.sqs.visibility_timeout
        self.max_messages = config.sqs.max_messages
        self.message_processor = message_processor

        # スレッドプール設定
        self.executor = ThreadPoolExecutor(max_workers=config.worker.threads)

        # シャットダウンフラグ
        self.shutdown_requested = False

        # シグナルハンドラー設定（Spot中断対応）
        signal.signal(signal.SIGTERM, self._handle_shutdown_signal)
        signal.signal(signal.SIGINT, self._handle_shutdown_signal)

        logger.info(f"Initialized SQS handler for queue: {self.queue_url}")

    def start_polling(self):
        """
        SQSポーリングを開始（メインループ）
        """
        logger.info("Starting SQS polling...")

        while not self.shutdown_requested:
            try:
                # メッセージを取得
                messages = self._receive_messages()

                if messages:
                    logger.info(f"Received {len(messages)} messages from SQS")
                    self._process_messages(messages)
                else:
                    # メッセージがない場合は少し待機
                    time.sleep(config.worker.poll_interval)

            except KeyboardInterrupt:
                logger.info("Received keyboard interrupt")
                self.shutdown()
                break

            except Exception as e:
                logger.error(f"Error in polling loop: {str(e)}")
                time.sleep(10)  # エラー時は少し待機

        logger.info("SQS polling stopped")

    def _receive_messages(self) -> List[Dict]:
        """
        SQSからメッセージを受信

        Returns:
            メッセージのリスト
        """
        try:
            response = self.sqs.receive_message(
                QueueUrl=self.queue_url,
                MaxNumberOfMessages=self.max_messages,
                VisibilityTimeout=self.visibility_timeout,
                WaitTimeSeconds=20,  # Long Polling（20秒待機）
                MessageAttributeNames=['All']
            )

            messages = response.get('Messages', [])
            return messages

        except ClientError as e:
            logger.error(f"Failed to receive messages from SQS: {str(e)}")
            return []

    def _process_messages(self, messages: List[Dict]):
        """
        メッセージを並列処理

        Args:
            messages: SQSメッセージのリスト
        """
        futures = []

        # 各メッセージを並列処理
        for message in messages:
            future = self.executor.submit(self._process_single_message, message)
            futures.append((future, message))

        # 処理完了を待機
        for future, message in futures:
            try:
                # 処理結果を取得
                success = future.result(timeout=self.visibility_timeout - 10)

                if success:
                    # 処理成功：メッセージを削除
                    self._delete_message(message)
                else:
                    # 処理失敗：メッセージは自動的に再表示される
                    logger.warning(f"Message processing failed, will be retried")

            except Exception as e:
                logger.error(f"Error processing message: {str(e)}")

    def _process_single_message(self, message: Dict) -> bool:
        """
        単一メッセージを処理

        Args:
            message: SQSメッセージ

        Returns:
            処理成功の場合True
        """
        try:
            # メッセージ本文を解析
            body = json.loads(message['Body'])

            # EventBridge経由のS3イベントの場合
            if 'detail' in body:
                return self._process_s3_event(body['detail'])

            # 直接のS3イベントの場合
            elif 'Records' in body:
                for record in body['Records']:
                    if record.get('eventSource') == 'aws:s3':
                        return self._process_s3_record(record)

            # カスタムメッセージの場合
            else:
                return self._process_custom_message(body)

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse message body: {str(e)}")
            return False

        except Exception as e:
            logger.error(f"Failed to process message: {str(e)}")
            return False

    def _process_s3_event(self, detail: Dict) -> bool:
        """
        EventBridge経由のS3イベントを処理

        Args:
            detail: イベント詳細

        Returns:
            処理成功の場合True
        """
        try:
            bucket = detail.get('bucket', {}).get('name')
            key = detail.get('object', {}).get('key')

            if not bucket or not key:
                logger.error("Missing bucket or key in S3 event")
                return False

            logger.info(f"Processing S3 file: s3://{bucket}/{key}")

            # ファイル処理を実行
            return self.message_processor(bucket, key)

        except Exception as e:
            logger.error(f"Failed to process S3 event: {str(e)}")
            return False

    def _process_s3_record(self, record: Dict) -> bool:
        """
        S3イベントレコードを処理

        Args:
            record: S3イベントレコード

        Returns:
            処理成功の場合True
        """
        try:
            bucket = record['s3']['bucket']['name']
            key = record['s3']['object']['key']

            logger.info(f"Processing S3 file: s3://{bucket}/{key}")

            # ファイル処理を実行
            return self.message_processor(bucket, key)

        except Exception as e:
            logger.error(f"Failed to process S3 record: {str(e)}")
            return False

    def _process_custom_message(self, body: Dict) -> bool:
        """
        カスタムメッセージを処理

        Args:
            body: メッセージ本文

        Returns:
            処理成功の場合True
        """
        try:
            # カスタムメッセージタイプに応じて処理
            message_type = body.get('type')

            if message_type == 'sync_start':
                # 同期開始メッセージ
                logger.info("Received sync start message")
                return self._handle_sync_start(body)

            elif message_type == 'reindex':
                # 再インデックスメッセージ
                logger.info("Received reindex message")
                return self._handle_reindex(body)

            else:
                logger.warning(f"Unknown message type: {message_type}")
                return True  # 不明なメッセージは削除

        except Exception as e:
            logger.error(f"Failed to process custom message: {str(e)}")
            return False

    def _handle_sync_start(self, body: Dict) -> bool:
        """
        同期開始メッセージを処理

        Args:
            body: メッセージ本文

        Returns:
            処理成功の場合True
        """
        try:
            logger.info("Starting file synchronization...")
            # 同期処理の実装（DataSyncトリガーなど）
            return True

        except Exception as e:
            logger.error(f"Sync start failed: {str(e)}")
            return False

    def _handle_reindex(self, body: Dict) -> bool:
        """
        再インデックスメッセージを処理

        Args:
            body: メッセージ本文

        Returns:
            処理成功の場合True
        """
        try:
            file_path = body.get('file_path')
            if file_path:
                logger.info(f"Reindexing file: {file_path}")
                # 再インデックス処理
                return True
            else:
                logger.error("No file_path in reindex message")
                return False

        except Exception as e:
            logger.error(f"Reindex failed: {str(e)}")
            return False

    def _delete_message(self, message: Dict):
        """
        処理済みメッセージを削除

        Args:
            message: SQSメッセージ
        """
        try:
            self.sqs.delete_message(
                QueueUrl=self.queue_url,
                ReceiptHandle=message['ReceiptHandle']
            )
            logger.debug(f"Deleted message: {message['MessageId']}")

        except ClientError as e:
            logger.error(f"Failed to delete message: {str(e)}")

    def _handle_shutdown_signal(self, signum, frame):
        """
        シャットダウンシグナルを処理（Spot中断対応）

        Args:
            signum: シグナル番号
            frame: フレーム
        """
        logger.info(f"Received shutdown signal: {signum}")
        self.shutdown()

    def shutdown(self):
        """
        グレースフルシャットダウン
        """
        logger.info("Initiating graceful shutdown...")
        self.shutdown_requested = True

        # スレッドプールをシャットダウン
        self.executor.shutdown(wait=True, timeout=config.worker.shutdown_timeout)

        logger.info("Shutdown complete")

    def get_queue_attributes(self) -> Dict:
        """
        キュー属性を取得

        Returns:
            キュー属性の辞書
        """
        try:
            response = self.sqs.get_queue_attributes(
                QueueUrl=self.queue_url,
                AttributeNames=['All']
            )
            return response.get('Attributes', {})

        except ClientError as e:
            logger.error(f"Failed to get queue attributes: {str(e)}")
            return {}

    def get_queue_depth(self) -> int:
        """
        キューの深さ（待機メッセージ数）を取得

        Returns:
            待機メッセージ数
        """
        attributes = self.get_queue_attributes()
        visible = int(attributes.get('ApproximateNumberOfMessages', 0))
        not_visible = int(attributes.get('ApproximateNumberOfMessagesNotVisible', 0))
        delayed = int(attributes.get('ApproximateNumberOfMessagesDelayed', 0))

        total = visible + not_visible + delayed
        return total