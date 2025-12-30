#!/usr/bin/env python3
"""
CloudWatch Logs Analysis Script
Analyzes worker logs to verify actual file processing vs just message deletion
"""

import boto3
import json
from datetime import datetime, timedelta
from collections import Counter, defaultdict
import argparse
import sys

# Configuration
LOG_GROUP = "/aws/ec2/cis-filesearch-worker"
REGION = "ap-northeast-1"
INSTANCE_ID = "i-0e6ac1e4d535a4ab2"


class LogAnalyzer:
    def __init__(self):
        self.logs_client = boto3.client('logs', region_name=REGION)
        self.cloudwatch = boto3.client('cloudwatch', region_name=REGION)

    def get_log_streams(self, limit=10):
        """Get recent log streams"""
        try:
            response = self.logs_client.describe_log_streams(
                logGroupName=LOG_GROUP,
                orderBy='LastEventTime',
                descending=True,
                limit=limit
            )
            return response.get('logStreams', [])
        except Exception as e:
            print(f"Error getting log streams: {e}")
            return []

    def analyze_processing_activity(self, minutes=30):
        """Analyze processing activity in recent logs"""
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(minutes=minutes)

        print(f"\n=== Analyzing logs from {start_time} to {end_time} ===\n")

        # Patterns to search for
        patterns = {
            'message_received': '"Processing message"',
            'file_type_detected': '"File type detected:"',
            's3_access': '"Accessing S3 file:"',
            'metadata_extracted': '"Extracted metadata:"',
            'opensearch_indexed': '"Indexed to OpenSearch:"',
            'docuworks_detected': '"DocuWorks file detected"',
            'relationships_tracked': '"Tracking relationships"',
            'errors': '"ERROR"',
            'message_deleted': '"Message deleted"'
        }

        results = {}

        for name, pattern in patterns.items():
            try:
                response = self.logs_client.filter_log_events(
                    logGroupName=LOG_GROUP,
                    startTime=int(start_time.timestamp() * 1000),
                    endTime=int(end_time.timestamp() * 1000),
                    filterPattern=pattern
                )
                events = response.get('events', [])
                results[name] = len(events)

                print(f"{name:.<40} {len(events):>6} events")

                # Show sample events
                if events and name in ['opensearch_indexed', 'docuworks_detected', 'errors']:
                    print(f"  Sample events:")
                    for event in events[:3]:
                        timestamp = datetime.fromtimestamp(event['timestamp'] / 1000)
                        message = event['message'][:200]
                        print(f"    [{timestamp}] {message}")

            except Exception as e:
                print(f"{name:.<40} ERROR: {e}")
                results[name] = 0

        # Analysis
        print("\n=== Analysis ===\n")

        total_messages = results.get('message_received', 0)
        messages_deleted = results.get('message_deleted', 0)
        opensearch_indexed = results.get('opensearch_indexed', 0)
        errors = results.get('errors', 0)

        if total_messages > 0:
            processing_rate = (opensearch_indexed / total_messages * 100) if total_messages > 0 else 0
            deletion_rate = (messages_deleted / total_messages * 100) if total_messages > 0 else 0
            error_rate = (errors / total_messages * 100) if total_messages > 0 else 0

            print(f"Total messages processed: {total_messages}")
            print(f"Messages indexed to OpenSearch: {opensearch_indexed} ({processing_rate:.1f}%)")
            print(f"Messages deleted: {messages_deleted} ({deletion_rate:.1f}%)")
            print(f"Errors encountered: {errors} ({error_rate:.1f}%)")

            # Determine if processing is working
            if opensearch_indexed > 0:
                print("\n✅ VERIFICATION: Files ARE being indexed to OpenSearch!")
            elif messages_deleted > 0 and opensearch_indexed == 0:
                print("\n❌ WARNING: Messages are being deleted but NOT indexed!")
                print("   This suggests the worker is still only deleting messages.")
            else:
                print("\n⚠️  UNKNOWN: No clear processing activity detected.")
        else:
            print("⚠️  No messages found in the specified time range.")
            print("   The worker might not be receiving messages or logs are not being generated.")

        return results

    def get_file_type_distribution(self, minutes=60):
        """Get distribution of file types being processed"""
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(minutes=minutes)

        print(f"\n=== File Type Distribution (last {minutes} minutes) ===\n")

        try:
            response = self.logs_client.filter_log_events(
                logGroupName=LOG_GROUP,
                startTime=int(start_time.timestamp() * 1000),
                endTime=int(end_time.timestamp() * 1000),
                filterPattern='"File type detected:"'
            )

            file_types = []
            for event in response.get('events', []):
                message = event['message']
                # Extract file type from log message
                if 'File type detected:' in message:
                    try:
                        parts = message.split('File type detected:')
                        if len(parts) > 1:
                            file_type = parts[1].strip().split()[0].strip('"').strip(',')
                            file_types.append(file_type)
                    except:
                        pass

            if file_types:
                counter = Counter(file_types)
                for file_type, count in counter.most_common(20):
                    print(f"{file_type:.<30} {count:>6} files")
            else:
                print("No file type information found.")

        except Exception as e:
            print(f"Error getting file type distribution: {e}")

    def check_opensearch_connectivity(self):
        """Check for OpenSearch connection errors"""
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(minutes=30)

        print("\n=== OpenSearch Connectivity Check ===\n")

        try:
            response = self.logs_client.filter_log_events(
                logGroupName=LOG_GROUP,
                startTime=int(start_time.timestamp() * 1000),
                endTime=int(end_time.timestamp() * 1000),
                filterPattern='"OpenSearch" OR "opensearch"'
            )

            events = response.get('events', [])
            if events:
                print(f"Found {len(events)} OpenSearch-related log entries:")
                for event in events[:10]:
                    timestamp = datetime.fromtimestamp(event['timestamp'] / 1000)
                    message = event['message']
                    print(f"  [{timestamp}] {message[:200]}")
            else:
                print("⚠️  No OpenSearch-related log entries found.")
                print("   This could indicate:")
                print("   - OpenSearch indexing is not implemented")
                print("   - Logs are not being generated for OpenSearch operations")
                print("   - Worker code is not reaching OpenSearch logic")

        except Exception as e:
            print(f"Error checking OpenSearch connectivity: {e}")


def main():
    parser = argparse.ArgumentParser(description='Analyze CIS FileSearch worker logs')
    parser.add_argument('--minutes', type=int, default=30,
                      help='Number of minutes to analyze (default: 30)')
    parser.add_argument('--file-types', action='store_true',
                      help='Show file type distribution')
    parser.add_argument('--opensearch', action='store_true',
                      help='Check OpenSearch connectivity')

    args = parser.parse_args()

    analyzer = LogAnalyzer()

    # List recent log streams
    print("\n=== Recent Log Streams ===\n")
    streams = analyzer.get_log_streams()
    for stream in streams[:5]:
        name = stream['logStreamName']
        last_event = datetime.fromtimestamp(stream['lastEventTime'] / 1000)
        print(f"{name}")
        print(f"  Last event: {last_event}")

    # Main analysis
    analyzer.analyze_processing_activity(minutes=args.minutes)

    # Optional analyses
    if args.file_types:
        analyzer.get_file_type_distribution(minutes=args.minutes)

    if args.opensearch:
        analyzer.check_opensearch_connectivity()


if __name__ == '__main__':
    main()
