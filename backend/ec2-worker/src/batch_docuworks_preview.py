#!/usr/bin/env python3
"""
Batch Preview Generation Script for DocuWorks Files

This script processes existing DocuWorks files (.xdw, .xbd) that are indexed
in OpenSearch but do not have preview images generated yet.

Usage:
    python batch_docuworks_preview.py [--dry-run] [--limit N] [--batch-size N]

Options:
    --dry-run       Show what would be processed without making changes
    --limit N       Limit processing to N files (default: all)
    --batch-size N  Process N files per batch (default: 50)
    --verbose       Enable verbose logging
"""

import argparse
import logging
import sys
import os
import io
import time
import hashlib
import boto3
from datetime import datetime
from typing import Dict, List, Optional, Any
from pathlib import Path
from dataclasses import dataclass

# Add src directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import config
from s3_client import S3Client
from opensearch_client import OpenSearchClient
from preview_generator import PreviewGenerator, PreviewConfig

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@dataclass
class BatchStats:
    """Processing statistics"""
    total_found: int = 0
    processed: int = 0
    success: int = 0
    failed: int = 0
    skipped: int = 0
    no_pdf: int = 0
    start_time: float = 0.0

    def elapsed_time(self) -> float:
        return time.time() - self.start_time

    def success_rate(self) -> float:
        if self.processed == 0:
            return 0.0
        return (self.success / self.processed) * 100

    def __str__(self) -> str:
        return (
            f"Total Found: {self.total_found}, "
            f"Processed: {self.processed}, "
            f"Success: {self.success}, "
            f"Failed: {self.failed}, "
            f"Skipped: {self.skipped}, "
            f"No PDF: {self.no_pdf}, "
            f"Success Rate: {self.success_rate():.1f}%, "
            f"Elapsed: {self.elapsed_time():.1f}s"
        )


class DocuWorksPreviewBatchProcessor:
    """
    Batch processor for generating DocuWorks file previews.

    This processor:
    1. Queries OpenSearch for DocuWorks files without preview_images
    2. Finds the converted PDF in S3's docuworks-converted/ folder
    3. Generates preview images using the existing PreviewGenerator
    4. Uploads previews to S3 thumbnail bucket
    5. Updates the OpenSearch document with preview_images array
    """

    DOCUWORKS_EXTENSIONS = ['.xdw', '.xbd']
    CONVERTED_PDF_PREFIX = 'docuworks-converted/'

    def __init__(
        self,
        dry_run: bool = False,
        batch_size: int = 50,
        verbose: bool = False
    ):
        """
        Initialize the batch processor.

        Args:
            dry_run: If True, only log what would be done without making changes
            batch_size: Number of files to process per batch
            verbose: Enable verbose logging
        """
        self.dry_run = dry_run
        self.batch_size = batch_size
        self.verbose = verbose

        if verbose:
            logging.getLogger().setLevel(logging.DEBUG)

        logger.info("Initializing DocuWorks Preview Batch Processor...")
        logger.info(f"  Dry Run: {dry_run}")
        logger.info(f"  Batch Size: {batch_size}")

        # Initialize clients
        self.s3_client = S3Client()
        self.opensearch_client = OpenSearchClient()

        # Initialize preview generator with default config
        preview_config = PreviewConfig(
            dpi=config.preview.dpi,
            max_width=config.preview.max_width,
            max_height=config.preview.max_height,
            quality=config.preview.quality,
            max_pages=config.preview.max_pages
        )
        self.preview_generator = PreviewGenerator(preview_config)

        # Statistics
        self.stats = BatchStats(start_time=time.time())

        # Cache for converted PDFs in S3 (base_filename -> s3_key mapping)
        self._pdf_cache: Optional[Dict[str, str]] = None

        logger.info("Initialization complete")

    def query_docuworks_without_previews(
        self,
        limit: Optional[int] = None,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """
        Query OpenSearch for DocuWorks files without preview images.

        Args:
            limit: Maximum number of results to return
            offset: Number of results to skip (for pagination)

        Returns:
            List of documents from OpenSearch
        """
        try:
            # Build the query for DocuWorks files without preview_images
            # Using bool query with must_not to find missing or empty preview_images
            query = {
                "query": {
                    "bool": {
                        "must": [
                            {
                                "terms": {
                                    "file_extension": self.DOCUWORKS_EXTENSIONS
                                }
                            }
                        ],
                        "must_not": [
                            {
                                "exists": {
                                    "field": "preview_images"
                                }
                            }
                        ]
                    }
                },
                "size": limit or 10000,
                "from": offset,
                "sort": [
                    {"indexed_at": {"order": "asc"}}
                ],
                "_source": [
                    "file_id", "file_name", "file_path", "file_extension",
                    "preview_images", "thumbnail_url", "_id"
                ]
            }

            logger.debug(f"Executing OpenSearch query: {query}")

            response = self.opensearch_client.client.search(
                index=self.opensearch_client.index_name,
                body=query
            )

            hits = response.get('hits', {}).get('hits', [])
            total = response.get('hits', {}).get('total', {})

            if isinstance(total, dict):
                total_count = total.get('value', 0)
            else:
                total_count = total

            logger.info(f"Found {total_count} DocuWorks files without previews")
            logger.info(f"Retrieved {len(hits)} documents in this batch")

            # Extract documents
            documents = []
            for hit in hits:
                doc = hit['_source']
                doc['_id'] = hit['_id']
                documents.append(doc)

            return documents

        except Exception as e:
            logger.error(f"Failed to query OpenSearch: {e}")
            return []

    def _build_pdf_cache(self) -> Dict[str, str]:
        """
        Build a cache of all converted PDFs in S3.

        This fetches all objects from docuworks-converted/ and builds a mapping
        from base filename to S3 key for efficient lookups.

        Returns:
            Dictionary mapping base filenames to S3 keys
        """
        logger.info("Building PDF cache from S3...")
        pdf_cache: Dict[str, str] = {}

        try:
            # Use paginator to get all objects (beyond 1000 limit)
            s3 = boto3.client('s3', **config.get_boto3_config())
            paginator = s3.get_paginator('list_objects_v2')

            page_iterator = paginator.paginate(
                Bucket=config.s3.landing_bucket,
                Prefix=self.CONVERTED_PDF_PREFIX
            )

            total_objects = 0
            pdf_count = 0

            for page in page_iterator:
                if 'Contents' not in page:
                    continue

                for obj in page['Contents']:
                    total_objects += 1
                    key = obj['Key']

                    if key.endswith('.pdf'):
                        pdf_count += 1
                        # Extract the filename from the key
                        # e.g., "docuworks-converted/road/.../200428_ts-server5_filename.pdf"
                        filename = Path(key).stem  # "200428_ts-server5_filename"

                        # Store the full key, using filename as part of the lookup
                        # We'll search for base_filename in this filename during lookup
                        pdf_cache[filename] = key

            logger.info(f"PDF cache built: {pdf_count} PDFs found (scanned {total_objects} objects)")
            return pdf_cache

        except Exception as e:
            logger.error(f"Failed to build PDF cache: {e}")
            return {}

    def find_converted_pdf(self, base_filename: str) -> Optional[str]:
        """
        Find the converted PDF in S3's docuworks-converted/ folder.

        Uses a cached lookup for efficient batch processing.
        The PDF filename pattern is: timestamp_server_originalfilename.pdf

        Args:
            base_filename: The base filename (without extension)

        Returns:
            S3 key of the converted PDF, or None if not found
        """
        # Build cache on first call
        if self._pdf_cache is None:
            self._pdf_cache = self._build_pdf_cache()

        # Search for base_filename in cached PDF filenames
        for pdf_filename, s3_key in self._pdf_cache.items():
            if base_filename in pdf_filename:
                logger.debug(f"Found matching PDF: {s3_key} for {base_filename}")
                return s3_key

        logger.debug(f"No converted PDF found for {base_filename}")
        return None

    def generate_previews_from_pdf(
        self,
        pdf_s3_key: str
    ) -> List[Dict[str, Any]]:
        """
        Download PDF from S3 and generate preview images.

        Args:
            pdf_s3_key: S3 key of the PDF file

        Returns:
            List of preview data dictionaries
        """
        temp_pdf_path = None

        try:
            # Download PDF from S3
            logger.debug(f"Downloading PDF from S3: {pdf_s3_key}")
            temp_pdf_path = self.s3_client.download_file(
                config.s3.landing_bucket,
                pdf_s3_key
            )

            if not temp_pdf_path or not os.path.exists(temp_pdf_path):
                logger.error(f"Failed to download PDF: {pdf_s3_key}")
                return []

            # Generate previews using existing method
            logger.debug(f"Generating previews from: {temp_pdf_path}")
            previews = self.preview_generator._generate_from_pdf(Path(temp_pdf_path))

            logger.info(f"Generated {len(previews)} preview pages from PDF")
            return previews

        except Exception as e:
            logger.error(f"Failed to generate previews from PDF {pdf_s3_key}: {e}")
            return []

        finally:
            # Cleanup temporary file
            if temp_pdf_path:
                self.s3_client.cleanup_temp_file(temp_pdf_path)

    def upload_previews_to_s3(
        self,
        previews: List[Dict[str, Any]],
        file_id: str
    ) -> List[Dict[str, Any]]:
        """
        Upload preview images to S3 thumbnail bucket.

        Args:
            previews: List of preview data from generate_previews_from_pdf
            file_id: Unique file identifier for S3 path

        Returns:
            List of uploaded preview info with S3 keys
        """
        if self.dry_run:
            logger.info(f"[DRY RUN] Would upload {len(previews)} previews for file_id: {file_id}")
            return [
                {
                    "page": p['page'],
                    "s3_key": f"previews/{file_id}/page_{p['page']}.jpg",
                    "width": p['width'],
                    "height": p['height'],
                    "size": p['size']
                }
                for p in previews
            ]

        uploaded = []

        for preview in previews:
            try:
                preview_key = f"previews/{file_id}/page_{preview['page']}.jpg"

                # Create BytesIO from preview data
                preview_io = io.BytesIO(preview['data'])

                # Upload to S3
                preview_url = self.s3_client.upload_fileobj(
                    preview_io,
                    config.s3.thumbnail_bucket,
                    preview_key,
                    content_type='image/jpeg'
                )

                if preview_url:
                    uploaded.append({
                        "page": preview['page'],
                        "s3_key": preview_key,
                        "width": preview['width'],
                        "height": preview['height'],
                        "size": preview['size']
                    })
                    logger.debug(f"Uploaded preview page {preview['page']} to {preview_key}")
                else:
                    logger.warning(f"Failed to upload preview page {preview['page']}")

            except Exception as e:
                logger.error(f"Failed to upload preview page {preview['page']}: {e}")

        logger.info(f"Uploaded {len(uploaded)}/{len(previews)} preview images")
        return uploaded

    def update_opensearch_document(
        self,
        doc_id: str,
        preview_images: List[Dict[str, Any]]
    ) -> bool:
        """
        Update the OpenSearch document with preview_images array.

        Args:
            doc_id: OpenSearch document ID
            preview_images: List of preview image info

        Returns:
            True if update was successful
        """
        if self.dry_run:
            logger.info(f"[DRY RUN] Would update document {doc_id} with {len(preview_images)} preview images")
            return True

        try:
            updates = {
                "preview_images": preview_images,
                "total_pages": len(preview_images),
                "preview_generated_at": datetime.utcnow().isoformat()
            }

            success = self.opensearch_client.update_document(doc_id, updates)

            if success:
                logger.debug(f"Updated OpenSearch document: {doc_id}")
            else:
                logger.error(f"Failed to update OpenSearch document: {doc_id}")

            return success

        except Exception as e:
            logger.error(f"Failed to update OpenSearch document {doc_id}: {e}")
            return False

    def process_single_file(self, document: Dict[str, Any]) -> bool:
        """
        Process a single DocuWorks file.

        Args:
            document: OpenSearch document

        Returns:
            True if processing was successful
        """
        file_name = document.get('file_name', 'unknown')
        file_id = document.get('file_id')
        doc_id = document.get('_id')

        logger.info(f"Processing: {file_name} (doc_id: {doc_id})")

        try:
            # Extract base filename (without extension)
            base_filename = Path(file_name).stem

            # Step 1: Find converted PDF in S3
            pdf_key = self.find_converted_pdf(base_filename)

            if not pdf_key:
                logger.warning(f"No converted PDF found for: {file_name}")
                self.stats.no_pdf += 1
                return False

            logger.info(f"Found converted PDF: {pdf_key}")

            # Step 2: Generate previews from PDF
            previews = self.generate_previews_from_pdf(pdf_key)

            if not previews:
                logger.warning(f"No previews generated for: {file_name}")
                return False

            # Step 3: Upload previews to S3
            uploaded = self.upload_previews_to_s3(previews, file_id)

            if not uploaded:
                logger.error(f"Failed to upload previews for: {file_name}")
                return False

            # Step 4: Update OpenSearch document
            success = self.update_opensearch_document(doc_id, uploaded)

            if success:
                logger.info(f"Successfully processed: {file_name} ({len(uploaded)} pages)")
                return True
            else:
                logger.error(f"Failed to update document for: {file_name}")
                return False

        except Exception as e:
            logger.error(f"Error processing {file_name}: {e}")
            return False

    def run(self, limit: Optional[int] = None) -> BatchStats:
        """
        Run the batch processing.

        Args:
            limit: Maximum number of files to process (None = all)

        Returns:
            BatchStats with processing results
        """
        logger.info("=" * 60)
        logger.info("DocuWorks Preview Batch Processing Started")
        logger.info(f"  Mode: {'DRY RUN' if self.dry_run else 'LIVE'}")
        logger.info(f"  Limit: {limit or 'None (all files)'}")
        logger.info("=" * 60)

        # Query for files to process
        documents = self.query_docuworks_without_previews(limit=limit)
        self.stats.total_found = len(documents)

        if not documents:
            logger.info("No DocuWorks files without previews found")
            return self.stats

        logger.info(f"Processing {len(documents)} files...")

        for i, doc in enumerate(documents, 1):
            file_name = doc.get('file_name', 'unknown')
            logger.info(f"[{i}/{len(documents)}] Processing: {file_name}")

            try:
                success = self.process_single_file(doc)
                self.stats.processed += 1

                if success:
                    self.stats.success += 1
                else:
                    self.stats.failed += 1

            except Exception as e:
                logger.error(f"Failed to process {file_name}: {e}")
                self.stats.processed += 1
                self.stats.failed += 1

            # Progress logging every 10 files
            if i % 10 == 0:
                logger.info(f"Progress: {self.stats}")

        # Final summary
        logger.info("=" * 60)
        logger.info("Batch Processing Complete")
        logger.info(f"  {self.stats}")
        logger.info("=" * 60)

        return self.stats


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Batch generate previews for DocuWorks files in OpenSearch"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be processed without making changes"
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit processing to N files (default: all)"
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=50,
        help="Process N files per batch (default: 50)"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose logging"
    )

    args = parser.parse_args()

    try:
        # Validate configuration
        if not config.validate():
            logger.error("Configuration validation failed")
            sys.exit(1)

        # Initialize and run processor
        processor = DocuWorksPreviewBatchProcessor(
            dry_run=args.dry_run,
            batch_size=args.batch_size,
            verbose=args.verbose
        )

        stats = processor.run(limit=args.limit)

        # Exit with error code if there were failures
        if stats.failed > 0 and stats.success == 0:
            sys.exit(1)

        sys.exit(0)

    except KeyboardInterrupt:
        logger.info("Processing interrupted by user")
        sys.exit(130)

    except Exception as e:
        logger.error(f"Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
