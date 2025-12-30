#!/usr/bin/env python3.11
"""
Spot Instance Interruption Handler

Monitors EC2 instance metadata for spot interruption notices
Gracefully shuts down worker when interruption is detected

AWS sends 2-minute warning before terminating spot instances
This handler ensures:
1. Current message processing completes
2. In-flight messages return to queue
3. Worker shuts down cleanly
4. No data loss

Usage:
  # Run as systemd service (auto-start)
  python spot_interruption_handler.py

  # Run in foreground (testing)
  python spot_interruption_handler.py --foreground
"""

import os
import sys
import time
import logging
import requests
import subprocess
import signal
from datetime import datetime
from typing import Optional

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class SpotInterruptionHandler:
    """Handles EC2 Spot Instance interruption notices"""

    # IMDSv2 token endpoint
    IMDS_TOKEN_URL = 'http://169.254.169.254/latest/api/token'
    IMDS_SPOT_TERMINATION_URL = 'http://169.254.169.254/latest/meta-data/spot/instance-action'

    def __init__(self, worker_service_name: str = 'file-processor.service'):
        self.worker_service_name = worker_service_name
        self.shutdown_initiated = False
        self.check_interval = 5  # Check every 5 seconds

    def get_imds_token(self) -> Optional[str]:
        """Get IMDSv2 token for metadata access"""
        try:
            response = requests.put(
                self.IMDS_TOKEN_URL,
                headers={'X-aws-ec2-metadata-token-ttl-seconds': '21600'},
                timeout=2
            )
            return response.text
        except Exception as e:
            logger.warning(f"Failed to get IMDSv2 token: {e}")
            return None

    def check_interruption_notice(self) -> Optional[dict]:
        """
        Check if spot interruption notice has been issued

        Returns:
            dict with interruption details or None
        """
        try:
            # Get IMDSv2 token
            token = self.get_imds_token()
            if not token:
                return None

            # Query spot termination endpoint
            headers = {'X-aws-ec2-metadata-token': token}
            response = requests.get(
                self.IMDS_SPOT_TERMINATION_URL,
                headers=headers,
                timeout=2
            )

            if response.status_code == 200:
                # Interruption notice exists
                import json
                notice = json.loads(response.text)

                logger.warning("=" * 60)
                logger.warning("⚠️  SPOT INTERRUPTION NOTICE RECEIVED")
                logger.warning(f"Action: {notice.get('action', 'unknown')}")
                logger.warning(f"Time: {notice.get('time', 'unknown')}")
                logger.warning("=" * 60)

                return notice

            elif response.status_code == 404:
                # No interruption notice
                return None

            else:
                logger.warning(f"Unexpected status checking interruption: {response.status_code}")
                return None

        except requests.exceptions.Timeout:
            # Timeout is normal when not running on EC2
            return None

        except Exception as e:
            logger.error(f"Error checking interruption notice: {e}")
            return None

    def graceful_shutdown(self, notice: dict):
        """
        Gracefully shutdown worker service

        Steps:
        1. Send SIGTERM to worker (triggers graceful shutdown)
        2. Wait for worker to finish current message (max 60s)
        3. If still running, send SIGKILL
        """
        if self.shutdown_initiated:
            return

        self.shutdown_initiated = True

        logger.info("Initiating graceful shutdown...")

        try:
            # Stop systemd service (sends SIGTERM)
            logger.info(f"Stopping {self.worker_service_name}...")
            result = subprocess.run(
                ['systemctl', 'stop', self.worker_service_name],
                timeout=90,  # Allow 90 seconds for graceful shutdown
                capture_output=True,
                text=True
            )

            if result.returncode == 0:
                logger.info("✅ Worker stopped gracefully")
            else:
                logger.error(f"Failed to stop worker: {result.stderr}")

        except subprocess.TimeoutExpired:
            logger.error("Timeout stopping worker - forcing kill")

            # Force kill
            subprocess.run(['systemctl', 'kill', '-s', 'SIGKILL', self.worker_service_name])

        except Exception as e:
            logger.error(f"Error during shutdown: {e}", exc_info=True)

        # Send notification (optional)
        self.send_interruption_alert(notice)

    def send_interruption_alert(self, notice: dict):
        """Send alert about spot interruption (SNS/CloudWatch)"""
        try:
            import boto3
            cloudwatch = boto3.client('cloudwatch')

            cloudwatch.put_metric_data(
                Namespace='CISFileSearch/Worker',
                MetricData=[
                    {
                        'MetricName': 'SpotInterruption',
                        'Value': 1,
                        'Unit': 'Count',
                        'Timestamp': datetime.utcnow()
                    }
                ]
            )

            logger.info("Sent spot interruption metric to CloudWatch")

        except Exception as e:
            logger.warning(f"Failed to send alert: {e}")

    def monitor(self):
        """Main monitoring loop"""
        logger.info("=" * 60)
        logger.info("Spot Interruption Handler - Starting")
        logger.info(f"Monitoring service: {self.worker_service_name}")
        logger.info(f"Check interval: {self.check_interval}s")
        logger.info("=" * 60)

        while not self.shutdown_initiated:
            try:
                # Check for interruption notice
                notice = self.check_interruption_notice()

                if notice:
                    # Interruption detected - shutdown gracefully
                    self.graceful_shutdown(notice)
                    break

                # Sleep until next check
                time.sleep(self.check_interval)

            except KeyboardInterrupt:
                logger.info("Received keyboard interrupt - exiting")
                break

            except Exception as e:
                logger.error(f"Error in monitoring loop: {e}", exc_info=True)
                time.sleep(self.check_interval)

        logger.info("Spot interruption handler stopped")

    def run_as_daemon(self):
        """Run as background daemon"""
        # TODO: Implement proper daemonization if needed
        # For now, systemd handles this
        self.monitor()


def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(
        description='Spot Instance Interruption Handler',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument(
        '--foreground',
        action='store_true',
        help='Run in foreground (default: background daemon)'
    )

    parser.add_argument(
        '--service-name',
        default='file-processor.service',
        help='Name of worker systemd service (default: file-processor.service)'
    )

    args = parser.parse_args()

    handler = SpotInterruptionHandler(worker_service_name=args.service_name)

    if args.foreground:
        handler.monitor()
    else:
        handler.run_as_daemon()


if __name__ == '__main__':
    main()
