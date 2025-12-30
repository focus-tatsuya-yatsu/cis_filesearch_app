#!/usr/bin/env python3
"""
Quick verification script for worker deployment
Performs essential checks to verify file processing is working
"""

import boto3
import json
from datetime import datetime, timedelta
import sys

# Configuration
INSTANCE_ID = "i-0e6ac1e4d535a4ab2"
QUEUE_URL = "https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue"
LOG_GROUP = "/aws/ec2/cis-filesearch-worker"
REGION = "ap-northeast-1"

# Color codes
class Colors:
    RED = '\033[0;31m'
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    BLUE = '\033[0;34m'
    NC = '\033[0m'  # No Color

def print_header(text):
    print(f"\n{Colors.BLUE}{'='*60}{Colors.NC}")
    print(f"{Colors.BLUE}{text:^60}{Colors.NC}")
    print(f"{Colors.BLUE}{'='*60}{Colors.NC}\n")

def print_success(text):
    print(f"{Colors.GREEN}✓ {text}{Colors.NC}")

def print_error(text):
    print(f"{Colors.RED}✗ {text}{Colors.NC}")

def print_warning(text):
    print(f"{Colors.YELLOW}⚠ {text}{Colors.NC}")

def check_instance_status():
    """Check if instance is running"""
    print_header("1. Instance Status")

    ec2 = boto3.client('ec2', region_name=REGION)

    try:
        response = ec2.describe_instances(InstanceIds=[INSTANCE_ID])
        instance = response['Reservations'][0]['Instances'][0]

        state = instance['State']['Name']
        instance_type = instance['InstanceType']
        launch_time = instance['LaunchTime']

        print(f"Instance ID: {INSTANCE_ID}")
        print(f"State: {state}")
        print(f"Type: {instance_type}")
        print(f"Launched: {launch_time}")

        if state == 'running':
            print_success("Instance is running")
            return True
        else:
            print_error(f"Instance is not running (state: {state})")
            return False

    except Exception as e:
        print_error(f"Failed to check instance status: {e}")
        return False

def check_sqs_queue():
    """Check SQS queue status"""
    print_header("2. SQS Queue Status")

    sqs = boto3.client('sqs', region_name=REGION)

    try:
        response = sqs.get_queue_attributes(
            QueueUrl=QUEUE_URL,
            AttributeNames=['ApproximateNumberOfMessages',
                          'ApproximateNumberOfMessagesNotVisible',
                          'ApproximateNumberOfMessagesDelayed']
        )

        attrs = response['Attributes']
        messages = int(attrs.get('ApproximateNumberOfMessages', 0))
        in_flight = int(attrs.get('ApproximateNumberOfMessagesNotVisible', 0))
        delayed = int(attrs.get('ApproximateNumberOfMessagesDelayed', 0))

        print(f"Messages in queue: {messages}")
        print(f"Messages in flight: {in_flight}")
        print(f"Messages delayed: {delayed}")

        if in_flight > 0:
            print_success("Messages are being processed")
            return True
        elif messages > 0:
            print_warning("Messages in queue but not being processed")
            return False
        else:
            print_warning("No messages in queue (might be normal if fully processed)")
            return True

    except Exception as e:
        print_error(f"Failed to check SQS queue: {e}")
        return False

def analyze_logs():
    """Analyze CloudWatch logs for processing activity"""
    print_header("3. Processing Activity Analysis")

    logs = boto3.client('logs', region_name=REGION)

    end_time = datetime.utcnow()
    start_time = end_time - timedelta(minutes=30)

    start_ms = int(start_time.timestamp() * 1000)
    end_ms = int(end_time.timestamp() * 1000)

    print(f"Analyzing logs from {start_time.strftime('%H:%M:%S')} to {end_time.strftime('%H:%M:%S')} UTC\n")

    # Check for key activities
    checks = {
        'Messages received': '"Processing message"',
        'Files indexed': '"Indexed to OpenSearch"',
        'File types detected': '"File type detected:"',
        'S3 access': '"Accessing S3 file:"',
        'DocuWorks files': '"DocuWorks"',
        'Errors': '"ERROR"',
    }

    results = {}

    for name, pattern in checks.items():
        try:
            response = logs.filter_log_events(
                logGroupName=LOG_GROUP,
                startTime=start_ms,
                endTime=end_ms,
                filterPattern=pattern
            )
            count = len(response.get('events', []))
            results[name] = count

            status = "✓" if count > 0 else "✗"
            print(f"{status} {name:.<35} {count:>6} events")

        except Exception as e:
            results[name] = 0
            print(f"✗ {name:.<35} ERROR: {str(e)[:30]}")

    # Analyze results
    print("\n" + "="*60)

    messages = results.get('Messages received', 0)
    indexed = results.get('Files indexed', 0)
    errors = results.get('Errors', 0)

    if indexed > 0:
        print_success(f"PROCESSING IS WORKING: {indexed} files indexed in last 30 minutes")
        processing_rate = (indexed / messages * 100) if messages > 0 else 0
        print(f"Processing rate: {processing_rate:.1f}%")
        return True
    elif messages > 0 and indexed == 0:
        print_error("WARNING: Messages received but NO files indexed!")
        print_warning("Worker might be only deleting messages without processing")
        return False
    else:
        print_warning("No recent processing activity detected")
        print_warning("This could be normal if queue is empty")
        return None

def check_recent_logs():
    """Show recent log entries"""
    print_header("4. Recent Log Entries")

    logs = boto3.client('logs', region_name=REGION)

    try:
        # Get most recent log stream
        streams = logs.describe_log_streams(
            logGroupName=LOG_GROUP,
            orderBy='LastEventTime',
            descending=True,
            limit=1
        )

        if not streams['logStreams']:
            print_error("No log streams found")
            return False

        stream_name = streams['logStreams'][0]['logStreamName']
        last_event = datetime.fromtimestamp(
            streams['logStreams'][0]['lastEventTime'] / 1000
        )

        print(f"Latest log stream: {stream_name}")
        print(f"Last event: {last_event}\n")

        # Get recent events
        response = logs.get_log_events(
            logGroupName=LOG_GROUP,
            logStreamName=stream_name,
            limit=20,
            startFromHead=False
        )

        print("Recent log entries (last 20):")
        print("-" * 60)

        for event in response['events'][-10:]:
            timestamp = datetime.fromtimestamp(event['timestamp'] / 1000)
            message = event['message'][:120]
            print(f"[{timestamp.strftime('%H:%M:%S')}] {message}")

        return True

    except Exception as e:
        print_error(f"Failed to fetch recent logs: {e}")
        return False

def main():
    print_header("CIS FileSearch Worker Quick Verification")
    print(f"Instance: {INSTANCE_ID}")
    print(f"Time: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC")

    results = []

    # Run checks
    results.append(check_instance_status())
    results.append(check_sqs_queue())

    processing_status = analyze_logs()
    results.append(processing_status if processing_status is not None else False)

    results.append(check_recent_logs())

    # Summary
    print_header("Verification Summary")

    passed = sum(1 for r in results if r is True)
    failed = sum(1 for r in results if r is False)

    print(f"Checks passed: {passed}/{len(results)}")
    print(f"Checks failed: {failed}/{len(results)}")

    if processing_status is True:
        print_success("\n🎉 VERIFICATION SUCCESSFUL: Worker is processing files correctly!")
        print("\nNext steps:")
        print("1. Monitor processing rate over next hour")
        print("2. Verify OpenSearch index is being populated")
        print("3. Check DocuWorks relationship tracking")
        print("\nRun for detailed analysis:")
        print("  python3 analyze-logs.py --minutes 60 --file-types --opensearch")
        return 0
    elif processing_status is False:
        print_error("\n❌ VERIFICATION FAILED: Worker is NOT processing files!")
        print("\nPossible issues:")
        print("1. Worker code not deployed correctly")
        print("2. OpenSearch connectivity issues")
        print("3. Missing environment variables")
        print("4. IAM permission issues")
        print("\nTroubleshooting:")
        print("  ./ssm-connect.sh  # Connect to instance")
        print("  python3 analyze-logs.py --minutes 60 --opensearch  # Detailed analysis")
        return 1
    else:
        print_warning("\n⚠️  VERIFICATION INCONCLUSIVE: No recent activity detected")
        print("\nThis might be normal if:")
        print("1. Queue is empty (all messages processed)")
        print("2. No new files have been added recently")
        print("3. Worker just started")
        print("\nWait a few minutes and re-run this script")
        return 2

if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n\nVerification interrupted by user")
        sys.exit(130)
    except Exception as e:
        print_error(f"\nUnexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
