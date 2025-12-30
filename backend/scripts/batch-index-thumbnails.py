#!/usr/bin/env python3
"""
Batch Thumbnail Indexer
テキストインデックスのサムネイル画像を画像インデックスに登録するスクリプト

Usage:
    python3 batch-index-thumbnails.py --dry-run
    python3 batch-index-thumbnails.py --batch-size 10 --max-files 100
    python3 batch-index-thumbnails.py --resume
"""

import os
import sys
import json
import time
import argparse
import logging
import tempfile
import base64
from typing import List, Dict, Optional
from pathlib import Path
from datetime import datetime

import boto3
from botocore.exceptions import ClientError
from opensearchpy import OpenSearch, RequestsHttpConnection, helpers
from requests_aws4auth import AWS4Auth

# ロギング設定
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(f'batch-thumbnail-{datetime.now():%Y%m%d-%H%M%S}.log')
    ]
)
logger = logging.getLogger(__name__)


class ThumbnailIndexer:
    """サムネイル画像インデクサークラス"""

    # 画像検索対象とするファイル拡張子（OCR済みのもの）
    TARGET_EXTENSIONS = {
        '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff',
        '.xls', '.xlsx', '.doc', '.docx', '.ppt', '.pptx',
        '.xdw', '.xbd'  # DocuWorks
    }
    
    # 除外する拡張子（CAD、メタデータ、一時ファイル等）
    EXCLUDE_EXTENSIONS = {
        '.sfc', '.emf', '.dwg', '.dxf', '.bvf',  # CAD
        '.meta', '.lnk', '.log', '.zip', '.lzh', '.tmp', '.$$$', '.bak',
        '.csv', '.xml', '.dtd', '.txt', '.dat', '.db', '.out'
    }

    def __init__(
        self,
        opensearch_endpoint: str,
        text_index: str = 'cis-files',
        image_index: str = 'file-index-v2-knn',
        thumbnail_bucket: str = 'cis-filesearch-s3-thumbnail',
        bedrock_region: str = 'us-east-1',
        bedrock_model: str = 'amazon.titan-embed-image-v1',
        aws_region: str = 'ap-northeast-1',
        batch_size: int = 10,
        tps_limit: int = 8,
        state_file: str = 'thumbnail-progress.json'
    ):
        self.text_index = text_index
        self.image_index = image_index
        self.thumbnail_bucket = thumbnail_bucket
        self.batch_size = batch_size
        self.tps_limit = tps_limit
        self.state_file = state_file
        self.bedrock_model = bedrock_model

        # AWS クライアント初期化
        self.s3_client = boto3.client('s3', region_name=aws_region)
        self.bedrock_client = boto3.client('bedrock-runtime', region_name=bedrock_region)

        # OpenSearch クライアント初期化
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
            timeout=60
        )

        # 統計情報
        self.stats = {
            'total_files': 0,
            'processed': 0,
            'succeeded': 0,
            'failed': 0,
            'skipped': 0,
            'already_indexed': 0,
            'start_time': time.time()
        }

        # 進捗状態
        self.processed_ids = set()
        self.load_state()

        logger.info("Thumbnail Indexer initialized")
        logger.info(f"  Text Index: {text_index}")
        logger.info(f"  Image Index: {image_index}")
        logger.info(f"  Thumbnail Bucket: {thumbnail_bucket}")
        logger.info(f"  Bedrock Model: {bedrock_model}")

    def load_state(self):
        """進捗状態をロード"""
        if os.path.exists(self.state_file):
            try:
                with open(self.state_file, 'r') as f:
                    state = json.load(f)
                    self.processed_ids = set(state.get('processed_ids', []))
                    logger.info(f"Loaded state: {len(self.processed_ids)} already processed")
            except Exception as e:
                logger.warning(f"Failed to load state: {e}")

    def save_state(self):
        """進捗状態を保存"""
        try:
            with open(self.state_file, 'w') as f:
                json.dump({
                    'processed_ids': list(self.processed_ids),
                    'stats': self.stats,
                    'last_updated': datetime.now().isoformat()
                }, f)
        except Exception as e:
            logger.warning(f"Failed to save state: {e}")

    def get_docs_with_thumbnails(self, max_files: Optional[int] = None, search_after: list = None) -> tuple:
        """
        サムネイルがあるドキュメントを取得（search_after方式で10000件制限を回避）
        """
        logger.info(f"Fetching documents with thumbnails (search_after: {search_after})...")

        try:
            batch_size = min(max_files or 1000, 1000)
            query = {
                "query": {
                    "bool": {
                        "must": [
                            {"exists": {"field": "thumbnail_s3_key"}},
                            {"terms": {"file_extension": list(self.TARGET_EXTENSIONS)}}
                        ]
                    }
                },
                "size": batch_size,
                "sort": [{"_id": "asc"}],
                "_source": [
                    "file_name", "file_path", "file_extension", "file_size",
                    "thumbnail_s3_key", "thumbnail_url", "category", "nas_server"
                ]
            }
            
            if search_after:
                query["search_after"] = search_after

            response = self.opensearch.search(
                index=self.text_index,
                body=query
            )

            docs = []
            last_sort = None
            for hit in response['hits']['hits']:
                source = hit['_source']
                docs.append({
                    'doc_id': hit['_id'],
                    'file_name': source.get('file_name'),
                    'file_path': source.get('file_path'),
                    'file_extension': source.get('file_extension'),
                    'file_size': source.get('file_size'),
                    'thumbnail_s3_key': source.get('thumbnail_s3_key'),
                    'thumbnail_url': source.get('thumbnail_url'),
                    'category': source.get('category'),
                    'nas_server': source.get('nas_server')
                })
                last_sort = hit.get('sort')

            total = response['hits']['total']['value'] if isinstance(response['hits']['total'], dict) else response['hits']['total']
            
            logger.info(f"Fetched {len(docs)} documents (total: {total})")
            return docs, last_sort, total

        except Exception as e:
            logger.error(f"Failed to fetch documents: {e}")
            return [], None, 0

    def check_already_indexed(self, file_path: str) -> bool:
        """画像インデックスに既に登録されているか確認（元ファイルパスで厳密に検索）"""
        try:
            # file_path.keywordで完全一致検索
            response = self.opensearch.search(
                index=self.image_index,
                body={
                    "query": {
                        "term": {"file_path.keyword": file_path}
                    },
                    "size": 1
                }
            )
            total = response['hits']['total']['value'] if isinstance(response['hits']['total'], dict) else response['hits']['total']
            logger.debug(f"check file_path.keyword '{file_path}': {total} hits")
            if total > 0:
                logger.info(f"Already indexed (file_path): {file_path[:80]}...")
                return True
            
            # source_file_path.keywordでも確認（サムネイル登録済みの場合）
            response2 = self.opensearch.search(
                index=self.image_index,
                body={
                    "query": {
                        "term": {"source_file_path.keyword": file_path}
                    },
                    "size": 1
                }
            )
            total2 = response2['hits']['total']['value'] if isinstance(response2['hits']['total'], dict) else response2['hits']['total']
            logger.debug(f"check source_file_path.keyword '{file_path}': {total2} hits")
            if total2 > 0:
                logger.info(f"Already indexed (source): {file_path[:80]}...")
                return True
            
            return False
        except Exception as e:
            logger.warning(f"check_already_indexed error for {file_path}: {e}")
            return False

    def download_thumbnail(self, s3_key: str) -> Optional[bytes]:
        """S3からサムネイルをダウンロード"""
        try:
            response = self.s3_client.get_object(
                Bucket=self.thumbnail_bucket,
                Key=s3_key
            )
            return response['Body'].read()
        except Exception as e:
            logger.error(f"Failed to download {s3_key}: {e}")
            return None

    def generate_embedding(self, image_bytes: bytes) -> Optional[List[float]]:
        """Bedrockでベクトル生成"""
        try:
            image_base64 = base64.b64encode(image_bytes).decode('utf-8')
            
            response = self.bedrock_client.invoke_model(
                modelId=self.bedrock_model,
                contentType='application/json',
                accept='application/json',
                body=json.dumps({
                    "inputImage": image_base64
                })
            )
            
            result = json.loads(response['body'].read())
            return result.get('embedding')
        except Exception as e:
            logger.error(f"Failed to generate embedding: {e}")
            return None

    def index_thumbnail(self, doc: Dict, embedding: List[float]) -> bool:
        """画像インデックスにサムネイルを登録"""
        try:
            # 元ファイルのパスをIDとして使用（重複防止）
            doc_id = f"thumb_{doc['doc_id']}"
            
            document = {
                'file_name': doc['file_name'],
                'file_path': doc['file_path'],  # 元ファイルのパス
                'source_file_path': doc['file_path'],  # 検索用
                'thumbnail_path': f"s3://{self.thumbnail_bucket}/{doc['thumbnail_s3_key']}",
                'file_type': doc['file_extension'],
                'file_size': doc['file_size'],
                'category': doc['category'],
                'nas_server': doc['nas_server'],
                'image_embedding': embedding,
                'indexed_at': datetime.now().isoformat(),
                'is_thumbnail': True  # サムネイルであることを示すフラグ
            }

            self.opensearch.index(
                index=self.image_index,
                id=doc_id,
                body=document
            )
            return True
        except Exception as e:
            logger.error(f"Failed to index thumbnail: {e}")
            return False

    def process_batch(self, docs: List[Dict], dry_run: bool = False) -> int:
        """バッチ処理"""
        success_count = 0
        
        for doc in docs:
            doc_id = doc['doc_id']
            
            # 既に処理済みならスキップ
            if doc_id in self.processed_ids:
                self.stats['skipped'] += 1
                continue

            # 既にインデックスにあればスキップ
            if self.check_already_indexed(doc['file_path']):
                self.stats['already_indexed'] += 1
                self.processed_ids.add(doc_id)
                continue

            if dry_run:
                logger.info(f"[DRY-RUN] Would process: {doc['file_name']} -> {doc['thumbnail_s3_key']}")
                success_count += 1
                continue

            # サムネイルをダウンロード
            thumbnail_data = self.download_thumbnail(doc['thumbnail_s3_key'])
            if not thumbnail_data:
                self.stats['failed'] += 1
                continue

            # ベクトル生成
            embedding = self.generate_embedding(thumbnail_data)
            if not embedding:
                self.stats['failed'] += 1
                continue

            # インデックスに登録
            if self.index_thumbnail(doc, embedding):
                success_count += 1
                self.stats['succeeded'] += 1
                logger.info(f"Indexed: {doc['file_name']}")
            else:
                self.stats['failed'] += 1

            self.processed_ids.add(doc_id)
            self.stats['processed'] += 1

            # レート制限
            time.sleep(1.0 / self.tps_limit)

        return success_count

    def run(self, max_files: Optional[int] = None, dry_run: bool = False):
        """メイン処理"""
        logger.info(f"Starting thumbnail indexing (max_files={max_files}, dry_run={dry_run})")
        
        search_after = None
        docs, search_after, total = self.get_docs_with_thumbnails(max_files, search_after=None)
        self.stats['total_files'] = total
        
        processed_total = 0
        
        while docs:
            success = self.process_batch(docs, dry_run)
            processed_total += len(docs)
            
            logger.info(f"Progress: {processed_total}/{total} processed, {self.stats['succeeded']} succeeded")
            self.save_state()
            
            if max_files and processed_total >= max_files:
                break
            
            if len(docs) == 1000 and search_after:
                docs, search_after, _ = self.get_docs_with_thumbnails(search_after=search_after)
            else:
                break

        # 最終統計
        elapsed = time.time() - self.stats['start_time']
        logger.info("=" * 50)
        logger.info("Indexing completed!")
        logger.info(f"  Total documents: {self.stats['total_files']}")
        logger.info(f"  Processed: {self.stats['processed']}")
        logger.info(f"  Succeeded: {self.stats['succeeded']}")
        logger.info(f"  Failed: {self.stats['failed']}")
        logger.info(f"  Skipped: {self.stats['skipped']}")
        logger.info(f"  Already indexed: {self.stats['already_indexed']}")
        logger.info(f"  Elapsed time: {elapsed:.1f}s")
        logger.info("=" * 50)


def main():
    parser = argparse.ArgumentParser(description='Batch Thumbnail Indexer')
    parser.add_argument('--dry-run', action='store_true', help='Dry run mode')
    parser.add_argument('--max-files', type=int, default=None, help='Maximum files to process')
    parser.add_argument('--batch-size', type=int, default=10, help='Batch size')
    parser.add_argument('--tps-limit', type=int, default=8, help='TPS limit for Bedrock')
    parser.add_argument('--resume', action='store_true', help='Resume from last state')
    args = parser.parse_args()

    # 設定
    OPENSEARCH_ENDPOINT = 'vpc-cis-filesearch-opensearch-xuupcpgtq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com'
    
    indexer = ThumbnailIndexer(
        opensearch_endpoint=OPENSEARCH_ENDPOINT,
        batch_size=args.batch_size,
        tps_limit=args.tps_limit
    )
    
    if not args.resume:
        indexer.processed_ids = set()
    
    indexer.run(max_files=args.max_files, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
