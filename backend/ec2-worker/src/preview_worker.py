#!/usr/bin/env python3
"""
Preview Worker - Dedicated worker for preview regeneration tasks

This worker polls the preview-specific SQS queue and processes
preview regeneration tasks for Office and DocuWorks files.

Supports Auto Scaling based on queue depth.

Usage:
    python preview_worker.py [--queue-url URL] [--threads N]
"""

import logging
import json
import time
import signal
import argparse
import sys
import os
import io
import tempfile
import shutil
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
import boto3
from botocore.exceptions import ClientError

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import get_config
config = get_config()
from s3_client import S3Client
from opensearch_client import OpenSearchClient
from preview_generator import PreviewGenerator, PreviewConfig
from office_converter import OfficeConverter

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Default Preview Queue URL
DEFAULT_PREVIEW_QUEUE_URL = os.getenv(
    'PREVIEW_QUEUE_URL',
    'https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-preview-queue'
)


@dataclass
class WorkerStats:
    """Worker statistics"""
    processed: int = 0
    success: int = 0
    failed: int = 0
    skipped: int = 0
    start_time: float = field(default_factory=time.time)

    def __str__(self) -> str:
        elapsed = time.time() - self.start_time
        rate = self.processed / elapsed * 60 if elapsed > 0 else 0
        success_rate = (self.success / self.processed * 100) if self.processed > 0 else 0
        return (
            f"Processed: {self.processed}, "
            f"Success: {self.success}, "
            f"Failed: {self.failed}, "
            f"Skipped: {self.skipped}, "
            f"Rate: {rate:.1f}/min, "
            f"Success Rate: {success_rate:.1f}%"
        )


class PreviewWorker:
    """
    Dedicated worker for preview regeneration tasks.

    Features:
    - Polls preview-specific SQS queue
    - Processes Office and DocuWorks files
    - Supports graceful shutdown for Spot interruption
    - Auto Scaling friendly (terminates when queue is empty)
    """

    DOCUWORKS_EXTENSIONS = ['.xdw', '.xbd']
    CONVERTED_PDF_PREFIX = 'docuworks-converted/'

    def __init__(
        self,
        queue_url: Optional[str] = None,
        max_threads: int = 2,
        visibility_timeout: int = 900,
        idle_timeout: int = 300
    ):
        """
        Initialize the preview worker.

        Args:
            queue_url: SQS queue URL
            max_threads: Maximum concurrent processing threads
            visibility_timeout: SQS visibility timeout in seconds
            idle_timeout: Seconds to wait before shutting down when queue is empty
        """
        self.queue_url = queue_url or DEFAULT_PREVIEW_QUEUE_URL
        self.max_threads = max_threads
        self.visibility_timeout = visibility_timeout
        self.idle_timeout = idle_timeout

        # AWS clients
        self.sqs = boto3.client('sqs', **{'region_name': config.aws.region})
        self.s3_client = S3Client()
        self.opensearch_client = OpenSearchClient(config)

        # Preview generator (using defaults or environment variables)
        preview_config = PreviewConfig(
            dpi=int(os.getenv('PREVIEW_DPI', '150')),
            max_width=int(os.getenv('PREVIEW_MAX_WIDTH', '1200')),
            max_height=int(os.getenv('PREVIEW_MAX_HEIGHT', '1600')),
            quality=int(os.getenv('PREVIEW_QUALITY', '85')),
            max_pages=int(os.getenv('PREVIEW_MAX_PAGES', '20'))
        )
        self.preview_generator = PreviewGenerator(preview_config)

        # Office converter (lazy init)
        self._office_converter: Optional[OfficeConverter] = None

        # Thread pool
        self.executor = ThreadPoolExecutor(max_workers=max_threads)

        # Shutdown handling
        self.shutdown_requested = False
        signal.signal(signal.SIGTERM, self._handle_shutdown)
        signal.signal(signal.SIGINT, self._handle_shutdown)

        # Statistics
        self.stats = WorkerStats()

        # PDF cache for DocuWorks
        self._pdf_cache: Optional[Dict[str, str]] = None

        # Idle tracking
        self._last_message_time = time.time()

        logger.info("=" * 60)
        logger.info("Preview Worker Initialized")
        logger.info(f"  Queue URL: {self.queue_url}")
        logger.info(f"  Max Threads: {max_threads}")
        logger.info(f"  Visibility Timeout: {visibility_timeout}s")
        logger.info(f"  Idle Timeout: {idle_timeout}s")
        logger.info("=" * 60)

    @property
    def office_converter(self) -> OfficeConverter:
        """Lazy initialization of OfficeConverter."""
        if self._office_converter is None:
            self._office_converter = OfficeConverter()
            if self._office_converter.is_available():
                logger.info("LibreOffice is available for Office file conversion")
            else:
                logger.warning("LibreOffice is NOT available - Office files will fail")
        return self._office_converter

    def start(self):
        """Start the worker polling loop."""
        logger.info("Starting preview worker polling...")

        while not self.shutdown_requested:
            try:
                messages = self._receive_messages()

                if messages:
                    self._last_message_time = time.time()
                    logger.info(f"Received {len(messages)} preview tasks")
                    self._process_messages(messages)
                else:
                    # Check idle timeout for Auto Scaling
                    idle_time = time.time() - self._last_message_time
                    if idle_time > self.idle_timeout:
                        logger.info(f"Queue empty for {idle_time:.0f}s, shutting down for Auto Scaling")
                        break

                    # Wait before next poll
                    time.sleep(5)

            except KeyboardInterrupt:
                logger.info("Keyboard interrupt received")
                break

            except Exception as e:
                logger.error(f"Error in polling loop: {e}")
                time.sleep(10)

        self._shutdown()

    def _receive_messages(self) -> List[Dict]:
        """Receive messages from SQS."""
        try:
            response = self.sqs.receive_message(
                QueueUrl=self.queue_url,
                MaxNumberOfMessages=min(self.max_threads, 10),
                VisibilityTimeout=self.visibility_timeout,
                WaitTimeSeconds=20,
                MessageAttributeNames=['All']
            )
            return response.get('Messages', [])
        except ClientError as e:
            logger.error(f"Failed to receive messages: {e}")
            return []

    def _process_messages(self, messages: List[Dict]):
        """Process messages in parallel."""
        futures = []

        for message in messages:
            future = self.executor.submit(self._process_single_message, message)
            futures.append((future, message))

        for future, message in futures:
            try:
                success = future.result(timeout=self.visibility_timeout - 60)

                if success:
                    self._delete_message(message)
                    self.stats.success += 1
                else:
                    self.stats.failed += 1

                self.stats.processed += 1

                # Log progress periodically
                if self.stats.processed % 10 == 0:
                    logger.info(f"Progress: {self.stats}")

            except Exception as e:
                logger.error(f"Error processing message: {e}")
                self.stats.failed += 1
                self.stats.processed += 1

    def _process_single_message(self, message: Dict) -> bool:
        """Process a single preview task message."""
        try:
            body = json.loads(message['Body'])

            task_type = body.get('task_type')
            if task_type != 'preview_regeneration':
                logger.warning(f"Unknown task type: {task_type}")
                return True  # Delete unknown messages

            file_type = body.get('file_type')
            file_name = body.get('file_name', 'unknown')
            doc_id = body.get('doc_id')
            file_id = body.get('file_id')

            logger.info(f"Processing: {file_name} (type: {file_type})")

            # Check if preview already exists
            if self._check_preview_exists(doc_id):
                logger.info(f"Preview already exists for {file_name}, skipping")
                self.stats.skipped += 1
                return True

            # Process based on file type
            if file_type == 'office':
                return self._process_office_file(body)
            elif file_type == 'docuworks':
                return self._process_docuworks_file(body)
            elif file_type == 'pdf':
                return self._process_pdf_file(body)
            else:
                logger.warning(f"Unsupported file type: {file_type}")
                return True  # Delete unsupported

        except json.JSONDecodeError as e:
            logger.error(f"Invalid message JSON: {e}")
            return True  # Delete invalid messages
        except Exception as e:
            logger.error(f"Failed to process message: {e}")
            return False

    def _check_preview_exists(self, doc_id: str) -> bool:
        """Check if document already has preview_images."""
        try:
            doc = self.opensearch_client.get_document(doc_id)
            if doc and doc.get('preview_images'):
                return True
            return False
        except Exception:
            return False

    def _process_office_file(self, task: Dict) -> bool:
        """Process Office file preview generation."""
        file_name = task.get('file_name')
        file_id = task.get('file_id')
        doc_id = task.get('doc_id')
        s3_key = task.get('s3_key')

        temp_office_path = None
        temp_dir = None

        try:
            # Download Office file
            temp_office_path = self.s3_client.download_file(
                config.aws.s3_bucket,
                s3_key
            )

            if not temp_office_path or not os.path.exists(temp_office_path):
                logger.error(f"Failed to download: {s3_key}")
                return False

            # Convert to PDF
            temp_dir = tempfile.mkdtemp(prefix='preview_')
            pdf_path = self.office_converter.convert_to_pdf(
                temp_office_path,
                output_dir=temp_dir,
                timeout=180
            )

            if not pdf_path or not os.path.exists(pdf_path):
                logger.error(f"PDF conversion failed for {file_name}")
                return False

            # Generate previews
            previews = self.preview_generator._generate_from_pdf(Path(pdf_path))

            if not previews:
                logger.error(f"No previews generated for {file_name}")
                return False

            # Upload to S3
            uploaded = self._upload_previews(previews, file_id)

            if not uploaded:
                logger.error(f"Failed to upload previews for {file_name}")
                return False

            # Update OpenSearch
            if not self._update_opensearch(doc_id, uploaded):
                logger.error(f"Failed to update OpenSearch for {file_name}")
                return False

            logger.info(f"Successfully processed: {file_name} ({len(uploaded)} pages)")
            return True

        except Exception as e:
            logger.error(f"Error processing Office file {file_name}: {e}")
            return False

        finally:
            if temp_office_path:
                self.s3_client.cleanup_temp_file(temp_office_path)
            if temp_dir and os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)

    def _process_docuworks_file(self, task: Dict) -> bool:
        """Process DocuWorks file preview generation."""
        file_name = task.get('file_name')
        file_id = task.get('file_id')
        doc_id = task.get('doc_id')

        temp_pdf_path = None

        try:
            # Find converted PDF
            base_name = Path(file_name).stem
            pdf_key = self._find_converted_pdf(base_name)

            if not pdf_key:
                logger.warning(f"No converted PDF found for {file_name}")
                return False

            # Download PDF
            temp_pdf_path = self.s3_client.download_file(
                config.aws.s3_bucket,
                pdf_key
            )

            if not temp_pdf_path or not os.path.exists(temp_pdf_path):
                logger.error(f"Failed to download PDF: {pdf_key}")
                return False

            # Generate previews
            previews = self.preview_generator._generate_from_pdf(Path(temp_pdf_path))

            if not previews:
                logger.error(f"No previews generated for {file_name}")
                return False

            # Upload to S3
            uploaded = self._upload_previews(previews, file_id)

            if not uploaded:
                logger.error(f"Failed to upload previews for {file_name}")
                return False

            # Update OpenSearch
            if not self._update_opensearch(doc_id, uploaded):
                logger.error(f"Failed to update OpenSearch for {file_name}")
                return False

            logger.info(f"Successfully processed: {file_name} ({len(uploaded)} pages)")
            return True

        except Exception as e:
            logger.error(f"Error processing DocuWorks file {file_name}: {e}")
            return False

        finally:
            if temp_pdf_path:
                self.s3_client.cleanup_temp_file(temp_pdf_path)

    def _process_pdf_file(self, task: Dict) -> bool:
        """Process PDF file preview generation."""
        file_name = task.get('file_name')
        file_id = task.get('file_id')
        doc_id = task.get('doc_id')
        s3_key = task.get('s3_key')

        temp_pdf_path = None

        try:
            # Download PDF file
            temp_pdf_path = self.s3_client.download_file(
                config.aws.s3_bucket,
                s3_key
            )

            if not temp_pdf_path or not os.path.exists(temp_pdf_path):
                logger.error(f"Failed to download PDF: {s3_key}")
                return False

            # Generate previews directly from PDF
            previews = self.preview_generator._generate_from_pdf(Path(temp_pdf_path))

            if not previews:
                logger.error(f"No previews generated for {file_name}")
                return False

            # Upload to S3
            uploaded = self._upload_previews(previews, file_id)

            if not uploaded:
                logger.error(f"Failed to upload previews for {file_name}")
                return False

            # Update OpenSearch
            if not self._update_opensearch(doc_id, uploaded):
                logger.error(f"Failed to update OpenSearch for {file_name}")
                return False

            logger.info(f"Successfully processed PDF: {file_name} ({len(uploaded)} pages)")
            return True

        except Exception as e:
            logger.error(f"Error processing PDF file {file_name}: {e}")
            return False

        finally:
            if temp_pdf_path:
                self.s3_client.cleanup_temp_file(temp_pdf_path)

    def _find_converted_pdf(self, base_name: str) -> Optional[str]:
        """Find converted PDF in S3."""
        if self._pdf_cache is None:
            self._build_pdf_cache()

        for pdf_name, s3_key in self._pdf_cache.items():
            if base_name in pdf_name:
                return s3_key

        return None

    def _build_pdf_cache(self):
        """Build cache of converted PDFs."""
        logger.info("Building PDF cache from S3...")
        self._pdf_cache = {}

        try:
            s3 = boto3.client('s3', **{'region_name': config.aws.region})
            paginator = s3.get_paginator('list_objects_v2')

            page_iterator = paginator.paginate(
                Bucket=config.aws.s3_bucket,
                Prefix=self.CONVERTED_PDF_PREFIX
            )

            for page in page_iterator:
                if 'Contents' not in page:
                    continue
                for obj in page['Contents']:
                    key = obj['Key']
                    if key.endswith('.pdf'):
                        filename = Path(key).stem
                        self._pdf_cache[filename] = key

            logger.info(f"PDF cache built: {len(self._pdf_cache)} PDFs found")

        except Exception as e:
            logger.error(f"Failed to build PDF cache: {e}")

    def _upload_previews(self, previews: List[Dict], file_id: str) -> List[Dict]:
        """Upload preview images to S3."""
        uploaded = []

        for preview in previews:
            try:
                preview_key = f"previews/{file_id}/page_{preview['page']}.jpg"
                preview_io = io.BytesIO(preview['data'])

                preview_url = self.s3_client.upload_fileobj(
                    preview_io,
                    config.aws.s3_thumbnail_bucket,
                    preview_key,
                    content_type='image/jpeg'
                )

                if preview_url:
                    uploaded.append({
                        "page": preview['page'],
                        "s3_key": preview_key,
                        "width": preview['width'],
                        "height": preview['height'],
                        "size": preview['size']
                    })

            except Exception as e:
                logger.error(f"Failed to upload preview page {preview['page']}: {e}")

        return uploaded

    def _update_opensearch(self, doc_id: str, preview_images: List[Dict]) -> bool:
        """Update OpenSearch document with preview images."""
        try:
            updates = {
                "preview_images": preview_images,
                "total_pages": len(preview_images),
                "preview_generated_at": datetime.utcnow().isoformat()
            }
            # Use OpenSearch client's update API directly
            self.opensearch_client.client.update(
                index=config.aws.opensearch_index,
                id=doc_id,
                body={"doc": updates}
            )
            return True
        except Exception as e:
            logger.error(f"Failed to update OpenSearch: {e}")
            return False

    def _delete_message(self, message: Dict):
        """Delete processed message from SQS."""
        try:
            self.sqs.delete_message(
                QueueUrl=self.queue_url,
                ReceiptHandle=message['ReceiptHandle']
            )
        except ClientError as e:
            logger.error(f"Failed to delete message: {e}")

    def _handle_shutdown(self, signum, frame):
        """Handle shutdown signal."""
        logger.info(f"Received signal {signum}, initiating shutdown...")
        self.shutdown_requested = True

    def _shutdown(self):
        """Graceful shutdown."""
        logger.info("Shutting down preview worker...")
        self.executor.shutdown(wait=True)

        logger.info("=" * 60)
        logger.info("Preview Worker Final Statistics")
        logger.info(f"  {self.stats}")
        logger.info("=" * 60)


def validate_startup() -> bool:
    """
    Validate configuration before starting the worker.
    Returns True if all validations pass.
    """
    logger.info("=" * 60)
    logger.info("Preview Worker - Startup Validation")
    logger.info("=" * 60)

    # Note: Skip config.validate() as it checks for SQS_QUEUE_URL
    # Preview worker uses PREVIEW_QUEUE_URL instead (tested below)

    # Test AWS credentials
    logger.info("Testing AWS credentials...")
    try:
        sts = boto3.client('sts', **{'region_name': config.aws.region})
        identity = sts.get_caller_identity()
        logger.info(f"AWS Identity: {identity.get('Arn', 'Unknown')}")
    except Exception as e:
        logger.error(f"AWS credentials test failed: {e}")
        logger.error("Ensure the EC2 instance has an IAM role attached with proper permissions")
        return False

    # Test SQS connectivity
    preview_queue_url = os.getenv('PREVIEW_QUEUE_URL', DEFAULT_PREVIEW_QUEUE_URL)
    logger.info(f"Testing SQS connectivity to: {preview_queue_url}")
    try:
        sqs = boto3.client('sqs', **{'region_name': config.aws.region})
        attrs = sqs.get_queue_attributes(
            QueueUrl=preview_queue_url,
            AttributeNames=['ApproximateNumberOfMessages']
        )
        msg_count = attrs.get('Attributes', {}).get('ApproximateNumberOfMessages', '0')
        logger.info(f"SQS connectivity OK. Messages in queue: {msg_count}")
    except Exception as e:
        logger.error(f"SQS connectivity test failed: {e}")
        return False

    # Test OpenSearch connectivity
    logger.info(f"Testing OpenSearch connectivity to: {config.aws.opensearch_endpoint}")
    try:
        from opensearch_client import OpenSearchClient
        os_client = OpenSearchClient(config)
        stats = os_client.get_index_stats()
        logger.info(f"OpenSearch connectivity OK. Documents: {stats.get('document_count', 'unknown')}")
    except Exception as e:
        logger.error(f"OpenSearch connectivity test failed: {e}")
        logger.error("Check OPENSEARCH_ENDPOINT and network/security group configuration")
        return False

    # Test S3 connectivity
    logger.info(f"Testing S3 connectivity to: {config.aws.s3_bucket}")
    try:
        s3 = boto3.client('s3', **{'region_name': config.aws.region})
        s3.head_bucket(Bucket=config.aws.s3_bucket)
        logger.info("S3 landing bucket connectivity OK")
    except Exception as e:
        logger.error(f"S3 connectivity test failed: {e}")
        return False

    logger.info("=" * 60)
    logger.info("All startup validations passed!")
    logger.info("=" * 60)
    return True


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Preview Worker - Process preview regeneration tasks"
    )
    parser.add_argument(
        "--queue-url",
        type=str,
        default=None,
        help="SQS queue URL"
    )
    parser.add_argument(
        "--threads",
        type=int,
        default=2,
        help="Maximum concurrent threads (default: 2)"
    )
    parser.add_argument(
        "--idle-timeout",
        type=int,
        default=300,
        help="Idle timeout in seconds for Auto Scaling (default: 300)"
    )
    parser.add_argument(
        "--skip-validation",
        action="store_true",
        help="Skip startup validation (not recommended)"
    )

    args = parser.parse_args()

    try:
        # Perform startup validation unless skipped
        if not args.skip_validation:
            if not validate_startup():
                logger.error("Startup validation failed. Exiting.")
                logger.error("Use --skip-validation to bypass (not recommended)")
                sys.exit(1)

        worker = PreviewWorker(
            queue_url=args.queue_url,
            max_threads=args.threads,
            idle_timeout=args.idle_timeout
        )
        worker.start()
        sys.exit(0)

    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(130)
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
