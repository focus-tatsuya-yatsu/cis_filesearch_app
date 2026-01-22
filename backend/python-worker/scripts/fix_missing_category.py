#!/usr/bin/env python3
"""
Fix Missing Category Script for OpenSearch

This script updates documents in cis-files-v2 that are missing the category field
or have incorrect category based on nas_server.

Features:
    1. Fix documents missing category field (extract from file_path)
    2. Fix documents with wrong category based on nas_server mapping

Usage:
    # Count documents needing fixes
    python fix_missing_category.py --endpoint https://vpc-xxx.es.amazonaws.com --count-only

    # Fix missing category (dry-run)
    python fix_missing_category.py --endpoint https://vpc-xxx.es.amazonaws.com --dry-run

    # Fix wrong category based on nas_server (dry-run)
    python fix_missing_category.py --endpoint https://vpc-xxx.es.amazonaws.com --fix-wrong-category --dry-run

    # Fix both missing and wrong category
    python fix_missing_category.py --endpoint https://vpc-xxx.es.amazonaws.com --fix-wrong-category

Requirements:
    pip install opensearch-py requests-aws4auth boto3
"""

import argparse
import logging
import re
import sys
import time
from datetime import datetime
from typing import Dict, Any, Tuple

import boto3
from opensearchpy import OpenSearch, RequestsHttpConnection, helpers
from requests_aws4auth import AWS4Auth

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# File path pattern for extracting category/server information
FILE_PATH_PATTERN = re.compile(
    r'(?:documents|processed|docuworks-converted)/(road|structure)/(ts-server\d+)/([^/]+)/'
)

# Simple fallback pattern
SIMPLE_CATEGORY_PATTERN = re.compile(r'/(road|structure)/')

# Category display names
CATEGORY_DISPLAY_MAP = {
    'road': '道路',
    'structure': '構造'
}

# NAS server to category mapping
# ts-server3, ts-server5 -> road (道路)
# ts-server6, ts-server7 -> structure (構造)
NAS_SERVER_CATEGORY_MAP = {
    'ts-server3': 'road',
    'ts-server5': 'road',
    'ts-server6': 'structure',
    'ts-server7': 'structure'
}


def extract_metadata_from_path(file_path: str) -> Dict[str, str]:
    """
    Extract category, nas_server, root_folder, and nas_path from file path.

    Args:
        file_path: S3 file path

    Returns:
        Dictionary with extracted metadata
    """
    metadata = {}

    if not file_path:
        return metadata

    # Try main pattern first
    match = FILE_PATH_PATTERN.search(file_path)
    if match:
        category = match.group(1)
        nas_server = match.group(2)
        root_folder = match.group(3)

        metadata['category'] = category
        metadata['category_display'] = CATEGORY_DISPLAY_MAP.get(category, category)
        metadata['nas_server'] = nas_server
        metadata['root_folder'] = root_folder

        # Generate NAS path
        if nas_server in file_path:
            remaining = file_path.split(f'{nas_server}/', 1)[-1]
            windows_path = remaining.replace('/', '\\')
            metadata['nas_path'] = f"\\\\{nas_server}\\share\\{windows_path}"

        return metadata

    # Fallback: try simple category extraction
    simple_match = SIMPLE_CATEGORY_PATTERN.search(file_path)
    if simple_match:
        category = simple_match.group(1)
        metadata['category'] = category
        metadata['category_display'] = CATEGORY_DISPLAY_MAP.get(category, category)

    return metadata


def create_opensearch_client(endpoint: str, region: str = 'ap-northeast-1') -> OpenSearch:
    """Create OpenSearch client with AWS authentication."""
    credentials = boto3.Session().get_credentials()
    awsauth = AWS4Auth(
        credentials.access_key,
        credentials.secret_key,
        region,
        'es',
        session_token=credentials.token
    )

    # Extract host from endpoint
    host = endpoint.replace('https://', '').replace('http://', '').rstrip('/')

    client = OpenSearch(
        hosts=[{'host': host, 'port': 443}],
        http_auth=awsauth,
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection,
        timeout=60,
        max_retries=3,
        retry_on_timeout=True
    )

    return client


def count_documents_without_category(client: OpenSearch, index: str) -> int:
    """Count documents without category field."""
    result = client.count(
        index=index,
        body={
            "query": {
                "bool": {
                    "must_not": [
                        {"exists": {"field": "category"}}
                    ]
                }
            }
        }
    )
    return result['count']


def count_documents_with_category(client: OpenSearch, index: str) -> Dict[str, int]:
    """Count documents by category."""
    result = client.search(
        index=index,
        body={
            "size": 0,
            "aggs": {
                "categories": {
                    "terms": {
                        "field": "category",
                        "size": 10
                    }
                }
            }
        }
    )

    counts = {}
    for bucket in result['aggregations']['categories']['buckets']:
        counts[bucket['key']] = bucket['doc_count']

    return counts


def infer_category_from_server(nas_server: str) -> Dict[str, str]:
    """
    Infer correct category from nas_server field.

    Args:
        nas_server: NAS server name (e.g., 'ts-server6')

    Returns:
        Dictionary with category and category_display, or empty dict if unknown
    """
    if not nas_server:
        return {}

    category = NAS_SERVER_CATEGORY_MAP.get(nas_server)
    if category:
        return {
            'category': category,
            'category_display': CATEGORY_DISPLAY_MAP.get(category, category)
        }
    return {}


def count_documents_with_wrong_category(client: OpenSearch, index: str) -> Dict[str, int]:
    """
    Count documents where nas_server implies a different category.

    Returns:
        Dictionary with counts by error type
    """
    counts = {}

    # Count ts-server6/7 with wrong category (should be 'structure')
    result = client.count(
        index=index,
        body={
            "query": {
                "bool": {
                    "must": [
                        {"terms": {"nas_server": ["ts-server6", "ts-server7"]}},
                        {"term": {"category": "road"}}
                    ]
                }
            }
        }
    )
    counts['structure_servers_with_road'] = result['count']

    # Count ts-server3/5 with wrong category (should be 'road')
    result = client.count(
        index=index,
        body={
            "query": {
                "bool": {
                    "must": [
                        {"terms": {"nas_server": ["ts-server3", "ts-server5"]}},
                        {"term": {"category": "structure"}}
                    ]
                }
            }
        }
    )
    counts['road_servers_with_structure'] = result['count']

    counts['total'] = counts['structure_servers_with_road'] + counts['road_servers_with_structure']

    return counts


def fix_wrong_category(
    client: OpenSearch,
    index: str,
    batch_size: int = 500,
    dry_run: bool = False
) -> Tuple[int, int, int]:
    """
    Fix documents where category doesn't match nas_server.

    Args:
        client: OpenSearch client
        index: Index name
        batch_size: Number of documents per batch
        dry_run: If True, only simulate

    Returns:
        Tuple of (updated_count, skipped_count, error_count)
    """
    # Count documents to fix
    wrong_counts = count_documents_with_wrong_category(client, index)
    total_to_fix = wrong_counts['total']

    logger.info(f"Documents with wrong category: {total_to_fix:,}")
    logger.info(f"  - ts-server6/7 with 'road' (should be 'structure'): {wrong_counts['structure_servers_with_road']:,}")
    logger.info(f"  - ts-server3/5 with 'structure' (should be 'road'): {wrong_counts['road_servers_with_structure']:,}")

    if total_to_fix == 0:
        logger.info("No documents need category correction!")
        return 0, 0, 0

    if dry_run:
        logger.info("DRY RUN MODE - No changes will be made")

    # Statistics
    updated_count = 0
    skipped_count = 0
    error_count = 0
    processed_count = 0

    # Category correction stats
    correction_stats = {'road_to_structure': 0, 'structure_to_road': 0}

    # Query for documents with wrong category
    query = {
        "query": {
            "bool": {
                "should": [
                    # ts-server6/7 should be structure, not road
                    {
                        "bool": {
                            "must": [
                                {"terms": {"nas_server": ["ts-server6", "ts-server7"]}},
                                {"term": {"category": "road"}}
                            ]
                        }
                    },
                    # ts-server3/5 should be road, not structure
                    {
                        "bool": {
                            "must": [
                                {"terms": {"nas_server": ["ts-server3", "ts-server5"]}},
                                {"term": {"category": "structure"}}
                            ]
                        }
                    }
                ],
                "minimum_should_match": 1
            }
        },
        "_source": ["nas_server", "category", "file_name"]
    }

    # Scroll through documents
    scroll_response = client.search(
        index=index,
        scroll='10m',
        size=batch_size,
        body=query
    )

    scroll_id = scroll_response['_scroll_id']
    hits = scroll_response['hits']['hits']

    start_time = time.time()

    while hits:
        bulk_actions = []

        for hit in hits:
            doc_id = hit['_id']
            nas_server = hit['_source'].get('nas_server', '')
            old_category = hit['_source'].get('category', '')

            # Infer correct category from nas_server
            correct_metadata = infer_category_from_server(nas_server)

            if correct_metadata and correct_metadata.get('category') != old_category:
                # Track correction type
                if old_category == 'road' and correct_metadata['category'] == 'structure':
                    correction_stats['road_to_structure'] += 1
                elif old_category == 'structure' and correct_metadata['category'] == 'road':
                    correction_stats['structure_to_road'] += 1

                if not dry_run:
                    action = {
                        "_op_type": "update",
                        "_index": index,
                        "_id": doc_id,
                        "doc": correct_metadata
                    }
                    bulk_actions.append(action)

                updated_count += 1
            else:
                skipped_count += 1

        processed_count += len(hits)

        # Execute bulk update
        if bulk_actions and not dry_run:
            try:
                success, errors = helpers.bulk(
                    client,
                    bulk_actions,
                    raise_on_error=False,
                    raise_on_exception=False
                )
                if errors:
                    error_count += len(errors)
                    for err in errors[:3]:
                        logger.error(f"Bulk error: {err}")
            except Exception as e:
                logger.error(f"Bulk update failed: {e}")
                error_count += len(bulk_actions)

        # Progress logging
        elapsed = time.time() - start_time
        docs_per_sec = processed_count / elapsed if elapsed > 0 else 0
        eta_seconds = (total_to_fix - processed_count) / docs_per_sec if docs_per_sec > 0 else 0

        logger.info(
            f"Progress: {processed_count:,}/{total_to_fix:,} "
            f"({100*processed_count/total_to_fix:.1f}%) - "
            f"{docs_per_sec:.0f} docs/sec - "
            f"ETA: {eta_seconds/60:.1f} min"
        )

        # Get next batch
        scroll_response = client.scroll(scroll_id=scroll_id, scroll='10m')
        scroll_id = scroll_response['_scroll_id']
        hits = scroll_response['hits']['hits']

    # Clear scroll
    try:
        client.clear_scroll(scroll_id=scroll_id)
    except Exception:
        pass

    # Refresh index to make updates visible
    if not dry_run and updated_count > 0:
        logger.info("Refreshing index...")
        client.indices.refresh(index=index)

    # Log statistics
    logger.info("=" * 60)
    logger.info("WRONG CATEGORY FIX COMPLETE")
    logger.info("=" * 60)
    logger.info(f"Total processed: {processed_count:,}")
    logger.info(f"Updated: {updated_count:,}")
    logger.info(f"Skipped: {skipped_count:,}")
    logger.info(f"Errors: {error_count:,}")
    logger.info(f"Duration: {(time.time() - start_time)/60:.1f} minutes")
    logger.info("")
    logger.info("Corrections made:")
    logger.info(f"  road -> structure: {correction_stats['road_to_structure']:,}")
    logger.info(f"  structure -> road: {correction_stats['structure_to_road']:,}")

    return updated_count, skipped_count, error_count


def fix_missing_category(
    client: OpenSearch,
    index: str,
    batch_size: int = 500,
    dry_run: bool = False
) -> Tuple[int, int, int]:
    """
    Fix documents missing category field.

    Args:
        client: OpenSearch client
        index: Index name
        batch_size: Number of documents per batch
        dry_run: If True, only simulate

    Returns:
        Tuple of (updated_count, skipped_count, error_count)
    """
    # Count documents to fix
    total_to_fix = count_documents_without_category(client, index)
    logger.info(f"Documents without category: {total_to_fix:,}")

    if total_to_fix == 0:
        logger.info("No documents need fixing!")
        return 0, 0, 0

    if dry_run:
        logger.info("DRY RUN MODE - No changes will be made")

    # Statistics
    updated_count = 0
    skipped_count = 0
    error_count = 0
    processed_count = 0

    # Category distribution for logging
    category_stats = {'road': 0, 'structure': 0, 'none': 0}

    # Scroll through documents without category
    scroll_response = client.search(
        index=index,
        scroll='10m',
        size=batch_size,
        body={
            "query": {
                "bool": {
                    "must_not": [
                        {"exists": {"field": "category"}}
                    ]
                }
            },
            "_source": ["file_path", "file_name"]
        }
    )

    scroll_id = scroll_response['_scroll_id']
    hits = scroll_response['hits']['hits']

    start_time = time.time()

    while hits:
        bulk_actions = []

        for hit in hits:
            doc_id = hit['_id']
            file_path = hit['_source'].get('file_path', '')

            # Extract metadata from file_path
            metadata = extract_metadata_from_path(file_path)

            if metadata:
                # Update category stats
                category = metadata.get('category')
                if category:
                    category_stats[category] = category_stats.get(category, 0) + 1
                else:
                    category_stats['none'] += 1

                if not dry_run:
                    action = {
                        "_op_type": "update",
                        "_index": index,
                        "_id": doc_id,
                        "doc": metadata
                    }
                    bulk_actions.append(action)

                updated_count += 1
            else:
                skipped_count += 1
                category_stats['none'] += 1

        processed_count += len(hits)

        # Execute bulk update
        if bulk_actions and not dry_run:
            try:
                success, errors = helpers.bulk(
                    client,
                    bulk_actions,
                    raise_on_error=False,
                    raise_on_exception=False
                )
                if errors:
                    error_count += len(errors)
                    for err in errors[:3]:
                        logger.error(f"Bulk error: {err}")
            except Exception as e:
                logger.error(f"Bulk update failed: {e}")
                error_count += len(bulk_actions)

        # Progress logging
        elapsed = time.time() - start_time
        docs_per_sec = processed_count / elapsed if elapsed > 0 else 0
        eta_seconds = (total_to_fix - processed_count) / docs_per_sec if docs_per_sec > 0 else 0

        logger.info(
            f"Progress: {processed_count:,}/{total_to_fix:,} "
            f"({100*processed_count/total_to_fix:.1f}%) - "
            f"{docs_per_sec:.0f} docs/sec - "
            f"ETA: {eta_seconds/60:.1f} min"
        )

        # Get next batch
        scroll_response = client.scroll(scroll_id=scroll_id, scroll='10m')
        scroll_id = scroll_response['_scroll_id']
        hits = scroll_response['hits']['hits']

    # Clear scroll
    try:
        client.clear_scroll(scroll_id=scroll_id)
    except Exception:
        pass

    # Refresh index to make updates visible
    if not dry_run and updated_count > 0:
        logger.info("Refreshing index...")
        client.indices.refresh(index=index)

    # Log statistics
    logger.info("=" * 60)
    logger.info("FIX COMPLETE")
    logger.info("=" * 60)
    logger.info(f"Total processed: {processed_count:,}")
    logger.info(f"Updated: {updated_count:,}")
    logger.info(f"Skipped (no metadata extractable): {skipped_count:,}")
    logger.info(f"Errors: {error_count:,}")
    logger.info(f"Duration: {(time.time() - start_time)/60:.1f} minutes")
    logger.info("")
    logger.info("Category Distribution (of processed documents):")
    for cat, count in sorted(category_stats.items()):
        logger.info(f"  {cat}: {count:,}")

    return updated_count, skipped_count, error_count


def main():
    parser = argparse.ArgumentParser(
        description='Fix documents with missing or wrong category in OpenSearch'
    )
    parser.add_argument('--endpoint', required=True, help='OpenSearch endpoint URL')
    parser.add_argument('--index', default='cis-files-v2', help='Index name')
    parser.add_argument('--region', default='ap-northeast-1', help='AWS region')
    parser.add_argument('--batch-size', type=int, default=500, help='Batch size')
    parser.add_argument('--dry-run', action='store_true', help='Dry run mode')
    parser.add_argument('--count-only', action='store_true', help='Only count documents')
    parser.add_argument(
        '--fix-wrong-category',
        action='store_true',
        help='Fix documents with wrong category based on nas_server (ts-server6/7 should be structure)'
    )

    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("OpenSearch Category Fix Script")
    logger.info("=" * 60)
    logger.info(f"Endpoint: {args.endpoint[:50]}...")
    logger.info(f"Index: {args.index}")
    logger.info(f"Batch Size: {args.batch_size}")
    logger.info(f"Dry Run: {args.dry_run}")
    logger.info(f"Fix Wrong Category: {args.fix_wrong_category}")
    logger.info("=" * 60)

    # Create client
    client = create_opensearch_client(args.endpoint, args.region)

    # Verify connection
    try:
        info = client.info()
        logger.info(f"Connected to cluster: {info['cluster_name']}")
    except Exception as e:
        logger.error(f"Failed to connect to OpenSearch: {e}")
        sys.exit(1)

    # Count only mode
    if args.count_only:
        total = client.count(index=args.index)['count']
        without_category = count_documents_without_category(client, args.index)
        with_category = count_documents_with_category(client, args.index)
        wrong_category = count_documents_with_wrong_category(client, args.index)

        logger.info("")
        logger.info("Document Statistics:")
        logger.info(f"  Total documents: {total:,}")
        logger.info(f"  Without category: {without_category:,}")
        logger.info(f"  With category:")
        for cat, count in sorted(with_category.items()):
            logger.info(f"    {cat}: {count:,}")
        logger.info("")
        logger.info("  Documents with WRONG category (based on nas_server):")
        logger.info(f"    ts-server6/7 with 'road' (should be 'structure'): {wrong_category['structure_servers_with_road']:,}")
        logger.info(f"    ts-server3/5 with 'structure' (should be 'road'): {wrong_category['road_servers_with_structure']:,}")
        logger.info(f"    Total needing correction: {wrong_category['total']:,}")
        return

    total_errors = 0

    # Fix wrong category first if requested
    if args.fix_wrong_category:
        logger.info("")
        logger.info("=" * 60)
        logger.info("Phase 1: Fixing wrong categories based on nas_server")
        logger.info("=" * 60)
        updated, skipped, errors = fix_wrong_category(
            client,
            args.index,
            args.batch_size,
            args.dry_run
        )
        total_errors += errors

    # Fix missing category
    logger.info("")
    logger.info("=" * 60)
    logger.info("Phase 2: Fixing missing categories")
    logger.info("=" * 60)
    updated, skipped, errors = fix_missing_category(
        client,
        args.index,
        args.batch_size,
        args.dry_run
    )
    total_errors += errors

    # Verify fix
    if not args.dry_run:
        logger.info("")
        logger.info("=" * 60)
        logger.info("Verification:")
        logger.info("=" * 60)
        remaining = count_documents_without_category(client, args.index)
        logger.info(f"  Documents still without category: {remaining:,}")

        with_category = count_documents_with_category(client, args.index)
        logger.info(f"  Category distribution after fix:")
        for cat, count in sorted(with_category.items()):
            logger.info(f"    {cat}: {count:,}")

        if args.fix_wrong_category:
            wrong_category = count_documents_with_wrong_category(client, args.index)
            logger.info(f"  Documents still with wrong category: {wrong_category['total']:,}")

    if args.dry_run:
        logger.info("")
        logger.info("This was a DRY RUN - no changes were made")
        logger.info("Run without --dry-run to apply changes")

    # Exit with error if there were failures
    if total_errors > 0:
        logger.warning(f"Completed with {total_errors} errors")
        sys.exit(1)

    logger.info("Done!")


if __name__ == '__main__':
    main()
