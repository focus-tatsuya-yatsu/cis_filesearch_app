#!/usr/bin/env python3
"""
Preview Task Enqueuer

Queries OpenSearch for files without previews and enqueues them to SQS
for parallel processing by worker instances.

Usage:
    python preview_task_enqueuer.py [--file-type office|docuworks|all] [--limit N] [--dry-run]
"""

import argparse
import logging
import json
import sys
import os
from datetime import datetime
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
import uuid
import time
import boto3
from botocore.exceptions import ClientError

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import config
from opensearch_client import OpenSearchClient

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Preview Queue URL
PREVIEW_QUEUE_URL = os.getenv(
    'PREVIEW_QUEUE_URL',
    'https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-preview-queue'
)


@dataclass
class EnqueueStats:
    """Enqueue statistics"""
    total_found: int = 0
    enqueued: int = 0
    skipped: int = 0
    failed: int = 0
    start_time: float = field(default_factory=time.time)

    def __str__(self) -> str:
        elapsed = time.time() - self.start_time
        rate = self.enqueued / elapsed if elapsed > 0 else 0
        return (
            f"Found: {self.total_found}, "
            f"Enqueued: {self.enqueued}, "
            f"Skipped: {self.skipped}, "
            f"Failed: {self.failed}, "
            f"Rate: {rate:.1f}/s, "
            f"Elapsed: {elapsed:.1f}s"
        )


class PreviewTaskEnqueuer:
    """
    Enqueues preview generation tasks to SQS.

    This class:
    1. Queries OpenSearch for files without preview_images
    2. Creates SQS messages for each file
    3. Sends messages to the preview task queue
    4. Supports batching for efficient SQS operations
    """

    OFFICE_EXTENSIONS = ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']
    DOCUWORKS_EXTENSIONS = ['.xdw', '.xbd']

    def __init__(
        self,
        queue_url: Optional[str] = None,
        dry_run: bool = False,
        batch_size: int = 10
    ):
        """
        Initialize the enqueuer.

        Args:
            queue_url: SQS queue URL (defaults to PREVIEW_QUEUE_URL)
            dry_run: If True, only log what would be enqueued
            batch_size: Number of messages per SQS batch (max 10)
        """
        self.dry_run = dry_run
        self.batch_size = min(batch_size, 10)  # SQS max is 10
        self.queue_url = queue_url or PREVIEW_QUEUE_URL

        self.sqs = boto3.client('sqs', **config.get_boto3_config())
        self.opensearch_client = OpenSearchClient()
        self.stats = EnqueueStats()
        self.batch_id = f"batch_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"

        logger.info(f"Initialized PreviewTaskEnqueuer")
        logger.info(f"  Queue URL: {self.queue_url}")
        logger.info(f"  Dry Run: {dry_run}")
        logger.info(f"  Batch ID: {self.batch_id}")

    def get_total_count(self, file_type: str = 'all') -> int:
        """Get total count of files without previews."""
        extensions = self._get_extensions(file_type)

        query = {
            "query": {
                "bool": {
                    "must": [
                        {"terms": {"file_extension": extensions}}
                    ],
                    "must_not": [
                        {"exists": {"field": "preview_images"}}
                    ]
                }
            },
            "size": 0
        }

        try:
            response = self.opensearch_client.client.search(
                index=self.opensearch_client.index_name,
                body=query
            )

            total = response.get('hits', {}).get('total', {})
            if isinstance(total, dict):
                return total.get('value', 0)
            return total

        except Exception as e:
            logger.error(f"Failed to get count: {e}")
            return 0

    def _get_extensions(self, file_type: str) -> List[str]:
        """Get file extensions for the given type."""
        extensions = []
        if file_type in ('office', 'all'):
            extensions.extend(self.OFFICE_EXTENSIONS)
        if file_type in ('docuworks', 'all'):
            extensions.extend(self.DOCUWORKS_EXTENSIONS)
        return extensions

    def query_files_without_previews(
        self,
        file_type: str = 'all',
        limit: Optional[int] = None,
        scroll_size: int = 1000
    ) -> List[Dict[str, Any]]:
        """
        Query OpenSearch for files without preview images using scroll API.

        Args:
            file_type: 'office', 'docuworks', or 'all'
            limit: Maximum number of files to return
            scroll_size: Number of documents per scroll page

        Returns:
            List of file documents
        """
        extensions = self._get_extensions(file_type)

        query = {
            "query": {
                "bool": {
                    "must": [
                        {"terms": {"file_extension": extensions}}
                    ],
                    "must_not": [
                        {"exists": {"field": "preview_images"}}
                    ]
                }
            },
            "size": min(scroll_size, limit or scroll_size),
            "sort": [{"indexed_at": {"order": "asc"}}],
            "_source": [
                "file_id", "file_name", "file_path", "file_extension"
            ]
        }

        documents = []

        try:
            # Initial search with scroll
            response = self.opensearch_client.client.search(
                index=self.opensearch_client.index_name,
                body=query,
                scroll='5m'
            )

            scroll_id = response.get('_scroll_id')
            hits = response.get('hits', {}).get('hits', [])

            while hits:
                for hit in hits:
                    if limit and len(documents) >= limit:
                        break
                    doc = hit['_source']
                    doc['_id'] = hit['_id']
                    documents.append(doc)

                if limit and len(documents) >= limit:
                    break

                # Get next page
                response = self.opensearch_client.client.scroll(
                    scroll_id=scroll_id,
                    scroll='5m'
                )
                scroll_id = response.get('_scroll_id')
                hits = response.get('hits', {}).get('hits', [])

            # Clear scroll
            if scroll_id:
                try:
                    self.opensearch_client.client.clear_scroll(scroll_id=scroll_id)
                except:
                    pass

            logger.info(f"Retrieved {len(documents)} files without previews")
            return documents

        except Exception as e:
            logger.error(f"Failed to query OpenSearch: {e}")
            return []

    def _determine_file_type(self, extension: str) -> str:
        """Determine file type from extension."""
        if extension.lower() in self.OFFICE_EXTENSIONS:
            return 'office'
        elif extension.lower() in self.DOCUWORKS_EXTENSIONS:
            return 'docuworks'
        return 'unknown'

    def _extract_s3_key(self, file_path: str) -> str:
        """Extract S3 key from file path."""
        s3_prefix = f"s3://{config.s3.landing_bucket}/"
        if file_path.startswith(s3_prefix):
            return file_path[len(s3_prefix):]
        elif file_path.startswith("s3://"):
            parts = file_path.replace("s3://", "").split("/", 1)
            if len(parts) > 1:
                return parts[1]
        return file_path.lstrip('/')

    def _create_task_message(self, document: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create SQS message for a preview task.

        Args:
            document: OpenSearch document

        Returns:
            Task message dictionary
        """
        file_extension = document.get('file_extension', '')
        file_path = document.get('file_path', '')

        return {
            "task_type": "preview_regeneration",
            "file_type": self._determine_file_type(file_extension),
            "file_id": document.get('file_id'),
            "doc_id": document.get('_id'),
            "file_name": document.get('file_name'),
            "file_path": file_path,
            "file_extension": file_extension,
            "s3_key": self._extract_s3_key(file_path),
            "enqueued_at": datetime.utcnow().isoformat(),
            "priority": "normal",
            "retry_count": 0,
            "metadata": {
                "source": "batch_enqueue",
                "batch_id": self.batch_id,
                "reason": "missing_preview"
            }
        }

    def _send_batch(self, messages: List[Dict[str, Any]]) -> int:
        """
        Send a batch of messages to SQS.

        Args:
            messages: List of message dictionaries

        Returns:
            Number of successfully sent messages
        """
        if self.dry_run:
            for msg in messages:
                logger.debug(f"[DRY RUN] Would enqueue: {msg['file_name']} ({msg['file_type']})")
            return len(messages)

        entries = []
        for i, msg in enumerate(messages):
            entries.append({
                'Id': str(i),
                'MessageBody': json.dumps(msg),
                'MessageAttributes': {
                    'task_type': {
                        'DataType': 'String',
                        'StringValue': msg['task_type']
                    },
                    'file_type': {
                        'DataType': 'String',
                        'StringValue': msg['file_type']
                    }
                }
            })

        try:
            response = self.sqs.send_message_batch(
                QueueUrl=self.queue_url,
                Entries=entries
            )

            successful = len(response.get('Successful', []))
            failed = response.get('Failed', [])

            if failed:
                for f in failed:
                    logger.error(f"Failed to send message {f['Id']}: {f.get('Message')}")

            return successful

        except ClientError as e:
            logger.error(f"Failed to send batch: {e}")
            return 0

    def enqueue_preview_tasks(
        self,
        file_type: str = 'all',
        limit: Optional[int] = None
    ) -> EnqueueStats:
        """
        Query files and enqueue preview tasks.

        Args:
            file_type: 'office', 'docuworks', or 'all'
            limit: Maximum number of files to process

        Returns:
            EnqueueStats with results
        """
        logger.info("=" * 60)
        logger.info("Preview Task Enqueue Started")
        logger.info(f"  File Type: {file_type}")
        logger.info(f"  Limit: {limit or 'unlimited'}")
        logger.info(f"  Mode: {'DRY RUN' if self.dry_run else 'LIVE'}")
        logger.info("=" * 60)

        # Get total count first
        total_available = self.get_total_count(file_type)
        logger.info(f"Total files without previews: {total_available}")

        # Query for files
        documents = self.query_files_without_previews(file_type, limit)
        self.stats.total_found = len(documents)

        if not documents:
            logger.info("No files to enqueue")
            return self.stats

        # Create messages and send in batches
        batch = []
        processed = 0

        for doc in documents:
            message = self._create_task_message(doc)

            if message['file_type'] == 'unknown':
                logger.warning(f"Skipping unknown file type: {doc.get('file_name')}")
                self.stats.skipped += 1
                continue

            batch.append(message)

            if len(batch) >= self.batch_size:
                sent = self._send_batch(batch)
                self.stats.enqueued += sent
                self.stats.failed += len(batch) - sent
                batch = []

                processed += self.batch_size
                if processed % 1000 == 0:
                    logger.info(f"Progress: {processed}/{self.stats.total_found} - {self.stats}")

        # Send remaining messages
        if batch:
            sent = self._send_batch(batch)
            self.stats.enqueued += sent
            self.stats.failed += len(batch) - sent

        logger.info("=" * 60)
        logger.info("Enqueue Complete")
        logger.info(f"  {self.stats}")
        logger.info("=" * 60)

        return self.stats


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Enqueue preview generation tasks to SQS"
    )
    parser.add_argument(
        "--file-type",
        choices=['office', 'docuworks', 'all'],
        default='all',
        help="Type of files to process"
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of files to enqueue"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be enqueued without sending"
    )
    parser.add_argument(
        "--queue-url",
        type=str,
        default=None,
        help="Override SQS queue URL"
    )
    parser.add_argument(
        "--count-only",
        action="store_true",
        help="Only show count of files without previews"
    )

    args = parser.parse_args()

    try:
        enqueuer = PreviewTaskEnqueuer(
            queue_url=args.queue_url,
            dry_run=args.dry_run
        )

        if args.count_only:
            count = enqueuer.get_total_count(args.file_type)
            print(f"Files without previews ({args.file_type}): {count}")
            sys.exit(0)

        stats = enqueuer.enqueue_preview_tasks(
            file_type=args.file_type,
            limit=args.limit
        )

        if stats.failed > 0 and stats.enqueued == 0:
            sys.exit(1)

        sys.exit(0)

    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(130)
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
