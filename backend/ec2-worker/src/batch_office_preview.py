#!/usr/bin/env python3
"""
Batch Preview Generation Script for Office Files

This script processes existing Office files (.doc, .docx, .xls, .xlsx, .ppt, .pptx)
that are indexed in OpenSearch but do not have preview images generated yet.

Usage:
    python batch_office_preview.py [--dry-run] [--limit N] [--batch-size N]

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
import shutil
import tempfile
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
from office_converter import OfficeConverter

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
    conversion_failed: int = 0
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
            f"Conversion Failed: {self.conversion_failed}, "
            f"Success Rate: {self.success_rate():.1f}%, "
            f"Elapsed: {self.elapsed_time():.1f}s"
        )


class OfficePreviewBatchProcessor:
    """
    Batch processor for generating Office file previews.

    This processor:
    1. Queries OpenSearch for Office files without preview_images
    2. Downloads the original file from S3
    3. Converts to PDF using LibreOffice (via OfficeConverter)
    4. Generates preview images using PreviewGenerator
    5. Uploads previews to S3 thumbnail bucket
    6. Updates the OpenSearch document with preview_images array
    """

    OFFICE_EXTENSIONS = ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx']

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

        logger.info("Initializing Office Preview Batch Processor...")
        logger.info(f"  Dry Run: {dry_run}")
        logger.info(f"  Batch Size: {batch_size}")

        # Initialize clients
        self.s3_client = S3Client()
        self.opensearch_client = OpenSearchClient()

        # Initialize office converter
        self.office_converter = OfficeConverter()
        if not self.office_converter.is_available():
            logger.error("LibreOffice is not available. Cannot process Office files.")
            raise RuntimeError("LibreOffice is required but not available")

        libreoffice_version = self.office_converter.get_version()
        if libreoffice_version:
            logger.info(f"  LibreOffice: {libreoffice_version}")

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

        logger.info("Initialization complete")

    def query_office_files_without_previews(
        self,
        limit: Optional[int] = None,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """
        Query OpenSearch for Office files without preview images.

        Args:
            limit: Maximum number of results to return
            offset: Number of results to skip (for pagination)

        Returns:
            List of documents from OpenSearch
        """
        try:
            # Build the query for Office files without preview_images
            query = {
                "query": {
                    "bool": {
                        "must": [
                            {
                                "terms": {
                                    "file_extension": self.OFFICE_EXTENSIONS
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

            logger.info(f"Found {total_count} Office files without previews")
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

    def find_s3_key_for_file(self, file_path: str, file_name: str) -> Optional[str]:
        """
        Find the S3 key for the original Office file.

        The S3 key is typically the file path relative to the landing bucket.

        Args:
            file_path: Full file path from OpenSearch (may be S3 URI or path)
            file_name: File name

        Returns:
            S3 key if found, None otherwise
        """
        try:
            # Extract S3 key from file_path
            # Handle S3 URI format: s3://bucket-name/key/path/file.ext
            s3_key = file_path

            # Remove S3 URI prefix if present
            s3_prefix = f"s3://{config.s3.landing_bucket}/"
            if file_path.startswith(s3_prefix):
                s3_key = file_path[len(s3_prefix):]
            elif file_path.startswith("s3://"):
                # Handle other bucket prefixes - extract just the key part
                parts = file_path.replace("s3://", "").split("/", 1)
                if len(parts) > 1:
                    s3_key = parts[1]

            # Remove leading slashes
            s3_key = s3_key.lstrip('/')

            logger.debug(f"Extracted S3 key: {s3_key}")

            # Check if the file exists in S3
            metadata = self.s3_client.get_object_metadata(
                config.s3.landing_bucket,
                s3_key
            )

            if metadata:
                logger.debug(f"Found file in S3: {s3_key}")
                return s3_key

            # If not found, try searching in documents/ prefix
            logger.debug(f"File not found at {s3_key}, searching in documents/...")

            # Search by partial path matching
            # Extract the relative path after "documents/"
            if "documents/" in s3_key:
                doc_path = s3_key[s3_key.index("documents/"):]
                metadata = self.s3_client.get_object_metadata(
                    config.s3.landing_bucket,
                    doc_path
                )
                if metadata:
                    logger.debug(f"Found file at: {doc_path}")
                    return doc_path

            logger.warning(f"Could not find S3 key for file: {file_name}")
            return None

        except Exception as e:
            logger.error(f"Error finding S3 key for {file_name}: {e}")
            return None

    def download_and_convert_to_pdf(self, s3_key: str) -> Optional[str]:
        """
        Download Office file from S3 and convert to PDF.

        Args:
            s3_key: S3 key of the Office file

        Returns:
            Path to the generated PDF, or None on failure
        """
        temp_office_path = None
        temp_output_dir = None

        try:
            # Download Office file from S3
            logger.debug(f"Downloading Office file from S3: {s3_key}")
            temp_office_path = self.s3_client.download_file(
                config.s3.landing_bucket,
                s3_key
            )

            if not temp_office_path or not os.path.exists(temp_office_path):
                logger.error(f"Failed to download Office file: {s3_key}")
                return None

            file_size = os.path.getsize(temp_office_path)
            logger.debug(f"Downloaded Office file: {file_size} bytes")

            # Create temporary output directory for PDF
            temp_output_dir = tempfile.mkdtemp(prefix='office_preview_')

            # Convert Office file to PDF using LibreOffice
            logger.debug(f"Converting to PDF: {temp_office_path}")
            pdf_path = self.office_converter.convert_to_pdf(
                temp_office_path,
                output_dir=temp_output_dir,
                timeout=180  # 3 minutes timeout for large files
            )

            if not pdf_path or not os.path.exists(pdf_path):
                logger.error(f"Failed to convert Office file to PDF: {s3_key}")
                return None

            pdf_size = os.path.getsize(pdf_path)
            logger.info(f"Successfully converted to PDF: {pdf_size} bytes")

            return pdf_path

        except Exception as e:
            logger.error(f"Error converting Office file {s3_key}: {e}")
            return None

        finally:
            # Cleanup downloaded Office file
            if temp_office_path:
                self.s3_client.cleanup_temp_file(temp_office_path)

    def generate_previews_from_pdf(self, pdf_path: str) -> List[Dict[str, Any]]:
        """
        Generate preview images from PDF.

        Args:
            pdf_path: Path to the PDF file

        Returns:
            List of preview data dictionaries
        """
        try:
            logger.debug(f"Generating previews from PDF: {pdf_path}")
            previews = self.preview_generator._generate_from_pdf(Path(pdf_path))
            logger.info(f"Generated {len(previews)} preview pages from PDF")
            return previews

        except Exception as e:
            logger.error(f"Failed to generate previews from PDF {pdf_path}: {e}")
            return []

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

    def cleanup_temp_files(self, *paths):
        """
        Clean up temporary files and directories.

        Args:
            *paths: Paths to clean up
        """
        for path in paths:
            if path is None:
                continue
            try:
                if os.path.isdir(path):
                    shutil.rmtree(path, ignore_errors=True)
                elif os.path.isfile(path):
                    os.remove(path)
            except Exception as e:
                logger.warning(f"Failed to cleanup {path}: {e}")

    def process_single_file(self, document: Dict[str, Any]) -> bool:
        """
        Process a single Office file.

        Args:
            document: OpenSearch document

        Returns:
            True if processing was successful
        """
        file_name = document.get('file_name', 'unknown')
        file_path = document.get('file_path', '')
        file_id = document.get('file_id')
        doc_id = document.get('_id')
        file_extension = document.get('file_extension', '')

        logger.info(f"Processing: {file_name} (ext: {file_extension}, doc_id: {doc_id})")

        pdf_path = None
        temp_dir = None

        try:
            # Step 1: Find the S3 key for the original file
            s3_key = self.find_s3_key_for_file(file_path, file_name)

            if not s3_key:
                logger.warning(f"Could not find S3 key for: {file_name}")
                self.stats.skipped += 1
                return False

            logger.debug(f"Found S3 key: {s3_key}")

            # Step 2: Download and convert to PDF
            pdf_path = self.download_and_convert_to_pdf(s3_key)

            if not pdf_path:
                logger.warning(f"Failed to convert Office file to PDF: {file_name}")
                self.stats.conversion_failed += 1
                return False

            # Get the temp directory containing the PDF
            temp_dir = os.path.dirname(pdf_path)

            # Step 3: Generate previews from PDF
            previews = self.generate_previews_from_pdf(pdf_path)

            if not previews:
                logger.warning(f"No previews generated for: {file_name}")
                return False

            # Step 4: Upload previews to S3
            uploaded = self.upload_previews_to_s3(previews, file_id)

            if not uploaded:
                logger.error(f"Failed to upload previews for: {file_name}")
                return False

            # Step 5: Update OpenSearch document
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

        finally:
            # Cleanup temporary files
            self.cleanup_temp_files(pdf_path, temp_dir)

    def run(self, limit: Optional[int] = None) -> BatchStats:
        """
        Run the batch processing.

        Args:
            limit: Maximum number of files to process (None = all)

        Returns:
            BatchStats with processing results
        """
        logger.info("=" * 60)
        logger.info("Office Preview Batch Processing Started")
        logger.info(f"  Mode: {'DRY RUN' if self.dry_run else 'LIVE'}")
        logger.info(f"  Limit: {limit or 'None (all files)'}")
        logger.info(f"  Extensions: {', '.join(self.OFFICE_EXTENSIONS)}")
        logger.info("=" * 60)

        # Query for files to process
        documents = self.query_office_files_without_previews(limit=limit)
        self.stats.total_found = len(documents)

        if not documents:
            logger.info("No Office files without previews found")
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
        description="Batch generate previews for Office files in OpenSearch"
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
        processor = OfficePreviewBatchProcessor(
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
