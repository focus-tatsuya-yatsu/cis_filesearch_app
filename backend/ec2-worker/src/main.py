#!/usr/bin/env python3
"""
CIS File Search Application - EC2 Worker
Main entry point for file processing worker
"""

import logging
import sys
import os
import time
import json
import tempfile
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Dict, Optional, Any
import psutil
import boto3

# ローカルモジュール
from config import config
from s3_client import S3Client
from ocr_processor import OCRProcessor
from thumbnail_generator import ThumbnailGenerator
from bedrock_client import BedrockClient
from opensearch_client import OpenSearchClient
from sqs_handler import SQSHandler

# ロギング設定
def setup_logging():
    """ロギングを設定"""
    log_format = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'

    # ルートロガー設定
    logging.basicConfig(
        level=getattr(logging, config.logging.level),
        format=log_format
    )

    # ファイルハンドラー追加（設定されている場合）
    if config.logging.file:
        file_handler = logging.FileHandler(config.logging.file)
        file_handler.setFormatter(logging.Formatter(log_format))
        logging.getLogger().addHandler(file_handler)

    # CloudWatchハンドラーはCloudWatch Agentで処理

logger = logging.getLogger(__name__)


class FileProcessor:
    """ファイル処理クラス"""

    def __init__(self):
        """初期化"""
        logger.info("Initializing File Processor...")

        # 各クライアントを初期化
        self.s3_client = S3Client()
        self.ocr_processor = OCRProcessor()
        self.thumbnail_generator = ThumbnailGenerator()
        self.bedrock_client = BedrockClient()
        self.opensearch_client = OpenSearchClient()

        # CloudWatchメトリクス用
        self.cloudwatch = boto3.client('cloudwatch', **config.get_boto3_config())

        # 処理統計
        self.stats = {
            'processed': 0,
            'failed': 0,
            'start_time': time.time()
        }

        logger.info("File Processor initialized successfully")

    def process_file(self, bucket: str, key: str) -> bool:
        """
        S3ファイルを処理してOpenSearchにインデックス

        Args:
            bucket: S3バケット名
            key: S3オブジェクトキー

        Returns:
            処理成功の場合True
        """
        start_time = time.time()
        temp_file = None

        try:
            logger.info(f"Processing file: s3://{bucket}/{key}")

            # ファイル情報を取得
            file_info = self.s3_client.get_object_metadata(bucket, key)
            if not file_info:
                logger.error(f"File not found: s3://{bucket}/{key}")
                return False

            # ドキュメント基本情報を構築
            document = {
                'file_id': hashlib.md5(f"{bucket}/{key}".encode()).hexdigest(),
                'file_name': Path(key).name,
                'file_path': f"s3://{bucket}/{key}",
                'file_extension': Path(key).suffix.lower(),
                'file_size': file_info['ContentLength'],
                'mime_type': file_info.get('ContentType', 'application/octet-stream'),
                'modified_at': file_info.get('LastModified', datetime.utcnow()).isoformat(),
                'processing_status': 'processing'
            }

            # ファイルをダウンロード
            temp_file = self.s3_client.download_file(bucket, key)

            # OCR処理（有効な場合）
            if config.features.enable_ocr:
                ocr_result = self._perform_ocr(temp_file, document)
                if ocr_result:
                    document.update(ocr_result)

            # サムネイル生成（有効な場合）
            if config.features.enable_thumbnail:
                thumbnail_result = self._generate_thumbnail(temp_file, key, document)
                if thumbnail_result:
                    document.update(thumbnail_result)

            # ベクトル化（有効な場合）
            if config.features.enable_vector_search:
                vector_result = self._generate_vector(temp_file, document)
                if vector_result:
                    document.update(vector_result)

            # OpenSearchにインデックス
            document['processing_status'] = 'completed'
            document['indexed_at'] = datetime.utcnow().isoformat()

            success = self.opensearch_client.index_document(document)

            if success:
                logger.info(f"Successfully processed file: {key}")

                # S3からファイルを削除（ランディングバケットの場合）
                if 'landing' in bucket.lower():
                    self.s3_client.delete_file(bucket, key)
                    logger.info(f"Deleted processed file from landing bucket: {key}")

                # 処理時間を記録
                processing_time = time.time() - start_time
                self._send_metrics('FileProcessed', 1)
                self._send_metrics('ProcessingTime', processing_time)

                self.stats['processed'] += 1
                return True
            else:
                logger.error(f"Failed to index document: {key}")
                self.stats['failed'] += 1
                return False

        except Exception as e:
            logger.error(f"Error processing file {key}: {str(e)}")
            self.stats['failed'] += 1

            # エラー情報をOpenSearchに記録
            try:
                error_doc = {
                    'file_path': f"s3://{bucket}/{key}",
                    'processing_status': 'error',
                    'error_message': str(e),
                    'indexed_at': datetime.utcnow().isoformat()
                }
                self.opensearch_client.index_document(error_doc)
            except:
                pass

            return False

        finally:
            # 一時ファイルをクリーンアップ
            if temp_file:
                self.s3_client.cleanup_temp_file(temp_file)

    def _perform_ocr(self, file_path: str, document: Dict) -> Dict:
        """
        OCR処理を実行

        Args:
            file_path: ファイルパス
            document: ドキュメント辞書

        Returns:
            OCR結果
        """
        try:
            logger.debug(f"Performing OCR on {file_path}")
            ocr_result = self.ocr_processor.process_file(file_path)

            if ocr_result['success']:
                return {
                    'ocr_text': ocr_result.get('text', ''),
                    'ocr_confidence': ocr_result.get('confidence', 0.0),
                    'content': ocr_result.get('text', ''),  # 全文検索用
                    'pages': ocr_result.get('pages', 1)
                }
            else:
                logger.warning(f"OCR failed: {ocr_result.get('error')}")
                return {}

        except Exception as e:
            logger.error(f"OCR processing error: {str(e)}")
            return {}

    def _generate_thumbnail(self, file_path: str, key: str, document: Dict) -> Dict:
        """
        サムネイルを生成

        Args:
            file_path: ファイルパス
            key: S3キー
            document: ドキュメント辞書

        Returns:
            サムネイル結果
        """
        try:
            logger.debug(f"Generating thumbnail for {file_path}")

            # サムネイル生成
            thumbnail_data = self.thumbnail_generator.generate_with_metadata(file_path)

            if thumbnail_data['thumbnail']:
                # S3にアップロード
                thumbnail_key = f"thumbnails/{Path(key).stem}_thumb.jpg"

                # BytesIOオブジェクトを作成
                import io
                thumbnail_io = io.BytesIO(thumbnail_data['thumbnail'])

                thumbnail_url = self.s3_client.upload_fileobj(
                    thumbnail_io,
                    config.s3.thumbnail_bucket,
                    thumbnail_key,
                    content_type='image/jpeg'
                )

                return {
                    'thumbnail_url': thumbnail_url,
                    'thumbnail_s3_key': thumbnail_key
                }
            else:
                logger.warning("Failed to generate thumbnail")
                return {}

        except Exception as e:
            logger.error(f"Thumbnail generation error: {str(e)}")
            return {}

    def _generate_vector(self, file_path: str, document: Dict) -> Dict:
        """
        ベクトル埋め込みを生成

        Args:
            file_path: ファイルパス
            document: ドキュメント辞書

        Returns:
            ベクトル結果
        """
        try:
            file_extension = Path(file_path).suffix.lower()

            # 画像ファイルの場合
            if file_extension in ['.jpg', '.jpeg', '.png', '.gif', '.bmp']:
                logger.debug(f"Generating image vector for {file_path}")

                # 画像ベクトル生成
                vector = self.bedrock_client.generate_image_embedding(file_path)

                if vector:
                    return {'image_vector': vector}

            # テキストコンテンツがある場合
            elif document.get('content'):
                logger.debug("Generating text vector from content")

                # テキストベクトル生成
                text = document['content'][:1000]  # 最初の1000文字
                vector = self.bedrock_client.generate_text_embedding(text)

                if vector:
                    return {'image_vector': vector}  # 同じフィールドに格納

            return {}

        except Exception as e:
            logger.error(f"Vector generation error: {str(e)}")
            return {}

    def _send_metrics(self, metric_name: str, value: float, unit: str = 'Count'):
        """
        CloudWatchメトリクスを送信

        Args:
            metric_name: メトリクス名
            value: 値
            unit: 単位
        """
        try:
            self.cloudwatch.put_metric_data(
                Namespace='CIS/FileProcessor',
                MetricData=[
                    {
                        'MetricName': metric_name,
                        'Value': value,
                        'Unit': unit,
                        'Timestamp': datetime.utcnow()
                    }
                ]
            )
        except Exception as e:
            logger.warning(f"Failed to send metric {metric_name}: {str(e)}")

    def get_system_status(self) -> Dict:
        """
        システムステータスを取得

        Returns:
            ステータス情報
        """
        try:
            return {
                'cpu_percent': psutil.cpu_percent(interval=1),
                'memory_percent': psutil.virtual_memory().percent,
                'disk_usage': psutil.disk_usage('/').percent,
                'processed_files': self.stats['processed'],
                'failed_files': self.stats['failed'],
                'uptime': time.time() - self.stats['start_time']
            }
        except Exception as e:
            logger.error(f"Failed to get system status: {str(e)}")
            return {}


def main():
    """メイン処理"""
    # ロギング設定
    setup_logging()

    logger.info("=" * 60)
    logger.info("CIS File Search Application - EC2 Worker")
    logger.info(f"Version: 1.0.0")
    logger.info(f"Region: {config.aws.region}")
    logger.info(f"Queue: {config.sqs.queue_url}")
    logger.info("=" * 60)

    # 設定検証
    if not config.validate():
        logger.error("Configuration validation failed")
        sys.exit(1)

    try:
        # ファイルプロセッサーを初期化
        processor = FileProcessor()

        # 接続テスト
        logger.info("Testing connections...")

        # Bedrockテスト
        if config.features.enable_vector_search:
            if not processor.bedrock_client.test_connection():
                logger.warning("Bedrock connection test failed, vector search disabled")
                config.features.enable_vector_search = False

        # OpenSearchテスト
        stats = processor.opensearch_client.get_stats()
        logger.info(f"OpenSearch index contains {stats.get('document_count', 0)} documents")

        # SQSハンドラーを初期化
        sqs_handler = SQSHandler(processor.process_file)

        # キュー情報を表示
        queue_depth = sqs_handler.get_queue_depth()
        logger.info(f"Queue depth: {queue_depth} messages")

        # ポーリング開始
        logger.info("Starting message processing...")
        sqs_handler.start_polling()

    except KeyboardInterrupt:
        logger.info("Received keyboard interrupt, shutting down...")

    except Exception as e:
        logger.error(f"Fatal error: {str(e)}")
        sys.exit(1)

    finally:
        # 最終統計を表示
        if 'processor' in locals():
            logger.info("=" * 60)
            logger.info("Final Statistics:")
            logger.info(f"Processed: {processor.stats['processed']} files")
            logger.info(f"Failed: {processor.stats['failed']} files")
            logger.info(f"Uptime: {time.time() - processor.stats['start_time']:.2f} seconds")
            logger.info("=" * 60)

    logger.info("Worker shutdown complete")
    sys.exit(0)


if __name__ == "__main__":
    main()