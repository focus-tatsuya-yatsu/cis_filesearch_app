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
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import unquote_plus  # CRITICAL: For URL decoding S3 keys

import boto3
from botocore.exceptions import ClientError

from config import get_config
from file_router import FileRouter
from opensearch_client import OpenSearchClient
from processors import ImageEmbeddingGenerator


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

        # Initialize image embedding generator
        embedding_enabled = os.environ.get('ENABLE_IMAGE_EMBEDDING', 'true').lower() == 'true'
        self.image_embedding = ImageEmbeddingGenerator(
            lambda_function_name=os.environ.get('IMAGE_EMBEDDING_LAMBDA', 'cis-filesearch-image-search'),
            aws_region=config.aws.region,
            enabled=embedding_enabled
        )

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

        # Log critical configuration for debugging
        self.logger.info("=" * 60)
        self.logger.info("Worker initialized with configuration:")
        self.logger.info(f"  OpenSearch connected: {self.opensearch.is_connected()}")
        self.logger.info(f"  OpenSearch endpoint: {config.aws.opensearch_endpoint[:50] if config.aws.opensearch_endpoint else 'NOT SET'}")
        self.logger.info(f"  S3 bucket: {config.aws.s3_bucket}")
        self.logger.info(f"  S3 thumbnail bucket: {config.aws.s3_thumbnail_bucket}")
        self.logger.info(f"  SQS queue: {config.aws.sqs_queue_url[:50] if config.aws.sqs_queue_url else 'NOT SET'}")
        self.logger.info(f"  DLQ URL: {self.dlq_url[:50] if self.dlq_url else 'NOT SET'}")
        self.logger.info(f"  Image embedding enabled: {embedding_enabled}")
        self.logger.info(f"  Thumbnail for images: {config.thumbnail.generate_for_images}")
        self.logger.info(f"  Thumbnail for PDFs: {config.thumbnail.generate_for_pdfs}")
        self.logger.info("=" * 60)

        # CRITICAL CHECK: Fail fast if OpenSearch is not connected
        if not self.opensearch.is_connected():
            self.logger.error("CRITICAL: OpenSearch is NOT connected!")
            self.logger.error("Files cannot be indexed. Check OPENSEARCH_ENDPOINT environment variable.")
            self.logger.error("Worker will send all messages to DLQ until OpenSearch is connected.")

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
            # Security: Validate S3 key to prevent path traversal
            if '..' in key or key.startswith('/'):
                self.logger.error(f"Security: Invalid S3 key pattern detected")
                return False

            # Security: Ensure local_path is within temp directory
            temp_dir = Path(self.config.processing.temp_dir).resolve()
            local_path_resolved = Path(local_path).resolve()
            if not str(local_path_resolved).startswith(str(temp_dir)):
                self.logger.error("Security: Path traversal attempt detected in local_path")
                return False

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

    def _extract_path_metadata(
        self,
        document: Dict[str, Any],
        s3_key: str,
        original_path: Optional[str] = None
    ) -> None:
        """
        Extract category, nas_server, and root_folder from S3 key path.
        Also generates nas_path for display using original_path if available.

        S3 key format examples:
        - documents/road/ts-server3/R06_JOB/.../file.xdw
        - documents/structure/ts-server6/H22_JOB/.../file.pdf
        - processed/road/ts-server5/trashbox/.../file.doc

        Original path format (from file-scanner):
        - /mnt/nas/ts-server3/R06_JOB/.../file.xdw
        - \\ts-server3\share\R06_JOB\...\file.xdw

        Mapping:
        - road: ts-server3, ts-server5 (道路)
        - structure: ts-server6, ts-server7 (構造)

        Args:
            document: Document dictionary to update
            s3_key: S3 object key
            original_path: Original NAS path from file-scanner (optional)
        """
        import re

        # Helper function to convert original_path to UNC path
        def convert_original_to_nas_path(orig_path: str) -> Optional[str]:
            """
            Convert original path to Windows UNC path.

            Examples:
            - /mnt/nas/ts-server3/R06_JOB/file.pdf → \\ts-server3\share\R06_JOB\file.pdf
            - /mnt/ts-server3/share/R06_JOB/file.pdf → \\ts-server3\share\R06_JOB\file.pdf
            - \\ts-server3\share\R06_JOB\file.pdf → \\ts-server3\share\R06_JOB\file.pdf (already UNC)
            """
            if not orig_path:
                return None

            # Already UNC path
            if orig_path.startswith('\\\\'):
                return orig_path

            # Normalize path separators
            normalized = orig_path.replace('\\', '/')

            # Extract server name
            server_match = re.search(r'(ts-server\d+)', normalized)
            if not server_match:
                return None

            nas_server = server_match.group(1)

            # Get the path after server name
            parts = normalized.split(f'{nas_server}/')
            if len(parts) < 2:
                return None

            remaining = parts[1]

            # Remove 'share/' prefix if present (some paths have it, some don't)
            if remaining.startswith('share/'):
                remaining = remaining[6:]

            # Convert to Windows path
            windows_path = remaining.replace('/', '\\')

            return f"\\\\{nas_server}\\share\\{windows_path}"

        # Category display mapping
        category_display_map = {
            'road': '道路',
            'structure': '構造'
        }

        # Pattern to match: {prefix}/{category}/{server}/{root_folder}/...
        # Prefixes: documents, processed, docuworks-converted
        pattern = r'^(?:documents|processed|docuworks-converted)/(road|structure)/(ts-server\d+)/([^/]+)/'
        match = re.match(pattern, s3_key)

        if match:
            category = match.group(1)
            nas_server = match.group(2)
            root_folder = match.group(3)

            document['category'] = category
            document['category_display'] = category_display_map.get(category, category)
            document['nas_server'] = nas_server
            document['root_folder'] = root_folder

            # Generate NAS path: prefer original_path if available
            if original_path:
                nas_path = convert_original_to_nas_path(original_path)
                if nas_path:
                    document['nas_path'] = nas_path
                    self.logger.debug(f"NAS path from original_path: {nas_path}")
                else:
                    # Fallback to s3_key based generation
                    remaining_path = s3_key.split(f'{nas_server}/', 1)[-1] if nas_server in s3_key else ''
                    windows_path = remaining_path.replace('/', '\\')
                    document['nas_path'] = f"\\\\{nas_server}\\share\\{windows_path}"
            else:
                # Generate from s3_key
                remaining_path = s3_key.split(f'{nas_server}/', 1)[-1] if nas_server in s3_key else ''
                windows_path = remaining_path.replace('/', '\\')
                document['nas_path'] = f"\\\\{nas_server}\\share\\{windows_path}"

            self.logger.debug(
                f"Extracted metadata: category={category}, server={nas_server}, "
                f"folder={root_folder}, nas_path={document.get('nas_path', 'N/A')}"
            )
        else:
            # Fallback: try to extract server from path
            server_match = re.search(r'(ts-server\d+)', s3_key)
            nas_server = None

            if server_match:
                nas_server = server_match.group(1)
                document['nas_server'] = nas_server

                # Infer category from server number
                server_num = int(re.search(r'\d+', nas_server).group())
                if server_num in [3, 5]:
                    document['category'] = 'road'
                    document['category_display'] = '道路'
                elif server_num in [6, 7]:
                    document['category'] = 'structure'
                    document['category_display'] = '構造'

            # Generate nas_path even in fallback case
            if original_path:
                nas_path = convert_original_to_nas_path(original_path)
                if nas_path:
                    document['nas_path'] = nas_path
                    self.logger.info(f"NAS path generated from original_path (fallback): {nas_path}")
            elif nas_server:
                # Generate from s3_key as last resort
                remaining_path = s3_key.split(f'{nas_server}/', 1)[-1] if nas_server in s3_key else ''
                if remaining_path:
                    windows_path = remaining_path.replace('/', '\\')
                    document['nas_path'] = f"\\\\{nas_server}\\share\\{windows_path}"
                    self.logger.info(f"NAS path generated from s3_key (fallback): {document['nas_path']}")

            if 'nas_path' not in document:
                self.logger.warning(
                    f"Could not generate nas_path from key: {s3_key[:100]}..."
                )
            else:
                self.logger.debug(
                    f"Fallback metadata extracted: server={nas_server}, nas_path={document.get('nas_path', 'N/A')}"
                )

    def upload_thumbnail_to_s3(
        self,
        thumbnail_data: bytes,
        bucket: str,
        key: str
    ) -> Optional[str]:
        """
        Upload thumbnail to S3 (dedicated thumbnail bucket)

        Args:
            thumbnail_data: Thumbnail image data
            bucket: S3 bucket name (ignored, uses dedicated thumbnail bucket)
            key: S3 object key (original file key)

        Returns:
            S3 URL of uploaded thumbnail or None
        """
        try:
            # Use dedicated thumbnail bucket to avoid S3 event notification loop
            thumbnail_bucket = self.config.aws.s3_thumbnail_bucket

            # Create thumbnail key - include hash for uniqueness
            # This ensures files with the same name in different folders get unique thumbnails
            import hashlib
            from pathlib import Path
            file_name = Path(key).stem  # Get filename without extension
            path_hash = hashlib.md5(key.encode()).hexdigest()[:8]  # Short hash for uniqueness
            thumbnail_key = f"thumbnails/{file_name}_{path_hash}_thumb.jpg"

            # Upload thumbnail to dedicated bucket
            self.s3_client.put_object(
                Bucket=thumbnail_bucket,
                Key=thumbnail_key,
                Body=thumbnail_data,
                ContentType='image/jpeg',
                Metadata={
                    'original-key': key,
                    'original-bucket': bucket
                }
            )

            thumbnail_url = f"s3://{thumbnail_bucket}/{thumbnail_key}"
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
            original_path = None  # Original NAS path from file-scanner
            if 'Records' in body:
                # S3 event notification format
                record = body['Records'][0]
                bucket = record['s3']['bucket']['name']
                # CRITICAL FIX: S3 event notifications URL-encode the object key
                # Must decode to handle Japanese characters, spaces, and special chars
                raw_key = record['s3']['object']['key']
                key = unquote_plus(raw_key)  # unquote_plus handles + as space too
                self.logger.debug(f"Decoded S3 key: {raw_key[:50]}... -> {key[:50]}...")
            else:
                # Custom message format (from file-scanner)
                bucket = body.get('bucket', self.config.aws.s3_bucket)
                key = body.get('key') or body.get('s3Key')  # Support both formats
                # Also decode in case custom messages are URL-encoded
                if key:
                    key = unquote_plus(key)
                # Extract original NAS path if available
                original_path = body.get('originalPath') or body.get('original_path')

            self.logger.info(f"Processing: s3://{bucket}/{key}")
            if original_path:
                self.logger.debug(f"Original NAS path: {original_path}")

            # Skip files from thumbnails directory (prevent recursive processing)
            if key.startswith('thumbnails/') or '/thumbnails/' in key:
                self.logger.info(f"Skipping thumbnail file: {key}")
                return (True, "Skipped - thumbnail file")

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

            # Extract category, nas_server, root_folder from S3 key
            # Key format: documents/{category}/{server}/{root_folder}/...
            # or: processed/{category}/{server}/{root_folder}/...
            # Also generates nas_path using original_path if available
            self._extract_path_metadata(document, key, original_path)

            # IMPORTANT: Override file_name and file_extension with correct values from S3 key
            # The file_router extracts these from the temp file path, which is incorrect
            document['file_name'] = Path(key).name
            document['file_extension'] = Path(key).suffix.lower()
            document['file_path'] = f"s3://{bucket}/{key}"

            # Upload thumbnail if available
            if result.thumbnail_data:
                self.logger.info(f"Thumbnail generated ({len(result.thumbnail_data)} bytes), uploading to S3...")
                thumbnail_url = self.upload_thumbnail_to_s3(
                    result.thumbnail_data,
                    bucket,
                    key
                )
                if thumbnail_url:
                    document['thumbnail_url'] = thumbnail_url
                    self.logger.info(f"Thumbnail uploaded: {thumbnail_url}")
                else:
                    self.logger.warning("Thumbnail upload failed")
            else:
                file_ext = Path(key).suffix.lower()
                self.logger.info(f"No thumbnail generated for {file_ext} file (processor: {result.processor_name})")

            # Generate image embedding for similarity search
            file_ext = Path(key).suffix.lower()
            if self.image_embedding.is_supported(file_ext):
                self.logger.info("Generating image embedding...")
                embedding, dimension = self.image_embedding.generate_embedding_safe(
                    s3_url=document['s3_url'],
                    file_extension=file_ext,
                    use_cache=True
                )
                if embedding:
                    document['image_embedding'] = embedding
                    document['image_embedding_dimension'] = dimension
                    self.logger.info(f"Image embedding generated ({dimension}D)")
                else:
                    self.logger.warning("Failed to generate image embedding - continuing without it")

            # Index to OpenSearch
            # CRITICAL FIX: OpenSearch indexing is REQUIRED, not optional
            # If OpenSearch is not connected, this is a FAILURE that must go to DLQ
            if not self.opensearch.is_connected():
                error_msg = "OpenSearch not connected - CANNOT index document (check OPENSEARCH_ENDPOINT env var and connectivity)"
                self.logger.error(error_msg)
                return (False, error_msg)

            self.logger.info("Indexing to OpenSearch...")
            if not self.opensearch.index_document(document, document_id=key):
                error_msg = "Failed to index document to OpenSearch"
                self.logger.error(error_msg)
                return (False, error_msg)

            self.logger.info("Successfully indexed document")

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

    def _process_message_wrapper(self, message: Dict[str, Any]) -> Tuple[Dict[str, Any], bool, Optional[str]]:
        """
        Wrapper for processing a single message in a thread-safe manner

        Args:
            message: SQS message to process

        Returns:
            (message, success, error_message): Tuple containing the original message and result
        """
        try:
            success, error_msg = self.process_sqs_message(message)
            return (message, success, error_msg)
        except Exception as e:
            return (message, False, str(e))

    def _delete_messages_batch(self, messages_to_delete: List[Dict[str, Any]]):
        """
        Delete multiple messages from SQS using batch delete

        Args:
            messages_to_delete: List of messages with ReceiptHandle to delete
        """
        if not messages_to_delete:
            return

        # SQS batch delete supports up to 10 messages at a time
        for i in range(0, len(messages_to_delete), 10):
            batch = messages_to_delete[i:i+10]
            entries = [
                {
                    'Id': str(idx),
                    'ReceiptHandle': msg['ReceiptHandle']
                }
                for idx, msg in enumerate(batch)
            ]

            try:
                response = self.sqs_client.delete_message_batch(
                    QueueUrl=self.config.aws.sqs_queue_url,
                    Entries=entries
                )

                successful = len(response.get('Successful', []))
                failed = response.get('Failed', [])

                if failed:
                    for failure in failed:
                        self.logger.error(f"Failed to delete message: {failure}")
                        self._send_metric('MessageDeleteFailed', 1)

                self.logger.info(f"Batch deleted {successful} messages")

            except Exception as e:
                self.logger.error(f"Batch delete failed: {e}", exc_info=True)
                # Fallback to individual deletes
                for msg in batch:
                    try:
                        self.sqs_client.delete_message(
                            QueueUrl=self.config.aws.sqs_queue_url,
                            ReceiptHandle=msg['ReceiptHandle']
                        )
                    except Exception as de:
                        self.logger.error(f"Individual delete also failed: {de}")
                        self._send_metric('MessageDeleteFailed', 1)

    def poll_and_process(self):
        """
        Main worker loop with parallel processing
        Polls SQS and processes messages using ThreadPoolExecutor

        OPTIMIZED: Uses parallel processing for better throughput
        """
        self.logger.info("Starting to poll SQS queue with parallel processing...")
        self.logger.info(f"Queue URL: {self.config.aws.sqs_queue_url[:50]}...")
        self.logger.info(f"Max workers: {self.config.processing.max_workers}")
        self.logger.info(f"Batch size: {self.config.aws.sqs_max_messages}")

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

                self.logger.info(f"Received {len(messages)} message(s) - processing in parallel")
                batch_start = time.time()

                # Process messages in parallel using ThreadPoolExecutor
                messages_to_delete = []

                with ThreadPoolExecutor(max_workers=self.config.processing.max_workers) as executor:
                    # Submit all messages for processing
                    future_to_message = {
                        executor.submit(self._process_message_wrapper, msg): msg
                        for msg in messages
                    }

                    # Collect results as they complete
                    for future in as_completed(future_to_message):
                        if self.shutdown_requested:
                            self.logger.info("Shutdown requested, stopping message processing")
                            break

                        try:
                            message, success, error_msg = future.result()
                            message_id = message.get('MessageId', 'unknown')
                            self.stats['processed'] += 1

                            if success:
                                self.logger.info(f"Message {message_id} processed successfully")
                                self.stats['succeeded'] += 1
                            else:
                                self.logger.error(f"Message {message_id} processing failed: {error_msg}")
                                self._send_to_dlq(message, error_msg)
                                self.stats['failed'] += 1

                            # Always mark for deletion
                            messages_to_delete.append(message)

                        except Exception as e:
                            message = future_to_message[future]
                            message_id = message.get('MessageId', 'unknown')
                            self.logger.error(f"Unexpected error processing {message_id}: {e}", exc_info=True)
                            self._send_to_dlq(message, str(e))
                            self.stats['failed'] += 1
                            messages_to_delete.append(message)

                # Batch delete all processed messages
                self._delete_messages_batch(messages_to_delete)

                batch_time = time.time() - batch_start
                self.logger.info(
                    f"Batch completed: {len(messages_to_delete)} messages in {batch_time:.2f}s "
                    f"({len(messages_to_delete)/batch_time:.1f} msg/s)"
                )

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
