#!/usr/bin/env python3
"""
Performance Measurement Tool
Measures and reports worker performance metrics

Usage:
    python measure-performance.py --duration 300  # Measure for 5 minutes
    python measure-performance.py --messages 100  # Measure until 100 messages processed
"""

import time
import sys
import argparse
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import boto3
from botocore.exceptions import ClientError


class PerformanceMonitor:
    """Monitor worker performance using CloudWatch and SQS metrics"""

    def __init__(self, region: str = 'ap-northeast-1'):
        """Initialize performance monitor"""
        self.cloudwatch = boto3.client('cloudwatch', region_name=region)
        self.sqs = boto3.client('sqs', region_name=region)
        self.region = region

    def get_sqs_queue_depth(self, queue_url: str) -> Dict[str, int]:
        """
        Get current queue depth

        Args:
            queue_url: SQS queue URL

        Returns:
            Dictionary with message counts
        """
        try:
            response = self.sqs.get_queue_attributes(
                QueueUrl=queue_url,
                AttributeNames=[
                    'ApproximateNumberOfMessages',
                    'ApproximateNumberOfMessagesNotVisible',
                    'ApproximateNumberOfMessagesDelayed'
                ]
            )

            attrs = response['Attributes']

            return {
                'available': int(attrs.get('ApproximateNumberOfMessages', 0)),
                'in_flight': int(attrs.get('ApproximateNumberOfMessagesNotVisible', 0)),
                'delayed': int(attrs.get('ApproximateNumberOfMessagesDelayed', 0)),
                'total': int(attrs.get('ApproximateNumberOfMessages', 0)) +
                         int(attrs.get('ApproximateNumberOfMessagesNotVisible', 0))
            }

        except ClientError as e:
            print(f"Error getting queue depth: {e}")
            return {'available': 0, 'in_flight': 0, 'delayed': 0, 'total': 0}

    def get_cloudwatch_metrics(
        self,
        namespace: str,
        metric_name: str,
        start_time: datetime,
        end_time: datetime,
        statistic: str = 'Sum'
    ) -> Optional[float]:
        """
        Get CloudWatch metric value

        Args:
            namespace: CloudWatch namespace
            metric_name: Metric name
            start_time: Start time for metric query
            end_time: End time for metric query
            statistic: Statistic type (Sum, Average, Maximum, etc.)

        Returns:
            Metric value or None
        """
        try:
            response = self.cloudwatch.get_metric_statistics(
                Namespace=namespace,
                MetricName=metric_name,
                StartTime=start_time,
                EndTime=end_time,
                Period=60,  # 1 minute
                Statistics=[statistic]
            )

            if response['Datapoints']:
                return sum(dp[statistic] for dp in response['Datapoints'])

            return None

        except ClientError as e:
            print(f"Error getting CloudWatch metric: {e}")
            return None

    def measure_performance(
        self,
        queue_url: str,
        duration_seconds: int = 300,
        target_messages: Optional[int] = None
    ) -> Dict:
        """
        Measure worker performance

        Args:
            queue_url: SQS queue URL
            duration_seconds: Duration to measure (seconds)
            target_messages: Stop after processing this many messages

        Returns:
            Performance metrics dictionary
        """
        print(f"Starting performance measurement...")
        print(f"Queue: {queue_url[:50]}...")

        start_time = datetime.utcnow()
        start_depth = self.get_sqs_queue_depth(queue_url)

        print(f"\nInitial queue depth: {start_depth['total']:,} messages")
        print(f"  - Available: {start_depth['available']:,}")
        print(f"  - In flight: {start_depth['in_flight']:,}")

        if target_messages:
            print(f"\nTarget: Process {target_messages:,} messages")
        else:
            print(f"\nDuration: {duration_seconds} seconds ({duration_seconds/60:.1f} minutes)")

        print("\nMonitoring...\n")

        # Sample interval (seconds)
        sample_interval = 10
        samples = []

        elapsed = 0
        messages_processed = 0

        try:
            while True:
                time.sleep(sample_interval)
                elapsed += sample_interval

                # Get current queue depth
                current_depth = self.get_sqs_queue_depth(queue_url)

                # Calculate messages processed
                messages_delta = start_depth['total'] - current_depth['total']
                messages_processed = max(0, messages_delta)

                # Calculate throughput
                if elapsed > 0:
                    throughput_per_min = (messages_processed / elapsed) * 60
                else:
                    throughput_per_min = 0

                # Store sample
                sample = {
                    'timestamp': datetime.utcnow(),
                    'elapsed': elapsed,
                    'queue_depth': current_depth['total'],
                    'messages_processed': messages_processed,
                    'throughput': throughput_per_min
                }
                samples.append(sample)

                # Print progress
                print(
                    f"[{elapsed:4d}s] "
                    f"Queue: {current_depth['total']:6,} | "
                    f"Processed: {messages_processed:5,} | "
                    f"Throughput: {throughput_per_min:6.1f} msg/min"
                )

                # Check exit conditions
                if target_messages and messages_processed >= target_messages:
                    print(f"\nTarget reached! Processed {messages_processed:,} messages")
                    break

                if not target_messages and elapsed >= duration_seconds:
                    print(f"\nDuration complete! {elapsed} seconds elapsed")
                    break

                # Check if queue is empty
                if current_depth['total'] == 0 and messages_processed > 0:
                    print("\nQueue is empty!")
                    break

        except KeyboardInterrupt:
            print("\n\nMeasurement interrupted by user")

        # Calculate final metrics
        end_time = datetime.utcnow()
        end_depth = self.get_sqs_queue_depth(queue_url)

        total_processed = start_depth['total'] - end_depth['total']
        total_time_seconds = elapsed
        total_time_minutes = elapsed / 60

        if total_time_seconds > 0:
            avg_throughput = (total_processed / total_time_seconds) * 60
        else:
            avg_throughput = 0

        # Estimate time to completion
        if end_depth['total'] > 0 and avg_throughput > 0:
            remaining_minutes = end_depth['total'] / avg_throughput
            eta_hours = remaining_minutes / 60
        else:
            remaining_minutes = 0
            eta_hours = 0

        # Build results
        results = {
            'measurement': {
                'start_time': start_time.isoformat(),
                'end_time': end_time.isoformat(),
                'duration_seconds': total_time_seconds,
                'duration_minutes': total_time_minutes,
            },
            'queue': {
                'start_depth': start_depth['total'],
                'end_depth': end_depth['total'],
                'messages_processed': total_processed,
            },
            'performance': {
                'average_throughput_per_min': avg_throughput,
                'average_throughput_per_hour': avg_throughput * 60,
                'messages_per_second': avg_throughput / 60,
            },
            'projection': {
                'remaining_messages': end_depth['total'],
                'estimated_time_minutes': remaining_minutes,
                'estimated_time_hours': eta_hours,
            },
            'samples': samples
        }

        return results

    def print_report(self, results: Dict):
        """Print performance report"""
        print("\n" + "=" * 70)
        print("PERFORMANCE MEASUREMENT REPORT")
        print("=" * 70)

        # Measurement period
        print(f"\nMeasurement Period:")
        print(f"  Start:    {results['measurement']['start_time']}")
        print(f"  End:      {results['measurement']['end_time']}")
        print(f"  Duration: {results['measurement']['duration_minutes']:.1f} minutes")

        # Queue statistics
        print(f"\nQueue Statistics:")
        print(f"  Start Depth:       {results['queue']['start_depth']:,} messages")
        print(f"  End Depth:         {results['queue']['end_depth']:,} messages")
        print(f"  Messages Processed: {results['queue']['messages_processed']:,}")

        # Performance metrics
        perf = results['performance']
        print(f"\nPerformance Metrics:")
        print(f"  Throughput: {perf['average_throughput_per_min']:.1f} messages/min")
        print(f"              {perf['average_throughput_per_hour']:.0f} messages/hour")
        print(f"              {perf['messages_per_second']:.2f} messages/sec")

        # Projections
        proj = results['projection']
        if proj['remaining_messages'] > 0:
            print(f"\nProjections:")
            print(f"  Remaining Messages: {proj['remaining_messages']:,}")
            print(f"  Estimated Time:     {proj['estimated_time_hours']:.1f} hours")
            print(f"                      ({proj['estimated_time_minutes']:.0f} minutes)")

        # Performance comparison
        print(f"\nPerformance Comparison:")

        baseline_throughput = 60  # Original: 60 msg/min
        current_throughput = perf['average_throughput_per_min']

        if current_throughput > 0:
            improvement_factor = current_throughput / baseline_throughput
            print(f"  Baseline:    {baseline_throughput} messages/min")
            print(f"  Current:     {current_throughput:.1f} messages/min")
            print(f"  Improvement: {improvement_factor:.1f}x faster")

            if improvement_factor >= 5:
                print(f"  Status:      🎉 EXCELLENT! Target achieved (5-8x)")
            elif improvement_factor >= 3:
                print(f"  Status:      ✓ GOOD! Significant improvement (3-5x)")
            elif improvement_factor >= 2:
                print(f"  Status:      ⚠ MODERATE improvement (2-3x)")
            else:
                print(f"  Status:      ⚠ NEEDS ATTENTION (< 2x)")

        print("\n" + "=" * 70)

    def save_report(self, results: Dict, filename: str = 'performance_report.json'):
        """Save report to file"""
        # Convert datetime objects to strings for JSON serialization
        for sample in results['samples']:
            sample['timestamp'] = sample['timestamp'].isoformat()

        with open(filename, 'w') as f:
            json.dump(results, f, indent=2)

        print(f"\nReport saved to: {filename}")


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description='Measure File Processing Worker Performance',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Measure for 5 minutes
  python measure-performance.py --queue-url https://sqs... --duration 300

  # Measure until 100 messages processed
  python measure-performance.py --queue-url https://sqs... --messages 100

  # Quick 1-minute test
  python measure-performance.py --queue-url https://sqs... --duration 60
        """
    )

    parser.add_argument(
        '--queue-url',
        required=True,
        help='SQS queue URL to monitor'
    )

    parser.add_argument(
        '--duration',
        type=int,
        default=300,
        help='Duration to measure in seconds (default: 300 = 5 minutes)'
    )

    parser.add_argument(
        '--messages',
        type=int,
        help='Stop after processing this many messages'
    )

    parser.add_argument(
        '--region',
        default='ap-northeast-1',
        help='AWS region (default: ap-northeast-1)'
    )

    parser.add_argument(
        '--output',
        default='performance_report.json',
        help='Output file for results (default: performance_report.json)'
    )

    args = parser.parse_args()

    # Create monitor
    monitor = PerformanceMonitor(region=args.region)

    # Measure performance
    results = monitor.measure_performance(
        queue_url=args.queue_url,
        duration_seconds=args.duration,
        target_messages=args.messages
    )

    # Print report
    monitor.print_report(results)

    # Save report
    monitor.save_report(results, filename=args.output)


if __name__ == '__main__':
    main()
