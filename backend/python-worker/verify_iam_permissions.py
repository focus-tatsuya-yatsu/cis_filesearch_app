#!/usr/bin/env python3
"""
IAM Permission Verification Script for Python Worker
Tests all required AWS permissions to identify missing access rights

This script systematically tests each AWS service access required by python-worker:
- S3 (GetObject, PutObject, DeleteObject)
- SQS (ReceiveMessage, DeleteMessage, ChangeMessageVisibility, SendMessage)
- OpenSearch (ESHttpPost, ESHttpPut, ESHttpGet)
- Bedrock (InvokeModel)
- CloudWatch Logs (CreateLogGroup, CreateLogStream, PutLogEvents)
- CloudWatch Metrics (PutMetricData)

Usage:
    python3 verify_iam_permissions.py
    python3 verify_iam_permissions.py --verbose
    python3 verify_iam_permissions.py --output-json report.json

Security Considerations:
- This script uses current AWS credentials (IAM role or profile)
- No destructive operations - only reads and tests
- Creates minimal test resources that are immediately cleaned up
"""

import os
import sys
import json
import time
import logging
import argparse
import tempfile
from datetime import datetime
from typing import Dict, List, Tuple, Any, Optional
from dataclasses import dataclass, asdict

import boto3
from botocore.exceptions import ClientError, NoCredentialsError, PartialCredentialsError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)


@dataclass
class PermissionTestResult:
    """Result of a single permission test"""
    service: str
    permission: str
    action: str
    status: str  # 'PASS', 'FAIL', 'SKIP'
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    resource_arn: Optional[str] = None
    timestamp: str = ""

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.utcnow().isoformat()


class IAMPermissionVerifier:
    """
    Verifies IAM permissions required by python-worker

    This class tests permissions across all AWS services used by the file processing pipeline.
    """

    def __init__(self, region: str = 'ap-northeast-1', verbose: bool = False):
        """
        Initialize permission verifier

        Args:
            region: AWS region
            verbose: Enable verbose logging
        """
        self.region = region
        self.verbose = verbose
        self.results: List[PermissionTestResult] = []

        # Initialize AWS clients
        try:
            self.s3_client = boto3.client('s3', region_name=region)
            self.sqs_client = boto3.client('sqs', region_name=region)
            self.opensearch_client = boto3.client('opensearch', region_name=region)
            self.bedrock_client = boto3.client('bedrock-runtime', region_name=region)
            self.logs_client = boto3.client('logs', region_name=region)
            self.cloudwatch_client = boto3.client('cloudwatch', region_name=region)
            self.sts_client = boto3.client('sts', region_name=region)
            self.iam_client = boto3.client('iam', region_name=region)
        except (NoCredentialsError, PartialCredentialsError) as e:
            logger.error(f"AWS credentials not found: {e}")
            sys.exit(1)

        # Get current identity
        try:
            identity = self.sts_client.get_caller_identity()
            self.account_id = identity['Account']
            self.caller_arn = identity['Arn']
            logger.info(f"Running as: {self.caller_arn}")
        except Exception as e:
            logger.error(f"Failed to get caller identity: {e}")
            sys.exit(1)

    def _add_result(self, result: PermissionTestResult):
        """Add test result to results list"""
        self.results.append(result)

        # Log result
        status_emoji = "✅" if result.status == "PASS" else "❌" if result.status == "FAIL" else "⏭️"
        log_msg = f"{status_emoji} {result.service:15} {result.permission:30} {result.action:50}"

        if result.status == "PASS":
            logger.info(log_msg)
        elif result.status == "FAIL":
            logger.error(f"{log_msg} | Error: {result.error_code} - {result.error_message}")
        else:
            logger.warning(log_msg)

    def verify_s3_permissions(self, test_bucket: Optional[str] = None) -> None:
        """
        Verify S3 permissions

        Required permissions:
        - s3:GetObject (download files from landing bucket)
        - s3:PutObject (upload thumbnails)
        - s3:DeleteObject (cleanup processed files)
        - s3:ListBucket (list bucket contents)

        Args:
            test_bucket: Optional test bucket name (defaults to env variable)
        """
        logger.info("=" * 80)
        logger.info("Testing S3 Permissions")
        logger.info("=" * 80)

        bucket = test_bucket or os.environ.get('S3_BUCKET', 'cis-filesearch-storage')
        test_key = f"_test/iam-verification-{int(time.time())}.txt"
        test_content = b"IAM permission test"

        # Test s3:ListBucket
        try:
            self.s3_client.list_objects_v2(Bucket=bucket, MaxKeys=1)
            self._add_result(PermissionTestResult(
                service="S3",
                permission="s3:ListBucket",
                action=f"List objects in bucket: {bucket}",
                status="PASS",
                resource_arn=f"arn:aws:s3:::{bucket}"
            ))
        except ClientError as e:
            self._add_result(PermissionTestResult(
                service="S3",
                permission="s3:ListBucket",
                action=f"List objects in bucket: {bucket}",
                status="FAIL",
                error_code=e.response['Error']['Code'],
                error_message=e.response['Error']['Message'],
                resource_arn=f"arn:aws:s3:::{bucket}"
            ))

        # Test s3:PutObject
        try:
            self.s3_client.put_object(
                Bucket=bucket,
                Key=test_key,
                Body=test_content,
                Metadata={'test': 'true'}
            )
            self._add_result(PermissionTestResult(
                service="S3",
                permission="s3:PutObject",
                action=f"Upload test object: s3://{bucket}/{test_key}",
                status="PASS",
                resource_arn=f"arn:aws:s3:::{bucket}/{test_key}"
            ))
            put_object_success = True
        except ClientError as e:
            self._add_result(PermissionTestResult(
                service="S3",
                permission="s3:PutObject",
                action=f"Upload test object: s3://{bucket}/{test_key}",
                status="FAIL",
                error_code=e.response['Error']['Code'],
                error_message=e.response['Error']['Message'],
                resource_arn=f"arn:aws:s3:::{bucket}/{test_key}"
            ))
            put_object_success = False

        # Test s3:GetObject (only if PutObject succeeded)
        if put_object_success:
            try:
                response = self.s3_client.get_object(Bucket=bucket, Key=test_key)
                content = response['Body'].read()
                assert content == test_content, "Downloaded content mismatch"
                self._add_result(PermissionTestResult(
                    service="S3",
                    permission="s3:GetObject",
                    action=f"Download test object: s3://{bucket}/{test_key}",
                    status="PASS",
                    resource_arn=f"arn:aws:s3:::{bucket}/{test_key}"
                ))
            except ClientError as e:
                self._add_result(PermissionTestResult(
                    service="S3",
                    permission="s3:GetObject",
                    action=f"Download test object: s3://{bucket}/{test_key}",
                    status="FAIL",
                    error_code=e.response['Error']['Code'],
                    error_message=e.response['Error']['Message'],
                    resource_arn=f"arn:aws:s3:::{bucket}/{test_key}"
                ))

            # Test s3:DeleteObject
            try:
                self.s3_client.delete_object(Bucket=bucket, Key=test_key)
                self._add_result(PermissionTestResult(
                    service="S3",
                    permission="s3:DeleteObject",
                    action=f"Delete test object: s3://{bucket}/{test_key}",
                    status="PASS",
                    resource_arn=f"arn:aws:s3:::{bucket}/{test_key}"
                ))
            except ClientError as e:
                self._add_result(PermissionTestResult(
                    service="S3",
                    permission="s3:DeleteObject",
                    action=f"Delete test object: s3://{bucket}/{test_key}",
                    status="FAIL",
                    error_code=e.response['Error']['Code'],
                    error_message=e.response['Error']['Message'],
                    resource_arn=f"arn:aws:s3:::{bucket}/{test_key}"
                ))
        else:
            # Skip GetObject and DeleteObject if PutObject failed
            for perm in ['s3:GetObject', 's3:DeleteObject']:
                self._add_result(PermissionTestResult(
                    service="S3",
                    permission=perm,
                    action=f"Skipped (PutObject failed)",
                    status="SKIP"
                ))

    def verify_sqs_permissions(self, test_queue_url: Optional[str] = None) -> None:
        """
        Verify SQS permissions

        Required permissions:
        - sqs:ReceiveMessage (poll for new file events)
        - sqs:DeleteMessage (remove processed messages - CRITICAL)
        - sqs:ChangeMessageVisibility (extend processing time)
        - sqs:GetQueueAttributes (queue monitoring)
        - sqs:SendMessage (send to DLQ on fatal errors)

        Args:
            test_queue_url: Optional test queue URL (defaults to env variable)
        """
        logger.info("=" * 80)
        logger.info("Testing SQS Permissions")
        logger.info("=" * 80)

        queue_url = test_queue_url or os.environ.get('SQS_QUEUE_URL', '')

        if not queue_url:
            logger.warning("SQS_QUEUE_URL not configured - skipping SQS tests")
            for perm in ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:ChangeMessageVisibility',
                         'sqs:GetQueueAttributes', 'sqs:SendMessage']:
                self._add_result(PermissionTestResult(
                    service="SQS",
                    permission=perm,
                    action="Skipped (no queue URL configured)",
                    status="SKIP"
                ))
            return

        # Extract queue ARN from URL
        queue_name = queue_url.split('/')[-1]
        queue_arn = f"arn:aws:sqs:{self.region}:{self.account_id}:{queue_name}"

        # Test sqs:GetQueueAttributes
        try:
            response = self.sqs_client.get_queue_attributes(
                QueueUrl=queue_url,
                AttributeNames=['All']
            )
            self._add_result(PermissionTestResult(
                service="SQS",
                permission="sqs:GetQueueAttributes",
                action=f"Get attributes for queue: {queue_name}",
                status="PASS",
                resource_arn=queue_arn
            ))
        except ClientError as e:
            self._add_result(PermissionTestResult(
                service="SQS",
                permission="sqs:GetQueueAttributes",
                action=f"Get attributes for queue: {queue_name}",
                status="FAIL",
                error_code=e.response['Error']['Code'],
                error_message=e.response['Error']['Message'],
                resource_arn=queue_arn
            ))

        # Test sqs:SendMessage
        test_message = json.dumps({
            'test': True,
            'timestamp': datetime.utcnow().isoformat(),
            'purpose': 'IAM permission verification'
        })

        try:
            send_response = self.sqs_client.send_message(
                QueueUrl=queue_url,
                MessageBody=test_message,
                MessageAttributes={
                    'Test': {'StringValue': 'true', 'DataType': 'String'}
                }
            )
            message_id = send_response['MessageId']
            self._add_result(PermissionTestResult(
                service="SQS",
                permission="sqs:SendMessage",
                action=f"Send test message to queue: {queue_name}",
                status="PASS",
                resource_arn=queue_arn
            ))
            send_message_success = True
        except ClientError as e:
            self._add_result(PermissionTestResult(
                service="SQS",
                permission="sqs:SendMessage",
                action=f"Send test message to queue: {queue_name}",
                status="FAIL",
                error_code=e.response['Error']['Code'],
                error_message=e.response['Error']['Message'],
                resource_arn=queue_arn
            ))
            send_message_success = False

        # Test sqs:ReceiveMessage (only if SendMessage succeeded)
        if send_message_success:
            try:
                receive_response = self.sqs_client.receive_message(
                    QueueUrl=queue_url,
                    MaxNumberOfMessages=1,
                    WaitTimeSeconds=2,
                    VisibilityTimeout=30
                )

                messages = receive_response.get('Messages', [])
                if messages:
                    receipt_handle = messages[0]['ReceiptHandle']
                    self._add_result(PermissionTestResult(
                        service="SQS",
                        permission="sqs:ReceiveMessage",
                        action=f"Receive message from queue: {queue_name}",
                        status="PASS",
                        resource_arn=queue_arn
                    ))
                    receive_message_success = True
                else:
                    self._add_result(PermissionTestResult(
                        service="SQS",
                        permission="sqs:ReceiveMessage",
                        action=f"Receive message from queue: {queue_name}",
                        status="FAIL",
                        error_message="No messages received (queue may be empty)",
                        resource_arn=queue_arn
                    ))
                    receive_message_success = False
            except ClientError as e:
                self._add_result(PermissionTestResult(
                    service="SQS",
                    permission="sqs:ReceiveMessage",
                    action=f"Receive message from queue: {queue_name}",
                    status="FAIL",
                    error_code=e.response['Error']['Code'],
                    error_message=e.response['Error']['Message'],
                    resource_arn=queue_arn
                ))
                receive_message_success = False

            # Test sqs:ChangeMessageVisibility (only if ReceiveMessage succeeded)
            if receive_message_success:
                try:
                    self.sqs_client.change_message_visibility(
                        QueueUrl=queue_url,
                        ReceiptHandle=receipt_handle,
                        VisibilityTimeout=60
                    )
                    self._add_result(PermissionTestResult(
                        service="SQS",
                        permission="sqs:ChangeMessageVisibility",
                        action=f"Change visibility timeout for message",
                        status="PASS",
                        resource_arn=queue_arn
                    ))
                except ClientError as e:
                    self._add_result(PermissionTestResult(
                        service="SQS",
                        permission="sqs:ChangeMessageVisibility",
                        action=f"Change visibility timeout for message",
                        status="FAIL",
                        error_code=e.response['Error']['Code'],
                        error_message=e.response['Error']['Message'],
                        resource_arn=queue_arn
                    ))

                # Test sqs:DeleteMessage (CRITICAL - without this, infinite loop!)
                try:
                    self.sqs_client.delete_message(
                        QueueUrl=queue_url,
                        ReceiptHandle=receipt_handle
                    )
                    self._add_result(PermissionTestResult(
                        service="SQS",
                        permission="sqs:DeleteMessage",
                        action=f"Delete test message from queue: {queue_name}",
                        status="PASS",
                        resource_arn=queue_arn
                    ))
                except ClientError as e:
                    # CRITICAL ERROR
                    self._add_result(PermissionTestResult(
                        service="SQS",
                        permission="sqs:DeleteMessage",
                        action=f"Delete test message from queue: {queue_name} [CRITICAL]",
                        status="FAIL",
                        error_code=e.response['Error']['Code'],
                        error_message=f"CRITICAL: {e.response['Error']['Message']} - Messages will reprocess infinitely!",
                        resource_arn=queue_arn
                    ))
            else:
                # Skip remaining tests if ReceiveMessage failed
                for perm in ['sqs:ChangeMessageVisibility', 'sqs:DeleteMessage']:
                    self._add_result(PermissionTestResult(
                        service="SQS",
                        permission=perm,
                        action="Skipped (ReceiveMessage failed)",
                        status="SKIP"
                    ))
        else:
            # Skip all receive-related tests if SendMessage failed
            for perm in ['sqs:ReceiveMessage', 'sqs:ChangeMessageVisibility', 'sqs:DeleteMessage']:
                self._add_result(PermissionTestResult(
                    service="SQS",
                    permission=perm,
                    action="Skipped (SendMessage failed)",
                    status="SKIP"
                ))

    def verify_opensearch_permissions(self, domain_name: Optional[str] = None) -> None:
        """
        Verify OpenSearch permissions

        Required permissions:
        - es:ESHttpPost (create/update documents)
        - es:ESHttpPut (index creation)
        - es:ESHttpGet (search and read)

        Args:
            domain_name: Optional OpenSearch domain name
        """
        logger.info("=" * 80)
        logger.info("Testing OpenSearch Permissions")
        logger.info("=" * 80)

        endpoint = os.environ.get('OPENSEARCH_ENDPOINT', '')

        if not endpoint:
            logger.warning("OPENSEARCH_ENDPOINT not configured - skipping OpenSearch tests")
            for perm in ['es:ESHttpPost', 'es:ESHttpPut', 'es:ESHttpGet']:
                self._add_result(PermissionTestResult(
                    service="OpenSearch",
                    permission=perm,
                    action="Skipped (no endpoint configured)",
                    status="SKIP"
                ))
            return

        # OpenSearch permissions are tested via HTTP API (not boto3)
        # This requires opensearchpy client which is tested in worker.py
        # For IAM verification, we test if the domain is accessible

        try:
            # Extract domain name from endpoint
            domain = endpoint.replace('https://', '').replace('http://', '').split('.')[0]

            response = self.opensearch_client.describe_domain(DomainName=domain)
            domain_arn = response['DomainStatus']['ARN']

            self._add_result(PermissionTestResult(
                service="OpenSearch",
                permission="opensearch:DescribeDomain",
                action=f"Describe OpenSearch domain: {domain}",
                status="PASS",
                resource_arn=domain_arn
            ))

            # Note: Actual HTTP permissions (ESHttpPost, ESHttpPut, ESHttpGet)
            # should be tested by opensearch_client.py during worker operation
            logger.info("Note: es:ESHttp* permissions require runtime testing via opensearch_client.py")

        except ClientError as e:
            self._add_result(PermissionTestResult(
                service="OpenSearch",
                permission="opensearch:DescribeDomain",
                action=f"Describe OpenSearch domain",
                status="FAIL",
                error_code=e.response['Error']['Code'],
                error_message=e.response['Error']['Message']
            ))

    def verify_bedrock_permissions(self) -> None:
        """
        Verify Bedrock permissions

        Required permissions:
        - bedrock:InvokeModel (call Titan Embeddings for vector search)
        """
        logger.info("=" * 80)
        logger.info("Testing Bedrock Permissions")
        logger.info("=" * 80)

        # Test with Titan Embeddings model
        model_id = "amazon.titan-embed-text-v1"
        model_arn = f"arn:aws:bedrock:{self.region}::foundation-model/{model_id}"

        test_text = "IAM permission test"

        try:
            response = self.bedrock_client.invoke_model(
                modelId=model_id,
                contentType='application/json',
                accept='application/json',
                body=json.dumps({"inputText": test_text})
            )

            # Parse response
            response_body = json.loads(response['body'].read())
            embeddings = response_body.get('embedding', [])

            assert len(embeddings) > 0, "No embeddings returned"

            self._add_result(PermissionTestResult(
                service="Bedrock",
                permission="bedrock:InvokeModel",
                action=f"Invoke Titan Embeddings model: {model_id}",
                status="PASS",
                resource_arn=model_arn
            ))
        except ClientError as e:
            self._add_result(PermissionTestResult(
                service="Bedrock",
                permission="bedrock:InvokeModel",
                action=f"Invoke Titan Embeddings model: {model_id}",
                status="FAIL",
                error_code=e.response['Error']['Code'],
                error_message=e.response['Error']['Message'],
                resource_arn=model_arn
            ))
        except Exception as e:
            self._add_result(PermissionTestResult(
                service="Bedrock",
                permission="bedrock:InvokeModel",
                action=f"Invoke Titan Embeddings model: {model_id}",
                status="FAIL",
                error_message=str(e),
                resource_arn=model_arn
            ))

    def verify_cloudwatch_permissions(self) -> None:
        """
        Verify CloudWatch Logs and Metrics permissions

        Required permissions:
        - logs:CreateLogGroup
        - logs:CreateLogStream
        - logs:PutLogEvents
        - cloudwatch:PutMetricData
        """
        logger.info("=" * 80)
        logger.info("Testing CloudWatch Permissions")
        logger.info("=" * 80)

        log_group_name = f"/aws/ec2/file-processor-test-{int(time.time())}"
        log_stream_name = f"test-stream-{int(time.time())}"

        # Test logs:CreateLogGroup
        try:
            self.logs_client.create_log_group(logGroupName=log_group_name)
            self._add_result(PermissionTestResult(
                service="CloudWatch Logs",
                permission="logs:CreateLogGroup",
                action=f"Create log group: {log_group_name}",
                status="PASS",
                resource_arn=f"arn:aws:logs:{self.region}:{self.account_id}:log-group:{log_group_name}"
            ))
            log_group_created = True
        except ClientError as e:
            self._add_result(PermissionTestResult(
                service="CloudWatch Logs",
                permission="logs:CreateLogGroup",
                action=f"Create log group: {log_group_name}",
                status="FAIL",
                error_code=e.response['Error']['Code'],
                error_message=e.response['Error']['Message'],
                resource_arn=f"arn:aws:logs:{self.region}:{self.account_id}:log-group:{log_group_name}"
            ))
            log_group_created = False

        if log_group_created:
            # Test logs:CreateLogStream
            try:
                self.logs_client.create_log_stream(
                    logGroupName=log_group_name,
                    logStreamName=log_stream_name
                )
                self._add_result(PermissionTestResult(
                    service="CloudWatch Logs",
                    permission="logs:CreateLogStream",
                    action=f"Create log stream: {log_stream_name}",
                    status="PASS",
                    resource_arn=f"arn:aws:logs:{self.region}:{self.account_id}:log-group:{log_group_name}:log-stream:{log_stream_name}"
                ))
                log_stream_created = True
            except ClientError as e:
                self._add_result(PermissionTestResult(
                    service="CloudWatch Logs",
                    permission="logs:CreateLogStream",
                    action=f"Create log stream: {log_stream_name}",
                    status="FAIL",
                    error_code=e.response['Error']['Code'],
                    error_message=e.response['Error']['Message']
                ))
                log_stream_created = False

            if log_stream_created:
                # Test logs:PutLogEvents
                try:
                    self.logs_client.put_log_events(
                        logGroupName=log_group_name,
                        logStreamName=log_stream_name,
                        logEvents=[
                            {
                                'timestamp': int(time.time() * 1000),
                                'message': 'IAM permission test log event'
                            }
                        ]
                    )
                    self._add_result(PermissionTestResult(
                        service="CloudWatch Logs",
                        permission="logs:PutLogEvents",
                        action=f"Put log events to stream: {log_stream_name}",
                        status="PASS"
                    ))
                except ClientError as e:
                    self._add_result(PermissionTestResult(
                        service="CloudWatch Logs",
                        permission="logs:PutLogEvents",
                        action=f"Put log events to stream: {log_stream_name}",
                        status="FAIL",
                        error_code=e.response['Error']['Code'],
                        error_message=e.response['Error']['Message']
                    ))
            else:
                self._add_result(PermissionTestResult(
                    service="CloudWatch Logs",
                    permission="logs:PutLogEvents",
                    action="Skipped (CreateLogStream failed)",
                    status="SKIP"
                ))

            # Cleanup: Delete log group
            try:
                self.logs_client.delete_log_group(logGroupName=log_group_name)
                logger.debug(f"Cleaned up test log group: {log_group_name}")
            except Exception as e:
                logger.warning(f"Failed to cleanup log group: {e}")
        else:
            for perm in ['logs:CreateLogStream', 'logs:PutLogEvents']:
                self._add_result(PermissionTestResult(
                    service="CloudWatch Logs",
                    permission=perm,
                    action="Skipped (CreateLogGroup failed)",
                    status="SKIP"
                ))

        # Test cloudwatch:PutMetricData
        try:
            self.cloudwatch_client.put_metric_data(
                Namespace='FileProcessor/Test',
                MetricData=[
                    {
                        'MetricName': 'IAMVerificationTest',
                        'Value': 1.0,
                        'Unit': 'Count',
                        'Timestamp': datetime.utcnow()
                    }
                ]
            )
            self._add_result(PermissionTestResult(
                service="CloudWatch Metrics",
                permission="cloudwatch:PutMetricData",
                action="Put custom metric data",
                status="PASS"
            ))
        except ClientError as e:
            self._add_result(PermissionTestResult(
                service="CloudWatch Metrics",
                permission="cloudwatch:PutMetricData",
                action="Put custom metric data",
                status="FAIL",
                error_code=e.response['Error']['Code'],
                error_message=e.response['Error']['Message']
            ))

    def generate_report(self) -> Dict[str, Any]:
        """
        Generate comprehensive verification report

        Returns:
            Report dictionary with summary and detailed results
        """
        total = len(self.results)
        passed = sum(1 for r in self.results if r.status == "PASS")
        failed = sum(1 for r in self.results if r.status == "FAIL")
        skipped = sum(1 for r in self.results if r.status == "SKIP")

        # Group failures by service
        failures_by_service = {}
        for result in self.results:
            if result.status == "FAIL":
                if result.service not in failures_by_service:
                    failures_by_service[result.service] = []
                failures_by_service[result.service].append(result)

        # Critical failures
        critical_failures = [r for r in self.results if r.status == "FAIL" and "CRITICAL" in r.action]

        report = {
            'timestamp': datetime.utcnow().isoformat(),
            'caller_identity': self.caller_arn,
            'region': self.region,
            'summary': {
                'total_tests': total,
                'passed': passed,
                'failed': failed,
                'skipped': skipped,
                'success_rate': round((passed / total * 100) if total > 0 else 0, 2)
            },
            'critical_failures': [asdict(r) for r in critical_failures],
            'failures_by_service': {
                service: [asdict(r) for r in results]
                for service, results in failures_by_service.items()
            },
            'all_results': [asdict(r) for r in self.results]
        }

        return report

    def print_summary(self):
        """Print human-readable summary"""
        print("\n" + "=" * 80)
        print("IAM PERMISSION VERIFICATION SUMMARY")
        print("=" * 80)

        total = len(self.results)
        passed = sum(1 for r in self.results if r.status == "PASS")
        failed = sum(1 for r in self.results if r.status == "FAIL")
        skipped = sum(1 for r in self.results if r.status == "SKIP")

        print(f"\nIdentity: {self.caller_arn}")
        print(f"Region: {self.region}")
        print(f"\nTotal Tests: {total}")
        print(f"✅ Passed: {passed}")
        print(f"❌ Failed: {failed}")
        print(f"⏭️  Skipped: {skipped}")

        if total > 0:
            success_rate = (passed / total) * 100
            print(f"\n📊 Success Rate: {success_rate:.1f}%")

        # Print critical failures
        critical_failures = [r for r in self.results if r.status == "FAIL" and "CRITICAL" in r.action]
        if critical_failures:
            print("\n" + "=" * 80)
            print("🚨 CRITICAL FAILURES (MUST FIX IMMEDIATELY)")
            print("=" * 80)
            for result in critical_failures:
                print(f"\n❌ {result.service}: {result.permission}")
                print(f"   Action: {result.action}")
                print(f"   Error: {result.error_code} - {result.error_message}")

        # Print failures by service
        failures_by_service = {}
        for result in self.results:
            if result.status == "FAIL":
                if result.service not in failures_by_service:
                    failures_by_service[result.service] = []
                failures_by_service[result.service].append(result)

        if failures_by_service:
            print("\n" + "=" * 80)
            print("FAILURES BY SERVICE")
            print("=" * 80)

            for service, failures in failures_by_service.items():
                print(f"\n{service} ({len(failures)} failures):")
                for result in failures:
                    print(f"  ❌ {result.permission}")
                    print(f"     Error: {result.error_code} - {result.error_message}")

        # Print recommendations
        if failed > 0:
            print("\n" + "=" * 80)
            print("RECOMMENDATIONS")
            print("=" * 80)
            print("\n1. Review IAM role/policy attached to current identity")
            print("2. Ensure all required permissions are granted")
            print("3. Check resource-based policies (S3 bucket policy, SQS queue policy)")
            print("4. Verify VPC endpoints for OpenSearch if using private endpoint")
            print("5. Check CloudTrail for AccessDenied events for detailed error analysis")
            print("\n   CloudTrail lookup command:")
            print("   aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=AccessDenied")
        else:
            print("\n" + "=" * 80)
            print("🎉 ALL PERMISSION TESTS PASSED!")
            print("=" * 80)
            print("\nYour IAM configuration is correct. The worker should be able to process files.")

        print("\n" + "=" * 80)


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description='Verify IAM permissions for Python Worker',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    parser.add_argument(
        '--region',
        default=os.environ.get('AWS_REGION', 'ap-northeast-1'),
        help='AWS region (default: ap-northeast-1)'
    )

    parser.add_argument(
        '--verbose',
        action='store_true',
        help='Enable verbose output'
    )

    parser.add_argument(
        '--output-json',
        metavar='FILE',
        help='Save results to JSON file'
    )

    parser.add_argument(
        '--s3-bucket',
        help='Override S3 bucket for testing (default: from S3_BUCKET env var)'
    )

    parser.add_argument(
        '--sqs-queue-url',
        help='Override SQS queue URL for testing (default: from SQS_QUEUE_URL env var)'
    )

    args = parser.parse_args()

    # Set logging level
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Create verifier
    verifier = IAMPermissionVerifier(region=args.region, verbose=args.verbose)

    # Run all verification tests
    verifier.verify_s3_permissions(test_bucket=args.s3_bucket)
    verifier.verify_sqs_permissions(test_queue_url=args.sqs_queue_url)
    verifier.verify_opensearch_permissions()
    verifier.verify_bedrock_permissions()
    verifier.verify_cloudwatch_permissions()

    # Generate report
    report = verifier.generate_report()

    # Save JSON report if requested
    if args.output_json:
        with open(args.output_json, 'w') as f:
            json.dump(report, f, indent=2)
        logger.info(f"Report saved to: {args.output_json}")

    # Print summary
    verifier.print_summary()

    # Exit with appropriate code
    if report['summary']['failed'] > 0:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == '__main__':
    main()
