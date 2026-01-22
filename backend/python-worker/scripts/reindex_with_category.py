#!/usr/bin/env python3
"""
OpenSearch Reindex Script with Category/NAS Server Field Extraction

This script reindexes documents from one OpenSearch index to another,
adding category, category_display, nas_server, and root_folder fields
extracted from the file_path.

Usage:
    python reindex_with_category.py --endpoint https://vpc-xxx.es.amazonaws.com \
        --source-index cis-files --dest-index cis-files-v2 \
        --batch-size 1000 --dry-run

Requirements:
    pip install opensearch-py requests-aws4auth boto3
"""

import argparse
import logging
import re
import sys
import time
from datetime import datetime
from typing import Dict, Any, Optional, Tuple

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
# Handles: documents/, processed/, docuworks-converted/ prefixes
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


def extract_metadata_from_path(file_path: str) -> Dict[str, str]:
    """
    Extract category, nas_server, and root_folder from file path.

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
        metadata['category'] = category
        metadata['category_display'] = CATEGORY_DISPLAY_MAP.get(category, category)
        metadata['nas_server'] = match.group(2)
        metadata['root_folder'] = match.group(3)
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


def get_index_mapping() -> Dict[str, Any]:
    """Return the index mapping with new fields."""
    return {
        "settings": {
            "index": {
                "number_of_shards": 2,
                "number_of_replicas": 1,
                "refresh_interval": "-1"  # Disable during bulk indexing
            },
            "analysis": {
                "analyzer": {
                    "japanese_analyzer": {
                        "type": "custom",
                        "tokenizer": "kuromoji_tokenizer",
                        "filter": ["kuromoji_baseform", "lowercase", "cjk_width"]
                    }
                }
            }
        },
        "mappings": {
            "properties": {
                "file_key": {"type": "keyword"},
                "file_name": {
                    "type": "text",
                    "analyzer": "japanese_analyzer",
                    "fields": {"keyword": {"type": "keyword"}}
                },
                "file_path": {
                    "type": "text",
                    "analyzer": "japanese_analyzer",
                    "fields": {"keyword": {"type": "keyword"}}
                },
                "file_extension": {"type": "keyword"},
                "file_type": {"type": "keyword"},
                "mime_type": {"type": "keyword"},
                "file_size": {"type": "long"},
                "extracted_text": {"type": "text", "analyzer": "japanese_analyzer"},
                "page_count": {"type": "integer"},
                "word_count": {"type": "integer"},
                "char_count": {"type": "integer"},
                "metadata": {"type": "object", "enabled": True},
                "processor_name": {"type": "keyword"},
                "processor_version": {"type": "keyword"},
                "processing_time_seconds": {"type": "float"},
                "processed_at": {"type": "date"},
                "indexed_at": {"type": "date"},
                "modified_at": {"type": "date"},
                "created_at": {"type": "date"},
                "ocr_confidence": {"type": "float"},
                "ocr_language": {"type": "keyword"},
                "bucket": {"type": "keyword"},
                "s3_url": {"type": "keyword"},
                "category": {"type": "keyword"},
                "category_display": {"type": "keyword"},
                "nas_server": {"type": "keyword"},
                "root_folder": {"type": "keyword"},
                "nas_path": {
                    "type": "text",
                    "fields": {"keyword": {"type": "keyword"}}
                },
                "thumbnail_url": {"type": "keyword"},
                "success": {"type": "boolean"},
                "error_message": {"type": "text"}
            }
        }
    }


def transform_document(doc: Dict[str, Any]) -> Dict[str, Any]:
    """
    Transform a document by adding category/nas_server fields.

    Args:
        doc: Original document

    Returns:
        Transformed document
    """
    source = doc.get('_source', {}).copy()
    file_path = source.get('file_path', '')

    # Extract metadata from file path
    extracted = extract_metadata_from_path(file_path)

    # Update source with extracted metadata (don't overwrite existing values)
    for key, value in extracted.items():
        if key not in source or not source[key]:
            source[key] = value

    return source


def reindex_documents(
    client: OpenSearch,
    source_index: str,
    dest_index: str,
    batch_size: int = 1000,
    dry_run: bool = False
) -> Tuple[int, int]:
    """
    Reindex documents with transformation.

    Args:
        client: OpenSearch client
        source_index: Source index name
        dest_index: Destination index name
        batch_size: Number of documents per batch
        dry_run: If True, only simulate

    Returns:
        Tuple of (success_count, error_count)
    """
    # Get total document count
    count_response = client.count(index=source_index)
    total_docs = count_response['count']
    logger.info(f"Total documents to process: {total_docs:,}")

    if dry_run:
        logger.info("DRY RUN MODE - No changes will be made")

    # Create destination index if it doesn't exist
    if not dry_run:
        if not client.indices.exists(index=dest_index):
            logger.info(f"Creating destination index: {dest_index}")
            client.indices.create(index=dest_index, body=get_index_mapping())
        else:
            logger.info(f"Destination index {dest_index} already exists")

    # Scroll through source documents
    success_count = 0
    error_count = 0
    processed_count = 0

    # Statistics for validation
    category_stats = {'road': 0, 'structure': 0, 'none': 0}
    server_stats = {}
    folder_stats = {}

    scroll_response = client.search(
        index=source_index,
        scroll='5m',
        size=batch_size,
        body={"query": {"match_all": {}}}
    )

    scroll_id = scroll_response['_scroll_id']
    hits = scroll_response['hits']['hits']

    start_time = time.time()

    while hits:
        batch_actions = []

        for doc in hits:
            transformed = transform_document(doc)

            # Update statistics
            category = transformed.get('category')
            if category:
                category_stats[category] = category_stats.get(category, 0) + 1
            else:
                category_stats['none'] += 1

            server = transformed.get('nas_server')
            if server:
                server_stats[server] = server_stats.get(server, 0) + 1

            folder = transformed.get('root_folder')
            if folder:
                folder_stats[folder] = folder_stats.get(folder, 0) + 1

            if not dry_run:
                action = {
                    '_index': dest_index,
                    '_id': doc['_id'],
                    '_source': transformed
                }
                batch_actions.append(action)

        processed_count += len(hits)

        # Bulk index
        if not dry_run and batch_actions:
            try:
                success, errors = helpers.bulk(
                    client,
                    batch_actions,
                    raise_on_error=False,
                    raise_on_exception=False
                )
                success_count += success
                if errors:
                    error_count += len(errors)
                    for error in errors[:5]:  # Log first 5 errors
                        logger.error(f"Bulk error: {error}")
            except Exception as e:
                logger.error(f"Bulk indexing failed: {e}")
                error_count += len(batch_actions)
        else:
            success_count += len(hits)

        # Progress logging
        elapsed = time.time() - start_time
        docs_per_sec = processed_count / elapsed if elapsed > 0 else 0
        eta_seconds = (total_docs - processed_count) / docs_per_sec if docs_per_sec > 0 else 0

        logger.info(
            f"Progress: {processed_count:,}/{total_docs:,} "
            f"({100*processed_count/total_docs:.1f}%) - "
            f"{docs_per_sec:.0f} docs/sec - "
            f"ETA: {eta_seconds/60:.1f} min"
        )

        # Get next batch
        scroll_response = client.scroll(scroll_id=scroll_id, scroll='5m')
        scroll_id = scroll_response['_scroll_id']
        hits = scroll_response['hits']['hits']

    # Clear scroll
    try:
        client.clear_scroll(scroll_id=scroll_id)
    except Exception:
        pass

    # Log statistics
    logger.info("=" * 60)
    logger.info("REINDEX COMPLETE")
    logger.info("=" * 60)
    logger.info(f"Total processed: {processed_count:,}")
    logger.info(f"Success: {success_count:,}")
    logger.info(f"Errors: {error_count:,}")
    logger.info(f"Duration: {(time.time() - start_time)/60:.1f} minutes")
    logger.info("")
    logger.info("Category Distribution:")
    for cat, count in sorted(category_stats.items()):
        logger.info(f"  {cat}: {count:,}")
    logger.info("")
    logger.info("NAS Server Distribution:")
    for server, count in sorted(server_stats.items()):
        logger.info(f"  {server}: {count:,}")
    logger.info("")
    logger.info(f"Root Folder Distribution (top 20 of {len(folder_stats)}):")
    for folder, count in sorted(folder_stats.items(), key=lambda x: -x[1])[:20]:
        logger.info(f"  {folder}: {count:,}")

    return success_count, error_count


def switch_alias(
    client: OpenSearch,
    alias_name: str,
    old_index: str,
    new_index: str
) -> bool:
    """
    Atomically switch alias from old index to new index.

    Args:
        client: OpenSearch client
        alias_name: Alias name
        old_index: Old index name
        new_index: New index name

    Returns:
        True if successful
    """
    try:
        actions = {"actions": []}

        # Check if alias exists on old index
        if client.indices.exists_alias(index=old_index, name=alias_name):
            actions["actions"].append(
                {"remove": {"index": old_index, "alias": alias_name}}
            )

        # Add alias to new index
        actions["actions"].append(
            {"add": {"index": new_index, "alias": alias_name}}
        )

        client.indices.update_aliases(body=actions)
        logger.info(f"Successfully switched alias '{alias_name}' to '{new_index}'")
        return True

    except Exception as e:
        logger.error(f"Failed to switch alias: {e}")
        return False


def finalize_index(client: OpenSearch, index_name: str):
    """
    Finalize index after reindexing (enable refresh, optimize).

    Args:
        client: OpenSearch client
        index_name: Index name
    """
    try:
        # Enable refresh
        client.indices.put_settings(
            index=index_name,
            body={"index": {"refresh_interval": "5s"}}
        )
        logger.info(f"Enabled refresh interval for {index_name}")

        # Refresh to make all documents searchable
        client.indices.refresh(index=index_name)
        logger.info(f"Refreshed index {index_name}")

    except Exception as e:
        logger.error(f"Failed to finalize index: {e}")


def main():
    parser = argparse.ArgumentParser(
        description='Reindex OpenSearch documents with category/nas_server extraction'
    )
    parser.add_argument('--endpoint', required=True, help='OpenSearch endpoint URL')
    parser.add_argument('--source-index', required=True, help='Source index name')
    parser.add_argument('--dest-index', required=True, help='Destination index name')
    parser.add_argument('--region', default='ap-northeast-1', help='AWS region')
    parser.add_argument('--batch-size', type=int, default=1000, help='Batch size')
    parser.add_argument('--dry-run', action='store_true', help='Dry run mode')
    parser.add_argument('--alias', help='Alias name to switch after reindex')
    parser.add_argument('--skip-finalize', action='store_true', help='Skip finalization')

    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("OpenSearch Reindex with Category/NAS Server Extraction")
    logger.info("=" * 60)
    logger.info(f"Endpoint: {args.endpoint[:50]}...")
    logger.info(f"Source Index: {args.source_index}")
    logger.info(f"Destination Index: {args.dest_index}")
    logger.info(f"Batch Size: {args.batch_size}")
    logger.info(f"Dry Run: {args.dry_run}")
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

    # Reindex
    success, errors = reindex_documents(
        client,
        args.source_index,
        args.dest_index,
        args.batch_size,
        args.dry_run
    )

    if not args.dry_run and not args.skip_finalize:
        # Finalize index
        finalize_index(client, args.dest_index)

        # Switch alias if specified
        if args.alias:
            switch_alias(client, args.alias, args.source_index, args.dest_index)

    # Exit with error if there were failures
    if errors > 0:
        logger.warning(f"Completed with {errors} errors")
        sys.exit(1)

    logger.info("Reindex completed successfully!")


if __name__ == '__main__':
    main()
