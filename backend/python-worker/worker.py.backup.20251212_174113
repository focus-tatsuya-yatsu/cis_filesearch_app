"""
Main Worker Module
EC2 File Processing Worker
Polls SQS, downloads files from S3, processes them, and indexes to OpenSearch
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
            'start_time': time.time(),
        }

        self.logger.info("Worker initialized successfully")

    def _handle_shutdown_signal(self, signum, frame):
        """Handle shutdown signals"""
        self.logger.info(f"Received signal {signum}, initiating graceful shutdown...")
        self.shutdown_requested = True

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

    def process_sqs_message(self, message: Dict[str, Any]) -> bool:
        """
        Process a single SQS message

        Args:
            message: SQS message

        Returns:
            True if processing successful
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
                self.logger.warning(f"Unsupported file type: {ext}")
                return False

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
                return False

            # Process file
            self.logger.info("Starting file processing...")
            result = self.file_router.process_file(temp_file_path)

            if not result.success:
                self.logger.error(f"Processing failed: {result.error_message}")
                return False

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
                    self.logger.error("Failed to index document")
                    return False

                self.logger.info("Successfully indexed document")
            else:
                self.logger.warning("OpenSearch not connected - skipping indexing")

            self.logger.info(
                f"Successfully processed: {Path(key).name} "
                f"({result.char_count:,} chars, {result.processing_time_seconds:.2f}s)"
            )

            return True

        except json.JSONDecodeError as e:
            self.logger.error(f"Invalid message format: {e}")
            return False

        except Exception as e:
            self.logger.error(f"Error processing message: {e}", exc_info=True)
            return False

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
                    self.stats['processed'] += 1

                    try:
                        # Process the message
                        success = self.process_sqs_message(message)

                        if success:
                            # Delete message from queue
                            self.sqs_client.delete_message(
                                QueueUrl=self.config.aws.sqs_queue_url,
                                ReceiptHandle=receipt_handle
                            )
                            self.logger.info("Message processed and deleted from queue")
                            self.stats['succeeded'] += 1

                        else:
                            self.logger.error("Processing failed - message will be retried")
                            self.stats['failed'] += 1

                    except Exception as e:
                        self.logger.error(f"Error processing message: {e}", exc_info=True)
                        self.stats['failed'] += 1

            except KeyboardInterrupt:
                self.logger.info("Received keyboard interrupt")
                break

            except Exception as e:
                self.logger.error(f"Error in polling loop: {e}", exc_info=True)
                # Don't exit, continue processing
                time.sleep(5)

        self.logger.info("Worker stopped")
        self._print_statistics()

    def _print_statistics(self):
        """Print worker statistics"""
        runtime = time.time() - self.stats['start_time']
        runtime_hours = runtime / 3600

        self.logger.info("=== Worker Statistics ===")
        self.logger.info(f"Runtime: {runtime:.0f} seconds ({runtime_hours:.2f} hours)")
        self.logger.info(f"Total Processed: {self.stats['processed']}")
        self.logger.info(f"Succeeded: {self.stats['succeeded']}")
        self.logger.info(f"Failed: {self.stats['failed']}")

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
        description='File Processing Worker for AWS EC2',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Environment Variables:
  AWS_REGION              AWS region (default: ap-northeast-1)
  S3_BUCKET              S3 bucket name
  SQS_QUEUE_URL          SQS queue URL (required)
  OPENSEARCH_ENDPOINT    OpenSearch endpoint URL
  OPENSEARCH_INDEX       OpenSearch index name (default: file-index)
  LOG_LEVEL              Logging level (DEBUG, INFO, WARNING, ERROR)

Example:
  python worker.py
  python worker.py --validate-only
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
    logger.info("File Processing Worker - Starting")
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
