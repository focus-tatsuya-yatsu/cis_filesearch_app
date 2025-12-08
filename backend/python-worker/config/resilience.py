"""
Resilience Configuration Module
エラーハンドリング、リトライ戦略、サーキットブレーカーの設定
"""

import os
import logging
from typing import Optional, Callable, Any
from dataclasses import dataclass
from enum import Enum
import time
from functools import wraps

logger = logging.getLogger(__name__)


class RetryStrategy(Enum):
    """リトライ戦略の種類"""
    EXPONENTIAL_BACKOFF = "exponential_backoff"
    LINEAR_BACKOFF = "linear_backoff"
    FIXED_DELAY = "fixed_delay"


class ErrorSeverity(Enum):
    """エラーの重要度"""
    TRANSIENT = "transient"  # 一時的なエラー（リトライ可能）
    PERMANENT = "permanent"  # 恒久的なエラー（リトライ不要）
    FATAL = "fatal"  # 致命的エラー（即座にDLQへ）


@dataclass
class RetryConfig:
    """リトライ設定"""

    # 基本設定
    max_retries: int = int(os.environ.get('MAX_RETRIES', '3'))
    initial_delay_seconds: float = float(os.environ.get('INITIAL_RETRY_DELAY', '2.0'))
    max_delay_seconds: float = float(os.environ.get('MAX_RETRY_DELAY', '60.0'))

    # リトライ戦略
    strategy: RetryStrategy = RetryStrategy.EXPONENTIAL_BACKOFF
    backoff_multiplier: float = 2.0  # 指数バックオフの倍率

    # ジッター（ランダム遅延）の追加
    add_jitter: bool = True
    jitter_max_seconds: float = 5.0

    # リトライ可能なエラータイプ
    retryable_exceptions: tuple = (
        ConnectionError,
        TimeoutError,
        # AWS一時的エラー
        # ClientError with specific codes
    )


@dataclass
class CircuitBreakerConfig:
    """サーキットブレーカー設定"""

    # 状態遷移の閾値
    failure_threshold: int = 5  # 連続失敗回数でOPEN状態へ
    success_threshold: int = 2  # 連続成功回数でCLOSED状態へ

    # タイムアウト
    timeout_seconds: float = 30.0
    half_open_timeout_seconds: float = 60.0  # HALF_OPEN状態の持続時間

    # 監視ウィンドウ
    rolling_window_seconds: int = 300  # 5分間のエラー率を監視


@dataclass
class DeadLetterQueueConfig:
    """デッドレターキュー設定"""

    # DLQ設定
    dlq_queue_url: str = os.environ.get('DLQ_QUEUE_URL', '')
    max_receive_count: int = int(os.environ.get('DLQ_MAX_RECEIVE_COUNT', '3'))

    # DLQ送信の条件
    send_to_dlq_on_permanent_error: bool = True
    send_to_dlq_on_max_retries: bool = True

    # DLQメッセージの保持期間（秒）
    message_retention_period: int = 14 * 24 * 60 * 60  # 14日間

    def is_configured(self) -> bool:
        """DLQが設定されているか確認"""
        return bool(self.dlq_queue_url)


@dataclass
class TimeoutConfig:
    """タイムアウト設定"""

    # 処理全体のタイムアウト
    overall_timeout_seconds: int = int(os.environ.get('OVERALL_TIMEOUT', '300'))

    # 各処理段階のタイムアウト
    s3_download_timeout: int = int(os.environ.get('S3_DOWNLOAD_TIMEOUT', '60'))
    file_processing_timeout: int = int(os.environ.get('FILE_PROCESSING_TIMEOUT', '180'))
    opensearch_index_timeout: int = int(os.environ.get('OPENSEARCH_INDEX_TIMEOUT', '30'))

    # OCR専用タイムアウト
    ocr_timeout_per_page: int = int(os.environ.get('OCR_TIMEOUT_PER_PAGE', '10'))

    # タイムアウト時のアクション
    raise_on_timeout: bool = True
    cleanup_on_timeout: bool = True


class ResilienceManager:
    """レジリエンス機能を提供するマネージャークラス"""

    def __init__(
        self,
        retry_config: Optional[RetryConfig] = None,
        circuit_breaker_config: Optional[CircuitBreakerConfig] = None,
        dlq_config: Optional[DeadLetterQueueConfig] = None,
        timeout_config: Optional[TimeoutConfig] = None,
    ):
        self.retry_config = retry_config or RetryConfig()
        self.circuit_breaker_config = circuit_breaker_config or CircuitBreakerConfig()
        self.dlq_config = dlq_config or DeadLetterQueueConfig()
        self.timeout_config = timeout_config or TimeoutConfig()

        # サーキットブレーカーの状態
        self.circuit_state = "CLOSED"  # CLOSED, OPEN, HALF_OPEN
        self.failure_count = 0
        self.success_count = 0
        self.last_failure_time = 0

        logger.info("ResilienceManager initialized")

    def calculate_delay(self, attempt: int) -> float:
        """
        リトライ遅延時間を計算

        Args:
            attempt: リトライ試行回数（0から開始）

        Returns:
            遅延時間（秒）
        """
        if self.retry_config.strategy == RetryStrategy.EXPONENTIAL_BACKOFF:
            delay = min(
                self.retry_config.initial_delay_seconds * (
                    self.retry_config.backoff_multiplier ** attempt
                ),
                self.retry_config.max_delay_seconds
            )
        elif self.retry_config.strategy == RetryStrategy.LINEAR_BACKOFF:
            delay = min(
                self.retry_config.initial_delay_seconds * (attempt + 1),
                self.retry_config.max_delay_seconds
            )
        else:  # FIXED_DELAY
            delay = self.retry_config.initial_delay_seconds

        # ジッターを追加
        if self.retry_config.add_jitter:
            import random
            jitter = random.uniform(0, self.retry_config.jitter_max_seconds)
            delay += jitter

        return delay

    def classify_error(self, exception: Exception) -> ErrorSeverity:
        """
        エラーの種類を分類

        Args:
            exception: 発生した例外

        Returns:
            ErrorSeverity
        """
        # 一時的なエラー（リトライ可能）
        if isinstance(exception, self.retry_config.retryable_exceptions):
            return ErrorSeverity.TRANSIENT

        # ファイルサイズ超過などの恒久的エラー
        if isinstance(exception, ValueError) and "exceeds maximum size" in str(exception):
            return ErrorSeverity.PERMANENT

        # サポートされていないファイル形式
        if isinstance(exception, ValueError) and "Unsupported file type" in str(exception):
            return ErrorSeverity.PERMANENT

        # その他は一時的なエラーとして扱う
        return ErrorSeverity.TRANSIENT

    def should_retry(self, exception: Exception, attempt: int) -> bool:
        """
        リトライすべきか判定

        Args:
            exception: 発生した例外
            attempt: 現在の試行回数

        Returns:
            リトライすべきか
        """
        # 最大リトライ回数を超えた場合
        if attempt >= self.retry_config.max_retries:
            logger.warning(f"Max retries ({self.retry_config.max_retries}) exceeded")
            return False

        # サーキットブレーカーがOPEN状態の場合
        if self.circuit_state == "OPEN":
            logger.warning("Circuit breaker is OPEN - skipping retry")
            return False

        # エラーの種類を判定
        severity = self.classify_error(exception)

        if severity == ErrorSeverity.PERMANENT or severity == ErrorSeverity.FATAL:
            logger.info(f"Error classified as {severity.value} - no retry")
            return False

        # TRANSIENT エラーはリトライ可能
        logger.info(f"Error classified as {severity.value} - retry allowed")
        return True

    def record_failure(self):
        """失敗を記録してサーキットブレーカーの状態を更新"""
        self.failure_count += 1
        self.success_count = 0
        self.last_failure_time = time.time()

        # 閾値を超えたらOPEN状態へ
        if self.failure_count >= self.circuit_breaker_config.failure_threshold:
            self.circuit_state = "OPEN"
            logger.warning(
                f"Circuit breaker opened after {self.failure_count} failures"
            )

    def record_success(self):
        """成功を記録してサーキットブレーカーの状態を更新"""
        self.success_count += 1
        self.failure_count = 0

        # HALF_OPEN状態で成功したらCLOSED状態へ
        if self.circuit_state == "HALF_OPEN":
            if self.success_count >= self.circuit_breaker_config.success_threshold:
                self.circuit_state = "CLOSED"
                logger.info("Circuit breaker closed after successful recovery")

    def check_circuit_state(self):
        """サーキットブレーカーの状態を確認・更新"""
        if self.circuit_state == "OPEN":
            # OPEN状態が一定時間経過したらHALF_OPEN状態へ
            elapsed = time.time() - self.last_failure_time
            if elapsed >= self.circuit_breaker_config.half_open_timeout_seconds:
                self.circuit_state = "HALF_OPEN"
                self.failure_count = 0
                logger.info("Circuit breaker moved to HALF_OPEN state")


def with_retry(resilience_manager: ResilienceManager):
    """
    リトライ機能を提供するデコレーター

    使用例:
        @with_retry(resilience_manager)
        def process_file(file_path):
            # 処理
            pass
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            resilience_manager.check_circuit_state()

            last_exception = None

            for attempt in range(resilience_manager.retry_config.max_retries + 1):
                try:
                    # 関数を実行
                    result = func(*args, **kwargs)

                    # 成功を記録
                    resilience_manager.record_success()

                    return result

                except Exception as e:
                    last_exception = e
                    logger.warning(
                        f"Attempt {attempt + 1} failed: {e}",
                        exc_info=(attempt == resilience_manager.retry_config.max_retries)
                    )

                    # リトライ判定
                    if not resilience_manager.should_retry(e, attempt):
                        resilience_manager.record_failure()
                        raise

                    # 最後の試行でなければ待機
                    if attempt < resilience_manager.retry_config.max_retries:
                        delay = resilience_manager.calculate_delay(attempt)
                        logger.info(f"Retrying in {delay:.2f} seconds...")
                        time.sleep(delay)

            # すべてのリトライが失敗
            resilience_manager.record_failure()
            raise last_exception

        return wrapper
    return decorator


def with_timeout(timeout_seconds: float):
    """
    タイムアウト機能を提供するデコレーター

    使用例:
        @with_timeout(30.0)
        def process_file(file_path):
            # 処理
            pass
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs) -> Any:
            import signal

            def timeout_handler(signum, frame):
                raise TimeoutError(f"Function {func.__name__} timed out after {timeout_seconds}s")

            # タイムアウトシグナルを設定
            old_handler = signal.signal(signal.SIGALRM, timeout_handler)
            signal.alarm(int(timeout_seconds))

            try:
                result = func(*args, **kwargs)
                signal.alarm(0)  # タイムアウトをキャンセル
                return result
            finally:
                signal.signal(signal.SIGALRM, old_handler)

        return wrapper
    return decorator
