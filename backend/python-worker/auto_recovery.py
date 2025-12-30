#!/usr/bin/env python3.11
"""
Auto Recovery System - Worker Health Monitoring & Self-Healing

Features:
1. Periodic health checks (every 60s)
2. Detects stuck workers (no progress for X minutes)
3. Detects memory leaks
4. Automatic restart on failure
5. Alerts on persistent issues
6. CloudWatch integration

Usage:
  # Run as systemd service (recommended)
  python auto_recovery.py

  # Manual execution
  python auto_recovery.py --check-interval 30
"""

import os
import sys
import time
import logging
import psutil
import subprocess
from datetime import datetime, timedelta
from typing import Dict, Optional, List

import boto3

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class WorkerHealthMonitor:
    """Monitors worker process health and triggers recovery"""

    def __init__(
        self,
        service_name: str = 'file-processor.service',
        check_interval: int = 60,
        stuck_threshold_minutes: int = 10,
        memory_threshold_gb: float = 5.0
    ):
        self.service_name = service_name
        self.check_interval = check_interval
        self.stuck_threshold = timedelta(minutes=stuck_threshold_minutes)
        self.memory_threshold = memory_threshold_gb * 1024 * 1024 * 1024  # Convert to bytes

        self.last_message_count = None
        self.last_progress_time = datetime.now()
        self.restart_count = 0
        self.health_check_failures = 0

        # AWS clients
        self.sqs = boto3.client('sqs', region_name=os.environ.get('AWS_REGION', 'ap-northeast-1'))
        self.cloudwatch = boto3.client('cloudwatch', region_name=os.environ.get('AWS_REGION', 'ap-northeast-1'))

    def get_worker_process(self) -> Optional[psutil.Process]:
        """Get worker process if running"""
        try:
            for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
                cmdline = proc.info.get('cmdline', [])
                if cmdline and 'worker.py' in ' '.join(cmdline):
                    return psutil.Process(proc.info['pid'])
        except Exception as e:
            logger.error(f"Error finding worker process: {e}")

        return None

    def check_service_status(self) -> Dict[str, any]:
        """Check systemd service status"""
        try:
            result = subprocess.run(
                ['systemctl', 'is-active', self.service_name],
                capture_output=True,
                text=True,
                timeout=5
            )

            active = result.stdout.strip() == 'active'

            # Get service details
            result = subprocess.run(
                ['systemctl', 'show', self.service_name, '--no-pager'],
                capture_output=True,
                text=True,
                timeout=5
            )

            properties = {}
            for line in result.stdout.split('\n'):
                if '=' in line:
                    key, value = line.split('=', 1)
                    properties[key] = value

            return {
                'active': active,
                'main_pid': int(properties.get('MainPID', 0)),
                'active_state': properties.get('ActiveState', 'unknown'),
                'sub_state': properties.get('SubState', 'unknown'),
                'memory_current': int(properties.get('MemoryCurrent', 0)),
            }

        except Exception as e:
            logger.error(f"Error checking service status: {e}")
            return {'active': False, 'error': str(e)}

    def check_sqs_progress(self) -> bool:
        """
        Check if worker is making progress by monitoring SQS message count

        Returns:
            True if progress detected, False if stuck
        """
        try:
            queue_url = os.environ.get('SQS_QUEUE_URL')
            if not queue_url:
                logger.warning("SQS_QUEUE_URL not set - cannot check progress")
                return True  # Assume healthy

            response = self.sqs.get_queue_attributes(
                QueueUrl=queue_url,
                AttributeNames=['ApproximateNumberOfMessages']
            )

            current_count = int(response['Attributes']['ApproximateNumberOfMessages'])

            if self.last_message_count is None:
                # First check
                self.last_message_count = current_count
                self.last_progress_time = datetime.now()
                return True

            # Check if messages are being processed
            if current_count < self.last_message_count:
                # Progress detected
                self.last_message_count = current_count
                self.last_progress_time = datetime.now()
                return True

            # No progress - check if stuck
            time_since_progress = datetime.now() - self.last_progress_time

            if time_since_progress > self.stuck_threshold:
                logger.warning(
                    f"⚠️  No progress detected for {time_since_progress.seconds // 60} minutes. "
                    f"Queue stuck at {current_count} messages"
                )
                return False

            return True

        except Exception as e:
            logger.error(f"Error checking SQS progress: {e}")
            return True  # Assume healthy on error

    def check_memory_usage(self, process: psutil.Process) -> bool:
        """
        Check if worker memory usage is within limits

        Returns:
            True if memory OK, False if exceeded threshold
        """
        try:
            mem_info = process.memory_info()
            rss = mem_info.rss  # Resident Set Size

            if rss > self.memory_threshold:
                logger.warning(
                    f"⚠️  High memory usage: {rss / 1024 / 1024 / 1024:.2f}GB "
                    f"(threshold: {self.memory_threshold / 1024 / 1024 / 1024:.2f}GB)"
                )
                return False

            return True

        except Exception as e:
            logger.error(f"Error checking memory: {e}")
            return True  # Assume healthy on error

    def check_worker_health(self) -> Dict[str, any]:
        """
        Comprehensive health check

        Returns:
            Health status dictionary
        """
        health = {
            'timestamp': datetime.now().isoformat(),
            'healthy': True,
            'issues': [],
        }

        # Check 1: Service status
        service_status = self.check_service_status()
        health['service_active'] = service_status.get('active', False)

        if not health['service_active']:
            health['healthy'] = False
            health['issues'].append('Service not active')

        # Check 2: Worker process exists
        process = self.get_worker_process()
        health['process_running'] = process is not None

        if not process:
            health['healthy'] = False
            health['issues'].append('Worker process not found')
            return health  # Cannot do further checks

        # Check 3: Memory usage
        memory_ok = self.check_memory_usage(process)
        health['memory_ok'] = memory_ok

        if not memory_ok:
            health['healthy'] = False
            health['issues'].append('High memory usage')

        # Check 4: SQS processing progress
        progress_ok = self.check_sqs_progress()
        health['progress_ok'] = progress_ok

        if not progress_ok:
            health['healthy'] = False
            health['issues'].append('No processing progress')

        # Check 5: CPU usage (optional)
        try:
            cpu_percent = process.cpu_percent(interval=1)
            health['cpu_percent'] = cpu_percent

            # If CPU is 0% for extended period, worker might be stuck
            # (This is a weak signal, so just log it)
            if cpu_percent < 1.0:
                logger.info(f"Low CPU usage: {cpu_percent:.1f}%")

        except Exception as e:
            logger.warning(f"Failed to get CPU usage: {e}")

        return health

    def restart_worker(self, reason: str):
        """Restart worker service"""
        logger.warning("=" * 60)
        logger.warning(f"🔄 RESTARTING WORKER - Reason: {reason}")
        logger.warning("=" * 60)

        try:
            # Restart service
            result = subprocess.run(
                ['systemctl', 'restart', self.service_name],
                capture_output=True,
                text=True,
                timeout=30
            )

            if result.returncode == 0:
                logger.info("✅ Worker restarted successfully")
                self.restart_count += 1

                # Reset health tracking
                self.last_message_count = None
                self.last_progress_time = datetime.now()
                self.health_check_failures = 0

                # Send metric
                self.send_metric('WorkerRestart', 1, {'Reason': reason})

            else:
                logger.error(f"Failed to restart worker: {result.stderr}")
                self.send_metric('WorkerRestartFailed', 1, {'Reason': reason})

        except Exception as e:
            logger.error(f"Error restarting worker: {e}", exc_info=True)

    def send_metric(self, metric_name: str, value: float, dimensions: Dict[str, str] = None):
        """Send metric to CloudWatch"""
        try:
            metric_data = {
                'MetricName': metric_name,
                'Value': value,
                'Unit': 'Count',
                'Timestamp': datetime.utcnow()
            }

            if dimensions:
                metric_data['Dimensions'] = [
                    {'Name': k, 'Value': v} for k, v in dimensions.items()
                ]

            self.cloudwatch.put_metric_data(
                Namespace='CISFileSearch/Worker',
                MetricData=[metric_data]
            )

        except Exception as e:
            logger.warning(f"Failed to send metric: {e}")

    def monitor(self):
        """Main monitoring loop"""
        logger.info("=" * 60)
        logger.info("Auto Recovery System - Starting")
        logger.info(f"Service: {self.service_name}")
        logger.info(f"Check interval: {self.check_interval}s")
        logger.info(f"Stuck threshold: {self.stuck_threshold.seconds // 60} minutes")
        logger.info(f"Memory threshold: {self.memory_threshold / 1024 / 1024 / 1024:.1f}GB")
        logger.info("=" * 60)

        while True:
            try:
                # Perform health check
                health = self.check_worker_health()

                if health['healthy']:
                    logger.info(f"✅ Health check passed")
                    self.health_check_failures = 0

                    # Send healthy metric
                    self.send_metric('HealthCheckStatus', 1)

                else:
                    logger.warning(f"⚠️  Health check failed: {', '.join(health['issues'])}")
                    self.health_check_failures += 1

                    # Send unhealthy metric
                    self.send_metric('HealthCheckStatus', 0)

                    # Restart if failed multiple times
                    if self.health_check_failures >= 3:
                        self.restart_worker(reason=', '.join(health['issues']))

                # Log restart count
                if self.restart_count > 0:
                    logger.info(f"Total restarts this session: {self.restart_count}")

                # Sleep until next check
                time.sleep(self.check_interval)

            except KeyboardInterrupt:
                logger.info("Received keyboard interrupt - exiting")
                break

            except Exception as e:
                logger.error(f"Error in monitoring loop: {e}", exc_info=True)
                time.sleep(self.check_interval)

        logger.info("Auto recovery system stopped")


def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(
        description='Worker Auto Recovery System',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument(
        '--check-interval',
        type=int,
        default=60,
        help='Health check interval in seconds (default: 60)'
    )

    parser.add_argument(
        '--stuck-threshold',
        type=int,
        default=10,
        help='Minutes without progress before restart (default: 10)'
    )

    parser.add_argument(
        '--memory-threshold',
        type=float,
        default=5.0,
        help='Memory threshold in GB (default: 5.0)'
    )

    parser.add_argument(
        '--service-name',
        default='file-processor.service',
        help='Systemd service name (default: file-processor.service)'
    )

    args = parser.parse_args()

    # Create and start monitor
    monitor = WorkerHealthMonitor(
        service_name=args.service_name,
        check_interval=args.check_interval,
        stuck_threshold_minutes=args.stuck_threshold,
        memory_threshold_gb=args.memory_threshold
    )

    monitor.monitor()


if __name__ == '__main__':
    main()
