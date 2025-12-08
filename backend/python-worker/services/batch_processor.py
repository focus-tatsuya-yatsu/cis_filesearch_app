"""
Batch Processing Service
複数メッセージの効率的な並列処理とバッチインデックス
"""

import logging
import time
from typing import List, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
import threading

logger = logging.getLogger(__name__)


@dataclass
class BatchResult:
    """バッチ処理の結果"""

    total_messages: int
    successful: int
    failed: int
    processing_time_seconds: float
    messages_per_second: float
    errors: List[Dict[str, Any]]

    def to_dict(self) -> Dict[str, Any]:
        return {
            'total_messages': self.total_messages,
            'successful': self.successful,
            'failed': self.failed,
            'processing_time_seconds': self.processing_time_seconds,
            'messages_per_second': self.messages_per_second,
            'success_rate': (self.successful / self.total_messages * 100) if self.total_messages > 0 else 0,
            'errors': self.errors,
        }


class BatchProcessor:
    """
    バッチ処理マネージャー
    複数メッセージの並列処理とバッチインデックスを提供
    """

    def __init__(self, config):
        """
        初期化

        Args:
            config: アプリケーション設定
        """
        self.config = config
        self.max_workers = config.processing.max_workers

        # スレッドセーフなカウンター
        self._lock = threading.Lock()
        self._processed_count = 0
        self._success_count = 0
        self._failed_count = 0

        logger.info(f"BatchProcessor initialized with {self.max_workers} workers")

    def process_messages_batch(
        self,
        messages: List[Dict[str, Any]],
        process_func: callable,
        use_threading: bool = True
    ) -> BatchResult:
        """
        メッセージをバッチ処理

        Args:
            messages: 処理するメッセージのリスト
            process_func: 各メッセージを処理する関数 (message) -> success: bool
            use_threading: 並列処理を使用するか

        Returns:
            BatchResult
        """
        start_time = time.time()

        # カウンターをリセット
        with self._lock:
            self._processed_count = 0
            self._success_count = 0
            self._failed_count = 0

        errors = []

        if use_threading and len(messages) > 1:
            # 並列処理
            logger.info(f"Processing {len(messages)} messages in parallel (workers: {self.max_workers})")
            errors = self._process_parallel(messages, process_func)
        else:
            # 順次処理
            logger.info(f"Processing {len(messages)} messages sequentially")
            errors = self._process_sequential(messages, process_func)

        # 処理時間を計算
        processing_time = time.time() - start_time
        messages_per_second = len(messages) / processing_time if processing_time > 0 else 0

        # 結果を作成
        result = BatchResult(
            total_messages=len(messages),
            successful=self._success_count,
            failed=self._failed_count,
            processing_time_seconds=processing_time,
            messages_per_second=messages_per_second,
            errors=errors
        )

        logger.info(
            f"Batch processing completed: {result.successful}/{result.total_messages} successful "
            f"({result.messages_per_second:.2f} msg/s)"
        )

        return result

    def _process_parallel(
        self,
        messages: List[Dict[str, Any]],
        process_func: callable
    ) -> List[Dict[str, Any]]:
        """並列処理の実装"""
        errors = []

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            # すべてのタスクをサブミット
            future_to_message = {
                executor.submit(self._process_single_message, msg, process_func): msg
                for msg in messages
            }

            # 完了したタスクを処理
            for future in as_completed(future_to_message):
                message = future_to_message[future]

                try:
                    success = future.result()

                    with self._lock:
                        self._processed_count += 1
                        if success:
                            self._success_count += 1
                        else:
                            self._failed_count += 1

                except Exception as e:
                    logger.error(f"Error processing message: {e}", exc_info=True)

                    with self._lock:
                        self._processed_count += 1
                        self._failed_count += 1

                    errors.append({
                        'message_id': message.get('MessageId', 'unknown'),
                        'error': str(e),
                        'error_type': type(e).__name__,
                    })

        return errors

    def _process_sequential(
        self,
        messages: List[Dict[str, Any]],
        process_func: callable
    ) -> List[Dict[str, Any]]:
        """順次処理の実装"""
        errors = []

        for message in messages:
            try:
                success = self._process_single_message(message, process_func)

                self._processed_count += 1
                if success:
                    self._success_count += 1
                else:
                    self._failed_count += 1

            except Exception as e:
                logger.error(f"Error processing message: {e}", exc_info=True)

                self._processed_count += 1
                self._failed_count += 1

                errors.append({
                    'message_id': message.get('MessageId', 'unknown'),
                    'error': str(e),
                    'error_type': type(e).__name__,
                })

        return errors

    def _process_single_message(
        self,
        message: Dict[str, Any],
        process_func: callable
    ) -> bool:
        """
        単一メッセージを処理

        Args:
            message: SQSメッセージ
            process_func: 処理関数

        Returns:
            成功した場合True
        """
        try:
            return process_func(message)
        except Exception as e:
            logger.error(f"Error in process_func: {e}")
            raise


class BatchIndexer:
    """
    OpenSearchへのバッチインデックス機能
    """

    def __init__(self, opensearch_client, batch_size: int = 100):
        """
        初期化

        Args:
            opensearch_client: OpenSearchクライアント
            batch_size: バッチサイズ
        """
        self.opensearch_client = opensearch_client
        self.batch_size = batch_size
        self.document_buffer = []

        # スレッドセーフな操作
        self._lock = threading.Lock()

        logger.info(f"BatchIndexer initialized with batch_size={batch_size}")

    def add_document(self, document: Dict[str, Any]) -> bool:
        """
        ドキュメントをバッファに追加

        Args:
            document: インデックスするドキュメント

        Returns:
            バッファがフラッシュされた場合True
        """
        with self._lock:
            self.document_buffer.append(document)

            # バッファがバッチサイズに達したらフラッシュ
            if len(self.document_buffer) >= self.batch_size:
                return self.flush()

        return False

    def flush(self) -> bool:
        """
        バッファ内のドキュメントをすべてインデックス

        Returns:
            成功した場合True
        """
        with self._lock:
            if not self.document_buffer:
                return True

            documents_to_index = self.document_buffer.copy()
            self.document_buffer.clear()

        logger.info(f"Flushing {len(documents_to_index)} documents to OpenSearch...")

        try:
            # バルクインデックス
            result = self.opensearch_client.bulk_index(documents_to_index)

            success_count = result.get('success', 0)
            failed_count = result.get('failed', 0)

            if failed_count > 0:
                logger.warning(
                    f"Batch indexing completed with errors: "
                    f"{success_count} succeeded, {failed_count} failed"
                )
                return False
            else:
                logger.info(f"Batch indexing successful: {success_count} documents")
                return True

        except Exception as e:
            logger.error(f"Batch indexing failed: {e}", exc_info=True)

            # エラー時はバッファに戻す（オプション）
            # with self._lock:
            #     self.document_buffer.extend(documents_to_index)

            return False

    def __enter__(self):
        """コンテキストマネージャー開始"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """コンテキストマネージャー終了時にフラッシュ"""
        if self.document_buffer:
            logger.info("Flushing remaining documents on context exit...")
            self.flush()


class MessageBatcher:
    """
    SQSメッセージのバッチ取得と管理
    """

    def __init__(self, sqs_client, queue_url: str, config):
        """
        初期化

        Args:
            sqs_client: boto3 SQSクライアント
            queue_url: SQSキューURL
            config: アプリケーション設定
        """
        self.sqs_client = sqs_client
        self.queue_url = queue_url
        self.config = config

        # バッチサイズ（SQSの最大は10）
        self.batch_size = min(config.aws.sqs_max_messages, 10)

        logger.info(f"MessageBatcher initialized with batch_size={self.batch_size}")

    def receive_message_batch(self) -> List[Dict[str, Any]]:
        """
        バッチでメッセージを受信

        Returns:
            メッセージのリスト
        """
        try:
            response = self.sqs_client.receive_message(
                QueueUrl=self.queue_url,
                MaxNumberOfMessages=self.batch_size,
                WaitTimeSeconds=self.config.aws.sqs_wait_time_seconds,
                VisibilityTimeout=self.config.aws.sqs_visibility_timeout,
                MessageAttributeNames=['All'],
                AttributeNames=['All']
            )

            messages = response.get('Messages', [])

            if messages:
                logger.info(f"Received {len(messages)} messages from queue")

            return messages

        except Exception as e:
            logger.error(f"Error receiving messages: {e}")
            return []

    def delete_message_batch(
        self,
        receipt_handles: List[str]
    ) -> Dict[str, int]:
        """
        複数メッセージを一括削除

        Args:
            receipt_handles: 削除するメッセージのレシートハンドルリスト

        Returns:
            成功/失敗カウントの辞書
        """
        if not receipt_handles:
            return {'successful': 0, 'failed': 0}

        # SQSのバッチ削除は最大10件まで
        batch_size = 10
        total_successful = 0
        total_failed = 0

        for i in range(0, len(receipt_handles), batch_size):
            batch = receipt_handles[i:i + batch_size]

            try:
                # バッチ削除エントリーを作成
                entries = [
                    {
                        'Id': str(idx),
                        'ReceiptHandle': handle
                    }
                    for idx, handle in enumerate(batch)
                ]

                # バッチ削除実行
                response = self.sqs_client.delete_message_batch(
                    QueueUrl=self.queue_url,
                    Entries=entries
                )

                successful = len(response.get('Successful', []))
                failed = len(response.get('Failed', []))

                total_successful += successful
                total_failed += failed

                if failed > 0:
                    logger.warning(
                        f"Batch delete partially failed: "
                        f"{successful} succeeded, {failed} failed"
                    )

            except Exception as e:
                logger.error(f"Batch delete error: {e}")
                total_failed += len(batch)

        logger.info(
            f"Batch delete completed: "
            f"{total_successful} succeeded, {total_failed} failed"
        )

        return {'successful': total_successful, 'failed': total_failed}
