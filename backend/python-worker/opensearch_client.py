"""
OpenSearch Client Module
Handles indexing and search operations with AWS OpenSearch Service
"""

import logging
from typing import Dict, Any, Optional, List
from datetime import datetime

from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth
import boto3

logger = logging.getLogger(__name__)


class OpenSearchClient:
    """
    Client for AWS OpenSearch Service
    Handles document indexing and search operations
    """

    def __init__(self, config):
        """
        Initialize OpenSearch client

        Args:
            config: Configuration object
        """
        self.config = config
        self.client = None

        if self.config.aws.opensearch_endpoint:
            self._initialize_client()
        else:
            logger.warning("OpenSearch endpoint not configured - client disabled")

    def _initialize_client(self):
        """Initialize OpenSearch connection"""
        try:
            # Get AWS credentials
            credentials = boto3.Session().get_credentials()

            # Create AWS4Auth for authentication
            awsauth = AWS4Auth(
                credentials.access_key,
                credentials.secret_key,
                self.config.aws.region,
                'es',
                session_token=credentials.token
            )

            # Create OpenSearch client
            self.client = OpenSearch(
                hosts=[{
                    'host': self._get_host_from_endpoint(),
                    'port': 443
                }],
                http_auth=awsauth,
                use_ssl=self.config.aws.opensearch_use_ssl,
                verify_certs=self.config.aws.opensearch_verify_certs,
                connection_class=RequestsHttpConnection,
                timeout=30,
                max_retries=3,
                retry_on_timeout=True
            )

            # Test connection
            info = self.client.info()
            logger.info(f"Connected to OpenSearch cluster: {info['cluster_name']}")

        except Exception as e:
            logger.error(f"Failed to initialize OpenSearch client: {e}")
            self.client = None

    def _get_host_from_endpoint(self) -> str:
        """Extract host from OpenSearch endpoint URL"""
        endpoint = self.config.aws.opensearch_endpoint
        # Remove https:// prefix
        endpoint = endpoint.replace('https://', '').replace('http://', '')
        # Remove trailing slash
        endpoint = endpoint.rstrip('/')
        return endpoint

    def is_connected(self) -> bool:
        """Check if client is connected to OpenSearch"""
        return self.client is not None

    def create_index(self, index_name: Optional[str] = None) -> bool:
        """
        Create index with appropriate mappings

        Args:
            index_name: Name of the index to create (defaults to config)

        Returns:
            True if successful
        """
        if not self.is_connected():
            logger.error("OpenSearch client not connected")
            return False

        index_name = index_name or self.config.aws.opensearch_index

        try:
            # Check if index exists
            if self.client.indices.exists(index=index_name):
                logger.info(f"Index '{index_name}' already exists")
                return True

            # Define index settings and mappings
            index_body = {
                "settings": {
                    "index": {
                        "number_of_shards": 2,
                        "number_of_replicas": 1,
                        "refresh_interval": "5s"
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
                        # File identification
                        "file_key": {"type": "keyword"},
                        "file_name": {
                            "type": "text",
                            "analyzer": "japanese_analyzer",
                            "fields": {
                                "keyword": {"type": "keyword"}
                            }
                        },
                        "file_path": {
                            "type": "text",
                            "analyzer": "japanese_analyzer",
                            "fields": {
                                "keyword": {"type": "keyword"}
                            }
                        },
                        "file_type": {"type": "keyword"},
                        "mime_type": {"type": "keyword"},
                        "file_size": {"type": "long"},

                        # Content
                        "extracted_text": {
                            "type": "text",
                            "analyzer": "japanese_analyzer"
                        },
                        "page_count": {"type": "integer"},
                        "word_count": {"type": "integer"},
                        "char_count": {"type": "integer"},

                        # Metadata
                        "metadata": {"type": "object", "enabled": True},

                        # Processing information
                        "processor_name": {"type": "keyword"},
                        "processor_version": {"type": "keyword"},
                        "processing_time_seconds": {"type": "float"},
                        "processed_at": {"type": "date"},
                        "indexed_at": {"type": "date"},

                        # OCR information
                        "ocr_confidence": {"type": "float"},
                        "ocr_language": {"type": "keyword"},

                        # S3 information
                        "bucket": {"type": "keyword"},

                        # Status
                        "success": {"type": "boolean"},
                        "error_message": {"type": "text"},
                    }
                }
            }

            # Create index
            response = self.client.indices.create(
                index=index_name,
                body=index_body
            )

            logger.info(f"Created index '{index_name}': {response}")
            return True

        except Exception as e:
            logger.error(f"Failed to create index '{index_name}': {e}")
            return False

    def index_document(
        self,
        document: Dict[str, Any],
        document_id: Optional[str] = None,
        index_name: Optional[str] = None
    ) -> bool:
        """
        Index a document to OpenSearch

        Args:
            document: Document to index
            document_id: Optional document ID (uses file_key if not provided)
            index_name: Index name (defaults to config)

        Returns:
            True if successful
        """
        if not self.is_connected():
            logger.error("OpenSearch client not connected")
            return False

        index_name = index_name or self.config.aws.opensearch_index

        try:
            # Add indexing timestamp
            document['indexed_at'] = datetime.utcnow().isoformat()

            # Use file_key as document ID if not provided
            if not document_id:
                document_id = document.get('file_key', '')

            # Index document
            response = self.client.index(
                index=index_name,
                id=document_id,
                body=document,
                refresh=False  # Don't force refresh (better performance)
            )

            logger.info(f"Indexed document: {document_id} (result: {response['result']})")
            return True

        except Exception as e:
            logger.error(f"Failed to index document: {e}")
            return False

    def bulk_index(
        self,
        documents: List[Dict[str, Any]],
        index_name: Optional[str] = None
    ) -> Dict[str, int]:
        """
        Bulk index multiple documents

        Args:
            documents: List of documents to index
            index_name: Index name (defaults to config)

        Returns:
            Dictionary with success/failure counts
        """
        if not self.is_connected():
            logger.error("OpenSearch client not connected")
            return {'success': 0, 'failed': 0}

        index_name = index_name or self.config.aws.opensearch_index

        try:
            # Prepare bulk request body
            bulk_body = []
            for doc in documents:
                # Add indexing timestamp
                doc['indexed_at'] = datetime.utcnow().isoformat()

                # Create index action
                document_id = doc.get('file_key', '')
                bulk_body.append({'index': {'_index': index_name, '_id': document_id}})
                bulk_body.append(doc)

            # Execute bulk request
            response = self.client.bulk(body=bulk_body, refresh=False)

            # Count successes and failures
            success_count = 0
            failed_count = 0

            if response.get('errors'):
                for item in response['items']:
                    if 'error' in item.get('index', {}):
                        failed_count += 1
                    else:
                        success_count += 1
            else:
                success_count = len(documents)

            logger.info(f"Bulk indexed {success_count} documents ({failed_count} failed)")

            return {'success': success_count, 'failed': failed_count}

        except Exception as e:
            logger.error(f"Bulk indexing failed: {e}")
            return {'success': 0, 'failed': len(documents)}

    def search(
        self,
        query: str,
        index_name: Optional[str] = None,
        size: int = 10,
        from_: int = 0
    ) -> Dict[str, Any]:
        """
        Search documents

        Args:
            query: Search query
            index_name: Index name (defaults to config)
            size: Number of results to return
            from_: Offset for pagination

        Returns:
            Search results
        """
        if not self.is_connected():
            logger.error("OpenSearch client not connected")
            return {'hits': {'total': {'value': 0}, 'hits': []}}

        index_name = index_name or self.config.aws.opensearch_index

        try:
            # Build search body
            search_body = {
                "query": {
                    "multi_match": {
                        "query": query,
                        "fields": [
                            "file_name^3",
                            "file_path^2",
                            "extracted_text"
                        ],
                        "type": "best_fields",
                        "operator": "or"
                    }
                },
                "highlight": {
                    "fields": {
                        "extracted_text": {},
                        "file_name": {},
                        "file_path": {}
                    }
                },
                "size": size,
                "from": from_
            }

            # Execute search
            response = self.client.search(
                index=index_name,
                body=search_body
            )

            logger.info(f"Search returned {response['hits']['total']['value']} results")

            return response

        except Exception as e:
            logger.error(f"Search failed: {e}")
            return {'hits': {'total': {'value': 0}, 'hits': []}}

    def delete_document(
        self,
        document_id: str,
        index_name: Optional[str] = None
    ) -> bool:
        """
        Delete a document

        Args:
            document_id: Document ID to delete
            index_name: Index name (defaults to config)

        Returns:
            True if successful
        """
        if not self.is_connected():
            logger.error("OpenSearch client not connected")
            return False

        index_name = index_name or self.config.aws.opensearch_index

        try:
            response = self.client.delete(
                index=index_name,
                id=document_id
            )

            logger.info(f"Deleted document: {document_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to delete document: {e}")
            return False

    def get_index_stats(self, index_name: Optional[str] = None) -> Dict[str, Any]:
        """
        Get index statistics

        Args:
            index_name: Index name (defaults to config)

        Returns:
            Index statistics
        """
        if not self.is_connected():
            return {}

        index_name = index_name or self.config.aws.opensearch_index

        try:
            stats = self.client.indices.stats(index=index_name)
            return stats

        except Exception as e:
            logger.error(f"Failed to get index stats: {e}")
            return {}

    def refresh_index(self, index_name: Optional[str] = None) -> bool:
        """
        Refresh index to make recent changes visible

        Args:
            index_name: Index name (defaults to config)

        Returns:
            True if successful
        """
        if not self.is_connected():
            return False

        index_name = index_name or self.config.aws.opensearch_index

        try:
            self.client.indices.refresh(index=index_name)
            logger.info(f"Refreshed index: {index_name}")
            return True

        except Exception as e:
            logger.error(f"Failed to refresh index: {e}")
            return False
