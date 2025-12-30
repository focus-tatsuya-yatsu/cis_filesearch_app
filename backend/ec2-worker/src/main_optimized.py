#!/usr/bin/env python3
"""
CIS File Search Application - EC2 Worker - OPTIMIZED VERSION
Main entry point for high-performance file processing worker

Performance Target: 500-1000 messages/minute on t3.medium
"""

import logging
import sys
import os
import time
import gc
import psutil
from datetime import datetime
from typing import Dict

# ローカルモジュール
from config_optimized import config
from s3_client import S3Client
from ocr_processor import OCRProcessor
from thumbnail_generator import ThumbnailGenerator
from bedrock_client import BedrockClient
from opensearch_client import OpenSearchClient
from sqs_handler_optimized import OptimizedSQSHandler
from log_filter import SensitiveDataFilter, PathSanitizer, setup_secure_logging

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

    # ✅ SECURITY: Add sensitive data filter to all logs
    setup_secure_logging()

logger = logging.getLogger(__name__)


class OptimizedFileProcessor:
    """最適化されたファイル処理クラス"""

    def __init__(self):
        """初期化"""
        logger.info("Initializing OPTIMIZED File Processor...")

        # 各クライアントを初期化
        self.s3_client = S3Client()

        # ✅ OPTIMIZATION: 機能が有効な場合のみ初期化（メモリ節約）
        self.ocr_processor = OCRProcessor() if config.features.enable_ocr else None
        self.thumbnail_generator = ThumbnailGenerator() if config.features.enable_thumbnail else None
        self.bedrock_client = BedrockClient() if config.features.enable_vector_search else None

        self.opensearch_client = OpenSearchClient()

        # 処理統計
        self.stats = {
            'processed': 0,
            'failed': 0,
            'start_time': time.time(),
            'last_memory_check': time.time()
        }

        # ✅ OPTIMIZATION: 最適なスレッド数を計算
        optimal_threads = config.get_optimal_thread_count()
        logger.info(f"Optimal thread count: {optimal_threads} (configured: {config.worker.threads})")

        logger.info(f"Features enabled: OCR={config.features.enable_ocr}, "
                   f"Thumbnail={config.features.enable_thumbnail}, "
                   f"Vector={config.features.enable_vector_search}")
        logger.info("File Processor initialized successfully")

    def process_file(self, bucket: str, key: str) -> bool:
        """
        S3ファイルを処理してOpenSearchにインデックス

        ✅ OPTIMIZATION:
        - 不要な機能をスキップ
        - メモリ効率的な処理
        - 早期リターンで無駄な処理を回避

        Args:
            bucket: S3バケット名
            key: S3オブジェクトキー

        Returns:
            処理成功の場合True
        """
        start_time = time.time()
        temp_file = None

        try:
            # ✅ OPTIMIZATION: メモリチェック（定期的）
            if time.time() - self.stats['last_memory_check'] > config.performance.memory_check_interval:
                self._check_memory_usage()
                self.stats['last_memory_check'] = time.time()

            # ファイル情報を取得
            file_info = self.s3_client.get_object_metadata(bucket, key)
            if not file_info:
                logger.error(f"File not found: s3://{bucket}/{key}")
                return False

            # ドキュメント基本情報を構築
            from pathlib import Path
            import hashlib

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

            # ✅ OPTIMIZATION: 重い処理（OCR、サムネイル、ベクトル化）をスキップ可能に
            # 速度優先の場合はすべて無効化

            # ファイルダウンロードは必要な機能が有効な場合のみ
            needs_download = (config.features.enable_ocr or
                            config.features.enable_thumbnail or
                            config.features.enable_vector_search)

            if needs_download:
                temp_file = self.s3_client.download_file(bucket, key)

                # OCR処理（有効な場合のみ）
                if config.features.enable_ocr and self.ocr_processor:
                    ocr_result = self._perform_ocr(temp_file, document)
                    if ocr_result:
                        document.update(ocr_result)

                # サムネイル生成（有効な場合のみ）
                if config.features.enable_thumbnail and self.thumbnail_generator:
                    thumbnail_result = self._generate_thumbnail(temp_file, key, document)
                    if thumbnail_result:
                        document.update(thumbnail_result)

                # ベクトル化（有効な場合のみ）
                if config.features.enable_vector_search and self.bedrock_client:
                    vector_result = self._generate_vector(temp_file, document)
                    if vector_result:
                        document.update(vector_result)

            # OpenSearchにインデックス
            document['processing_status'] = 'completed'
            document['indexed_at'] = datetime.utcnow().isoformat()

            success = self.opensearch_client.index_document(document)

            if success:
                # S3からファイルを削除（ランディングバケットの場合）
                if 'landing' in bucket.lower():
                    self.s3_client.delete_file(bucket, key)

                self.stats['processed'] += 1

                # ✅ OPTIMIZATION: 処理時間をデバッグレベルでログ（INFO だと遅い）
                processing_time = time.time() - start_time
                logger.debug(f"Processed {key} in {processing_time:.2f}s")

                return True
            else:
                logger.error(f"Failed to index document: {key}")
                self.stats['failed'] += 1
                return False

        except Exception as e:
            logger.error(f"Error processing file {key}: {str(e)}")
            self.stats['failed'] += 1
            return False

        finally:
            # ✅ OPTIMIZATION: メモリクリーンアップを確実に実行
            if temp_file:
                self.s3_client.cleanup_temp_file(temp_file)

            # ✅ OPTIMIZATION: 定期的にガベージコレクション実行
            if self.stats['processed'] % 100 == 0:
                gc.collect()

    def _perform_ocr(self, file_path: str, document: Dict) -> Dict:
        """OCR処理を実行（元のコードと同じ）"""
        try:
            ocr_result = self.ocr_processor.process_file(file_path)
            if ocr_result['success']:
                return {
                    'ocr_text': ocr_result.get('text', ''),
                    'ocr_confidence': ocr_result.get('confidence', 0.0),
                    'content': ocr_result.get('text', ''),
                    'pages': ocr_result.get('pages', 1)
                }
            return {}
        except Exception as e:
            logger.error(f"OCR processing error: {str(e)}")
            return {}

    def _generate_thumbnail(self, file_path: str, key: str, document: Dict) -> Dict:
        """サムネイルを生成（元のコードと同じ）"""
        try:
            from pathlib import Path
            import io

            thumbnail_data = self.thumbnail_generator.generate_with_metadata(file_path)
            if thumbnail_data['thumbnail']:
                thumbnail_key = f"thumbnails/{Path(key).stem}_thumb.jpg"
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
            return {}
        except Exception as e:
            logger.error(f"Thumbnail generation error: {str(e)}")
            return {}

    def _generate_vector(self, file_path: str, document: Dict) -> Dict:
        """ベクトル埋め込みを生成（元のコードと同じ）"""
        try:
            from pathlib import Path

            file_extension = Path(file_path).suffix.lower()

            if file_extension in ['.jpg', '.jpeg', '.png', '.gif', '.bmp']:
                vector = self.bedrock_client.generate_image_embedding(file_path)
                if vector:
                    return {'image_vector': vector}

            elif document.get('content'):
                text = document['content'][:1000]
                vector = self.bedrock_client.generate_text_embedding(text)
                if vector:
                    return {'image_vector': vector}

            return {}
        except Exception as e:
            logger.error(f"Vector generation error: {str(e)}")
            return {}

    def _check_memory_usage(self):
        """
        ✅ NEW: メモリ使用量をチェックして警告
        """
        try:
            memory = psutil.virtual_memory()
            memory_percent = memory.percent

            if memory_percent > config.performance.memory_warning_threshold:
                logger.warning(f"⚠️  High memory usage: {memory_percent:.1f}% "
                             f"(threshold: {config.performance.memory_warning_threshold}%)")

                # メモリ使用量が90%を超えたら強制的にGC実行
                if memory_percent > 90:
                    logger.warning("Forcing garbage collection due to high memory usage")
                    gc.collect()

        except Exception as e:
            logger.error(f"Failed to check memory usage: {str(e)}")


def main():
    """メイン処理"""
    # ロギング設定
    setup_logging()

    logger.info("=" * 80)
    logger.info("CIS File Search Application - EC2 Worker [OPTIMIZED VERSION]")
    logger.info(f"Version: 2.0.0 (Performance Optimized)")
    logger.info(f"Target: {config.performance.target_messages_per_minute} messages/minute")
    logger.info(f"Region: {config.aws.region}")
    logger.info(f"Queue: {config.sqs.queue_url}")
    logger.info(f"Worker Threads: {config.worker.threads}")
    logger.info(f"Parallel SQS Fetch: {config.sqs.parallel_fetch_count}")
    logger.info("=" * 80)

    # 設定検証
    if not config.validate():
        logger.error("Configuration validation failed")
        sys.exit(1)

    try:
        # ✅ OPTIMIZATION: システムリソース情報を表示
        cpu_count = psutil.cpu_count()
        memory_total_gb = psutil.virtual_memory().total / (1024**3)
        logger.info(f"System Resources: {cpu_count} CPUs, {memory_total_gb:.1f}GB RAM")

        # ファイルプロセッサーを初期化
        processor = OptimizedFileProcessor()

        # 接続テスト
        logger.info("Testing connections...")

        # Bedrockテスト（有効な場合のみ）
        if config.features.enable_vector_search and processor.bedrock_client:
            if not processor.bedrock_client.test_connection():
                logger.warning("Bedrock connection test failed, vector search disabled")
                config.features.enable_vector_search = False

        # OpenSearchテスト
        stats = processor.opensearch_client.get_stats()
        logger.info(f"OpenSearch index contains {stats.get('document_count', 0)} documents")

        # ✅ OPTIMIZATION: 最適化されたSQSハンドラーを使用
        sqs_handler = OptimizedSQSHandler(processor.process_file)

        # キュー情報を表示
        queue_depth = sqs_handler.get_queue_depth()
        logger.info(f"Queue depth: {queue_depth} messages")

        if queue_depth > 0:
            estimated_hours = (queue_depth / config.performance.target_messages_per_minute) / 60
            logger.info(f"Estimated completion time: {estimated_hours:.1f} hours "
                       f"(at {config.performance.target_messages_per_minute} msg/min)")

        # ポーリング開始
        logger.info("🚀 Starting OPTIMIZED message processing...")
        sqs_handler.start_polling()

    except KeyboardInterrupt:
        logger.info("Received keyboard interrupt, shutting down...")

    except Exception as e:
        logger.error(f"Fatal error: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        sys.exit(1)

    finally:
        # 最終統計を表示
        if 'processor' in locals():
            uptime = time.time() - processor.stats['start_time']
            logger.info("=" * 80)
            logger.info("Final Statistics:")
            logger.info(f"Processed: {processor.stats['processed']} files")
            logger.info(f"Failed: {processor.stats['failed']} files")
            logger.info(f"Uptime: {uptime:.2f} seconds ({uptime/60:.1f} minutes)")

            if uptime > 0:
                msg_per_min = (processor.stats['processed'] / uptime) * 60
                logger.info(f"Average Speed: {msg_per_min:.1f} messages/minute")

            logger.info("=" * 80)

    logger.info("Worker shutdown complete")
    sys.exit(0)


if __name__ == "__main__":
    main()
