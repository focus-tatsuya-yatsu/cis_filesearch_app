#!/usr/bin/env python3.11
"""
DLQ Reprocessor - Automatic Dead Letter Queue Recovery

Features:
1. Analyzes DLQ messages to categorize failures
2. Automatically retries recoverable failures
3. Implements exponential backoff
4. Monitors retry success rate
5. Alerts on persistent failures

Usage:
  # Manual reprocessing
  python dlq_reprocessor.py --dry-run
  python dlq_reprocessor.py --max-retries 1000

  # Automated (cron)
  */15 * * * * /usr/bin/python3.11 /home/ec2-user/python-worker/dlq_reprocessor.py --auto
"""

import os
import sys
import json
import time
import logging
import argparse
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from collections import defaultdict

import boto3
from botocore.exceptions import ClientError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class DLQAnalyzer:
    """Analyzes DLQ messages to understand failure patterns"""

    def __init__(self, dlq_url: str, region: str = 'ap-northeast-1'):
        self.dlq_url = dlq_url
        self.region = region
        self.sqs = boto3.client('sqs', region_name=region)

    def get_failure_categories(self, max_messages: int = 100) -> Dict[str, int]:
        """
        Analyze DLQ messages and categorize failures

        Returns:
            Dict mapping failure category to count
        """
        categories = defaultdict(int)

        try:
            # Sample messages from DLQ
            for _ in range(max_messages // 10):  # Batch of 10 messages
                response = self.sqs.receive_message(
                    QueueUrl=self.dlq_url,
                    MaxNumberOfMessages=10,
                    WaitTimeSeconds=2,
                    MessageAttributeNames=['All']
                )

                messages = response.get('Messages', [])
                if not messages:
                    break

                for message in messages:
                    # Extract error category from message attributes
                    error_msg = message.get('MessageAttributes', {}).get('ErrorMessage', {}).get('StringValue', 'Unknown')

                    # Categorize error
                    category = self._categorize_error(error_msg)
                    categories[category] += 1

                    # Return message to queue (don't delete during analysis)
                    self.sqs.change_message_visibility(
                        QueueUrl=self.dlq_url,
                        ReceiptHandle=message['ReceiptHandle'],
                        VisibilityTimeout=0  # Make visible immediately
                    )

        except Exception as e:
            logger.error(f"Failed to analyze DLQ: {e}")

        return dict(categories)

    def _categorize_error(self, error_message: str) -> str:
        """Categorize error message into recoverable/unrecoverable types"""
        error_lower = error_message.lower()

        # Recoverable errors (transient)
        if any(keyword in error_lower for keyword in ['timeout', 'throttling', 'rate limit', 'connection']):
            return 'RECOVERABLE_NETWORK'

        if any(keyword in error_lower for keyword in ['memory', 'disk space']):
            return 'RECOVERABLE_RESOURCE'

        if 'opensearch' in error_lower or 'index' in error_lower:
            return 'RECOVERABLE_OPENSEARCH'

        # Unrecoverable errors (permanent)
        if any(keyword in error_lower for keyword in ['unsupported', 'invalid format', 'corrupt']):
            return 'UNRECOVERABLE_FORMAT'

        if 'not found' in error_lower or '404' in error_message:
            return 'UNRECOVERABLE_NOTFOUND'

        if 'permission' in error_lower or 'access denied' in error_lower:
            return 'UNRECOVERABLE_PERMISSION'

        return 'UNKNOWN'


class DLQReprocessor:
    """Reprocesses DLQ messages with intelligent retry logic"""

    def __init__(
        self,
        dlq_url: str,
        main_queue_url: str,
        region: str = 'ap-northeast-1',
        dry_run: bool = False
    ):
        self.dlq_url = dlq_url
        self.main_queue_url = main_queue_url
        self.region = region
        self.dry_run = dry_run
        self.sqs = boto3.client('sqs', region_name=region)

        self.stats = {
            'total_examined': 0,
            'requeued': 0,
            'skipped_unrecoverable': 0,
            'skipped_recent': 0,
            'errors': 0,
        }

    def should_retry(self, message: Dict) -> Tuple[bool, str]:
        """
        Determine if message should be retried

        Returns:
            (should_retry, reason)
        """
        # Extract message attributes
        attrs = message.get('MessageAttributes', {})
        error_msg = attrs.get('ErrorMessage', {}).get('StringValue', '')
        failed_at_str = attrs.get('FailedAt', {}).get('StringValue', '')

        # Check if error is recoverable
        analyzer = DLQAnalyzer(self.dlq_url, self.region)
        category = analyzer._categorize_error(error_msg)

        if category.startswith('UNRECOVERABLE'):
            return False, f"Unrecoverable error: {category}"

        # Check age of failure (don't retry very recent failures)
        if failed_at_str:
            try:
                failed_at = datetime.fromisoformat(failed_at_str.replace('Z', '+00:00'))
                age = datetime.now(failed_at.tzinfo) - failed_at

                # Don't retry failures less than 5 minutes old
                if age < timedelta(minutes=5):
                    return False, f"Failure too recent: {age.seconds}s ago"

            except Exception as e:
                logger.warning(f"Failed to parse timestamp: {e}")

        # Check retry count (from custom attribute)
        retry_count = int(attrs.get('RetryCount', {}).get('StringValue', '0'))
        max_retries = 3

        if retry_count >= max_retries:
            return False, f"Max retries exceeded: {retry_count}/{max_retries}"

        return True, f"Recoverable error: {category}"

    def reprocess_messages(self, max_messages: int = 1000, batch_size: int = 10) -> Dict[str, int]:
        """
        Reprocess messages from DLQ

        Args:
            max_messages: Maximum number of messages to process
            batch_size: Number of messages to receive per batch

        Returns:
            Statistics dictionary
        """
        logger.info("=" * 60)
        logger.info(f"Starting DLQ Reprocessing ({'DRY RUN' if self.dry_run else 'LIVE'})")
        logger.info("=" * 60)

        processed = 0

        while processed < max_messages:
            try:
                # Receive messages from DLQ
                response = self.sqs.receive_message(
                    QueueUrl=self.dlq_url,
                    MaxNumberOfMessages=min(batch_size, max_messages - processed),
                    WaitTimeSeconds=5,
                    MessageAttributeNames=['All']
                )

                messages = response.get('Messages', [])

                if not messages:
                    logger.info("No more messages in DLQ")
                    break

                self.stats['total_examined'] += len(messages)

                for message in messages:
                    receipt_handle = message['ReceiptHandle']
                    message_id = message.get('MessageId', 'unknown')

                    # Determine if should retry
                    should_retry, reason = self.should_retry(message)

                    logger.info(f"Message {message_id}: {reason}")

                    if should_retry:
                        if not self.dry_run:
                            # Increment retry count
                            attrs = message.get('MessageAttributes', {})
                            retry_count = int(attrs.get('RetryCount', {}).get('StringValue', '0'))

                            # Send back to main queue with updated retry count
                            self.sqs.send_message(
                                QueueUrl=self.main_queue_url,
                                MessageBody=message['Body'],
                                MessageAttributes={
                                    **attrs,
                                    'RetryCount': {
                                        'StringValue': str(retry_count + 1),
                                        'DataType': 'String'
                                    },
                                    'ReprocessedAt': {
                                        'StringValue': datetime.utcnow().isoformat(),
                                        'DataType': 'String'
                                    }
                                }
                            )

                            # Delete from DLQ
                            self.sqs.delete_message(
                                QueueUrl=self.dlq_url,
                                ReceiptHandle=receipt_handle
                            )

                        self.stats['requeued'] += 1
                        logger.info(f"  → Requeued to main queue")

                    elif 'Unrecoverable' in reason:
                        self.stats['skipped_unrecoverable'] += 1

                        if not self.dry_run:
                            # Move to permanent failure storage (S3)
                            self._archive_failed_message(message)

                            # Delete from DLQ
                            self.sqs.delete_message(
                                QueueUrl=self.dlq_url,
                                ReceiptHandle=receipt_handle
                            )

                        logger.info(f"  → Archived as unrecoverable")

                    else:
                        self.stats['skipped_recent'] += 1
                        logger.info(f"  → Skipped (will retry later)")

                        # Return to DLQ with longer visibility timeout
                        if not self.dry_run:
                            self.sqs.change_message_visibility(
                                QueueUrl=self.dlq_url,
                                ReceiptHandle=receipt_handle,
                                VisibilityTimeout=300  # 5 minutes
                            )

                processed += len(messages)

            except Exception as e:
                logger.error(f"Error processing batch: {e}", exc_info=True)
                self.stats['errors'] += 1
                time.sleep(5)  # Back off on error

        self._print_statistics()

        return self.stats

    def _archive_failed_message(self, message: Dict):
        """Archive permanently failed message to S3"""
        try:
            bucket = os.environ.get('S3_BUCKET', 'cis-filesearch-storage')
            key = f"dlq-archive/{datetime.utcnow().strftime('%Y/%m/%d')}/{message['MessageId']}.json"

            s3 = boto3.client('s3', region_name=self.region)
            s3.put_object(
                Bucket=bucket,
                Key=key,
                Body=json.dumps(message, indent=2),
                ContentType='application/json',
                Metadata={
                    'message-id': message['MessageId'],
                    'archived-at': datetime.utcnow().isoformat()
                }
            )

            logger.info(f"Archived message to s3://{bucket}/{key}")

        except Exception as e:
            logger.error(f"Failed to archive message: {e}")

    def _print_statistics(self):
        """Print reprocessing statistics"""
        logger.info("=" * 60)
        logger.info("Reprocessing Statistics:")
        logger.info(f"  Total Examined: {self.stats['total_examined']}")
        logger.info(f"  Requeued: {self.stats['requeued']}")
        logger.info(f"  Skipped (Unrecoverable): {self.stats['skipped_unrecoverable']}")
        logger.info(f"  Skipped (Too Recent): {self.stats['skipped_recent']}")
        logger.info(f"  Errors: {self.stats['errors']}")
        logger.info("=" * 60)


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description='DLQ Reprocessor - Automatic recovery from Dead Letter Queue',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Analyze only, do not modify queues'
    )

    parser.add_argument(
        '--max-messages',
        type=int,
        default=1000,
        help='Maximum number of messages to process (default: 1000)'
    )

    parser.add_argument(
        '--analyze-only',
        action='store_true',
        help='Only analyze failure categories'
    )

    parser.add_argument(
        '--auto',
        action='store_true',
        help='Automated mode (for cron)'
    )

    args = parser.parse_args()

    # Get queue URLs from environment
    dlq_url = os.environ.get('DLQ_QUEUE_URL')
    main_queue_url = os.environ.get('SQS_QUEUE_URL')
    region = os.environ.get('AWS_REGION', 'ap-northeast-1')

    if not dlq_url or not main_queue_url:
        logger.error("DLQ_QUEUE_URL and SQS_QUEUE_URL must be set")
        sys.exit(1)

    # Analyze failure categories
    if args.analyze_only:
        analyzer = DLQAnalyzer(dlq_url, region)
        categories = analyzer.get_failure_categories()

        logger.info("=" * 60)
        logger.info("DLQ Failure Analysis:")
        for category, count in sorted(categories.items(), key=lambda x: x[1], reverse=True):
            logger.info(f"  {category}: {count}")
        logger.info("=" * 60)

        sys.exit(0)

    # Reprocess messages
    reprocessor = DLQReprocessor(
        dlq_url=dlq_url,
        main_queue_url=main_queue_url,
        region=region,
        dry_run=args.dry_run
    )

    stats = reprocessor.reprocess_messages(max_messages=args.max_messages)

    # Send CloudWatch metrics in auto mode
    if args.auto and not args.dry_run:
        try:
            cloudwatch = boto3.client('cloudwatch', region_name=region)
            cloudwatch.put_metric_data(
                Namespace='CISFileSearch/DLQ',
                MetricData=[
                    {
                        'MetricName': 'MessagesRequeued',
                        'Value': stats['requeued'],
                        'Unit': 'Count'
                    },
                    {
                        'MetricName': 'UnrecoverableMessages',
                        'Value': stats['skipped_unrecoverable'],
                        'Unit': 'Count'
                    }
                ]
            )
        except Exception as e:
            logger.error(f"Failed to send metrics: {e}")

    sys.exit(0)


if __name__ == '__main__':
    main()
