"""
Idempotency Manager for File Processing
Prevents duplicate processing of the same file
"""

import hashlib
import json
import time
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
import boto3
from botocore.exceptions import ClientError


class IdempotencyManager:
    """
    DynamoDBを使用した冪等性管理

    処理済みファイルのトラッキングにより、重複処理を防止
    """

    def __init__(self, table_name: str = 'cis-file-processing-idempotency'):
        """
        Initialize idempotency manager

        Args:
            table_name: DynamoDB table name
        """
        self.dynamodb = boto3.resource('dynamodb')
        self.table_name = table_name
        self.table = None

        # Create table if not exists
        self._ensure_table_exists()

    def _ensure_table_exists(self):
        """Create DynamoDB table if it doesn't exist"""
        try:
            self.table = self.dynamodb.Table(self.table_name)
            self.table.load()  # Check if table exists
        except ClientError as e:
            if e.response['Error']['Code'] == 'ResourceNotFoundException':
                self._create_table()
            else:
                raise

    def _create_table(self):
        """Create DynamoDB table for idempotency tracking"""
        table = self.dynamodb.create_table(
            TableName=self.table_name,
            KeySchema=[
                {'AttributeName': 'file_id', 'KeyType': 'HASH'},  # Partition key
            ],
            AttributeDefinitions=[
                {'AttributeName': 'file_id', 'AttributeType': 'S'},
                {'AttributeName': 'expiration', 'AttributeType': 'N'},
            ],
            GlobalSecondaryIndexes=[
                {
                    'IndexName': 'expiration-index',
                    'KeySchema': [
                        {'AttributeName': 'expiration', 'KeyType': 'HASH'},
                    ],
                    'Projection': {'ProjectionType': 'ALL'},
                    'ProvisionedThroughput': {
                        'ReadCapacityUnits': 5,
                        'WriteCapacityUnits': 5
                    }
                }
            ],
            BillingMode='PAY_PER_REQUEST'  # On-demand pricing
        )

        # Wait for table creation
        table.wait_until_exists()
        self.table = table

        # Enable TTL for automatic cleanup
        self.dynamodb.meta.client.update_time_to_live(
            TableName=self.table_name,
            TimeToLiveSpecification={
                'Enabled': True,
                'AttributeName': 'expiration'
            }
        )

    def generate_file_id(self, bucket: str, key: str, version_id: Optional[str] = None) -> str:
        """
        Generate unique file identifier

        Args:
            bucket: S3 bucket name
            key: S3 object key
            version_id: Optional S3 version ID

        Returns:
            Unique file identifier (hash)
        """
        identifier = f"{bucket}/{key}"
        if version_id:
            identifier += f"#{version_id}"

        return hashlib.sha256(identifier.encode()).hexdigest()

    def is_already_processed(self, file_id: str) -> bool:
        """
        Check if file has already been processed

        Args:
            file_id: File identifier

        Returns:
            True if file is already processed
        """
        try:
            response = self.table.get_item(Key={'file_id': file_id})

            if 'Item' not in response:
                return False

            item = response['Item']

            # Check if processing is complete
            if item.get('status') == 'completed':
                return True

            # Check if still processing (within timeout)
            if item.get('status') == 'processing':
                processing_started = item.get('processing_started', 0)
                timeout = item.get('timeout', 300)  # Default 5 minutes

                if time.time() - processing_started < timeout:
                    # Still within processing window
                    return True
                else:
                    # Processing timed out, allow retry
                    return False

            return False

        except ClientError as e:
            # If error, assume not processed (fail-safe)
            print(f"Error checking idempotency: {e}")
            return False

    def mark_as_processing(
        self,
        file_id: str,
        bucket: str,
        key: str,
        timeout: int = 300,
        metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Mark file as being processed

        Args:
            file_id: File identifier
            bucket: S3 bucket
            key: S3 key
            timeout: Processing timeout in seconds
            metadata: Additional metadata

        Returns:
            True if successfully marked, False if already processing
        """
        try:
            current_time = int(time.time())
            expiration = current_time + (24 * 3600)  # Expire after 24 hours

            item = {
                'file_id': file_id,
                'status': 'processing',
                'bucket': bucket,
                'key': key,
                'processing_started': current_time,
                'timeout': timeout,
                'expiration': expiration,
                'metadata': metadata or {}
            }

            # Use conditional expression to prevent overwriting completed items
            self.table.put_item(
                Item=item,
                ConditionExpression='attribute_not_exists(file_id) OR #status <> :completed',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={':completed': 'completed'}
            )

            return True

        except ClientError as e:
            if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                # Already processing or completed
                return False
            else:
                raise

    def mark_as_completed(
        self,
        file_id: str,
        result: Optional[Dict[str, Any]] = None
    ):
        """
        Mark file processing as completed

        Args:
            file_id: File identifier
            result: Processing result metadata
        """
        try:
            current_time = int(time.time())
            expiration = current_time + (7 * 24 * 3600)  # Keep for 7 days

            self.table.update_item(
                Key={'file_id': file_id},
                UpdateExpression='SET #status = :status, completed_at = :completed_at, expiration = :expiration, result = :result',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={
                    ':status': 'completed',
                    ':completed_at': current_time,
                    ':expiration': expiration,
                    ':result': result or {}
                }
            )

        except ClientError as e:
            print(f"Error marking as completed: {e}")
            raise

    def mark_as_failed(
        self,
        file_id: str,
        error: str,
        retry_count: int = 0
    ):
        """
        Mark file processing as failed

        Args:
            file_id: File identifier
            error: Error message
            retry_count: Number of retries
        """
        try:
            current_time = int(time.time())
            expiration = current_time + (24 * 3600)  # Expire after 24 hours

            self.table.update_item(
                Key={'file_id': file_id},
                UpdateExpression='SET #status = :status, failed_at = :failed_at, error = :error, retry_count = :retry_count, expiration = :expiration',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={
                    ':status': 'failed',
                    ':failed_at': current_time,
                    ':error': error,
                    ':retry_count': retry_count,
                    ':expiration': expiration
                }
            )

        except ClientError as e:
            print(f"Error marking as failed: {e}")
            raise

    def get_processing_status(self, file_id: str) -> Optional[Dict[str, Any]]:
        """
        Get processing status of a file

        Args:
            file_id: File identifier

        Returns:
            Processing status dictionary or None
        """
        try:
            response = self.table.get_item(Key={'file_id': file_id})
            return response.get('Item')
        except ClientError as e:
            print(f"Error getting status: {e}")
            return None


# Usage example in main.py
"""
from idempotency import IdempotencyManager

idempotency = IdempotencyManager()

def process_file(bucket: str, key: str) -> bool:
    file_id = idempotency.generate_file_id(bucket, key)

    # Check if already processed
    if idempotency.is_already_processed(file_id):
        logger.info(f"File {key} already processed, skipping")
        return True

    # Mark as processing
    if not idempotency.mark_as_processing(file_id, bucket, key, timeout=300):
        logger.warning(f"File {key} is already being processed")
        return False

    try:
        # Process file
        result = do_actual_processing(bucket, key)

        # Mark as completed
        idempotency.mark_as_completed(file_id, result)
        return True

    except Exception as e:
        # Mark as failed
        idempotency.mark_as_failed(file_id, str(e))
        return False
"""
