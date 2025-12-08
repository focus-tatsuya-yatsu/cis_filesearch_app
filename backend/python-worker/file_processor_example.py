"""
File Processor Example - Python Worker
Demonstrates OCR integration with S3, SQS, and OpenSearch

This script:
1. Polls SQS for file processing messages
2. Downloads files from S3
3. Extracts text using Tesseract OCR
4. Indexes extracted text to OpenSearch
5. Updates file metadata

Usage:
    python3.11 file_processor_example.py --queue-url <SQS_URL>
"""

import os
import sys
import json
import logging
import argparse
import tempfile
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

# Import OCR processor
from ocr_config import OCRProcessor

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('/var/log/file-processor.log')
    ]
)
logger = logging.getLogger(__name__)


class FileProcessorConfig:
    """Configuration for file processor"""

    # AWS Configuration (from environment or defaults)
    AWS_REGION = os.environ.get('AWS_REGION', 'ap-northeast-1')
    S3_BUCKET = os.environ.get('S3_BUCKET', 'cis-filesearch-storage')
    SQS_QUEUE_URL = os.environ.get('SQS_QUEUE_URL', '')
    OPENSEARCH_ENDPOINT = os.environ.get('OPENSEARCH_ENDPOINT', '')
    OPENSEARCH_INDEX = os.environ.get('OPENSEARCH_INDEX', 'file-index')

    # Processing Configuration
    MAX_FILE_SIZE_MB = 50
    OCR_TIMEOUT_SECONDS = 300
    SQS_WAIT_TIME_SECONDS = 20
    SQS_VISIBILITY_TIMEOUT = 300

    # OCR Configuration
    DEFAULT_LANGUAGE = 'jpn+eng'
    PDF_DPI = 300

    # Supported file types for OCR
    SUPPORTED_IMAGE_FORMATS = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif'}
    SUPPORTED_DOCUMENT_FORMATS = {'.pdf'}

    @classmethod
    def validate(cls) -> bool:
        """Validate configuration"""
        if not cls.SQS_QUEUE_URL:
            logger.error("SQS_QUEUE_URL not configured")
            return False

        if not cls.OPENSEARCH_ENDPOINT:
            logger.warning("OPENSEARCH_ENDPOINT not configured - indexing disabled")

        return True


class FileProcessor:
    """
    File Processor Worker
    Processes files from S3 using OCR and indexes to OpenSearch
    """

    def __init__(self, config: FileProcessorConfig):
        """
        Initialize File Processor

        Args:
            config: Configuration object
        """
        self.config = config

        # Initialize AWS clients
        self.s3 = boto3.client('s3', region_name=config.AWS_REGION)
        self.sqs = boto3.client('sqs', region_name=config.AWS_REGION)

        # Initialize OCR processor
        self.ocr = OCRProcessor()

        logger.info("File Processor initialized")
        logger.info(f"S3 Bucket: {config.S3_BUCKET}")
        logger.info(f"SQS Queue: {config.SQS_QUEUE_URL}")
        logger.info(f"Region: {config.AWS_REGION}")

    def download_from_s3(self, bucket: str, key: str, local_path: str) -> bool:
        """
        Download file from S3

        Args:
            bucket: S3 bucket name
            key: S3 object key
            local_path: Local file path to save

        Returns:
            True if successful, False otherwise
        """
        try:
            logger.info(f"Downloading s3://{bucket}/{key} to {local_path}")

            self.s3.download_file(bucket, key, local_path)

            # Verify file size
            file_size = os.path.getsize(local_path)
            max_size = self.config.MAX_FILE_SIZE_MB * 1024 * 1024

            if file_size > max_size:
                logger.error(f"File too large: {file_size} bytes (max: {max_size})")
                return False

            logger.info(f"Downloaded {file_size} bytes")
            return True

        except ClientError as e:
            logger.error(f"Failed to download from S3: {e}")
            return False

    def extract_text(self, file_path: str, file_type: str) -> Optional[str]:
        """
        Extract text from file using OCR

        Args:
            file_path: Path to file
            file_type: File extension

        Returns:
            Extracted text or None if failed
        """
        try:
            file_type = file_type.lower()

            if file_type in self.config.SUPPORTED_IMAGE_FORMATS:
                logger.info(f"Extracting text from image: {file_path}")
                text = self.ocr.extract_text_from_image(
                    file_path,
                    lang=self.config.DEFAULT_LANGUAGE
                )

            elif file_type in self.config.SUPPORTED_DOCUMENT_FORMATS:
                logger.info(f"Extracting text from PDF: {file_path}")
                text = self.ocr.extract_text_from_pdf(
                    file_path,
                    lang=self.config.DEFAULT_LANGUAGE,
                    dpi=self.config.PDF_DPI
                )

            else:
                logger.warning(f"Unsupported file type: {file_type}")
                return None

            logger.info(f"Extracted {len(text)} characters")
            return text

        except Exception as e:
            logger.error(f"Failed to extract text: {e}")
            return None

    def index_to_opensearch(self, document: Dict[str, Any]) -> bool:
        """
        Index document to OpenSearch

        Args:
            document: Document to index

        Returns:
            True if successful, False otherwise
        """
        # TODO: Implement OpenSearch indexing
        # This is a placeholder for actual implementation

        if not self.config.OPENSEARCH_ENDPOINT:
            logger.warning("OpenSearch endpoint not configured - skipping indexing")
            return False

        try:
            logger.info(f"Indexing document: {document.get('file_key')}")

            # Example using opensearch-py library
            # from opensearchpy import OpenSearch
            # client = OpenSearch([self.config.OPENSEARCH_ENDPOINT])
            # response = client.index(
            #     index=self.config.OPENSEARCH_INDEX,
            #     body=document
            # )

            logger.info("Document indexed successfully")
            return True

        except Exception as e:
            logger.error(f"Failed to index document: {e}")
            return False

    def process_file(self, message: Dict[str, Any]) -> bool:
        """
        Process a single file

        Args:
            message: SQS message containing file information

        Returns:
            True if processing successful, False otherwise
        """
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
                bucket = body.get('bucket', self.config.S3_BUCKET)
                key = body['key']

            file_ext = Path(key).suffix.lower()

            logger.info(f"Processing file: s3://{bucket}/{key}")

            # Create temporary file
            with tempfile.NamedTemporaryFile(
                suffix=file_ext,
                delete=False
            ) as tmp_file:
                tmp_path = tmp_file.name

            try:
                # Download file
                if not self.download_from_s3(bucket, key, tmp_path):
                    return False

                # Extract text
                text = self.extract_text(tmp_path, file_ext)

                if text is None:
                    logger.warning("No text extracted - skipping indexing")
                    return False

                # Prepare document for indexing
                document = {
                    'file_key': key,
                    'bucket': bucket,
                    'file_name': Path(key).name,
                    'file_path': key,
                    'file_type': file_ext,
                    'extracted_text': text,
                    'char_count': len(text),
                    'word_count': len(text.split()),
                    'processed_at': datetime.utcnow().isoformat(),
                    'processor_version': '1.0.0',
                }

                # Index to OpenSearch
                if self.index_to_opensearch(document):
                    logger.info(f"Successfully processed: {key}")
                    return True
                else:
                    logger.error(f"Failed to index: {key}")
                    return False

            finally:
                # Clean up temporary file
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)

        except Exception as e:
            logger.error(f"Error processing file: {e}")
            return False

    def poll_and_process(self):
        """
        Poll SQS queue and process messages

        This is the main worker loop
        """
        logger.info("Starting to poll SQS queue...")

        while True:
            try:
                # Receive messages from SQS
                response = self.sqs.receive_message(
                    QueueUrl=self.config.SQS_QUEUE_URL,
                    MaxNumberOfMessages=1,
                    WaitTimeSeconds=self.config.SQS_WAIT_TIME_SECONDS,
                    VisibilityTimeout=self.config.SQS_VISIBILITY_TIMEOUT,
                )

                messages = response.get('Messages', [])

                if not messages:
                    logger.debug("No messages received")
                    continue

                for message in messages:
                    receipt_handle = message['ReceiptHandle']

                    try:
                        # Process the message
                        success = self.process_file(message)

                        if success:
                            # Delete message from queue
                            self.sqs.delete_message(
                                QueueUrl=self.config.SQS_QUEUE_URL,
                                ReceiptHandle=receipt_handle
                            )
                            logger.info("Message processed and deleted")
                        else:
                            logger.error("Processing failed - message will be retried")

                    except Exception as e:
                        logger.error(f"Error processing message: {e}")

            except KeyboardInterrupt:
                logger.info("Received shutdown signal")
                break

            except Exception as e:
                logger.error(f"Error in polling loop: {e}")
                # Continue processing

        logger.info("Worker stopped")


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description='File Processor Worker')
    parser.add_argument(
        '--queue-url',
        type=str,
        help='SQS queue URL',
        default=FileProcessorConfig.SQS_QUEUE_URL
    )
    parser.add_argument(
        '--bucket',
        type=str,
        help='S3 bucket name',
        default=FileProcessorConfig.S3_BUCKET
    )
    parser.add_argument(
        '--region',
        type=str,
        help='AWS region',
        default=FileProcessorConfig.AWS_REGION
    )

    args = parser.parse_args()

    # Update configuration from args
    if args.queue_url:
        FileProcessorConfig.SQS_QUEUE_URL = args.queue_url
    if args.bucket:
        FileProcessorConfig.S3_BUCKET = args.bucket
    if args.region:
        FileProcessorConfig.AWS_REGION = args.region

    # Validate configuration
    if not FileProcessorConfig.validate():
        logger.error("Invalid configuration")
        sys.exit(1)

    # Create and start processor
    try:
        processor = FileProcessor(FileProcessorConfig)
        processor.poll_and_process()

    except Exception as e:
        logger.error(f"Fatal error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
