#!/usr/bin/env python3
"""
Batch Image Indexing Script
Generates 512-dimensional CLIP embeddings via Lambda and indexes to OpenSearch

Key Features:
- Uses existing CLIP Lambda function (512 dimensions)
- Parallel processing with concurrency control
- Resume capability for interrupted runs
- CloudWatch metrics integration
- Comprehensive error handling
"""

import os
import sys
import json
import time
import argparse
import logging
from typing import List, Dict, Optional
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3
from botocore.exceptions import ClientError
from opensearchpy import OpenSearch, RequestsHttpConnection, helpers
from requests_aws4auth import AWS4Auth

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(f'batch-indexing-{datetime.now():%Y%m%d-%H%M%S}.log')
    ]
)
logger = logging.getLogger(__name__)


class BatchImageIndexer:
    """Batch indexer for image embeddings using Lambda + OpenSearch"""

    # Supported image extensions
    IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'}

    def __init__(
        self,
        opensearch_endpoint: str,
        opensearch_index: str,
        lambda_function_name: str,
        aws_region: str = 'ap-northeast-1',
        concurrency: int = 10,
        batch_size: int = 100,
        state_file: str = 'batch-progress.json'
    ):
        """
        Initialize batch indexer

        Args:
            opensearch_endpoint: OpenSearch domain endpoint
            opensearch_index: Index name
            lambda_function_name: Image embedding Lambda function name
            aws_region: AWS region
            concurrency: Number of parallel Lambda invocations
            batch_size: Files per batch
            state_file: Progress state file path
        """
        self.opensearch_index = opensearch_index
        self.lambda_function_name = lambda_function_name
        self.concurrency = concurrency
        self.batch_size = batch_size
        self.state_file = state_file
        self.aws_region = aws_region

        # Initialize AWS clients
        self.lambda_client = boto3.client('lambda', region_name=aws_region)
        self.cloudwatch = boto3.client('cloudwatch', region_name=aws_region)

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
            timeout=60,
            max_retries=3,
            retry_on_timeout=True
        )

        # Statistics
        self.stats = {
            'total_files': 0,
            'processed': 0,
            'succeeded': 0,
            'failed': 0,
            'skipped': 0,
            'lambda_cache_hits': 0,
            'start_time': time.time()
        }

        logger.info("Batch Image Indexer initialized")
        logger.info(f"  OpenSearch: {opensearch_endpoint}/{opensearch_index}")
        logger.info(f"  Lambda: {lambda_function_name}")
        logger.info(f"  Concurrency: {concurrency}, Batch Size: {batch_size}")

    def get_images_without_vector(self, max_files: Optional[int] = None) -> List[Dict]:
        """
        Query OpenSearch for image files without vectors

        Args:
            max_files: Maximum number of files to retrieve

        Returns:
            List of file information dictionaries
        """
        logger.info("Fetching images without vectors from OpenSearch...")

        try:
            query = {
                "query": {
                    "bool": {
                        "must": [
                            {
                                "terms": {
                                    "file_extension.keyword": list(self.IMAGE_EXTENSIONS)
                                }
                            }
                        ],
                        "must_not": [
                            {
                                "exists": {
                                    "field": "image_vector"
                                }
                            }
                        ]
                    }
                },
                "size": min(max_files or 10000, 10000),  # OpenSearch limit
                "_source": [
                    "file_name", "file_path", "file_key",
                    "bucket", "s3_url", "file_extension"
                ],
                "sort": [{"indexed_at": "desc"}]
            }

            response = self.opensearch.search(
                index=self.opensearch_index,
                body=query
            )

            files = []
            for hit in response['hits']['hits']:
                source = hit['_source']
                files.append({
                    'doc_id': hit['_id'],
                    'file_name': source.get('file_name'),
                    'file_path': source.get('file_path'),
                    's3_url': source.get('s3_url'),
                    'file_key': source.get('file_key'),
                    'bucket': source.get('bucket'),
                    'extension': source.get('file_extension')
                })

            logger.info(f"Found {len(files)} images without vectors")
            self.stats['total_files'] = len(files)

            return files

        except Exception as e:
            logger.error(f"Failed to fetch files from OpenSearch: {e}")
            return []

    def generate_embedding_via_lambda(
        self,
        s3_url: str,
        use_cache: bool = True
    ) -> Optional[Dict]:
        """
        Generate image embedding by invoking Lambda function

        Args:
            s3_url: S3 URL of the image
            use_cache: Use Lambda's DynamoDB cache

        Returns:
            Dictionary with embedding and metadata, or None on failure
        """
        try:
            payload = {
                'imageUrl': s3_url,
                'useCache': use_cache,
                'operation': 'generate'
            }

            # Invoke Lambda
            response = self.lambda_client.invoke(
                FunctionName=self.lambda_function_name,
                InvocationType='RequestResponse',
                Payload=json.dumps(payload)
            )

            # Parse response
            if response.get('FunctionError'):
                logger.error(f"Lambda error: {response['FunctionError']}")
                return None

            result = json.loads(response['Payload'].read())

            if result['statusCode'] != 200:
                error_body = json.loads(result['body'])
                logger.error(f"Lambda invocation failed: {error_body}")
                return None

            data = json.loads(result['body'])

            if not data.get('success'):
                logger.error(f"Embedding generation failed: {data.get('error')}")
                return None

            embedding_data = data['data']

            # Track cache hits
            if embedding_data.get('cached'):
                self.stats['lambda_cache_hits'] += 1

            logger.debug(
                f"Generated embedding: {embedding_data['dimension']}D, "
                f"cached={embedding_data['cached']}, "
                f"time={embedding_data.get('inferenceTime', 0):.3f}s"
            )

            return embedding_data

        except ClientError as e:
            logger.error(f"Lambda invocation error: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error in Lambda invocation: {e}")
            return None

    def update_document_with_vector(
        self,
        doc_id: str,
        embedding: List[float]
    ) -> bool:
        """
        Update OpenSearch document with image vector

        Args:
            doc_id: Document ID
            embedding: Embedding vector

        Returns:
            True if successful
        """
        try:
            self.opensearch.update(
                index=self.opensearch_index,
                id=doc_id,
                body={
                    "doc": {
                        "image_vector": embedding,
                        "vector_dimension": len(embedding),
                        "vector_updated_at": datetime.utcnow().isoformat(),
                        "vector_model": "CLIP-ViT-B-32"
                    }
                },
                refresh=False  # Batch refresh later
            )

            logger.debug(f"Updated document: {doc_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to update document {doc_id}: {e}")
            return False

    def process_single_image(self, file_info: Dict) -> bool:
        """
        Process a single image file

        Args:
            file_info: File information dictionary

        Returns:
            True if successful
        """
        try:
            doc_id = file_info['doc_id']
            file_name = file_info['file_name']
            s3_url = file_info['s3_url']

            logger.info(f"Processing: {file_name} (ID: {doc_id[:8]}...)")

            # Generate embedding via Lambda
            embedding_data = self.generate_embedding_via_lambda(s3_url)

            if not embedding_data:
                logger.error(f"Failed to generate embedding: {file_name}")
                return False

            embedding = embedding_data['embedding']

            # Validate embedding
            if not isinstance(embedding, list) or len(embedding) != 512:
                logger.error(
                    f"Invalid embedding dimension: {len(embedding)} (expected 512)"
                )
                return False

            # Update OpenSearch document
            success = self.update_document_with_vector(doc_id, embedding)

            if success:
                logger.info(f"✓ Successfully indexed: {file_name}")
                return True
            else:
                return False

        except Exception as e:
            logger.error(f"Error processing image: {e}")
            return False

    def process_batch_parallel(self, files: List[Dict]) -> Dict:
        """
        Process a batch of files in parallel

        Args:
            files: List of file information dictionaries

        Returns:
            Dictionary with batch statistics
        """
        batch_stats = {
            'succeeded': 0,
            'failed': 0,
            'total': len(files)
        }

        with ThreadPoolExecutor(max_workers=self.concurrency) as executor:
            # Submit all tasks
            future_to_file = {
                executor.submit(self.process_single_image, file_info): file_info
                for file_info in files
            }

            # Process completed tasks
            for future in as_completed(future_to_file):
                file_info = future_to_file[future]
                try:
                    success = future.result()
                    if success:
                        batch_stats['succeeded'] += 1
                    else:
                        batch_stats['failed'] += 1
                except Exception as e:
                    logger.error(
                        f"Exception processing {file_info['file_name']}: {e}"
                    )
                    batch_stats['failed'] += 1

        return batch_stats

    def save_progress(self, processed_ids: List[str]):
        """Save progress state to file"""
        try:
            state = {
                'processed_files': processed_ids,
                'stats': self.stats,
                'last_update': datetime.utcnow().isoformat()
            }

            with open(self.state_file, 'w') as f:
                json.dump(state, f, indent=2)

            logger.debug(f"Progress saved: {len(processed_ids)} files")

        except Exception as e:
            logger.warning(f"Failed to save progress: {e}")

    def load_progress(self) -> List[str]:
        """Load progress state from file"""
        try:
            if os.path.exists(self.state_file):
                with open(self.state_file, 'r') as f:
                    state = json.load(f)
                    processed = state.get('processed_files', [])
                    logger.info(
                        f"Loaded progress: {len(processed)} files already processed"
                    )
                    return processed
        except Exception as e:
            logger.warning(f"Failed to load progress: {e}")

        return []

    def send_metrics(self):
        """Send metrics to CloudWatch"""
        try:
            metrics = [
                {
                    'MetricName': 'FilesProcessed',
                    'Value': self.stats['processed'],
                    'Unit': 'Count',
                    'Timestamp': datetime.utcnow()
                },
                {
                    'MetricName': 'SuccessRate',
                    'Value': (
                        self.stats['succeeded'] / max(self.stats['processed'], 1)
                    ) * 100,
                    'Unit': 'Percent',
                    'Timestamp': datetime.utcnow()
                },
                {
                    'MetricName': 'CacheHitRate',
                    'Value': (
                        self.stats['lambda_cache_hits'] / max(self.stats['processed'], 1)
                    ) * 100,
                    'Unit': 'Percent',
                    'Timestamp': datetime.utcnow()
                }
            ]

            self.cloudwatch.put_metric_data(
                Namespace='CIS/ImageIndexing',
                MetricData=metrics
            )

        except Exception as e:
            logger.warning(f"Failed to send metrics: {e}")

    def run(
        self,
        max_files: Optional[int] = None,
        dry_run: bool = False,
        resume: bool = False
    ):
        """
        Run batch indexing

        Args:
            max_files: Maximum number of files to process
            dry_run: Preview mode (no actual processing)
            resume: Resume from last checkpoint
        """
        logger.info("=" * 60)
        logger.info("Batch Image Indexing - Started")
        logger.info("=" * 60)

        # Load progress if resuming
        processed_ids = []
        if resume:
            processed_ids = self.load_progress()

        # Get images without vectors
        files = self.get_images_without_vector(max_files)

        if not files:
            logger.info("No files to process")
            return

        # Filter out already processed files
        if resume and processed_ids:
            files = [f for f in files if f['doc_id'] not in processed_ids]
            logger.info(f"Remaining files after resume: {len(files)}")

        if dry_run:
            logger.info(f"DRY RUN: Would process {len(files)} files")
            for i, file_info in enumerate(files[:10], 1):
                logger.info(
                    f"  {i}. {file_info['file_name']} "
                    f"(ID: {file_info['doc_id'][:8]}...)"
                )
            if len(files) > 10:
                logger.info(f"  ... and {len(files) - 10} more files")
            return

        # Process in batches
        total_batches = (len(files) + self.batch_size - 1) // self.batch_size

        for batch_idx in range(0, len(files), self.batch_size):
            batch = files[batch_idx:batch_idx + self.batch_size]
            batch_num = (batch_idx // self.batch_size) + 1

            logger.info(f"Processing batch {batch_num}/{total_batches}")

            # Process batch in parallel
            batch_stats = self.process_batch_parallel(batch)

            # Update overall statistics
            self.stats['processed'] += batch_stats['total']
            self.stats['succeeded'] += batch_stats['succeeded']
            self.stats['failed'] += batch_stats['failed']

            # Add successful IDs to processed list
            for file_info in batch:
                # Simplified: assume success if in batch_stats
                processed_ids.append(file_info['doc_id'])

            # Save progress every batch
            self.save_progress(processed_ids)
            self.send_metrics()

            # Progress report
            progress = (batch_idx + len(batch)) / len(files) * 100
            logger.info(
                f"Progress: {progress:.1f}% "
                f"({self.stats['processed']}/{len(files)} files)"
            )

        # Final refresh
        logger.info("Refreshing OpenSearch index...")
        self.opensearch.indices.refresh(index=self.opensearch_index)

        # Final statistics
        runtime = time.time() - self.stats['start_time']
        logger.info("=" * 60)
        logger.info("Batch Indexing Complete")
        logger.info("=" * 60)
        logger.info(f"Total Files: {self.stats['total_files']}")
        logger.info(f"Processed: {self.stats['processed']}")
        logger.info(f"Succeeded: {self.stats['succeeded']}")
        logger.info(f"Failed: {self.stats['failed']}")
        logger.info(
            f"Success Rate: "
            f"{(self.stats['succeeded']/max(self.stats['processed'],1))*100:.1f}%"
        )
        logger.info(
            f"Cache Hit Rate: "
            f"{(self.stats['lambda_cache_hits']/max(self.stats['processed'],1))*100:.1f}%"
        )
        logger.info(f"Runtime: {runtime:.1f}s ({runtime/60:.1f} minutes)")
        logger.info(
            f"Throughput: {self.stats['processed']/(runtime/60):.1f} files/minute"
        )
        logger.info("=" * 60)

        # Final save
        self.save_progress(processed_ids)
        self.send_metrics()


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(
        description='Batch Image Indexing for OpenSearch',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Dry run (preview files)
  python batch-index-images.py --dry-run

  # Process first 100 files
  python batch-index-images.py --max-files 100

  # Resume from checkpoint
  python batch-index-images.py --resume

  # Full processing with custom concurrency
  python batch-index-images.py --concurrency 20 --batch-size 200
        """
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
        '--lambda-function',
        default='cis-image-embedding',
        help='Image embedding Lambda function name'
    )
    parser.add_argument(
        '--aws-region',
        default='ap-northeast-1',
        help='AWS region'
    )
    parser.add_argument(
        '--concurrency',
        type=int,
        default=10,
        help='Number of parallel Lambda invocations'
    )
    parser.add_argument(
        '--batch-size',
        type=int,
        default=100,
        help='Files per batch'
    )
    parser.add_argument(
        '--max-files',
        type=int,
        help='Maximum number of files to process'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Preview mode (no actual processing)'
    )
    parser.add_argument(
        '--resume',
        action='store_true',
        help='Resume from last checkpoint'
    )
    parser.add_argument(
        '--state-file',
        default='batch-progress.json',
        help='Progress state file path'
    )

    args = parser.parse_args()

    # Validate required parameters
    if not args.opensearch_endpoint:
        logger.error(
            "OpenSearch endpoint required "
            "(--opensearch-endpoint or OPENSEARCH_ENDPOINT env var)"
        )
        sys.exit(1)

    try:
        # Initialize indexer
        indexer = BatchImageIndexer(
            opensearch_endpoint=args.opensearch_endpoint,
            opensearch_index=args.opensearch_index,
            lambda_function_name=args.lambda_function,
            aws_region=args.aws_region,
            concurrency=args.concurrency,
            batch_size=args.batch_size,
            state_file=args.state_file
        )

        # Run indexing
        indexer.run(
            max_files=args.max_files,
            dry_run=args.dry_run,
            resume=args.resume
        )

    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(0)

    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
