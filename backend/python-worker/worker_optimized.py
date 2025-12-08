"""
Optimized Worker Module with Multiprocessing
High-performance file processing with parallel execution
Target: 500 files/hour per worker, <4GB memory usage
"""

import os
import sys
import json
import time
import logging
import tempfile
import argparse
import signal
import gc
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime
from multiprocessing import Pool, cpu_count, Manager
from dataclasses import dataclass

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError

from config import get_config
from file_router import FileRouter
from opensearch_client import OpenSearchClient
from services.resource_manager import ResourceManager
from services.batch_processor import MessageBatcher


# Configure logging
def setup_logging(config):
    """Setup logging configuration"""
    log_level = config.logging.get_log_level()

    formatter = logging.Formatter(
        '%(asctime)s - %(processName)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)

    logging.basicConfig(
        level=log_level,
        handlers=[console_handler]
    )

    # Suppress noisy loggers
    logging.getLogger('boto3').setLevel(logging.WARNING)
    logging.getLogger('botocore').setLevel(logging.WARNING)
    logging.getLogger('urllib3').setLevel(logging.WARNING)

    logger = logging.getLogger(__name__)
    logger.info("Logging configured")

    return logger


@dataclass
class ProcessingStats:
    """Thread-safe processing statistics"""
    processed: int = 0
    succeeded: int = 0
    failed: int = 0
    total_processing_time: float = 0.0
    total_download_time: float = 0.0
    total_ocr_time: float = 0.0
    total_index_time: float = 0.0

    def add_success(self, download_time: float, ocr_time: float, index_time: float):
        """Add successful processing stats"""
        self.processed += 1
        self.succeeded += 1
        self.total_processing_time += (download_time + ocr_time + index_time)
        self.total_download_time += download_time
        self.total_ocr_time += ocr_time
        self.total_index_time += index_time

    def add_failure(self):
        """Add failed processing stats"""
        self.processed += 1
        self.failed += 1


def process_single_message(args: tuple) -> Dict[str, Any]:
    """
    Process a single SQS message (worker function for multiprocessing)

    Args:
        args: Tuple of (message, config_dict)

    Returns:
        Processing result dict
    """
    message, config_dict = args

    # Setup logging for worker process
    logger = logging.getLogger(f"Worker-{os.getpid()}")

    result = {
        'success': False,
        'message_id': message.get('MessageId', 'unknown'),
        'receipt_handle': message['ReceiptHandle'],
        'download_time': 0.0,
        'ocr_time': 0.0,
        'index_time': 0.0,
        'error': None
    }

    temp_file_path = None

    try:
        # Parse message body
        body = json.loads(message['Body'])

        # Extract file information
        if 'Records' in body:
            record = body['Records'][0]
            bucket = record['s3']['bucket']['name']
            key = record['s3']['object']['key']
        else:
            bucket = body.get('bucket', config_dict['s3_bucket'])
            key = body['key']

        logger.info(f"Processing: s3://{bucket}/{key}")

        # Initialize AWS clients (per-process)
        boto_config = BotoConfig(
            region_name=config_dict['region'],
            retries={'max_attempts': 3, 'mode': 'adaptive'},
            max_pool_connections=10
        )
        s3_client = boto3.client('s3', config=boto_config)

        # Initialize file router and OpenSearch client
        from config import Config
        config = Config()
        config.aws.region = config_dict['region']
        config.aws.s3_bucket = config_dict['s3_bucket']
        config.aws.opensearch_endpoint = config_dict['opensearch_endpoint']
        config.aws.opensearch_index = config_dict['opensearch_index']

        file_router = FileRouter(config)
        opensearch = OpenSearchClient(config)

        # Check file type support
        if not file_router.is_supported(key):
            ext = Path(key).suffix.lower()
            result['error'] = f"Unsupported file type: {ext}"
            return result

        # Create temporary file
        file_ext = Path(key).suffix
        with tempfile.NamedTemporaryFile(
            suffix=file_ext,
            delete=False,
            dir=config_dict['temp_dir']
        ) as tmp_file:
            temp_file_path = tmp_file.name

        # Step 1: Download from S3 (with multipart for large files)
        download_start = time.time()

        file_size = s3_client.head_object(Bucket=bucket, Key=key)['ContentLength']

        if file_size > 50 * 1024 * 1024:  # 50MB threshold
            # Use multipart download for large files
            from boto3.s3.transfer import TransferConfig
            transfer_config = TransferConfig(
                multipart_threshold=50 * 1024 * 1024,
                max_concurrency=4,
                multipart_chunksize=10 * 1024 * 1024,
                use_threads=True
            )
            s3_client.download_file(bucket, key, temp_file_path, Config=transfer_config)
        else:
            # Standard download
            s3_client.download_file(bucket, key, temp_file_path)

        result['download_time'] = time.time() - download_start
        logger.debug(f"Downloaded in {result['download_time']:.2f}s")

        # Step 2: Process file (OCR)
        ocr_start = time.time()
        processing_result = file_router.process_file(temp_file_path)
        result['ocr_time'] = time.time() - ocr_start

        if not processing_result.success:
            result['error'] = processing_result.error_message
            return result

        logger.debug(f"Processed in {result['ocr_time']:.2f}s")

        # Step 3: Index to OpenSearch
        index_start = time.time()

        document = processing_result.to_dict()
        document['file_key'] = key
        document['bucket'] = bucket
        document['s3_url'] = f"s3://{bucket}/{key}"

        if opensearch.is_connected():
            if not opensearch.index_document(document, document_id=key):
                result['error'] = "Failed to index document"
                return result

        result['index_time'] = time.time() - index_start
        logger.debug(f"Indexed in {result['index_time']:.2f}s")

        result['success'] = True

        total_time = result['download_time'] + result['ocr_time'] + result['index_time']
        logger.info(
            f"Successfully processed: {Path(key).name} "
            f"({processing_result.char_count:,} chars, {total_time:.2f}s)"
        )

    except Exception as e:
        logger.error(f"Error processing message: {e}", exc_info=True)
        result['error'] = str(e)

    finally:
        # Cleanup temporary file
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception as e:
                logger.warning(f"Failed to remove temp file: {e}")

        # Force garbage collection every 10 files
        if result['message_id'].endswith(('0', '5')):
            gc.collect()

    return result


class OptimizedFileProcessingWorker:
    """
    Optimized worker with multiprocessing support
    Target: 500 files/hour with <4GB memory usage
    """

    def __init__(self, config):
        """Initialize optimized worker"""
        self.config = config
        self.logger = logging.getLogger(__name__)
        self.shutdown_requested = False

        # Calculate optimal worker count
        # Leave 1 CPU for main process and system
        cpu_cores = cpu_count()
        self.worker_count = max(1, cpu_cores - 1)
        self.logger.info(f"CPU cores: {cpu_cores}, Workers: {self.worker_count}")

        # Initialize AWS clients (main process)
        boto_config = BotoConfig(
            region_name=config.aws.region,
            retries={'max_attempts': 3, 'mode': 'adaptive'},
            max_pool_connections=50  # Support concurrent workers
        )

        self.sqs_client = boto3.client('sqs', config=boto_config)

        # Initialize message batcher
        self.message_batcher = MessageBatcher(
            self.sqs_client,
            config.aws.sqs_queue_url,
            config
        )

        # Initialize resource manager
        self.resource_manager = ResourceManager(config)

        # Setup signal handlers
        signal.signal(signal.SIGTERM, self._handle_shutdown_signal)
        signal.signal(signal.SIGINT, self._handle_shutdown_signal)

        # Statistics (thread-safe with Manager)
        manager = Manager()
        self.stats = manager.dict({
            'processed': 0,
            'succeeded': 0,
            'failed': 0,
            'start_time': time.time(),
            'total_processing_time': 0.0,
            'total_download_time': 0.0,
            'total_ocr_time': 0.0,
            'total_index_time': 0.0,
        })

        # Files processed counter for GC
        self.files_since_gc = 0
        self.gc_interval = 50  # Force GC every 50 files

        self.logger.info("Optimized worker initialized successfully")

    def _handle_shutdown_signal(self, signum, frame):
        """Handle shutdown signals"""
        self.logger.info(f"Received signal {signum}, initiating graceful shutdown...")
        self.shutdown_requested = True

    def _create_config_dict(self) -> Dict[str, Any]:
        """Create serializable config dict for worker processes"""
        return {
            'region': self.config.aws.region,
            's3_bucket': self.config.aws.s3_bucket,
            'opensearch_endpoint': self.config.aws.opensearch_endpoint,
            'opensearch_index': self.config.aws.opensearch_index,
            'temp_dir': self.config.processing.temp_dir,
        }

    def poll_and_process(self):
        """Main worker loop with multiprocessing"""
        self.logger.info("Starting optimized worker loop...")
        self.logger.info(f"Queue URL: {self.config.aws.sqs_queue_url[:50]}...")

        # Create worker pool (reusable)
        with Pool(processes=self.worker_count) as pool:
            while not self.shutdown_requested:
                try:
                    # Check resource health before processing
                    if not self._check_resource_health():
                        self.logger.warning("Unhealthy resources, waiting...")
                        time.sleep(30)
                        continue

                    # Receive messages in batch
                    messages = self.message_batcher.receive_message_batch()

                    if not messages:
                        self.logger.debug("No messages received")

                        # Periodic maintenance during idle time
                        self._perform_maintenance()
                        continue

                    self.logger.info(f"Received {len(messages)} message(s)")

                    # Prepare arguments for worker processes
                    config_dict = self._create_config_dict()
                    worker_args = [(msg, config_dict) for msg in messages]

                    # Process messages in parallel
                    batch_start = time.time()
                    results = pool.map(process_single_message, worker_args)
                    batch_time = time.time() - batch_start

                    # Collect results and delete successful messages
                    successful_handles = []

                    for result in results:
                        self.stats['processed'] = self.stats['processed'] + 1

                        if result['success']:
                            self.stats['succeeded'] = self.stats['succeeded'] + 1
                            self.stats['total_download_time'] = self.stats['total_download_time'] + result['download_time']
                            self.stats['total_ocr_time'] = self.stats['total_ocr_time'] + result['ocr_time']
                            self.stats['total_index_time'] = self.stats['total_index_time'] + result['index_time']

                            successful_handles.append(result['receipt_handle'])
                        else:
                            self.stats['failed'] = self.stats['failed'] + 1
                            self.logger.error(f"Processing failed: {result['error']}")

                    # Batch delete successful messages
                    if successful_handles:
                        delete_result = self.message_batcher.delete_message_batch(successful_handles)
                        self.logger.info(
                            f"Batch delete: {delete_result['successful']}/{len(successful_handles)} succeeded"
                        )

                    # Log batch statistics
                    throughput = len(messages) / batch_time if batch_time > 0 else 0
                    self.logger.info(
                        f"Batch completed: {len(results)} messages in {batch_time:.2f}s "
                        f"({throughput:.2f} msg/s)"
                    )

                    # Increment file counter for GC
                    self.files_since_gc += len(messages)

                    # Force garbage collection periodically
                    if self.files_since_gc >= self.gc_interval:
                        self._force_garbage_collection()
                        self.files_since_gc = 0

                except KeyboardInterrupt:
                    self.logger.info("Received keyboard interrupt")
                    break

                except Exception as e:
                    self.logger.error(f"Error in polling loop: {e}", exc_info=True)
                    time.sleep(5)  # Back off on errors

        self.logger.info("Worker stopped")
        self._print_statistics()

        # Final cleanup
        self.resource_manager.cleanup_all()

    def _check_resource_health(self) -> bool:
        """Check if system resources are healthy"""
        try:
            # Check memory
            if not self.resource_manager.check_memory_available(min_free_mb=500.0):
                self.logger.warning("Low memory - forcing GC")
                self._force_garbage_collection()
                return self.resource_manager.check_memory_available(min_free_mb=200.0)

            # Check disk space
            if not self.resource_manager.check_disk_space(min_free_gb=2.0):
                self.logger.warning("Low disk space - cleaning up")
                self.resource_manager.cleanup_old_files(max_age_hours=1)
                return self.resource_manager.check_disk_space(min_free_gb=1.0)

            return True

        except Exception as e:
            self.logger.error(f"Error checking resource health: {e}")
            return True  # Continue processing on check failure

    def _perform_maintenance(self):
        """Perform periodic maintenance tasks during idle time"""
        # Clean up old temporary files
        self.resource_manager.cleanup_old_files(max_age_hours=24)

        # Log resource usage every 10 idle cycles
        if hasattr(self, '_idle_count'):
            self._idle_count += 1
        else:
            self._idle_count = 1

        if self._idle_count >= 10:
            self.resource_manager.log_resource_usage()
            self._idle_count = 0

    def _force_garbage_collection(self):
        """Force garbage collection and log memory freed"""
        self.resource_manager.force_garbage_collection()

    def _print_statistics(self):
        """Print comprehensive worker statistics"""
        runtime = time.time() - self.stats['start_time']
        runtime_hours = runtime / 3600

        self.logger.info("=" * 60)
        self.logger.info("=== Worker Statistics ===")
        self.logger.info(f"Runtime: {runtime:.0f} seconds ({runtime_hours:.2f} hours)")
        self.logger.info(f"Total Processed: {self.stats['processed']}")
        self.logger.info(f"Succeeded: {self.stats['succeeded']}")
        self.logger.info(f"Failed: {self.stats['failed']}")

        if self.stats['processed'] > 0:
            success_rate = (self.stats['succeeded'] / self.stats['processed']) * 100
            self.logger.info(f"Success Rate: {success_rate:.1f}%")

            if runtime_hours > 0:
                throughput = self.stats['processed'] / runtime_hours
                self.logger.info(f"Throughput: {throughput:.1f} files/hour")

        # Performance breakdown
        if self.stats['succeeded'] > 0:
            avg_download = self.stats['total_download_time'] / self.stats['succeeded']
            avg_ocr = self.stats['total_ocr_time'] / self.stats['succeeded']
            avg_index = self.stats['total_index_time'] / self.stats['succeeded']
            avg_total = avg_download + avg_ocr + avg_index

            self.logger.info("")
            self.logger.info("=== Performance Breakdown (Average) ===")
            self.logger.info(f"Download: {avg_download:.2f}s ({avg_download/avg_total*100:.1f}%)")
            self.logger.info(f"OCR:      {avg_ocr:.2f}s ({avg_ocr/avg_total*100:.1f}%)")
            self.logger.info(f"Index:    {avg_index:.2f}s ({avg_index/avg_total*100:.1f}%)")
            self.logger.info(f"Total:    {avg_total:.2f}s")

        self.logger.info("=" * 60)

        # Final resource usage
        self.resource_manager.log_resource_usage()


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description='Optimized File Processing Worker with Multiprocessing',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Environment Variables:
  AWS_REGION              AWS region (default: ap-northeast-1)
  S3_BUCKET              S3 bucket name
  SQS_QUEUE_URL          SQS queue URL (required)
  OPENSEARCH_ENDPOINT    OpenSearch endpoint URL
  OPENSEARCH_INDEX       OpenSearch index name (default: file-index)
  LOG_LEVEL              Logging level (DEBUG, INFO, WARNING, ERROR)
  MAX_WORKERS            Number of worker processes (default: CPU_COUNT-1)

Example:
  python worker_optimized.py
  python worker_optimized.py --validate-only

Performance Target:
  - 500 files/hour per worker instance
  - <4GB memory usage
  - Automatic resource management
        """
    )

    parser.add_argument(
        '--validate-only',
        action='store_true',
        help='Validate configuration and exit'
    )

    args = parser.parse_args()

    # Load configuration
    config = get_config()

    # Setup logging
    logger = setup_logging(config)

    logger.info("=" * 60)
    logger.info("Optimized File Processing Worker - Starting")
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

    # Create and start optimized worker
    try:
        worker = OptimizedFileProcessingWorker(config)
        worker.poll_and_process()

    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
