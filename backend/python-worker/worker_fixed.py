"""
Main Worker Module - FIXED VERSION
EC2 File Processing Worker with Enhanced Error Handling
Polls SQS, downloads files from S3, processes them, and indexes to OpenSearch

CHANGES FROM ORIGINAL:
1. Added _send_to_dlq() method to explicitly send failed messages to DLQ
2. Modified message handling to ALWAYS delete messages from main queue
3. Improved error handling with proper cleanup
4. Added message processing state tracking
"""

import os
import sys
import json
import time
import logging
import tempfile
import argparse
import signal
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

from config import get_config
from file_router import FileRouter
from opensearch_client import OpenSearchClient


# Configure logging
def setup_logging(config):
    """Setup logging configuration"""
    log_level = config.logging.get_log_level()

    # Create formatter
    formatter = logging.Formatter(
        config.logging.log_format,
        datefmt=config.logging.date_format
    )

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)

    # File handler
    try:
        file_handler = logging.FileHandler(config.logging.log_file)
        file_handler.setFormatter(formatter)
        handlers = [console_handler, file_handler]
    except:
        handlers = [console_handler]

    # Configure root logger
    logging.basicConfig(
        level=log_level,
        handlers=handlers
    )

    # Suppress noisy loggers
    logging.getLogger('boto3').setLevel(logging.WARNING)
    logging.getLogger('botocore').setLevel(logging.WARNING)
    logging.getLogger('urllib3').setLevel(logging.WARNING)

    logger = logging.getLogger(__name__)
    logger.info("Logging configured")

    return logger


class FileProcessingWorker:
    """
    Main worker class for file processing
    Handles the complete pipeline: SQS → S3 → Process → OpenSearch

    ENHANCEMENTS:
    - Guaranteed message deletion from main queue
    - Explicit DLQ handling for failed messages
    - Improved error recovery
    """

    def __init__(self, config):
        """
        Initialize worker

        Args:
            config: Configuration object
        """
        self.config = config
        self.logger = logging.getLogger(__name__)
        self.shutdown_requested = False

        # Initialize AWS clients
        self.s3_client = boto3.client('s3', region_name=config.aws.region)
        self.sqs_client = boto3.client('sqs', region_name=config.aws.region)

        # Initialize file router
        self.file_router = FileRouter(config)

        # Initialize OpenSearch client
        self.opensearch = OpenSearchClient(config)

        # Setup signal handlers for graceful shutdown
        signal.signal(signal.SIGTERM, self._handle_shutdown_signal)
        signal.signal(signal.SIGINT, self._handle_shutdown_signal)

        # Statistics
        self.stats = {
            'processed': 0,
            'succeeded': 0,
            'failed': 0,
            'sent_to_dlq': 0,
            'start_time': time.time(),
        }

        # DLQ URL (取得)
        self.dlq_url = self._get_dlq_url()

        self.logger.info("Worker initialized successfully")

    def _get_dlq_url(self) -> Optional[str]:
        """
        Get DLQ URL from environment or derive from main queue

        Returns:
            DLQ URL or None
        """
        # 環境変数から直接取得を試みる
        dlq_url = os.environ.get('DLQ_QUEUE_URL')
        if dlq_url:
            self.logger.info(f"DLQ URL from env: {dlq_url}")
            return dlq_url

        # メインキューのURLからDLQ名を推測
        try:
            main_queue_url = self.config.aws.sqs_queue_url
            # file-processing-queue-production → file-processing-dlq-production
            dlq_name = main_queue_url.split('/')[-1].replace('queue', 'dlq')

            response = self.sqs_client.get_queue_url(QueueName=dlq_name)
            dlq_url = response['QueueUrl']
            self.logger.info(f"DLQ URL derived: {dlq_url}")
            return dlq_url
        except Exception as e:
            self.logger.warning(f"Could not get DLQ URL: {e}")
            return None

    def _handle_shutdown_signal(self, signum, frame):
        """Handle shutdown signals"""
        self.logger.info(f"Received signal {signum}, initiating graceful shutdown...")
        self.shutdown_requested = True

    def _send_to_dlq(self, message: Dict[str, Any], error_message: str = None):
        """
        Send failed message to Dead Letter Queue

        NEW METHOD: Explicitly handles failed messages

        Args:
            message: SQS message
            error_message: Error description
        """
        if not self.dlq_url:
            self.logger.warning("DLQ URL not configured - cannot send failed message")
            return False

        try:
            # メッセージ本文を取得
            message_body = message.get('Body', '{}')

            # メッセージ属性を準備
            message_attributes = {
                'FailedAt': {
                    'StringValue': datetime.utcnow().isoformat(),
                    'DataType': 'String'
                },
                'OriginalMessageId': {
                    'StringValue': message.get('MessageId', 'unknown'),
                    'DataType': 'String'
                }
            }

            if error_message:
                message_attributes['ErrorMessage'] = {
                    'StringValue': error_message[:256],  # DynamoDB制限対策
                    'DataType': 'String'
                }

            # DLQに送信
            self.sqs_client.send_message(
                QueueUrl=self.dlq_url,
                MessageBody=message_body,
                MessageAttributes=message_attributes
            )

            self.logger.info(f"Message sent to DLQ: {message.get('MessageId')}")
            self.stats['sent_to_dlq'] += 1
            return True

        except Exception as e:
            self.logger.error(f"Failed to send message to DLQ: {e}", exc_info=True)
            return False

    def download_file_from_s3(
        self,
        bucket: str,
        key: str,
        local_path: str
    ) -> bool:
        """
        Download file from S3

        Args:
            bucket: S3 bucket name
            key: S3 object key
            local_path: Local file path to save

        Returns:
            True if successful
        """
        try:
            self.logger.info(f"Downloading s3://{bucket}/{key}")

            self.s3_client.download_file(bucket, key, local_path)

            file_size = os.path.getsize(local_path)
            self.logger.info(f"Downloaded {file_size:,} bytes")

            return True

        except ClientError as e:
            self.logger.error(f"S3 download failed: {e}")
            return False
        except Exception as e:
            self.logger.error(f"Unexpected error during download: {e}")
            return False

    def upload_thumbnail_to_s3(
        self,
        thumbnail_data: bytes,
        bucket: str,
        key: str
    ) -> Optional[str]:
        """
        Upload thumbnail to S3

        Args:
            thumbnail_data: Thumbnail image data
            bucket: S3 bucket name
            key: S3 object key (original file key)

        Returns:
            S3 URL of uploaded thumbnail or None
        """
        try:
            # Create thumbnail key
            thumbnail_key = f"thumbnails/{key}.jpg"

            # Upload thumbnail
            self.s3_client.put_object(
                Bucket=bucket,
                Key=thumbnail_key,
                Body=thumbnail_data,
                ContentType='image/jpeg',
                Metadata={
                    'original-key': key
                }
            )

            thumbnail_url = f"s3://{bucket}/{thumbnail_key}"
            self.logger.debug(f"Uploaded thumbnail: {thumbnail_url}")

            return thumbnail_url

        except Exception as e:
            self.logger.warning(f"Failed to upload thumbnail: {e}")
            return None

    def process_sqs_message(self, message: Dict[str, Any]) -> tuple[bool, str]:
        """
        Process a single SQS message

        MODIFIED: Now returns (success, error_message) tuple

        Args:
            message: SQS message

        Returns:
            (success, error_message): Processing result and error description
        """
        temp_file_path = None

        try:
            # Parse message body
            body = json.loads(message['Body'])

            # Extract file information
            if 'Records' in body:
                # S3 event notification format
                record = body['Records'][0]
                bucket = record['s3']['bucket']['name']
                key = record['s3']['object']['key']
            else:
                # Custom message format
                bucket = body.get('bucket', self.config.aws.s3_bucket)
                key = body['key']

            self.logger.info(f"Processing: s3://{bucket}/{key}")

            # Check if file type is supported
            if not self.file_router.is_supported(key):
                ext = Path(key).suffix.lower()
                error_msg = f"Unsupported file type: {ext}"
                self.logger.warning(error_msg)
                return (False, error_msg)

            # Create temporary file
            file_ext = Path(key).suffix
            with tempfile.NamedTemporaryFile(
                suffix=file_ext,
                delete=False,
                dir=self.config.processing.temp_dir
            ) as tmp_file:
                temp_file_path = tmp_file.name

            # Download file from S3
            if not self.download_file_from_s3(bucket, key, temp_file_path):
                error_msg = "S3 download failed"
                return (False, error_msg)

            # Process file
            self.logger.info("Starting file processing...")
            result = self.file_router.process_file(temp_file_path)

            if not result.success:
                error_msg = f"Processing failed: {result.error_message}"
                self.logger.error(error_msg)
                return (False, error_msg)

            # Prepare document for indexing
            document = result.to_dict()
            document['file_key'] = key
            document['bucket'] = bucket
            document['s3_url'] = f"s3://{bucket}/{key}"

            # Upload thumbnail if available
            if result.thumbnail_data:
                thumbnail_url = self.upload_thumbnail_to_s3(
                    result.thumbnail_data,
                    bucket,
                    key
                )
                if thumbnail_url:
                    document['thumbnail_url'] = thumbnail_url

            # Index to OpenSearch
            if self.opensearch.is_connected():
                self.logger.info("Indexing to OpenSearch...")
                if not self.opensearch.index_document(document, document_id=key):
                    error_msg = "Failed to index document to OpenSearch"
                    self.logger.error(error_msg)
                    return (False, error_msg)

                self.logger.info("Successfully indexed document")
            else:
                self.logger.warning("OpenSearch not connected - skipping indexing")

            self.logger.info(
                f"Successfully processed: {Path(key).name} "
                f"({result.char_count:,} chars, {result.processing_time_seconds:.2f}s)"
            )

            return (True, None)

        except json.JSONDecodeError as e:
            error_msg = f"Invalid message format: {e}"
            self.logger.error(error_msg)
            return (False, error_msg)

        except Exception as e:
            error_msg = f"Error processing message: {e}"
            self.logger.error(error_msg, exc_info=True)
            return (False, error_msg)

        finally:
            # Cleanup temporary file
            if temp_file_path and os.path.exists(temp_file_path):
                try:
                    os.remove(temp_file_path)
                    self.logger.debug(f"Removed temporary file: {temp_file_path}")
                except Exception as e:
                    self.logger.warning(f"Failed to remove temporary file: {e}")

    def poll_and_process(self):
        """
        Main worker loop
        Polls SQS and processes messages

        MODIFIED: Enhanced error handling with guaranteed message deletion
        """
        self.logger.info("Starting to poll SQS queue...")
        self.logger.info(f"Queue URL: {self.config.aws.sqs_queue_url[:50]}...")

        # Create OpenSearch index if it doesn't exist
        if self.opensearch.is_connected():
            self.opensearch.create_index()

        while not self.shutdown_requested:
            try:
                # Receive messages from SQS
                response = self.sqs_client.receive_message(
                    QueueUrl=self.config.aws.sqs_queue_url,
                    MaxNumberOfMessages=self.config.aws.sqs_max_messages,
                    WaitTimeSeconds=self.config.aws.sqs_wait_time_seconds,
                    VisibilityTimeout=self.config.aws.sqs_visibility_timeout,
                )

                messages = response.get('Messages', [])

                if not messages:
                    self.logger.debug("No messages received")
                    continue

                self.logger.info(f"Received {len(messages)} message(s)")

                # Process each message
                for message in messages:
                    if self.shutdown_requested:
                        self.logger.info("Shutdown requested, stopping message processing")
                        break

                    receipt_handle = message['ReceiptHandle']
                    message_id = message.get('MessageId', 'unknown')
                    self.stats['processed'] += 1

                    # メッセージ削除フラグ (必ず削除するため)
                    should_delete = True
                    send_to_dlq = False
                    error_message = None

                    try:
                        # Process the message
                        success, error_msg = self.process_sqs_message(message)

                        if success:
                            self.logger.info(f"Message {message_id} processed successfully")
                            self.stats['succeeded'] += 1
                        else:
                            self.logger.error(f"Message {message_id} processing failed: {error_msg}")
                            send_to_dlq = True
                            error_message = error_msg
                            self.stats['failed'] += 1

                    except Exception as e:
                        self.logger.error(f"Unexpected error processing message {message_id}: {e}", exc_info=True)
                        send_to_dlq = True
                        error_message = str(e)
                        self.stats['failed'] += 1

                    # 失敗したメッセージをDLQに送信
                    if send_to_dlq:
                        self._send_to_dlq(message, error_message)

                    # メッセージを必ず削除 (成功/失敗に関わらず)
                    if should_delete:
                        try:
                            self.sqs_client.delete_message(
                                QueueUrl=self.config.aws.sqs_queue_url,
                                ReceiptHandle=receipt_handle
                            )
                            self.logger.info(f"Message {message_id} deleted from queue")
                        except Exception as e:
                            self.logger.error(f"Failed to delete message {message_id}: {e}", exc_info=True)
                            # 削除失敗は重大なエラー - 再度キューに表示される可能性
                            # CloudWatch Alarmで検知できるようにメトリクスを送信
                            self._send_metric('MessageDeleteFailed', 1)

            except KeyboardInterrupt:
                self.logger.info("Received keyboard interrupt")
                break

            except Exception as e:
                self.logger.error(f"Error in polling loop: {e}", exc_info=True)
                # Don't exit, continue processing
                time.sleep(5)

        self.logger.info("Worker stopped")
        self._print_statistics()

    def _send_metric(self, metric_name: str, value: float):
        """
        Send custom metric to CloudWatch

        NEW METHOD: For monitoring critical failures

        Args:
            metric_name: Metric name
            value: Metric value
        """
        try:
            cloudwatch = boto3.client('cloudwatch', region_name=self.config.aws.region)
            cloudwatch.put_metric_data(
                Namespace='CISFileSearch/Worker',
                MetricData=[
                    {
                        'MetricName': metric_name,
                        'Value': value,
                        'Unit': 'Count',
                        'Timestamp': datetime.utcnow()
                    }
                ]
            )
        except Exception as e:
            self.logger.warning(f"Failed to send metric {metric_name}: {e}")

    def _print_statistics(self):
        """Print worker statistics"""
        runtime = time.time() - self.stats['start_time']
        runtime_hours = runtime / 3600

        self.logger.info("=== Worker Statistics ===")
        self.logger.info(f"Runtime: {runtime:.0f} seconds ({runtime_hours:.2f} hours)")
        self.logger.info(f"Total Processed: {self.stats['processed']}")
        self.logger.info(f"Succeeded: {self.stats['succeeded']}")
        self.logger.info(f"Failed: {self.stats['failed']}")
        self.logger.info(f"Sent to DLQ: {self.stats['sent_to_dlq']}")

        if self.stats['processed'] > 0:
            success_rate = (self.stats['succeeded'] / self.stats['processed']) * 100
            self.logger.info(f"Success Rate: {success_rate:.1f}%")

            if runtime > 0:
                throughput = self.stats['processed'] / runtime_hours
                self.logger.info(f"Throughput: {throughput:.1f} files/hour")

        self.logger.info("========================")


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description='File Processing Worker for AWS EC2 (FIXED VERSION)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Environment Variables:
  AWS_REGION              AWS region (default: ap-northeast-1)
  S3_BUCKET              S3 bucket name
  SQS_QUEUE_URL          SQS queue URL (required)
  DLQ_QUEUE_URL          DLQ queue URL (optional, will be derived if not provided)
  OPENSEARCH_ENDPOINT    OpenSearch endpoint URL
  OPENSEARCH_INDEX       OpenSearch index name (default: file-index)
  LOG_LEVEL              Logging level (DEBUG, INFO, WARNING, ERROR)

Example:
  python worker_fixed.py
  python worker_fixed.py --validate-only
        """
    )

    parser.add_argument(
        '--validate-only',
        action='store_true',
        help='Validate configuration and exit'
    )

    parser.add_argument(
        '--create-index',
        action='store_true',
        help='Create OpenSearch index and exit'
    )

    args = parser.parse_args()

    # Load configuration
    config = get_config()

    # Setup logging
    logger = setup_logging(config)

    logger.info("=" * 60)
    logger.info("File Processing Worker (FIXED VERSION) - Starting")
    logger.info("=" * 60)

    # Print configuration summary
    config.print_summary()

    # Validate configuration
    if not config.validate():
        logger.error("Configuration validation failed")
        sys.exit(1)

    if args.validate_only:
        logger.info("Configuration is valid")
        sys.exit(0)

    # Create OpenSearch index if requested
    if args.create_index:
        logger.info("Creating OpenSearch index...")
        opensearch = OpenSearchClient(config)
        if opensearch.create_index():
            logger.info("Index created successfully")
            sys.exit(0)
        else:
            logger.error("Failed to create index")
            sys.exit(1)

    # Create and start worker
    try:
        worker = FileProcessingWorker(config)
        worker.poll_and_process()

    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
