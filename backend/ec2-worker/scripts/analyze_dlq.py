#!/usr/bin/env python3
"""
DLQ Message Analysis Tool
Analyzes failed messages in Dead Letter Queue to identify root causes
"""

import json
import boto3
import sys
from collections import Counter, defaultdict
from datetime import datetime
from typing import List, Dict, Any

def analyze_dlq_messages(queue_url: str, max_messages: int = 100) -> Dict[str, Any]:
    """
    Analyze messages in DLQ to identify failure patterns

    Args:
        queue_url: DLQ URL
        max_messages: Maximum number of messages to analyze

    Returns:
        Analysis results
    """
    sqs = boto3.client('sqs')

    messages_analyzed = 0
    failure_reasons = Counter()
    file_types = Counter()
    file_sizes = defaultdict(list)
    error_messages = []

    print(f"🔍 Analyzing DLQ: {queue_url}")
    print("=" * 80)

    while messages_analyzed < max_messages:
        # Receive messages (without deleting)
        response = sqs.receive_message(
            QueueUrl=queue_url,
            MaxNumberOfMessages=10,
            VisibilityTimeout=10,
            AttributeNames=['All'],
            MessageAttributeNames=['All']
        )

        messages = response.get('Messages', [])
        if not messages:
            break

        for message in messages:
            try:
                # Parse message body
                body = json.loads(message['Body'])

                # Extract file information
                file_path = None
                file_size = None

                if 'detail' in body:
                    # EventBridge format
                    file_path = body['detail'].get('object', {}).get('key')
                    file_size = body['detail'].get('object', {}).get('size')
                elif 'Records' in body:
                    # S3 event format
                    record = body['Records'][0]
                    file_path = record.get('s3', {}).get('object', {}).get('key')
                    file_size = record.get('s3', {}).get('object', {}).get('size')

                if file_path:
                    # Get file extension
                    ext = file_path.split('.')[-1].lower() if '.' in file_path else 'unknown'
                    file_types[ext] += 1

                    if file_size:
                        file_sizes[ext].append(file_size)

                # Extract error information from message attributes
                error_msg = message.get('MessageAttributes', {}).get('ErrorMessage', {}).get('StringValue')
                if error_msg:
                    error_messages.append({
                        'file': file_path,
                        'error': error_msg,
                        'timestamp': message['Attributes'].get('SentTimestamp')
                    })

                # Approximate receive count (number of retries)
                receive_count = int(message['Attributes'].get('ApproximateReceiveCount', 0))
                failure_reasons[f"Retried {receive_count} times"] += 1

                messages_analyzed += 1

                # Make message visible again
                sqs.change_message_visibility(
                    QueueUrl=queue_url,
                    ReceiptHandle=message['ReceiptHandle'],
                    VisibilityTimeout=0
                )

            except Exception as e:
                print(f"⚠️  Error analyzing message: {e}")
                continue

    # Analysis results
    print(f"\n📊 Analysis Results ({messages_analyzed} messages analyzed)")
    print("=" * 80)

    print("\n📁 File Types:")
    for ext, count in file_types.most_common(10):
        avg_size = sum(file_sizes[ext]) / len(file_sizes[ext]) if file_sizes[ext] else 0
        print(f"  {ext:15} : {count:5} files (avg size: {avg_size/1024/1024:.2f} MB)")

    print("\n🔄 Failure Patterns:")
    for reason, count in failure_reasons.most_common(10):
        print(f"  {reason:30} : {count:5} messages")

    print("\n❌ Recent Errors:")
    for error in error_messages[:10]:
        timestamp = datetime.fromtimestamp(int(error['timestamp'])/1000).strftime('%Y-%m-%d %H:%M:%S')
        print(f"  [{timestamp}] {error['file']}")
        print(f"    Error: {error['error'][:100]}...")

    # Recommendations
    print("\n💡 Recommendations:")
    print("=" * 80)

    # Large files
    large_files = {ext: sizes for ext, sizes in file_sizes.items()
                   if sizes and max(sizes) > 100 * 1024 * 1024}  # > 100MB
    if large_files:
        print("⚠️  Large files detected (>100MB):")
        for ext, sizes in large_files.items():
            print(f"  - {ext}: max {max(sizes)/1024/1024:.2f} MB")
        print("  → Increase memory limits (MemoryMax in systemd)")
        print("  → Increase SQS visibility timeout")

    # PDF files
    if 'pdf' in file_types and file_types['pdf'] > messages_analyzed * 0.3:
        print("\n⚠️  High percentage of PDF files:")
        print("  → Check OCR timeout settings")
        print("  → Monitor Tesseract process memory usage")

    # High retry count
    high_retry = [r for r in failure_reasons if 'Retried' in r and int(r.split()[1]) > 3]
    if high_retry:
        print("\n⚠️  Messages with >3 retries detected:")
        print("  → Check OpenSearch connection")
        print("  → Check IAM permissions")
        print("  → Review worker logs for recurring errors")

    return {
        'total_analyzed': messages_analyzed,
        'file_types': dict(file_types),
        'failure_reasons': dict(failure_reasons),
        'errors': error_messages
    }


def get_queue_attributes(queue_url: str) -> Dict[str, Any]:
    """Get DLQ attributes"""
    sqs = boto3.client('sqs')

    response = sqs.get_queue_attributes(
        QueueUrl=queue_url,
        AttributeNames=['All']
    )

    attrs = response['Attributes']

    print("\n📊 Queue Statistics:")
    print("=" * 80)
    print(f"Messages Available:       {attrs.get('ApproximateNumberOfMessages', 0):>10}")
    print(f"Messages In Flight:       {attrs.get('ApproximateNumberOfMessagesNotVisible', 0):>10}")
    print(f"Messages Delayed:         {attrs.get('ApproximateNumberOfMessagesDelayed', 0):>10}")
    print(f"Oldest Message Age:       {int(attrs.get('ApproximateAgeOfOldestMessage', 0))/3600:.1f} hours")
    print(f"Message Retention:        {int(attrs.get('MessageRetentionPeriod', 0))/86400:.0f} days")

    return attrs


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python analyze_dlq.py <DLQ_URL> [max_messages]")
        print("\nExample:")
        print("  python analyze_dlq.py https://sqs.ap-northeast-1.amazonaws.com/123456789012/my-queue-dlq 100")
        sys.exit(1)

    dlq_url = sys.argv[1]
    max_msgs = int(sys.argv[2]) if len(sys.argv) > 2 else 100

    print("🔍 DLQ Analysis Tool")
    print("=" * 80)

    # Get queue stats
    get_queue_attributes(dlq_url)

    # Analyze messages
    results = analyze_dlq_messages(dlq_url, max_msgs)

    print("\n✅ Analysis complete!")
    print(f"📝 Results saved to: dlq_analysis_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")

    with open(f"dlq_analysis_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json", 'w') as f:
        json.dump(results, f, indent=2, default=str)
