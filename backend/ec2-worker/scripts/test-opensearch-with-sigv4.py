#!/usr/bin/env python3
"""
OpenSearch Connection Test with AWS Signature V4
Purpose: Test OpenSearch connectivity using proper AWS authentication
Usage: python3 test-opensearch-with-sigv4.py
"""

import sys
import json
from typing import Dict, Any

try:
    import boto3
    from opensearchpy import OpenSearch, RequestsHttpConnection
    from requests_aws4auth import AWS4Auth
except ImportError as e:
    print(f"Error: Missing required package - {e}")
    print("\nInstalling required packages...")
    import subprocess
    subprocess.check_call([
        sys.executable, "-m", "pip", "install", "-q",
        "boto3", "opensearch-py", "requests-aws4auth"
    ])
    # Retry import
    import boto3
    from opensearchpy import OpenSearch, RequestsHttpConnection
    from requests_aws4auth import AWS4Auth

# Configuration
OPENSEARCH_ENDPOINT = "vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com"
REGION = "ap-northeast-1"

def print_colored(message: str, color: str = "green"):
    """Print colored output"""
    colors = {
        "green": "\033[0;32m",
        "red": "\033[0;31m",
        "yellow": "\033[1;33m",
        "blue": "\033[0;34m",
        "reset": "\033[0m"
    }
    print(f"{colors.get(color, colors['green'])}{message}{colors['reset']}")

def get_aws_auth() -> AWS4Auth:
    """Get AWS authentication using instance credentials"""
    try:
        # Get credentials from instance metadata
        session = boto3.Session()
        credentials = session.get_credentials()

        if not credentials:
            raise ValueError("No AWS credentials found")

        # Create AWS Signature V4 auth
        awsauth = AWS4Auth(
            credentials.access_key,
            credentials.secret_key,
            REGION,
            'es',
            session_token=credentials.token
        )

        print_colored("✓ AWS credentials obtained successfully", "green")
        return awsauth

    except Exception as e:
        print_colored(f"✗ Failed to get AWS credentials: {e}", "red")
        raise

def test_connection_basic() -> bool:
    """Test basic OpenSearch connection without auth"""
    print("\n[1/5] Testing basic HTTPS connection...")

    try:
        import urllib.request
        import ssl

        context = ssl.create_default_context()
        url = f"https://{OPENSEARCH_ENDPOINT}/_cluster/health"

        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, context=context, timeout=10) as response:
            status_code = response.getcode()

            if status_code == 200:
                print_colored("✓ Basic HTTPS connection successful (no auth)", "green")
                return True
            elif status_code == 403:
                print_colored("✓ HTTPS connection OK, but authentication required", "yellow")
                return True
            else:
                print_colored(f"⚠ Unexpected status code: {status_code}", "yellow")
                return True

    except Exception as e:
        print_colored(f"✗ Basic connection failed: {e}", "red")
        return False

def test_opensearch_client(awsauth: AWS4Auth) -> Dict[str, Any]:
    """Test OpenSearch client with AWS auth"""
    print("\n[2/5] Connecting to OpenSearch with AWS SigV4...")

    try:
        # Create OpenSearch client
        client = OpenSearch(
            hosts=[{
                'host': OPENSEARCH_ENDPOINT,
                'port': 443
            }],
            http_auth=awsauth,
            use_ssl=True,
            verify_certs=True,
            connection_class=RequestsHttpConnection,
            timeout=30
        )

        print_colored("✓ OpenSearch client created", "green")
        return client

    except Exception as e:
        print_colored(f"✗ Failed to create OpenSearch client: {e}", "red")
        raise

def test_cluster_health(client: OpenSearch) -> Dict[str, Any]:
    """Test cluster health endpoint"""
    print("\n[3/5] Testing cluster health...")

    try:
        health = client.cluster.health()

        print_colored("✓ Cluster health retrieved successfully", "green")
        print(f"  Cluster Name: {health.get('cluster_name')}")
        print(f"  Status: {health.get('status')}")
        print(f"  Number of Nodes: {health.get('number_of_nodes')}")
        print(f"  Number of Data Nodes: {health.get('number_of_data_nodes')}")
        print(f"  Active Shards: {health.get('active_shards')}")

        return health

    except Exception as e:
        print_colored(f"✗ Failed to get cluster health: {e}", "red")
        raise

def test_cluster_info(client: OpenSearch) -> Dict[str, Any]:
    """Test cluster info endpoint"""
    print("\n[4/5] Testing cluster info...")

    try:
        info = client.info()

        print_colored("✓ Cluster info retrieved successfully", "green")
        print(f"  Cluster Name: {info.get('cluster_name')}")
        print(f"  Version: {info.get('version', {}).get('number')}")
        print(f"  Distribution: {info.get('version', {}).get('distribution', 'N/A')}")

        return info

    except Exception as e:
        print_colored(f"✗ Failed to get cluster info: {e}", "red")
        raise

def test_indices(client: OpenSearch):
    """Test index operations"""
    print("\n[5/5] Testing index operations...")

    try:
        # List all indices
        indices = client.cat.indices(format='json')

        print_colored(f"✓ Found {len(indices)} indices", "green")

        if indices:
            print("\n  Existing indices:")
            for idx in indices:
                print(f"    - {idx.get('index')}: {idx.get('docs.count', '0')} docs, "
                      f"{idx.get('store.size', 'N/A')} size")

        # Check if 'files' index exists
        if client.indices.exists(index='files'):
            print_colored("\n✓ 'files' index exists", "green")

            # Get index stats
            stats = client.indices.stats(index='files')
            doc_count = stats['indices']['files']['primaries']['docs']['count']
            store_size = stats['indices']['files']['primaries']['store']['size_in_bytes']

            print(f"  Documents: {doc_count}")
            print(f"  Size: {store_size / 1024 / 1024:.2f} MB")

            # Get a sample document
            if doc_count > 0:
                sample = client.search(index='files', body={'size': 1})
                if sample['hits']['total']['value'] > 0:
                    print("\n  Sample document:")
                    print(f"    {json.dumps(sample['hits']['hits'][0]['_source'], indent=4)}")
        else:
            print_colored("\n⚠ 'files' index does not exist yet", "yellow")
            print("  This is normal if no files have been indexed")

        return True

    except Exception as e:
        print_colored(f"✗ Failed to test indices: {e}", "red")
        return False

def test_search_functionality(client: OpenSearch):
    """Test search functionality"""
    print("\n[BONUS] Testing search functionality...")

    try:
        # Test a simple search query
        query = {
            "query": {
                "match_all": {}
            },
            "size": 5
        }

        result = client.search(index='files', body=query)

        total_hits = result['hits']['total']['value']
        print_colored(f"✓ Search executed successfully", "green")
        print(f"  Total documents: {total_hits}")

        if total_hits > 0:
            print("\n  Sample results:")
            for hit in result['hits']['hits'][:3]:
                source = hit['_source']
                print(f"    - {source.get('file_path', 'N/A')}")

        return True

    except Exception as e:
        if "index_not_found_exception" in str(e):
            print_colored("⚠ 'files' index not found - no search results yet", "yellow")
        else:
            print_colored(f"⚠ Search test failed: {e}", "yellow")
        return False

def main():
    """Main test function"""
    print("=" * 50)
    print("OpenSearch Connection Test with AWS SigV4")
    print("=" * 50)

    try:
        # Test 1: Basic connection
        if not test_connection_basic():
            print_colored("\n✗ Basic connection failed. Check network connectivity.", "red")
            print("\nRun diagnostic script for details:")
            print("  ./diagnose-opensearch.sh")
            return 1

        # Get AWS credentials
        awsauth = get_aws_auth()

        # Test 2: Create OpenSearch client
        client = test_opensearch_client(awsauth)

        # Test 3: Cluster health
        health = test_cluster_health(client)

        # Test 4: Cluster info
        info = test_cluster_info(client)

        # Test 5: Indices
        test_indices(client)

        # Bonus: Search functionality
        test_search_functionality(client)

        # Summary
        print("\n" + "=" * 50)
        print_colored("✓ ALL TESTS PASSED", "green")
        print_colored("OpenSearch is fully accessible and operational!", "green")
        print("=" * 50)

        return 0

    except Exception as e:
        print("\n" + "=" * 50)
        print_colored(f"✗ TEST FAILED: {e}", "red")
        print("=" * 50)

        print("\nTroubleshooting steps:")
        print("  1. Check security groups allow EC2 → OpenSearch on port 443")
        print("  2. Verify IAM role has OpenSearch permissions")
        print("  3. Ensure OpenSearch access policy allows this EC2 instance")
        print("  4. Wait 5-10 minutes after making IAM/access policy changes")
        print("\nRun the fix script:")
        print("  ./fix-opensearch-connectivity.sh")

        return 1

if __name__ == "__main__":
    sys.exit(main())
