#!/usr/bin/env python3.11
"""
Health Check Module
Pre-flight validation before starting worker service

Validates:
1. Python dependencies installed
2. AWS credentials configured
3. SQS queue accessibility
4. S3 bucket accessibility
5. OpenSearch connectivity (optional)
6. Environment variables set
7. Disk space available
8. Memory available

Exit Codes:
0 - All checks passed
1 - Critical failure (prevents service start)
2 - Warning (service can start but with degraded functionality)
"""

import sys
import os
import importlib
import logging
from pathlib import Path
from typing import Dict, List, Tuple

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class HealthCheckResult:
    """Health check result with severity"""
    def __init__(self, name: str, passed: bool, message: str, severity: str = 'critical'):
        self.name = name
        self.passed = passed
        self.message = message
        self.severity = severity  # 'critical' or 'warning'

    def __repr__(self):
        status = "✅ PASS" if self.passed else "❌ FAIL"
        return f"{status} [{self.severity.upper()}] {self.name}: {self.message}"


class HealthChecker:
    """Comprehensive health checker"""

    def __init__(self):
        self.results: List[HealthCheckResult] = []
        self.critical_failures = 0
        self.warnings = 0

    def check_python_dependencies(self) -> HealthCheckResult:
        """Check if all required Python packages are installed"""
        required_packages = [
            'boto3',
            'botocore',
            'opensearchpy',
            'PIL',  # Pillow
            'pytesseract',
            'pdf2image',
            'docx',
            'pptx',
            'openpyxl',
        ]

        missing = []
        for package in required_packages:
            try:
                importlib.import_module(package)
            except ImportError:
                missing.append(package)

        if missing:
            return HealthCheckResult(
                name="Python Dependencies",
                passed=False,
                message=f"Missing packages: {', '.join(missing)}. Run: pip install -r requirements.txt",
                severity='critical'
            )

        return HealthCheckResult(
            name="Python Dependencies",
            passed=True,
            message=f"All {len(required_packages)} required packages installed",
            severity='critical'
        )

    def check_environment_variables(self) -> HealthCheckResult:
        """Check if required environment variables are set"""
        required_vars = {
            'SQS_QUEUE_URL': 'critical',
            'S3_BUCKET': 'critical',
            'AWS_REGION': 'critical',
            'OPENSEARCH_ENDPOINT': 'warning',  # Optional
            'DLQ_QUEUE_URL': 'warning',  # Can be derived
        }

        missing_critical = []
        missing_warnings = []

        for var, severity in required_vars.items():
            if not os.environ.get(var):
                if severity == 'critical':
                    missing_critical.append(var)
                else:
                    missing_warnings.append(var)

        if missing_critical:
            return HealthCheckResult(
                name="Environment Variables",
                passed=False,
                message=f"Missing critical variables: {', '.join(missing_critical)}",
                severity='critical'
            )

        if missing_warnings:
            return HealthCheckResult(
                name="Environment Variables",
                passed=True,
                message=f"Warning: Optional variables not set: {', '.join(missing_warnings)}",
                severity='warning'
            )

        return HealthCheckResult(
            name="Environment Variables",
            passed=True,
            message="All required environment variables set",
            severity='critical'
        )

    def check_aws_credentials(self) -> HealthCheckResult:
        """Check if AWS credentials are configured"""
        try:
            import boto3
            sts = boto3.client('sts')
            identity = sts.get_caller_identity()

            return HealthCheckResult(
                name="AWS Credentials",
                passed=True,
                message=f"Authenticated as: {identity['Arn']}",
                severity='critical'
            )

        except Exception as e:
            return HealthCheckResult(
                name="AWS Credentials",
                passed=False,
                message=f"AWS authentication failed: {e}",
                severity='critical'
            )

    def check_sqs_connectivity(self) -> HealthCheckResult:
        """Check if SQS queue is accessible"""
        try:
            import boto3
            sqs_queue_url = os.environ.get('SQS_QUEUE_URL')

            if not sqs_queue_url:
                return HealthCheckResult(
                    name="SQS Connectivity",
                    passed=False,
                    message="SQS_QUEUE_URL not set",
                    severity='critical'
                )

            sqs = boto3.client('sqs', region_name=os.environ.get('AWS_REGION', 'ap-northeast-1'))
            attrs = sqs.get_queue_attributes(
                QueueUrl=sqs_queue_url,
                AttributeNames=['ApproximateNumberOfMessages']
            )

            msg_count = attrs['Attributes']['ApproximateNumberOfMessages']

            return HealthCheckResult(
                name="SQS Connectivity",
                passed=True,
                message=f"Queue accessible. Messages in queue: {msg_count}",
                severity='critical'
            )

        except Exception as e:
            return HealthCheckResult(
                name="SQS Connectivity",
                passed=False,
                message=f"SQS connection failed: {e}",
                severity='critical'
            )

    def check_s3_connectivity(self) -> HealthCheckResult:
        """Check if S3 bucket is accessible"""
        try:
            import boto3
            bucket = os.environ.get('S3_BUCKET')

            if not bucket:
                return HealthCheckResult(
                    name="S3 Connectivity",
                    passed=False,
                    message="S3_BUCKET not set",
                    severity='critical'
                )

            s3 = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'ap-northeast-1'))
            s3.head_bucket(Bucket=bucket)

            return HealthCheckResult(
                name="S3 Connectivity",
                passed=True,
                message=f"Bucket '{bucket}' accessible",
                severity='critical'
            )

        except Exception as e:
            return HealthCheckResult(
                name="S3 Connectivity",
                passed=False,
                message=f"S3 connection failed: {e}",
                severity='critical'
            )

    def check_opensearch_connectivity(self) -> HealthCheckResult:
        """Check if OpenSearch is accessible (optional)"""
        try:
            endpoint = os.environ.get('OPENSEARCH_ENDPOINT')

            if not endpoint:
                return HealthCheckResult(
                    name="OpenSearch Connectivity",
                    passed=True,
                    message="OpenSearch endpoint not configured (optional)",
                    severity='warning'
                )

            # Basic connectivity check
            import requests
            response = requests.get(f"{endpoint}/_cluster/health", timeout=5)

            if response.status_code == 200:
                return HealthCheckResult(
                    name="OpenSearch Connectivity",
                    passed=True,
                    message="OpenSearch cluster accessible",
                    severity='warning'
                )
            else:
                return HealthCheckResult(
                    name="OpenSearch Connectivity",
                    passed=False,
                    message=f"OpenSearch returned status {response.status_code}",
                    severity='warning'
                )

        except Exception as e:
            return HealthCheckResult(
                name="OpenSearch Connectivity",
                passed=False,
                message=f"OpenSearch connection failed: {e}",
                severity='warning'
            )

    def check_disk_space(self) -> HealthCheckResult:
        """Check if sufficient disk space is available"""
        try:
            import shutil
            temp_dir = os.environ.get('TEMP_DIR', '/tmp')
            stat = shutil.disk_usage(temp_dir)

            # At least 10GB free space required
            free_gb = stat.free / (1024 ** 3)
            threshold_gb = 10

            if free_gb < threshold_gb:
                return HealthCheckResult(
                    name="Disk Space",
                    passed=False,
                    message=f"Low disk space: {free_gb:.1f}GB free (minimum: {threshold_gb}GB)",
                    severity='critical'
                )

            return HealthCheckResult(
                name="Disk Space",
                passed=True,
                message=f"Sufficient disk space: {free_gb:.1f}GB free",
                severity='critical'
            )

        except Exception as e:
            return HealthCheckResult(
                name="Disk Space",
                passed=False,
                message=f"Disk space check failed: {e}",
                severity='warning'
            )

    def check_memory_available(self) -> HealthCheckResult:
        """Check if sufficient memory is available"""
        try:
            with open('/proc/meminfo', 'r') as f:
                meminfo = f.read()

            mem_available = None
            for line in meminfo.split('\n'):
                if line.startswith('MemAvailable:'):
                    mem_available = int(line.split()[1]) / (1024 ** 2)  # Convert to GB
                    break

            if mem_available is None:
                return HealthCheckResult(
                    name="Memory Available",
                    passed=True,
                    message="Memory info not available",
                    severity='warning'
                )

            # At least 2GB available memory required
            threshold_gb = 2

            if mem_available < threshold_gb:
                return HealthCheckResult(
                    name="Memory Available",
                    passed=False,
                    message=f"Low memory: {mem_available:.1f}GB available (minimum: {threshold_gb}GB)",
                    severity='critical'
                )

            return HealthCheckResult(
                name="Memory Available",
                passed=True,
                message=f"Sufficient memory: {mem_available:.1f}GB available",
                severity='critical'
            )

        except Exception as e:
            return HealthCheckResult(
                name="Memory Available",
                passed=True,
                message=f"Memory check skipped: {e}",
                severity='warning'
            )

    def run_all_checks(self) -> bool:
        """Run all health checks"""
        logger.info("=" * 60)
        logger.info("Starting Health Checks")
        logger.info("=" * 60)

        # Run all checks
        self.results.append(self.check_python_dependencies())
        self.results.append(self.check_environment_variables())
        self.results.append(self.check_aws_credentials())
        self.results.append(self.check_sqs_connectivity())
        self.results.append(self.check_s3_connectivity())
        self.results.append(self.check_opensearch_connectivity())
        self.results.append(self.check_disk_space())
        self.results.append(self.check_memory_available())

        # Print results
        for result in self.results:
            if result.passed:
                logger.info(str(result))
            elif result.severity == 'critical':
                logger.error(str(result))
                self.critical_failures += 1
            else:
                logger.warning(str(result))
                self.warnings += 1

        # Summary
        logger.info("=" * 60)
        logger.info(f"Health Check Summary:")
        logger.info(f"  Total Checks: {len(self.results)}")
        logger.info(f"  Passed: {len([r for r in self.results if r.passed])}")
        logger.info(f"  Critical Failures: {self.critical_failures}")
        logger.info(f"  Warnings: {self.warnings}")
        logger.info("=" * 60)

        # Determine overall status
        if self.critical_failures > 0:
            logger.error("❌ HEALTH CHECK FAILED - Critical issues detected")
            logger.error("Service cannot start safely")
            return False

        if self.warnings > 0:
            logger.warning("⚠️  HEALTH CHECK PASSED WITH WARNINGS")
            logger.warning("Service will start with degraded functionality")

        else:
            logger.info("✅ HEALTH CHECK PASSED - All systems operational")

        return True


def main():
    """Main entry point"""
    checker = HealthChecker()

    try:
        success = checker.run_all_checks()

        if success:
            sys.exit(0)  # All checks passed
        else:
            sys.exit(1)  # Critical failures detected

    except Exception as e:
        logger.error(f"Health check crashed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
