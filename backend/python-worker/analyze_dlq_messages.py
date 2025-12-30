#!/usr/bin/env python3
"""
Dead Letter Queue (DLQ) Message Analysis Tool

Analyzes messages in the DLQ to identify failure patterns and root causes.
This tool helps diagnose why messages are failing to process successfully.

Key Analysis:
- Error pattern classification
- Failure rate calculation
- Failed step identification (S3/OCR/Bedrock/OpenSearch)
- Temporal patterns (time-based failures)
- Resource-specific failures

Usage:
    python3 analyze_dlq_messages.py
    python3 analyze_dlq_messages.py --dlq-url <DLQ_URL>
    python3 analyze_dlq_messages.py --max-messages 100 --output report.json
    python3 analyze_dlq_messages.py --replay-messages  # Re-send failed messages back to main queue

Security Considerations:
- Read-only by default (--replay-messages enables writes)
- Does not delete DLQ messages unless explicitly requested
- Exports sensitive information to JSON (use with caution)
"""

import os
import sys
import json
import logging
import argparse
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Counter as CounterType
from collections import Counter, defaultdict
from dataclasses import dataclass, asdict, field

import boto3
from botocore.exceptions import ClientError, NoCredentialsError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


@dataclass
class DLQMessage:
    """Represents a single DLQ message"""
    message_id: str
    receipt_handle: str
    body: str
    attributes: Dict[str, Any]
    message_attributes: Dict[str, Any]
    sent_timestamp: int
    approximate_receive_count: int

    # Parsed information
    parsed_body: Optional[Dict[str, Any]] = None
    error_type: Optional[str] = None
    error_message: Optional[str] = None
    failed_step: Optional[str] = None
    file_key: Optional[str] = None
    file_type: Optional[str] = None

    def parse(self):
        """Parse message body and extract error information"""
        try:
            self.parsed_body = json.loads(self.body)

            # Extract file information
            if 'Records' in self.parsed_body:
                # S3 event notification format
                record = self.parsed_body['Records'][0]
                self.file_key = record['s3']['object']['key']
            elif 'key' in self.parsed_body:
                # Custom message format
                self.file_key = self.parsed_body['key']

            # Determine file type
            if self.file_key:
                ext = self.file_key.split('.')[-1].lower() if '.' in self.file_key else 'unknown'
                self.file_type = ext

            # Extract error information (if present in message)
            if 'error' in self.parsed_body:
                self.error_message = self.parsed_body['error']

            if 'errorType' in self.parsed_body:
                self.error_type = self.parsed_body['errorType']

            if 'failedStep' in self.parsed_body:
                self.failed_step = self.parsed_body['failedStep']

        except json.JSONDecodeError:
            logger.warning(f"Failed to parse message body as JSON: {self.message_id}")
        except Exception as e:
            logger.error(f"Error parsing message {self.message_id}: {e}")


@dataclass
class DLQAnalysisReport:
    """Analysis report for DLQ messages"""
    timestamp: str
    dlq_url: str
    total_messages: int
    messages_analyzed: int

    # Error classification
    error_patterns: Dict[str, int] = field(default_factory=dict)
    failed_steps: Dict[str, int] = field(default_factory=dict)
    file_types: Dict[str, int] = field(default_factory=dict)

    # Temporal analysis
    messages_by_hour: Dict[int, int] = field(default_factory=dict)
    messages_by_day: Dict[str, int] = field(default_factory=dict)

    # Top failures
    top_errors: List[Dict[str, Any]] = field(default_factory=list)
    top_failed_files: List[Dict[str, Any]] = field(default_factory=list)

    # Recommendations
    recommendations: List[str] = field(default_factory=list)

    # Raw messages (for detailed analysis)
    sample_messages: List[Dict[str, Any]] = field(default_factory=list)


class DLQAnalyzer:
    """
    Analyzes Dead Letter Queue messages to identify failure patterns
    """

    def __init__(self, dlq_url: str, region: str = 'ap-northeast-1'):
        """
        Initialize DLQ analyzer

        Args:
            dlq_url: DLQ URL
            region: AWS region
        """
        self.dlq_url = dlq_url
        self.region = region

        try:
            self.sqs_client = boto3.client('sqs', region_name=region)
            self.sts_client = boto3.client('sts', region_name=region)
        except (NoCredentialsError, Exception) as e:
            logger.error(f"Failed to initialize AWS clients: {e}")
            sys.exit(1)

        # Get caller identity
        try:
            identity = self.sts_client.get_caller_identity()
            logger.info(f"Running as: {identity['Arn']}")
        except Exception as e:
            logger.error(f"Failed to get caller identity: {e}")
            sys.exit(1)

        self.messages: List[DLQMessage] = []

    def fetch_messages(self, max_messages: int = 100, delete_after_fetch: bool = False) -> int:
        """
        Fetch messages from DLQ

        Args:
            max_messages: Maximum number of messages to fetch
            delete_after_fetch: Delete messages after fetching (use with caution!)

        Returns:
            Number of messages fetched
        """
        logger.info(f"Fetching up to {max_messages} messages from DLQ...")

        fetched = 0
        batch_size = 10  # SQS max is 10 messages per request

        while fetched < max_messages:
            try:
                # Calculate batch size for this iteration
                current_batch_size = min(batch_size, max_messages - fetched)

                response = self.sqs_client.receive_message(
                    QueueUrl=self.dlq_url,
                    MaxNumberOfMessages=current_batch_size,
                    AttributeNames=['All'],
                    MessageAttributeNames=['All'],
                    WaitTimeSeconds=2,
                    VisibilityTimeout=30
                )

                messages = response.get('Messages', [])

                if not messages:
                    logger.info("No more messages in DLQ")
                    break

                for msg in messages:
                    dlq_msg = DLQMessage(
                        message_id=msg['MessageId'],
                        receipt_handle=msg['ReceiptHandle'],
                        body=msg['Body'],
                        attributes=msg.get('Attributes', {}),
                        message_attributes=msg.get('MessageAttributes', {}),
                        sent_timestamp=int(msg.get('Attributes', {}).get('SentTimestamp', 0)),
                        approximate_receive_count=int(msg.get('Attributes', {}).get('ApproximateReceiveCount', 0))
                    )

                    # Parse message
                    dlq_msg.parse()

                    self.messages.append(dlq_msg)
                    fetched += 1

                    # Delete if requested (DANGEROUS!)
                    if delete_after_fetch:
                        try:
                            self.sqs_client.delete_message(
                                QueueUrl=self.dlq_url,
                                ReceiptHandle=msg['ReceiptHandle']
                            )
                            logger.debug(f"Deleted message: {msg['MessageId']}")
                        except Exception as e:
                            logger.error(f"Failed to delete message: {e}")

                logger.info(f"Fetched {len(messages)} messages (total: {fetched})")

                # If we got fewer messages than requested, no more messages available
                if len(messages) < current_batch_size:
                    break

            except ClientError as e:
                logger.error(f"Error fetching messages: {e}")
                break
            except Exception as e:
                logger.error(f"Unexpected error: {e}")
                break

        logger.info(f"Total messages fetched: {fetched}")
        return fetched

    def analyze(self) -> DLQAnalysisReport:
        """
        Analyze fetched DLQ messages

        Returns:
            Analysis report
        """
        logger.info("Analyzing messages...")

        report = DLQAnalysisReport(
            timestamp=datetime.utcnow().isoformat(),
            dlq_url=self.dlq_url,
            total_messages=len(self.messages),
            messages_analyzed=len(self.messages)
        )

        # Counters
        error_patterns = Counter()
        failed_steps = Counter()
        file_types = Counter()
        messages_by_hour = Counter()
        messages_by_day = Counter()
        file_failures = Counter()

        for msg in self.messages:
            # Error classification
            if msg.error_type:
                error_patterns[msg.error_type] += 1
            elif msg.error_message:
                # Extract error type from message
                error_type = self._classify_error(msg.error_message)
                error_patterns[error_type] += 1
            else:
                error_patterns['Unknown'] += 1

            # Failed step
            if msg.failed_step:
                failed_steps[msg.failed_step] += 1
            else:
                # Infer from error message
                step = self._infer_failed_step(msg.body, msg.error_message)
                if step:
                    failed_steps[step] += 1

            # File type distribution
            if msg.file_type:
                file_types[msg.file_type] += 1

            # Temporal analysis
            if msg.sent_timestamp:
                dt = datetime.fromtimestamp(msg.sent_timestamp / 1000)
                messages_by_hour[dt.hour] += 1
                messages_by_day[dt.strftime('%Y-%m-%d')] += 1

            # File-specific failures
            if msg.file_key:
                file_failures[msg.file_key] += 1

        # Populate report
        report.error_patterns = dict(error_patterns)
        report.failed_steps = dict(failed_steps)
        report.file_types = dict(file_types)
        report.messages_by_hour = dict(messages_by_hour)
        report.messages_by_day = dict(messages_by_day)

        # Top errors (sorted by frequency)
        report.top_errors = [
            {'error_type': error, 'count': count}
            for error, count in error_patterns.most_common(10)
        ]

        # Top failed files
        report.top_failed_files = [
            {'file_key': file_key, 'failure_count': count}
            for file_key, count in file_failures.most_common(10)
        ]

        # Sample messages (first 5)
        report.sample_messages = [
            {
                'message_id': msg.message_id,
                'file_key': msg.file_key,
                'error_type': msg.error_type,
                'error_message': msg.error_message,
                'failed_step': msg.failed_step,
                'receive_count': msg.approximate_receive_count,
                'body': msg.body[:500]  # Truncate long bodies
            }
            for msg in self.messages[:5]
        ]

        # Generate recommendations
        report.recommendations = self._generate_recommendations(report)

        return report

    def _classify_error(self, error_message: str) -> str:
        """
        Classify error based on error message

        Args:
            error_message: Error message string

        Returns:
            Error classification
        """
        if not error_message:
            return 'Unknown'

        error_lower = error_message.lower()

        # Permission errors
        if any(keyword in error_lower for keyword in ['accessdenied', 'unauthorized', 'forbidden', 'permission']):
            return 'PermissionError'

        # Timeout errors
        if any(keyword in error_lower for keyword in ['timeout', 'timed out', 'deadline']):
            return 'TimeoutError'

        # Network errors
        if any(keyword in error_lower for keyword in ['connection', 'network', 'dns', 'unreachable']):
            return 'NetworkError'

        # Resource errors
        if any(keyword in error_lower for keyword in ['notfound', 'does not exist', 'nosuchkey']):
            return 'ResourceNotFoundError'

        # Validation errors
        if any(keyword in error_lower for keyword in ['invalid', 'validation', 'malformed']):
            return 'ValidationError'

        # Processing errors
        if any(keyword in error_lower for keyword in ['ocr', 'tesseract', 'pdf', 'image']):
            return 'ProcessingError'

        # Service errors
        if any(keyword in error_lower for keyword in ['throttling', 'rate', 'limit exceeded']):
            return 'ThrottlingError'

        return 'UnknownError'

    def _infer_failed_step(self, body: str, error_message: Optional[str]) -> Optional[str]:
        """
        Infer which processing step failed

        Args:
            body: Message body
            error_message: Error message

        Returns:
            Failed step name or None
        """
        text = f"{body} {error_message or ''}".lower()

        if any(keyword in text for keyword in ['s3', 'bucket', 'download', 'getobject']):
            return 'S3Download'

        if any(keyword in text for keyword in ['ocr', 'tesseract', 'vision']):
            return 'OCR'

        if any(keyword in text for keyword in ['bedrock', 'titan', 'embedding', 'invokemodel']):
            return 'Bedrock'

        if any(keyword in text for keyword in ['opensearch', 'elasticsearch', 'index', 'search']):
            return 'OpenSearch'

        if any(keyword in text for keyword in ['thumbnail', 'image', 'resize']):
            return 'Thumbnail'

        return None

    def _generate_recommendations(self, report: DLQAnalysisReport) -> List[str]:
        """
        Generate recommendations based on analysis

        Args:
            report: Analysis report

        Returns:
            List of recommendations
        """
        recommendations = []

        # Permission errors
        if 'PermissionError' in report.error_patterns:
            count = report.error_patterns['PermissionError']
            recommendations.append(
                f"🔐 {count} permission errors detected. Run verify_iam_permissions.py to check IAM role permissions."
            )

        # Timeout errors
        if 'TimeoutError' in report.error_patterns:
            count = report.error_patterns['TimeoutError']
            recommendations.append(
                f"⏱️ {count} timeout errors detected. Consider increasing SQS visibility timeout or processing timeout."
            )

        # OpenSearch failures
        if 'OpenSearch' in report.failed_steps:
            count = report.failed_steps['OpenSearch']
            recommendations.append(
                f"🔍 {count} OpenSearch indexing failures. Check OpenSearch endpoint, VPC endpoint, and security groups."
            )

        # Bedrock failures
        if 'Bedrock' in report.failed_steps:
            count = report.failed_steps['Bedrock']
            recommendations.append(
                f"🤖 {count} Bedrock API failures. Verify bedrock:InvokeModel permission and model availability in region."
            )

        # S3 download failures
        if 'S3Download' in report.failed_steps:
            count = report.failed_steps['S3Download']
            recommendations.append(
                f"📦 {count} S3 download failures. Check s3:GetObject permission and bucket policy."
            )

        # Processing errors
        if 'ProcessingError' in report.error_patterns:
            count = report.error_patterns['ProcessingError']
            recommendations.append(
                f"⚙️ {count} file processing errors. Check OCR dependencies (Tesseract, poppler-utils) and file corruption."
            )

        # Throttling
        if 'ThrottlingError' in report.error_patterns:
            count = report.error_patterns['ThrottlingError']
            recommendations.append(
                f"🚦 {count} throttling errors. Implement exponential backoff or request service quota increase."
            )

        # High failure rate
        failure_rate = (report.total_messages / max(report.total_messages, 1)) * 100
        if report.total_messages > 10 and failure_rate > 50:
            recommendations.append(
                f"⚠️ High failure rate ({failure_rate:.1f}%). System configuration may be fundamentally broken."
            )

        # Specific file types failing
        if report.file_types:
            most_common_type = max(report.file_types.items(), key=lambda x: x[1])
            if most_common_type[1] > report.total_messages * 0.3:
                recommendations.append(
                    f"📄 {most_common_type[0].upper()} files failing frequently ({most_common_type[1]} failures). "
                    f"Check processor for this file type."
                )

        if not recommendations:
            recommendations.append("✅ No specific issues detected. Review sample messages for details.")

        return recommendations

    def replay_messages(self, target_queue_url: str, delete_after_replay: bool = False) -> int:
        """
        Replay DLQ messages to main queue

        Args:
            target_queue_url: Target queue URL
            delete_after_replay: Delete from DLQ after successful replay

        Returns:
            Number of messages replayed
        """
        logger.info(f"Replaying {len(self.messages)} messages to {target_queue_url}...")

        replayed = 0

        for msg in self.messages:
            try:
                # Send to target queue
                self.sqs_client.send_message(
                    QueueUrl=target_queue_url,
                    MessageBody=msg.body,
                    MessageAttributes=msg.message_attributes
                )

                replayed += 1
                logger.info(f"Replayed message: {msg.message_id}")

                # Delete from DLQ if requested
                if delete_after_replay:
                    self.sqs_client.delete_message(
                        QueueUrl=self.dlq_url,
                        ReceiptHandle=msg.receipt_handle
                    )
                    logger.debug(f"Deleted message from DLQ: {msg.message_id}")

            except Exception as e:
                logger.error(f"Failed to replay message {msg.message_id}: {e}")

        logger.info(f"Successfully replayed {replayed}/{len(self.messages)} messages")
        return replayed

    def print_report(self, report: DLQAnalysisReport):
        """
        Print human-readable report

        Args:
            report: Analysis report
        """
        print("\n" + "=" * 80)
        print("DLQ MESSAGE ANALYSIS REPORT")
        print("=" * 80)

        print(f"\nDLQ URL: {report.dlq_url}")
        print(f"Analysis Time: {report.timestamp}")
        print(f"Total Messages Analyzed: {report.total_messages}")

        # Error patterns
        if report.error_patterns:
            print("\n" + "=" * 80)
            print("ERROR PATTERNS")
            print("=" * 80)
            for error_type, count in sorted(report.error_patterns.items(), key=lambda x: x[1], reverse=True):
                percentage = (count / report.total_messages) * 100
                print(f"  {error_type:30} {count:5} ({percentage:5.1f}%)")

        # Failed steps
        if report.failed_steps:
            print("\n" + "=" * 80)
            print("FAILED PROCESSING STEPS")
            print("=" * 80)
            for step, count in sorted(report.failed_steps.items(), key=lambda x: x[1], reverse=True):
                percentage = (count / report.total_messages) * 100
                print(f"  {step:30} {count:5} ({percentage:5.1f}%)")

        # File types
        if report.file_types:
            print("\n" + "=" * 80)
            print("FILE TYPES FAILING")
            print("=" * 80)
            for file_type, count in sorted(report.file_types.items(), key=lambda x: x[1], reverse=True):
                percentage = (count / report.total_messages) * 100
                print(f"  {file_type:30} {count:5} ({percentage:5.1f}%)")

        # Temporal analysis
        if report.messages_by_day:
            print("\n" + "=" * 80)
            print("FAILURES BY DAY")
            print("=" * 80)
            for day in sorted(report.messages_by_day.keys()):
                count = report.messages_by_day[day]
                print(f"  {day}: {count} messages")

        if report.messages_by_hour:
            print("\n" + "=" * 80)
            print("FAILURES BY HOUR (UTC)")
            print("=" * 80)
            for hour in sorted(report.messages_by_hour.keys()):
                count = report.messages_by_hour[hour]
                bar = "█" * (count // max(1, max(report.messages_by_hour.values()) // 50))
                print(f"  {hour:02d}:00 {count:5} {bar}")

        # Top errors
        if report.top_errors:
            print("\n" + "=" * 80)
            print("TOP 10 ERRORS")
            print("=" * 80)
            for i, error in enumerate(report.top_errors, 1):
                print(f"  {i}. {error['error_type']}: {error['count']} occurrences")

        # Top failed files
        if report.top_failed_files:
            print("\n" + "=" * 80)
            print("TOP 10 FAILED FILES")
            print("=" * 80)
            for i, file_info in enumerate(report.top_failed_files, 1):
                print(f"  {i}. {file_info['file_key']}: {file_info['failure_count']} failures")

        # Recommendations
        if report.recommendations:
            print("\n" + "=" * 80)
            print("RECOMMENDATIONS")
            print("=" * 80)
            for i, rec in enumerate(report.recommendations, 1):
                print(f"\n{i}. {rec}")

        print("\n" + "=" * 80)


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description='Analyze Dead Letter Queue messages',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument(
        '--dlq-url',
        help='DLQ URL (can also use DLQ_URL env var)'
    )

    parser.add_argument(
        '--region',
        default=os.environ.get('AWS_REGION', 'ap-northeast-1'),
        help='AWS region'
    )

    parser.add_argument(
        '--max-messages',
        type=int,
        default=100,
        help='Maximum messages to fetch (default: 100)'
    )

    parser.add_argument(
        '--output-json',
        metavar='FILE',
        help='Save report to JSON file'
    )

    parser.add_argument(
        '--replay-messages',
        action='store_true',
        help='Replay messages to main queue'
    )

    parser.add_argument(
        '--target-queue-url',
        help='Target queue URL for replay (required if --replay-messages)'
    )

    parser.add_argument(
        '--delete-after-fetch',
        action='store_true',
        help='DELETE messages after fetching (DANGEROUS! Use with caution)'
    )

    parser.add_argument(
        '--delete-after-replay',
        action='store_true',
        help='DELETE messages after replay (use with --replay-messages)'
    )

    args = parser.parse_args()

    # Get DLQ URL
    dlq_url = args.dlq_url or os.environ.get('DLQ_URL')
    if not dlq_url:
        logger.error("DLQ URL not provided. Use --dlq-url or set DLQ_URL environment variable")
        sys.exit(1)

    # Validate replay options
    if args.replay_messages and not args.target_queue_url:
        logger.error("--target-queue-url required when using --replay-messages")
        sys.exit(1)

    # Create analyzer
    analyzer = DLQAnalyzer(dlq_url=dlq_url, region=args.region)

    # Fetch messages
    count = analyzer.fetch_messages(
        max_messages=args.max_messages,
        delete_after_fetch=args.delete_after_fetch
    )

    if count == 0:
        logger.info("No messages found in DLQ")
        sys.exit(0)

    # Analyze messages
    report = analyzer.analyze()

    # Save JSON report if requested
    if args.output_json:
        with open(args.output_json, 'w') as f:
            json.dump(asdict(report), f, indent=2)
        logger.info(f"Report saved to: {args.output_json}")

    # Print report
    analyzer.print_report(report)

    # Replay messages if requested
    if args.replay_messages:
        replayed = analyzer.replay_messages(
            target_queue_url=args.target_queue_url,
            delete_after_replay=args.delete_after_replay
        )
        logger.info(f"Replay complete: {replayed} messages")


if __name__ == '__main__':
    main()
