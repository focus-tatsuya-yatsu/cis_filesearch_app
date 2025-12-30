#!/usr/bin/env python3
"""
DLQ Recovery Script
Processes messages from DLQ and attempts to re-index them
"""

import os
import sys
import json
import boto3
import logging
import argparse
from datetime import datetime
from typing import Dict, Any
from config import get_config
from opensearch_client import OpenSearchClient

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class DLQRecovery:
    """Recovery processor for Dead Letter Queue messages"""

    def __init__(self, dlq_url: str = None):
        """
        Initialize DLQ recovery

        Args:
            dlq_url: DLQ URL (defaults to environment variable or derived)
        """
        self.config = get_config()
        self.sqs = boto3.client('sqs', region_name=self.config.aws.region)
        self.s3 = boto3.client('s3', region_name=self.config.aws.region)
        self.opensearch = OpenSearchClient(self.config)

        # Get DLQ URL
        self.dlq_url = dlq_url or os.environ.get(
            'DLQ_QUEUE_URL',
            'https://sqs.ap-northeast-1.amazonaws.com/381492033915/cis-filesearch-dlq'
        )

        logger.info(f"DLQ URL: {self.dlq_url}")

        self.stats = {
            'processed': 0,
            'recovered': 0,
            'already_indexed': 0,
            'failed': 0,
            'moved_to_archive': 0
        }

    def process_dlq_batch(self, batch_size: int = 10, max_batches: int = None):
        """
        Process DLQ messages in batches

        Args:
            batch_size: Number of messages to process per batch
            max_batches: Maximum number of batches to process (None = unlimited)
        """
        logger.info("=" * 60)
        logger.info("DLQ Recovery Started")
        logger.info("=" * 60)
        logger.info(f"Batch size: {batch_size}")
        logger.info(f"Max batches: {max_batches if max_batches else 'unlimited'}")
        logger.info(f"OpenSearch: {'Connected' if self.opensearch.is_connected() else 'Not Connected'}")
        logger.info("=" * 60)

        batch_count = 0

        while True:
            if max_batches and batch_count >= max_batches:
                logger.info(f"Reached max batches limit: {max_batches}")
                break

            # Receive messages from DLQ
            response = self.sqs.receive_message(
                QueueUrl=self.dlq_url,
                MaxNumberOfMessages=batch_size,
                WaitTimeSeconds=10,
                VisibilityTimeout=300
            )

            messages = response.get('Messages', [])
            if not messages:
                logger.info("No more messages in DLQ")
                break

            logger.info(f"\n--- Batch {batch_count + 1}: {len(messages)} messages ---")

            for message in messages:
                self.process_single_message(message)

            batch_count += 1

        logger.info("\n" + "=" * 60)
        self.print_stats()
        logger.info("=" * 60)

    def process_single_message(self, message: Dict[str, Any]):
        """
        Process a single DLQ message

        Args:
            message: SQS message from DLQ
        """
        message_id = message.get('MessageId', 'unknown')
        receipt_handle = message['ReceiptHandle']

        self.stats['processed'] += 1

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

            logger.info(f"\n[{self.stats['processed']}] Processing: {key}")

            # Check if document already exists in OpenSearch
            if self.check_already_indexed(key):
                logger.info(f"  ✓ Already indexed - removing from DLQ")
                self.delete_from_dlq(receipt_handle, message_id)
                self.stats['already_indexed'] += 1
                return

            # Try to re-index
            if self.retry_indexing(bucket, key):
                logger.info(f"  ✓ Successfully re-indexed")
                self.delete_from_dlq(receipt_handle, message_id)
                self.stats['recovered'] += 1
            else:
                logger.warning(f"  ✗ Re-indexing failed")
                # Archive to S3 for manual review
                self.archive_failed_message(message, key)
                self.delete_from_dlq(receipt_handle, message_id)
                self.stats['moved_to_archive'] += 1

        except Exception as e:
            logger.error(f"  ✗ Error processing DLQ message {message_id}: {e}", exc_info=True)
            self.stats['failed'] += 1

    def check_already_indexed(self, document_id: str) -> bool:
        """
        Check if document already exists in OpenSearch

        Args:
            document_id: Document ID to check

        Returns:
            True if document exists
        """
        if not self.opensearch.is_connected():
            logger.warning("  OpenSearch not connected - cannot check if indexed")
            return False

        try:
            result = self.opensearch.client.exists(
                index=self.config.aws.opensearch_index,
                id=document_id
            )
            return result
        except Exception as e:
            logger.error(f"  Error checking if indexed: {e}")
            return False

    def retry_indexing(self, bucket: str, key: str) -> bool:
        """
        Attempt to re-index document from S3 metadata

        Args:
            bucket: S3 bucket name
            key: S3 object key

        Returns:
            True if successful
        """
        try:
            # Check if retry document exists in S3
            retry_key = f"retry-index/{datetime.utcnow().strftime('%Y-%m-%d')}/{key}.json"

            try:
                # Try to get the retry document first
                response = self.s3.get_object(Bucket=bucket, Key=retry_key)
                document = json.loads(response['Body'].read())
                logger.info(f"  Found retry document in S3")
            except self.s3.exceptions.NoSuchKey:
                # Retry document doesn't exist, create from object metadata
                logger.info(f"  Creating document from S3 metadata")
                response = self.s3.head_object(Bucket=bucket, Key=key)

                # Build basic document from metadata
                document = {
                    'file_key': key,
                    'bucket': bucket,
                    's3_url': f"s3://{bucket}/{key}",
                    'file_name': key.split('/')[-1],
                    'file_size': response.get('ContentLength', 0),
                    'mime_type': response.get('ContentType', 'application/octet-stream'),
                    'indexed_at': datetime.utcnow().isoformat(),
                    'recovery_source': 'dlq',
                    'metadata': response.get('Metadata', {}),
                    'extracted_text': '',  # No text content for retry from metadata
                    'success': True
                }

            # Index to OpenSearch
            if self.opensearch.is_connected():
                return self.opensearch.index_document(document, document_id=key)

            logger.warning("  OpenSearch not connected")
            return False

        except self.s3.exceptions.NoSuchKey:
            logger.error(f"  ✗ File no longer exists in S3: {key}")
            return False
        except Exception as e:
            logger.error(f"  ✗ Retry indexing failed for {key}: {e}")
            return False

    def archive_failed_message(self, message: Dict[str, Any], key: str):
        """
        Archive failed message to S3

        Args:
            message: SQS message
            key: Original file key
        """
        try:
            # Create archive key
            timestamp = datetime.utcnow().strftime('%Y-%m-%d_%H-%M-%S')
            safe_key = key.replace('/', '_')
            archive_key = f"dlq-archive/{datetime.utcnow().strftime('%Y-%m-%d')}/{timestamp}_{safe_key}.json"

            # Store message
            self.s3.put_object(
                Bucket=self.config.aws.s3_bucket,
                Key=archive_key,
                Body=json.dumps(message, ensure_ascii=False, indent=2),
                ContentType='application/json',
                Metadata={
                    'original-key': key,
                    'archived-at': datetime.utcnow().isoformat(),
                    'message-id': message.get('MessageId', 'unknown')
                }
            )

            logger.info(f"  Archived to: s3://{self.config.aws.s3_bucket}/{archive_key}")

        except Exception as e:
            logger.error(f"  Failed to archive message: {e}")

    def delete_from_dlq(self, receipt_handle: str, message_id: str):
        """
        Delete message from DLQ

        Args:
            receipt_handle: Message receipt handle
            message_id: Message ID
        """
        try:
            self.sqs.delete_message(
                QueueUrl=self.dlq_url,
                ReceiptHandle=receipt_handle
            )
            logger.debug(f"  Deleted from DLQ: {message_id}")
        except Exception as e:
            logger.error(f"  Failed to delete from DLQ: {e}")

    def print_stats(self):
        """Print recovery statistics"""
        logger.info("DLQ Recovery Statistics")
        logger.info(f"Total Processed:     {self.stats['processed']}")
        logger.info(f"Successfully Recovered:  {self.stats['recovered']}")
        logger.info(f"Already Indexed:     {self.stats['already_indexed']}")
        logger.info(f"Archived:            {self.stats['moved_to_archive']}")
        logger.info(f"Failed:              {self.stats['failed']}")

        total_success = self.stats['recovered'] + self.stats['already_indexed']
        if self.stats['processed'] > 0:
            success_rate = (total_success / self.stats['processed']) * 100
            logger.info(f"Success Rate:        {success_rate:.1f}%")


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description='DLQ Recovery Script',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Test with small batch
  python3 recover_dlq.py --batch-size 5 --max-batches 1

  # Process all messages
  python3 recover_dlq.py --batch-size 50

  # Dry run mode
  python3 recover_dlq.py --dry-run --batch-size 10

  # Custom DLQ URL
  python3 recover_dlq.py --dlq-url https://sqs.ap-northeast-1.amazonaws.com/.../my-dlq
        """
    )

    parser.add_argument(
        '--batch-size',
        type=int,
        default=10,
        help='Messages per batch (default: 10)'
    )

    parser.add_argument(
        '--max-batches',
        type=int,
        help='Maximum batches to process (default: unlimited)'
    )

    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Dry run mode (no changes)'
    )

    parser.add_argument(
        '--dlq-url',
        type=str,
        help='DLQ URL (defaults to environment variable)'
    )

    parser.add_argument(
        '--verbose',
        action='store_true',
        help='Verbose logging'
    )

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    if args.dry_run:
        logger.warning("=" * 60)
        logger.warning("DRY RUN MODE - No changes will be made")
        logger.warning("=" * 60)
        return

    # Create recovery instance
    recovery = DLQRecovery(dlq_url=args.dlq_url)

    # Process DLQ
    recovery.process_dlq_batch(
        batch_size=args.batch_size,
        max_batches=args.max_batches
    )


if __name__ == '__main__':
    main()
