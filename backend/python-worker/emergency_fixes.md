# Emergency SQS Queue Recovery Plan

## Critical Issues Identified

### Issue 1: Messages Stuck "In Flight" (5 messages)
**Root Cause**: OpenSearch indexing failures prevent message deletion
**Impact**: Messages remain in visibility timeout, then return to queue

### Issue 2: DLQ Accumulation (8,158 messages)
**Root Cause**: No DLQ processing mechanism implemented
**Impact**: Failed messages accumulate indefinitely

### Issue 3: OpenSearch Connection Failures
**Root Cause**: Likely configuration or network issues
**Impact**: All message processing fails at indexing step

## Immediate Recovery Commands

### Step 1: Verify Worker Status
```bash
# SSH into EC2 instance
ssh -i /path/to/cis_key_pair.pem ec2-user@<WORKER_IP>

# Check service status
sudo systemctl status phased-worker.service

# Check recent logs
sudo journalctl -u phased-worker.service -n 200 --no-pager

# Check OpenSearch connection errors
sudo journalctl -u phased-worker.service | grep -i opensearch | tail -50
```

### Step 2: Verify OpenSearch Configuration
```bash
# Check environment variables
sudo cat /etc/systemd/system/phased-worker.service

# Test OpenSearch connectivity
curl -X GET "https://<OPENSEARCH_ENDPOINT>/_cluster/health" -u admin:password
```

### Step 3: Clear Stuck Messages (Temporary)
```bash
# Purge main queue to stop the loop
aws sqs purge-queue \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/381492033915/cis-filesearch-index-queue \
  --region ap-northeast-1

# Note: This deletes all messages in queue - use only in emergency
```

### Step 4: Stop Worker During Diagnosis
```bash
# Stop worker to prevent further processing failures
sudo systemctl stop phased-worker.service

# Verify it's stopped
sudo systemctl status phased-worker.service
```

## Code Fixes Required

### Fix 1: Guaranteed Message Deletion (CRITICAL)
File: `/backend/python-worker/worker.py`

**Problem**: Message deletion happens inside try-except but OpenSearch errors prevent reaching it

**Solution**: Move message deletion to `finally` block

```python
# Line 428-479: REPLACE entire message processing loop
for message in messages:
    if self.shutdown_requested:
        self.logger.info("Shutdown requested, stopping message processing")
        break

    receipt_handle = message['ReceiptHandle']
    message_id = message.get('MessageId', 'unknown')
    self.stats['processed'] += 1

    # Message processing state
    processing_success = False
    error_message = None

    try:
        # Process the message
        success, error_msg = self.process_sqs_message(message)

        if success:
            self.logger.info(f"Message {message_id} processed successfully")
            self.stats['succeeded'] += 1
            processing_success = True
        else:
            self.logger.error(f"Message {message_id} processing failed: {error_msg}")
            error_message = error_msg
            self.stats['failed'] += 1

    except Exception as e:
        self.logger.error(f"Unexpected error processing message {message_id}: {e}", exc_info=True)
        error_message = str(e)
        self.stats['failed'] += 1

    finally:
        # CRITICAL: Always delete message from queue (success or failure)
        try:
            self.sqs_client.delete_message(
                QueueUrl=self.config.aws.sqs_queue_url,
                ReceiptHandle=receipt_handle
            )
            self.logger.info(f"✓ Message {message_id} deleted from queue")

            # If processing failed, send to DLQ AFTER deletion
            if not processing_success and error_message:
                self._send_to_dlq(message, error_message)

        except Exception as delete_error:
            # This is CRITICAL - message will reappear after visibility timeout
            self.logger.critical(f"❌ FAILED to delete message {message_id}: {delete_error}", exc_info=True)
            self._send_metric('MessageDeleteFailed', 1)
            # Send alert to CloudWatch
            self._send_alert(f"Critical: Failed to delete SQS message {message_id}")
```

### Fix 2: OpenSearch Failure Resilience
File: `/backend/python-worker/worker.py`

**Problem**: OpenSearch failures should not prevent message deletion

**Solution**: Make OpenSearch indexing non-blocking

```python
# Line 359-368: REPLACE OpenSearch indexing logic
# Index to OpenSearch (non-blocking failure)
opensearch_indexed = False
if self.opensearch.is_connected():
    self.logger.info("Indexing to OpenSearch...")
    try:
        opensearch_indexed = self.opensearch.index_document(document, document_id=key)
        if opensearch_indexed:
            self.logger.info("Successfully indexed document to OpenSearch")
        else:
            self.logger.warning("OpenSearch indexing failed - will retry later")
            # Store document in S3 for later retry
            self._store_for_retry(document, key)
    except Exception as e:
        self.logger.error(f"OpenSearch indexing exception: {e}", exc_info=True)
        self._store_for_retry(document, key)
else:
    self.logger.warning("OpenSearch not connected - storing document for later indexing")
    self._store_for_retry(document, key)

# CONTINUE processing (don't fail the entire message)
self.logger.info(
    f"Processing completed: {Path(key).name} "
    f"({result.char_count:,} chars, {result.processing_time_seconds:.2f}s) "
    f"[OpenSearch: {'✓' if opensearch_indexed else '✗'}]"
)

return (True, None)  # Success even if OpenSearch failed
```

### Fix 3: Add Retry Storage Method
File: `/backend/python-worker/worker.py`

Add new method to store failed documents for retry:

```python
def _store_for_retry(self, document: Dict[str, Any], key: str):
    """
    Store document in S3 for later retry

    Args:
        document: Document that failed to index
        key: Original file key
    """
    try:
        retry_key = f"retry-index/{datetime.utcnow().strftime('%Y-%m-%d')}/{key}.json"

        self.s3_client.put_object(
            Bucket=self.config.aws.s3_bucket,
            Key=retry_key,
            Body=json.dumps(document, ensure_ascii=False, indent=2),
            ContentType='application/json',
            Metadata={
                'original-key': key,
                'retry-reason': 'opensearch-indexing-failed',
                'failed-at': datetime.utcnow().isoformat()
            }
        )

        self.logger.info(f"Stored document for retry: s3://{self.config.aws.s3_bucket}/{retry_key}")

    except Exception as e:
        self.logger.error(f"Failed to store document for retry: {e}", exc_info=True)
```

### Fix 4: Increase Visibility Timeout
File: `/backend/python-worker/config.py`

```python
# Line 30: CHANGE visibility timeout
sqs_visibility_timeout: int = int(os.environ.get('SQS_VISIBILITY_TIMEOUT', '600'))  # 10 minutes instead of 5
```

## DLQ Recovery Script

Create new file: `/backend/python-worker/recover_dlq.py`

```python
#!/usr/bin/env python3
"""
DLQ Recovery Script
Processes messages from DLQ and attempts to re-index them
"""

import os
import sys
import json
import boto3
import logging
from datetime import datetime
from config import get_config
from opensearch_client import OpenSearchClient

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class DLQRecovery:
    def __init__(self):
        self.config = get_config()
        self.sqs = boto3.client('sqs', region_name=self.config.aws.region)
        self.s3 = boto3.client('s3', region_name=self.config.aws.region)
        self.opensearch = OpenSearchClient(self.config)

        # Get DLQ URL
        self.dlq_url = os.environ.get('DLQ_QUEUE_URL',
                                      'https://sqs.ap-northeast-1.amazonaws.com/381492033915/cis-filesearch-dlq')

        self.stats = {
            'processed': 0,
            'recovered': 0,
            'failed': 0,
            'moved_to_archive': 0
        }

    def process_dlq_batch(self, batch_size=10, max_batches=None):
        """Process DLQ messages in batches"""
        logger.info(f"Starting DLQ recovery from: {self.dlq_url}")

        batch_count = 0

        while True:
            if max_batches and batch_count >= max_batches:
                logger.info(f"Reached max batches limit: {max_batches}")
                break

            # Receive messages from DLQ
            response = self.sqs.receive_message(
                QueueUrl=self.dlq_url,
                MaxNumberOfMessages=batch_size,
                WaitTimeSeconds=10,
                VisibilityTimeout=300
            )

            messages = response.get('Messages', [])
            if not messages:
                logger.info("No more messages in DLQ")
                break

            logger.info(f"Processing batch {batch_count + 1}: {len(messages)} messages")

            for message in messages:
                self.process_single_message(message)

            batch_count += 1

        self.print_stats()

    def process_single_message(self, message):
        """Process a single DLQ message"""
        message_id = message.get('MessageId', 'unknown')
        receipt_handle = message['ReceiptHandle']

        self.stats['processed'] += 1

        try:
            # Parse message body
            body = json.loads(message['Body'])

            # Extract file information
            if 'Records' in body:
                record = body['Records'][0]
                bucket = record['s3']['bucket']['name']
                key = record['s3']['object']['key']
            else:
                bucket = body.get('bucket', self.config.aws.s3_bucket)
                key = body['key']

            logger.info(f"Attempting recovery: {key}")

            # Check if document already exists in OpenSearch
            if self.check_already_indexed(key):
                logger.info(f"Document already indexed: {key}")
                self.delete_from_dlq(receipt_handle, message_id)
                self.stats['recovered'] += 1
                return

            # Try to re-index
            if self.retry_indexing(bucket, key):
                logger.info(f"✓ Successfully re-indexed: {key}")
                self.delete_from_dlq(receipt_handle, message_id)
                self.stats['recovered'] += 1
            else:
                logger.warning(f"✗ Re-indexing failed: {key}")
                # Archive to S3 for manual review
                self.archive_failed_message(message, key)
                self.delete_from_dlq(receipt_handle, message_id)
                self.stats['moved_to_archive'] += 1

        except Exception as e:
            logger.error(f"Error processing DLQ message {message_id}: {e}", exc_info=True)
            self.stats['failed'] += 1

    def check_already_indexed(self, document_id):
        """Check if document already exists in OpenSearch"""
        if not self.opensearch.is_connected():
            return False

        try:
            result = self.opensearch.client.exists(
                index=self.config.aws.opensearch_index,
                id=document_id
            )
            return result
        except:
            return False

    def retry_indexing(self, bucket, key):
        """Attempt to re-index document from S3 metadata"""
        try:
            # Get object metadata
            response = self.s3.head_object(Bucket=bucket, Key=key)

            # Build document from metadata
            document = {
                'file_key': key,
                'bucket': bucket,
                's3_url': f"s3://{bucket}/{key}",
                'file_name': key.split('/')[-1],
                'file_size': response.get('ContentLength', 0),
                'mime_type': response.get('ContentType', 'application/octet-stream'),
                'indexed_at': datetime.utcnow().isoformat(),
                'recovery_source': 'dlq',
                'metadata': response.get('Metadata', {})
            }

            # Index to OpenSearch
            if self.opensearch.is_connected():
                return self.opensearch.index_document(document, document_id=key)

            return False

        except Exception as e:
            logger.error(f"Retry indexing failed for {key}: {e}")
            return False

    def archive_failed_message(self, message, key):
        """Archive failed message to S3"""
        try:
            archive_key = f"dlq-archive/{datetime.utcnow().strftime('%Y-%m-%d')}/{key}.json"

            self.s3.put_object(
                Bucket=self.config.aws.s3_bucket,
                Key=archive_key,
                Body=json.dumps(message, ensure_ascii=False, indent=2),
                ContentType='application/json'
            )

            logger.info(f"Archived to: s3://{self.config.aws.s3_bucket}/{archive_key}")

        except Exception as e:
            logger.error(f"Failed to archive message: {e}")

    def delete_from_dlq(self, receipt_handle, message_id):
        """Delete message from DLQ"""
        try:
            self.sqs.delete_message(
                QueueUrl=self.dlq_url,
                ReceiptHandle=receipt_handle
            )
            logger.info(f"Deleted from DLQ: {message_id}")
        except Exception as e:
            logger.error(f"Failed to delete from DLQ: {e}")

    def print_stats(self):
        """Print recovery statistics"""
        logger.info("=== DLQ Recovery Statistics ===")
        logger.info(f"Processed: {self.stats['processed']}")
        logger.info(f"Recovered: {self.stats['recovered']}")
        logger.info(f"Archived: {self.stats['moved_to_archive']}")
        logger.info(f"Failed: {self.stats['failed']}")
        logger.info("==============================")

def main():
    import argparse

    parser = argparse.ArgumentParser(description='DLQ Recovery Script')
    parser.add_argument('--batch-size', type=int, default=10, help='Messages per batch')
    parser.add_argument('--max-batches', type=int, help='Maximum batches to process')
    parser.add_argument('--dry-run', action='store_true', help='Dry run mode')

    args = parser.parse_args()

    recovery = DLQRecovery()

    if args.dry_run:
        logger.info("DRY RUN MODE - No changes will be made")
        return

    recovery.process_dlq_batch(
        batch_size=args.batch_size,
        max_batches=args.max_batches
    )

if __name__ == '__main__':
    main()
```

## Deployment Steps

### 1. Apply Code Fixes
```bash
# On local machine
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker

# Apply fixes to worker.py (use provided code above)
# Edit worker.py with the fixes

# Deploy to EC2
scp -i /path/to/key.pem worker.py ec2-user@<IP>:/home/ec2-user/file-processor/
scp -i /path/to/key.pem recover_dlq.py ec2-user@<IP>:/home/ec2-user/file-processor/
```

### 2. Update Environment Variables
```bash
# SSH into EC2
ssh -i /path/to/key.pem ec2-user@<IP>

# Update systemd service file
sudo nano /etc/systemd/system/phased-worker.service

# Add/update:
Environment="SQS_VISIBILITY_TIMEOUT=600"
Environment="DLQ_QUEUE_URL=https://sqs.ap-northeast-1.amazonaws.com/381492033915/cis-filesearch-dlq"

# Reload systemd
sudo systemctl daemon-reload
```

### 3. Restart Worker
```bash
sudo systemctl restart phased-worker.service
sudo systemctl status phased-worker.service

# Monitor logs
sudo journalctl -u phased-worker.service -f
```

### 4. Run DLQ Recovery
```bash
# Make script executable
chmod +x /home/ec2-user/file-processor/recover_dlq.py

# Test with small batch first
python3 recover_dlq.py --batch-size 5 --max-batches 1

# If successful, process all
python3 recover_dlq.py --batch-size 50
```

## Monitoring Commands

```bash
# Check queue status
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/381492033915/cis-filesearch-index-queue \
  --attribute-names ApproximateNumberOfMessages,ApproximateNumberOfMessagesNotVisible \
  --region ap-northeast-1

# Check DLQ status
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/381492033915/cis-filesearch-dlq \
  --attribute-names ApproximateNumberOfMessages \
  --region ap-northeast-1

# Monitor worker logs
ssh -i /path/to/key.pem ec2-user@<IP> \
  "sudo journalctl -u phased-worker.service -f | grep -E '(deleted|OpenSearch|failed)'"
```

## Expected Outcomes

After applying fixes:
1. ✅ Messages will be deleted immediately after processing (success or failure)
2. ✅ OpenSearch failures won't block message deletion
3. ✅ Failed indexing attempts stored in S3 for retry
4. ✅ DLQ messages can be recovered systematically
5. ✅ No more "stuck in flight" messages

## Risk Assessment

- **Low Risk**: Message deletion in `finally` block
- **Medium Risk**: OpenSearch non-blocking failures
- **High Risk**: Purging main queue (use only if absolutely necessary)

## Rollback Plan

If issues occur:
```bash
# Stop worker
sudo systemctl stop phased-worker.service

# Restore previous version
sudo cp /home/ec2-user/file-processor/worker.py.backup /home/ec2-user/file-processor/worker.py

# Restart
sudo systemctl start phased-worker.service
```
