#!/usr/bin/env python3
"""
Batch Image Embedding Generator
既存の画像ファイルにベクトル埋め込みを追加するバッチ処理スクリプト

Usage:
    python3 batch-generate-image-embeddings.py --dry-run
    python3 batch-generate-image-embeddings.py --batch-size 10 --max-files 100
    python3 batch-generate-image-embeddings.py --resume
"""

import os
import sys
import json
import time
import argparse
import logging
import tempfile
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
        logging.FileHandler(f'batch-embedding-{datetime.now():%Y%m%d-%H%M%S}.log')
    ]
)
logger = logging.getLogger(__name__)


class BatchEmbeddingGenerator:
    """バッチ画像埋め込み生成クラス"""

    # サポートする画像拡張子
    IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'}

    def __init__(
        self,
        opensearch_endpoint: str,
        opensearch_index: str,
        s3_bucket: str,
        bedrock_region: str = 'us-east-1',
        bedrock_model: str = 'amazon.titan-embed-image-v1',
        aws_region: str = 'ap-northeast-1',
        batch_size: int = 10,
        tps_limit: int = 8,
        state_file: str = 'batch-progress.json'
    ):
        """
        初期化

        Args:
            opensearch_endpoint: OpenSearchエンドポイント
            opensearch_index: インデックス名
            s3_bucket: S3バケット名
            bedrock_region: Bedrockリージョン
            bedrock_model: BedrockモデルID
            aws_region: AWSリージョン
            batch_size: バッチサイズ
            tps_limit: スロットリング制限 (TPS)
            state_file: 進捗状況ファイル
        """
        self.opensearch_index = opensearch_index
        self.s3_bucket = s3_bucket
        self.batch_size = batch_size
        self.tps_limit = tps_limit
        self.state_file = state_file

        # AWS クライアント初期化
        self.s3_client = boto3.client('s3', region_name=aws_region)
        self.bedrock_client = boto3.client('bedrock-runtime', region_name=bedrock_region)
        self.cloudwatch = boto3.client('cloudwatch', region_name=aws_region)
        self.bedrock_model = bedrock_model

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
            'start_time': time.time()
        }

        logger.info("Batch Embedding Generator initialized")
        logger.info(f"  OpenSearch: {opensearch_endpoint}/{opensearch_index}")
        logger.info(f"  S3 Bucket: {s3_bucket}")
        logger.info(f"  Bedrock Model: {bedrock_model}")
        logger.info(f"  Batch Size: {batch_size}, TPS Limit: {tps_limit}")

    def get_image_files_without_vector(self, max_files: Optional[int] = None) -> List[Dict]:
        """
        ベクトルがない画像ファイルを取得

        Args:
            max_files: 最大取得件数

        Returns:
            ファイル情報のリスト
        """
        logger.info("Fetching image files without vectors from OpenSearch...")

        try:
            # クエリ: 画像拡張子 AND image_vectorフィールドなし
            query = {
                "query": {
                    "bool": {
                        "must": [
                            {
                                "terms": {
                                    "file_extension": list(self.IMAGE_EXTENSIONS)
                                }
                            }
                        ],
                        "must_not": [
                            {
                                "exists": {
                                    "field": "image_vector"
                                }
                            }
                        ]
                    }
                },
                "size": max_files or 10000,
                "_source": ["file_name", "file_path", "file_key", "bucket", "s3_url", "file_extension"],
                "sort": [{"indexed_at": "desc"}]  # 新しいファイルから処理
            }

            response = self.opensearch.search(
                index=self.opensearch_index,
                body=query
            )

            files = []
            for hit in response['hits']['hits']:
                source = hit['_source']
                files.append({
                    'doc_id': hit['_id'],
                    'file_name': source.get('file_name'),
                    'file_path': source.get('file_path') or source.get('s3_url'),
                    'file_key': source.get('file_key'),
                    'bucket': source.get('bucket') or self.s3_bucket,
                    'extension': source.get('file_extension')
                })

            logger.info(f"Found {len(files)} image files without vectors")
            self.stats['total_files'] = len(files)

            return files

        except Exception as e:
            logger.error(f"Failed to fetch files from OpenSearch: {e}")
            return []

    def download_image_from_s3(self, bucket: str, key: str) -> Optional[str]:
        """
        S3から画像をダウンロード

        Args:
            bucket: S3バケット名
            key: S3オブジェクトキー

        Returns:
            ローカルファイルパス
        """
        try:
            # 一時ファイル作成
            suffix = Path(key).suffix
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp_path = tmp.name

            # S3からダウンロード
            self.s3_client.download_file(bucket, key, tmp_path)

            logger.debug(f"Downloaded: s3://{bucket}/{key} -> {tmp_path}")
            return tmp_path

        except ClientError as e:
            logger.error(f"Failed to download s3://{bucket}/{key}: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error downloading file: {e}")
            return None

    def generate_embedding(self, image_path: str) -> Optional[List[float]]:
        """
        Bedrockで画像埋め込みを生成

        Args:
            image_path: 画像ファイルパス

        Returns:
            1024次元ベクトル
        """
        try:
            import base64
            from PIL import Image
            import io

            # 画像を読み込み
            with Image.open(image_path) as img:
                # 必要に応じてリサイズ
                max_size = (2048, 2048)
                if img.width > max_size[0] or img.height > max_size[1]:
                    img.thumbnail(max_size, Image.Resampling.LANCZOS)

                # RGBに変換
                if img.mode != 'RGB':
                    img = img.convert('RGB')

                # バイトデータに変換
                img_byte_arr = io.BytesIO()
                img.save(img_byte_arr, format='JPEG', quality=95)
                img_bytes = img_byte_arr.getvalue()

            # Base64エンコード
            image_base64 = base64.b64encode(img_bytes).decode('utf-8')

            # Bedrock API呼び出し
            request_body = {
                "inputImage": image_base64
            }

            response = self.bedrock_client.invoke_model(
                modelId=self.bedrock_model,
                body=json.dumps(request_body),
                contentType='application/json',
                accept='application/json'
            )

            # レスポンス解析
            response_body = json.loads(response['body'].read())
            embedding = response_body.get('embedding')

            if embedding and len(embedding) == 1024:
                logger.debug(f"Generated embedding: {len(embedding)} dimensions")
                return embedding
            else:
                logger.error(f"Invalid embedding response: {response_body}")
                return None

        except ClientError as e:
            if e.response['Error']['Code'] == 'ThrottlingException':
                logger.warning("Bedrock throttling detected, waiting...")
                time.sleep(5)
                # リトライ
                return self.generate_embedding(image_path)
            else:
                logger.error(f"Bedrock API error: {e}")
                return None

        except Exception as e:
            logger.error(f"Failed to generate embedding: {e}")
            return None

    def update_document_vector(self, doc_id: str, embedding: List[float]) -> bool:
        """
        OpenSearchドキュメントにベクトルを追加

        Args:
            doc_id: ドキュメントID
            embedding: ベクトル

        Returns:
            成功の場合True
        """
        try:
            self.opensearch.update(
                index=self.opensearch_index,
                id=doc_id,
                body={
                    "doc": {
                        "image_vector": embedding,
                        "vector_updated_at": datetime.utcnow().isoformat()
                    }
                },
                refresh=False  # パフォーマンス向上のため、refreshは後でまとめて実行
            )

            logger.debug(f"Updated document: {doc_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to update document {doc_id}: {e}")
            return False

    def process_file(self, file_info: Dict) -> bool:
        """
        1ファイルを処理

        Args:
            file_info: ファイル情報

        Returns:
            成功の場合True
        """
        local_file = None

        try:
            doc_id = file_info['doc_id']
            file_name = file_info['file_name']
            bucket = file_info['bucket']
            key = file_info['file_key']

            logger.info(f"Processing: {file_name} (ID: {doc_id[:8]}...)")

            # S3からダウンロード
            local_file = self.download_image_from_s3(bucket, key)
            if not local_file:
                logger.error(f"Failed to download: {file_name}")
                return False

            # ベクトル生成
            embedding = self.generate_embedding(local_file)
            if not embedding:
                logger.error(f"Failed to generate embedding: {file_name}")
                return False

            # OpenSearch更新
            success = self.update_document_vector(doc_id, embedding)

            if success:
                logger.info(f"✓ Successfully processed: {file_name}")
                return True
            else:
                return False

        except Exception as e:
            logger.error(f"Error processing file: {e}")
            return False

        finally:
            # 一時ファイル削除
            if local_file and os.path.exists(local_file):
                try:
                    os.remove(local_file)
                except:
                    pass

    def save_progress(self, processed_files: List[str]):
        """
        進捗状況を保存

        Args:
            processed_files: 処理済みファイルIDリスト
        """
        try:
            with open(self.state_file, 'w') as f:
                json.dump({
                    'processed_files': processed_files,
                    'stats': self.stats,
                    'last_update': datetime.utcnow().isoformat()
                }, f, indent=2)

            logger.debug(f"Progress saved: {len(processed_files)} files")

        except Exception as e:
            logger.warning(f"Failed to save progress: {e}")

    def load_progress(self) -> List[str]:
        """
        進捗状況を読み込み

        Returns:
            処理済みファイルIDリスト
        """
        try:
            if os.path.exists(self.state_file):
                with open(self.state_file, 'r') as f:
                    data = json.load(f)
                    processed = data.get('processed_files', [])
                    logger.info(f"Loaded progress: {len(processed)} files already processed")
                    return processed
        except Exception as e:
            logger.warning(f"Failed to load progress: {e}")

        return []

    def send_metrics(self):
        """CloudWatchメトリクスを送信"""
        try:
            self.cloudwatch.put_metric_data(
                Namespace='CIS/BatchEmbedding',
                MetricData=[
                    {
                        'MetricName': 'FilesProcessed',
                        'Value': self.stats['processed'],
                        'Unit': 'Count',
                        'Timestamp': datetime.utcnow()
                    },
                    {
                        'MetricName': 'SuccessRate',
                        'Value': (self.stats['succeeded'] / max(self.stats['processed'], 1)) * 100,
                        'Unit': 'Percent',
                        'Timestamp': datetime.utcnow()
                    }
                ]
            )
        except Exception as e:
            logger.warning(f"Failed to send metrics: {e}")

    def run(self, max_files: Optional[int] = None, dry_run: bool = False, resume: bool = False):
        """
        バッチ処理実行

        Args:
            max_files: 最大処理ファイル数
            dry_run: ドライラン（実際の処理は行わない）
            resume: 中断から再開
        """
        logger.info("=" * 60)
        logger.info("Batch Image Embedding Generation - Started")
        logger.info("=" * 60)

        # 進捗状況読み込み（リジューム時）
        processed_file_ids = []
        if resume:
            processed_file_ids = self.load_progress()

        # ベクトルがないファイルを取得
        files = self.get_image_files_without_vector(max_files)

        if not files:
            logger.info("No files to process")
            return

        # リジューム時は処理済みファイルをスキップ
        if resume:
            files = [f for f in files if f['doc_id'] not in processed_file_ids]
            logger.info(f"Remaining files after resume: {len(files)}")

        if dry_run:
            logger.info(f"DRY RUN: Would process {len(files)} files")
            for i, file_info in enumerate(files[:10], 1):
                logger.info(f"  {i}. {file_info['file_name']} (ID: {file_info['doc_id'][:8]}...)")
            if len(files) > 10:
                logger.info(f"  ... and {len(files) - 10} more files")
            return

        # バッチ処理
        delay = 1.0 / self.tps_limit

        for i, file_info in enumerate(files, 1):
            logger.info(f"Progress: {i}/{len(files)} ({i/len(files)*100:.1f}%)")

            self.stats['processed'] += 1

            success = self.process_file(file_info)

            if success:
                self.stats['succeeded'] += 1
                processed_file_ids.append(file_info['doc_id'])
            else:
                self.stats['failed'] += 1

            # 進捗保存（10ファイルごと）
            if i % 10 == 0:
                self.save_progress(processed_file_ids)
                self.send_metrics()

            # スロットリング対策
            time.sleep(delay)

        # 最終的にrefresh
        logger.info("Refreshing OpenSearch index...")
        self.opensearch.indices.refresh(index=self.opensearch_index)

        # 最終統計
        runtime = time.time() - self.stats['start_time']
        logger.info("=" * 60)
        logger.info("Batch Processing Complete")
        logger.info("=" * 60)
        logger.info(f"Total Files: {self.stats['total_files']}")
        logger.info(f"Processed: {self.stats['processed']}")
        logger.info(f"Succeeded: {self.stats['succeeded']}")
        logger.info(f"Failed: {self.stats['failed']}")
        logger.info(f"Success Rate: {(self.stats['succeeded']/max(self.stats['processed'],1))*100:.1f}%")
        logger.info(f"Runtime: {runtime:.1f} seconds ({runtime/60:.1f} minutes)")
        logger.info(f"Throughput: {self.stats['processed']/(runtime/60):.1f} files/minute")
        logger.info("=" * 60)

        # 最終進捗保存
        self.save_progress(processed_file_ids)
        self.send_metrics()


def main():
    """メインエントリーポイント"""
    parser = argparse.ArgumentParser(
        description='Batch Image Embedding Generator for OpenSearch',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Dry run (preview files to be processed)
  python3 batch-generate-image-embeddings.py --dry-run

  # Process first 100 files
  python3 batch-generate-image-embeddings.py --max-files 100

  # Resume from last checkpoint
  python3 batch-generate-image-embeddings.py --resume

  # Full batch processing
  python3 batch-generate-image-embeddings.py --batch-size 10 --tps-limit 8
        """
    )

    parser.add_argument('--opensearch-endpoint', required=False,
                        default=os.environ.get('OPENSEARCH_ENDPOINT'),
                        help='OpenSearch endpoint URL')
    parser.add_argument('--opensearch-index', default='file-index-v2-knn',
                        help='OpenSearch index name')
    parser.add_argument('--s3-bucket', required=False,
                        default=os.environ.get('S3_BUCKET'),
                        help='S3 bucket name')
    parser.add_argument('--bedrock-region', default='us-east-1',
                        help='Bedrock region')
    parser.add_argument('--bedrock-model', default='amazon.titan-embed-image-v1',
                        help='Bedrock model ID')
    parser.add_argument('--aws-region', default='ap-northeast-1',
                        help='AWS region')
    parser.add_argument('--batch-size', type=int, default=10,
                        help='Batch size for processing')
    parser.add_argument('--tps-limit', type=int, default=8,
                        help='TPS limit for Bedrock API calls')
    parser.add_argument('--max-files', type=int,
                        help='Maximum number of files to process')
    parser.add_argument('--dry-run', action='store_true',
                        help='Dry run mode (no actual processing)')
    parser.add_argument('--resume', action='store_true',
                        help='Resume from last checkpoint')
    parser.add_argument('--state-file', default='batch-progress.json',
                        help='Progress state file')

    args = parser.parse_args()

    # 必須パラメータチェック
    if not args.opensearch_endpoint:
        logger.error("OpenSearch endpoint is required (--opensearch-endpoint or OPENSEARCH_ENDPOINT env var)")
        sys.exit(1)

    if not args.s3_bucket:
        logger.error("S3 bucket is required (--s3-bucket or S3_BUCKET env var)")
        sys.exit(1)

    try:
        # バッチ処理実行
        generator = BatchEmbeddingGenerator(
            opensearch_endpoint=args.opensearch_endpoint,
            opensearch_index=args.opensearch_index,
            s3_bucket=args.s3_bucket,
            bedrock_region=args.bedrock_region,
            bedrock_model=args.bedrock_model,
            aws_region=args.aws_region,
            batch_size=args.batch_size,
            tps_limit=args.tps_limit,
            state_file=args.state_file
        )

        generator.run(
            max_files=args.max_files,
            dry_run=args.dry_run,
            resume=args.resume
        )

    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(0)

    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
