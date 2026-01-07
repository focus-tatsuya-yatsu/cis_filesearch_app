#!/usr/bin/env python3
"""
DocuWorks Preview Status Check Script

This script checks the status of DocuWorks files in OpenSearch and S3,
providing information about how many files have previews and how many
converted PDFs are available.

Usage:
    python check_docuworks_status.py [--details] [--check-s3]
"""

import argparse
import logging
import sys
import os
from collections import defaultdict
from typing import Dict, List, Any

# Add src directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import config
from s3_client import S3Client
from opensearch_client import OpenSearchClient

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class DocuWorksStatusChecker:
    """Check the status of DocuWorks files and their previews."""

    DOCUWORKS_EXTENSIONS = ['.xdw', '.xbd']
    CONVERTED_PDF_PREFIX = 'docuworks-converted/'

    def __init__(self):
        """Initialize the status checker."""
        self.s3_client = S3Client()
        self.opensearch_client = OpenSearchClient()

    def get_opensearch_stats(self) -> Dict[str, Any]:
        """
        Get statistics about DocuWorks files in OpenSearch.

        Returns:
            Dictionary with statistics
        """
        try:
            # Total DocuWorks files
            total_query = {
                "query": {
                    "terms": {
                        "file_extension": self.DOCUWORKS_EXTENSIONS
                    }
                },
                "size": 0
            }

            total_response = self.opensearch_client.client.search(
                index=self.opensearch_client.index_name,
                body=total_query
            )

            total_count = total_response['hits']['total']
            if isinstance(total_count, dict):
                total_count = total_count.get('value', 0)

            # DocuWorks files with preview_images
            with_previews_query = {
                "query": {
                    "bool": {
                        "must": [
                            {"terms": {"file_extension": self.DOCUWORKS_EXTENSIONS}},
                            {"exists": {"field": "preview_images"}}
                        ]
                    }
                },
                "size": 0
            }

            with_previews_response = self.opensearch_client.client.search(
                index=self.opensearch_client.index_name,
                body=with_previews_query
            )

            with_previews_count = with_previews_response['hits']['total']
            if isinstance(with_previews_count, dict):
                with_previews_count = with_previews_count.get('value', 0)

            # DocuWorks files without preview_images
            without_previews = total_count - with_previews_count

            # Breakdown by extension
            extension_stats = {}
            for ext in self.DOCUWORKS_EXTENSIONS:
                ext_query = {
                    "query": {
                        "term": {"file_extension": ext}
                    },
                    "size": 0
                }
                ext_response = self.opensearch_client.client.search(
                    index=self.opensearch_client.index_name,
                    body=ext_query
                )
                ext_count = ext_response['hits']['total']
                if isinstance(ext_count, dict):
                    ext_count = ext_count.get('value', 0)
                extension_stats[ext] = ext_count

            return {
                'total': total_count,
                'with_previews': with_previews_count,
                'without_previews': without_previews,
                'by_extension': extension_stats,
                'completion_rate': (with_previews_count / total_count * 100) if total_count > 0 else 0
            }

        except Exception as e:
            logger.error(f"Failed to get OpenSearch stats: {e}")
            return {}

    def get_s3_converted_pdf_count(self) -> Dict[str, Any]:
        """
        Count converted PDFs in S3.

        Returns:
            Dictionary with S3 statistics
        """
        try:
            objects = self.s3_client.list_objects(
                config.s3.landing_bucket,
                prefix=self.CONVERTED_PDF_PREFIX,
                max_keys=10000
            )

            pdf_count = 0
            total_size = 0

            for obj in objects:
                if obj['Key'].endswith('.pdf'):
                    pdf_count += 1
                    total_size += obj['Size']

            return {
                'converted_pdfs': pdf_count,
                'total_size_mb': total_size / (1024 * 1024),
                'prefix': self.CONVERTED_PDF_PREFIX
            }

        except Exception as e:
            logger.error(f"Failed to get S3 stats: {e}")
            return {}

    def get_sample_files_without_previews(
        self,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Get a sample of DocuWorks files without previews.

        Args:
            limit: Number of sample files to return

        Returns:
            List of sample documents
        """
        try:
            query = {
                "query": {
                    "bool": {
                        "must": [
                            {"terms": {"file_extension": self.DOCUWORKS_EXTENSIONS}}
                        ],
                        "must_not": [
                            {"exists": {"field": "preview_images"}}
                        ]
                    }
                },
                "size": limit,
                "_source": ["file_name", "file_path", "file_extension", "file_size", "indexed_at"]
            }

            response = self.opensearch_client.client.search(
                index=self.opensearch_client.index_name,
                body=query
            )

            return [hit['_source'] for hit in response['hits']['hits']]

        except Exception as e:
            logger.error(f"Failed to get sample files: {e}")
            return []

    def check_pdf_availability_for_samples(
        self,
        samples: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Check if converted PDFs are available for sample files.

        Args:
            samples: List of sample documents

        Returns:
            Statistics about PDF availability
        """
        try:
            # Get all PDFs in docuworks-converted/
            objects = self.s3_client.list_objects(
                config.s3.landing_bucket,
                prefix=self.CONVERTED_PDF_PREFIX,
                max_keys=5000
            )

            # Build a set of base filenames in S3
            s3_pdf_basenames = set()
            for obj in objects:
                if obj['Key'].endswith('.pdf'):
                    # Extract the filename part after the last underscore
                    # e.g., "200428_ts-server5_filename.pdf" -> "filename"
                    key = obj['Key']
                    filename = os.path.basename(key)
                    s3_pdf_basenames.add(filename)

            # Check each sample
            found = 0
            not_found = 0
            found_files = []
            not_found_files = []

            for sample in samples:
                file_name = sample.get('file_name', '')
                base_name = os.path.splitext(file_name)[0]

                # Check if any PDF contains this base name
                pdf_found = False
                for pdf_name in s3_pdf_basenames:
                    if base_name in pdf_name:
                        pdf_found = True
                        break

                if pdf_found:
                    found += 1
                    found_files.append(file_name)
                else:
                    not_found += 1
                    not_found_files.append(file_name)

            return {
                'checked': len(samples),
                'pdf_found': found,
                'pdf_not_found': not_found,
                'found_files': found_files[:5],
                'not_found_files': not_found_files[:5]
            }

        except Exception as e:
            logger.error(f"Failed to check PDF availability: {e}")
            return {}

    def print_report(self, check_s3: bool = False, show_details: bool = False):
        """
        Print a comprehensive status report.

        Args:
            check_s3: Whether to check S3 for converted PDFs
            show_details: Whether to show sample file details
        """
        print("\n" + "=" * 70)
        print("DocuWorks Preview Status Report")
        print("=" * 70)

        # OpenSearch statistics
        print("\n[OpenSearch Statistics]")
        os_stats = self.get_opensearch_stats()

        if os_stats:
            print(f"  Total DocuWorks files:     {os_stats['total']:,}")
            print(f"  With preview images:       {os_stats['with_previews']:,}")
            print(f"  Without preview images:    {os_stats['without_previews']:,}")
            print(f"  Completion rate:           {os_stats['completion_rate']:.1f}%")
            print("\n  By extension:")
            for ext, count in os_stats['by_extension'].items():
                print(f"    {ext}: {count:,}")
        else:
            print("  Failed to retrieve statistics")

        # S3 statistics
        if check_s3:
            print("\n[S3 Converted PDFs]")
            s3_stats = self.get_s3_converted_pdf_count()

            if s3_stats:
                print(f"  Location:          s3://{config.s3.landing_bucket}/{s3_stats['prefix']}")
                print(f"  Converted PDFs:    {s3_stats['converted_pdfs']:,}")
                print(f"  Total size:        {s3_stats['total_size_mb']:.2f} MB")
            else:
                print("  Failed to retrieve S3 statistics")

        # Sample files
        if show_details:
            print("\n[Sample Files Without Previews]")
            samples = self.get_sample_files_without_previews(limit=10)

            if samples:
                for i, sample in enumerate(samples, 1):
                    print(f"  {i}. {sample.get('file_name', 'unknown')}")
                    print(f"      Path: {sample.get('file_path', 'unknown')}")
                    print(f"      Size: {sample.get('file_size', 0):,} bytes")

                # Check PDF availability
                if check_s3:
                    print("\n[PDF Availability Check]")
                    availability = self.check_pdf_availability_for_samples(samples)

                    if availability:
                        print(f"  Checked: {availability['checked']} files")
                        print(f"  PDF found: {availability['pdf_found']}")
                        print(f"  PDF not found: {availability['pdf_not_found']}")

                        if availability['found_files']:
                            print("\n  Files with available PDFs:")
                            for f in availability['found_files']:
                                print(f"    - {f}")

                        if availability['not_found_files']:
                            print("\n  Files without available PDFs:")
                            for f in availability['not_found_files']:
                                print(f"    - {f}")
            else:
                print("  No sample files found or all files have previews")

        print("\n" + "=" * 70)
        print("Report generated at:", __import__('datetime').datetime.now().isoformat())
        print("=" * 70 + "\n")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Check DocuWorks preview generation status"
    )
    parser.add_argument(
        "--details",
        action="store_true",
        help="Show detailed information including sample files"
    )
    parser.add_argument(
        "--check-s3",
        action="store_true",
        help="Check S3 for converted PDFs"
    )

    args = parser.parse_args()

    try:
        checker = DocuWorksStatusChecker()
        checker.print_report(
            check_s3=args.check_s3,
            show_details=args.details
        )

    except Exception as e:
        logger.error(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
