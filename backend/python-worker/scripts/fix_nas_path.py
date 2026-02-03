#!/usr/bin/env python3
"""
Fix missing nas_path in OpenSearch documents.

This script:
1. Queries OpenSearch for documents with empty/missing nas_path
2. Generates nas_path from file_path (S3 key)
3. Updates the documents in OpenSearch

Usage:
    python fix_nas_path.py --dry-run  # Preview changes
    python fix_nas_path.py            # Apply changes
"""

import argparse
import json
import re
import sys
from typing import Optional, Dict, Any, List
import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
import urllib.request
import ssl

# Configuration
OPENSEARCH_ENDPOINT = 'https://vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com'
OPENSEARCH_INDEX = 'cis-files'
AWS_REGION = 'ap-northeast-1'
BATCH_SIZE = 100  # Documents per batch update


def get_aws_credentials():
    """Get AWS credentials from boto3 session."""
    session = boto3.Session()
    credentials = session.get_credentials()
    return credentials.get_frozen_credentials()


def signed_request(method: str, url: str, body: Optional[Dict] = None, headers: Optional[Dict] = None) -> Dict:
    """Make a signed request to OpenSearch."""
    credentials = get_aws_credentials()
    if headers is None:
        headers = {}
    headers['Content-Type'] = 'application/json'

    data = json.dumps(body).encode('utf-8') if body else None
    aws_request = AWSRequest(method=method, url=url, data=data, headers=headers)
    SigV4Auth(credentials, 'es', AWS_REGION).add_auth(aws_request)

    req = urllib.request.Request(url, data=data, headers=dict(aws_request.headers), method=method)

    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    try:
        with urllib.request.urlopen(req, context=ssl_context, timeout=60) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8') if e.fp else ''
        print(f"HTTP Error {e.code}: {e.reason}")
        print(f"Response body: {error_body}")
        raise


def generate_nas_path(file_path: str) -> Optional[str]:
    """
    Generate nas_path from file_path (S3 path).

    Examples:
    - s3://bucket/documents/road/ts-server3/R06_JOB/xxx/file.pdf
      → \\ts-server3\share\R06_JOB\xxx\file.pdf
    - documents/structure/ts-server6/H22_JOB/xxx/file.pdf
      → \\ts-server6\share\H22_JOB\xxx\file.pdf
    """
    if not file_path:
        return None

    # Normalize path
    normalized = file_path.replace('\\', '/')

    # Remove s3:// prefix and bucket name if present
    if normalized.startswith('s3://'):
        parts = normalized[5:].split('/', 1)
        if len(parts) > 1:
            normalized = parts[1]

    # Extract server name
    server_match = re.search(r'(ts-server\d+)', normalized)
    if not server_match:
        return None

    nas_server = server_match.group(1)

    # Get the path after server name
    parts = normalized.split(f'{nas_server}/')
    if len(parts) < 2:
        return None

    remaining = parts[1]

    # Convert to Windows path
    windows_path = remaining.replace('/', '\\')

    return f"\\\\{nas_server}\\share\\{windows_path}"


def find_documents_without_nas_path(scroll_id: Optional[str] = None) -> Dict:
    """Find documents with missing nas_path using scroll API."""
    url = f"{OPENSEARCH_ENDPOINT}/{OPENSEARCH_INDEX}/_search"

    if scroll_id:
        # Continue scrolling
        url = f"{OPENSEARCH_ENDPOINT}/_search/scroll"
        body = {
            "scroll": "5m",
            "scroll_id": scroll_id
        }
    else:
        # Initial search
        url = f"{OPENSEARCH_ENDPOINT}/{OPENSEARCH_INDEX}/_search?scroll=5m"
        body = {
            "query": {
                "bool": {
                    "must_not": [
                        {"exists": {"field": "nas_path"}}
                    ]
                }
            },
            "size": BATCH_SIZE,
            "_source": ["file_path", "file_name", "nas_server"]
        }

    return signed_request('POST', url, body)


def update_documents(updates: List[Dict]) -> Dict:
    """Bulk update documents in OpenSearch."""
    url = f"{OPENSEARCH_ENDPOINT}/_bulk"

    # Build bulk request body
    bulk_body = ""
    for update in updates:
        action = {"update": {"_index": OPENSEARCH_INDEX, "_id": update["_id"]}}
        doc = {"doc": {"nas_path": update["nas_path"]}}
        bulk_body += json.dumps(action) + "\n" + json.dumps(doc) + "\n"

    # Send bulk request
    credentials = get_aws_credentials()
    headers = {'Content-Type': 'application/x-ndjson'}

    data = bulk_body.encode('utf-8')
    aws_request = AWSRequest(method='POST', url=url, data=data, headers=headers)
    SigV4Auth(credentials, 'es', AWS_REGION).add_auth(aws_request)

    req = urllib.request.Request(url, data=data, headers=dict(aws_request.headers), method='POST')

    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    with urllib.request.urlopen(req, context=ssl_context, timeout=120) as response:
        return json.loads(response.read().decode('utf-8'))


def main():
    parser = argparse.ArgumentParser(description='Fix missing nas_path in OpenSearch')
    parser.add_argument('--dry-run', action='store_true', help='Preview changes without applying')
    parser.add_argument('--limit', type=int, default=0, help='Limit number of documents to process (0=no limit)')
    args = parser.parse_args()

    print(f"OpenSearch endpoint: {OPENSEARCH_ENDPOINT}")
    print(f"Index: {OPENSEARCH_INDEX}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("-" * 60)

    total_found = 0
    total_fixed = 0
    total_failed = 0
    scroll_id = None

    try:
        while True:
            # Find documents without nas_path
            response = find_documents_without_nas_path(scroll_id)

            scroll_id = response.get('_scroll_id')
            hits = response.get('hits', {}).get('hits', [])

            if not hits:
                break

            total_found += len(hits)

            # Generate nas_path for each document
            updates = []
            for hit in hits:
                doc_id = hit['_id']
                source = hit.get('_source', {})
                file_path = source.get('file_path', '')

                nas_path = generate_nas_path(file_path)

                if nas_path:
                    updates.append({
                        "_id": doc_id,
                        "nas_path": nas_path,
                        "file_path": file_path
                    })
                else:
                    total_failed += 1
                    print(f"  Could not generate nas_path for: {file_path[:80]}...")

            if updates:
                if args.dry_run:
                    print(f"\n[DRY RUN] Would update {len(updates)} documents:")
                    for u in updates[:3]:
                        print(f"  {u['file_path'][:60]}...")
                        print(f"    → {u['nas_path']}")
                    if len(updates) > 3:
                        print(f"  ... and {len(updates) - 3} more")
                    total_fixed += len(updates)
                else:
                    result = update_documents(updates)
                    errors = result.get('errors', False)
                    if errors:
                        for item in result.get('items', []):
                            if 'error' in item.get('update', {}):
                                print(f"  Error updating: {item['update']['error']}")
                                total_failed += 1
                            else:
                                total_fixed += 1
                    else:
                        total_fixed += len(updates)
                        print(f"  Updated {len(updates)} documents")

            # Check limit
            if args.limit and total_found >= args.limit:
                print(f"\nReached limit of {args.limit} documents")
                break

            print(f"Progress: {total_found} found, {total_fixed} fixed, {total_failed} failed")

        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)
        print(f"Total documents found without nas_path: {total_found}")
        print(f"Total documents {'would be ' if args.dry_run else ''}fixed: {total_fixed}")
        print(f"Total documents failed: {total_failed}")

        if args.dry_run:
            print("\nThis was a DRY RUN. No changes were made.")
            print("Run without --dry-run to apply changes.")

    finally:
        # Clear scroll
        if scroll_id:
            try:
                url = f"{OPENSEARCH_ENDPOINT}/_search/scroll"
                signed_request('DELETE', url, {"scroll_id": scroll_id})
            except:
                pass


if __name__ == '__main__':
    main()
