"""
Amazon OpenSearch Client for Document Indexing and Search
"""

import logging
import json
from typing import Optional, List, Dict, Any
from datetime import datetime
import hashlib
from opensearchpy import OpenSearch, RequestsHttpConnection, helpers
from opensearchpy.exceptions import RequestError, ConnectionError as OSConnectionError
from requests_aws4auth import AWS4Auth
import boto3
from config import config

logger = logging.getLogger(__name__)


class OpenSearchClient:
    """OpenSearchクライアント - インデックス管理と検索"""

    def __init__(self):
        """初期化"""
        self.index_name = config.opensearch.index_name
        self.endpoint = config.opensearch.endpoint.replace('https://', '').replace('http://', '')

        # AWS認証またはBasic認証を設定
        if config.opensearch.use_aws_auth:
            # AWS署名認証
            credentials = boto3.Session().get_credentials()
            self.awsauth = AWS4Auth(
                credentials.access_key,
                credentials.secret_key,
                config.aws.region,
                'es',
                session_token=credentials.token
            )

            self.client = OpenSearch(
                hosts=[{'host': self.endpoint, 'port': 443}],
                http_auth=self.awsauth,
                use_ssl=True,
                verify_certs=True,
                connection_class=RequestsHttpConnection
            )
        else:
            # Basic認証
            self.client = OpenSearch(
                hosts=[{'host': self.endpoint, 'port': 443}],
                http_auth=(config.opensearch.username, config.opensearch.password),
                use_ssl=True,
                verify_certs=True
            )

        logger.info(f"Initialized OpenSearch client for index: {self.index_name}")

        # インデックスを初期化
        self._ensure_index_exists()

    def _ensure_index_exists(self):
        """インデックスが存在することを確認、なければ作成"""
        try:
            if not self.client.indices.exists(index=self.index_name):
                logger.info(f"Creating index: {self.index_name}")
                self._create_index()
            else:
                logger.info(f"Index already exists: {self.index_name}")
        except Exception as e:
            logger.error(f"Failed to ensure index exists: {str(e)}")

    def _create_index(self):
        """インデックスを作成"""
        try:
            # インデックス設定とマッピング
            index_body = {
                "settings": {
                    "index": {
                        "number_of_shards": 1,
                        "number_of_replicas": 1,
                        "knn": True,  # k-NNプラグインを有効化
                        "knn.algo_param.ef_search": 100
                    },
                    "analysis": {
                        "analyzer": {
                            "japanese_analyzer": {
                                "type": "custom",
                                "tokenizer": "kuromoji_tokenizer",
                                "filter": [
                                    "kuromoji_baseform",
                                    "kuromoji_part_of_speech",
                                    "ja_stop",
                                    "kuromoji_number",
                                    "kuromoji_stemmer"
                                ]
                            }
                        }
                    }
                },
                "mappings": {
                    "properties": {
                        # ファイル基本情報
                        "file_id": {"type": "keyword"},
                        "file_name": {"type": "text", "analyzer": "japanese_analyzer"},
                        "file_path": {"type": "text"},
                        "file_extension": {"type": "keyword"},
                        "file_size": {"type": "long"},
                        "mime_type": {"type": "keyword"},

                        # 時間情報
                        "created_at": {"type": "date"},
                        "modified_at": {"type": "date"},
                        "indexed_at": {"type": "date"},

                        # テキストコンテンツ
                        "content": {
                            "type": "text",
                            "analyzer": "japanese_analyzer"
                        },
                        "ocr_text": {
                            "type": "text",
                            "analyzer": "japanese_analyzer"
                        },
                        "ocr_confidence": {"type": "float"},

                        # サムネイル
                        "thumbnail_url": {"type": "keyword"},
                        "thumbnail_s3_key": {"type": "keyword"},

                        # ベクトル検索用
                        "image_vector": {
                            "type": "knn_vector",
                            "dimension": 1024,
                            "method": {
                                "name": "hnsw",
                                "space_type": "cosinesimil",
                                "engine": "faiss",
                                "parameters": {
                                    "ef_construction": 256,
                                    "m": 16
                                }
                            }
                        },

                        # メタデータ
                        "metadata": {
                            "type": "object",
                            "enabled": False  # 動的マッピングを無効化
                        },

                        # 処理ステータス
                        "processing_status": {"type": "keyword"},
                        "error_message": {"type": "text"},

                        # 権限・タグ
                        "tags": {"type": "keyword"},
                        "department": {"type": "keyword"},
                        "owner": {"type": "keyword"}
                    }
                }
            }

            self.client.indices.create(index=self.index_name, body=index_body)
            logger.info(f"Successfully created index: {self.index_name}")

        except RequestError as e:
            if "resource_already_exists_exception" in str(e).lower():
                logger.info(f"Index {self.index_name} already exists")
            else:
                logger.error(f"Failed to create index: {str(e)}")
                raise

    def index_document(self, document: Dict[str, Any]) -> bool:
        """
        ドキュメントをインデックスに追加

        Args:
            document: インデックスするドキュメント

        Returns:
            成功の場合True
        """
        try:
            # ドキュメントIDを生成（ファイルパスからハッシュ）
            if 'file_path' in document:
                doc_id = hashlib.md5(document['file_path'].encode()).hexdigest()
            else:
                doc_id = None

            # タイムスタンプを追加
            document['indexed_at'] = datetime.utcnow().isoformat()

            # インデックスに追加
            response = self.client.index(
                index=self.index_name,
                id=doc_id,
                body=document,
                refresh=True  # 即座に検索可能にする
            )

            if response['result'] in ['created', 'updated']:
                logger.info(f"Successfully indexed document: {doc_id}")
                return True
            else:
                logger.error(f"Failed to index document: {response}")
                return False

        except Exception as e:
            logger.error(f"Failed to index document: {str(e)}")
            return False

    def bulk_index_documents(self, documents: List[Dict[str, Any]]) -> Dict[str, int]:
        """
        複数のドキュメントを一括インデックス

        Args:
            documents: ドキュメントのリスト

        Returns:
            結果統計
        """
        stats = {
            'total': len(documents),
            'success': 0,
            'failed': 0
        }

        try:
            # バルクアクションを準備
            actions = []
            for doc in documents:
                # ドキュメントIDを生成
                if 'file_path' in doc:
                    doc_id = hashlib.md5(doc['file_path'].encode()).hexdigest()
                else:
                    doc_id = None

                # タイムスタンプを追加
                doc['indexed_at'] = datetime.utcnow().isoformat()

                action = {
                    '_index': self.index_name,
                    '_id': doc_id,
                    '_source': doc
                }
                actions.append(action)

            # バルクインデックス実行
            success, failed = helpers.bulk(
                self.client,
                actions,
                raise_on_error=False,
                raise_on_exception=False
            )

            stats['success'] = success
            stats['failed'] = len(failed)

            if failed:
                logger.warning(f"Failed to index {len(failed)} documents")
                for item in failed:
                    logger.error(f"Failed document: {item}")

            logger.info(f"Bulk indexed: {success} success, {len(failed)} failed")

        except Exception as e:
            logger.error(f"Bulk indexing failed: {str(e)}")
            stats['failed'] = stats['total']

        return stats

    def search_text(self, query: str, size: int = 100) -> List[Dict]:
        """
        テキスト検索

        Args:
            query: 検索クエリ
            size: 取得件数

        Returns:
            検索結果のリスト
        """
        try:
            # 検索クエリを構築
            search_body = {
                "query": {
                    "multi_match": {
                        "query": query,
                        "fields": [
                            "file_name^3",  # ファイル名を重視
                            "content^2",    # コンテンツ
                            "ocr_text",     # OCRテキスト
                            "file_path"     # ファイルパス
                        ],
                        "type": "best_fields",
                        "operator": "or",
                        "fuzziness": "AUTO"  # あいまい検索を有効化
                    }
                },
                "size": size,
                "highlight": {
                    "fields": {
                        "content": {},
                        "ocr_text": {}
                    }
                }
            }

            # 検索実行
            response = self.client.search(
                index=self.index_name,
                body=search_body
            )

            # 結果を整形
            results = []
            for hit in response['hits']['hits']:
                result = hit['_source']
                result['_id'] = hit['_id']
                result['_score'] = hit['_score']

                # ハイライト情報を追加
                if 'highlight' in hit:
                    result['_highlight'] = hit['highlight']

                results.append(result)

            logger.info(f"Text search found {len(results)} results for query: {query}")
            return results

        except Exception as e:
            logger.error(f"Text search failed: {str(e)}")
            return []

    def search_vector(self, vector: List[float], k: int = 10) -> List[Dict]:
        """
        ベクトル類似検索（画像検索）

        Args:
            vector: 検索ベクトル（1024次元）
            k: 取得件数

        Returns:
            検索結果のリスト
        """
        try:
            # k-NN検索クエリを構築
            search_body = {
                "size": k,
                "query": {
                    "knn": {
                        "image_vector": {
                            "vector": vector,
                            "k": k
                        }
                    }
                }
            }

            # 検索実行
            response = self.client.search(
                index=self.index_name,
                body=search_body
            )

            # 結果を整形
            results = []
            for hit in response['hits']['hits']:
                result = hit['_source']
                result['_id'] = hit['_id']
                result['_score'] = hit['_score']
                results.append(result)

            logger.info(f"Vector search found {len(results)} results")
            return results

        except Exception as e:
            logger.error(f"Vector search failed: {str(e)}")
            return []

    def hybrid_search(self, query: str, vector: Optional[List[float]] = None,
                     text_weight: float = 0.5, vector_weight: float = 0.5,
                     size: int = 100) -> List[Dict]:
        """
        ハイブリッド検索（テキスト + ベクトル）

        Args:
            query: テキスト検索クエリ
            vector: 検索ベクトル
            text_weight: テキスト検索の重み
            vector_weight: ベクトル検索の重み
            size: 取得件数

        Returns:
            検索結果のリスト
        """
        try:
            # クエリを構築
            must_clauses = []

            # テキスト検索部分
            if query:
                text_query = {
                    "multi_match": {
                        "query": query,
                        "fields": ["file_name^3", "content^2", "ocr_text"],
                        "boost": text_weight
                    }
                }
                must_clauses.append(text_query)

            # ベクトル検索部分
            if vector:
                vector_query = {
                    "knn": {
                        "image_vector": {
                            "vector": vector,
                            "k": size,
                            "boost": vector_weight
                        }
                    }
                }
                must_clauses.append(vector_query)

            # 複合クエリを構築
            search_body = {
                "size": size,
                "query": {
                    "bool": {
                        "should": must_clauses,
                        "minimum_should_match": 1
                    }
                }
            }

            # 検索実行
            response = self.client.search(
                index=self.index_name,
                body=search_body
            )

            # 結果を整形
            results = []
            for hit in response['hits']['hits']:
                result = hit['_source']
                result['_id'] = hit['_id']
                result['_score'] = hit['_score']
                results.append(result)

            logger.info(f"Hybrid search found {len(results)} results")
            return results

        except Exception as e:
            logger.error(f"Hybrid search failed: {str(e)}")
            return []

    def get_document(self, doc_id: str) -> Optional[Dict]:
        """
        ドキュメントをIDで取得

        Args:
            doc_id: ドキュメントID

        Returns:
            ドキュメント
        """
        try:
            response = self.client.get(
                index=self.index_name,
                id=doc_id
            )
            return response['_source']

        except Exception as e:
            logger.error(f"Failed to get document {doc_id}: {str(e)}")
            return None

    def update_document(self, doc_id: str, updates: Dict) -> bool:
        """
        ドキュメントを更新

        Args:
            doc_id: ドキュメントID
            updates: 更新内容

        Returns:
            成功の場合True
        """
        try:
            self.client.update(
                index=self.index_name,
                id=doc_id,
                body={"doc": updates},
                refresh=True
            )
            logger.info(f"Successfully updated document: {doc_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to update document {doc_id}: {str(e)}")
            return False

    def delete_document(self, doc_id: str) -> bool:
        """
        ドキュメントを削除

        Args:
            doc_id: ドキュメントID

        Returns:
            成功の場合True
        """
        try:
            self.client.delete(
                index=self.index_name,
                id=doc_id,
                refresh=True
            )
            logger.info(f"Successfully deleted document: {doc_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to delete document {doc_id}: {str(e)}")
            return False

    def get_stats(self) -> Dict:
        """
        インデックス統計を取得

        Returns:
            統計情報
        """
        try:
            # インデックス統計を取得
            stats = self.client.indices.stats(index=self.index_name)

            # カウント取得
            count_response = self.client.count(index=self.index_name)

            return {
                'document_count': count_response['count'],
                'index_size': stats['indices'][self.index_name]['total']['store']['size_in_bytes'],
                'index_size_mb': stats['indices'][self.index_name]['total']['store']['size_in_bytes'] / (1024 * 1024)
            }

        except Exception as e:
            logger.error(f"Failed to get stats: {str(e)}")
            return {}