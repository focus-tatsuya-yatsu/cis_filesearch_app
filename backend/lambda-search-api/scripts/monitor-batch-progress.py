#!/usr/bin/env python3
"""
Batch Indexing Progress Monitor
Real-time monitoring of batch image indexing progress
"""

import os
import sys
import json
import time
import argparse
from datetime import datetime, timedelta
from typing import Dict, Optional

import boto3
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth


class ProgressMonitor:
    """Monitor batch indexing progress"""

    def __init__(
        self,
        opensearch_endpoint: str,
        opensearch_index: str,
        state_file: str = 'batch-progress.json',
        aws_region: str = 'ap-northeast-1'
    ):
        """Initialize monitor"""
        self.opensearch_index = opensearch_index
        self.state_file = state_file

        # Initialize OpenSearch client
        credentials = boto3.Session().get_credentials()
        awsauth = AWS4Auth(
            credentials.access_key,
            credentials.secret_key,
            aws_region,
            'es',
            session_token=credentials.token
        )

        self.opensearch = OpenSearch(
            hosts=[{'host': opensearch_endpoint.replace('https://', ''), 'port': 443}],
            http_auth=awsauth,
            use_ssl=True,
            verify_certs=True,
            connection_class=RequestsHttpConnection,
            timeout=30
        )

        # CloudWatch client
        self.cloudwatch = boto3.client('cloudwatch', region_name=aws_region)

    def load_state(self) -> Optional[Dict]:
        """Load current progress state"""
        try:
            if os.path.exists(self.state_file):
                with open(self.state_file, 'r') as f:
                    return json.load(f)
        except Exception as e:
            print(f"Warning: Failed to load state file: {e}")

        return None

    def get_opensearch_stats(self) -> Dict:
        """Get current OpenSearch statistics"""
        try:
            # Total images
            total_query = {
                "size": 0,
                "query": {
                    "terms": {
                        "file_extension.keyword": [
                            ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"
                        ]
                    }
                }
            }

            total_response = self.opensearch.search(
                index=self.opensearch_index,
                body=total_query
            )

            total_images = total_response['hits']['total']['value']

            # Images with vectors
            vector_query = {
                "size": 0,
                "query": {
                    "bool": {
                        "must": [
                            {
                                "terms": {
                                    "file_extension.keyword": [
                                        ".jpg", ".jpeg", ".png", ".gif",
                                        ".bmp", ".webp"
                                    ]
                                }
                            },
                            {
                                "exists": {
                                    "field": "image_vector"
                                }
                            }
                        ]
                    }
                }
            }

            vector_response = self.opensearch.search(
                index=self.opensearch_index,
                body=vector_query
            )

            images_with_vector = vector_response['hits']['total']['value']

            return {
                'total_images': total_images,
                'images_with_vector': images_with_vector,
                'images_without_vector': total_images - images_with_vector,
                'completion_percentage': (
                    images_with_vector / total_images * 100
                    if total_images > 0 else 0
                )
            }

        except Exception as e:
            print(f"Error getting OpenSearch stats: {e}")
            return {
                'total_images': 0,
                'images_with_vector': 0,
                'images_without_vector': 0,
                'completion_percentage': 0
            }

    def get_cloudwatch_metrics(self) -> Dict:
        """Get CloudWatch metrics for batch processing"""
        try:
            end_time = datetime.utcnow()
            start_time = end_time - timedelta(hours=1)

            # Files processed metric
            processed_response = self.cloudwatch.get_metric_statistics(
                Namespace='CIS/ImageIndexing',
                MetricName='FilesProcessed',
                StartTime=start_time,
                EndTime=end_time,
                Period=300,  # 5 minutes
                Statistics=['Sum', 'Average']
            )

            # Success rate metric
            success_response = self.cloudwatch.get_metric_statistics(
                Namespace='CIS/ImageIndexing',
                MetricName='SuccessRate',
                StartTime=start_time,
                EndTime=end_time,
                Period=300,
                Statistics=['Average']
            )

            # Cache hit rate metric
            cache_response = self.cloudwatch.get_metric_statistics(
                Namespace='CIS/ImageIndexing',
                MetricName='CacheHitRate',
                StartTime=start_time,
                EndTime=end_time,
                Period=300,
                Statistics=['Average']
            )

            return {
                'files_processed_last_hour': sum(
                    dp['Sum'] for dp in processed_response['Datapoints']
                ),
                'avg_success_rate': (
                    sum(dp['Average'] for dp in success_response['Datapoints']) /
                    len(success_response['Datapoints'])
                    if success_response['Datapoints'] else 0
                ),
                'avg_cache_hit_rate': (
                    sum(dp['Average'] for dp in cache_response['Datapoints']) /
                    len(cache_response['Datapoints'])
                    if cache_response['Datapoints'] else 0
                )
            }

        except Exception as e:
            print(f"Error getting CloudWatch metrics: {e}")
            return {
                'files_processed_last_hour': 0,
                'avg_success_rate': 0,
                'avg_cache_hit_rate': 0
            }

    def estimate_completion_time(
        self,
        remaining: int,
        throughput: float
    ) -> Optional[str]:
        """Estimate completion time"""
        if throughput <= 0:
            return "Unknown"

        remaining_minutes = remaining / throughput
        completion_time = datetime.utcnow() + timedelta(minutes=remaining_minutes)

        return completion_time.strftime('%Y-%m-%d %H:%M:%S UTC')

    def display_progress(self, clear_screen: bool = True):
        """Display current progress"""
        if clear_screen:
            os.system('clear' if os.name != 'nt' else 'cls')

        print("=" * 70)
        print("  BATCH IMAGE INDEXING - PROGRESS MONITOR")
        print("=" * 70)
        print(f"Time: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}")
        print()

        # Load state file
        state = self.load_state()

        if state:
            print("📄 STATE FILE")
            print("-" * 70)
            stats = state.get('stats', {})
            print(f"  Total Processed:     {stats.get('processed', 0):,}")
            print(f"  Succeeded:           {stats.get('succeeded', 0):,}")
            print(f"  Failed:              {stats.get('failed', 0):,}")
            print(f"  Lambda Cache Hits:   {stats.get('lambda_cache_hits', 0):,}")

            if stats.get('processed', 0) > 0:
                success_rate = (
                    stats.get('succeeded', 0) / stats.get('processed', 1)
                ) * 100
                print(f"  Success Rate:        {success_rate:.1f}%")

            # Calculate throughput
            start_time = stats.get('start_time')
            if start_time:
                runtime_seconds = time.time() - start_time
                runtime_minutes = runtime_seconds / 60

                if runtime_minutes > 0:
                    throughput = stats.get('processed', 0) / runtime_minutes
                    print(f"  Throughput:          {throughput:.1f} files/min")
                    print(f"  Runtime:             {runtime_minutes:.1f} minutes")
                else:
                    throughput = 0

            print(f"  Last Update:         {state.get('last_update', 'N/A')}")
            print()

        # OpenSearch statistics
        print("🔍 OPENSEARCH INDEX")
        print("-" * 70)
        os_stats = self.get_opensearch_stats()

        print(f"  Total Images:        {os_stats['total_images']:,}")
        print(f"  With Vectors:        {os_stats['images_with_vector']:,}")
        print(f"  Without Vectors:     {os_stats['images_without_vector']:,}")
        print(
            f"  Completion:          "
            f"{os_stats['completion_percentage']:.1f}%"
        )

        # Progress bar
        bar_width = 50
        filled = int(bar_width * os_stats['completion_percentage'] / 100)
        bar = '█' * filled + '░' * (bar_width - filled)
        print(f"  Progress: [{bar}]")
        print()

        # Estimate completion time
        if state and runtime_minutes > 0 and throughput > 0:
            remaining = os_stats['images_without_vector']
            eta = self.estimate_completion_time(remaining, throughput)
            print(f"  Estimated Completion: {eta}")
            print()

        # CloudWatch metrics
        print("📊 CLOUDWATCH METRICS (Last Hour)")
        print("-" * 70)
        cw_metrics = self.get_cloudwatch_metrics()

        print(
            f"  Files Processed:     "
            f"{cw_metrics['files_processed_last_hour']:,.0f}"
        )
        print(f"  Avg Success Rate:    {cw_metrics['avg_success_rate']:.1f}%")
        print(f"  Avg Cache Hit Rate:  {cw_metrics['avg_cache_hit_rate']:.1f}%")
        print()

        print("=" * 70)
        print("Press Ctrl+C to exit")
        print("=" * 70)

    def monitor_loop(self, interval: int = 10):
        """Continuous monitoring loop"""
        try:
            while True:
                self.display_progress()
                time.sleep(interval)

        except KeyboardInterrupt:
            print("\n\nMonitoring stopped by user")


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description='Monitor batch image indexing progress',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument(
        '--opensearch-endpoint',
        default=os.environ.get('OPENSEARCH_ENDPOINT'),
        help='OpenSearch endpoint URL'
    )
    parser.add_argument(
        '--opensearch-index',
        default='file-index-v2-knn',
        help='OpenSearch index name'
    )
    parser.add_argument(
        '--state-file',
        default='batch-progress.json',
        help='Progress state file path'
    )
    parser.add_argument(
        '--interval',
        type=int,
        default=10,
        help='Refresh interval in seconds'
    )
    parser.add_argument(
        '--once',
        action='store_true',
        help='Display once and exit (no loop)'
    )

    args = parser.parse_args()

    if not args.opensearch_endpoint:
        print(
            "Error: OpenSearch endpoint required "
            "(--opensearch-endpoint or OPENSEARCH_ENDPOINT env var)"
        )
        sys.exit(1)

    try:
        monitor = ProgressMonitor(
            opensearch_endpoint=args.opensearch_endpoint,
            opensearch_index=args.opensearch_index,
            state_file=args.state_file
        )

        if args.once:
            monitor.display_progress(clear_screen=False)
        else:
            monitor.monitor_loop(interval=args.interval)

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
